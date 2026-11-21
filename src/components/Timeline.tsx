import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Volume2,
  VolumeX,
  Type,
  Film,
  Layers,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import type { Sequence, Clip, Project, EditOperation, Track, TransitionType, Asset } from '../core/types';
import { BUILT_IN_TRANSITIONS } from '../core/presets';
import { durationOf, splitOperations, timecode, timecodeFrames } from '../core/project';
import { mediaUrl } from '../composition/Film';
import { pointerDrag } from '../lib/pointerDrag';
import type { PlayheadClock } from '../lib/playheadClock';

const WaveformSvg = React.memo(function WaveformSvg({
  waveform,
  sourceIn,
  clipDuration,
  assetDurationFrames,
  volume,
  bars,
  isVideo,
}: {
  waveform: number[];
  sourceIn: number;
  clipDuration: number;
  assetDurationFrames: number;
  volume: number;
  bars: number;
  isVideo: boolean;
}) {
  const pathD = useMemo(() => {
    const count = Math.max(16, Math.min(120, bars));
    const step = 100 / count;
    const barW = Math.max(0.35, step * 0.56);
    const volScale = Math.min(1, volume);
    const segs: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.min(
        waveform.length - 1,
        Math.floor(((sourceIn + (i / count) * clipDuration) / Math.max(1, assetDurationFrames)) * waveform.length),
      );
      const amp = waveform[idx] || 0;
      const h = Math.max(2, Math.min(30, (0.08 + amp * (isVideo ? 0.55 : 0.86) * volScale) * 32));
      const x = i * step;
      const y = 32 - h;
      segs.push(`M${x.toFixed(1)},32V${y.toFixed(1)}h${barW.toFixed(2)}V32Z`);
    }
    return segs.join('');
  }, [waveform, sourceIn, clipDuration, assetDurationFrames, volume, bars, isVideo]);

  return (
    <div className={`waveform ${isVideo ? 'video-wave' : ''}`}>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <path d={pathD} fill="currentColor" />
      </svg>
    </div>
  );
});

const tracks: { id: Track; code: string; label: string; icon: typeof Film }[] = [
  { id: 'overlay', code: 'V2', label: '叠加', icon: Layers },
  { id: 'visual', code: 'V1', label: '主镜', icon: Film },
  { id: 'caption', code: 'T1', label: '字幕', icon: Type },
  { id: 'audio', code: 'A1', label: '声音', icon: Volume2 },
];

const TICK_STEPS = [0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

type LaneRow = {
  id: Track;
  code: string;
  label: string;
  icon: typeof Film;
  clips: Clip[];
  index: number;
  key: string;
};

const TimelineTrackLabels = React.memo(function TimelineTrackLabels({
  labelsRef,
  fps,
  rows,
  overlayCount,
  allClips,
  mutedSet,
  onToggleLock,
  onToggleVisMute,
}: {
  labelsRef: React.RefObject<HTMLDivElement | null>;
  fps: number;
  rows: LaneRow[];
  overlayCount: number;
  allClips: Clip[];
  mutedSet: Set<Track>;
  onToggleLock: (trackId: Track) => void;
  onToggleVisMute: (trackId: Track) => void;
}) {
  return (
    <div className="track-labels" ref={labelsRef}>
      <div className="ruler-label">{fps} FPS</div>
      {rows.map((t) => {
        const isHiddenOrMuted = mutedSet.has(t.id);
        const isAudio = t.id === 'audio';
        const trackClips = allClips.filter((c) => c.track === t.id);
        const trackLocked = trackClips.length > 0 && trackClips.every((c) => c.locked);
        const displayCode =
          t.id === 'overlay'
            ? `V${overlayCount + 1 - t.index}`
            : t.index === 0
              ? t.code
              : `${t.code[0]}${t.index + 1}`;
        return (
          <div key={t.key} className={`track-label ${t.id} ${isHiddenOrMuted ? 'is-muted' : ''}`}>
            <b className="track-code">{displayCode}</b>
            <span>{t.label}</span>
            {t.index === 0 && (
              <div className="track-head-acts">
                <button
                  type="button"
                  className={`track-head-btn ${trackLocked ? 'locked-active' : ''}`}
                  aria-label={`${trackLocked ? '解锁' : '锁定'}${t.label}轨`}
                  title={`${trackLocked ? '解锁整条' : '锁定整条'}${t.label}轨`}
                  disabled={!trackClips.length}
                  onClick={() => onToggleLock(t.id)}
                >
                  {trackLocked ? <Lock size={10} /> : <Unlock size={10} />}
                </button>
                <button
                  type="button"
                  className={`track-mute-btn ${isHiddenOrMuted ? 'active' : ''}`}
                  aria-label={
                    isAudio
                      ? `${isHiddenOrMuted ? '取消静音' : '静音'}${t.label}轨`
                      : `${isHiddenOrMuted ? '显示' : '隐藏'}${t.label}轨`
                  }
                  title={
                    isAudio
                      ? `${isHiddenOrMuted ? '恢复声音' : '静音'}音频轨`
                      : `${isHiddenOrMuted ? '显示' : '隐藏'}${t.label}轨画面`
                  }
                  onClick={() => onToggleVisMute(t.id)}
                >
                  {isAudio ? (
                    isHiddenOrMuted ? <VolumeX size={11} /> : <Volume2 size={11} />
                  ) : isHiddenOrMuted ? (
                    <EyeOff size={11} />
                  ) : (
                    <Eye size={11} />
                  )}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

const TimelineRuler = React.memo(function TimelineRuler({
  ticks,
  totalFrames,
  fps,
  showFramePrecision,
  onStartScrub,
}: {
  ticks: number[];
  totalFrames: number;
  fps: number;
  showFramePrecision: boolean;
  onStartScrub: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="ruler" onPointerDown={onStartScrub}>
      {ticks.map((tickFrame, i) => (
        <span style={{ left: `${(tickFrame / totalFrames) * 100}%` }} key={i}>
          {showFramePrecision ? timecodeFrames(tickFrame, fps) : timecode(tickFrame, fps).slice(0, 5)}
        </span>
      ))}
    </div>
  );
});

const TimelineLanes = React.memo(function TimelineLanes({
  rows,
  mutedSet,
  assetsById,
  fps,
  totalFrames,
  contentWidth,
  selected,
  selectedIds,
  drag,
  toolMode,
  mediaOrigin,
  onLaneClick,
  onAssetDropAt,
  onClipDragStart,
  onClipRazorHover,
  onClipDoubleClick,
  onClipSelect,
  onApplyTransition,
}: {
  rows: LaneRow[];
  mutedSet: Set<Track>;
  assetsById: Map<string, Asset>;
  fps: number;
  totalFrames: number;
  contentWidth: number;
  selected: string | null;
  selectedIds: string[];
  drag: { id: string; start: number; duration: number; sourceIn: number; snapFrame?: number } | null;
  toolMode: 'select' | 'razor';
  mediaOrigin: string;
  onLaneClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onAssetDropAt: (payload: string, target: HTMLDivElement, clientX: number) => void;
  onClipDragStart: (e: React.PointerEvent<HTMLElement>, clip: Clip, mode: 'move' | 'in' | 'out') => void;
  onClipRazorHover: (e: React.PointerEvent<HTMLDivElement>, clip: Clip) => void;
  onClipDoubleClick: (start: number) => void;
  onClipSelect: (id: string | null, additive?: boolean) => void;
  onApplyTransition: (clip: Clip, trType: TransitionType) => void;
}) {
  const selectedSet = useMemo(() => {
    const s = new Set(selectedIds);
    if (selected) s.add(selected);
    return s;
  }, [selectedIds, selected]);
  return (
    <>
      {rows.map((track) => {
        const isMuted = mutedSet.has(track.id);
        return (
          <div
            className={`lane ${track.id} ${isMuted ? 'lane-muted' : ''}`}
            key={track.key}
            onClick={onLaneClick}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/cocraft-asset')) e.preventDefault();
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData('application/cocraft-asset');
              if (id) {
                e.preventDefault();
                e.stopPropagation();
                onAssetDropAt(id, e.currentTarget, e.clientX);
              }
            }}
          >
            {track.clips.map((c) => {
              const clip = drag?.id === c.id ? { ...c, ...drag } : c;
              const asset = c.assetId ? assetsById.get(c.assetId) : undefined;
              const clipPxWidth = (clip.duration / totalFrames) * contentWidth;
              const waveBars = Math.max(24, Math.min(120, Math.round(clipPxWidth / 4)));
              const showWave = (c.kind === 'audio' || c.kind === 'video') && !!asset?.waveform?.length;
              const trMeta = c.transitionIn
                ? BUILT_IN_TRANSITIONS.find((x) => x.id === c.transitionIn?.type)
                : undefined;
              const isSelected = selectedSet.has(c.id);
              const isPrimarySelected = selected === c.id;
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`片段 ${c.name}`}
                  aria-pressed={isSelected}
                  className={`timeline-clip ${c.kind} ${isSelected ? 'selected' : ''} ${c.locked ? 'locked' : ''} ${asset?.offline ? 'offline' : ''} ${drag?.id === c.id ? 'dragging' : ''}`}
                  style={{
                    left: `${(clip.start / totalFrames) * 100}%`,
                    width: `${(clip.duration / totalFrames) * 100}%`,
                  }}
                  onPointerDown={(e) => onClipDragStart(e, c, 'move')}
                  onPointerMove={(e) => {
                    if (toolMode === 'razor') onClipRazorHover(e, c);
                  }}
                  onDoubleClick={() => onClipDoubleClick(c.start)}
                  onDragOver={(e) => {
                    if (
                      e.dataTransfer.types.includes('application/cocraft-transition') &&
                      c.kind !== 'audio' &&
                      !c.locked
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  onDrop={(e) => {
                    const trType = e.dataTransfer.getData('application/cocraft-transition') as TransitionType;
                    if (trType && c.kind !== 'audio' && !c.locked) {
                      e.preventDefault();
                      e.stopPropagation();
                      onApplyTransition(c, trType);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onClipSelect(c.id, e.shiftKey || e.metaKey || e.ctrlKey);
                  }}
                  title={`${c.name} · ${timecodeFrames(c.start, fps)} — ${timecodeFrames(c.start + c.duration, fps)}${asset?.offline ? ' (素材离线)' : ''}`}
                >
                  {asset?.thumbnail && !asset.offline && (
                    <div
                      className="clip-thumbnails"
                      style={{ backgroundImage: `url("${mediaUrl(mediaOrigin, asset.id, true)}")` }}
                    />
                  )}
                  {c.transitionIn && (
                    <span
                      className="clip-transition-badge"
                      title={`入场转场：${trMeta?.name || c.transitionIn.type} (${(c.transitionIn.durationFrames / fps).toFixed(1)}s)`}
                    >
                      <Sparkles size={9} />
                      {clipPxWidth > 76 && <span>{trMeta?.name || c.transitionIn.type}</span>}
                    </span>
                  )}
                  <div className="clip-label">
                    {asset?.offline ? (
                      <AlertTriangle size={11} />
                    ) : c.locked ? (
                      <Lock size={10} />
                    ) : c.kind === 'code' ? (
                      <span className="mono">{'{}'}</span>
                    ) : null}
                    <span>{c.name}</span>
                  </div>
                  {showWave && (
                    <WaveformSvg
                      waveform={asset!.waveform!}
                      sourceIn={clip.sourceIn}
                      clipDuration={clip.duration}
                      assetDurationFrames={(asset!.duration || 1) * fps}
                      volume={Number(clip.props.volume ?? 1)}
                      bars={waveBars}
                      isVideo={c.kind === 'video'}
                    />
                  )}
                  {drag?.id === c.id && (
                    <div className="clip-drag-hud">
                      {timecodeFrames(clip.start, fps)} · {(clip.duration / fps).toFixed(2)}s
                    </div>
                  )}
                  {isPrimarySelected && !c.locked && toolMode === 'select' && (
                    <>
                      <div className="trim-handle left" onPointerDown={(e) => onClipDragStart(e, c, 'in')} />
                      <div className="trim-handle right" onPointerDown={(e) => onClipDragStart(e, c, 'out')} />
                    </>
                  )}
                </div>
              );
            })}
            {!track.clips.length && (
              <div className="lane-empty">
                {track.id === 'visual'
                  ? '拖入素材，开始剪辑'
                  : track.id === 'caption'
                    ? '字幕会出现在这里'
                    : ''}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
});

export const Timeline = React.memo(function Timeline({
  project,
  sequence,
  playheadClock,
  frame = 0,
  selected,
  selectedIds = [],
  onSelect,
  onSeek,
  onEndScrub,
  onEdit,
  onAssetDrop,
  mediaOrigin,
  zoom,
  onZoomChange,
  snap,
  toolMode = 'select',
}: {
  project: Project;
  sequence: Sequence;
  playheadClock?: PlayheadClock;
  frame?: number;
  selected: string | null;
  selectedIds?: string[];
  onSelect: (id: string | null, additive?: boolean) => void;
  onSeek: (frame: number, options?: { scrubbing?: boolean }) => void;
  onEndScrub?: (frame: number) => void;
  onEdit: (name: string, operations: EditOperation[]) => void;
  onAssetDrop: (id: string, frame: number) => void;
  mediaOrigin: string;
  zoom: number;
  onZoomChange?: (nextZoom: number) => void;
  snap: boolean;
  toolMode?: 'select' | 'razor';
}) {
  const cleanup = useRef<(() => void) | null>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const playheadElRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(playheadClock ? playheadClock.get() : frame);
  if (!playheadClock) frameRef.current = frame;
  const [viewportWidth, setViewportWidth] = useState(960);
  const [razorPreview, setRazorPreview] = useState<{ frame: number; clipId: string } | null>(null);

  useEffect(() => {
    const el = overflowRef.current;
    if (!el) return;
    const update = () => setViewportWidth(Math.max(320, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cleanup.current?.();
    };
  }, []);

  const mutedSet = useMemo(() => new Set(sequence.mutedTracks || []), [sequence.mutedTracks]);
  const assetsById = useMemo(() => new Map(project.assets.map((a) => [a.id, a])), [project.assets]);

  const rows: LaneRow[] = useMemo(
    () =>
      tracks.flatMap((track) => {
        const lanes: Clip[][] = [[]];
        const clips = sequence.clips.filter((c) => c.track === track.id).sort((a, b) => a.start - b.start);
        for (const clip of clips) {
          let lane = lanes.find(
            (l) => !l.length || l[l.length - 1].start + l[l.length - 1].duration <= clip.start,
          );
          if (!lane) {
            lane = [];
            lanes.push(lane);
          }
          lane.push(clip);
        }
        return lanes.map((clips, index) => ({ ...track, clips, index, key: track.id + '-' + index }));
      }),
    [sequence.clips],
  );
  const overlayCount = useMemo(() => rows.filter((r) => r.id === 'overlay').length, [rows]);

  const duration = useMemo(() => durationOf(sequence), [sequence]);
  const totalFrames = Math.max(duration + sequence.fps * 2, sequence.fps * 12);
  const totalSeconds = totalFrames / sequence.fps;

  const fitPxPerSec = viewportWidth / totalSeconds;
  const pxPerSec = Math.max(4, Math.min(480, fitPxPerSec * (zoom / 100)));
  const contentWidth = Math.max(viewportWidth, Math.round(totalSeconds * pxPerSec));

  const scaleRef = useRef({ totalFrames, contentWidth });
  scaleRef.current = { totalFrames, contentWidth };

  useLayoutEffect(() => {
    const updatePlayhead = (f: number) => {
      frameRef.current = f;
      if (playheadElRef.current) {
        const { totalFrames: tf, contentWidth: cw } = scaleRef.current;
        playheadElRef.current.style.transform = `translate3d(${((f / Math.max(1, tf)) * cw).toFixed(2)}px, 0, 0)`;
      }
    };
    updatePlayhead(playheadClock ? playheadClock.get() : frame);
    if (!playheadClock) return;
    return playheadClock.subscribe(updatePlayhead);
  }, [playheadClock, totalFrames, contentWidth, frame]);

  const prevPxPerSecRef = useRef(pxPerSec);
  const lastSeqIdRef = useRef(sequence.id);
  const lastScrollLeftRef = useRef(0);

  useLayoutEffect(() => {
    const el = overflowRef.current;
    if (lastSeqIdRef.current !== sequence.id) {
      lastSeqIdRef.current = sequence.id;
      prevPxPerSecRef.current = pxPerSec;
      return;
    }
    const prevPx = prevPxPerSecRef.current;
    prevPxPerSecRef.current = pxPerSec;
    if (!el || Math.abs(pxPerSec - prevPx) < 0.001) return;
    const playheadSec = frameRef.current / sequence.fps;
    const oldX = playheadSec * prevPx;
    const oldScroll = lastScrollLeftRef.current;
    const screenOffset = oldX - oldScroll;
    const targetOffset =
      screenOffset >= 0 && screenOffset <= el.clientWidth ? screenOffset : el.clientWidth * 0.35;
    const nextScroll = Math.max(0, Math.round(playheadSec * pxPerSec - targetOffset));
    el.scrollLeft = nextScroll;
    lastScrollLeftRef.current = nextScroll;
  }, [pxPerSec, sequence.id]);

  const [drag, setDrag] = useState<{
    id: string;
    start: number;
    duration: number;
    sourceIn: number;
    snapFrame?: number;
  } | null>(null);

  const at = useCallback(
    (e: { clientX: number }, target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      return Math.max(
        0,
        Math.min(totalFrames - 1, Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * totalFrames)),
      );
    },
    [totalFrames],
  );

  const toggleTrackMuteOrVis = useCallback(
    (trackId: Track) => {
      const current = new Set(sequence.mutedTracks || []);
      if (current.has(trackId)) current.delete(trackId);
      else current.add(trackId);
      const label =
        trackId === 'audio'
          ? current.has(trackId)
            ? '静音音频轨'
            : '取消音频轨静音'
          : current.has(trackId)
            ? '隐藏轨道画面'
            : '显示轨道画面';
      onEdit(label, [{ type: 'updateSequence', sequenceId: sequence.id, changes: { mutedTracks: [...current] } }]);
    },
    [sequence.mutedTracks, sequence.id, onEdit],
  );

  const toggleTrackLock = useCallback(
    (trackId: Track) => {
      const list = sequence.clips.filter((c) => c.track === trackId);
      if (!list.length) return;
      const allLocked = list.every((c) => c.locked);
      onEdit(
        allLocked ? '解锁整条轨道' : '锁定整条轨道',
        list.map((c) => ({
          type: 'updateClip',
          sequenceId: sequence.id,
          clipId: c.id,
          changes: { locked: !allLocked },
        })),
      );
    },
    [sequence.clips, sequence.id, onEdit],
  );

  const applyTransitionToClip = useCallback(
    (clip: Clip, trId: TransitionType) => {
      if (clip.locked || clip.kind === 'audio') return;
      const meta = BUILT_IN_TRANSITIONS.find((t) => t.id === trId);
      const durationFrames = Math.max(
        3,
        Math.min(clip.duration, Math.round((meta?.defaultSeconds || 0.6) * sequence.fps)),
      );
      onEdit(`添加转场「${meta?.name || trId}」`, [
        {
          type: 'updateClip',
          sequenceId: sequence.id,
          clipId: clip.id,
          changes: { transitionIn: { type: trId, durationFrames } },
        },
      ]);
      onSelect(clip.id);
    },
    [sequence.fps, sequence.id, onEdit, onSelect],
  );

  const begin = useCallback(
    (e: React.PointerEvent<HTMLElement>, clip: Clip, mode: 'move' | 'in' | 'out') => {
      e.stopPropagation();
      const lane = e.currentTarget.parentElement?.classList.contains('lane')
        ? e.currentTarget.parentElement
        : (e.currentTarget.closest('.lane') as HTMLElement);

      if (toolMode === 'razor' && mode === 'move') {
        onSelect(clip.id, false);
        if (clip.locked || !lane) return;
        const splitFrame = at(e, lane);
        if (splitFrame > clip.start && splitFrame < clip.start + clip.duration) {
          onEdit('刀片分割片段', splitOperations(sequence, clip, splitFrame));
          setRazorPreview(null);
        }
        return;
      }

      if ((e.shiftKey || e.metaKey || e.ctrlKey) && mode === 'move') {
        onSelect(clip.id, true);
        return;
      }

      onSelect(clip.id, false);
      if (clip.locked || !lane) return;
      const width = Math.max(1, lane.getBoundingClientRect().width);
      const origin = e.clientX;
      let current = {
        id: clip.id,
        start: clip.start,
        duration: clip.duration,
        sourceIn: clip.sourceIn,
        snapFrame: undefined as number | undefined,
      };
      const points = [
        0,
        frameRef.current,
        ...sequence.clips.filter((c) => c.id !== clip.id).flatMap((c) => [c.start, c.start + c.duration]),
      ];
      const snapToleranceFrames = Math.max(1, Math.round((totalFrames / width) * 8));
      const findSnap = (candidate: number) => {
        if (!snap) return undefined;
        let best: number | undefined;
        let bestDist = snapToleranceFrames + 1;
        for (const p of points) {
          const d = Math.abs(p - candidate);
          if (d <= snapToleranceFrames && d < bestDist) {
            best = p;
            bestDist = d;
          }
        }
        return best;
      };

      const asset = assetsById.get(clip.assetId || '');
      const max = asset && asset.kind !== 'image' ? Math.floor(asset.duration * sequence.fps) : Infinity;

      const move = (clientX: number) => {
        const delta = Math.round(((clientX - origin) / width) * totalFrames);
        let start = clip.start,
          dur = clip.duration,
          sourceIn = clip.sourceIn,
          snapFrame: number | undefined;

        if (mode === 'move') {
          start = Math.max(0, clip.start + delta);
          const snapStart = findSnap(start);
          const snapEnd = findSnap(start + dur);
          if (snapStart !== undefined) {
            start = snapStart;
            snapFrame = snapStart;
          } else if (snapEnd !== undefined && snapEnd - dur >= 0) {
            start = snapEnd - dur;
            snapFrame = snapEnd;
          }
        } else if (mode === 'in') {
          const minDelta = clip.kind === 'image' || !clip.assetId ? -clip.start : -Math.min(clip.start, clip.sourceIn);
          let d = Math.max(minDelta, Math.min(delta, clip.duration - 1));
          let candidateStart = clip.start + d;
          const snapped = findSnap(candidateStart);
          if (snapped !== undefined) {
            const sd = snapped - clip.start;
            if (sd >= minDelta && sd <= clip.duration - 1) {
              candidateStart = snapped;
              snapFrame = snapped;
            }
          }
          start = Math.max(0, candidateStart);
          const actualShift = start - clip.start;
          sourceIn = clip.kind === 'image' || !clip.assetId ? 0 : clip.sourceIn + actualShift;
          dur = clip.duration - actualShift;
        } else if (mode === 'out') {
          const maxDur = Number.isFinite(max) ? Math.max(1, max - clip.sourceIn) : Infinity;
          let candidateDur = Math.max(1, Math.min(clip.duration + delta, maxDur));
          const snappedEnd = findSnap(clip.start + candidateDur);
          if (snappedEnd !== undefined) {
            const sd = snappedEnd - clip.start;
            if (sd >= 1 && sd <= maxDur) {
              candidateDur = sd;
              snapFrame = snappedEnd;
            }
          }
          dur = candidateDur;
        }
        current = { id: clip.id, start, duration: dur, sourceIn, snapFrame };
        setDrag(current);
      };

      const up = () => {
        setDrag(null);
        if (
          current.start !== clip.start ||
          current.duration !== clip.duration ||
          current.sourceIn !== clip.sourceIn
        )
          onEdit(mode === 'move' ? '移动片段' : '调整入出点', [
            {
              type: 'updateClip',
              sequenceId: sequence.id,
              clipId: clip.id,
              changes: { start: current.start, duration: current.duration, sourceIn: current.sourceIn },
            },
          ]);
      };

      cleanup.current?.();
      cleanup.current = pointerDrag(e, move, up, mode === 'move' ? 'grabbing' : 'ew-resize');
    },
    [toolMode, sequence, totalFrames, snap, assetsById, at, onSelect, onEdit],
  );

  const stepSec = useMemo(
    () => TICK_STEPS.find((s) => s * pxPerSec >= (pxPerSec >= 90 ? 104 : 88)) || TICK_STEPS[TICK_STEPS.length - 1],
    [pxPerSec],
  );
  const ticks = useMemo(() => {
    const list: number[] = [];
    for (let t = 0; t <= totalSeconds + 0.001; t += stepSec) {
      list.push(Math.round(t * sequence.fps));
    }
    return list;
  }, [totalSeconds, stepSec, sequence.fps]);

  const showFramePrecision = stepSec < 2 && stepSec * pxPerSec >= 96;

  const startScrub = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const initial = Math.min(duration - 1, at(e, target));
      onSeek(initial, { scrubbing: true });
      cleanup.current?.();
      cleanup.current = pointerDrag(
        e,
        (clientX) => onSeek(Math.min(duration - 1, at({ clientX }, target)), { scrubbing: true }),
        (clientX) => {
          const finalFrame = Math.min(duration - 1, at({ clientX }, target));
          if (onEndScrub) onEndScrub(finalFrame);
          else onSeek(finalFrame, { scrubbing: false });
        },
        'crosshair',
      );
    },
    [duration, at, onSeek, onEndScrub],
  );

  const handleLaneClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onSelect(null);
        const f = Math.min(duration - 1, at(e, e.currentTarget));
        onSeek(f, { scrubbing: false });
      }
    },
    [duration, at, onSelect, onSeek],
  );

  const handleAssetDropAt = useCallback(
    (id: string, target: HTMLDivElement, clientX: number) => {
      onAssetDrop(id, at({ clientX }, target));
    },
    [at, onAssetDrop],
  );

  const handleClipRazorHover = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, c: Clip) => {
      if (c.locked) return;
      const laneEl = e.currentTarget.closest('.lane') as HTMLElement | null;
      if (!laneEl) return;
      const f = at(e, laneEl);
      if (f > c.start && f < c.start + c.duration) {
        setRazorPreview({ frame: f, clipId: c.id });
      } else {
        setRazorPreview(null);
      }
    },
    [at],
  );

  return (
    <div
      className="timeline-scroll"
      onWheel={(e) => {
        if ((e.metaKey || e.ctrlKey) && onZoomChange) {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
          onZoomChange(Math.max(50, Math.min(3200, Math.round(zoom * factor))));
        }
      }}
    >
      <TimelineTrackLabels
        labelsRef={labels}
        fps={sequence.fps}
        rows={rows}
        overlayCount={overlayCount}
        allClips={sequence.clips}
        mutedSet={mutedSet}
        onToggleLock={toggleTrackLock}
        onToggleVisMute={toggleTrackMuteOrVis}
      />
      <div
        className={`timeline-overflow ${toolMode === 'razor' ? 'razor-mode' : ''}`}
        ref={overflowRef}
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('timeline-content')) {
            onSelect(null);
          }
        }}
        onScroll={(e) => {
          lastScrollLeftRef.current = e.currentTarget.scrollLeft;
          if (labels.current) labels.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onPointerLeave={() => setRazorPreview(null)}
      >
        <div className="timeline-content" style={{ width: `${contentWidth}px` }}>
          <TimelineRuler
            ticks={ticks}
            totalFrames={totalFrames}
            fps={sequence.fps}
            showFramePrecision={showFramePrecision}
            onStartScrub={startScrub}
          />
          <TimelineLanes
            rows={rows}
            mutedSet={mutedSet}
            assetsById={assetsById}
            fps={sequence.fps}
            totalFrames={totalFrames}
            contentWidth={contentWidth}
            selected={selected}
            selectedIds={selectedIds}
            drag={drag}
            toolMode={toolMode}
            mediaOrigin={mediaOrigin}
            onLaneClick={handleLaneClick}
            onAssetDropAt={handleAssetDropAt}
            onClipDragStart={begin}
            onClipRazorHover={handleClipRazorHover}
            onClipDoubleClick={onSeek}
            onClipSelect={onSelect}
            onApplyTransition={applyTransitionToClip}
          />
          {drag?.snapFrame !== undefined && (
            <div className="snap-guide" style={{ left: `${(drag.snapFrame / totalFrames) * 100}%` }} />
          )}
          {razorPreview && toolMode === 'razor' && (
            <div
              className="razor-hover-line"
              style={{ left: `${(razorPreview.frame / totalFrames) * 100}%` }}
            >
              <span>{timecodeFrames(razorPreview.frame, sequence.fps)}</span>
            </div>
          )}
          <div
            ref={playheadElRef}
            className="playhead"
            style={{
              left: 0,
              transform: `translate3d(${(((playheadClock ? playheadClock.get() : frame) / totalFrames) * contentWidth).toFixed(2)}px, 0, 0)`,
              willChange: 'transform',
            }}
          >
            <span />
            <i />
          </div>
        </div>
      </div>
    </div>
  );
});
