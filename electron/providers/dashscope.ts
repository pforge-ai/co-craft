import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProviderConnection } from '../../src/core/types';
import {
  dashscopeSizeFormat,
  mapSizeToAspectRatio,
  pickParams,
  type ImageDriverRequest,
  type ImageDriverResult,
  type MediaProviderDriver,
  type ProviderHttp,
  type SpeechDriverRequest,
  type SpeechDriverResult,
  type VideoDriverRequest,
  type VideoPollResult,
  type VideoSubmitResult,
} from './types';

const DASHSCOPE_STATUS_MAP: Record<string, VideoPollResult['status']> = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
  CANCELLED: 'canceled',
  UNKNOWN: 'expired',
};

const POLL_TIMEOUT_MS = 15 * 60 * 1000;

export function isDashscopeMediaArrayVideo(modelId: string): boolean {
  return /^(wan3\.0|wan2\.7|happyhorse|kling\/)/i.test(modelId.trim());
}

export function isDashscopeAnimateVideo(modelId: string): boolean {
  return /^wan2\.2-animate-(move|mix)/i.test(modelId.trim());
}

export function isDashscopeS2VVideo(modelId: string): boolean {
  return /^wan2\.2-s2v/i.test(modelId.trim());
}

export function isDashscopeMultimodalImage(modelId: string): boolean {
  return /^(qwen-image|wan2\.7-image|z-image)/i.test(modelId.trim());
}

/**
 * Official Alibaba Cloud DashScope temporary OSS file upload flow:
 * 1) GET /api/v1/uploads?action=getPolicy&model=<modelId>
 * 2) Multipart POST directly to upload_host (SSRF-validated, no Bearer header leaked)
 * 3) Returns `oss://<upload_dir>/<fileName>` (48h temporary storage, resolved via `X-DashScope-OssResourceResolve: enable`)
 */
async function uploadDashscopeTempOss(
  provider: ProviderConnection,
  modelId: string,
  file: { bytes: Buffer; fileName: string; mime: string },
  http: ProviderHttp,
  signal: AbortSignal,
): Promise<string> {
  const policyRes = await http.request(
    provider,
    `uploads?action=getPolicy&model=${encodeURIComponent(modelId)}`,
    {
      method: 'GET',
      baseKind: 'native',
      headers: { 'X-DashScope-OssResourceResolve': 'enable' },
      signal,
    },
  );
  const policyJson: any = await policyRes.json();
  const d = policyJson?.data;
  if (!d?.upload_host || !d?.upload_dir || !d?.oss_access_key_id || !d?.policy || !d?.signature) {
    throw new Error('阿里百炼临时上传凭证获取失败，请核对 API Key 与模型权限');
  }
  const uploadUrl = new URL(String(d.upload_host));
  await http.assertSafeUrl(uploadUrl, provider.baseUrl);
  const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'input.bin';
  const key = `${String(d.upload_dir).replace(/\/+$/, '')}/${safeName}`;
  const form = new FormData();
  form.set('OSSAccessKeyId', String(d.oss_access_key_id));
  form.set('Signature', String(d.signature));
  form.set('policy', String(d.policy));
  form.set('x-oss-object-acl', String(d.x_oss_object_acl || 'private'));
  form.set('x-oss-forbid-overwrite', String(d.x_oss_forbid_overwrite || 'true'));
  form.set('key', key);
  form.set('success_action_status', '200');
  // Per Alibaba Cloud OSS PostObject contract, `file` MUST be the final field
  form.set('file', new Blob([new Uint8Array(file.bytes)], { type: file.mime }), safeName);

  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    body: form,
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
  });
  if (!upRes.ok) {
    const errText = await upRes.text().catch(() => '');
    throw new Error(`上传驱动素材至百炼临时存储失败 (${upRes.status})：${errText.slice(0, 240)}`);
  }
  return `oss://${key}`;
}

async function pollDashscopeTaskRaw(
  provider: ProviderConnection,
  taskId: string,
  http: ProviderHttp,
  signal: AbortSignal,
) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let transientErrors = 0;
  for (;;) {
    signal.throwIfAborted();
    if (Date.now() > deadline) {
      throw new Error('云端生成任务等待超时（超过 15 分钟），可在后台作业面板稍后继续查询');
    }
    let data: any;
    try {
      const res = await http.request(provider, `tasks/${encodeURIComponent(taskId)}`, {
        signal,
        baseKind: 'native',
      });
      data = await res.json();
      transientErrors = 0;
    } catch (err: any) {
      if (signal.aborted) throw err;
      const isTransient = (typeof err?.status === 'number' && err.status >= 500) || typeof err?.status !== 'number';
      if (isTransient && transientErrors < 3) {
        transientErrors++;
        await delay(2000 * transientErrors, undefined, { signal });
        continue;
      }
      throw err;
    }
    const rawStatus = String(data.output?.task_status || '').toUpperCase();
    const status = DASHSCOPE_STATUS_MAP[rawStatus];
    signal.throwIfAborted();
    if (!status) throw new Error('阿里百炼返回了无法识别的任务状态，请核对控制台记录');
    if (status === 'succeeded') {
      await http.onStage('云端生成完成', undefined, status);
      return data;
    }
    if (status === 'failed' || status === 'canceled' || status === 'expired') {
      await http.onStage('云端任务已终止', undefined, status);
      throw new Error(data.output?.message || data.message || `云任务已终止（${status}）`);
    }
    const stage = status === 'pending' ? '云端排队中' : '云端生成中';
    await http.onStage(stage, undefined, status);
    await delay(1800, undefined, { signal });
  }
}

function extractDashscopeImage(dsRes: any): ImageDriverResult {
  const contentList = dsRes?.output?.choices?.[0]?.message?.content;
  const contentImg = Array.isArray(contentList)
    ? contentList.find((c: any) => typeof c?.image === 'string' && c.image)?.image
    : undefined;
  const resultItem = dsRes?.output?.results?.[0];
  const imgVal = contentImg || resultItem?.url || resultItem?.b64_image;
  if (typeof imgVal === 'string' && imgVal) {
    return imgVal.startsWith('data:') || !/^https?:\/\//i.test(imgVal)
      ? { b64_json: imgVal }
      : { url: imgVal };
  }
  return {};
}

export const dashscopeDriver: MediaProviderDriver = {
  adapters: ['dashscope-image', 'dashscope-video', 'dashscope-speech'],

  async generateImage(req: ImageDriverRequest, http: ProviderHttp): Promise<ImageDriverResult> {
    const { provider, model, prompt, params, references, signal } = req;
    const modelId = model.modelId;
    let dsRes: any;

    if (req.existingRemote?.id) {
      dsRes = await pollDashscopeTaskRaw(provider, req.existingRemote.id, http, signal);
      return extractDashscopeImage(dsRes);
    }

    const sizeVal = dashscopeSizeFormat(req.resolution || req.size || params.size);
    const contentItems: Array<{ image?: string; text?: string }> = [
      ...references.map((r) => ({ image: r.dataUri })),
      { text: prompt },
    ];

    if (isDashscopeMultimodalImage(modelId)) {
      const isQwenEdit = /^qwen-image-edit/i.test(modelId);
      const isWan27Image = /^wan2\.7-image/i.test(modelId);
      const isZImage = /^z-image/i.test(modelId);
      const allowSizeWithRef = isWan27Image || /^qwen-image-3/i.test(modelId);
      const extraKeys = isWan27Image
        ? ['seed', 'watermark', 'thinking_mode']
        : isZImage
          ? ['seed', 'prompt_extend']
          : ['seed', 'watermark', 'prompt_extend', 'negative_prompt'];
      try {
        dsRes = await http.json(
          provider,
          'services/aigc/multimodal-generation/generation',
          {
            model: modelId,
            input: {
              messages: [{ role: 'user', content: contentItems }],
            },
            parameters: {
              ...pickParams(params, extraKeys),
              ...(!isZImage ? { n: 1 } : {}),
              ...(!isQwenEdit && sizeVal && (allowSizeWithRef || !references.length) ? { size: sizeVal } : {}),
            },
          },
          { signal, baseKind: 'native' },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Legacy qwen-image-plus / qwen-image on some DashScope workspaces serve via async text2image/image-synthesis
        if (/^qwen-image/i.test(modelId) && !references.length && /(404|Model not exist|InvalidParameter)/i.test(msg)) {
          dsRes = await http.json(
            provider,
            'services/aigc/text2image/image-synthesis',
            {
              model: modelId,
              input: {
                prompt,
                ...(params.negative_prompt ? { negative_prompt: params.negative_prompt } : {}),
              },
              parameters: {
                ...pickParams(params, ['seed', 'watermark', 'prompt_extend']),
                n: 1,
                ...(sizeVal ? { size: sizeVal } : {}),
              },
            },
            { signal, baseKind: 'native', extraHeaders: { 'X-DashScope-Async': 'enable' } },
          );
        } else {
          throw err;
        }
      }
    } else if (/^wanx/i.test(modelId)) {
      dsRes = await http.json(
        provider,
        'services/aigc/text2image/image-synthesis',
        {
          model: modelId,
          input: {
            prompt,
            ...(params.negative_prompt ? { negative_prompt: params.negative_prompt } : {}),
            ...(references[0] ? { ref_img: references[0].dataUri } : {}),
          },
          parameters: {
            ...pickParams(params, ['seed', 'watermark', 'prompt_extend']),
            n: 1,
            ...(sizeVal ? { size: sizeVal } : {}),
          },
        },
        { signal, baseKind: 'native', extraHeaders: { 'X-DashScope-Async': 'enable' } },
      );
    } else {
      // wan2.6-image / wan2.6-t2i / kling/kling-v3-image-generation / vidu/*
      dsRes = await http.json(
        provider,
        'services/aigc/image-generation/generation',
        {
          model: modelId,
          input: {
            messages: [{ role: 'user', content: contentItems }],
          },
          parameters: {
            ...pickParams(params, ['seed', 'watermark', 'prompt_extend', 'negative_prompt']),
            n: 1,
            ...(sizeVal ? { size: sizeVal } : {}),
          },
        },
        { signal, baseKind: 'native', extraHeaders: { 'X-DashScope-Async': 'enable' } },
      );
    }

    if (dsRes?.output?.task_id) {
      await http.onRemoteCreated({ id: dsRes.output.task_id, status: 'pending' });
      dsRes = await pollDashscopeTaskRaw(provider, dsRes.output.task_id, http, signal);
    }
    return extractDashscopeImage(dsRes);
  },

  async submitVideo(req: VideoDriverRequest, http: ProviderHttp): Promise<VideoSubmitResult> {
    const { provider, model, prompt, params, references, lastFrame, motionVideo, driverAudio, signal } = req;
    const modelId = model.modelId;
    const lowerId = modelId.toLowerCase();
    const duration = req.seconds || (params.duration ? Number(params.duration) : undefined);
    const audio = req.generateAudio !== undefined ? req.generateAudio : params.audio;

    // 1) Wan 2.2 Animate Move (Motion Transfer) & Animate Mix (Character Replacement)
    if (isDashscopeAnimateVideo(modelId)) {
      if (!references[0]) throw new Error('动作迁移/视频换人需要连入 1 张角色主体图片');
      if (!motionVideo) throw new Error('动作迁移/视频换人需要连入 1 段驱动视频（motion-video）');
      await http.onStage('正在上传角色图与驱动视频');
      const imgExt = references[0].mime === 'image/jpeg' ? 'jpg' : 'png';
      const imageOss = await uploadDashscopeTempOss(
        provider,
        modelId,
        { bytes: references[0].buffer, fileName: `subject-${references[0].assetId}.${imgExt}`, mime: references[0].mime },
        http,
        signal,
      );
      const vidBytes = await readFile(motionVideo.filePath);
      const videoOss = await uploadDashscopeTempOss(
        provider,
        modelId,
        { bytes: vidBytes, fileName: motionVideo.fileName || `motion-${motionVideo.assetId}.mp4`, mime: motionVideo.mime },
        http,
        signal,
      );
      await http.onStage('正在提交动作表演云端任务');
      const modeVal = req.animateMode || (params.mode === 'wan-pro' ? 'wan-pro' : 'wan-std');
      const data = await http.json(
        provider,
        'services/aigc/image2video/video-synthesis',
        {
          model: modelId,
          input: {
            image_url: imageOss,
            video_url: videoOss,
          },
          parameters: {
            mode: modeVal,
            ...(params.check_image !== undefined ? { check_image: Boolean(params.check_image) } : {}),
          },
        },
        {
          signal,
          baseKind: 'native',
          extraHeaders: {
            'X-DashScope-Async': 'enable',
            'X-DashScope-OssResourceResolve': 'enable',
          },
        },
      );
      const remoteId = data?.output?.task_id;
      if (typeof remoteId !== 'string' || !remoteId) {
        throw new Error('阿里百炼动作表演接口未返回云任务 ID，请核对模型权限与素材格式');
      }
      return { remoteId, initialStatus: 'pending' };
    }

    // 2) Wan 2.2 S2V (Audio-Driven Lip-Sync Digital Performance)
    if (isDashscopeS2VVideo(modelId)) {
      if (!references[0]) throw new Error('音频驱动对口型需要连入 1 张角色主体图片');
      if (!driverAudio) throw new Error('音频驱动对口型需要连入 1 段配音音频（driver-audio）');
      await http.onStage('正在上传角色图与驱动音频');
      const imgExt = references[0].mime === 'image/jpeg' ? 'jpg' : 'png';
      const imageOss = await uploadDashscopeTempOss(
        provider,
        modelId,
        { bytes: references[0].buffer, fileName: `subject-${references[0].assetId}.${imgExt}`, mime: references[0].mime },
        http,
        signal,
      );
      const audBytes = await readFile(driverAudio.filePath);
      const audioOss = await uploadDashscopeTempOss(
        provider,
        modelId,
        { bytes: audBytes, fileName: driverAudio.fileName || `driver-${driverAudio.assetId}.wav`, mime: driverAudio.mime },
        http,
        signal,
      );
      await http.onStage('正在提交对口型云端任务');
      const rawRes = req.resolution || params.resolution || '720P';
      const resolution = String(rawRes).trim().toUpperCase() === '480P' ? '480P' : '720P';
      const data = await http.json(
        provider,
        'services/aigc/image2video/video-synthesis',
        {
          model: modelId,
          input: {
            image_url: imageOss,
            audio_url: audioOss,
          },
          parameters: {
            resolution,
            style: String(params.style || 'speech'),
          },
        },
        {
          signal,
          baseKind: 'native',
          extraHeaders: {
            'X-DashScope-Async': 'enable',
            'X-DashScope-OssResourceResolve': 'enable',
          },
        },
      );
      const remoteId = data?.output?.task_id;
      if (typeof remoteId !== 'string' || !remoteId) {
        throw new Error('阿里百炼对口型接口未返回云任务 ID，请核对模型权限与音频格式');
      }
      return { remoteId, initialStatus: 'pending' };
    }

    let payload: Record<string, unknown>;

    if (isDashscopeMediaArrayVideo(modelId)) {
      const isR2V = /-r2v/i.test(lowerId);
      const isWan3 = /^wan3\.0/i.test(lowerId);
      const isKling = /^kling\//i.test(lowerId);
      const media: Array<{ type: string; url: string }> = [];

      if (isR2V) {
        for (const ref of references) media.push({ type: 'reference_image', url: ref.dataUri });
      } else if (lastFrame || references.length === 1) {
        if (references[0]) media.push({ type: 'first_frame', url: references[0].dataUri });
        if (lastFrame) media.push({ type: 'last_frame', url: lastFrame.dataUri });
        if (isWan3 || lowerId.includes('omni')) {
          for (const extra of references.slice(1)) media.push({ type: 'reference_image', url: extra.dataUri });
        }
      } else if (references.length > 1) {
        for (const ref of references) media.push({ type: 'reference_image', url: ref.dataUri });
      }

      const rawRes = req.resolution || (req.size && /^(480|720|1080)p$/i.test(req.size.trim()) ? req.size : undefined) || params.resolution;
      const resolution = rawRes ? String(rawRes).trim().toUpperCase() : undefined;
      const ratioVal =
        req.aspectRatio ||
        mapSizeToAspectRatio(req.size) ||
        (params.aspect_ratio ? String(params.aspect_ratio) : undefined) ||
        (params.ratio ? String(params.ratio) : undefined);

      const paramBag: Record<string, unknown> = {
        ...pickParams(params, ['seed', 'watermark', 'prompt_extend']),
        ...(resolution && !isKling ? { resolution } : {}),
        ...(duration ? { duration: Number(duration) } : {}),
        ...(audio !== undefined ? { audio: Boolean(audio) } : {}),
      };
      if (ratioVal) {
        if (isWan3 || isKling) paramBag.aspect_ratio = ratioVal;
        else if (!/-i2v/i.test(lowerId)) paramBag.ratio = ratioVal;
      }

      payload = {
        model: modelId,
        input: {
          prompt,
          ...(params.negative_prompt ? { negative_prompt: params.negative_prompt } : {}),
          ...(media.length ? { media } : {}),
        },
        parameters: paramBag,
      };
    } else {
      // Legacy Wan 2.6 / 2.5 / 2.2 / 2.1 video-synthesis contracts
      const sizeInput = req.size || params.size;
      const sizeIsPreset = typeof sizeInput === 'string' && /^(480|720|1080)p$/i.test(sizeInput.trim());
      const resInput = req.resolution || (sizeIsPreset ? String(sizeInput).trim().toUpperCase() : undefined);
      const baseParams = pickParams(params, ['resolution', 'seed', 'watermark', 'prompt_extend', 'audio']);
      if (sizeInput && !sizeIsPreset && !req.resolution) {
        delete baseParams.resolution;
      }
      if (audio !== undefined) baseParams.audio = Boolean(audio);

      const inputBag: Record<string, unknown> = {
        prompt,
        ...(params.negative_prompt ? { negative_prompt: params.negative_prompt } : {}),
      };
      if (/-kf2v/i.test(lowerId)) {
        if (references[0]) inputBag.first_frame_url = references[0].dataUri;
        if (lastFrame) inputBag.last_frame_url = lastFrame.dataUri;
      } else if (/-r2v/i.test(lowerId)) {
        if (references.length) inputBag.reference_urls = references.map((r) => r.dataUri);
      } else if (references[0]) {
        inputBag.img_url = references[0].dataUri;
      }

      payload = {
        model: modelId,
        input: inputBag,
        parameters: {
          ...baseParams,
          ...(duration ? { duration: Number(duration) } : {}),
          ...(resInput
            ? { resolution: String(resInput).trim().toUpperCase() }
            : sizeInput
              ? { size: dashscopeSizeFormat(sizeInput) }
              : {}),
        },
      };
    }

    const data = await http.json(provider, 'services/aigc/video-generation/video-synthesis', payload, {
      signal,
      baseKind: 'native',
      extraHeaders: { 'X-DashScope-Async': 'enable' },
    });
    const remoteId = data?.output?.task_id;
    if (typeof remoteId !== 'string' || !remoteId) {
      throw new Error('阿里百炼未返回云任务 ID，请核对模型 ID 与账户控制台记录');
    }
    return { remoteId, initialStatus: 'pending' };
  },

  async pollVideo(provider, remote, http, signal): Promise<VideoPollResult> {
    const res = await http.request(provider, `tasks/${encodeURIComponent(remote.id)}`, {
      signal,
      baseKind: 'native',
    });
    const data: any = await res.json();
    const rawStatus = String(data.output?.task_status || '').toUpperCase();
    const status = DASHSCOPE_STATUS_MAP[rawStatus];
    if (!status) throw new Error('阿里百炼返回了无法识别的任务状态，请核对控制台记录');
    if (status === 'succeeded') {
      const videoUrl =
        data.output?.video_url ||
        data.output?.results?.video_url ||
        data.output?.results?.[0]?.url;
      return { status, videoUrl };
    }
    if (status === 'failed' || status === 'canceled' || status === 'expired') {
      return { status, errorMessage: data.output?.message || data.message || `云任务已终止（${status}）` };
    }
    return { status };
  },

  async generateSpeech(req: SpeechDriverRequest, http: ProviderHttp): Promise<SpeechDriverResult> {
    const data: any = await http.json(
      req.provider,
      'services/aigc/multimodal-generation/generation',
      {
        model: req.model.modelId,
        input: {
          text: req.prompt,
          voice: req.voice || req.params.voice || 'Cherry',
          ...(req.params.language_type ? { language_type: req.params.language_type } : {}),
        },
      },
      { signal: req.signal, baseKind: 'native' },
    );
    const audio = data.output?.audio;
    if (!audio?.data && !audio?.url) throw new Error('千问语音合成未返回音频内容');
    if (audio.data) {
      return { bytes: Buffer.from(String(audio.data).replace(/^data:[^,]+,/, ''), 'base64') };
    }
    return { url: String(audio.url) };
  },
};
