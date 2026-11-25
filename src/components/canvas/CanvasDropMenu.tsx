import React from 'react';
import {
  AudioLines,
  Box,
  Camera,
  Clapperboard,
  Film,
  Layers,
  Scissors,
  Sparkles,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { scriptOutlineToShotOperations, type CompositeShot } from '../../core/storyboard';
import type {
  CanvasGeneratorAction,
  CanvasGeneratorInput,
  ChatContextRef,
  EditOperation,
  Project,
  Sequence,
  VaultItem,
} from '../../core/types';
import type { CanvasPt } from '../CanvasWiresLayer';

export interface CanvasDropMenuState {
  sourceKey: string;
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
}

interface CanvasDropMenuProps {
  dropMenu: CanvasDropMenuState;
  project: Project;
  sequence: Sequence;
  upstreamEntities: readonly VaultItem[];
  shots: readonly CompositeShot[];
  activeVarByEnt: Record<string, string>;
  textDrafts: Record<string, string>;
  onClose: () => void;
  onCollectRefs: (keys: string[]) => ChatContextRef[];
  onSpawnGeneratorNode: (opts: {
    use: 'image' | 'video' | 'speech';
    action: CanvasGeneratorAction;
    inputs: CanvasGeneratorInput[];
    prompt?: string;
    placement: CanvasPt;
  }) => void;
  onAppendShot: (fromItem?: VaultItem) => void;
  onAppendToTimeline: (keys: string[]) => void;
  onBakeSpatialToAiVideo?: (sourceKey: string, placement: CanvasPt) => void;
  onCapturePairToAiVideo?: (sourceKey: string, placement: CanvasPt) => void;
  onCaptureRefToAiImage?: (sourceKey: string, placement: CanvasPt) => void;
  onSpawnSpatialMultiCam?: (sourceKey: string) => void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
}

export const CanvasDropMenu = React.memo(function CanvasDropMenu({
  dropMenu,
  project,
  sequence,
  upstreamEntities,
  shots,
  activeVarByEnt,
  textDrafts,
  onClose,
  onCollectRefs,
  onSpawnGeneratorNode,
  onAppendShot,
  onAppendToTimeline,
  onBakeSpatialToAiVideo,
  onCapturePairToAiVideo,
  onCaptureRefToAiImage,
  onSpawnSpatialMultiCam,
  onEdit,
}: CanvasDropMenuProps) {
  const sk = dropMenu.sourceKey;
  const srcEnt = sk.startsWith('ent:')
    ? upstreamEntities.find((e) => `ent:${e.id}` === sk)
    : undefined;
  const srcAsset = sk.startsWith('asset:')
    ? project.assets.find((a) => `asset:${a.id}` === sk)
    : undefined;
  const srcShot = sk.startsWith('shot:')
    ? shots.find((s) => `shot:${s.id}` === sk)
    : undefined;
  const srcComp = sk.startsWith('comp:')
    ? project.components.find((c) => `comp:${c.id}` === sk)
    : undefined;

  const isTextNode = srcEnt?.entityKind === 'text';
  const isCodeSource = Boolean(srcComp || srcShot?.anchorClip.kind === 'code');
  const isSpatialStageSource = Boolean(
    srcEnt?.rig?.presetId === 'spatial-stage' ||
      srcEnt?.rig?.presetId === 'teardown-3d' ||
      srcAsset?.kind === 'model-3d' ||
      srcShot?.anchorClip.props?.presetId === 'spatial-stage' ||
      srcShot?.anchorClip.props?.presetId === 'teardown-3d',
  );
  const isSpatialSource = isSpatialStageSource || isCodeSource;
  const rawText = isTextNode && srcEnt ? (textDrafts[srcEnt.id] ?? srcEnt.textContent ?? '').trim() : '';

  const hasVisualRef = Boolean(
    srcAsset?.kind === 'image' ||
      srcShot?.anchorClip.assetId ||
      (srcEnt && (srcEnt.variants?.some((v) => v.assetId) || srcEnt.assetId || activeVarByEnt[srcEnt.id])),
  );

  const refs = onCollectRefs([sk]);
  const promptBase = rawText || srcEnt?.promptAnchor || srcShot?.scriptText || refs[0]?.label || '';
  const placement = { x: Math.round(dropMenu.worldX), y: Math.round(dropMenu.worldY) };

  const defaultImgSlot = (): CanvasGeneratorInput['slot'] => {
    if (isTextNode) return 'prompt-text';
    const role = srcAsset?.role || srcEnt?.role;
    if (role === 'environment' || role === 'backdrop') return 'scene';
    if (role === 'visual-style') return 'style';
    return 'subject';
  };

  return (
    <div
      className="cc-popover cc-tap-menu cc-drop-create"
      style={{ left: dropMenu.screenX, top: dropMenu.screenY }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="cc-menu-group">
        {isSpatialSource ? '3D 空间摄影棚 → AI 视频 / 图像闭环' : '就地创建下游转换节点'}
      </div>

      {isSpatialSource && (
        <>
          {onBakeSpatialToAiVideo && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onBakeSpatialToAiVideo(sk, placement);
              }}
            >
              <span className="cc-menu-item-label">
                <Clapperboard size={13} /> 录 3D 预演视频 → 动作迁移 / 参考生视频
              </span>
            </button>
          )}
          {onCapturePairToAiVideo && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onCapturePairToAiVideo(sk, placement);
              }}
            >
              <span className="cc-menu-item-label">
                <Box size={13} /> {isCodeSource ? '拍开场/收尾两帧 → 首尾帧生视频' : 'A机→B机双拍 → 首尾帧生视频'}
              </span>
            </button>
          )}
          {onCaptureRefToAiImage && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onCaptureRefToAiImage(sk, placement);
              }}
            >
              <span className="cc-menu-item-label">
                <Camera size={13} /> {isCodeSource ? '拍当前 3D 帧 → AI 写实重绘' : '拍当前机位+深度图 → AI 风格重绘'}
              </span>
            </button>
          )}
          {isSpatialStageSource && onSpawnSpatialMultiCam && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onSpawnSpatialMultiCam(sk);
              }}
            >
              <span className="cc-menu-item-label">
                <Film size={13} /> 一键派生 A/B/C 三机位分镜组
              </span>
            </button>
          )}
          <div className="cc-menu-divider" />
        </>
      )}

      {isTextNode && (
        <>
          <button
            type="button"
            onClick={async () => {
              onClose();
              if (!srcEnt || !rawText) return;
              const ops = scriptOutlineToShotOperations(
                sequence,
                rawText,
                {
                  entityId: srcEnt.id,
                  version: srcEnt.version,
                },
                upstreamEntities,
              );
              if (ops.length) await onEdit(`从「${srcEnt.name}」拆解分镜`, ops);
            }}
          >
            <span className="cc-menu-item-label">
              <Clapperboard size={13} /> 按行拆解为分镜序列
            </span>
            <kbd>S</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onSpawnGeneratorNode({
                use: 'speech',
                action: 'tts',
                inputs: [{ nodeKey: sk, slot: 'prompt-text' }],
                prompt: rawText || srcEnt?.name || '',
                placement,
              });
            }}
          >
            <span className="cc-menu-item-label">
              <AudioLines size={13} /> 新建 AI 配音工坊卡
            </span>
            <kbd>A</kbd>
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => {
          onClose();
          onSpawnGeneratorNode({
            use: 'image',
            action: hasVisualRef ? 'image-edit' : 'text-to-image',
            inputs: [{ nodeKey: sk, slot: defaultImgSlot() }],
            prompt: hasVisualRef ? '' : promptBase,
            placement,
          });
        }}
      >
        <span className="cc-menu-item-label">
          <Sparkles size={13} /> {hasVisualRef ? '指令改图 / 延伸生图卡' : '文生概念图工坊卡'}
        </span>
        <kbd>G</kbd>
      </button>

      {hasVisualRef && (
        <>
          <button
            type="button"
            onClick={() => {
              onClose();
              onSpawnGeneratorNode({
                use: 'image',
                action: 'turnaround',
                inputs: [{ nodeKey: sk, slot: 'subject' }],
                placement,
              });
            }}
          >
            <span className="cc-menu-item-label">
              <UserCheck size={13} /> 角色 / 主体三视图卡
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onSpawnGeneratorNode({
                use: 'image',
                action: 'cutout',
                inputs: [{ nodeKey: sk, slot: 'subject' }],
                placement,
              });
            }}
          >
            <span className="cc-menu-item-label">
              <Wand2 size={13} /> 透明底智能抠图卡
            </span>
          </button>
        </>
      )}

      {srcAsset?.kind === 'video' && (
        <>
          <button
            type="button"
            onClick={() => {
              onClose();
              onSpawnGeneratorNode({
                use: 'video',
                action: 'motion-transfer',
                inputs: [{ nodeKey: sk, slot: 'motion-video' }],
                placement,
              });
            }}
          >
            <span className="cc-menu-item-label">
              <Clapperboard size={13} /> 作动作源 → 动作迁移卡 (Move)
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onSpawnGeneratorNode({
                use: 'video',
                action: 'character-replace',
                inputs: [{ nodeKey: sk, slot: 'motion-video' }],
                placement,
              });
            }}
          >
            <span className="cc-menu-item-label">
              <UserCheck size={13} /> 作原片 → 视频换人卡 (Mix)
            </span>
          </button>
        </>
      )}

      {srcAsset?.kind === 'audio' && (
        <button
          type="button"
          onClick={() => {
            onClose();
            onSpawnGeneratorNode({
              use: 'video',
              action: 'lip-sync',
              inputs: [{ nodeKey: sk, slot: 'driver-audio' }],
              placement,
            });
          }}
        >
          <span className="cc-menu-item-label">
            <AudioLines size={13} /> 作语音源 → 音频对口型卡 (S2V)
          </span>
        </button>
      )}

      {(!srcAsset || srcAsset.kind !== 'audio') && (
        <button
          type="button"
          onClick={() => {
            onClose();
            onSpawnGeneratorNode({
              use: 'video',
              action: hasVisualRef ? 'image-to-video' : 'ref-video',
              inputs: [{ nodeKey: sk, slot: isTextNode ? 'prompt-text' : 'first-frame' }],
              prompt: isTextNode ? rawText : undefined,
              placement,
            });
          }}
        >
          <span className="cc-menu-item-label">
            <Clapperboard size={13} /> {hasVisualRef ? 'AI 图生视频卡（作首帧）' : 'AI 生成视频卡'}
          </span>
          <kbd>V</kbd>
        </button>
      )}

      <div className="cc-menu-divider" />

      <button
        type="button"
        onClick={() => {
          onClose();
          onAppendShot(srcEnt);
        }}
      >
        <span className="cc-menu-item-label">
          <Film size={13} /> 派生至新分镜镜头
        </span>
        <kbd>N</kbd>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onAppendToTimeline([sk]);
        }}
      >
        <span className="cc-menu-item-label">
          <Scissors size={13} /> 直接放入时间线
        </span>
      </button>
    </div>
  );
});
