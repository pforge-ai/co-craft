import React, { useId } from 'react';

export interface BrandMarkProps {
  size?: number;
  className?: string;
  tone?: 'prism' | 'inherit' | 'accent' | 'mono';
  label?: string;
}

const warmArc =
  'M13.2 4.8H19.4C20.9 4.8 22.1 6 22.1 7.5C22.1 9 20.9 10.2 19.4 10.2H13.4C11.3 10.2 10 11.5 10 13.6V14.8C10 16.9 11.3 18.2 13.4 18.2H17.6C19.1 18.2 20.3 19.4 20.3 20.9C20.3 22.4 19.1 23.6 17.6 23.6H13.2C8 23.6 4.6 20.2 4.6 15V13.4C4.6 8.2 8 4.8 13.2 4.8Z';

const coolArc =
  'M18.4 8.4H24.2C25.7 8.4 26.9 9.6 26.9 11.1C26.9 12.6 25.7 13.8 24.2 13.8H18.6C16.5 13.8 15.2 15.1 15.2 17.2V18.4C15.2 20.5 16.5 21.8 18.6 21.8H24.2C25.7 21.8 26.9 23 26.9 24.5C26.9 26 25.7 27.2 24.2 27.2H18.4C13.2 27.2 9.8 23.8 9.8 18.6V17C9.8 11.8 13.2 8.4 18.4 8.4Z';

export function BrandMark({ size = 24, className = '', tone = 'prism', label }: BrandMarkProps) {
  const uid = useId().replace(/:/g, '');

  if (tone === 'mono' || tone === 'inherit') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        width={size}
        height={size}
        fill="none"
        aria-hidden={label ? undefined : true}
        aria-label={label}
        role={label ? 'img' : undefined}
        focusable="false"
        className={className}
        style={{ display: 'block', flexShrink: 0 }}
      >
        <path d={warmArc} transform="rotate(-7 13.4 14.2)" fill="currentColor" fillOpacity="0.62" />
        <path d={coolArc} transform="rotate(5 18.4 17.8)" fill="currentColor" fillOpacity="0.95" />
      </svg>
    );
  }

  const warmId = `cc-w-${uid}`;
  const coolId = `cc-c-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      className={className}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={warmId} x1="5" y1="5" x2="20" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFE066" />
          <stop offset="0.48" stopColor="#FF8E9E" />
          <stop offset="1" stopColor="#EC4899" />
        </linearGradient>
        <linearGradient id={coolId} x1="26" y1="8" x2="10" y2="27" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5EEAD4" />
          <stop offset="0.35" stopColor="#22D3EE" />
          <stop offset="0.72" stopColor="#2563EB" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <path d={warmArc} transform="rotate(-7 13.4 14.2)" fill={`url(#${warmId})`} opacity="0.94" />
      <path d={coolArc} transform="rotate(5 18.4 17.8)" fill={`url(#${coolId})`} opacity="0.86" />
    </svg>
  );
}
