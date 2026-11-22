import React, { useState } from 'react';
import { AudioLines, Captions, Eye, ImagePlus, Video, ArrowUpRight, SlidersHorizontal } from 'lucide-react';
import type { Asset, GenerationTarget, Job, ModelUse, Project, Settings } from '../core/types';
import { selectedModel } from '../core/models';
import { Modal, Spinner } from './ui';

type Use = Exclude<ModelUse, 'agent'>;
const modes = [
  { id: 'image', label: '图像', icon: ImagePlus, action: '生成图像', prompt: '描述主体、构图、光线与风格' },
  { id: 'video', label: '视频', icon: Video, action: '生成视频', prompt: '描述镜头、主体动作与运镜' },
  { id: 'speech', label: '配音', icon: AudioLines, action: '生成配音', prompt: '输入需要朗读的文稿' },
  { id: 'transcription', label: '转录', icon: Captions, action: '转录素材', prompt: '' },
  { id: 'vision', label: '画面分析', icon: Eye, action: '分析画面', prompt: '想了解这个画面的哪些细节？' },
] as const;
export interface GenerationDraft {
  use: Use;
  prompt?: string;
  modelId?: string;
  assetId?: string;
  referenceAssetId?: string;
  size?: string;
  seconds?: number;
  voice?: string;
  language?: string;
  target?: GenerationTarget;
}
type Props = {
  project: Project;
  settings: Settings;
  initial: GenerationDraft;
  onClose: () => void;
  onConfigure: (current: GenerationDraft) => void;
  onStarted: (job: Job) => void;
};
const accepts = (use: Use, asset: Asset) =>
  use === 'transcription' ? asset.kind !== 'image' : asset.kind !== 'audio';

export function GenerationDialog({ project, settings, initial, onClose, onConfigure, onStarted }: Props) {
  const [draft, setDraft] = useState(initial);
  const [history, setHistory] = useState<Partial<Record<Use, GenerationDraft>>>({});
  React.useEffect(() => {
    setDraft(initial);
  }, [initial.use, initial.prompt, initial.assetId, initial.referenceAssetId, initial.target?.clipId]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const update = (part: Partial<GenerationDraft>) => {
    setDraft((d) => ({ ...d, ...part }));
    setError('');
  };
  const mode = modes.find((m) => m.id === draft.use)!;
  const models = settings.models.filter((m) => m.capabilities.includes(draft.use));
  const defaultModel = selectedModel(settings, draft.use, project.modelDefaults);
  const model = models.find((m) => m.id === draft.modelId) || defaultModel;
  const provider = settings.providers.find((p) => p.id === model?.providerId);
  const connected = provider && (provider.hasApiKey || !provider.requiresKey);
  const isAnalysis = draft.use === 'vision' || draft.use === 'transcription';
  const sourceAssets = project.assets.filter((a) => accepts(draft.use, a));
  const assetId = sourceAssets.some((a) => a.id === draft.assetId) ? draft.assetId : sourceAssets[0]?.id;
  const canStart = connected && (isAnalysis ? !!assetId : !!draft.prompt?.trim());
  const start = async () => {
    if (busy || !canStart || !model) return;
    setBusy(true);
    setError('');
    try {
      const job = await window.cocraft.call<Job>('generation.start', {
        ...draft,
        modelId: model.id,
        prompt: draft.prompt?.trim() || undefined,
        assetId: isAnalysis ? assetId : undefined,
        referenceAssetId: draft.referenceAssetId || undefined,
        target: draft.use === 'image' || draft.use === 'video' ? draft.target : undefined,
      });
      onStarted(job);
    } catch (e) {
      setError(
        String(e)
          .replace(/^.*?Error: (?=[^]*$)/, '')
          .replace(/^Error: /, ''),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="素材工作室" onClose={onClose} className="generation-shell">
      <div className="generation-modes" role="group" aria-label="工作室用途">
        {modes.map((m) => (
          <button
            type="button"
            key={m.id}
            aria-pressed={draft.use === m.id}
            onClick={() => {
              if (m.id === draft.use) return;
              setHistory((h) => ({ ...h, [draft.use]: draft }));
              setDraft(
                history[m.id] || {
                  use: m.id,
                  prompt: m.id === 'image' || m.id === 'video' ? draft.prompt : undefined,
                  referenceAssetId:
                    m.id === 'image' || m.id === 'video' ? draft.referenceAssetId : undefined,
                  target: m.id === 'image' || m.id === 'video' ? draft.target : undefined,
                },
              );
              setError('');
            }}
          >
            <m.icon size={16} />
            {m.label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <div className="generation-body">
          {draft.target && (draft.use === 'image' || draft.use === 'video') && (
            <div className="generation-target-banner" role="status">
              <span>
                目标镜头：<b>{draft.target.shotLabel || '当前分镜'}</b> · 完成后将自动作为未激活候选挂载回此镜
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => update({ target: undefined })}
              >
                仅收入素材库
              </button>
            </div>
          )}
          <label className="field">
            <span>使用模型</span>
            <select
              aria-label="工作室模型"
              value={models.some((m) => m.id === draft.modelId) ? draft.modelId : ''}
              onChange={(e) => update({ modelId: e.target.value || undefined })}
            >
              <option value="">{defaultModel ? '默认 · ' + defaultModel.name : '选择模型'}</option>
              {models.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name} · {settings.providers.find((p) => p.id === m.providerId)?.name}
                </option>
              ))}
            </select>
          </label>
          {isAnalysis && (
            <label className="field">
              <span>项目素材</span>
              <select
                aria-label="待分析素材"
                value={assetId || ''}
                onChange={(e) => update({ assetId: e.target.value })}
              >
                {!sourceAssets.length && (
                  <option value="">先导入{draft.use === 'vision' ? '图片或视频' : '音频或视频'}</option>
                )}
                {sourceAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.use !== 'transcription' && (
            <label className="field">
              <span>
                {draft.use === 'speech' ? '配音文稿' : draft.use === 'vision' ? '分析要求' : '画面描述'}
              </span>
              <textarea
                aria-label={mode.prompt}
                rows={4}
                placeholder={mode.prompt}
                value={draft.prompt || ''}
                onChange={(e) => update({ prompt: e.target.value })}
              />
            </label>
          )}
          {(draft.use === 'image' || draft.use === 'video') && (
            <div className="generation-options">
              <label className="field">
                <span>
                  {model?.adapter === 'ark-video'
                    ? '画面宽高比'
                    : model?.adapter === 'dashscope-video'
                      ? '分辨率 / 尺寸'
                      : '画面尺寸'}
                </span>
                <input
                  aria-label="画面尺寸"
                  value={draft.size ?? ''}
                  placeholder={String(
                    model?.parameters.size ||
                      model?.parameters.resolution ||
                      model?.parameters.ratio ||
                      (model?.adapter === 'ark-video'
                        ? '例如 16:9'
                        : model?.adapter === 'dashscope-video'
                          ? '例如 720P 或 1280*720'
                          : '模型默认'),
                  )}
                  onChange={(e) => update({ size: e.target.value || undefined })}
                />
              </label>
              {draft.use === 'video' && (
                <label className="field">
                  <span>时长（秒）</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    aria-label="视频时长"
                    value={draft.seconds ?? ''}
                    placeholder={String(model?.parameters.seconds || model?.parameters.duration || '模型默认')}
                    onChange={(e) => update({ seconds: Number(e.target.value) || undefined })}
                  />
                </label>
              )}
              {(draft.use === 'video' || draft.use === 'image') && (
                <label className="field">
                  <span>参考图</span>
                  <select
                    value={draft.referenceAssetId || ''}
                    onChange={(e) => update({ referenceAssetId: e.target.value })}
                  >
                    <option value="">无</option>
                    {project.assets
                      .filter((a) => a.kind === 'image')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {draft.use === 'speech' && (
            <label className="field">
              <span>音色</span>
              <input
                value={draft.voice ?? ''}
                placeholder={String(
                  model?.parameters.voice ||
                    (model?.adapter === 'dashscope-speech' ? 'Cherry / Serena / Ethan' : '使用模型默认音色'),
                )}
                onChange={(e) => update({ voice: e.target.value || undefined })}
              />
            </label>
          )}
          {draft.use === 'transcription' && (
            <label className="field">
              <span>语言</span>
              <select
                value={draft.language || ''}
                onChange={(e) => update({ language: e.target.value || undefined })}
              >
                <option value="">模型默认 / 自动识别</option>
                <option value="zh">中文</option>
                <option value="en">英语</option>
                <option value="ja">日语</option>
              </select>
            </label>
          )}
          {error && (
            <p role="alert" className="error-copy">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="button subtle" onClick={() => onConfigure(draft)}>
            <SlidersHorizontal size={13} />
            配置模型
          </button>
          <span className="generation-provider">
            {provider?.protocol === 'system'
              ? '本机处理'
              : connected
                ? provider?.name
                : '请先配置此用途的模型'}
          </span>
          <button type="submit" disabled={!canStart || busy} className="button primary">
            {busy ? <Spinner /> : <ArrowUpRight size={15} />} {mode.action}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
