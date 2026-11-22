import React, { useEffect, useRef, useState } from 'react';
import { getPreset, type PresetParameter } from '../core/presets';
import { PresetFrame } from '../composition/Presets';
import './ResourceLibrary.css';

export type ParameterValue = string | number | boolean;

export const posterFrame = (duration: number) =>
  Math.min(duration - 1, Math.round(Math.min(72, duration * 0.48)));

const thumbnailCrop: Record<string, { x: number; y: number; zoom: number }> = {
  'lower-third': { x: 0.34, y: 0.82, zoom: 1.65 },
  'glass-caption': { x: 0.5, y: 0.84, zoom: 1.6 },
  'kinetic-caption': { x: 0.5, y: 0.83, zoom: 1.55 },
  'focus-callout': { x: 0.56, y: 0.37, zoom: 1.33 },
};

export function PresetPreview({
  presetId,
  values,
  portrait = false,
  playing = false,
  thumbnail = false,
  backdrop,
  className = '',
}: {
  presetId: string;
  values?: Record<string, unknown>;
  portrait?: boolean;
  playing?: boolean;
  thumbnail?: boolean;
  backdrop?: string;
  className?: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const preset = getPreset(presetId)!;
  const duration = Math.max(1, Math.round(preset.durationSeconds * 30));
  const initial = posterFrame(duration);
  const [width, setWidth] = useState(0);
  const [frame, setFrame] = useState(initial);
  const current = useRef(initial);

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    current.current = initial;
    setFrame(initial);
  }, [presetId, initial]);

  useEffect(() => {
    if (!playing) {
      if (thumbnail) {
        current.current = initial;
        setFrame(initial);
      }
      return;
    }
    let token = 0;
    const begin = performance.now();
    const offset = thumbnail ? 0 : current.current;
    const tick = (now: number) => {
      const next = (offset + Math.floor((now - begin) * 0.03)) % duration;
      if (next !== current.current) {
        current.current = next;
        setFrame(next);
      }
      token = requestAnimationFrame(tick);
    };
    token = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(token);
  }, [playing, thumbnail, presetId, duration, initial]);

  const cw = portrait ? 675 : 1200;
  const ch = portrait ? 1200 : 675;
  const crop = thumbnail ? thumbnailCrop[presetId] : undefined;
  const showsPhoto = backdrop && (values?.surface ?? preset.defaultProps.surface) === 'transparent';

  return (
    <div
      ref={element}
      className={`preset-preview ${portrait ? 'portrait' : 'landscape'} ${className}`}
      style={{ aspectRatio: `${cw}/${ch}` }}
      aria-label={`${preset.name}动态预览`}
    >
      {width > 0 && (
        <div
          className="preset-preview-stage"
          style={{ width: cw, height: ch, transform: `scale(${width / cw})` }}
        >
          {showsPhoto && (
            <img
              src={backdrop}
              alt=""
              style={{ width: cw, height: ch, objectFit: 'cover', filter: 'brightness(.72)' }}
            />
          )}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transformOrigin: '0 0',
              transform: crop
                ? `translate(${cw * (0.5 - crop.zoom * crop.x)}px, ${ch * (0.5 - crop.zoom * crop.y)}px) scale(${crop.zoom})`
                : undefined,
            }}
          >
            <PresetFrame
              presetId={presetId}
              frame={frame}
              fps={30}
              duration={duration}
              width={cw}
              height={ch}
              props={values}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ParameterField({
  parameter,
  value,
  onChange,
  commitOnBlur = false,
  disabled = false,
}: {
  parameter: PresetParameter;
  value: unknown;
  onChange: (key: string, value: ParameterValue) => void;
  commitOnBlur?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const raw = String(value ?? '');
  const display = draft ?? raw;
  const t = parameter.type;

  const parse = (s: string): ParameterValue | null => {
    if (t !== 'number') return s;
    if (s.trim() === '' || !Number.isFinite(Number(s))) return null;
    return Math.max(parameter.min ?? -Infinity, Math.min(parameter.max ?? Infinity, Number(s)));
  };

  const change = (s: string) => {
    if (commitOnBlur || t === 'number') setDraft(s);
    const parsed = parse(s);
    if ((!commitOnBlur || t === 'select') && parsed !== null && String(parsed) !== raw) {
      onChange(parameter.key, parsed);
    }
    if (t === 'select') setDraft(null);
  };

  const blur = (s: string) => {
    const parsed = parse(s);
    if (draft !== null && parsed !== null && String(parsed) !== raw) onChange(parameter.key, parsed);
    setDraft(null);
  };

  const attributes = {
    disabled,
    'aria-label': parameter.label,
    value: display,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      change(e.currentTarget.value),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      blur(e.currentTarget.value),
  };

  return (
    <label className={`preset-field ${t === 'color' ? 'color-field' : ''}`}>
      <span>{parameter.label}</span>
      {t === 'boolean' ? (
        <input
          disabled={disabled}
          type="checkbox"
          checked={value === true}
          aria-label={parameter.label}
          onChange={(e) => onChange(parameter.key, e.currentTarget.checked)}
        />
      ) : t === 'select' ? (
        <select {...attributes}>
          {parameter.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : t === 'text' ? (
        <textarea {...attributes} rows={parameter.key === 'text' ? 2 : 1} maxLength={500} />
      ) : (
        <div className="preset-value">
          <input {...attributes} type={t} min={parameter.min} max={parameter.max} step={parameter.step} />
          {t === 'color' && <span>{display.toUpperCase()}</span>}
        </div>
      )}
    </label>
  );
}

export function ParameterControls({
  parameters,
  values,
  onChange,
  commitOnBlur = false,
  disabled = false,
}: {
  parameters: PresetParameter[];
  values: Record<string, unknown>;
  onChange: (key: string, value: ParameterValue) => void;
  commitOnBlur?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="preset-controls">
      {parameters.map((parameter) => (
        <ParameterField
          key={parameter.key}
          parameter={parameter}
          value={values[parameter.key]}
          onChange={onChange}
          commitOnBlur={commitOnBlur}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

export function PresetControls({
  presetId,
  values,
  onChange,
  commitOnBlur = false,
  disabled = false,
}: {
  presetId: string;
  values: Record<string, unknown>;
  onChange: (key: string, value: ParameterValue) => void;
  commitOnBlur?: boolean;
  disabled?: boolean;
}) {
  const preset = getPreset(presetId);
  return preset ? (
    <ParameterControls
      parameters={preset.parameters}
      values={{ ...preset.defaultProps, ...values }}
      onChange={onChange}
      commitOnBlur={commitOnBlur}
      disabled={disabled}
    />
  ) : null;
}
