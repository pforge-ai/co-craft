import React from 'react';
import { clone } from '../core/project';
import type { EditOperation, Project, Sequence, VaultItem } from '../core/types';

export interface CanvasPt {
  x: number;
  y: number;
}

export type PortSide = 'left' | 'right' | 'top' | 'bottom';

export interface CanvasWireItem {
  key: string;
  kind: 'binding' | 'asset-lineage' | 'entity-lineage' | 'shot-clip';
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
    if (side === 'right') return { x: pos.x + sz.w + 2, y: pos.y + Math.min(86, sz.h * 0.5) };
    if (side === 'left') return { x: pos.x - 2, y: pos.y + Math.min(86, sz.h * 0.5) };
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

export function CanvasWiresSvg({
  wires,
  hoveredNodeKey,
  wireDrag,
}: {
  wires: CanvasWireItem[];
  hoveredNodeKey: string | null;
  wireDrag: CanvasWireDrag | null;
}) {
  return (
    <svg className="cc-wires-svg" width="4000" height="3000">
      {wires.map((w) => {
        const d = bezierPathFor(w.x1, w.y1, w.x2, w.y2, w.s1, w.s2);
        const highlighted =
          w.active || hoveredNodeKey === w.fromKey || hoveredNodeKey === w.toKey || Boolean(wireDrag);
        return (
          <g key={w.key} className={`cc-wire-group ${highlighted ? 'highlighted' : ''}`}>
            <path
              d={d}
              className={`cc-wire-path ${w.isLineage ? 'lineage' : ''} ${w.active ? 'active' : ''} ${highlighted ? 'highlighted' : ''}`}
            />
            <circle cx={w.x1} cy={w.y1} r={3} className="cc-wire-dot" />
            <circle cx={w.x2} cy={w.y2} r={3} className="cc-wire-dot" />
          </g>
        );
      })}
      {wireDrag && (
        <path
          d={bezierPathFor(
            wireDrag.x1,
            wireDrag.y1,
            wireDrag.x2,
            wireDrag.y2,
            wireDrag.side,
            wireDrag.x2 >= wireDrag.x1 ? 'left' : 'right',
          )}
          className="cc-wire-path dragging"
        />
      )}
    </svg>
  );
}

export function CanvasWirePillsSvg({
  wires,
  hoveredNodeKey,
  wireDrag,
  project,
  sequence,
  upstreamEntities,
  onEdit,
}: {
  wires: CanvasWireItem[];
  hoveredNodeKey: string | null;
  wireDrag: CanvasWireDrag | null;
  project: Project;
  sequence: Sequence;
  upstreamEntities: VaultItem[];
  onEdit: (name: string, ops: EditOperation[]) => Promise<void> | void;
}) {
  return (
    <svg className="cc-wires-svg cc-wire-pills-layer" width="4000" height="3000">
      {wires.map((w) => {
        const mx = (w.x1 + w.x2) / 2;
        const my = (w.y1 + w.y2) / 2;
        const pillW = Math.min(180, Math.max(64, w.label.length * 8.5 + 22));
        const highlighted =
          w.active || hoveredNodeKey === w.fromKey || hoveredNodeKey === w.toKey || Boolean(wireDrag);
        return (
          <g
            key={w.key}
            className={`cc-wire-pill ${w.isLineage ? 'lineage-pill' : ''} ${highlighted ? 'highlighted' : ''}`}
            transform={`translate(${mx}, ${my})`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
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
              const clip = sequence.clips.find((c) => c.id === w.clipId);
              if (!clip || clip.locked) return;
              const nextBindings = (clip.subjectBindings || []).filter((x) => x.entityId !== w.entityId);
              const nextSubjectIds = (clip.subjectIds || []).filter((id) => id !== w.entityId);
              void onEdit(`解除 ${w.label} 绑定`, [
                {
                  type: 'updateClip',
                  sequenceId: sequence.id,
                  clipId: clip.id,
                  changes: { subjectBindings: nextBindings, subjectIds: nextSubjectIds },
                },
              ]);
            }}
          >
            <title>点击解除「{w.label}」连线</title>
            <rect x={-pillW / 2} y={-10} width={pillW} height={20} rx={10} />
            <text x={0} y={3.5} textAnchor="middle">
              {w.label.length > 16 ? `${w.label.slice(0, 15)}…` : w.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
