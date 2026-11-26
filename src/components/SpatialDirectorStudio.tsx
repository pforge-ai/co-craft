import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Box,
  Cable,
  Camera,
  Check,
  Clapperboard,
  Code2,
  Compass,
  Diamond,
  Film,
  Grid3X3,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Lightbulb,
  Move,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Route,
  Save,
  SkipBack,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  User,
  Video,
  X,
} from 'lucide-react';
import { evaluateKeyframeTrack, removeClipKeyframe, upsertClipKeyframe } from '../core/keyframes';
import { clone, newClip, timecode } from '../core/project';
import { pointerDrag } from '../lib/pointerDrag';
import {
  DEFAULT_SPATIAL_BOOKMARKS,
  SPATIAL_ACTOR_ACTION_OPTIONS,
  SPATIAL_ACTOR_PATH_OPTIONS,
  SPATIAL_DEVICE_OPTIONS,
  SPATIAL_ENVIRONMENT_OPTIONS,
  SPATIAL_LOOK_PRESET_OPTIONS,
  SPATIAL_RENDER_PASS_OPTIONS,
  SPATIAL_SCENE_MODE_OPTIONS,
  SPATIAL_STAGE_OBJECT_LABELS,
  createStageObject,
  isSpatialClip,
  isSplatAssetPath,
  kelvinToHex,
  normalizeCameraBookmarks,
  type SpatialActorAction,
  type SpatialActorPath,
  type SpatialCameraBookmark,
  type SpatialCameraPreset,
  type SpatialStageObject,
  type SpatialStageObjectKind,
} from '../core/spatialStage';
import type {
  Clip,
  EditOperation,
  KeyframeProperty,
  Project,
  Sequence,
  Settings,
  VaultItem,
} from '../core/types';
import { StageRadarOverlay } from './StageRadarOverlay';
import { TimelineCurveHeader, TimelineCurveLane } from './TimelineCurveDrawer';

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
type RightSidebarTab = 'direct' | 'objects' | 'agent';

const CAMERA_PRESET_OPTIONS: { id: SpatialCameraPreset; label: string }[] = [
  { id: 'dolly-in', label: '推近镜头 (Dolly-In)' },
  { id: 'orbit', label: '环绕运镜 (Orbit)' },
  { id: 'pan-sweep', label: '横摇过肩 (Pan Sweep)' },
  { id: 'dolly-zoom', label: '希区柯克变焦 (Dolly-Zoom)' },
  { id: 'crane-up', label: '摇臂拉升 (Crane-Up)' },
  { id: 'hero-low', label: '低机位仰拍 (Hero Low)' },
  { id: 'isometric', label: '等轴建筑 (Isometric)' },
  { id: 'top-down', label: '上帝俯瞰 (Top-Down)' },
  { id: 'static', label: '固定机位 (Static)' },
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
  onBakeVideo,
  onAskAgent,
  onOpenCodeEditor,
  onOpenMcpSettings,
  agentSlot,
}: SpatialDirectorStudioProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const aspectBoxRef = useRef<HTMLDivElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rightTab, setRightTab] = useState<RightSidebarTab>('direct');
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('cc-sds-right-width'));
    return Number.isFinite(saved) && saved >= 280 && saved <= 720 ? Math.round(saved) : 368;
  });
  const [frameGuide, setFrameGuide] = useState<FrameGuide>('thirds');
  const [previewDurationSec, setPreviewDurationSec] = useState(4);
  const [viewportTool, setViewportTool] = useState<ViewportTool>('camera');
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [showRadar, setShowRadar] = useState(false);
  const [showCameraPath, setShowCameraPath] = useState(false);
  const [curveOpen, setCurveOpen] = useState(false);
  const [curveProp, setCurveProp] = useState<KeyframeProperty>('cameraYaw');
  const [curveSelectedFrame, setCurveSelectedFrame] = useState<number | null>(null);
  const [pathStep, setPathStep] = useState<'start' | 'end'>('start');
  const [pendingPathStart, setPendingPathStart] = useState<[number, number] | null>(null);
  const [renamingBmId, setRenamingBmId] = useState<string | null>(null);
  const [renamingBmDraft, setRenamingBmDraft] = useState('');
  const [addCardAssetId, setAddCardAssetId] = useState('');
  const [addGlbAssetId, setAddGlbAssetId] = useState('');
  const [liveStageHud, setLiveStageHud] = useState<string | null>(null);

  const resizerCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => resizerCleanupRef.current?.(), []);

  // Pending 3D raycast promise resolver for block/path viewport tools
  const pendingPickRef = useRef<
    Map<
      string,
      (res: { objectId: string | null; floorX: number | null; floorZ: number | null }) => void
    >
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
    const maxW = Math.max(360, Math.min(720, window.innerWidth - 420));
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
    cameraPreset: 'orbit',
    cameraLens: 35,
    cameraYaw: 0,
    cameraPitch: 0,
    cameraDistance: 1.0,
    cameraPanX: 0,
    cameraPanY: 0,
    lightingPreset: 'studio',
    keyLightYaw: 38,
    keyLightTemp: 5600,
    lookPreset: 'cinema',
    renderPass: 'beauty',
    stageObjects: [] as SpatialStageObject[],
    cameraBookmarks: DEFAULT_SPATIAL_BOOKMARKS,
    activeBookmarkId: 'cam-a',
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
    '3D 空间导演棚';

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
    ? 'TSX 3D 组件'
    : isSplat
      ? '3DGS 空间世界'
      : currentSceneType === 'parallax-25d'
        ? '2.5D 立体景深'
        : currentSceneType === 'device-showcase'
          ? '3D 硬件舞台'
          : '3D 导演摄影棚';

  const fps = targetSeq.fps || 30;
  const durationFrames = Math.max(
    fps,
    target.kind === 'clip' && clipObj ? clipObj.duration : Math.round(previewDurationSec * fps),
  );
  const clampedFrame = Math.max(0, Math.min(durationFrames - 1, frame));

  // Parse persisted custom camera bookmarks (works for Clip, Vault, Component & Asset!)
  const cameraBookmarks = useMemo<SpatialCameraBookmark[]>(() => {
    if (Array.isArray(currentProps.cameraBookmarks)) {
      return normalizeCameraBookmarks(currentProps.cameraBookmarks);
    }
    if (typeof currentProps.cameraBookmarksJson === 'string' && currentProps.cameraBookmarksJson.trim()) {
      try {
        return normalizeCameraBookmarks(JSON.parse(currentProps.cameraBookmarksJson));
      } catch {}
    }
    return normalizeCameraBookmarks(undefined);
  }, [currentProps.cameraBookmarks, currentProps.cameraBookmarksJson]);

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

  // Resolve current camera values (honoring clip keyframes & canonical 0.35..3.0 distance scale)
  const resolvedCam = useMemo(() => {
    const evalNum = (track: KeyframeProperty, fallback: number) => {
      const raw = currentProps[track];
      const base = raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : fallback;
      if (target.kind === 'clip' && clipObj?.keyframes?.[track]?.length) {
        return evaluateKeyframeTrack(clipObj.keyframes[track], clampedFrame, base);
      }
      return base;
    };
    const rawLens = evalNum('cameraLens', isCodeTarget ? 0 : 35);
    return {
      yaw: liveHud?.yaw ?? evalNum('cameraYaw', 0),
      pitch: liveHud?.pitch ?? evalNum('cameraPitch', 0),
      distance: liveHud?.distance ?? normalizeDistanceVal(evalNum('cameraDistance', 1.0)),
      panX: liveHud?.panX ?? evalNum('cameraPanX', 0),
      panY: liveHud?.panY ?? evalNum('cameraPanY', 0),
      lens: liveHud?.lens ?? (rawLens > 0 ? rawLens : 35),
      hasExplicitLens: liveHud?.lens !== undefined || rawLens > 0,
    };
  }, [currentProps, target.kind, clipObj, clampedFrame, liveHud, isCodeTarget]);

  // BOTH SpatialStage AND custom TSX 3D components (`ThreeCanvas`) now support 60fps direct orbit + multi-pass!
  const supportsDirectOrbit = true;

  // Build isolated 1-clip synthetic project for the studio's dedicated preview iframe
  const STUDIO_SEQ_ID = 'seq_spatial_director_studio';
  const STUDIO_CLIP_ID = 'clip_spatial_director_studio';
  const studioProject = useMemo<Project>(() => {
    const base = clone(project);
    const clipProps: Record<string, unknown> = {
      ...currentProps,
      ...(isCodeTarget ? {} : { showHud: false }),
      _studioInteractive: true,
      _selectedObjectId: selectedObjectId,
      _showCameraPath: showCameraPath,
      cameraBookmarks,
    };
    const syntheticClip: Clip = {
      id: STUDIO_CLIP_ID,
      name: title,
      kind: isCodeTarget ? 'code' : clipObj ? clipObj.kind : 'shape',
      track: 'visual',
      layer: 0,
      start: 0,
      duration: durationFrames,
      sourceIn: clipObj?.sourceIn || 0,
      assetId: isCodeTarget ? undefined : clipObj?.assetId || assetObj?.id || vaultObj?.assetId,
      componentId: isCodeTarget ? (compObj?.id || clipObj?.componentId) : undefined,
      locked: false,
      keyframes: clipObj?.keyframes ? clone(clipObj.keyframes) : undefined,
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
    durationFrames,
    selectedObjectId,
    showCameraPath,
    cameraBookmarks,
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

  // Push synthetic 3D project into studio iframe whenever props/keyframes change
  useEffect(() => {
    if (!iframeReady) return;
    postToStage('load', {
      props: { project: studioProject, sequenceId: STUDIO_SEQ_ID, mediaOrigin: previewOrigin },
      frame: clampedFrame,
    });
  }, [iframeReady, studioProject, previewOrigin, postToStage]);

  const seekTo = useCallback(
    (nextFrame: number) => {
      const f = Math.max(0, Math.min(durationFrames - 1, Math.round(nextFrame)));
      setFrame(f);
      postToStage('seek', { frame: f });
    },
    [durationFrames, postToStage],
  );

  const togglePlay = useCallback(() => {
    if (playing) {
      postToStage('pause');
      setPlaying(false);
    } else {
      if (clampedFrame >= durationFrames - 2) seekTo(0);
      postToStage('play');
      setPlaying(true);
    }
  }, [playing, clampedFrame, durationFrames, postToStage, seekTo]);

  // Persist prop changes atomically back to the underlying Clip / VaultItem / CodeComponent / Asset
  const commitPropPatch = useCallback(
    (label: string, patch: Record<string, unknown>, alsoUpdateKeyframes = true) => {
      if (target.kind === 'clip' && clipObj) {
        let nextKeyframes = clipObj.keyframes;
        if (alsoUpdateKeyframes && clipObj.keyframes) {
          for (const tr of CAMERA_KF_TRACKS) {
            if (patch[tr] !== undefined && clipObj.keyframes[tr]?.length) {
              nextKeyframes = upsertClipKeyframe(nextKeyframes, tr, clampedFrame, Number(patch[tr]), 'ease-in-out');
            }
          }
        }
        void onEdit(label, [
          {
            type: 'updateClip',
            sequenceId: targetSeq.id,
            clipId: clipObj.id,
            changes: {
              props: patch,
              ...(nextKeyframes !== clipObj.keyframes ? { keyframes: nextKeyframes } : {}),
            },
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
          if (k === 'cameraBookmarks' && Array.isArray(v)) {
            nextProps.cameraBookmarksJson = JSON.stringify(v);
          } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            nextProps[k] = v;
          }
        }
        void onEdit(label, [{ type: 'putComponent', component: { ...compObj, props: nextProps } }]);
        return;
      }
      setAssetPropsLocal((prev) => ({ ...prev, ...patch }));
    },
    [target.kind, clipObj, targetSeq.id, vaultObj, compObj, clampedFrame, onEdit],
  );

  const previewLivePatch = useCallback(
    (patch: Record<string, unknown>) => {
      postToStage('live-transform', {
        override: {
          clipId: STUDIO_CLIP_ID,
          props: patch,
        },
      });
    },
    [postToStage],
  );

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

  const dropCameraKeyframe = useCallback(() => {
    if (target.kind !== 'clip' || !clipObj) return;
    let nextKf = clipObj.keyframes;
    nextKf = upsertClipKeyframe(nextKf, 'cameraYaw', clampedFrame, resolvedCam.yaw, 'ease-in-out');
    nextKf = upsertClipKeyframe(nextKf, 'cameraPitch', clampedFrame, resolvedCam.pitch, 'ease-in-out');
    nextKf = upsertClipKeyframe(nextKf, 'cameraDistance', clampedFrame, resolvedCam.distance, 'ease-in-out');
    nextKf = upsertClipKeyframe(nextKf, 'cameraLens', clampedFrame, resolvedCam.lens, 'ease-in-out');
    nextKf = upsertClipKeyframe(nextKf, 'cameraPanX', clampedFrame, resolvedCam.panX, 'ease-in-out');
    nextKf = upsertClipKeyframe(nextKf, 'cameraPanY', clampedFrame, resolvedCam.panY, 'ease-in-out');
    void onEdit(`在第 ${clampedFrame} 帧打 3D 机位关键帧`, [
      {
        type: 'updateClip',
        sequenceId: targetSeq.id,
        clipId: clipObj.id,
        changes: { keyframes: nextKf },
      },
    ]);
  }, [target.kind, clipObj, targetSeq.id, clampedFrame, resolvedCam, onEdit]);

  const deleteCameraKeyframeAtPlayhead = useCallback(() => {
    if (target.kind !== 'clip' || !clipObj?.keyframes) return;
    let nextKf: Clip['keyframes'] = clipObj.keyframes;
    for (const tr of CAMERA_KF_TRACKS) {
      nextKf = removeClipKeyframe(nextKf, tr, clampedFrame);
    }
    void onEdit(`删除第 ${clampedFrame} 帧机位关键帧`, [
      {
        type: 'updateClip',
        sequenceId: targetSeq.id,
        clipId: clipObj.id,
        changes: { keyframes: nextKf },
      },
    ]);
  }, [target.kind, clipObj, targetSeq.id, clampedFrame, onEdit]);

  const cameraKeyframeFrames = useMemo(() => {
    if (target.kind !== 'clip' || !clipObj?.keyframes) return [] as number[];
    const set = new Set<number>();
    for (const tr of CAMERA_KF_TRACKS) {
      for (const kf of clipObj.keyframes[tr] || []) set.add(kf.frame);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [target.kind, clipObj]);

  const hasCameraKfAtPlayhead = cameraKeyframeFrames.includes(clampedFrame);

  // Camera Bookmarks CRUD
  const activeBookmarkId = String(currentProps.activeBookmarkId || cameraBookmarks[0]?.id || 'cam-a');

  const applyBookmark = useCallback(
    (bm: SpatialCameraBookmark, alsoDropKf = false) => {
      const patch: Record<string, unknown> = {
        activeBookmarkId: bm.id,
        cameraPreset: bm.cameraPreset,
        cameraLens: bm.cameraLens,
        cameraYaw: bm.cameraYaw,
        cameraPitch: bm.cameraPitch,
        cameraDistance: bm.cameraDistance,
        cameraPanX: bm.cameraPanX ?? 0,
        cameraPanY: bm.cameraPanY ?? 0,
      };
      if (alsoDropKf && target.kind === 'clip' && clipObj) {
        let nextKf = clipObj.keyframes;
        nextKf = upsertClipKeyframe(nextKf, 'cameraYaw', clampedFrame, bm.cameraYaw, 'ease-in-out');
        nextKf = upsertClipKeyframe(nextKf, 'cameraPitch', clampedFrame, bm.cameraPitch, 'ease-in-out');
        nextKf = upsertClipKeyframe(nextKf, 'cameraDistance', clampedFrame, bm.cameraDistance, 'ease-in-out');
        nextKf = upsertClipKeyframe(nextKf, 'cameraLens', clampedFrame, bm.cameraLens, 'ease-in-out');
        nextKf = upsertClipKeyframe(nextKf, 'cameraPanX', clampedFrame, bm.cameraPanX ?? 0, 'ease-in-out');
        nextKf = upsertClipKeyframe(nextKf, 'cameraPanY', clampedFrame, bm.cameraPanY ?? 0, 'ease-in-out');
        void onEdit(`在 f${clampedFrame} 打入 ${bm.label} 关键帧`, [
          {
            type: 'updateClip',
            sequenceId: targetSeq.id,
            clipId: clipObj.id,
            changes: { props: patch, keyframes: nextKf },
          },
        ]);
        return;
      }
      commitPropPatch(`切换至 ${bm.label}`, patch, true);
    },
    [commitPropPatch, target.kind, clipObj, clampedFrame, onEdit, targetSeq.id],
  );

  const handleUpdateActiveBookmark = () => {
    const nextList = cameraBookmarks.map((bm) =>
      bm.id === activeBookmarkId
        ? {
            ...bm,
            cameraPreset: String(currentProps.cameraPreset || bm.cameraPreset) as SpatialCameraPreset,
            cameraLens: Math.round(resolvedCam.lens),
            cameraYaw: Math.round(resolvedCam.yaw),
            cameraPitch: Math.round(resolvedCam.pitch),
            cameraDistance: Number(resolvedCam.distance.toFixed(2)),
            cameraPanX: Number(resolvedCam.panX.toFixed(2)),
            cameraPanY: Number(resolvedCam.panY.toFixed(2)),
          }
        : bm,
    );
    commitPropPatch('更新当前机位书签', { cameraBookmarks: nextList }, false);
  };

  const handleSaveNewBookmark = () => {
    const nextIdx = cameraBookmarks.length;
    const letter = String.fromCharCode(65 + (nextIdx % 26));
    const newId = `cam-${letter.toLowerCase()}-${Date.now().toString(36).slice(-4)}`;
    const newBm: SpatialCameraBookmark = {
      id: newId,
      shortKey: letter,
      label: `${letter} · 自定义机位`,
      cameraPreset: String(currentProps.cameraPreset || 'static') as SpatialCameraPreset,
      cameraLens: Math.round(resolvedCam.lens),
      cameraYaw: Math.round(resolvedCam.yaw),
      cameraPitch: Math.round(resolvedCam.pitch),
      cameraDistance: Number(resolvedCam.distance.toFixed(2)),
      cameraPanX: Number(resolvedCam.panX.toFixed(2)),
      cameraPanY: Number(resolvedCam.panY.toFixed(2)),
    };
    commitPropPatch(`保存新机位 ${newBm.label}`, {
      cameraBookmarks: [...cameraBookmarks, newBm],
      activeBookmarkId: newId,
    }, false);
  };

  const handleDeleteBookmark = (bmId: string) => {
    if (cameraBookmarks.length <= 1) return;
    const nextList = cameraBookmarks.filter((b) => b.id !== bmId);
    const nextActive = activeBookmarkId === bmId ? nextList[0].id : activeBookmarkId;
    commitPropPatch('删除机位书签', {
      cameraBookmarks: nextList,
      activeBookmarkId: nextActive,
    }, false);
  };

  const handleRenameBookmarkCommit = (bmId: string) => {
    const clean = renamingBmDraft.trim();
    setRenamingBmId(null);
    if (!clean) return;
    const nextList = cameraBookmarks.map((b) => (b.id === bmId ? { ...b, label: clean } : b));
    commitPropPatch(`重命名机位为「${clean}」`, { cameraBookmarks: nextList }, false);
  };

  // Composable Scene Graph CRUD
  const addStageObject = (kind: SpatialStageObjectKind, opts?: { assetId?: string; name?: string }) => {
    const obj = createStageObject(kind, stageObjects, opts);
    const nextList = [...stageObjects, obj];
    setSelectedObjectId(obj.id);
    setRightTab('objects');
    commitPropPatch(`舞台添加「${obj.name}」`, { stageObjects: nextList }, false);
  };

  const updateStageObject = (objId: string, changes: Partial<SpatialStageObject>, label = '调整舞台物体') => {
    const nextList = stageObjects.map((o) => (o.id === objId ? { ...o, ...changes } : o));
    commitPropPatch(label, { stageObjects: nextList }, false);
  };

  const deleteStageObject = (objId: string) => {
    const targetObj = stageObjects.find((o) => o.id === objId);
    const nextList = stageObjects.filter((o) => o.id !== objId);
    if (selectedObjectId === objId) setSelectedObjectId(null);
    commitPropPatch(`移除舞台物体「${targetObj?.name || ''}」`, { stageObjects: nextList }, false);
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
          return;
        }
        onClose();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(clampedFrame - (e.shiftKey ? 10 : 1));
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(clampedFrame + (e.shiftKey ? 10 : 1));
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'k' && target.kind === 'clip') {
        e.preventDefault();
        dropCameraKeyframe();
        return;
      }
      if (isSpatialStageTarget && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (k === 'v') {
          e.preventDefault();
          setViewportTool('camera');
          return;
        }
        if (k === 'g') {
          e.preventDefault();
          setViewportTool('block');
          return;
        }
        if (k === 'p') {
          e.preventDefault();
          setViewportTool('path');
          setPathStep('start');
          setPendingPathStart(null);
          return;
        }
      }
      if (supportsDirectOrbit && viewportTool === 'camera' && ['w', 's', 'a', 'd', 'q', 'e'].includes(k)) {
        e.preventDefault();
        const dollyStep = e.shiftKey ? 0.2 : 0.08;
        const panStep = e.shiftKey ? 0.45 : 0.18;
        if (k === 'w') {
          commitPropPatch('推近镜头', {
            cameraDistance: Math.max(0.35, Number((resolvedCam.distance - dollyStep).toFixed(2))),
          });
        } else if (k === 's') {
          commitPropPatch('拉远镜头', {
            cameraDistance: Math.min(3.0, Number((resolvedCam.distance + dollyStep).toFixed(2))),
          });
        } else if (k === 'a') {
          commitPropPatch('左移机位', {
            cameraPanX: Math.max(-5, Number((resolvedCam.panX - panStep).toFixed(2))),
          });
        } else if (k === 'd') {
          commitPropPatch('右移机位', {
            cameraPanX: Math.min(5, Number((resolvedCam.panX + panStep).toFixed(2))),
          });
        } else if (k === 'e') {
          commitPropPatch('抬升机位', {
            cameraPanY: Math.min(4, Number((resolvedCam.panY + panStep).toFixed(2))),
          });
        } else if (k === 'q') {
          commitPropPatch('压低机位', {
            cameraPanY: Math.max(-4, Number((resolvedCam.panY - panStep).toFixed(2))),
          });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    onClose,
    togglePlay,
    seekTo,
    clampedFrame,
    target.kind,
    isSpatialStageTarget,
    viewportTool,
    supportsDirectOrbit,
    dropCameraKeyframe,
    commitPropPatch,
    resolvedCam,
  ]);

  // Native 3D viewport pointer interaction routed by active ViewportTool: camera | block | path
  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    e.preventDefault();

    // Right/Middle button ALWAYS orbits/pans camera even while in block/path tool!
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
            commitPropPatch(
              '设置主角走线起点',
              { actorStartX: hit.floorX, actorStartZ: hit.floorZ },
              false,
            );
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
            commitPropPatch(
              '绘制主角走位路径',
              {
                actorStartX: sx,
                actorStartZ: sz,
                actorEndX: hit.floorX,
                actorEndZ: hit.floorZ,
              },
              false,
            );
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
          if (hit.objectId !== '__hero__' && hit.objectId !== '__rival__') {
            setRightTab('objects');
          }
          activeBlockDragRef.current = { objectId: hit.objectId, changed: false };
          setLiveStageHud(`已选中物体 · 拖拽在地面移位`);
        } else if (selectedObjectId) {
          // Clicking empty floor while an object is selected moves it directly to that floor spot!
          if (hit.floorX !== null && hit.floorZ !== null) {
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
        postToStage('live-transform', { override: null });
        if (drag?.changed) {
          if (drag.latestObjects) {
            commitPropPatch('3D 视口拖拽物体摆位', { stageObjects: drag.latestObjects }, false);
          } else if (drag.latestHero) {
            commitPropPatch(
              '3D 视口移动主角起点',
              { actorStartX: drag.latestHero.sx, actorStartZ: drag.latestHero.sz },
              false,
            );
          }
        }
      };

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', finish, true);
      window.addEventListener('pointercancel', finish, true);
      return;
    }

    // Camera Orbit / Pan mode
    const isPan = e.button === 2 || e.button === 1 || e.shiftKey;
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    const startCam = { ...resolvedCam };
    let latest = { ...startCam };
    let raf = 0;

    const flush = () => {
      raf = 0;
      setLiveHud(latest);
      previewLivePatch({
        cameraYaw: latest.yaw,
        cameraPitch: latest.pitch,
        cameraPanX: latest.panX,
        cameraPanY: latest.panY,
      });
    };

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
          yaw: Math.round((((startCam.yaw + dx * 0.45 + 180) % 360) + 360) % 360 - 180),
          pitch: Math.max(-75, Math.min(82, Math.round(startCam.pitch + dy * 0.35))),
        };
      }
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const finish = (ev?: PointerEvent) => {
      if (ev && ev.pointerId !== pointerId) return;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      setLiveHud(null);
      postToStage('live-transform', { override: null });
      if (isPan) {
        if (latest.panX !== startCam.panX || latest.panY !== startCam.panY) {
          commitPropPatch('平移 3D 机位', { cameraPanX: latest.panX, cameraPanY: latest.panY });
        }
      } else if (latest.yaw !== startCam.yaw || latest.pitch !== startCam.pitch) {
        commitPropPatch('旋转 3D 摄像机视角', { cameraYaw: latest.yaw, cameraPitch: latest.pitch });
      }
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
  };

  const handleViewportWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!supportsDirectOrbit) return;
    e.preventDefault();
    if (e.altKey) {
      const nextLens = Math.max(18, Math.min(120, Math.round(resolvedCam.lens + e.deltaY * 0.08)));
      if (nextLens !== resolvedCam.lens) commitPropPatch('调整镜头焦段', { cameraLens: nextLens });
    } else {
      const nextDist = Math.max(0.35, Math.min(3.0, Number((resolvedCam.distance + e.deltaY * 0.0012).toFixed(2))));
      if (nextDist !== resolvedCam.distance) commitPropPatch('推拉机位距离', { cameraDistance: nextDist });
    }
  };

  const enabledMcpServers = (settings.mcpServers || []).filter((s) => s.enabled);

  const capturePayload = {
    clipId: target.kind === 'clip' ? clipObj?.id : undefined,
    vaultItemId: target.kind === 'vault' ? vaultObj?.id : undefined,
    componentId: target.kind === 'component' ? compObj?.id : undefined,
    assetId: target.kind === 'asset' ? assetObj?.id : undefined,
  };

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

  const handleAddToMainTimeline = () => {
    const tail = sequence.clips.length
      ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
      : 0;
    const nc: Clip = {
      ...newClip(isCodeTarget ? 'code' : 'shape', tail),
      name: title,
      duration: durationFrames,
      assetId: isCodeTarget ? undefined : assetObj?.id || vaultObj?.assetId,
      componentId: isCodeTarget ? compObj?.id : undefined,
      props: clone(currentProps),
    };
    void onEdit(`将「${title}」加入主片时间线`, [{ type: 'addClip', sequenceId: sequence.id, clip: nc }]);
  };

  const keyLightYawVal = Number(currentProps.keyLightYaw ?? 38);
  const keyLightTempVal = Number(currentProps.keyLightTemp ?? 5600);
  const hasCustomActorPath =
    currentProps.actorStartX !== undefined && currentProps.actorEndX !== undefined;

  // Clip proxy with start=0 so TimelineCurveHeader & TimelineCurveLane fill 100% of single-shot studio rail width
  const studioCurveClip = useMemo<Clip | null>(() => {
    if (target.kind !== 'clip' || !clipObj) return null;
    return { ...clipObj, start: 0 };
  }, [target.kind, clipObj]);

  return (
    <div className="sds-shell" role="dialog" aria-label="3D 导演棚空间调度工作区">
      {/* Top Director Studio Bar */}
      <header className="sds-topbar">
        <div className="sds-top-left">
          <button type="button" className="sds-back-btn" onClick={onClose}>
            <ArrowLeft size={14} /> {returnLabel}
          </button>
          <span className="sds-sep" />
          <Box size={14} className="sds-accent-ico" />
          <b className="sds-title">{title}</b>
          <span className="sds-badge">{badgeLabel}</span>
        </div>

        <div className="sds-top-center">
          {/* 5-Pass Render Selector — works for BOTH SpatialStage AND custom TSX 3D components! */}
          <div className="sds-seg" role="group" aria-label="3D 渲染通道">
            {SPATIAL_RENDER_PASS_OPTIONS.map((rp) => {
              const active = String(currentProps.renderPass || 'beauty') === rp.id;
              return (
                <button
                  key={rp.id}
                  type="button"
                  className={active ? 'active' : ''}
                  title={rp.label}
                  onClick={() => commitPropPatch(`切换通道「${rp.label}」`, { renderPass: rp.id }, false)}
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
          <button
            type="button"
            className="sds-out-btn"
            title="GPU 秒级拍摄当前帧为构图参考图并落入画布"
            onClick={() =>
              void onCaptureReference({
                ...capturePayload,
                frame: clampedFrame,
                passes: ['beauty'],
              })
            }
          >
            <Camera size={12} /> 拍参考帧
          </button>
          <button
            type="button"
            className="sds-out-btn"
            title="一次拍出彩图 + Depth 深度图 + Normal 法线图送入画布"
            onClick={() =>
              void onCaptureReference({
                ...capturePayload,
                frame: clampedFrame,
                passes: ['beauty', 'depth', 'normal'],
              })
            }
          >
            <Layers size={12} /> 多通道
          </button>
          {onCaptureMultiCam && (
            <button
              type="button"
              className="sds-out-btn"
              title={`一键按全部 ${cameraBookmarks.length} 个已保存机位批量拍摄空间一致分镜图并串联至时间线`}
              onClick={() =>
                void onCaptureMultiCam({
                  ...capturePayload,
                  frame: clampedFrame,
                  cameras: cameraBookmarks,
                  includeDepth: false,
                  addToTimeline: true,
                  ...(target.kind === 'asset' ? { propsOverride: assetPropsLocal } : {}),
                })
              }
            >
              <LayoutGrid size={12} /> 多机位出分镜
            </button>
          )}
          <button
            type="button"
            className="sds-out-btn"
            title="双拍首尾帧送入画布并自动连入首尾帧生视频工坊"
            onClick={() =>
              void onCapturePair({
                ...capturePayload,
                startBookmarkId: cameraBookmarks[0]?.id || 'cam-a',
                endBookmarkId: cameraBookmarks[1]?.id || cameraBookmarks[0]?.id || 'cam-b',
              })
            }
          >
            <Film size={12} /> 首尾帧→AI
          </button>
          <button
            type="button"
            className="sds-out-btn primary"
            title="用 GPU 离屏引擎录制真实 3D MP4 预演视频送入画布并接入 AI 生视频"
            onClick={() =>
              void onBakeVideo({
                ...capturePayload,
                durationSeconds: Math.max(1, Math.min(8, Math.round(durationFrames / fps))),
                ...(target.kind === 'asset' ? { props: assetPropsLocal } : {}),
              })
            }
          >
            <Clapperboard size={12} /> 录视频→AI生片
          </button>
        </div>
      </header>

      {/* Main Studio Body: Interactive 3D Viewport + Resizable Director / Objects / Agent Sidebar */}
      <div className="sds-body" style={{ gridTemplateColumns: `minmax(0, 1fr) ${rightWidth}px` }}>
        <div className="sds-viewport-col">
          <div
            className={`sds-viewport-stage tool-${viewportTool}`}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={handleViewportPointerDown}
            onWheel={handleViewportWheel}
          >
            {/* Floating Darkroom 3D Viewport Tool & Overlay Pill (keeps topbar strictly single-row!) */}
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
                    title="切换 CineTracer 风格 2D 俯视调度图（支持直接拖动物体与点击切换机位）"
                    onClick={() => setShowRadar((v) => !v)}
                  >
                    <Compass size={11} /> 俯视图
                  </button>
                  <button
                    type="button"
                    className={showCameraPath ? 'active' : ''}
                    title="在 3D 视口叠加显示多机位视锥体与轨迹样条（拍摄与导出时自动隐藏）"
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
              {/* Safe Framing Guides Overlay */}
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

            {/* CineTracer-style Top-Down Floor Plan Radar Overlay */}
            {isSpatialStageTarget && showRadar && (
              <StageRadarOverlay
                sceneType={currentSceneType}
                isPortrait={targetSeq.height > targetSeq.width}
                is25D={currentSceneType === 'parallax-25d'}
                timeSec={clampedFrame / Math.max(1, fps)}
                durationSec={Math.max(1, durationFrames / Math.max(1, fps))}
                cameraPreset={String(currentProps.cameraPreset || 'dolly-in')}
                liveCamera={resolvedCam}
                bookmarks={cameraBookmarks}
                activeBookmarkId={activeBookmarkId}
                stageObjects={stageObjects}
                selectedObjectId={selectedObjectId}
                actorPath={String(currentProps.actorPath || 'approach') as SpatialActorPath}
                actorStartX={currentProps.actorStartX !== undefined ? Number(currentProps.actorStartX) : undefined}
                actorStartZ={currentProps.actorStartZ !== undefined ? Number(currentProps.actorStartZ) : undefined}
                actorEndX={currentProps.actorEndX !== undefined ? Number(currentProps.actorEndX) : undefined}
                actorEndZ={currentProps.actorEndZ !== undefined ? Number(currentProps.actorEndZ) : undefined}
                onSelectBookmark={(bm) => applyBookmark(bm, false)}
                onSelectObject={(id) => {
                  setSelectedObjectId(id);
                  if (id && id !== '__hero__' && id !== '__rival__') setRightTab('objects');
                }}
                onPreviewStagePatch={(patch) => previewLivePatch(patch)}
                onCommitStagePatch={(label, patch) => {
                  postToStage('live-transform', { override: null });
                  commitPropPatch(label, patch, false);
                }}
                onClose={() => setShowRadar(false)}
              />
            )}

            {/* Subtle Floating Camera & Tool Telemetry HUD */}
            <div className="sds-cam-hud" onPointerDown={(e) => e.stopPropagation()}>
              {liveStageHud ? (
                <span className="sds-live-mode-msg">{liveStageHud}</span>
              ) : (
                <>
                  <span>
                    Yaw {Math.round(resolvedCam.yaw)}° · Pitch {Math.round(resolvedCam.pitch)}° · Dist{' '}
                    {resolvedCam.distance.toFixed(2)}× · {resolvedCam.hasExplicitLens ? `${Math.round(resolvedCam.lens)}mm` : '原焦段'}
                  </span>
                  <span className="sds-cam-hint">
                    {viewportTool === 'block'
                      ? '点选物体拖地移位 · 右键仍可平移视角 · V 返回摄像机'
                      : viewportTool === 'path'
                        ? '点击地面定起点再点定终点 · Esc 退出走线'
                        : '左键环绕 · 右键/Shift 平移 · 滚轮推拉 · Alt+滚轮变焦 · WASD 游走'}
                  </span>
                  <button
                    type="button"
                    title="复位摄像机机位"
                    onClick={() =>
                      commitPropPatch('复位 3D 机位', {
                        cameraYaw: 0,
                        cameraPitch: 0,
                        cameraDistance: 1.0,
                        cameraPanX: 0,
                        cameraPanY: 0,
                        cameraLens: isCodeTarget ? 0 : 35,
                      })
                    }
                  >
                    <RotateCcw size={11} /> 复位
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Dedicated Single-Shot Camera, Bezier Curve & Custom Multi-Cam Rail */}
          <footer className="sds-rail">
            <div className="sds-rail-top">
              <div className="sds-rail-transport">
                <button type="button" title="回到开头" onClick={() => seekTo(0)}>
                  <SkipBack size={13} />
                </button>
                <button type="button" className="play" title="播放 / 暂停 (Space)" onClick={togglePlay}>
                  {playing ? <Pause size={13} /> : <Play size={13} />}
                </button>
                <code className="sds-tc">
                  {timecode(clampedFrame, fps)} / {timecode(durationFrames, fps)} · f{clampedFrame}
                </code>
              </div>

              <div className="sds-rail-actions">
                {target.kind === 'clip' && clipObj && (
                  <>
                    <button
                      type="button"
                      className={`sds-kf-btn ${hasCameraKfAtPlayhead ? 'active' : ''}`}
                      title="在当前帧记录 3D 摄像机姿态关键帧 (快捷键 K)"
                      onClick={dropCameraKeyframe}
                    >
                      <Diamond size={11} /> {hasCameraKfAtPlayhead ? '更新机位关键帧' : '+ 机位关键帧 (K)'}
                    </button>
                    {hasCameraKfAtPlayhead && (
                      <button
                        type="button"
                        className="sds-kf-btn danger"
                        title="删除当前帧的机位关键帧"
                        onClick={deleteCameraKeyframeAtPlayhead}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                    <button
                      type="button"
                      className={`sds-kf-btn ${curveOpen ? 'active' : ''}`}
                      title="展开 / 收起 3D 运镜贝塞尔速度曲线编辑器"
                      onClick={() => setCurveOpen((v) => !v)}
                    >
                      <Activity size={11} /> 曲线
                    </button>
                  </>
                )}
                {target.kind !== 'clip' && (
                  <button
                    type="button"
                    className="sds-kf-btn"
                    title="将当前 3D 舞台加入主片时间线，即可逐帧打机位关键帧与编辑贝塞尔曲线"
                    onClick={handleAddToMainTimeline}
                  >
                    <Plus size={11} /> 放入时间线以打关键帧
                  </button>
                )}
                <select
                  aria-label="预演时长"
                  className="sds-dur-select"
                  value={String(Math.round(durationFrames / fps))}
                  onChange={(e) => {
                    const sec = Number(e.target.value) || 4;
                    setPreviewDurationSec(sec);
                    if (target.kind === 'clip' && clipObj) {
                      void onEdit(`调整 3D 镜头时长为 ${sec}s`, [
                        {
                          type: 'updateClip',
                          sequenceId: targetSeq.id,
                          clipId: clipObj.id,
                          changes: { duration: Math.max(fps, Math.round(sec * fps)) },
                        },
                      ]);
                    }
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

            {/* Scrubber Track with Golden Camera Keyframe Diamonds */}
            <div className="sds-scrubber-wrap">
              <input
                type="range"
                aria-label="3D 单镜运镜时间条"
                className="sds-scrubber"
                min={0}
                max={Math.max(1, durationFrames - 1)}
                value={clampedFrame}
                onChange={(e) => seekTo(Number(e.target.value))}
              />
              {cameraKeyframeFrames.length > 0 && (
                <div className="sds-kf-markers">
                  {cameraKeyframeFrames.map((kfFrame) => (
                    <button
                      key={kfFrame}
                      type="button"
                      className={`sds-kf-diamond ${kfFrame === clampedFrame ? 'active' : ''}`}
                      style={{ left: `${(kfFrame / Math.max(1, durationFrames - 1)) * 100}%` }}
                      title={`跳转至第 ${kfFrame} 帧机位关键帧`}
                      onClick={() => seekTo(kfFrame)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Inline Cubic-Bezier 3D Camera Curve Drawer */}
            {curveOpen && studioCurveClip && (
              <div className="sds-curve-drawer" aria-label="3D 摄像机贝塞尔曲线编辑器">
                <TimelineCurveHeader
                  clip={studioCurveClip}
                  sequenceId={targetSeq.id}
                  prop={curveProp}
                  allowedProperties={CAMERA_KF_TRACKS}
                  selectedFrame={curveSelectedFrame}
                  currentFrame={clampedFrame}
                  onChangeProp={setCurveProp}
                  onSelectFrame={setCurveSelectedFrame}
                  onEdit={(n, ops) => void onEdit(n, ops)}
                  onClose={() => setCurveOpen(false)}
                />
                <div className="sds-curve-lane-wrap">
                  <TimelineCurveLane
                    clip={studioCurveClip}
                    sequenceId={targetSeq.id}
                    prop={curveProp}
                    totalFrames={studioCurveClip.duration}
                    selectedFrame={curveSelectedFrame}
                    onSelectFrame={setCurveSelectedFrame}
                    onSeek={(f) => seekTo(f)}
                    onEndScrub={(f) => seekTo(f)}
                    onEdit={(n, ops) => void onEdit(n, ops)}
                  />
                </div>
              </div>
            )}

            {/* Custom Persistent Multi-Camera Rig Bookmarks Bar (works for BOTH SpatialStage AND TSX 3D!) */}
            <div className="sds-bookmark-bar">
              <span className="sds-bm-label">多机位</span>
              <div className="sds-bm-list">
                {cameraBookmarks.map((bm) => {
                  const isActive = activeBookmarkId === bm.id;
                  const isRenaming = renamingBmId === bm.id;
                  return (
                    <div key={bm.id} className={`sds-bm-chip-wrap ${isActive ? 'active' : ''}`}>
                      {isRenaming ? (
                        <div className="sds-bm-rename">
                          <input
                            type="text"
                            autoFocus
                            value={renamingBmDraft}
                            onChange={(e) => setRenamingBmDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameBookmarkCommit(bm.id);
                              if (e.key === 'Escape') setRenamingBmId(null);
                            }}
                            onBlur={() => handleRenameBookmarkCommit(bm.id)}
                          />
                          <button type="button" onMouseDown={() => handleRenameBookmarkCommit(bm.id)}>
                            <Check size={10} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`sds-bm-chip ${isActive ? 'active' : ''}`}
                          title={`单击切换 ${bm.label}（${bm.cameraLens}mm）；Shift+点击打关键帧；双击重命名`}
                          onClick={(e) => applyBookmark(bm, e.shiftKey)}
                          onDoubleClick={() => {
                            setRenamingBmId(bm.id);
                            setRenamingBmDraft(bm.label);
                          }}
                        >
                          <b>{bm.shortKey}</b>
                          <span>{bm.label.replace(/^[A-Z]\s*机?\s*[·•-]?\s*/, '')}</span>
                          <small>{bm.cameraLens}mm</small>
                        </button>
                      )}
                      {cameraBookmarks.length > 1 && !isRenaming && (
                        <button
                          type="button"
                          className="sds-bm-del"
                          aria-label={`删除机位 ${bm.label}`}
                          title="删除此机位"
                          onClick={() => handleDeleteBookmark(bm.id)}
                        >
                          <X size={9} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="sds-bm-actions">
                <button
                  type="button"
                  className="sds-bm-action-btn"
                  title="将当前视口机位姿态保存到选中的机位书签"
                  onClick={handleUpdateActiveBookmark}
                >
                  <Save size={10} /> 更新机位
                </button>
                <button
                  type="button"
                  className="sds-bm-action-btn"
                  title="把当前视口机位存为新的自定义机位（用于多机位批量出分镜）"
                  onClick={handleSaveNewBookmark}
                >
                  <Plus size={10} /> 存为新机位
                </button>
              </div>
            </div>
          </footer>
        </div>

        {/* Right Resizable Director / Scene Graph Objects / Native Agent Panel */}
        <aside className="sds-inspector">
          <div
            className="sds-resizer"
            role="separator"
            aria-label="调整导演棚右侧栏宽度"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuenow={rightWidth}
            title="拖动调整右侧面板宽度（双击恢复默认 368px）"
            onPointerDown={handleRightResize}
            onDoubleClick={() => {
              setRightWidth(368);
              localStorage.setItem('cc-sds-right-width', '368');
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
          <div className={`sds-tabs ${isSpatialStageTarget ? 'three-col' : ''}`}>
            <button
              type="button"
              className={rightTab === 'direct' ? 'active' : ''}
              onClick={() => setRightTab('direct')}
            >
              <SlidersHorizontal size={12} /> 导演调度
            </button>
            {isSpatialStageTarget && (
              <button
                type="button"
                className={rightTab === 'objects' ? 'active' : ''}
                onClick={() => setRightTab('objects')}
              >
                <Box size={12} /> 场内物体{stageObjects.length > 0 ? ` (${stageObjects.length})` : ''}
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

          {rightTab === 'direct' ? (
            <div className="sds-panel-scroll">
              {/* Universal Director Camera Controls (works for BOTH SpatialStage AND custom TSX 3D components!) */}
              <section className="sds-group">
                <h4>摄像机运镜与焦段</h4>
                {isSpatialStageTarget && (
                  <label className="sds-field">
                    <span>运镜轨迹</span>
                    <select
                      value={String(currentProps.cameraPreset || 'dolly-in')}
                      onChange={(e) => commitPropPatch('修改运镜模式', { cameraPreset: e.target.value }, false)}
                    >
                      {CAMERA_PRESET_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="sds-chip-row">
                  {[24, 35, 50, 85].map((mm) => (
                    <button
                      key={mm}
                      type="button"
                      className={resolvedCam.hasExplicitLens && Math.round(resolvedCam.lens) === mm ? 'active' : ''}
                      onClick={() => commitPropPatch(`切焦段 ${mm}mm`, { cameraLens: mm })}
                    >
                      {mm}mm
                    </button>
                  ))}
                </div>
                <label className="sds-slider">
                  <div>
                    <span>水平旋转 Yaw</span>
                    <b>{Math.round(resolvedCam.yaw)}°</b>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={Math.round(resolvedCam.yaw)}
                    onChange={(e) => commitPropPatch('调整水平角', { cameraYaw: Number(e.target.value) })}
                  />
                </label>
                <label className="sds-slider">
                  <div>
                    <span>俯仰角 Pitch</span>
                    <b>{Math.round(resolvedCam.pitch)}°</b>
                  </div>
                  <input
                    type="range"
                    min={-75}
                    max={80}
                    step={1}
                    value={Math.round(resolvedCam.pitch)}
                    onChange={(e) => commitPropPatch('调整俯仰角', { cameraPitch: Number(e.target.value) })}
                  />
                </label>
                <label className="sds-slider">
                  <div>
                    <span>机位推拉倍率 Distance</span>
                    <b>{resolvedCam.distance.toFixed(2)}×</b>
                  </div>
                  <input
                    type="range"
                    min={0.35}
                    max={3.0}
                    step={0.05}
                    value={resolvedCam.distance}
                    onChange={(e) => commitPropPatch('调整机位距离', { cameraDistance: Number(e.target.value) })}
                  />
                </label>
              </section>

              {isSpatialStageTarget ? (
                <>
                  <section className="sds-group">
                    <h4>舞台模式、影调与布光</h4>
                    <label className="sds-field">
                      <span>舞台模式</span>
                      <select
                        value={currentSceneType}
                        onChange={(e) => commitPropPatch('切换 3D 舞台模式', { sceneType: e.target.value }, false)}
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
                          onChange={(e) =>
                            commitPropPatch('切换 3D 舞台环境', { environmentPreset: e.target.value }, false)
                          }
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
                          onChange={(e) => commitPropPatch('切换硬件设备', { deviceType: e.target.value }, false)}
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
                        onChange={(e) => commitPropPatch('切换影调风格', { lookPreset: e.target.value }, false)}
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
                          onClick={() => commitPropPatch(`切换布光「${l.label}」`, { lightingPreset: l.id }, false)}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                    <label className="sds-slider">
                      <div>
                        <span>主光方位 Key Yaw</span>
                        <b>{Math.round(keyLightYawVal)}°</b>
                      </div>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={2}
                        value={Math.round(keyLightYawVal)}
                        onChange={(e) => commitPropPatch('旋转主光方位', { keyLightYaw: Number(e.target.value) }, false)}
                      />
                    </label>
                    <label className="sds-slider">
                      <div>
                        <span className="sds-temp-label">
                          主光色温
                          <i className="sds-temp-dot" style={{ background: kelvinToHex(keyLightTempVal) }} />
                        </span>
                        <b>{Math.round(keyLightTempVal)}K</b>
                      </div>
                      <input
                        type="range"
                        min={2600}
                        max={9000}
                        step={100}
                        value={Math.round(keyLightTempVal)}
                        onChange={(e) => commitPropPatch('调整主光色温', { keyLightTemp: Number(e.target.value) }, false)}
                      />
                    </label>
                    <label className="sds-field">
                      <span>空间氛围粒子</span>
                      <select
                        value={String(currentProps.particles3D || 'none')}
                        onChange={(e) => commitPropPatch('调整氛围粒子', { particles3D: e.target.value }, false)}
                      >
                        {PARTICLES_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {currentSceneType === 'parallax-25d' && (
                      <label className="sds-slider">
                        <div>
                          <span>立体景深起伏 Depth</span>
                          <b>{Number(currentProps.depthStrength ?? 0.65).toFixed(2)}</b>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1.4}
                          step={0.05}
                          value={Number(currentProps.depthStrength ?? 0.65)}
                          onChange={(e) => commitPropPatch('调整景深起伏', { depthStrength: Number(e.target.value) }, false)}
                        />
                      </label>
                    )}
                    {(currentSceneType === 'turbine' ||
                      currentSceneType === 'chip-stack' ||
                      currentSceneType === 'factory-flow' ||
                      assetObj?.kind === 'model-3d') && (
                      <label className="sds-slider">
                        <div>
                          <span>结构爆炸拆解 Explode</span>
                          <b>{Math.round(Number(currentProps.explode ?? 0) * 100)}%</b>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={Number(currentProps.explode ?? 0)}
                          onChange={(e) => commitPropPatch('调整结构拆解', { explode: Number(e.target.value) }, false)}
                        />
                      </label>
                    )}
                    <label className="sds-slider">
                      <div>
                        <span>辉光强度 Bloom</span>
                        <b>{Math.round(Number(currentProps.bloomStrength ?? 22))}%</b>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={80}
                        step={2}
                        value={Math.round(Number(currentProps.bloomStrength ?? 22))}
                        onChange={(e) => commitPropPatch('调整辉光强度', { bloomStrength: Number(e.target.value) }, false)}
                      />
                    </label>
                  </section>

                  {currentSceneType === 'previs-blocking' && (
                    <section className="sds-group">
                      <div className="sds-group-head">
                        <h4>主角动作与走位路线</h4>
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
                          value={String(currentProps.actorAction || 'walk')}
                          onChange={(e) => commitPropPatch('调整人物动作', { actorAction: e.target.value }, false)}
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
                          value={String(currentProps.actorPath || 'approach')}
                          onChange={(e) =>
                            commitPropPatch(
                              '调整人物走线',
                              {
                                actorPath: e.target.value,
                                actorStartX: undefined,
                                actorStartZ: undefined,
                                actorEndX: undefined,
                                actorEndZ: undefined,
                              },
                              false,
                            )
                          }
                        >
                          {SPATIAL_ACTOR_PATH_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {hasCustomActorPath && (
                        <div className="sds-custom-path-row">
                          <span>
                            自定义走线：({Number(currentProps.actorStartX).toFixed(1)},{' '}
                            {Number(currentProps.actorStartZ).toFixed(1)}) → (
                            {Number(currentProps.actorEndX).toFixed(1)},{' '}
                            {Number(currentProps.actorEndZ).toFixed(1)})
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              commitPropPatch(
                                '清除自定义走线',
                                {
                                  actorStartX: undefined,
                                  actorStartZ: undefined,
                                  actorEndX: undefined,
                                  actorEndZ: undefined,
                                },
                                false,
                              )
                            }
                          >
                            重置
                          </button>
                        </div>
                      )}
                    </section>
                  )}
                </>
              ) : (
                <section className="sds-group">
                  <div className="sds-group-head">
                    <h4>TSX 组件自定义参数</h4>
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
                  {editableCompProps.length > 0 ? (
                    editableCompProps.map(([key, val]) =>
                      typeof val === 'boolean' ? (
                        <label key={key} className="sds-toggle-row">
                          <span>{key}</span>
                          <input
                            type="checkbox"
                            className="switch"
                            checked={val}
                            onChange={(e) => commitPropPatch(`调整参数 ${key}`, { [key]: e.target.checked }, false)}
                          />
                        </label>
                      ) : typeof val === 'number' ? (
                        <label key={key} className="sds-field">
                          <span>{key}</span>
                          <input
                            type="number"
                            step={Math.abs(val) <= 2 ? 0.1 : 1}
                            value={val}
                            onChange={(e) =>
                              commitPropPatch(`调整参数 ${key}`, { [key]: Number(e.target.value) }, false)
                            }
                          />
                        </label>
                      ) : (
                        <label key={key} className="sds-field">
                          <span>{key}</span>
                          <input
                            type="text"
                            value={val}
                            onChange={(e) => commitPropPatch(`调整参数 ${key}`, { [key]: e.target.value }, false)}
                          />
                        </label>
                      ),
                    )
                  ) : (
                    <div className="sds-empty-note">
                      <p>
                        上方导演机位（鼠标拖拽环绕/推拉/焦段）与 5 通道渲染已自动接管此 TSX 3D 组件，无需改写源码。
                      </p>
                      <button
                        type="button"
                        className="sds-out-btn"
                        onClick={() => {
                          setRightTab('agent');
                          onAskAgent(
                            `【3D 导演棚 · 组件 ${compObj?.name || title} (${compObj?.id || ''})】请帮我给这个 3D 场景增加可调节的建筑密度、高度缩放和氛围光效参数。`,
                            clipObj,
                          );
                        }}
                      >
                        <Sparkles size={11} /> 让 Agent 扩展场景参数
                      </button>
                    </div>
                  )}
                </section>
              )}
            </div>
          ) : rightTab === 'objects' && isSpatialStageTarget ? (
            <div className="sds-panel-scroll">
              <section className="sds-group">
                <h4>快速往舞台加物体</h4>
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
              </section>

              <section className="sds-group">
                <h4>场内物体列表 ({stageObjects.length})</h4>
                {stageObjects.length === 0 ? (
                  <div className="sds-empty-note">
                    <p>
                      当前未添加额外场内物体。点击上方按钮添加演员、2D 立牌、道具或灯光，即可在 3D 视口（摆位模式 G）或「俯视图」里直接拖拽调度。
                    </p>
                  </div>
                ) : (
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
                  <h4>选中属性 · {selectedStageObj.name}</h4>
                  <label className="sds-field">
                    <span>物体名称</span>
                    <input
                      type="text"
                      value={selectedStageObj.name}
                      onChange={(e) => updateStageObject(selectedStageObj.id, { name: e.target.value }, '重命名舞台物体')}
                    />
                  </label>
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
                  <label className="sds-slider">
                    <div>
                      <span>水平朝向 Rotation Y</span>
                      <b>{Math.round(selectedStageObj.rotationY)}°</b>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={5}
                      value={Math.round(selectedStageObj.rotationY)}
                      onChange={(e) =>
                        updateStageObject(selectedStageObj.id, { rotationY: Number(e.target.value) }, '旋转物体朝向')
                      }
                    />
                  </label>
                  <label className="sds-slider">
                    <div>
                      <span>缩放 Scale</span>
                      <b>{selectedStageObj.scale.toFixed(2)}×</b>
                    </div>
                    <input
                      type="range"
                      min={0.3}
                      max={2.6}
                      step={0.05}
                      value={selectedStageObj.scale}
                      onChange={(e) =>
                        updateStageObject(selectedStageObj.id, { scale: Number(e.target.value) }, '缩放舞台物体')
                      }
                    />
                  </label>

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
                      <label className="sds-slider">
                        <div>
                          <span>灯光强度 Intensity</span>
                          <b>{(selectedStageObj.intensity ?? 2.6).toFixed(1)}</b>
                        </div>
                        <input
                          type="range"
                          min={0.2}
                          max={8}
                          step={0.2}
                          value={selectedStageObj.intensity ?? 2.6}
                          onChange={(e) =>
                            updateStageObject(
                              selectedStageObj.id,
                              { intensity: Number(e.target.value) },
                              '调整舞台灯光强度',
                            )
                          }
                        />
                      </label>
                      <label className="sds-slider">
                        <div>
                          <span className="sds-temp-label">
                            灯光色温
                            <i
                              className="sds-temp-dot"
                              style={{ background: kelvinToHex(selectedStageObj.temperature ?? 3800) }}
                            />
                          </span>
                          <b>{Math.round(selectedStageObj.temperature ?? 3800)}K</b>
                        </div>
                        <input
                          type="range"
                          min={2200}
                          max={9000}
                          step={100}
                          value={Math.round(selectedStageObj.temperature ?? 3800)}
                          onChange={(e) =>
                            updateStageObject(
                              selectedStageObj.id,
                              { temperature: Number(e.target.value) },
                              '调整舞台灯光色温',
                            )
                          }
                        />
                      </label>
                    </>
                  )}

                  {selectedStageObj.kind !== 'light' && selectedStageObj.kind !== 'glb' && (
                    <label className="sds-field">
                      <span>主色调</span>
                      <input
                        type="color"
                        value={selectedStageObj.color || '#64748b'}
                        onChange={(e) =>
                          updateStageObject(selectedStageObj.id, { color: e.target.value }, '修改物体颜色')
                        }
                      />
                    </label>
                  )}
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
