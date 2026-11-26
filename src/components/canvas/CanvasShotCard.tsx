import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Film,
  GitBranch,
  GripVertical,
  Lock,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  Unlock,
  Wand2,
  X,
} from 'lucide-react';
import { timecode } from '../../core/project';
import { isSpatialClip } from '../../core/spatialStage';
import {
  collectShotClipsForCompound,
  moveCompositeShotOperations,
  updateShotNotesOperations,
  updateShotScriptOperations,
  updateSingleCaptionTextOperations,
  type CompositeShot,
} from '../../core/storyboard';
import type { Clip, EditOperation, Job, Project, Sequence, VaultItem } from '../../core/types';
import { ShotCompositeThumb } from '../ShotCompositeThumb';
import type { CanvasPt, PortSide } from '../CanvasWiresLayer';
import {
  FORK_VARIANT_PRESETS,
  detectStaleBindings,
  resolveShotGenContextFull,
  type CanvasGenerationOptions,
} from './types';

export interface CanvasShotCardProps {
  project: Project;
  sequence: Sequence;
  shot: CompositeShot;
  shots: readonly CompositeShot[];
  pos: CanvasPt;
  previewOrigin: string;
  selected: boolean;
  isPrimarySelected: boolean;
  wireTarget: boolean;
  upstreamEntities: readonly VaultItem[];
  activeVarByEnt: Record<string, string>;
  takeMenuOpen: boolean;
  activeJob?: Job;
  justCompleted?: boolean;
  reorderDropSide?: 'before' | 'after' | null;
  isReorderingSource?: boolean;
  dimmed?: boolean;
  inDegree?: number;
  outDegree?: number;
  onTraceNode?: (nodeKey: string) => void;
  onMouseEnter: (nodeKey: string) => void;
  onMouseLeave: (nodeKey: string) => void;
  onPointerDown: (e: React.PointerEvent<HTMLElement>, nodeKey: string, pos: CanvasPt) => void;
  onClick: (e: React.MouseEvent, nodeKey: string, clipId: string) => void;
  onStartWireDrag: (e: React.PointerEvent<HTMLElement>, nodeKey: string, side: PortSide) => void;
  onStartReorderDrag: (e: React.PointerEvent<HTMLElement>, shot: CompositeShot) => void;
  onQuickLook: (nodeKey: string) => void;
  onToggleTakeMenu: (shotId: string) => void;
  onAddCandidateTake: (
    shot: CompositeShot,
    variant: 'clone' | 'seecode-architecture' | 'tinycharts-state' | 'teardown-3d' | 'screen-focus-rig',
  ) => void;
  onOpenGeneration: (opts: CanvasGenerationOptions) => void;
  onBakeShotToAiVideo?: (shot: CompositeShot, pos: CanvasPt) => void;
  onCaptureShotPairToAiVideo?: (shot: CompositeShot, pos: CanvasPt) => void;
  onCaptureShotRefToAiImage?: (shot: CompositeShot, pos: CanvasPt) => void;
  onOpenShotInDirector?: (shot: CompositeShot) => void;
  onForkShotVariants: (shot: CompositeShot, pos: CanvasPt) => void;
  onTweakShotWithAgent: (shot: CompositeShot, prompt: string) => void;
  onJumpToEdit: (clipId: string, startFrame: number) => void;
  onSaveClipsAsAsset?: (
    clips: Clip[],
    customName?: string,
    clipWindow?: { start: number; duration: number },
  ) => Promise<void>;
  onCancelJob?: (jobId: string) => void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
}

export const CanvasShotCard = React.memo(function CanvasShotCard({
  project,
  sequence,
  shot,
  shots,
  pos,
  previewOrigin,
  selected,
  isPrimarySelected,
  wireTarget,
  upstreamEntities,
  activeVarByEnt,
  takeMenuOpen,
  activeJob,
  justCompleted = false,
  reorderDropSide = null,
  isReorderingSource = false,
  dimmed = false,
  inDegree = 0,
  outDegree = 0,
  onTraceNode,
  onMouseEnter,
  onMouseLeave,
  onPointerDown,
  onClick,
  onStartWireDrag,
  onStartReorderDrag,
  onQuickLook,
  onToggleTakeMenu,
  onAddCandidateTake,
  onOpenGeneration,
  onBakeShotToAiVideo,
  onCaptureShotPairToAiVideo,
  onCaptureShotRefToAiImage,
  onOpenShotInDirector,
  onForkShotVariants,
  onTweakShotWithAgent,
  onJumpToEdit,
  onSaveClipsAsAsset,
  onCancelJob,
  onEdit,
}: CanvasShotCardProps) {
  const [thumbHovered, setThumbHovered] = useState(false);
  const [staleMenuOpen, setStaleMenuOpen] = useState(false);

  const nodeKey = `shot:${shot.id}`;
  const c = shot.anchorClip;
  const takes = c.takes || [];
  const activeTakeIdx = takes.length > 0 ? Math.max(0, takes.findIndex((t) => t.id === c.activeTakeId)) : -1;
  const primaryBinding = shot.bindings[0];
  const boundEnt = primaryBinding ? upstreamEntities.find((x) => x.id === primaryBinding.entityId) : undefined;
  const staleBindings = detectStaleBindings(shot, upstreamEntities);
  const staleEntityIds = new Set(staleBindings.map((s) => s.entity.id));

  const genCtx = resolveShotGenContextFull(shot, upstreamEntities, project.assets, activeVarByEnt);
  const anchorAsset = c.assetId ? project.assets.find((a) => a.id === c.assetId) : undefined;
  const isDirectable3D = c.kind === 'code' || isSpatialClip(c, anchorAsset);
  const canImgToVideo = genCtx.refAssetIds.length > 0;
  const jobPct = activeJob ? Math.max(0, Math.min(100, Math.round((activeJob.progress || 0) * 100))) : 0;

  const stepTake = (delta: -1 | 1) => {
    if (c.locked || takes.length < 2) return;
    const nextIdx = (activeTakeIdx + delta + takes.length) % takes.length;
    const nextTake = takes[nextIdx];
    if (!nextTake) return;
    void onEdit(`切换镜头 #${shot.index} 候选 ${nextTake.label}`, [
      { type: 'switchClipTake', sequenceId: sequence.id, clipId: c.id, takeId: nextTake.id },
    ]);
  };

  const syncStaleBindings = async (thenRegenerate: boolean) => {
    setStaleMenuOpen(false);
    if (shot.locked) return;
    const nextBindings = shot.bindings.map((b) => {
      const ent = upstreamEntities.find((e) => e.id === b.entityId);
      if (!ent) return b;
      const vrId = activeVarByEnt[ent.id] || ent.defaultVariantId || b.variantId || ent.variants?.[0]?.id;
      return { ...b, variantId: vrId, pinnedVersion: ent.version };
    });
    await onEdit(`同步镜头 #${shot.index} 上游设定版本`, [
      {
        type: 'updateClip',
        sequenceId: sequence.id,
        clipId: c.id,
        changes: {
          subjectBindings: nextBindings,
          subjectIds: nextBindings.map((x) => x.entityId),
        },
      },
    ]);
    if (thenRegenerate) {
      const freshCtx = resolveShotGenContextFull(
        { ...shot, bindings: nextBindings },
        upstreamEntities,
        project.assets,
        activeVarByEnt,
      );
      onOpenGeneration({
        use: 'image',
        prompt: freshCtx.prompt,
        referenceAssetId: freshCtx.refAssetId,
        referenceAssetIds: freshCtx.refAssetIds.length ? freshCtx.refAssetIds : undefined,
        target: {
          sequenceId: sequence.id,
          clipId: c.id,
          shotLabel: `镜头 #${shot.index} · ${c.name}`,
          mode: 'take',
        },
        canvas: {
          sourceNodeKeys: freshCtx.sourceNodeKeys,
          referenceAssetIds: freshCtx.refAssetIds.length ? freshCtx.refAssetIds : undefined,
        },
      });
    }
  };

  return (
    <div
      data-node-id={nodeKey}
      data-shot-node-id={shot.id}
      className={`cc-node shot ${selected ? 'selected' : ''} ${wireTarget ? 'wire-target' : ''} ${activeJob ? 'generating' : ''} ${isReorderingSource ? 'reordering-source' : ''} ${dimmed ? 'trace-dimmed' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onMouseEnter={() => onMouseEnter(nodeKey)}
      onMouseLeave={() => onMouseLeave(nodeKey)}
      onPointerDown={(e) => onPointerDown(e, nodeKey, pos)}
      onClick={(e) => onClick(e, nodeKey, c.id)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/cocraft-entity')) e.preventDefault();
      }}
      onDrop={(e) => {
        const entPayload = e.dataTransfer.getData('application/cocraft-entity');
        if (entPayload && !shot.locked) {
          e.preventDefault();
          e.stopPropagation();
          const [entityId, variantId] = entPayload.split(':');
          const ent = upstreamEntities.find((x) => x.id === entityId);
          // Append multi-subject binding cleanly instead of wiping existing subjects
          const nextBindings = [
            ...shot.bindings.filter((x) => x.entityId !== entityId),
            {
              entityId,
              variantId: variantId || activeVarByEnt[entityId] || ent?.defaultVariantId || undefined,
              pinnedVersion: ent?.version,
            },
          ];
          void onEdit(`追加绑定 @${ent?.name || '主体'} 到分镜`, [
            {
              type: 'updateClip',
              sequenceId: sequence.id,
              clipId: c.id,
              changes: {
                subjectBindings: nextBindings,
                subjectIds: nextBindings.map((x) => x.entityId),
              },
            },
          ]);
        }
      }}
    >
      {reorderDropSide && <div className={`cc-shot-drop-line ${reorderDropSide}`} aria-hidden="true" />}

      {isPrimarySelected && (
        <div
          className="cc-node-toolbar"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="前移镜头"
            title="前移镜头（画面与字幕同步移动）"
            disabled={shot.locked || shot.index === 1}
            onClick={() => {
              const ops = moveCompositeShotOperations(sequence, shots as CompositeShot[], shot.id, -1);
              if (ops.length) void onEdit(`前移镜头 #${shot.index}`, ops);
            }}
          >
            <ArrowLeft size={12} />
          </button>
          <button
            type="button"
            aria-label="后移镜头"
            title="后移镜头（画面与字幕同步移动）"
            disabled={shot.locked || shot.index === shots.length}
            onClick={() => {
              const ops = moveCompositeShotOperations(sequence, shots as CompositeShot[], shot.id, 1);
              if (ops.length) void onEdit(`后移镜头 #${shot.index}`, ops);
            }}
          >
            <ArrowRight size={12} />
          </button>
          <span className="cc-tb-sep" />
          {isDirectable3D && onOpenShotInDirector && (
            <button
              type="button"
              className="cc-tb-primary"
              aria-label={`镜头 ${shot.index} 进入 3D 导演棚`}
              title="进入专属全屏「3D 导演棚」自由运镜、打机位关键帧并直接出片回流"
              onClick={() => onOpenShotInDirector(shot)}
            >
              <Box size={11} /> 导演棚
            </button>
          )}
          {isDirectable3D && onBakeShotToAiVideo && (
            <button
              type="button"
              aria-label={`镜头 ${shot.index} 录 3D 视频并 AI 生片`}
              title="将本镜 3D / 动态运镜直接录成真 MP4 视频，并自动连入下游 AI 视频工坊（动作迁移 / 参考生视频）"
              onClick={() => onBakeShotToAiVideo(shot, pos)}
            >
              <Clapperboard size={11} /> 录视频→AI
            </button>
          )}
          {isDirectable3D && onCaptureShotPairToAiVideo && (
            <button
              type="button"
              aria-label={`镜头 ${shot.index} 首尾帧生视频`}
              title="自动双拍开场/收尾（或 A→B 机位）两帧并连入首尾帧生视频工坊"
              onClick={() => onCaptureShotPairToAiVideo(shot, pos)}
            >
              <Film size={11} /> 首尾帧→AI
            </button>
          )}
          <button
            type="button"
            aria-label={`镜头 ${shot.index} AI 生成候选`}
            title={
              isDirectable3D && !genCtx.refAssetId && onCaptureShotRefToAiImage
                ? '拍摄当前 3D 画面作为参考图并送入 AI 写实重绘工坊'
                : genCtx.refAssetIds.length > 1
                  ? `自动带入全部 ${genCtx.refAssetIds.length} 张绑定参考图生成画面候选`
                  : '带入本镜台词与主体设定生成画面候选'
            }
            onClick={() => {
              if (isDirectable3D && !genCtx.refAssetId && onCaptureShotRefToAiImage) {
                onCaptureShotRefToAiImage(shot, pos);
                return;
              }
              onOpenGeneration({
                use: 'image',
                prompt: genCtx.prompt,
                referenceAssetId: genCtx.refAssetId,
                referenceAssetIds: genCtx.refAssetIds.length ? genCtx.refAssetIds : undefined,
                target: {
                  sequenceId: sequence.id,
                  clipId: c.id,
                  shotLabel: `镜头 #${shot.index} · ${c.name}`,
                  mode: 'take',
                },
                canvas: {
                  sourceNodeKeys: genCtx.sourceNodeKeys,
                  referenceAssetIds: genCtx.refAssetIds.length ? genCtx.refAssetIds : undefined,
                },
              });
            }}
          >
            <Sparkles size={12} /> {isDirectable3D && !genCtx.refAssetId ? '拍帧重绘' : '生图'}
          </button>
          {canImgToVideo && !isDirectable3D && (
            <button
              type="button"
              aria-label={`镜头 ${shot.index} 图生视频`}
              title="直接以本镜画面或绑定主体参考图生成视频候选"
              onClick={() =>
                onOpenGeneration({
                  use: 'video',
                  prompt: `${genCtx.prompt || c.name}，电影感自然镜头运动`,
                  referenceAssetId: genCtx.refAssetId,
                  referenceAssetIds: genCtx.refAssetIds.length ? genCtx.refAssetIds : undefined,
                  target: {
                    sequenceId: sequence.id,
                    clipId: c.id,
                    shotLabel: `镜头 #${shot.index} · ${c.name}`,
                    mode: 'take',
                  },
                  canvas: {
                    sourceNodeKeys: genCtx.sourceNodeKeys,
                    referenceAssetIds: genCtx.refAssetIds.length ? genCtx.refAssetIds : undefined,
                  },
                })
              }
            >
              <Clapperboard size={11} /> 生视频
            </button>
          )}
          <button
            type="button"
            title="在画布旁横向派生 3 组不同景别/光影的视觉变体并排比稿"
            aria-label={`镜头 ${shot.index} 派生变体`}
            onClick={() => onForkShotVariants(shot, pos)}
          >
            <GitBranch size={11} /> 变体
          </button>
          <button
            type="button"
            title={isDirectable3D ? '让 Agent 调度此 3D 镜头的摄像机运镜、走线、动作或环境光影' : '让 Agent 微调本镜'}
            onClick={() =>
              onTweakShotWithAgent(
                shot,
                isDirectable3D
                  ? `请调度镜头 #${shot.index}「${c.name}」的3D机位运镜、视角轨迹或场景光影：`
                  : `优化镜头 #${shot.index}（${genCtx.prompt || c.name}）：`,
              )
            }
          >
            <Wand2 size={11} /> {isDirectable3D ? '调度' : '微调'}
          </button>
          <button
            type="button"
            aria-label={`为镜头 ${shot.index} 生产候选`}
            onClick={() => onToggleTakeMenu(shot.id)}
          >
            <Plus size={12} /> 候选
          </button>
          <button
            type="button"
            title="进入时间线在此位置精剪"
            onClick={() => onJumpToEdit(c.id, shot.start)}
          >
            <Scissors size={11} /> 精剪
          </button>
          {onSaveClipsAsAsset && (
            <button
              type="button"
              aria-label="保存为项目资产"
              title="将当前镜头整组保存为复合资产"
              onClick={() =>
                void onSaveClipsAsAsset(collectShotClipsForCompound(sequence, shot), c.name, {
                  start: shot.start,
                  duration: shot.duration,
                })
              }
            >
              <BookmarkPlus size={11} /> 存资产
            </button>
          )}
          <button
            type="button"
            aria-label={c.locked ? '解锁镜头' : '锁定镜头'}
            onClick={() =>
              void onEdit(c.locked ? '解锁镜头' : '锁定镜头', [
                { type: 'updateClip', sequenceId: sequence.id, clipId: c.id, changes: { locked: !c.locked } },
              ])
            }
          >
            {c.locked ? <Lock size={11} /> : <Unlock size={11} />}
          </button>
          {!c.locked && (
            <button
              type="button"
              aria-label={`删除镜头 ${shot.index}`}
              title="删除此分镜"
              onClick={() =>
                void onEdit(`删除镜头 #${shot.index}`, [
                  { type: 'deleteClip', sequenceId: sequence.id, clipId: c.id },
                ])
              }
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      )}

      {takeMenuOpen && (
        <div className="cc-popover cc-take-menu" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => onAddCandidateTake(shot, 'seecode-architecture')}>
            + 流程指标图解候选
          </button>
          <button type="button" onClick={() => onAddCandidateTake(shot, 'tinycharts-state')}>
            + 手绘白板推演候选
          </button>
          <button type="button" onClick={() => onAddCandidateTake(shot, 'teardown-3d')}>
            + 三维空间结构候选
          </button>
          <button type="button" onClick={() => onAddCandidateTake(shot, 'screen-focus-rig')}>
            + 设备窗口特写候选
          </button>
          <button type="button" onClick={() => onAddCandidateTake(shot, 'clone')}>
            克隆当前画面为候选
          </button>
          <button
            type="button"
            onClick={() => {
              onToggleTakeMenu(shot.id);
              onOpenGeneration({
                use: 'image',
                prompt: genCtx.prompt,
                referenceAssetId: genCtx.refAssetId,
                referenceAssetIds: genCtx.refAssetIds.length ? genCtx.refAssetIds : undefined,
                target: {
                  sequenceId: sequence.id,
                  clipId: c.id,
                  shotLabel: `镜头 #${shot.index} · ${c.name}`,
                  mode: 'take',
                },
                canvas: {
                  sourceNodeKeys: genCtx.sourceNodeKeys,
                  referenceAssetIds: genCtx.refAssetIds.length ? genCtx.refAssetIds : undefined,
                },
              });
            }}
          >
            <Sparkles size={12} /> AI 生图候选（带入全部绑定参考图）
          </button>
          <button
            type="button"
            onClick={() => {
              onToggleTakeMenu(shot.id);
              onOpenGeneration({
                use: 'video',
                prompt: `${genCtx.prompt || c.name}，电影级镜头运动`,
                referenceAssetId: genCtx.refAssetId,
                referenceAssetIds: genCtx.refAssetIds.length ? genCtx.refAssetIds : undefined,
                target: {
                  sequenceId: sequence.id,
                  clipId: c.id,
                  shotLabel: `镜头 #${shot.index} · ${c.name}`,
                  mode: 'take',
                },
                canvas: {
                  sourceNodeKeys: genCtx.sourceNodeKeys,
                  referenceAssetIds: genCtx.refAssetIds.length ? genCtx.refAssetIds : undefined,
                },
              });
            }}
          >
            <Clapperboard size={12} /> AI 生视频候选（自动匹配图生/参考视频）
          </button>
          <div className="cc-menu-divider" />
          {FORK_VARIANT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onToggleTakeMenu(shot.id);
                onOpenGeneration({
                  use: 'image',
                  prompt: `${genCtx.prompt || c.name}，${preset.suffix}`,
                  referenceAssetId: genCtx.refAssetId,
                  referenceAssetIds: genCtx.refAssetIds.length ? genCtx.refAssetIds : undefined,
                  canvas: {
                    placement: { x: Math.round(pos.x + 312), y: Math.round(pos.y) },
                    sourceNodeKeys: genCtx.sourceNodeKeys,
                    referenceAssetIds: genCtx.refAssetIds.length ? genCtx.refAssetIds : undefined,
                  },
                });
              }}
            >
              <GitBranch size={11} /> 画布旁派生：{preset.label}
            </button>
          ))}
        </div>
      )}

      {staleMenuOpen && staleBindings.length > 0 && (
        <div
          className="cc-popover cc-stale-popover"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="cc-menu-group">上游设定已升级</div>
          <div className="cc-stale-list">
            {staleBindings.map(({ binding, entity }) => (
              <div key={entity.id} className="cc-stale-row">
                <span>@{entity.name}</span>
                <small>
                  v{binding.pinnedVersion} → v{entity.version}
                </small>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => void syncStaleBindings(true)}>
            <Sparkles size={12} /> 按新设定重拍候选
          </button>
          <button type="button" onClick={() => void syncStaleBindings(false)}>
            <Check size={12} /> 仅同步绑定版本
          </button>
        </div>
      )}

      <button
        type="button"
        className="cc-port in"
        title="拖出或接收上游设定或参考节点连线"
        aria-label={`镜头 ${shot.index} 左侧连线端口`}
        onPointerDown={(e) => onStartWireDrag(e, nodeKey, 'left')}
      />
      {inDegree > 0 && onTraceNode && (
        <button
          type="button"
          className="cc-port-badge in"
          title={`已关联 ${inDegree} 个上游节点，点击溯源完整链路`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onTraceNode(nodeKey);
          }}
        >
          ← {inDegree}
        </button>
      )}

      <div className="cc-node-header">
        {!shot.locked && shots.length > 1 && (
          <button
            type="button"
            className="cc-shot-reorder-grip"
            title="拖拽此把手直接调整分镜顺序（画面、字幕与镜头配音同步移动）"
            aria-label={`拖拽排序镜头 ${shot.index}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onStartReorderDrag(e, shot);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={11} />
          </button>
        )}
        <Film size={11} />
        <span>
          镜头 {String(shot.index).padStart(2, '0')} · {timecode(shot.start, sequence.fps)}
        </span>
        {staleBindings.length > 0 && (
          <button
            type="button"
            className="cc-stale-badge"
            title="上游角色或设定节点已更新版本，点击同步或重拍"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setStaleMenuOpen((v) => !v);
            }}
          >
            <RefreshCw size={9} /> 设定已更新
          </button>
        )}
        <small>
          {(shot.duration / sequence.fps).toFixed(1)}s
          {shot.compositeClips.length > 1 ? ` · ${shot.compositeClips.length}层` : ''}
        </small>
      </div>

      <div className={`cc-node-card shot-card-body ${justCompleted ? 'cc-just-completed' : ''}`}>
        <div
          className="cc-shot-thumb"
          onMouseEnter={() => setThumbHovered(true)}
          onMouseLeave={() => setThumbHovered(false)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onQuickLook(nodeKey);
          }}
        >
          <ShotCompositeThumb
            project={project}
            sequence={sequence}
            shot={shot}
            previewOrigin={previewOrigin}
            hoverPlay={thumbHovered}
          />
          {activeJob && (
            <div
              className="cc-shot-gen-pill"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <Sparkles size={10} />
              <span>
                {activeJob.stage || 'AI 渲染中'}
                {jobPct > 0 ? ` ${jobPct}%` : ''}
              </span>
              {onCancelJob && (
                <button
                  type="button"
                  title="取消生成"
                  aria-label="取消镜头生成"
                  onClick={() => onCancelJob(activeJob.id)}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )}
          {takes.length >= 2 && (
            <div
              className={`cc-shot-take-pill ${thumbHovered || selected ? 'expanded' : ''}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              title={`共 ${takes.length} 个候选画面，点击箭头快速切换`}
            >
              {!c.locked && (
                <button
                  type="button"
                  className="cc-take-step"
                  aria-label={`镜头 ${shot.index} 上一个候选`}
                  onClick={() => stepTake(-1)}
                >
                  <ChevronLeft size={11} />
                </button>
              )}
              <span>
                T{activeTakeIdx + 1}/{takes.length}
              </span>
              {!c.locked && (
                <button
                  type="button"
                  className="cc-take-step"
                  aria-label={`镜头 ${shot.index} 下一个候选`}
                  onClick={() => stepTake(1)}
                >
                  <ChevronRight size={11} />
                </button>
              )}
            </div>
          )}
          {shot.locked && (
            <span className="cc-lock-tag">
              <Lock size={10} />
            </span>
          )}
          {!selected && (boundEnt || (shot.scriptText && shot.captionClips.length === 0)) && (
            <div className="cc-shot-overlay-cap">
              {boundEnt && (
                <b>
                  @{boundEnt.name}
                  {shot.bindings.length > 1 ? ` +${shot.bindings.length - 1}` : ''}
                </b>
              )}
              {shot.captionClips.length === 0 && <span>{shot.scriptText || c.name}</span>}
            </div>
          )}
        </div>

        {selected && (
          <div className="cc-shot-inspector-drawer" onClick={(e) => e.stopPropagation()}>
            {shot.captionClips.length >= 2 ? (
              <div className="shot-timed-captions compact">
                <div className="shot-timed-head">
                  <span>已对时字幕（{shot.captionClips.length} 句）</span>
                  {!shot.locked && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `确定将镜头 #${shot.index} 的 ${shot.captionClips.length} 条逐句字幕合并为 1 条整镜字幕？原分句停顿时间将被替换（可 ⌘Z 撤销）。`,
                          )
                        ) {
                          void onEdit(
                            `合并重写镜头 #${shot.index} 字幕`,
                            updateShotScriptOperations(sequence, shot, shot.scriptText, { resetTiming: true }),
                          );
                        }
                      }}
                    >
                      合并重排
                    </button>
                  )}
                </div>
                {shot.captionClips.map((cap, capIdx) => (
                  <div key={cap.id} className="shot-timed-row">
                    <span className="shot-timed-tc">{timecode(cap.start, sequence.fps)}</span>
                    <input
                      key={`${cap.id}-${String(cap.props.text || '')}`}
                      type="text"
                      className="shot-timed-input"
                      aria-label={`镜头 ${shot.index} 第 ${capIdx + 1} 句字幕`}
                      defaultValue={String(cap.props.text || '')}
                      disabled={shot.locked || cap.locked}
                      onBlur={(e) => {
                        const nextVal = e.currentTarget.value.trim();
                        if (nextVal !== String(cap.props.text || '').trim()) {
                          void onEdit(
                            `修改镜头 #${shot.index} 第 ${capIdx + 1} 句字幕`,
                            updateSingleCaptionTextOperations(sequence, cap, nextVal),
                          );
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  </div>
                ))}
                <input
                  key={`${shot.id}-notes-${c.shotNotes || ''}`}
                  type="text"
                  className="shot-notes-input"
                  aria-label={`镜头 ${shot.index} 旁白备注`}
                  placeholder="本镜旁白备注（不影响字幕时码）…"
                  defaultValue={c.shotNotes || ''}
                  disabled={shot.locked}
                  onBlur={(e) => {
                    if (e.currentTarget.value.trim() !== (c.shotNotes || '').trim()) {
                      void onEdit(
                        `更新镜头 #${shot.index} 旁白备注`,
                        updateShotNotesOperations(sequence, shot, e.currentTarget.value),
                      );
                    }
                  }}
                />
              </div>
            ) : (
              <textarea
                key={`${shot.id}-${shot.scriptText}`}
                className="cc-shot-script"
                rows={2}
                aria-label={`镜头 ${shot.index} 旁白与字幕`}
                placeholder="输入本镜台词或旁白（自动同步字幕轨）…"
                defaultValue={shot.scriptText}
                disabled={shot.locked}
                onBlur={(e) => {
                  if (e.currentTarget.value.trim() !== shot.scriptText.trim()) {
                    void onEdit(
                      `更新镜头 #${shot.index} 台词`,
                      updateShotScriptOperations(sequence, shot, e.currentTarget.value),
                    );
                  }
                }}
              />
            )}
            <div className="cc-shot-foot">
              {shot.bindings.map((binding) => {
                const ent = upstreamEntities.find((x) => x.id === binding.entityId);
                if (!ent) return null;
                const vr =
                  ent.variants?.find((v) => v.id === binding.variantId) ||
                  ent.variants?.find((v) => v.id === ent.defaultVariantId) ||
                  ent.variants?.[0];
                const isStale = staleEntityIds.has(ent.id);
                return (
                  <span
                    key={binding.entityId}
                    className={`cc-bound-pill ${isStale ? 'stale' : ''}`}
                    title={
                      isStale
                        ? `上游 @${ent.name} 已更新至 v${ent.version}（当前绑定 v${binding.pinnedVersion}）`
                        : '已通过画布连线绑定一致性特征'
                    }
                  >
                    @{ent.name}
                    {vr ? `:${vr.name}` : ''}
                    {!shot.locked && (
                      <button
                        type="button"
                        aria-label={`解除主体绑定 ${ent.name}`}
                        onClick={() => {
                          const nextBindings = shot.bindings.filter((x) => x.entityId !== ent.id);
                          void onEdit(`解除 @${ent.name} 绑定`, [
                            {
                              type: 'updateClip',
                              sequenceId: sequence.id,
                              clipId: c.id,
                              changes: {
                                subjectBindings: nextBindings,
                                subjectIds: nextBindings.map((x) => x.entityId),
                              },
                            },
                          ]);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
              {!shot.locked && upstreamEntities.some((u) => !shot.bindings.some((b) => b.entityId === u.id)) ? (
                <select
                  className="cc-bind-select"
                  aria-label={`镜头 ${shot.index} 绑定主体`}
                  value=""
                  onChange={(e) => {
                    const ent = upstreamEntities.find((x) => x.id === e.target.value);
                    if (!ent) return;
                    const vrId = activeVarByEnt[ent.id] || ent.defaultVariantId || ent.variants?.[0]?.id;
                    const nextBindings = [
                      ...shot.bindings.filter((x) => x.entityId !== ent.id),
                      { entityId: ent.id, variantId: vrId, pinnedVersion: ent.version },
                    ];
                    void onEdit(`绑定 @${ent.name}`, [
                      {
                        type: 'updateClip',
                        sequenceId: sequence.id,
                        clipId: c.id,
                        changes: {
                          subjectBindings: nextBindings,
                          subjectIds: nextBindings.map((x) => x.entityId),
                        },
                      },
                    ]);
                  }}
                >
                  <option value="">+ 绑定节点…</option>
                  {upstreamEntities
                    .filter((u) => !shot.bindings.some((b) => b.entityId === u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        @{u.name}
                      </option>
                    ))}
                </select>
              ) : shot.bindings.length === 0 ? (
                <span className="cc-muted-meta">{c.name.slice(0, 14)}</span>
              ) : null}

              <div className="cc-takes">
                {takes.map((t, ti) => {
                  const isAct = c.activeTakeId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={isAct ? 'active' : ''}
                      title={t.label}
                      disabled={c.locked}
                      onClick={() =>
                        void onEdit(`切换镜头 #${shot.index} 候选`, [
                          { type: 'switchClipTake', sequenceId: sequence.id, clipId: c.id, takeId: t.id },
                        ])
                      }
                    >
                      {isAct && <Check size={9} />}T{ti + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="cc-port out"
        title="拖出连线派生后续分镜或参考"
        aria-label={`从镜头 ${shot.index} 拖线`}
        onPointerDown={(e) => onStartWireDrag(e, nodeKey, 'right')}
      />
      {outDegree > 0 && onTraceNode && (
        <button
          type="button"
          className="cc-port-badge out"
          title={`已派生 ${outDegree} 个下游节点，点击溯源完整链路`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onTraceNode(nodeKey);
          }}
        >
          {outDegree} →
        </button>
      )}
    </div>
  );
});
