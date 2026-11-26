import React from 'react';
import { AtSign, ChevronDown, ChevronRight, Group, Layers, Package, X } from 'lucide-react';
import type { CanvasGroup, ChatContextRef } from '../../core/types';
import type { CanvasPt as Pt } from '../CanvasWiresLayer';

export interface GroupBoxItem {
  grp: CanvasGroup;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CollapsedGroupItem {
  grp: CanvasGroup;
  x: number;
  y: number;
  previews: string[];
}

export interface SemanticZoneMetaItem {
  id: 'context' | 'explore' | 'shots';
  label: string;
  count: number;
  collapsed: boolean;
  frame: { x: number; y: number; w: number; h: number } | null;
  deckPos: Pt;
  previews: string[];
}

interface CanvasFramesLayerProps {
  groupBoxes: GroupBoxItem[];
  collapsedGroups: CollapsedGroupItem[];
  semanticZoneMeta: SemanticZoneMetaItem[];
  editingGroupId: string | null;
  groupNameDraft: string;
  onGroupHeaderPointerDown: (e: React.PointerEvent<HTMLDivElement>, grp: CanvasGroup) => void;
  onStartRenameGroup: (grp: CanvasGroup) => void;
  onChangeGroupNameDraft: (val: string) => void;
  onCommitRenameGroup: (groupId: string, nextName: string) => Promise<void> | void;
  onCancelRenameGroup: () => void;
  onToggleCollapseGroup: (groupId: string) => Promise<void> | void;
  onDissolveGroup: (groupId: string) => Promise<void> | void;
  collectRefsFromNodeKeys: (keys: string[]) => ChatContextRef[];
  onAddRefsToChat?: (refs: ChatContextRef[], openDrawer?: boolean) => void;
  onPackNodes: (keys: string[], exportOffline: boolean) => Promise<void> | void;
  onToggleSemanticZone: (zoneId: 'context' | 'explore' | 'shots') => Promise<void> | void;
}

export function CanvasFramesLayer({
  groupBoxes,
  collapsedGroups,
  semanticZoneMeta,
  editingGroupId,
  groupNameDraft,
  onGroupHeaderPointerDown,
  onStartRenameGroup,
  onChangeGroupNameDraft,
  onCommitRenameGroup,
  onCancelRenameGroup,
  onToggleCollapseGroup,
  onDissolveGroup,
  collectRefsFromNodeKeys,
  onAddRefsToChat,
  onPackNodes,
  onToggleSemanticZone,
}: CanvasFramesLayerProps) {
  return (
    <>
      {groupBoxes.map(({ grp, x, y, w, h }) => {
        const isEditingName = editingGroupId === grp.id;
        return (
          <div
            key={grp.id}
            className="cc-group-frame"
            style={{ left: x, top: y, width: w, height: h }}
          >
            <div
              className="cc-group-header"
              onPointerDown={(e) => onGroupHeaderPointerDown(e, grp)}
            >
              <button
                type="button"
                className="cc-group-fold-btn"
                title="折叠分组为紧凑卡叠"
                aria-label={`折叠分组 ${grp.name}`}
                onClick={() => void onToggleCollapseGroup(grp.id)}
              >
                <ChevronDown size={11} />
              </button>
              <Group size={11} />
              {isEditingName ? (
                <input
                  className="cc-group-rename-input"
                  aria-label="重命名分组"
                  autoFocus
                  value={groupNameDraft}
                  onChange={(e) => onChangeGroupNameDraft(e.target.value)}
                  onBlur={() => void onCommitRenameGroup(grp.id, groupNameDraft)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onCommitRenameGroup(grp.id, groupNameDraft);
                    if (e.key === 'Escape') onCancelRenameGroup();
                  }}
                />
              ) : (
                <span
                  title="双击重命名分组"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onStartRenameGroup(grp);
                  }}
                >
                  {grp.name}
                </span>
              )}
              <div className="cc-group-acts">
                <button
                  type="button"
                  title="将整组节点添加到对话"
                  onClick={() => {
                    const refs = collectRefsFromNodeKeys(grp.nodeIds);
                    if (onAddRefsToChat && refs.length) onAddRefsToChat(refs, true);
                  }}
                >
                  <AtSign size={10} />
                </button>
                <button
                  type="button"
                  title="整组打成素材包"
                  onClick={() => void onPackNodes(grp.nodeIds, false)}
                >
                  <Package size={10} />
                </button>
                <button
                  type="button"
                  title="解散此分组"
                  onClick={() => void onDissolveGroup(grp.id)}
                >
                  <X size={10} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {collapsedGroups.map(({ grp, x, y, previews }) => (
        <div
          key={`stack-${grp.id}`}
          className="cc-group-stack"
          style={{ left: x, top: y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="cc-group-stack-layers" onClick={() => void onToggleCollapseGroup(grp.id)}>
            <div className="cc-stack-back layer-2" />
            <div className="cc-stack-back layer-1" />
            <div className="cc-stack-front">
              {previews.length > 0 ? (
                <div className={`cc-stack-mosaic count-${previews.length}`}>
                  {previews.map((src, i) => (
                    <img key={i} src={src} alt="" draggable={false} />
                  ))}
                </div>
              ) : (
                <div className="cc-stack-empty">
                  <Group size={20} />
                </div>
              )}
              <span className="cc-stack-badge">{grp.nodeIds.length} 项</span>
            </div>
          </div>
          <div className="cc-group-stack-foot">
            <button
              type="button"
              className="cc-stack-expand-btn"
              title="展开此分组"
              aria-label={`展开分组 ${grp.name}`}
              onClick={() => void onToggleCollapseGroup(grp.id)}
            >
              <ChevronRight size={11} />
              <b>{grp.name}</b>
            </button>
            <div className="cc-group-acts">
              <button
                type="button"
                title="将整组节点添加到对话"
                onClick={() => {
                  const refs = collectRefsFromNodeKeys(grp.nodeIds);
                  if (onAddRefsToChat && refs.length) onAddRefsToChat(refs, true);
                }}
              >
                <AtSign size={10} />
              </button>
              <button
                type="button"
                title="整组打成素材包"
                onClick={() => void onPackNodes(grp.nodeIds, false)}
              >
                <Package size={10} />
              </button>
              <button
                type="button"
                title="解散此分组"
                onClick={() => void onDissolveGroup(grp.id)}
              >
                <X size={10} />
              </button>
            </div>
          </div>
        </div>
      ))}

      {semanticZoneMeta.map((z) => {
        if (z.count === 0) return null;
        if (z.collapsed) {
          return (
            <div
              key={`zone-stack-${z.id}`}
              className="cc-group-stack cc-zone-stack"
              style={{ left: z.deckPos.x, top: z.deckPos.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="cc-group-stack-layers" onClick={() => void onToggleSemanticZone(z.id)}>
                <div className="cc-stack-back layer-2" />
                <div className="cc-stack-back layer-1" />
                <div className="cc-stack-front">
                  {z.previews.length > 0 ? (
                    <div className={`cc-stack-mosaic count-${z.previews.length}`}>
                      {z.previews.map((src, i) => (
                        <img key={i} src={src} alt="" draggable={false} />
                      ))}
                    </div>
                  ) : (
                    <div className="cc-stack-empty">
                      <Layers size={20} />
                    </div>
                  )}
                  <span className="cc-stack-badge">{z.count} 项</span>
                </div>
              </div>
              <div className="cc-group-stack-foot">
                <button
                  type="button"
                  className="cc-stack-expand-btn"
                  title={`展开「${z.label}」分区`}
                  aria-label={`展开分区 ${z.label}`}
                  onClick={() => void onToggleSemanticZone(z.id)}
                >
                  <ChevronRight size={11} />
                  <b>{z.label}</b>
                </button>
              </div>
            </div>
          );
        }
        if (!z.frame) return null;
        return (
          <div
            key={`zone-frame-${z.id}`}
            className={`cc-zone-frame zone-${z.id}`}
            style={{ left: z.frame.x, top: z.frame.y, width: z.frame.w, height: z.frame.h }}
          >
            <div className="cc-zone-header" onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="cc-zone-fold-btn"
                title={`折叠「${z.label}」为紧凑卡叠`}
                aria-label={`折叠分区 ${z.label}`}
                onClick={() => void onToggleSemanticZone(z.id)}
              >
                <ChevronDown size={11} />
                <span>{z.label}</span>
                <small>{z.count}</small>
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
