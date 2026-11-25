import React, { useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Layers,
  Play,
  RotateCcw,
  Waypoints,
  X,
} from 'lucide-react';
import type { CanvasWireCategory, CanvasWireDisplayMode } from '../CanvasWiresLayer';

export type CanvasAssetFilter = 'all' | 'context' | 'visual' | 'audio' | 'used';

interface ZoneSummary {
  id: 'context' | 'explore' | 'shots';
  label: string;
  count: number;
  collapsed: boolean;
}

interface CanvasTopHudProps {
  assetFilter: CanvasAssetFilter;
  onAssetFilterChange: (f: CanvasAssetFilter) => void;
  counts: { all: number; context: number; visual: number; audio: number; used: number };
  zones: readonly ZoneSummary[];
  onToggleZone: (zoneId: 'context' | 'explore' | 'shots') => void;
  wireMode: CanvasWireDisplayMode;
  onWireModeChange: (m: CanvasWireDisplayMode) => void;
  wireTypeFilter: Record<CanvasWireCategory, boolean>;
  onToggleWireType: (cat: CanvasWireCategory) => void;
  hiddenEntries: readonly { key: string; label: string }[];
  onRestoreHidden: (keys?: string[]) => void;
  tracedInfo: { label: string; count: number } | null;
  onClearTrace: () => void;
  shotCount: number;
  totalDurationSec: number;
  onOpenAnimatic: () => void;
  onSwitchToEdit: () => void;
}

const WIRE_TYPE_LABELS: { id: CanvasWireCategory; label: string; desc: string }[] = [
  { id: 'binding', label: '设定绑定', desc: '角色 / 场景 / 剧本约束镜头' },
  { id: 'lineage', label: '生成血缘', desc: '工坊加工、变体派生与首尾帧' },
  { id: 'sequence', label: '叙事序列', desc: '分镜先后剪辑衔接顺序' },
  { id: 'assembly', label: '装配引用', desc: '音轨与独立素材装入镜头' },
];

export const CanvasTopHud = React.memo(function CanvasTopHud({
  assetFilter,
  onAssetFilterChange,
  counts,
  zones,
  onToggleZone,
  wireMode,
  onWireModeChange,
  wireTypeFilter,
  onToggleWireType,
  hiddenEntries,
  onRestoreHidden,
  tracedInfo,
  onClearTrace,
  shotCount,
  totalDurationSec,
  onOpenAnimatic,
  onSwitchToEdit,
}: CanvasTopHudProps) {
  const [openMenu, setOpenMenu] = useState<'wires' | 'zones' | 'hidden' | null>(null);

  const wireModeLabel = wireMode === 'focus' ? '聚焦' : wireMode === 'all' ? '全部' : '隐藏';
  const collapsedZoneCount = zones.filter((z) => z.collapsed).length;

  return (
    <div className="cc-top-hud" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cc-hud-left">
        {/* Filter Pill */}
        <div className="cc-hud-pill cc-hud-filter" role="tablist" aria-label="画布资产筛选">
          {(
            [
              ['all', `全部 ${counts.all}`],
              ['context', `设定 ${counts.context}`],
              ['visual', '画面'],
              ['audio', '音频'],
              ['used', '在用'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={assetFilter === id}
              className={assetFilter === id ? 'active' : ''}
              onClick={() => onAssetFilterChange(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Collapsible Semantic Zones Control */}
        {zones.some((z) => z.count > 0) && (
          <div className="cc-hud-anchor">
            <button
              type="button"
              className={`cc-hud-btn ${openMenu === 'zones' || collapsedZoneCount > 0 ? 'active' : ''}`}
              aria-expanded={openMenu === 'zones'}
              onClick={() => setOpenMenu((m) => (m === 'zones' ? null : 'zones'))}
            >
              <Layers size={11} />
              <span>分区{collapsedZoneCount > 0 ? ` · 折 ${collapsedZoneCount}` : ''}</span>
              <ChevronDown size={10} />
            </button>
            {openMenu === 'zones' && (
              <div className="cc-popover cc-hud-popover" role="menu" aria-label="语义分区展开与折叠">
                <div className="cc-menu-group">语义分区折叠控制</div>
                {zones
                  .filter((z) => z.count > 0)
                  .map((z) => (
                    <button
                      key={z.id}
                      type="button"
                      className="cc-hud-check-row"
                      onClick={() => onToggleZone(z.id)}
                    >
                      <span className="cc-hud-row-left">
                        {z.collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                        <b>{z.label}</b>
                        <small>{z.count} 项</small>
                      </span>
                      <span className="cc-hud-state-tag">{z.collapsed ? '已折叠' : '已展开'}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* 4-Category Wire Layer & Mode Filter */}
        <div className="cc-hud-anchor">
          <button
            type="button"
            className={`cc-hud-btn ${openMenu === 'wires' || wireMode !== 'focus' ? 'active' : ''}`}
            aria-expanded={openMenu === 'wires'}
            onClick={() => setOpenMenu((m) => (m === 'wires' ? null : 'wires'))}
          >
            <Waypoints size={11} />
            <span>连线 · {wireModeLabel}</span>
            <ChevronDown size={10} />
          </button>
          {openMenu === 'wires' && (
            <div className="cc-popover cc-hud-popover cc-wire-filter-pop" role="menu" aria-label="连线视图与分类过滤">
              <div className="cc-menu-group">连线显示模式</div>
              <div className="cc-wire-mode-seg" role="group" aria-label="连线模式">
                {(
                  [
                    ['focus', '聚焦（推荐）'],
                    ['all', '全部展开'],
                    ['hidden', '隐藏'],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    className={wireMode === m ? 'active' : ''}
                    onClick={() => onWireModeChange(m)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="cc-menu-divider" />
              <div className="cc-menu-group">关系类型开关</div>
              {WIRE_TYPE_LABELS.map((t) => {
                const on = wireTypeFilter[t.id];
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`cc-hud-check-row ${on ? 'checked' : ''}`}
                    onClick={() => onToggleWireType(t.id)}
                  >
                    <span className="cc-hud-row-copy">
                      <b>{t.label}</b>
                      <small>{t.desc}</small>
                    </span>
                    <span className={`cc-hud-chk ${on ? 'on' : ''}`}>{on && <Check size={10} />}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Stowed / Hidden Assets Restore */}
        {hiddenEntries.length > 0 && (
          <div className="cc-hud-anchor">
            <button
              type="button"
              className={`cc-hud-btn ${openMenu === 'hidden' ? 'active' : ''}`}
              onClick={() => setOpenMenu((m) => (m === 'hidden' ? null : 'hidden'))}
            >
              <RotateCcw size={10} />
              <span>已收起 {hiddenEntries.length}</span>
            </button>
            {openMenu === 'hidden' && (
              <div className="cc-popover cc-hidden-popover" role="menu" aria-label="已移出画布的素材">
                <div className="cc-hidden-pop-head">
                  <b>已收起（工程资产保留）</b>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      onRestoreHidden();
                    }}
                  >
                    全部放回
                  </button>
                </div>
                <div className="cc-hidden-pop-list">
                  {hiddenEntries.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onRestoreHidden([item.key])}
                    >
                      <span>{item.label}</span>
                      <small>+ 放回</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Trace Spotlight Banner when inspecting a full causal chain */}
      {tracedInfo && (
        <div className="cc-trace-banner" role="status">
          <GitBranch size={11} />
          <span>
            链路溯源 · <b>{tracedInfo.label}</b>（{tracedInfo.count} 个关联节点）
          </span>
          <button type="button" onClick={onClearTrace} aria-label="退出链路溯源">
            <X size={11} /> 退出
          </button>
        </div>
      )}

      {/* Right Storyboard Quick Actions (always reachable regardless of pan/zoom!) */}
      {shotCount > 0 && (
        <div className="cc-hud-right">
          <span className="cc-hud-seq-meta">
            {shotCount} 镜 · {totalDurationSec.toFixed(1)}s
          </span>
          <button
            type="button"
            className="cc-hud-btn cc-hud-play"
            title="在创造画布内连续播放全部分镜画面、字幕与配音"
            onClick={onOpenAnimatic}
          >
            <Play size={10} /> 串播分镜
          </button>
          <button
            type="button"
            className="cc-hud-btn"
            title="切换至专业时间线精剪"
            onClick={onSwitchToEdit}
          >
            精剪 <ArrowRight size={10} />
          </button>
        </div>
      )}
    </div>
  );
});
