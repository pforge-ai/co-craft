import React from 'react';
import { LayoutGrid, LayoutList, Map as MapIcon, MessageSquare, ZoomIn, ZoomOut } from 'lucide-react';

export interface MinimapDot {
  key: string;
  left: number;
  top: number;
  isShot: boolean;
}

export function CanvasUtilityControls({
  showMinimap,
  onToggleMinimap,
  minimapDots,
  rightAgentOpen,
  onToggleRightAgent,
  zoom,
  onZoomOut,
  onZoomIn,
  onTidy,
  onFit,
}: {
  showMinimap: boolean;
  onToggleMinimap: () => void;
  minimapDots: MinimapDot[];
  rightAgentOpen?: boolean;
  onToggleRightAgent?: () => void;
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onTidy: () => void;
  onFit: () => void;
}) {
  return (
    <div className="cc-bottom-right-controls" onPointerDown={(e) => e.stopPropagation()}>
      {showMinimap && minimapDots.length > 0 && (
        <div className="cc-minimap" aria-hidden="true">
          {minimapDots.map((dot) => (
            <i
              key={dot.key}
              className={dot.isShot ? 'shot-dot' : 'ent-dot'}
              style={{
                left: `${dot.left}%`,
                top: `${dot.top}%`,
              }}
            />
          ))}
        </div>
      )}
      <div className="cc-utility-pill" role="toolbar" aria-label="画布视图工具">
        {onToggleRightAgent && (
          <button
            type="button"
            className={rightAgentOpen ? 'active' : ''}
            title="展开 / 收起右侧 Agent 对话"
            aria-label="切换 Agent 对话面板"
            onClick={onToggleRightAgent}
          >
            <MessageSquare size={13} />
          </button>
        )}
        <button
          type="button"
          className={showMinimap ? 'active' : ''}
          title="显示 / 隐藏画布小地图"
          aria-label="切换画布小地图"
          onClick={onToggleMinimap}
        >
          <MapIcon size={13} />
        </button>
        <span className="cc-zoom-sep" />
        <button
          type="button"
          title="缩小画布"
          aria-label="缩小画布"
          disabled={zoom <= 0.45}
          onClick={onZoomOut}
        >
          <ZoomOut size={12} />
        </button>
        <button
          type="button"
          title="一键整理画布排版（自动消除重叠）"
          aria-label="整理画布排版"
          onClick={onTidy}
        >
          <LayoutList size={12} />
        </button>
        <button
          type="button"
          className="cc-zoom-readout"
          title="适应全部画布节点（保留手动布局）"
          onClick={onFit}
        >
          <LayoutGrid size={11} style={{ marginRight: 3 }} />
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          title="放大画布"
          aria-label="放大画布"
          disabled={zoom >= 1.5}
          onClick={onZoomIn}
        >
          <ZoomIn size={12} />
        </button>
      </div>
    </div>
  );
}
