import React from 'react';
import { clone } from '../core/project';
import type {
  CanvasGeneratorInputSlot,
  EditOperation,
  Project,
  Sequence,
  VaultItem,
} from '../core/types';

export interface CanvasPt {
  x: number;
  y: number;
}

export type PortSide = 'left' | 'right' | 'top' | 'bottom';

export type CanvasWireCategory = 'binding' | 'lineage' | 'sequence' | 'assembly';
export type CanvasWireDisplayMode = 'focus' | 'all' | 'hidden';
export type CanvasWireSemantic =
  | 'binding'
  | 'lineage'
  | 'first-last'
  | 'gen-input'
  | 'sequence'
  | 'shot-clip'
  | 'ghost';

export interface CanvasWireItem {
  key: string;
  kind:
    | 'binding'
    | 'asset-lineage'
    | 'entity-lineage'
    | 'shot-clip'
    | 'ghost-generation'
    | 'generator-input'
    | 'sequence-flow';
  category: CanvasWireCategory;
  semantic?: CanvasWireSemantic;
  fromKey: string;
  toKey: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  s1: PortSide;
  s2: PortSide;
  label: string;
  shotId: string;
  clipId: string;
  entityId: string;
  targetAssetId?: string;
  targetEntId?: string;
  sourceAssetId?: string;
  sourceVaultId?: string;
  removeClipId?: string;
  generatorId?: string;
  inputSlot?: CanvasGeneratorInputSlot;
  isLineage?: boolean;
  active: boolean;
}

export interface CanvasWireDrag {
  fromNodeId: string;
  side: PortSide;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function computeSmartWire(
  fromPos: CanvasPt,
  fromSz: { w: number; h: number },
  toPos: CanvasPt,
  toSz: { w: number; h: number },
): { x1: number; y1: number; x2: number; y2: number; s1: PortSide; s2: PortSide } {
  const fc = { x: fromPos.x + fromSz.w / 2, y: fromPos.y + fromSz.h / 2 };
  const tc = { x: toPos.x + toSz.w / 2, y: toPos.y + toSz.h / 2 };
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  let s1: PortSide;
  let s2: PortSide;
  if (Math.abs(dx) >= Math.abs(dy) * 0.6) {
    s1 = dx >= 0 ? 'right' : 'left';
    s2 = dx >= 0 ? 'left' : 'right';
  } else {
    s1 = dy >= 0 ? 'bottom' : 'top';
    s2 = dy >= 0 ? 'top' : 'bottom';
  }
  const anchor = (pos: CanvasPt, sz: { w: number; h: number }, side: PortSide): CanvasPt => {
    const portY = sz.h <= 100 ? 48 : 86;
    if (side === 'right') return { x: pos.x + sz.w, y: pos.y + portY };
    if (side === 'left') return { x: pos.x, y: pos.y + portY };
    if (side === 'bottom') return { x: pos.x + sz.w * 0.5, y: pos.y + sz.h + 2 };
    return { x: pos.x + sz.w * 0.5, y: pos.y - 2 };
  };
  const p1 = anchor(fromPos, fromSz, s1);
  const p2 = anchor(toPos, toSz, s2);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, s1, s2 };
}

export function bezierPathFor(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  s1: PortSide,
  s2: PortSide,
): string {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const cp = Math.max(24, Math.min(110, dist * 0.42));
  const offset = (x: number, y: number, side: PortSide): CanvasPt => {
    if (side === 'right') return { x: x + cp, y };
    if (side === 'left') return { x: x - cp, y };
    if (side === 'bottom') return { x, y: y + cp };
    return { x, y: y - cp };
  };
  const c1 = offset(x1, y1, s1);
  const c2 = offset(x2, y2, s2);
  return `M ${x1} ${y1} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${x2} ${y2}`;
}

/**
 * Computes a dynamic world-space bounding box covering all wires and any active wire drag
 * so wires and label pills NEVER clip in negative coordinates or large infinite canvases.
 */
export function computeWireSvgBounds(
  wires: readonly CanvasWireItem[],
  wireDrag: CanvasWireDrag | null,
): { x: number; y: number; w: number; h: number } | null {
  if (!wires.length && !wireDrag) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const w of wires) {
    include(w.x1, w.y1);
    include(w.x2, w.y2);
  }
  if (wireDrag) {
    include(wireDrag.x1, wireDrag.y1);
    include(wireDrag.x2, wireDrag.y2);
  }
  if (!Number.isFinite(minX)) return null;
  const pad = 220;
  const x = Math.floor(minX - pad);
  const y = Math.floor(minY - pad);
  const w = Math.max(320, Math.ceil(maxX - minX + pad * 2));
  const h = Math.max(240, Math.ceil(maxY - minY + pad * 2));
  return { x, y, w, h };
}

/**
 * Computes full upstream + downstream BFS trace graph from a focal node key.
 */
export function computeTraceGraph(
  startKey: string,
  wires: readonly CanvasWireItem[],
): { nodeKeys: Set<string>; wireKeys: Set<string> } {
  const nodeKeys = new Set<string>([startKey]);
  const wireKeys = new Set<string>();
  const nonSeq = wires.filter((w) => w.kind !== 'sequence-flow');

  // Walk upstream
  const upQueue = [startKey];
  const upVisited = new Set<string>([startKey]);
  while (upQueue.length) {
    const cur = upQueue.shift()!;
    for (const w of nonSeq) {
      if (w.toKey === cur) {
        wireKeys.add(w.key);
        nodeKeys.add(w.fromKey);
        if (!upVisited.has(w.fromKey)) {
          upVisited.add(w.fromKey);
          upQueue.push(w.fromKey);
        }
      }
    }
  }

  // Walk downstream
  const downQueue = [startKey];
  const downVisited = new Set<string>([startKey]);
  while (downQueue.length) {
    const cur = downQueue.shift()!;
    for (const w of nonSeq) {
      if (w.fromKey === cur) {
        wireKeys.add(w.key);
        nodeKeys.add(w.toKey);
        if (!downVisited.has(w.toKey)) {
          downVisited.add(w.toKey);
          downQueue.push(w.toKey);
        }
      }
    }
  }

  return { nodeKeys, wireKeys };
}

function wireSemanticFor(w: CanvasWireItem): CanvasWireSemantic {
  if (w.semantic) return w.semantic;
  if (w.kind === 'ghost-generation') return 'ghost';
  if (w.kind === 'sequence-flow') return 'sequence';
  if (w.kind === 'generator-input') return 'gen-input';
  if (w.kind === 'shot-clip') return 'shot-clip';
  if (w.isLineage) return 'lineage';
  return 'binding';
}

export const CanvasWiresSvg = React.memo(function CanvasWiresSvg({
  wires,
  hoveredNodeKey,
  wireDrag,
  wireMode = 'focus',
  tracedWireKeys = null,
}: {
  wires: CanvasWireItem[];
  hoveredNodeKey: string | null;
  wireDrag: CanvasWireDrag | null;
  wireMode?: CanvasWireDisplayMode;
  tracedWireKeys?: ReadonlySet<string> | null;
}) {
  const visibleWires = wires.filter((w) => {
    const isGhost = w.kind === 'ghost-generation';
    if (isGhost) return true;
    if (tracedWireKeys) return tracedWireKeys.has(w.key);
    if (wireMode === 'hidden') return Boolean(wireDrag);
    if (wireMode === 'focus') {
      if (w.kind === 'sequence-flow') return true;
      return w.active || hoveredNodeKey === w.fromKey || hoveredNodeKey === w.toKey || Boolean(wireDrag);
    }
    return true;
  });

  const bounds = computeWireSvgBounds(visibleWires, wireDrag);
  if (!bounds) return null;
  return (
    <svg
      className="cc-wires-svg"
      style={{ left: bounds.x, top: bounds.y }}
      width={bounds.w}
      height={bounds.h}
      viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
    >
      <defs>
        <linearGradient id="cc-wire-photon-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--wire-c1, #10b981)" stopOpacity="0.88" />
          <stop offset="55%" stopColor="var(--wire-c2, #2adb5c)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--wire-c3, #ecfdf5)" stopOpacity="1" />
        </linearGradient>
      </defs>
      {visibleWires.map((w) => {
        const d = bezierPathFor(w.x1, w.y1, w.x2, w.y2, w.s1, w.s2);
        const sem = wireSemanticFor(w);
        const isGhost = sem === 'ghost';
        const isSeq = sem === 'sequence';
        const isTraced = Boolean(tracedWireKeys?.has(w.key));
        const highlighted =
          !isSeq &&
          (isGhost ||
            isTraced ||
            w.active ||
            hoveredNodeKey === w.fromKey ||
            hoveredNodeKey === w.toKey ||
            Boolean(wireDrag));
        const isDiamond = sem === 'first-last';
        const isHollowStart = sem === 'lineage' || sem === 'ghost' || sem === 'gen-input';
        return (
          <g key={w.key} className={`cc-wire-group sem-${sem} ${highlighted ? 'highlighted' : ''}`}>
            <path
              d={d}
              className={`cc-wire-path sem-${sem} ${w.isLineage ? 'lineage' : ''} ${w.active ? 'active' : ''} ${highlighted ? 'highlighted' : ''}`}
            />
            {highlighted && <path d={d} className={`cc-wire-pulse ${isGhost ? 'ghost' : ''}`} />}
            {isDiamond ? (
              <>
                <rect
                  x={w.x1 - 3}
                  y={w.y1 - 3}
                  width={6}
                  height={6}
                  transform={`rotate(45 ${w.x1} ${w.y1})`}
                  className="cc-wire-dot diamond"
                />
                <rect
                  x={w.x2 - 3}
                  y={w.y2 - 3}
                  width={6}
                  height={6}
                  transform={`rotate(45 ${w.x2} ${w.y2})`}
                  className="cc-wire-dot diamond"
                />
              </>
            ) : (
              <>
                <circle
                  cx={w.x1}
                  cy={w.y1}
                  r={isSeq ? 2 : 3}
                  className={`cc-wire-dot ${isHollowStart ? 'hollow' : ''}`}
                />
                <circle cx={w.x2} cy={w.y2} r={isSeq ? 2.5 : 3} className="cc-wire-dot" />
              </>
            )}
          </g>
        );
      })}
      {wireDrag &&
        (() => {
          const dragPath = bezierPathFor(
            wireDrag.x1,
            wireDrag.y1,
            wireDrag.x2,
            wireDrag.y2,
            wireDrag.side,
            wireDrag.x2 >= wireDrag.x1 ? 'left' : 'right',
          );
          return (
            <g className="cc-wire-group highlighted">
              <path d={dragPath} className="cc-wire-path dragging" />
              <path d={dragPath} className="cc-wire-pulse dragging" />
            </g>
          );
        })()}
    </svg>
  );
});

export const CanvasWirePillsSvg = React.memo(function CanvasWirePillsSvg({
  wires,
  hoveredNodeKey,
  wireDrag,
  wireMode = 'focus',
  tracedWireKeys = null,
  project,
  sequence,
  upstreamEntities,
  onEdit,
}: {
  wires: CanvasWireItem[];
  hoveredNodeKey: string | null;
  wireDrag: CanvasWireDrag | null;
  wireMode?: CanvasWireDisplayMode;
  tracedWireKeys?: ReadonlySet<string> | null;
  project: Project;
  sequence: Sequence;
  upstreamEntities: VaultItem[];
  onEdit: (name: string, ops: EditOperation[]) => Promise<void> | void;
}) {
  const interactiveWires = wires.filter((w) => {
    if (w.kind === 'ghost-generation' || w.kind === 'sequence-flow') return false;
    if (tracedWireKeys) return tracedWireKeys.has(w.key);
    if (wireMode === 'hidden') return false;
    return w.active || hoveredNodeKey === w.fromKey || hoveredNodeKey === w.toKey || Boolean(wireDrag);
  });
  const bounds = computeWireSvgBounds(interactiveWires, null);
  if (!bounds) return null;
  return (
    <svg
      className="cc-wires-svg cc-wire-pills-layer"
      style={{ left: bounds.x, top: bounds.y }}
      width={bounds.w}
      height={bounds.h}
      viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
    >
      {interactiveWires.map((w) => {
        const mx = (w.x1 + w.x2) / 2;
        const my = (w.y1 + w.y2) / 2;
        const pillW = Math.min(180, Math.max(64, w.label.length * 8.5 + 22));
        return (
          <g
            key={w.key}
            className={`cc-wire-pill ${w.isLineage ? 'lineage-pill' : ''} highlighted`}
            transform={`translate(${mx}, ${my})`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (w.kind === 'generator-input' && w.generatorId) {
                const nextGens = (project.canvasGenerators || []).map((g) =>
                  g.id === w.generatorId
                    ? { ...g, inputs: g.inputs.filter((x) => x.nodeKey !== w.fromKey) }
                    : g,
                );
                void onEdit('断开工坊输入连线', [
                  { type: 'updateProject', changes: { canvasGenerators: nextGens } },
                ]);
                return;
              }
              if (w.kind === 'asset-lineage' && w.targetAssetId) {
                const targetAsset = project.assets.find((x) => x.id === w.targetAssetId);
                if (!targetAsset) return;
                const nextDerived = (targetAsset.derivedFrom || []).filter((d) => {
                  if (w.sourceVaultId && d.vaultItemId === w.sourceVaultId) return false;
                  if (w.sourceAssetId && d.assetId === w.sourceAssetId && !w.sourceVaultId) return false;
                  return true;
                });
                void onEdit('解除参考关联连线', [
                  { type: 'updateAssetMeta', assetId: targetAsset.id, changes: { derivedFrom: nextDerived } },
                ]);
                return;
              }
              if (w.kind === 'entity-lineage' && w.targetEntId) {
                const targetEnt = upstreamEntities.find((x) => x.id === w.targetEntId);
                if (!targetEnt) return;
                const nextDerived = (targetEnt.derivedFrom || []).filter((d) => {
                  if (w.sourceVaultId && d.vaultItemId === w.sourceVaultId) return false;
                  if (w.sourceAssetId && d.assetId === w.sourceAssetId) return false;
                  return true;
                });
                void onEdit('解除资产派生连线', [
                  {
                    type: 'putVaultItem',
                    item: {
                      ...clone(targetEnt),
                      derivedFrom: nextDerived,
                      updatedAt: new Date().toISOString(),
                    },
                  },
                ]);
                return;
              }
              if (w.kind === 'shot-clip' && w.removeClipId) {
                const removeClip = sequence.clips.find((c) => c.id === w.removeClipId);
                if (!removeClip || removeClip.locked) return;
                void onEdit('移出分镜片段连线', [
                  { type: 'deleteClip', sequenceId: sequence.id, clipId: w.removeClipId },
                ]);
                return;
              }
              const targetClip = sequence.clips.find((x) => x.id === w.clipId);
              if (!targetClip || targetClip.locked) return;
              const nextBindings = (targetClip.subjectBindings || []).filter((b) => b.entityId !== w.entityId);
              void onEdit('解除主体连线绑定', [
                {
                  type: 'updateClip',
                  sequenceId: sequence.id,
                  clipId: targetClip.id,
                  changes: {
                    subjectBindings: nextBindings,
                    subjectIds: nextBindings.map((b) => b.entityId),
                  },
                },
              ]);
            }}
          >
            <title>点击解除连线</title>
            <rect x={-pillW / 2} y={-10} width={pillW} height={20} rx={10} />
            <text textAnchor="middle" dominantBaseline="central">
              {w.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
});
