import React from 'react';
import {
  AtSign,
  BookmarkPlus,
  Clapperboard,
  EyeOff,
  Film,
  Group,
  Link2,
  Package,
  Sparkles,
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

interface CanvasMultiBarProps {
  selectedNodeIds: string[];
  visualSelection: {
    imageAssetIds: string[];
    labels: string[];
    sourceNodeKeys: string[];
    anchorPlacement: CanvasPt;
  };
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
  onCreateGroup,
  onPackNodes,
  onLinkNodes,
  onAppendToTimeline,
  onHideNodes,
  onSaveClipsAsAsset,
  onClearSelection,
}: CanvasMultiBarProps) {
  if (selectedNodeIds.length < 2) return null;

  const { imageAssetIds, labels, sourceNodeKeys, anchorPlacement } = visualSelection;
  const imgCount = imageAssetIds.length;
  const canFirstLastVideo = imgCount === 2;
  const canMultiRefImage = imgCount >= 2;
  const canMultiRefVideo = imgCount >= 3;
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
              ],
              prompt: `从「${labels[0]}」自然运镜过渡到「${labels[1]}」，电影级连贯镜头运动`,
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
          title={`在画布右侧原地创建多图融合工坊卡，自动汇入 ${Math.min(imgCount, 6)} 张参考图`}
          onClick={() =>
            onSpawnGeneratorNode({
              use: 'image',
              action: 'multi-ref-image',
              inputs: sourceNodeKeys.slice(0, 6).map((k, idx) => ({
                nodeKey: k,
                slot: idx === 0 ? 'subject' : idx === 1 ? 'scene' : 'style',
              })),
              prompt: `融合 ${promptSummary} 的角色主体与视觉风格，生成统一构图的电影关键帧`,
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
              inputs: sourceNodeKeys.slice(0, 4).map((k) => ({ nodeKey: k, slot: 'subject' })),
              prompt: `保持 ${promptSummary} 的外观与风格一致，电影感动态镜头表现`,
              placement: anchorPlacement,
            })
          }
        >
          <Clapperboard size={11} /> 参考生视频
        </button>
      )}

      {(canFirstLastVideo || canMultiRefImage) && <span className="cc-tb-sep" />}

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
