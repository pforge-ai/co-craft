export type ClipKind = 'video' | 'image' | 'audio' | 'title' | 'caption' | 'shape' | 'code';
export type Track = 'visual' | 'overlay' | 'caption' | 'audio';
export interface Asset {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  path: string;
  duration: number;
  waveform?: number[];
  width?: number;
  height?: number;
  thumbnail?: string;
  source?: { provider: string; url?: string; author?: string; license?: string };
  createdAt: string;
}
export interface CodeComponent {
  id: string;
  name: string;
  source: string;
  compiled: string;
  pack?: {
    id: string;
    name: string;
    version: string;
    author: string;
    license: string;
    durationSeconds: number;
    parameters?: import('./presets').PresetParameter[];
    sourceDirectory: string;
    fingerprint?: string;
    entry?: string;
  };
  hash: string;
  props: Record<string, string | number | boolean>;
}
export interface Clip {
  id: string;
  name: string;
  kind: ClipKind;
  track: Track;
  /** Compositing order within this track. Legacy snapshots use chronological order at layer zero. */
  layer?: number;
  start: number;
  duration: number;
  sourceIn: number;
  assetId?: string;
  componentId?: string;
  locked: boolean;
  props: {
    text?: string;
    subtitle?: string;
    color?: string;
    background?: string;
    fontSize?: number;
    align?: 'left' | 'center' | 'right';
    position?: 'center' | 'bottom' | 'top';
    volume?: number;
    opacity?: number;
    scale?: number;
    x?: number;
    y?: number;
    fit?: 'cover' | 'contain';
    animation?: 'fade' | 'rise' | 'type' | 'none';
    template?: string;
    [key: string]: unknown;
  };
}
export interface Sequence {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  clips: Clip[];
  background: string;
}
export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  brief: string;
  assets: Asset[];
  sequences: Sequence[];
  components: CodeComponent[];
  modelDefaults?: Partial<Record<ModelUse, string>>;
}
export interface Revision {
  revision: number;
  name: string;
  author: 'you' | 'agent' | 'system';
  createdAt: string;
  changes: string[];
}
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  createdAt: string;
  tool?: string;
  status?: string;
}
export interface Task {
  modelId?: string;
  id: string;
  name: string;
  sequenceId: string;
  createdAt: string;
  messages: Message[];
  status: 'idle' | 'running' | 'error';
  sessionPath?: string;
}
export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  updatedAt: string;
}
export interface ProjectEnvelope {
  project: Project;
  path: string;
  tasks: Task[];
  revisions: Revision[];
  canUndo: boolean;
  canRedo: boolean;
}
export interface Job {
  id: string;
  type: 'export' | 'import' | 'transcribe' | 'generate';
  name: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage: string;
  output?: string;
  error?: string;
  createdAt: string;
  revision?: number;
  projectPath?: string;
  modelId?: string;
  providerId?: string;
  inputAssetId?: string;
  result?: { asset?: Asset; text?: string; segments?: { start: number; end: number; text: string }[] };
  remote?: {
    id: string;
    adapter: ModelAdapter;
    modelId: string;
    providerId: string;
    prompt: string;
    status?: string;
  };
}
export type ModelUse = 'agent' | 'vision' | 'transcription' | 'speech' | 'image' | 'video';
export type ModelAdapter =
  | 'chat'
  | 'openai-image'
  | 'openai-speech'
  | 'openai-transcription'
  | 'openai-video'
  | 'ark-image'
  | 'ark-video'
  | 'system-speech';
export interface ProviderConnection {
  id: string;
  name: string;
  protocol: 'openai' | 'anthropic' | 'google' | 'ark' | 'system';
  baseUrl: string;
  apiKey?: string;
  hasApiKey: boolean;
  requiresKey: boolean;
}
export interface ModelDefinition {
  id: string;
  providerId: string;
  name: string;
  modelId: string;
  capabilities: ModelUse[];
  adapter: ModelAdapter;
  parameters: Record<string, string | number | boolean>;
}
export interface Settings {
  schemaVersion?: 2;
  providers: ProviderConnection[];
  models: ModelDefinition[];
  defaults: Partial<Record<ModelUse, string>>;
  glass: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  hasApiKey: boolean;
  pexelsKey?: string;
  hasPexelsKey: boolean;
  transcriptionKey?: string;
  hasTranscriptionKey: boolean;
  theme: 'dark' | 'light' | 'system';
  allowShell: boolean;
  allowNetwork: boolean;
}
export type EditOperation =
  | { type: 'updateClip'; sequenceId: string; clipId: string; changes: Partial<Clip> }
  | { type: 'addClip'; sequenceId: string; clip: Clip }
  | { type: 'deleteClip'; sequenceId: string; clipId: string; ripple?: boolean }
  | { type: 'updateSequence'; sequenceId: string; changes: Partial<Omit<Sequence, 'clips' | 'id'>> }
  | { type: 'addSequence'; sequence: Sequence }
  | {
      type: 'updateProject';
      changes: { name?: string; brief?: string; modelDefaults?: Partial<Record<ModelUse, string>> };
    }
  | { type: 'addAsset'; asset: Asset }
  | { type: 'putComponent'; component: CodeComponent };
export interface EditRequest {
  baseRevision: number;
  name: string;
  operations: EditOperation[];
  author?: 'you' | 'agent';
  runId?: string;
}
export interface BootData {
  studioMedia: Asset[];
  projects: ProjectSummary[];
  current: ProjectEnvelope;
  settings: Settings;
  jobs: Job[];
  previewOrigin: string;
  version: string;
  skills: { name: string; description: string; path: string }[];
}
export interface AgentEvent {
  taskId: string;
  type: 'text' | 'tool-start' | 'tool-end' | 'done' | 'error' | 'status';
  text?: string;
  tool?: string;
  runId: string;
}
export interface StockVideo {
  id: number;
  name: string;
  thumbnail: string;
  url: string;
  download: string;
  author: string;
  duration: number;
  width: number;
  height: number;
}
export interface DesktopAPI {
  call<T = unknown>(method: string, payload?: unknown): Promise<T>;
  on(channel: 'project' | 'agent' | 'jobs' | 'menu', callback: (data: any) => void): () => void;
  pathsForFiles(files: File[]): string[];
}
declare global {
  interface Window {
    cocraft: DesktopAPI;
  }
}
