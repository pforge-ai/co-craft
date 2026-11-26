import React from 'react';
import {
  AtSign,
  Clapperboard,
  ClipboardPaste,
  Download,
  FileText,
  Group,
  Package,
  Redo2,
  Trash2,
  Undo2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import type { Asset, ChatContextRef } from '../../core/types';
import type { CanvasPt as Pt } from '../CanvasWiresLayer';

export interface CanvasContextMenuState {
  clientX: number;
  clientY: number;
  nodeKey?: string;
}

export interface CanvasSubjectModalState {
  mode: 'new' | 'variant';
  entId?: string;
}

interface CanvasContextMenuProps {
  contextMenu: CanvasContextMenuState;
  selectedNodeIds: string[];
  pan: Pt;
  zoom: number;
  canUndo?: boolean;
  canRedo?: boolean;
  collectRefsFromNodeKeys: (keys: string[]) => ChatContextRef[];
  onAddRefsToChat?: (refs: ChatContextRef[], openDrawer?: boolean) => void;
  onCreateGroup: (keys: string[]) => Promise<void> | void;
  onPackNodes: (keys: string[], exportOffline: boolean) => Promise<void> | void;
  onExportMaterialPack?: unknown;
  onDeleteNodes: (keys: string[]) => Promise<void> | void;
  onClearSelection: () => void;
  onImportMedia: () => void;
  onCreateTextNode: (content: string, pos?: Pt) => Promise<void> | void;
  onOpenNewSubject: () => void;
  onAppendShot: () => Promise<void> | void;
  onUndo?: () => void;
  onRedo?: () => void;
  onClose: () => void;
}

export function CanvasContextMenu({
  contextMenu,
  selectedNodeIds,
  pan,
  zoom,
  canUndo,
  canRedo,
  collectRefsFromNodeKeys,
  onAddRefsToChat,
  onCreateGroup,
  onPackNodes,
  onExportMaterialPack,
  onDeleteNodes,
  onClearSelection,
  onImportMedia,
  onCreateTextNode,
  onOpenNewSubject,
  onAppendShot,
  onUndo,
  onRedo,
  onClose,
}: CanvasContextMenuProps) {
  const targets = selectedNodeIds.length
    ? selectedNodeIds
    : contextMenu.nodeKey
      ? [contextMenu.nodeKey]
      : [];
  const worldPos = (): Pt => ({
    x: Math.round((contextMenu.clientX - pan.x) / zoom),
    y: Math.round((contextMenu.clientY - pan.y) / zoom),
  });

  return (
    <div
      className="cc-popover cc-tap-menu cc-context-menu"
      style={{ left: contextMenu.clientX, top: contextMenu.clientY }}
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {contextMenu.nodeKey || selectedNodeIds.length > 0 ? (
        <>
          <div className="cc-menu-group">
            {selectedNodeIds.length > 1 ? `已选 ${selectedNodeIds.length} 个节点` : '节点操作'}
          </div>
          <button
            type="button"
            onClick={() => {
              const refs = collectRefsFromNodeKeys(targets);
              onClose();
              if (onAddRefsToChat && refs.length) onAddRefsToChat(refs, true);
            }}
          >
            <span className="cc-menu-item-label">
              <AtSign size={13} /> 添加到对话
            </span>
            <kbd>@</kbd>
          </button>
          {selectedNodeIds.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                onClose();
                void onCreateGroup(selectedNodeIds);
              }}
            >
              <span className="cc-menu-item-label">
                <Group size={13} /> 成组归类
              </span>
              <kbd>⌘G</kbd>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onClose();
              void onPackNodes(targets, false);
            }}
          >
            <span className="cc-menu-item-label">
              <Package size={13} /> 打成素材包存入个人库
            </span>
          </button>
          {Boolean(onExportMaterialPack) && (
            <button
              type="button"
              onClick={() => {
                onClose();
                void onPackNodes(targets, true);
              }}
            >
              <span className="cc-menu-item-label">
                <Download size={13} /> 导出离线素材包…
              </span>
            </button>
          )}
          <div className="cc-menu-divider" />
          <button
            type="button"
            className="danger"
            onClick={() => {
              onClose();
              void onDeleteNodes(targets);
            }}
          >
            <span className="cc-menu-item-label">
              <Trash2 size={13} /> 删除资产 / 节点
            </span>
            <kbd>⌫</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onClearSelection();
            }}
          >
            <span className="cc-menu-item-label">
              <X size={13} /> 取消选中
            </span>
            <kbd>Esc</kbd>
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              onClose();
              onImportMedia();
            }}
          >
            <span className="cc-menu-item-label">
              <Upload size={13} /> 上传素材
            </span>
            <kbd>U</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              const pos = worldPos();
              onClose();
              void onCreateTextNode('', pos);
            }}
          >
            <span className="cc-menu-item-label">
              <FileText size={13} /> 添加文本节点
            </span>
            <kbd>T</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenNewSubject();
            }}
          >
            <span className="cc-menu-item-label">
              <UserCheck size={13} /> 添加角色 / 设定
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              void onAppendShot();
            }}
          >
            <span className="cc-menu-item-label">
              <Clapperboard size={13} /> 添加分镜镜头
            </span>
          </button>
          <div className="cc-menu-divider" />
          {onUndo && (
            <button
              type="button"
              disabled={!canUndo}
              onClick={() => {
                onClose();
                onUndo();
              }}
            >
              <span className="cc-menu-item-label">
                <Undo2 size={13} /> 撤销
              </span>
              <kbd>⌘Z</kbd>
            </button>
          )}
          {onRedo && (
            <button
              type="button"
              disabled={!canRedo}
              onClick={() => {
                onClose();
                onRedo();
              }}
            >
              <span className="cc-menu-item-label">
                <Redo2 size={13} /> 重做
              </span>
              <kbd>⇧⌘Z</kbd>
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              const pos = worldPos();
              onClose();
              try {
                const txt = await navigator.clipboard.readText();
                await onCreateTextNode(txt || '', pos);
              } catch {
                await onCreateTextNode('', pos);
              }
            }}
          >
            <span className="cc-menu-item-label">
              <ClipboardPaste size={13} /> 粘贴为文本节点
            </span>
            <kbd>⌘V</kbd>
          </button>
        </>
      )}
    </div>
  );
}

interface CanvasSubjectModalProps {
  modal: CanvasSubjectModalState;
  imageAssets: Asset[];
  subjRole: 'character' | 'product' | 'environment';
  subjName: string;
  subjVar: string;
  subjRef: string;
  subjDesc: string;
  onChangeRole: (v: 'character' | 'product' | 'environment') => void;
  onChangeName: (v: string) => void;
  onChangeVar: (v: string) => void;
  onChangeRef: (v: string) => void;
  onChangeDesc: (v: string) => void;
  onSubmit: (e: React.FormEvent) => Promise<void> | void;
  onClose: () => void;
}

export function CanvasSubjectModal({
  modal,
  imageAssets,
  subjRole,
  subjName,
  subjVar,
  subjRef,
  subjDesc,
  onChangeRole,
  onChangeName,
  onChangeVar,
  onChangeRef,
  onChangeDesc,
  onSubmit,
  onClose,
}: CanvasSubjectModalProps) {
  return (
    <form
      className="cc-popover cc-modal-card"
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => void onSubmit(e)}
    >
      <div className="cc-card-head">
        <b>{modal.mode === 'variant' ? '新增主体状态分支' : '新建角色 / 产品 / 场景设定'}</b>
        <button type="button" onClick={onClose} aria-label="关闭">
          <X size={13} />
        </button>
      </div>
      {modal.mode === 'new' && (
        <div className="cc-grid-2">
          <select
            value={subjRole}
            onChange={(e) => onChangeRole(e.target.value as 'character' | 'product' | 'environment')}
            aria-label="主体角色类型"
          >
            <option value="character">角色形象</option>
            <option value="product">产品主体</option>
            <option value="environment">场景环境</option>
          </select>
          <input
            required
            autoFocus
            aria-label="主体名称"
            placeholder="名称（如：林夏）"
            value={subjName}
            onChange={(e) => onChangeName(e.target.value)}
          />
        </div>
      )}
      <div className="cc-grid-2">
        <input
          aria-label="状态分支名称"
          placeholder="状态（如：雨夜风衣态）"
          value={subjVar}
          onChange={(e) => onChangeVar(e.target.value)}
        />
        <select value={subjRef} onChange={(e) => onChangeRef(e.target.value)} aria-label="绑定参考图片">
          <option value="">无参考图（仅特征词）</option>
          {imageAssets.map((img) => (
            <option key={img.id} value={img.id}>
              参考图：{img.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        rows={2}
        aria-label="外观特征锁定描述"
        placeholder="特征锚点词（连线绑定到分镜后，AI 生成候选时自动带入）…"
        value={subjDesc}
        onChange={(e) => onChangeDesc(e.target.value)}
      />
      <div className="cc-card-foot">
        <button type="submit" className="button tiny primary">
          保存节点
        </button>
      </div>
    </form>
  );
}
