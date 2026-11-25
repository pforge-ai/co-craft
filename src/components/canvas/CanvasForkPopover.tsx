import React, { useState } from 'react';
import { GitBranch, Sparkles, X } from 'lucide-react';
import { selectedModel } from '../../core/models';
import type { Job, Project, Settings } from '../../core/types';
import type { CanvasPt } from '../CanvasWiresLayer';
import { FORK_VARIANT_PRESETS, type CanvasGenerationOptions } from './types';

export interface ForkSourceTarget {
  label: string;
  basePrompt: string;
  refAssetIds: string[];
  sourceNodeKeys: string[];
  anchorPos: CanvasPt;
}

interface CanvasForkPopoverProps {
  source: ForkSourceTarget;
  project: Project;
  settings?: Settings;
  onClose: () => void;
  onJobsStarted?: (jobs: Job[]) => void;
  onOpenGeneration: (opts: CanvasGenerationOptions) => void;
}

export function CanvasForkPopover({
  source,
  project,
  settings,
  onClose,
  onJobsStarted,
  onOpenGeneration,
}: CanvasForkPopoverProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({
    'wide-cinema': true,
    'dramatic-rim': true,
    'closeup-detail': false,
  });
  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>(() =>
    Object.fromEntries(FORK_VARIANT_PRESETS.map((p) => [p.id, p.suffix])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const imageModel = settings ? selectedModel(settings, 'image', project.modelDefaults) : undefined;
  const imageProvider = settings?.providers.find((p) => p.id === imageModel?.providerId);
  const connected = Boolean(imageProvider && (imageProvider.hasApiKey || !imageProvider.requiresKey));

  const activePresets = FORK_VARIANT_PRESETS.filter((p) => checked[p.id]);

  const handleLaunch = async () => {
    if (!activePresets.length || submitting) return;
    if (!connected || !imageModel) {
      // Fallback: open GenerationDialog with the first selected variant so user can pick/connect a model
      const first = activePresets[0];
      onClose();
      onOpenGeneration({
        use: 'image',
        prompt: `${source.basePrompt}，${customPrompts[first.id] || first.suffix}`,
        referenceAssetId: source.refAssetIds[0],
        referenceAssetIds: source.refAssetIds.length ? source.refAssetIds : undefined,
        canvas: {
          placement: { x: Math.round(source.anchorPos.x + 312), y: Math.round(source.anchorPos.y) },
          sourceNodeKeys: source.sourceNodeKeys,
          referenceAssetIds: source.refAssetIds.length ? source.refAssetIds : undefined,
        },
      });
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const started: Job[] = [];
      for (let i = 0; i < activePresets.length; i++) {
        const preset = activePresets[i];
        const fullPrompt = `${source.basePrompt}，${(customPrompts[preset.id] || preset.suffix).trim()}`;
        const placement = {
          x: Math.round(source.anchorPos.x + 312),
          y: Math.round(source.anchorPos.y + i * 198),
        };
        const job = await window.cocraft.call<Job>('generation.start', {
          use: 'image',
          modelId: imageModel.id,
          prompt: fullPrompt,
          referenceAssetId: source.refAssetIds[0],
          referenceAssetIds: source.refAssetIds.length ? source.refAssetIds : undefined,
          canvas: {
            placement,
            sourceNodeKeys: source.sourceNodeKeys,
            referenceAssetIds: source.refAssetIds.length ? source.refAssetIds : undefined,
            promptPreview: `${preset.label} · ${source.basePrompt}`.slice(0, 120),
            use: 'image',
          },
        });
        started.push(job);
      }
      onJobsStarted?.(started);
      onClose();
    } catch (e) {
      setError(
        String(e)
          .replace(/^.*?Error: (?=[^]*$)/, '')
          .replace(/^Error: /, ''),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="cc-popover cc-modal-card cc-fork-card"
      role="dialog"
      aria-label="画布并排派生变体"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="cc-card-head">
        <b>
          <GitBranch size={12} /> 并排派生变体 · {source.label}
        </b>
        <button type="button" onClick={onClose} aria-label="关闭派生变体">
          <X size={13} />
        </button>
      </div>
      <p className="cc-fork-hint">
        勾选 2–3 组导演变体方向，将在原节点右侧原地展开对比卡片并自动连线
        {source.refAssetIds.length > 0 ? `（自动携带 ${source.refAssetIds.length} 张参考图）` : ''}。
      </p>
      <div className="cc-fork-list">
        {FORK_VARIANT_PRESETS.map((p) => {
          const isOn = Boolean(checked[p.id]);
          return (
            <div key={p.id} className={`cc-fork-item ${isOn ? 'active' : ''}`}>
              <label className="cc-fork-check">
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                />
                <span>{p.label}</span>
              </label>
              <input
                type="text"
                className="cc-fork-input"
                aria-label={`${p.label} 提示词`}
                value={customPrompts[p.id] ?? p.suffix}
                onChange={(e) => setCustomPrompts((prev) => ({ ...prev, [p.id]: e.target.value }))}
              />
            </div>
          );
        })}
      </div>
      {error && <div className="cc-fork-error">{error}</div>}
      <div className="cc-card-foot cc-fork-foot">
        <span className="cc-fork-model">
          {connected && imageModel ? `模型：${imageModel.name}` : '未连接默认生图模型（点击前往配置）'}
        </span>
        <button
          type="button"
          className="button tiny primary"
          disabled={activePresets.length === 0 || submitting}
          onClick={() => void handleLaunch()}
        >
          <Sparkles size={11} />
          {connected
            ? submitting
              ? '正在提交…'
              : `原地派生 ${activePresets.length} 张对比图`
            : '打开工作室选择模型'}
        </button>
      </div>
    </div>
  );
}
