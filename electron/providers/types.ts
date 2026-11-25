import type { ModelAdapter, ModelDefinition, ProviderConnection } from '../../src/core/types';

export interface EncodedReferenceImage {
  assetId: string;
  buffer: Buffer;
  mime: 'image/png' | 'image/jpeg';
  dataUri: string;
}

export interface EncodedMediaFile {
  assetId: string;
  filePath: string;
  fileName: string;
  mime: string;
  kind: 'video' | 'audio';
}

export interface ProviderRequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal;
  /** Route selector interpreted per protocol: 'default' | 'native' (DashScope /api/v1) | 'v1' | 'v2' (MiniMax) */
  baseKind?: 'default' | 'native' | 'v1' | 'v2';
}

export interface ProviderHttp {
  request(provider: ProviderConnection, path: string, opts?: ProviderRequestOptions): Promise<Response>;
  json(
    provider: ProviderConnection,
    path: string,
    body: unknown,
    opts?: Omit<ProviderRequestOptions, 'method' | 'body'> & { extraHeaders?: Record<string, string> },
  ): Promise<any>;
  downloadToFile(url: string, destFile: string, signal: AbortSignal, providerBaseUrl?: string): Promise<void>;
  assertSafeUrl(url: URL, providerBaseUrl?: string): Promise<void>;
  onRemoteCreated(remote: {
    id: string;
    status: string;
    apiVersion?: string;
    pollPath?: string;
  }): Promise<void>;
  onStage(stage: string, progress?: number, remoteStatus?: string): Promise<void>;
}

export interface ImageDriverRequest {
  provider: ProviderConnection;
  model: ModelDefinition;
  prompt: string;
  params: Record<string, unknown>;
  references: EncodedReferenceImage[];
  size?: string;
  resolution?: string;
  aspectRatio?: string;
  background?: 'auto' | 'opaque' | 'transparent';
  existingRemote?: { id: string; status?: string; apiVersion?: string; pollPath?: string };
  signal: AbortSignal;
}

export interface ImageDriverResult {
  b64_json?: string;
  url?: string;
}

export interface VideoDriverRequest {
  provider: ProviderConnection;
  model: ModelDefinition;
  prompt: string;
  params: Record<string, unknown>;
  references: EncodedReferenceImage[];
  lastFrame?: EncodedReferenceImage;
  motionVideo?: EncodedMediaFile;
  driverAudio?: EncodedMediaFile;
  animateMode?: 'wan-std' | 'wan-pro';
  size?: string;
  resolution?: string;
  aspectRatio?: string;
  seconds?: number;
  generateAudio?: boolean;
  signal: AbortSignal;
}

export interface VideoSubmitResult {
  remoteId: string;
  initialStatus: string;
  apiVersion?: string;
  pollPath?: string;
}

export interface VideoPollResult {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'expired';
  progress?: number;
  videoUrl?: string;
  streamPath?: string;
  errorMessage?: string;
}

export interface SpeechDriverRequest {
  provider: ProviderConnection;
  model: ModelDefinition;
  prompt: string;
  params: Record<string, unknown>;
  voice?: string;
  dir: string;
  outputStem: string;
  signal: AbortSignal;
}

export interface SpeechDriverResult {
  /** Direct file path if the driver wrote the audio file itself */
  filePath?: string;
  /** Raw bytes returned inline (base64/hex decoded) */
  bytes?: Buffer;
  /** Remote audio URL to download via SSRF-checked downloader */
  url?: string;
}

export interface MediaProviderDriver {
  readonly adapters: readonly ModelAdapter[];
  generateImage?(req: ImageDriverRequest, http: ProviderHttp): Promise<ImageDriverResult>;
  submitVideo?(req: VideoDriverRequest, http: ProviderHttp): Promise<VideoSubmitResult>;
  pollVideo?(
    provider: ProviderConnection,
    remote: { id: string; adapter: ModelAdapter; apiVersion?: string; pollPath?: string },
    http: ProviderHttp,
    signal: AbortSignal,
  ): Promise<VideoPollResult>;
  generateSpeech?(req: SpeechDriverRequest, http: ProviderHttp): Promise<SpeechDriverResult>;
}

export function pickParams(p: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => p[k] !== undefined && p[k] !== '').map((k) => [k, p[k]]));
}

export function dashscopeSizeFormat(s?: unknown): string | undefined {
  if (!s) return undefined;
  const trimmed = String(s).trim();
  if (/^\d+x\d+$/i.test(trimmed)) return trimmed.replace(/x/i, '*');
  return trimmed || undefined;
}

export function mapSizeToAspectRatio(size?: string): string | undefined {
  if (!size) return undefined;
  const trimmed = size.trim().toLowerCase();
  if (/^\d+:\d+$/.test(trimmed) || trimmed === 'adaptive') return trimmed;
  const presetMap: Record<string, string> = {
    '1280x720': '16:9',
    '1280*720': '16:9',
    '1920x1080': '16:9',
    '1920*1080': '16:9',
    '720x1280': '9:16',
    '720*1280': '9:16',
    '1080x1920': '9:16',
    '1080*1920': '9:16',
    '1024x1024': '1:1',
    '1024*1024': '1:1',
    '1440x1080': '4:3',
    '1080x1440': '3:4',
  };
  return presetMap[trimmed];
}

export function detectAudioExtension(header: Buffer): string {
  if (header.toString('ascii', 0, 4) === 'RIFF') return 'wav';
  if (header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) return 'mp3';
  if (header.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (header.toString('ascii', 0, 4) === 'fLaC') return 'flac';
  return 'mp3';
}
