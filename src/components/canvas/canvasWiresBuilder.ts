import type { CompositeShot } from '../../core/storyboard';
import type {
  Asset,
  CanvasGeneratorNode,
  Clip,
  CodeComponent,
  Job,
  VaultItem,
} from '../../core/types';
import { computeSmartWire, type CanvasPt as Pt, type CanvasWireItem } from '../CanvasWiresLayer';
import { SLOT_LABELS } from './CanvasGeneratorNode';

export interface BuildCanvasWiresParams {
  visibleShots: CompositeShot[];
  visibleGenerators: CanvasGeneratorNode[];
  layout: Record<string, Pt>;
  upstreamEntities: VaultItem[];
  standaloneAssets: Asset[];
  standaloneComponents: CodeComponent[];
  sequenceClips: Clip[];
  selectedNodeIds: string[];
  ghostJobs: { job: Job; pos: Pt; sourceKeys: string[] }[];
  nodeSizeFor: (key: string) => { w: number; h: number };
}

/**
 * Pure builder computing all SVG Bezier relationship wires on Create Canvas:
 * bindings, shot clips, narrative sequence flow, asset/entity lineage,
 * generator input slots, and live ghost-generation wires.
 */
export function buildCanvasWires({
  visibleShots,
  visibleGenerators,
  layout,
  upstreamEntities,
  standaloneAssets,
  standaloneComponents,
  sequenceClips,
  selectedNodeIds,
  ghostJobs,
  nodeSizeFor,
}: BuildCanvasWiresParams): CanvasWireItem[] {
  const list: CanvasWireItem[] = [];
  const selSet = new Set(selectedNodeIds);
  const pushWire = (
    base: Omit<CanvasWireItem, 'x1' | 'y1' | 'x2' | 'y2' | 's1' | 's2' | 'active'>,
    overrideTo?: { pos: Pt; sz: { w: number; h: number } },
  ) => {
    const p1 = layout[base.fromKey];
    const p2 = overrideTo?.pos || layout[base.toKey];
    if (!p1 || !p2) return;
    const smart = computeSmartWire(
      p1,
      nodeSizeFor(base.fromKey),
      p2,
      overrideTo?.sz || nodeSizeFor(base.toKey),
    );
    list.push({
      ...base,
      ...smart,
      active: base.kind === 'ghost-generation' || selSet.has(base.fromKey) || selSet.has(base.toKey),
    });
  };

  // A) Entity -> Shot bindings
  for (const sh of visibleShots) {
    for (const b of sh.bindings) {
      const ent = upstreamEntities.find((x) => x.id === b.entityId);
      if (!ent) continue;
      const vr = ent.variants?.find((v) => v.id === b.variantId);
      pushWire({
        key: `${ent.id}->${sh.id}`,
        kind: 'binding',
        category: 'binding',
        semantic: 'binding',
        fromKey: `ent:${ent.id}`,
        toKey: `shot:${sh.id}`,
        label: vr ? `@${ent.name}:${vr.name}` : `@${ent.name}`,
        shotId: sh.id,
        clipId: sh.anchorClip.id,
        entityId: ent.id,
      });
    }
    // B) Standalone Asset -> Shot (clips aligned inside shot interval)
    for (const a of standaloneAssets) {
      const matchedClip = sequenceClips.find(
        (c) => c.assetId === a.id && c.start >= sh.start && c.start < sh.start + sh.duration,
      );
      if (matchedClip) {
        pushWire({
          key: `clip:${a.id}->${sh.id}`,
          kind: 'shot-clip',
          category: 'assembly',
          semantic: 'shot-clip',
          fromKey: `asset:${a.id}`,
          toKey: `shot:${sh.id}`,
          label: a.name.slice(0, 14),
          shotId: sh.id,
          clipId: sh.anchorClip.id,
          entityId: '',
          removeClipId: matchedClip.id,
        });
      }
    }
    // C) Standalone Component -> Shot
    for (const comp of standaloneComponents) {
      const matchedComp = sh.compositeClips.find((c) => c.componentId === comp.id);
      if (matchedComp) {
        pushWire({
          key: `comp:${comp.id}->${sh.id}`,
          kind: 'shot-clip',
          category: 'assembly',
          semantic: 'shot-clip',
          fromKey: `comp:${comp.id}`,
          toKey: `shot:${sh.id}`,
          label: '驱动画面',
          shotId: sh.id,
          clipId: sh.anchorClip.id,
          entityId: '',
          removeClipId: matchedComp.id,
        });
      }
    }
  }

  // C2) Sequence Narrative Flow: Shot[i] -> Shot[i+1]
  for (let i = 0; i < visibleShots.length - 1; i++) {
    const curSh = visibleShots[i];
    const nextSh = visibleShots[i + 1];
    pushWire({
      key: `seq:${curSh.id}->${nextSh.id}`,
      kind: 'sequence-flow',
      category: 'sequence',
      semantic: 'sequence',
      fromKey: `shot:${curSh.id}`,
      toKey: `shot:${nextSh.id}`,
      label: '',
      shotId: curSh.id,
      clipId: curSh.anchorClip.id,
      entityId: '',
    });
  }

  // D) Asset lineage: Asset/Ent/Shot/Gen -> Asset
  for (const a of standaloneAssets) {
    if (!a.derivedFrom?.length) continue;
    for (const ref of a.derivedFrom) {
      const fromKey =
        ref.vaultItemId?.startsWith('shot:') || ref.vaultItemId?.startsWith('gen:')
          ? ref.vaultItemId
          : ref.vaultItemId
            ? `ent:${ref.vaultItemId}`
            : ref.assetId
              ? `asset:${ref.assetId}`
              : '';
      if (!fromKey || !layout[fromKey]) continue;
      pushWire({
        key: `lin:${fromKey}->asset:${a.id}`,
        kind: 'asset-lineage',
        category: 'lineage',
        semantic: ref.via === 'first-last-frame' ? 'first-last' : 'lineage',
        fromKey,
        toKey: `asset:${a.id}`,
        shotId: '',
        clipId: '',
        entityId: '',
        sourceAssetId: ref.assetId,
        sourceVaultId: ref.vaultItemId,
        targetAssetId: a.id,
        isLineage: true,
        label: ref.note || ref.via || '关联',
      });
    }
  }

  // E) Entity lineage: Asset/Ent/Gen/Shot -> Ent
  for (const ent of upstreamEntities) {
    if (!ent.derivedFrom?.length) continue;
    for (const ref of ent.derivedFrom) {
      const fromKey =
        ref.vaultItemId?.startsWith('gen:') || ref.vaultItemId?.startsWith('shot:')
          ? ref.vaultItemId
          : ref.vaultItemId
            ? `ent:${ref.vaultItemId}`
            : ref.assetId
              ? `asset:${ref.assetId}`
              : '';
      if (!fromKey || !layout[fromKey]) continue;
      pushWire({
        key: `elin:${fromKey}->ent:${ent.id}`,
        kind: 'entity-lineage',
        category: 'lineage',
        semantic: 'lineage',
        fromKey,
        toKey: `ent:${ent.id}`,
        shotId: '',
        clipId: '',
        entityId: '',
        sourceAssetId: ref.assetId,
        sourceVaultId: ref.vaultItemId,
        targetEntId: ent.id,
        isLineage: true,
        label: ref.note || ref.via || '关联',
      });
    }
  }

  // F) Generator Node Typed Inputs: upstream -> gen:<id>
  for (const gen of visibleGenerators) {
    const toKey = `gen:${gen.id}`;
    if (!layout[toKey]) continue;
    for (const inp of gen.inputs) {
      if (!layout[inp.nodeKey]) continue;
      const isFirstLast = inp.slot === 'first-frame' || inp.slot === 'last-frame';
      pushWire({
        key: `genin:${inp.nodeKey}->${toKey}`,
        kind: 'generator-input',
        category: 'lineage',
        semantic: isFirstLast ? 'first-last' : 'gen-input',
        fromKey: inp.nodeKey,
        toKey,
        shotId: '',
        clipId: '',
        entityId: '',
        generatorId: gen.id,
        inputSlot: inp.slot,
        isLineage: true,
        label: SLOT_LABELS[inp.slot] || '输入',
      });
    }
  }

  // G) Live Ghost Generation Wires: upstream reference/source nodes -> in-place Ghost card
  for (const g of ghostJobs) {
    const isAudioGhost = g.job.canvas?.use === 'speech';
    const ghostSz = isAudioGhost ? { w: 248, h: 108 } : { w: 248, h: 162 };
    for (const srcKey of g.sourceKeys) {
      if (!layout[srcKey]) continue;
      pushWire(
        {
          key: `ghost:${srcKey}->${g.job.id}`,
          kind: 'ghost-generation',
          category: 'lineage',
          semantic: 'ghost',
          fromKey: srcKey,
          toKey: `ghost:${g.job.id}`,
          shotId: '',
          clipId: '',
          entityId: '',
          isLineage: true,
          label: '生成中',
        },
        { pos: g.pos, sz: ghostSz },
      );
    }
  }
  return list;
}
