import {
  BUILT_IN_TRANSITIONS,
  presetCatalog,
  type PresetCategory,
  type PresetDefinition,
} from './presets';
import type { Asset, CodeComponent, VaultItem } from './types';

export type BuiltInTransitionSpec = (typeof BUILT_IN_TRANSITIONS)[number];

export type CatalogField = string | readonly string[] | undefined | null;

/**
 * Shared multi-token catalog matcher used across both AssetExplorer (sidebar)
 * and ResourceLibrary (T modal) so search behavior is 1:1 consistent.
 */
export function matchCatalogText(query: string, ...fields: CatalogField[]): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = fields
    .flatMap((field) => (Array.isArray(field) ? field : field ? [field] : []))
    .join(' ')
    .toLocaleLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function filterPresets(
  query: string,
  opts?: {
    category?: string;
    categories?: readonly PresetCategory[];
    favoriteIds?: readonly string[];
  },
): PresetDefinition[] {
  const category = opts?.category;
  const categories = opts?.categories;
  const favoriteIds = opts?.favoriteIds;
  return presetCatalog.filter((preset) => {
    if (categories && !categories.includes(preset.category)) return false;
    if (category && category !== 'all') {
      if (category === 'favorites') {
        if (!favoriteIds?.includes(preset.id)) return false;
      } else if (preset.category !== category) {
        return false;
      }
    }
    return matchCatalogText(query, preset.name, preset.description, preset.keywords, preset.id, preset.category);
  });
}

export function filterStudioMediaByKind(
  studioMedia: readonly Asset[],
  query: string,
): { visual: Asset[]; audio: Asset[] } {
  const visual: Asset[] = [];
  const audio: Asset[] = [];
  for (const asset of studioMedia) {
    const kindKeywords =
      asset.kind === 'audio' ? '声音 音频 音乐 音效 audio sfx' : '图片 摄影 底板 视觉 image photo';
    if (
      !matchCatalogText(
        query,
        asset.name,
        asset.tags,
        kindKeywords,
        asset.source?.provider,
        asset.source?.author,
        asset.id,
      )
    ) {
      continue;
    }
    if (asset.kind === 'audio') audio.push(asset);
    else visual.push(asset);
  }
  return { visual, audio };
}

export function filterProjectComponents(
  components: readonly CodeComponent[],
  query: string,
): CodeComponent[] {
  return components.filter((component) =>
    matchCatalogText(
      query,
      component.name,
      component.id,
      component.pack?.name,
      component.pack?.author,
      '组件 component tsx',
    ),
  );
}

export function filterTransitions(query: string): BuiltInTransitionSpec[] {
  return BUILT_IN_TRANSITIONS.filter((tr) =>
    matchCatalogText(query, tr.name, tr.description, tr.id, '转场 transition'),
  );
}

export function filterVaultItems(
  items: readonly VaultItem[],
  query: string,
  predicate?: (item: VaultItem) => boolean,
): VaultItem[] {
  return items.filter((item) => {
    if (predicate && !predicate(item)) return false;
    return matchCatalogText(
      query,
      item.name,
      item.description,
      item.promptAnchor,
      item.tags,
      item.role,
      item.subkind,
      item.entityKind,
    );
  });
}
