import {
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

const MINIMAX_STATUS_MAP: Record<string, VideoPollResult['status']> = {
  preparing: 'pending',
  queueing: 'pending',
  queued: 'pending',
  pending: 'pending',
  processing: 'running',
  running: 'running',
  success: 'succeeded',
  succeeded: 'succeeded',
  completed: 'succeeded',
  fail: 'failed',
  failed: 'failed',
  cancelled: 'canceled',
  canceled: 'canceled',
  expired: 'expired',
};

function assertMiniMaxOk(data: any, action: string) {
  const code = data?.base_resp?.status_code;
  if (typeof code === 'number' && code !== 0) {
    const msg = data?.base_resp?.status_msg || `错误码 ${code}`;
    throw new Error(`MiniMax ${action}失败 (${code})：${msg}`);
  }
}

export function isMiniMaxV2Video(modelId: string): boolean {
  return /^minimax-h3/i.test(modelId.trim());
}

export function isMiniMaxH3Image(modelId: string): boolean {
  return /h3-image/i.test(modelId.trim());
}

export const minimaxDriver: MediaProviderDriver = {
  adapters: ['minimax-image', 'minimax-video', 'minimax-speech'],

  async generateImage(req: ImageDriverRequest, http: ProviderHttp): Promise<ImageDriverResult> {
    const { provider, model, prompt, params, references, signal } = req;
    const modelId = model.modelId;
    const ratio = req.aspectRatio || mapSizeToAspectRatio(req.size) || (params.aspect_ratio ? String(params.aspect_ratio) : undefined);
    const size = req.size || (params.size ? String(params.size) : undefined);

    let data: any;
    if (isMiniMaxH3Image(modelId)) {
      if (references.length > 0) {
        data = await http.json(
          provider,
          'images/edits',
          {
            model: modelId,
            prompt,
            images: references.map((r) => ({ image_url: r.dataUri })),
            size: size || 'auto',
            n: 1,
            response_format: 'url',
          },
          { signal, baseKind: 'v1' },
        );
      } else {
        data = await http.json(
          provider,
          'images/generations',
          {
            model: modelId,
            prompt,
            ...(size ? { size } : {}),
            ...(ratio ? { aspect_ratio: ratio } : {}),
            n: 1,
            response_format: 'url',
          },
          { signal, baseKind: 'v1' },
        );
      }
    } else {
      // image-01 / image-01-live
      data = await http.json(
        provider,
        'image_generation',
        {
          ...pickParams(params, ['aspect_ratio', 'prompt_optimizer', 'seed']),
          model: modelId,
          prompt,
          ...(ratio ? { aspect_ratio: ratio } : {}),
          ...(references[0]
            ? { subject_reference: [{ type: 'character', image_file: references[0].dataUri }] }
            : {}),
          n: 1,
          response_format: 'url',
        },
        { signal, baseKind: 'v1' },
      );
    }

    assertMiniMaxOk(data, '生图');
    const url =
      data?.data?.[0]?.url ||
      data?.data?.image_urls?.[0] ||
      data?.image_urls?.[0];
    const b64 =
      data?.data?.[0]?.b64_json ||
      data?.data?.image_base64?.[0] ||
      data?.image_base64?.[0];
    return {
      ...(url ? { url: String(url) } : {}),
      ...(b64 ? { b64_json: String(b64) } : {}),
    };
  },

  async submitVideo(req: VideoDriverRequest, http: ProviderHttp): Promise<VideoSubmitResult> {
    const { provider, model, prompt, params, references, lastFrame, signal } = req;
    const modelId = model.modelId;
    const duration = req.seconds || (params.duration ? Number(params.duration) : undefined);
    const rawRes = req.resolution || (params.resolution ? String(params.resolution) : undefined);
    const resolution = rawRes ? rawRes.trim().toUpperCase() : undefined;
    const ratio = req.aspectRatio || mapSizeToAspectRatio(req.size) || (params.ratio ? String(params.ratio) : undefined);

    if (isMiniMaxV2Video(modelId)) {
      const generateAudio =
        req.generateAudio !== undefined ? req.generateAudio : params.generate_audio;
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
      if (lastFrame || references.length === 1) {
        if (references[0]) {
          content.push({
            type: 'image_url',
            image_url: { url: references[0].dataUri },
            role: 'first_frame',
          });
        }
        if (lastFrame) {
          content.push({
            type: 'image_url',
            image_url: { url: lastFrame.dataUri },
            role: 'last_frame',
          });
        }
      } else if (references.length > 1) {
        for (const ref of references) {
          content.push({
            type: 'image_url',
            image_url: { url: ref.dataUri },
            role: 'reference_image',
          });
        }
      }

      const data: any = await http.json(
        provider,
        'video_generation',
        {
          model: modelId,
          content,
          ...(duration ? { duration: Number(duration) } : {}),
          ...(resolution ? { resolution } : {}),
          ...(ratio ? { ratio } : {}),
          ...(generateAudio !== undefined ? { generate_audio: Boolean(generateAudio) } : {}),
        },
        { signal, baseKind: 'v2' },
      );
      assertMiniMaxOk(data, '视频提交');
      const remoteId = data?.task_id;
      if (typeof remoteId !== 'string' || !remoteId) {
        throw new Error('MiniMax 未返回视频任务 ID，请核对账户控制台记录');
      }
      return { remoteId, initialStatus: 'pending', apiVersion: 'v2' };
    }

    // Legacy v1: MiniMax-Hailuo-2.3 / Hailuo-02 / T2V-01-Director / I2V-01-live / S2V-01
    const body: Record<string, unknown> = {
      ...pickParams(params, ['prompt_optimizer', 'fast_pretreatment']),
      model: modelId,
      prompt,
      ...(duration ? { duration: Number(duration) } : {}),
      ...(resolution ? { resolution } : {}),
    };
    if (/^s2v-/i.test(modelId) && references[0]) {
      body.subject_reference = [{ type: 'character', image: [references[0].dataUri] }];
    } else {
      if (references[0]) body.first_frame_image = references[0].dataUri;
      if (lastFrame) body.last_frame_image = lastFrame.dataUri;
    }

    const data: any = await http.json(provider, 'video_generation', body, { signal, baseKind: 'v1' });
    assertMiniMaxOk(data, '视频提交');
    const remoteId = data?.task_id;
    if (typeof remoteId !== 'string' || !remoteId) {
      throw new Error('MiniMax 未返回视频任务 ID，请核对账户控制台记录');
    }
    return { remoteId, initialStatus: 'pending', apiVersion: 'v1' };
  },

  async pollVideo(provider, remote, http, signal): Promise<VideoPollResult> {
    const isV2 = remote.apiVersion === 'v2';
    const pollRes = isV2
      ? await http.request(provider, `query/video_generation/${encodeURIComponent(remote.id)}`, {
          signal,
          baseKind: 'v2',
        })
      : await http.request(
          provider,
          `query/video_generation?task_id=${encodeURIComponent(remote.id)}`,
          { signal, baseKind: 'v1' },
        );
    const data: any = await pollRes.json();
    assertMiniMaxOk(data, '视频查询');
    const rawStatus = String(data.status || '').toLowerCase();
    const status = MINIMAX_STATUS_MAP[rawStatus];
    if (!status) throw new Error('MiniMax 返回了无法识别的视频任务状态，请核对控制台记录');

    if (status === 'succeeded') {
      let videoUrl = data.content?.url || data.video_url;
      if (!videoUrl && data.file_id) {
        const fileRes = await http.request(
          provider,
          `files/retrieve?file_id=${encodeURIComponent(String(data.file_id))}`,
          { signal, baseKind: 'v1' },
        );
        const fileData: any = await fileRes.json();
        assertMiniMaxOk(fileData, '取回视频文件');
        videoUrl = fileData.file?.download_url || fileData.download_url;
      }
      return { status, videoUrl };
    }
    if (status === 'failed' || status === 'canceled' || status === 'expired') {
      return {
        status,
        errorMessage: data.base_resp?.status_msg || data.error?.message || `云任务已终止（${status}）`,
      };
    }
    return { status };
  },

  async generateSpeech(req: SpeechDriverRequest, http: ProviderHttp): Promise<SpeechDriverResult> {
    const { provider, model, prompt, params, voice, signal } = req;
    const voiceId = String(voice || params.voice || 'male-qn-qingse');
    const speed = params.speed !== undefined ? Number(params.speed) : 1.0;
    const vol = params.vol !== undefined ? Number(params.vol) : 1.0;
    const pitch = params.pitch !== undefined ? Number(params.pitch) : 0;

    const data: any = await http.json(
      provider,
      't2a_v2',
      {
        model: model.modelId,
        text: prompt,
        stream: false,
        output_format: 'hex',
        voice_setting: {
          voice_id: voiceId,
          speed,
          vol,
          pitch,
          ...(params.emotion ? { emotion: String(params.emotion) } : {}),
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      },
      { signal, baseKind: 'v1' },
    );
    assertMiniMaxOk(data, '语音合成');
    const audioField = data?.data?.audio;
    if (typeof audioField !== 'string' || !audioField) {
      throw new Error('MiniMax 语音合成未返回音频数据');
    }
    if (/^https?:\/\//i.test(audioField)) {
      return { url: audioField };
    }
    return { bytes: Buffer.from(audioField, 'hex') };
  },
};
