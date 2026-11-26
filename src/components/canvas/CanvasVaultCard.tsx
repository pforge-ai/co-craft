import React from 'react';
import {
  AudioLines,
  Box,
  Clapperboard,
  Eye,
  EyeOff,
  Film,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Layers,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { mediaUrl } from '../../composition/Film';
import { getPreset } from '../../core/presets';
import { clone, instantiateCompoundVaultItemOperations } from '../../core/project';
import {
  DEFAULT_SPATIAL_BOOKMARKS,
  SPATIAL_ACTOR_ACTION_OPTIONS,
  SPATIAL_ACTOR_PATH_OPTIONS,
  SPATIAL_ENVIRONMENT_OPTIONS,
  SPATIAL_RENDER_PASS_OPTIONS,
} from '../../core/spatialStage';
import { scriptOutlineToShotOperations } from '../../core/storyboard';
import { ROLE_LABELS, inferAssetRole } from '../../core/taxonomy';
import type { EditOperation, Project, Sequence, VaultItem } from '../../core/types';
import { formatCanvasDisplayName } from '../../lib/canvasLayout';
import type { CanvasPt as Pt, PortSide } from '../CanvasWiresLayer';
import { PresetPreview } from '../PresetControls';
import type { SpatialDirectorTarget } from '../SpatialDirectorStudio';
import { GENERATOR_ACTION_META, SLOT_LABELS } from './CanvasGeneratorNode';
import type { CanvasGenerationOptions } from './types';

export interface CanvasVaultCardProps {
  ent: VaultItem;
  nodeKey: string;
  pos: Pt;
  selected: boolean;
  isPrimarySelected: boolean;
  isWireTarget: boolean;
  isDimmed: boolean;
  deg?: { inCount: number; outCount: number };
  project: Project;
  sequence: Sequence;
  previewOrigin: string;
  upstreamEntities: VaultItem[];
  activeVariantId?: string;
  textDraft?: string;
  rigExplodeDraft?: number;
  voicePopoverOpen: boolean;
  rigPopoverOpen: boolean;
  onHoverChange: (hovered: boolean) => void;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onClick: (e: React.MouseEvent) => void;
  onStartWireDrag: (e: React.PointerEvent<HTMLElement>, side: PortSide) => void;
  onToggleTrace: () => void;
  onSelectVariant: (variantId: string) => void;
  onTextDraftChange: (val: string) => void;
  onTextDraftClear: (expectedVal?: string) => void;
  onRigExplodeDraftChange: (val: number | undefined) => void;
  onToggleVoicePopover: () => void;
  onToggleRigPopover: () => void;
  onOpenNewVariant: () => void;
  onOpenQuickLook: () => void;
  onHideFromCanvas: () => void;
  onSelectClip: (clipId: string | null) => void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
  onOpenGeneration: (opts: CanvasGenerationOptions) => void;
  onPublishToLibrary: (payload: { itemId: string }) => Promise<void>;
  onInstantiateWorkshopRecipe: (ent: VaultItem, pos: Pt) => Promise<void>;
  onAppendShotFromEnt: (ent: VaultItem) => Promise<void>;
  onBakeSpatialToAiVideo: (nodeKey: string, placement: Pt) => Promise<void>;
  onCaptureSpatialPairToAiVideo: (nodeKey: string, placement: Pt) => Promise<void>;
  onSpawnSpatialMultiCamShots: (nodeKey: string) => Promise<void>;
  onOpenSpatialDirector?: (target: SpatialDirectorTarget) => void;
}

export function CanvasVaultCard({
  ent,
  nodeKey,
  pos,
  selected,
  isPrimarySelected,
  isWireTarget,
  isDimmed,
  deg,
  project,
  sequence,
  previewOrigin,
  upstreamEntities,
  activeVariantId,
  textDraft,
  rigExplodeDraft,
  voicePopoverOpen,
  rigPopoverOpen,
  onHoverChange,
  onPointerDown,
  onClick,
  onStartWireDrag,
  onToggleTrace,
  onSelectVariant,
  onTextDraftChange,
  onTextDraftClear,
  onRigExplodeDraftChange,
  onToggleVoicePopover,
  onToggleRigPopover,
  onOpenNewVariant,
  onOpenQuickLook,
  onHideFromCanvas,
  onSelectClip,
  onEdit,
  onOpenGeneration,
  onPublishToLibrary,
  onInstantiateWorkshopRecipe,
  onAppendShotFromEnt,
  onBakeSpatialToAiVideo,
  onCaptureSpatialPairToAiVideo,
  onSpawnSpatialMultiCamShots,
  onOpenSpatialDirector,
}: CanvasVaultCardProps) {
  const isTextNote = ent.entityKind === 'text';
  const isCompound = ent.entityKind === 'compound';
  const isRecipe = ent.subkind === 'recipe' && Boolean(ent.recipe?.workshop);
  const variants = ent.variants || [];
  const activeVar =
    variants.find((v) => v.id === (activeVariantId || ent.defaultVariantId)) || variants[0];
  const refAssetId = activeVar?.assetId || ent.assetId;
  const refAsset = refAssetId ? project.assets.find((a) => a.id === refAssetId) : undefined;
  const hasRig = Boolean(ent.rig?.presetId && getPreset(ent.rig.presetId));

  return (
    <div
      data-node-id={nodeKey}
      className={`cc-node upstream ${isTextNote ? 'text-note' : ''} ${isCompound ? 'compound' : ''} ${selected ? 'selected' : ''} ${isWireTarget ? 'wire-target' : ''} ${isDimmed ? 'trace-dimmed' : ''}`}
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
          {isTextNote ? (
            <>
              <button
                type="button"
                onClick={async () => {
                  const rawContent = textDraft ?? ent.textContent ?? '';
                  const content = rawContent.trim();
                  if (!content) return;
                  const dirty = rawContent !== (ent.textContent || '');
                  const saveOp: EditOperation[] = dirty
                    ? [
                        {
                          type: 'putVaultItem',
                          item: {
                            ...clone(ent),
                            textContent: rawContent,
                            version: ent.version + 1,
                            updatedAt: new Date().toISOString(),
                          },
                        },
                      ]
                    : [];
                  const ops = scriptOutlineToShotOperations(
                    sequence,
                    content,
                    {
                      entityId: ent.id,
                      version: ent.version + (dirty ? 1 : 0),
                    },
                    upstreamEntities,
                  );
                  if (ops.length) await onEdit(`从「${ent.name}」拆解分镜`, [...saveOp, ...ops]);
                }}
              >
                <Clapperboard size={12} /> 拆为分镜序列
              </button>
              <button
                type="button"
                onClick={() =>
                  onOpenGeneration({ use: 'image', prompt: textDraft ?? ent.textContent ?? ent.name })
                }
              >
                <Sparkles size={12} /> AI 生图
              </button>
              <button
                type="button"
                onClick={() =>
                  onOpenGeneration({ use: 'speech', prompt: textDraft ?? ent.textContent ?? ent.name })
                }
              >
                <AudioLines size={12} /> AI 配音
              </button>
            </>
          ) : isRecipe ? (
            <>
              <button
                type="button"
                title="按此配方一键生成可运行工坊卡（若同时选中新角色/视频/音频则自动接入对应槽位）"
                onClick={() => void onInstantiateWorkshopRecipe(ent, pos)}
              >
                <Sparkles size={12} /> 套用配方
              </button>
              <button
                type="button"
                title="发布配方至跨项目个人库"
                onClick={() => void onPublishToLibrary({ itemId: ent.id })}
              >
                ↑个人库
              </button>
            </>
          ) : isCompound ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const tail = sequence.clips.length
                    ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
                    : 0;
                  const { operations, primaryClipId } = instantiateCompoundVaultItemOperations(
                    sequence.id,
                    ent,
                    tail,
                    sequence.fps,
                  );
                  if (operations.length) {
                    void onEdit(`置入复合资产「${ent.name}」`, operations).then(() => {
                      if (primaryClipId) onSelectClip(primaryClipId);
                    });
                  }
                }}
              >
                <Plus size={12} /> 放入时间线
              </button>
              <button
                type="button"
                title="发布至跨项目个人库"
                onClick={() => void onPublishToLibrary({ itemId: ent.id })}
              >
                ↑个人库
              </button>
            </>
          ) : (
            <>
              {ent.rig?.presetId === 'spatial-stage' || ent.rig?.presetId === 'teardown-3d' ? (
                <>
                  {onOpenSpatialDirector && (
                    <button
                      type="button"
                      className="cc-tb-primary"
                      title="进入独立全屏「3D 导演棚」自由鼠标运镜、调灯光走线与出片"
                      onClick={() => onOpenSpatialDirector({ kind: 'vault', vaultItemId: ent.id })}
                    >
                      <Box size={12} /> 导演棚
                    </button>
                  )}
                  <button
                    type="button"
                    title="把当前 3D 摄像机运镜、人物动作、走线与环境直接录成真实 MP4 预演视频，并自动连入动作迁移/参考生视频工坊"
                    onClick={() => void onBakeSpatialToAiVideo(nodeKey, { x: pos.x + 306, y: pos.y })}
                  >
                    <Clapperboard size={12} /> 录视频→AI生片
                  </button>
                  <button
                    type="button"
                    title="从当前 3D 空间自动拍下 A机(首帧) 与 B机(尾帧)，直接连入首尾帧生视频工坊"
                    onClick={() =>
                      void onCaptureSpatialPairToAiVideo(nodeKey, { x: pos.x + 306, y: pos.y })
                    }
                  >
                    <Box size={12} /> A→B首尾帧
                  </button>
                  <button
                    type="button"
                    title="用当前同一套 3D 布景一键派生 A主镜 + B过肩反打 + C低仰拍 三镜连续分镜组"
                    onClick={() => void onSpawnSpatialMultiCamShots(nodeKey)}
                  >
                    <Film size={12} /> 派生3机位
                  </button>
                  <button type="button" onClick={onToggleRigPopover}>
                    <SlidersHorizontal size={12} /> 导演参数
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenGeneration({
                        use: 'image',
                        prompt: `${ent.name}，${activeVar?.promptDelta || ent.promptAnchor || ''}`,
                        referenceAssetId: refAsset?.kind === 'image' ? refAsset.id : undefined,
                      })
                    }
                  >
                    <Sparkles size={12} /> AI 生成设定图
                  </button>
                  {hasRig ? (
                    <button type="button" onClick={onToggleRigPopover}>
                      <SlidersHorizontal size={12} /> 参数
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={onOpenNewVariant}>
                        <GitBranch size={12} /> +状态
                      </button>
                      <button
                        type="button"
                        title="为演员/角色绑定专属配音音色（剧本写「角色名：台词」时自动沿用）"
                        onClick={onToggleVoicePopover}
                      >
                        <AudioLines size={12} /> {ent.voiceProfile?.voice || ent.voiceId ? '声纹✓' : '声纹'}
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => void onAppendShotFromEnt(ent)}>
                    <Plus size={12} /> 派生镜头
                  </button>
                </>
              )}
              <button
                type="button"
                title="发布至跨项目个人库"
                onClick={() => void onPublishToLibrary({ itemId: ent.id })}
              >
                ↑个人库
              </button>
            </>
          )}
          <button
            type="button"
            title="快速大图预览 (Space)"
            aria-label={`预览 ${ent.name}`}
            onClick={onOpenQuickLook}
          >
            <Eye size={11} />
          </button>
          <button
            type="button"
            title="移出画布（保留工程资产）"
            aria-label={`将 ${ent.name} 移出画布`}
            onClick={onHideFromCanvas}
          >
            <EyeOff size={11} />
          </button>
          <button
            type="button"
            title="移除节点"
            onClick={() => void onEdit(`删除「${ent.name}」`, [{ type: 'removeVaultItem', itemId: ent.id }])}
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}

      <button
        type="button"
        className="cc-port in"
        title="拖出或接收连线"
        aria-label={`${ent.name} 左侧连线端口`}
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
        {isTextNote ? (
          <FileText size={11} />
        ) : isCompound ? (
          <Layers size={11} />
        ) : hasRig ? (
          <Box size={11} />
        ) : (
          <ImageIcon size={11} />
        )}
        <span>
          {isTextNote
            ? ent.name
            : isRecipe
              ? `配方 · ${ent.name}`
              : isCompound
                ? `精剪 · ${formatCanvasDisplayName(ent.name, true)}`
                : `${ROLE_LABELS[inferAssetRole(ent)]} · ${formatCanvasDisplayName(ent.name)}`}
        </span>
        <small>
          {isCompound && ent.compound
            ? `${(ent.compound.durationFrames / ent.compound.fps).toFixed(1)}s`
            : ent.voiceProfile?.voice || ent.voiceId
              ? `${ent.voiceProfile?.voice || ent.voiceId} · v${ent.version}`
              : `v${ent.version}`}
        </small>
      </div>

      <div className="cc-node-card">
        {isTextNote ? (
          <textarea
            className="cc-text-node-body"
            rows={4}
            aria-label="画布文本内容"
            placeholder="输入分镜脚本（每行一镜）、创意构思或提示词…"
            value={textDraft ?? ent.textContent ?? ''}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => onTextDraftChange(e.currentTarget.value)}
            onBlur={(e) => {
              const val = e.currentTarget.value;
              if (val === (ent.textContent || '')) {
                onTextDraftClear();
                return;
              }
              void onEdit(`更新文本「${ent.name}」`, [
                {
                  type: 'putVaultItem',
                  item: {
                    ...clone(ent),
                    textContent: val,
                    version: ent.version + 1,
                    updatedAt: new Date().toISOString(),
                  },
                },
              ]).finally(() => {
                onTextDraftClear(val);
              });
            }}
          />
        ) : isRecipe && ent.recipe?.workshop ? (
          <div className="cc-recipe-body">
            <div className="cc-recipe-slots">
              {ent.recipe.workshop.inputSlots.map((slot, sIdx) => (
                <span key={`${slot}-${sIdx}`} className="cc-recipe-slot-pill">
                  {SLOT_LABELS[slot] || slot}
                </span>
              ))}
              <span className="cc-recipe-slot-pill">
                → {(GENERATOR_ACTION_META[ent.recipe.workshop.action] || GENERATOR_ACTION_META['text-to-image']).label}
              </span>
            </div>
            {ent.recipe.workshop.prompt && <p className="cc-recipe-prompt">{ent.recipe.workshop.prompt}</p>}
          </div>
        ) : (
          <>
            <div
              className="cc-node-visual"
              onDoubleClick={(e) => {
                e.stopPropagation();
                onOpenQuickLook();
              }}
            >
              {hasRig ? (
                <PresetPreview
                  presetId={ent.rig!.presetId!}
                  values={{
                    ...(ent.rig!.props || {}),
                    ...(rigExplodeDraft !== undefined ? { explode: rigExplodeDraft } : {}),
                  }}
                  project={project}
                  mediaOrigin={previewOrigin}
                  playing={isPrimarySelected}
                  thumbnail={!isPrimarySelected && rigExplodeDraft === undefined}
                />
              ) : refAsset && !refAsset.offline && refAsset.thumbnail ? (
                <img src={mediaUrl(previewOrigin, refAsset.id, true)} alt={ent.name} draggable={false} />
              ) : isCompound ? (
                <div className="cc-compound-placeholder">
                  <Layers size={18} />
                  <small>{ent.compound?.clips.length || 0} 层精剪组合</small>
                </div>
              ) : (
                <div className="cc-anchor-text">
                  <p>{activeVar?.promptDelta || ent.promptAnchor || ent.description}</p>
                </div>
              )}
            </div>

            {variants.length > 0 && (
              <div className="cc-node-variants">
                {variants.map((vr) => (
                  <button
                    key={vr.id}
                    type="button"
                    className={vr.id === activeVar?.id ? 'active' : ''}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectVariant(vr.id);
                    }}
                  >
                    {vr.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        className="cc-port out"
        title="拖出连线至任意节点或空白画布派生"
        aria-label={`从 ${ent.name} 拖线`}
        onPointerDown={(e) => onStartWireDrag(e, 'right')}
      />
      {deg && deg.outCount > 0 && (
        <button
          type="button"
          className="cc-port-badge out"
          title={`已连向 ${deg.outCount} 个下游节点，点击溯源完整链路`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleTrace();
          }}
        >
          {deg.outCount} →
        </button>
      )}

      {voicePopoverOpen && !isTextNote && !isCompound && !hasRig && (
        <div
          className="cc-popover cc-rig-inspector"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="cc-card-head">
            <b>{ent.name} · 专属声纹</b>
            <button type="button" onClick={onToggleVoicePopover} aria-label="关闭声纹设置">
              <X size={12} />
            </button>
          </div>
          <label className="cc-mini-field">
            <span>音色 ID（如 Cherry / Ethan / 沉稳男声）</span>
            <input
              aria-label="演员专属音色"
              placeholder="例如：Cherry / Ethan / alloy"
              value={ent.voiceProfile?.voice ?? ent.voiceId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                void onEdit(`更新「${ent.name}」专属音色`, [
                  {
                    type: 'putVaultItem',
                    item: {
                      ...clone(ent),
                      voiceId: v || undefined,
                      voiceProfile: { ...(ent.voiceProfile || {}), voice: v || undefined },
                    },
                  },
                ]);
              }}
            />
          </label>
          <div className="cc-voice-presets">
            {['Cherry', 'Ethan', 'Chelsie', 'Serena', 'alloy'].map((presetVoice) => (
              <button
                key={presetVoice}
                type="button"
                className={`branch-fork-chip ${(ent.voiceProfile?.voice || ent.voiceId) === presetVoice ? 'active' : ''}`}
                onClick={() =>
                  void onEdit(`绑定「${ent.name}」音色 ${presetVoice}`, [
                    {
                      type: 'putVaultItem',
                      item: {
                        ...clone(ent),
                        voiceId: presetVoice,
                        voiceProfile: { ...(ent.voiceProfile || {}), voice: presetVoice },
                      },
                    },
                  ])
                }
              >
                {presetVoice}
              </button>
            ))}
          </div>
          <label className="cc-mini-field">
            <span>表演语气备注</span>
            <input
              aria-label="演员表演语气"
              placeholder="如：低沉克制、略带冷幽默"
              value={ent.voiceProfile?.styleNote ?? ''}
              onChange={(e) => {
                const note = e.target.value;
                void onEdit(`更新「${ent.name}」配音语气`, [
                  {
                    type: 'putVaultItem',
                    item: {
                      ...clone(ent),
                      voiceProfile: { ...(ent.voiceProfile || {}), styleNote: note || undefined },
                    },
                  },
                ]);
              }}
            />
          </label>
        </div>
      )}

      {rigPopoverOpen && ent.rig?.presetId && (
        <div className="cc-popover cc-rig-inspector" onClick={(e) => e.stopPropagation()}>
          <div className="cc-card-head">
            <b>{ent.name} · 参数</b>
            <button type="button" onClick={onToggleRigPopover}>
              <X size={12} />
            </button>
          </div>
          <label className="cc-mini-field">
            <span>主标题文案</span>
            <input
              value={String(ent.rig.props?.text || '')}
              onChange={(e) => {
                const nextProps = { ...(ent.rig?.props || {}), text: e.target.value };
                void onEdit('更新画布组件文案', [
                  {
                    type: 'putVaultItem',
                    item: { ...clone(ent), rig: { ...ent.rig!, props: nextProps } },
                  },
                ]);
              }}
            />
          </label>
          {(ent.rig.presetId === 'spatial-stage' || ent.rig.presetId === 'teardown-3d') && (() => {
            const activeSceneType = String(
              ent.rig.props?.sceneType ||
                (ent.rig.presetId === 'teardown-3d' ? 'turbine' : 'parallax-25d'),
            );
            const isPrevisMode = activeSceneType === 'previs-blocking';
            const isDeviceMode = activeSceneType === 'device-showcase';
            const isTeardownMode =
              activeSceneType === 'turbine' ||
              activeSceneType === 'chip-stack' ||
              activeSceneType === 'factory-flow';
            const updateSpatialProp = (label: string, patch: Record<string, unknown>) => {
              const nextProps = { ...(ent.rig?.props || {}), ...patch };
              void onEdit(label, [
                {
                  type: 'putVaultItem',
                  item: { ...clone(ent), rig: { ...ent.rig!, props: nextProps } },
                },
              ]);
            };
            return (
              <>
                <label className="cc-mini-field">
                  <span>置景模式</span>
                  <select
                    value={activeSceneType}
                    onChange={(e) => updateSpatialProp('切换空间摄影棚模式', { sceneType: e.target.value })}
                  >
                    <option value="parallax-25d">2.5D 立体漫剧/原画</option>
                    <option value="previs-blocking">3D 导演走线预演棚</option>
                    <option value="device-showcase">3D 硬件动态贴屏</option>
                    <option value="turbine">同轴光学镜组拆解</option>
                    <option value="chip-stack">AI 芯片叠层</option>
                    <option value="factory-flow">节点流水线沙盘</option>
                  </select>
                </label>
                {isPrevisMode && (
                  <>
                    <label className="cc-mini-field">
                      <span>3D 场景环境</span>
                      <select
                        value={String(ent.rig.props?.environmentPreset || 'rooftop-night')}
                        onChange={(e) =>
                          updateSpatialProp('切换 3D 场景环境', { environmentPreset: e.target.value })
                        }
                      >
                        {SPATIAL_ENVIRONMENT_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="cc-mini-field">
                      <span>人物动作表演</span>
                      <select
                        value={String(ent.rig.props?.actorAction || 'walk')}
                        onChange={(e) =>
                          updateSpatialProp('切换人物动作表演', { actorAction: e.target.value })
                        }
                      >
                        {SPATIAL_ACTOR_ACTION_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="cc-mini-field">
                      <span>人物走线路径</span>
                      <select
                        value={String(ent.rig.props?.actorPath || 'approach')}
                        onChange={(e) =>
                          updateSpatialProp('切换人物走线路径', { actorPath: e.target.value })
                        }
                      >
                        {SPATIAL_ACTOR_PATH_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {isDeviceMode && (
                  <label className="cc-mini-field">
                    <span>硬件样机形态</span>
                    <select
                      value={String(ent.rig.props?.deviceType || 'phone')}
                      onChange={(e) =>
                        updateSpatialProp('切换硬件样机形态', { deviceType: e.target.value })
                      }
                    >
                      <option value="phone">钛金属旗舰手机</option>
                      <option value="laptop">超薄专业笔记本</option>
                      <option value="cinema-display">悬浮电影级巨幕</option>
                    </select>
                  </label>
                )}
                <div className="cc-mini-field">
                  <span>多机位书签</span>
                  <div className="cc-spatial-pills">
                    {DEFAULT_SPATIAL_BOOKMARKS.map((bm) => (
                      <button
                        key={bm.id}
                        type="button"
                        className={String(ent.rig?.props?.activeBookmarkId || '') === bm.id ? 'active' : ''}
                        title={`${bm.label} (${bm.cameraLens}mm)`}
                        onClick={() =>
                          updateSpatialProp(`切换空间机位「${bm.label}」`, {
                            activeBookmarkId: bm.id,
                            cameraPreset: bm.cameraPreset,
                            cameraLens: bm.cameraLens,
                            cameraYaw: bm.cameraYaw,
                            cameraPitch: bm.cameraPitch,
                            cameraDistance: bm.cameraDistance,
                          })
                        }
                      >
                        {bm.shortKey}机
                      </button>
                    ))}
                  </div>
                </div>
                <div className="cc-mini-field">
                  <span>输出通道（成片 / AI 控图）</span>
                  <div className="cc-spatial-pills">
                    {SPATIAL_RENDER_PASS_OPTIONS.slice(0, 4).map((rp) => (
                      <button
                        key={rp.id}
                        type="button"
                        className={String(ent.rig?.props?.renderPass || 'beauty') === rp.id ? 'active' : ''}
                        onClick={() =>
                          updateSpatialProp(`切换空间通道「${rp.label}」`, { renderPass: rp.id })
                        }
                      >
                        {rp.short}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="cc-mini-field">
                  <span>导演运镜轨迹</span>
                  <select
                    value={String(ent.rig.props?.cameraPreset || 'dolly-in')}
                    onChange={(e) => updateSpatialProp('切换三维视角', { cameraPreset: e.target.value })}
                  >
                    <option value="dolly-in">平滑推镜 (Dolly In)</option>
                    <option value="dolly-zoom">希区柯克变焦 (Vertigo)</option>
                    <option value="orbit">环绕审视 (Orbit)</option>
                    <option value="pan-sweep">横摇巡视 (Pan Sweep)</option>
                    <option value="crane-up">摇臂升降 (Crane Up)</option>
                    <option value="hero-low">低机位仰视</option>
                    <option value="top-down">垂直俯瞰</option>
                    <option value="isometric">等轴测俯视</option>
                  </select>
                </label>
                <label className="cc-mini-field">
                  <span>3D 空间体积粒子</span>
                  <select
                    value={String(ent.rig.props?.particles3D || 'none')}
                    onChange={(e) => updateSpatialProp('切换三维氛围粒子', { particles3D: e.target.value })}
                  >
                    <option value="none">关闭</option>
                    <option value="dust">电影浮尘光粒</option>
                    <option value="rain">三维空间雨丝</option>
                    <option value="snow">立体飘雪</option>
                    <option value="embers">炽热火星</option>
                  </select>
                </label>
                {isTeardownMode && (
                  <label className="cc-mini-field">
                    <span>
                      拆解间距 ({Math.round(Number(rigExplodeDraft ?? ent.rig.props?.explode ?? 0.65) * 100)}%)
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1.3}
                      step={0.05}
                      value={Number(rigExplodeDraft ?? ent.rig.props?.explode ?? 0.65)}
                      onChange={(e) => onRigExplodeDraftChange(Number(e.target.value))}
                      onPointerUp={(e) => {
                        const val = Number(e.currentTarget.value);
                        onRigExplodeDraftChange(undefined);
                        if (val !== Number(ent.rig?.props?.explode ?? 0.65)) {
                          updateSpatialProp('调整三维拆解间距', { explode: val });
                        }
                      }}
                      onBlur={(e) => {
                        const val = Number(e.currentTarget.value);
                        if (rigExplodeDraft === undefined) return;
                        onRigExplodeDraftChange(undefined);
                        if (val !== Number(ent.rig?.props?.explode ?? 0.65)) {
                          updateSpatialProp('调整三维拆解间距', { explode: val });
                        }
                      }}
                    />
                  </label>
                )}
              </>
            );
          })()}
          {ent.rig.presetId === 'screen-focus-rig' && (
            <label className="cc-mini-field">
              <span>设备外壳样式</span>
              <select
                value={String(ent.rig.props?.frameStyle || 'macos')}
                onChange={(e) => {
                  const nextProps = { ...(ent.rig?.props || {}), frameStyle: e.target.value };
                  void onEdit('切换设备外壳', [
                    {
                      type: 'putVaultItem',
                      item: { ...clone(ent), rig: { ...ent.rig!, props: nextProps } },
                    },
                  ]);
                }}
              >
                <option value="macos">macOS 圆角窗</option>
                <option value="browser">极简浏览器框</option>
                <option value="phone">竖屏手机壳</option>
                <option value="terminal">暗色终端窗</option>
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
