import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { signatureSize } from './lib/typeset';

export default function Signature({
  text = 'Made with intention.',
  subtitle = 'STUDIO SIGNATURE',
  accent = '#b9a6ff',
  markAssetId = '',
  showMark = true,
  assetUrl = (id: string) => id,
}) {
  const frame = useCurrentFrame(),
    { width, height, fps, durationInFrames } = useVideoConfig();
  const short = Math.min(width, height),
    portrait = height > width;
  const a = interpolate(frame, [0, fps * 0.7], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const exit = interpolate(frame, [durationInFrames - fps * 0.3, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const contentWidth = width * 0.82,
    titleSize = signatureSize(text, contentWidth, height * 0.32, short * 0.12);
  return (
    <AbsoluteFill
      style={{
        background: '#11151a',
        color: '#f4f2ec',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        padding: width * 0.09,
        justifyContent: 'center',
        opacity: exit,
      }}
    >
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse at 82% 4%,${accent}32,transparent 53%)` }}
      />
      <div
        style={{ position: 'relative', opacity: a, transform: `translateY(${(1 - a) * short * 0.035}px)` }}
      >
        {showMark && markAssetId && (
          <Img
            src={assetUrl(markAssetId)}
            style={{ width: short * 0.115, height: short * 0.115, marginBottom: short * 0.065 }}
          />
        )}
        <div
          style={{
            fontSize: signatureSize(subtitle, contentWidth, height * 0.095, short * 0.028),
            letterSpacing: '.07em',
            color: accent,
            marginBottom: short * 0.026,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {subtitle}
        </div>
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 630,
            letterSpacing: '-.045em',
            lineHeight: 1.16,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            maxWidth: '100%',
          }}
        >
          {text}
        </div>
        <div
          style={{
            marginTop: short * 0.061,
            height: 2,
            width: portrait ? '100%' : '76%',
            background: '#e1e3d74a',
            transform: `scaleX(${a})`,
            transformOrigin: 'left',
          }}
        />
      </div>
    </AbsoluteFill>
  );
}
