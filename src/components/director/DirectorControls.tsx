import React, { useEffect, useRef, useState } from 'react';

function roundToStep(v: number, step: number): number {
  if (step >= 1) return Math.round(v / step) * step;
  const decimals = Math.max(0, Math.min(4, Math.ceil(-Math.log10(step))));
  return Number((Math.round(v / step) * step).toFixed(decimals));
}

function formatNumber(v: number, step: number, decimals?: number): string {
  const d = decimals ?? (step >= 1 ? 0 : Math.min(2, Math.ceil(-Math.log10(step))));
  return Number.isFinite(v) ? v.toFixed(d) : '0';
}

/**
 * Figma / Blender-grade compact scrub field for 3D Director Studio.
 * - Dragging the label scrubs smoothly at 60fps via `onLiveChange` (0 disk writes).
 * - Releasing the pointer commits ONCE via `onCommit`.
 * - Double-clicking the label immediately resets to `defaultValue`.
 * - Hold Shift for 5x coarse speed, Alt for 0.25x precision.
 */
export function DirectorScrubInput({
  label,
  ariaLabel,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  dragSpeed = 0.5,
  suffix = '',
  decimals,
  wrap360 = false,
  disabled = false,
  onLiveChange,
  onCommit,
}: {
  label: string;
  ariaLabel?: string;
  value: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  dragSpeed?: number;
  suffix?: string;
  decimals?: number;
  wrap360?: boolean;
  disabled?: boolean;
  onLiveChange: (next: number) => void;
  onCommit: (next: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState(() => formatNumber(value, step, decimals));
  const cleanupRef = useRef<(() => void) | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!focused && !dragging) {
      setDraft(formatNumber(value, step, decimals));
    }
  }, [value, step, decimals, focused, dragging]);

  useEffect(
    () => () => {
      cleanupRef.current?.();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const clampVal = (raw: number): number => {
    let n = raw;
    if (wrap360) {
      n = ((((n + 180) % 360) + 360) % 360) - 180;
    } else {
      if (min !== undefined) n = Math.max(min, n);
      if (max !== undefined) n = Math.min(max, n);
    }
    return roundToStep(n, step);
  };

  const commitTyped = (raw: string) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      const clamped = clampVal(parsed);
      setDraft(formatNumber(clamped, step, decimals));
      if (clamped !== roundToStep(value, step)) {
        onLiveChange(clamped);
        onCommit(clamped);
      }
    } else {
      setDraft(formatNumber(value, step, decimals));
    }
  };

  const handleLabelPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const base = value;
    let latest = value;
    let moved = false;
    setDragging(true);

    const flush = () => {
      rafRef.current = 0;
      setDraft(formatNumber(latest, step, decimals));
      onLiveChange(latest);
    };

    cleanupRef.current?.();
    const pointerId = e.pointerId;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'ew-resize';

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      const mult = ev.shiftKey ? 5 : ev.altKey ? 0.25 : 1;
      const next = clampVal(base + dx * dragSpeed * step * mult);
      if (next !== latest) {
        latest = next;
        if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
      }
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      document.body.style.cursor = prevCursor;
      cleanupRef.current = null;
    };

    const onUp = (ev?: PointerEvent) => {
      if (ev && ev.pointerId !== pointerId) return;
      cleanup();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      setDragging(false);
      if (moved && latest !== roundToStep(value, step)) {
        setDraft(formatNumber(latest, step, decimals));
        onLiveChange(latest);
        onCommit(latest);
      }
    };

    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  const handleDoubleClickReset = () => {
    if (disabled || defaultValue === undefined) return;
    const target = clampVal(defaultValue);
    setDraft(formatNumber(target, step, decimals));
    if (target !== roundToStep(value, step)) {
      onLiveChange(target);
      onCommit(target);
    }
  };

  return (
    <div className={`sds-scrub ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <span
        className="sds-scrub-label"
        title={
          defaultValue !== undefined
            ? `左右拖动微调${ariaLabel || label}（Shift 加速 / Alt 精细 / 双击复位）`
            : `左右拖动微调${ariaLabel || label}`
        }
        onPointerDown={handleLabelPointerDown}
        onDoubleClick={handleDoubleClickReset}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel || label}
        disabled={disabled}
        value={draft}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commitTyped(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setFocused(false);
            setDraft(formatNumber(value, step, decimals));
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const next = clampVal(value + delta);
            setDraft(formatNumber(next, step, decimals));
            onLiveChange(next);
            onCommit(next);
          }
        }}
      />
      {suffix && <span className="sds-scrub-unit">{suffix}</span>}
    </div>
  );
}

/**
 * Ultra-smooth 60fps range slider for scene lighting, temperature, bloom, and object transform.
 * Streams live WebGL preview via `onLiveChange` while dragging; persists ONCE on release.
 */
export function DirectorLiveSlider({
  label,
  valueText,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  disabled = false,
  onLiveChange,
  onCommit,
}: {
  label: React.ReactNode;
  valueText: string;
  value: number;
  defaultValue?: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onLiveChange: (next: number) => void;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const latestRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!draggingRef.current) {
      setDraft(null);
      latestRef.current = value;
    }
  }, [value]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const shown = draft ?? value;
  const pct = Math.max(0, Math.min(100, ((shown - min) / Math.max(0.0001, max - min)) * 100));

  const finishDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const finalVal = latestRef.current;
    setDraft(null);
    if (finalVal !== value) {
      onLiveChange(finalVal);
      onCommit(finalVal);
    }
  };

  return (
    <label className="sds-live-slider">
      <div
        className="sds-live-slider-head"
        title={defaultValue !== undefined ? '双击复位默认值' : undefined}
        onDoubleClick={() => {
          if (disabled || defaultValue === undefined) return;
          draggingRef.current = false;
          setDraft(null);
          latestRef.current = defaultValue;
          if (defaultValue !== value) {
            onLiveChange(defaultValue);
            onCommit(defaultValue);
          }
        }}
      >
        <span>{label}</span>
        <b>{valueText}</b>
      </div>
      <div className="sds-live-slider-track">
        <div className="sds-live-slider-fill" style={{ width: `${pct}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={shown}
          onPointerDown={() => {
            draggingRef.current = true;
            latestRef.current = shown;
          }}
          onChange={(e) => {
            const next = Number(e.target.value);
            latestRef.current = next;
            if (draggingRef.current) {
              setDraft(next);
              if (!rafRef.current) {
                rafRef.current = requestAnimationFrame(() => {
                  rafRef.current = 0;
                  onLiveChange(latestRef.current);
                });
              }
            } else {
              onLiveChange(next);
              onCommit(next);
            }
          }}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onBlur={finishDrag}
        />
      </div>
    </label>
  );
}

/**
 * Local-draft text input that commits ONCE on Enter or Blur instead of writing disk on every keystroke.
 */
export function DirectorTextField({
  value,
  placeholder,
  ariaLabel,
  className,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const next = draft.trim();
    if (next && next !== value) {
      onCommit(next);
    } else if (!next) {
      setDraft(value);
    }
  };

  return (
    <input
      type="text"
      className={className}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          setFocused(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
