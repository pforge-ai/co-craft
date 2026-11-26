import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Box,
  Cable,
  Camera,
  Clapperboard,
  Code2,
  Diamond,
  Film,
  Grid3X3,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  SkipBack,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { evaluateKeyframeTrack, removeClipKeyframe, upsertClipKeyframe } from '../core/keyframes';
import { clone, newClip, timecode, uid } from '../core/project';
import {
  DEFAULT_SPATIAL_BOOKMARKS,
  SPATIAL_ACTOR_ACTION_OPTIONS,
  SPATIAL_ACTOR_PATH_OPTIONS,
  SPATIAL_ENVIRONMENT_OPTIONS,
  SPATIAL_RENDER_PASS_OPTIONS,
  isSpatialClip,
  isSplatAssetPath,
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
}

type FrameGuide = 'off' | 'thirds' | 'vertical-safe' | 'scope-239';

const CAMERA_PRESET_OPTIONS = [
  { id: 'orbit', label: '环绕运镜' },
  { id: 'dolly-in', label: '推近镜头' },
  { id: 'crane-up', label: '摇臂拉升' },
  { id: 'push-focus', label: '焦点推进' },
  { id: 'hero-low', label: '低机位仰拍' },
  { id: 'isometric', label: '等轴建筑' },
  { id: 'top-down', label: '上帝俯瞰' },
  { id: 'static', label: '固定机位' },
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
  onBakeVideo,
  onAskAgent,
  onOpenCodeEditor,
  onOpenMcpSettings,
}: SpatialDirectorStudioProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rightTab, setRightTab] = useState<'direct' | 'ai'>('direct');
  const [frameGuide, setFrameGuide] = useState<FrameGuide>('thirds');
  const [previewDurationSec, setPreviewDurationSec] = useState(4);
  const [agentInput, setAgentInput] = useState('');
  const [assetPropsLocal, setAssetPropsLocal] = useState<Record<string, unknown>>({
    cameraPreset: 'orbit',
    cameraLens: 35,
    cameraYaw: 0,
    cameraPitch: 12,
    cameraDistance: 5.4,
    cameraPanX: 0,
    cameraPanY: 0,
    lightingPreset: 'studio',
    renderPass: 'beauty',
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

  const badgeLabel = isCodeTarget
    ? 'TSX 3D 组件'
    : isSplat
      ? '3DGS 空间世界'
      : String(clipObj?.props?.sceneType || vaultObj?.rig?.props?.sceneType || '') === '25d-parallax'
        ? '2.5D 立体景深'
        : '3D 导演摄影棚';

  const currentProps: Record<string, unknown> = useMemo(() => {
    if (target.kind === 'clip' && clipObj) {
      return isCodeTarget ? { ...(compObj?.props || {}), ...clipObj.props } : { ...clipObj.props };
    }
    if (target.kind === 'vault' && vaultObj) {
      return { ...(vaultObj.rig?.props || {}), ...(vaultObj.rig?.presetId ? { presetId: vaultObj.rig.presetId } : {}) };
    }
    if (target.kind === 'component' && compObj) {
      return { ...(compObj.props || {}) };
    }
    return assetPropsLocal;
  }, [target.kind, clipObj, vaultObj, compObj, isCodeTarget, assetPropsLocal]);

  const fps = targetSeq.fps || 30;
  const durationFrames = Math.max(
    fps,
    target.kind === 'clip' && clipObj ? clipObj.duration : Math.round(previewDurationSec * fps),
  );
  const clampedFrame = Math.max(0, Math.min(durationFrames - 1, frame));

  // Resolve current camera values (honoring clip keyframes if present)
  const resolvedCam = useMemo(() => {
    const evalNum = (track: KeyframeProperty, fallback: number) => {
      const base = Number(currentProps[track] ?? fallback);
      if (target.kind === 'clip' && clipObj?.keyframes?.[track]?.length) {
        return evaluateKeyframeTrack(clipObj.keyframes[track], clampedFrame, base);
      }
      return base;
    };
    return {
      yaw: liveHud?.yaw ?? evalNum('cameraYaw', 0),
      pitch: liveHud?.pitch ?? evalNum('cameraPitch', 12),
      distance: liveHud?.distance ?? evalNum('cameraDistance', 5.4),
      panX: liveHud?.panX ?? evalNum('cameraPanX', 0),
      panY: liveHud?.panY ?? evalNum('cameraPanY', 0),
      lens: liveHud?.lens ?? evalNum('cameraLens', 35),
    };
  }, [currentProps, target.kind, clipObj, clampedFrame, liveHud]);

  const supportsDirectOrbit =
    isSpatialStageTarget ||
    'cameraYaw' in currentProps ||
    'cameraPitch' in currentProps ||
    'cameraDistance' in currentProps;

  // Build isolated 1-clip synthetic project for the studio's dedicated preview iframe
  const STUDIO_SEQ_ID = 'seq_spatial_director_studio';
  const STUDIO_CLIP_ID = 'clip_spatial_director_studio';
  const studioProject = useMemo<Project>(() => {
    const base = clone(project);
    const clipProps = isCodeTarget
      ? { ...currentProps }
      : { ...currentProps, showHud: false };
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
  }, [project, targetSeq, title, isCodeTarget, clipObj, assetObj, vaultObj, compObj, currentProps, durationFrames]);

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
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
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

  // Studio keyboard shortcuts (Space, Arrows, K, WASD/QE, Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
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
      if (e.key.toLowerCase() === 'k' && target.kind === 'clip' && supportsDirectOrbit) {
        e.preventDefault();
        dropCameraKeyframe();
        return;
      }
      if (supportsDirectOrbit) {
        const k = e.key.toLowerCase();
        if (['w', 's', 'a', 'd', 'q', 'e'].includes(k)) {
          e.preventDefault();
          const step = e.shiftKey ? 0.5 : 0.22;
          if (k === 'w') {
            commitPropPatch('推近镜头', { cameraDistance: Math.max(1.5, Math.round((resolvedCam.distance - step) * 100) / 100) });
          } else if (k === 's') {
            commitPropPatch('拉远镜头', { cameraDistance: Math.min(18, Math.round((resolvedCam.distance + step) * 100) / 100) });
          } else if (k === 'a') {
            commitPropPatch('左移机位', { cameraPanX: Math.max(-5, Math.round((resolvedCam.panX - step) * 100) / 100) });
          } else if (k === 'd') {
            commitPropPatch('右移机位', { cameraPanX: Math.min(5, Math.round((resolvedCam.panX + step) * 100) / 100) });
          } else if (k === 'e') {
            commitPropPatch('抬升机位', { cameraPanY: Math.min(4, Math.round((resolvedCam.panY + step) * 100) / 100) });
          } else if (k === 'q') {
            commitPropPatch('压低机位', { cameraPanY: Math.max(-4, Math.round((resolvedCam.panY - step) * 100) / 100) });
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, togglePlay, seekTo, clampedFrame, target.kind, supportsDirectOrbit, dropCameraKeyframe, commitPropPatch, resolvedCam]);

  // Native 3D viewport pointer interaction: Left=Orbit, Right/Shift/Middle=Pan, Wheel=Dolly/Lens
  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!supportsDirectOrbit) return;
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
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
      postToStage('live-transform', {
        override: {
          clipId: STUDIO_CLIP_ID,
          props: {
            cameraYaw: latest.yaw,
            cameraPitch: latest.pitch,
            cameraPanX: latest.panX,
            cameraPanY: latest.panY,
          },
        },
      });
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (isPan) {
        latest = {
          ...startCam,
          panX: Math.max(-6, Math.min(6, Math.round((startCam.panX - dx * 0.008) * 100) / 100)),
          panY: Math.max(-5, Math.min(5, Math.round((startCam.panY + dy * 0.008) * 100) / 100)),
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
      const nextDist = Math.max(1.4, Math.min(20, Math.round((resolvedCam.distance + e.deltaY * 0.006) * 100) / 100));
      if (nextDist !== resolvedCam.distance) commitPropPatch('推拉机位距离', { cameraDistance: nextDist });
    }
  };

  const enabledMcpServers = (settings.mcpServers || []).filter((s) => s.enabled);
  const blenderMcp = enabledMcpServers.find((s) => /blender/i.test(s.name) || s.preset === 'blender');

  const capturePayload = {
    clipId: target.kind === 'clip' ? clipObj?.id : undefined,
    vaultItemId: target.kind === 'vault' ? vaultObj?.id : undefined,
    componentId: target.kind === 'component' ? compObj?.id : undefined,
    assetId: target.kind === 'asset' ? assetObj?.id : undefined,
  };

  const editableCompProps = useMemo(() => {
    if (!isCodeTarget) return [] as Array<[string, string | number | boolean]>;
    return Object.entries(currentProps).filter(
      ([, v]) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string',
    ) as Array<[string, string | number | boolean]>;
  }, [isCodeTarget, currentProps]);

  const sendDirectorPrompt = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setAgentInput('');
    const prefix = isCodeTarget && compObj
      ? `【3D 导演棚 · 组件 ${compObj.name} (${compObj.id})】`
      : `【3D 导演棚 · ${title}】`;
    onAskAgent(`${prefix}${clean}`, clipObj);
  };

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
          {isSpatialStageTarget && (
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
          )}
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
            className={`sds-mcp-pill ${blenderMcp ? 'connected' : ''}`}
            title={
              blenderMcp
                ? `已配置 ${blenderMcp.name} MCP，点击在 AI 协同栏联动 Blender`
                : '配置 Blender MCP 或其他外部 MCP 服务'
            }
            onClick={() => (blenderMcp ? setRightTab('ai') : onOpenMcpSettings())}
          >
            <Cable size={12} />
            {blenderMcp ? 'Blender MCP' : '接 Blender MCP'}
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
          {isSpatialStageTarget && (
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
          )}
          <button
            type="button"
            className="sds-out-btn"
            title="双拍首尾帧送入画布并自动连入首尾帧生视频工坊"
            onClick={() =>
              void onCapturePair({
                ...capturePayload,
                startBookmarkId: 'cam-a',
                endBookmarkId: 'cam-b',
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

      {/* Main Studio Body: 75% Interactive 3D Viewport + 25% Director Inspector */}
      <div className="sds-body">
        <div className="sds-viewport-col">
          <div
            className="sds-viewport-stage"
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={handleViewportPointerDown}
            onWheel={handleViewportWheel}
          >
            <div
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

            {/* Subtle Floating Camera Telemetry HUD */}
            <div className="sds-cam-hud" onPointerDown={(e) => e.stopPropagation()}>
              {supportsDirectOrbit ? (
                <>
                  <span>
                    Yaw {Math.round(resolvedCam.yaw)}° · Pitch {Math.round(resolvedCam.pitch)}° · Dist{' '}
                    {resolvedCam.distance.toFixed(1)} · {Math.round(resolvedCam.lens)}mm
                  </span>
                  <span className="sds-cam-hint">左键旋转 · 右键/Shift 平移 · 滚轮推拉 · WASD 游走</span>
                  <button
                    type="button"
                    title="复位摄像机机位"
                    onClick={() =>
                      commitPropPatch('复位 3D 机位', {
                        cameraYaw: 0,
                        cameraPitch: 12,
                        cameraDistance: 5.4,
                        cameraPanX: 0,
                        cameraPanY: 0,
                        cameraLens: 35,
                      })
                    }
                  >
                    <RotateCcw size={11} /> 复位
                  </button>
                </>
              ) : (
                <span>
                  自定义 TSX 3D 舞台 · 第 {clampedFrame} 帧（右侧可直接调组件参数或让 AI 暴露交互机位）
                </span>
              )}
            </div>
          </div>

          {/* Dedicated Single-Shot Camera & Blocking Rail (Zero NLE Track Clutter!) */}
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
                {target.kind === 'clip' && supportsDirectOrbit && (
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
                  </>
                )}
                {target.kind !== 'clip' && (
                  <button
                    type="button"
                    className="sds-kf-btn"
                    title="将当前 3D 舞台加入主片时间线，即可逐帧打机位关键帧"
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

            {/* A/B/C/D Camera Bookmarks Quick Bar */}
            {isSpatialStageTarget && (
              <div className="sds-bookmark-bar">
                <span className="sds-bm-label">机位书签</span>
                {DEFAULT_SPATIAL_BOOKMARKS.map((bm) => {
                  const isActive = String(currentProps.activeBookmarkId || '') === bm.id;
                  return (
                    <button
                      key={bm.id}
                      type="button"
                      className={`sds-bm-chip ${isActive ? 'active' : ''}`}
                      title={`点击切换 ${bm.label}（${bm.cameraLens}mm）；按住 Shift 点击直接打关键帧`}
                      onClick={(e) => {
                        const patch = {
                          activeBookmarkId: bm.id,
                          cameraPreset: bm.cameraPreset,
                          cameraLens: bm.cameraLens,
                          cameraYaw: bm.cameraYaw,
                          cameraPitch: bm.cameraPitch,
                          cameraDistance: bm.cameraDistance,
                          cameraPanX: bm.cameraPanX ?? 0,
                          cameraPanY: bm.cameraPanY ?? 0,
                        };
                        commitPropPatch(`切换至 ${bm.label}`, patch, true);
                        if (e.shiftKey && target.kind === 'clip' && clipObj) {
                          let nextKf = clipObj.keyframes;
                          nextKf = upsertClipKeyframe(nextKf, 'cameraYaw', clampedFrame, bm.cameraYaw, 'ease-in-out');
                          nextKf = upsertClipKeyframe(nextKf, 'cameraPitch', clampedFrame, bm.cameraPitch, 'ease-in-out');
                          nextKf = upsertClipKeyframe(nextKf, 'cameraDistance', clampedFrame, bm.cameraDistance, 'ease-in-out');
                          nextKf = upsertClipKeyframe(nextKf, 'cameraLens', clampedFrame, bm.cameraLens, 'ease-in-out');
                          void onEdit(`在 f${clampedFrame} 打入 ${bm.label} 关键帧`, [
                            {
                              type: 'updateClip',
                              sequenceId: targetSeq.id,
                              clipId: clipObj.id,
                              changes: { props: patch, keyframes: nextKf },
                            },
                          ]);
                        }
                      }}
                    >
                      <b>{bm.shortKey}</b>
                      <span>{bm.label.replace(/^[A-D]\s*机?\s*[·•-]?\s*/, '')}</span>
                      <small>{bm.cameraLens}mm</small>
                    </button>
                  );
                })}
              </div>
            )}
          </footer>
        </div>

        {/* Right Focused 3D Director Panel */}
        <aside className="sds-inspector">
          <div className="sds-tabs">
            <button
              type="button"
              className={rightTab === 'direct' ? 'active' : ''}
              onClick={() => setRightTab('direct')}
            >
              <SlidersHorizontal size={12} /> 导演调度
            </button>
            <button
              type="button"
              className={rightTab === 'ai' ? 'active' : ''}
              onClick={() => setRightTab('ai')}
            >
              <Wand2 size={12} /> AI 与 MCP 协同
            </button>
          </div>

          {rightTab === 'direct' ? (
            <div className="sds-panel-scroll">
              {isSpatialStageTarget ? (
                <>
                  <section className="sds-group">
                    <h4>摄像机运镜与焦段</h4>
                    <label className="sds-field">
                      <span>运镜轨迹</span>
                      <select
                        value={String(currentProps.cameraPreset || 'orbit')}
                        onChange={(e) => commitPropPatch('修改运镜模式', { cameraPreset: e.target.value }, false)}
                      >
                        {CAMERA_PRESET_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="sds-chip-row">
                      {[24, 35, 50, 85].map((mm) => (
                        <button
                          key={mm}
                          type="button"
                          className={Math.round(resolvedCam.lens) === mm ? 'active' : ''}
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
                        min={-60}
                        max={80}
                        step={1}
                        value={Math.round(resolvedCam.pitch)}
                        onChange={(e) => commitPropPatch('调整俯仰角', { cameraPitch: Number(e.target.value) })}
                      />
                    </label>
                    <label className="sds-slider">
                      <div>
                        <span>机位距离 Distance</span>
                        <b>{resolvedCam.distance.toFixed(1)}</b>
                      </div>
                      <input
                        type="range"
                        min={1.8}
                        max={14}
                        step={0.1}
                        value={resolvedCam.distance}
                        onChange={(e) => commitPropPatch('调整机位距离', { cameraDistance: Number(e.target.value) })}
                      />
                    </label>
                  </section>

                  <section className="sds-group">
                    <h4>舞台环境与光效</h4>
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
                  </section>

                  <section className="sds-group">
                    <h4>人物动作与走线</h4>
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
                      <span>走位路线</span>
                      <select
                        value={String(currentProps.actorPath || 'approach')}
                        onChange={(e) => commitPropPatch('调整人物走线', { actorPath: e.target.value }, false)}
                      >
                        {SPATIAL_ACTOR_PATH_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </section>
                </>
              ) : (
                <section className="sds-group">
                  <div className="sds-group-head">
                    <h4>TSX 3D 组件参数</h4>
                    {compObj && onOpenCodeEditor && (
                      <button
                        type="button"
                        className="sds-link-btn"
                        onClick={() => onOpenCodeEditor(compObj.id)}
                      >
                        <Code2 size={11} /> 源码
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
                      <p>当前 TSX 组件暂未暴露可调参数。</p>
                      <button
                        type="button"
                        className="sds-out-btn"
                        onClick={() =>
                          sendDirectorPrompt(
                            '请为这个 3D TSX 组件增加可交互的 cameraYaw、cameraPitch、cameraDistance、cameraSpeed 与 lightingMood 可调参数，并确保在导演棚里能用鼠标拖拽自由环绕运镜。',
                          )
                        }
                      >
                        <Sparkles size={11} /> 让 AI 补充可调机位参数
                      </button>
                    </div>
                  )}
                </section>
              )}
            </div>
          ) : (
            <div className="sds-panel-scroll">
              <section className="sds-group">
                <h4>导演自然语言调度</h4>
                <p className="sds-muted">
                  直接描述镜头轨迹、人物走位、光影风格或让 Agent 调用外部 MCP 服务（如 Blender）联动生成资产。
                </p>
                <div className="sds-prompt-box">
                  <textarea
                    rows={3}
                    placeholder="例如：把摄像机压低做低空掠过推进，加入冷暖对比体积雾，然后录成 3 秒预演视频…"
                    value={agentInput}
                    onChange={(e) => setAgentInput(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        sendDirectorPrompt(agentInput);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="sds-send-btn"
                    disabled={!agentInput.trim()}
                    onClick={() => sendDirectorPrompt(agentInput)}
                  >
                    <Send size={12} /> 发送给 Agent（⌘↵）
                  </button>
                </div>
                <div className="sds-quick-chips">
                  {[
                    '改为低空环绕推进镜头，增强电影纵深感',
                    '切换黄金时刻逆光剪影，增加柔和雾气氛围',
                    '让人物从远景沿弧线走近中景特写并转身',
                    '切为极简建筑白模，增强阴影对比',
                  ].map((preset) => (
                    <button key={preset} type="button" onClick={() => sendDirectorPrompt(preset)}>
                      {preset}
                    </button>
                  ))}
                </div>
              </section>

              <section className="sds-group">
                <div className="sds-group-head">
                  <h4>外部 MCP 3D 联动</h4>
                  <button type="button" className="sds-link-btn" onClick={onOpenMcpSettings}>
                    管理 MCP
                  </button>
                </div>
                {blenderMcp ? (
                  <div className="sds-mcp-card active">
                    <b>已启用 · {blenderMcp.name}</b>
                    <p>内置 Agent 可直接调用 Blender MCP 工具建模、打光与导出资产回 CoCraft。</p>
                    <div className="sds-quick-chips">
                      <button
                        type="button"
                        onClick={() =>
                          sendDirectorPrompt(
                            '通过 Blender MCP 查看当前场景并优化布光，将场景导出为 .glb 文件保存到工作区并调用 import_asset 导入 CoCraft。',
                          )
                        }
                      >
                        同步 Blender 场景导出 .glb 导入
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          sendDirectorPrompt(
                            '通过 Blender MCP 渲染一张高清透视参考图保存到工作区并调用 import_asset 导入画布。',
                          )
                        }
                      >
                        用 Blender 渲染参考帧回画布
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="sds-mcp-card">
                    <b>尚未连接 Blender MCP</b>
                    <p>在「设置 → MCP 服务」一键添加 Blender MCP（uvx blender-mcp），即可让内置 Agent 跨软件联动建模与渲染。</p>
                    <button type="button" className="sds-out-btn" onClick={onOpenMcpSettings}>
                      <Cable size={12} /> 前往配置 Blender MCP
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
