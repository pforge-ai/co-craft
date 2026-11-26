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
  Plus,
  X,
  Diamond,
} from 'lucide-react';
import type {
  Sequence,
  Clip,
  Project,
  EditOperation,
  Track,
  TransitionType,
  Asset,
  TimelineTrackDef,
  KeyframeProperty,
} from '../core/types';
import { BUILT_IN_TRANSITIONS } from '../core/presets';
import { listAllKeyframeFrames, moveClipKeyframeFrame } from '../core/keyframes';
import {
  createNewTrackDef,
  findTrackForClip,
  formatTrackCode,
  isTrackCompatibleWithClip,
  resolveSequenceTracks,
} from '../core/tracks';
import { durationOf, splitOperations, timecode, timecodeFrames } from '../core/project';
import { mediaUrl } from '../composition/Film';
import { pointerDrag } from '../lib/pointerDrag';
import type { PlayheadClock } from '../lib/playheadClock';
import {
  TimelineCurveHeader,
  TimelineCurveLane,
  defaultCurvePropertyForClip,
} from './TimelineCurveDrawer';

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

const TICK_STEPS = [0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

type LaneRow = {
  id: Track;
  trackId: string;
  trackDef: TimelineTrackDef;
  code: string;
  label: string;
  icon: typeof Film;
  clips: Clip[];
  index: number;
  key: string;
};

const iconForTrack = (kind: Track) =>
  kind === 'overlay' ? Layers : kind === 'visual' ? Film : kind === 'caption' ? Type : Volume2;

const TimelineTrackLabels = React.memo(function TimelineTrackLabels({
  labelsRef,
  fps,
  rows,
  allTracks,
  allClips,
  sequenceId,
  mutedSet,
  soloSet,
  anySolo,
  mutedVideoAudio,
  curveClip,
  curveRowKey,
  curveProp,
  curveSelectedFrame,
  currentFrame,
  onChangeCurveProp,
  onSelectCurveFrame,
  onCloseCurve,
  onEdit,
  onAddTrack,
  onRenameTrack,
  onDeleteTrack,
  onToggleLock,
  onToggleSolo,
  onToggleVisMute,
  onToggleVideoAudioMute,
}: {
  labelsRef: React.RefObject<HTMLDivElement | null>;
  fps: number;
  rows: LaneRow[];
  allTracks: TimelineTrackDef[];
  allClips: Clip[];
  sequenceId: string;
  mutedSet: Set<Track>;
  soloSet: Set<Track>;
  anySolo: boolean;
  mutedVideoAudio: boolean;
  curveClip: Clip | null;
  curveRowKey: string | null;
  curveProp: KeyframeProperty;
  curveSelectedFrame: number | null;
  currentFrame: number;
  onChangeCurveProp: (p: KeyframeProperty) => void;
  onSelectCurveFrame: (f: number | null) => void;
  onCloseCurve: () => void;
  onEdit: (name: string, ops: EditOperation[]) => void;
  onAddTrack: (group: 'video' | 'caption' | 'audio') => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onToggleLock: (trackDef: TimelineTrackDef) => void;
  onToggleSolo: (trackDef: TimelineTrackDef) => void;
  onToggleVisMute: (trackDef: TimelineTrackDef) => void;
  onToggleVideoAudioMute: () => void;
}) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const primaryVisualId = allTracks.find((t) => t.kind === 'visual')?.id;
  const visualCount = allTracks.filter((t) => t.kind === 'visual').length;

  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest('.track-add-anchor')) setAddMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [addMenuOpen]);

  return (
    <div className="track-labels" ref={labelsRef}>
      <div className="ruler-label">
        <span>{fps} FPS</span>
        <div className="track-add-anchor">
          <button
            type="button"
            className="track-add-btn"
            aria-label="新增轨道"
            title="新增视频 / 声音 / 字幕轨道"
            aria-expanded={addMenuOpen}
            onClick={() => setAddMenuOpen((v) => !v)}
          >
            <Plus size={11} />
          </button>
          {addMenuOpen && (
            <div className="track-add-popover" role="menu" aria-label="新增多轨轨道">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAddMenuOpen(false);
                  onAddTrack('video');
                }}
              >
                <Layers size={11} /> 新增视频轨 (V)
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAddMenuOpen(false);
                  onAddTrack('audio');
                }}
              >
                <Volume2 size={11} /> 新增声音轨 (A)
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAddMenuOpen(false);
                  onAddTrack('caption');
                }}
              >
                <Type size={11} /> 新增字幕轨 (T)
              </button>
            </div>
          )}
        </div>
      </div>
      {rows.map((t) => {
        const def = t.trackDef;
        const isHiddenOrMuted = Boolean(def.muted) || mutedSet.has(t.id);
        const isSolo = Boolean(def.solo) || soloSet.has(t.id);
        const isDimmedBySolo = anySolo && !isSolo;
        const isAudio = t.id === 'audio';
        const isPrimaryVisual = def.id === primaryVisualId;
        const trackClips = allClips.filter((c) => findTrackForClip(c, allTracks)?.id === def.id);
        const trackLocked = trackClips.length > 0 && trackClips.every((c) => c.locked);
        const canDelete = !(def.kind === 'visual' && visualCount <= 1) && t.index === 0;
        const displayCode = t.index === 0 ? t.code : `${t.code}·${t.index + 1}`;
        const isRenaming = renamingId === def.id && t.index === 0;
        const hasLockedClips = trackClips.some((c) => c.locked);

        const commitRename = () => {
          const next = renameDraft.trim();
          setRenamingId(null);
          if (next && next !== def.name) onRenameTrack(def.id, next);
        };

        return (
          <React.Fragment key={t.key}>
            <div
              className={`track-label ${t.id} ${isHiddenOrMuted || isDimmedBySolo ? 'is-muted' : ''} ${isSolo ? 'is-solo' : ''}`}
              data-track-id={def.id}
            >
              <b className="track-code">{displayCode}</b>
              {isRenaming ? (
                <input
                  className="track-rename-input"
                  aria-label={`重命名轨道 ${def.name}`}
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <span
                  className="track-name-text"
                  title={t.index === 0 ? `${t.label}（双击重命名轨道）` : t.label}
                  onDoubleClick={() => {
                    if (t.index !== 0) return;
                    setRenamingId(def.id);
                    setRenameDraft(def.name);
                  }}
                >
                  {t.label}
                </span>
              )}
              {t.index === 0 && !isRenaming && (
                <div className="track-head-acts">
                  <button
                    type="button"
                    className={`track-solo-btn ${isSolo ? 'active' : ''}`}
                    aria-label={`${isSolo ? '取消独奏' : '独奏'}${t.label}轨`}
                    title={`${isSolo ? '取消' : '开启'}${t.label}轨独奏 (Solo)`}
                    onClick={() => onToggleSolo(def)}
                  >
                    S
                  </button>
                  <button
                    type="button"
                    className={`track-head-btn ${trackLocked ? 'locked-active' : ''}`}
                    aria-label={`${trackLocked ? '解锁' : '锁定'}${t.label}轨`}
                    title={`${trackLocked ? '解锁整条' : '锁定整条'}${t.label}轨`}
                    disabled={!trackClips.length}
                    onClick={() => onToggleLock(def)}
                  >
                    {trackLocked ? <Lock size={10} /> : <Unlock size={10} />}
                  </button>
                  {isPrimaryVisual && (
                    <button
                      type="button"
                      className={`track-mute-btn ${mutedVideoAudio ? 'active' : ''}`}
                      aria-label={mutedVideoAudio ? '恢复视频原声' : '静音视频原声'}
                      title={
                        mutedVideoAudio
                          ? '恢复 V1 视频内嵌同期声（独立于声音轨）'
                          : '静音 V1 视频内嵌同期声（不影响独立声音轨）'
                      }
                      onClick={onToggleVideoAudioMute}
                    >
                      {mutedVideoAudio ? <VolumeX size={11} /> : <Volume2 size={11} />}
                    </button>
                  )}
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
                        ? `${isHiddenOrMuted ? '恢复声音' : '静音'} ${t.label}轨`
                        : `${isHiddenOrMuted ? '显示' : '隐藏'} ${t.label}轨画面`
                    }
                    onClick={() => onToggleVisMute(def)}
                  >
                    {isAudio ? (
                      isHiddenOrMuted ? <VolumeX size={11} /> : <Volume2 size={11} />
                    ) : isHiddenOrMuted ? (
                      <EyeOff size={11} />
                    ) : (
                      <Eye size={11} />
                    )}
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      className="track-head-btn track-del-btn"
                      aria-label={`删除轨道 ${t.label}`}
                      disabled={hasLockedClips}
                      title={hasLockedClips ? '轨道包含已锁定片段，无法删除' : `删除轨道「${t.label}」`}
                      onClick={() => onDeleteTrack(def.id)}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              )}
            </div>
            {curveClip && curveRowKey === t.key && (
              <TimelineCurveHeader
                clip={curveClip}
                sequenceId={sequenceId}
                prop={curveProp}
                selectedFrame={curveSelectedFrame}
                currentFrame={currentFrame}
                onChangeProp={onChangeCurveProp}
                onSelectFrame={onSelectCurveFrame}
                onEdit={onEdit}
                onClose={onCloseCurve}
              />
            )}
          </React.Fragment>
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
  soloSet,
  anySolo,
  assetsById,
  sequenceId,
  fps,
  totalFrames,
  contentWidth,
  selected,
  selectedIds,
  drag,
  toolMode,
  mediaOrigin,
  curveClip,
  curveRowKey,
  curveProp,
  curveSelectedFrame,
  onSelectCurveFrame,
  onToggleCurveForClip,
  onSeek,
  onEndScrub,
  onEdit,
  onLaneClick,
  onAssetDropAt,
  onClipDragStart,
  onClipRazorHover,
  onClipDoubleClick,
  onClipSelect,
  onApplyTransition,
  onKeyframeDragStart,
}: {
  rows: LaneRow[];
  mutedSet: Set<Track>;
  soloSet: Set<Track>;
  anySolo: boolean;
  assetsById: Map<string, Asset>;
  sequenceId: string;
  fps: number;
  totalFrames: number;
  contentWidth: number;
  selected: string | null;
  selectedIds: string[];
  drag: {
    id: string;
    start: number;
    duration: number;
    sourceIn: number;
    snapFrame?: number;
    targetTrackId?: string;
  } | null;
  toolMode: 'select' | 'razor';
  mediaOrigin: string;
  curveClip: Clip | null;
  curveRowKey: string | null;
  curveProp: KeyframeProperty;
  curveSelectedFrame: number | null;
  onSelectCurveFrame: (f: number | null) => void;
  onToggleCurveForClip: (clipId: string) => void;
  onSeek: (frame: number, options?: { scrubbing?: boolean }) => void;
  onEndScrub?: (frame: number) => void;
  onEdit: (name: string, ops: EditOperation[]) => void;
  onLaneClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onAssetDropAt: (payload: string, target: HTMLDivElement, clientX: number, trackDef: TimelineTrackDef) => void;
  onClipDragStart: (e: React.PointerEvent<HTMLElement>, clip: Clip, mode: 'move' | 'in' | 'out') => void;
  onClipRazorHover: (e: React.PointerEvent<HTMLDivElement>, clip: Clip) => void;
  onClipDoubleClick: (start: number) => void;
  onClipSelect: (id: string | null, additive?: boolean) => void;
  onApplyTransition: (clip: Clip, trType: TransitionType) => void;
  onKeyframeDragStart: (e: React.PointerEvent<HTMLButtonElement>, clip: Clip, kfFrame: number) => void;
}) {
  const selectedSet = useMemo(() => {
    const s = new Set(selectedIds);
    if (selected) s.add(selected);
    return s;
  }, [selectedIds, selected]);
  return (
    <>
      {rows.map((track) => {
        const def = track.trackDef;
        const isMuted =
          Boolean(def.muted) ||
          mutedSet.has(track.id) ||
          (anySolo && !def.solo && !soloSet.has(track.id));
        const isDropTarget = drag?.targetTrackId === def.id && track.index === 0;
        return (
          <React.Fragment key={track.key}>
            <div
              className={`lane ${track.id} ${isMuted ? 'lane-muted' : ''} ${isDropTarget ? 'drop-target-track' : ''}`}
              data-track-id={def.id}
              data-track-kind={def.kind}
              onClick={onLaneClick}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/cocraft-asset')) e.preventDefault();
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('application/cocraft-asset');
                if (id) {
                  e.preventDefault();
                  e.stopPropagation();
                  onAssetDropAt(id, e.currentTarget, e.clientX, def);
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
                const kfFrames = c.keyframes ? listAllKeyframeFrames(c) : [];
                const isCurveOpen = curveClip?.id === c.id;

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
                      {c.muted && <VolumeX size={10} aria-label="片段已静音" />}
                      <span>{c.name}</span>
                      {(kfFrames.length > 0 || isPrimarySelected) && clipPxWidth > 54 && (
                        <button
                          type="button"
                          className={`clip-curve-toggle ${isCurveOpen ? 'active' : ''}`}
                          aria-label={`${isCurveOpen ? '收起' : '展开'}「${c.name}」关键帧曲线`}
                          title={isCurveOpen ? '收起关键帧曲线抽屉' : '在下方展开关键帧曲线与贝塞尔手柄'}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleCurveForClip(c.id);
                          }}
                        >
                          <Diamond size={8} />
                        </button>
                      )}
                      {c.track === 'audio' && clipPxWidth > 68 && (
                        <em
                          className={`clip-attach-pill ${c.audioAttachMode === 'shot' ? 'shot' : 'timeline'}`}
                          title={
                            c.audioAttachMode === 'shot'
                              ? '随镜移动：分镜换序时跟随所属镜头一起移动'
                              : '固定时间线：分镜换序时保持在原时间位置'
                          }
                        >
                          {c.audioAttachMode === 'shot' ? '随镜' : '固定'}
                        </em>
                      )}
                    </div>
                    {showWave && (
                      <WaveformSvg
                        waveform={asset!.waveform!}
                        sourceIn={clip.sourceIn}
                        clipDuration={clip.duration}
                        assetDurationFrames={(asset!.duration || 1) * fps}
                        volume={c.muted ? 0 : Number(clip.props.volume ?? 1)}
                        bars={waveBars}
                        isVideo={c.kind === 'video'}
                      />
                    )}
                    {drag?.id === c.id && (
                      <div className="clip-drag-hud">
                        {timecodeFrames(clip.start, fps)} · {(clip.duration / fps).toFixed(2)}s
                        {clip.kind !== 'title' && clip.kind !== 'caption' && clip.kind !== 'image'
                          ? ` · 源 ${timecodeFrames(clip.sourceIn, fps)}`
                          : ''}
                      </div>
                    )}
                    {isPrimarySelected && !c.locked && toolMode === 'select' && (
                      <>
                        <div className="trim-handle left" onPointerDown={(e) => onClipDragStart(e, c, 'in')} />
                        <div className="trim-handle right" onPointerDown={(e) => onClipDragStart(e, c, 'out')} />
                      </>
                    )}
                    {kfFrames.length > 0 && (
                      <div className="clip-kf-bar" aria-label={`${c.name} 关键帧`}>
                        {kfFrames.map((kf) => (
                          <button
                            key={kf}
                            type="button"
                            className="clip-kf-diamond"
                            style={{ left: `${(Math.min(c.duration, kf) / Math.max(1, c.duration)) * 100}%` }}
                            title={`关键帧 F${kf} (${timecodeFrames(c.start + kf, fps)}) · 点击跳转，拖拽调整时机`}
                            aria-label={`关键帧 F${kf}`}
                            onPointerDown={(e) => onKeyframeDragStart(e, c, kf)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ))}
                      </div>
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
            {curveClip && curveRowKey === track.key && (
              <TimelineCurveLane
                clip={curveClip}
                sequenceId={sequenceId}
                prop={curveProp}
                totalFrames={totalFrames}
                selectedFrame={curveSelectedFrame}
                onSelectFrame={onSelectCurveFrame}
                onSeek={onSeek}
                onEndScrub={onEndScrub}
                onEdit={onEdit}
              />
            )}
          </React.Fragment>
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
  curveClipId,
  onToggleCurveClip,
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
  onAssetDrop: (id: string, frame: number, targetTrack?: { track: Track; trackId: string; layer: number }) => void;
  mediaOrigin: string;
  zoom: number;
  onZoomChange?: (nextZoom: number) => void;
  snap: boolean;
  toolMode?: 'select' | 'razor';
  curveClipId?: string | null;
  onToggleCurveClip?: (clipId: string | null) => void;
}) {
  const cleanup = useRef<(() => void) | null>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const playheadElRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(playheadClock ? playheadClock.get() : frame);
  if (!playheadClock) frameRef.current = frame;
  const [viewportWidth, setViewportWidth] = useState(960);
  const [razorPreview, setRazorPreview] = useState<{ frame: number; clipId: string } | null>(null);
  const [localCurveClipId, setLocalCurveClipId] = useState<string | null>(null);
  const [curveProp, setCurveProp] = useState<KeyframeProperty>('opacity');
  const [curveSelectedFrame, setCurveSelectedFrame] = useState<number | null>(null);

  const activeCurveClipId = curveClipId !== undefined ? curveClipId : localCurveClipId;
  const setActiveCurveClipId = useCallback(
    (next: string | null) => {
      if (onToggleCurveClip) onToggleCurveClip(next);
      else setLocalCurveClipId(next);
    },
    [onToggleCurveClip],
  );

  const curveClip = useMemo(
    () => (activeCurveClipId ? sequence.clips.find((c) => c.id === activeCurveClipId) || null : null),
    [activeCurveClipId, sequence.clips],
  );

  useEffect(() => {
    if (!curveClip) return;
    setCurveProp(defaultCurvePropertyForClip(curveClip));
    setCurveSelectedFrame(null);
  }, [curveClip?.id]);

  const handleToggleCurveForClip = useCallback(
    (clipId: string) => {
      onSelect(clipId, false);
      setActiveCurveClipId(activeCurveClipId === clipId ? null : clipId);
    },
    [activeCurveClipId, onSelect, setActiveCurveClipId],
  );

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

  const allTracks = useMemo(() => resolveSequenceTracks(sequence), [sequence.tracks, sequence.clips]);
  const mutedSet = useMemo(() => new Set(sequence.mutedTracks || []), [sequence.mutedTracks]);
  const soloSet = useMemo(() => new Set(sequence.soloTracks || []), [sequence.soloTracks]);
  const anySolo = useMemo(
    () => soloSet.size > 0 || allTracks.some((t) => Boolean(t.solo)),
    [soloSet, allTracks],
  );
  const assetsById = useMemo(() => new Map(project.assets.map((a) => [a.id, a])), [project.assets]);

  const rows: LaneRow[] = useMemo(() => {
    return allTracks.flatMap((trackDef) => {
      const lanes: Clip[][] = [[]];
      const clips = sequence.clips
        .filter((c) => findTrackForClip(c, allTracks)?.id === trackDef.id)
        .sort((a, b) => a.start - b.start);
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
      const code = formatTrackCode(trackDef, allTracks);
      const icon = iconForTrack(trackDef.kind);
      return lanes.map((laneClips, index) => ({
        id: trackDef.kind,
        trackId: trackDef.id,
        trackDef,
        code,
        label: trackDef.name,
        icon,
        clips: laneClips,
        index,
        key: `${trackDef.id}-${index}`,
      }));
    });
  }, [allTracks, sequence.clips]);

  const curveRowKey = useMemo(() => {
    if (!curveClip) return null;
    const found = rows.find((r) => r.clips.some((c) => c.id === curveClip.id));
    return found?.key || null;
  }, [curveClip, rows]);

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
    targetTrackId?: string;
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

  // Dynamic Multi-Track Mutations
  const handleAddTrack = useCallback(
    (group: 'video' | 'caption' | 'audio') => {
      const nextDef = createNewTrackDef(allTracks, group);
      const nextTracks = [...allTracks, nextDef];
      onEdit(`新增轨道「${nextDef.name}」`, [
        { type: 'updateSequence', sequenceId: sequence.id, changes: { tracks: nextTracks } },
      ]);
    },
    [allTracks, sequence.id, onEdit],
  );

  const handleRenameTrack = useCallback(
    (trackId: string, nextName: string) => {
      const nextTracks = allTracks.map((t) => (t.id === trackId ? { ...t, name: nextName } : t));
      onEdit(`重命名轨道为「${nextName}」`, [
        { type: 'updateSequence', sequenceId: sequence.id, changes: { tracks: nextTracks } },
      ]);
    },
    [allTracks, sequence.id, onEdit],
  );

  const handleDeleteTrack = useCallback(
    (trackId: string) => {
      const target = allTracks.find((t) => t.id === trackId);
      if (!target) return;
      const trackClips = sequence.clips.filter((c) => findTrackForClip(c, allTracks)?.id === trackId);
      if (trackClips.some((c) => c.locked)) return;
      const remaining = allTracks.filter((t) => t.id !== trackId);
      if (!remaining.some((t) => t.kind === 'visual')) return;
      const ops: EditOperation[] = [
        ...trackClips.map((c) => ({ type: 'deleteClip' as const, sequenceId: sequence.id, clipId: c.id })),
        { type: 'updateSequence', sequenceId: sequence.id, changes: { tracks: remaining } },
      ];
      onEdit(`删除轨道「${target.name}」`, ops);
    },
    [allTracks, sequence.clips, sequence.id, onEdit],
  );

  const toggleTrackMuteOrVis = useCallback(
    (trackDef: TimelineTrackDef) => {
      const wasMuted = Boolean(trackDef.muted) || mutedSet.has(trackDef.kind);
      const nextMuted = !wasMuted;
      const nextTracks = allTracks.map((t) => (t.id === trackDef.id ? { ...t, muted: nextMuted } : t));
      const nextLegacyMuted = (sequence.mutedTracks || []).filter((k) => k !== trackDef.kind);
      const label =
        trackDef.kind === 'audio'
          ? nextMuted
            ? `静音「${trackDef.name}」轨`
            : `取消静音「${trackDef.name}」轨`
          : nextMuted
            ? `隐藏「${trackDef.name}」轨画面`
            : `显示「${trackDef.name}」轨画面`;
      onEdit(label, [
        {
          type: 'updateSequence',
          sequenceId: sequence.id,
          changes: { tracks: nextTracks, mutedTracks: nextLegacyMuted },
        },
      ]);
    },
    [allTracks, mutedSet, sequence.mutedTracks, sequence.id, onEdit],
  );

  const toggleVideoAudioMute = useCallback(() => {
    const nextMuted = !sequence.mutedVideoAudio;
    onEdit(nextMuted ? '静音视频原声' : '恢复视频原声', [
      { type: 'updateSequence', sequenceId: sequence.id, changes: { mutedVideoAudio: nextMuted } },
    ]);
  }, [sequence.mutedVideoAudio, sequence.id, onEdit]);

  const toggleTrackSolo = useCallback(
    (trackDef: TimelineTrackDef) => {
      const wasSolo = Boolean(trackDef.solo) || soloSet.has(trackDef.kind);
      const nextSolo = !wasSolo;
      const nextTracks = allTracks.map((t) => (t.id === trackDef.id ? { ...t, solo: nextSolo } : t));
      const nextLegacySolo = (sequence.soloTracks || []).filter((k) => k !== trackDef.kind);
      onEdit(nextSolo ? `开启「${trackDef.name}」轨独奏` : `取消「${trackDef.name}」轨独奏`, [
        {
          type: 'updateSequence',
          sequenceId: sequence.id,
          changes: { tracks: nextTracks, soloTracks: nextLegacySolo },
        },
      ]);
    },
    [allTracks, soloSet, sequence.soloTracks, sequence.id, onEdit],
  );

  const handleKeyframeDragStart = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, clip: Clip, kfFrame: number) => {
      e.stopPropagation();
      onSelect(clip.id);
      onSeek(clip.start + kfFrame);
      if (clip.locked) return;
      const sx = e.clientX;
      const startFrame = kfFrame;
      let targetFrame = kfFrame;
      cleanup.current?.();
      cleanup.current = pointerDrag(
        e,
        (mx) => {
          const { totalFrames: tf, contentWidth: cw } = scaleRef.current;
          const deltaFrames = Math.round(((mx - sx) / Math.max(1, cw)) * tf);
          targetFrame = Math.max(0, Math.min(Math.max(0, clip.duration - 1), startFrame + deltaFrames));
          onSeek(clip.start + targetFrame, { scrubbing: true });
        },
        () => {
          cleanup.current = null;
          onEndScrub?.(clip.start + targetFrame);
          if (targetFrame !== startFrame) {
            const nextKf = moveClipKeyframeFrame(
              clip.keyframes,
              startFrame,
              targetFrame,
              Math.max(0, clip.duration - 1),
            );
            onEdit(`移动「${clip.name}」关键帧至 F${targetFrame}`, [
              {
                type: 'updateClip',
                sequenceId: sequence.id,
                clipId: clip.id,
                changes: { keyframes: nextKf },
              },
            ]);
          }
        },
        'ew-resize',
      );
    },
    [sequence.id, onSelect, onSeek, onEndScrub, onEdit],
  );

  const toggleTrackLock = useCallback(
    (trackDef: TimelineTrackDef) => {
      const list = sequence.clips.filter((c) => findTrackForClip(c, allTracks)?.id === trackDef.id);
      if (!list.length) return;
      const allLocked = list.every((c) => c.locked);
      onEdit(
        allLocked ? `解锁「${trackDef.name}」轨` : `锁定「${trackDef.name}」轨`,
        list.map((c) => ({
          type: 'updateClip',
          sequenceId: sequence.id,
          clipId: c.id,
          changes: { locked: !allLocked },
        })),
      );
    },
    [allTracks, sequence.clips, sequence.id, onEdit],
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
      const origTrackDef = findTrackForClip(clip, allTracks);
      let current = {
        id: clip.id,
        start: clip.start,
        duration: clip.duration,
        sourceIn: clip.sourceIn,
        snapFrame: undefined as number | undefined,
        targetTrackId: origTrackDef?.id,
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

      const detectHoveredTrackId = (clientY: number): string | undefined => {
        if (mode !== 'move' || !overflowRef.current) return origTrackDef?.id;
        const laneEls = overflowRef.current.querySelectorAll<HTMLElement>('.lane[data-track-id]');
        for (const el of laneEls) {
          const r = el.getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) {
            const tid = el.dataset.trackId;
            const def = allTracks.find((t) => t.id === tid);
            if (def && isTrackCompatibleWithClip(def, clip.kind)) {
              return def.id;
            }
            break;
          }
        }
        return origTrackDef?.id;
      };

      const move = (clientX: number, clientY: number) => {
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
        const targetTrackId = detectHoveredTrackId(clientY);
        current = { id: clip.id, start, duration: dur, sourceIn, snapFrame, targetTrackId };
        setDrag(current);
      };

      const up = () => {
        setDrag(null);
        const targetDef = current.targetTrackId
          ? allTracks.find((t) => t.id === current.targetTrackId)
          : undefined;
        const trackChanged = Boolean(targetDef && origTrackDef && targetDef.id !== origTrackDef.id);
        if (
          current.start !== clip.start ||
          current.duration !== clip.duration ||
          current.sourceIn !== clip.sourceIn ||
          trackChanged
        ) {
          onEdit(
            trackChanged
              ? `移动片段至「${targetDef!.name}」轨`
              : mode === 'move'
                ? '移动片段'
                : '调整入出点',
            [
              {
                type: 'updateClip',
                sequenceId: sequence.id,
                clipId: clip.id,
                changes: {
                  start: current.start,
                  duration: current.duration,
                  sourceIn: current.sourceIn,
                  ...(trackChanged && targetDef
                    ? { track: targetDef.kind, trackId: targetDef.id, layer: targetDef.layer }
                    : {}),
                },
              },
            ],
          );
        }
      };

      cleanup.current?.();
      cleanup.current = pointerDrag(e, move, up, mode === 'move' ? 'grabbing' : 'ew-resize');
    },
    [toolMode, sequence, allTracks, totalFrames, snap, assetsById, at, onSelect, onEdit],
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
    (id: string, target: HTMLDivElement, clientX: number, trackDef: TimelineTrackDef) => {
      onAssetDrop(id, at({ clientX }, target), {
        track: trackDef.kind,
        trackId: trackDef.id,
        layer: trackDef.layer,
      });
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
        allTracks={allTracks}
        allClips={sequence.clips}
        sequenceId={sequence.id}
        mutedSet={mutedSet}
        soloSet={soloSet}
        anySolo={anySolo}
        mutedVideoAudio={Boolean(sequence.mutedVideoAudio)}
        curveClip={curveClip}
        curveRowKey={curveRowKey}
        curveProp={curveProp}
        curveSelectedFrame={curveSelectedFrame}
        currentFrame={frameRef.current}
        onChangeCurveProp={setCurveProp}
        onSelectCurveFrame={setCurveSelectedFrame}
        onCloseCurve={() => setActiveCurveClipId(null)}
        onEdit={onEdit}
        onAddTrack={handleAddTrack}
        onRenameTrack={handleRenameTrack}
        onDeleteTrack={handleDeleteTrack}
        onToggleLock={toggleTrackLock}
        onToggleSolo={toggleTrackSolo}
        onToggleVisMute={toggleTrackMuteOrVis}
        onToggleVideoAudioMute={toggleVideoAudioMute}
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
            soloSet={soloSet}
            anySolo={anySolo}
            assetsById={assetsById}
            sequenceId={sequence.id}
            fps={sequence.fps}
            totalFrames={totalFrames}
            contentWidth={contentWidth}
            selected={selected}
            selectedIds={selectedIds}
            drag={drag}
            toolMode={toolMode}
            mediaOrigin={mediaOrigin}
            curveClip={curveClip}
            curveRowKey={curveRowKey}
            curveProp={curveProp}
            curveSelectedFrame={curveSelectedFrame}
            onSelectCurveFrame={setCurveSelectedFrame}
            onToggleCurveForClip={handleToggleCurveForClip}
            onSeek={onSeek}
            onEndScrub={onEndScrub}
            onEdit={onEdit}
            onLaneClick={handleLaneClick}
            onAssetDropAt={handleAssetDropAt}
            onClipDragStart={begin}
            onClipRazorHover={handleClipRazorHover}
            onClipDoubleClick={onSeek}
            onClipSelect={onSelect}
            onApplyTransition={applyTransitionToClip}
            onKeyframeDragStart={handleKeyframeDragStart}
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
