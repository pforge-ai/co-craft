import type { Asset, Clip } from './types';

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
  const distMul = Math.max(0.45, Math.min(2.6, Number.isFinite(input.distance) ? Number(input.distance) : 1));
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
    cameraBookmarks: DEFAULT_SPATIAL_BOOKMARKS,
    activeBookmarkId: 'cam-a',
  };
}
