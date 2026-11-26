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

function fallbackSizeForKey(key: string): CanvasSize {
  if (key.startsWith('shot:')) return { w: 288, h: 276 };
  if (key.startsWith('gen:')) return { w: 316, h: 268 };
  if (key.startsWith('ent:')) return { w: 280, h: 172 };
  return { w: 256, h: 172 };
}

/**
 * Finds the nearest collision-free canvas position at or near `desired` against all
 * existing entries in `existingLayout`. Used by backend generation/capture/extraction
 * handlers and frontend node creation so newly created cards NEVER land on top of existing ones.
 */
export function findFreeCanvasPlacement(
  existingLayout: Record<string, CanvasPoint> | undefined,
  desired: CanvasPoint,
  sz: CanvasSize = { w: 256, h: 172 },
  excludeKey?: string,
): CanvasPoint {
  const baseX = Math.round(desired.x);
  const baseY = Math.max(CANVAS_LANE_TOP, Math.round(desired.y));
  const placed: { pos: CanvasPoint; sz: CanvasSize }[] = [];
  if (existingLayout) {
    for (const [k, pt] of Object.entries(existingLayout)) {
      if (k === excludeKey || !pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
      placed.push({ pos: pt, sz: fallbackSizeForKey(k) });
    }
  }
  const collides = (pos: CanvasPoint) => placed.some((p) => rectsOverlap(pos, sz, p.pos, p.sz, 16));
  if (!collides({ x: baseX, y: baseY })) return { x: baseX, y: baseY };

  const stepX = Math.max(sz.w + 28, 296);
  const stepY = Math.max(sz.h + 28, 206);
  let best: CanvasPoint | null = null;
  let bestDist = Infinity;
  // Search nearby rows & columns cleanly (preferring directly below or right next to desired)
  for (let col = 0; col <= 8; col++) {
    for (let row = 0; row <= 10; row++) {
      if (col === 0 && row === 0) continue;
      const cand = { x: baseX + col * stepX, y: baseY + row * stepY };
      if (!collides(cand)) {
        const d = Math.hypot(cand.x - baseX, (cand.y - baseY) * 1.05);
        if (d < bestDist) {
          bestDist = d;
          best = cand;
        }
      }
    }
  }
  return best || { x: baseX + stepX, y: baseY };
}

/**
 * Collision-free layout resolver:
 * 1) Keeps actively dragged `pinnedKeys` glued to the cursor without jumping.
 * 2) Preserves valid non-overlapping saved positions from `savedPositions`; if two saved
 *    cards collide (even partial overlap!), shifts the colliding card to the nearest clear
 *    spot nearby so existing cards NEVER cover each other.
 * 3) Places unpositioned nodes into the first non-overlapping grid slot.
 */
export function resolveNonOverlappingCanvasLayout(params: {
  assetNodeKeys: readonly string[];
  shotNodeKeys: readonly string[];
  savedPositions: Record<string, CanvasPoint>;
  occupiedRects?: readonly { pos: CanvasPoint; sz: CanvasSize }[];
  pinnedKeys?: ReadonlySet<string>;
  assetCols: number;
  shotLaneX: number;
  getSize: (key: string) => CanvasSize;
}): Record<string, CanvasPoint> {
  const {
    assetNodeKeys,
    shotNodeKeys,
    savedPositions,
    occupiedRects = [],
    pinnedKeys,
    assetCols,
    shotLaneX,
    getSize,
  } = params;
  const map: Record<string, CanvasPoint> = {};
  const placed: { key: string; pos: CanvasPoint; sz: CanvasSize }[] = occupiedRects.map((r, i) => ({
    key: `__occupied_${i}`,
    pos: r.pos,
    sz: r.sz,
  }));

  const collidesAny = (pos: CanvasPoint, sz: CanvasSize, gutter = 14) =>
    placed.some((p) => rectsOverlap(pos, sz, p.pos, p.sz, gutter));

  const placeNear = (desired: CanvasPoint, sz: CanvasSize): CanvasPoint => {
    const baseX = Math.round(desired.x);
    const baseY = Math.max(CANVAS_LANE_TOP, Math.round(desired.y));
    const stepX = Math.max(sz.w + 26, 292);
    const stepY = Math.max(sz.h + 26, 198);
    let best: CanvasPoint | null = null;
    let bestDist = Infinity;
    for (let col = 0; col <= 8; col++) {
      for (let row = 0; row <= 10; row++) {
        if (col === 0 && row === 0) continue;
        const cand = { x: baseX + col * stepX, y: baseY + row * stepY };
        if (!collidesAny(cand, sz, 14)) {
          const d = Math.hypot(cand.x - baseX, (cand.y - baseY) * 1.05);
          if (d < bestDist) {
            bestDist = d;
            best = cand;
          }
        }
      }
    }
    return best || { x: baseX + stepX, y: baseY };
  };

  const placeInFirstFreeSlot = (
    _key: string,
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

  // Pass 0: lock in actively dragged pinned keys verbatim so dragging never teleports
  if (pinnedKeys && pinnedKeys.size > 0) {
    for (const key of [...assetNodeKeys, ...shotNodeKeys]) {
      if (!pinnedKeys.has(key)) continue;
      const saved = savedPositions[key];
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        const sz = getSize(key);
        map[key] = saved;
        placed.push({ key, pos: saved, sz });
      }
    }
  }

  // Pass 1: lock in valid non-overlapping saved positions; resolve partial or full overlaps locally
  const deferredAssets: string[] = [];
  const collidedSaved: { key: string; desired: CanvasPoint; sz: CanvasSize }[] = [];
  for (const key of assetNodeKeys) {
    if (map[key]) continue;
    const saved = savedPositions[key];
    const sz = getSize(key);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      if (!collidesAny(saved, sz, 10)) {
        map[key] = saved;
        placed.push({ key, pos: saved, sz });
      } else {
        collidedSaved.push({ key, desired: saved, sz });
      }
      continue;
    }
    deferredAssets.push(key);
  }

  const deferredShots: string[] = [];
  for (const key of shotNodeKeys) {
    if (map[key]) continue;
    const saved = savedPositions[key];
    const sz = getSize(key);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      if (!collidesAny(saved, sz, 10)) {
        map[key] = saved;
        placed.push({ key, pos: saved, sz });
      } else {
        collidedSaved.push({ key, desired: saved, sz });
      }
      continue;
    }
    deferredShots.push(key);
  }

  // Pass 1.5: glide colliding saved cards to the closest clear spot nearby (keeps context!)
  for (const item of collidedSaved) {
    const pos = placeNear(item.desired, item.sz);
    map[item.key] = pos;
    placed.push({ key: item.key, pos, sz: item.sz });
  }

  // Pass 2: assign free grid slots for all unpositioned nodes
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
 * collision-free semantic lanes (剧本与设定 | 探索工坊 | 成片分镜序列) so neither cards
 * nor dashed zone frames ever overlap.
 */
export function computeTidyCanvasLayout(params: {
  assetNodeKeys: readonly string[];
  shotNodeKeys: readonly string[];
  contextKeys?: readonly string[];
  exploreKeys?: readonly string[];
  groups: readonly CanvasGroup[];
  getSize: (key: string) => CanvasSize;
}): { positions: Record<string, CanvasPoint>; shotLaneX: number } {
  const { assetNodeKeys, shotNodeKeys, contextKeys, exploreKeys, groups, getSize } = params;
  const positions: Record<string, CanvasPoint> = {};

  const orderWithGroups = (keys: readonly string[]) => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const keySet = new Set(keys);
    for (const grp of groups) {
      for (const id of grp.nodeIds) {
        if (keySet.has(id) && !seen.has(id)) {
          ordered.push(id);
          seen.add(id);
        }
      }
    }
    for (const id of keys) {
      if (!seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    }
    return ordered;
  };

  const placeLane = (keys: readonly string[], startX: number): number => {
    if (!keys.length) return startX;
    const ordered = orderWithGroups(keys);
    const cols = ordered.length > 8 ? 3 : ordered.length > 3 ? 2 : 1;
    const maxW = ordered.reduce((m, k) => Math.max(m, getSize(k).w), 248);
    const colStep = Math.max(maxW + 36, maxW > 290 ? 356 : 304);
    const colY = Array.from({ length: cols }, () => CANVAS_LANE_TOP);
    let maxRight = startX;

    ordered.forEach((key, idx) => {
      const col = cols > 1 ? idx % cols : 0;
      const sz = getSize(key);
      const x = startX + col * colStep;
      positions[key] = { x, y: colY[col] };
      colY[col] += sz.h + 44;
      maxRight = Math.max(maxRight, x + sz.w);
    });
    return maxRight;
  };

  let cursorX = 40;
  const hasExplicitZones = Boolean(contextKeys || exploreKeys);
  if (hasExplicitZones) {
    const ctxList = contextKeys || [];
    const expList = exploreKeys || [];
    if (ctxList.length > 0) {
      cursorX = placeLane(ctxList, cursorX) + 92;
    }
    if (expList.length > 0) {
      cursorX = placeLane(expList, cursorX) + 92;
    }
    // Catch any stray keys not in context/explore
    const placedSet = new Set(Object.keys(positions));
    const rest = assetNodeKeys.filter((k) => !placedSet.has(k));
    if (rest.length > 0) {
      cursorX = placeLane(rest, cursorX) + 92;
    }
  } else {
    const maxRight = placeLane(assetNodeKeys, cursorX);
    cursorX = assetNodeKeys.length > 0 ? maxRight + 92 : 80;
  }

  const shotLaneX = Object.keys(positions).length > 0 ? cursorX : 80;
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
