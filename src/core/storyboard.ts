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
  /** Co-occurring overlay/visual clips composited in the same shot window */
  compositeClips: Clip[];
  /** Synced caption clips inside this shot window */
  captionClips: Clip[];
  /** Editable narration / subtitle script for this shot */
  scriptText: string;
  /** Bound @Entity:Variant consistency references */
  bindings: ShotBinding[];
  locked: boolean;
}

function overlapRatio(aStart: number, aDur: number, bStart: number, bDur: number): number {
  const ov = Math.min(aStart + aDur, bStart + bDur) - Math.max(aStart, bStart);
  if (ov <= 0) return 0;
  return ov / Math.max(1, Math.min(aDur, bDur));
}

/**
 * Groups multi-track timeline clips into contiguous, non-overlapping Composite Scene Shots ("一镜一卡").
 * - Co-occurring visual + overlay + caption at the same window merge into ONE coherent Shot Card.
 * - When multiple short overlays subdivide a long backdrop (e.g. 10s backdrop + 2 short titles),
 *   partitions [v.start, v.end) into non-overlapping head / overlay / gap / tail shot windows so
 *   100% of the backdrop is covered with zero overlapping duplicate cards.
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

  const minSlice = Math.min(15, Math.max(6, Math.floor(sequence.fps * 0.4)));
  const windows: { id: string; start: number; duration: number; anchor: Clip; members: Clip[] }[] = [];
  const consumedOverlayIds = new Set<string>();

  for (const v of visuals) {
    const vEnd = v.start + v.duration;
    // Overlays falling inside v's span
    const innerOverlays = overlays.filter(
      (ov) => !consumedOverlayIds.has(ov.id) && ov.start < vEnd - 2 && ov.start + ov.duration > v.start + 2,
    );
    const shortSubOverlays = innerOverlays.filter((ov) => ov.duration < v.duration * 0.75);

    // Subdivide v into contiguous non-overlapping intervals if >= 2 short overlays OR 1 very short (<45%) overlay on a long (>=6s) backdrop
    const shouldPartition =
      shortSubOverlays.length >= 2 ||
      (shortSubOverlays.length === 1 &&
        v.duration >= sequence.fps * 6 &&
        overlapRatio(v.start, v.duration, shortSubOverlays[0].start, shortSubOverlays[0].duration) < 0.45);

    if (shouldPartition) {
      // Merge any overlapping shortSubOverlays into disjoint sub-windows clamped to [v.start, vEnd]
      const merged: { start: number; end: number; ovs: Clip[] }[] = [];
      for (const ov of shortSubOverlays) {
        consumedOverlayIds.add(ov.id);
        const s = Math.max(v.start, ov.start);
        const e = Math.min(vEnd, ov.start + ov.duration);
        if (e <= s) continue;
        const prev = merged.at(-1);
        if (prev && s < prev.end) {
          prev.end = Math.max(prev.end, e);
          prev.ovs.push(ov);
        } else {
          merged.push({ start: s, end: e, ovs: [ov] });
        }
      }
      // Also attach any full-span overlay covering v
      const fullSpanOvs = innerOverlays.filter((ov) => !consumedOverlayIds.has(ov.id));
      for (const fo of fullSpanOvs) consumedOverlayIds.add(fo.id);

      let cursor = v.start;
      for (let idx = 0; idx < merged.length; idx++) {
        const seg = merged[idx];
        if (seg.start - cursor >= minSlice) {
          windows.push({
            id: `${v.id}@${cursor}`,
            start: cursor,
            duration: seg.start - cursor,
            anchor: v,
            members: [v, ...fullSpanOvs],
          });
          cursor = seg.start;
        } else {
          seg.start = cursor;
        }
        const isLast = idx === merged.length - 1;
        const tailRem = vEnd - seg.end;
        const segEnd = isLast && tailRem > 0 && tailRem < minSlice ? vEnd : seg.end;
        const featured = seg.ovs.find((m) => m.props.presetId || m.kind === 'code') || seg.ovs[0];
        windows.push({
          id: featured.id,
          start: seg.start,
          duration: segEnd - seg.start,
          anchor: featured,
          members: [v, ...fullSpanOvs, ...seg.ovs],
        });
        cursor = segEnd;
      }
      if (vEnd - cursor >= minSlice) {
        windows.push({
          id: `${v.id}@${cursor}`,
          start: cursor,
          duration: vEnd - cursor,
          anchor: v,
          members: [v, ...fullSpanOvs],
        });
      }
      continue;
    }

    // Standard single composite shot: merge co-occurring overlays (>= 45% overlap) into v
    const matchingOverlays = innerOverlays.filter(
      (ov) => overlapRatio(v.start, v.duration, ov.start, ov.duration) >= 0.45,
    );
    for (const m of matchingOverlays) consumedOverlayIds.add(m.id);
    const featured = matchingOverlays.find((m) => m.props.presetId || m.kind === 'code');
    const vIsBackground =
      v.kind === 'shape' && (!v.props.presetId || getPreset(String(v.props.presetId))?.category === 'backgrounds');
    windows.push({
      id: v.id,
      start: v.start,
      duration: v.duration,
      anchor: vIsBackground && featured ? featured : v,
      members: [v, ...matchingOverlays],
    });
  }

  // Remaining standalone overlay scenes (with no underlying visual clip) — merge overlapping ones too!
  const remOverlays = overlays.filter((ov) => !consumedOverlayIds.has(ov.id));
  const standaloneMerged: { start: number; end: number; ovs: Clip[] }[] = [];
  for (const ov of remOverlays) {
    const s = ov.start;
    const e = ov.start + ov.duration;
    const prev = standaloneMerged.at(-1);
    if (prev && s < prev.end) {
      prev.end = Math.max(prev.end, e);
      prev.ovs.push(ov);
    } else {
      standaloneMerged.push({ start: s, end: e, ovs: [ov] });
    }
  }
  for (const seg of standaloneMerged) {
    const featured = seg.ovs.find((m) => m.props.presetId || m.kind === 'code') || seg.ovs[0];
    windows.push({
      id: featured.id,
      start: seg.start,
      duration: seg.end - seg.start,
      anchor: featured,
      members: seg.ovs,
    });
  }

  windows.sort((a, b) => a.start - b.start);

  return windows.map((win, i) => {
    const shotCaps = captions.filter((cap) => {
      const mid = cap.start + cap.duration / 2;
      return mid >= win.start && mid < win.start + win.duration;
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
      captionClips: shotCaps,
      scriptText,
      bindings,
      locked: win.members.some((m) => m.locked) || shotCaps.some((c) => c.locked),
    };
  });
}

/**
 * Computes true narrative Storyboard Shots along the primary V1 visual lane for Create Canvas.
 * Unlike computeCompositeShots (which subdivides long backdrops across short overlay titles),
 * this keeps one visual clip = one continuous shot card so adding overlay text NEVER fragments
 * the underlying visual scene into artificial sub-shots.
 */
export function computePrimaryTimelineShots(sequence: Sequence): CompositeShot[] {
  const visuals = sequence.clips
    .filter((c) => c.track === 'visual')
    .sort((a, b) => a.start - b.start || (a.layer ?? 0) - (b.layer ?? 0));
  const overlays = sequence.clips
    .filter((c) => c.track === 'overlay')
    .sort((a, b) => a.start - b.start || (a.layer ?? 0) - (b.layer ?? 0));
  const captions = sequence.clips
    .filter((c) => c.kind === 'caption' || c.track === 'caption')
    .sort((a, b) => a.start - b.start);

  const bases: { id: string; start: number; duration: number; anchor: Clip; members: Clip[] }[] = [];
  if (visuals.length > 0) {
    for (const v of visuals) {
      const vEnd = v.start + v.duration;
      const innerOvs = overlays.filter((ov) => ov.start < vEnd - 2 && ov.start + ov.duration > v.start + 2);
      bases.push({ id: v.id, start: v.start, duration: v.duration, anchor: v, members: [v, ...innerOvs] });
    }
  } else {
    const merged: { start: number; end: number; ovs: Clip[] }[] = [];
    for (const ov of overlays) {
      const prev = merged.at(-1);
      if (prev && ov.start < prev.end) {
        prev.end = Math.max(prev.end, ov.start + ov.duration);
        prev.ovs.push(ov);
      } else {
        merged.push({ start: ov.start, end: ov.start + ov.duration, ovs: [ov] });
      }
    }
    for (const seg of merged) {
      const anchor = seg.ovs[0];
      bases.push({ id: anchor.id, start: seg.start, duration: seg.end - seg.start, anchor, members: seg.ovs });
    }
  }

  return bases.map((b, i) => {
    const shotCaps = captions.filter((cap) => {
      const mid = cap.start + cap.duration / 2;
      return mid >= b.start && mid < b.start + b.duration;
    });
    const bindings: ShotBinding[] = b.anchor.subjectBindings?.length
      ? b.anchor.subjectBindings
      : (b.anchor.subjectIds || []).map((id) => ({ entityId: id }));
    const scriptText =
      shotCaps
        .map((c) => String(c.props.text || '').trim())
        .filter(Boolean)
        .join(' ') ||
      b.anchor.shotNotes ||
      '';
    return {
      id: b.id,
      index: i + 1,
      start: b.start,
      duration: b.duration,
      anchorClip: b.anchor,
      compositeClips: b.members,
      captionClips: shotCaps,
      scriptText,
      bindings,
      locked: b.members.some((m) => m.locked) || shotCaps.some((c) => c.locked),
    };
  });
}

/**
 * Atomically swaps two adjacent Composite Shots, shifting ALL visual, overlay, and caption clips
 * belonging to each shot so subtitles and overlays NEVER desync from visuals.
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

  // Prevent swapping sub-windows that share the exact same underlying visual clip
  const sharedClip = shotA.compositeClips.some((ca) => shotB.compositeClips.some((cb) => cb.id === ca.id));
  if (sharedClip) return [];

  const aClips = [...new Map([...shotA.compositeClips, ...shotA.captionClips].map((c) => [c.id, c])).values()];
  const bClips = [...new Map([...shotB.compositeClips, ...shotB.captionClips].map((c) => [c.id, c])).values()];

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
 * Updates or creates the synced narration caption for a Composite Shot.
 * When a shot previously had multiple subtitle clips, updates the first clip to span the shot
 * and deletes stale extra subtitle clips inside the shot window so no duplicate old lines linger.
 */
export function updateShotScriptOperations(
  sequence: Sequence,
  shot: CompositeShot,
  nextScript: string,
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

/** Splits multi-line outline or script paragraphs into clean sequential Composite Shots */
export function scriptOutlineToShotOperations(
  sequence: Sequence,
  outline: string,
  sourceBinding?: { entityId: string; version?: number },
): EditOperation[] {
  const lines = outline
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-*•\d.、)]+\s*/, '').trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const fps = sequence.fps;
  let cursor = sequence.clips.length
    ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
    : 0;

  const ops: EditOperation[] = [];
  lines.forEach((line, idx) => {
    const sec = Math.max(3.5, Math.min(8, line.length * 0.24));
    const dur = Math.round(sec * fps);
    const visualShot: Clip = {
      ...clone(newClip('title', cursor)),
      id: uid('clip'),
      track: 'visual',
      name: `镜头 ${String(idx + 1).padStart(2, '0')} · ${line.slice(0, 14)}`,
      duration: dur,
      shotNotes: line,
      ...(sourceBinding
        ? {
            subjectIds: [sourceBinding.entityId],
            subjectBindings: [{ entityId: sourceBinding.entityId, pinnedVersion: sourceBinding.version }],
          }
        : {}),
      props: {
        text: line.slice(0, 26),
        fontSize: 62,
        color: '#f1f5f9',
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
