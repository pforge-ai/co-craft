import React, { useEffect, useRef, useState } from 'react';
import { X, LoaderCircle } from 'lucide-react';
import { BrandMark } from './BrandMark';
export function IconButton({
  label,
  children,
  onClick,
  active,
  disabled,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const preferred =
      ref.current?.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') ||
      ref.current?.querySelector<HTMLElement>('button:not(:disabled)');
    preferred?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const els = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ) || [],
        );
        if (!els.length) return;
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0].focus();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
export function Field({
  label,
  value,
  onCommit,
  type = 'text',
  suffix,
  disabled = false,
  step,
  min,
  max,
  multiline = false,
}: {
  label: string;
  value: string | number;
  onCommit: (v: string) => void;
  type?: string;
  suffix?: string;
  disabled?: boolean;
  step?: number;
  min?: number;
  max?: number;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (draft !== String(value)) onCommit(draft);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-input">
        {multiline ? (
          <textarea
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            disabled={disabled}
            rows={3}
          />
        ) : (
          <input
            aria-label={label}
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            disabled={disabled}
            step={step}
            min={min}
            max={max}
          />
        )}
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}
export const Spinner = () => <LoaderCircle className="spin" size={15} />;
export function Mark({small=false}:{small?:boolean}) {
  return <BrandMark size={small ? 16 : 32} tone="accent" />;
}
