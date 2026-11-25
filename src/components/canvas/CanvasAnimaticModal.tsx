import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { mediaUrl } from '../../composition/Film';
import { getPreset } from '../../core/presets';
import { timecode } from '../../core/project';
import type { CompositeShot } from '../../core/storyboard';
import type { EditOperation, Project, Sequence } from '../../core/types';
import { PresetPreview } from '../PresetControls';
import { ShotCompositeThumb } from '../ShotCompositeThumb';

interface CanvasAnimaticModalProps {
  project: Project;
  sequence: Sequence;
  shots: readonly CompositeShot[];
  previewOrigin: string;
  initialShotIndex?: number;
  onClose: () => void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
  onJumpToEdit: (clipId: string, startFrame: number) => void;
  onRegenerateShot: (shot: CompositeShot) => void;
}

export function CanvasAnimaticModal({
  project,
  sequence,
  shots,
  previewOrigin,
  initialShotIndex = 0,
  onClose,
  onEdit,
  onJumpToEdit,
  onRegenerateShot,
}: CanvasAnimaticModalProps) {
  const [shotIdx, setShotIdx] = useState(() =>
    Math.max(0, Math.min(shots.length - 1, initialShotIndex)),
  );
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [localSec, setLocalSec] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const clampedIdx = Math.max(0, Math.min(shots.length - 1, shotIdx));
  const shot = shots[clampedIdx];
  const fps = Math.max(1, sequence.fps || 30);
  const shotDurationSec = shot ? Math.max(0.5, shot.duration / fps) : 1;

  const anchorClip = shot?.anchorClip;
  const anchorAsset = anchorClip?.assetId
    ? project.assets.find((a) => a.id === anchorClip.assetId)
    : undefined;
  const presetId = String(anchorClip?.props.presetId || '');
  const hasPreset = Boolean(presetId && getPreset(presetId));
  const isVideo = Boolean(anchorAsset && anchorAsset.kind === 'video' && !anchorAsset.offline);
  const isImage = Boolean(anchorAsset && anchorAsset.kind === 'image' && !anchorAsset.offline);

  // Pick shot-attached audio clip if available
  const shotAudioClip = useMemo(() => {
    if (!shot) return undefined;
    return shot.audioClips.find((ac) => {
      if (!ac.assetId || ac.muted) return false;
      const a = project.assets.find((x) => x.id === ac.assetId);
      return Boolean(a && !a.offline);
    });
  }, [shot, project.assets]);

  // Reset local clock when switching shot
  useEffect(() => {
    setLocalSec(0);
    if (videoRef.current && anchorClip) {
      const startOffset = anchorClip.sourceIn / fps;
      try {
        videoRef.current.currentTime = startOffset;
      } catch {}
    }
    if (audioRef.current && shotAudioClip) {
      const startOffset = shotAudioClip.sourceIn / fps;
      try {
        audioRef.current.currentTime = startOffset;
      } catch {}
    }
  }, [clampedIdx, anchorClip?.id, anchorClip?.activeTakeId, shotAudioClip?.id, fps]);

  // Sync media elements with play/pause & mute
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.muted = muted || Boolean(anchorClip?.muted || sequence.mutedVideoAudio);
      if (playing) void v.play().catch(() => {});
      else v.pause();
    }
    const a = audioRef.current;
    if (a) {
      a.muted = muted;
      if (playing) void a.play().catch(() => {});
      else a.pause();
    }
  }, [playing, muted, clampedIdx, anchorClip?.activeTakeId, anchorClip?.muted, sequence.mutedVideoAudio]);

  // Advance timer across shots smoothly
  useEffect(() => {
    if (!playing || !shot) return;
    let raf = 0;
    let lastTs = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;
      setLocalSec((prev) => {
        const next = prev + dt;
        if (next >= shotDurationSec) {
          if (clampedIdx < shots.length - 1) {
            setShotIdx(clampedIdx + 1);
            return 0;
          }
          setPlaying(false);
          return shotDurationSec;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, shot, shotDurationSec, clampedIdx, shots.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => {
          if (!p && clampedIdx === shots.length - 1 && localSec >= shotDurationSec - 0.05) {
            setShotIdx(0);
            setLocalSec(0);
          }
          return !p;
        });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setShotIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setShotIdx((i) => Math.min(shots.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, clampedIdx, shots.length, localSec, shotDurationSec]);

  if (!shot || !anchorClip) return null;

  const currentAbsFrame = shot.start + Math.min(shot.duration - 1, Math.floor(localSec * fps));
  const activeCaption = shot.captionClips.find(
    (cap) => currentAbsFrame >= cap.start && currentAbsFrame < cap.start + cap.duration,
  );
  const captionText = String(activeCaption?.props.text || shot.scriptText || '').trim();
  const takes = anchorClip.takes || [];
  const totalFrames = shots.reduce((s, sh) => s + sh.duration, 0);
  const portrait = sequence.height > sequence.width;
  const pctInShot = Math.min(100, Math.max(0, (localSec / shotDurationSec) * 100));

  return (
    <div
      className="cc-animatic-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="分镜串播预览"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div className="cc-animatic-modal" onClick={(e) => e.stopPropagation()}>
        <header className="cc-animatic-head">
          <div className="cc-animatic-title">
            <Film size={13} />
            <b>分镜串播预览</b>
            <span className="cc-animatic-meta">
              镜头 {String(shot.index).padStart(2, '0')} / {String(shots.length).padStart(2, '0')} ·{' '}
              {timecode(currentAbsFrame, fps)} / {timecode(totalFrames, fps)}
            </span>
          </div>
          <div className="cc-animatic-head-acts">
            {takes.length >= 2 && (
              <div className="cc-animatic-takes" role="group" aria-label="快速切换镜头候选">
                {takes.map((t, ti) => {
                  const isAct = anchorClip.activeTakeId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={isAct ? 'active' : ''}
                      disabled={anchorClip.locked}
                      title={t.label}
                      onClick={() =>
                        void onEdit(`切换镜头 #${shot.index} 候选`, [
                          {
                            type: 'switchClipTake',
                            sequenceId: sequence.id,
                            clipId: anchorClip.id,
                            takeId: t.id,
                          },
                        ])
                      }
                    >
                      {isAct && <Check size={9} />}T{ti + 1}
                    </button>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              className="cc-animatic-btn"
              onClick={() => {
                onClose();
                onRegenerateShot(shot);
              }}
            >
              <Sparkles size={11} /> 重拍候选
            </button>
            <button
              type="button"
              className="cc-animatic-btn"
              onClick={() => {
                onClose();
                onJumpToEdit(anchorClip.id, shot.start);
              }}
            >
              <Scissors size={11} /> 去精剪
            </button>
            <button type="button" className="cc-animatic-close" aria-label="关闭串播" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </header>

        <div className={`cc-animatic-stage ${portrait ? 'portrait' : ''}`}>
          {hasPreset ? (
            <PresetPreview presetId={presetId} values={anchorClip.props} portrait={portrait} />
          ) : isVideo && anchorAsset ? (
            <video
              ref={videoRef}
              key={`${anchorAsset.id}-${anchorClip.activeTakeId || ''}`}
              src={mediaUrl(previewOrigin, anchorAsset.id)}
              playsInline
              muted={muted || Boolean(anchorClip.muted || sequence.mutedVideoAudio)}
              style={{ objectFit: (anchorClip.props.fit as 'cover' | 'contain') || 'contain' }}
            />
          ) : isImage && anchorAsset ? (
            <img
              src={mediaUrl(previewOrigin, anchorAsset.id)}
              alt={anchorClip.name}
              style={{ objectFit: (anchorClip.props.fit as 'cover' | 'contain') || 'contain' }}
            />
          ) : (
            <div className="cc-animatic-fallback">
              <ShotCompositeThumb
                project={project}
                sequence={sequence}
                shot={shot}
                previewOrigin={previewOrigin}
              />
            </div>
          )}

          {shotAudioClip?.assetId && (
            <audio
              ref={audioRef}
              key={shotAudioClip.id}
              src={mediaUrl(previewOrigin, shotAudioClip.assetId)}
              muted={muted}
            />
          )}

          {captionText && <div className="cc-animatic-caption">{captionText}</div>}
          <div className="cc-animatic-shot-badge">
            #{String(shot.index).padStart(2, '0')} · {anchorClip.name}
          </div>
        </div>

        <footer className="cc-animatic-foot">
          <div className="cc-animatic-controls">
            <button
              type="button"
              className="cc-animatic-icon"
              aria-label="上一镜头"
              disabled={clampedIdx === 0}
              onClick={() => setShotIdx((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              className="cc-animatic-play"
              aria-label={playing ? '暂停串播' : '继续串播'}
              onClick={() => {
                if (!playing && clampedIdx === shots.length - 1 && localSec >= shotDurationSec - 0.05) {
                  setShotIdx(0);
                  setLocalSec(0);
                }
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button
              type="button"
              className="cc-animatic-icon"
              aria-label="下一镜头"
              disabled={clampedIdx >= shots.length - 1}
              onClick={() => setShotIdx((i) => Math.min(shots.length - 1, i + 1))}
            >
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              className="cc-animatic-icon"
              title="从头串播"
              aria-label="从头串播"
              onClick={() => {
                setShotIdx(0);
                setLocalSec(0);
                setPlaying(true);
              }}
            >
              <RotateCcw size={13} />
            </button>
            <button
              type="button"
              className="cc-animatic-icon"
              aria-label={muted ? '取消静音' : '静音'}
              onClick={() => setMuted((m) => !m)}
            >
              {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
          </div>

          <div className="cc-animatic-strip" role="tablist" aria-label="分镜进度条">
            {shots.map((sh, i) => {
              const isCurrent = i === clampedIdx;
              const isPast = i < clampedIdx;
              const weight = Math.max(1, sh.duration);
              return (
                <button
                  key={sh.id}
                  type="button"
                  role="tab"
                  aria-selected={isCurrent}
                  className={`cc-animatic-seg ${isCurrent ? 'current' : ''} ${isPast ? 'past' : ''}`}
                  style={{ flexGrow: weight }}
                  title={`镜头 #${sh.index} · ${(sh.duration / fps).toFixed(1)}s`}
                  onClick={() => {
                    setShotIdx(i);
                    setLocalSec(0);
                  }}
                >
                  <span
                    className="cc-animatic-seg-fill"
                    style={{ width: isPast ? '100%' : isCurrent ? `${pctInShot}%` : '0%' }}
                  />
                  <small>{String(sh.index).padStart(2, '0')}</small>
                </button>
              );
            })}
          </div>
        </footer>
      </div>
    </div>
  );
}
