import React, { useState, useRef } from 'react';
import { Lock, Volume2, Type, Film, Layers, Music, Plus } from 'lucide-react';
import type { Sequence, Clip, Project, EditOperation, Track } from '../core/types';
import { durationOf, timecode } from '../core/project';
import { mediaUrl } from '../composition/Film';
const tracks: { id: Track; label: string; icon: typeof Film }[] = [
  { id: 'overlay', label: '画面包装', icon: Layers },
  { id: 'visual', label: '视频', icon: Film },
  { id: 'caption', label: '字幕', icon: Type },
  { id: 'audio', label: '声音', icon: Volume2 },
];
export function Timeline({
  project,
  sequence,
  frame,
  selected,
  onSelect,
  onSeek,
  onEdit,
  onAssetDrop,
  mediaOrigin,
  zoom,
  snap,
}: {
  project: Project;
  sequence: Sequence;
  frame: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onSeek: (frame: number) => void;
  onEdit: (name: string, operations: EditOperation[]) => void;
  onAssetDrop: (id: string, frame: number) => void;
  mediaOrigin: string;
  zoom: number;
  snap: boolean;
}) {
  const duration = durationOf(sequence);
  const total = Math.max(duration + sequence.fps, sequence.fps * 12);
  const content = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; start: number; duration: number; sourceIn: number } | null>(
    null,
  );
  const at = (e: { clientX: number }, target: HTMLElement) =>
    Math.max(
      0,
      Math.min(
        total - 1,
        Math.round(
          ((e.clientX - target.getBoundingClientRect().left) / target.getBoundingClientRect().width) * total,
        ),
      ),
    );
  function begin(e: React.PointerEvent, clip: Clip, mode: 'move' | 'in' | 'out') {
    e.stopPropagation();
    onSelect(clip.id);
    if (clip.locked) return;
    const lane = e.currentTarget.parentElement!.classList.contains('lane')
      ? e.currentTarget.parentElement!
      : (e.currentTarget.closest('.lane') as HTMLElement);
    const width = lane.getBoundingClientRect().width;
    const origin = e.clientX;
    let current = { id: clip.id, start: clip.start, duration: clip.duration, sourceIn: clip.sourceIn };
    const points = [
      0,
      frame,
      ...sequence.clips.filter((c) => c.id !== clip.id).flatMap((c) => [c.start, c.start + c.duration]),
    ];
    const asset = project.assets.find((a) => a.id === clip.assetId);
    const max = asset && asset.kind !== 'image' ? Math.floor(asset.duration * sequence.fps) : Infinity;
    const move = (ev: PointerEvent) => {
      const delta = Math.round(((ev.clientX - origin) / width) * total);
      let start = clip.start,
        duration = clip.duration,
        sourceIn = clip.sourceIn;
      if (mode === 'move') {
        start = Math.max(0, clip.start + delta);
        if (snap) {
          const p = points.find((p) => Math.abs(p - start) < (total / width) * 7);
          if (p !== undefined) start = p;
        }
      }
      if (mode === 'in') {
        const d = Math.max(-clip.sourceIn, Math.min(delta, clip.duration - 1));
        start = Math.max(0, clip.start + d);
        sourceIn = clip.sourceIn + start - clip.start;
        duration = clip.duration - (start - clip.start);
      }
      if (mode === 'out') duration = Math.max(1, Math.min(clip.duration + delta, max - clip.sourceIn));
      current = { id: clip.id, start, duration, sourceIn };
      setDrag(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
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
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  const ticks = Array.from({ length: 9 }, (_, i) => Math.round((i * total) / 8));
  return (
    <div className="timeline-scroll">
      <div className="track-labels">
        <div className="ruler-label">{sequence.fps} FPS</div>
        {tracks.map((t) => (
          <div key={t.id} className={`track-label ${t.id}`}>
            <t.icon size={13} />
            <span>{t.label}</span>
          </div>
        ))}
      </div>
      <div className="timeline-overflow">
        <div className="timeline-content" ref={content} style={{ width: `${zoom}%` }}>
          <div
            className="ruler"
            onPointerDown={(e) => {
              onSeek(Math.min(duration - 1, at(e, e.currentTarget)));
              const target = e.currentTarget;
              const move = (ev: PointerEvent) => onSeek(Math.min(duration - 1, at(ev, target)));
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
          >
            {ticks.map((tick, i) => (
              <span style={{ left: `${(i / 8) * 100}%` }} key={i}>
                {timecode(tick, sequence.fps).slice(0, 5)}
              </span>
            ))}
          </div>
          {tracks.map((track) => (
            <div
              className={`lane ${track.id}`}
              key={track.id}
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  onSelect(null);
                  onSeek(Math.min(duration - 1, at(e, e.currentTarget)));
                }
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/cocraft-asset')) e.preventDefault();
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('application/cocraft-asset');
                if (id) {
                  e.preventDefault();
                  e.stopPropagation();
                  onAssetDrop(id, at(e, e.currentTarget));
                }
              }}
            >
              {sequence.clips
                .filter((c) => c.track === track.id)
                .map((c) => {
                  const clip = drag?.id === c.id ? { ...c, ...drag } : c;
                  const asset = project.assets.find((a) => a.id === c.assetId);
                  return (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`片段 ${c.name}`}
                      aria-pressed={selected === c.id}
                      className={`timeline-clip ${c.kind} ${selected === c.id ? 'selected' : ''} ${c.locked ? 'locked' : ''} ${drag?.id === c.id ? 'dragging' : ''}`}
                      style={{
                        left: `${(clip.start / total) * 100}%`,
                        width: `${(clip.duration / total) * 100}%`,
                      }}
                      onPointerDown={(e) => begin(e, c, 'move')}
                      onDoubleClick={() => onSeek(c.start)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onSelect(c.id);
                      }}
                      title={`${c.name} · ${timecode(c.start, sequence.fps)} — ${timecode(c.start + c.duration, sequence.fps)}`}
                    >
                      {asset?.thumbnail && (
                        <div
                          className="clip-thumbnails"
                          style={{ backgroundImage: `url("${mediaUrl(mediaOrigin, asset.id, true)}")` }}
                        />
                      )}
                      <div className="clip-label">
                        {c.locked ? (
                          <Lock size={10} />
                        ) : c.kind === 'code' ? (
                          <span className="mono">{'{}'}</span>
                        ) : null}
                        <span>{c.name}</span>
                      </div>
                      {c.kind === 'audio' && (
                        <div className="waveform">
                          {Array.from({ length: 85 }, (_, i) => (
                            <i
                              key={i}
                              style={{
                                height: `${5 + (asset?.waveform?.[Math.min(255, Math.floor(((clip.sourceIn + (i / 85) * clip.duration) / Math.max(1, (asset?.duration || 1) * sequence.fps)) * 256))] || 0) * 85 * Math.min(1, Number(clip.props.volume ?? 1))}%`,
                              }}
                            />
                          ))}
                        </div>
                      )}
                      {selected === c.id && !c.locked && (
                        <>
                          <div className="trim-handle left" onPointerDown={(e) => begin(e, c, 'in')} />
                          <div className="trim-handle right" onPointerDown={(e) => begin(e, c, 'out')} />
                        </>
                      )}
                    </div>
                  );
                })}
              {!sequence.clips.some((c) => c.track === track.id) && (
                <div className="lane-empty">
                  {track.id === 'visual'
                    ? '拖入素材，开始剪辑'
                    : track.id === 'caption'
                      ? '字幕会出现在这里'
                      : ''}
                </div>
              )}
            </div>
          ))}
          <div className="playhead" style={{ left: `${(frame / total) * 100}%` }}>
            <span />
            <i />
          </div>
        </div>
      </div>
    </div>
  );
}
