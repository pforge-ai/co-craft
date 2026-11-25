import { nativeImage } from 'electron';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, rename, rm, open, link } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join, extname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { binary, importMedia, run } from './media';
import { ProjectStore, atomicJSON } from './store';
import type { SettingsStore } from './settings';
import type { JobService } from './jobs';
import {
  detectAudioExtension,
  getProviderDriver,
  type EncodedReferenceImage,
  type ProviderHttp,
  type ProviderRequestOptions,
} from './providers';
import { uid } from '../src/core/project';
import {
  modelUses,
  selectedModel,
  normalizeProviderUrl as providerBase,
  dashscopeEndpoints,
  minimaxEndpoints,
  modelInputCapabilities,
} from '../src/core/models';
import type {
  Asset,
  AssetLineageRef,
  ClipTake,
  EditOperation,
  GenerationCanvasMeta,
  GenerationTarget,
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
  referenceAssetIds?: string[];
  lastFrameAssetId?: string;
  motionVideoAssetId?: string;
  driverAudioAssetId?: string;
  animateMode?: 'wan-std' | 'wan-pro';
  size?: string;
  resolution?: string;
  aspectRatio?: string;
  seconds?: number;
  generateAudio?: boolean;
  background?: 'auto' | 'opaque' | 'transparent';
  voice?: string;
  language?: string;
  parameters?: Record<string, string | number | boolean>;
  target?: GenerationTarget;
  canvas?: GenerationCanvasMeta;
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
  'dashscope-image': ['size', 'seed', 'watermark', 'prompt_extend', 'negative_prompt', 'thinking_mode'],
  'minimax-image': ['size', 'aspect_ratio', 'seed', 'prompt_optimizer'],
  'ark-video': ['resolution', 'ratio', 'duration', 'seed', 'watermark', 'generate_audio', 'camera_fixed'],
  'openai-video': ['size', 'seconds'],
  'dashscope-video': [
    'resolution',
    'ratio',
    'aspect_ratio',
    'size',
    'duration',
    'seed',
    'watermark',
    'prompt_extend',
    'negative_prompt',
    'audio',
    'mode',
    'check_image',
    'style',
  ],
  'minimax-video': ['resolution', 'ratio', 'duration', 'generate_audio', 'prompt_optimizer', 'fast_pretreatment'],
  'openai-speech': ['voice', 'speed', 'instructions'],
  'dashscope-speech': ['voice', 'language_type'],
  'minimax-speech': ['voice', 'speed', 'vol', 'pitch', 'emotion'],
  'system-speech': ['voice', 'rate'],
  'openai-transcription': ['language', 'response_format', 'temperature'],
  'dashscope-transcription': ['language', 'temperature'],
};

export function modelParameters(adapter: ModelAdapter, raw?: Record<string, string | number | boolean>) {
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
  if (protocol === 'dashscope') base = dashscopeEndpoints(base).compatBase;
  if (protocol === 'minimax') base = minimaxEndpoints(base).v1Base;
  return { baseUrl: base, modelId: protocol === 'google' ? modelId.replace(/^models\//, '') : modelId };
}

function endpoint(
  provider: ProviderConnection,
  path: string,
  baseKind: ProviderRequestOptions['baseKind'] = 'default',
) {
  if (provider.protocol === 'dashscope') {
    const { nativeBase, compatBase } = dashscopeEndpoints(provider.baseUrl);
    return (baseKind === 'native' ? nativeBase : compatBase) + '/' + path;
  }
  if (provider.protocol === 'minimax') {
    const { v1Base, v2Base } = minimaxEndpoints(provider.baseUrl);
    return (baseKind === 'v2' ? v2Base : v1Base) + '/' + path;
  }
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
  baseKind: ProviderRequestOptions['baseKind'] = 'default',
) {
  const headers = new Headers(init.headers);
  if (provider.protocol === 'anthropic') headers.set('anthropic-version', '2023-06-01');
  if (provider.apiKey && provider.protocol !== 'system') {
    if (provider.protocol === 'anthropic') headers.set('x-api-key', provider.apiKey);
    else if (provider.protocol === 'google') headers.set('x-goog-api-key', provider.apiKey);
    else headers.set('Authorization', `Bearer ${provider.apiKey}`);
  }
  const response = await fetch(endpoint(provider, path, baseKind), {
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
      message = parsed.error?.message || parsed.base_resp?.status_msg || parsed.message || message;
    } catch {}
    throw new ProviderError(
      response.status,
      cleanError(`${provider.name} (${response.status})：${String(message)}`, provider).message,
    );
  }
  return response;
}

const jsonRequest = async (
  p: ProviderConnection,
  path: string,
  body: unknown,
  signal?: AbortSignal,
  baseKind: ProviderRequestOptions['baseKind'] = 'default',
  extraHeaders?: Record<string, string>,
) =>
  (
    await request(
      p,
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
        body: JSON.stringify(body),
      },
      signal,
      baseKind,
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

function normalizedReferenceIds(req: Pick<GenerationRequest, 'referenceAssetId' | 'referenceAssetIds'>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (Array.isArray(req.referenceAssetIds)) {
    for (const id of req.referenceAssetIds) {
      if (typeof id === 'string' && id.trim() && !seen.has(id.trim())) {
        seen.add(id.trim());
        out.push(id.trim());
      }
    }
  }
  if (typeof req.referenceAssetId === 'string' && req.referenceAssetId.trim() && !seen.has(req.referenceAssetId.trim())) {
    out.unshift(req.referenceAssetId.trim());
  }
  return out;
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

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

function isPrivateOrLoopbackIp(rawIp: string): boolean {
  let ip = rawIp.toLowerCase().replace(/^\[|\]$/g, '');
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx >= 0) ip = ip.slice(0, zoneIdx);
  // Decode IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (ip.startsWith('::ffff:')) {
    const tail = ip.slice(7);
    if (tail.includes('.')) return isPrivateOrLoopbackIp(tail);
    const hexParts = tail.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateOrLoopbackIp(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
      }
    }
    return true;
  }
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT + Alibaba metadata 100.100.100.200
    if (a === 169 && b === 254) return true; // AWS/GCP/Azure metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast & reserved
    return false;
  }
  if (kind === 6) {
    if (ip === '::' || ip === '::1') return true;
    const firstHex = parseInt(ip.split(':')[0] || '0', 16);
    if ((firstHex & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((firstHex & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstHex & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return false;
}

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (isIP(h)) return isPrivateOrLoopbackIp(h);
  return false;
}

export async function assertSafeRemoteUrl(target: URL, providerBaseUrl?: string): Promise<void> {
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password)
    throw new Error('素材下载地址无效');
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (host === '169.254.169.254' || host === '100.100.100.200')
    throw new Error('已拦截不安全的云元数据地址');
  const providerHost = providerBaseUrl
    ? new URL(providerBaseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
    : '';
  const allowLocalProvider =
    Boolean(providerHost) && isPrivateOrLoopbackHost(providerHost) && host === providerHost;
  if (isPrivateOrLoopbackHost(host)) {
    if (!allowLocalProvider) throw new Error('已拦截来自远端服务指向本机或内网的素材下载地址');
    return;
  }
  if (!allowLocalProvider && !isIP(host)) {
    const records = await lookup(host, { all: true }).catch(() => []);
    for (const rec of records) {
      if (isPrivateOrLoopbackIp(rec.address)) {
        throw new Error('已拦截解析到本机或内网地址的素材下载域名');
      }
    }
  }
}

export async function downloadToFile(
  url: string,
  file: string,
  signal: AbortSignal,
  providerBaseUrl?: string,
  maxBytes = MAX_DOWNLOAD_BYTES,
) {
  const target = new URL(url);
  await assertSafeRemoteUrl(target, providerBaseUrl);
  const response = await fetch(target, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok || !response.body) throw new Error(`下载生成素材失败 (${response.status})`);
  const declaredLen = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    throw new Error(`远端文件体积过大（超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制）`);
  }
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > maxBytes) {
        cb(new Error(`远端文件体积超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`));
        return;
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body as any), limiter, createWriteStream(file, { flags: 'wx' }), {
      signal,
    });
  } catch (err) {
    await rm(file, { force: true }).catch(() => {});
    throw err;
  }
}

/** Provider adapters use official request contracts via electron/providers/*; no model credentials are serialized in a job. */
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
          : '连接成功，服务未返回模型目录，可使用一键套件或手动添加模型',
      };
    } catch (error) {
      if (error instanceof ProviderError && [404, 405].includes(error.status))
        return { models: [], verified: false, message: '该服务没有开放模型目录，可使用一键套件或手动添加模型。' };
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
    const refIds = normalizedReferenceIds(input);
    const lastFrameId = typeof input.lastFrameAssetId === 'string' && input.lastFrameAssetId.trim() ? input.lastFrameAssetId.trim() : undefined;
    const motionVideoId =
      typeof input.motionVideoAssetId === 'string' && input.motionVideoAssetId.trim()
        ? input.motionVideoAssetId.trim()
        : undefined;
    const driverAudioId =
      typeof input.driverAudioAssetId === 'string' && input.driverAudioAssetId.trim()
        ? input.driverAudioAssetId.trim()
        : undefined;
    const caps = modelInputCapabilities(resolved.model);
    const defaultPerfPrompt = caps.supportsDriverAudio
      ? '音频驱动对口型'
      : caps.supportsMotionVideo
        ? caps.motionMode === 'mix'
          ? '视频换人'
          : '动作迁移'
        : '';

    const req: GenerationRequest = {
      use: input.use,
      prompt: String(input.prompt || '').trim() || (caps.promptOptional ? defaultPerfPrompt : ''),
      modelId: model.id,
      assetId: input.assetId,
      referenceAssetId: refIds[0],
      ...(refIds.length ? { referenceAssetIds: refIds } : {}),
      ...(lastFrameId ? { lastFrameAssetId: lastFrameId } : {}),
      ...(motionVideoId ? { motionVideoAssetId: motionVideoId } : {}),
      ...(driverAudioId ? { driverAudioAssetId: driverAudioId } : {}),
      ...(input.animateMode ? { animateMode: input.animateMode } : {}),
      size: input.size,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      seconds: input.seconds,
      ...(input.generateAudio !== undefined ? { generateAudio: Boolean(input.generateAudio) } : {}),
      ...(input.background ? { background: input.background } : {}),
      voice: input.voice,
      language: input.language,
      parameters: modelParameters(model.adapter, input.parameters),
      ...(input.target &&
      typeof input.target.sequenceId === 'string' &&
      typeof input.target.clipId === 'string'
        ? {
            target: {
              sequenceId: input.target.sequenceId,
              clipId: input.target.clipId,
              shotLabel: input.target.shotLabel ? String(input.target.shotLabel).slice(0, 80) : undefined,
              mode: input.target.mode === 'replace' ? 'replace' : 'take',
            },
          }
        : {}),
      ...(input.canvas || refIds.length || lastFrameId || motionVideoId || driverAudioId
        ? {
            canvas: {
              ...(input.canvas?.placement &&
              Number.isFinite(input.canvas.placement.x) &&
              Number.isFinite(input.canvas.placement.y)
                ? {
                    placement: {
                      x: Math.round(input.canvas.placement.x),
                      y: Math.round(input.canvas.placement.y),
                    },
                  }
                : {}),
              ...(Array.isArray(input.canvas?.sourceNodeKeys) && input.canvas.sourceNodeKeys.length
                ? {
                    sourceNodeKeys: Array.from(
                      new Set(
                        input.canvas.sourceNodeKeys
                          .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
                          .slice(0, 8),
                      ),
                    ),
                  }
                : {}),
              ...(refIds.length ? { referenceAssetIds: refIds } : {}),
              ...(lastFrameId ? { lastFrameAssetId: lastFrameId } : {}),
              ...(motionVideoId ? { motionVideoAssetId: motionVideoId } : {}),
              ...(driverAudioId ? { driverAudioAssetId: driverAudioId } : {}),
              promptPreview: String(input.canvas?.promptPreview || input.prompt || defaultPerfPrompt || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120),
              use: input.use,
            },
          }
        : {}),
    };

    if (['image', 'video', 'speech'].includes(req.use) && !req.prompt && !caps.promptOptional)
      throw new Error('请输入创作内容');
    if (['transcription', 'vision'].includes(req.use) && !assets.some((a) => a.id === req.assetId))
      throw new Error('请选择项目中的素材');
    if ((refIds.length || lastFrameId) && !['image', 'video'].includes(req.use))
      throw new Error('此用途不支持参考图片');
    for (const rid of refIds) {
      if (!assets.some((a) => a.id === rid && a.kind === 'image'))
        throw new Error('所选参考图片不存在或不是图片素材');
    }
    if (lastFrameId && !assets.some((a) => a.id === lastFrameId && a.kind === 'image'))
      throw new Error('所选尾帧图片不存在或不是图片素材');
    if (motionVideoId && !assets.some((a) => a.id === motionVideoId && a.kind === 'video'))
      throw new Error('所选驱动视频不存在或不是视频素材');
    if (driverAudioId && !assets.some((a) => a.id === driverAudioId && a.kind === 'audio'))
      throw new Error('所选驱动音频不存在或不是音频素材');

    const expected: Record<string, ModelAdapter[]> = {
      image: ['openai-image', 'ark-image', 'dashscope-image', 'minimax-image'],
      video: ['openai-video', 'ark-video', 'dashscope-video', 'minimax-video'],
      speech: ['openai-speech', 'system-speech', 'dashscope-speech', 'minimax-speech'],
      transcription: ['openai-transcription', 'dashscope-transcription'],
      vision: ['chat'],
    };
    if (!expected[req.use].includes(resolved.model.adapter))
      throw new Error(`「${resolved.model.name}」的接口适配器不适用于${label(req.use)}`);

    if (
      resolved.model.adapter === 'openai-video' &&
      new URL(resolved.provider.baseUrl).hostname === 'api.openai.com'
    )
      throw new Error(
        'OpenAI 官方 Videos API 已于 2026-09-24 停止提供。请选择百炼、火山方舟、MiniMax 或其他已支持该协议的服务。',
      );

    if ((req.use === 'image' || req.use === 'video') && caps.requiresReference && refIds.length === 0) {
      throw new Error(
        caps.supportsMotionVideo
          ? `模型「${resolved.model.modelId}」需要连入 1 张角色主体参考图`
          : caps.supportsDriverAudio
            ? `模型「${resolved.model.modelId}」需要连入 1 张角色人像图`
            : caps.referenceMode === 'multi-ref'
              ? `模型「${resolved.model.modelId}」需要至少选择 1 张参考图片`
              : `图生视频模型「${resolved.model.modelId}」需要选择首帧参考图片，或改用文生视频模型`,
      );
    }
    if (req.use === 'video' && caps.supportsMotionVideo && !motionVideoId) {
      throw new Error(`模型「${resolved.model.modelId}」需要连入 1 段驱动视频（motion-video）`);
    }
    if (req.use === 'video' && caps.supportsDriverAudio && !driverAudioId) {
      throw new Error(`模型「${resolved.model.modelId}」需要连入 1 段驱动音频（driver-audio）`);
    }
    if ((req.use === 'image' || req.use === 'video') && caps.maxReferences > 0 && refIds.length > caps.maxReferences) {
      throw new Error(`模型「${resolved.model.modelId}」最多支持 ${caps.maxReferences} 张参考图片`);
    }
    if (lastFrameId && req.use === 'video' && !refIds.length) {
      throw new Error('设置尾帧图片时，请同时选择首帧图片');
    }

    const neededAssetIds = new Set<string>([
      ...(req.assetId ? [req.assetId] : []),
      ...refIds,
      ...(lastFrameId ? [lastFrameId] : []),
      ...(motionVideoId ? [motionVideoId] : []),
      ...(driverAudioId ? [driverAudioId] : []),
    ]);

    const targetSeq = req.target
      ? project.sequences.find((s) => s.id === req.target!.sequenceId)
      : project.sequences.find((s) => s.isMainBranch) || project.sequences[0];

    const job: GenerationJob = {
      id: uid('job'),
      name: req.target?.shotLabel
        ? `${label(req.use)}候选 · ${req.target.shotLabel}`
        : `${label(req.use)} · ${resolved.model.name}`,
      type: req.use === 'transcription' ? 'transcribe' : 'generate',
      status: 'running',
      progress: 0,
      stage: '准备请求',
      createdAt: new Date().toISOString(),
      revision: project.revision,
      projectId: project.id,
      projectName: project.name,
      branchName: targetSeq?.branchName || targetSeq?.name,
      projectPath: store.path,
      providerId: provider.id,
      modelId: model.id,
      inputAssetId: req.assetId,
      ...(req.target ? { target: req.target } : {}),
      ...(req.canvas ? { canvas: req.canvas } : {}),
      generation: {
        request: req,
        model: structuredClone(resolved.model),
        provider: publicProvider(provider),
        publish: options.publish ?? true,
        assets: assets
          .filter((a) => neededAssetIds.has(a.id))
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
    if (job.result) {
      const result = job.result;
      return this.jobs.runTask(
        job,
        async (signal) => {
          if (result.asset) await this.publishAsset(store, result.asset, () => !signal.aborted, job);
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

  private createDriverHttp(job: GenerationJob, resolved: Resolved): ProviderHttp {
    const { model, provider } = resolved;
    const req = job.generation!.request;
    return {
      request: (p, path, opts) =>
        request(
          p,
          path,
          {
            method: opts?.method,
            headers: opts?.headers,
            body: opts?.body,
          },
          opts?.signal,
          opts?.baseKind || 'default',
        ),
      json: (p, path, body, opts) =>
        jsonRequest(p, path, body, opts?.signal, opts?.baseKind || 'default', opts?.extraHeaders),
      downloadToFile: (url, dest, sig, base) => downloadToFile(url, dest, sig, base),
      assertSafeUrl: (url, base) => assertSafeRemoteUrl(url, base),
      onRemoteCreated: async (remote) => {
        await this.jobs.update(job, {
          remote: {
            id: remote.id,
            status: remote.status,
            adapter: model.adapter,
            modelId: model.id,
            providerId: provider.id,
            prompt: req.prompt || '',
            ...(remote.apiVersion ? { apiVersion: remote.apiVersion } : {}),
            ...(remote.pollPath ? { pollPath: remote.pollPath } : {}),
          },
        });
      },
      onStage: async (stage, progress, remoteStatus) => {
        const nextRemote =
          job.remote && remoteStatus ? { ...job.remote, status: remoteStatus } : job.remote;
        const patch: Partial<Job> = {};
        if (stage !== job.stage) patch.stage = stage;
        if (progress !== undefined && progress !== job.progress) patch.progress = progress;
        if (nextRemote && remoteStatus && remoteStatus !== job.remote?.status) patch.remote = nextRemote;
        if (Object.keys(patch).length) await this.jobs.update(job, patch);
      },
    };
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
        const asset = await importMedia(file, store.path, 'asset_' + job.id);
        if (asset.kind === 'image' && (!asset.width || !asset.height))
          throw new Error('服务返回的图片无法解码');
        asset.name = `${label(req.use)} · ${(req.prompt || model.name).replace(/\s+/g, ' ').slice(0, 28)}`;
        const source = {
          provider: provider.name,
          license: provider.protocol === 'system' ? '系统语音' : '生成内容，适用提供商条款',
          modelId: model.modelId,
          modelName: model.name,
          prompt: req.prompt,
          parameters: p,
          referenceAssetId: req.referenceAssetId,
          ...(req.referenceAssetIds?.length ? { referenceAssetIds: req.referenceAssetIds } : {}),
          ...(req.lastFrameAssetId ? { lastFrameAssetId: req.lastFrameAssetId } : {}),
          jobId: job.id,
        };
        asset.source = source;
        // Automatically attach canvas lineage refs so generated cards auto-wire to upstream references & source nodes
        const derivedFrom: AssetLineageRef[] = [];
        const seenAssetRefs = new Set<string>();
        const seenVaultRefs = new Set<string>();
        const reqRefs = normalizedReferenceIds(req);
        const perfCaps = modelInputCapabilities(model);
        if (req.motionVideoAssetId && reqRefs.length > 0) {
          const viaKind = perfCaps.motionMode === 'mix' ? ('character-replace' as const) : ('motion-transfer' as const);
          const noteLabel = perfCaps.motionMode === 'mix' ? '换人主体' : '表演角色';
          derivedFrom.push({
            assetId: reqRefs[0],
            via: viaKind,
            modelOrSkill: model.modelId,
            note: noteLabel,
          });
          seenAssetRefs.add(reqRefs[0]);
          derivedFrom.push({
            assetId: req.motionVideoAssetId,
            via: viaKind,
            modelOrSkill: model.modelId,
            note: perfCaps.motionMode === 'mix' ? '原片视频' : '动作驱动',
          });
          seenAssetRefs.add(req.motionVideoAssetId);
        } else if (req.driverAudioAssetId && reqRefs.length > 0) {
          derivedFrom.push({
            assetId: reqRefs[0],
            via: 'lip-sync',
            modelOrSkill: model.modelId,
            note: '口型角色',
          });
          seenAssetRefs.add(reqRefs[0]);
          derivedFrom.push({
            assetId: req.driverAudioAssetId,
            via: 'lip-sync',
            modelOrSkill: model.modelId,
            note: '驱动语音',
          });
          seenAssetRefs.add(req.driverAudioAssetId);
        } else if (req.lastFrameAssetId && reqRefs.length > 0) {
          derivedFrom.push({
            assetId: reqRefs[0],
            via: 'first-last-frame',
            modelOrSkill: model.modelId,
            note: '首帧',
          });
          seenAssetRefs.add(reqRefs[0]);
          if (req.lastFrameAssetId !== reqRefs[0]) {
            derivedFrom.push({
              assetId: req.lastFrameAssetId,
              via: 'first-last-frame',
              modelOrSkill: model.modelId,
              note: '尾帧',
            });
            seenAssetRefs.add(req.lastFrameAssetId);
          }
        } else {
          for (const rid of reqRefs) {
            if (seenAssetRefs.has(rid)) continue;
            seenAssetRefs.add(rid);
            derivedFrom.push({
              assetId: rid,
              via: 'ai-generate',
              modelOrSkill: model.modelId,
              note: reqRefs.length > 1 ? '多图参考' : req.use === 'video' ? '图生视频' : 'AI 派生',
            });
          }
        }
        for (const srcKey of req.canvas?.sourceNodeKeys || []) {
          if (srcKey.startsWith('ent:')) {
            const vid = srcKey.slice(4);
            if (!seenVaultRefs.has(vid)) {
              seenVaultRefs.add(vid);
              derivedFrom.push({
                vaultItemId: vid,
                via: req.use === 'speech' ? 'text-derive' : 'ai-generate',
                modelOrSkill: model.modelId,
                note: req.use === 'speech' ? '文本配音' : req.use === 'video' ? '设定生视频' : '设定生图',
              });
            }
          } else if (srcKey.startsWith('gen:')) {
            if (!seenVaultRefs.has(srcKey)) {
              seenVaultRefs.add(srcKey);
              derivedFrom.push({
                vaultItemId: srcKey,
                via: req.lastFrameAssetId ? 'first-last-frame' : 'ai-generate',
                modelOrSkill: model.modelId,
                note: req.use === 'video' ? '工坊生视频' : req.use === 'speech' ? '工坊配音' : '工坊生图',
              });
            }
          } else if (srcKey.startsWith('shot:')) {
            if (!seenVaultRefs.has(srcKey)) {
              seenVaultRefs.add(srcKey);
              derivedFrom.push({
                vaultItemId: srcKey,
                via: 'fork',
                modelOrSkill: model.modelId,
                note: '分镜派生',
              });
            }
          } else if (srcKey.startsWith('asset:')) {
            const aid = srcKey.slice(6);
            if (!seenAssetRefs.has(aid)) {
              seenAssetRefs.add(aid);
              derivedFrom.push({
                assetId: aid,
                via: 'ai-generate',
                modelOrSkill: model.modelId,
                note: req.use === 'video' ? '图生视频' : 'AI 派生',
              });
            }
          }
        }
        if (derivedFrom.length) asset.derivedFrom = derivedFrom;
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
      await this.jobs.update(job, { result, output: result.asset?.path || resultFile });
      signal.throwIfAborted();
      if (result.asset && job.generation.publish)
        await this.publishAsset(store, result.asset, () => !signal.aborted, job);
      return result;
    } catch (error) {
      throw cleanError(error, provider);
    }
  }

  private async publishAsset(store: ProjectStore, asset: Asset, active: () => boolean, job?: GenerationJob) {
    const target = job?.target;
    const canAttachTake = Boolean(target && (asset.kind === 'image' || asset.kind === 'video'));
    const takeId = canAttachTake ? `take_${job!.id}` : undefined;
    for (let i = 0; i < 5; i++) {
      if (!active()) throw new Error('作业已取消');
      const p = await store.project();
      const assetExists = p.assets.some((existing) => existing.id === asset.id);
      const ops: EditOperation[] = [];
      if (!assetExists) ops.push({ type: 'addAsset', asset });
      const projectChanges: NonNullable<Extract<EditOperation, { type: 'updateProject' }>['changes']> = {};
      if (
        !canAttachTake &&
        job?.canvas?.placement &&
        Number.isFinite(job.canvas.placement.x) &&
        Number.isFinite(job.canvas.placement.y) &&
        !p.canvasLayout?.[`asset:${asset.id}`]
      ) {
        projectChanges.canvasLayout = {
          ...(p.canvasLayout || {}),
          [`asset:${asset.id}`]: {
            x: Math.round(job.canvas.placement.x),
            y: Math.round(job.canvas.placement.y),
          },
        };
      }
      const sourceGenKey = job?.canvas?.sourceNodeKeys?.find((k) => k.startsWith('gen:'));
      if (sourceGenKey && p.canvasGenerators?.length) {
        const genId = sourceGenKey.slice(4);
        const matchIdx = p.canvasGenerators.findIndex((g) => g.id === genId);
        if (matchIdx >= 0) {
          const prevOuts = p.canvasGenerators[matchIdx].outputAssetIds || [];
          if (!prevOuts.includes(asset.id)) {
            projectChanges.canvasGenerators = p.canvasGenerators.map((g, idx) =>
              idx === matchIdx
                ? { ...g, outputAssetIds: [...prevOuts, asset.id], updatedAt: new Date().toISOString() }
                : g,
            );
          }
        }
      }
      if (Object.keys(projectChanges).length > 0) {
        ops.push({ type: 'updateProject', changes: projectChanges });
      }

      let attachment: Job['targetAttachment'] | undefined;
      if (canAttachTake && target) {
        const targetSeq = p.sequences.find((s) => s.id === target.sequenceId);
        const targetClip = targetSeq?.clips.find((c) => c.id === target.clipId);
        const alreadyAttached = Boolean(targetClip?.takes?.some((t) => t.id === takeId));
        if (!targetSeq) {
          attachment = { applied: false, reason: '原成片分支已删除，生成结果已收入项目素材库' };
        } else if (!targetClip) {
          attachment = { applied: false, reason: '原目标镜头已删除，生成结果已收入项目素材库' };
        } else if (targetClip.locked) {
          attachment = { applied: false, reason: `镜头「${targetClip.name}」已锁定，生成结果已收入项目素材库` };
        } else if (alreadyAttached) {
          attachment = { applied: true, takeId };
        } else {
          const nextNum = (targetClip.takes?.length || 1) + 1;
          const modelLabel = job?.generation?.model?.name || 'AI';
          const take: ClipTake = {
            id: takeId!,
            label: `T${nextNum} · ${modelLabel}`,
            kind: asset.kind === 'video' ? 'video' : 'image',
            sourceIn: 0,
            assetId: asset.id,
            props: { fit: 'cover', opacity: 1, scale: 1 },
            createdAt: new Date().toISOString(),
          };
          ops.push({
            type: 'addClipTake',
            sequenceId: targetSeq.id,
            clipId: targetClip.id,
            take,
            activate: target.mode === 'replace',
          });
          attachment = { applied: true, takeId };
        }
      }

      if (ops.length === 0) {
        if (job && attachment) await this.jobs.update(job, { targetAttachment: attachment });
        return;
      }

      const editTitle =
        attachment?.applied && target
          ? `为镜头挂载 AI 候选「${asset.name}」`
          : `添加${asset.kind === 'audio' ? '配音' : '生成素材'}`;
      try {
        const envelope = await store.edit(
          { baseRevision: p.revision, name: editTitle, operations: ops },
          active,
        );
        if (job && attachment) await this.jobs.update(job, { targetAttachment: attachment });
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

  private async encodeReference(
    store: ProjectStore,
    job: GenerationJob,
    dir: string,
    signal: AbortSignal,
    assetId: string,
    compressLargeToJpeg = true,
  ): Promise<EncodedReferenceImage> {
    const asset = await this.sourceAsset(store, job, assetId);
    let buffer = await imageData(asset, dir, signal, 'png');
    let mime: 'image/png' | 'image/jpeg' = 'image/png';
    if (compressLargeToJpeg && buffer.length > 3 * 1024 * 1024) {
      buffer = await imageData(asset, dir, signal, 'jpeg');
      mime = 'image/jpeg';
    }
    return {
      assetId,
      buffer,
      mime,
      dataUri: `data:${mime};base64,${buffer.toString('base64')}`,
    };
  }

  private async encodeReferences(
    store: ProjectStore,
    job: GenerationJob,
    dir: string,
    signal: AbortSignal,
    ids: string[],
  ): Promise<EncodedReferenceImage[]> {
    const results: EncodedReferenceImage[] = [];
    for (const id of ids) {
      results.push(await this.encodeReference(store, job, dir, signal, id));
    }
    return results;
  }

  private async image(
    store: ProjectStore,
    job: GenerationJob,
    resolved: Resolved,
    p: Record<string, unknown>,
    dir: string,
    signal: AbortSignal,
  ) {
    const { provider, model } = resolved;
    const req = job.generation!.request;
    if (p.output_format && !['png', 'jpeg', 'webp', 'gif'].includes(String(p.output_format)))
      throw new Error('请选择 PNG、JPEG、WebP 或 GIF 作为图像输出');

    const refIds = normalizedReferenceIds(req);
    const references = await this.encodeReferences(store, job, dir, signal, refIds);
    await this.jobs.update(job, { stage: '正在生成图像' });

    const driver = getProviderDriver(model.adapter);
    if (!driver.generateImage) throw new Error(`适配器「${model.adapter}」不支持图像生成`);

    const http = this.createDriverHttp(job, resolved);
    const image = await driver.generateImage(
      {
        provider,
        model,
        prompt: req.prompt!,
        params: p,
        references,
        size: req.size,
        resolution: req.resolution,
        aspectRatio: req.aspectRatio,
        background: req.background,
        existingRemote: job.remote,
        signal,
      },
      http,
    );

    if (!image?.b64_json && !image?.url) throw new Error('服务没有返回图片');
    const output = join(dir, uid('image'));
    if (image.b64_json) {
      await writeFile(output, Buffer.from(String(image.b64_json).replace(/^data:[^,]+,/, ''), 'base64'), {
        flag: 'wx',
      });
    } else if (image.url) {
      await downloadToFile(image.url, output, signal, provider.baseUrl);
    }

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
    resolved: Resolved,
    p: Record<string, unknown>,
    dir: string,
    signal: AbortSignal,
  ) {
    const { provider, model } = resolved;
    const req = job.generation!.request;
    await this.jobs.update(job, { stage: '正在生成配音' });
    const driver = getProviderDriver(model.adapter);
    if (!driver.generateSpeech) throw new Error(`适配器「${model.adapter}」不支持语音合成`);

    const http = this.createDriverHttp(job, resolved);
    const out = await driver.generateSpeech(
      {
        provider,
        model,
        prompt: req.prompt!,
        params: p,
        voice: req.voice,
        dir,
        outputStem: uid('voice'),
        signal,
      },
      http,
    );

    if (out.filePath) return out.filePath;
    const rawFile = join(dir, uid('voice-raw'));
    if (out.bytes) {
      await writeFile(rawFile, out.bytes, { flag: 'wx' });
    } else if (out.url) {
      await downloadToFile(out.url, rawFile, signal, provider.baseUrl);
    } else {
      throw new Error('语音合成服务未返回音频内容');
    }

    const handle = await open(rawFile, 'r');
    const header = Buffer.alloc(12);
    try {
      await handle.read(header);
    } finally {
      await handle.close();
    }
    const ext = detectAudioExtension(header);
    const named = `${rawFile}.${ext}`;
    await rename(rawFile, named);
    return named;
  }

  private async video(
    store: ProjectStore,
    job: GenerationJob,
    resolved: Resolved,
    p: Record<string, unknown>,
    dir: string,
    signal: AbortSignal,
  ) {
    const { provider, model } = resolved;
    const req = job.generation!.request;
    const driver = getProviderDriver(model.adapter);
    if (!driver.submitVideo || !driver.pollVideo) {
      throw new Error(`适配器「${model.adapter}」不支持视频生成`);
    }
    const http = this.createDriverHttp(job, resolved);

    if (!job.remote) {
      await this.jobs.update(job, { stage: '正在提交云端任务' });
      const refIds = normalizedReferenceIds(req);
      const references = await this.encodeReferences(store, job, dir, signal, refIds);
      const lastFrame = req.lastFrameAssetId
        ? await this.encodeReference(store, job, dir, signal, req.lastFrameAssetId)
        : undefined;
      const motionAsset = req.motionVideoAssetId
        ? await this.sourceAsset(store, job, req.motionVideoAssetId)
        : undefined;
      const motionVideo = motionAsset
        ? {
            assetId: motionAsset.id,
            filePath: motionAsset.path,
            fileName: motionAsset.name || `${motionAsset.id}${extname(motionAsset.path) || '.mp4'}`,
            mime: extname(motionAsset.path).toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4',
            kind: 'video' as const,
          }
        : undefined;
      const driverAudAsset = req.driverAudioAssetId
        ? await this.sourceAsset(store, job, req.driverAudioAssetId)
        : undefined;
      const driverAudio = driverAudAsset
        ? {
            assetId: driverAudAsset.id,
            filePath: driverAudAsset.path,
            fileName: driverAudAsset.name || `${driverAudAsset.id}${extname(driverAudAsset.path) || '.wav'}`,
            mime: extname(driverAudAsset.path).toLowerCase() === '.mp3' ? 'audio/mpeg' : 'audio/wav',
            kind: 'audio' as const,
          }
        : undefined;
      signal.throwIfAborted();
      // A submitted creation request can be billable. Read its acknowledgement even after a local stop.
      const receipt = AbortSignal.timeout(30000);
      const submitted = await driver.submitVideo(
        {
          provider,
          model,
          prompt: req.prompt!,
          params: p,
          references,
          lastFrame,
          motionVideo,
          driverAudio,
          animateMode: req.animateMode,
          size: req.size,
          resolution: req.resolution,
          aspectRatio: req.aspectRatio,
          seconds: req.seconds,
          generateAudio: req.generateAudio,
          signal: receipt,
        },
        http,
      );
      await http.onRemoteCreated({
        id: submitted.remoteId,
        status: submitted.initialStatus,
        apiVersion: submitted.apiVersion,
        pollPath: submitted.pollPath,
      });
    }

    signal.throwIfAborted();
    const pollDeadline = Date.now() + POLL_TIMEOUT_MS;
    let pollRetries = 0;
    let finished: { videoUrl?: string; streamPath?: string } | undefined;

    for (;;) {
      signal.throwIfAborted();
      if (Date.now() > pollDeadline) {
        throw new Error('云端生成任务等待超时（超过 15 分钟），可在后台作业面板稍后继续查询');
      }
      let pollRes;
      try {
        pollRes = await driver.pollVideo(
          provider,
          {
            id: job.remote!.id,
            adapter: model.adapter,
            apiVersion: job.remote!.apiVersion,
            pollPath: job.remote!.pollPath,
          },
          http,
          signal,
        );
        pollRetries = 0;
      } catch (err) {
        if (signal.aborted) throw err;
        const isTransient = (err instanceof ProviderError && err.status >= 500) || !(err instanceof ProviderError);
        if (isTransient && pollRetries < 3) {
          pollRetries++;
          await delay(2000 * pollRetries, undefined, { signal });
          continue;
        }
        throw err;
      }

      signal.throwIfAborted();
      const remote = { ...job.remote!, status: pollRes.status };
      if (pollRes.status === 'succeeded') {
        await this.jobs.update(job, { remote });
        finished = { videoUrl: pollRes.videoUrl, streamPath: pollRes.streamPath };
        break;
      }
      if (pollRes.status === 'failed' || pollRes.status === 'canceled' || pollRes.status === 'expired') {
        await this.jobs.update(job, { remote });
        throw new Error(pollRes.errorMessage || `云任务已终止（${pollRes.status}）`);
      }
      const stage = pollRes.status === 'pending' ? '云端排队中' : '云端生成中';
      const fraction = pollRes.progress !== undefined ? pollRes.progress : job.progress;
      if (stage !== job.stage || fraction !== job.progress || pollRes.status !== job.remote!.status) {
        await this.jobs.update(job, { remote, stage, progress: fraction });
      }
      await delay(1800, undefined, { signal });
    }

    await this.jobs.update(job, { stage: '正在下载生成的视频' });
    const output = join(dir, `${uid('video')}.mp4`);
    if (finished?.videoUrl) {
      await downloadToFile(finished.videoUrl, output, signal, provider.baseUrl);
    } else if (finished?.streamPath) {
      const response = await request(provider, finished.streamPath, {}, signal);
      if (!response.body) throw new Error('服务没有返回视频内容');
      await pipeline(Readable.fromWeb(response.body as any), createWriteStream(output, { flags: 'wx' }), {
        signal,
      });
    } else {
      throw new Error('云任务完成但未返回视频地址');
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
    if ((asset as Asset).hasAudio === false) throw new Error('该视频素材不包含音轨，无法进行语音转录');
    const p = { ...model.parameters, ...req.parameters };
    const isDashscopeAsr = model.adapter === 'dashscope-transcription';
    const chunkSeconds = isDashscopeAsr ? 120 : 300;
    const overlapSeconds = isDashscopeAsr ? 3 : 4;
    const stepSeconds = chunkSeconds - overlapSeconds;
    const diarize = model.modelId === 'gpt-4o-transcribe-diarize';
    const format = String(
      p.response_format ||
        (diarize ? 'diarized_json' : model.modelId.includes('whisper') ? 'verbose_json' : 'json'),
    );
    if (!isDashscopeAsr && !['json', 'verbose_json', 'diarized_json', 'text'].includes(format))
      throw new Error('请选择 JSON、带时间戳的 JSON 或纯文本转录格式');
    const segments: { start: number; end: number; text: string }[] = [];
    const texts: string[] = [];
    let coveredEnd = 0;
    for (let start = 0; start < asset.duration; start += stepSeconds) {
      signal.throwIfAborted();
      const file = join(dir, `speech-${start}.wav`);
      await this.jobs.update(job, {
        stage: `提取并转录 ${Math.floor(start / 60)}–${Math.ceil(Math.min(asset.duration, start + chunkSeconds) / 60)} 分钟`,
        progress: start / asset.duration,
      });
      let wavBytes: Buffer;
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
        wavBytes = await readFile(file);
      } catch (err) {
        if (String(err).includes('matches no streams') || String(err).includes('Stream map'))
          throw new Error('该视频素材不包含可提取的音轨');
        throw err;
      } finally {
        await rm(file, { force: true });
      }
      if (isDashscopeAsr) {
        const resp = await jsonRequest(
          provider,
          'chat/completions',
          {
            model: model.modelId,
            messages: [
              ...(req.prompt ? [{ role: 'system', content: req.prompt }] : []),
              {
                role: 'user',
                content: [
                  {
                    type: 'input_audio',
                    input_audio: {
                      data: `data:audio/wav;base64,${wavBytes.toString('base64')}`,
                      format: 'wav',
                    },
                  },
                ],
              },
            ],
            ...(p.temperature !== undefined ? { temperature: Number(p.temperature) } : {}),
            asr_options: {
              enable_itn: true,
              ...(req.language || p.language ? { language: String(req.language || p.language) } : {}),
            },
          },
          signal,
        );
        const rawContent = resp.choices?.[0]?.message?.content;
        const text = (
          typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent.map((part: any) => part?.text || '').join(' ')
              : ''
        ).trim();
        if (text) {
          let deduped = text;
          const prevText = texts.at(-1);
          if (start > 0 && prevText) {
            const maxOv = Math.min(24, prevText.length, deduped.length);
            for (let ov = maxOv; ov >= 4; ov--) {
              if (prevText.endsWith(deduped.slice(0, ov))) {
                deduped = deduped.slice(ov).trim();
                break;
              }
            }
          }
          if (deduped) {
            texts.push(deduped);
            const chunkStart = start > 0 ? Math.max(start, coveredEnd) : start;
            const chunkEnd = Math.min(asset.duration, start + chunkSeconds);
            if (chunkEnd > chunkStart) {
              const sentences = deduped
                .split(/(?<=[。！？.!?])\s+|\n+/)
                .map((s) => s.trim())
                .filter(Boolean);
              if (sentences.length <= 1) {
                segments.push({ start: chunkStart, end: chunkEnd, text: deduped });
              } else {
                const totalChars = Math.max(1, sentences.reduce((sum, s) => sum + s.length, 0));
                let cur = chunkStart;
                sentences.forEach((sent, idx) => {
                  const endT =
                    idx === sentences.length - 1
                      ? chunkEnd
                      : cur + ((chunkEnd - chunkStart) * sent.length) / totalChars;
                  segments.push({ start: Number(cur.toFixed(2)), end: Number(endT.toFixed(2)), text: sent });
                  cur = endT;
                });
              }
              coveredEnd = Math.max(coveredEnd, chunkEnd);
            }
          }
        }
      } else {
        const body = new FormData();
        body.append('file', new Blob([new Uint8Array(wavBytes)], { type: 'audio/wav' }), 'speech.wav');
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
            const absStart = start + from;
            const absEnd = start + to;
            const mid = (absStart + absEnd) / 2;
            if (start > 0 && mid <= coveredEnd + 0.1) continue;
            const clampedStart = start > 0 ? Math.max(absStart, coveredEnd) : absStart;
            if (absEnd <= clampedStart) continue;
            segments.push({ start: clampedStart, end: absEnd, text });
            coveredEnd = Math.max(coveredEnd, absEnd);
            chunk.push(text);
          }
        }
        const text = typeof data.text === 'string' && data.text.trim() ? data.text.trim() : chunk.join(' ');
        if (text) texts.push(text);
      }
      if (start + chunkSeconds >= asset.duration) break;
    }
    if (!texts.length && !segments.length) throw new Error('模型没有返回可用的转录文本');
    const transcriptResult = { text: texts.join('\n'), segments };
    try {
      const analysisDir = join(store.path, '.cocraft', 'analysis');
      await mkdir(analysisDir, { recursive: true });
      await atomicJSON(join(analysisDir, `transcript-${asset.id}.json`), {
        ...transcriptResult,
        language: req.language,
        updatedAt: new Date().toISOString(),
      });
      if (job.generation?.publish) await this.changed(store, await store.envelope());
    } catch {}
    return transcriptResult;
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
          ...(p.maxTokens ? { max_tokens: p.maxTokens } : {}),
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
