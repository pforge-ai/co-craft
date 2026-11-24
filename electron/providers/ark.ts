import {
  mapSizeToAspectRatio,
  pickParams,
  type ImageDriverRequest,
  type ImageDriverResult,
  type MediaProviderDriver,
  type ProviderHttp,
  type VideoDriverRequest,
  type VideoPollResult,
  type VideoSubmitResult,
} from './types';

const ARK_STATUS_MAP: Record<string, VideoPollResult['status']> = {
  queued: 'pending',
  pending: 'pending',
  running: 'running',
  in_progress: 'running',
  processing: 'running',
  succeeded: 'succeeded',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'canceled',
  canceled: 'canceled',
  expired: 'expired',
};

export const arkDriver: MediaProviderDriver = {
  adapters: ['ark-image', 'ark-video'],

  async generateImage(req: ImageDriverRequest, http: ProviderHttp): Promise<ImageDriverResult> {
    const { provider, model, prompt, params, references, signal } = req;
    const size = req.resolution || req.size || (params.size ? String(params.size) : undefined);
    const background = req.background || (params.background ? String(params.background) : undefined);
    const outputFormat =
      background === 'transparent'
        ? 'png'
        : params.output_format
          ? String(params.output_format)
          : undefined;

    const imageField =
      references.length > 1
        ? references.map((r) => r.dataUri)
        : references.length === 1
          ? references[0].dataUri
          : undefined;

    const data: any = await http.json(
      provider,
      'images/generations',
      {
        ...pickParams(params, ['size', 'seed', 'watermark', 'guidance_scale', 'output_format', 'background']),
        model: model.modelId,
        prompt,
        ...(size ? { size } : {}),
        ...(background ? { background } : {}),
        ...(outputFormat ? { output_format: outputFormat } : {}),
        response_format: 'b64_json',
        ...(imageField ? { image: imageField } : {}),
      },
      { signal },
    );
    const item = data?.data?.[0];
    return {
      ...(item?.b64_json ? { b64_json: item.b64_json } : {}),
      ...(item?.url ? { url: item.url } : {}),
    };
  },

  async submitVideo(req: VideoDriverRequest, http: ProviderHttp): Promise<VideoSubmitResult> {
    const { provider, model, prompt, params, references, lastFrame, signal } = req;
    const ratio =
      req.aspectRatio ||
      mapSizeToAspectRatio(req.size) ||
      (req.size && !/^\d+[x*]\d+$/i.test(req.size) ? req.size : undefined) ||
      (params.ratio ? String(params.ratio) : undefined);
    const rawRes = req.resolution || (params.resolution ? String(params.resolution) : undefined);
    const resolution = rawRes ? rawRes.trim().toLowerCase() : undefined;
    const duration = req.seconds || (params.duration ? Number(params.duration) : undefined);
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
      'contents/generations/tasks',
      {
        ...pickParams(params, ['seed', 'watermark', 'camera_fixed']),
        model: model.modelId,
        content,
        ...(resolution ? { resolution } : {}),
        ...(ratio ? { ratio } : {}),
        ...(duration ? { duration: Number(duration) } : {}),
        ...(generateAudio !== undefined ? { generate_audio: Boolean(generateAudio) } : {}),
      },
      { signal },
    );
    const remoteId = data?.id;
    if (typeof remoteId !== 'string' || !remoteId) {
      throw new Error('火山方舟未返回云任务 ID，请核对推理接入点/模型 ID 与控制台记录');
    }
    return { remoteId, initialStatus: 'queued' };
  },

  async pollVideo(provider, remote, http, signal): Promise<VideoPollResult> {
    const res = await http.request(provider, `contents/generations/tasks/${encodeURIComponent(remote.id)}`, {
      signal,
    });
    const data: any = await res.json();
    const raw = String(data.status || '').toLowerCase();
    const status = ARK_STATUS_MAP[raw];
    if (!status) throw new Error('火山方舟返回了无法识别的云任务状态，请核对服务商记录');
    const progress = Number(data.progress);
    const fraction = Number.isFinite(progress) ? Math.min(0.95, Math.max(0, progress / 100)) : undefined;
    if (status === 'succeeded') {
      const videoUrl =
        data.content?.video_url ||
        (Array.isArray(data.content)
          ? data.content.find((c: any) => typeof c?.video_url === 'string')?.video_url
          : undefined) ||
        data.output?.video_url;
      return { status, videoUrl };
    }
    if (status === 'failed' || status === 'canceled' || status === 'expired') {
      return { status, errorMessage: data.error?.message || `云任务已终止（${status}）` };
    }
    return { status, progress: fraction };
  },
};
