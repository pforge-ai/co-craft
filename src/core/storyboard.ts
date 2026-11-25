import { clone, newClip, uid } from './project';
import { getPreset } from './presets';
import type { Clip, EditOperation, Sequence, ShotBinding } from './types';

export interface CompositeShot {
  id: string;
  index: number;
  start: number;
  duration: number;
  /** Primary visual/stage clip driving this shot's timing & Takes */
  anchorClip: Clip;
  /** Shot-local visual & overlay clips composited inside this shot window (move atomically on reorder) */
  compositeClips: Clip[];
  /** Multi-shot spanning overlays (e.g. corner watermark/logo) rendered in preview/thumbnails but NOT moved per shot */
  spanningOverlays: Clip[];
  /** Synced caption clips inside this shot window */
  captionClips: Clip[];
  /** Shot-attached audio clips (audioAttachMode === 'shot') moving atomically with this shot */
  audioClips: Clip[];
  /** Editable narration / subtitle script summary for this shot */
  scriptText: string;
  /** Bound @Entity:Variant consistency references */
  bindings: ShotBinding[];
  locked: boolean;
}

/**
 * Strips ONLY explicit list markers (- , * , • , 1. , 1、, 1) , (1) , ① ) while strictly preserving
 * real numeric prefixes like "2026 年", "3.5 倍", "35mm", "100%", "-15℃", "0.4 版本".
 */
export function stripExplicitListMarker(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/^(?:[*•·▪▸]\s+|-\s+(?!\d))/u, '')
    .replace(
      /^(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*|[（(]\d{1,2}[)）]\s*|\d{1,2}[、)]\s*|\d{1,2}\.\s+)/u,
      '',
    )
    .trim();
}

/**
 * Unified Pro-NLE Primary Storyline Shot Model ("一镜一卡"), shared identically by 「创造」 and 「剪辑」:
 * - Each V1 `visual` clip defines ONE continuous narrative shot window (overlays never shatter primary visuals).
 * - Shot-local overlays (contained within the shot window) belong to `compositeClips` and move with the shot.
 * - Multi-shot spanning overlays (e.g. persistent watermark/logo) go into `spanningOverlays` so they never
 *   block shot reordering via shared clips.
 * - Captions whose midpoint lies inside the shot belong to `captionClips` and move with the shot.
 * - Audio clips explicitly marked `audioAttachMode === 'shot'` whose midpoint lies inside the shot belong
 *   to `audioClips` and move with the shot; `timeline` audio (e.g. BGM) stays pinned on the timeline.
 */
export function computeCompositeShots(sequence: Sequence): CompositeShot[] {
  const visuals = sequence.clips
    .filter((c) => c.track === 'visual')
    .sort((a, b) => a.start - b.start || (a.layer ?? 0) - (b.layer ?? 0));
  const overlays = sequence.clips
    .filter((c) => c.track === 'overlay')
    .sort((a, b) => a.start - b.start || (a.layer ?? 0) - (b.layer ?? 0));
  const captions = sequence.clips
    .filter((c) => c.kind === 'caption' || c.track === 'caption')
    .sort((a, b) => a.start - b.start);
  const shotAttachedAudios = sequence.clips
    .filter((c) => c.track === 'audio' && c.audioAttachMode === 'shot')
    .sort((a, b) => a.start - b.start);

  const windows: {
    id: string;
    start: number;
    duration: number;
    anchor: Clip;
    members: Clip[];
    spanning: Clip[];
  }[] = [];

  if (visuals.length > 0) {
    const claimedOverlayIds = new Set<string>();
    for (const v of visuals) {
      const vEnd = v.start + v.duration;
      const overlappingOvs = overlays.filter((ov) => ov.start < vEnd - 2 && ov.start + ov.duration > v.start + 2);
      const localOvs: Clip[] = [];
      const spanningOvs: Clip[] = [];
      for (const ov of overlappingOvs) {
        const ovEnd = ov.start + ov.duration;
        // Overlay belongs locally to this shot if its midpoint is in [v.start, vEnd) AND it doesn't substantially span across other shots
        const spansOutside = ov.start < v.start - 4 || ovEnd > vEnd + 4;
        const mid = ov.start + ov.duration / 2;
        if (!spansOutside && !claimedOverlayIds.has(ov.id) && mid >= v.start && mid < vEnd) {
          claimedOverlayIds.add(ov.id);
          localOvs.push(ov);
        } else {
          spanningOvs.push(ov);
        }
      }
      const featured = localOvs.find((m) => m.props.presetId || m.kind === 'code');
      const vIsBackground =
        v.kind === 'shape' &&
        (!v.props.presetId || getPreset(String(v.props.presetId))?.category === 'backgrounds');
      windows.push({
        id: v.id,
        start: v.start,
        duration: v.duration,
        anchor: vIsBackground && featured ? featured : v,
        members: [v, ...localOvs],
        spanning: spanningOvs,
      });
    }
  } else {
    const merged: { start: number; end: number; ovs: Clip[] }[] = [];
    for (const ov of overlays) {
      const s = ov.start;
      const e = ov.start + ov.duration;
      const prev = merged.at(-1);
      if (prev && s < prev.end) {
        prev.end = Math.max(prev.end, e);
        prev.ovs.push(ov);
      } else {
        merged.push({ start: s, end: e, ovs: [ov] });
      }
    }
    for (const seg of merged) {
      const featured = seg.ovs.find((m) => m.props.presetId || m.kind === 'code') || seg.ovs[0];
      windows.push({
        id: featured.id,
        start: seg.start,
        duration: seg.end - seg.start,
        anchor: featured,
        members: seg.ovs,
        spanning: [],
      });
    }
  }

  windows.sort((a, b) => a.start - b.start);

  const claimedCaptionIds = new Set<string>();
  const claimedAudioIds = new Set<string>();

  return windows.map((win, i) => {
    const winEnd = win.start + win.duration;
    const shotCaps = captions.filter((cap) => {
      if (claimedCaptionIds.has(cap.id)) return false;
      const mid = cap.start + cap.duration / 2;
      if (mid >= win.start && mid < winEnd) {
        claimedCaptionIds.add(cap.id);
        return true;
      }
      return false;
    });
    const shotAudios = shotAttachedAudios.filter((aud) => {
      if (claimedAudioIds.has(aud.id)) return false;
      const mid = aud.start + aud.duration / 2;
      if (mid >= win.start && mid < winEnd) {
        claimedAudioIds.add(aud.id);
        return true;
      }
      return false;
    });

    const primaryOwner = win.members.find((m) => m.track === 'visual') || win.anchor;
    const legacySubjectBindings: ShotBinding[] = (
      win.anchor.subjectBindings?.length
        ? []
        : win.anchor.subjectIds || primaryOwner.subjectIds || []
    ).map((id) => ({ entityId: id }));
    const bindings =
      win.anchor.subjectBindings?.length
        ? win.anchor.subjectBindings
        : primaryOwner.subjectBindings?.length
          ? primaryOwner.subjectBindings
          : legacySubjectBindings;
    const scriptText =
      shotCaps
        .map((c) => String(c.props.text || '').trim())
        .filter(Boolean)
        .join(' ') ||
      win.anchor.shotNotes ||
      '';

    return {
      id: win.id,
      index: i + 1,
      start: win.start,
      duration: win.duration,
      anchorClip: win.anchor,
      compositeClips: win.members,
      spanningOverlays: win.spanning,
      captionClips: shotCaps,
      audioClips: shotAudios,
      scriptText,
      bindings,
      locked:
        win.members.some((m) => m.locked) ||
        shotCaps.some((c) => c.locked) ||
        shotAudios.some((a) => a.locked),
    };
  });
}

/**
 * Alias for `computeCompositeShots` — guarantees Create Canvas and Edit Storyboard share one canonical shot list.
 */
export function computePrimaryTimelineShots(sequence: Sequence): CompositeShot[] {
  return computeCompositeShots(sequence);
}

/**
 * Collects the full shot stack (visual + shot-local overlays + timed captions + shot-attached audio)
 * for promoting a shot into a reusable Compound Asset without losing trims, subtitles, or synced cues.
 */
export function collectShotClipsForCompound(sequence: Sequence, shot: CompositeShot): Clip[] {
  const map = new Map<string, Clip>();
  for (const c of [...shot.compositeClips, ...shot.captionClips, ...shot.audioClips]) {
    const live = sequence.clips.find((x) => x.id === c.id) || c;
    map.set(live.id, live);
  }
  return [...map.values()].sort((a, b) => a.start - b.start || (a.layer ?? 0) - (b.layer ?? 0));
}

/**
 * Atomically swaps two adjacent Composite Shots, shifting ALL shot-local visual, overlay,
 * caption, and `shot`-attached audio clips together while keeping `timeline` BGM and spanning watermarks pinned.
 */
export function moveCompositeShotOperations(
  sequence: Sequence,
  shots: CompositeShot[],
  shotId: string,
  delta: -1 | 1,
): EditOperation[] {
  const idx = shots.findIndex((s) => s.id === shotId);
  const targetIdx = idx + delta;
  if (idx < 0 || targetIdx < 0 || targetIdx >= shots.length) return [];
  const firstIdx = Math.min(idx, targetIdx);
  const secondIdx = Math.max(idx, targetIdx);
  const shotA = shots[firstIdx];
  const shotB = shots[secondIdx];
  if (shotA.locked || shotB.locked) return [];

  const sharedClip = shotA.compositeClips.some((ca) => shotB.compositeClips.some((cb) => cb.id === ca.id));
  if (sharedClip) return [];

  const aClips = [
    ...new Map(
      [...shotA.compositeClips, ...shotA.captionClips, ...shotA.audioClips].map((c) => [c.id, c]),
    ).values(),
  ];
  const bClips = [
    ...new Map(
      [...shotB.compositeClips, ...shotB.captionClips, ...shotB.audioClips].map((c) => [c.id, c]),
    ).values(),
  ];

  const baseStart = shotA.start;
  const gapBetween = Math.max(0, shotB.start - (shotA.start + shotA.duration));
  const newBStart = baseStart;
  const newAStart = baseStart + shotB.duration + gapBetween;

  const ops: EditOperation[] = [];
  for (const c of bClips) {
    const rel = c.start - shotB.start;
    ops.push({
      type: 'updateClip',
      sequenceId: sequence.id,
      clipId: c.id,
      changes: { start: Math.max(0, newBStart + rel) },
    });
  }
  for (const c of aClips) {
    const rel = c.start - shotA.start;
    ops.push({
      type: 'updateClip',
      sequenceId: sequence.id,
      clipId: c.id,
      changes: { start: Math.max(0, newAStart + rel) },
    });
  }
  return ops;
}

/**
 * Atomically moves `fromShotId` to `toIndex` (`0 .. shots.length - 1`) in one edit,
 * preserving inter-shot gaps and shifting all shot-local visuals, overlays, captions,
 * and `shot`-attached audio clips together while keeping `timeline` BGM pinned.
 */
export function reorderCompositeShotOperations(
  sequence: Sequence,
  shots: CompositeShot[],
  fromShotId: string,
  toIndex: number,
): EditOperation[] {
  const fromIdx = shots.findIndex((s) => s.id === fromShotId);
  if (fromIdx < 0 || toIndex < 0 || toIndex >= shots.length || fromIdx === toIndex) return [];
  const lo = Math.min(fromIdx, toIndex);
  const hi = Math.max(fromIdx, toIndex);
  const slice = shots.slice(lo, hi + 1);
  if (slice.some((s) => s.locked)) return [];

  // Guard against shared clips across affected shots
  const seenClipIds = new Set<string>();
  const clipsByShot = new Map<string, Clip[]>();
  for (const sh of slice) {
    const localClips = [
      ...new Map(
        [...sh.compositeClips, ...sh.captionClips, ...sh.audioClips].map((c) => [c.id, c]),
      ).values(),
    ];
    for (const c of localClips) {
      if (seenClipIds.has(c.id)) return [];
      seenClipIds.add(c.id);
    }
    clipsByShot.set(sh.id, localClips);
  }

  // Record inter-shot gaps between adjacent slots in [lo .. hi]
  const gaps: number[] = [];
  for (let i = lo; i < hi; i++) {
    gaps.push(Math.max(0, shots[i + 1].start - (shots[i].start + shots[i].duration)));
  }

  // Build new order of the affected slice
  const reordered = [...slice];
  const [moved] = reordered.splice(fromIdx - lo, 1);
  reordered.splice(toIndex - lo, 0, moved);

  let cursor = slice[0].start;
  const ops: EditOperation[] = [];
  reordered.forEach((sh, i) => {
    const newStart = cursor;
    const delta = newStart - sh.start;
    if (delta !== 0) {
      for (const c of clipsByShot.get(sh.id) || []) {
        const rel = c.start - sh.start;
        ops.push({
          type: 'updateClip',
          sequenceId: sequence.id,
          clipId: c.id,
          changes: { start: Math.max(0, newStart + rel) },
        });
      }
    }
    cursor += sh.duration + (gaps[i] ?? 0);
  });
  return ops;
}

/**
 * Edits ONE timed subtitle clip's text while strictly preserving its exact `start` and `duration` frames.
 */
export function updateSingleCaptionTextOperations(
  sequence: Sequence,
  captionClip: Clip,
  nextText: string,
): EditOperation[] {
  if (captionClip.locked) return [];
  const trimmed = nextText.trim();
  if (!trimmed) {
    return [{ type: 'deleteClip', sequenceId: sequence.id, clipId: captionClip.id }];
  }
  return [
    {
      type: 'updateClip',
      sequenceId: sequence.id,
      clipId: captionClip.id,
      changes: {
        name: trimmed.slice(0, 22),
        props: { text: trimmed },
      },
    },
  ];
}

/**
 * Updates only the shot's narration draft note (`shotNotes`) without disturbing existing timed SRT subtitles.
 */
export function updateShotNotesOperations(
  sequence: Sequence,
  shot: CompositeShot,
  nextNotes: string,
): EditOperation[] {
  if (shot.anchorClip.locked) return [];
  return [
    {
      type: 'updateClip',
      sequenceId: sequence.id,
      clipId: shot.anchorClip.id,
      changes: { shotNotes: nextNotes.trim() },
    },
  ];
}

/**
 * Updates or creates the synced narration caption for a Composite Shot.
 * - When a shot has 1 caption and `resetTiming` is false (default), preserves its exact original `start`/`duration`.
 * - When explicitly merging/re-timing multiple captions (`resetTiming: true` or explicit merge), consolidates to [shot.start, shot.duration].
 */
export function updateShotScriptOperations(
  sequence: Sequence,
  shot: CompositeShot,
  nextScript: string,
  options: { resetTiming?: boolean } = {},
): EditOperation[] {
  const trimmed = nextScript.trim();
  const ops: EditOperation[] = [
    {
      type: 'updateClip',
      sequenceId: sequence.id,
      clipId: shot.anchorClip.id,
      changes: { shotNotes: trimmed },
    },
  ];

  if (shot.captionClips.length > 0) {
    if (!trimmed) {
      for (const cap of shot.captionClips) {
        if (!cap.locked) ops.push({ type: 'deleteClip', sequenceId: sequence.id, clipId: cap.id });
      }
    } else if (shot.captionClips.length === 1 && !options.resetTiming) {
      const onlyCap = shot.captionClips[0];
      if (!onlyCap.locked) {
        ops.push({
          type: 'updateClip',
          sequenceId: sequence.id,
          clipId: onlyCap.id,
          changes: {
            name: trimmed.slice(0, 22),
            props: { text: trimmed },
          },
        });
      }
    } else {
      const [firstCap, ...extraCaps] = shot.captionClips;
      if (!firstCap.locked) {
        ops.push({
          type: 'updateClip',
          sequenceId: sequence.id,
          clipId: firstCap.id,
          changes: {
            start: shot.start,
            duration: shot.duration,
            name: trimmed.slice(0, 22),
            props: { text: trimmed },
          },
        });
      }
      for (const extra of extraCaps) {
        if (!extra.locked) {
          ops.push({ type: 'deleteClip', sequenceId: sequence.id, clipId: extra.id });
        }
      }
    }
  } else if (trimmed) {
    const cap = {
      ...newClip('caption', shot.start),
      duration: shot.duration,
      name: trimmed.slice(0, 22),
      props: {
        text: trimmed,
        fontSize: 44,
        color: '#ffffff',
        position: 'bottom' as const,
        background: '#00000088',
        animation: 'none' as const,
      },
    };
    ops.push({ type: 'addClip', sequenceId: sequence.id, clip: cap });
  }
  return ops;
}

/**
 * Splits multi-line outline or script paragraphs into clean sequential Composite Shots:
 * - Preserves numeric data verbatim (only strips explicit list bullets/ordinals).
 * - Places new shots right after existing visual/overlay/caption content (never pushed behind a 30s BGM).
 * - Avoids double-rendering identical full copy on both center title and bottom caption.
 */
export function scriptOutlineToShotOperations(
  sequence: Sequence,
  outline: string,
  sourceBinding?: { entityId: string; version?: number },
): EditOperation[] {
  const lines = outline
    .split(/\n+/)
    .map(stripExplicitListMarker)
    .filter(Boolean);
  if (!lines.length) return [];

  const fps = sequence.fps;
  const nonAudioClips = sequence.clips.filter((c) => c.track !== 'audio');
  let cursor = nonAudioClips.length
    ? Math.max(...nonAudioClips.map((c) => c.start + c.duration))
    : 0;

  const existingShotCount = sequence.clips.filter((c) => c.track === 'visual').length;
  const ops: EditOperation[] = [];
  lines.forEach((line, idx) => {
    const shotNum = existingShotCount + idx + 1;
    const sec = Math.max(3.5, Math.min(8, line.length * 0.24));
    const dur = Math.round(sec * fps);
    const visualShot: Clip = {
      ...clone(newClip('title', cursor)),
      id: uid('clip'),
      track: 'visual',
      name: `镜头 ${String(shotNum).padStart(2, '0')} · ${line.slice(0, 14)}`,
      duration: dur,
      shotNotes: line,
      ...(sourceBinding
        ? {
            subjectIds: [sourceBinding.entityId],
            subjectBindings: [{ entityId: sourceBinding.entityId, pinnedVersion: sourceBinding.version }],
          }
        : {}),
      props: {
        text: `镜头 ${String(shotNum).padStart(2, '0')}`,
        subtitle: '分镜占位 · 可替换素材或生成画面',
        fontSize: 54,
        color: '#cbd5e1',
        background: '#111318',
        position: 'center',
        align: 'center',
        animation: 'none',
      },
    };
    const capClip: Clip = {
      ...newClip('caption', cursor),
      id: uid('clip'),
      duration: dur,
      name: line.slice(0, 20),
      props: {
        text: line,
        fontSize: 44,
        color: '#ffffff',
        position: 'bottom',
        background: '#00000088',
        animation: 'none',
      },
    };
    ops.push({ type: 'addClip', sequenceId: sequence.id, clip: visualShot });
    ops.push({ type: 'addClip', sequenceId: sequence.id, clip: capClip });
    cursor += dur;
  });
  return ops;
}
