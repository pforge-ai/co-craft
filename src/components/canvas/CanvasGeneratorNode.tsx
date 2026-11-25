import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  AudioLines,
  BookmarkPlus,
  Clapperboard,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  Play,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { mediaUrl } from '../../composition/Film';
import { modelInputCapabilities, recommendModelForInputs } from '../../core/models';
import type {
  Asset,
  CanvasGeneratorAction,
  CanvasGeneratorInput,
  CanvasGeneratorInputSlot,
  CanvasGeneratorNode as GeneratorNodeModel,
  Job,
  Project,
  Settings,
  VaultItem,
} from '../../core/types';
import type { CompositeShot } from '../../core/storyboard';
import type { CanvasPt, PortSide } from '../CanvasWiresLayer';
import type { CanvasGenerationOptions } from './types';

export const GENERATOR_ACTION_META: Record<
  CanvasGeneratorAction,
  { label: string; use: 'image' | 'video' | 'speech'; defaultPrompt: string; costTier?: 'L2' | 'L3' }
> = {
  'text-to-image': { label: 'AI 生图', use: 'image', defaultPrompt: '' },
  'image-edit': { label: '指令改图', use: 'image', defaultPrompt: '保留主体身份与构图，按以下要求局部调整画面：' },
  'multi-ref-image': { label: '多图融合', use: 'image', defaultPrompt: '融合参考图中的主体与风格，生成统一电影关键帧' },
  turnaround: {
    label: '角色三视图',
    use: 'image',
    defaultPrompt: '同一角色的标准三视图定妆设定表（正面、侧面、背面全身），纯色干净背景，服装与五官高度一致',
  },
  cutout: {
    label: '透明底抠图',
    use: 'image',
    defaultPrompt: '完整保留参考图主体边缘与质感，去除全部背景输出干净透明底 PNG',
  },
  'image-to-video': { label: '图生视频', use: 'video', defaultPrompt: '电影级平稳推镜与自然动态，光影连贯', costTier: 'L3' },
  'first-last-video': { label: '首尾帧视频', use: 'video', defaultPrompt: '从首帧自然运镜流畅过渡至尾帧，电影感动态连贯', costTier: 'L3' },
  'ref-video': { label: '参考生视频', use: 'video', defaultPrompt: '保持参考主体外观与美术风格一致，电影感镜头表现', costTier: 'L3' },
  'motion-transfer': { label: '动作迁移', use: 'video', defaultPrompt: '', costTier: 'L3' },
  'character-replace': { label: '视频换人', use: 'video', defaultPrompt: '', costTier: 'L3' },
  'lip-sync': { label: '音频对口型', use: 'video', defaultPrompt: '', costTier: 'L2' },
  tts: { label: 'AI 配音', use: 'speech', defaultPrompt: '' },
};

export const SLOT_LABELS: Record<CanvasGeneratorInputSlot, string> = {
  subject: '主体',
  scene: '场景',
  style: '风格',
  'first-frame': '首帧',
  'last-frame': '尾帧',
  'prompt-text': '文本',
  'motion-video': '动作视频',
  'driver-audio': '驱动语音',
  source: '参考',
};

const IMAGE_SLOTS: CanvasGeneratorInputSlot[] = ['subject', 'scene', 'style', 'source'];
const VIDEO_SLOTS: CanvasGeneratorInputSlot[] = ['first-frame', 'last-frame', 'subject', 'style', 'source'];

interface CanvasGeneratorNodeProps {
  node: GeneratorNodeModel;
  pos: CanvasPt;
  project: Project;
  settings?: Settings;
  upstreamEntities: readonly VaultItem[];
  shots: readonly CompositeShot[];
  activeVarByEnt: Record<string, string>;
  previewOrigin: string;
  selected: boolean;
  wireTarget: boolean;
  dimmed: boolean;
  activeJobs: readonly Job[];
  inDegree: number;
  outDegree: number;
  onMouseEnter: (nodeKey: string) => void;
  onMouseLeave: (nodeKey: string) => void;
  onPointerDown: (e: React.PointerEvent<HTMLElement>, nodeKey: string, pos: CanvasPt) => void;
  onClick: (e: React.MouseEvent, nodeKey: string) => void;
  onStartWireDrag: (e: React.PointerEvent<HTMLElement>, nodeKey: string, side: PortSide) => void;
  onTraceNode: (nodeKey: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<GeneratorNodeModel>) => void;
  onDeleteNode: (nodeId: string) => void;
  onSaveRecipe?: (node: GeneratorNodeModel) => void;
  onJobsStarted?: (jobs: Job[]) => void;
  onExtractVideoFrame?: (
    assetId: string,
    mode: 'first' | 'last',
    placement?: { x: number; y: number },
  ) => Promise<Asset | undefined>;
  onOpenGeneration: (opts: CanvasGenerationOptions) => void;
}

export const CanvasGeneratorNodeCard = React.memo(function CanvasGeneratorNodeCard({
  node,
  pos,
  project,
  settings,
  upstreamEntities,
  shots,
  activeVarByEnt,
  previewOrigin,
  selected,
  wireTarget,
  dimmed,
  activeJobs,
  inDegree,
  outDegree,
  onMouseEnter,
  onMouseLeave,
  onPointerDown,
  onClick,
  onStartWireDrag,
  onTraceNode,
  onUpdateNode,
  onDeleteNode,
  onSaveRecipe,
  onJobsStarted,
  onExtractVideoFrame,
  onOpenGeneration,
}: CanvasGeneratorNodeProps) {
  const [promptLocal, setPromptLocal] = useState(node.prompt);
  const [submitting, setSubmitting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    setPromptLocal(node.prompt);
  }, [node.prompt]);

  const nodeKey = `gen:${node.id}`;
  const isRunning = submitting || activeJobs.length > 0;
  const meta = GENERATOR_ACTION_META[node.action] || GENERATOR_ACTION_META['text-to-image'];

  // Resolve upstream inputs to thumbnails, image/video/audio assetIds, and prompt text snippets
  const resolvedInputs = useMemo(() => {
    return node.inputs.map((inp) => {
      let label = inp.nodeKey;
      let imageAssetId: string | undefined;
      let videoAssetId: string | undefined;
      let audioAssetId: string | undefined;
      let textSnippet = '';
      let thumbSrc: string | undefined;

      if (inp.nodeKey.startsWith('asset:')) {
        const a = project.assets.find((x) => `asset:${x.id}` === inp.nodeKey);
        if (a) {
          label = a.name.replace(/\.[^.]+$/, '').slice(0, 14);
          if (a.kind === 'image') imageAssetId = a.id;
          else if (a.kind === 'video') videoAssetId = a.id;
          else if (a.kind === 'audio') audioAssetId = a.id;
          if (a.thumbnail && !a.offline) thumbSrc = mediaUrl(previewOrigin, a.id, true);
        }
      } else if (inp.nodeKey.startsWith('ent:')) {
        const ent = upstreamEntities.find((x) => `ent:${x.id}` === inp.nodeKey);
        if (ent) {
          label = `@${ent.name}`;
          if (ent.entityKind === 'text') {
            textSnippet = (ent.textContent || ent.description || '').trim();
          } else {
            const vr =
              ent.variants?.find((v) => v.id === (activeVarByEnt[ent.id] || ent.defaultVariantId)) ||
              ent.variants?.[0];
            const aid = vr?.assetId || ent.assetId;
            const img = aid ? project.assets.find((x) => x.id === aid && x.kind === 'image') : undefined;
            if (img) {
              imageAssetId = img.id;
              if (img.thumbnail && !img.offline) thumbSrc = mediaUrl(previewOrigin, img.id, true);
            }
            textSnippet = [ent.promptAnchor, vr?.promptDelta].filter(Boolean).join('，');
          }
        }
      } else if (inp.nodeKey.startsWith('shot:')) {
        const sh = shots.find((s) => `shot:${s.id}` === inp.nodeKey);
        if (sh) {
          label = `镜头 #${sh.index}`;
          const aid = sh.anchorClip.assetId;
          const img = aid ? project.assets.find((x) => x.id === aid && x.kind === 'image') : undefined;
          if (img) {
            imageAssetId = img.id;
            if (img.thumbnail && !img.offline) thumbSrc = mediaUrl(previewOrigin, img.id, true);
          }
          textSnippet = sh.scriptText || '';
        }
      }
      return { ...inp, label, imageAssetId, videoAssetId, audioAssetId, textSnippet, thumbSrc };
    });
  }, [node.inputs, project.assets, upstreamEntities, shots, activeVarByEnt, previewOrigin]);

  const firstFrameInput = resolvedInputs.find((x) => x.slot === 'first-frame' && x.imageAssetId);
  const lastFrameInput = resolvedInputs.find((x) => x.slot === 'last-frame' && x.imageAssetId);
  const motionVideoInput = resolvedInputs.find((x) => x.slot === 'motion-video' && x.videoAssetId) ||
    resolvedInputs.find((x) => Boolean(x.videoAssetId));
  const driverAudioInput = resolvedInputs.find((x) => x.slot === 'driver-audio' && x.audioAssetId) ||
    resolvedInputs.find((x) => Boolean(x.audioAssetId));
  const orderedRefIds = useMemo(() => {
    const out: string[] = [];
    if (firstFrameInput?.imageAssetId) out.push(firstFrameInput.imageAssetId);
    for (const r of resolvedInputs) {
      if (!r.imageAssetId || r.slot === 'last-frame') continue;
      if (!out.includes(r.imageAssetId)) out.push(r.imageAssetId);
    }
    return out;
  }, [resolvedInputs, firstFrameInput]);

  const isAnimateAction = node.action === 'motion-transfer' || node.action === 'character-replace';
  const isLipSyncAction = node.action === 'lip-sync';
  const motionVideoAssetId = isAnimateAction ? motionVideoInput?.videoAssetId : undefined;
  const driverAudioAssetId = isLipSyncAction ? driverAudioInput?.audioAssetId : undefined;
  const lastFrameAssetId =
    node.use === 'video' && !isAnimateAction && !isLipSyncAction && lastFrameInput?.imageAssetId && orderedRefIds.length > 0
      ? lastFrameInput.imageAssetId
      : undefined;

  const availableModels = useMemo(
    () => (settings?.models || []).filter((m) => m.capabilities.includes(node.use)),
    [settings?.models, node.use],
  );
  const model = useMemo(() => {
    if (!settings) return undefined;
    return recommendModelForInputs(settings, node.use, {
      projectDefaults: project.modelDefaults,
      preferredModelId: node.modelId,
      refCount: orderedRefIds.length,
      hasLastFrame: Boolean(lastFrameAssetId),
      hasMotionVideo: isAnimateAction,
      motionMode: node.action === 'character-replace' ? 'mix' : node.action === 'motion-transfer' ? 'move' : undefined,
      hasDriverAudio: isLipSyncAction,
      transparentBg: node.action === 'cutout' || node.params?.background === 'transparent',
    });
  }, [
    settings,
    node.use,
    node.modelId,
    node.action,
    node.params?.background,
    project.modelDefaults,
    orderedRefIds.length,
    lastFrameAssetId,
    isAnimateAction,
    isLipSyncAction,
  ]);

  const provider = settings?.providers.find((p) => p.id === model?.providerId);
  const connected = Boolean(provider && (provider.hasApiKey || !provider.requiresKey));
  const caps = modelInputCapabilities(model);
  const batchCount = Math.max(1, Math.min(3, node.params?.batchCount || 1));

  const buildEffectivePrompt = () => {
    const textParts: string[] = [];
    for (const r of resolvedInputs) {
      if (r.slot === 'prompt-text' && r.textSnippet) textParts.push(r.textSnippet);
      else if (r.slot !== 'prompt-text' && r.textSnippet && !promptLocal.includes(r.label)) {
        textParts.push(`${r.label}（${r.textSnippet}）`);
      }
    }
    const base = promptLocal.trim();
    return [...textParts, base].filter(Boolean).join('，').trim();
  };

  const handleCycleSlot = (inp: CanvasGeneratorInput) => {
    if (inp.slot === 'prompt-text' || inp.slot === 'motion-video' || inp.slot === 'driver-audio') return;
    const ring = node.use === 'video' ? VIDEO_SLOTS : IMAGE_SLOTS;
    const idx = ring.indexOf(inp.slot);
    const nextSlot = ring[(idx + 1) % ring.length];
    const nextInputs = node.inputs.map((x) =>
      x.nodeKey === inp.nodeKey ? { ...x, slot: nextSlot } : x,
    );
    onUpdateNode(node.id, { inputs: nextInputs });
  };

  const handleSwapFirstLast = () => {
    const nextInputs = node.inputs.map((x) => {
      if (x.slot === 'first-frame') return { ...x, slot: 'last-frame' as const };
      if (x.slot === 'last-frame') return { ...x, slot: 'first-frame' as const };
      return x;
    });
    onUpdateNode(node.id, { inputs: nextInputs });
  };

  const handleRemoveInput = (key: string) => {
    onUpdateNode(node.id, { inputs: node.inputs.filter((x) => x.nodeKey !== key) });
  };

  const handleActionChange = (nextAction: CanvasGeneratorAction) => {
    const nextMeta = GENERATOR_ACTION_META[nextAction];
    const nextInputs: CanvasGeneratorInput[] = node.inputs.map((inp, idx) => {
      if (inp.slot === 'prompt-text' || inp.slot === 'motion-video' || inp.slot === 'driver-audio') return inp;
      if (nextMeta.use === 'video') {
        if (nextAction === 'motion-transfer' || nextAction === 'character-replace' || nextAction === 'lip-sync') {
          return { ...inp, slot: 'subject' };
        }
        if (nextAction === 'first-last-video') {
          return { ...inp, slot: idx === 0 ? 'first-frame' : idx === 1 ? 'last-frame' : 'subject' };
        }
        if (nextAction === 'image-to-video') {
          return { ...inp, slot: idx === 0 ? 'first-frame' : 'subject' };
        }
        return { ...inp, slot: 'subject' };
      }
      return { ...inp, slot: inp.slot === 'first-frame' || inp.slot === 'last-frame' ? 'subject' : inp.slot };
    });
    const nextPrompt = promptLocal.trim() ? promptLocal : nextMeta.defaultPrompt;
    setPromptLocal(nextPrompt);
    onUpdateNode(node.id, {
      action: nextAction,
      use: nextMeta.use,
      modelId: undefined,
      prompt: nextPrompt,
      inputs: nextInputs,
      params: {
        ...(node.params || {}),
        ...(nextAction === 'cutout' ? { background: 'transparent' } : {}),
      },
    });
  };

  const handleOpenInDialog = () => {
    const effectivePrompt = buildEffectivePrompt();
    const outIdx = node.outputAssetIds?.length || 0;
    onOpenGeneration({
      use: node.use,
      modelId: model?.id,
      prompt: effectivePrompt,
      referenceAssetId: orderedRefIds[0],
      referenceAssetIds: orderedRefIds.length ? orderedRefIds : undefined,
      lastFrameAssetId,
      canvas: {
        placement: { x: Math.round(pos.x + 356), y: Math.round(pos.y + outIdx * 196) },
        sourceNodeKeys: [nodeKey, ...node.inputs.map((i) => i.nodeKey)],
        referenceAssetIds: orderedRefIds.length ? orderedRefIds : undefined,
        lastFrameAssetId,
        promptPreview: effectivePrompt.slice(0, 120),
        use: node.use,
      },
    });
  };

  const handleRun = async () => {
    if (submitting) return;
    const promptOptional = Boolean(caps.promptOptional || isAnimateAction || isLipSyncAction);
    const effectivePrompt = buildEffectivePrompt() || (promptOptional ? meta.label : '');
    if (!effectivePrompt && !promptOptional) {
      setError('请先填写画面/镜头描述或连入文本节点');
      return;
    }
    if (isAnimateAction) {
      if (model && !caps.supportsMotionVideo) {
        setError(
          `当前模型「${model.name}」不支持动作迁移；请点击上方「抽首帧转图生视频」或在设置中添加 Wan 2.2 Animate Move`,
        );
        return;
      }
      if (!orderedRefIds.length) {
        setError('请先连入 1 张角色主体图片');
        return;
      }
      if (!motionVideoAssetId) {
        setError('请先连入 1 段动作/原片驱动视频');
        return;
      }
    }
    if (isLipSyncAction) {
      if (!orderedRefIds.length) {
        setError('请先连入 1 张角色人像图片');
        return;
      }
      if (!driverAudioAssetId) {
        setError('请先连入 1 段配音音频');
        return;
      }
    }
    if (!connected || !model) {
      handleOpenInDialog();
      return;
    }
    if (promptLocal !== node.prompt) {
      onUpdateNode(node.id, { prompt: promptLocal });
    }
    setSubmitting(true);
    setError('');
    try {
      const effectiveRefs = caps.maxReferences > 0 ? orderedRefIds.slice(0, caps.maxReferences) : [];
      const effectiveLast =
        node.use === 'video' && caps.supportsLastFrame && effectiveRefs.length > 0 ? lastFrameAssetId : undefined;
      const runs = node.use === 'image' ? batchCount : 1;
      const existingOutCount = node.outputAssetIds?.length || 0;
      const started: Job[] = [];
      for (let i = 0; i < runs; i++) {
        const placement = {
          x: Math.round(pos.x + 356),
          y: Math.round(pos.y + (existingOutCount + i) * 196),
        };
        const job = await window.cocraft.call<Job>('generation.start', {
          use: node.use,
          modelId: model.id,
          prompt: effectivePrompt,
          referenceAssetId: effectiveRefs[0],
          referenceAssetIds: effectiveRefs.length ? effectiveRefs : undefined,
          lastFrameAssetId: effectiveLast,
          motionVideoAssetId,
          driverAudioAssetId,
          animateMode: isAnimateAction ? node.params?.animateMode || 'wan-std' : undefined,
          aspectRatio: caps.supportsAspectRatio ? node.params?.aspectRatio || undefined : undefined,
          resolution: caps.supportsResolution ? node.params?.resolution || undefined : undefined,
          seconds: node.use === 'video' && !promptOptional ? node.params?.seconds || undefined : undefined,
          generateAudio: node.use === 'video' && caps.supportsAudioToggle ? node.params?.generateAudio : undefined,
          background:
            node.use === 'image' && caps.supportsTransparentBg
              ? node.action === 'cutout' || node.params?.background === 'transparent'
                ? 'transparent'
                : undefined
              : undefined,
          canvas: {
            placement,
            sourceNodeKeys: [nodeKey],
            referenceAssetIds: effectiveRefs.length ? effectiveRefs : undefined,
            lastFrameAssetId: effectiveLast,
            motionVideoAssetId,
            driverAudioAssetId,
            promptPreview: effectivePrompt.slice(0, 120),
            use: node.use,
          },
        });
        started.push(job);
      }
      onJobsStarted?.(started);
    } catch (err) {
      setError(
        String(err)
          .replace(/^.*?Error: (?=[^]*$)/, '')
          .replace(/^Error: /, ''),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConvertMotionToI2V = async () => {
    if (!motionVideoAssetId || !onExtractVideoFrame || converting) return;
    setConverting(true);
    setError('');
    try {
      const frameAsset = await onExtractVideoFrame(motionVideoAssetId, 'first', {
        x: Math.round(pos.x - 280),
        y: Math.round(pos.y),
      });
      if (!frameAsset) return;
      const kept = node.inputs.filter((x) => x.slot !== 'motion-video');
      const nextPrompt =
        promptLocal.trim() || '严格遵循 3D 预演构图与运镜，渲染电影级真实光影与动态';
      setPromptLocal(nextPrompt);
      onUpdateNode(node.id, {
        action: 'image-to-video',
        use: 'video',
        modelId: undefined,
        prompt: nextPrompt,
        inputs: [{ nodeKey: `asset:${frameAsset.id}`, slot: 'first-frame' }, ...kept],
      });
    } finally {
      setConverting(false);
    }
  };

  const compatNotice = useMemo(() => {
    if (!model) return null;
    if (isAnimateAction && !caps.supportsMotionVideo) {
      return {
        text: `「${model.name}」不支持视频动作迁移（需 Wan 2.2 Animate Move）。`,
        canConvertToI2V: Boolean(motionVideoAssetId && onExtractVideoFrame),
      };
    }
    if (node.action === 'first-last-video' && lastFrameAssetId && !caps.supportsLastFrame) {
      return {
        text: `「${model.name}」仅使用首帧（添加 Wan 2.7 I2V / Wan 2.2 KF2V 可启首尾双帧过渡）`,
        canConvertToI2V: false,
      };
    }
    if (node.use === 'image' && orderedRefIds.length > 0 && caps.maxReferences === 0) {
      return {
        text: `「${model.name}」为纯文生图模型，不会读取参考图；添加 Qwen-Image 3.0 / Edit 或 Wan 2.7 Image 可参考重绘`,
        canConvertToI2V: false,
      };
    }
    return null;
  }, [
    model,
    isAnimateAction,
    caps.supportsMotionVideo,
    caps.supportsLastFrame,
    caps.maxReferences,
    motionVideoAssetId,
    onExtractVideoFrame,
    node.action,
    node.use,
    lastFrameAssetId,
    orderedRefIds.length,
  ]);

  const Icon = node.use === 'video' ? Clapperboard : node.use === 'speech' ? AudioLines : ImageIcon;

  return (
    <div
      data-node-id={nodeKey}
      className={`cc-node generator ${node.collapsed ? 'collapsed-pill' : ''} ${selected ? 'selected' : ''} ${wireTarget ? 'wire-target' : ''} ${isRunning ? 'generating' : ''} ${dimmed ? 'trace-dimmed' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onMouseEnter={() => onMouseEnter(nodeKey)}
      onMouseLeave={() => onMouseLeave(nodeKey)}
      onPointerDown={(e) => onPointerDown(e, nodeKey, pos)}
      onClick={(e) => onClick(e, nodeKey)}
    >
      <button
        type="button"
        className="cc-port in"
        title="拖线连入图片、角色、场景或剧本作为输入"
        aria-label="工坊节点左侧输入端口"
        onPointerDown={(e) => onStartWireDrag(e, nodeKey, 'left')}
      />
      {inDegree > 0 && (
        <button
          type="button"
          className="cc-port-badge in"
          title={`已接入 ${inDegree} 个上游节点，点击溯源完整链路`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onTraceNode(nodeKey);
          }}
        >
          ← {inDegree}
        </button>
      )}

      <div className="cc-node-header cc-gen-header">
        <Icon size={11} />
        <span>
          {meta.label}
          {node.outputAssetIds?.length ? ` · 已出 ${node.outputAssetIds.length}` : ''}
        </span>
        {(caps.costTier || meta.costTier) && (
          <span className={`cc-gen-tier-badge tier-${(caps.costTier || meta.costTier || '').toLowerCase()}`}>
            {caps.costTier || meta.costTier}
          </span>
        )}
        <div className="cc-gen-head-acts" onPointerDown={(e) => e.stopPropagation()}>
          {onSaveRecipe && (
            <button
              type="button"
              title="将当前工坊拓扑、模型与参数存为可复用配方（Recipe）"
              aria-label="存为配方"
              onClick={(e) => {
                e.stopPropagation();
                onSaveRecipe({ ...node, prompt: promptLocal });
              }}
            >
              <BookmarkPlus size={10} />
            </button>
          )}
          <button
            type="button"
            title={node.collapsed ? '展开工坊卡片' : '折叠为配方胶囊'}
            aria-label={node.collapsed ? '展开工坊卡片' : '折叠为配方胶囊'}
            onClick={(e) => {
              e.stopPropagation();
              onUpdateNode(node.id, { collapsed: !node.collapsed });
            }}
          >
            {node.collapsed ? <Maximize2 size={10} /> : <Minimize2 size={10} />}
          </button>
          <button
            type="button"
            title="删除工坊节点（保留已生成资产）"
            aria-label="删除工坊节点"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteNode(node.id);
            }}
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {node.collapsed ? (
        <div className="cc-node-card cc-gen-card collapsed" onClick={(e) => e.stopPropagation()}>
          <div className="cc-gen-pill-row">
            <div className="cc-gen-pill-info" onClick={() => onUpdateNode(node.id, { collapsed: false })}>
              <b>{model?.name || meta.label}</b>
              <small>{promptLocal.slice(0, 26) || '点击展开编辑参数'}</small>
            </div>
            <button
              type="button"
              className="cc-gen-pill-run"
              title="直接按此配方再抽一次"
              disabled={isRunning}
              onClick={() => void handleRun()}
            >
              <RotateCw size={11} />
            </button>
          </div>
        </div>
      ) : (
        <div className="cc-node-card cc-gen-card" onPointerDown={(e) => e.stopPropagation()}>
          {/* Action + Model Row */}
          <div className="cc-gen-top-controls">
            <select
              className="cc-gen-select action"
              aria-label="生成动作类型"
              value={node.action}
              onChange={(e) => handleActionChange(e.target.value as CanvasGeneratorAction)}
            >
              <optgroup label="图像转换 / 生成">
                <option value="text-to-image">AI 生图</option>
                <option value="image-edit">指令改图</option>
                <option value="multi-ref-image">多图融合</option>
                <option value="turnaround">角色三视图</option>
                <option value="cutout">透明底抠图</option>
              </optgroup>
              <optgroup label="视频转换 / 生成">
                <option value="image-to-video">图生视频</option>
                <option value="first-last-video">首尾帧视频</option>
                <option value="ref-video">参考生视频</option>
              </optgroup>
              <optgroup label="人物表演 / 驱动 (L2 / L3)">
                <option value="motion-transfer">动作迁移 (Move)</option>
                <option value="character-replace">视频换人 (Mix)</option>
                <option value="lip-sync">音频对口型 (S2V)</option>
              </optgroup>
              <optgroup label="语音合成">
                <option value="tts">AI 配音</option>
              </optgroup>
            </select>

            <select
              className="cc-gen-select model"
              aria-label="选择生成模型"
              value={model?.id || ''}
              onChange={(e) => onUpdateNode(node.id, { modelId: e.target.value || undefined })}
            >
              {availableModels.length === 0 && <option value="">未配置模型</option>}
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Typed Upstream Input Chips */}
          {resolvedInputs.length > 0 ? (
            <div className="cc-gen-inputs">
              {resolvedInputs.map((inp) => (
                <span key={inp.nodeKey} className={`cc-gen-input-chip slot-${inp.slot}`}>
                  {inp.thumbSrc && <img src={inp.thumbSrc} alt="" />}
                  <button
                    type="button"
                    className="cc-gen-slot-tag"
                    title="点击切换该连线的输入角色（主体 / 场景 / 风格 / 首尾帧）"
                    onClick={() => handleCycleSlot(inp)}
                  >
                    {SLOT_LABELS[inp.slot]}
                  </button>
                  <span className="cc-gen-inp-name">{inp.label}</span>
                  <button
                    type="button"
                    className="cc-gen-inp-del"
                    aria-label={`移除输入 ${inp.label}`}
                    onClick={() => handleRemoveInput(inp.nodeKey)}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
              {node.use === 'video' && firstFrameInput && lastFrameInput && (
                <button
                  type="button"
                  className="cc-gen-swap-btn"
                  title="互换首帧与尾帧"
                  onClick={handleSwapFirstLast}
                >
                  <ArrowLeftRight size={10} /> 互换首尾
                </button>
              )}
            </div>
          ) : (
            <div className="cc-gen-inputs-empty">可从任意资产/剧本拖线连入此卡，自动分配角色槽位</div>
          )}

          {/* Inline Prompt */}
          <textarea
            className="cc-gen-prompt"
            rows={2}
            aria-label="工坊节点提示词"
            placeholder={
              node.use === 'speech'
                ? '输入需要朗读的台词，或连入文本卡…'
                : isAnimateAction
                  ? '动作迁移/换人由驱动视频控制，无需填写提示词（可留空或写备注）…'
                  : isLipSyncAction
                    ? '口型与头部微动作由驱动音频自动生成，无需填写提示词（可留空）…'
                    : node.use === 'video'
                      ? '描述镜头动作、运镜与氛围（⌘↵ 直接运行）…'
                      : '描述目标画面、修改要求或美术风格（⌘↵ 直接运行）…'
            }
            value={promptLocal}
            onChange={(e) => {
              setPromptLocal(e.target.value);
              setError('');
            }}
            onBlur={() => {
              if (promptLocal !== node.prompt) onUpdateNode(node.id, { prompt: promptLocal });
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleRun();
              }
            }}
          />

          {/* Compact Dynamic Param Chips */}
          <div className="cc-gen-params">
            {caps.supportsAspectRatio && (
              <select
                aria-label="画幅比例"
                value={node.params?.aspectRatio || ''}
                onChange={(e) =>
                  onUpdateNode(node.id, {
                    params: { ...(node.params || {}), aspectRatio: e.target.value || undefined },
                  })
                }
              >
                <option value="">默认比例</option>
                {(caps.aspectRatios || ['16:9', '9:16', '1:1', '4:3']).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            {caps.supportsResolution && caps.resolutions?.length && (
              <select
                aria-label="清晰度"
                value={node.params?.resolution || ''}
                onChange={(e) =>
                  onUpdateNode(node.id, {
                    params: { ...(node.params || {}), resolution: e.target.value || undefined },
                  })
                }
              >
                <option value="">默认画质</option>
                {caps.resolutions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            {isAnimateAction && (
              <select
                aria-label="动作表演模式"
                value={node.params?.animateMode || 'wan-std'}
                onChange={(e) =>
                  onUpdateNode(node.id, {
                    params: {
                      ...(node.params || {}),
                      animateMode: e.target.value === 'wan-pro' ? 'wan-pro' : 'wan-std',
                    },
                  })
                }
              >
                <option value="wan-std">标准模式 (wan-std)</option>
                <option value="wan-pro">高精模式 (wan-pro)</option>
              </select>
            )}
            {node.use === 'video' && !isAnimateAction && !isLipSyncAction && (
              <select
                aria-label="视频时长"
                value={String(node.params?.seconds || '')}
                onChange={(e) =>
                  onUpdateNode(node.id, {
                    params: {
                      ...(node.params || {}),
                      seconds: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
              >
                <option value="">默认时长</option>
                <option value="5">5s</option>
                <option value="6">6s</option>
                <option value="8">8s</option>
                <option value="10">10s</option>
              </select>
            )}
            {node.use === 'video' && caps.supportsAudioToggle && (
              <button
                type="button"
                className={`cc-gen-toggle ${node.params?.generateAudio ? 'on' : ''}`}
                onClick={() =>
                  onUpdateNode(node.id, {
                    params: { ...(node.params || {}), generateAudio: !node.params?.generateAudio },
                  })
                }
              >
                伴音
              </button>
            )}
            {node.use === 'image' && caps.supportsTransparentBg && (
              <button
                type="button"
                className={`cc-gen-toggle ${node.action === 'cutout' || node.params?.background === 'transparent' ? 'on' : ''}`}
                onClick={() =>
                  onUpdateNode(node.id, {
                    params: {
                      ...(node.params || {}),
                      background: node.params?.background === 'transparent' ? 'auto' : 'transparent',
                    },
                  })
                }
              >
                透明底
              </button>
            )}
            {node.use === 'image' && (
              <div className="cc-gen-batch" role="group" aria-label="批量张数">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={batchCount === n ? 'active' : ''}
                    onClick={() =>
                      onUpdateNode(node.id, { params: { ...(node.params || {}), batchCount: n } })
                    }
                  >
                    ×{n}
                  </button>
                ))}
              </div>
            )}
          </div>

          {compatNotice && (
            <div className="cc-gen-compat-hint">
              <span>{compatNotice.text}</span>
              {compatNotice.canConvertToI2V && (
                <button
                  type="button"
                  className="cc-gen-compat-btn"
                  disabled={converting}
                  onClick={() => void handleConvertMotionToI2V()}
                >
                  {converting ? '抽帧中…' : '抽首帧转图生视频'}
                </button>
              )}
            </div>
          )}

          {error && <div className="cc-gen-err">{error}</div>}

          {/* Footer Run Bar */}
          <div className="cc-gen-foot">
            <button
              type="button"
              className="cc-gen-studio-link"
              title="在完整素材工作室弹窗中展开全部高级参数"
              onClick={handleOpenInDialog}
            >
              <SlidersHorizontal size={10} /> 高级
            </button>
            <button
              type="button"
              className="cc-gen-run-btn"
              disabled={submitting}
              onClick={() => void handleRun()}
            >
              {isRunning ? (
                <>
                  <Sparkles size={11} /> 渲染中…
                </>
              ) : !connected ? (
                <>
                  <SlidersHorizontal size={11} /> 选择/配置模型
                </>
              ) : (node.outputAssetIds?.length || 0) > 0 ? (
                <>
                  <RotateCw size={11} /> 再抽一次
                </>
              ) : (
                <>
                  <Play size={10} /> 原地生成{node.use === 'image' && batchCount > 1 ? ` ×${batchCount}` : ''}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="cc-port out"
        title="拖线继续下游加工"
        aria-label="工坊节点右侧输出端口"
        onPointerDown={(e) => onStartWireDrag(e, nodeKey, 'right')}
      />
      {outDegree > 0 && (
        <button
          type="button"
          className="cc-port-badge out"
          title={`已产出 ${outDegree} 个下游节点，点击溯源完整链路`}
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
