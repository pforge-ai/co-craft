import React from 'react';
import {
  AudioLines,
  Box,
  Clapperboard,
  FileText,
  Film,
  Group,
  Hand,
  Image as ImageIcon,
  LayoutGrid,
  MousePointer2,
  Plus,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { CanvasGeneratorAction } from '../../core/types';

interface CanvasLeftToolbarProps {
  canvasTool: 'select' | 'pan';
  addMenuOpen: boolean;
  canGroupSelected: boolean;
  onSelectTool: (tool: 'select' | 'pan') => void;
  onToggleAddMenu: () => void;
  onCloseAddMenu: () => void;
  onCreateGenerator: (use: 'image' | 'video' | 'speech', action: CanvasGeneratorAction) => void;
  onCreateTextNode: () => void;
  onCreateRig3D: () => void;
  onImportMedia: () => void;
  onAppendShot: () => void;
  onGroupSelected: () => void;
  onTidyCanvas: () => void;
  onOpenStudioDialog: () => void;
}

export const CanvasLeftToolbar = React.memo(function CanvasLeftToolbar({
  canvasTool,
  addMenuOpen,
  canGroupSelected,
  onSelectTool,
  onToggleAddMenu,
  onCloseAddMenu,
  onCreateGenerator,
  onCreateTextNode,
  onCreateRig3D,
  onImportMedia,
  onAppendShot,
  onGroupSelected,
  onTidyCanvas,
  onOpenStudioDialog,
}: CanvasLeftToolbarProps) {
  return (
    <div className="cc-left-rail-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cc-left-rail" role="toolbar" aria-label="画布创作工具">
        <button
          type="button"
          className={`cc-rail-btn ${canvasTool === 'select' ? 'active' : ''}`}
          title="指针框选 (V)"
          aria-label="指针框选工具"
          onClick={() => onSelectTool('select')}
        >
          <MousePointer2 size={14} />
        </button>
        <button
          type="button"
          className={`cc-rail-btn ${canvasTool === 'pan' ? 'active' : ''}`}
          title="抓手平移 (H / 按住空格)"
          aria-label="抓手平移工具"
          onClick={() => onSelectTool('pan')}
        >
          <Hand size={14} />
        </button>

        <span className="cc-rail-sep" />

        <button
          type="button"
          className={`cc-rail-btn cc-rail-add ${addMenuOpen ? 'open' : ''}`}
          title="添加节点或 AI 工坊卡 (+)"
          aria-label="添加画布节点"
          aria-expanded={addMenuOpen}
          onClick={onToggleAddMenu}
        >
          <Plus size={15} />
        </button>

        <button
          type="button"
          className="cc-rail-btn"
          title="新建脚本文本节点 (T)"
          aria-label="新建脚本文本节点"
          onClick={onCreateTextNode}
        >
          <FileText size={14} />
        </button>

        <button
          type="button"
          className="cc-rail-btn"
          title="原地添加 AI 图像工坊卡 (G)"
          aria-label="添加 AI 生图工坊卡"
          onClick={() => onCreateGenerator('image', 'text-to-image')}
        >
          <Sparkles size={14} />
        </button>

        <button
          type="button"
          className="cc-rail-btn"
          title="新建统一空间摄影棚（2.5D 立体 / 导演白模 / 3D 硬件贴屏）"
          aria-label="新建空间摄影棚"
          onClick={onCreateRig3D}
        >
          <Box size={14} />
        </button>

        <button
          type="button"
          className="cc-rail-btn"
          title="上传本地图片 / 视频 / 音频 / 3D (.glb/.spz) 素材 (U)"
          aria-label="上传本地素材"
          onClick={onImportMedia}
        >
          <Upload size={14} />
        </button>

        <span className="cc-rail-sep" />

        {canGroupSelected && (
          <button
            type="button"
            className="cc-rail-btn"
            title="将已选节点成组归类 (⌘G)"
            aria-label="选中节点成组"
            onClick={onGroupSelected}
          >
            <Group size={14} />
          </button>
        )}

        <button
          type="button"
          className="cc-rail-btn"
          title="按语义分区整理画布排版"
          aria-label="整理画布排版"
          onClick={onTidyCanvas}
        >
          <LayoutGrid size={14} />
        </button>
      </div>

      {addMenuOpen && (
        <div className="cc-popover cc-tap-menu cc-rail-popover" role="menu" aria-label="添加画布节点">
          <div className="cc-menu-group">AI 加工 / 转换工坊卡</div>
          <button
            type="button"
            onClick={() => {
              onCloseAddMenu();
              onCreateGenerator('image', 'text-to-image');
            }}
          >
            <span className="cc-menu-item-label">
              <ImageIcon size={13} /> AI 生图 / 改图工坊卡
            </span>
            <kbd>G</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              onCloseAddMenu();
              onCreateGenerator('video', 'image-to-video');
            }}
          >
            <span className="cc-menu-item-label">
              <Clapperboard size={13} /> AI 视频 / 首尾帧工坊卡
            </span>
            <kbd>V</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              onCloseAddMenu();
              onCreateGenerator('speech', 'tts');
            }}
          >
            <span className="cc-menu-item-label">
              <AudioLines size={13} /> AI 配音工坊卡
            </span>
            <kbd>A</kbd>
          </button>

          <div className="cc-menu-divider" />
          <div className="cc-menu-group">资产与叙事节点</div>

          <button
            type="button"
            onClick={() => {
              onCloseAddMenu();
              onCreateTextNode();
            }}
          >
            <span className="cc-menu-item-label">
              <FileText size={13} /> 剧本 / 文本节点
            </span>
            <kbd>T</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              onCloseAddMenu();
              onImportMedia();
            }}
          >
            <span className="cc-menu-item-label">
              <Upload size={13} /> 上传本地媒体
            </span>
            <kbd>U</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              onCloseAddMenu();
              onCreateRig3D();
            }}
          >
            <span className="cc-menu-item-label">
              <Box size={13} /> 空间摄影棚（2.5D / 白模 / 3D）
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onCloseAddMenu();
              onAppendShot();
            }}
          >
            <span className="cc-menu-item-label">
              <Film size={13} /> 新增空白分镜
            </span>
            <kbd>N</kbd>
          </button>

          <div className="cc-menu-divider" />
          <button
            type="button"
            onClick={() => {
              onCloseAddMenu();
              onOpenStudioDialog();
            }}
          >
            <span className="cc-menu-item-label">
              <Sparkles size={13} /> 打开完整素材工作室…
            </span>
          </button>
        </div>
      )}
    </div>
  );
});
