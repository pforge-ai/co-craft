import type {
  Clip,
  ClipKeyframe,
  ClipKeyframes,
  KeyframeEasing,
  KeyframeProperty,
  Sequence,
} from './types';

export const KEYFRAME_EASING_OPTIONS: { id: KeyframeEasing; label: string }[] = [
  { id: 'ease-in-out', label: '平滑缓入缓出' },
  { id: 'ease-out', label: '缓出收尾' },
  { id: 'ease-in', label: '缓入启动' },
  { id: 'linear', label: '匀速线性' },
  { id: 'hold', label: '定格跳变' },
];

export const KEYFRAME_PROPERTY_LABELS: Record<KeyframeProperty, string> = {
  x: '水平位置 X',
  y: '垂直位置 Y',
  scale: '缩放',
  rotation: '旋转',
  opacity: '不透明度',
  volume: '音量',
  cameraYaw: '3D 水平角',
  cameraPitch: '3D 俯仰角',
  cameraDistance: '3D 推拉距离',
  cameraLens: '镜头焦段 (mm)',
  cameraPanX: '3D 水平平移',
  cameraPanY: '3D 垂直平移',
  explode: '3D 爆炸拆解',
};

export function applyKeyframeEasing(t: number, easing: KeyframeEasing = 'ease-in-out'): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'linear':
      return clamped;
    case 'hold':
      return clamped >= 1 ? 1 : 0;
    case 'ease-in':
      return clamped * clamped * clamped;
    case 'ease-out':
      return 1 - Math.pow(1 - clamped, 3);
    case 'ease-in-out':
    default:
      return clamped < 0.5
        ? 4 * clamped * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
  }
}

export function normalizeKeyframeTrack(points: readonly ClipKeyframe[] | undefined): ClipKeyframe[] {
  if (!points?.length) return [];
  const byFrame = new Map<number, ClipKeyframe>();
  for (const pt of points) {
    if (!Number.isFinite(pt.frame) || !Number.isFinite(pt.value)) continue;
    const frame = Math.max(0, Math.round(pt.frame));
    byFrame.set(frame, {
      frame,
      value: pt.value,
      easing: pt.easing || 'ease-in-out',
    });
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

/**
 * Evaluates a single keyframe property curve at `localFrame` (relative to clip.start).
 * Clamps flat before the first keyframe and after the last keyframe (standard NLE behavior).
 */
export function evaluateKeyframeTrack(
  points: readonly ClipKeyframe[] | undefined,
  localFrame: number,
  fallback: number,
): number {
  if (!points || points.length === 0) return fallback;
  const sorted =
    points.length > 1 && points.some((p, i) => i > 0 && p.frame < points[i - 1].frame)
      ? normalizeKeyframeTrack(points)
      : points;
  if (sorted.length === 0) return fallback;
  if (sorted.length === 1 || localFrame <= sorted[0].frame) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (localFrame >= last.frame) return last.value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (localFrame >= a.frame && localFrame <= b.frame) {
      if (b.frame <= a.frame) return b.value;
      const rawT = (localFrame - a.frame) / (b.frame - a.frame);
      const eased = applyKeyframeEasing(rawT, a.easing || 'ease-in-out');
      return a.value + (b.value - a.value) * eased;
    }
  }
  return last.value;
}

export function hasAnyKeyframes(clip: Clip | undefined | null): boolean {
  if (!clip?.keyframes) return false;
  return Object.values(clip.keyframes).some((arr) => Array.isArray(arr) && arr.length > 0);
}

export function listAllKeyframeFrames(clip: Clip | undefined | null): number[] {
  if (!clip?.keyframes) return [];
  const frames = new Set<number>();
  for (const arr of Object.values(clip.keyframes)) {
    if (!arr) continue;
    for (const pt of arr) {
      if (Number.isFinite(pt.frame)) frames.add(Math.max(0, Math.round(pt.frame)));
    }
  }
  return [...frames].sort((a, b) => a - b);
}

/**
 * Resolves `clip.props` at `localFrame` by applying all keyframe curves.
 * Returns the original `clip.props` reference untouched when no keyframes exist (zero allocation).
 */
export function resolveClipPropsAtFrame(clip: Clip, localFrame: number): Clip['props'] {
  if (!clip.keyframes) return clip.props;
  const keys = Object.keys(clip.keyframes) as KeyframeProperty[];
  let changed = false;
  let nextProps: Clip['props'] | null = null;
  for (const prop of keys) {
    const track = clip.keyframes[prop];
    if (!track || track.length === 0) continue;
    const baseDefault = prop === 'scale' || prop === 'opacity' || prop === 'volume' ? 1 : 0;
    const fallback = clip.props[prop] !== undefined ? Number(clip.props[prop]) : baseDefault;
    const val = evaluateKeyframeTrack(track, localFrame, fallback);
    if (!nextProps) nextProps = { ...clip.props };
    nextProps[prop] = val;
    changed = true;
  }
  return changed && nextProps ? nextProps : clip.props;
}

export function upsertClipKeyframe(
  keyframes: ClipKeyframes | undefined,
  prop: KeyframeProperty,
  frame: number,
  value: number,
  easing: KeyframeEasing = 'ease-in-out',
): ClipKeyframes {
  const f = Math.max(0, Math.round(frame));
  const next: ClipKeyframes = { ...(keyframes || {}) };
  const existing = normalizeKeyframeTrack(next[prop]).filter((p) => p.frame !== f);
  existing.push({ frame: f, value, easing });
  existing.sort((a, b) => a.frame - b.frame);
  next[prop] = existing;
  return next;
}

export function removeClipKeyframe(
  keyframes: ClipKeyframes | undefined,
  prop: KeyframeProperty,
  frame: number,
): ClipKeyframes | undefined {
  if (!keyframes?.[prop]) return keyframes;
  const f = Math.max(0, Math.round(frame));
  const next: ClipKeyframes = { ...keyframes };
  const filtered = normalizeKeyframeTrack(next[prop]).filter((p) => p.frame !== f);
  if (filtered.length === 0) delete next[prop];
  else next[prop] = filtered;
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Moves every keyframe sitting at `fromFrame` to `toFrame` (used when dragging a keyframe diamond on the Timeline).
 */
export function moveClipKeyframeFrame(
  keyframes: ClipKeyframes | undefined,
  fromFrame: number,
  toFrame: number,
  maxFrame = Number.MAX_SAFE_INTEGER,
): ClipKeyframes | undefined {
  if (!keyframes) return undefined;
  const src = Math.max(0, Math.round(fromFrame));
  const limit = Number.isFinite(maxFrame) ? Math.max(0, Math.round(maxFrame)) : Number.MAX_SAFE_INTEGER;
  const dst = Math.max(0, Math.min(limit, Math.round(toFrame)));
  if (src === dst) return keyframes;
  const next: ClipKeyframes = {};
  for (const [prop, arr] of Object.entries(keyframes) as [KeyframeProperty, ClipKeyframe[] | undefined][]) {
    if (!arr?.length) continue;
    const cleaned = normalizeKeyframeTrack(arr);
    const moving = cleaned.find((p) => p.frame === src);
    if (!moving) {
      next[prop] = cleaned;
      continue;
    }
    const rest = cleaned.filter((p) => p.frame !== src && p.frame !== dst);
    rest.push({ ...moving, frame: dst });
    rest.sort((a, b) => a.frame - b.frame);
    next[prop] = rest;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Seamlessly splits keyframe curves when a clip is cut by the Razor blade at `splitOffset`:
 * evaluates boundary values at `splitOffset` so left and right halves preserve exact motion continuity.
 */
export function splitKeyframesForSplit(
  keyframes: ClipKeyframes | undefined,
  splitOffset: number,
): { left?: ClipKeyframes; right?: ClipKeyframes } {
  if (!keyframes) return {};
  const left: ClipKeyframes = {};
  const right: ClipKeyframes = {};
  for (const [prop, arr] of Object.entries(keyframes) as [KeyframeProperty, ClipKeyframe[] | undefined][]) {
    if (!arr?.length) continue;
    const sorted = normalizeKeyframeTrack(arr);
    const boundaryVal = evaluateKeyframeTrack(sorted, splitOffset, sorted[0].value);
    const leftPts = sorted.filter((p) => p.frame < splitOffset);
    const rightPts = sorted
      .filter((p) => p.frame > splitOffset)
      .map((p) => ({ ...p, frame: p.frame - splitOffset }));
    const exactPt = sorted.find((p) => p.frame === splitOffset);

    if (leftPts.length > 0 || exactPt) {
      const boundaryEase = exactPt?.easing || leftPts[leftPts.length - 1]?.easing || 'ease-in-out';
      left[prop] = normalizeKeyframeTrack([...leftPts, { frame: splitOffset, value: boundaryVal, easing: boundaryEase }]);
    }
    if (rightPts.length > 0 || exactPt) {
      const prevPt = [...sorted].reverse().find((p) => p.frame <= splitOffset);
      right[prop] = normalizeKeyframeTrack([
        { frame: 0, value: boundaryVal, easing: exactPt?.easing || prevPt?.easing || 'ease-in-out' },
        ...rightPts,
      ]);
    }
  }
  return {
    left: Object.keys(left).length > 0 ? left : undefined,
    right: Object.keys(right).length > 0 ? right : undefined,
  };
}

export function scaleKeyframesForFps(
  keyframes: ClipKeyframes | undefined,
  scale: number,
): ClipKeyframes | undefined {
  if (!keyframes || Math.abs(scale - 1) < 1e-4) return keyframes;
  const out: ClipKeyframes = {};
  for (const [prop, arr] of Object.entries(keyframes) as [KeyframeProperty, ClipKeyframe[] | undefined][]) {
    if (!arr?.length) continue;
    out[prop] = normalizeKeyframeTrack(
      arr.map((p) => ({ ...p, frame: Math.max(0, Math.round(p.frame * scale)) })),
    );
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 1-click cinematic Ken Burns / motion presets on visual clips. */
export function buildKenBurnsKeyframes(
  clip: Clip,
  style: 'zoom-in' | 'zoom-out' | 'pan-right' = 'zoom-in',
): ClipKeyframes {
  const end = Math.max(1, clip.duration - 1);
  const existing: ClipKeyframes = { ...(clip.keyframes || {}) };
  const baseScale = Number(clip.props.scale ?? 1);
  const baseX = Number(clip.props.x ?? 0);
  if (style === 'zoom-in') {
    existing.scale = [
      { frame: 0, value: Number(baseScale.toFixed(3)), easing: 'ease-in-out' },
      { frame: end, value: Number((baseScale * 1.12).toFixed(3)), easing: 'ease-in-out' },
    ];
  } else if (style === 'zoom-out') {
    existing.scale = [
      { frame: 0, value: Number((baseScale * 1.14).toFixed(3)), easing: 'ease-in-out' },
      { frame: end, value: Number(baseScale.toFixed(3)), easing: 'ease-in-out' },
    ];
  } else {
    existing.scale = [
      { frame: 0, value: Number(Math.max(1.08, baseScale).toFixed(3)), easing: 'ease-in-out' },
      { frame: end, value: Number(Math.max(1.08, baseScale).toFixed(3)), easing: 'ease-in-out' },
    ];
    existing.x = [
      { frame: 0, value: Math.round(baseX - 36), easing: 'ease-in-out' },
      { frame: end, value: Math.round(baseX + 36), easing: 'ease-in-out' },
    ];
  }
  return existing;
}

/**
 * Pro NLE Auto-Ducking: generates smooth `volume` keyframes on `bgmClip` that duck down
 * whenever voice/dialogue clips (other audio clips, unmuted V1 videos, or captions) play.
 */
export function buildAudioDuckingKeyframes(
  sequence: Sequence,
  bgmClip: Clip,
  opts?: { duckVolume?: number; rampFrames?: number },
): ClipKeyframes {
  const baseVol = Math.max(0.05, Number(bgmClip.props.volume ?? 1));
  const duckVol = Number(Math.min(baseVol, opts?.duckVolume ?? Math.min(0.24, baseVol * 0.28)).toFixed(3));
  const ramp = Math.max(2, Math.round(opts?.rampFrames ?? Math.round(sequence.fps * 0.25)));
  const bgmStart = bgmClip.start;
  const bgmEnd = bgmClip.start + bgmClip.duration;

  // Prefer real dialogue/narration audio clips; fall back to captions or unmuted videos if none
  const voiceAudioIntervals = sequence.clips
    .filter((c) => c.id !== bgmClip.id && c.track === 'audio' && !c.muted)
    .map((c) => ({ start: Math.max(bgmStart, c.start), end: Math.min(bgmEnd, c.start + c.duration) }))
    .filter((iv) => iv.end > iv.start);

  const fallbackIntervals =
    voiceAudioIntervals.length > 0
      ? voiceAudioIntervals
      : sequence.clips
          .filter(
            (c) =>
              c.id !== bgmClip.id &&
              (c.kind === 'caption' || (c.kind === 'video' && !c.muted && !sequence.mutedVideoAudio)),
          )
          .map((c) => ({ start: Math.max(bgmStart, c.start), end: Math.min(bgmEnd, c.start + c.duration) }))
          .filter((iv) => iv.end > iv.start);

  // Merge overlapping or closely adjacent speech windows (within 2 * ramp frames)
  fallbackIntervals.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const iv of fallbackIntervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv.start <= prev.end + ramp * 2) {
      prev.end = Math.max(prev.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }

  const next: ClipKeyframes = { ...(bgmClip.keyframes || {}) };
  if (merged.length === 0) return next;

  const pts: ClipKeyframe[] = [];
  const maxLocal = Math.max(1, bgmClip.duration - 1);
  if (merged[0].start > bgmStart + ramp) {
    pts.push({ frame: 0, value: baseVol, easing: 'ease-in-out' });
  }
  for (const iv of merged) {
    const localStart = Math.max(0, iv.start - bgmStart);
    const localEnd = Math.min(maxLocal, iv.end - bgmStart);
    const preFrame = Math.max(0, localStart - ramp);
    const postFrame = Math.min(maxLocal, localEnd + ramp);
    if (preFrame < localStart) {
      pts.push({ frame: preFrame, value: baseVol, easing: 'ease-in-out' });
    }
    pts.push({ frame: localStart, value: duckVol, easing: 'linear' });
    pts.push({ frame: localEnd, value: duckVol, easing: 'ease-in-out' });
    if (postFrame > localEnd) {
      pts.push({ frame: postFrame, value: baseVol, easing: 'ease-in-out' });
    }
  }
  if (pts.length > 0 && pts[pts.length - 1].frame < maxLocal) {
    pts.push({ frame: maxLocal, value: baseVol, easing: 'ease-in-out' });
  }
  next.volume = normalizeKeyframeTrack(pts);
  return next;
}
