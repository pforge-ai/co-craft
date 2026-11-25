import React from 'react';
import {
  AtSign,
  AudioLines,
  BookmarkPlus,
  Box,
  Clapperboard,
  EyeOff,
  Film,
  Group,
  Link2,
  Package,
  Sparkles,
  Star,
  Tag,
  X,
} from 'lucide-react';
import type {
  CanvasGeneratorAction,
  CanvasGeneratorInput,
  ChatContextRef,
  Clip,
} from '../../core/types';
import type { CompositeShot } from '../../core/storyboard';
import type { CanvasPt } from '../CanvasWiresLayer';
import type { CanvasMultiSelectionSummary } from './types';

interface CanvasMultiBarProps {
  selectedNodeIds: string[];
  visualSelection: CanvasMultiSelectionSummary;
  shots: readonly CompositeShot[];
  canAddToChat: boolean;
  canSaveClipsAsAsset: boolean;
  onCollectRefs: (keys: string[]) => ChatContextRef[];
  onAddRefsToChat?: (refs: ChatContextRef[], openDrawer?: boolean) => void;
  onSpawnGeneratorNode: (opts: {
    use: 'image' | 'video' | 'speech';
    action: CanvasGeneratorAction;
    inputs: CanvasGeneratorInput[];
    prompt?: string;
    placement: CanvasPt;
  }) => void;
  onBridgeTwoVideos?: (videoAId: string, videoBId: string, placement: CanvasPt) => void;
  onCombineVisualAudio?: (visualAssetId: string, audioAssetId: string) => void;
  onCreateSpatial25D?: (imageAssetIds: string[], placement: CanvasPt) => void;
  onTriageAssets?: (assetIds: string[]) => void;
  onAutoTagAssets?: (assetIds: string[]) => void;
  onCreateGroup: (keys: string[]) => void;
  onPackNodes: (keys: string[]) => void;
  onLinkNodes: (keys: string[]) => void;
  onAppendToTimeline: (keys: string[]) => void;
  onHideNodes: (keys: string[]) => void;
  onSaveClipsAsAsset?: (clips: Clip[]) => void;
  onClearSelection: () => void;
}

export const CanvasMultiBar = React.memo(function CanvasMultiBar({
  selectedNodeIds,
  visualSelection,
  shots,
  canAddToChat,
  canSaveClipsAsAsset,
  onCollectRefs,
  onAddRefsToChat,
  onSpawnGeneratorNode,
  onBridgeTwoVideos,
  onCombineVisualAudio,
  onCreateSpatial25D,
  onTriageAssets,
  onAutoTagAssets,
  onCreateGroup,
  onPackNodes,
  onLinkNodes,
  onAppendToTimeline,
  onHideNodes,
  onSaveClipsAsAsset,
  onClearSelection,
}: CanvasMultiBarProps) {
  if (selectedNodeIds.length < 2) return null;

  const {
    imageAssetIds,
    videoAssetIds,
    videoNodeKeys,
    audioAssetIds,
    audioNodeKeys,
    visualAssetIds,
    textNodeKeys,
    textSnippets,
    labels,
    sourceNodeKeys,
    anchorPlacement,
  } = visualSelection;
  const imgCount = imageAssetIds.length;
  const textInputs: CanvasGeneratorInput[] = textNodeKeys.map((k) => ({ nodeKey: k, slot: 'prompt-text' }));
  const textJoined = textSnippets.join('，').slice(0, 220);

  const canImgTextCombo = imgCount === 1 && textNodeKeys.length >= 1;
  const canFirstLastVideo = imgCount === 2;
  const canMultiRefImage = imgCount >= 2;
  const canMultiRefVideo = imgCount >= 3;
  const canMotionAnimate = imgCount === 1 && videoNodeKeys.length === 1;
  const canLipSync = imgCount === 1 && audioNodeKeys.length === 1;
  const canBridgeTwoVideos = videoAssetIds.length === 2 && Boolean(onBridgeTwoVideos);
  const canCombineVisualAudio =
    visualAssetIds.length === 1 && audioAssetIds.length === 1 && Boolean(onCombineVisualAudio);
  const allSelectedAssetIds = Array.from(new Set([...imageAssetIds, ...videoAssetIds, ...audioAssetIds]));
  const canSpatial25D = imgCount >= 2 && imgCount <= 4 && Boolean(onCreateSpatial25D);
  const canTriageImages = imgCount >= 2 && Boolean(onTriageAssets);
  const canAutoTag = allSelectedAssetIds.length >= 1 && Boolean(onAutoTagAssets);
  const hasAnyAiOrCombo =
    canImgTextCombo ||
    canFirstLastVideo ||
    canMultiRefImage ||
    canMotionAnimate ||
    canLipSync ||
    canBridgeTwoVideos ||
    canCombineVisualAudio ||
    canSpatial25D ||
    canTriageImages ||
    canAutoTag;
  const promptSummary = labels.slice(0, 4).join(' + ');

  return (
    <div
      className="cc-multi-bar"
      role="toolbar"
      aria-label="画布多选操作"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="cc-multi-count">已选 {selectedNodeIds.length} 项</span>
      <span className="cc-tb-sep" />

      {canImgTextCombo && (
        <>
          <button
            type="button"
            className="cc-multi-ai"
            title="将所选图片与脚本文本自动连入原位改图/生图工坊卡"
            onClick={() =>
              onSpawnGeneratorNode({
                use: 'image',
                action: 'image-edit',
                inputs: [{ nodeKey: sourceNodeKeys[0], slot: 'subject' }, ...textInputs],
                prompt: textJoined,
                placement: anchorPlacement,
              })
            }
          >
            <Sparkles size={11} /> 图+文生图卡
          </button>
          <button
            type="button"
            className="cc-multi-ai"
            title="将所选图片作首帧、脚本文本作运镜提示，原地建图生视频工坊卡"
            onClick={() =>
              onSpawnGeneratorNode({
                use: 'video',
                action: 'image-to-video',
                inputs: [{ nodeKey: sourceNodeKeys[0], slot: 'first-frame' }, ...textInputs],
                prompt: textJoined,
                placement: anchorPlacement,
              })
            }
          >
            <Clapperboard size={11} /> 图+文生视频
          </button>
        </>
      )}

      {canFirstLastVideo && (
        <button
          type="button"
          className="cc-multi-ai"
          title="在画布右侧原地创建首尾帧视频工坊卡（左图为首帧、右图为尾帧，支持一键互换）"
          onClick={() =>
            onSpawnGeneratorNode({
              use: 'video',
              action: 'first-last-video',
              inputs: [
                { nodeKey: sourceNodeKeys[0], slot: 'first-frame' },
                { nodeKey: sourceNodeKeys[1], slot: 'last-frame' },
                ...textInputs,
              ],
              prompt:
                textJoined ||
                `从「${labels[0]}」自然运镜过渡到「${labels[1]}」，电影级连贯镜头运动`,
              placement: anchorPlacement,
            })
          }
        >
          <Clapperboard size={11} /> 首尾帧生视频
        </button>
      )}

      {canMultiRefImage && (
        <button
          type="button"
          className="cc-multi-ai"
          title={`在画布右侧原地创建多图融合工坊卡，自动汇入 ${Math.min(imgCount, 6)} 张参考图${textNodeKeys.length ? `与 ${textNodeKeys.length} 份文本` : ''}`}
          onClick={() =>
            onSpawnGeneratorNode({
              use: 'image',
              action: 'multi-ref-image',
              inputs: [
                ...sourceNodeKeys.slice(0, 6).map((k, idx) => ({
                  nodeKey: k,
                  slot: (idx === 0 ? 'subject' : idx === 1 ? 'scene' : 'style') as
                    | 'subject'
                    | 'scene'
                    | 'style',
                })),
                ...textInputs,
              ],
              prompt:
                textJoined ||
                `融合 ${promptSummary} 的角色主体与视觉风格，生成统一构图的电影关键帧`,
              placement: anchorPlacement,
            })
          }
        >
          <Sparkles size={11} /> 多图融合生图
        </button>
      )}

      {canMultiRefVideo && (
        <button
          type="button"
          className="cc-multi-ai"
          title={`在画布右侧原地创建多参考一致性视频工坊卡（${Math.min(imgCount, 4)} 张参考图）`}
          onClick={() =>
            onSpawnGeneratorNode({
              use: 'video',
              action: 'ref-video',
              inputs: [
                ...sourceNodeKeys.slice(0, 4).map((k) => ({ nodeKey: k, slot: 'subject' as const })),
                ...textInputs,
              ],
              prompt: textJoined || `保持 ${promptSummary} 的外观与风格一致，电影感动态镜头表现`,
              placement: anchorPlacement,
            })
          }
        >
          <Clapperboard size={11} /> 参考生视频
        </button>
      )}

      {canMotionAnimate && (
        <>
          <button
            type="button"
            className="cc-multi-ai"
            title="将所选角色图与驱动视频连入动作迁移工坊卡（百炼 wan2.2-animate-move）"
            onClick={() =>
              onSpawnGeneratorNode({
                use: 'video',
                action: 'motion-transfer',
                inputs: [
                  { nodeKey: sourceNodeKeys[0], slot: 'subject' },
                  { nodeKey: videoNodeKeys[0], slot: 'motion-video' },
                  ...textInputs,
                ],
                prompt: textJoined,
                placement: anchorPlacement,
              })
            }
          >
            <Clapperboard size={11} /> 动作迁移
          </button>
          <button
            type="button"
            className="cc-multi-ai"
            title="保留原片视频背景光影，将主角替换为所选角色图（百炼 wan2.2-animate-mix）"
            onClick={() =>
              onSpawnGeneratorNode({
                use: 'video',
                action: 'character-replace',
                inputs: [
                  { nodeKey: sourceNodeKeys[0], slot: 'subject' },
                  { nodeKey: videoNodeKeys[0], slot: 'motion-video' },
                  ...textInputs,
                ],
                prompt: textJoined,
                placement: anchorPlacement,
              })
            }
          >
            <Sparkles size={11} /> 视频换人
          </button>
        </>
      )}

      {canLipSync && (
        <button
          type="button"
          className="cc-multi-ai"
          title="将所选角色人像与配音波形连入音频驱动对口型工坊卡（L2 极低费 · wan2.2-s2v）"
          onClick={() =>
            onSpawnGeneratorNode({
              use: 'video',
              action: 'lip-sync',
              inputs: [
                { nodeKey: sourceNodeKeys[0], slot: 'subject' },
                { nodeKey: audioNodeKeys[0], slot: 'driver-audio' },
                ...textInputs,
              ],
              prompt: textJoined,
              placement: anchorPlacement,
            })
          }
        >
          <AudioLines size={11} /> 音频对口型
        </button>
      )}

      {canBridgeTwoVideos && (
        <button
          type="button"
          className="cc-multi-ai"
          title="用 FFmpeg 自动抽取左视频尾帧 + 右视频首帧，原地连入首尾帧过渡视频工坊卡"
          onClick={() => onBridgeTwoVideos?.(videoAssetIds[0], videoAssetIds[1], anchorPlacement)}
        >
          <Clapperboard size={11} /> 尾接首过渡视频
        </button>
      )}

      {canCombineVisualAudio && (
        <button
          type="button"
          className="cc-multi-ai"
          title="按音频时长自动撑开画面（声定画长），附加 L1 呼吸运镜与颗粒并同步字幕"
          onClick={() => onCombineVisualAudio?.(visualAssetIds[0], audioAssetIds[0])}
        >
          <AudioLines size={11} /> 合为带声分镜
        </button>
      )}

      {canSpatial25D && (
        <button
          type="button"
          className="cc-multi-ai"
          title="零视频费把所选 2–4 张平面图按 Z 轴纵深立进统一空间摄影棚，自动配真 3D 电影推镜与体积粒子（¥0）"
          onClick={() => onCreateSpatial25D?.(imageAssetIds.slice(0, 4), anchorPlacement)}
        >
          <Box size={11} /> 立为 2.5D 空间镜
        </button>
      )}

      {canTriageImages && (
        <button
          type="button"
          title="对比所选候选图并标星推荐最佳帧（默认本地免费评分，开启 System 1 后启用 Noul+Score 畸变质检）"
          onClick={() => onTriageAssets?.(imageAssetIds)}
        >
          <Star size={11} /> 质检挑优
        </button>
      )}

      {canAutoTag && (
        <button
          type="button"
          title="按需为所选素材标记创作角色（角色/场景/道具/配音/配乐；默认本地免费，绝不静默刷 API）"
          onClick={() => onAutoTagAssets?.(allSelectedAssetIds)}
        >
          <Tag size={11} /> 智能标角色
        </button>
      )}

      {hasAnyAiOrCombo && <span className="cc-tb-sep" />}

      {canAddToChat && (
        <button
          type="button"
          onClick={() => {
            const refs = onCollectRefs(selectedNodeIds);
            if (onAddRefsToChat && refs.length) onAddRefsToChat(refs, false);
          }}
        >
          <AtSign size={11} /> 添加到对话
        </button>
      )}
      <button type="button" onClick={() => onCreateGroup(selectedNodeIds)}>
        <Group size={11} /> 成组
      </button>
      <button type="button" onClick={() => onPackNodes(selectedNodeIds)}>
        <Package size={11} /> 打成素材包
      </button>
      <button type="button" onClick={() => onLinkNodes(selectedNodeIds)}>
        <Link2 size={11} /> 建立关联
      </button>
      <button type="button" onClick={() => onAppendToTimeline(selectedNodeIds)}>
        <Film size={11} /> 串入时间线
      </button>
      {selectedNodeIds.some((k) => k.startsWith('asset:') || k.startsWith('ent:') || k.startsWith('comp:')) && (
        <button
          type="button"
          title="从画布收起所选素材（不删除工程文件，随时可恢复）"
          onClick={() => onHideNodes(selectedNodeIds)}
        >
          <EyeOff size={11} /> 移出画布
        </button>
      )}
      {selectedNodeIds.some((k) => k.startsWith('shot:')) && canSaveClipsAsAsset && onSaveClipsAsAsset && (
        <button
          type="button"
          onClick={() => {
            const chosenShots = selectedNodeIds
              .filter((k) => k.startsWith('shot:'))
              .map((k) => shots.find((s) => `shot:${s.id}` === k))
              .filter((x): x is CompositeShot => Boolean(x));
            const allClips = chosenShots.flatMap((s) => [...s.compositeClips, ...s.captionClips]);
            if (allClips.length) onSaveClipsAsAsset(allClips);
          }}
        >
          <BookmarkPlus size={11} /> 存为资产
        </button>
      )}
      <button type="button" className="cc-multi-close" aria-label="取消多选" onClick={onClearSelection}>
        <X size={11} />
      </button>
    </div>
  );
});
