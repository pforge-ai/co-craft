import React, { useMemo, useState } from 'react';
import {
  Plus,
  Layers,
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  UserCheck,
  Lock,
  FileText,
  X,
} from 'lucide-react';
import { ShotCompositeThumb } from './ShotCompositeThumb';
import { createPresetClip } from '../core/presets';
import { clone, durationOf, newClip, timecode, uid } from '../core/project';
import {
  computeCompositeShots,
  moveCompositeShotOperations,
  scriptOutlineToShotOperations,
  updateShotNotesOperations,
  updateShotScriptOperations,
  updateSingleCaptionTextOperations,
  type CompositeShot,
} from '../core/storyboard';
import { inferAssetRole } from '../core/taxonomy';
import type {
  Clip,
  ClipTake,
  EditOperation,
  GenerationTarget,
  Project,
  Sequence,
  ShotBinding,
} from '../core/types';

interface StoryboardStudioProps {
  project: Project;
  sequence: Sequence;
  selectedClipId: string | null;
  previewOrigin: string;
  onSelectClip: (id: string) => void;
  onSeek: (frame: number) => void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
  onAskAgentForShot?: (clip: Clip, prompt: string) => void;
  onOpenGenerationForShot?: (prompt: string, referenceAssetId?: string, target?: GenerationTarget) => void;
}

export function StoryboardStudio({
  project,
  sequence,
  selectedClipId,
  previewOrigin,
  onSelectClip,
  onSeek,
  onEdit,
  onAskAgentForShot,
  onOpenGenerationForShot,
}: StoryboardStudioProps) {
  const [takeMenuFor, setTakeMenuFor] = useState<string | null>(null);
  const [showOutlineDrawer, setShowOutlineDrawer] = useState(false);
  const [outlineDraft, setOutlineDraft] = useState('');

  const compositeShots = useMemo(() => computeCompositeShots(sequence), [sequence]);

  const subjectEntities = useMemo(
    () =>
      (project.vault || []).filter((v) => {
        const r = inferAssetRole(v);
        return r === 'character' || r === 'product' || r === 'environment';
      }),
    [project.vault],
  );

  async function addCandidateTake(
    shot: CompositeShot,
    variant: 'clone' | 'teardown-3d' | 'seecode-architecture' | 'tinycharts-state' | 'screen-focus-rig',
  ) {
    const clip = shot.anchorClip;
    const nextIdx = (clip.takes?.length ? clip.takes.length : 1) + 1;
    let take: ClipTake;
    if (variant === 'clone') {
      take = {
        id: uid('take'),
        label: `候选 ${nextIdx} · 调整副本`,
        kind: clip.kind,
        sourceIn: clip.sourceIn,
        assetId: clip.assetId,
        componentId: clip.componentId,
        props: clone(clip.props),
        createdAt: new Date().toISOString(),
      };
    } else {
      const presetClip = createPresetClip(
        variant,
        clip.start,
        sequence.fps,
        {
          text: shot.scriptText.slice(0, 22) || String(clip.props.text || clip.name),
        },
        project,
      );
      const labelTag =
        variant === 'teardown-3d'
          ? '三维结构'
          : variant === 'seecode-architecture'
            ? '流程数据图解'
            : variant === 'tinycharts-state'
              ? '手绘白板'
              : '设备外壳特写';
      take = {
        id: uid('take'),
        label: `候选 ${nextIdx} · ${labelTag}`,
        kind: presetClip.kind,
        sourceIn: 0,
        props: clone(presetClip.props),
        createdAt: new Date().toISOString(),
      };
    }
    setTakeMenuFor(null);
    await onEdit(`为镜头 #${shot.index} 新增${take.label}`, [
      { type: 'addClipTake', sequenceId: sequence.id, clipId: clip.id, take, activate: true },
    ]);
    onSelectClip(clip.id);
    onSeek(shot.start + Math.min(shot.duration - 1, Math.round(sequence.fps * 0.8)));
  }

  async function moveShotOrder(shot: CompositeShot, delta: -1 | 1) {
    const ops = moveCompositeShotOperations(sequence, compositeShots, shot.id, delta);
    if (!ops.length) return;
    await onEdit('调整镜头顺序（同步画面与字幕）', ops);
  }

  async function appendNewShot(presetId?: string) {
    const tail = sequence.clips.length
      ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
      : 0;
    const clip: Clip = presetId
      ? createPresetClip(presetId, tail, sequence.fps, {}, project)
      : {
          ...newClip('title', tail),
          track: 'visual',
          name: `镜头 ${String(compositeShots.length + 1).padStart(2, '0')}`,
          duration: Math.round(sequence.fps * 4),
          props: {
            text: `镜头 ${compositeShots.length + 1} · 待生产画面`,
            subtitle: '可写旁白、绑定主体状态并生成多个候选版本',
            fontSize: 58,
            color: '#e2e8f0',
            background: '#0f172a',
            position: 'center',
            align: 'center',
            animation: 'fade',
          },
        };
    clip.track = 'visual';
    await onEdit(`新增镜头 #${compositeShots.length + 1}`, [{ type: 'addClip', sequenceId: sequence.id, clip }]);
    onSelectClip(clip.id);
    onSeek(clip.start);
  }

  function resolveBindingPromptAndRef(binding?: ShotBinding): { text: string; refAssetId?: string } {
    if (!binding?.entityId) return { text: '' };
    const ent = subjectEntities.find((e) => e.id === binding.entityId);
    if (!ent) return { text: '' };
    const variant =
      ent.variants?.find((vr) => vr.id === binding.variantId) ||
      ent.variants?.find((vr) => vr.id === ent.defaultVariantId) ||
      ent.variants?.[0];
    const desc = [ent.promptAnchor, variant?.promptDelta].filter(Boolean).join('；');
    const tagPart = variant ? `:${variant.name}` : '';
    return {
      text: `@${ent.name}${tagPart}（特征锁定：${desc || ent.name}）`,
      refAssetId: variant?.assetId || ent.assetId,
    };
  }

  return (
    <div className="storyboard-studio compact">
      <div className="sb-compact-actions">
        <span>
          共 {compositeShots.length} 个分镜 · {(durationOf(sequence) / sequence.fps).toFixed(1)}s
        </span>
        <div className="sb-compact-btns">
          <button type="button" className="button tiny subtle" onClick={() => setShowOutlineDrawer((v) => !v)}>
            <FileText size={12} /> 拆镜
          </button>
          <button type="button" className="button tiny subtle" onClick={() => void appendNewShot()}>
            <Plus size={12} /> 新增空白镜
          </button>
          <button
            type="button"
            className="button tiny primary"
            onClick={() => void appendNewShot('seecode-architecture')}
          >
            <Plus size={12} /> 图解镜
          </button>
        </div>
      </div>

      {/* Script Outline -> Shots Drawer */}
      {showOutlineDrawer && (
        <form
          className="sb-outline-drawer"
          onSubmit={async (e) => {
            e.preventDefault();
            const ops = scriptOutlineToShotOperations(sequence, outlineDraft);
            if (!ops.length) return;
            await onEdit('从文稿提纲拆解生成分镜卡', ops);
            setOutlineDraft('');
            setShowOutlineDrawer(false);
          }}
        >
          <div className="sb-outline-head">
            <b>粘贴多行口播文稿或分镜提纲（每行自动生成一张带同步字幕的合成镜头卡）</b>
            <button type="button" className="icon-button tiny" onClick={() => setShowOutlineDrawer(false)}>
              <X size={14} />
            </button>
          </div>
          <textarea
            rows={4}
            aria-label="分镜提纲内容"
            placeholder={
              '第一镜：展示传统剪辑需要来回切换四五个工具的痛点\n第二镜：拖入界面录屏，自动套上圆角窗口并平滑放大点击位置\n第三镜：对比处理耗时从 2 小时缩短到 10 分钟的关键指标'
            }
            value={outlineDraft}
            onChange={(e) => setOutlineDraft(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="submit" className="button tiny primary" disabled={!outlineDraft.trim()}>
              一键拆解生成分镜
            </button>
          </div>
        </form>
      )}

      {compositeShots.length === 0 ? (
        <div className="sb-empty-state">
          <Layers size={28} />
          <h3>当前成片分支还没有镜头</h3>
          <p>点击上方「从文稿拆解分镜」批量生成镜头序列，或直接新增第一个镜头。</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="button" onClick={() => setShowOutlineDrawer(true)}>
              <FileText size={14} /> 粘贴文稿拆解分镜
            </button>
            <button type="button" className="button primary" onClick={() => void appendNewShot()}>
              <Plus size={14} /> 新建第一个镜头
            </button>
          </div>
        </div>
      ) : (
        <div className="storyboard-grid">
          {compositeShots.map((shot) => {
            const c = shot.anchorClip;
            const takes = c.takes || [];
            const primaryBinding = shot.bindings[0];
            const boundEntity = primaryBinding
              ? subjectEntities.find((e) => e.id === primaryBinding.entityId)
              : undefined;
            const isSelected = shot.compositeClips.some((m) => m.id === selectedClipId);

            return (
              <article
                key={shot.id}
                data-shot-id={shot.id}
                className={`shot-card ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onSelectClip(c.id);
                  onSeek(shot.start);
                }}
              >
                {/* Composite Visual Preview */}
                <div className="shot-preview">
                  <ShotCompositeThumb
                    project={project}
                    sequence={sequence}
                    shot={shot}
                    previewOrigin={previewOrigin}
                  />

                  <span className="shot-index">镜头 {String(shot.index).padStart(2, '0')}</span>
                  {shot.compositeClips.length > 1 && (
                    <span className="shot-track-pill">{shot.compositeClips.length} 层合成</span>
                  )}
                  {shot.audioClips.length > 0 && (
                    <span className="shot-track-pill audio" title="随镜移动的声音片段">
                      +{shot.audioClips.length} 随镜音
                    </span>
                  )}
                  {shot.locked && (
                    <span className="shot-lock-pill" title="已锁定版本保护">
                      <Lock size={11} />
                    </span>
                  )}
                </div>

                {/* Shot Body */}
                <div className="shot-body">
                  <div className="shot-title-row">
                    <b title={c.name}>{c.name}</b>
                    <small>
                      {timecode(shot.start, sequence.fps)} · {(shot.duration / sequence.fps).toFixed(1)}s
                    </small>
                  </div>

                  {/* Inline Narration / Timed Per-Line Subtitles (Review #4: preserve individual SRT timing!) */}
                  {shot.captionClips.length >= 2 ? (
                    <div className="shot-timed-captions" onClick={(e) => e.stopPropagation()}>
                      <div className="shot-timed-head">
                        <span>已对时字幕（{shot.captionClips.length} 句 · 逐句改字不改时码）</span>
                        {!shot.locked && (
                          <button
                            type="button"
                            className="text-button"
                            title="将这几句合并重写为一条整镜字幕"
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
                          <span className="shot-timed-tc">
                            {timecode(cap.start, sequence.fps)}–{timecode(cap.start + cap.duration, sequence.fps)}
                          </span>
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
                        placeholder="本镜旁白备注（不影响上方逐句字幕时码）…"
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
                      className="shot-script-input"
                      rows={2}
                      aria-label={`镜头 ${shot.index} 旁白与字幕`}
                      placeholder="输入本镜旁白台词或字幕（失焦自动同步至字幕轨）…"
                      defaultValue={shot.scriptText}
                      disabled={shot.locked}
                      onClick={(e) => e.stopPropagation()}
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

                  {/* Multi-Take Switcher & Inline Producer */}
                  <div className="shot-takes-bar" onClick={(e) => e.stopPropagation()}>
                    {takes.length > 0 ? (
                      takes.map((t, tIdx) => {
                        const active = c.activeTakeId === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={`take-pill ${active ? 'active' : ''}`}
                            title={t.label}
                            disabled={c.locked}
                            onClick={() =>
                              void onEdit(`切换镜头 #${shot.index} 至「${t.label}」`, [
                                { type: 'switchClipTake', sequenceId: sequence.id, clipId: c.id, takeId: t.id },
                              ])
                            }
                          >
                            {active && <Check size={10} />} 候选 {tIdx + 1}
                          </button>
                        );
                      })
                    ) : (
                      <span className="take-hint">当前 1 个版本</span>
                    )}

                    {!c.locked && (
                      <div className="take-add-wrap">
                        <button
                          type="button"
                          className="take-add-btn"
                          aria-label={`为镜头 ${shot.index} 生产新候选`}
                          onClick={() => setTakeMenuFor(takeMenuFor === shot.id ? null : shot.id)}
                        >
                          <Plus size={11} /> 生产候选
                        </button>
                        {takeMenuFor === shot.id && (
                          <div className="take-popover" role="menu">
                            <button type="button" onClick={() => void addCandidateTake(shot, 'seecode-architecture')}>
                              + 流程与数据图解候选
                            </button>
                            <button type="button" onClick={() => void addCandidateTake(shot, 'tinycharts-state')}>
                              + 手绘白板推演候选
                            </button>
                            <button type="button" onClick={() => void addCandidateTake(shot, 'teardown-3d')}>
                              + 三维空间拆解候选
                            </button>
                            <button type="button" onClick={() => void addCandidateTake(shot, 'screen-focus-rig')}>
                              + 设备外壳特写候选
                            </button>
                            <button type="button" onClick={() => void addCandidateTake(shot, 'clone')}>
                              克隆当前作为调整副本
                            </button>
                            {onOpenGenerationForShot && (
                              <button
                                type="button"
                                onClick={() => {
                                  setTakeMenuFor(null);
                                  const resolved = resolveBindingPromptAndRef(primaryBinding);
                                  const genPrompt = [shot.scriptText || c.name, resolved.text]
                                    .filter(Boolean)
                                    .join('，');
                                  onOpenGenerationForShot(genPrompt, resolved.refAssetId, {
                                    sequenceId: sequence.id,
                                    clipId: c.id,
                                    shotLabel: `镜头 #${shot.index} · ${c.name}`,
                                    mode: 'take',
                                  });
                                }}
                              >
                                <Sparkles size={12} /> AI 生图/生视频候选（带入绑定主体）
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* @Entity:Variant Consistency Binding + Reorder + Agent */}
                  <div className="shot-meta-controls" onClick={(e) => e.stopPropagation()}>
                    {subjectEntities.length > 0 && (
                      <div className="shot-binding-row">
                        <label className="shot-subject-select">
                          <UserCheck size={11} />
                          <select
                            aria-label={`镜头 ${shot.index} 绑定主体`}
                            value={primaryBinding?.entityId || ''}
                            disabled={c.locked}
                            onChange={(e) => {
                              const entId = e.target.value;
                              const ent = subjectEntities.find((x) => x.id === entId);
                              const nextBindings: ShotBinding[] = ent
                                ? [
                                    {
                                      entityId: ent.id,
                                      variantId: ent.defaultVariantId || ent.variants?.[0]?.id,
                                      pinnedVersion: ent.version,
                                    },
                                  ]
                                : [];
                              void onEdit('更新镜头主体绑定', [
                                {
                                  type: 'updateClip',
                                  sequenceId: sequence.id,
                                  clipId: c.id,
                                  changes: {
                                    subjectBindings: nextBindings,
                                    subjectIds: ent ? [ent.id] : [],
                                  },
                                },
                              ]);
                            }}
                          >
                            <option value="">@绑定角色 / 产品 / 环境…</option>
                            {subjectEntities.map((s) => (
                              <option key={s.id} value={s.id}>
                                @{s.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        {/* State Variant Selector when bound entity has multiple states */}
                        {boundEntity && boundEntity.variants && boundEntity.variants.length > 0 && (
                          <select
                            className="shot-variant-select"
                            aria-label={`选择 ${boundEntity.name} 的状态分支`}
                            value={primaryBinding?.variantId || boundEntity.variants[0].id}
                            disabled={c.locked}
                            onChange={(e) => {
                              const nextBindings: ShotBinding[] = [
                                {
                                  entityId: boundEntity.id,
                                  variantId: e.target.value,
                                  pinnedVersion: boundEntity.version,
                                },
                              ];
                              void onEdit(`切换镜头主体状态为 ${boundEntity.name}`, [
                                {
                                  type: 'updateClip',
                                  sequenceId: sequence.id,
                                  clipId: c.id,
                                  changes: { subjectBindings: nextBindings },
                                },
                              ]);
                            }}
                          >
                            {boundEntity.variants.map((vr) => (
                              <option key={vr.id} value={vr.id}>
                                状态：{vr.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    <div className="shot-foot-actions">
                      <div className="shot-order-btns">
                        <button
                          type="button"
                          className="icon-button tiny"
                          aria-label="前移镜头"
                          disabled={shot.locked || shot.index === 1}
                          onClick={() => void moveShotOrder(shot, -1)}
                        >
                          <ArrowLeft size={12} />
                        </button>
                        <button
                          type="button"
                          className="icon-button tiny"
                          aria-label="后移镜头"
                          disabled={shot.locked || shot.index === compositeShots.length}
                          onClick={() => void moveShotOrder(shot, 1)}
                        >
                          <ArrowRight size={12} />
                        </button>
                      </div>

                      {onAskAgentForShot && !c.locked && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            const resolved = resolveBindingPromptAndRef(primaryBinding);
                            const contextParts = [
                              `请针对镜头 #${shot.index}「${c.name}」`,
                              shot.scriptText ? `（台词：「${shot.scriptText}」）` : '',
                              resolved.text ? `（引用主体 ${resolved.text}）` : '',
                              '生产或优化本镜的画面候选：',
                            ].filter(Boolean);
                            onAskAgentForShot(c, contextParts.join(''));
                          }}
                        >
                          <Sparkles size={11} /> Agent 定制此镜
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
