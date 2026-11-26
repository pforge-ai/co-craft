import type { Clip, ClipKind, Sequence, TimelineTrackDef, Track } from './types';

export const DEFAULT_TIMELINE_TRACKS: TimelineTrackDef[] = [
  { id: 'v2', kind: 'overlay', name: '叠加', layer: 1 },
  { id: 'v1', kind: 'visual', name: '主镜', layer: 0 },
  { id: 't1', kind: 'caption', name: '字幕', layer: 0 },
  { id: 'a1', kind: 'audio', name: '声音', layer: 0 },
];

const KIND_ORDER: Record<Track, number> = {
  overlay: 0,
  visual: 1,
  caption: 2,
  audio: 3,
};

/**
 * Resolves the ordered list of timeline tracks for a sequence.
 * Fully backward-compatible: sequences without `tracks` seamlessly use the canonical 4-track layout.
 * Visual/overlay tracks appear top-to-bottom in descending layer order (V3 -> V2 -> V1),
 * followed by captions (T1 -> T2...) and audio (A1 -> A2...).
 */
export function resolveSequenceTracks(sequence: Pick<Sequence, 'tracks' | 'clips'>): TimelineTrackDef[] {
  const base: TimelineTrackDef[] =
    Array.isArray(sequence.tracks) && sequence.tracks.length > 0
      ? sequence.tracks.map((t) => ({ ...t }))
      : DEFAULT_TIMELINE_TRACKS.map((t) => ({ ...t }));

  // Ensure every clip's explicit trackId (if referenced) still exists or falls back safely
  const byId = new Set(base.map((t) => t.id));
  if (!base.some((t) => t.kind === 'visual')) {
    base.push({ id: 'v1', kind: 'visual', name: '主镜', layer: 0 });
    byId.add('v1');
  }
  for (const c of sequence.clips) {
    if (c.trackId && !byId.has(c.trackId)) {
      const sameKind = base.filter((t) => t.kind === c.track);
      const nextLayer = sameKind.reduce((m, t) => Math.max(m, t.layer), -1) + 1;
      base.push({
        id: c.trackId,
        kind: c.track,
        name:
          c.track === 'audio'
            ? `声音 ${sameKind.length + 1}`
            : c.track === 'caption'
              ? `字幕 ${sameKind.length + 1}`
              : c.track === 'overlay'
                ? `叠加 ${sameKind.length + 1}`
                : '主镜',
        layer: nextLayer,
      });
      byId.add(c.trackId);
    }
  }

  return base.sort((a, b) => {
    const ka = KIND_ORDER[a.kind] ?? 9;
    const kb = KIND_ORDER[b.kind] ?? 9;
    if (ka !== kb) return ka - kb;
    // Higher overlay/visual layers sit higher in the timeline UI (V3 above V2 above V1)
    if (a.kind === 'overlay' || a.kind === 'visual') return b.layer - a.layer;
    return a.layer - b.layer;
  });
}

/**
 * Resolves the effective `TimelineTrackDef` owning a given clip.
 */
export function findTrackForClip(
  clip: Pick<Clip, 'track' | 'trackId'>,
  tracks: readonly TimelineTrackDef[],
): TimelineTrackDef | undefined {
  if (clip.trackId) {
    const exact = tracks.find((t) => t.id === clip.trackId);
    if (exact) return exact;
  }
  // Legacy fallback: match first track of same base kind (lowest layer for overlay/audio/caption)
  const sameKind = tracks.filter((t) => t.kind === clip.track);
  if (!sameKind.length) return tracks.find((t) => t.kind === 'visual') || tracks[0];
  return sameKind.reduce((best, cur) => (cur.layer < best.layer ? cur : best), sameKind[0]);
}

/**
 * Computes human-readable track codes: V1 (visual), V2/V3/V4 (overlays ascending by layer),
 * T1/T2 (captions), A1/A2/A3 (audio).
 */
export function formatTrackCode(
  track: TimelineTrackDef,
  allTracks: readonly TimelineTrackDef[],
): string {
  if (track.kind === 'visual') {
    const visuals = allTracks.filter((t) => t.kind === 'visual').sort((a, b) => a.layer - b.layer);
    const idx = Math.max(0, visuals.findIndex((t) => t.id === track.id));
    return `V${idx + 1}`;
  }
  if (track.kind === 'overlay') {
    const visualCount = Math.max(1, allTracks.filter((t) => t.kind === 'visual').length);
    const overlays = allTracks.filter((t) => t.kind === 'overlay').sort((a, b) => a.layer - b.layer);
    const idx = Math.max(0, overlays.findIndex((t) => t.id === track.id));
    return `V${visualCount + idx + 1}`;
  }
  if (track.kind === 'caption') {
    const caps = allTracks.filter((t) => t.kind === 'caption').sort((a, b) => a.layer - b.layer);
    const idx = Math.max(0, caps.findIndex((t) => t.id === track.id));
    return `T${idx + 1}`;
  }
  const audios = allTracks.filter((t) => t.kind === 'audio').sort((a, b) => a.layer - b.layer);
  const idx = Math.max(0, audios.findIndex((t) => t.id === track.id));
  return `A${idx + 1}`;
}

export function createNewTrackDef(
  existing: readonly TimelineTrackDef[],
  group: 'video' | 'caption' | 'audio',
  customName?: string,
): TimelineTrackDef {
  const kind: Track = group === 'video' ? 'overlay' : group;
  const sameKind = existing.filter((t) => t.kind === kind);
  const maxLayer = sameKind.reduce((m, t) => Math.max(m, t.layer), kind === 'overlay' ? 0 : -1);
  const nextLayer = maxLayer + 1;
  const prefix = group === 'video' ? 'v' : group === 'caption' ? 't' : 'a';
  let seqNum = existing.filter((t) => (group === 'video' ? t.kind === 'visual' || t.kind === 'overlay' : t.kind === kind)).length + 1;
  let id = `${prefix}${seqNum}`;
  while (existing.some((t) => t.id === id)) {
    seqNum++;
    id = `${prefix}${seqNum}`;
  }
  const defaultName =
    group === 'video'
      ? `视频 ${seqNum}`
      : group === 'caption'
        ? `字幕 ${seqNum}`
        : `声音 ${seqNum}`;
  return {
    id,
    kind,
    name: (customName || '').trim() || defaultName,
    layer: nextLayer,
  };
}

export function isTrackCompatibleWithClip(track: TimelineTrackDef, clipKind: ClipKind): boolean {
  if (clipKind === 'audio') return track.kind === 'audio';
  if (clipKind === 'caption') return track.kind === 'caption' || track.kind === 'overlay';
  return track.kind === 'visual' || track.kind === 'overlay';
}

/**
 * Shared active-track predicate honoring BOTH legacy sequence-level mutedTracks/soloTracks
 * AND per-track TimelineTrackDef.muted / solo flags. Identical in Timeline, Preview, and MP4 Export.
 */
export function isClipTrackActive(
  sequence: Pick<Sequence, 'tracks' | 'clips' | 'mutedTracks' | 'soloTracks'>,
  clip: Pick<Clip, 'track' | 'trackId'>,
): boolean {
  const legacyMuted = new Set(sequence.mutedTracks || []);
  const legacySolo = new Set(sequence.soloTracks || []);
  const tracks = resolveSequenceTracks(sequence);
  const def = findTrackForClip(clip, tracks);

  if (legacyMuted.has(clip.track) || def?.muted) return false;

  const anyTrackSolo = tracks.some((t) => t.solo);
  if (legacySolo.size > 0 || anyTrackSolo) {
    return legacySolo.has(clip.track) || Boolean(def?.solo);
  }
  return true;
}

/**
 * Shared compositing order for Film.tsx:
 * visual (0..) < audio (1000..) < overlay (2000 + track.layer * 100..) < caption (5000 + track.layer * 100..)
 */
export function getClipCompositingOrder(
  sequence: Pick<Sequence, 'tracks' | 'clips'>,
  clip: Pick<Clip, 'track' | 'trackId' | 'layer'>,
): number {
  const tracks = resolveSequenceTracks(sequence);
  const def = findTrackForClip(clip, tracks);
  const baseBand: Record<Track, number> = {
    visual: 0,
    audio: 10_000,
    overlay: 20_000,
    caption: 50_000,
  };
  const trackLayer = def?.layer ?? 0;
  return (baseBand[clip.track] ?? 0) + trackLayer * 1000 + (clip.layer ?? 0);
}
