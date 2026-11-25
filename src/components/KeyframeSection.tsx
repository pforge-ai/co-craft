import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Diamond, Sparkles, Trash2, Volume2 } from 'lucide-react';
import type {
  Clip,
  EditOperation,
  KeyframeEasing,
  KeyframeProperty,
  Sequence,
} from '../core/types';
import {
  KEYFRAME_EASING_OPTIONS,
  KEYFRAME_PROPERTY_LABELS,
  buildAudioDuckingKeyframes,
  buildKenBurnsKeyframes,
  evaluateKeyframeTrack,
  hasAnyKeyframes,
  listAllKeyframeFrames,
  removeClipKeyframe,
  upsertClipKeyframe,
} from '../core/keyframes';
import type { PlayheadClock } from '../lib/playheadClock';

function EasingPreviewSvg({ easing }: { easing: KeyframeEasing }) {
  let d = 'M 3 19 C 14 19, 22 3, 33 3'; // ease-in-out
  if (easing === 'linear') d = 'M 3 19 L 33 3';
  else if (easing === 'ease-in') d = 'M 3 19 C 20 19, 33 14, 33 3';
  else if (easing === 'ease-out') d = 'M 3 19 C 3 8, 16 3, 33 3';
  else if (easing === 'hold') d = 'M 3 19 L 33 19 L 33 3';
  return (
    <svg className="kf-curve-svg" viewBox="0 0 36 22" width="36" height="22" aria-hidden="true">
      <line x1="3" y1="19" x2="33" y2="19" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1" />
      <line x1="3" y1="3" x2="3" y2="19" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="3" cy="19" r="2" fill="var(--accent)" />
      <circle cx="33" cy="3" r="2" fill="var(--accent)" />
    </svg>
  );
}

export interface KeyframeSectionProps {
  clip: Clip;
  sequence: Sequence;
  playheadClock?: PlayheadClock;
  properties: KeyframeProperty[];
  onSeek?: (frame: number) => void;
  onEdit: (name: string, ops: EditOperation[]) => void;
}

export function KeyframeSection({
  clip,
  sequence,
  playheadClock,
  properties,
  onSeek,
  onEdit,
}: KeyframeSectionProps) {
  const [globalFrame, setGlobalFrame] = useState(() => playheadClock?.get() ?? clip.start);
  const [activeEasing, setActiveEasing] = useState<KeyframeEasing>('ease-in-out');

  useEffect(() => {
    if (!playheadClock) return;
    setGlobalFrame(playheadClock.get());
    return playheadClock.subscribe(setGlobalFrame);
  }, [playheadClock]);

  const rawLocal = globalFrame - clip.start;
  const inBounds = rawLocal >= 0 && rawLocal < clip.duration;
  const localFrame = Math.max(0, Math.min(Math.max(0, clip.duration - 1), rawLocal));
  const allFrames = listAllKeyframeFrames(clip);
  const prevFrame = [...allFrames].reverse().find((f) => f < localFrame);
  const nextFrame = allFrames.find((f) => f > localFrame);

  // Sync easing selector with any keyframe sitting at localFrame
  const activePointAtPlayhead = (() => {
    for (const p of properties) {
      const hit = clip.keyframes?.[p]?.find((k) => k.frame === localFrame);
      if (hit) return { prop: p, kf: hit };
    }
    return null;
  })();
  const displayedEasing: KeyframeEasing = activePointAtPlayhead?.kf.easing || activeEasing;

  const commitKeyframes = (label: string, nextKf: Clip['keyframes']) => {
    onEdit(label, [
      {
        type: 'updateClip',
        sequenceId: sequence.id,
        clipId: clip.id,
        changes: { keyframes: nextKf },
      },
    ]);
  };

  const togglePropertyKeyframe = (prop: KeyframeProperty) => {
    if (clip.locked) return;
    const existing = clip.keyframes?.[prop]?.find((k) => k.frame === localFrame);
    if (existing) {
      commitKeyframes(
        `删除「${KEYFRAME_PROPERTY_LABELS[prop]}」关键帧`,
        removeClipKeyframe(clip.keyframes, prop, localFrame),
      );
      return;
    }
    const baseDefault = prop === 'scale' || prop === 'opacity' || prop === 'volume' ? 1 : 0;
    const fallback = clip.props[prop] !== undefined ? Number(clip.props[prop]) : baseDefault;
    const val = evaluateKeyframeTrack(clip.keyframes?.[prop], localFrame, fallback);
    commitKeyframes(
      `添加「${KEYFRAME_PROPERTY_LABELS[prop]}」关键帧`,
      upsertClipKeyframe(clip.keyframes, prop, localFrame, Number(val.toFixed(4)), displayedEasing),
    );
  };

  const updateEasingAtPlayhead = (nextEase: KeyframeEasing) => {
    setActiveEasing(nextEase);
    if (!clip.keyframes || clip.locked) return;
    let changed = false;
    const nextKf = { ...clip.keyframes };
    for (const p of properties) {
      const list = nextKf[p];
      if (!list?.length) continue;
      if (list.some((k) => k.frame === localFrame)) {
        nextKf[p] = list.map((k) => (k.frame === localFrame ? { ...k, easing: nextEase } : k));
        changed = true;
      }
    }
    if (changed) {
      commitKeyframes('更新关键帧缓动曲线', nextKf);
    }
  };

  const formatPropVal = (prop: KeyframeProperty, val: number) => {
    if (prop === 'scale' || prop === 'opacity' || prop === 'volume') return `${Math.round(val * 100)}%`;
    if (prop === 'rotation' || prop === 'cameraYaw' || prop === 'cameraPitch') return `${Math.round(val)}°`;
    if (prop === 'cameraLens') return `${Math.round(val)}mm`;
    if (prop === 'cameraDistance') return `${val.toFixed(2)}x`;
    if (prop === 'cameraPanX' || prop === 'cameraPanY') return `${val.toFixed(2)}`;
    if (prop === 'explode') return `${Math.round(val * 100)}%`;
    return `${Math.round(val)}px`;
  };

  const isVisual = clip.kind !== 'audio';

  return (
    <section className="ins-sec kf-section" aria-label="关键帧与缓动曲线">
      <div className="ins-sec-head">
        <h4>关键帧动画</h4>
        <div className="kf-nav-group">
          <button
            type="button"
            className="kf-nav-btn"
            aria-label="上一关键帧"
            title="跳到上一个关键帧"
            disabled={prevFrame === undefined || !onSeek}
            onClick={() => prevFrame !== undefined && onSeek?.(clip.start + prevFrame)}
          >
            <ChevronLeft size={12} />
          </button>
          <span className="kf-frame-readout" title={inBounds ? '片段内相对帧' : '播放头当前在片段外'}>
            {inBounds ? `F${localFrame}` : '片段外'}
          </span>
          <button
            type="button"
            className="kf-nav-btn"
            aria-label="下一关键帧"
            title="跳到下一个关键帧"
            disabled={nextFrame === undefined || !onSeek}
            onClick={() => nextFrame !== undefined && onSeek?.(clip.start + nextFrame)}
          >
            <ChevronRight size={12} />
          </button>
          {hasAnyKeyframes(clip) && !clip.locked && (
            <button
              type="button"
              className="kf-nav-btn danger"
              aria-label="清空全部关键帧"
              title="清空此片段的全部关键帧"
              onClick={() => commitKeyframes('清空片段关键帧', undefined)}
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Per-property keyframe toggles */}
      <div className="kf-prop-list">
        {properties.map((prop) => {
          const track = clip.keyframes?.[prop];
          const count = track?.length || 0;
          const hasAtNow = Boolean(track?.some((k) => k.frame === localFrame));
          const baseDefault = prop === 'scale' || prop === 'opacity' || prop === 'volume' ? 1 : 0;
          const fallback = clip.props[prop] !== undefined ? Number(clip.props[prop]) : baseDefault;
          const liveVal = evaluateKeyframeTrack(track, localFrame, fallback);
          return (
            <div key={prop} className={`kf-prop-row ${count > 0 ? 'animated' : ''}`}>
              <span className="kf-prop-name">{KEYFRAME_PROPERTY_LABELS[prop]}</span>
              <span className="kf-prop-val">{formatPropVal(prop, liveVal)}</span>
              {count > 0 && <small className="kf-prop-count">{count} 帧</small>}
              <button
                type="button"
                className={`kf-diamond-btn ${hasAtNow ? 'active' : count > 0 ? 'has-keys' : ''}`}
                disabled={clip.locked}
                aria-label={`${hasAtNow ? '移除' : '添加'}${KEYFRAME_PROPERTY_LABELS[prop]}关键帧`}
                title={
                  hasAtNow
                    ? `移除 F${localFrame} 的「${KEYFRAME_PROPERTY_LABELS[prop]}」关键帧`
                    : `在 F${localFrame} 添加「${KEYFRAME_PROPERTY_LABELS[prop]}」关键帧`
                }
                onClick={() => togglePropertyKeyframe(prop)}
              >
                <Diamond size={11} fill={hasAtNow ? 'currentColor' : 'none'} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Easing curve selector + mini curve preview */}
      <div className="kf-easing-row">
        <EasingPreviewSvg easing={displayedEasing} />
        <select
          aria-label="关键帧缓动曲线"
          value={displayedEasing}
          disabled={clip.locked}
          onChange={(e) => updateEasingAtPlayhead(e.target.value as KeyframeEasing)}
        >
          {KEYFRAME_EASING_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Quick Motion / Audio Ducking Presets */}
      {!clip.locked && (
        <div className="kf-presets-row">
          {isVisual ? (
            <>
              <button
                type="button"
                className="button tiny subtle"
                title="生成 100% → 112% 平滑慢推镜关键帧"
                onClick={() => commitKeyframes('应用慢推镜关键帧', buildKenBurnsKeyframes(clip, 'zoom-in'))}
              >
                <Sparkles size={10} /> 慢推镜
              </button>
              <button
                type="button"
                className="button tiny subtle"
                title="生成 114% → 100% 平滑缓拉镜关键帧"
                onClick={() => commitKeyframes('应用缓拉镜关键帧', buildKenBurnsKeyframes(clip, 'zoom-out'))}
              >
                缓拉镜
              </button>
              <button
                type="button"
                className="button tiny subtle"
                title="生成左右平移推进关键帧"
                onClick={() => commitKeyframes('应用横移关键帧', buildKenBurnsKeyframes(clip, 'pan-right'))}
              >
                横移
              </button>
              <button
                type="button"
                className="button tiny subtle"
                title="生成首尾不透明度平滑淡入淡出关键帧"
                onClick={() => {
                  const fadeLen = Math.min(18, Math.max(3, Math.floor(clip.duration / 4)));
                  const end = Math.max(1, clip.duration - 1);
                  commitKeyframes('应用淡入淡出关键帧', {
                    ...(clip.keyframes || {}),
                    opacity: [
                      { frame: 0, value: 0, easing: 'ease-out' },
                      { frame: fadeLen, value: 1, easing: 'linear' },
                      { frame: Math.max(fadeLen, end - fadeLen), value: 1, easing: 'ease-in' },
                      { frame: end, value: 0, easing: 'ease-in' },
                    ],
                  });
                }}
              >
                淡入淡出
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button tiny subtle"
              title="检测对白/旁白区间，自动为背景乐生成平滑闪避音量关键帧"
              onClick={() => {
                const nextKf = buildAudioDuckingKeyframes(sequence, clip);
                commitKeyframes('自动生成人声闪避关键帧', nextKf);
              }}
            >
              <Volume2 size={11} /> 人声闪避 (Auto-Duck)
            </button>
          )}
        </div>
      )}
    </section>
  );
}
