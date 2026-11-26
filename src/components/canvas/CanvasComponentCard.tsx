import React from 'react';
import {
  Box,
  Clapperboard,
  EyeOff,
  Film,
  Layers,
  Plus,
  SlidersHorizontal,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { newClip } from '../../core/project';
import type { Clip, CodeComponent, EditOperation, Sequence } from '../../core/types';
import type { CanvasPt as Pt, PortSide } from '../CanvasWiresLayer';
import { CodeComponentThumb } from '../CodeComponentThumb';
import type { SpatialDirectorTarget } from '../SpatialDirectorStudio';

export interface CanvasComponentCardProps {
  comp: CodeComponent;
  nodeKey: string;
  pos: Pt;
  selected: boolean;
  isPrimarySelected: boolean;
  isWireTarget: boolean;
  sequence: Sequence;
  popoverOpen: boolean;
  promptDraft: string;
  onPromptDraftChange: (val: string) => void;
  onTogglePopover: () => void;
  onClosePopover: () => void;
  onHoverChange: (hovered: boolean) => void;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onClick: (e: React.MouseEvent) => void;
  onStartWireDrag: (e: React.PointerEvent<HTMLElement>, side: PortSide) => void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
  onPublishToLibrary: (payload: { componentId: string }) => Promise<void>;
  onHideFromCanvas: () => void;
  onDeleteFromProject: () => void;
  onSendCanvasInstruction: (prompt: string, scopeClip?: Clip) => void;
  hasBakeSpatialVideo: boolean;
  hasCaptureSpatialPair: boolean;
  onBakeSpatialToAiVideo: (nodeKey: string, placement: Pt) => Promise<void>;
  onCaptureSpatialPairToAiVideo: (nodeKey: string, placement: Pt) => Promise<void>;
  onOpenSpatialDirector?: (target: SpatialDirectorTarget) => void;
}

export function CanvasComponentCard({
  comp,
  nodeKey,
  pos,
  selected,
  isPrimarySelected,
  isWireTarget,
  sequence,
  popoverOpen,
  promptDraft,
  onPromptDraftChange,
  onTogglePopover,
  onClosePopover,
  onHoverChange,
  onPointerDown,
  onClick,
  onStartWireDrag,
  onEdit,
  onPublishToLibrary,
  onHideFromCanvas,
  onDeleteFromProject,
  onSendCanvasInstruction,
  hasBakeSpatialVideo,
  hasCaptureSpatialPair,
  onBakeSpatialToAiVideo,
  onCaptureSpatialPairToAiVideo,
  onOpenSpatialDirector,
}: CanvasComponentCardProps) {
  const tail = sequence.clips.length ? Math.max(...sequence.clips.map((c) => c.start + c.duration)) : 0;

  return (
    <div
      data-node-id={nodeKey}
      className={`cc-node asset component ${selected ? 'selected' : ''} ${isWireTarget ? 'wire-target' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {isPrimarySelected && (
        <div
          className="cc-node-toolbar"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          {onOpenSpatialDirector && (
            <button
              type="button"
              className="cc-tb-primary"
              title="进入独立全屏「3D 导演棚」大屏预览、调参数并一键录片"
              onClick={() => onOpenSpatialDirector({ kind: 'component', componentId: comp.id })}
            >
              <Box size={11} /> 导演棚
            </button>
          )}
          {hasBakeSpatialVideo && (
            <button
              type="button"
              title="把当前 3D / 动态组件直接录成真 MP4 视频并自动接入 AI 生视频工坊"
              onClick={() => void onBakeSpatialToAiVideo(nodeKey, { x: pos.x + 286, y: pos.y })}
            >
              <Clapperboard size={11} /> 录视频→AI生片
            </button>
          )}
          {hasCaptureSpatialPair && (
            <button
              type="button"
              title="自动拍摄开场与收尾两帧，直连首尾帧 AI 生视频工坊"
              onClick={() => void onCaptureSpatialPairToAiVideo(nodeKey, { x: pos.x + 286, y: pos.y })}
            >
              <Film size={11} /> 首尾帧→AI
            </button>
          )}
          <button
            type="button"
            className={popoverOpen ? 'active' : ''}
            title="调整组件参数，或用自然语言让 Agent 调度摄像机轨迹、人物走线与光影"
            onClick={onTogglePopover}
          >
            <SlidersHorizontal size={11} /> 调度
          </button>
          <button
            type="button"
            title="作为分镜加入时间线"
            onClick={() => {
              const c: Clip = {
                ...newClip('code', tail),
                name: comp.name,
                componentId: comp.id,
                props: { ...comp.props },
              };
              void onEdit(`加入组件「${comp.name}」`, [
                { type: 'addClip', sequenceId: sequence.id, clip: c },
              ]);
            }}
          >
            <Plus size={11} /> 放入镜头
          </button>
          <button
            type="button"
            title="发布组件至个人库"
            onClick={() => void onPublishToLibrary({ componentId: comp.id })}
          >
            ↑个人库
          </button>
          <button type="button" title="移出画布（保留工程组件）" onClick={onHideFromCanvas}>
            <EyeOff size={11} />
          </button>
          <button
            type="button"
            title="从工程删除组件（支持 ⌘Z 撤销；已锁定镜头受保护）"
            aria-label={`删除组件 ${comp.name}`}
            onClick={onDeleteFromProject}
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}

      {popoverOpen && (
        <div
          className="cc-popover cc-rig-inspector"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="cc-card-head">
            <b>{comp.name} · 导演调度</b>
            <button type="button" onClick={onClosePopover}>
              <X size={12} />
            </button>
          </div>
          {Object.keys(comp.props || {}).length > 0 &&
            Object.entries(comp.props || {}).map(([k, v]) => {
              const commitCompProp = (nextVal: string | number | boolean) => {
                const updatedComp = { ...comp, props: { ...comp.props, [k]: nextVal } };
                const syncOps: EditOperation[] = [
                  { type: 'putComponent', component: updatedComp },
                  ...sequence.clips
                    .filter((c) => c.componentId === comp.id && !c.locked)
                    .map((c) => ({
                      type: 'updateClip' as const,
                      sequenceId: sequence.id,
                      clipId: c.id,
                      changes: { props: { [k]: nextVal } },
                    })),
                ];
                void onEdit(`调整组件参数 ${k}`, syncOps);
              };
              return (
                <label key={k} className="cc-mini-field">
                  <span>{k}</span>
                  {typeof v === 'boolean' ? (
                    <input type="checkbox" checked={v} onChange={(e) => commitCompProp(e.target.checked)} />
                  ) : typeof v === 'number' ? (
                    <input
                      type="number"
                      step="any"
                      defaultValue={v}
                      onBlur={(e) => {
                        const n = Number(e.currentTarget.value);
                        if (Number.isFinite(n) && n !== v) commitCompProp(n);
                      }}
                    />
                  ) : (
                    <input
                      type="text"
                      defaultValue={String(v)}
                      onBlur={(e) => {
                        if (e.currentTarget.value !== String(v)) {
                          commitCompProp(e.currentTarget.value);
                        }
                      }}
                    />
                  )}
                </label>
              );
            })}
          <div className="cc-mini-field">
            <span>一键 AI 导演运镜与布景调度</span>
            <div className="cc-comp-direct-chips">
              {[
                {
                  label: '环绕航拍',
                  prompt: '改为平滑 360° 电影级低空环绕航拍运镜，并暴露 cameraYaw/cameraPitch/cameraDistance 参数',
                },
                {
                  label: '低空穿梭',
                  prompt: '改为贴近楼宇街道的低空穿越推进运镜，增强纵深透视与速度感',
                },
                {
                  label: '推近拉远',
                  prompt: '改为电影感慢推近再拉远的大景别运镜，突出地标主体层次',
                },
                {
                  label: '雨夜霓虹',
                  prompt: '升级为雨夜氛围光影、体积雾气与湿润路面反射',
                },
                {
                  label: '加人物走线',
                  prompt: '在街道/天台加入可动画的白模人物走线调度，并保持运镜跟拍',
                },
              ].map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  className="cc-comp-chip"
                  onClick={() => {
                    onClosePopover();
                    onSendCanvasInstruction(
                      `请直接修改组件「${comp.name}」（componentId: ${comp.id}）：${chip.prompt}。`,
                      sequence.clips.find((c) => c.componentId === comp.id),
                    );
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
          <form
            className="cc-comp-direct-form"
            onSubmit={(e) => {
              e.preventDefault();
              const txt = promptDraft.trim();
              if (!txt) return;
              onPromptDraftChange('');
              onClosePopover();
              onSendCanvasInstruction(
                `请直接修改组件「${comp.name}」（componentId: ${comp.id}）：${txt}`,
                sequence.clips.find((c) => c.componentId === comp.id),
              );
            }}
          >
            <input
              type="text"
              placeholder="输入自定义调度指令，如：从帝国大厦俯冲拉升…"
              value={promptDraft}
              onChange={(e) => onPromptDraftChange(e.target.value)}
            />
            <button type="submit" disabled={!promptDraft.trim()}>
              <Wand2 size={11} />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        className="cc-port in"
        title="拖出或接收连线"
        aria-label={`${comp.name} 左侧连线端口`}
        onPointerDown={(e) => onStartWireDrag(e, 'left')}
      />
      <div className="cc-node-header">
        <Layers size={11} />
        <span>组件 · {comp.name}</span>
      </div>
      <div className="cc-node-card asset-card">
        <div className="cc-node-preview">
          <CodeComponentThumb component={comp} />
        </div>
      </div>
      <button
        type="button"
        className="cc-port out"
        title="拖线挂载到分镜或时间线"
        aria-label={`从 ${comp.name} 拖线`}
        onPointerDown={(e) => onStartWireDrag(e, 'right')}
      />
    </div>
  );
}
