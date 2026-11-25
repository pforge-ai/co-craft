import type {
  Asset,
  GenerationCanvasMeta,
  GenerationTarget,
  Project,
  ShotBinding,
  VaultItem,
} from '../../core/types';
import type { CompositeShot } from '../../core/storyboard';
import type { CanvasPt } from '../CanvasWiresLayer';

export interface CanvasGenerationOptions {
  use: 'image' | 'video' | 'speech' | 'transcription';
  prompt?: string;
  modelId?: string;
  referenceAssetId?: string;
  referenceAssetIds?: string[];
  lastFrameAssetId?: string;
  assetId?: string;
  target?: GenerationTarget;
  canvas?: GenerationCanvasMeta;
}

export interface ShotGenContext {
  prompt: string;
  refAssetId?: string;
  refAssetIds: string[];
  sourceNodeKeys: string[];
}

export interface StaleShotBinding {
  binding: ShotBinding;
  entity: VaultItem;
}

export interface ForkVariantPreset {
  id: string;
  label: string;
  suffix: string;
}

export const FORK_VARIANT_PRESETS: readonly ForkVariantPreset[] = [
  { id: 'wide-cinema', label: '广角史诗景别', suffix: '广角电影镜头构图，空间纵深感强，保持主体与美术风格一致' },
  { id: 'dramatic-rim', label: '逆光光影变体', suffix: '戏剧化侧逆光与空气透视，电影暗房质感，保持主体一致' },
  { id: 'closeup-detail', label: '特写细节变体', suffix: '近景特写构图，细腻材质与浅景深虚化，保持主体特征一致' },
];

/**
 * Resolves full multi-subject generation context for a storyboard shot:
 * collects prompt anchors & reference images from ALL bound upstream entities (not just the first!),
 * plus falls back to the shot's own visual image clip if present.
 */
export function resolveShotGenContextFull(
  shot: CompositeShot,
  upstreamEntities: readonly VaultItem[],
  assets: readonly Asset[],
  activeVarByEnt: Record<string, string>,
): ShotGenContext {
  const refAssetIds: string[] = [];
  const sourceNodeKeys: string[] = [`shot:${shot.id}`];
  const subjectPhrases: string[] = [];

  for (const b of shot.bindings) {
    const ent = upstreamEntities.find((x) => x.id === b.entityId);
    if (!ent) continue;
    sourceNodeKeys.push(`ent:${ent.id}`);
    const vr =
      ent.variants?.find((v) => v.id === (b.variantId || activeVarByEnt[ent.id] || ent.defaultVariantId)) ||
      ent.variants?.[0];
    const anchorDesc = [ent.textContent, ent.promptAnchor, vr?.promptDelta].filter(Boolean).join('；');
    if (ent.entityKind !== 'text') {
      subjectPhrases.push(`@${ent.name}${vr ? `:${vr.name}` : ''}（${anchorDesc || ent.name}）`);
    } else if (anchorDesc) {
      subjectPhrases.push(anchorDesc);
    }
    const candidateRef = vr?.assetId || ent.assetId;
    if (candidateRef && assets.some((a) => a.id === candidateRef && a.kind === 'image')) {
      if (!refAssetIds.includes(candidateRef)) refAssetIds.push(candidateRef);
    }
  }

  // Also include the shot's current image clip as reference if it's an image asset
  const anchorAsset = shot.anchorClip.assetId
    ? assets.find((a) => a.id === shot.anchorClip.assetId && a.kind === 'image')
    : undefined;
  if (anchorAsset && !refAssetIds.includes(anchorAsset.id)) {
    refAssetIds.push(anchorAsset.id);
  }

  const baseText = shot.scriptText || String(shot.anchorClip.props.text || shot.anchorClip.name || '');
  return {
    prompt: [baseText, ...subjectPhrases].filter(Boolean).join('，'),
    refAssetId: refAssetIds[0],
    refAssetIds,
    sourceNodeKeys: Array.from(new Set(sourceNodeKeys)),
  };
}

/**
 * Detects bound upstream entities whose version has advanced past the shot's `pinnedVersion`.
 */
export function detectStaleBindings(
  shot: CompositeShot,
  upstreamEntities: readonly VaultItem[],
): StaleShotBinding[] {
  const out: StaleShotBinding[] = [];
  for (const binding of shot.bindings) {
    const entity = upstreamEntities.find((e) => e.id === binding.entityId);
    if (!entity) continue;
    if (binding.pinnedVersion !== undefined && entity.version > binding.pinnedVersion) {
      out.push({ binding, entity });
    }
  }
  return out;
}

/**
 * Collects ordered visual image references from a list of selected canvas node keys.
 * Sorts nodes left-to-right (then top-to-bottom) so 2-node selection naturally maps Left -> First Frame, Right -> Last Frame.
 */
export function collectVisualSelection(
  nodeKeys: readonly string[],
  project: Project,
  upstreamEntities: readonly VaultItem[],
  shots: readonly CompositeShot[],
  activeVarByEnt: Record<string, string>,
  layout: Record<string, CanvasPt>,
): {
  imageAssetIds: string[];
  labels: string[];
  sourceNodeKeys: string[];
  anchorPlacement: CanvasPt;
} {
  const sortedKeys = [...nodeKeys].sort((a, b) => {
    const pa = layout[a] || { x: 0, y: 0 };
    const pb = layout[b] || { x: 0, y: 0 };
    if (Math.abs(pa.x - pb.x) > 36) return pa.x - pb.x;
    return pa.y - pb.y;
  });

  const imageAssetIds: string[] = [];
  const labels: string[] = [];
  const sourceNodeKeys: string[] = [];
  let maxX = -Infinity;
  let sumY = 0;
  let countPos = 0;

  for (const key of sortedKeys) {
    const pos = layout[key];
    if (pos) {
      maxX = Math.max(maxX, pos.x);
      sumY += pos.y;
      countPos += 1;
    }

    if (key.startsWith('asset:')) {
      const a = project.assets.find((x) => `asset:${x.id}` === key);
      if (a && a.kind === 'image') {
        if (!imageAssetIds.includes(a.id)) imageAssetIds.push(a.id);
        labels.push(a.name.replace(/\.[^.]+$/, ''));
        sourceNodeKeys.push(key);
      }
    } else if (key.startsWith('ent:')) {
      const ent = upstreamEntities.find((x) => `ent:${x.id}` === key);
      if (ent) {
        const vr =
          ent.variants?.find((v) => v.id === (activeVarByEnt[ent.id] || ent.defaultVariantId)) ||
          ent.variants?.[0];
        const aid = vr?.assetId || ent.assetId;
        const img = aid ? project.assets.find((x) => x.id === aid && x.kind === 'image') : undefined;
        if (img) {
          if (!imageAssetIds.includes(img.id)) imageAssetIds.push(img.id);
          labels.push(`@${ent.name}${vr ? `:${vr.name}` : ''}`);
          sourceNodeKeys.push(key);
        }
      }
    } else if (key.startsWith('shot:')) {
      const sh = shots.find((s) => `shot:${s.id}` === key);
      const aid = sh?.anchorClip.assetId;
      const img = aid ? project.assets.find((x) => x.id === aid && x.kind === 'image') : undefined;
      if (sh && img) {
        if (!imageAssetIds.includes(img.id)) imageAssetIds.push(img.id);
        labels.push(`镜头 #${sh.index}`);
        sourceNodeKeys.push(key);
      }
    }
  }

  const anchorPlacement =
    countPos > 0 && Number.isFinite(maxX)
      ? { x: Math.round(maxX + 312), y: Math.round(sumY / countPos) }
      : { x: 420, y: 120 };

  return { imageAssetIds, labels, sourceNodeKeys, anchorPlacement };
}
