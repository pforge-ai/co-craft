import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';

type Props = {
  label?: string;
  title?: string;
  caption?: string;
  accent?: string;
  peakColor?: string;
  panelColor?: string;
  segments?: number;
  durationFrames?: number;
  scale?: number;
  top?: number;
  right?: number;
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Deterministic per-frame level for one channel, 0..1. */
const levelAt = (f: number, fps: number, ch: number): number => {
  const t = f / fps;
  const drift = 0.5 + 0.26 * Math.sin(t * 1.9 + ch * 1.7);
  const breathe = 0.12 * Math.sin(t * 0.9 + ch * 0.8 + 1.4);
  // pulse envelope: dips to near silence, then a firm hit (like the 220 Hz study)
  const pulse = Math.pow(Math.max(0, Math.sin(t * 2.6 + ch * 0.15)), 5) * 0.34;
  const jitter =
    0.055 * Math.sin(t * 21.7 + ch * 2.3) +
    0.035 * Math.sin(t * 34.1 + ch * 5.9) +
    0.02 * Math.sin(t * 57.3 + ch * 1.1);
  return clamp(drift + breathe + pulse + jitter, 0.045, 0.985);
};

const dB = (level: number) => {
  const v = 20 * Math.log10(Math.max(level, 0.001));
  return v <= -60 ? '-∞' : v.toFixed(1);
};

export default function StereoMeter({
  label = '信号监测',
  title = '立体声电平',
  caption = 'L / R 双通道 · 琥珀为峰值',
  accent = '#a9d8c2',
  peakColor = '#f4af78',
  panelColor = 'rgba(10,16,14,0.46)',
  segments = 20,
  durationFrames = 90,
  scale = 1,
  top = 58,
  right = 66,
}: Props) {
  const f = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const fit = Math.min(width / 1920, height / 1080) * scale;

  const inAnim = interpolate(f, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const outAnim = interpolate(
    f,
    [Math.max(1, durationFrames - 11), Math.max(2, durationFrames - 2)],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );
  const opacity = inAnim * outAnim;
  const shift = (1 - inAnim) * 26 * fit;

  const channels = [0, 1].map((ch) => {
    const now = levelAt(f, fps, ch);
    // peak hold: max over the recent window, so it hangs and then falls away
    let peak = 0;
    for (let k = 0; k < 26; k++) {
      peak = Math.max(peak, levelAt(f - k, fps, ch) * (1 - k / 34));
    }
    const peakFrame = Math.max(now, peak * 0.94);
    return {ch, level: now, peak: peakFrame};
  });

  const segCount = Math.max(8, Math.round(segments));
  const barW = 246;
  const gap = 3;
  const segW = (barW - gap * (segCount - 1)) / segCount;

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          top,
          right,
          transform: `translateY(${shift}px)`,
          opacity,
          width: 320,
          boxSizing: 'border-box',
          padding: '16px 18px 14px',
          borderRadius: 10,
          background: panelColor,
          border: '1px solid rgba(233,226,208,0.16)',
          boxShadow: '0 12px 34px rgba(0,0,0,0.28)',
          fontFamily:
            '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Helvetica Neue",sans-serif',
          color: '#efe7d5',
          display: 'flex',
          flexDirection: 'column',
          gap: 11,
        }}
      >
        {/* header */}
        <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 7}}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: peakColor,
                opacity: 0.55 + 0.45 * Math.abs(Math.sin(f / 12)),
                display: 'block',
              }}
            />
            <span
              style={{
                fontSize: 9.5,
                letterSpacing: 2.2,
                textTransform: 'uppercase',
                color: 'rgba(239,231,213,0.62)',
              }}
            >
              {label}
            </span>
          </div>
          <span style={{fontSize: 9.5, letterSpacing: 1.1, color: 'rgba(239,231,213,0.42)'}}>
            30 fps
          </span>
        </div>

        <div style={{fontSize: 21, fontWeight: 600, letterSpacing: 1.2, lineHeight: 1.15}}>
          {title}
        </div>

        {/* meters */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 9}}>
          {channels.map(({ch, level, peak}) => (
            <div key={ch} style={{display: 'flex', alignItems: 'center', gap: 9}}>
              <span
                style={{
                  width: 12,
                  fontSize: 11,
                  fontWeight: 600,
                  color: ch === 0 ? accent : 'rgba(239,231,213,0.78)',
                  letterSpacing: 0.5,
                }}
              >
                {ch === 0 ? 'L' : 'R'}
              </span>
              <div style={{position: 'relative', width: barW, height: 13}}>
                {Array.from({length: segCount}).map((_, i) => {
                  const cellTop = (i + 1) / segCount;
                  const cellBottom = i / segCount;
                  const lit = level >= cellBottom + 0.012;
                  const isTop = lit && level < cellTop + 0.055;
                  const isPeak = peak >= cellBottom && peak <= cellTop;
                  const color = isPeak ? peakColor : accent;
                  const strength = lit ? (isTop || isPeak ? 1 : 0.86) : 0;
                  return (
                    <span
                      key={i}
                      style={{
                        position: 'absolute',
                        left: i * (segW + gap),
                        top: isTop ? -1.5 : 0,
                        width: segW,
                        height: isTop ? 16 : 13,
                        borderRadius: 1.5,
                        background: lit
                          ? color
                          : 'rgba(239,231,213,0.10)',
                        opacity: lit ? strength : 1,
                        boxShadow: isPeak && lit ? `0 0 10px ${peakColor}` : 'none',
                      }}
                    />
                  );
                })}
                {/* peak-hold tick */}
                <span
                  style={{
                    position: 'absolute',
                    top: -2,
                    bottom: -2,
                    left: clamp(peak) * (barW - 2) - 1,
                    width: 2,
                    background: peakColor,
                    opacity: 0.9,
                  }}
                />
              </div>
              <span
                style={{
                  width: 42,
                  textAlign: 'right',
                  fontSize: 10.5,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'rgba(239,231,213,0.6)',
                  letterSpacing: 0.2,
                }}
              >
                {dB(level)}
              </span>
            </div>
          ))}
        </div>

        {/* scale + caption */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 8.5,
            letterSpacing: 0.6,
            color: 'rgba(239,231,213,0.34)',
            marginTop: -2,
          }}
        >
          <span>-48</span>
          <span>-24</span>
          <span>-12</span>
          <span>-6</span>
          <span>0 dB</span>
        </div>

        <div
          style={{
            fontSize: 10.5,
            letterSpacing: 0.5,
            color: 'rgba(239,231,213,0.66)',
            borderTop: '1px solid rgba(239,231,213,0.12)',
            paddingTop: 8,
          }}
        >
          {caption}
        </div>
      </div>
    </AbsoluteFill>
  );
}
