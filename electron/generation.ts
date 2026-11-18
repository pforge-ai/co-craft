import { nativeImage } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, rename, rm, open, link } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { binary, importMedia, run } from './media';
import { ProjectStore, atomicJSON } from './store';
import type { SettingsStore } from './settings';
import type { JobService } from './jobs';
import { uid } from '../src/core/project';
import { modelUses, selectedModel, normalizeProviderUrl as providerBase } from '../src/core/models';
import type {
  Asset,
  Job,
  ModelAdapter,
  ModelDefinition,
  ModelUse,
  ProviderConnection,
  ProjectEnvelope,
} from '../src/core/types';

export interface GenerationRequest {
  use: Exclude<ModelUse, 'agent'>;
  prompt?: string;
  modelId?: string;
  assetId?: string;
  referenceAssetId?: string;
  size?: string;
  seconds?: number;
  voice?: string;
  language?: string;
  parameters?: Record<string, string | number | boolean>;
}
interface GenerationSnapshot {
  request: GenerationRequest;
  model: ModelDefinition;
  provider: Omit<ProviderConnection, 'apiKey'>;
  publish: boolean;
  assets: Pick<Asset, 'id' | 'kind' | 'path' | 'name' | 'duration'>[];
}
type GenerationJob = Job & { generation: GenerationSnapshot };
type Resolved = { model: ModelDefinition; provider: ProviderConnection };
const label = (use: ModelUse) => modelUses.find((x) => x.id === use)?.name || use;
const parameters = (p: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => p[k] !== undefined && p[k] !== '').map((k) => [k, p[k]]));
const parameterKeys: Record<ModelAdapter, string[]> = {
  chat: ['temperature', 'maxTokens', 'contextWindow'],
  'ark-image': ['size', 'seed', 'watermark', 'guidance_scale', 'output_format', 'background'],
  'openai-image': [
    'size',
    'quality',
    'background',
    'input_fidelity',
    'output_format',
    'output_compression',
    'moderation',
  ],
  'ark-video': ['resolution', 'ratio', 'duration', 'seed', 'watermark', 'generate_audio', 'camera_fixed'],
  'openai-video': ['size', 'seconds'],
  'openai-speech': ['voice', 'speed', 'instructions'],
  'system-speech': ['voice', 'rate'],
  'openai-transcription': ['language', 'response_format', 'temperature'],
};
function modelParameters(adapter: ModelAdapter, raw?: Record<string, string | number | boolean>) {
  return Object.fromEntries(
    Object.entries(raw || {}).filter(
      ([key, value]) =>
        parameterKeys[adapter]?.includes(key) && ['string', 'number', 'boolean'].includes(typeof value),
    ),
  );
}
// Pi's Anthropic SDK adds /v1 itself; the Google SDK treats the configured base as already versioned.
export function chatEndpoint(protocol: string, baseUrl: string, modelId: string) {
  let base = providerBase(baseUrl);
  if (protocol === 'anthropic') base = base.replace(/\/v1$/, '');
  if (protocol === 'google' && new URL(base).pathname === '/') base += '/v1beta';
  return { baseUrl: base, modelId: protocol === 'google' ? modelId.replace(/^models\//, '') : modelId };
}
function endpoint(provider: ProviderConnection, path: string) {
  const { baseUrl } = chatEndpoint(provider.protocol, provider.baseUrl, '');
  return baseUrl + (provider.protocol === 'anthropic' ? '/v1/' : '/') + path;
}
const cleanError = (error: unknown, provider: ProviderConnection) => {
  const value = error instanceof Error ? error.message : String(error);
  return new Error(
    provider.apiKey ? value.replaceAll(provider.apiKey, '[密钥已隐藏]').slice(0, 1200) : value.slice(0, 1200),
  );
};
class ProviderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request(
  provider: ProviderConnection,
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
) {
  const headers = new Headers(init.headers);
  if (provider.protocol === 'anthropic') headers.set('anthropic-version', '2023-06-01');
  if (provider.apiKey && provider.protocol !== 'system') {
    if (provider.protocol === 'anthropic') headers.set('x-api-key', provider.apiKey);
    else if (provider.protocol === 'google') headers.set('x-goog-api-key', provider.apiKey);
    else headers.set('Authorization', `Bearer ${provider.apiKey}`);
  }
  const response = await fetch(endpoint(provider, path), {
    ...init,
    headers,
    credentials: 'omit',
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    let message = await response.text();
    try {
      const parsed = JSON.parse(message);
      message = parsed.error?.message || parsed.message || message;
    } catch {}
    throw new ProviderError(
      response.status,
      cleanError(`${provider.name} (${response.status})：${String(message)}`, provider).message,
    );
  }
  return response;
}
const jsonRequest = async (p: ProviderConnection, path: string, body: unknown, signal: AbortSignal) =>
  (
    await request(
      p,
      path,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      signal,
    )
  ).json();
function publicProvider({ id, name, protocol, baseUrl, requiresKey, hasApiKey }: ProviderConnection) {
  return {
    id,
    name,
    protocol,
    baseUrl: protocol === 'system' ? '' : providerBase(baseUrl),
    requiresKey,
    hasApiKey,
  };
}
function sameConnection(a: ProviderConnection, b: GenerationSnapshot['provider']) {
  return a.id === b.id && a.protocol === b.protocol && providerBase(a.baseUrl) === providerBase(b.baseUrl);
}
async function imageData(
  asset: Pick<Asset, 'kind' | 'path'>,
  dir: string,
  signal: AbortSignal,
  format: 'png' | 'jpeg' = 'png',
) {
  if (asset.kind !== 'image') throw new Error('参考素材需要是图片');
  let image = nativeImage.createFromPath(asset.path);
  if (image.isEmpty() && extname(asset.path).toLowerCase() === '.svg') {
    const png = join(dir, uid('reference') + '.png');
    try {
      await run('/usr/bin/sips', ['-Z', '2048', '-s', 'format', 'png', asset.path, '--out', png], { signal });
      image = nativeImage.createFromPath(png);
    } finally {
      await rm(png, { force: true });
    }
  }
  if (image.isEmpty()) throw new Error('这张图片无法解码，请使用 PNG、JPEG 或 WebP');
  const { width, height } = image.getSize();
  const resized =
    Math.max(width, height) > 2048
      ? image.resize(width >= height ? { width: 2048 } : { height: 2048 })
      : image;
  return format === 'jpeg' ? resized.toJPEG(85) : resized.toPNG();
}
export async function collectGeneratedFile(file: string, store: ProjectStore) {
  const folder = join(store.path, 'assets');
  const snapshot = join(folder, '.' + uid('collect'));
  await copyFile(file, snapshot, constants.COPYFILE_EXCL);
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(snapshot)) hash.update(chunk);
    const destination = join(
      folder,
      `generated-${hash.digest('hex').slice(0, 32)}${extname(file).toLowerCase()}`,
    );
    try {
      await link(snapshot, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Volumes without hard links can atomically replace the same content-addressed bytes.
      if (code === 'ENOTSUP' || code === 'EPERM') await rename(snapshot, destination);
      else if (code !== 'EEXIST') throw error;
    }
    return destination;
  } finally {
    await rm(snapshot, { force: true });
  }
}
async function download(url: string, file: string, signal: AbortSignal) {
  const target = new URL(url);
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password)
    throw new Error('素材下载地址无效');
  const response = await fetch(target, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
    credentials: 'omit',
  });
  if (!response.ok || !response.body) throw new Error(`下载生成素材失败 (${response.status})`);
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(file, { flags: 'wx' }), {
    signal,
  });
}

/** Provider adapters use official request contracts; no model credentials are serialized in a job. */
export class GenerationService {
  private stores = new Map<string, ProjectStore>();
  constructor(
    private settings: SettingsStore,
    private jobs: JobService,
    private changed: (store: ProjectStore, envelope: ProjectEnvelope) => void | Promise<void>,
    private resolveStore?: (path: string) => ProjectStore | Promise<ProjectStore>,
  ) {}
  async availableModels(store: ProjectStore) {
    const settings = await this.settings.get();
    const project = await store.project();
    return {
      defaults: Object.fromEntries(
        modelUses.flatMap(({ id }) => {
          const model = selectedModel(settings, id, project.modelDefaults);
          return model ? [[id, model.id]] : [];
        }),
      ),
      models: settings.models.map((m) => ({
        id: m.id,
        name: m.name,
        uses: m.capabilities,
        adapter: m.adapter,
        parameters: modelParameters(m.adapter, m.parameters),
        connected: settings.providers.some((p) => p.id === m.providerId && (!p.requiresKey || p.hasApiKey)),
      })),
    };
  }
  async inspectProvider(input: { providerId?: string; provider?: ProviderConnection }) {
    const draft = input.provider;
    const id = draft?.id || input.providerId;
    const current = id ? await this.settings.connection(id) : undefined;
    const provider = draft ? { ...draft } : current;
    if (!provider) throw new Error('连接不存在');
    if (provider.protocol === 'system')
      return { models: [{ id: 'system', name: 'macOS 系统语音' }], verified: true, message: '本机服务可用' };
    providerBase(provider.baseUrl);
    if (draft && draft.apiKey === undefined && current && sameConnection(provider, current))
      provider.apiKey = current.apiKey;
    if (provider.requiresKey && !provider.apiKey) throw new Error('请为此服务地址填写 API Key');
    try {
      const models: { id: string; name: string }[] = [];
      const seen = new Set<string>();
      let cursor = '';
      do {
        const query = cursor
          ? '?' + new URLSearchParams({ [provider.protocol === 'google' ? 'pageToken' : 'after_id']: cursor })
          : '';
        const data = await (await request(provider, 'models' + query)).json();
        const source = data.data || data.models;
        if (!Array.isArray(source)) throw new Error('服务响应未包含可识别的模型目录，请核对接口协议和地址');
        for (const m of source) {
          const rawId = m?.id || m?.name;
          if (typeof rawId !== 'string' || !rawId) continue;
          const id = provider.protocol === 'google' ? rawId.replace(/^models\//, '') : rawId;
          models.push({ id, name: String(m.display_name || m.displayName || id) });
        }
        cursor =
          provider.protocol === 'google'
            ? data.nextPageToken
            : provider.protocol === 'anthropic' && data.has_more
              ? data.last_id
              : '';
        if (seen.has(cursor) || seen.size >= 20) break;
        seen.add(cursor);
      } while (cursor);
      return {
        models,
        verified: true,
        message: models.length
          ? `连接成功，发现 ${models.length} 个模型；用途能力请按服务商说明设置`
          : '连接成功，服务未返回模型目录，可手动添加模型',
      };
    } catch (error) {
      if (error instanceof ProviderError && [404, 405].includes(error.status))
        return { models: [], verified: false, message: '该服务没有开放模型目录。可以手动添加模型。' };
      throw cleanError(error, provider);
    }
  }
  async start(
    store: ProjectStore,
    input: GenerationRequest,
    options: { publish?: boolean; assets?: Asset[]; signal?: AbortSignal } = {},
  ) {
    const allowed: ModelUse[] = ['image', 'video', 'speech', 'transcription', 'vision'];
    if (!allowed.includes(input.use)) throw new Error('不支持的生成用途');
    const project = await store.project();
    this.stores.set(store.path, store);
    const assets = [...project.assets, ...(options.assets || [])];
    const { provider, model } = await this.settings.resolve(input.use, input.modelId, project.modelDefaults);
    if (provider.protocol !== 'system') providerBase(provider.baseUrl);
    const resolved = {
      provider,
      model: { ...model, parameters: modelParameters(model.adapter, model.parameters) },
    };
    const req: GenerationRequest = {
      use: input.use,
      prompt: String(input.prompt || '').trim(),
      modelId: model.id,
      assetId: input.assetId,
      referenceAssetId: input.referenceAssetId,
      size: input.size,
      seconds: input.seconds,
      voice: input.voice,
      language: input.language,
      parameters: modelParameters(model.adapter, input.parameters),
    };
    if (['image', 'video', 'speech'].includes(req.use) && !req.prompt) throw new Error('请输入创作内容');
    if (['transcription', 'vision'].includes(req.use) && !assets.some((a) => a.id === req.assetId))
      throw new Error('请选择项目中的素材');
    if (req.referenceAssetId && !['image', 'video'].includes(req.use))
      throw new Error('此用途不支持参考图片');
    if (req.referenceAssetId && !assets.some((a) => a.id === req.referenceAssetId && a.kind === 'image'))
      throw new Error('参考图片不存在');
    const expected: Record<string, string[]> = {
      image: ['openai-image', 'ark-image'],
      video: ['openai-video', 'ark-video'],
      speech: ['openai-speech', 'system-speech'],
      transcription: ['openai-transcription'],
      vision: ['chat'],
    };
    if (!expected[req.use].includes(resolved.model.adapter))
      throw new Error(`「${resolved.model.name}」的接口适配器不适用于${label(req.use)}`);
    if (
      resolved.model.adapter === 'openai-video' &&
      new URL(resolved.provider.baseUrl).hostname === 'api.openai.com'
    )
      throw new Error(
        'OpenAI 官方 Videos API 已于 2026-09-24 停止提供。请选择方舟视频模型或其他已支持该协议的服务。',
      );
    const job: GenerationJob = {
      id: uid('job'),
      name: `${label(req.use)} · ${resolved.model.name}`,
      type: req.use === 'transcription' ? 'transcribe' : 'generate',
      status: 'running',
      progress: 0,
      stage: '准备请求',
      createdAt: new Date().toISOString(),
      revision: project.revision,
      projectPath: store.path,
      providerId: provider.id,
      modelId: model.id,
      inputAssetId: req.assetId,
      generation: {
        request: req,
        model: structuredClone(resolved.model),
        provider: publicProvider(provider),
        publish: options.publish ?? true,
        assets: assets
          .filter((a) => a.id === req.assetId || a.id === req.referenceAssetId)
          .map(({ id, name, kind, path, duration }) => ({ id, name, kind, path, duration })),
      },
    };
    return this.jobs.runTask(job, (signal) => this.execute(store, job, resolved, signal), options.signal);
  }
  async resume(id: string) {
    const job = this.jobs.jobs.find((j) => j.id === id) as GenerationJob | undefined;
    if (!job?.generation || !job.projectPath || (!job.remote && !job.result))
      throw new Error('此作业没有可继续查询的云端编号或已保存的结果，请核对服务商记录');
    if (job.status === 'running' || job.status === 'completed') return job;
    if (['failed', 'cancelled', 'canceled', 'expired'].includes(job.remote?.status || ''))
      throw new Error('云端任务已终止');
    const store =
      this.stores.get(job.projectPath) ||
      (await this.resolveStore?.(job.projectPath)) ||
      new ProjectStore(job.projectPath);
    this.stores.set(store.path, store);
    await store.project();
    // Explicit recovery collects a result into the library without restoring an old Agent run.
    if (job.result) {
      const result = job.result;
      return this.jobs.runTask(
        job,
        async (signal) => {
          if (result.asset) await this.publishAsset(store, result.asset, () => !signal.aborted);
          else signal.throwIfAborted();
          return result;
        },
        undefined,
        '恢复本地结果',
      );
    }
    const provider = job.providerId ? await this.settings.connection(job.providerId) : undefined;
    if (!provider) throw new Error('请恢复原提供商连接后继续查询');
    if (!sameConnection(provider, job.generation.provider))
      throw new Error('此连接的地址或协议已改变，请恢复原连接后继续查询');
    if (provider.requiresKey && !provider.apiKey) throw new Error('请先恢复原连接的 API Key');
    const resolved = {
      provider: { ...job.generation.provider, apiKey: provider.apiKey },
      model: job.generation.model,
    };
    job.generation.publish = true;
    return this.jobs.runTask(
      job,
      (signal) => this.execute(store, job, resolved, signal),
      undefined,
      '继续查询已有云任务',
    );
  }
  wait(id: string, signal?: AbortSignal) {
    return this.jobs.wait(id, signal);
  }
  private async execute(
    store: ProjectStore,
    job: GenerationJob,
    resolved: Resolved,
    signal: AbortSignal,
  ): Promise<Job['result']> {
    const { model, provider } = resolved;
    const req = job.generation!.request;
    const dir = join(store.path, '.cocraft', 'generation', job.id);
    await mkdir(dir, { recursive: true });
    signal.throwIfAborted();
    const p = { ...model.parameters, ...req.parameters };
    try {
      let result: NonNullable<Job['result']>;
      if (req.use === 'vision') result = await this.vision(store, job, resolved, dir, signal);
      else if (req.use === 'transcription') result = await this.transcribe(store, job, resolved, dir, signal);
      else {
        const output =
          req.use === 'speech'
            ? await this.speech(job, resolved, p, dir, signal)
            : req.use === 'video'
              ? await this.video(store, job, resolved, p, dir, signal)
              : await this.image(store, job, resolved, p, dir, signal);
        signal.throwIfAborted();
        const file = await collectGeneratedFile(output, store);
        await rm(output, { force: true });
        const asset = await importMedia(file, store.path);
        if (asset.kind === 'image' && (!asset.width || !asset.height))
          throw new Error('服务返回的图片无法解码');
        asset.id = 'asset_' + job.id;
        asset.name = `${label(req.use)} · ${(req.prompt || model.name).replace(/\s+/g, ' ').slice(0, 28)}`;
        const source = {
          provider: provider.name,
          license: provider.protocol === 'system' ? '系统语音' : '生成内容，适用提供商条款',
          modelId: model.modelId,
          modelName: model.name,
          prompt: req.prompt,
          parameters: p,
          referenceAssetId: req.referenceAssetId,
          jobId: job.id,
        };
        asset.source = source;
        await atomicJSON(join(dir, 'provenance.json'), {
          source,
          request: req,
          remote: job.remote,
          assetId: asset.id,
          createdAt: new Date().toISOString(),
        });
        result = { asset };
      }
      signal.throwIfAborted();
      const resultFile = join(dir, 'result.json');
      await atomicJSON(resultFile, result);
      // Persist before the project pointer moves. Recovery uses this result and the stable asset ID.
      await this.jobs.update(job, { result, output: result.asset?.path || resultFile });
      signal.throwIfAborted();
      if (result.asset && job.generation.publish)
        await this.publishAsset(store, result.asset, () => !signal.aborted);
      return result;
    } catch (error) {
      throw cleanError(error, provider);
    }
  }
  private async publishAsset(store: ProjectStore, asset: Asset, active: () => boolean) {
    // An import does not overwrite existing objects; retry only local base-version contention, never a generation request.
    for (let i = 0; i < 5; i++) {
      if (!active()) throw new Error('作业已取消');
      const p = await store.project();
      if (p.assets.some((existing) => existing.id === asset.id)) return;
      try {
        const envelope = await store.edit(
          {
            baseRevision: p.revision,
            name: `添加${asset.kind === 'audio' ? '配音' : '生成素材'}`,
            operations: [{ type: 'addAsset', asset }],
          },
          active,
        );
        await this.changed(store, envelope);
        return;
      } catch (error) {
        if (i === 4 || !String(error).includes('工程已有新修改')) throw error;
      }
    }
  }
  private async sourceAsset(store: ProjectStore, job: GenerationJob, id: string) {
    const asset =
      job.generation?.assets?.find((a) => a.id === id) ||
      (await store.project()).assets.find((a) => a.id === id);
    if (!asset) throw new Error('素材不存在');
    return asset;
  }
  private async reference(
    store: ProjectStore,
    job: GenerationJob,
    dir: string,
    signal: AbortSignal,
    id?: string,
  ) {
    if (!id) return undefined;
    const asset = await this.sourceAsset(store, job, id);
    return imageData(asset, dir, signal);
  }
  private async image(
    store: ProjectStore,
    job: GenerationJob,
    { provider, model }: Resolved,
    p: Record<string, unknown>,
    dir: string,
    signal: AbortSignal,
  ) {
    const req = job.generation!.request;
    if (p.output_format && !['png', 'jpeg', 'webp', 'gif'].includes(String(p.output_format)))
      throw new Error('请选择 PNG、JPEG、WebP 或 GIF 作为图像输出');
    const reference = await this.reference(store, job, dir, signal, req.referenceAssetId);
    await this.jobs.update(job, { stage: '正在生成图像' });
    let data: any;
    if (model.adapter === 'ark-image') {
      data = await jsonRequest(
        provider,
        'images/generations',
        {
          ...parameters(p, parameterKeys['ark-image']),
          model: model.modelId,
          prompt: req.prompt,
          ...(req.size ? { size: req.size } : {}),
          response_format: 'b64_json',
          ...(reference ? { image: `data:image/png;base64,${reference.toString('base64')}` } : {}),
        },
        signal,
      );
    } else if (reference) {
      const body = new FormData();
      for (const [key, value] of Object.entries({
        ...parameters(p, parameterKeys['openai-image']),
        model: model.modelId,
        prompt: req.prompt,
        n: 1,
        ...(req.size ? { size: req.size } : {}),
      }))
        body.append(key, String(value));
      body.append('image', new Blob([new Uint8Array(reference)], { type: 'image/png' }), 'reference.png');
      data = await (await request(provider, 'images/edits', { method: 'POST', body }, signal)).json();
    } else {
      data = await jsonRequest(
        provider,
        'images/generations',
        {
          ...parameters(p, [
            'size',
            'quality',
            'background',
            'output_format',
            'output_compression',
            'moderation',
          ]),
          model: model.modelId,
          prompt: req.prompt,
          n: 1,
          ...(req.size ? { size: req.size } : {}),
        },
        signal,
      );
    }
    const image = data.data?.[0];
    if (!image?.b64_json && !image?.url) throw new Error('服务没有返回图片');
    const output = join(dir, uid('image'));
    if (image.b64_json)
      await writeFile(output, Buffer.from(String(image.b64_json).replace(/^data:[^,]+,/, ''), 'base64'), {
        flag: 'wx',
      });
    else await download(image.url, output, signal);
    const handle = await open(output, 'r');
    const header = Buffer.alloc(12);
    try {
      await handle.read(header);
    } finally {
      await handle.close();
    }
    const format = header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      ? 'png'
      : header[0] === 0xff && header[1] === 0xd8
        ? 'jpg'
        : header.toString('ascii', 0, 3) === 'GIF'
          ? 'gif'
          : header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8) === 'WEBP'
            ? 'webp'
            : undefined;
    if (!format) throw new Error('服务返回的内容不是可读取的 PNG、JPEG、WebP 或 GIF 图片');
    const file = output + '.' + format;
    await rename(output, file);
    return file;
  }
  private async speech(
    job: GenerationJob,
    { provider, model }: Resolved,
    p: Record<string, unknown>,
    dir: string,
    signal: AbortSignal,
  ) {
    const req = job.generation!.request;
    await this.jobs.update(job, { stage: '正在生成配音' });
    const output = join(dir, `${uid('voice')}.wav`);
    if (model.adapter === 'system-speech') {
      let voice = req.voice || String(p.voice || '');
      if (!voice) {
        const voices = await run('/usr/bin/say', ['-v', '?'], { signal });
        const list = voices.split('\n');
        voice = (
          list.find((l) => /^Tingting\s+zh_CN/.test(l)) ||
          list.find((l) => l.includes('zh_CN')) ||
          list[0]
        ).split(/\s{2,}/)[0];
      }
      await run(
        '/usr/bin/say',
        [
          '-v',
          voice,
          '-r',
          String(p.rate || 175),
          '--file-format=WAVE',
          '--data-format=LEI16@24000',
          '-o',
          output,
          '--',
          req.prompt!,
        ],
        { signal },
      );
    } else {
      const response = await request(
        provider,
        'audio/speech',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...parameters(p, ['speed', 'instructions']),
            model: model.modelId,
            input: req.prompt,
            voice: req.voice || p.voice || 'coral',
            response_format: 'wav',
          }),
        },
        signal,
      );
      if (!response.body) throw new Error('服务没有返回声音');
      await pipeline(Readable.fromWeb(response.body as any), createWriteStream(output, { flags: 'wx' }), {
        signal,
      });
    }
    return output;
  }
  private async video(
    store: ProjectStore,
    job: GenerationJob,
    { provider, model }: Resolved,
    p: Record<string, unknown>,
    dir: string,
    signal: AbortSignal,
  ) {
    const req = job.generation!.request;
    const ark = model.adapter === 'ark-video';
    const route = ark ? 'contents/generations/tasks' : 'videos';
    if (!job.remote) {
      await this.jobs.update(job, { stage: '正在提交云端任务' });
      const reference = await this.reference(store, job, dir, signal, req.referenceAssetId);
      const arkRatio =
        (req.size &&
          ({ '1280x720': '16:9', '720x1280': '9:16', '1024x1024': '1:1' } as Record<string, string>)[
            req.size
          ]) ||
        req.size;
      signal.throwIfAborted();
      // A submitted creation request can be billable. Read its acknowledgement even after a local stop.
      const receipt = AbortSignal.timeout(30000);
      let data;
      if (ark) {
        data = await jsonRequest(
          provider,
          route,
          {
            ...parameters(p, parameterKeys['ark-video']),
            model: model.modelId,
            content: [
              { type: 'text', text: req.prompt },
              ...(reference
                ? [
                    {
                      type: 'image_url',
                      image_url: { url: `data:image/png;base64,${reference.toString('base64')}` },
                      role: 'first_frame',
                    },
                  ]
                : []),
            ],
            ...(req.seconds ? { duration: req.seconds } : {}),
            ...(arkRatio ? { ratio: arkRatio } : {}),
          },
          receipt,
        );
      } else {
        const body = new FormData();
        body.set('model', model.modelId);
        body.set('prompt', req.prompt!);
        if (req.seconds || p.seconds) body.set('seconds', String(req.seconds || p.seconds));
        if (req.size || p.size) body.set('size', String(req.size || p.size));
        if (reference)
          body.set(
            'input_reference',
            new Blob([new Uint8Array(reference)], { type: 'image/png' }),
            'reference.png',
          );
        data = await (await request(provider, route, { method: 'POST', body }, receipt)).json();
      }
      if (typeof data.id !== 'string' || !data.id)
        throw new Error('服务未返回云任务 ID，请核对提供商后台记录再重新提交');
      await this.jobs.update(job, {
        remote: {
          id: data.id,
          status: 'queued',
          adapter: model.adapter,
          modelId: model.id,
          providerId: provider.id,
          prompt: req.prompt!,
        },
      });
    }
    signal.throwIfAborted();
    const routeWithId = `${route}/${encodeURIComponent(job.remote!.id)}`;
    let final: any;
    for (;;) {
      signal.throwIfAborted();
      const data: any = await (await request(provider, routeWithId, {}, signal)).json();
      const status = data.status;
      signal.throwIfAborted();
      if (
        ![
          'succeeded',
          'completed',
          'queued',
          'pending',
          'running',
          'in_progress',
          'processing',
          'failed',
          'cancelled',
          'canceled',
          'expired',
        ].includes(status)
      )
        throw new Error('服务返回了无法识别的云任务状态，请核对服务商记录');
      const remote = { ...job.remote!, status };
      if (['succeeded', 'completed'].includes(status)) {
        await this.jobs.update(job, { remote });
        final = data;
        break;
      }
      if (['failed', 'cancelled', 'canceled', 'expired'].includes(status)) {
        await this.jobs.update(job, { remote });
        throw new Error(data.error?.message || `云任务已终止（${status}）`);
      }
      const progress = Number(data.progress);
      const stage = status === 'queued' || status === 'pending' ? '云端排队中' : '云端生成中';
      const fraction = Number.isFinite(progress) ? Math.min(0.95, Math.max(0, progress / 100)) : 0;
      if (stage !== job.stage || fraction !== job.progress || status !== job.remote!.status)
        await this.jobs.update(job, { remote, stage, progress: fraction });
      await delay(1800, undefined, { signal });
    }
    await this.jobs.update(job, { stage: '正在下载生成的视频' });
    const output = join(dir, `${uid('video')}.mp4`);
    if (ark) {
      if (!final.content?.video_url) throw new Error('云任务完成但未返回视频地址');
      await download(final.content.video_url, output, signal);
    } else {
      const response = await request(provider, `${routeWithId}/content`, {}, signal);
      if (!response.body) throw new Error('服务没有返回视频内容');
      await pipeline(Readable.fromWeb(response.body as any), createWriteStream(output, { flags: 'wx' }), {
        signal,
      });
    }
    return output;
  }
  private async transcribe(
    store: ProjectStore,
    job: GenerationJob,
    { provider, model }: Resolved,
    dir: string,
    signal: AbortSignal,
  ) {
    const req = job.generation!.request;
    const asset = await this.sourceAsset(store, job, req.assetId!);
    if (asset.kind === 'image') throw new Error('请选择包含语音的视频或音频');
    const p = { ...model.parameters, ...req.parameters };
    const chunkSeconds = 300;
    const diarize = model.modelId === 'gpt-4o-transcribe-diarize';
    const format = String(
      p.response_format ||
        (diarize ? 'diarized_json' : model.modelId.includes('whisper') ? 'verbose_json' : 'json'),
    );
    if (!['json', 'verbose_json', 'diarized_json', 'text'].includes(format))
      throw new Error('请选择 JSON、带时间戳的 JSON 或纯文本转录格式');
    const segments: { start: number; end: number; text: string }[] = [];
    const texts: string[] = [];
    for (let start = 0; start < asset.duration; start += chunkSeconds) {
      signal.throwIfAborted();
      const file = join(dir, `speech-${start}.wav`);
      await this.jobs.update(job, {
        stage: `提取并转录 ${Math.floor(start / 60)}–${Math.ceil(Math.min(asset.duration, start + chunkSeconds) / 60)} 分钟`,
        progress: start / asset.duration,
      });
      const body = new FormData();
      try {
        await run(
          binary('ffmpeg'),
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-ss',
            String(start),
            '-i',
            asset.path,
            '-t',
            String(chunkSeconds),
            '-map',
            '0:a:0',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-c:a',
            'pcm_s16le',
            file,
          ],
          { signal },
        );
        body.append(
          'file',
          new Blob([new Uint8Array(await readFile(file))], { type: 'audio/wav' }),
          'speech.wav',
        );
      } finally {
        await rm(file, { force: true });
      }
      body.append('model', model.modelId);
      body.append('response_format', format);
      if (format === 'verbose_json') body.append('timestamp_granularities[]', 'segment');
      if (diarize) body.append('chunking_strategy', 'auto');
      if (p.temperature !== undefined) body.append('temperature', String(p.temperature));
      if (req.language || p.language)
        body.append(
          model.modelId === 'gpt-transcribe' ? 'languages[]' : 'language',
          String(req.language || p.language),
        );
      if (req.prompt && !diarize) body.append('prompt', req.prompt);
      const response = await request(provider, 'audio/transcriptions', { method: 'POST', body }, signal);
      const data = format === 'text' ? { text: await response.text() } : await response.json();
      const chunk = [];
      for (const s of Array.isArray(data.segments) ? data.segments : []) {
        const text = typeof s.text === 'string' ? s.text.trim() : '';
        const from = Math.max(0, s.start),
          to = Math.min(s.end, asset.duration - start, chunkSeconds);
        if (text && Number.isFinite(s.start) && Number.isFinite(s.end) && to > from) {
          segments.push({ start: start + from, end: start + to, text });
          chunk.push(text);
        }
      }
      const text = typeof data.text === 'string' && data.text.trim() ? data.text.trim() : chunk.join(' ');
      if (text) texts.push(text);
    }
    if (!texts.length && !segments.length) throw new Error('模型没有返回可用的转录文本');
    return { text: texts.join('\n'), segments };
  }
  private async vision(
    store: ProjectStore,
    job: GenerationJob,
    { provider, model }: Resolved,
    dir: string,
    signal: AbortSignal,
  ) {
    const req = job.generation!.request;
    const asset = await this.sourceAsset(store, job, req.assetId!);
    if (asset.kind === 'audio') throw new Error('请选择视频或图片；音频请使用转录');
    await this.jobs.update(job, { stage: '准备画面分析' });
    const images: { mimeType: string; data: string }[] = [];
    const targets =
      asset.kind === 'video'
        ? [0, asset.duration * 0.35, asset.duration * 0.7].map((n) =>
            Math.min(Math.max(0, asset.duration - 0.05), n),
          )
        : [];
    const times: number[] = [];
    if (asset.kind === 'image')
      images.push({
        data: (await imageData(asset, dir, signal, 'jpeg')).toString('base64'),
        mimeType: 'image/jpeg',
      });
    else
      for (const [index, time] of [...new Set(targets)].entries()) {
        const file = join(dir, `sample-${index}.jpg`);
        try {
          await run(
            binary('ffmpeg'),
            [
              '-hide_banner',
              '-loglevel',
              'error',
              '-y',
              '-ss',
              String(time),
              '-i',
              asset.path,
              '-frames:v',
              '1',
              '-vf',
              'scale=1280:1280:force_original_aspect_ratio=decrease',
              file,
            ],
            { signal },
          );
          const bytes = await readFile(file);
          if (bytes.length) {
            images.push({ data: bytes.toString('base64'), mimeType: 'image/jpeg' });
            times.push(time);
          }
        } catch (error) {
          // A sparse or very short VFR clip can have no frame after the seek timestamp.
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !images.length) throw error;
        } finally {
          await rm(file, { force: true });
        }
      }
    if (!images.length) throw new Error('素材中没有可分析的画面');
    const prompt = `${req.prompt || '分析画面内容、构图、镜头特点，给出具体可操作的剪辑建议。'}\n素材：${asset.name}。${times.length ? `以下是 ${times.map((t) => t.toFixed(2) + 's').join('、')} 的采样帧。你只看到了采样帧，不能声称观看了完整视频或听到了声音。` : ''}`;
    await this.jobs.update(job, { stage: '视觉模型正在分析' });
    const { modelId } = chatEndpoint(provider.protocol, provider.baseUrl, model.modelId);
    const p = { ...model.parameters, ...req.parameters };
    const temperature = parameters(p, ['temperature']);
    let content;
    if (provider.protocol === 'google') {
      const body = {
        contents: [
          { role: 'user', parts: [{ text: prompt }, ...images.map((inlineData) => ({ inlineData }))] },
        ],
        generationConfig: { ...temperature, ...(p.maxTokens ? { maxOutputTokens: p.maxTokens } : {}) },
      };
      const data = await jsonRequest(
        provider,
        `models/${encodeURIComponent(modelId)}:generateContent`,
        body,
        signal,
      );
      content = data.candidates?.[0]?.content?.parts?.filter((part: { thought?: boolean }) => !part.thought);
    } else if (provider.protocol === 'anthropic') {
      const parts = [
        { type: 'text', text: prompt },
        ...images.map((i) => ({
          type: 'image',
          source: { type: 'base64', media_type: i.mimeType, data: i.data },
        })),
      ];
      const data = await jsonRequest(
        provider,
        'messages',
        {
          model: modelId,
          max_tokens: p.maxTokens || 2000,
          ...temperature,
          messages: [{ role: 'user', content: parts }],
        },
        signal,
      );
      content = data.content?.filter((part: { type: string }) => part.type === 'text');
    } else {
      const parts = [
        { type: 'text', text: prompt },
        ...images.map((i) => ({
          type: 'image_url',
          image_url: { url: `data:${i.mimeType};base64,${i.data}` },
        })),
      ];
      const data = await jsonRequest(
        provider,
        'chat/completions',
        {
          model: modelId,
          ...temperature,
          ...(p.maxTokens ? { max_completion_tokens: p.maxTokens } : {}),
          messages: [{ role: 'user', content: parts }],
        },
        signal,
      );
      content = data.choices?.[0]?.message?.content;
    }
    const text =
      typeof content === 'string'
        ? content.trim()
        : Array.isArray(content)
          ? content
              .map((part) => part.text || '')
              .join('\n')
              .trim()
          : '';
    if (!text) throw new Error('视觉模型没有返回分析文本');
    return {
      text: `${times.length ? `采样位置：${times.map((t) => t.toFixed(2) + 's').join('、')}\n\n` : ''}${text}`,
    };
  }
}
