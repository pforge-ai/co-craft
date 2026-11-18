import React from 'react';

export interface BrandMarkProps {
  size?: number;
  className?: string;
  tone?: 'inherit' | 'accent';
  label?: string;
}

// Optical variants preserve the splice at small toolbar sizes.
const regularTop = 'M25 4H13C7.3 4 3.5 7.8 3.5 13.5V15H9.8V13.5C9.8 11.3 11 10.3 13.5 10.3H21.3L25 4Z';
const regularBottom =
  'M3.5 17V18.5C3.5 24.2 7.3 28 13 28H21.3L25 21.7H13.5C11 21.7 9.8 20.7 9.8 18.5V17H3.5Z';
const compactTop = 'M25.5 4H13C7.2 4 3.5 7.8 3.5 13.5V14.5H10V13.5C10 11.4 11.1 10.5 13.5 10.5H21.7L25.5 4Z';
const compactBottom =
  'M3.5 17.5V18.5C3.5 24.2 7.2 28 13 28H21.7L25.5 21.5H13.5C11.1 21.5 10 20.6 10 18.5V17.5H3.5Z';

export function BrandMark({ size = 24, className = '', tone = 'inherit', label }: BrandMarkProps) {
  const compact = size <= 20;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={compact ? '-1.5 0 32 32' : '-1.75 0 32 32'}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      className={className}
      style={{
        display: 'block',
        flexShrink: 0,
        color: tone === 'accent' ? 'var(--brand-accent, var(--accent, #8497ff))' : undefined,
      }}
    >
      <path d={compact ? compactTop : regularTop} />
      <path d={compact ? compactBottom : regularBottom} />
    </svg>
  );
}
