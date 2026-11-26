import type { Asset, Clip, ClipKeyframes } from './types';

export type SpatialSceneMode =
  | 'parallax-25d'
  | 'previs-blocking'
  | 'device-showcase'
  | 'turbine'
  | 'chip-stack'
  | 'factory-flow';

export type SpatialCameraPreset =
  | 'dolly-in'
  | 'orbit'
  | 'crane-up'
  | 'dolly-zoom'
  | 'pan-sweep'
  | 'isometric'
  | 'hero-low'
  | 'top-down'
  | 'static';

export type SpatialRenderPass = 'beauty' | 'clay' | 'depth' | 'normal' | 'wireframe';

export type SpatialLookPreset = 'cinema' | 'anime-npr' | 'noir-dramatic' | 'clean-studio';

export type SpatialParticles3D = 'none' | 'dust' | 'rain' | 'snow' | 'embers';

export type SpatialBlockingPose = 'standoff' | 'dialogue' | 'action-dash' | 'hero-solo';

export type SpatialActorAction = 'idle' | 'walk' | 'run' | 'confront' | 'wave' | 'turn';

export type SpatialActorPath =
  | 'hold'
  | 'approach'
  | 'cross-left-right'
  | 'cross-right-left'
  | 'circle-rival'
  | 'retreat';

export type SpatialEnvironmentPreset =
  | 'studio-grid'
  | 'rooftop-night'
  | 'neon-alley'
  | 'cyber-corridor'
  | 'open-horizon';

export type SpatialDeviceType = 'phone' | 'laptop' | 'cinema-display';

export type SpatialStageObjectKind =
  | 'actor'
  | 'prop-box'
  | 'prop-pillar'
  | 'prop-arch'
  | 'glb'
  | 'card-25d'
  | 'light';

export interface SpatialStageObject {
  id: string;
  name: string;
  kind: SpatialStageObjectKind;
  assetId?: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  color?: string;
  action?: SpatialActorAction;
  endPosition?: [number, number, number];
  intensity?: number;
  temperature?: number;
}

export const SPATIAL_SCENE_MODE_OPTIONS: { id: SpatialSceneMode; label: string }[] = [
  { id: 'previs-blocking', label: '导演白模预演棚' },
  { id: 'parallax-25d', label: '2.5D 立体视差舞台' },
  { id: 'device-showcase', label: '3D 硬件屏幕演示' },
  { id: 'turbine', label: '机械涡轮拆解' },
  { id: 'chip-stack', label: '芯片架构堆栈' },
  { id: 'factory-flow', label: '空间产线流' },
];

export const SPATIAL_LOOK_PRESET_OPTIONS: { id: SpatialLookPreset; label: string }[] = [
  { id: 'cinema', label: '电影质感' },
  { id: 'clean-studio', label: '干净棚拍' },
  { id: 'noir-dramatic', label: '黑色电影' },
  { id: 'anime-npr', label: '二次元风格化' },
];

export const SPATIAL_DEVICE_OPTIONS: { id: SpatialDeviceType; label: string }[] = [
  { id: 'phone', label: '智能手机' },
  { id: 'laptop', label: '笔记本电脑' },
  { id: 'cinema-display', label: '专业监视器' },
];

export const SPATIAL_STAGE_OBJECT_LABELS: Record<SpatialStageObjectKind, string> = {
  actor: '演员人偶',
  'prop-box': '体块道具',
  'prop-pillar': '建筑立柱',
  'prop-arch': '场景拱门',
  glb: '3D 模型',
  'card-25d': '2D 立体立牌',
  light: '舞台灯光',
};

/**
 * Deterministic color temperature (Kelvin 2000K..10000K) to hex string converter.
 * 2600K = warm tungsten, 5600K = daylight neutral, 8500K = cool moonlight.
 */
export function kelvinToHex(kelvin: number): string {
  const k = Math.max(2000, Math.min(10000, Number.isFinite(kelvin) ? kelvin : 5600)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (k <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(k) - 161.1195681661;
    b = k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(k - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(k - 60, 0.0755148492);
    b = 255;
  }
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export function createStageObject(
  kind: SpatialStageObjectKind,
  existing: SpatialStageObject[] = [],
  opts?: { name?: string; assetId?: string; color?: string; position?: [number, number, number] },
): SpatialStageObject {
  const countOfKind = existing.filter((o) => o.kind === kind).length + 1;
  const spread = ((existing.length % 5) - 2) * 0.95;
  const depthOffset = -0.4 + Math.floor(existing.length / 5) * 0.8;
  const defaultPos: [number, number, number] =
    opts?.position ||
    (kind === 'light'
      ? [spread || 1.8, 2.4, depthOffset + 1.2]
      : kind === 'card-25d'
        ? [spread, 0, depthOffset - 0.6]
        : [spread, 0, depthOffset]);
  const id = `obj_${kind.replace(/[^a-z0-9]/g, '')}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const base: SpatialStageObject = {
    id,
    name: opts?.name || `${SPATIAL_STAGE_OBJECT_LABELS[kind]} ${countOfKind}`,
    kind,
    assetId: opts?.assetId,
    position: [
      Number(defaultPos[0].toFixed(2)),
      Number(defaultPos[1].toFixed(2)),
      Number(defaultPos[2].toFixed(2)),
    ],
    rotationY: 0,
    scale: 1,
    color:
      opts?.color ||
      (kind === 'actor'
        ? '#60a5fa'
        : kind === 'light'
          ? '#ffd8a8'
          : kind === 'prop-arch'
            ? '#475569'
            : '#64748b'),
  };
  if (kind === 'actor') {
    base.action = 'walk';
    base.endPosition = [Number((base.position[0] + 0.8).toFixed(2)), 0, Number((base.position[2] + 1.2).toFixed(2))];
  } else if (kind === 'light') {
    base.intensity = 2.6;
    base.temperature = 3800;
  }
  return base;
}

export function normalizeCameraBookmarks(raw: unknown): SpatialCameraBookmark[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_SPATIAL_BOOKMARKS.map((b) => ({ ...b }));
  }
  const clean: SpatialCameraBookmark[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Partial<SpatialCameraBookmark> | null;
    if (!item || typeof item !== 'object') continue;
    const rawDist = Number(item.cameraDistance ?? 1);
    const normDist = Number.isFinite(rawDist)
      ? rawDist > 3.2
        ? Math.max(0.35, Math.min(3.0, Number((rawDist / 5.4).toFixed(2))))
        : Math.max(0.35, Math.min(3.0, rawDist))
      : 1.0;
    clean.push({
      id: typeof item.id === 'string' && item.id ? item.id : `cam-${i + 1}`,
      shortKey: typeof item.shortKey === 'string' && item.shortKey ? item.shortKey : String.fromCharCode(65 + (i % 26)),
      label: typeof item.label === 'string' && item.label ? item.label : `机位 ${i + 1}`,
      cameraPreset: (typeof item.cameraPreset === 'string' ? item.cameraPreset : 'static') as SpatialCameraPreset,
      cameraLens: Math.max(16, Math.min(135, Number(item.cameraLens ?? 35))),
      cameraYaw: Number.isFinite(Number(item.cameraYaw)) ? Number(item.cameraYaw) : 0,
      cameraPitch: Number.isFinite(Number(item.cameraPitch)) ? Number(item.cameraPitch) : 0,
      cameraDistance: normDist,
      cameraPanX: Number.isFinite(Number(item.cameraPanX)) ? Number(item.cameraPanX) : 0,
      cameraPanY: Number.isFinite(Number(item.cameraPanY)) ? Number(item.cameraPanY) : 0,
    });
  }
  return clean.length > 0 ? clean : DEFAULT_SPATIAL_BOOKMARKS.map((b) => ({ ...b }));
}

export type SpatialShotMode = 'still' | 'motion';

export interface SpatialCameraPoseSpec {
  cameraPreset: SpatialCameraPreset;
  cameraLens: number;
  cameraYaw: number;
  cameraPitch: number;
  cameraDistance: number;
  cameraPanX?: number;
  cameraPanY?: number;
}

export interface SpatialShotOutputRecord {
  assetIds: string[];
  primaryAssetId?: string;
  clipId?: string;
  kind: 'still' | 'multipass' | 'pair' | 'video' | 'live-3d';
  shotAt: string;
  /** Deterministic signature of the Scene/Set layer when this shot was last captured */
  sceneSignature: string;
}

export interface SpatialDirectorShot {
  id: string;
  shortKey: string;
  name: string;
  mode: SpatialShotMode;
  camera: SpatialCameraPoseSpec;
  endCamera?: SpatialCameraPoseSpec;
  durationSec: number;
  renderPass?: SpatialRenderPass;
  keyframes?: ClipKeyframes;
  actorAction?: SpatialActorAction;
  actorPath?: SpatialActorPath;
  output?: SpatialShotOutputRecord;
}

function normalizeShotDistance(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1.0;
  const scaled = n > 3.2 ? n / 5.4 : n;
  return Number(Math.max(0.35, Math.min(3.0, scaled)).toFixed(2));
}

export function buildMotionShotKeyframes(
  startCam: SpatialCameraPoseSpec,
  endCam: SpatialCameraPoseSpec,
  durationFrames: number,
): ClipKeyframes {
  const endF = Math.max(1, Math.round(durationFrames) - 1);
  return {
    cameraYaw: [
      { frame: 0, value: Number(startCam.cameraYaw || 0), easing: 'ease-in-out' },
      { frame: endF, value: Number(endCam.cameraYaw || 0), easing: 'ease-in-out' },
    ],
    cameraPitch: [
      { frame: 0, value: Number(startCam.cameraPitch || 0), easing: 'ease-in-out' },
      { frame: endF, value: Number(endCam.cameraPitch || 0), easing: 'ease-in-out' },
    ],
    cameraDistance: [
      { frame: 0, value: normalizeShotDistance(startCam.cameraDistance), easing: 'ease-in-out' },
      { frame: endF, value: normalizeShotDistance(endCam.cameraDistance), easing: 'ease-in-out' },
    ],
    cameraLens: [
      { frame: 0, value: Math.max(16, Math.min(135, Number(startCam.cameraLens || 35))), easing: 'ease-in-out' },
      { frame: endF, value: Math.max(16, Math.min(135, Number(endCam.cameraLens || 35))), easing: 'ease-in-out' },
    ],
    cameraPanX: [
      { frame: 0, value: Number(startCam.cameraPanX || 0), easing: 'ease-in-out' },
      { frame: endF, value: Number(endCam.cameraPanX || 0), easing: 'ease-in-out' },
    ],
    cameraPanY: [
      { frame: 0, value: Number(startCam.cameraPanY || 0), easing: 'ease-in-out' },
      { frame: endF, value: Number(endCam.cameraPanY || 0), easing: 'ease-in-out' },
    ],
  };
}

export const DEFAULT_DIRECTOR_SHOTS: SpatialDirectorShot[] = [
  {
    id: 'shot-1',
    shortKey: 'S1',
    name: '主镜建立',
    mode: 'still',
    camera: {
      cameraPreset: 'static',
      cameraLens: 35,
      cameraYaw: 0,
      cameraPitch: -2,
      cameraDistance: 1.0,
      cameraPanX: 0,
      cameraPanY: 0,
    },
    durationSec: 3,
    renderPass: 'beauty',
  },
  {
    id: 'shot-2',
    shortKey: 'S2',
    name: '过肩反打',
    mode: 'still',
    camera: {
      cameraPreset: 'static',
      cameraLens: 85,
      cameraYaw: -28,
      cameraPitch: 4,
      cameraDistance: 0.92,
      cameraPanX: 0.12,
      cameraPanY: 0.04,
    },
    durationSec: 3,
    renderPass: 'beauty',
  },
  {
    id: 'shot-3',
    shortKey: 'S3',
    name: '推轨运镜',
    mode: 'motion',
    camera: {
      cameraPreset: 'static',
      cameraLens: 35,
      cameraYaw: -18,
      cameraPitch: 2,
      cameraDistance: 1.15,
      cameraPanX: 0,
      cameraPanY: 0,
    },
    endCamera: {
      cameraPreset: 'static',
      cameraLens: 50,
      cameraYaw: 16,
      cameraPitch: -8,
      cameraDistance: 0.82,
      cameraPanX: 0,
      cameraPanY: -0.05,
    },
    durationSec: 4,
    renderPass: 'beauty',
    keyframes: buildMotionShotKeyframes(
      { cameraPreset: 'static', cameraLens: 35, cameraYaw: -18, cameraPitch: 2, cameraDistance: 1.15, cameraPanX: 0, cameraPanY: 0 },
      { cameraPreset: 'static', cameraLens: 50, cameraYaw: 16, cameraPitch: -8, cameraDistance: 0.82, cameraPanX: 0, cameraPanY: -0.05 },
      120,
    ),
  },
  {
    id: 'shot-4',
    shortKey: 'S4',
    name: '俯瞰调度',
    mode: 'still',
    camera: {
      cameraPreset: 'static',
      cameraLens: 24,
      cameraYaw: 12,
      cameraPitch: 32,
      cameraDistance: 1.2,
      cameraPanX: 0,
      cameraPanY: 0,
    },
    durationSec: 3,
    renderPass: 'beauty',
  },
];

/**
 * Deterministic lightweight signature of the Scene / Set layer (shared environment, lighting, props, cast).
 * Camera framing / active shot selection intentionally excluded so editing Shot 2 does not mark Shot 1 stale!
 */
export function computeStageSceneSignature(props: Record<string, unknown>): string {
  const payload = {
    sceneType: props.sceneType ?? '',
    environmentPreset: props.environmentPreset ?? '',
    lookPreset: props.lookPreset ?? '',
    lightingPreset: props.lightingPreset ?? '',
    keyLightYaw: Math.round(Number(props.keyLightYaw ?? 38)),
    keyLightTemp: Math.round(Number(props.keyLightTemp ?? 5600)),
    particles3D: props.particles3D ?? 'none',
    deviceType: props.deviceType ?? '',
    explode: Number(Number(props.explode ?? 0).toFixed(2)),
    depthStrength: Number(Number(props.depthStrength ?? 0.65).toFixed(2)),
    bloomStrength: Math.round(Number(props.bloomStrength ?? 22)),
    blockingPose: props.blockingPose ?? '',
    actorStartX: props.actorStartX ?? null,
    actorStartZ: props.actorStartZ ?? null,
    actorEndX: props.actorEndX ?? null,
    actorEndZ: props.actorEndZ ?? null,
    stageObjects: Array.isArray(props.stageObjects) ? props.stageObjects : [],
    layerAssetIds: Array.isArray(props.layerAssetIds) ? props.layerAssetIds : [],
    screenAssetId: props.screenAssetId ?? '',
  };
  const str = JSON.stringify(payload);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `sc_${(h >>> 0).toString(16)}`;
}

export function normalizeStageShots(rawShots: unknown, fallbackBookmarks?: unknown): SpatialDirectorShot[] {
  if (Array.isArray(rawShots) && rawShots.length > 0) {
    const clean: SpatialDirectorShot[] = [];
    for (let i = 0; i < rawShots.length; i++) {
      const s = rawShots[i] as Partial<SpatialDirectorShot> | null;
      if (!s || typeof s !== 'object') continue;
      const cam = (s.camera || {}) as Partial<SpatialCameraPoseSpec>;
      const mode: SpatialShotMode = s.mode === 'motion' ? 'motion' : 'still';
      const dur = Math.max(1, Math.min(12, Math.round(Number(s.durationSec ?? (mode === 'motion' ? 4 : 3)))));
      const normCam: SpatialCameraPoseSpec = {
        cameraPreset: (typeof cam.cameraPreset === 'string' ? cam.cameraPreset : 'static') as SpatialCameraPreset,
        cameraLens: Math.max(16, Math.min(135, Number(cam.cameraLens ?? 35))),
        cameraYaw: Number.isFinite(Number(cam.cameraYaw)) ? Number(cam.cameraYaw) : 0,
        cameraPitch: Number.isFinite(Number(cam.cameraPitch)) ? Number(cam.cameraPitch) : 0,
        cameraDistance: normalizeShotDistance(cam.cameraDistance),
        cameraPanX: Number.isFinite(Number(cam.cameraPanX)) ? Number(cam.cameraPanX) : 0,
        cameraPanY: Number.isFinite(Number(cam.cameraPanY)) ? Number(cam.cameraPanY) : 0,
      };
      const endCamRaw = s.endCamera as Partial<SpatialCameraPoseSpec> | undefined;
      const endCamera: SpatialCameraPoseSpec | undefined = endCamRaw
        ? {
            cameraPreset: (typeof endCamRaw.cameraPreset === 'string' ? endCamRaw.cameraPreset : 'static') as SpatialCameraPreset,
            cameraLens: Math.max(16, Math.min(135, Number(endCamRaw.cameraLens ?? normCam.cameraLens))),
            cameraYaw: Number.isFinite(Number(endCamRaw.cameraYaw)) ? Number(endCamRaw.cameraYaw) : normCam.cameraYaw,
            cameraPitch: Number.isFinite(Number(endCamRaw.cameraPitch)) ? Number(endCamRaw.cameraPitch) : normCam.cameraPitch,
            cameraDistance: normalizeShotDistance(endCamRaw.cameraDistance ?? normCam.cameraDistance),
            cameraPanX: Number.isFinite(Number(endCamRaw.cameraPanX)) ? Number(endCamRaw.cameraPanX) : 0,
            cameraPanY: Number.isFinite(Number(endCamRaw.cameraPanY)) ? Number(endCamRaw.cameraPanY) : 0,
          }
        : undefined;
      clean.push({
        id: typeof s.id === 'string' && s.id ? s.id : `shot-${i + 1}`,
        shortKey: typeof s.shortKey === 'string' && s.shortKey ? s.shortKey : `S${i + 1}`,
        name: typeof s.name === 'string' && s.name ? s.name : `镜头 ${i + 1}`,
        mode,
        camera: normCam,
        endCamera,
        durationSec: dur,
        renderPass:
          s.renderPass === 'clay' ||
          s.renderPass === 'depth' ||
          s.renderPass === 'normal' ||
          s.renderPass === 'wireframe'
            ? s.renderPass
            : 'beauty',
        keyframes: s.keyframes && typeof s.keyframes === 'object' ? s.keyframes : undefined,
        actorAction: s.actorAction,
        actorPath: s.actorPath,
        output: s.output,
      });
    }
    if (clean.length > 0) return clean;
  }
  if (Array.isArray(fallbackBookmarks) && fallbackBookmarks.length > 0) {
    const bms = normalizeCameraBookmarks(fallbackBookmarks);
    return bms.map((bm, idx) => ({
      id: bm.id || `shot-${idx + 1}`,
      shortKey: `S${idx + 1}`,
      name: bm.label.replace(/^[A-Z]\s*机?\s*[·•-]?\s*/, '') || `机位 ${idx + 1}`,
      mode: 'still' as const,
      camera: {
        cameraPreset: 'static' as SpatialCameraPreset,
        cameraLens: bm.cameraLens,
        cameraYaw: bm.cameraYaw,
        cameraPitch: bm.cameraPitch,
        cameraDistance: bm.cameraDistance,
        cameraPanX: bm.cameraPanX ?? 0,
        cameraPanY: bm.cameraPanY ?? 0,
      },
      durationSec: 3,
      renderPass: 'beauty' as SpatialRenderPass,
    }));
  }
  return DEFAULT_DIRECTOR_SHOTS.map((s) => ({
    ...s,
    camera: { ...s.camera },
    endCamera: s.endCamera ? { ...s.endCamera } : undefined,
    keyframes: s.keyframes ? JSON.parse(JSON.stringify(s.keyframes)) : undefined,
  }));
}

export function createDirectorShot(
  mode: SpatialShotMode,
  existing: SpatialDirectorShot[],
  baseCamera?: Partial<SpatialCameraPoseSpec>,
  fps = 30,
): SpatialDirectorShot {
  const num = existing.length + 1;
  const startCam: SpatialCameraPoseSpec = {
    cameraPreset: 'static',
    cameraLens: Math.max(16, Math.min(135, Number(baseCamera?.cameraLens ?? 35))),
    cameraYaw: Number.isFinite(Number(baseCamera?.cameraYaw)) ? Number(baseCamera?.cameraYaw) : 0,
    cameraPitch: Number.isFinite(Number(baseCamera?.cameraPitch)) ? Number(baseCamera?.cameraPitch) : 0,
    cameraDistance: normalizeShotDistance(baseCamera?.cameraDistance ?? 1.0),
    cameraPanX: Number.isFinite(Number(baseCamera?.cameraPanX)) ? Number(baseCamera?.cameraPanX) : 0,
    cameraPanY: Number.isFinite(Number(baseCamera?.cameraPanY)) ? Number(baseCamera?.cameraPanY) : 0,
  };
  const endCam: SpatialCameraPoseSpec | undefined =
    mode === 'motion'
      ? {
          ...startCam,
          cameraYaw: Number((startCam.cameraYaw + 24).toFixed(0)),
          cameraDistance: Number(Math.max(0.45, startCam.cameraDistance * 0.84).toFixed(2)),
        }
      : undefined;
  return {
    id: `shot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    shortKey: `S${num}`,
    name: mode === 'motion' ? `运镜镜头 ${num}` : `定机位 ${num}`,
    mode,
    camera: startCam,
    endCamera: endCam,
    durationSec: mode === 'motion' ? 4 : 3,
    renderPass: 'beauty',
    keyframes: mode === 'motion' && endCam ? buildMotionShotKeyframes(startCam, endCam, 4 * fps) : undefined,
  };
}

/**
 * Projects a Shot List onto SpatialCameraBookmark[] for 2D StageRadarOverlay and 3D frustum trajectory guides.
 */
export function shotsToCameraBookmarks(shots: SpatialDirectorShot[]): SpatialCameraBookmark[] {
  return shots.map((s) => ({
    id: s.id,
    shortKey: s.shortKey,
    label: `${s.shortKey} · ${s.name}`,
    cameraPreset: s.camera.cameraPreset,
    cameraLens: s.camera.cameraLens,
    cameraYaw: s.camera.cameraYaw,
    cameraPitch: s.camera.cameraPitch,
    cameraDistance: s.camera.cameraDistance,
    cameraPanX: s.camera.cameraPanX ?? 0,
    cameraPanY: s.camera.cameraPanY ?? 0,
  }));
}

export const SPATIAL_ACTOR_ACTION_OPTIONS: { id: SpatialActorAction; label: string }[] = [
  { id: 'walk', label: '迈步行走 (Walk)' },
  { id: 'run', label: '前倾疾跑 (Run)' },
  { id: 'confront', label: '抬手对峙 (Confront)' },
  { id: 'turn', label: '转身回眸 (Turn)' },
  { id: 'wave', label: '挥手呼喊 (Wave)' },
  { id: 'idle', label: '呼吸待机 (Idle)' },
];

export const SPATIAL_ACTOR_PATH_OPTIONS: { id: SpatialActorPath; label: string }[] = [
  { id: 'hold', label: '原地表演 (Hold)' },
  { id: 'approach', label: '向镜头走近 (Approach)' },
  { id: 'cross-left-right', label: '左进右出横穿 (L → R)' },
  { id: 'cross-right-left', label: '右进左出横穿 (R → L)' },
  { id: 'circle-rival', label: '绕对手走位对峙 (Circle)' },
  { id: 'retreat', label: '后退拉远 (Retreat)' },
];

export const SPATIAL_ENVIRONMENT_OPTIONS: { id: SpatialEnvironmentPreset; label: string }[] = [
  { id: 'rooftop-night', label: '雨夜天台都市' },
  { id: 'neon-alley', label: '赛博霓虹窄巷' },
  { id: 'cyber-corridor', label: '纵深科幻长廊' },
  { id: 'open-horizon', label: '极简地平线逆光' },
  { id: 'studio-grid', label: '标准白箱导演棚' },
];

export interface SpatialCameraBookmark {
  id: string;
  label: string;
  shortKey: string;
  cameraPreset: SpatialCameraPreset;
  cameraLens: number;
  cameraYaw: number;
  cameraPitch: number;
  cameraDistance: number;
  cameraPanX?: number;
  cameraPanY?: number;
}

export const SPATIAL_LENS_OPTIONS = [
  { mm: 24, label: '24mm 广角' },
  { mm: 35, label: '35mm 电影' },
  { mm: 50, label: '50mm 标准' },
  { mm: 85, label: '85mm 特写' },
] as const;

export const SPATIAL_RENDER_PASS_OPTIONS: { id: SpatialRenderPass; label: string; short: string }[] = [
  { id: 'beauty', label: '成片渲染', short: '成片' },
  { id: 'clay', label: '导演白模 (Clay)', short: '白模' },
  { id: 'depth', label: '深度图 (Depth)', short: '深度' },
  { id: 'normal', label: '法线图 (Normal)', short: '法线' },
  { id: 'wireframe', label: '结构线框', short: '线框' },
];

export const DEFAULT_SPATIAL_BOOKMARKS: SpatialCameraBookmark[] = [
  {
    id: 'cam-a',
    shortKey: 'A',
    label: 'A · 主镜推进',
    cameraPreset: 'dolly-in',
    cameraLens: 35,
    cameraYaw: 0,
    cameraPitch: -2,
    cameraDistance: 1.0,
    cameraPanX: 0,
    cameraPanY: 0,
  },
  {
    id: 'cam-b',
    shortKey: 'B',
    label: 'B · 过肩反打',
    cameraPreset: 'pan-sweep',
    cameraLens: 85,
    cameraYaw: -28,
    cameraPitch: 4,
    cameraDistance: 0.92,
    cameraPanX: 0.12,
    cameraPanY: 0.04,
  },
  {
    id: 'cam-c',
    shortKey: 'C',
    label: 'C · 低位仰拍',
    cameraPreset: 'hero-low',
    cameraLens: 24,
    cameraYaw: 18,
    cameraPitch: -14,
    cameraDistance: 0.95,
    cameraPanX: 0,
    cameraPanY: -0.08,
  },
  {
    id: 'cam-d',
    shortKey: 'D',
    label: 'D · 俯瞰调度',
    cameraPreset: 'top-down',
    cameraLens: 35,
    cameraYaw: 8,
    cameraPitch: 30,
    cameraDistance: 1.15,
    cameraPanX: 0,
    cameraPanY: 0,
  },
];

export const SPLAT_EXTENSIONS = ['.spz', '.splat', '.ksplat', '.ply'] as const;
export const MODEL_3D_EXTENSIONS = ['.glb', '.gltf', ...SPLAT_EXTENSIONS] as const;

export function isSplatAssetPath(filePathOrName?: string | null): boolean {
  if (!filePathOrName) return false;
  const lower = filePathOrName.toLowerCase().split('?')[0];
  return SPLAT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isSpatialClip(clip?: Clip | null, linkedAsset?: Asset | null): boolean {
  if (!clip) return false;
  const pid = String(clip.props?.presetId || '');
  return pid === 'spatial-stage' || pid === 'teardown-3d' || linkedAsset?.kind === 'model-3d';
}

/**
 * Converts 35mm full-frame equivalent focal length (24mm vertical sensor) to vertical FOV in degrees.
 * 24mm -> ~53.1°, 35mm -> ~37.8°, 50mm -> ~27.0°, 85mm -> ~16.1°.
 */
export function lensMmToFov(lensMm: number): number {
  const safeMm = Math.max(14, Math.min(200, Number.isFinite(lensMm) ? lensMm : 35));
  const fovRad = 2 * Math.atan(24 / (2 * safeMm));
  return Number(((fovRad * 180) / Math.PI).toFixed(2));
}

export interface SpatialCameraPoseInput {
  preset: string;
  time: number;
  speed?: number;
  isPortrait?: boolean;
  is25D?: boolean;
  lensMm?: number;
  yaw?: number;
  pitch?: number;
  distance?: number;
  panX?: number;
  panY?: number;
}

export interface SpatialCameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

/**
 * Deterministic director camera solver shared by SpatialStage renderer and unit tests.
 * Supports true Hitchcock Dolly-Zoom (coupled distance + FOV keeping focal plane scale constant).
 */
export function computeSpatialCameraPose(input: SpatialCameraPoseInput): SpatialCameraPose {
  const t = Math.max(0, Number.isFinite(input.time) ? input.time : 0);
  const spd = Math.max(0, Number.isFinite(input.speed) ? Number(input.speed) : 1);
  const isPortrait = Boolean(input.isPortrait);
  const is25D = Boolean(input.is25D);
  const baseLens = Math.max(16, Math.min(135, Number.isFinite(input.lensMm) ? Number(input.lensMm) : 35));
  const rawDist = Number.isFinite(input.distance) ? Number(input.distance) : 1;
  // Support canonical multiplier (0.35..3.0); seamlessly remap legacy absolute distances (> 3.2, e.g. 5.4 -> 1.0)
  const normalizedDist = rawDist > 3.2 ? rawDist / 5.4 : rawDist;
  const distMul = Math.max(0.35, Math.min(3.0, normalizedDist));
  const panX = Number.isFinite(input.panX) ? Number(input.panX) : 0;
  const panY = Number.isFinite(input.panY) ? Number(input.panY) : 0;
  const yawDeg = Number.isFinite(input.yaw) ? Number(input.yaw) : 0;
  const pitchDeg = Number.isFinite(input.pitch) ? Number(input.pitch) : 0;

  let fov = lensMmToFov(baseLens);
  const aspectScale = isPortrait ? (is25D ? 1.16 : 1.36) : 1.0;

  // Base camera offset around target before spherical yaw/pitch offsets
  let x = 0;
  let y = is25D ? 0.08 : 1.65;
  let z = is25D ? 5.2 : 6.0;

  if (is25D) {
    // 2.5D layered artwork keeps the camera facing the depth stack so planes never flip edge-on
    const progress = 1 - Math.exp(-t * 0.38 * Math.max(0.25, spd));
    if (input.preset === 'dolly-zoom') {
      // Hitchcock Vertigo effect: push camera in while widening FOV so Z=0 plane keeps identical apparent size!
      const baseFovRad = (fov * Math.PI) / 180;
      const baseHalfH = Math.tan(baseFovRad / 2) * 5.2;
      const zTravel = 5.2 - progress * 1.9;
      const nextFovRad = 2 * Math.atan(baseHalfH / Math.max(2.1, zTravel));
      fov = Math.max(15, Math.min(82, (nextFovRad * 180) / Math.PI));
      x = Math.sin(t * 0.35 * spd) * 0.25;
      y = 0.05;
      z = zTravel;
    } else if (input.preset === 'orbit') {
      const sway = Math.sin(t * 0.65 * spd) * 0.42;
      x = Math.sin(sway) * 5.0;
      y = 0.14 + Math.sin(t * 0.4 * spd) * 0.18;
      z = Math.cos(sway) * 5.0;
    } else if (input.preset === 'crane-up') {
      x = Math.sin(t * 0.3 * spd) * 0.35;
      y = -0.45 + progress * 1.05;
      z = 5.2 - progress * 0.45;
    } else if (input.preset === 'pan-sweep') {
      x = -0.75 + progress * 1.5;
      y = 0.06;
      z = 4.95;
    } else if (input.preset === 'hero-low') {
      x = Math.sin(t * 0.3 * spd) * 0.3;
      y = -0.72 + progress * 0.2;
      z = 4.85 - progress * 0.45;
    } else if (input.preset === 'top-down') {
      x = Math.sin(t * 0.3 * spd) * 0.25;
      y = 1.45;
      z = 4.7;
    } else if (input.preset === 'isometric') {
      x = 1.1 + Math.sin(t * 0.4 * spd) * 0.25;
      y = 0.85;
      z = 4.9;
    } else if (input.preset === 'static') {
      x = 0;
      y = 0;
      z = 5.0;
    } else {
      // 'dolly-in' default: subtle cinematic forward glide + gentle parallax arc
      x = Math.sin(t * 0.45 * spd) * 0.38;
      y = Math.cos(t * 0.32 * spd) * 0.1;
      z = 5.45 - progress * 1.15;
    }
  } else {
    // Full 360° 3D spatial choreography
    if (input.preset === 'isometric') {
      const sway = Math.sin(t * 0.45 * spd) * 0.35;
      x = 4.6 + sway;
      y = 3.5;
      z = 4.6 - sway;
    } else if (input.preset === 'dolly-in') {
      const zDist = Math.max(3.0, 6.4 - t * 0.52 * spd);
      x = 1.65;
      y = 1.45;
      z = zDist;
    } else if (input.preset === 'dolly-zoom') {
      const progress = Math.min(1, t * 0.28 * spd);
      const baseFovRad = (fov * Math.PI) / 180;
      const baseDist = 6.2;
      const baseHalfH = Math.tan(baseFovRad / 2) * baseDist;
      const nextDist = baseDist - progress * 2.5;
      const nextFovRad = 2 * Math.atan(baseHalfH / Math.max(2.4, nextDist));
      fov = Math.max(14, Math.min(84, (nextFovRad * 180) / Math.PI));
      x = 0.9 * (1 - progress * 0.35);
      y = 1.05;
      z = nextDist;
    } else if (input.preset === 'crane-up') {
      const lift = Math.min(1, t * 0.3 * spd);
      const angle = 0.28 + t * 0.16 * spd;
      x = Math.sin(angle) * 5.6;
      y = 0.55 + lift * 2.9;
      z = Math.cos(angle) * 5.6;
    } else if (input.preset === 'pan-sweep') {
      const angle = -0.32 + Math.min(0.64, t * 0.16 * spd);
      x = Math.sin(angle) * 5.6;
      y = 1.35;
      z = Math.cos(angle) * 5.6;
    } else if (input.preset === 'top-down') {
      const angle = t * 0.28 * spd;
      x = Math.sin(angle) * 1.9;
      y = 6.3;
      z = Math.cos(angle) * 1.9;
    } else if (input.preset === 'hero-low') {
      const angle = -0.4 + t * 0.22 * spd;
      x = Math.sin(angle) * 5.1;
      y = 0.65;
      z = Math.cos(angle) * 5.1;
    } else if (input.preset === 'static') {
      x = 0;
      y = 1.4;
      z = 5.6;
    } else {
      // 'orbit'
      const angle = 0.55 + t * 0.42 * spd;
      x = Math.cos(angle) * 6.2;
      y = 2.25;
      z = Math.sin(angle) * 6.2;
    }
  }

  // Apply lens focal-length framing compensation so switching 24mm <-> 85mm naturally re-frames distance
  const lensRefScale = (35 / baseLens) ** -0.48;
  const totalScale = aspectScale * distMul * lensRefScale;
  x *= totalScale;
  y *= totalScale;
  z *= totalScale;

  // Apply interactive yaw / pitch spherical rotation around target
  if (yawDeg !== 0 || pitchDeg !== 0) {
    const r = Math.hypot(x, y, z) || 1;
    let theta = Math.atan2(x, z);
    let phi = Math.acos(Math.max(-1, Math.min(1, y / r)));
    theta += (yawDeg * Math.PI) / 180;
    phi = Math.max(0.18, Math.min(Math.PI - 0.18, phi + (pitchDeg * Math.PI) / 180));
    x = r * Math.sin(phi) * Math.sin(theta);
    y = r * Math.cos(phi);
    z = r * Math.sin(phi) * Math.cos(theta);
  }

  const target: [number, number, number] = [panX * 2.2, panY * 1.6, 0];
  return {
    position: [
      Number((x + target[0]).toFixed(4)),
      Number((y + target[1]).toFixed(4)),
      Number((z + target[2]).toFixed(4)),
    ],
    target,
    fov: Number(fov.toFixed(2)),
  };
}

export interface DirectorCameraOverrideInput {
  yaw?: number;
  pitch?: number;
  distance?: number;
  panX?: number;
  panY?: number;
  lensMm?: number;
}

/**
 * Pure deterministic spherical director-camera override for arbitrary Three.js scenes (including custom TSX 3D components).
 * At neutral defaults (yaw=0, pitch=0, distance=1, panX=0, panY=0, lensMm=undefined) this is an exact identity transform.
 */
export function computeDirectorCameraOverride(
  basePos: [number, number, number],
  baseTarget: [number, number, number],
  baseFov: number,
  override: DirectorCameraOverrideInput,
): { position: [number, number, number]; target: [number, number, number]; fov: number; changed: boolean } {
  const yawDeg = Number.isFinite(override.yaw) ? Number(override.yaw) : 0;
  const pitchDeg = Number.isFinite(override.pitch) ? Number(override.pitch) : 0;
  const rawDist = Number.isFinite(override.distance) ? Number(override.distance) : 1;
  const distMul = Math.max(0.35, Math.min(3.0, rawDist > 3.2 ? rawDist / 5.4 : rawDist));
  const panX = Number.isFinite(override.panX) ? Number(override.panX) : 0;
  const panY = Number.isFinite(override.panY) ? Number(override.panY) : 0;
  const hasLens = override.lensMm !== undefined && Number.isFinite(override.lensMm) && Number(override.lensMm) > 0;
  const fov = hasLens ? lensMmToFov(Number(override.lensMm)) : baseFov;

  const isIdentityPose =
    Math.abs(yawDeg) < 1e-4 &&
    Math.abs(pitchDeg) < 1e-4 &&
    Math.abs(distMul - 1) < 1e-4 &&
    Math.abs(panX) < 1e-4 &&
    Math.abs(panY) < 1e-4;

  if (isIdentityPose && !hasLens) {
    return {
      position: [...basePos],
      target: [...baseTarget],
      fov: baseFov,
      changed: false,
    };
  }

  let ox = basePos[0] - baseTarget[0];
  let oy = basePos[1] - baseTarget[1];
  let oz = basePos[2] - baseTarget[2];
  const baseRadius = Math.max(0.25, Math.hypot(ox, oy, oz));

  if (!isIdentityPose) {
    const r = baseRadius * distMul;
    let theta = Math.atan2(ox, oz);
    let phi = Math.acos(Math.max(-1, Math.min(1, oy / baseRadius)));
    theta += (yawDeg * Math.PI) / 180;
    phi = Math.max(0.08, Math.min(Math.PI - 0.08, phi + (pitchDeg * Math.PI) / 180));
    ox = r * Math.sin(phi) * Math.sin(theta);
    oy = r * Math.cos(phi);
    oz = r * Math.sin(phi) * Math.cos(theta);
  }

  // Pan along camera's horizontal right axis and world Y, scaled proportionally to scene radius
  const panScale = baseRadius * 0.24;
  const horizLen = Math.hypot(ox, oz);
  const rightX = horizLen > 1e-4 ? oz / horizLen : 1;
  const rightZ = horizLen > 1e-4 ? -ox / horizLen : 0;
  const tx = baseTarget[0] + rightX * panX * panScale;
  const ty = baseTarget[1] + panY * panScale;
  const tz = baseTarget[2] + rightZ * panX * panScale;

  return {
    position: [Number((tx + ox).toFixed(4)), Number((ty + oy).toFixed(4)), Number((tz + oz).toFixed(4))],
    target: [Number(tx.toFixed(4)), Number(ty.toFixed(4)), Number(tz.toFixed(4))],
    fov: Number(fov.toFixed(2)),
    changed: true,
  };
}

/**
 * Perspective scale compensation for a 2.5D plane at depth `planeZ` viewed from `cameraZ`,
 * so all stacked planes share consistent apparent framing at the reference camera position.
 */
export function computeParallaxPlaneScale(cameraZ: number, planeZ: number): number {
  const safeCamZ = Math.max(1.2, cameraZ);
  const dist = Math.max(0.6, safeCamZ - planeZ);
  return Number((dist / safeCamZ).toFixed(4));
}

export interface ParallaxLayerSlot {
  index: number;
  role: 'background' | 'midground' | 'subject' | 'foreground';
  z: number;
  scale: number;
}

/**
 * Computes deterministic Z-depth placement & perspective-compensated scale for 1..4 2D artwork layers.
 */
export function computeParallaxLayerLayout(layerCount: number, depthSpread = 1.0, refCameraZ = 5.0): ParallaxLayerSlot[] {
  const n = Math.max(1, Math.min(4, Math.round(layerCount)));
  const spread = Math.max(0.2, Math.min(2.2, Number.isFinite(depthSpread) ? depthSpread : 1));
  if (n === 1) {
    return [{ index: 0, role: 'subject', z: 0, scale: 1 }];
  }
  const templates: Record<number, { role: ParallaxLayerSlot['role']; z: number }[]> = {
    2: [
      { role: 'background', z: -1.45 * spread },
      { role: 'subject', z: 0.72 * spread },
    ],
    3: [
      { role: 'background', z: -1.85 * spread },
      { role: 'midground', z: -0.2 * spread },
      { role: 'subject', z: 0.95 * spread },
    ],
    4: [
      { role: 'background', z: -2.1 * spread },
      { role: 'midground', z: -0.65 * spread },
      { role: 'subject', z: 0.65 * spread },
      { role: 'foreground', z: 1.55 * spread },
    ],
  };
  return (templates[n] || templates[4]).map((slot, index) => ({
    index,
    role: slot.role,
    z: Number(slot.z.toFixed(3)),
    scale: computeParallaxPlaneScale(refCameraZ, slot.z),
  }));
}

export interface ActorPathState {
  x: number;
  z: number;
  facingYaw: number;
  progress: number;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
}

/**
 * Deterministic 3D actor blocking trajectory solver (supports presets AND explicit Agent start/end coordinates).
 */
export function computeActorPathState(input: {
  path: SpatialActorPath;
  time: number;
  durationSec?: number;
  baseX: number;
  baseZ: number;
  baseYaw: number;
  speed?: number;
  customStart?: [number, number];
  customEnd?: [number, number];
  rivalPos?: [number, number];
}): ActorPathState {
  const dur = Math.max(0.8, Number.isFinite(input.durationSec) ? Number(input.durationSec) : 4.0);
  const spd = Math.max(0, Number.isFinite(input.speed) ? Number(input.speed) : 1);
  const rawU = Math.max(0, Math.min(1, (Math.max(0, input.time) * spd) / dur));
  // Smooth ease-in-out S-curve for natural film blocking acceleration/deceleration
  const u = rawU < 0.5 ? 2 * rawU * rawU : 1 - Math.pow(-2 * rawU + 2, 2) / 2;

  if (input.customStart && input.customEnd) {
    const [sx, sz] = input.customStart;
    const [ex, ez] = input.customEnd;
    const x = sx + (ex - sx) * u;
    const z = sz + (ez - sz) * u;
    const dx = ex - sx;
    const dz = ez - sz;
    const facingYaw = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : input.baseYaw;
    return { x, z, facingYaw, progress: u, startX: sx, startZ: sz, endX: ex, endZ: ez };
  }

  if (input.path === 'circle-rival') {
    const [rx, rz] = input.rivalPos || [0.9, -0.6];
    const radius = 1.95;
    const a0 = Math.PI * 0.85;
    const a1 = Math.PI * 0.28;
    const a = a0 + (a1 - a0) * u;
    const x = rx + Math.cos(a) * radius;
    const z = rz + Math.sin(a) * radius;
    const facingYaw = Math.atan2(rx - x, rz - z);
    return {
      x,
      z,
      facingYaw,
      progress: u,
      startX: rx + Math.cos(a0) * radius,
      startZ: rz + Math.sin(a0) * radius,
      endX: rx + Math.cos(a1) * radius,
      endZ: rz + Math.sin(a1) * radius,
    };
  }

  let sx = input.baseX;
  let sz = input.baseZ;
  let ex = input.baseX;
  let ez = input.baseZ;

  if (input.path === 'approach') {
    sx = input.baseX * 0.7;
    sz = -2.1;
    ex = input.baseX * 0.45;
    ez = 1.45;
  } else if (input.path === 'retreat') {
    sx = input.baseX * 0.45;
    sz = 1.35;
    ex = input.baseX * 0.7;
    ez = -2.0;
  } else if (input.path === 'cross-left-right') {
    sx = -2.35;
    sz = 0.55;
    ex = 2.35;
    ez = 0.25;
  } else if (input.path === 'cross-right-left') {
    sx = 2.35;
    sz = 0.25;
    ex = -2.35;
    ez = 0.55;
  }

  const x = sx + (ex - sx) * u;
  const z = sz + (ez - sz) * u;
  const dx = ex - sx;
  const dz = ez - sz;
  const facingYaw = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : input.baseYaw;
  return { x, z, facingYaw, progress: u, startX: sx, startZ: sz, endX: ex, endZ: ez };
}

export function buildSpatialStageProps(opts: {
  sceneMode?: SpatialSceneMode;
  layerAssetIds?: string[];
  screenAssetId?: string;
  title?: string;
  subtitle?: string;
  cameraPreset?: SpatialCameraPreset;
  cameraLens?: number;
  lookPreset?: SpatialLookPreset;
  particles3D?: SpatialParticles3D;
  blockingPose?: SpatialBlockingPose;
  actorAction?: SpatialActorAction;
  actorPath?: SpatialActorPath;
  environmentPreset?: SpatialEnvironmentPreset;
  deviceType?: SpatialDeviceType;
  showHud?: boolean;
}): Record<string, unknown> {
  const mode = opts.sceneMode || 'parallax-25d';
  const is25D = mode === 'parallax-25d';
  return {
    presetId: 'spatial-stage',
    sceneType: mode,
    text: opts.title ?? (is25D ? '立体空间镜头' : mode === 'previs-blocking' ? '导演白模预演棚' : mode === 'device-showcase' ? '三维产品演示舞台' : '统一空间摄影棚'),
    subtitle: opts.subtitle ?? (is25D ? '2.5D PARALLAX STAGE' : mode === 'previs-blocking' ? 'DIRECTOR PREVIS' : 'SPATIAL STAGE'),
    cameraPreset: opts.cameraPreset ?? (is25D ? 'dolly-in' : mode === 'previs-blocking' ? 'pan-sweep' : 'orbit'),
    cameraLens: opts.cameraLens ?? 35,
    cameraYaw: 0,
    cameraPitch: 0,
    cameraDistance: 1,
    cameraPanX: 0,
    cameraPanY: 0,
    lightingPreset: mode === 'device-showcase' ? 'studio' : mode === 'previs-blocking' ? 'dramatic' : 'studio',
    keyLightYaw: 38,
    keyLightTemp: 5600,
    lookPreset: opts.lookPreset ?? (mode === 'device-showcase' ? 'clean-studio' : 'cinema'),
    renderPass: 'beauty',
    particles3D: opts.particles3D ?? (is25D ? 'dust' : mode === 'previs-blocking' ? 'rain' : 'none'),
    depthStrength: is25D ? 0.65 : 0.4,
    depthSpread: 1.0,
    dofStrength: is25D ? 28 : 18,
    bloomStrength: 24,
    explode: mode === 'turbine' || mode === 'chip-stack' || mode === 'factory-flow' ? 0.6 : 0,
    speed: 1,
    animateExplode: mode === 'turbine' || mode === 'chip-stack' || mode === 'factory-flow',
    animationIndex: 0,
    blockingPose: opts.blockingPose ?? 'standoff',
    actorAction: opts.actorAction ?? 'walk',
    actorPath: opts.actorPath ?? 'approach',
    environmentPreset: opts.environmentPreset ?? 'rooftop-night',
    deviceType: opts.deviceType ?? 'phone',
    showHud: opts.showHud ?? (mode === 'turbine' || mode === 'chip-stack' || mode === 'factory-flow'),
    focusLabel: '',
    accent: '#3b82f6',
    secondary: '#14b8a6',
    surface: 'dark',
    layerAssetIds: opts.layerAssetIds?.length ? opts.layerAssetIds.slice(0, 4) : undefined,
    screenAssetId: opts.screenAssetId || undefined,
    stageObjects: [] as SpatialStageObject[],
    cameraBookmarks: DEFAULT_SPATIAL_BOOKMARKS,
    activeBookmarkId: 'cam-a',
  };
}
