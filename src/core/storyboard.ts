import { clone, newClip, uid } from './project';
import { getPreset } from './presets';
import type { Asset, Clip, EditOperation, Sequence, ShotBinding, VaultItem } from './types';

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

export interface ParsedDialogueLine {
  speakerName?: string;
  entity?: VaultItem;
  stageNote?: string;
  text: string;
  raw: string;
}

/**
 * Parses multi-line scripts with optional speaker attribution (`林夏：台词 [特写]`),
 * preserving numeric times (`00:05`, `16:9`) cleanly and matching bound character VaultItems.
 */
export function parseSpeakerDialogueLines(
  outline: string,
  entities: readonly VaultItem[] = [],
): ParsedDialogueLine[] {
  const lines = outline
    .split(/\n+/)
    .map(stripExplicitListMarker)
    .filter(Boolean);
  const actorEntities = entities.filter((e) => e.entityKind !== 'text' && e.entityKind !== 'compound');
  return lines.map((raw) => {
    let speakerName: string | undefined;
    let body = raw;
    // Match `Speaker：Dialogue` or `Speaker: Dialogue` where speaker is 1..12 non-digit-only chars
    const m = raw.match(/^([^\s:：0-9][^\s:：]{0,11})\s*[:：]\s*(.+)$/);
    if (m) {
      speakerName = m[1].trim();
      body = m[2].trim();
    }
    let stageNote: string | undefined;
    const stageMatch = body.match(/\s*(?:[\[【]([^\]】]{1,28})[\]】]|[（(]([^）)]{1,20})[）)])\s*$/);
    if (stageMatch) {
      stageNote = (stageMatch[1] || stageMatch[2] || '').trim();
      body = body.slice(0, stageMatch.index).trim() || body;
    } else {
      const inlineStage = body.match(/[\[【]([^\]】]{1,28})[\]】]/);
      if (inlineStage) {
        stageNote = inlineStage[1].trim();
        body = body.replace(inlineStage[0], '').replace(/\s{2,}/g, ' ').trim() || body;
      }
    }
    const entity = speakerName
      ? actorEntities.find(
          (e) =>
            e.name.trim() === speakerName ||
            e.name.trim().includes(speakerName) ||
            speakerName.includes(e.name.trim()),
        )
      : undefined;
    return {
      speakerName,
      entity,
      stageNote,
      text: body,
      raw,
    };
  });
}

/**
 * Splits multi-line outline or script paragraphs into clean sequential Composite Shots:
 * - Preserves numeric data verbatim (only strips explicit list bullets/ordinals).
 * - Automatically recognizes `角色名：台词` lines and binds matched character VaultItems.
 * - Places new shots right after existing visual/overlay/caption content (never pushed behind a 30s BGM).
 */
export function scriptOutlineToShotOperations(
  sequence: Sequence,
  outline: string,
  sourceBinding?: { entityId: string; version?: number },
  entities: readonly VaultItem[] = [],
): EditOperation[] {
  const parsed = parseSpeakerDialogueLines(outline, entities);
  if (!parsed.length) return [];

  const fps = sequence.fps;
  const nonAudioClips = sequence.clips.filter((c) => c.track !== 'audio');
  let cursor = nonAudioClips.length
    ? Math.max(...nonAudioClips.map((c) => c.start + c.duration))
    : 0;

  const existingShotCount = sequence.clips.filter((c) => c.track === 'visual').length;
  const ops: EditOperation[] = [];
  parsed.forEach((item, idx) => {
    const line = item.text;
    const shotNum = existingShotCount + idx + 1;
    const sec = Math.max(3.5, Math.min(8, line.length * 0.24));
    const dur = Math.round(sec * fps);
    const bindings: ShotBinding[] = [];
    const subjectIds: string[] = [];
    if (sourceBinding) {
      bindings.push({ entityId: sourceBinding.entityId, pinnedVersion: sourceBinding.version });
      subjectIds.push(sourceBinding.entityId);
    }
    if (item.entity && !subjectIds.includes(item.entity.id)) {
      bindings.push({
        entityId: item.entity.id,
        variantId: item.entity.defaultVariantId,
        pinnedVersion: item.entity.version,
      });
      subjectIds.push(item.entity.id);
    }
    const visualShot: Clip = {
      ...clone(newClip('title', cursor)),
      id: uid('clip'),
      track: 'visual',
      name: `镜头 ${String(shotNum).padStart(2, '0')} · ${(item.speakerName ? `${item.speakerName}：` : '') + line.slice(0, 12)}`,
      duration: dur,
      shotNotes: item.raw,
      ...(bindings.length ? { subjectIds, subjectBindings: bindings } : {}),
      props: {
        text: `镜头 ${String(shotNum).padStart(2, '0')}`,
        subtitle: item.speakerName ? `${item.speakerName} · 分镜占位` : '分镜占位 · 可替换素材或生成画面',
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
        wordHighlight: true,
        wordHighlightColor: '#fde047',
      },
    };
    ops.push({ type: 'addClip', sequenceId: sequence.id, clip: visualShot });
    ops.push({ type: 'addClip', sequenceId: sequence.id, clip: capClip });
    cursor += dur;
  });
  return ops;
}

/**
 * Audio-First Shot Assembly (画+音直合分镜):
 * Creates a visual shot whose duration is strictly driven by the paired audio asset's duration,
 * attaches the audio as shot-local audio, applies subtle L1 cinematic finish on still images,
 * and auto-populates word-highlighted captions if the audio carries a transcript.
 */
export function combineVisualAndAudioToShotOperations(
  sequence: Sequence,
  visualAsset: Asset,
  audioAsset: Asset,
  options: {
    subjectBindings?: ShotBinding[];
    enableL1Cinema?: boolean;
    wordHighlight?: boolean;
  } = {},
): { operations: EditOperation[]; visualClipId: string; audioClipId: string } {
  const fps = sequence.fps;
  const nonAudioClips = sequence.clips.filter((c) => c.track !== 'audio');
  const start = nonAudioClips.length
    ? Math.max(...nonAudioClips.map((c) => c.start + c.duration))
    : 0;
  const sec = Math.max(1.2, audioAsset.duration || 4);
  const dur = Math.max(15, Math.round(sec * fps));
  const isImage = visualAsset.kind === 'image';
  const enableL1 = options.enableL1Cinema !== false && isImage;
  const wordHighlight = options.wordHighlight !== false;

  const visualClip: Clip = {
    ...newClip(isImage ? 'image' : 'video', start, visualAsset.id),
    id: uid('clip'),
    track: 'visual',
    name: visualAsset.name.replace(/\.[^.]+$/, '').slice(0, 24),
    duration: dur,
    ...(options.subjectBindings?.length
      ? {
          subjectBindings: options.subjectBindings,
          subjectIds: options.subjectBindings.map((b) => b.entityId),
        }
      : {}),
    ...(audioAsset.transcript?.text ? { shotNotes: audioAsset.transcript.text.slice(0, 200) } : {}),
    props: {
      fit: 'cover',
      opacity: 1,
      scale: 1,
      ...(enableL1
        ? {
            cameraBreath: 42,
            filmGrain: 18,
            vignette: 16,
          }
        : {}),
    },
  };

  const audioClip: Clip = {
    ...newClip('audio', start, audioAsset.id),
    id: uid('clip'),
    track: 'audio',
    name: audioAsset.name.replace(/\.[^.]+$/, '').slice(0, 24),
    duration: dur,
    audioAttachMode: 'shot',
    props: { volume: 1 },
  };

  const ops: EditOperation[] = [
    { type: 'addClip', sequenceId: sequence.id, clip: visualClip },
    { type: 'addClip', sequenceId: sequence.id, clip: audioClip },
  ];

  const segments = audioAsset.transcript?.segments;
  if (segments && segments.length > 0) {
    for (const seg of segments) {
      const segText = seg.text.trim();
      if (!segText) continue;
      const segStart = start + Math.max(0, Math.round(seg.start * fps));
      const segEnd = start + Math.min(dur, Math.max(segStart - start + 8, Math.round(seg.end * fps)));
      const segDur = Math.max(8, segEnd - segStart);
      if (segStart >= start + dur) continue;
      ops.push({
        type: 'addClip',
        sequenceId: sequence.id,
        clip: {
          ...newClip('caption', segStart),
          id: uid('clip'),
          duration: Math.min(segDur, start + dur - segStart),
          name: segText.slice(0, 20),
          props: {
            text: segText,
            fontSize: 44,
            color: '#ffffff',
            position: 'bottom',
            background: '#00000088',
            animation: 'none',
            wordHighlight,
            wordHighlightColor: '#fde047',
          },
        },
      });
    }
  } else if (audioAsset.transcript?.text?.trim()) {
    const t = audioAsset.transcript.text.trim();
    ops.push({
      type: 'addClip',
      sequenceId: sequence.id,
      clip: {
        ...newClip('caption', start),
        id: uid('clip'),
        duration: dur,
        name: t.slice(0, 20),
        props: {
          text: t,
          fontSize: 44,
          color: '#ffffff',
          position: 'bottom',
          background: '#00000088',
          animation: 'none',
          wordHighlight,
          wordHighlightColor: '#fde047',
        },
      },
    });
  }

  return { operations: ops, visualClipId: visualClip.id, audioClipId: audioClip.id };
}

/**
 * Pure parser for FFmpeg `silencedetect` stderr output into non-silent speech intervals
 * with natural breath padding (shared by Electron FFmpeg trimming & pure-Node unit tests).
 */
export function parseSilenceDetectLog(
  stderrLog: string,
  totalDuration: number,
  padSec = 0.06,
): { kept: { start: number; end: number }[]; removedSeconds: number } {
  const dur = Math.max(0, totalDuration);
  if (dur <= 0) return { kept: [], removedSeconds: 0 };
  const silences: { start: number; end: number }[] = [];
  let pendingStart: number | null = null;
  for (const line of stderrLog.split(/\r?\n/)) {
    const sm = line.match(/silence_start:\s*([0-9.]+)/);
    if (sm) {
      pendingStart = Math.max(0, Math.min(dur, Number(sm[1])));
      continue;
    }
    const em = line.match(/silence_end:\s*([0-9.]+)/);
    if (em) {
      const end = Math.max(0, Math.min(dur, Number(em[1])));
      const start = pendingStart !== null ? pendingStart : 0;
      if (end > start) silences.push({ start, end });
      pendingStart = null;
    }
  }
  if (pendingStart !== null && dur > pendingStart) {
    silences.push({ start: pendingStart, end: dur });
  }
  if (!silences.length) return { kept: [{ start: 0, end: dur }], removedSeconds: 0 };

  const rawKept: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start > cursor) {
      rawKept.push({
        start: Math.max(0, cursor - padSec),
        end: Math.min(dur, s.start + padSec),
      });
    }
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < dur) {
    rawKept.push({ start: Math.max(0, cursor - padSec), end: dur });
  }

  const merged: { start: number; end: number }[] = [];
  for (const seg of rawKept) {
    if (seg.end - seg.start < 0.04) continue;
    const prev = merged[merged.length - 1];
    if (prev && seg.start <= prev.end + 0.03) {
      prev.end = Math.max(prev.end, seg.end);
    } else {
      merged.push({ ...seg });
    }
  }
  const keptDur = merged.reduce((sum, x) => sum + (x.end - x.start), 0);
  return { kept: merged, removedSeconds: Math.max(0, Number((dur - keptDur).toFixed(2))) };
}
