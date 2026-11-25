import type { Asset, AssetRole, Clip } from './types';

export type OmnibarLocalIntent = 'tidy' | 'new-text' | 'breakdown' | 'reframe-vertical' | 'agent';

/**
 * Pure Tier-0 local heuristic role classifier ($0, 0ms).
 * Used whenever System 1 is OFF or gracefully falls back.
 */
export function classifyAssetRoleLocally(
  asset: Pick<Asset, 'name' | 'kind' | 'duration' | 'width' | 'height'>,
): AssetRole {
  const n = asset.name.toLowerCase();
  if (asset.kind === 'audio') {
    if (/(bgm|music|配乐|背景音|ambient|theme|ost)/i.test(n) || asset.duration >= 20) return 'bgm';
    if (/(sfx|音效|whoosh|click|boom|hit|雨声|风声)/i.test(n) || (asset.duration > 0 && asset.duration <= 2.5)) {
      return 'sfx';
    }
    return 'voiceover';
  }
  if (asset.kind === 'video') {
    if (/(screen|录屏|demo|capture|ui)/i.test(n)) return 'screen-recording';
    return 'footage';
  }
  if (/(character|actor|hero|girl|boy|role|人物|角色|主角|立绘|定妆|人像|portrait)/i.test(n)) return 'character';
  if (/(scene|env|bg|backdrop|street|room|city|forest|场景|背景|环境|街道|建筑)/i.test(n)) return 'environment';
  if (/(style|palette|mood|参考风|风格|色调|质感)/i.test(n)) return 'visual-style';
  if (/(product|item|prop|phone|bottle|产品|道具|商品|包装)/i.test(n)) return 'product';
  return asset.width && asset.height && asset.height > asset.width ? 'character' : 'environment';
}

/**
 * Pure Tier-0 deterministic Omnibar local intent matcher ($0, 0ms).
 * Intercepts obvious zero-ambiguity local actions without spending main Agent tokens.
 */
export function routeOmnibarLocally(text: string): { intent: OmnibarLocalIntent; confidence: number } {
  const t = text.trim();
  if (!t) return { intent: 'agent', confidence: 1 };
  if (/^(整理|排版|对齐|自动整理|一键整理)(画布|节点|布局)?[。！!]?$/i.test(t)) {
    return { intent: 'tidy', confidence: 0.96 };
  }
  if (/^(派生|生成|转成|转|切换)?\s*(?:(9\s*[:：]\s*16|竖屏|抖音|小红书)\s*){1,3}(版本|分支|画幅|版)?[。！!]?$/i.test(t)) {
    return { intent: 'reframe-vertical', confidence: 0.94 };
  }
  if (/^(新建|加一个?|创建)(文本|便签|剧本|脚本)(卡|节点)?[:：]?\s*/i.test(t) && t.length <= 42) {
    return { intent: 'new-text', confidence: 0.9 };
  }
  if (t.includes('\n') && t.split(/\n+/).filter((x) => x.trim()).length >= 3 && !/[？?]/.test(t)) {
    return { intent: 'breakdown', confidence: 0.86 };
  }
  return { intent: 'agent', confidence: 0.5 };
}

/**
 * Converts TypeSafe Jev `box` (`{ top, bottom, left, right }`) into CoCraft `0..100` percentage focal point
 * (`focalX`, `focalY` clamped to `[10, 90]`, matching `Film.tsx` `objectPosition` and `Inspector.tsx` sliders).
 * Supports Jev 0..1000 normalized grid, 0..1 fractions, and pixel coordinates when `imgW/imgH` are supplied.
 */
export function boxToNormalizedFocal(
  box: { top: number; bottom: number; left: number; right: number },
  imgW?: number,
  imgH?: number,
): { focalX: number; focalY: number } | null {
  const { top, bottom, left, right } = box;
  if (![top, bottom, left, right].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const maxVal = Math.max(Math.abs(top), Math.abs(bottom), Math.abs(left), Math.abs(right));
  let cx: number;
  let cy: number;
  if (maxVal <= 1.05) {
    cx = ((left + right) / 2) * 100;
    cy = ((top + bottom) / 2) * 100;
  } else if (maxVal <= 1000) {
    cx = ((left + right) / 2 / 1000) * 100;
    cy = ((top + bottom) / 2 / 1000) * 100;
  } else if (imgW && imgH) {
    cx = ((left + right) / 2 / imgW) * 100;
    cy = ((top + bottom) / 2 / imgH) * 100;
  } else {
    return null;
  }
  const clampPct = (v: number) => Math.round(Math.max(10, Math.min(90, v)));
  return { focalX: clampPct(cx), focalY: clampPct(cy) };
}

/**
 * Pure deterministic Auto-Reframe transformer for aspect-ratio branching (e.g. 16:9 -> 9:16 portrait or 1:1 square):
 * - Media clips switch to `cover` with subject-locked `focalX/Y` (0..100% scale, from System 1 Box or smart upper-third 50/42).
 * - Portrait captions auto-scale font size and lift bottom safe-zone to clear short-video platform UI overlays.
 */
export function reframeClipForTargetAspect(
  clip: Clip,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  focalOverride?: { focalX: number; focalY: number },
): Clip {
  const next: Clip = { ...clip, props: { ...clip.props } };
  const becomingPortrait = dstH > dstW && srcW >= srcH;
  const widthRatio = srcW > 0 ? dstW / srcW : 1;

  if (next.kind === 'image' || next.kind === 'video') {
    next.props.fit = 'cover';
    if (focalOverride) {
      const toPct = (v: number) => (v > 0 && v <= 1 ? v * 100 : v);
      next.props.focalX = Math.round(Math.max(10, Math.min(90, toPct(focalOverride.focalX))));
      next.props.focalY = Math.round(Math.max(10, Math.min(90, toPct(focalOverride.focalY))));
    } else if (becomingPortrait) {
      if (next.props.focalX === undefined) next.props.focalX = 50;
      if (next.props.focalY === undefined) next.props.focalY = 42;
    }
    if (typeof next.props.x === 'number' && Number.isFinite(next.props.x)) {
      next.props.x = Math.round(next.props.x * widthRatio);
    }
    return next;
  }

  if (next.kind === 'caption') {
    const rawFs = Number(next.props.fontSize || 44);
    const scaledFs = becomingPortrait
      ? Math.max(34, Math.min(54, Math.round(rawFs * Math.max(0.76, Math.min(1.05, widthRatio * 1.45)))))
      : Math.max(30, Math.min(64, Math.round(rawFs * Math.max(0.8, Math.min(1.15, widthRatio)))));
    next.props.fontSize = scaledFs;
    if (becomingPortrait && (next.props.position || 'bottom') === 'bottom') {
      const safeLift = -Math.round(dstH * 0.11);
      const curY = Number(next.props.y || 0);
      next.props.y = Math.min(curY, safeLift);
    }
    return next;
  }

  if (next.kind === 'title') {
    const rawFs = Number(next.props.fontSize || 64);
    next.props.fontSize = Math.max(36, Math.min(82, Math.round(rawFs * Math.max(0.68, Math.min(1.1, widthRatio * 1.25)))));
    return next;
  }

  return next;
}
