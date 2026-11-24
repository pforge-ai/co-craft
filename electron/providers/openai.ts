import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import {
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

const execFileAsync = promisify(execFile);

async function runSay(args: string[], signal?: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/say', args, { signal, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

const OPENAI_VIDEO_STATUS: Record<string, VideoPollResult['status']> = {
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

export const openaiDriver: MediaProviderDriver = {
  adapters: ['openai-image', 'openai-video', 'openai-speech', 'system-speech'],

  async generateImage(req: ImageDriverRequest, http: ProviderHttp): Promise<ImageDriverResult> {
    const { provider, model, prompt, params, references, signal } = req;
    const background = req.background || (params.background ? String(params.background) : undefined);
    const size = req.size || (params.size ? String(params.size) : undefined);

    if (references.length > 0) {
      const body = new FormData();
      for (const [key, value] of Object.entries({
        ...pickParams(params, [
          'size',
          'quality',
          'background',
          'input_fidelity',
          'output_format',
          'output_compression',
          'moderation',
        ]),
        model: model.modelId,
        prompt,
        n: 1,
        ...(size ? { size } : {}),
        ...(background ? { background } : {}),
      })) {
        body.append(key, String(value));
      }
      body.append(
        'image',
        new Blob([new Uint8Array(references[0].buffer)], { type: references[0].mime }),
        references[0].mime === 'image/jpeg' ? 'reference.jpg' : 'reference.png',
      );
      const data: any = await (await http.request(provider, 'images/edits', { method: 'POST', body, signal })).json();
      return data?.data?.[0] || {};
    }

    const data: any = await http.json(
      provider,
      'images/generations',
      {
        ...pickParams(params, ['size', 'quality', 'background', 'output_format', 'output_compression', 'moderation']),
        model: model.modelId,
        prompt,
        n: 1,
        ...(size ? { size } : {}),
        ...(background ? { background } : {}),
      },
      { signal },
    );
    return data?.data?.[0] || {};
  },

  async submitVideo(req: VideoDriverRequest, http: ProviderHttp): Promise<VideoSubmitResult> {
    const { provider, model, prompt, params, references, signal } = req;
    const body = new FormData();
    body.set('model', model.modelId);
    body.set('prompt', prompt);
    if (req.seconds || params.seconds) body.set('seconds', String(req.seconds || params.seconds));
    if (req.size || params.size) body.set('size', String(req.size || params.size));
    if (references[0]) {
      body.set(
        'input_reference',
        new Blob([new Uint8Array(references[0].buffer)], { type: references[0].mime }),
        references[0].mime === 'image/jpeg' ? 'reference.jpg' : 'reference.png',
      );
    }
    const data: any = await (await http.request(provider, 'videos', { method: 'POST', body, signal })).json();
    if (typeof data?.id !== 'string' || !data.id) {
      throw new Error('服务未返回云任务 ID，请核对提供商后台记录再重新提交');
    }
    return { remoteId: data.id, initialStatus: 'queued' };
  },

  async pollVideo(provider, remote, http, signal): Promise<VideoPollResult> {
    const route = `videos/${encodeURIComponent(remote.id)}`;
    const data: any = await (await http.request(provider, route, { signal })).json();
    const status = OPENAI_VIDEO_STATUS[String(data.status || '').toLowerCase()];
    if (!status) throw new Error('服务返回了无法识别的云任务状态，请核对服务商记录');
    const progress = Number(data.progress);
    const fraction = Number.isFinite(progress) ? Math.min(0.95, Math.max(0, progress / 100)) : undefined;
    if (status === 'succeeded') {
      return { status, streamPath: `${route}/content` };
    }
    if (status === 'failed' || status === 'canceled' || status === 'expired') {
      return { status, errorMessage: data.error?.message || `云任务已终止（${status}）` };
    }
    return { status, progress: fraction };
  },

  async generateSpeech(req: SpeechDriverRequest, http: ProviderHttp): Promise<SpeechDriverResult> {
    const output = join(req.dir, `${req.outputStem}.wav`);
    if (req.model.adapter === 'system-speech') {
      let voice = req.voice || String(req.params.voice || '');
      if (!voice) {
        const voices = await runSay(['-v', '?'], req.signal);
        const list = voices.split('\n');
        voice = (
          list.find((l) => /^Tingting\s+zh_CN/.test(l)) ||
          list.find((l) => l.includes('zh_CN')) ||
          list[0]
        ).split(/\s{2,}/)[0];
      }
      await runSay(
        [
          '-v',
          voice,
          '-r',
          String(req.params.rate || 175),
          '--file-format=WAVE',
          '--data-format=LEI16@24000',
          '-o',
          output,
          '--',
          req.prompt,
        ],
        req.signal,
      );
      return { filePath: output };
    }

    const response = await http.request(req.provider, 'audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...pickParams(req.params, ['speed', 'instructions']),
        model: req.model.modelId,
        input: req.prompt,
        voice: req.voice || req.params.voice || 'coral',
        response_format: 'wav',
      }),
      signal: req.signal,
    });
    if (!response.body) throw new Error('服务没有返回声音');
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(output, { flags: 'wx' }), {
      signal: req.signal,
    });
    return { filePath: output };
  },
};
