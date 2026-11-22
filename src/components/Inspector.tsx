import React, { useEffect, useRef, useState } from 'react';
import {
  Lock,
  Unlock,
  Copy,
  Trash2,
  Code2,
  AlertTriangle,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Bold,
  Italic,
  Underline,
  Plus,
  Minus,
  RotateCcw,
  AtSign,
  BookmarkPlus,
  Scissors,
} from 'lucide-react';
import type { Clip, Sequence, Project, EditOperation, TransitionType, KeyframeProperty } from '../core/types';
import { uid, clone, detachAudioFromClipOperations } from '../core/project';
import { upsertClipKeyframe } from '../core/keyframes';
import type { PlayheadClock } from '../lib/playheadClock';
import { mediaUrl } from '../composition/Film';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import { KeyframeSection } from './KeyframeSection';
import { PresetControls, ParameterControls } from './PresetControls';
import { BUILT_IN_TRANSITIONS, getPreset } from '../core/presets';
import { pointerDrag } from '../lib/pointerDrag';
import { IconButton } from './ui';

const ASPECT_PRESETS = [
  { id: 'landscape', label: '16:9 横屏', width: 1920, height: 1080 },
  { id: 'portrait', label: '9:16 竖屏', width: 1080, height: 1920 },
  { id: 'square', label: '1:1 方屏', width: 1080, height: 1080 },
];

const BLEND_MODES = [
  { value: 'normal', label: '正常' },
  { value: 'screen', label: '滤色 Screen' },
  { value: 'multiply', label: '正片叠底 Multiply' },
  { value: 'overlay', label: '叠加 Overlay' },
  { value: 'lighten', label: '变亮 Lighten' },
];

const TEXT_ANIMS_IN = [
  { id: 'none', label: '无' },
  { id: 'fade', label: '渐显' },
  { id: 'rise', label: '上浮' },
  { id: 'pop', label: '弹入' },
  { id: 'blur-in', label: '柔焦' },
  { id: 'type', label: '打字' },
];

const TEXT_ANIMS_OUT = [
  { id: 'none', label: '无出场' },
  { id: 'fade', label: '渐隐淡出' },
  { id: 'sink', label: '下沉收尾' },
];

function ScrubInput({
  prefix,
  label,
  value,
  suffix,
  min,
  max,
  step = 1,
  disabled = false,
  onCommit,
}: {
  prefix: string;
  label: string;
  value: number;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const clampVal = (v: number) => {
    let n = v;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return step < 1 ? Math.round(n * 100) / 100 : Math.round(n);
  };

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      const clamped = clampVal(parsed);
      setDraft(String(clamped));
      if (clamped !== value) onCommit(clamped);
    } else {
      setDraft(String(value));
    }
  };

  const startScrub = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    e.stopPropagation();
    const startX = e.clientX;
    const base = value;
    let latest = value;
    cleanupRef.current?.();
    cleanupRef.current = pointerDrag(
      e,
      (cx) => {
        const delta = cx - startX;
        const speed = step < 1 ? step * 0.5 : step;
        latest = clampVal(base + Math.round(delta * 0.5) * speed);
        setDraft(String(latest));
      },
      () => {
        if (latest !== value) onCommit(latest);
      },
      'ew-resize',
    );
  };

  return (
    <div className={`ins-scrub ${disabled ? 'disabled' : ''}`}>
      <span
        className="ins-scrub-prefix"
        title={`左右拖动调整${label}`}
        onPointerDown={startScrub}
      >
        {prefix}
      </span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        disabled={disabled}
        value={draft}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setFocused(false);
            commit(draft);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setFocused(false);
            setDraft(String(value));
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const next = clampVal(value + delta);
            setDraft(String(next));
            onCommit(next);
          }
        }}
      />
      {suffix && <span className="ins-scrub-unit">{suffix}</span>}
    </div>
  );
}

function CompactSliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  defaultValue = 0,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  defaultValue?: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const latestRef = useRef<number>(value);

  useEffect(() => {
    if (!draggingRef.current) {
      setDraft(null);
      latestRef.current = value;
    }
  }, [value]);

  const shown = draft ?? value;
  const commit = () => {
    draggingRef.current = false;
    const next = latestRef.current;
    setDraft(null);
    if (next !== value) onChange(next);
  };

  return (
    <div className="ins-slider-row">
      <span
        className="ins-slider-label"
        title="双击恢复默认"
        onDoubleClick={() => {
          if (!disabled) {
            draggingRef.current = false;
            setDraft(null);
            onChange(defaultValue);
          }
        }}
      >
        {label}
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={shown}
        onDoubleClick={() => {
          if (!disabled) {
            draggingRef.current = false;
            setDraft(null);
            onChange(defaultValue);
          }
        }}
        onPointerDown={() => {
          draggingRef.current = true;
          latestRef.current = shown;
        }}
        onChange={(e) => {
          const next = Number(e.target.value);
          latestRef.current = next;
          if (draggingRef.current) setDraft(next);
          else onChange(next);
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onBlur={() => {
          if (draggingRef.current) commit();
        }}
      />
      <span className="ins-slider-val">
        {shown}
        {suffix}
      </span>
    </div>
  );
}

function normalizeHex6(raw: string): string {
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7).toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s))
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  return '#ffffff';
}

function ColorHexInput({
  label,
  value,
  disabled,
  editableHex = false,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  editableHex?: boolean;
  onChange: (hex: string) => void;
}) {
  const safeHex = normalizeHex6(value);
  return (
    <div className="ins-color-pill">
      <input
        type="color"
        aria-label={label}
        disabled={disabled}
        value={safeHex}
        onChange={(e) => onChange(e.target.value)}
      />
      {editableHex ? (
        <input
          type="text"
          aria-label={`${label} Hex`}
          disabled={disabled}
          maxLength={7}
          defaultValue={safeHex.toUpperCase()}
          key={safeHex}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            background: 'transparent',
            fontFamily: 'var(--mono)',
            fontSize: 10.5,
            color: 'var(--text)',
            padding: 0,
            height: '100%',
            minHeight: 0,
          }}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v) && v.toLowerCase() !== safeHex) {
              onChange(v.toLowerCase());
            } else {
              e.currentTarget.value = safeHex.toUpperCase();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      ) : (
        <span>{safeHex.toUpperCase()}</span>
      )}
    </div>
  );
}

function PropToggleSection({
  title,
  enabled,
  disabled,
  onToggle,
  children,
}: {
  title: string;
  enabled: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <section className="ins-sec">
      <div className="ins-sec-head">
        <h4>{title}</h4>
        <button
          type="button"
          className="ins-icon-btn"
          disabled={disabled}
          aria-label={enabled ? `关闭${title}` : `启用${title}`}
          title={enabled ? `移除${title}` : `添加${title}`}
          onClick={() => onToggle(!enabled)}
        >
          {enabled ? <Minus size={11} /> : <Plus size={11} />}
        </button>
      </div>
      {enabled && <div className="ins-sec-body">{children}</div>}
    </section>
  );
}

export const Inspector = React.memo(function Inspector({
  clip,
  selectedClipIds = [],
  sequence,
  project,
  previewOrigin = '',
  playheadClock,
  onSeek,
  onSelectClip,
  onEdit,
  onReference,
  onSaveAsAsset,
  onCode,
  onRelink,
  onClearSelect,
}: {
  clip: Clip | undefined;
  selectedClipIds?: string[];
  sequence: Sequence;
  project: Project;
  previewOrigin?: string;
  playheadClock?: PlayheadClock;
  onSeek?: (frame: number) => void;
  onSelectClip?: (clipId: string) => void;
  onEdit: (name: string, ops: EditOperation[]) => void;
  onReference: () => void;
  onSaveAsAsset?: () => void;
  onCode: () => void;
  onRelink?: (assetId: string) => void;
  onClearSelect?: () => void;
}) {
  const [textTab, setTextTab] = useState<'style' | 'motion'>('style');
  const [mediaTab, setMediaTab] = useState<'frame' | 'adjust' | 'audio'>('frame');
  const [presetTab, setPresetTab] = useState<'params' | 'transform'>('params');

  useEffect(() => {
    if (clip?.kind === 'image' && mediaTab === 'audio') {
      setMediaTab('frame');
    }
  }, [clip?.id, clip?.kind, mediaTab]);

  if (!clip) {
    const hasLocked = sequence.clips.some((c) => c.locked);
    return (
      <div className="inspector canvas-inspector compact">
        <div className="inspector-title">
          <div>
            <span className="eyebrow">成片画布</span>
            <h3>{sequence.name}</h3>
          </div>
        </div>
        <section className="ins-sec">
          <div className="ins-sec-head">
            <h4>画幅比例与分辨率</h4>
            <span className="ins-mono-meta">
              {sequence.width}×{sequence.height} · {sequence.fps}fps
            </span>
          </div>
          <div className="aspect-pills" role="group" aria-label="画幅比例">
            {ASPECT_PRESETS.map((ap) => {
              const active = sequence.width === ap.width && sequence.height === ap.height;
              return (
                <button
                  key={ap.id}
                  type="button"
                  className={`aspect-pill ${active ? 'active' : ''}`}
                  disabled={hasLocked}
                  title={hasLocked ? '当前序列含锁定片段，请先解锁再调整画幅' : `${ap.width} × ${ap.height}`}
                  onClick={() =>
                    onEdit(`切换画幅为 ${ap.label}`, [
                      {
                        type: 'updateSequence',
                        sequenceId: sequence.id,
                        changes: { width: ap.width, height: ap.height },
                      },
                    ])
                  }
                >
                  {ap.label}
                </button>
              );
            })}
          </div>
          {hasLocked && <p className="inspector-hint">序列包含已锁定片段，解锁后可修改画幅或底色。</p>}
        </section>

        <section className="ins-sec">
          <div className="ins-sec-head">
            <h4>画布底色</h4>
            <span className="ins-mono-meta">{sequence.clips.length} 片段</span>
          </div>
          <div className="ins-canvas-bg-row">
            <ColorHexInput
              label="画布底色"
              editableHex
              disabled={hasLocked}
              value={sequence.background || '#10161c'}
              onChange={(hex) =>
                onEdit('更新画布底色', [
                  {
                    type: 'updateSequence',
                    sequenceId: sequence.id,
                    changes: { background: hex },
                  },
                ])
              }
            />
          </div>
        </section>
      </div>
    );
  }

  const update = (changes: Partial<Clip>, name = '调整片段') =>
    onEdit(name, [{ type: 'updateClip', sequenceId: sequence.id, clipId: clip.id, changes }]);
  const prop = (key: string, value: unknown) => {
    const kfTrack = clip.keyframes?.[key as KeyframeProperty];
    if (kfTrack && kfTrack.length > 0 && typeof value === 'number' && Number.isFinite(value)) {
      const rawLocal = (playheadClock?.get() ?? clip.start) - clip.start;
      const localFrame = Math.max(0, Math.min(Math.max(0, clip.duration - 1), rawLocal));
      const existingAtFrame = kfTrack.find((k) => k.frame === localFrame);
      const nextKf = upsertClipKeyframe(
        clip.keyframes,
        key as KeyframeProperty,
        localFrame,
        value,
        existingAtFrame?.easing || 'ease-in-out',
      );
      update({ props: { [key]: value }, keyframes: nextKf }, '更新关键帧 · ' + clip.name);
      return;
    }
    update({ props: { [key]: value } }, '调整' + clip.name);
  };
  const propsPatch = (patch: Record<string, unknown>, label = '调整' + clip.name) =>
    update({ props: patch }, label);

  const isText = clip.kind === 'title' || clip.kind === 'caption';
  const isMedia = ['image', 'video'].includes(clip.kind);
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const component = project.components.find((c) => c.id === clip.componentId);
  const overlaps = sequence.clips.filter(
    (other) =>
      other.id !== clip.id &&
      other.track === clip.track &&
      other.start < clip.start + clip.duration &&
      other.start + other.duration > clip.start,
  );
  const preset = getPreset(String(clip.props.presetId || ''));

  const curX = Number(clip.props.x || 0);
  const curY = Number(clip.props.y || 0);
  const curScale = Math.round(Number(clip.props.scale ?? 1) * 100);
  const curRot = Math.round(Number(clip.props.rotation || 0));
  const curOpacity = Math.round(Number(clip.props.opacity ?? 1) * 100);

  const alignHorizontal = (dir: 'left' | 'center' | 'right') => {
    if (!preset && isText) {
      propsPatch({ align: dir, x: 0 }, '对齐方式');
    } else {
      const s = Number(clip.props.scale ?? 1);
      const offset = dir === 'center' ? 0 : Math.round((sequence.width * Math.max(0.2, 1 - s)) / 2) * (dir === 'left' ? -1 : 1);
      prop('x', offset);
    }
  };

  const alignVertical = (dir: 'top' | 'center' | 'bottom') => {
    if (!preset && isText) {
      propsPatch({ position: dir, y: 0 }, '垂直位置');
    } else {
      const s = Number(clip.props.scale ?? 1);
      const offset = dir === 'center' ? 0 : Math.round((sequence.height * Math.max(0.2, 1 - s)) / 2) * (dir === 'top' ? -1 : 1);
      prop('y', offset);
    }
  };

  const renderAlignAndTransform = (allowFlipScale = true) => (
    <section className="ins-sec">
      <div className="ins-sec-head">
        <h4>变换与对齐</h4>
        {(curX !== 0 || curY !== 0 || curScale !== 100 || curRot !== 0) && !clip.locked && (
          <button
            type="button"
            className="ins-icon-btn"
            title="重置变换"
            onClick={() => propsPatch({ x: 0, y: 0, scale: 1, rotation: 0 }, '重置变换')}
          >
            <RotateCcw size={10} />
          </button>
        )}
      </div>
      <div className="ins-align-bar" role="group" aria-label="画布对齐">
        <button
          type="button"
          disabled={clip.locked}
          title="左对齐"
          aria-label="左对齐"
          onClick={() => alignHorizontal('left')}
        >
          <AlignStartVertical size={12} />
        </button>
        <button
          type="button"
          disabled={clip.locked}
          title="水平居中"
          aria-label="水平居中"
          onClick={() => alignHorizontal('center')}
        >
          <AlignCenterVertical size={12} />
        </button>
        <button
          type="button"
          disabled={clip.locked}
          title="右对齐"
          aria-label="右对齐"
          onClick={() => alignHorizontal('right')}
        >
          <AlignEndVertical size={12} />
        </button>
        <span className="ins-align-sep" />
        <button
          type="button"
          disabled={clip.locked}
          title="顶对齐"
          aria-label="顶对齐"
          onClick={() => alignVertical('top')}
        >
          <AlignStartHorizontal size={12} />
        </button>
        <button
          type="button"
          disabled={clip.locked}
          title="垂直居中"
          aria-label="垂直居中"
          onClick={() => alignVertical('center')}
        >
          <AlignCenterHorizontal size={12} />
        </button>
        <button
          type="button"
          disabled={clip.locked}
          title="底对齐"
          aria-label="底对齐"
          onClick={() => alignVertical('bottom')}
        >
          <AlignEndHorizontal size={12} />
        </button>
      </div>
      <div className="ins-grid-2">
        <ScrubInput
          prefix="X"
          label="水平偏移"
          value={curX}
          suffix="px"
          disabled={clip.locked}
          onCommit={(v) => prop('x', v)}
        />
        <ScrubInput
          prefix="Y"
          label="垂直偏移"
          value={curY}
          suffix="px"
          disabled={clip.locked}
          onCommit={(v) => prop('y', v)}
        />
        {allowFlipScale && (
          <ScrubInput
            prefix="S"
            label="缩放"
            value={curScale}
            suffix="%"
            min={15}
            max={400}
            disabled={clip.locked}
            onCommit={(v) => prop('scale', v / 100)}
          />
        )}
        <ScrubInput
          prefix="R"
          label="旋转角度"
          value={curRot}
          suffix="°"
          min={-360}
          max={360}
          disabled={clip.locked}
          onCommit={(v) => prop('rotation', v)}
        />
      </div>
    </section>
  );

  const renderOpacityAndBlend = () => (
    <section className="ins-sec">
      <h4>混合与不透明度</h4>
      <CompactSliderRow
        label="不透明度"
        value={curOpacity}
        min={0}
        max={100}
        defaultValue={100}
        suffix="%"
        disabled={clip.locked}
        onChange={(v) => prop('opacity', v / 100)}
      />
      <div className="ins-inline-row">
        <span>混合</span>
        <select
          aria-label="混合模式"
          value={String(clip.props.blendMode || 'normal')}
          disabled={clip.locked}
          onChange={(e) => prop('blendMode', e.target.value)}
        >
          {BLEND_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );

  const renderTransitionSection = () => (
    <section className="ins-sec">
      <h4>入场转场</h4>
      <div className="ins-inline-row">
        <span>效果</span>
        <select
          aria-label="入场转场类型"
          value={clip.transitionIn?.type || ''}
          disabled={clip.locked}
          onChange={(e) => {
            const nextType = e.target.value as TransitionType | '';
            if (!nextType) {
              update({ transitionIn: null }, `移除「${clip.name}」转场`);
              return;
            }
            const meta = BUILT_IN_TRANSITIONS.find((t) => t.id === nextType);
            const frames =
              clip.transitionIn?.durationFrames ||
              Math.max(3, Math.min(clip.duration, Math.round((meta?.defaultSeconds || 0.6) * sequence.fps)));
            update(
              { transitionIn: { type: nextType, durationFrames: frames } },
              `设置入场转场：${meta?.name || nextType}`,
            );
          }}
        >
          <option value="">无转场</option>
          {BUILT_IN_TRANSITIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {clip.transitionIn && (
        <ScrubInput
          prefix="时长"
          label="转场时长"
          value={Number((clip.transitionIn.durationFrames / sequence.fps).toFixed(2))}
          suffix="s"
          step={0.1}
          min={0.2}
          max={Math.min(2, Number((clip.duration / sequence.fps).toFixed(2)))}
          disabled={clip.locked}
          onCommit={(v) => {
            const nextFrames = Math.max(1, Math.min(clip.duration, Math.round(v * sequence.fps)));
            update(
              { transitionIn: { type: clip.transitionIn!.type, durationFrames: nextFrames } },
              '调整转场时长',
            );
          }}
        />
      )}
    </section>
  );

  const renderTimeAndLayer = () => (
    <section className="ins-sec">
      <div className="ins-sec-head">
        <h4>时间与层级</h4>
        {overlaps.length > 0 && clip.kind !== 'audio' && (
          <div className="ins-mini-seg">
            <button
              type="button"
              disabled={clip.locked}
              title="置于最前"
              onClick={() =>
                update(
                  { layer: Math.max(clip.layer ?? 0, ...overlaps.map((c) => c.layer ?? 0)) + 1 },
                  '置于最前',
                )
              }
            >
              置顶
            </button>
            <button
              type="button"
              disabled={clip.locked}
              title="置于最后"
              onClick={() =>
                update(
                  { layer: Math.min(clip.layer ?? 0, ...overlaps.map((c) => c.layer ?? 0)) - 1 },
                  '置于最后',
                )
              }
            >
              置底
            </button>
          </div>
        )}
      </div>
      <div className="ins-grid-2">
        <ScrubInput
          prefix="入"
          label="开始时间"
          value={Number((clip.start / sequence.fps).toFixed(2))}
          suffix="s"
          step={0.1}
          min={0}
          disabled={clip.locked}
          onCommit={(v) => update({ start: Math.max(0, Math.round(v * sequence.fps)) })}
        />
        <ScrubInput
          prefix="长"
          label="持续时长"
          value={Number((clip.duration / sequence.fps).toFixed(2))}
          suffix="s"
          step={0.1}
          min={Number((1 / sequence.fps).toFixed(2))}
          disabled={clip.locked}
          onCommit={(v) => update({ duration: Math.max(1, Math.round(v * sequence.fps)) })}
        />
      </div>
      {isMedia && clip.kind !== 'image' && (
        <ScrubInput
          prefix="源"
          label="原素材入点"
          value={Number((clip.sourceIn / sequence.fps).toFixed(2))}
          suffix="s"
          step={0.1}
          min={0}
          disabled={clip.locked}
          onCommit={(v) => update({ sourceIn: Math.max(0, Math.round(v * sequence.fps)) })}
        />
      )}
    </section>
  );

  const renderAudioSection = () => (
    <section className="ins-sec">
      <div className="ins-sec-head">
        <h4>声音控制</h4>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {clip.kind === 'video' && clip.assetId && !clip.muted && (
            <button
              type="button"
              className="button tiny subtle"
              disabled={clip.locked}
              title="将视频内嵌同期声分离到独立 A1 音轨，支持 J-Cut / L-Cut 声画错位剪辑"
              onClick={() => {
                const res = detachAudioFromClipOperations(sequence, clip);
                onEdit(`分离「${clip.name}」音画 (J/L Cut)`, res.operations);
                onSelectClip?.(res.audioClipId);
              }}
            >
              <Scissors size={10} /> 分离音画
            </button>
          )}
          <button
            type="button"
            className={`button tiny ${clip.muted ? 'primary' : 'subtle'}`}
            disabled={clip.locked}
            onClick={() => update({ muted: !clip.muted })}
          >
            {clip.muted ? '已静音 · 点击恢复' : '静音此片段'}
          </button>
        </div>
      </div>
      <CompactSliderRow
        label="音量"
        value={Math.round(Number(clip.props.volume ?? 1) * 100)}
        min={0}
        max={200}
        defaultValue={100}
        suffix="%"
        disabled={clip.locked || Boolean(clip.muted)}
        onChange={(v) => prop('volume', v / 100)}
      />
      <div className="ins-grid-2">
        <ScrubInput
          prefix="入"
          label="音频淡入"
          value={
            clip.props.fadeIn !== undefined
              ? Number(Number(clip.props.fadeIn).toFixed(2))
              : clip.kind === 'audio'
                ? Number(Math.min(0.45, (clip.duration / sequence.fps) * 0.18).toFixed(2))
                : 0.05
          }
          suffix="s"
          step={0.05}
          min={0}
          max={5}
          disabled={clip.locked}
          onCommit={(v) => prop('fadeIn', v)}
        />
        <ScrubInput
          prefix="出"
          label="音频淡出"
          value={
            clip.props.fadeOut !== undefined
              ? Number(Number(clip.props.fadeOut).toFixed(2))
              : clip.kind === 'audio'
                ? Number(Math.min(0.7, (clip.duration / sequence.fps) * 0.22).toFixed(2))
                : 0.05
          }
          suffix="s"
          step={0.05}
          min={0}
          max={5}
          disabled={clip.locked}
          onCommit={(v) => prop('fadeOut', v)}
        />
      </div>
      {clip.track === 'audio' && (
        <div className="ins-attach-mode">
          <span className="ins-sub-label">分镜换序归属</span>
          <div className="ins-seg" role="group" aria-label="音频时间线归属">
            <button
              type="button"
              className={clip.audioAttachMode === 'shot' ? 'active' : ''}
              disabled={clip.locked}
              onClick={() => update({ audioAttachMode: 'shot' })}
            >
              随镜移动
            </button>
            <button
              type="button"
              className={clip.audioAttachMode !== 'shot' ? 'active' : ''}
              disabled={clip.locked}
              onClick={() => update({ audioAttachMode: 'timeline' })}
            >
              固定时间线
            </button>
          </div>
        </div>
      )}
    </section>
  );

  const renderColorAdjustSection = () => {
    const bright = Number(clip.props.brightness || 0);
    const contrast = Number(clip.props.contrast || 0);
    const sat = Number(clip.props.saturation || 0);
    const temp = Number(clip.props.temperature || 0);
    const blur = Number(clip.props.blur || 0);
    const vignette = Number(clip.props.vignette || 0);
    const dirty = bright !== 0 || contrast !== 0 || sat !== 0 || temp !== 0 || blur !== 0 || vignette !== 0;
    return (
      <section className="ins-sec">
        <div className="ins-sec-head">
          <h4>色彩调节</h4>
          {dirty && !clip.locked && (
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                propsPatch(
                  { brightness: 0, contrast: 0, saturation: 0, temperature: 0, blur: 0, vignette: 0 },
                  '重置色彩调节',
                )
              }
            >
              全部重置
            </button>
          )}
        </div>
        <CompactSliderRow
          label="亮度"
          value={bright}
          min={-60}
          max={60}
          disabled={clip.locked}
          onChange={(v) => prop('brightness', v)}
        />
        <CompactSliderRow
          label="对比度"
          value={contrast}
          min={-60}
          max={60}
          disabled={clip.locked}
          onChange={(v) => prop('contrast', v)}
        />
        <CompactSliderRow
          label="饱和度"
          value={sat}
          min={-100}
          max={100}
          disabled={clip.locked}
          onChange={(v) => prop('saturation', v)}
        />
        <CompactSliderRow
          label="色温"
          value={temp}
          min={-100}
          max={100}
          disabled={clip.locked}
          onChange={(v) => prop('temperature', v)}
        />
        <CompactSliderRow
          label="模糊"
          value={blur}
          min={0}
          max={24}
          step={0.5}
          suffix="px"
          disabled={clip.locked}
          onChange={(v) => prop('blur', v)}
        />
        <CompactSliderRow
          label="暗角"
          value={vignette}
          min={0}
          max={100}
          disabled={clip.locked}
          onChange={(v) => prop('vignette', v)}
        />
      </section>
    );
  };

  return (
    <div className="inspector compact">
      <div className="inspector-title">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="eyebrow">
              {clip.kind === 'code' ? '可编程画面' : isText ? '文字' : clip.kind === 'audio' ? '音频' : '画面'}
            </span>
            {onClearSelect && (
              <button type="button" className="link-btn" onClick={onClearSelect}>
                ← 画布设置
              </button>
            )}
          </div>
          <h3>{clip.name}</h3>
        </div>
        <div className="ins-head-acts">
          {onSaveAsAsset && (
            <IconButton label="保存为项目资产" onClick={onSaveAsAsset}>
              <BookmarkPlus size={13} />
            </IconButton>
          )}
          <IconButton label="引用给 Agent" onClick={onReference}>
            <AtSign size={13} />
          </IconButton>
          <IconButton label="复制片段" onClick={() =>
            onEdit('复制片段', [
              {
                type: 'addClip',
                sequenceId: sequence.id,
                clip: {
                  ...clone(clip),
                  id: uid('clip'),
                  name: clip.name + ' · 副本',
                  start: clip.start + clip.duration,
                  locked: false,
                },
              },
            ])
          }>
            <Copy size={13} />
          </IconButton>
          <IconButton
            label="删除片段"
            disabled={clip.locked}
            onClick={() => onEdit('删除片段', [{ type: 'deleteClip', sequenceId: sequence.id, clipId: clip.id }])}
          >
            <Trash2 size={13} />
          </IconButton>
          <IconButton
            label={clip.locked ? '解锁片段' : '锁定片段'}
            active={clip.locked}
            onClick={() => update({ locked: !clip.locked }, clip.locked ? '解锁片段' : '锁定片段')}
          >
            {clip.locked ? <Lock size={13} /> : <Unlock size={13} />}
          </IconButton>
        </div>
      </div>

      {selectedClipIds.length > 1 && (
        <div className="ins-multi-banner">
          <span>已多选 {selectedClipIds.length} 个片段</span>
          {onSaveAsAsset && (
            <button type="button" className="link-btn" onClick={onSaveAsAsset}>
              合并存为资产
            </button>
          )}
        </div>
      )}

      {clip.locked && (
        <div className="lock-notice">
          <Lock size={11} /> 已锁定 · 手动与 Agent 编辑均受保护
        </div>
      )}
      {asset?.offline && (
        <div className="offline-notice" role="alert">
          <AlertTriangle size={13} />
          <div>
            <b>源素材文件已离线</b>
            <p>原路径缺失，导出已受保护阻止。</p>
          </div>
          {onRelink && (
            <button className="button tiny" onClick={() => onRelink(asset.id)}>
              重新定位
            </button>
          )}
        </div>
      )}

      {/* Sub-tabs per clip type (CapCut / Figma pattern) */}
      {!preset && isText && (
        <div className="ins-subtabs" role="tablist" aria-label="文字属性分类">
          <button
            type="button"
            role="tab"
            aria-selected={textTab === 'style'}
            className={textTab === 'style' ? 'active' : ''}
            onClick={() => setTextTab('style')}
          >
            样式
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={textTab === 'motion'}
            className={textTab === 'motion' ? 'active' : ''}
            onClick={() => setTextTab('motion')}
          >
            动效
          </button>
        </div>
      )}

      {!preset && isMedia && (
        <div className="ins-subtabs" role="tablist" aria-label="画面属性分类">
          <button
            type="button"
            role="tab"
            aria-selected={mediaTab === 'frame'}
            className={mediaTab === 'frame' ? 'active' : ''}
            onClick={() => setMediaTab('frame')}
          >
            画面
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mediaTab === 'adjust'}
            className={mediaTab === 'adjust' ? 'active' : ''}
            onClick={() => setMediaTab('adjust')}
          >
            调节
          </button>
          {clip.kind === 'video' && (
            <button
              type="button"
              role="tab"
              aria-selected={mediaTab === 'audio'}
              className={mediaTab === 'audio' ? 'active' : ''}
              onClick={() => setMediaTab('audio')}
            >
              音频
            </button>
          )}
        </div>
      )}

      {preset && (
        <div className="ins-subtabs" role="tablist" aria-label="组件属性分类">
          <button
            type="button"
            role="tab"
            aria-selected={presetTab === 'params'}
            className={presetTab === 'params' ? 'active' : ''}
            onClick={() => setPresetTab('params')}
          >
            参数
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={presetTab === 'transform'}
            className={presetTab === 'transform' ? 'active' : ''}
            onClick={() => setPresetTab('transform')}
          >
            变换
          </button>
        </div>
      )}

      {/* ── TEXT INSPECTOR ── */}
      {!preset && isText && textTab === 'style' && (
        <>
          <section className="ins-sec">
            <h4>文案内容</h4>
            <textarea
              key={clip.id + 'text'}
              className="ins-textarea"
              rows={2}
              aria-label="文案"
              disabled={clip.locked}
              defaultValue={String(clip.props.text || '')}
              onBlur={(e) => {
                if (e.currentTarget.value !== String(clip.props.text || '')) prop('text', e.currentTarget.value);
              }}
            />
          </section>

          <PropToggleSection
            title="副标题"
            enabled={Boolean(clip.props.subtitle)}
            disabled={clip.locked}
            onToggle={(next) => prop('subtitle', next ? '副标题说明' : '')}
          >
            <input
              key={clip.id + 'sub'}
              type="text"
              className="ins-text-input"
              aria-label="副标题"
              disabled={clip.locked}
              defaultValue={String(clip.props.subtitle || '')}
              onBlur={(e) => prop('subtitle', e.currentTarget.value)}
            />
          </PropToggleSection>

          <section className="ins-sec">
            <h4>排版</h4>
            <select
              aria-label="字体"
              value={String(clip.props.fontFamily || 'sans')}
              disabled={clip.locked}
              onChange={(e) => prop('fontFamily', e.target.value)}
            >
              <option value="sans">现代无衬线</option>
              <option value="serif">人文衬线体</option>
              <option value="rounded">圆体</option>
              <option value="mono">等宽字体</option>
            </select>
            <div className="ins-grid-2">
              <select
                aria-label="字重"
                value={String(clip.props.fontWeight ?? (clip.props.template === 'editorial' ? 400 : 650))}
                disabled={clip.locked}
                onChange={(e) => prop('fontWeight', Number(e.target.value))}
              >
                <option value="400">Regular 400</option>
                <option value="500">Medium 500</option>
                <option value="650">SemiBold 650</option>
                <option value="700">Bold 700</option>
                <option value="800">Heavy 800</option>
              </select>
              <ScrubInput
                prefix="字"
                label="字号"
                value={Number(clip.props.fontSize || (clip.kind === 'caption' ? 46 : 80))}
                min={14}
                max={180}
                suffix="px"
                disabled={clip.locked}
                onCommit={(v) => prop('fontSize', v)}
              />
            </div>
            <div className="ins-grid-2">
              <ScrubInput
                prefix="行"
                label="行高"
                value={Number(clip.props.lineHeight ?? 1.28)}
                min={0.8}
                max={3}
                step={0.05}
                disabled={clip.locked}
                onCommit={(v) => prop('lineHeight', v)}
              />
              <ScrubInput
                prefix="距"
                label="字符间距"
                value={Number(clip.props.letterSpacing || 0)}
                min={-10}
                max={40}
                suffix="px"
                disabled={clip.locked}
                onCommit={(v) => prop('letterSpacing', v)}
              />
            </div>
            <div className="ins-typo-bar">
              <div className="ins-mini-seg">
                <button
                  type="button"
                  title="加粗"
                  disabled={clip.locked}
                  className={Number(clip.props.fontWeight ?? 650) >= 700 ? 'active' : ''}
                  onClick={() => prop('fontWeight', Number(clip.props.fontWeight ?? 650) >= 700 ? 400 : 700)}
                >
                  <Bold size={11} />
                </button>
                <button
                  type="button"
                  title="斜体"
                  disabled={clip.locked}
                  className={clip.props.italic ? 'active' : ''}
                  onClick={() => prop('italic', !clip.props.italic)}
                >
                  <Italic size={11} />
                </button>
                <button
                  type="button"
                  title="下划线"
                  disabled={clip.locked}
                  className={clip.props.underline ? 'active' : ''}
                  onClick={() => prop('underline', !clip.props.underline)}
                >
                  <Underline size={11} />
                </button>
              </div>
              <div className="ins-mini-seg">
                <button
                  type="button"
                  title="文本左对齐"
                  disabled={clip.locked}
                  className={clip.props.align === 'left' ? 'active' : ''}
                  onClick={() => prop('align', 'left')}
                >
                  <AlignLeft size={11} />
                </button>
                <button
                  type="button"
                  title="文本居中"
                  disabled={clip.locked}
                  className={(clip.props.align || 'center') === 'center' ? 'active' : ''}
                  onClick={() => prop('align', 'center')}
                >
                  <AlignCenter size={11} />
                </button>
                <button
                  type="button"
                  title="文本右对齐"
                  disabled={clip.locked}
                  className={clip.props.align === 'right' ? 'active' : ''}
                  onClick={() => prop('align', 'right')}
                >
                  <AlignRight size={11} />
                </button>
              </div>
            </div>
          </section>

          <section className="ins-sec">
            <h4>填充</h4>
            <div className="ins-fill-row">
              <ColorHexInput
                label="文字颜色"
                value={String(clip.props.color || '#ffffff')}
                disabled={clip.locked}
                onChange={(hex) => prop('color', hex)}
              />
              <ScrubInput
                prefix="透"
                label="不透明度"
                value={curOpacity}
                min={0}
                max={100}
                suffix="%"
                disabled={clip.locked}
                onCommit={(v) => prop('opacity', v / 100)}
              />
              <select
                aria-label="混合模式"
                value={String(clip.props.blendMode || 'normal')}
                disabled={clip.locked}
                onChange={(e) => prop('blendMode', e.target.value)}
              >
                {BLEND_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label.split(' ')[0]}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <PropToggleSection
            title="描边"
            enabled={Boolean(clip.props.strokeEnabled)}
            disabled={clip.locked}
            onToggle={(next) =>
              propsPatch(
                {
                  strokeEnabled: next,
                  strokeColor: clip.props.strokeColor || '#0b0d12',
                  strokeWidth: clip.props.strokeWidth ?? 3,
                },
                next ? '开启文字描边' : '关闭文字描边',
              )
            }
          >
            <div className="ins-grid-2">
              <ColorHexInput
                label="描边颜色"
                value={String(clip.props.strokeColor || '#0b0d12')}
                disabled={clip.locked}
                onChange={(hex) => prop('strokeColor', hex)}
              />
              <ScrubInput
                prefix="粗"
                label="描边宽度"
                value={Number(clip.props.strokeWidth ?? 3)}
                min={1}
                max={16}
                suffix="px"
                disabled={clip.locked}
                onCommit={(v) => prop('strokeWidth', v)}
              />
            </div>
          </PropToggleSection>

          <PropToggleSection
            title="背景底框"
            enabled={
              clip.props.bgEnabled !== undefined
                ? Boolean(clip.props.bgEnabled)
                : Boolean(clip.props.background && clip.props.background !== 'transparent')
            }
            disabled={clip.locked}
            onToggle={(next) =>
              propsPatch(
                {
                  bgEnabled: next,
                  background: next ? (clip.props.background && clip.props.background !== 'transparent' ? clip.props.background : '#0c0d10') : 'transparent',
                  bgOpacity: clip.props.bgOpacity ?? 0.78,
                  bgRadius: clip.props.bgRadius ?? 8,
                },
                next ? '开启文字背景' : '关闭文字背景',
              )
            }
          >
            <div className="ins-grid-2">
              <ColorHexInput
                label="背景色"
                value={String(clip.props.background || '#0c0d10')}
                disabled={clip.locked}
                onChange={(hex) => prop('background', hex)}
              />
              <ScrubInput
                prefix="%"
                label="背景透明度"
                value={Math.round(Number(clip.props.bgOpacity ?? 0.78) * 100)}
                min={10}
                max={100}
                suffix="%"
                disabled={clip.locked}
                onCommit={(v) => prop('bgOpacity', v / 100)}
              />
            </div>
            <div className="ins-grid-2">
              <ScrubInput
                prefix="圆"
                label="背景圆角"
                value={Number(clip.props.bgRadius ?? 8)}
                min={0}
                max={48}
                suffix="px"
                disabled={clip.locked}
                onCommit={(v) => prop('bgRadius', v)}
              />
              <ScrubInput
                prefix="距"
                label="背景内边距"
                value={Number(clip.props.bgPaddingX ?? 20)}
                min={4}
                max={64}
                suffix="px"
                disabled={clip.locked}
                onCommit={(v) => prop('bgPaddingX', v)}
              />
            </div>
          </PropToggleSection>

          <PropToggleSection
            title="阴影"
            enabled={Boolean(clip.props.shadowEnabled)}
            disabled={clip.locked}
            onToggle={(next) =>
              propsPatch(
                {
                  shadowEnabled: next,
                  shadowColor: clip.props.shadowColor || '#000000',
                  shadowBlur: clip.props.shadowBlur ?? 14,
                  shadowOffsetY: clip.props.shadowOffsetY ?? 4,
                },
                next ? '开启文字阴影' : '关闭文字阴影',
              )
            }
          >
            <div className="ins-grid-2">
              <ScrubInput
                prefix="柔"
                label="阴影模糊"
                value={Number(clip.props.shadowBlur ?? 14)}
                min={0}
                max={40}
                suffix="px"
                disabled={clip.locked}
                onCommit={(v) => prop('shadowBlur', v)}
              />
              <ScrubInput
                prefix="移"
                label="垂直偏移"
                value={Number(clip.props.shadowOffsetY ?? 4)}
                min={-30}
                max={30}
                suffix="px"
                disabled={clip.locked}
                onCommit={(v) => prop('shadowOffsetY', v)}
              />
            </div>
          </PropToggleSection>

          {renderAlignAndTransform(true)}
          {renderTimeAndLayer()}
        </>
      )}

      {!preset && isText && textTab === 'motion' && (
        <>
          <section className="ins-sec">
            <h4>入场动画</h4>
            <div className="ins-pill-grid">
              {TEXT_ANIMS_IN.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={clip.locked}
                  className={(clip.props.animation || 'none') === a.id ? 'active' : ''}
                  onClick={() => prop('animation', a.id)}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {(clip.props.animation || 'none') !== 'none' && (
              <CompactSliderRow
                label="时长"
                value={Number(clip.props.animDuration ?? 0.45)}
                min={0.15}
                max={2}
                step={0.05}
                defaultValue={0.45}
                suffix="s"
                disabled={clip.locked}
                onChange={(v) => prop('animDuration', v)}
              />
            )}
          </section>

          <section className="ins-sec">
            <h4>出场动画</h4>
            <div className="ins-inline-row">
              <span>效果</span>
              <select
                aria-label="出场动效"
                value={String(clip.props.outAnimation || 'none')}
                disabled={clip.locked}
                onChange={(e) => prop('outAnimation', e.target.value)}
              >
                {TEXT_ANIMS_OUT.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <KeyframeSection
            clip={clip}
            sequence={sequence}
            playheadClock={playheadClock}
            properties={['x', 'y', 'scale', 'rotation', 'opacity']}
            onSeek={onSeek}
            onEdit={onEdit}
          />
          {renderTransitionSection()}
          {renderTimeAndLayer()}
        </>
      )}

      {/* ── IMAGE / VIDEO INSPECTOR ── */}
      {!preset && isMedia && mediaTab === 'frame' && (
        <>
          {renderAlignAndTransform(true)}
          <KeyframeSection
            clip={clip}
            sequence={sequence}
            playheadClock={playheadClock}
            properties={['x', 'y', 'scale', 'rotation', 'opacity']}
            onSeek={onSeek}
            onEdit={onEdit}
          />
          <section className="ins-sec">
            <h4>画幅适应与裁切</h4>
            <div className="ins-inline-row">
              <span>填充方式</span>
              <div className="ins-mini-seg" style={{ flex: 1 }}>
                <button
                  type="button"
                  disabled={clip.locked}
                  className={(clip.props.fit || 'cover') === 'cover' ? 'active' : ''}
                  onClick={() => prop('fit', 'cover')}
                >
                  填满画面
                </button>
                <button
                  type="button"
                  disabled={clip.locked}
                  className={clip.props.fit === 'contain' ? 'active' : ''}
                  onClick={() => prop('fit', 'contain')}
                >
                  完整显示
                </button>
              </div>
            </div>
            <CompactSliderRow
              label="圆角"
              value={Number(clip.props.borderRadius || 0)}
              min={0}
              max={160}
              suffix="px"
              disabled={clip.locked}
              onChange={(v) => prop('borderRadius', v)}
            />
            {(clip.props.fit || 'cover') === 'cover' && (
              <div className="ins-grid-2">
                <ScrubInput
                  prefix="焦X"
                  label="构图焦点 X"
                  value={Math.round(Number(clip.props.focalX ?? 50))}
                  min={0}
                  max={100}
                  suffix="%"
                  disabled={clip.locked}
                  onCommit={(v) => prop('focalX', v)}
                />
                <ScrubInput
                  prefix="焦Y"
                  label="构图焦点 Y"
                  value={Math.round(Number(clip.props.focalY ?? 50))}
                  min={0}
                  max={100}
                  suffix="%"
                  disabled={clip.locked}
                  onCommit={(v) => prop('focalY', v)}
                />
              </div>
            )}
          </section>
          {renderOpacityAndBlend()}
          {renderTransitionSection()}
          {renderTimeAndLayer()}
        </>
      )}

      {!preset && isMedia && mediaTab === 'adjust' && (
        <>
          {renderColorAdjustSection()}
          {renderTimeAndLayer()}
        </>
      )}

      {!preset && clip.kind === 'video' && mediaTab === 'audio' && (
        <>
          {renderAudioSection()}
          <KeyframeSection
            clip={clip}
            sequence={sequence}
            playheadClock={playheadClock}
            properties={['volume']}
            onSeek={onSeek}
            onEdit={onEdit}
          />
          {renderTimeAndLayer()}
        </>
      )}

      {/* ── PURE AUDIO INSPECTOR ── */}
      {clip.kind === 'audio' && (
        <>
          {asset && previewOrigin && !asset.offline && (
            <section className="ins-sec">
              <h4>波形试听</h4>
              <AudioWaveformPlayer
                id={`ins-${asset.id}`}
                name={asset.name}
                url={mediaUrl(previewOrigin, asset.id)}
                duration={asset.duration}
                waveform={asset.waveform}
                compact
              />
            </section>
          )}
          {renderAudioSection()}
          <KeyframeSection
            clip={clip}
            sequence={sequence}
            playheadClock={playheadClock}
            properties={['volume']}
            onSeek={onSeek}
            onEdit={onEdit}
          />
          {renderTimeAndLayer()}
        </>
      )}

      {/* ── PRESET / CODE / 3D / SHAPE ── */}
      {preset && presetTab === 'params' && (
        <>
          <section className="ins-sec">
            <h4>{preset.name} · 参数</h4>
            <fieldset disabled={clip.locked} className="preset-inspector">
              <PresetControls
                key={clip.id}
                commitOnBlur
                presetId={preset.id}
                values={clip.props}
                onChange={prop}
              />
            </fieldset>
          </section>
          {asset?.kind === 'model-3d' && (
            <section className="ins-sec">
              <h4>三维机位</h4>
              <div className="ins-grid-2">
                <ScrubInput
                  prefix="拆"
                  label="爆炸拆解度"
                  value={Number(Number(clip.props.explode ?? 0).toFixed(2))}
                  step={0.05}
                  min={0}
                  max={1.4}
                  disabled={clip.locked}
                  onCommit={(v) => prop('explode', v)}
                />
                <ScrubInput
                  prefix="速"
                  label="运转速率"
                  value={Number(Number(clip.props.speed ?? 1).toFixed(1))}
                  step={0.1}
                  min={0}
                  max={3}
                  disabled={clip.locked}
                  onCommit={(v) => prop('speed', v)}
                />
              </div>
            </section>
          )}
          {renderTimeAndLayer()}
        </>
      )}

      {preset && presetTab === 'transform' && (
        <>
          {renderAlignAndTransform(true)}
          <KeyframeSection
            clip={clip}
            sequence={sequence}
            playheadClock={playheadClock}
            properties={
              preset.id === 'teardown-3d' || asset?.kind === 'model-3d'
                ? ['x', 'y', 'scale', 'rotation', 'opacity', 'cameraYaw', 'cameraPitch', 'explode']
                : ['x', 'y', 'scale', 'rotation', 'opacity']
            }
            onSeek={onSeek}
            onEdit={onEdit}
          />
          {renderOpacityAndBlend()}
          {renderTransitionSection()}
          {renderTimeAndLayer()}
        </>
      )}

      {component && (
        <>
          <section className="ins-sec">
            <div className="ins-sec-head">
              <h4>
                组件参数 <span className="badge">CODE</span>
              </h4>
              <button type="button" className="link-btn" onClick={onCode}>
                <Code2 size={11} /> 编辑源码
              </button>
            </div>
            {component.pack?.parameters?.length ? (
              <ParameterControls
                key={clip.id}
                parameters={component.pack.parameters}
                values={{ ...component.props, ...clip.props }}
                onChange={prop}
                commitOnBlur
                disabled={clip.locked}
              />
            ) : (
              Object.entries({ ...component.props, ...clip.props })
                .filter(
                  ([k]) =>
                    ![
                      'opacity',
                      'scale',
                      'rotation',
                      'fit',
                      'volume',
                      'x',
                      'y',
                      'focalX',
                      'focalY',
                      'fadeIn',
                      'fadeOut',
                    ].includes(k),
                )
                .map(([k, v]) =>
                  typeof v === 'boolean' ? (
                    <label className="check-field" key={k}>
                      <input
                        type="checkbox"
                        checked={v}
                        disabled={clip.locked}
                        onChange={(e) => prop(k, e.target.checked)}
                      />
                      {k}
                    </label>
                  ) : typeof v === 'number' ? (
                    <ScrubInput
                      key={k}
                      prefix={k.slice(0, 3)}
                      label={k}
                      value={v}
                      disabled={clip.locked}
                      onCommit={(value) => prop(k, value)}
                    />
                  ) : (
                    <div className="ins-inline-row" key={k}>
                      <span>{k}</span>
                      <input
                        type="text"
                        className="ins-text-input"
                        aria-label={k}
                        defaultValue={String(v)}
                        disabled={clip.locked}
                        onBlur={(e) => prop(k, e.currentTarget.value)}
                      />
                    </div>
                  ),
                )
            )}
          </section>
          {renderAlignAndTransform(true)}
          <KeyframeSection
            clip={clip}
            sequence={sequence}
            playheadClock={playheadClock}
            properties={['x', 'y', 'scale', 'rotation', 'opacity']}
            onSeek={onSeek}
            onEdit={onEdit}
          />
          {renderOpacityAndBlend()}
          {renderTransitionSection()}
          {renderTimeAndLayer()}
        </>
      )}

      {!preset && clip.kind === 'shape' && !component && asset?.kind !== 'model-3d' && (
        <>
          <section className="ins-sec">
            <h4>纯色/纹理底板</h4>
            <div className="ins-inline-row">
              <span>样式</span>
              <select
                value={String(clip.props.template || 'aurora')}
                disabled={clip.locked}
                onChange={(e) => prop('template', e.target.value)}
              >
                <option value="aurora">流动光晕</option>
                <option value="grid">动态网格</option>
                <option value="solid">纯色</option>
              </select>
            </div>
            <ColorHexInput
              label="背景主色"
              value={String(clip.props.color || '#8faac2')}
              disabled={clip.locked}
              onChange={(hex) => prop('color', hex)}
            />
          </section>
          <KeyframeSection
            clip={clip}
            sequence={sequence}
            playheadClock={playheadClock}
            properties={['x', 'y', 'scale', 'rotation', 'opacity']}
            onSeek={onSeek}
            onEdit={onEdit}
          />
          {renderOpacityAndBlend()}
          {renderTransitionSection()}
          {renderTimeAndLayer()}
        </>
      )}

    </div>
  );
});
