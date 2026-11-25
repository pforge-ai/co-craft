import React, { useState } from 'react';
import { AudioLines, Captions, Eye, ImagePlus, Video, ArrowUpRight, SlidersHorizontal, X } from 'lucide-react';
import type { Asset, GenerationCanvasMeta, GenerationTarget, Job, ModelUse, Project, Settings } from '../core/types';
import { modelInputCapabilities, recommendModelForInputs } from '../core/models';
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
  referenceAssetIds?: string[];
  lastFrameAssetId?: string;
  size?: string;
  resolution?: string;
  aspectRatio?: string;
  seconds?: number;
  generateAudio?: boolean;
  background?: 'auto' | 'opaque' | 'transparent';
  voice?: string;
  language?: string;
  target?: GenerationTarget;
  canvas?: GenerationCanvasMeta;
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

function getDraftRefs(draft: GenerationDraft): string[] {
  if (Array.isArray(draft.referenceAssetIds) && draft.referenceAssetIds.length) {
    return draft.referenceAssetIds;
  }
  return draft.referenceAssetId ? [draft.referenceAssetId] : [];
}

export function GenerationDialog({ project, settings, initial, onClose, onConfigure, onStarted }: Props) {
  const [draft, setDraft] = useState<GenerationDraft>(() => ({
    ...initial,
    ...(initial.referenceAssetId && !initial.referenceAssetIds?.length
      ? { referenceAssetIds: [initial.referenceAssetId] }
      : {}),
  }));
  const [history, setHistory] = useState<Partial<Record<Use, GenerationDraft>>>({});
  React.useEffect(() => {
    setDraft({
      ...initial,
      ...(initial.referenceAssetId && !initial.referenceAssetIds?.length
        ? { referenceAssetIds: [initial.referenceAssetId] }
        : {}),
    });
  }, [initial]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const update = (part: Partial<GenerationDraft>) => {
    setDraft((d) => ({ ...d, ...part }));
    setError('');
  };

  const setRefs = (nextIds: string[]) => {
    const clean = Array.from(new Set(nextIds.filter(Boolean)));
    update({
      referenceAssetIds: clean.length ? clean : undefined,
      referenceAssetId: clean[0],
    });
  };

  const mode = modes.find((m) => m.id === draft.use)!;
  const models = settings.models.filter((m) => m.capabilities.includes(draft.use));
  const draftRefsCount = getDraftRefs(draft).length;
  const defaultModel = recommendModelForInputs(settings, draft.use, {
    projectDefaults: project.modelDefaults,
    refCount: draftRefsCount,
    hasLastFrame: Boolean(draft.lastFrameAssetId),
    transparentBg: draft.background === 'transparent',
  });
  const model = (draft.modelId ? models.find((m) => m.id === draft.modelId) : undefined) || defaultModel;
  const provider = settings.providers.find((p) => p.id === model?.providerId);
  const connected = provider && (provider.hasApiKey || !provider.requiresKey);
  const isAnalysis = draft.use === 'vision' || draft.use === 'transcription';
  const sourceAssets = project.assets.filter((a) => accepts(draft.use, a));
  const imageAssets = project.assets.filter((a) => a.kind === 'image');
  const assetId = sourceAssets.some((a) => a.id === draft.assetId) ? draft.assetId : sourceAssets[0]?.id;
  const caps = modelInputCapabilities(model);
  const refs = getDraftRefs(draft).filter((id) => imageAssets.some((a) => a.id === id));
  const lastFrameId =
    draft.lastFrameAssetId && imageAssets.some((a) => a.id === draft.lastFrameAssetId)
      ? draft.lastFrameAssetId
      : '';
  const defaultAudio = Boolean(model?.parameters.generate_audio ?? model?.parameters.audio);
  const audioChecked = draft.generateAudio !== undefined ? draft.generateAudio : defaultAudio;
  const transparentChecked =
    draft.background === 'transparent' || (draft.background === undefined && model?.parameters.background === 'transparent');

  const canStart = connected && (isAnalysis ? !!assetId : !!draft.prompt?.trim());

  const start = async () => {
    if (busy || !canStart || !model) return;
    setBusy(true);
    setError('');
    try {
      const effectiveRefs = caps.maxReferences > 0 ? refs.slice(0, caps.maxReferences) : [];
      const effectiveLastFrame =
        draft.use === 'video' && caps.supportsLastFrame && effectiveRefs.length > 0 ? lastFrameId || undefined : undefined;
      const job = await window.cocraft.call<Job>('generation.start', {
        use: draft.use,
        modelId: model.id,
        prompt: draft.prompt?.trim() || undefined,
        assetId: isAnalysis ? assetId : undefined,
        referenceAssetId: effectiveRefs[0],
        referenceAssetIds: effectiveRefs.length ? effectiveRefs : undefined,
        lastFrameAssetId: effectiveLastFrame,
        size: caps.supportsSizeInput ? draft.size || undefined : undefined,
        resolution: caps.supportsResolution ? draft.resolution || undefined : undefined,
        aspectRatio: caps.supportsAspectRatio ? draft.aspectRatio || undefined : undefined,
        seconds: draft.use === 'video' ? draft.seconds || undefined : undefined,
        generateAudio: draft.use === 'video' && caps.supportsAudioToggle ? audioChecked : undefined,
        background:
          draft.use === 'image' && caps.supportsTransparentBg
            ? transparentChecked
              ? 'transparent'
              : draft.background
            : undefined,
        voice: draft.use === 'speech' ? draft.voice || undefined : undefined,
        language: draft.use === 'transcription' ? draft.language || undefined : undefined,
        target: draft.use === 'image' || draft.use === 'video' ? draft.target : undefined,
        canvas:
          draft.canvas || effectiveRefs.length || effectiveLastFrame
            ? {
                ...(draft.canvas || {}),
                ...(effectiveRefs.length ? { referenceAssetIds: effectiveRefs } : {}),
                ...(effectiveLastFrame ? { lastFrameAssetId: effectiveLastFrame } : {}),
                promptPreview: (draft.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 120),
                use: draft.use,
              }
            : undefined,
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
                  prompt: m.id === 'image' || m.id === 'video' || m.id === 'speech' ? draft.prompt : undefined,
                  referenceAssetId:
                    m.id === 'image' || m.id === 'video' ? draft.referenceAssetId : undefined,
                  referenceAssetIds:
                    m.id === 'image' || m.id === 'video' ? draft.referenceAssetIds : undefined,
                  lastFrameAssetId: m.id === 'video' ? draft.lastFrameAssetId : undefined,
                  target: m.id === 'image' || m.id === 'video' ? draft.target : undefined,
                  canvas: draft.canvas,
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
              onChange={(e) =>
                update({
                  modelId: e.target.value || undefined,
                  resolution: undefined,
                  aspectRatio: undefined,
                  generateAudio: undefined,
                  background: undefined,
                })
              }
            >
              <option value="">{defaultModel ? '默认 · ' + defaultModel.name : '选择模型'}</option>
              {models.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name} · {settings.providers.find((p) => p.id === m.providerId)?.name}
                </option>
              ))}
            </select>
          </label>

          {caps.hint && !isAnalysis && <p className="generation-model-hint">{caps.hint}</p>}

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
                rows={3}
                placeholder={mode.prompt}
                value={draft.prompt || ''}
                onChange={(e) => update({ prompt: e.target.value })}
              />
            </label>
          )}

          {(draft.use === 'image' || draft.use === 'video') && (
            <>
              <div className="generation-options">
                {caps.supportsResolution && caps.resolutions?.length ? (
                  <label className="field">
                    <span>清晰度</span>
                    <select
                      aria-label="清晰度"
                      value={draft.resolution || ''}
                      onChange={(e) => update({ resolution: e.target.value || undefined })}
                    >
                      <option value="">
                        默认{model?.parameters.resolution || model?.parameters.size ? ` · ${model?.parameters.resolution || model?.parameters.size}` : ''}
                      </option>
                      {caps.resolutions.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {caps.supportsAspectRatio && caps.aspectRatios?.length ? (
                  <label className="field">
                    <span>画幅比例</span>
                    <select
                      aria-label="画幅比例"
                      value={draft.aspectRatio || ''}
                      onChange={(e) => update({ aspectRatio: e.target.value || undefined })}
                    >
                      <option value="">
                        默认{model?.parameters.ratio || model?.parameters.aspect_ratio ? ` · ${model?.parameters.ratio || model?.parameters.aspect_ratio}` : ''}
                      </option>
                      {caps.aspectRatios.map((r) => (
                        <option key={r} value={r}>
                          {r === 'adaptive' ? 'adaptive (自适应)' : r}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {caps.supportsSizeInput && (!caps.supportsResolution || draft.use === 'image') && (
                  <label className="field">
                    <span>画面尺寸</span>
                    <input
                      aria-label="画面尺寸"
                      value={draft.size ?? ''}
                      placeholder={String(
                        model?.parameters.size ||
                          (model?.adapter === 'dashscope-image'
                            ? '例如 1280*720'
                            : '例如 1536x1024 或模型默认'),
                      )}
                      onChange={(e) => update({ size: e.target.value || undefined })}
                    />
                  </label>
                )}

                {draft.use === 'video' && (
                  <label className="field">
                    <span>
                      时长（秒）
                      {caps.durationRange ? ` ${caps.durationRange[0]}–${caps.durationRange[1]}` : ''}
                    </span>
                    <input
                      type="number"
                      min={caps.durationRange?.[0] || 1}
                      max={caps.durationRange?.[1] || 30}
                      step={1}
                      aria-label="视频时长"
                      value={draft.seconds ?? ''}
                      placeholder={String(model?.parameters.seconds || model?.parameters.duration || '模型默认')}
                      onChange={(e) => update({ seconds: Number(e.target.value) || undefined })}
                    />
                  </label>
                )}
              </div>

              {((draft.use === 'video' && caps.supportsAudioToggle) ||
                (draft.use === 'image' && caps.supportsTransparentBg)) && (
                <div className="generation-toggles">
                  {draft.use === 'video' && caps.supportsAudioToggle && (
                    <label className="generation-toggle">
                      <input
                        type="checkbox"
                        checked={audioChecked}
                        onChange={(e) => update({ generateAudio: e.target.checked })}
                      />
                      <span>原生音画同步（同时生成匹配音效/对白）</span>
                    </label>
                  )}
                  {draft.use === 'image' && caps.supportsTransparentBg && (
                    <label className="generation-toggle">
                      <input
                        type="checkbox"
                        checked={transparentChecked}
                        onChange={(e) => update({ background: e.target.checked ? 'transparent' : 'opaque' })}
                      />
                      <span>透明背景 PNG（可直接做前景贴片）</span>
                    </label>
                  )}
                </div>
              )}

              {/* Option B: Video First/Last Frame & Multi-Reference Picker */}
              {draft.use === 'video' && caps.supportsLastFrame && caps.maxReferences > 0 && (
                <div className="generation-media-refs">
                  <div className="generation-options">
                    <label className="field">
                      <span>首帧图{caps.requiresReference ? '（必填）' : '（可选）'}</span>
                      <select
                        aria-label="首帧参考图"
                        value={refs[0] || ''}
                        onChange={(e) => {
                          const nextFirst = e.target.value;
                          if (!nextFirst) {
                            setRefs(refs.slice(1));
                            if (lastFrameId) update({ lastFrameAssetId: undefined });
                          } else {
                            setRefs([nextFirst, ...refs.slice(1).filter((id) => id !== nextFirst)]);
                          }
                        }}
                      >
                        <option value="">无</option>
                        {imageAssets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>尾帧图（可选）</span>
                      <select
                        aria-label="尾帧参考图"
                        value={lastFrameId}
                        disabled={!refs[0]}
                        onChange={(e) => update({ lastFrameAssetId: e.target.value || undefined })}
                      >
                        <option value="">无</option>
                        {imageAssets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {caps.referenceMode === 'media-flex' && caps.maxReferences > 1 && !lastFrameId && (
                    <div className="generation-multi-ref">
                      <div className="generation-ref-header">
                        <span>
                          多主体参考图（可选，已选 {refs.length} / {caps.maxReferences} 张；选 2 张以上自动切为主体参考模式）
                        </span>
                      </div>
                      {refs.length > 0 && (
                        <div className="generation-ref-chips">
                          {refs.map((id, idx) => {
                            const asset = imageAssets.find((a) => a.id === id);
                            return (
                              <span key={id} className="generation-ref-chip">
                                <em>图{idx + 1}</em>
                                <span className="generation-ref-name">{asset?.name || id}</span>
                                <button
                                  type="button"
                                  aria-label={`移除参考图 ${idx + 1}`}
                                  onClick={() => setRefs(refs.filter((r) => r !== id))}
                                >
                                  <X size={11} />
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {refs.length < caps.maxReferences && imageAssets.some((a) => !refs.includes(a.id)) && (
                        <select
                          aria-label="添加更多参考图"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) setRefs([...refs, e.target.value]);
                          }}
                        >
                          <option value="">+ 添加参考图（{refs.length}/{caps.maxReferences}）</option>
                          {imageAssets
                            .filter((a) => !refs.includes(a.id))
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Option B: Multi-Reference Image / R2V Picker */}
              {!(draft.use === 'video' && caps.supportsLastFrame) &&
                caps.referenceMode === 'multi-ref' &&
                caps.maxReferences > 1 && (
                  <div className="generation-media-refs">
                    <div className="generation-multi-ref">
                      <div className="generation-ref-header">
                        <span>
                          参考图{caps.requiresReference ? '（至少 1 张）' : '（可选多图）'} · 已选 {refs.length} /{' '}
                          {caps.maxReferences}
                        </span>
                        {refs.length > 0 && (
                          <button type="button" className="text-button" onClick={() => setRefs([])}>
                            清空
                          </button>
                        )}
                      </div>
                      {refs.length > 0 && (
                        <div className="generation-ref-chips">
                          {refs.map((id, idx) => {
                            const asset = imageAssets.find((a) => a.id === id);
                            return (
                              <span key={id} className="generation-ref-chip">
                                <em>图{idx + 1}</em>
                                <span className="generation-ref-name">{asset?.name || id}</span>
                                <button
                                  type="button"
                                  aria-label={`移除参考图 ${idx + 1}`}
                                  onClick={() => setRefs(refs.filter((r) => r !== id))}
                                >
                                  <X size={11} />
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <select
                        aria-label="添加参考图"
                        value=""
                        disabled={refs.length >= caps.maxReferences || !imageAssets.some((a) => !refs.includes(a.id))}
                        onChange={(e) => {
                          if (e.target.value) setRefs([...refs, e.target.value]);
                        }}
                      >
                        <option value="">
                          {imageAssets.length === 0
                            ? '当前项目暂无图片素材'
                            : refs.length >= caps.maxReferences
                              ? `已达上限 (${caps.maxReferences} 张)`
                              : '+ 选择项目图片作为参考'}
                        </option>
                        {imageAssets
                          .filter((a) => !refs.includes(a.id))
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                )}

              {/* Standard Single Reference Picker */}
              {!(draft.use === 'video' && caps.supportsLastFrame) &&
                (caps.referenceMode === 'image-ref' || caps.referenceMode === 'first-frame') &&
                caps.maxReferences === 1 && (
                  <label className="field">
                    <span>
                      {caps.referenceMode === 'first-frame' ? '首帧图' : '参考图'}
                      {caps.requiresReference ? '（必填）' : '（可选）'}
                    </span>
                    <select
                      aria-label="参考图"
                      value={refs[0] || ''}
                      onChange={(e) => setRefs(e.target.value ? [e.target.value] : [])}
                    >
                      <option value="">无</option>
                      {imageAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
            </>
          )}

          {draft.use === 'speech' && (
            <div className="field">
              <span>音色</span>
              <input
                aria-label="配音音色"
                value={draft.voice ?? ''}
                placeholder={String(
                  model?.parameters.voice ||
                    (caps.voices?.length ? caps.voices.slice(0, 3).join(' / ') : '使用模型默认音色'),
                )}
                onChange={(e) => update({ voice: e.target.value || undefined })}
              />
              {caps.voices && caps.voices.length > 0 && (
                <div className="model-quick-chips" aria-label="快捷音色">
                  {caps.voices.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`model-quick-chip ${(draft.voice || model?.parameters.voice) === v ? 'active' : ''}`}
                      onClick={() => update({ voice: v })}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
