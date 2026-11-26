import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Box,
  Cable,
  Camera,
  Check,
  CheckCircle2,
  Clapperboard,
  Code2,
  Compass,
  Diamond,
  Film,
  Grid3X3,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Lightbulb,
  Move,
  PanelLeft,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  SkipBack,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  User,
  Video,
  X,
} from 'lucide-react';
import { evaluateKeyframeTrack, removeClipKeyframe, upsertClipKeyframe } from '../core/keyframes';
import { clone, timecode } from '../core/project';
import { pointerDrag } from '../lib/pointerDrag';
import {
  DEFAULT_DIRECTOR_SHOTS,
  SPATIAL_ACTOR_ACTION_OPTIONS,
  SPATIAL_ACTOR_PATH_OPTIONS,
  SPATIAL_DEVICE_OPTIONS,
  SPATIAL_ENVIRONMENT_OPTIONS,
  SPATIAL_LOOK_PRESET_OPTIONS,
  SPATIAL_RENDER_PASS_OPTIONS,
  SPATIAL_SCENE_MODE_OPTIONS,
  SPATIAL_STAGE_OBJECT_LABELS,
  buildMotionShotKeyframes,
  computeStageSceneSignature,
  createDirectorShot,
  createStageObject,
  isSpatialClip,
  isSplatAssetPath,
  kelvinToHex,
  normalizeStageShots,
  shotsToCameraBookmarks,
  type SpatialActorAction,
  type SpatialActorPath,
  type SpatialCameraBookmark,
  type SpatialCameraPoseSpec,
  type SpatialCameraPreset,
  type SpatialDirectorShot,
  type SpatialRenderPass,
  type SpatialShotMode,
  type SpatialStageObject,
  type SpatialStageObjectKind,
} from '../core/spatialStage';
import type {
  Clip,
  ClipKeyframes,
  EditOperation,
  KeyframeProperty,
  Project,
  Sequence,
  Settings,
  VaultItem,
} from '../core/types';
import { StageRadarOverlay } from './StageRadarOverlay';
import { TimelineCurveHeader, TimelineCurveLane } from './TimelineCurveDrawer';
import { DirectorLiveSlider, DirectorScrubInput, DirectorTextField } from './director/DirectorControls';

const QUICK_ANGLE_PRESETS = [
  { id: 'eye', label: '平视', yaw: 0, pitch: 0, distance: 1.0 },
  { id: 'three-quarter', label: '45° 侧拍', yaw: 34, pitch: 12, distance: 1.04 },
  { id: 'low', label: '低仰拍', yaw: 0, pitch: -16, distance: 0.88 },
  { id: 'overhead', label: '俯瞰', yaw: 16, pitch: 38, distance: 1.24 },
] as const;

export type SpatialDirectorTarget =
  | { kind: 'clip'; sequenceId: string; clipId: string }
  | { kind: 'vault'; vaultItemId: string }
  | { kind: 'component'; componentId: string }
  | { kind: 'asset'; assetId: string };

export interface SpatialDirectorStudioProps {
  target: SpatialDirectorTarget;
  returnLabel: string;
  project: Project;
  sequence: Sequence;
  settings: Settings;
  previewOrigin: string;
  onClose: () => void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
  onCaptureReference: (opts: {
    clipId?: string;
    vaultItemId?: string;
    assetId?: string;
    componentId?: string;
    frame?: number;
    passes?: ('beauty' | 'clay' | 'depth' | 'normal' | 'wireframe')[];
  }) => Promise<unknown>;
  onCapturePair: (opts: {
    clipId?: string;
    vaultItemId?: string;
    assetId?: string;
    componentId?: string;
    startBookmarkId?: string;
    endBookmarkId?: string;
  }) => Promise<unknown>;
  onCaptureMultiCam?: (opts: {
    clipId?: string;
    vaultItemId?: string;
    assetId?: string;
    componentId?: string;
    frame?: number;
    cameras: SpatialCameraBookmark[];
    includeDepth?: boolean;
    addToTimeline?: boolean;
    propsOverride?: Record<string, unknown>;
  }) => Promise<unknown>;
  onShootDirectorShots?: (opts: {
    clipId?: string;
    vaultItemId?: string;
    assetId?: string;
    componentId?: string;
    allShots: SpatialDirectorShot[];
    shotIds: string[];
    includeDepthNormal?: boolean;
    motionOutput?: 'video' | 'pair' | 'live-3d';
    addToTimeline?: boolean;
    sceneSignature: string;
    propsOverride?: Record<string, unknown>;
  }) => Promise<unknown>;
  onBakeVideo: (opts: {
    clipId?: string;
    vaultItemId?: string;
    assetId?: string;
    componentId?: string;
    durationSeconds?: number;
    props?: Record<string, unknown>;
  }) => Promise<unknown>;
  onAskAgent: (instruction: string, scopeClip?: Clip) => void;
  onOpenCodeEditor?: (componentId: string) => void;
  onOpenMcpSettings: () => void;
  agentSlot: React.ReactNode;
}

type FrameGuide = 'off' | 'thirds' | 'vertical-safe' | 'scope-239';
type ViewportTool = 'camera' | 'block' | 'path';
type RightSidebarTab = 'shot' | 'scene' | 'agent';
type MotionOutputMode = 'video' | 'pair' | 'live-3d';

const CAMERA_PRESET_OPTIONS: { id: SpatialCameraPreset; label: string }[] = [
  { id: 'static', label: '固定 / 关键帧驱动 (Static)' },
  { id: 'dolly-in', label: '自动推近 (Dolly-In)' },
  { id: 'orbit', label: '自动环绕 (Orbit)' },
  { id: 'pan-sweep', label: '自动横摇 (Pan Sweep)' },
  { id: 'dolly-zoom', label: '希区柯克变焦 (Dolly-Zoom)' },
  { id: 'crane-up', label: '自动摇臂拉升 (Crane-Up)' },
  { id: 'hero-low', label: '低机位仰拍 (Hero Low)' },
  { id: 'isometric', label: '等轴建筑 (Isometric)' },
  { id: 'top-down', label: '上帝俯瞰 (Top-Down)' },
];

const LIGHTING_OPTIONS = [
  { id: 'studio', label: '影棚平衡' },
  { id: 'dramatic', label: '电影明暗' },
  { id: 'soft', label: '柔和漫射' },
];

const PARTICLES_OPTIONS = [
  { id: 'none', label: '无粒子' },
  { id: 'dust', label: '空气尘埃' },
  { id: 'rain', label: '细雨' },
  { id: 'snow', label: '飘雪' },
  { id: 'embers', label: '火星余烬' },
];

const CAMERA_KF_TRACKS: KeyframeProperty[] = [
  'cameraYaw',
  'cameraPitch',
  'cameraDistance',
  'cameraLens',
  'cameraPanX',
  'cameraPanY',
];

const INTERNAL_TSX_DIRECTOR_KEYS = new Set([
  'cameraPreset',
  'cameraYaw',
  'cameraPitch',
  'cameraDistance',
  'cameraPanX',
  'cameraPanY',
  'cameraLens',
  'renderPass',
  'cameraBookmarks',
  'cameraBookmarksJson',
  'activeBookmarkId',
  'stageShots',
  'stageShotsJson',
  'activeShotId',
  '_studioInteractive',
  '_selectedObjectId',
  '_showCameraPath',
]);

function normalizeDistanceVal(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1.0;
  const scaled = n > 3.2 ? n / 5.4 : n;
  return Number(Math.max(0.35, Math.min(3.0, scaled)).toFixed(2));
}

function hasAnyCameraKeyframe(kf?: ClipKeyframes): boolean {
  if (!kf) return false;
  return CAMERA_KF_TRACKS.some((tr) => Array.isArray(kf[tr]) && kf[tr]!.length > 0);
}

export function SpatialDirectorStudio({
  target,
  returnLabel,
  project,
  sequence,
  settings,
  previewOrigin,
  onClose,
  onEdit,
  onCaptureReference,
  onCapturePair,
  onCaptureMultiCam,
  onShootDirectorShots,
  onBakeVideo,
  onAskAgent,
  onOpenCodeEditor,
  onOpenMcpSettings,
  agentSlot,
}: SpatialDirectorStudioProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewportStageRef = useRef<HTMLDivElement>(null);
  const aspectBoxRef = useRef<HTMLDivElement>(null);
  const rulerTrackRef = useRef<HTMLDivElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rightTab, setRightTab] = useState<RightSidebarTab>('shot');
  const [showShotList, setShowShotList] = useState(true);
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('cc-sds-right-width'));
    return Number.isFinite(saved) && saved >= 280 && saved <= 720 ? Math.round(saved) : 344;
  });
  const [frameGuide, setFrameGuide] = useState<FrameGuide>('thirds');
  const [viewportTool, setViewportTool] = useState<ViewportTool>('camera');
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [showRadar, setShowRadar] = useState(false);
  const [showCameraPath, setShowCameraPath] = useState(false);
  const [curveOpen, setCurveOpen] = useState(false);
  const [curveProp, setCurveProp] = useState<KeyframeProperty>('cameraYaw');
  const [curveSelectedFrame, setCurveSelectedFrame] = useState<number | null>(null);
  const [pathStep, setPathStep] = useState<'start' | 'end'>('start');
  const [pendingPathStart, setPendingPathStart] = useState<[number, number] | null>(null);
  const [renamingShotId, setRenamingShotId] = useState<string | null>(null);
  const [renamingShotDraft, setRenamingShotDraft] = useState('');
  const [addCardAssetId, setAddCardAssetId] = useState('');
  const [addGlbAssetId, setAddGlbAssetId] = useState('');
  const [liveStageHud, setLiveStageHud] = useState<string | null>(null);
  const [includeDepthNormal, setIncludeDepthNormal] = useState(false);
  const [motionOutputMode, setMotionOutputMode] = useState<MotionOutputMode>('video');
  const [showHelpTip, setShowHelpTip] = useState(false);
  const [liveSceneProps, setLiveSceneProps] = useState<Record<string, unknown> | null>(null);

  const liveCamRef = useRef<{
    yaw: number;
    pitch: number;
    distance: number;
    panX: number;
    panY: number;
    lens: number;
  } | null>(null);
  const liveCamRafRef = useRef(0);
  const deferredCamCommitRef = useRef<number | null>(null);
  const deferredCamLabelRef = useRef('调整 3D 摄像机');
  const pendingCommitRevRef = useRef<number | null>(null);
  const pendingClearTimerRef = useRef<number | null>(null);

  const resizerCleanupRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      resizerCleanupRef.current?.();
      if (liveCamRafRef.current) cancelAnimationFrame(liveCamRafRef.current);
      if (deferredCamCommitRef.current !== null) window.clearTimeout(deferredCamCommitRef.current);
      if (pendingClearTimerRef.current !== null) window.clearTimeout(pendingClearTimerRef.current);
    },
    [],
  );

  const pendingPickRef = useRef<
    Map<string, (res: { objectId: string | null; floorX: number | null; floorZ: number | null }) => void>
  >(new Map());
  const activeBlockDragRef = useRef<{
    objectId: string;
    latestObjects?: SpatialStageObject[];
    latestHero?: { sx: number; sz: number };
    changed: boolean;
  } | null>(null);

  const handleRightResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidth;
    let latestW = startW;
    const maxW = Math.max(340, Math.min(720, window.innerWidth - 520));
    resizerCleanupRef.current?.();
    resizerCleanupRef.current = pointerDrag(
      e,
      (mx) => {
        latestW = Math.max(280, Math.min(maxW, Math.round(startW - (mx - startX))));
        setRightWidth(latestW);
      },
      () => {
        resizerCleanupRef.current = null;
        localStorage.setItem('cc-sds-right-width', String(latestW));
      },
      'col-resize',
    );
  };

  const [assetPropsLocal, setAssetPropsLocal] = useState<Record<string, unknown>>({
    presetId: 'spatial-stage',
    sceneType: 'previs-blocking',
    environmentPreset: 'rooftop-night',
    lightingPreset: 'dramatic',
    keyLightYaw: 38,
    keyLightTemp: 5600,
    lookPreset: 'cinema',
    renderPass: 'beauty',
    stageObjects: [] as SpatialStageObject[],
    stageShots: DEFAULT_DIRECTOR_SHOTS,
    activeShotId: 'shot-1',
  });

  const [liveHud, setLiveHud] = useState<{
    yaw: number;
    pitch: number;
    distance: number;
    panX: number;
    panY: number;
    lens: number;
  } | null>(null);

  const targetSeq =
    target.kind === 'clip'
      ? project.sequences.find((s) => s.id === target.sequenceId) || sequence
      : sequence;
  const clipObj =
    target.kind === 'clip'
      ? targetSeq.clips.find((c) => c.id === target.clipId)
      : undefined;
  const vaultObj =
    target.kind === 'vault'
      ? (project.vault || []).find((v) => v.id === target.vaultItemId)
      : undefined;
  const compObj =
    target.kind === 'component'
      ? project.components.find((c) => c.id === target.componentId)
      : clipObj?.componentId
        ? project.components.find((c) => c.id === clipObj.componentId)
        : undefined;
  const assetObj =
    target.kind === 'asset'
      ? project.assets.find((a) => a.id === target.assetId)
      : clipObj?.assetId
        ? project.assets.find((a) => a.id === clipObj.assetId)
        : vaultObj?.assetId
          ? project.assets.find((a) => a.id === vaultObj.assetId)
          : undefined;

  const isCodeTarget = Boolean(target.kind === 'component' || clipObj?.kind === 'code');
  const isSpatialStageTarget = Boolean(
    !isCodeTarget &&
      ((clipObj && isSpatialClip(clipObj, assetObj)) ||
        vaultObj?.rig?.presetId === 'spatial-stage' ||
        vaultObj?.rig?.presetId === 'teardown-3d' ||
        assetObj?.kind === 'model-3d'),
  );
  const isSplat = Boolean(assetObj && isSplatAssetPath(assetObj.path));

  const title =
    clipObj?.name ||
    compObj?.name ||
    vaultObj?.name ||
    assetObj?.name ||
    '3D 导演片场';

  const currentProps: Record<string, unknown> = useMemo(() => {
    if (target.kind === 'clip' && clipObj) {
      return isCodeTarget ? { ...(compObj?.props || {}), ...clipObj.props } : { ...clipObj.props };
    }
    if (target.kind === 'vault' && vaultObj) {
      return {
        ...(vaultObj.rig?.props || {}),
        ...(vaultObj.rig?.presetId ? { presetId: vaultObj.rig.presetId } : {}),
      };
    }
    if (target.kind === 'component' && compObj) {
      return { ...(compObj.props || {}) };
    }
    return assetPropsLocal;
  }, [target.kind, clipObj, vaultObj, compObj, isCodeTarget, assetPropsLocal]);

  const currentSceneType = String(currentProps.sceneType || (isCodeTarget ? 'code' : 'previs-blocking'));

  // Default Radar ON automatically when entering a Previs Blocking stage
  const initializedRadarRef = useRef(false);
  useEffect(() => {
    if (!initializedRadarRef.current) {
      initializedRadarRef.current = true;
      if (isSpatialStageTarget && currentSceneType === 'previs-blocking') {
        setShowRadar(true);
      }
    }
  }, [isSpatialStageTarget, currentSceneType]);

  const badgeLabel = isCodeTarget
    ? 'TSX 3D 片场'
    : isSplat
      ? '3DGS 空间世界'
      : currentSceneType === 'parallax-25d'
        ? '2.5D 立体片场'
        : currentSceneType === 'device-showcase'
          ? '3D 硬件片场'
          : '3D 导演片场';

  const fps = targetSeq.fps || 30;

  // 1. Parse persisted Shot List (`stageShots` / `stageShotsJson`, with clean migration from legacy bookmarks)
  const stageShots = useMemo<SpatialDirectorShot[]>(() => {
    let raw: unknown = currentProps.stageShots;
    if (!Array.isArray(raw) && typeof currentProps.stageShotsJson === 'string' && currentProps.stageShotsJson.trim()) {
      try {
        raw = JSON.parse(currentProps.stageShotsJson);
      } catch {}
    }
    return normalizeStageShots(raw, currentProps.cameraBookmarks, isCodeTarget ? 'code' : 'stage');
  }, [currentProps.stageShots, currentProps.stageShotsJson, currentProps.cameraBookmarks, isCodeTarget]);

  const [localActiveShotId, setLocalActiveShotId] = useState<string>(() =>
    String(currentProps.activeShotId || stageShots[0]?.id || 'shot-1'),
  );

  // Keep activeShot synced to valid shot ID
  const activeShot = useMemo<SpatialDirectorShot>(() => {
    return stageShots.find((s) => s.id === localActiveShotId) || stageShots[0];
  }, [stageShots, localActiveShotId]);

  const activeShotRef = useRef(activeShot);
  activeShotRef.current = activeShot;

  // Deterministic signature of the shared Scene / Set layer (environment + lighting + stageObjects)
  const currentSceneSig = useMemo(() => computeStageSceneSignature(currentProps), [currentProps]);

  const staleShots = useMemo(
    () =>
      stageShots.filter(
        (s) => Boolean(s.output?.sceneSignature && s.output.sceneSignature !== currentSceneSig),
      ),
    [stageShots, currentSceneSig],
  );

  const shotBookmarksForRadar = useMemo(() => shotsToCameraBookmarks(stageShots), [stageShots]);

  const stageObjects = useMemo<SpatialStageObject[]>(() => {
    return Array.isArray(currentProps.stageObjects)
      ? (currentProps.stageObjects as SpatialStageObject[]).filter((o) => o && typeof o.id === 'string')
      : [];
  }, [currentProps.stageObjects]);

  const stageObjectsRef = useRef(stageObjects);
  stageObjectsRef.current = stageObjects;

  const selectedStageObj = useMemo(
    () => stageObjects.find((o) => o.id === selectedObjectId) || null,
    [stageObjects, selectedObjectId],
  );

  const isMotionShot = activeShot.mode === 'motion';
  const durationFrames = Math.max(
    fps,
    isMotionShot ? Math.round((activeShot.durationSec || 4) * fps) : Math.max(fps * 2, 60),
  );
  const clampedFrame = isMotionShot ? Math.max(0, Math.min(durationFrames - 1, frame)) : 0;

  const shotHasManualKf = isMotionShot && hasAnyCameraKeyframe(activeShot.keyframes);

  // Resolve current camera values strictly from the active Shot (honoring activeShot.keyframes ONLY in motion mode!)
  const resolvedCam = useMemo(() => {
    const cam = activeShot.camera;
    const evalNum = (track: KeyframeProperty, fallback: number) => {
      if (isMotionShot && activeShot.keyframes?.[track]?.length) {
        return evaluateKeyframeTrack(activeShot.keyframes[track], clampedFrame, fallback);
      }
      return fallback;
    };
    const rawLens = evalNum('cameraLens', isCodeTarget ? (cam.cameraLens || 0) : (cam.cameraLens || 35));
    return {
      yaw: liveHud?.yaw ?? evalNum('cameraYaw', cam.cameraYaw ?? 0),
      pitch: liveHud?.pitch ?? evalNum('cameraPitch', cam.cameraPitch ?? 0),
      distance: liveHud?.distance ?? normalizeDistanceVal(evalNum('cameraDistance', cam.cameraDistance ?? 1.0)),
      panX: liveHud?.panX ?? evalNum('cameraPanX', cam.cameraPanX ?? 0),
      panY: liveHud?.panY ?? evalNum('cameraPanY', cam.cameraPanY ?? 0),
      lens: liveHud?.lens ?? (rawLens > 0 ? rawLens : 35),
      hasExplicitLens: liveHud?.lens !== undefined || rawLens > 0,
    };
  }, [activeShot, isMotionShot, clampedFrame, liveHud, isCodeTarget]);

  const activeRenderPass: SpatialRenderPass = activeShot.renderPass || 'beauty';

  // Build isolated 1-clip synthetic project combining Shared Scene Layer + Active Shot Camera/Motion
  const STUDIO_SEQ_ID = 'seq_spatial_director_studio';
  const STUDIO_CLIP_ID = 'clip_spatial_director_studio';
  const studioProject = useMemo<Project>(() => {
    const base = clone(project);
    // CRITICAL: Still shots AND motion shots with manual keyframes ALWAYS force cameraPreset='static'
    // so preset auto-drift NEVER stacks on top of manual framing or keyframes!
    const effectivePreset: SpatialCameraPreset =
      !isMotionShot || shotHasManualKf ? 'static' : activeShot.camera.cameraPreset || 'dolly-in';
    const clipProps: Record<string, unknown> = {
      ...currentProps,
      cameraPreset: effectivePreset,
      cameraLens: activeShot.camera.cameraLens,
      cameraYaw: activeShot.camera.cameraYaw,
      cameraPitch: activeShot.camera.cameraPitch,
      cameraDistance: activeShot.camera.cameraDistance,
      cameraPanX: activeShot.camera.cameraPanX ?? 0,
      cameraPanY: activeShot.camera.cameraPanY ?? 0,
      renderPass: activeRenderPass,
      ...(activeShot.actorAction ? { actorAction: activeShot.actorAction } : {}),
      ...(activeShot.actorPath ? { actorPath: activeShot.actorPath } : {}),
      ...(isCodeTarget ? {} : { showHud: false }),
      _studioInteractive: true,
      _selectedObjectId: selectedObjectId,
      _showCameraPath: showCameraPath,
      cameraBookmarks: shotBookmarksForRadar,
    };
    const syntheticClip: Clip = {
      id: STUDIO_CLIP_ID,
      name: `${activeShot.shortKey} · ${activeShot.name}`,
      kind: isCodeTarget ? 'code' : clipObj ? clipObj.kind : 'shape',
      track: 'visual',
      layer: 0,
      start: 0,
      duration: durationFrames,
      sourceIn: clipObj?.sourceIn || 0,
      assetId: isCodeTarget ? undefined : clipObj?.assetId || assetObj?.id || vaultObj?.assetId,
      componentId: isCodeTarget ? (compObj?.id || clipObj?.componentId) : undefined,
      locked: false,
      keyframes: isMotionShot && activeShot.keyframes ? clone(activeShot.keyframes) : undefined,
      props: clipProps,
    };
    base.sequences = [
      {
        ...targetSeq,
        id: STUDIO_SEQ_ID,
        name: title,
        clips: [syntheticClip],
      },
    ];
    return base;
  }, [
    project,
    targetSeq,
    title,
    isCodeTarget,
    clipObj,
    assetObj,
    vaultObj,
    compObj,
    currentProps,
    activeShot,
    activeRenderPass,
    isMotionShot,
    shotHasManualKf,
    durationFrames,
    selectedObjectId,
    showCameraPath,
    shotBookmarksForRadar,
  ]);

  const targetOrigin = previewOrigin ? new URL(previewOrigin).origin : '*';
  const postToStage = useCallback(
    (type: string, more: Record<string, unknown> = {}) => {
      const msg = { source: 'cocraft-workbench', type, ...more };
      if (portRef.current) {
        portRef.current.postMessage(msg);
      } else {
        iframeRef.current?.contentWindow?.postMessage(msg, targetOrigin);
      }
    },
    [targetOrigin],
  );

  // Handshake private MessageChannel with the studio's dedicated preview iframe
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.source !== 'cocraft-preview') return;
      if (e.data.event === 'ready') {
        const ch = new MessageChannel();
        if (portRef.current) {
          portRef.current.onmessage = null;
          portRef.current.close();
        }
        portRef.current = ch.port1;
        ch.port1.onmessage = (pe) => {
          const d = pe.data;
          if (!d || d.source !== 'cocraft-preview') return;
          if (d.event === 'frame' && typeof d.frame === 'number') {
            setFrame(d.frame);
          }
          if (d.event === 'play') setPlaying(true);
          if (d.event === 'pause' || d.event === 'ended') setPlaying(false);
          if (d.event === 'stage-event') {
            const reqId = typeof d.requestId === 'string' ? d.requestId : '';
            const resolver = reqId ? pendingPickRef.current.get(reqId) : undefined;
            if (resolver) {
              pendingPickRef.current.delete(reqId);
              resolver({
                objectId: typeof d.objectId === 'string' ? d.objectId : null,
                floorX: typeof d.floorX === 'number' ? d.floorX : null,
                floorZ: typeof d.floorZ === 'number' ? d.floorZ : null,
              });
            }
          }
        };
        ch.port1.start();
        iframeRef.current?.contentWindow?.postMessage(
          { source: 'cocraft-workbench', type: 'init-channel' },
          targetOrigin,
          [ch.port2],
        );
        setIframeReady(true);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (portRef.current) {
        portRef.current.onmessage = null;
        portRef.current.close();
        portRef.current = null;
      }
    };
  }, [targetOrigin]);

  const previewLivePatch = useCallback(
    (patch: Record<string, unknown>) => {
      postToStage('live-transform', {
        override: { clipId: STUDIO_CLIP_ID, props: patch },
        skipMeasure: true,
      });
    },
    [postToStage],
  );

  const cancelDeferredCamCommit = useCallback(() => {
    if (deferredCamCommitRef.current !== null) {
      window.clearTimeout(deferredCamCommitRef.current);
      deferredCamCommitRef.current = null;
    }
    if (liveCamRafRef.current) {
      cancelAnimationFrame(liveCamRafRef.current);
      liveCamRafRef.current = 0;
    }
  }, []);

  const markPendingCommit = useCallback(() => {
    if (pendingClearTimerRef.current !== null) {
      window.clearTimeout(pendingClearTimerRef.current);
      pendingClearTimerRef.current = null;
    }
    if (target.kind === 'asset') {
      // Asset target updates React state synchronously — let load effect hand over cleanly next frame
      pendingCommitRevRef.current = -1;
    } else {
      pendingCommitRevRef.current = project.revision;
    }
    // Safety net in case an edit was a no-op or rejected by IPC
    pendingClearTimerRef.current = window.setTimeout(() => {
      pendingClearTimerRef.current = null;
      pendingCommitRevRef.current = null;
      liveCamRef.current = null;
      setLiveHud(null);
      setLiveSceneProps(null);
      postToStage('live-transform', { override: null, skipMeasure: true });
    }, 520);
  }, [target.kind, project.revision, postToStage]);

  const pushLiveCamera = useCallback(
    (next: { yaw: number; pitch: number; distance: number; panX: number; panY: number; lens: number }) => {
      liveCamRef.current = next;
      if (!liveCamRafRef.current) {
        liveCamRafRef.current = requestAnimationFrame(() => {
          liveCamRafRef.current = 0;
          const cur = liveCamRef.current;
          if (!cur) return;
          setLiveHud(cur);
          previewLivePatch({
            cameraYaw: cur.yaw,
            cameraPitch: cur.pitch,
            cameraDistance: cur.distance,
            cameraPanX: cur.panX,
            cameraPanY: cur.panY,
            ...(cur.lens > 0 ? { cameraLens: cur.lens } : {}),
          });
        });
      }
    },
    [previewLivePatch],
  );

  const pushLiveSceneProp = useCallback(
    (patch: Record<string, unknown>) => {
      setLiveSceneProps((prev) => ({ ...(prev || {}), ...patch }));
      previewLivePatch(patch);
    },
    [previewLivePatch],
  );

  // Push synthetic 3D project into studio iframe whenever scene/shot/keyframes change
  useEffect(() => {
    if (!iframeReady) return;
    postToStage('load', {
      props: { project: studioProject, sequenceId: STUDIO_SEQ_ID, mediaOrigin: previewOrigin },
      frame: clampedFrame,
    });
    // Zero-snap-back handover: clear live draft ONLY once the committed revision has been pushed to iframe!
    const awaiting = pendingCommitRevRef.current;
    if (awaiting !== null && (awaiting === -1 || project.revision > awaiting)) {
      pendingCommitRevRef.current = null;
      if (pendingClearTimerRef.current !== null) {
        window.clearTimeout(pendingClearTimerRef.current);
        pendingClearTimerRef.current = null;
      }
      liveCamRef.current = null;
      setLiveHud(null);
      setLiveSceneProps(null);
    }
  }, [iframeReady, studioProject, previewOrigin, postToStage, project.revision]);

  const seekTo = useCallback(
    (nextFrame: number) => {
      const f = Math.max(0, Math.min(durationFrames - 1, Math.round(nextFrame)));
      setFrame(f);
      postToStage('seek', { frame: f });
    },
    [durationFrames, postToStage],
  );

  const togglePlay = useCallback(() => {
    if (!isMotionShot) return;
    if (playing) {
      postToStage('pause');
      setPlaying(false);
    } else {
      if (clampedFrame >= durationFrames - 2) seekTo(0);
      postToStage('play');
      setPlaying(true);
    }
  }, [isMotionShot, playing, clampedFrame, durationFrames, postToStage, seekTo]);

  // Switch active shot cleanly (auto-pauses and resets playhead to f0 on still shots!)
  const selectShot = useCallback(
    (shotId: string) => {
      const next = stageShots.find((s) => s.id === shotId);
      if (!next) return;
      cancelDeferredCamCommit();
      pendingCommitRevRef.current = null;
      if (pendingClearTimerRef.current !== null) {
        window.clearTimeout(pendingClearTimerRef.current);
        pendingClearTimerRef.current = null;
      }
      liveCamRef.current = null;
      setLiveHud(null);
      setLiveSceneProps(null);
      postToStage('live-transform', { override: null, skipMeasure: true });
      setLocalActiveShotId(next.id);
      setCurveSelectedFrame(null);
      if (next.mode === 'still') {
        postToStage('pause');
        setPlaying(false);
        setFrame(0);
        setCurveOpen(false);
      } else {
        setFrame(0);
        postToStage('seek', { frame: 0 });
      }
    },
    [stageShots, postToStage, cancelDeferredCamCommit],
  );

  // Persist Scene-layer OR Shot-layer prop patches atomically back to Clip / VaultItem / CodeComponent / Asset
  const commitScenePatch = useCallback(
    (label: string, patch: Record<string, unknown>) => {
      if (target.kind === 'clip' && clipObj) {
        void onEdit(label, [
          {
            type: 'updateClip',
            sequenceId: targetSeq.id,
            clipId: clipObj.id,
            changes: { props: patch },
          },
        ]);
        return;
      }
      if (target.kind === 'vault' && vaultObj) {
        const nextItem: VaultItem = {
          ...vaultObj,
          rig: {
            ...(vaultObj.rig || { presetId: 'spatial-stage' }),
            props: { ...(vaultObj.rig?.props || {}), ...patch },
          },
          updatedAt: new Date().toISOString(),
        };
        void onEdit(label, [{ type: 'putVaultItem', item: nextItem }]);
        return;
      }
      if (target.kind === 'component' && compObj) {
        const nextProps: Record<string, string | number | boolean> = { ...(compObj.props || {}) };
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'stageShots' && Array.isArray(v)) {
            nextProps.stageShotsJson = JSON.stringify(v);
          } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            nextProps[k] = v;
          }
        }
        void onEdit(label, [{ type: 'putComponent', component: { ...compObj, props: nextProps } }]);
        return;
      }
      setAssetPropsLocal((prev) => ({ ...prev, ...patch }));
    },
    [target.kind, clipObj, targetSeq.id, vaultObj, compObj, onEdit],
  );

  // Persist updated Shot List + mirror active shot's camera onto clip props so timeline thumbnails stay in sync
  const commitStageShots = useCallback(
    (label: string, nextShots: SpatialDirectorShot[], nextActiveId?: string) => {
      const activeId = nextActiveId || activeShotRef.current.id;
      const cur = nextShots.find((s) => s.id === activeId) || nextShots[0];
      const patch: Record<string, unknown> = {
        stageShots: nextShots,
        activeShotId: cur.id,
        cameraPreset: cur.mode === 'still' || hasAnyCameraKeyframe(cur.keyframes) ? 'static' : cur.camera.cameraPreset,
        cameraLens: cur.camera.cameraLens,
        cameraYaw: cur.camera.cameraYaw,
        cameraPitch: cur.camera.cameraPitch,
        cameraDistance: cur.camera.cameraDistance,
        cameraPanX: cur.camera.cameraPanX ?? 0,
        cameraPanY: cur.camera.cameraPanY ?? 0,
        renderPass: cur.renderPass || 'beauty',
      };
      if (nextActiveId) setLocalActiveShotId(cur.id);
      commitScenePatch(label, patch);
    },
    [commitScenePatch],
  );

  // Update the active Shot's camera (and active frame keyframe if this is a keyframed motion shot!)
  const updateActiveShotCamera = useCallback(
    (label: string, camPatch: Partial<SpatialCameraPoseSpec>, alsoUpdateKeyframes = true) => {
      const cur = activeShotRef.current;
      const nextCam: SpatialCameraPoseSpec = { ...cur.camera, ...camPatch };
      let nextKf = cur.keyframes;
      if (cur.mode === 'motion' && alsoUpdateKeyframes && cur.keyframes) {
        for (const tr of CAMERA_KF_TRACKS) {
          const val = (camPatch as Record<string, unknown>)[tr];
          if (val !== undefined && cur.keyframes[tr]?.length) {
            nextKf = upsertClipKeyframe(nextKf, tr, clampedFrame, Number(val), 'ease-in-out');
          }
        }
      }
      const nextShots = stageShots.map((s) =>
        s.id === cur.id ? { ...s, camera: nextCam, keyframes: nextKf } : s,
      );
      commitStageShots(label, nextShots);
    },
    [stageShots, clampedFrame, commitStageShots],
  );

  // Smooth 60fps wheel & keyboard flight: updates live WebGL every frame, persists ONCE after pause!
  const updateActiveShotCameraRef = useRef(updateActiveShotCamera);
  updateActiveShotCameraRef.current = updateActiveShotCamera;
  const resolvedCamRef = useRef(resolvedCam);
  resolvedCamRef.current = resolvedCam;

  const scheduleDeferredCamCommit = useCallback(
    (
      label: string,
      mutate: (base: { yaw: number; pitch: number; distance: number; panX: number; panY: number; lens: number }) => {
        yaw: number;
        pitch: number;
        distance: number;
        panX: number;
        panY: number;
        lens: number;
      },
      delayMs = 200,
    ) => {
      const base = liveCamRef.current || {
        yaw: resolvedCamRef.current.yaw,
        pitch: resolvedCamRef.current.pitch,
        distance: resolvedCamRef.current.distance,
        panX: resolvedCamRef.current.panX,
        panY: resolvedCamRef.current.panY,
        lens: resolvedCamRef.current.lens,
      };
      const next = mutate(base);
      deferredCamLabelRef.current = label;
      pushLiveCamera(next);
      if (deferredCamCommitRef.current !== null) {
        window.clearTimeout(deferredCamCommitRef.current);
      }
      deferredCamCommitRef.current = window.setTimeout(() => {
        deferredCamCommitRef.current = null;
        const finalCam = liveCamRef.current;
        if (!finalCam) return;
        markPendingCommit();
        updateActiveShotCameraRef.current(deferredCamLabelRef.current, {
          cameraYaw: finalCam.yaw,
          cameraPitch: finalCam.pitch,
          cameraDistance: finalCam.distance,
          cameraPanX: finalCam.panX,
          cameraPanY: finalCam.panY,
          ...(finalCam.lens > 0 ? { cameraLens: finalCam.lens } : {}),
        });
      }, delayMs);
    },
    [pushLiveCamera, markPendingCommit],
  );

  const updateActiveShot = useCallback(
    (label: string, changes: Partial<SpatialDirectorShot>) => {
      const cur = activeShotRef.current;
      const nextShots = stageShots.map((s) => (s.id === cur.id ? { ...s, ...changes } : s));
      commitStageShots(label, nextShots);
    },
    [stageShots, commitStageShots],
  );

  const setActiveShotMode = useCallback(
    (nextMode: SpatialShotMode) => {
      const cur = activeShotRef.current;
      if (cur.mode === nextMode) return;
      if (nextMode === 'still') {
        postToStage('pause');
        setPlaying(false);
        setFrame(0);
        setCurveOpen(false);
        updateActiveShot(`切换「${cur.name}」为静态定机位`, {
          mode: 'still',
          camera: { ...cur.camera, cameraPreset: 'static' },
        });
      } else {
        const durSec = cur.durationSec || 4;
        const startCam: SpatialCameraPoseSpec = { ...cur.camera, cameraPreset: 'static' };
        const endCam: SpatialCameraPoseSpec = cur.endCamera || {
          ...startCam,
          cameraYaw: Math.round(startCam.cameraYaw + 24),
          cameraDistance: Number(Math.max(0.45, startCam.cameraDistance * 0.84).toFixed(2)),
        };
        const kf =
          hasAnyCameraKeyframe(cur.keyframes) && cur.keyframes
            ? cur.keyframes
            : buildMotionShotKeyframes(startCam, endCam, durSec * fps);
        updateActiveShot(`切换「${cur.name}」为动态运镜`, {
          mode: 'motion',
          durationSec: durSec,
          camera: startCam,
          endCamera: endCam,
          keyframes: kf,
        });
      }
    },
    [fps, postToStage, updateActiveShot],
  );

  // Motion Shot Keyframe Actions (scoped cleanly to activeShot.keyframes!)
  const dropMotionKeyframeAt = useCallback(
    (targetFrame: number, labelPrefix?: string) => {
      const cur = activeShotRef.current;
      if (cur.mode !== 'motion') return;
      let nextKf = cur.keyframes;
      nextKf = upsertClipKeyframe(nextKf, 'cameraYaw', targetFrame, resolvedCam.yaw, 'ease-in-out');
      nextKf = upsertClipKeyframe(nextKf, 'cameraPitch', targetFrame, resolvedCam.pitch, 'ease-in-out');
      nextKf = upsertClipKeyframe(nextKf, 'cameraDistance', targetFrame, resolvedCam.distance, 'ease-in-out');
      nextKf = upsertClipKeyframe(nextKf, 'cameraLens', targetFrame, resolvedCam.lens, 'ease-in-out');
      nextKf = upsertClipKeyframe(nextKf, 'cameraPanX', targetFrame, resolvedCam.panX, 'ease-in-out');
      nextKf = upsertClipKeyframe(nextKf, 'cameraPanY', targetFrame, resolvedCam.panY, 'ease-in-out');
      updateActiveShot(labelPrefix || `在 F${targetFrame} 记录机位关键帧`, {
        keyframes: nextKf,
        camera: { ...cur.camera, cameraPreset: 'static' },
      });
    },
    [resolvedCam, updateActiveShot],
  );

  const deleteMotionKeyframeAtPlayhead = useCallback(() => {
    const cur = activeShotRef.current;
    if (cur.mode !== 'motion' || !cur.keyframes) return;
    let nextKf: ClipKeyframes | undefined = cur.keyframes;
    for (const tr of CAMERA_KF_TRACKS) {
      nextKf = removeClipKeyframe(nextKf, tr, clampedFrame);
    }
    updateActiveShot(`删除 F${clampedFrame} 机位关键帧`, { keyframes: nextKf });
  }, [clampedFrame, updateActiveShot]);

  const cameraKeyframeFrames = useMemo(() => {
    if (!isMotionShot || !activeShot.keyframes) return [] as number[];
    const set = new Set<number>();
    for (const tr of CAMERA_KF_TRACKS) {
      for (const kf of activeShot.keyframes[tr] || []) set.add(kf.frame);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [isMotionShot, activeShot.keyframes]);

  const hasCameraKfAtPlayhead = cameraKeyframeFrames.includes(clampedFrame);

  // Shot List CRUD
  const handleAddShot = (mode: SpatialShotMode) => {
    const newShot = createDirectorShot(
      mode,
      stageShots,
      {
        cameraLens: Math.round(resolvedCam.lens),
        cameraYaw: Math.round(resolvedCam.yaw),
        cameraPitch: Math.round(resolvedCam.pitch),
        cameraDistance: resolvedCam.distance,
        cameraPanX: resolvedCam.panX,
        cameraPanY: resolvedCam.panY,
      },
      fps,
    );
    const nextShots = [...stageShots, newShot];
    commitStageShots(`新增${mode === 'motion' ? '动态运镜' : '静态机位'}「${newShot.name}」`, nextShots, newShot.id);
    if (mode === 'still') {
      postToStage('pause');
      setPlaying(false);
      setFrame(0);
      setCurveOpen(false);
    }
  };

  const handleDeleteShot = (shotId: string) => {
    if (stageShots.length <= 1) return;
    const nextShots = stageShots.filter((s) => s.id !== shotId);
    const nextId = activeShot.id === shotId ? nextShots[0].id : activeShot.id;
    commitStageShots('删除镜头', nextShots, nextId);
  };

  const handleRenameShotCommit = (shotId: string) => {
    const clean = renamingShotDraft.trim();
    setRenamingShotId(null);
    if (!clean) return;
    const nextShots = stageShots.map((s) => (s.id === shotId ? { ...s, name: clean } : s));
    commitStageShots(`重命名镜头为「${clean}」`, nextShots);
  };

  // Composable Scene Graph CRUD (Shared Scene Layer)
  const addStageObject = (kind: SpatialStageObjectKind, opts?: { assetId?: string; name?: string }) => {
    const obj = createStageObject(kind, stageObjects, opts);
    const nextList = [...stageObjects, obj];
    setSelectedObjectId(obj.id);
    setRightTab('scene');
    commitScenePatch(`舞台添加「${obj.name}」`, { stageObjects: nextList });
  };

  const updateStageObject = (objId: string, changes: Partial<SpatialStageObject>, label = '调整舞台物体') => {
    const nextList = stageObjects.map((o) => (o.id === objId ? { ...o, ...changes } : o));
    commitScenePatch(label, { stageObjects: nextList });
  };

  const deleteStageObject = (objId: string) => {
    const targetObj = stageObjects.find((o) => o.id === objId);
    const nextList = stageObjects.filter((o) => o.id !== objId);
    if (selectedObjectId === objId) setSelectedObjectId(null);
    commitScenePatch(`移除舞台物体「${targetObj?.name || ''}」`, { stageObjects: nextList });
  };

  const queryStageRaycast = useCallback(
    (action: 'pick' | 'floor', clientX: number, clientY: number) => {
      const box = aspectBoxRef.current?.getBoundingClientRect();
      if (!box || box.width < 10 || box.height < 10) {
        return Promise.resolve({ objectId: null, floorX: null, floorZ: null });
      }
      const nx = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
      const ny = Math.max(0, Math.min(1, (clientY - box.top) / box.height));
      const requestId = `rc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      return new Promise<{ objectId: string | null; floorX: number | null; floorZ: number | null }>((resolve) => {
        const timer = window.setTimeout(() => {
          pendingPickRef.current.delete(requestId);
          resolve({ objectId: null, floorX: null, floorZ: null });
        }, 220);
        pendingPickRef.current.set(requestId, (res) => {
          window.clearTimeout(timer);
          resolve(res);
        });
        postToStage('stage-pointer', { action, nx, ny, requestId });
      });
    },
    [postToStage],
  );

  // Precision Frame Ruler Scrub Handler (1:1 pixel aligned with Bezier curve!)
  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMotionShot || !rulerTrackRef.current) return;
    e.preventDefault();
    const el = rulerTrackRef.current;
    const seekFromClientX = (cx: number) => {
      const rect = el.getBoundingClientRect();
      const norm = Math.max(0, Math.min(1, (cx - rect.left) / Math.max(1, rect.width)));
      seekTo(Math.round(norm * Math.max(1, durationFrames - 1)));
    };
    seekFromClientX(e.clientX);
    const pid = e.pointerId;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      seekFromClientX(ev.clientX);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  // Studio keyboard shortcuts (Space, Arrows, K, V/G/P, WASD/QE, Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (viewportTool !== 'camera') {
          setViewportTool('camera');
          setPendingPathStart(null);
          setPathStep('start');
          setLiveStageHud(null);
          return;
        }
        onClose();
        return;
      }
      if (e.code === 'Space' && isMotionShot) {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === 'ArrowLeft' && isMotionShot) {
        e.preventDefault();
        seekTo(clampedFrame - (e.shiftKey ? 10 : 1));
        return;
      }
      if (e.key === 'ArrowRight' && isMotionShot) {
        e.preventDefault();
        seekTo(clampedFrame + (e.shiftKey ? 10 : 1));
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'k' && isMotionShot) {
        e.preventDefault();
        dropMotionKeyframeAt(clampedFrame);
        return;
      }
      if (isSpatialStageTarget && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (k === 'v') {
          e.preventDefault();
          setViewportTool('camera');
          setLiveStageHud(null);
          return;
        }
        if (k === 'g') {
          e.preventDefault();
          setViewportTool('block');
          setLiveStageHud('摆位模式：点选 3D 物体并在地面拖动移位');
          return;
        }
        if (k === 'p') {
          e.preventDefault();
          setViewportTool('path');
          setPathStep('start');
          setPendingPathStart(null);
          setLiveStageHud('走线模式：点击地面设「起点」');
          return;
        }
      }
      if (viewportTool === 'camera' && ['w', 's', 'a', 'd', 'q', 'e'].includes(k)) {
        e.preventDefault();
        const dollyStep = e.shiftKey ? 0.16 : 0.06;
        const panStep = e.shiftKey ? 0.36 : 0.14;
        if (k === 'w') {
          scheduleDeferredCamCommit('推近镜头', (c) => ({
            ...c,
            distance: Math.max(0.35, Number((c.distance - dollyStep).toFixed(2))),
          }), 220);
        } else if (k === 's') {
          scheduleDeferredCamCommit('拉远镜头', (c) => ({
            ...c,
            distance: Math.min(3.0, Number((c.distance + dollyStep).toFixed(2))),
          }), 220);
        } else if (k === 'a') {
          scheduleDeferredCamCommit('左移机位', (c) => ({
            ...c,
            panX: Math.max(-5, Number((c.panX - panStep).toFixed(2))),
          }), 220);
        } else if (k === 'd') {
          scheduleDeferredCamCommit('右移机位', (c) => ({
            ...c,
            panX: Math.min(5, Number((c.panX + panStep).toFixed(2))),
          }), 220);
        } else if (k === 'e') {
          scheduleDeferredCamCommit('抬升机位', (c) => ({
            ...c,
            panY: Math.min(4, Number((c.panY + panStep).toFixed(2))),
          }), 220);
        } else if (k === 'q') {
          scheduleDeferredCamCommit('压低机位', (c) => ({
            ...c,
            panY: Math.max(-4, Number((c.panY - panStep).toFixed(2))),
          }), 220);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    onClose,
    isMotionShot,
    togglePlay,
    seekTo,
    clampedFrame,
    isSpatialStageTarget,
    viewportTool,
    dropMotionKeyframeAt,
    scheduleDeferredCamCommit,
  ]);

  // Native 3D viewport pointer interaction routed by ViewportTool: camera | block | path
  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (showHelpTip) setShowHelpTip(false);
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    e.preventDefault();

    const forceCamera = e.button === 2 || e.button === 1 || !isSpatialStageTarget || viewportTool === 'camera';

    if (!forceCamera && viewportTool === 'path') {
      void queryStageRaycast('floor', e.clientX, e.clientY).then((hit) => {
        if (hit.floorX === null || hit.floorZ === null) return;
        const selActor = stageObjectsRef.current.find((o) => o.id === selectedObjectId && o.kind === 'actor');
        if (pathStep === 'start') {
          setPendingPathStart([hit.floorX, hit.floorZ]);
          setPathStep('end');
          setLiveStageHud(`走线起点已定 (${hit.floorX.toFixed(1)}, ${hit.floorZ.toFixed(1)}) · 请再点地面设终点`);
          if (selActor) {
            updateStageObject(
              selActor.id,
              { position: [hit.floorX, selActor.position[1], hit.floorZ] },
              `设置「${selActor.name}」走线起点`,
            );
          } else {
            commitScenePatch('设置主角走线起点', { actorStartX: hit.floorX, actorStartZ: hit.floorZ });
          }
        } else {
          const sx = pendingPathStart?.[0] ?? (selActor ? selActor.position[0] : Number(currentProps.actorStartX ?? -1.15));
          const sz = pendingPathStart?.[1] ?? (selActor ? selActor.position[2] : Number(currentProps.actorStartZ ?? 0.95));
          setPathStep('start');
          setPendingPathStart(null);
          setLiveStageHud(null);
          if (selActor) {
            updateStageObject(
              selActor.id,
              {
                position: [sx, selActor.position[1], sz],
                endPosition: [hit.floorX, selActor.position[1], hit.floorZ],
              },
              `绘制「${selActor.name}」走位路径`,
            );
          } else {
            commitScenePatch('绘制主角走位路径', {
              actorStartX: sx,
              actorStartZ: sz,
              actorEndX: hit.floorX,
              actorEndZ: hit.floorZ,
            });
          }
        }
      });
      return;
    }

    if (!forceCamera && viewportTool === 'block') {
      const pointerId = e.pointerId;
      let moveInFlight = false;
      let finished = false;
      activeBlockDragRef.current = null;

      void queryStageRaycast('pick', e.clientX, e.clientY).then((hit) => {
        if (finished) return;
        if (hit.objectId) {
          setSelectedObjectId(hit.objectId);
          if (hit.objectId !== '__hero__' && hit.objectId !== '__rival__') setRightTab('scene');
          activeBlockDragRef.current = { objectId: hit.objectId, changed: false };
          setLiveStageHud('已选中物体 · 拖拽在地面移位');
        } else if (selectedObjectId && hit.floorX !== null && hit.floorZ !== null) {
          const targetObj = stageObjectsRef.current.find((o) => o.id === selectedObjectId);
          if (targetObj) {
            const nextList = stageObjectsRef.current.map((o) =>
              o.id === targetObj.id
                ? { ...o, position: [hit.floorX!, o.position[1], hit.floorZ!] as [number, number, number] }
                : o,
            );
            activeBlockDragRef.current = { objectId: targetObj.id, latestObjects: nextList, changed: true };
            previewLivePatch({ stageObjects: nextList });
            setLiveStageHud(`${targetObj.name} → X:${hit.floorX.toFixed(1)} Z:${hit.floorZ.toFixed(1)}`);
          } else if (selectedObjectId === '__hero__') {
            activeBlockDragRef.current = {
              objectId: '__hero__',
              latestHero: { sx: hit.floorX, sz: hit.floorZ },
              changed: true,
            };
            previewLivePatch({ actorStartX: hit.floorX, actorStartZ: hit.floorZ });
            setLiveStageHud(`主角起点 → X:${hit.floorX.toFixed(1)} Z:${hit.floorZ.toFixed(1)}`);
          }
        }
      });

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId || moveInFlight || !activeBlockDragRef.current) return;
        moveInFlight = true;
        void queryStageRaycast('floor', ev.clientX, ev.clientY).then((hit) => {
          moveInFlight = false;
          const drag = activeBlockDragRef.current;
          if (!drag || finished || hit.floorX === null || hit.floorZ === null) return;
          if (drag.objectId === '__hero__') {
            drag.latestHero = { sx: hit.floorX, sz: hit.floorZ };
            drag.changed = true;
            setLiveStageHud(`主角起点 → X:${hit.floorX.toFixed(1)} Z:${hit.floorZ.toFixed(1)}`);
            previewLivePatch({ actorStartX: hit.floorX, actorStartZ: hit.floorZ });
            return;
          }
          const found = stageObjectsRef.current.find((o) => o.id === drag.objectId);
          if (!found) return;
          const nextList = stageObjectsRef.current.map((o) =>
            o.id === found.id
              ? { ...o, position: [hit.floorX!, o.position[1], hit.floorZ!] as [number, number, number] }
              : o,
          );
          drag.latestObjects = nextList;
          drag.changed = true;
          setLiveStageHud(`${found.name} → X:${hit.floorX.toFixed(1)} Z:${hit.floorZ.toFixed(1)}`);
          previewLivePatch({ stageObjects: nextList });
        });
      };

      const finish = (ev?: PointerEvent) => {
        if (ev && ev.pointerId !== pointerId) return;
        finished = true;
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', finish, true);
        window.removeEventListener('pointercancel', finish, true);
        const drag = activeBlockDragRef.current;
        activeBlockDragRef.current = null;
        setLiveStageHud(null);
        if (drag?.changed) {
          markPendingCommit();
          if (drag.latestObjects) {
            commitScenePatch('3D 视口拖拽物体摆位', { stageObjects: drag.latestObjects });
          } else if (drag.latestHero) {
            commitScenePatch('3D 视口移动主角起点', {
              actorStartX: drag.latestHero.sx,
              actorStartZ: drag.latestHero.sz,
            });
          }
        } else {
          postToStage('live-transform', { override: null, skipMeasure: true });
        }
      };

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', finish, true);
      window.addEventListener('pointercancel', finish, true);
      return;
    }

    // Camera Orbit / Pan mode (60fps live-transform with zero-snap-back commit handover!)
    cancelDeferredCamCommit();
    const isPan = e.button === 2 || e.button === 1 || e.shiftKey;
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    const startCam = liveCamRef.current
      ? { ...liveCamRef.current }
      : {
          yaw: resolvedCam.yaw,
          pitch: resolvedCam.pitch,
          distance: resolvedCam.distance,
          panX: resolvedCam.panX,
          panY: resolvedCam.panY,
          lens: resolvedCam.lens,
        };
    let latest = { ...startCam };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (isPan) {
        latest = {
          ...startCam,
          panX: Math.max(-5, Math.min(5, Number((startCam.panX - dx * 0.008).toFixed(2)))),
          panY: Math.max(-4, Math.min(4, Number((startCam.panY + dy * 0.008).toFixed(2)))),
        };
      } else {
        latest = {
          ...startCam,
          yaw: Math.round((((startCam.yaw + dx * 0.42 + 180) % 360) + 360) % 360 - 180),
          pitch: Math.max(-75, Math.min(82, Math.round(startCam.pitch + dy * 0.34))),
        };
      }
      pushLiveCamera(latest);
    };

    const finish = (ev?: PointerEvent) => {
      if (ev && ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      if (isPan) {
        if (latest.panX !== startCam.panX || latest.panY !== startCam.panY) {
          markPendingCommit();
          updateActiveShotCamera('平移 3D 机位', { cameraPanX: latest.panX, cameraPanY: latest.panY });
        }
      } else if (latest.yaw !== startCam.yaw || latest.pitch !== startCam.pitch) {
        markPendingCommit();
        updateActiveShotCamera('旋转 3D 摄像机视角', { cameraYaw: latest.yaw, cameraPitch: latest.pitch });
      }
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
  };

  // Native non-passive wheel listener: eliminates React passive-wheel preventDefault error & prevents macOS bounce
  useEffect(() => {
    const el = viewportStageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest('.sds-vp-toolbar, .sds-cam-hud, .sds-radar-card')) return;
      e.preventDefault();
      if (e.altKey) {
        const deltaLens = Math.max(-8, Math.min(8, e.deltaY * 0.06));
        scheduleDeferredCamCommit(
          '调整镜头焦段',
          (c) => ({
            ...c,
            lens: Math.max(18, Math.min(120, Math.round(c.lens + deltaLens))),
          }),
          180,
        );
      } else {
        // Smooth proportional dolly: feels silky on both macOS high-DPI trackpads and mouse wheels
        const factor = Math.exp(Math.max(-0.18, Math.min(0.18, e.deltaY * 0.0011)));
        scheduleDeferredCamCommit(
          '推拉机位距离',
          (c) => ({
            ...c,
            distance: Math.max(0.35, Math.min(3.0, Number((c.distance * factor).toFixed(2)))),
          }),
          180,
        );
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scheduleDeferredCamCommit]);

  // Unified Shoot Trigger (1 shot, stale shots, or all shots!)
  const capturePayload = {
    clipId: target.kind === 'clip' ? clipObj?.id : undefined,
    vaultItemId: target.kind === 'vault' ? vaultObj?.id : undefined,
    componentId: target.kind === 'component' ? compObj?.id : undefined,
    assetId: target.kind === 'asset' ? assetObj?.id : undefined,
  };

  const triggerShoot = (shotIds: string[], addToTimeline: boolean) => {
    if (onShootDirectorShots) {
      void onShootDirectorShots({
        ...capturePayload,
        allShots: stageShots,
        shotIds,
        includeDepthNormal,
        motionOutput: motionOutputMode,
        addToTimeline,
        sceneSignature: currentSceneSig,
        ...(target.kind === 'asset' ? { propsOverride: assetPropsLocal } : {}),
      });
      return;
    }
    // Graceful fallback if parent omitted onShootDirectorShots
    if (shotIds.length > 1 && onCaptureMultiCam) {
      void onCaptureMultiCam({
        ...capturePayload,
        frame: clampedFrame,
        cameras: shotBookmarksForRadar,
        includeDepth: includeDepthNormal,
        addToTimeline,
      });
    } else if (activeShot.mode === 'motion') {
      if (motionOutputMode === 'pair') {
        void onCapturePair({ ...capturePayload });
      } else {
        void onBakeVideo({ ...capturePayload, durationSeconds: activeShot.durationSec || 4 });
      }
    } else {
      void onCaptureReference({
        ...capturePayload,
        frame: 0,
        passes: includeDepthNormal ? ['beauty', 'depth', 'normal'] : [activeRenderPass],
      });
    }
  };

  const enabledMcpServers = (settings.mcpServers || []).filter((s) => s.enabled);

  const editableCompProps = useMemo(() => {
    if (!isCodeTarget) return [] as Array<[string, string | number | boolean]>;
    return Object.entries(currentProps).filter(
      ([k, v]) =>
        !INTERNAL_TSX_DIRECTOR_KEYS.has(k) &&
        (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string'),
    ) as Array<[string, string | number | boolean]>;
  }, [isCodeTarget, currentProps]);

  const projectImageAssets = useMemo(
    () => project.assets.filter((a) => a.kind === 'image' && !a.offline),
    [project.assets],
  );
  const project3DAssets = useMemo(
    () => project.assets.filter((a) => a.kind === 'model-3d' && !a.offline),
    [project.assets],
  );

  const keyLightYawVal = Number(currentProps.keyLightYaw ?? 38);
  const keyLightTempVal = Number(currentProps.keyLightTemp ?? 5600);
  const hasCustomActorPath =
    currentProps.actorStartX !== undefined && currentProps.actorEndX !== undefined;

  // Shot-scoped proxy Clip so TimelineCurveHeader & TimelineCurveLane edit `activeShot.keyframes` cleanly
  // (works for Clip, Vault, Component, AND Asset targets with 1:1 pixel alignment!)
  const activeShotCurveClip = useMemo<Clip>(() => {
    return {
      id: activeShot.id,
      name: `${activeShot.shortKey} · ${activeShot.name}`,
      kind: isCodeTarget ? 'code' : 'shape',
      track: 'visual',
      layer: 0,
      start: 0,
      duration: durationFrames,
      sourceIn: 0,
      locked: false,
      keyframes: activeShot.keyframes,
      props: {
        cameraYaw: activeShot.camera.cameraYaw,
        cameraPitch: activeShot.camera.cameraPitch,
        cameraDistance: activeShot.camera.cameraDistance,
        cameraLens: activeShot.camera.cameraLens,
        cameraPanX: activeShot.camera.cameraPanX ?? 0,
        cameraPanY: activeShot.camera.cameraPanY ?? 0,
      },
    };
  }, [activeShot, isCodeTarget, durationFrames]);

  const handleShotCurveEdit = useCallback(
    (label: string, ops: EditOperation[]) => {
      const updateOp = ops.find((op) => op.type === 'updateClip') as
        | { type: 'updateClip'; changes?: { keyframes?: ClipKeyframes } }
        | undefined;
      if (!updateOp?.changes || !('keyframes' in updateOp.changes)) return;
      updateActiveShot(label, {
        keyframes: updateOp.changes.keyframes,
        camera: { ...activeShotRef.current.camera, cameraPreset: 'static' },
      });
    },
    [updateActiveShot],
  );

  const activeShotStale = Boolean(
    activeShot.output?.sceneSignature && activeShot.output.sceneSignature !== currentSceneSig,
  );
  const primaryShootLabel =
    activeShot.mode === 'still'
      ? activeShotStale
        ? '重拍此镜'
        : '拍摄此镜'
      : motionOutputMode === 'pair'
        ? '拍首尾帧'
        : motionOutputMode === 'live-3d'
          ? '实时入轨'
          : activeShotStale
            ? '重录此镜'
            : '录制此镜';

  const rulerTicks = useMemo(() => {
    const secs = Math.max(1, Math.round(durationFrames / Math.max(1, fps)));
    const arr: { pct: number; label: string }[] = [];
    for (let s = 0; s <= secs; s++) {
      arr.push({ pct: (s / secs) * 100, label: `${s}s` });
    }
    return arr;
  }, [durationFrames, fps]);

  const playheadPct = (clampedFrame / Math.max(1, durationFrames - 1)) * 100;

  return (
    <div className="sds-shell" role="dialog" aria-label="3D 导演棚空间调度工作区">
      {/* Top Director Studio Bar — Strictly Single-Row & Context-Aware */}
      <header className="sds-topbar">
        <div className="sds-top-left">
          <button type="button" className="sds-back-btn" onClick={onClose}>
            <ArrowLeft size={14} /> {returnLabel}
          </button>
          <button
            type="button"
            className={`sds-icon-toggle ${showShotList ? 'active' : ''}`}
            title={showShotList ? '收起本场镜头单' : '展开本场镜头单'}
            aria-label="切换镜头单侧栏"
            onClick={() => setShowShotList((v) => !v)}
          >
            <PanelLeft size={13} />
          </button>
          <span className="sds-sep" />
          <Box size={14} className="sds-accent-ico" />
          <b className="sds-title">{title}</b>
          <span className="sds-badge">{badgeLabel}</span>
        </div>

        <div className="sds-top-center">
          <div className="sds-seg" role="group" aria-label="3D 渲染通道">
            {SPATIAL_RENDER_PASS_OPTIONS.map((rp) => {
              const active = activeRenderPass === rp.id;
              return (
                <button
                  key={rp.id}
                  type="button"
                  className={active ? 'active' : ''}
                  title={rp.label}
                  onClick={() => updateActiveShot(`切换通道「${rp.label}」`, { renderPass: rp.id })}
                >
                  {rp.short}
                </button>
              );
            })}
          </div>
          <div className="sds-seg" role="group" aria-label="取景辅助参考线">
            {(
              [
                ['off', '无框'],
                ['thirds', '三分线'],
                ['vertical-safe', '9:16'],
                ['scope-239', '2.39:1'],
              ] as const
            ).map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                className={frameGuide === id ? 'active' : ''}
                onClick={() => setFrameGuide(id)}
              >
                {id === 'thirds' && <Grid3X3 size={11} />}
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="sds-top-right">
          <button
            type="button"
            className={`sds-mcp-pill ${enabledMcpServers.length > 0 ? 'connected' : ''}`}
            title={
              enabledMcpServers.length > 0
                ? `已启用 ${enabledMcpServers.map((s) => s.name).join('、')}，点击管理 MCP 连接配置`
                : '配置外部 MCP 服务连接（JSON）'
            }
            onClick={onOpenMcpSettings}
          >
            <Cable size={12} />
            {enabledMcpServers.length > 0 ? `MCP · ${enabledMcpServers.length}` : 'MCP'}
          </button>
          <span className="sds-sep" />

          {/* Context-aware Shoot Options based on Active Shot Mode */}
          {activeShot.mode === 'still' ? (
            <button
              type="button"
              className={`sds-out-btn ${includeDepthNormal ? 'active-opt' : ''}`}
              title="开启后拍摄定机位镜头时将同步生成 Depth 深度图与 Normal 法线图"
              onClick={() => setIncludeDepthNormal((v) => !v)}
            >
              <Layers size={11} /> +深度/法线
            </button>
          ) : (
            <div className="sds-seg" role="group" aria-label="动态镜头出片方式">
              {(
                [
                  ['video', 'MP4'],
                  ['pair', '首尾帧'],
                  ['live-3d', '实时轨'],
                ] as const
              ).map(([m, lbl]) => (
                <button
                  key={m}
                  type="button"
                  className={motionOutputMode === m ? 'active' : ''}
                  onClick={() => setMotionOutputMode(m)}
                >
                  {lbl}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className="sds-out-btn primary"
            title={
              activeShot.mode === 'still'
                ? `拍摄当前镜头「${activeShot.shortKey} · ${activeShot.name}」为项目素材落入画布`
                : `按所选方式输出当前动态镜头「${activeShot.shortKey} · ${activeShot.name}」`
            }
            onClick={() => triggerShoot([activeShot.id], false)}
          >
            {activeShot.mode === 'still' ? <Camera size={12} /> : <Clapperboard size={12} />} {primaryShootLabel}
          </button>

          <button
            type="button"
            className="sds-out-btn"
            title={`一键按本场镜头单顺序拍摄全部 ${stageShots.length} 个镜头并串联分镜序列`}
            onClick={() => triggerShoot(stageShots.map((s) => s.id), true)}
          >
            <LayoutGrid size={12} /> 拍全部 ({stageShots.length})
          </button>
        </div>
      </header>

      {/* Main 3-Column Studio Body: [ Shot List (调度) | 3D Viewport (+ Motion Rail) | Inspector (镜头 / 布景 / Agent) ] */}
      <div
        className="sds-body"
        style={{
          gridTemplateColumns: showShotList
            ? `208px minmax(0, 1fr) ${rightWidth}px`
            : `minmax(0, 1fr) ${rightWidth}px`,
        }}
      >
        {/* Left Column: 本场镜头单 (Shot List — separates Shots cleanly from Scene Set!) */}
        {showShotList && (
          <aside className="sds-shots-col" aria-label="本场镜头单">
            <div className="sds-shots-head">
              <b>本场镜头单 ({stageShots.length})</b>
              <div className="sds-shots-add-row">
                <button type="button" title="按当前视角新增静态定机位镜头" onClick={() => handleAddShot('still')}>
                  <Camera size={10} /> + 定机位
                </button>
                <button type="button" title="按当前视角新增动态运镜镜头" onClick={() => handleAddShot('motion')}>
                  <Film size={10} /> + 运镜
                </button>
              </div>
            </div>

            <div className="sds-shots-list">
              {stageShots.map((shot) => {
                const isActive = shot.id === activeShot.id;
                const isRenaming = renamingShotId === shot.id;
                const outAsset = shot.output?.primaryAssetId
                  ? project.assets.find((a) => a.id === shot.output?.primaryAssetId)
                  : undefined;
                const isStale = Boolean(
                  shot.output?.sceneSignature && shot.output.sceneSignature !== currentSceneSig,
                );
                const isFresh = Boolean(shot.output && !isStale);

                return (
                  <div
                    key={shot.id}
                    className={`sds-shot-card ${isActive ? 'active' : ''}`}
                    data-shot-id={shot.id}
                    onClick={() => selectShot(shot.id)}
                  >
                    <div className="sds-shot-top">
                      <span className="sds-shot-key">{shot.shortKey}</span>
                      {isRenaming ? (
                        <div className="sds-shot-rename" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            autoFocus
                            value={renamingShotDraft}
                            onChange={(e) => setRenamingShotDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameShotCommit(shot.id);
                              if (e.key === 'Escape') setRenamingShotId(null);
                            }}
                            onBlur={() => handleRenameShotCommit(shot.id)}
                          />
                          <button type="button" onMouseDown={() => handleRenameShotCommit(shot.id)}>
                            <Check size={10} />
                          </button>
                        </div>
                      ) : (
                        <b
                          className="sds-shot-name"
                          title="双击重命名镜头"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setRenamingShotId(shot.id);
                            setRenamingShotDraft(shot.name);
                          }}
                        >
                          {shot.name}
                        </b>
                      )}
                      {stageShots.length > 1 && !isRenaming && (
                        <button
                          type="button"
                          className="sds-shot-del"
                          aria-label={`删除镜头 ${shot.name}`}
                          title="删除此镜头"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteShot(shot.id);
                          }}
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>

                    <div className="sds-shot-meta">
                      <span className={`sds-shot-mode ${shot.mode}`}>
                        {shot.mode === 'motion' ? `运镜 ${shot.durationSec}s` : '定机位'}
                      </span>
                      <span className="sds-shot-lens">{Math.round(shot.camera.cameraLens)}mm</span>
                    </div>

                    {outAsset?.kind === 'image' && previewOrigin && (
                      <div className="sds-shot-thumb">
                        <img src={`${previewOrigin}/media/${encodeURIComponent(outAsset.id)}`} alt={shot.name} />
                      </div>
                    )}

                    <div className="sds-shot-status-row">
                      {isStale ? (
                        <span className="sds-shot-status stale">
                          <AlertCircle size={10} /> 场景已改 · 可重拍
                        </span>
                      ) : isFresh ? (
                        <span className="sds-shot-status fresh">
                          <CheckCircle2 size={10} /> 已出素材
                        </span>
                      ) : (
                        <span className="sds-shot-status idle">未拍摄</span>
                      )}
                      {isStale && (
                        <button
                          type="button"
                          className="sds-shot-reshoot-mini"
                          title="用最新布景重拍此镜头"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerShoot([shot.id], false);
                          }}
                        >
                          <RefreshCw size={9} /> 重拍
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {staleShots.length > 0 && (
              <div className="sds-shots-foot">
                <button
                  type="button"
                  className="sds-reshoot-all-btn"
                  onClick={() => triggerShoot(staleShots.map((s) => s.id), false)}
                >
                  <RefreshCw size={11} /> 重拍变更镜头 ({staleShots.length})
                </button>
              </div>
            )}
          </aside>
        )}

        {/* Center Column: Pure 3D Viewfinder + Conditional Single-Shot Rehearsal Timeline (Motion ONLY!) */}
        <div className="sds-viewport-col">
          <div
            ref={viewportStageRef}
            className={`sds-viewport-stage tool-${viewportTool}`}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={handleViewportPointerDown}
          >
            {/* Floating Darkroom 3D Viewport Tool & Overlay Pill */}
            {isSpatialStageTarget && (
              <div
                className="sds-vp-toolbar"
                onPointerDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              >
                <div className="sds-seg sds-tool-seg" role="group" aria-label="视口交互模式">
                  <button
                    type="button"
                    className={viewportTool === 'camera' ? 'active' : ''}
                    title="摄像机环绕与推拉 (V)"
                    onClick={() => {
                      setViewportTool('camera');
                      setLiveStageHud(null);
                    }}
                  >
                    <Video size={11} /> 摄像机
                  </button>
                  <button
                    type="button"
                    className={viewportTool === 'block' ? 'active' : ''}
                    title="直接点选并在地面拖拽摆位 (G)"
                    onClick={() => {
                      setViewportTool('block');
                      setLiveStageHud('摆位模式：点选 3D 物体并在地面拖动移位');
                    }}
                  >
                    <Move size={11} /> 摆位
                  </button>
                  <button
                    type="button"
                    className={viewportTool === 'path' ? 'active' : ''}
                    title="在 3D 地面依次点击设置演员走位起点与终点 (P)"
                    onClick={() => {
                      setViewportTool('path');
                      setPathStep('start');
                      setPendingPathStart(null);
                      setLiveStageHud('走线模式：点击地面设「起点」');
                    }}
                  >
                    <Route size={11} /> 走线
                  </button>
                </div>
                <div className="sds-seg" role="group" aria-label="导演空间辅图">
                  <button
                    type="button"
                    className={showRadar ? 'active' : ''}
                    title="切换 CineTracer 风格 2D 俯视调度图（拖动物体 / 点机位切镜头）"
                    onClick={() => setShowRadar((v) => !v)}
                  >
                    <Compass size={11} /> 俯视图
                  </button>
                  <button
                    type="button"
                    className={showCameraPath ? 'active' : ''}
                    title="叠加显示本场多机位视锥体与轨迹样条（拍摄时自动隐藏）"
                    onClick={() => setShowCameraPath((v) => !v)}
                  >
                    <Route size={11} /> 轨迹
                  </button>
                </div>
              </div>
            )}

            <div
              ref={aspectBoxRef}
              className="sds-iframe-aspect"
              style={{ aspectRatio: `${targetSeq.width} / ${targetSeq.height}` }}
            >
              <iframe
                ref={iframeRef}
                src={`${previewOrigin}/ui/preview.html`}
                title="3D 导演棚实时视口"
                sandbox="allow-scripts allow-same-origin"
                allow="autoplay"
              />
              {frameGuide !== 'off' && (
                <div className={`sds-guide guide-${frameGuide}`} aria-hidden="true">
                  {frameGuide === 'thirds' && (
                    <>
                      <span className="g-v1" />
                      <span className="g-v2" />
                      <span className="g-h1" />
                      <span className="g-h2" />
                    </>
                  )}
                  {frameGuide === 'vertical-safe' && <span className="g-vert-box" />}
                  {frameGuide === 'scope-239' && (
                    <>
                      <span className="g-letter-top" />
                      <span className="g-letter-bot" />
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Top-Down Stage Radar Overlay synced with Shot List S1..SN */}
            {isSpatialStageTarget && showRadar && (
              <StageRadarOverlay
                sceneType={currentSceneType}
                isPortrait={targetSeq.height > targetSeq.width}
                is25D={currentSceneType === 'parallax-25d'}
                timeSec={clampedFrame / Math.max(1, fps)}
                durationSec={Math.max(1, durationFrames / Math.max(1, fps))}
                cameraPreset={!isMotionShot || shotHasManualKf ? 'static' : activeShot.camera.cameraPreset}
                liveCamera={resolvedCam}
                bookmarks={shotBookmarksForRadar}
                activeBookmarkId={activeShot.id}
                stageObjects={stageObjects}
                selectedObjectId={selectedObjectId}
                actorPath={String(activeShot.actorPath || currentProps.actorPath || 'approach') as SpatialActorPath}
                actorStartX={currentProps.actorStartX !== undefined ? Number(currentProps.actorStartX) : undefined}
                actorStartZ={currentProps.actorStartZ !== undefined ? Number(currentProps.actorStartZ) : undefined}
                actorEndX={currentProps.actorEndX !== undefined ? Number(currentProps.actorEndX) : undefined}
                actorEndZ={currentProps.actorEndZ !== undefined ? Number(currentProps.actorEndZ) : undefined}
                onSelectBookmark={(bm) => selectShot(bm.id)}
                onSelectObject={(id) => {
                  setSelectedObjectId(id);
                  if (id && id !== '__hero__' && id !== '__rival__') setRightTab('scene');
                }}
                onPreviewStagePatch={(patch) => previewLivePatch(patch)}
                onCommitStagePatch={(label, patch) => {
                  markPendingCommit();
                  commitScenePatch(label, patch);
                }}
                onClose={() => setShowRadar(false)}
              />
            )}

            {/* Sleek Single-Row Floating Camera & Tool Telemetry HUD */}
            <div
              className="sds-cam-hud"
              onPointerDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              {liveStageHud ? (
                <span className="sds-live-mode-msg">{liveStageHud}</span>
              ) : (
                <>
                  <span className="sds-cam-readout">
                    <b>{activeShot.shortKey}</b>
                    <span>Yaw {Math.round(resolvedCam.yaw)}°</span>
                    <span>Pitch {Math.round(resolvedCam.pitch)}°</span>
                    <span>{resolvedCam.distance.toFixed(2)}×</span>
                    <span>{resolvedCam.hasExplicitLens ? `${Math.round(resolvedCam.lens)}mm` : '原焦段'}</span>
                  </span>
                  <div className="sds-cam-hud-actions">
                    <div className="sds-help-wrap">
                      <button
                        type="button"
                        className={`sds-hud-icon-btn ${showHelpTip ? 'active' : ''}`}
                        aria-label="视口操作快捷键说明"
                        title="查看 3D 视口操作快捷键"
                        onClick={() => setShowHelpTip((v) => !v)}
                      >
                        <HelpCircle size={12} />
                      </button>
                      {showHelpTip && (
                        <div className="sds-hotkey-popover" role="tooltip">
                          <div><b>左键拖动</b><span>环绕视角</span></div>
                          <div><b>右键 / Shift+拖</b><span>平移机位</span></div>
                          <div><b>滚轮 / 双指</b><span>平滑推拉</span></div>
                          <div><b>Alt + 滚轮</b><span>调节焦段</span></div>
                          <div><b>WASD / QE</b><span>漫游升降</span></div>
                          {isMotionShot && <div><b>Space / K</b><span>播放 / 打关键帧</span></div>}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      title="复位当前镜头摄像机机位"
                      onClick={() => {
                        cancelDeferredCamCommit();
                        markPendingCommit();
                        pushLiveCamera({
                          yaw: 0,
                          pitch: 0,
                          distance: 1.0,
                          panX: 0,
                          panY: 0,
                          lens: isCodeTarget ? 35 : 35,
                        });
                        updateActiveShotCamera('复位当前镜头机位', {
                          cameraYaw: 0,
                          cameraPitch: 0,
                          cameraDistance: 1.0,
                          cameraPanX: 0,
                          cameraPanY: 0,
                          cameraLens: isCodeTarget ? 0 : 35,
                        });
                      }}
                    >
                      <RotateCcw size={11} /> 复位
                    </button>
                    {!isMotionShot && (
                      <button
                        type="button"
                        className="sds-switch-motion-btn"
                        title="把当前镜头切换为带时间轴和曲线的动态运镜"
                        onClick={() => setActiveShotMode('motion')}
                      >
                        <Film size={11} /> 转为动态运镜
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Conditional Bottom Strip: Static Shots stay clean & maximized; Motion Shots get Precision 1:1 Aligned Rehearsal Timeline! */}
          {isMotionShot && (
            <footer className="sds-rail sds-motion-rail" aria-label="动态镜头单镜预演时间轴">
              <div className="sds-rail-top">
                <div className="sds-rail-transport">
                  <button type="button" title="回到镜头开头" onClick={() => seekTo(0)}>
                    <SkipBack size={13} />
                  </button>
                  <button type="button" className="play" title="播放 / 暂停本镜预演 (Space)" onClick={togglePlay}>
                    {playing ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                  <code className="sds-tc">
                    {timecode(clampedFrame, fps)} / {timecode(durationFrames, fps)} · f{clampedFrame}
                  </code>
                </div>

                <div className="sds-rail-actions">
                  <button
                    type="button"
                    className="sds-kf-btn"
                    title="把当前视口机位设为本镜开头起镜姿态 (f0)"
                    onClick={() => dropMotionKeyframeAt(0, `设为「${activeShot.name}」运镜起点`)}
                  >
                    设为起点
                  </button>
                  <button
                    type="button"
                    className="sds-kf-btn"
                    title={`把当前视口机位设为本镜结尾落镜姿态 (f${durationFrames - 1})`}
                    onClick={() => dropMotionKeyframeAt(durationFrames - 1, `设为「${activeShot.name}」运镜终点`)}
                  >
                    设为终点
                  </button>
                  <button
                    type="button"
                    className={`sds-kf-btn ${hasCameraKfAtPlayhead ? 'active' : ''}`}
                    title="在当前帧记录 3D 摄像机姿态关键帧 (快捷键 K)"
                    onClick={() => dropMotionKeyframeAt(clampedFrame)}
                  >
                    <Diamond size={11} /> {hasCameraKfAtPlayhead ? '更新关键帧' : '+ 打点 (K)'}
                  </button>
                  {hasCameraKfAtPlayhead && (
                    <button
                      type="button"
                      className="sds-kf-btn danger"
                      title="删除当前帧关键帧"
                      onClick={deleteMotionKeyframeAtPlayhead}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`sds-kf-btn ${curveOpen ? 'active' : ''}`}
                    title="展开 / 收起 3D 运镜贝塞尔速度曲线编辑器（与上方标尺 1:1 垂直对齐）"
                    onClick={() => setCurveOpen((v) => !v)}
                  >
                    <Activity size={11} /> 曲线
                  </button>
                  <select
                    aria-label="动态镜头时长"
                    className="sds-dur-select"
                    value={String(activeShot.durationSec || 4)}
                    onChange={(e) => {
                      const nextSec = Number(e.target.value) || 4;
                      updateActiveShot(`调整「${activeShot.name}」时长为 ${nextSec}s`, {
                        durationSec: nextSec,
                      });
                    }}
                  >
                    {[2, 3, 4, 5, 8, 10].map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}s
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 1:1 Aligned Precision Frame Ruler Grid (exact same 164px | 1fr split as .sds-curve-drawer!) */}
              <div className="sds-ruler-grid">
                <div className="sds-ruler-head">
                  <span>{activeShot.shortKey} 运镜轴</span>
                  <small>{shotHasManualKf ? '关键帧驱动' : '预设运镜'}</small>
                </div>
                <div
                  ref={rulerTrackRef}
                  className="sds-ruler-track"
                  role="slider"
                  aria-label="单镜运镜预演时间标尺"
                  aria-valuemin={0}
                  aria-valuemax={Math.max(1, durationFrames - 1)}
                  aria-valuenow={clampedFrame}
                  tabIndex={0}
                  onPointerDown={handleRulerPointerDown}
                >
                  {rulerTicks.map((tk) => (
                    <span
                      key={tk.label}
                      className="sds-ruler-tick"
                      style={{ left: `${tk.pct}%` }}
                    >
                      <i>{tk.label}</i>
                    </span>
                  ))}
                  <span className="sds-ruler-rail-line" />
                  <span className="sds-ruler-progress" style={{ width: `${playheadPct}%` }} />
                  {cameraKeyframeFrames.map((kfFrame) => (
                    <button
                      key={kfFrame}
                      type="button"
                      className={`sds-kf-diamond ${kfFrame === clampedFrame ? 'active' : ''}`}
                      style={{ left: `${(kfFrame / Math.max(1, durationFrames - 1)) * 100}%` }}
                      title={`跳转至 F${kfFrame} 机位关键帧`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => seekTo(kfFrame)}
                    />
                  ))}
                  <span className="sds-ruler-needle" style={{ left: `${playheadPct}%` }} />
                </div>
              </div>

              {/* Inline Cubic-Bezier Curve Drawer — 1:1 Pixel-Aligned Under Precision Ruler! */}
              {curveOpen && (
                <div className="sds-curve-drawer" aria-label="3D 摄像机贝塞尔曲线编辑器">
                  <TimelineCurveHeader
                    clip={activeShotCurveClip}
                    sequenceId={targetSeq.id}
                    prop={curveProp}
                    allowedProperties={CAMERA_KF_TRACKS}
                    selectedFrame={curveSelectedFrame}
                    currentFrame={clampedFrame}
                    onChangeProp={setCurveProp}
                    onSelectFrame={setCurveSelectedFrame}
                    onEdit={handleShotCurveEdit}
                    onClose={() => setCurveOpen(false)}
                  />
                  <div className="sds-curve-lane-wrap">
                    <TimelineCurveLane
                      clip={activeShotCurveClip}
                      sequenceId={targetSeq.id}
                      prop={curveProp}
                      totalFrames={activeShotCurveClip.duration}
                      selectedFrame={curveSelectedFrame}
                      onSelectFrame={setCurveSelectedFrame}
                      onSeek={(f) => seekTo(f)}
                      onEndScrub={(f) => seekTo(f)}
                      onEdit={handleShotCurveEdit}
                    />
                  </div>
                </div>
              )}
            </footer>
          )}
        </div>

        {/* Right Resizable Inspector: [ 镜头调度 (Shot) | 布景与物体 (Scene) | Agent ] */}
        <aside className="sds-inspector">
          <div
            className="sds-resizer"
            role="separator"
            aria-label="调整导演棚右侧栏宽度"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuenow={rightWidth}
            title="拖动调整右侧面板宽度（双击恢复默认 344px）"
            onPointerDown={handleRightResize}
            onDoubleClick={() => {
              setRightWidth(344);
              localStorage.setItem('cc-sds-right-width', '344');
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const delta = e.key === 'ArrowLeft' ? 20 : -20;
                const nextW = Math.max(280, Math.min(720, rightWidth + delta));
                setRightWidth(nextW);
                localStorage.setItem('cc-sds-right-width', String(nextW));
              }
            }}
          />

          <div className={`sds-tabs ${isCodeTarget ? 'two-col' : 'three-col'}`}>
            <button
              type="button"
              className={rightTab === 'shot' || (isCodeTarget && rightTab === 'scene') ? 'active' : ''}
              onClick={() => setRightTab('shot')}
            >
              <Camera size={12} /> {isCodeTarget ? '镜头与参数' : '镜头调度'}
            </button>
            {!isCodeTarget && (
              <button
                type="button"
                className={rightTab === 'scene' ? 'active' : ''}
                onClick={() => setRightTab('scene')}
              >
                <SlidersHorizontal size={12} /> 布景{stageObjects.length > 0 ? ` (${stageObjects.length})` : ''}
              </button>
            )}
            <button
              type="button"
              className={rightTab === 'agent' ? 'active' : ''}
              onClick={() => setRightTab('agent')}
            >
              <Sparkles size={12} /> Agent
            </button>
          </div>

          {rightTab === 'shot' || (isCodeTarget && rightTab === 'scene') ? (
            <div className="sds-panel-scroll">
              {/* Section 1: Compact Shot Identity + Output Mode (Zero Duplicate Badges) */}
              <section className="sds-group sds-shot-head-group">
                <div className="sds-shot-id-row">
                  <span className="sds-shot-key-pill">{activeShot.shortKey}</span>
                  <DirectorTextField
                    className="sds-shot-name-input"
                    ariaLabel="镜头名称"
                    placeholder="输入镜头名称…"
                    value={activeShot.name}
                    onCommit={(nextName) => updateActiveShot('修改镜头名称', { name: nextName })}
                  />
                  {isMotionShot && (
                    <select
                      aria-label="镜头时长"
                      className="sds-dur-inline"
                      value={String(activeShot.durationSec || 4)}
                      onChange={(e) => {
                        const nextSec = Number(e.target.value) || 4;
                        updateActiveShot(`调整「${activeShot.name}」时长为 ${nextSec}s`, {
                          durationSec: nextSec,
                        });
                      }}
                    >
                      {[2, 3, 4, 5, 8, 10].map((sec) => (
                        <option key={sec} value={sec}>
                          {sec}s
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="sds-mode-seg" role="group" aria-label="镜头拍摄类型">
                  <button
                    type="button"
                    className={activeShot.mode === 'still' ? 'active' : ''}
                    onClick={() => setActiveShotMode('still')}
                  >
                    <Camera size={11} />
                    <span>定机位</span>
                    <small>拍图</small>
                  </button>
                  <button
                    type="button"
                    className={activeShot.mode === 'motion' ? 'active' : ''}
                    onClick={() => setActiveShotMode('motion')}
                  >
                    <Film size={11} />
                    <span>动态运镜</span>
                    <small>录视频</small>
                  </button>
                </div>
              </section>

              {/* Section 2: Framing & Lens — Figma-Density 60fps Scrub Grid + Instant Angles */}
              <section className="sds-group">
                <div className="sds-group-head">
                  <h4>取景构图</h4>
                  <button
                    type="button"
                    className="sds-ghost-reset"
                    title="重置当前镜头 6 轴机位与焦段"
                    onClick={() => {
                      cancelDeferredCamCommit();
                      markPendingCommit();
                      pushLiveCamera({ yaw: 0, pitch: 0, distance: 1.0, panX: 0, panY: 0, lens: 35 });
                      updateActiveShotCamera('复位当前镜头机位', {
                        cameraYaw: 0,
                        cameraPitch: 0,
                        cameraDistance: 1.0,
                        cameraPanX: 0,
                        cameraPanY: 0,
                        cameraLens: isCodeTarget ? 0 : 35,
                      });
                    }}
                  >
                    <RotateCcw size={10} /> 复位
                  </button>
                </div>

                <div className="sds-lens-seg" role="group" aria-label="镜头焦段预设">
                  {[24, 35, 50, 85].map((mm) => (
                    <button
                      key={mm}
                      type="button"
                      className={resolvedCam.hasExplicitLens && Math.round(resolvedCam.lens) === mm ? 'active' : ''}
                      onClick={() => {
                        cancelDeferredCamCommit();
                        markPendingCommit();
                        pushLiveCamera({ ...resolvedCam, lens: mm });
                        updateActiveShotCamera(`切焦段 ${mm}mm`, { cameraLens: mm });
                      }}
                    >
                      {mm}mm
                    </button>
                  ))}
                </div>

                <div className="sds-angle-presets" role="group" aria-label="一键构图视角">
                  {QUICK_ANGLE_PRESETS.map((p) => {
                    const isNear =
                      Math.abs(resolvedCam.yaw - p.yaw) <= 4 &&
                      Math.abs(resolvedCam.pitch - p.pitch) <= 4 &&
                      Math.abs(resolvedCam.distance - p.distance) <= 0.08;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={isNear ? 'active' : ''}
                        onClick={() => {
                          cancelDeferredCamCommit();
                          markPendingCommit();
                          pushLiveCamera({
                            yaw: p.yaw,
                            pitch: p.pitch,
                            distance: p.distance,
                            panX: 0,
                            panY: 0,
                            lens: resolvedCam.lens,
                          });
                          updateActiveShotCamera(`一键构图「${p.label}」`, {
                            cameraYaw: p.yaw,
                            cameraPitch: p.pitch,
                            cameraDistance: p.distance,
                            cameraPanX: 0,
                            cameraPanY: 0,
                          });
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                <div className="sds-scrub-grid">
                  <DirectorScrubInput
                    label="水平"
                    ariaLabel="水平旋转 Yaw"
                    value={Math.round(resolvedCam.yaw)}
                    defaultValue={0}
                    step={1}
                    dragSpeed={0.6}
                    wrap360
                    suffix="°"
                    onLiveChange={(v) => {
                      cancelDeferredCamCommit();
                      pushLiveCamera({ ...resolvedCam, yaw: v });
                    }}
                    onCommit={(v) => {
                      markPendingCommit();
                      updateActiveShotCamera('调整水平角', { cameraYaw: v });
                    }}
                  />
                  <DirectorScrubInput
                    label="俯仰"
                    ariaLabel="俯仰角 Pitch"
                    value={Math.round(resolvedCam.pitch)}
                    defaultValue={0}
                    min={-75}
                    max={80}
                    step={1}
                    dragSpeed={0.5}
                    suffix="°"
                    onLiveChange={(v) => {
                      cancelDeferredCamCommit();
                      pushLiveCamera({ ...resolvedCam, pitch: v });
                    }}
                    onCommit={(v) => {
                      markPendingCommit();
                      updateActiveShotCamera('调整俯仰角', { cameraPitch: v });
                    }}
                  />
                  <DirectorScrubInput
                    label="距离"
                    ariaLabel="机位推拉倍率 Distance"
                    value={resolvedCam.distance}
                    defaultValue={1.0}
                    min={0.35}
                    max={3.0}
                    step={0.02}
                    decimals={2}
                    dragSpeed={0.6}
                    suffix="×"
                    onLiveChange={(v) => {
                      cancelDeferredCamCommit();
                      pushLiveCamera({ ...resolvedCam, distance: v });
                    }}
                    onCommit={(v) => {
                      markPendingCommit();
                      updateActiveShotCamera('调整机位距离', { cameraDistance: v });
                    }}
                  />
                  <DirectorScrubInput
                    label="焦段"
                    ariaLabel="镜头焦段 Lens"
                    value={Math.round(resolvedCam.lens)}
                    defaultValue={35}
                    min={18}
                    max={120}
                    step={1}
                    dragSpeed={0.4}
                    suffix="mm"
                    onLiveChange={(v) => {
                      cancelDeferredCamCommit();
                      pushLiveCamera({ ...resolvedCam, lens: v });
                    }}
                    onCommit={(v) => {
                      markPendingCommit();
                      updateActiveShotCamera('调整镜头焦段', { cameraLens: v });
                    }}
                  />
                  <DirectorScrubInput
                    label="横移"
                    ariaLabel="水平平移 Pan X"
                    value={resolvedCam.panX}
                    defaultValue={0}
                    min={-5}
                    max={5}
                    step={0.05}
                    decimals={2}
                    dragSpeed={0.45}
                    onLiveChange={(v) => {
                      cancelDeferredCamCommit();
                      pushLiveCamera({ ...resolvedCam, panX: v });
                    }}
                    onCommit={(v) => {
                      markPendingCommit();
                      updateActiveShotCamera('水平平移机位', { cameraPanX: v });
                    }}
                  />
                  <DirectorScrubInput
                    label="升降"
                    ariaLabel="垂直升降 Pan Y"
                    value={resolvedCam.panY}
                    defaultValue={0}
                    min={-4}
                    max={4}
                    step={0.05}
                    decimals={2}
                    dragSpeed={0.45}
                    onLiveChange={(v) => {
                      cancelDeferredCamCommit();
                      pushLiveCamera({ ...resolvedCam, panY: v });
                    }}
                    onCommit={(v) => {
                      markPendingCommit();
                      updateActiveShotCamera('垂直升降机位', { cameraPanY: v });
                    }}
                  />
                </div>
                <p className="sds-micro-hint">按住标签左右拖 60fps 微调 · 双击单格复位</p>
              </section>

              {isMotionShot && (
                <section className="sds-group">
                  <div className="sds-group-head">
                    <h4>运镜驱动方式</h4>
                    {shotHasManualKf && (
                      <button
                        type="button"
                        className="sds-link-btn"
                        onClick={() => updateActiveShot('清空机位关键帧', { keyframes: undefined })}
                      >
                        清空关键帧
                      </button>
                    )}
                  </div>
                  {shotHasManualKf ? (
                    <div className="sds-mode-info-box">
                      当前由 <b>{cameraKeyframeFrames.length} 个关键帧</b> 驱动平滑运镜（自动停用预设漂移）。拖移画面后点击下方「设为起点 / 设为终点」或展开「曲线」微调加减速。
                    </div>
                  ) : (
                    isSpatialStageTarget && (
                      <label className="sds-field">
                        <span>自动运镜轨迹</span>
                        <select
                          value={activeShot.camera.cameraPreset || 'dolly-in'}
                          onChange={(e) =>
                            updateActiveShotCamera(
                              '切换自动运镜预设',
                              { cameraPreset: e.target.value as SpatialCameraPreset },
                              false,
                            )
                          }
                        >
                          {CAMERA_PRESET_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )
                  )}

                  {isSpatialStageTarget && currentSceneType === 'previs-blocking' && (
                    <>
                      <div className="sds-group-head" style={{ marginTop: 4 }}>
                        <h4>本镜主角表演与走线</h4>
                        <button
                          type="button"
                          className="sds-link-btn"
                          onClick={() => {
                            setViewportTool('path');
                            setPathStep('start');
                            setPendingPathStart(null);
                            setLiveStageHud('走线模式：点击地面设「起点」');
                          }}
                        >
                          <Route size={11} /> 地面画走线
                        </button>
                      </div>
                      <label className="sds-field">
                        <span>主体动作</span>
                        <select
                          value={String(activeShot.actorAction || currentProps.actorAction || 'walk')}
                          onChange={(e) =>
                            updateActiveShot('调整本镜主角动作', {
                              actorAction: e.target.value as SpatialActorAction,
                            })
                          }
                        >
                          {SPATIAL_ACTOR_ACTION_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="sds-field">
                        <span>预设走位</span>
                        <select
                          value={String(activeShot.actorPath || currentProps.actorPath || 'approach')}
                          onChange={(e) =>
                            updateActiveShot('调整本镜主角走线', {
                              actorPath: e.target.value as SpatialActorPath,
                            })
                          }
                        >
                          {SPATIAL_ACTOR_PATH_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </section>
              )}

              {/* Shot Output Lineage & Staleness Card */}
              {activeShot.output && (
                <section className="sds-group">
                  <h4>本镜已出素材</h4>
                  <div className={`sds-output-lineage-card ${activeShotStale ? 'stale' : ''}`}>
                    <div>
                      <b>
                        {activeShotStale ? '片场布景已变更，建议重拍' : '已与当前片场布景同步'}
                      </b>
                      <small>
                        共 {activeShot.output.assetIds.length} 份素材 · 方式：{activeShot.output.kind}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="sds-out-btn"
                      onClick={() => triggerShoot([activeShot.id], false)}
                    >
                      <RefreshCw size={11} /> 重拍
                    </button>
                  </div>
                </section>
              )}

              {/* TSX Component Custom Params */}
              {isCodeTarget && (
                <section className="sds-group">
                  <div className="sds-group-head">
                    <h4>TSX 场景参数</h4>
                    {compObj && onOpenCodeEditor && (
                      <button
                        type="button"
                        className="sds-link-btn"
                        onClick={() => onOpenCodeEditor(compObj.id)}
                      >
                        <Code2 size={11} /> 编辑源码
                      </button>
                    )}
                  </div>
                  <p className="sds-tsx-scope-hint">
                    上方导演棚接管机位与通道；下方调节 TSX 场景自身参数。
                    {!isMotionShot && editableCompProps.some(([k]) => /orbit|speed|turn|anim|spin|wave|phase/i.test(k))
                      ? '（定机位定格于首帧，切为「动态运镜」可预览组件动画）'
                      : ''}
                  </p>
                  {editableCompProps.length > 0 ? (
                    <div className="sds-tsx-params-list">
                      {editableCompProps.map(([key, rawVal]) => {
                        const liveVal =
                          liveSceneProps && key in liveSceneProps ? liveSceneProps[key] : rawVal;
                        if (typeof rawVal === 'boolean') {
                          return (
                            <label key={key} className="sds-toggle-row">
                              <span>{key}</span>
                              <input
                                type="checkbox"
                                className="switch"
                                checked={Boolean(liveVal)}
                                onChange={(e) => commitScenePatch(`调整参数 ${key}`, { [key]: e.target.checked })}
                              />
                            </label>
                          );
                        }
                        if (typeof rawVal === 'number') {
                          const numVal = Number(liveVal);
                          const fineStep = Math.abs(rawVal) <= 5 ? 0.05 : 1;
                          return (
                            <DirectorScrubInput
                              key={key}
                              label={key}
                              ariaLabel={`TSX 参数 ${key}`}
                              value={Number.isFinite(numVal) ? numVal : rawVal}
                              step={fineStep}
                              decimals={fineStep < 1 ? 2 : 0}
                              dragSpeed={0.45}
                              onLiveChange={(v) => pushLiveSceneProp({ [key]: v })}
                              onCommit={(v) => {
                                markPendingCommit();
                                commitScenePatch(`调整参数 ${key}`, { [key]: v });
                              }}
                            />
                          );
                        }
                        return (
                          <label key={key} className="sds-field">
                            <span>{key}</span>
                            <DirectorTextField
                              ariaLabel={`TSX 参数 ${key}`}
                              value={String(liveVal ?? '')}
                              onCommit={(v) => commitScenePatch(`调整参数 ${key}`, { [key]: v })}
                            />
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="sds-empty-note">
                      <p>当前 TSX 3D 片场已由导演棚自动接管全部多机位、运镜与 5 通道渲染，无需改源码。</p>
                    </div>
                  )}
                </section>
              )}
            </div>
          ) : rightTab === 'scene' ? (
            <div className="sds-panel-scroll">
              <div className="sds-scene-scope-banner">
                片场布景、灯光与场内物体由本场全部 <b>{stageShots.length} 个镜头</b>共享；修改后已拍镜头将提示可一键重拍。
              </div>

              {isSpatialStageTarget ? (
                <>
                  <section className="sds-group">
                    <h4>场内物体组合 ({stageObjects.length})</h4>
                    <div className="sds-obj-add-grid">
                      <button type="button" onClick={() => addStageObject('actor')}>
                        <User size={11} /> + 演员
                      </button>
                      <button type="button" onClick={() => addStageObject('prop-box')}>
                        <Box size={11} /> + 道具箱
                      </button>
                      <button type="button" onClick={() => addStageObject('prop-pillar')}>
                        <Box size={11} /> + 立柱
                      </button>
                      <button type="button" onClick={() => addStageObject('prop-arch')}>
                        <Box size={11} /> + 拱门
                      </button>
                      <button type="button" onClick={() => addStageObject('light')}>
                        <Lightbulb size={11} /> + 灯光
                      </button>
                      <button type="button" onClick={() => addStageObject('card-25d')}>
                        <ImageIcon size={11} /> + 2D立牌
                      </button>
                    </div>

                    {projectImageAssets.length > 0 && (
                      <div className="sds-obj-asset-row">
                        <select
                          aria-label="选择项目图片作为 2D 立牌"
                          value={addCardAssetId || projectImageAssets[0]?.id || ''}
                          onChange={(e) => setAddCardAssetId(e.target.value)}
                        >
                          {projectImageAssets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const aid = addCardAssetId || projectImageAssets[0]?.id;
                            const a = projectImageAssets.find((x) => x.id === aid);
                            if (a) addStageObject('card-25d', { assetId: a.id, name: `立牌 · ${a.name}` });
                          }}
                        >
                          + 图片立牌
                        </button>
                      </div>
                    )}

                    {project3DAssets.length > 0 && (
                      <div className="sds-obj-asset-row">
                        <select
                          aria-label="选择项目 3D 模型放入舞台"
                          value={addGlbAssetId || project3DAssets[0]?.id || ''}
                          onChange={(e) => setAddGlbAssetId(e.target.value)}
                        >
                          {project3DAssets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const aid = addGlbAssetId || project3DAssets[0]?.id;
                            const a = project3DAssets.find((x) => x.id === aid);
                            if (a) addStageObject('glb', { assetId: a.id, name: a.name });
                          }}
                        >
                          + 3D模型
                        </button>
                      </div>
                    )}

                    {stageObjects.length > 0 && (
                      <div className="sds-obj-list">
                        {stageObjects.map((obj) => {
                          const sel = selectedObjectId === obj.id;
                          return (
                            <div
                              key={obj.id}
                              className={`sds-obj-item ${sel ? 'active' : ''}`}
                              onClick={() => setSelectedObjectId(obj.id)}
                            >
                              <span
                                className="sds-obj-dot"
                                style={{
                                  background:
                                    obj.kind === 'light'
                                      ? kelvinToHex(obj.temperature ?? 3800)
                                      : obj.color || '#64748b',
                                }}
                              />
                              <div className="sds-obj-meta">
                                <b>{obj.name}</b>
                                <small>
                                  {SPATIAL_STAGE_OBJECT_LABELS[obj.kind]} · ({obj.position[0].toFixed(1)},{' '}
                                  {obj.position[2].toFixed(1)})
                                </small>
                              </div>
                              <button
                                type="button"
                                className="sds-obj-del"
                                aria-label={`删除 ${obj.name}`}
                                title="移除物体"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteStageObject(obj.id);
                                }}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {selectedStageObj && (
                    <section className="sds-group">
                      <h4>选中物体 · {selectedStageObj.name}</h4>
                      <div className="sds-xyz-row">
                        {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                          <label key={axis} className="sds-field">
                            <span>{axis}</span>
                            <input
                              type="number"
                              step={0.2}
                              value={selectedStageObj.position[idx]}
                              onChange={(e) => {
                                const nextPos: [number, number, number] = [...selectedStageObj.position];
                                nextPos[idx] = Number(e.target.value) || 0;
                                updateStageObject(selectedStageObj.id, { position: nextPos }, `移动 ${selectedStageObj.name}`);
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <DirectorLiveSlider
                        label="水平朝向 Rotation Y"
                        valueText={`${Math.round(selectedStageObj.rotationY)}°`}
                        value={Math.round(selectedStageObj.rotationY)}
                        defaultValue={0}
                        min={-180}
                        max={180}
                        step={5}
                        onLiveChange={(v) => {
                          const nextList = stageObjects.map((o) =>
                            o.id === selectedStageObj.id ? { ...o, rotationY: v } : o,
                          );
                          previewLivePatch({ stageObjects: nextList });
                        }}
                        onCommit={(v) => {
                          markPendingCommit();
                          updateStageObject(selectedStageObj.id, { rotationY: v }, '旋转物体朝向');
                        }}
                      />
                      <DirectorLiveSlider
                        label="缩放 Scale"
                        valueText={`${selectedStageObj.scale.toFixed(2)}×`}
                        value={selectedStageObj.scale}
                        defaultValue={1.0}
                        min={0.3}
                        max={2.6}
                        step={0.05}
                        onLiveChange={(v) => {
                          const nextList = stageObjects.map((o) =>
                            o.id === selectedStageObj.id ? { ...o, scale: v } : o,
                          );
                          previewLivePatch({ stageObjects: nextList });
                        }}
                        onCommit={(v) => {
                          markPendingCommit();
                          updateStageObject(selectedStageObj.id, { scale: v }, '缩放舞台物体');
                        }}
                      />
                      {selectedStageObj.kind === 'actor' && (
                        <>
                          <label className="sds-field">
                            <span>演员动作</span>
                            <select
                              value={selectedStageObj.action || 'walk'}
                              onChange={(e) =>
                                updateStageObject(
                                  selectedStageObj.id,
                                  { action: e.target.value as SpatialActorAction },
                                  '修改演员动作',
                                )
                              }
                            >
                              {SPATIAL_ACTOR_ACTION_OPTIONS.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="sds-out-btn"
                            onClick={() => {
                              setViewportTool('path');
                              setPathStep('start');
                              setPendingPathStart(null);
                              setLiveStageHud(`为「${selectedStageObj.name}」画走线：点地面设起点`);
                            }}
                          >
                            <Route size={11} /> 在 3D 地面重绘此演员走线
                          </button>
                        </>
                      )}
                      {selectedStageObj.kind === 'light' && (
                        <>
                          <DirectorLiveSlider
                            label="灯光强度 Intensity"
                            valueText={(selectedStageObj.intensity ?? 2.6).toFixed(1)}
                            value={selectedStageObj.intensity ?? 2.6}
                            defaultValue={2.6}
                            min={0.2}
                            max={8}
                            step={0.2}
                            onLiveChange={(v) => {
                              const nextList = stageObjects.map((o) =>
                                o.id === selectedStageObj.id ? { ...o, intensity: v } : o,
                              );
                              previewLivePatch({ stageObjects: nextList });
                            }}
                            onCommit={(v) => {
                              markPendingCommit();
                              updateStageObject(selectedStageObj.id, { intensity: v }, '调整灯光强度');
                            }}
                          />
                          <DirectorLiveSlider
                            label={
                              <span className="sds-temp-label">
                                灯光色温
                                <i
                                  className="sds-temp-dot"
                                  style={{ background: kelvinToHex(selectedStageObj.temperature ?? 3800) }}
                                />
                              </span>
                            }
                            valueText={`${Math.round(selectedStageObj.temperature ?? 3800)}K`}
                            value={Math.round(selectedStageObj.temperature ?? 3800)}
                            defaultValue={3800}
                            min={2200}
                            max={9000}
                            step={100}
                            onLiveChange={(v) => {
                              const nextList = stageObjects.map((o) =>
                                o.id === selectedStageObj.id ? { ...o, temperature: v } : o,
                              );
                              previewLivePatch({ stageObjects: nextList });
                            }}
                            onCommit={(v) => {
                              markPendingCommit();
                              updateStageObject(selectedStageObj.id, { temperature: v }, '调整灯光色温');
                            }}
                          />
                        </>
                      )}
                    </section>
                  )}

                  <section className="sds-group">
                    <h4>全局环境、影调与主光</h4>
                    <label className="sds-field">
                      <span>舞台模式</span>
                      <select
                        value={currentSceneType}
                        onChange={(e) => commitScenePatch('切换 3D 舞台模式', { sceneType: e.target.value })}
                      >
                        {SPATIAL_SCENE_MODE_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {currentSceneType === 'previs-blocking' && (
                      <label className="sds-field">
                        <span>场景环境</span>
                        <select
                          value={String(currentProps.environmentPreset || 'rooftop-night')}
                          onChange={(e) => commitScenePatch('切换 3D 舞台环境', { environmentPreset: e.target.value })}
                        >
                          {SPATIAL_ENVIRONMENT_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {currentSceneType === 'device-showcase' && (
                      <label className="sds-field">
                        <span>设备类型</span>
                        <select
                          value={String(currentProps.deviceType || 'phone')}
                          onChange={(e) => commitScenePatch('切换硬件设备', { deviceType: e.target.value })}
                        >
                          {SPATIAL_DEVICE_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="sds-field">
                      <span>影调风格</span>
                      <select
                        value={String(currentProps.lookPreset || 'cinema')}
                        onChange={(e) => commitScenePatch('切换影调风格', { lookPreset: e.target.value })}
                      >
                        {SPATIAL_LOOK_PRESET_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="sds-chip-row">
                      {LIGHTING_OPTIONS.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          className={String(currentProps.lightingPreset || 'studio') === l.id ? 'active' : ''}
                          onClick={() => commitScenePatch(`切换布光「${l.label}」`, { lightingPreset: l.id })}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                    <DirectorLiveSlider
                      label="主光方位 Key Yaw"
                      valueText={`${Math.round(Number(liveSceneProps?.keyLightYaw ?? keyLightYawVal))}°`}
                      value={Math.round(Number(liveSceneProps?.keyLightYaw ?? keyLightYawVal))}
                      defaultValue={38}
                      min={-180}
                      max={180}
                      step={2}
                      onLiveChange={(v) => pushLiveSceneProp({ keyLightYaw: v })}
                      onCommit={(v) => {
                        markPendingCommit();
                        commitScenePatch('旋转主光方位', { keyLightYaw: v });
                      }}
                    />
                    <DirectorLiveSlider
                      label={
                        <span className="sds-temp-label">
                          主光色温
                          <i
                            className="sds-temp-dot"
                            style={{ background: kelvinToHex(Number(liveSceneProps?.keyLightTemp ?? keyLightTempVal)) }}
                          />
                        </span>
                      }
                      valueText={`${Math.round(Number(liveSceneProps?.keyLightTemp ?? keyLightTempVal))}K`}
                      value={Math.round(Number(liveSceneProps?.keyLightTemp ?? keyLightTempVal))}
                      defaultValue={5600}
                      min={2600}
                      max={9000}
                      step={100}
                      onLiveChange={(v) => pushLiveSceneProp({ keyLightTemp: v })}
                      onCommit={(v) => {
                        markPendingCommit();
                        commitScenePatch('调整主光色温', { keyLightTemp: v });
                      }}
                    />
                    <label className="sds-field">
                      <span>空间氛围粒子</span>
                      <select
                        value={String(currentProps.particles3D || 'none')}
                        onChange={(e) => commitScenePatch('调整氛围粒子', { particles3D: e.target.value })}
                      >
                        {PARTICLES_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {currentSceneType === 'parallax-25d' && (
                      <DirectorLiveSlider
                        label="立体景深起伏 Depth"
                        valueText={Number(liveSceneProps?.depthStrength ?? currentProps.depthStrength ?? 0.65).toFixed(2)}
                        value={Number(liveSceneProps?.depthStrength ?? currentProps.depthStrength ?? 0.65)}
                        defaultValue={0.65}
                        min={0}
                        max={1.4}
                        step={0.05}
                        onLiveChange={(v) => pushLiveSceneProp({ depthStrength: v })}
                        onCommit={(v) => {
                          markPendingCommit();
                          commitScenePatch('调整景深起伏', { depthStrength: v });
                        }}
                      />
                    )}
                    {(currentSceneType === 'turbine' ||
                      currentSceneType === 'chip-stack' ||
                      currentSceneType === 'factory-flow' ||
                      assetObj?.kind === 'model-3d') && (
                      <DirectorLiveSlider
                        label="结构爆炸拆解 Explode"
                        valueText={`${Math.round(Number(liveSceneProps?.explode ?? currentProps.explode ?? 0) * 100)}%`}
                        value={Number(liveSceneProps?.explode ?? currentProps.explode ?? 0)}
                        defaultValue={0}
                        min={0}
                        max={1}
                        step={0.02}
                        onLiveChange={(v) => pushLiveSceneProp({ explode: v })}
                        onCommit={(v) => {
                          markPendingCommit();
                          commitScenePatch('调整结构拆解', { explode: v });
                        }}
                      />
                    )}
                    <DirectorLiveSlider
                      label="辉光强度 Bloom"
                      valueText={`${Math.round(Number(liveSceneProps?.bloomStrength ?? currentProps.bloomStrength ?? 22))}%`}
                      value={Math.round(Number(liveSceneProps?.bloomStrength ?? currentProps.bloomStrength ?? 22))}
                      defaultValue={22}
                      min={0}
                      max={80}
                      step={2}
                      onLiveChange={(v) => pushLiveSceneProp({ bloomStrength: v })}
                      onCommit={(v) => {
                        markPendingCommit();
                        commitScenePatch('调整辉光强度', { bloomStrength: v });
                      }}
                    />
                    {hasCustomActorPath && (
                      <div className="sds-custom-path-row">
                        <span>
                          主角自定义走线：({Number(currentProps.actorStartX).toFixed(1)},{' '}
                          {Number(currentProps.actorStartZ).toFixed(1)}) → (
                          {Number(currentProps.actorEndX).toFixed(1)},{' '}
                          {Number(currentProps.actorEndZ).toFixed(1)})
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            commitScenePatch('清除自定义走线', {
                              actorStartX: undefined,
                              actorStartZ: undefined,
                              actorEndX: undefined,
                              actorEndZ: undefined,
                            })
                          }
                        >
                          重置
                        </button>
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <section className="sds-group">
                  <div className="sds-group-head">
                    <h4>TSX 3D 片场源码</h4>
                    {compObj && onOpenCodeEditor && (
                      <button
                        type="button"
                        className="sds-link-btn"
                        onClick={() => onOpenCodeEditor(compObj.id)}
                      >
                        <Code2 size={11} /> 打开代码编辑器
                      </button>
                    )}
                  </div>
                  <div className="sds-empty-note">
                    <p>当前片场由自定义 TSX 3D 组件渲染，可在左侧镜头单中自由新增多个静态机位或动态运镜，或切换到「Agent」让 AI 调整场景建筑与光影。</p>
                    <button
                      type="button"
                      className="sds-out-btn"
                      onClick={() => {
                        setRightTab('agent');
                        onAskAgent(
                          `【3D 导演片场 · 组件 ${compObj?.name || title} (${compObj?.id || ''})】请帮我优化这个 3D 场景的灯光对比与空间层次感。`,
                          clipObj,
                        );
                      }}
                    >
                      <Sparkles size={11} /> 让 Agent 升级场景布景
                    </button>
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="sds-agent-host">{agentSlot}</div>
          )}
        </aside>
      </div>
    </div>
  );
}
