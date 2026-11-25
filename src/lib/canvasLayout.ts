import type { Asset, CanvasGeneratorNode, CanvasGroup, VaultItem } from '../core/types';

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasSize {
  w: number;
  h: number;
}

const MEDIA_EXT_RE = /\.(svg|png|jpe?g|webp|gif|bmp|avif|mp4|mov|m4v|webm|wav|mp3|m4a|aac|ogg|glb|gltf)$/i;
const TRAILING_DURATION_RE = /\s*[·•-]\s*\d+(?:\.\d+)?s\s*$/i;

/**
 * Strips noisy file extensions and duplicate trailing duration tags from card titles
 * so the canvas reads cleanly like a creative moodboard.
 */
export function formatCanvasDisplayName(rawName: string, stripTrailingDuration = false): string {
  let out = rawName.trim().replace(MEDIA_EXT_RE, '');
  if (stripTrailingDuration) {
    out = out.replace(TRAILING_DURATION_RE, '');
  }
  return out.trim() || rawName.trim();
}

/**
 * Formats right-hand metadata badge for standalone Asset cards:
 * - Images show format/dimensions (`SVG` / `1920×1080` / `图片`), NEVER a bogus `8.0s` duration!
 * - 3D models show `GLB`
 * - Video & audio show duration in seconds (`18.4s`).
 */
export function formatAssetCardMeta(asset: Asset): string {
  if (asset.kind === 'image') {
    if (/\.svg$/i.test(asset.name) || /\.svg$/i.test(asset.path || '')) return 'SVG';
    if (asset.width && asset.height) return `${asset.width}×${asset.height}`;
    return '图片';
  }
  if (asset.kind === 'model-3d') {
    if (
      asset.subkind === 'splat-3d' ||
      /\.(spz|splat|ksplat|ply)$/i.test(asset.name || asset.path || '')
    ) {
      return '3DGS';
    }
    return 'GLB';
  }
  if (asset.duration > 0) return `${asset.duration.toFixed(1)}s`;
  return '';
}

/**
 * Accurate rendered card size matching actual DOM geometry so bottom/top wire anchors
 * sit flush on the card border (no floating 15px gap).
 */
export function estimateCanvasNodeSize(
  key: string,
  ctx: {
    assets: readonly Asset[];
    entities: readonly VaultItem[];
    generators?: readonly CanvasGeneratorNode[];
  },
): CanvasSize {
  if (key.startsWith('shot:')) return { w: 288, h: 276 };
  if (key.startsWith('gen:')) {
    const g = ctx.generators?.find((x) => `gen:${x.id}` === key);
    if (g?.collapsed) return { w: 248, h: 66 };
    return { w: 316, h: 268 };
  }
  if (key.startsWith('asset:')) {
    const a = ctx.assets.find((x) => `asset:${x.id}` === key);
    if (a?.kind === 'audio') return { w: 248, h: 86 };
    return { w: 248, h: 162 };
  }
  if (key.startsWith('ent:')) {
    const ent = ctx.entities.find((x) => `ent:${x.id}` === key);
    if (ent?.entityKind === 'text') return { w: 280, h: 146 };
    if (ent?.variants && ent.variants.length > 0) return { w: 248, h: 192 };
    return { w: 248, h: 162 };
  }
  return { w: 248, h: 162 };
}

function rectsOverlap(
  aPos: CanvasPoint,
  aSz: CanvasSize,
  bPos: CanvasPoint,
  bSz: CanvasSize,
  gutter = 14,
): boolean {
  return !(
    aPos.x + aSz.w + gutter <= bPos.x ||
    bPos.x + bSz.w + gutter <= aPos.x ||
    aPos.y + aSz.h + gutter <= bPos.y ||
    bPos.y + bSz.h + gutter <= aPos.y
  );
}

/** Starting Y for row 0 cards so zone frames (`minY - 58`), zone headers & floating toolbars sit cleanly below the Top HUD. */
export const CANVAS_LANE_TOP = 116;

/**
 * Collision-free layout resolver:
 * 1) Preserves valid user-dragged positions from `savedPositions` (if two saved nodes are
 *    literally stacked within 24px from legacy data, the second is shifted to a free slot).
 * 2) Places unpositioned nodes into the first non-overlapping grid slot so new entities/assets
 *    NEVER land on top of manually positioned cards.
 */
export function resolveNonOverlappingCanvasLayout(params: {
  assetNodeKeys: readonly string[];
  shotNodeKeys: readonly string[];
  savedPositions: Record<string, CanvasPoint>;
  occupiedRects?: readonly { pos: CanvasPoint; sz: CanvasSize }[];
  assetCols: number;
  shotLaneX: number;
  getSize: (key: string) => CanvasSize;
}): Record<string, CanvasPoint> {
  const { assetNodeKeys, shotNodeKeys, savedPositions, occupiedRects = [], assetCols, shotLaneX, getSize } =
    params;
  const map: Record<string, CanvasPoint> = {};
  const placed: { key: string; pos: CanvasPoint; sz: CanvasSize }[] = occupiedRects.map((r, i) => ({
    key: `__occupied_${i}`,
    pos: r.pos,
    sz: r.sz,
  }));

  const collidesAny = (pos: CanvasPoint, sz: CanvasSize, gutter = 14) =>
    placed.some((p) => rectsOverlap(pos, sz, p.pos, p.sz, gutter));

  const placeInFirstFreeSlot = (
    key: string,
    sz: CanvasSize,
    startX: number,
    cols: number,
    stepX: number,
    stepY: number,
  ): CanvasPoint => {
    for (let slot = 0; slot < 2000; slot++) {
      const col = cols > 1 ? slot % cols : 0;
      const row = cols > 1 ? Math.floor(slot / cols) : slot;
      const candidate = { x: startX + col * stepX, y: CANVAS_LANE_TOP + row * stepY };
      if (!collidesAny(candidate, sz, 14)) {
        return candidate;
      }
    }
    return { x: startX, y: CANVAS_LANE_TOP + placed.length * stepY };
  };

  // Pass 1: lock in valid manual saved positions first (guarding against exact legacy stacks)
  const deferredAssets: string[] = [];
  for (const key of assetNodeKeys) {
    const saved = savedPositions[key];
    const sz = getSize(key);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const exactStacked = placed.some(
        (p) => Math.abs(p.pos.x - saved.x) < 28 && Math.abs(p.pos.y - saved.y) < 28,
      );
      if (!exactStacked) {
        map[key] = saved;
        placed.push({ key, pos: saved, sz });
        continue;
      }
    }
    deferredAssets.push(key);
  }

  const deferredShots: string[] = [];
  for (const key of shotNodeKeys) {
    const saved = savedPositions[key];
    const sz = getSize(key);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const exactStacked = placed.some(
        (p) => Math.abs(p.pos.x - saved.x) < 28 && Math.abs(p.pos.y - saved.y) < 28,
      );
      if (!exactStacked) {
        map[key] = saved;
        placed.push({ key, pos: saved, sz });
        continue;
      }
    }
    deferredShots.push(key);
  }

  // Pass 2: assign free grid slots for all unpositioned (or legacy-stacked) nodes
  for (const key of deferredAssets) {
    const sz = getSize(key);
    const pos = placeInFirstFreeSlot(key, sz, 40, assetCols, 300, 214);
    map[key] = pos;
    placed.push({ key, pos, sz });
  }

  for (const key of deferredShots) {
    const sz = getSize(key);
    const pos = placeInFirstFreeSlot(key, sz, shotLaneX, 6, 316, 246);
    map[key] = pos;
    placed.push({ key, pos, sz });
  }

  return map;
}

/**
 * One-click Figma-style "Tidy Up" that neatly arranges all visible nodes into
 * collision-free grids while keeping grouped nodes adjacent.
 */
export function computeTidyCanvasLayout(params: {
  assetNodeKeys: readonly string[];
  shotNodeKeys: readonly string[];
  groups: readonly CanvasGroup[];
  getSize: (key: string) => CanvasSize;
}): { positions: Record<string, CanvasPoint>; shotLaneX: number } {
  const { assetNodeKeys, shotNodeKeys, groups, getSize } = params;
  const positions: Record<string, CanvasPoint> = {};

  // Order asset keys so members of the same group stay contiguous
  const orderedAssets: string[] = [];
  const seen = new Set<string>();
  const assetSet = new Set(assetNodeKeys);
  for (const grp of groups) {
    for (const id of grp.nodeIds) {
      if (assetSet.has(id) && !seen.has(id)) {
        orderedAssets.push(id);
        seen.add(id);
      }
    }
  }
  for (const id of assetNodeKeys) {
    if (!seen.has(id)) {
      orderedAssets.push(id);
      seen.add(id);
    }
  }

  const cols = orderedAssets.length > 8 ? 3 : orderedAssets.length > 3 ? 2 : 1;
  const colStep = orderedAssets.some((k) => getSize(k).w > 290) ? 356 : 304;
  const colY = Array.from({ length: cols }, () => CANVAS_LANE_TOP);

  orderedAssets.forEach((key, idx) => {
    const col = cols > 1 ? idx % cols : 0;
    const sz = getSize(key);
    positions[key] = { x: 40 + col * colStep, y: colY[col] };
    colY[col] += sz.h + 44;
  });

  const shotLaneX = orderedAssets.length > 0 ? 40 + cols * colStep + 68 : 80;
  shotNodeKeys.forEach((key, i) => {
    const col = i % 6;
    const row = Math.floor(i / 6);
    positions[key] = {
      x: shotLaneX + col * 316,
      y: CANVAS_LANE_TOP + row * 246,
    };
  });

  return { positions, shotLaneX };
}
