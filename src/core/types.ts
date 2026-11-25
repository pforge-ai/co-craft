export type ClipKind = 'video' | 'image' | 'audio' | 'title' | 'caption' | 'shape' | 'code';
export type Track = 'visual' | 'overlay' | 'caption' | 'audio';

/** Layer 1: Objective carrier / engine kind (never mixed with usage roles) */
export type AssetEntityKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'component'
  | 'three'
  | 'style'
  | 'skill'
  | 'text'
  | 'compound'
  | 'pack';

/** Layer 2: Creative usage role (determines activated capabilities & slots) */
export type AssetRole =
  | 'character'
  | 'product'
  | 'environment'
  | 'screen-recording'
  | 'footage'
  | 'voiceover'
  | 'sfx'
  | 'bgm'
  | 'title-chapter'
  | 'caption-style'
  | 'logic-diagram'
  | 'whiteboard'
  | 'device-frame'
  | 'backdrop'
  | 'editing-skill'
  | 'animation-skill'
  | 'visual-style';

/** Legacy v0.3 compatibility aliases */
export type AssetCategory = 'media' | 'subject' | 'brand' | 'rig' | 'recipe';
export type VaultSubkind =
  | 'character'
  | 'product'
  | 'environment'
  | 'media'
  | 'screen-recording'
  | 'brand-kit'
  | 'motion-rig'
  | 'three-rig'
  | 'model-3d'
  | 'splat-3d'
  | 'recipe'
  | 'text-note'
  | 'compound-clip'
  | 'material-pack';

export interface CustomTagDef {
  name: string;
  color: string;
}

export interface CanvasGroup {
  id: string;
  name: string;
  nodeIds: string[];
  color?: string;
  collapsed?: boolean;
}

export type CanvasGeneratorInputSlot =
  | 'subject'
  | 'scene'
  | 'style'
  | 'first-frame'
  | 'last-frame'
  | 'prompt-text'
  | 'motion-video'
  | 'driver-audio'
  | 'source';

export interface CanvasGeneratorInput {
  nodeKey: string;
  slot: CanvasGeneratorInputSlot;
}

export type CanvasGeneratorAction =
  | 'text-to-image'
  | 'image-edit'
  | 'multi-ref-image'
  | 'turnaround'
  | 'cutout'
  | 'image-to-video'
  | 'first-last-video'
  | 'ref-video'
  | 'motion-transfer'
  | 'character-replace'
  | 'lip-sync'
  | 'tts';

export interface CanvasGeneratorNode {
  id: string;
  title?: string;
  use: 'image' | 'video' | 'speech';
  action: CanvasGeneratorAction;
  modelId?: string;
  prompt: string;
  inputs: CanvasGeneratorInput[];
  params?: {
    aspectRatio?: string;
    resolution?: string;
    size?: string;
    seconds?: number;
    generateAudio?: boolean;
    background?: 'auto' | 'opaque' | 'transparent';
    voice?: string;
    animateMode?: 'wan-std' | 'wan-pro';
    batchCount?: number;
  };
  outputAssetIds?: string[];
  collapsed?: boolean;
  updatedAt: string;
}

export interface ChatContextRef {
  key: string;
  kind: 'asset' | 'entity' | 'component' | 'clip' | 'shot' | 'group' | 'text';
  id: string;
  label: string;
  clipId?: string;
}

export interface AssetLineageRef {
  assetId?: string;
  vaultItemId?: string;
  variantId?: string;
  version?: number;
  via:
    | 'capture-3d'
    | 'capture-depth'
    | 'capture-normal'
    | 'capture-clay'
    | 'bake-3d-video'
    | 'spatial-25d'
    | 'ai-generate'
    | 'first-last-frame'
    | 'motion-transfer'
    | 'character-replace'
    | 'lip-sync'
    | 'extract-frame'
    | 'detach-audio'
    | 'audio-normalize'
    | 'silence-trim'
    | 'vision-describe'
    | 'transcribe-slice'
    | 'shell-wrap'
    | 'fork'
    | 'import'
    | 'manual-ref'
    | 'compound-save'
    | 'text-derive';
  modelOrSkill?: string;
  note?: string;
}

export interface AssetVariant {
  id: string;
  name: string;
  parentVariantId?: string;
  version: number;
  assetId?: string;
  libraryFile?: string;
  promptDelta?: string;
  tags: string[];
  componentProps?: Record<string, string | number | boolean>;
  updatedAt: string;
}

export interface StyleTokens {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  surfaceColor: string;
  inkColor: string;
  captionColor: string;
  lightingPreset?: 'titanium-dark' | 'porcelain-soft' | 'cyber-rim';
  cornerRadius?: number;
}

export interface ShotBinding {
  entityId: string;
  variantId?: string;
  pinnedVersion?: number;
}

export interface TranscriptData {
  text: string;
  segments: { start: number; end: number; text: string }[];
  language?: string;
  updatedAt: string;
}

export interface AssetQualityScore {
  /** Normalized 0..100 overall candidate quality score */
  score: number;
  /** True for the top-ranked non-defective candidate in a batch */
  recommended?: boolean;
  /** Concise detected issues (e.g. '构图偏移', '局部畸变') */
  issues?: string[];
  /** Which tier/provider scored this asset ('local' | 'fast-model' | 'typesafe-jev') */
  provider: string;
  evaluatedAt: string;
}

export interface Asset {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio' | 'model-3d';
  role?: AssetRole;
  category?: AssetCategory;
  subkind?: VaultSubkind;
  path: string;
  duration: number;
  sha256?: string;
  byteSize?: number;
  hasAudio?: boolean;
  fps?: number;
  offline?: boolean;
  waveform?: number[];
  width?: number;
  height?: number;
  thumbnail?: string;
  tags?: string[];
  collection?: string;
  derivedFrom?: AssetLineageRef[];
  transcript?: TranscriptData;
  qualityScore?: AssetQualityScore;
  source?: { provider: string; url?: string; author?: string; license?: string; [key: string]: unknown };
  createdAt: string;
}

export interface CompoundClipBundle {
  clips: Clip[];
  durationFrames: number;
  fps: number;
  width: number;
  height: number;
  assetFiles?: Record<string, string>;
  componentSources?: Record<string, { name: string; source: string; props: Record<string, string | number | boolean> }>;
}

export interface VaultPackMember {
  kind: 'asset' | 'component' | 'vault';
  name: string;
  role?: AssetRole;
  assetId?: string;
  libraryFile?: string;
  assetKind?: Asset['kind'];
  componentId?: string;
  componentSource?: string;
  props?: Record<string, any>;
  promptAnchor?: string;
  textContent?: string;
  compound?: CompoundClipBundle;
}

export type FilmOverlayEffect = 'none' | 'dust' | 'rain' | 'speedlines';

export interface WordTiming {
  word: string;
  startSec: number;
  endSec: number;
}

export interface ActorVoiceProfile {
  modelId?: string;
  voice?: string;
  speed?: number;
  styleNote?: string;
}

export interface VaultItem {
  id: string;
  name: string;
  /** Objective carrier kind in v0.4 */
  entityKind?: AssetEntityKind;
  /** Creative usage role in v0.4 */
  role?: AssetRole;
  /** Open user/Agent custom tags & facet tags (e.g. '状态:雨夜', '第一幕') */
  tags?: string[];
  collection?: string;
  category: AssetCategory;
  subkind: VaultSubkind;
  description?: string;
  /** Freeform canvas script / prompt note content for text nodes */
  textContent?: string;
  /** Shared identity anchor across all variants of this entity */
  promptAnchor?: string;
  voiceId?: string;
  /** Bound character voice profile for speaker-aware dialogue synthesis */
  voiceProfile?: ActorVoiceProfile;
  /** Optional linked .glb 3D character stand-in asset */
  rigAssetId?: string;
  assetId?: string;
  libraryFile?: string;
  assetKind?: Asset['kind'];
  /** Multi-state / branch variant tree */
  variants?: AssetVariant[];
  defaultVariantId?: string;
  /** Upstream derivation lineage */
  derivedFrom?: AssetLineageRef[];
  /** Saved post-edit compound clip bundle */
  compound?: CompoundClipBundle;
  /** Bundled reusable material pack members */
  packItems?: VaultPackMember[];
  /** Decoupled Visual Style tokens */
  styleTokens?: StyleTokens;
  brand?: {
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    captionColor: string;
  };
  rig?: {
    presetId?: string;
    componentId?: string;
    componentName?: string;
    componentSource?: string;
    props?: Record<string, unknown>;
    cameraPreset?: string;
    slots?: { key: string; label: string; accepts: ('video' | 'image' | 'model-3d')[] }[];
  };
  recipe?: {
    skillId: string;
    slots: string[];
    promptTemplate: string;
    presetId?: string;
    /** Reusable canvas workshop subgraph snapshot (action + typed input slots + model + params) */
    workshop?: {
      use: 'image' | 'video' | 'speech';
      action: CanvasGeneratorAction;
      modelId?: string;
      prompt: string;
      inputSlots: CanvasGeneratorInputSlot[];
      params?: CanvasGeneratorNode['params'];
    };
  };
  version: number;
  originGlobalId?: string;
  updatedAt: string;
}

export interface ClipTake {
  id: string;
  label: string;
  kind: ClipKind;
  sourceIn: number;
  assetId?: string;
  componentId?: string;
  props: Record<string, any>;
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

export type TransitionType = 'dissolve' | 'fade' | 'slide-left' | 'zoom-in' | 'blur' | 'wipe';

export interface ClipTransition {
  type: TransitionType;
  durationFrames: number;
}

export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';

export type KeyframeProperty =
  | 'x'
  | 'y'
  | 'scale'
  | 'rotation'
  | 'opacity'
  | 'volume'
  | 'cameraYaw'
  | 'cameraPitch'
  | 'cameraDistance'
  | 'cameraLens'
  | 'cameraPanX'
  | 'cameraPanY'
  | 'explode';

export interface ClipKeyframe {
  /** Local frame offset relative to clip.start (0 .. clip.duration - 1). */
  frame: number;
  value: number;
  easing?: KeyframeEasing;
}

export type ClipKeyframes = Partial<Record<KeyframeProperty, ClipKeyframe[]>>;

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
  /** Audio clip attachment behavior during storyboard reorder: 'shot' moves with owning shot; 'timeline' stays pinned (e.g. BGM). */
  audioAttachMode?: 'shot' | 'timeline';
  /** Per-clip audio mute (applies to video embedded audio or independent audio clips in preview & export). */
  muted?: boolean;
  transitionIn?: ClipTransition | null;
  /** Property keyframe animation curves evaluated per local frame in preview & MP4 export. */
  keyframes?: ClipKeyframes;
  takes?: ClipTake[];
  activeTakeId?: string;
  subjectIds?: string[];
  subjectBindings?: ShotBinding[];
  shotNotes?: string;
  props: {
    text?: string;
    subtitle?: string;
    color?: string;
    background?: string;
    fontSize?: number;
    align?: 'left' | 'center' | 'right';
    position?: 'center' | 'bottom' | 'top';
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
    opacity?: number;
    scale?: number;
    x?: number;
    y?: number;
    focalX?: number;
    focalY?: number;
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
  mutedTracks?: Track[];
  /** Soloed tracks: when non-empty, only listed tracks (unless muted) render in preview & export. */
  soloTracks?: Track[];
  /** Independently mute embedded video audio on V1/V2 tracks (separate from A1 track mute and preview monitor mute). */
  mutedVideoAudio?: boolean;
  /** Film Version Tree & Parallel Branch metadata */
  branchName?: string;
  parentSequenceId?: string;
  forkedAtRevision?: number;
  isMainBranch?: boolean;
  workflowIntent?: 'product-demo' | 'explainer' | 'story-film' | 'blank';
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
  vault?: VaultItem[];
  activeBrandId?: string;
  activeSkillIds?: string[];
  customTags?: CustomTagDef[];
  canvasLayout?: Record<string, { x: number; y: number }>;
  canvasGroups?: CanvasGroup[];
  /** Node keys stowed off the Create Canvas desktop (underlying project assets stay intact). */
  canvasHiddenNodeIds?: string[];
  /** In-canvas live Generator / Transform nodes (Asset -> New Asset workbench cards). */
  canvasGenerators?: CanvasGeneratorNode[];
  /** Collapsed semantic zone IDs on the Create Canvas ('context' | 'explore' | 'shots'). */
  canvasCollapsedZones?: string[];
  workflowIntent?: 'product-demo' | 'explainer' | 'story-film' | 'blank';
  modelDefaults?: Partial<Record<ModelUse, string>>;
}

export interface Revision {
  revision: number;
  name: string;
  author: 'you' | 'agent' | 'system';
  createdAt: string;
  changes: string[];
}

export type ThinkingLevelChoice = 'off' | 'low' | 'medium' | 'high';

export interface ComposerAttachment {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  previewDataUrl?: string;
  sizeBytes?: number;
}

export interface SkillInfo {
  name: string;
  title?: string;
  description: string;
  path: string;
  scope: 'builtin' | 'user' | 'project';
  body?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  createdAt: string;
  tool?: string;
  status?: string;
  thinking?: string;
  attachments?: Pick<ComposerAttachment, 'id' | 'name' | 'kind' | 'previewDataUrl'>[];
  skillIds?: string[];
  refs?: string[];
}

export interface TaskUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
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
  usage?: TaskUsage;
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
  offlineAssetIds?: string[];
}

export interface EditScope {
  sequenceId?: string;
  clipIds?: string[];
  strict?: boolean;
  pin?: { x: number; y: number; frame: number; label?: string };
}

export interface PreflightIssue {
  id: string;
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  frame?: number;
  clipId?: string;
  assetId?: string;
}

export interface GenerationTarget {
  sequenceId: string;
  clipId: string;
  shotLabel?: string;
  mode: 'take' | 'replace';
}

export interface GenerationCanvasMeta {
  /** Desired world-space placement on the Create Canvas for the generated asset */
  placement?: { x: number; y: number };
  /** Upstream canvas node keys (`asset:...`, `ent:...`, `shot:...`) for Ghost wires & lineage */
  sourceNodeKeys?: string[];
  /** Reference asset IDs used in this generation */
  referenceAssetIds?: string[];
  /** Last frame asset ID for first/last-frame video bridging */
  lastFrameAssetId?: string;
  /** Driving motion/reference video asset ID for motion transfer or character replacement */
  motionVideoAssetId?: string;
  /** Driving speech audio asset ID for lip-sync S2V generation */
  driverAudioAssetId?: string;
  /** Short prompt summary shown on in-place Ghost rendering cards */
  promptPreview?: string;
  /** Generation purpose shown on Ghost card badge */
  use?: Exclude<ModelUse, 'agent'>;
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
  projectId?: string;
  projectName?: string;
  branchName?: string;
  projectPath?: string;
  modelId?: string;
  providerId?: string;
  inputAssetId?: string;
  target?: GenerationTarget;
  canvas?: GenerationCanvasMeta;
  targetAttachment?: { applied: boolean; takeId?: string; reason?: string };
  result?: { asset?: Asset; text?: string; segments?: { start: number; end: number; text: string }[] };
  remote?: {
    id: string;
    adapter: ModelAdapter;
    modelId: string;
    providerId: string;
    prompt: string;
    status?: string;
    apiVersion?: string;
    pollPath?: string;
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
  | 'dashscope-image'
  | 'dashscope-video'
  | 'dashscope-speech'
  | 'dashscope-transcription'
  | 'minimax-image'
  | 'minimax-video'
  | 'minimax-speech'
  | 'system-speech';

export interface ProviderConnection {
  id: string;
  name: string;
  protocol: 'openai' | 'anthropic' | 'google' | 'ark' | 'dashscope' | 'minimax' | 'system';
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

export type System1Mode = 'off' | 'fast-model' | 'typesafe-jev';

export interface System1Features {
  /** 智能横转竖锁主体（Box）— 仅在派生竖屏 9:16 分支时按镜触发 */
  autoReframeBox: boolean;
  /** 批量抽卡质检挑优（Noul + Score）— 仅在手动点击「质检挑优」时触发 */
  batchQualityGate: boolean;
  /** 指令舱极速本地分流（Choice）— 省主 Agent Token 费 */
  omnibarRouter: boolean;
  /** 所选素材一键智能归类（Choice）— 仅点击多选栏按钮时手动触发 */
  autoTagAssets: boolean;
}

export interface System1Settings {
  mode: System1Mode;
  fastModelId?: string;
  jevBaseUrl?: string;
  jevModelId?: string;
  jevApiKey?: string;
  hasJevApiKey?: boolean;
  features: System1Features;
  monthlyCallCap?: number;
}

export interface System1UsageStats {
  month: string;
  totalCalls: number;
  byTier: { local: number; fastModel: number; jev: number };
  byFeature: { reframeBox: number; qualityGate: number; omnibarRouter: number; autoTag: number };
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
  glow?: 'off' | 'subtle' | 'vivid';
  glowColor?: 'emerald' | 'silver' | 'cobalt' | 'amber' | 'aurora';
  motionEffects?: boolean;
  allowShell: boolean;
  allowNetwork: boolean;
  mcpBridgeEnabled?: boolean;
  /** Strictly optional, default-OFF 3-Tier System 1 decision engine settings */
  system1?: System1Settings;
}

export type EditOperation =
  | { type: 'updateClip'; sequenceId: string; clipId: string; changes: Partial<Clip> }
  | { type: 'addClip'; sequenceId: string; clip: Clip }
  | { type: 'deleteClip'; sequenceId: string; clipId: string; ripple?: boolean }
  | { type: 'updateSequence'; sequenceId: string; changes: Partial<Omit<Sequence, 'clips' | 'id'>> }
  | { type: 'addSequence'; sequence: Sequence }
  | { type: 'deleteSequence'; sequenceId: string }
  | {
      type: 'updateProject';
      changes: {
        name?: string;
        brief?: string;
        workflowIntent?: Project['workflowIntent'];
        activeSkillIds?: string[];
        canvasLayout?: Record<string, { x: number; y: number }>;
        canvasGroups?: CanvasGroup[];
        canvasHiddenNodeIds?: string[];
        canvasGenerators?: CanvasGeneratorNode[];
        canvasCollapsedZones?: string[];
        modelDefaults?: Partial<Record<ModelUse, string>>;
      };
    }
  | { type: 'addAsset'; asset: Asset }
  | {
      type: 'updateAssetMeta';
      assetId: string;
      changes: {
        name?: string;
        role?: AssetRole | null;
        tags?: string[];
        collection?: string;
        derivedFrom?: AssetLineageRef[];
        qualityScore?: AssetQualityScore | null;
      };
    }
  | { type: 'removeAsset'; assetId: string }
  | {
      type: 'relinkAsset';
      assetId: string;
      path: string;
      sha256?: string;
      byteSize?: number;
      duration?: number;
      width?: number;
      height?: number;
      thumbnail?: string;
      waveform?: number[];
      hasAudio?: boolean;
      clearTranscript?: boolean;
    }
  | { type: 'updateAssetTranscript'; assetId: string; transcript: TranscriptData }
  | { type: 'putComponent'; component: CodeComponent }
  | { type: 'removeComponent'; componentId: string }
  | { type: 'putVaultItem'; item: VaultItem }
  | { type: 'removeVaultItem'; itemId: string }
  | { type: 'setActiveBrand'; itemId?: string }
  | { type: 'upsertCustomTag'; tag: CustomTagDef }
  | { type: 'removeCustomTag'; tagName: string }
  | {
      type: 'forkSequenceBranch';
      sourceSequenceId: string;
      newSequenceId?: string;
      branchName: string;
      width?: number;
      height?: number;
      autoReframe?: boolean;
      focalOverrides?: Record<string, { focalX: number; focalY: number }>;
    }
  | { type: 'promoteSequenceBranch'; sequenceId: string }
  | { type: 'addClipTake'; sequenceId: string; clipId: string; take: ClipTake; activate?: boolean }
  | { type: 'switchClipTake'; sequenceId: string; clipId: string; takeId: string }
  | { type: 'reorderClips'; sequenceId: string; orderedClipIds: string[] };

export interface EditRequest {
  baseRevision: number;
  name: string;
  operations: EditOperation[];
  author?: 'you' | 'agent';
  runId?: string;
  scope?: EditScope;
}

export interface BootData {
  studioMedia: Asset[];
  projects: ProjectSummary[];
  current: ProjectEnvelope;
  settings: Settings;
  jobs: Job[];
  previewOrigin: string;
  version: string;
  skills: SkillInfo[];
  globalVault?: VaultItem[];
}

export interface AgentEvent {
  taskId: string;
  type: 'text' | 'thinking' | 'text-commit' | 'tool-start' | 'tool-end' | 'done' | 'error' | 'status';
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
  on(channel: 'project' | 'agent' | 'jobs' | 'menu' | 'settings', callback: (data: any) => void): () => void;
  pathsForFiles(files: File[]): string[];
}

declare global {
  interface Window {
    cocraft: DesktopAPI;
  }
}
