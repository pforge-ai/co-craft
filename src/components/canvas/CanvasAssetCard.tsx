import React from 'react';
import {
  AudioLines,
  Box,
  Camera,
  Check,
  Clapperboard,
  Eye,
  EyeOff,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Layers,
  Plus,
  RotateCw,
  Scissors,
  Sparkles,
  Tag,
  Trash2,
  UserCheck,
  Wand2,
  X,
} from 'lucide-react';
import { mediaUrl } from '../../composition/Film';
import { inferDefaultAudioAttachMode, newClip, uid } from '../../core/project';
import type { SpatialSceneMode } from '../../core/spatialStage';
import type { CompositeShot } from '../../core/storyboard';
import { ROLE_LABELS } from '../../core/taxonomy';
import type {
  Asset,
  AssetRole,
  CanvasGeneratorAction,
  CanvasGeneratorInput,
  Clip,
  ClipTake,
  EditOperation,
  Sequence,
} from '../../core/types';
import { formatAssetCardMeta, formatCanvasDisplayName } from '../../lib/canvasLayout';
import { AudioWaveformPlayer } from '../AudioWaveformPlayer';
import type { CanvasPt as Pt, PortSide } from '../CanvasWiresLayer';
import type { SpatialDirectorTarget } from '../SpatialDirectorStudio';
import type { ForkSourceTarget } from './CanvasForkPopover';
import type { CanvasGenerationOptions } from './types';

export const QUICK_ASSET_ROLES: { id: AssetRole; label: string }[] = [
  { id: 'character', label: '角色' },
  { id: 'environment', label: '场景' },
  { id: 'product', label: '道具 / 主体' },
  { id: 'visual-style', label: '风格参考' },
];

export interface CanvasAssetCardProps {
  asset: Asset;
  nodeKey: string;
  pos: Pt;
  selected: boolean;
  isPrimarySelected: boolean;
  isWireTarget: boolean;
  isDimmed: boolean;
  justCompleted: boolean;
  deg?: { inCount: number; outCount: number };
  sequence: Sequence;
  shots: CompositeShot[];
  previewOrigin: string;
  deriveMenuOpen: boolean;
  roleMenuOpen: boolean;
  onHoverChange: (hovered: boolean) => void;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onClick: (e: React.MouseEvent) => void;
  onStartWireDrag: (e: React.PointerEvent<HTMLElement>, side: PortSide) => void;
  onToggleTrace: () => void;
  onToggleDeriveMenu: () => void;
  onToggleRoleMenu: () => void;
  onCloseRoleMenu: () => void;
  onOpenForkPopover: (source: ForkSourceTarget) => void;
  onUpgradeToSubject: (asset: Asset) => void;
  onOpenQuickLook: () => void;
  onHideFromCanvas: () => void;
  onDeleteFromProject: () => void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
  onOpenGeneration: (opts: CanvasGenerationOptions) => void;
  onPublishToLibrary: (payload: { assetId: string }) => Promise<void>;
  onSpawnGeneratorNode: (opts: {
    use: 'image' | 'video' | 'speech';
    action: CanvasGeneratorAction;
    inputs: CanvasGeneratorInput[];
    prompt?: string;
    placement: Pt;
  }) => Promise<void>;
  onCreateSpatialStageFromAssets: (
    assetIds: string[],
    sceneType: SpatialSceneMode,
    placement: Pt,
  ) => Promise<void>;
  onTrimAudioSilence?: (assetId: string, placement?: Pt) => Promise<void>;
  onNormalizeAudio?: (assetId: string, placement?: Pt) => Promise<void>;
  onExtractVideoFrame?: (assetId: string, mode: 'first' | 'last', placement?: Pt) => Promise<Asset | undefined>;
  onDetachVideoAudio?: (assetId: string, placement?: Pt) => Promise<void>;
  onVisionDescribeAsset?: (assetId: string, placement?: Pt) => Promise<void>;
  onOpenSpatialDirector?: (target: SpatialDirectorTarget) => void;
}

export function CanvasAssetCard({
  asset: a,
  nodeKey,
  pos,
  selected,
  isPrimarySelected,
  isWireTarget,
  isDimmed,
  justCompleted,
  deg,
  sequence,
  shots,
  previewOrigin,
  deriveMenuOpen,
  roleMenuOpen,
  onHoverChange,
  onPointerDown,
  onClick,
  onStartWireDrag,
  onToggleTrace,
  onToggleDeriveMenu,
  onToggleRoleMenu,
  onCloseRoleMenu,
  onOpenForkPopover,
  onUpgradeToSubject,
  onOpenQuickLook,
  onHideFromCanvas,
  onDeleteFromProject,
  onEdit,
  onOpenGeneration,
  onPublishToLibrary,
  onSpawnGeneratorNode,
  onCreateSpatialStageFromAssets,
  onTrimAudioSilence,
  onNormalizeAudio,
  onExtractVideoFrame,
  onDetachVideoAudio,
  onVisionDescribeAsset,
  onOpenSpatialDirector,
}: CanvasAssetCardProps) {
  const isAudio = a.kind === 'audio';
  const isVideo = a.kind === 'video';
  const explicitRole = a.role;
  const hasAiSource = Boolean(a.source && (a.source.prompt || a.source.modelId));
  const kindLabel = isAudio ? '音频' : isVideo ? '视频' : a.kind === 'model-3d' ? '三维模型' : '图片';
  const tail = sequence.clips.length ? Math.max(...sequence.clips.map((c) => c.start + c.duration)) : 0;

  return (
    <div
      data-node-id={nodeKey}
      className={`cc-node asset ${a.kind} ${selected ? 'selected' : ''} ${isWireTarget ? 'wire-target' : ''} ${isDimmed ? 'trace-dimmed' : ''}`}
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
          {isAudio ? (
            <>
              {onTrimAudioSilence && (
                <button
                  type="button"
                  title="本地 FFmpeg 0 费用自动裁去口播停顿气口静音，生成紧凑版音频卡"
                  onClick={() => void onTrimAudioSilence(a.id, { x: pos.x + 300, y: pos.y })}
                >
                  <Scissors size={11} /> 去静音
                </button>
              )}
              {onNormalizeAudio && (
                <button
                  type="button"
                  title="本地 FFmpeg 0 费用人声响度标准化至广播级 -14 LUFS"
                  onClick={() => void onNormalizeAudio(a.id, { x: pos.x + 300, y: pos.y + 108 })}
                >
                  <AudioLines size={11} /> -14 LUFS
                </button>
              )}
              <button type="button" onClick={() => onOpenGeneration({ use: 'transcription', assetId: a.id })}>
                <FileText size={11} /> 转录字幕
              </button>
              <button type="button" onClick={() => onOpenGeneration({ use: 'speech', prompt: a.name })}>
                <Sparkles size={11} /> AI 配音
              </button>
              <button
                type="button"
                onClick={() => {
                  const audioEnd = sequence.clips
                    .filter((c) => c.track === 'audio')
                    .reduce((m, c) => Math.max(m, c.start + c.duration), 0);
                  const dur = Math.max(1, Math.floor(a.duration * sequence.fps));
                  const c: Clip = {
                    ...newClip('audio', audioEnd, a.id),
                    name: a.name,
                    duration: dur,
                    audioAttachMode: inferDefaultAudioAttachMode(a, dur, sequence.fps),
                  };
                  void onEdit(`铺入音频「${a.name}」`, [
                    { type: 'addClip', sequenceId: sequence.id, clip: c },
                  ]);
                }}
              >
                <Plus size={11} /> 铺入音轨
              </button>
            </>
          ) : isVideo ? (
            <>
              {onExtractVideoFrame && (
                <button
                  type="button"
                  title="秒抽视频末帧为新图片卡落回画布（可直接拖线作下一镜首帧）"
                  onClick={() => void onExtractVideoFrame(a.id, 'last', { x: pos.x + 300, y: pos.y })}
                >
                  <Camera size={11} /> 抽尾帧
                </button>
              )}
              {onExtractVideoFrame && (
                <button
                  type="button"
                  title="秒抽视频首帧为新图片卡落回画布"
                  onClick={() => void onExtractVideoFrame(a.id, 'first', { x: pos.x + 300, y: pos.y + 186 })}
                >
                  <ImageIcon size={11} /> 抽首帧
                </button>
              )}
              {onDetachVideoAudio && (
                <button
                  type="button"
                  title="用 FFmpeg 秒提取视频音轨为独立波形资产卡"
                  onClick={() => void onDetachVideoAudio(a.id, { x: pos.x + 300, y: pos.y + 186 })}
                >
                  <AudioLines size={11} /> 抽音轨
                </button>
              )}
              {onVisionDescribeAsset && (
                <button
                  type="button"
                  title="用视觉模型反推画面提示词并落为可编辑文本节点"
                  onClick={() => void onVisionDescribeAsset(a.id, { x: pos.x + 300, y: pos.y - 160 })}
                >
                  <Wand2 size={11} /> 反推提示词
                </button>
              )}
              <button type="button" onClick={() => onOpenGeneration({ use: 'transcription', assetId: a.id })}>
                <FileText size={11} /> 转录
              </button>
              <button
                type="button"
                onClick={() => {
                  const c: Clip = {
                    ...newClip('video', tail, a.id),
                    name: a.name,
                    duration: Math.max(15, Math.floor((a.duration || 5) * sequence.fps)),
                  };
                  void onEdit(`加入分镜「${a.name}」`, [
                    { type: 'addClip', sequenceId: sequence.id, clip: c },
                  ]);
                }}
              >
                <Plus size={11} /> 入选镜头
              </button>
            </>
          ) : (
            <>
              {a.kind === 'image' && (
                <button
                  type="button"
                  title="在右侧原地展开 AI 加工转换工坊卡（改图 / 视频 / 三视图 / 抠图）"
                  onClick={onToggleDeriveMenu}
                >
                  <Sparkles size={11} /> 衍生 ▾
                </button>
              )}
              {a.kind === 'image' && onVisionDescribeAsset && (
                <button
                  type="button"
                  title="用视觉模型反推该图提示词，在右侧生成可编辑文本节点（可直接拖线给工坊卡改图）"
                  onClick={() => void onVisionDescribeAsset(a.id, { x: pos.x + 306, y: pos.y })}
                >
                  <Wand2 size={11} /> 反推提示词
                </button>
              )}
              {a.kind === 'image' && hasAiSource && (
                <button
                  type="button"
                  title="还原该图原始提示词、模型与上游参考图，在画布原地微调再抽一次"
                  onClick={() => {
                    const srcRefIds = Array.isArray(a.source?.referenceAssetIds)
                      ? (a.source?.referenceAssetIds as string[])
                      : typeof a.source?.referenceAssetId === 'string'
                        ? [a.source.referenceAssetId]
                        : [];
                    const inputs: CanvasGeneratorInput[] =
                      srcRefIds.length > 0
                        ? srcRefIds.map((rid) => ({ nodeKey: `asset:${rid}`, slot: 'subject' }))
                        : [{ nodeKey, slot: 'subject' }];
                    void onSpawnGeneratorNode({
                      use: 'image',
                      action: srcRefIds.length >= 2 ? 'multi-ref-image' : 'image-edit',
                      inputs,
                      prompt: String(a.source?.prompt || ''),
                      placement: { x: pos.x + 306, y: pos.y },
                    });
                  }}
                >
                  <RotateCw size={11} /> 再抽
                </button>
              )}
              {a.kind === 'image' && (
                <button
                  type="button"
                  title="在右侧一键并排派生 2–3 组不同景别/光影的变体做比稿"
                  onClick={() =>
                    onOpenForkPopover({
                      label: formatCanvasDisplayName(a.name, true),
                      basePrompt: String(a.source?.prompt || a.name.replace(/\.[^.]+$/, '')),
                      refAssetIds: [a.id],
                      sourceNodeKeys: [nodeKey],
                      anchorPos: pos,
                    })
                  }
                >
                  <GitBranch size={11} /> 变体
                </button>
              )}
              {(a.kind === 'image' || a.kind === 'video') &&
                (() => {
                  const parentShotRef = a.derivedFrom?.find((d) => d.vaultItemId?.startsWith('shot:'));
                  const targetShot = parentShotRef
                    ? shots.find((s) => `shot:${s.id}` === parentShotRef.vaultItemId && !s.locked)
                    : undefined;
                  if (!targetShot) return null;
                  return (
                    <button
                      type="button"
                      title={`将此变体直接采纳为镜头 #${targetShot.index} 的当前激活候选画面`}
                      onClick={() => {
                        const nextNum = (targetShot.anchorClip.takes?.length || 1) + 1;
                        const take: ClipTake = {
                          id: uid('take'),
                          label: `T${nextNum} · ${formatCanvasDisplayName(a.name, true).slice(0, 14)}`,
                          kind: a.kind === 'video' ? 'video' : 'image',
                          sourceIn: 0,
                          assetId: a.id,
                          props: { fit: 'cover', opacity: 1, scale: 1 },
                          createdAt: new Date().toISOString(),
                        };
                        void onEdit(`采纳「${a.name}」至镜头 #${targetShot.index}`, [
                          {
                            type: 'addClipTake',
                            sequenceId: sequence.id,
                            clipId: targetShot.anchorClip.id,
                            take,
                            activate: true,
                          },
                        ]);
                      }}
                    >
                      <Check size={11} /> 采纳至镜头 #{targetShot.index}
                    </button>
                  );
                })()}
              {a.kind === 'image' && (
                <button
                  type="button"
                  title="就地标记创作角色（角色 / 场景 / 道具 / 风格），自动归入设定分区与连线槽位"
                  onClick={onToggleRoleMenu}
                >
                  <Tag size={11} /> {explicitRole ? ROLE_LABELS[explicitRole].slice(0, 2) : '标角色'} ▾
                </button>
              )}
              {a.kind === 'model-3d' && onOpenSpatialDirector && (
                <button
                  type="button"
                  className="cc-tb-primary"
                  title="进入独立全屏「3D 导演棚」预览此 3D 模型/空间世界并运镜录片"
                  onClick={() => onOpenSpatialDirector({ kind: 'asset', assetId: a.id })}
                >
                  <Box size={11} /> 导演棚
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const c: Clip = {
                    ...newClip(a.kind === 'model-3d' ? 'shape' : a.kind, tail, a.id),
                    name: a.name,
                    duration: Math.max(
                      15,
                      Math.floor((a.kind === 'image' ? 5 : a.duration) * sequence.fps),
                    ),
                  };
                  void onEdit(`加入分镜「${a.name}」`, [
                    { type: 'addClip', sequenceId: sequence.id, clip: c },
                  ]);
                }}
              >
                <Plus size={11} /> 入选镜头
              </button>
            </>
          )}
          <button
            type="button"
            title="快速大图预览 / 播放 (Space)"
            aria-label={`预览 ${a.name}`}
            onClick={onOpenQuickLook}
          >
            <Eye size={11} />
          </button>
          <button
            type="button"
            title="发布至跨项目个人库"
            onClick={() => void onPublishToLibrary({ assetId: a.id })}
          >
            ↑个人库
          </button>
          <button
            type="button"
            title="移出画布（不删除工程文件，随时可恢复）"
            aria-label={`将 ${a.name} 移出画布`}
            onClick={onHideFromCanvas}
          >
            <EyeOff size={11} />
          </button>
          <button
            type="button"
            title="从工程删除素材（支持 ⌘Z 撤销；已锁定镜头受保护）"
            aria-label={`删除素材 ${a.name}`}
            onClick={onDeleteFromProject}
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}

      {deriveMenuOpen && (
        <div
          className="cc-popover cc-tap-menu cc-inline-subpop"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="cc-menu-group">资产 → 新资产原地加工</div>
          <button
            type="button"
            onClick={() =>
              void onSpawnGeneratorNode({
                use: 'image',
                action: 'image-edit',
                inputs: [
                  {
                    nodeKey,
                    slot:
                      explicitRole === 'environment'
                        ? 'scene'
                        : explicitRole === 'visual-style'
                          ? 'style'
                          : 'subject',
                  },
                ],
                placement: { x: pos.x + 306, y: pos.y },
              })
            }
          >
            <span className="cc-menu-item-label">
              <Wand2 size={12} /> 指令改图 / 风格延展
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              void onSpawnGeneratorNode({
                use: 'video',
                action: 'image-to-video',
                inputs: [{ nodeKey, slot: 'first-frame' }],
                placement: { x: pos.x + 306, y: pos.y },
              })
            }
          >
            <span className="cc-menu-item-label">
              <Clapperboard size={12} /> 图生视频（作首帧）
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              void onSpawnGeneratorNode({
                use: 'image',
                action: 'turnaround',
                inputs: [{ nodeKey, slot: 'subject' }],
                placement: { x: pos.x + 306, y: pos.y },
              })
            }
          >
            <span className="cc-menu-item-label">
              <UserCheck size={12} /> 角色 / 主体三视图
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              void onSpawnGeneratorNode({
                use: 'image',
                action: 'cutout',
                inputs: [{ nodeKey, slot: 'subject' }],
                placement: { x: pos.x + 306, y: pos.y },
              })
            }
          >
            <span className="cc-menu-item-label">
              <Sparkles size={12} /> 透明底智能抠图
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              void onSpawnGeneratorNode({
                use: 'image',
                action: 'multi-ref-image',
                inputs: [{ nodeKey, slot: 'subject' }],
                placement: { x: pos.x + 306, y: pos.y },
              })
            }
          >
            <span className="cc-menu-item-label">
              <Layers size={12} /> 多图融合工坊卡
            </span>
          </button>
          <div className="cc-menu-divider" />
          <div className="cc-menu-group">空间摄影棚（L1 零视频费）</div>
          <button
            type="button"
            onClick={() =>
              void onCreateSpatialStageFromAssets([a.id], 'parallax-25d', { x: pos.x + 306, y: pos.y })
            }
          >
            <span className="cc-menu-item-label">
              <Box size={12} /> 立为 2.5D 立体空间镜（¥0）
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              void onCreateSpatialStageFromAssets([a.id], 'device-showcase', {
                x: pos.x + 306,
                y: pos.y + 42,
              })
            }
          >
            <span className="cc-menu-item-label">
              <Box size={12} /> 贴屏至 3D 硬件样机（¥0）
            </span>
          </button>
        </div>
      )}

      {roleMenuOpen && (
        <div
          className="cc-popover cc-tap-menu cc-inline-subpop"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="cc-menu-group">标记资产创作角色</div>
          {QUICK_ASSET_ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                onCloseRoleMenu();
                void onEdit(`标记「${a.name}」为${r.label}`, [
                  { type: 'updateAssetMeta', assetId: a.id, changes: { role: r.id } },
                ]);
              }}
            >
              <span className="cc-menu-item-label">
                <Tag size={11} /> {r.label}
              </span>
              {explicitRole === r.id && <Check size={11} />}
            </button>
          ))}
          {explicitRole && (
            <button
              type="button"
              onClick={() => {
                onCloseRoleMenu();
                void onEdit(`清除「${a.name}」角色标记`, [
                  { type: 'updateAssetMeta', assetId: a.id, changes: { role: null } },
                ]);
              }}
            >
              <span className="cc-menu-item-label">
                <X size={11} /> 取消角色标记
              </span>
            </button>
          )}
          <div className="cc-menu-divider" />
          <button
            type="button"
            onClick={() => {
              onCloseRoleMenu();
              onUpgradeToSubject(a);
            }}
          >
            <span className="cc-menu-item-label">
              <GitBranch size={11} /> 升级为多状态设定集…
            </span>
          </button>
        </div>
      )}

      <button
        type="button"
        className="cc-port in"
        title="拖出或接收参考连线"
        aria-label={`${a.name} 左侧连线端口`}
        onPointerDown={(e) => onStartWireDrag(e, 'left')}
      />
      {deg && deg.inCount > 0 && (
        <button
          type="button"
          className="cc-port-badge in"
          title={`有 ${deg.inCount} 个上游关联，点击溯源完整链路`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleTrace();
          }}
        >
          ← {deg.inCount}
        </button>
      )}

      <div className="cc-node-header">
        {isAudio ? <AudioLines size={11} /> : a.kind === 'model-3d' ? <Box size={11} /> : <ImageIcon size={11} />}
        <span title={a.name}>
          {kindLabel} · {formatCanvasDisplayName(a.name, true)}
        </span>
        {explicitRole && (
          <button
            type="button"
            className="cc-role-badge"
            title="点击修改资产创作角色"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleRoleMenu();
            }}
          >
            {ROLE_LABELS[explicitRole].slice(0, 2)}
          </button>
        )}
        <small>{formatAssetCardMeta(a)}</small>
      </div>

      <div
        className={`cc-node-card asset-card ${justCompleted ? 'cc-just-completed' : ''}`}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onOpenQuickLook();
        }}
      >
        {isAudio ? (
          <div className="cc-audio-card-body">
            <AudioWaveformPlayer
              id={a.id}
              name={a.name}
              url={mediaUrl(previewOrigin, a.id)}
              duration={a.duration}
              waveform={a.waveform}
            />
          </div>
        ) : a.thumbnail ? (
          <div className="cc-node-preview">
            <img src={mediaUrl(previewOrigin, a.id, true)} alt={a.name} draggable={false} />
            {a.qualityScore && (
              <span
                className={`cc-quality-badge ${a.qualityScore.recommended ? 'recommended' : a.qualityScore.issues?.length ? 'has-issue' : ''}`}
                title={
                  a.qualityScore.issues?.length
                    ? `${a.qualityScore.provider} 评分 ${a.qualityScore.score} · ${a.qualityScore.issues.join('、')}`
                    : `${a.qualityScore.provider} 评分 ${a.qualityScore.score}${a.qualityScore.recommended ? '（推荐最佳候选）' : ''}`
                }
              >
                {a.qualityScore.recommended ? `★ 推荐 ${a.qualityScore.score}` : `${a.qualityScore.score}`}
              </span>
            )}
          </div>
        ) : (
          <div className="cc-node-placeholder">
            {a.kind === 'model-3d' ? <Box size={22} /> : <ImageIcon size={22} />}
            <small>{kindLabel}资产</small>
          </div>
        )}
      </div>

      <button
        type="button"
        className="cc-port out"
        title="拖出连线建立参考关联或生成下游镜头"
        aria-label={`从 ${a.name} 拖线`}
        onPointerDown={(e) => onStartWireDrag(e, 'right')}
      />
      {deg && deg.outCount > 0 && (
        <button
          type="button"
          className="cc-port-badge out"
          title={`已关联 ${deg.outCount} 个下游节点，点击溯源完整链路`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleTrace();
          }}
        >
          {deg.outCount} →
        </button>
      )}
    </div>
  );
}
