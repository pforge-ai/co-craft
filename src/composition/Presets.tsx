import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Clip, Project } from '../core/types';
import { getPreset, isLightHex, phaseAtSecond, resolveProjectStyle } from '../core/presets';
import { TeardownStage } from './ThreeStage';
import { SeeCodeRig, TinychartsRig, AnatomyRig, ScreenFocusRig } from './ScienceRigs';

const family = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif';
const mono = '"SFMono-Regular", Consolas, monospace';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const out = (v: number) => 1 - Math.pow(1 - clamp(v), 3);
const progress = (frame: number, fps: number, delay = 0, seconds = 0.7) =>
  out((frame / fps - delay) / seconds);
const textOf = (p: Record<string, unknown>, key: string, fallback = '') => String(p[key] ?? fallback);
let measureContext: CanvasRenderingContext2D | null | undefined;
const metrics = new Map<string, number>();
function measure(text: string, font: number, weight: number) {
  const key = `${font}|${weight}|${text}`;
  const cached = metrics.get(key);
  if (cached !== undefined) return cached;
  if (measureContext === undefined && typeof document !== 'undefined')
    measureContext = document.createElement('canvas').getContext('2d');
  let width = 0;
  if (measureContext) {
    measureContext.font = `${weight} ${font}px ${family}`;
    width = measureContext.measureText(text).width;
  } else width = [...text].reduce((n, c) => n + (/[^\x00-\xff]/.test(c) ? 1 : 0.58), 0) * font;
  if (metrics.size > 6000) metrics.clear();
  metrics.set(key, width);
  return width;
}
// Bind closing punctuation to its preceding word and opening quotes to the next.
// This keeps Chinese punctuation off the beginning of wrapped lines.
const words = new Intl.Segmenter('zh-Hans', { granularity: 'word' });
function phraseTokens(paragraph: string) {
  const tokens: string[] = [];
  let prefix = '';
  for (const { segment } of words.segment(paragraph)) {
    if (/^[“‘（【《「『〈(]+$/u.test(segment)) {
      prefix += segment;
      continue;
    }
    if (/^[，、。！？：；…”’）】》」』.,!?:;%％)]+$/u.test(segment) && tokens.length && !prefix) {
      tokens[tokens.length - 1] += segment;
    } else {
      tokens.push(prefix + segment);
      prefix = '';
    }
  }
  if (prefix) tokens.push(prefix);
  return tokens;
}
function wrapTokens(tokens: string[], width: number, font: number, weight: number) {
  const lines: string[] = [];
  let row = '';
  for (const token of tokens) {
    if (measure(row + token, font, weight) <= width) {
      row += token;
      continue;
    }
    if (row.trim()) {
      lines.push(row.trimEnd());
      row = '';
    }
    const next = token.trimStart();
    if (measure(next, font, weight) <= width) row = next;
    else
      for (const c of next) {
        if (row && measure(row + c, font, weight) > width) {
          lines.push(row);
          row = '';
        }
        row += c;
      }
  }
  if (row || !lines.length) lines.push(row.trimEnd());
  return lines;
}
const layouts = new Map<string, { font: number; lines: string }>();
function fit(text: string, width: number, height: number, preferred: number, weight = 600) {
  const key = JSON.stringify([text, width, height, preferred, weight]),
    cached = layouts.get(key);
  if (cached) return cached;
  const paragraphs = text.split('\n').map(phraseTokens);
  let font = preferred,
    groups: string[][] = [];
  for (let attempt = 0; attempt < 75; attempt++) {
    groups = paragraphs.map((tokens) => wrapTokens(tokens, width, font, weight));
    if (groups.reduce((n, rows) => n + rows.length, 0) * font * 1.18 <= height) break;
    font *= 0.94;
  }
  groups = groups.map((lines, i) => {
    if (lines.length < 2 || measure(lines[lines.length - 1], font, weight) > width * 0.43) return lines;
    let low = width * 0.52,
      high = width,
      best = lines;
    for (let n = 0; n < 6; n++) {
      const mid = (low + high) / 2,
        wrapped = wrapTokens(paragraphs[i], mid, font, weight);
      if (wrapped.length === lines.length) {
        best = wrapped;
        high = mid;
      } else low = mid;
    }
    return best;
  });
  const result = { font, lines: groups.flat().join('\n') };
  if (layouts.size > 650) layouts.clear();
  layouts.set(key, result);
  return result;
}
function TextBlock({
  text,
  width,
  height,
  size,
  weight = 600,
  style = {},
}: {
  text: string;
  width: number;
  height: number;
  size: number;
  weight?: number;
  style?: React.CSSProperties;
}) {
  const f = fit(text, width, height, size, weight);
  return (
    <div
      data-preset-text
      style={{
        fontSize: f.font,
        fontWeight: weight,
        lineHeight: 1.18,
        letterSpacing: '-0.035em',
        width,
        maxWidth: '100%',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        ...style,
      }}
    >
      {f.lines}
    </div>
  );
}
const absolute: React.CSSProperties = { position: 'absolute', inset: 0 };
const tau = 2 * Math.PI;

function SignalPlot({
  width,
  height,
  phase,
  time,
  accent,
  night = false,
}: {
  width: number;
  height: number;
  phase: number;
  time: number;
  accent: string;
  night?: boolean;
}) {
  const foreground = night ? '#f1ece1' : '#1e3834',
    secondary = night ? '#83c8bb' : '#37726d';
  const grid = night ? '#d2e3d025' : '#253e3830',
    paper = night ? '#f8edea0b' : '#89998b12';
  const labelSize = Math.min(width * 0.031, height * 0.063),
    top = labelSize * 1.9;
  const left = 0,
    right = width - 2,
    baselineA = height * 0.31,
    baselineSum = height * 0.74;
  const amp = (height * 0.167) / 2,
    radians = (phase * Math.PI) / 180,
    carrier = time * tau * 0.26;
  const path = (channel: 'a' | 'b' | 'sum') =>
    Array.from({ length: 153 }, (_, i) => {
      const fraction = i / 152,
        a = tau * 2.6 * fraction - carrier;
      const sample =
        channel === 'a'
          ? Math.sin(a)
          : channel === 'b'
            ? Math.sin(a + radians)
            : Math.sin(a) + Math.sin(a + radians);
      const x = left + fraction * (right - left),
        y = (channel === 'sum' ? baselineSum : baselineA) - sample * amp;
      return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  const a = path('a'),
    b = path('b'),
    sum = path('sum'),
    stroke = Math.max(1.5, labelSize * 0.105);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible', display: 'block' }}
      role="img"
      aria-label={`相位差 ${Math.round(phase)} 度的输入和合成波形`}
    >
      <rect x={0} y={top} width={width} height={height - top} fill={paper} />
      {Array.from({ length: 13 }, (_, i) => (
        <line
          key={i}
          x1={(i * width) / 12}
          x2={(i * width) / 12}
          y1={top}
          y2={height}
          stroke={grid}
          strokeWidth={i % 3 === 0 ? 1.4 : 0.65}
        />
      ))}
      {[baselineA, baselineSum].map((y) => (
        <line key={y} x1={0} x2={right} y1={y} y2={y} stroke={grid} strokeWidth={1.8} />
      ))}
      <path d={a} fill="none" stroke={secondary} strokeWidth={stroke * 2.15} />
      <path
        d={b}
        fill="none"
        stroke={accent}
        strokeWidth={stroke * 1.22}
        strokeDasharray={`${stroke * 2.8} ${stroke * 1.8}`}
      />
      <path
        d={`${sum} L${right} ${baselineSum} L0 ${baselineSum} Z`}
        fill={accent}
        opacity={night ? 0.15 : 0.13}
      />
      <path d={sum} fill="none" stroke={accent} strokeWidth={stroke * 2.45} />
      <g fontFamily={family} fontSize={labelSize} fontWeight={570} fill={foreground}>
        <text x={0} y={labelSize}>
          输入波形
        </text>
        <text x={0} y={height * 0.52}>
          合成波形
        </text>
      </g>
      <g fontFamily={mono} fontSize={labelSize * 0.81} fontWeight={500} textAnchor="end">
        <text x={right} y={labelSize} fill={secondary}>
          A <tspan fill={accent}>＋ B</tspan>
        </text>
        <text x={right} y={height * 0.52} fill={accent}>
          Σ
        </text>
      </g>
    </svg>
  );
}

function PhaseCurtain({
  width: w,
  height: h,
  frame,
  fps,
  props: p,
}: {
  width: number;
  height: number;
  frame: number;
  fps: number;
  props: Record<string, unknown>;
}) {
  const u = Math.min(w, h) / 1080,
    portrait = h > w * 1.1,
    photo = p.layout === 'photo';
  const time = frame / fps,
    carrier = time + Number(p.carrierOffset || 0),
    phase = phaseAtSecond(time, Number(p.phaseFrom), Number(p.phaseTo), Number(p.sweep));
  const accent = textOf(p, 'accent'),
    ink = photo ? '#fff6e9' : '#183931',
    secondary = photo ? '#e0d9ca' : '#50665b';
  const x = w * (portrait ? 0.077 : 0.068),
    right = w - x,
    top = h * (portrait ? 0.061 : 0.083);
  const wordsW = photo ? (portrait ? w - 2 * x : w * 0.495) : portrait ? w - 2 * x : w * 0.34;
  const title = textOf(p, 'text'),
    sub = textOf(p, 'subtitle'),
    label = textOf(p, 'label');
  const entrance = 0.8 + 0.2 * progress(frame, fps, 0, 0.54),
    lifted = (1 - progress(frame, fps, 0, 0.66)) * 12 * u;
  const degree = `${Math.round(phase)}°`,
    amp = 2 * Math.abs(Math.cos((phase * Math.PI) / 360));
  const chartW = portrait ? w - 2 * x : w * 0.485,
    chartH = portrait ? h * 0.32 : h * 0.49,
    chartX = portrait ? x : right - chartW,
    chartY = portrait ? h * 0.44 : h * 0.235;
  const bottom = h * (portrait ? 0.065 : 0.08),
    headerColor = photo ? '#f7e9ce' : '#375145';
  const outputWidth = portrait ? w * 0.59 : w * 0.27;
  return (
    <div style={{ ...absolute, color: ink, background: photo ? 'transparent' : '#edece3' }}>
      {photo ? (
        <div
          style={{
            ...absolute,
            background: portrait
              ? 'linear-gradient(180deg,#080c0a88 0%,#080c0a0a 27%,#080c0a44 40%,#080c0ae6 78%,#080c0af5 100%)'
              : 'linear-gradient(90deg,#080c0ae8 0%,#080c0acc 25%,#080c0a69 52%,transparent 83%),linear-gradient(0deg,#080c0a9c,transparent 35%)',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: portrait ? '100%' : '59%',
            background: 'linear-gradient(115deg,transparent 38%,#d9dfd429)',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: x,
          top,
          width: w - 2 * x,
          display: 'flex',
          alignItems: 'center',
          gap: 16 * u,
          color: headerColor,
        }}
      >
        <span style={{ width: 32 * u, height: 6 * u, background: accent, flexShrink: 0 }} />
        <TextBlock
          text={label}
          width={w * 0.44}
          height={50 * u}
          size={26 * u}
          weight={600}
          style={{ letterSpacing: '.03em' }}
        />
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: mono,
            fontSize: 18 * u,
            letterSpacing: '.16em',
            whiteSpace: 'nowrap',
          }}
        >
          ACOUSTIC STUDIES
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: x,
          top: photo ? h * (portrait ? 0.49 : 0.32) : h * (portrait ? 0.16 : 0.25),
          width: wordsW,
          opacity: entrance,
          transform: `translateY(${lifted}px)`,
        }}
      >
        <div
          style={{
            fontFamily: mono,
            fontSize: (portrait ? 21 : 23) * u,
            letterSpacing: '.14em',
            color: photo ? '#f1c59e' : accent,
            marginBottom: 24 * u,
          }}
        >
          {photo ? 'PHASE STUDY' : 'SIGNAL INTERFERENCE'}
        </div>
        <TextBlock
          text={title}
          width={wordsW}
          height={photo ? (portrait ? h * 0.175 : h * 0.3) : portrait ? h * 0.15 : h * 0.23}
          size={(photo ? (portrait ? 145 : 152) : portrait ? 124 : 120) * u}
          weight={640}
          style={{ letterSpacing: '-.067em' }}
        />
        <TextBlock
          text={sub}
          width={Math.min(wordsW, portrait ? w * 0.82 : w * 0.365)}
          height={photo ? h * 0.14 : h * 0.13}
          size={(portrait ? 34 : 31) * u}
          weight={440}
          style={{ marginTop: 24 * u, letterSpacing: 0, color: secondary, lineHeight: 1.3 }}
        />
      </div>
      {!photo && (
        <div style={{ position: 'absolute', left: chartX, top: chartY }}>
          <SignalPlot width={chartW} height={chartH} phase={phase} time={carrier} accent={accent} />
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          left: x,
          right: x,
          bottom,
          borderTop: `1px solid ${photo ? '#f3eed651' : '#244b3b53'}`,
          paddingTop: 19 * u,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 22 * u,
        }}
      >
        <div style={{ display: 'flex', gap: 18 * u, alignItems: 'center' }}>
          <svg width={49 * u} height={49 * u} viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r="22" fill="none" stroke={secondary} strokeWidth="1" />
            <path d="M26 26h19" stroke={secondary} strokeWidth="2" />
            <line
              x1="26"
              y1="26"
              x2={26 + 19 * Math.cos((phase * Math.PI) / 180)}
              y2={26 - 19 * Math.sin((phase * Math.PI) / 180)}
              stroke={accent}
              strokeWidth="3"
            />
            <circle cx="26" cy="26" r="2.2" fill={ink} />
          </svg>
          <div>
            <div style={{ fontSize: 17 * u, color: secondary }}>相位差</div>
            <b
              style={{
                fontFamily: mono,
                fontWeight: 500,
                letterSpacing: '-.05em',
                fontSize: 38 * u,
                lineHeight: 1.07,
              }}
            >
              {degree}
            </b>
          </div>
        </div>
        <div style={{ width: outputWidth, display: 'flex', flexDirection: 'column', gap: 9 * u }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              fontSize: 17 * u,
              color: secondary,
            }}
          >
            <span>相对单波振幅</span>
            <b style={{ fontFamily: mono, color: ink, fontWeight: 500, fontSize: 23 * u }}>
              {amp.toFixed(2)} ×
            </b>
          </div>
          <div style={{ height: 4 * u, background: photo ? '#fcefcc38' : '#91a29766' }}>
            <div style={{ height: '100%', background: accent, width: `${amp * 50}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
function Orbit({
  width,
  height,
  frame,
  fps,
  accent,
  secondary,
  intensity = 0.7,
}: {
  width: number;
  height: number;
  frame: number;
  fps: number;
  accent: string;
  secondary: string;
  intensity?: number;
}) {
  const m = Math.min(width, height),
    t = frame / fps;
  return (
    <div style={{ ...absolute, background: '#090b12', overflow: 'hidden' }}>
      <div
        style={{
          ...absolute,
          background: `radial-gradient(ellipse at 16% 16%, ${accent}28, transparent 55%),radial-gradient(ellipse at 87% 90%, ${secondary}21, transparent 60%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: m * 0.83,
          height: m * 0.83,
          left: width * 0.5 - m * 0.415,
          top: height * 0.5 - m * 0.415,
          transform: `rotate(-24deg) perspective(${m * 2}px) rotateX(${38 + Math.sin(t * 0.25) * 7}deg) rotateY(${Math.sin(t * 0.18) * 15}deg)`,
          opacity: clamp(intensity),
        }}
      >
        <div
          style={{
            ...absolute,
            borderRadius: '50%',
            background: `conic-gradient(from ${t * 8}deg,${accent}00 3%,${accent} 20%,${secondary} 40%,${accent}00 58%,${accent} 75%,${secondary}44 90%,transparent)`,
            filter: `blur(${m * 0.025}px)`,
            transform: 'scale(1.12)',
          }}
        />
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              inset: i * m * 0.022,
              borderRadius: '50%',
              border: `${m * 0.013}px solid transparent`,
              background: `linear-gradient(150deg,#f6ffffb0,#ffffff05 29%,#ffffff00 65%,${secondary}c0) border-box`,
              mask: `linear-gradient(#fff 0 0) padding-box,linear-gradient(#fff 0 0)`,
              maskComposite: 'exclude',
              boxShadow: `inset 0 ${m * 0.012}px ${m * 0.025}px #ffffff20`,
            }}
          />
        ))}
        <div
          style={{
            position: 'absolute',
            inset: m * 0.1,
            borderRadius: '50%',
            background: `radial-gradient(ellipse at 20% 20%,${accent}16,transparent 70%),#0a0c14`,
            boxShadow: `inset ${m * 0.01}px ${m * 0.01}px ${m * 0.06}px #000`,
          }}
        />
      </div>
      <div style={{ ...absolute, background: 'linear-gradient(180deg,#03060a00 35%,#03060a40)' }} />
    </div>
  );
}
export interface PresetFrameProps {
  presetId: string;
  frame: number;
  fps: number;
  duration: number;
  width: number;
  height: number;
  props?: Record<string, unknown>;
  assetUrl?: string;
  assetKind?: 'video' | 'image' | 'audio' | 'model-3d';
  sourceIn?: number;
}
export function PresetFrame({
  presetId,
  frame,
  fps,
  duration,
  width: w,
  height: h,
  props: overrides = {},
  assetUrl,
  assetKind,
  sourceIn = 0,
}: PresetFrameProps) {
  const requestedVersion =
    overrides.presetVersion === undefined ? undefined : Number(overrides.presetVersion);
  const definition = getPreset(presetId, requestedVersion);
  if (!definition) throw new Error(`找不到所需素材版本 ${presetId} v${requestedVersion ?? 1}`);
  const p = { ...definition.defaultProps, ...overrides };
  const m = Math.min(w, h),
    u = m / 1080,
    portrait = h > w * 1.1;
  const padX = w * (portrait ? 0.09 : 0.075),
    padY = h * 0.09;
  const safeW = w - padX * 2;
  const accent = textOf(p, 'accent', '#a8b8ff'),
    secondary = textOf(p, 'secondary', '#4ed9bc');
  const light = p.surface === 'light',
    transparent = p.surface === 'transparent';
  const ink = textOf(p, 'color', light ? '#151922' : '#f4f7fc');
  const dim = light ? '#636b78' : '#a7b0c2',
    base = light ? '#f2f1ec' : '#0c1019';
  const text = textOf(p, 'text'),
    subtitle = textOf(p, 'subtitle');
  const enter = progress(frame, fps),
    subEnter = progress(frame, fps, 0.2, 0.65);
  const exit =
    definition.category === 'backgrounds' ? 1 : clamp((duration - frame) / Math.max(fps * 0.28, 1));
  const size = Number(p.fontSize || (portrait ? 90 : 112)) * u;
  const opacity = Number(p.opacity ?? 1) * exit;
  const motion: React.CSSProperties = { opacity: enter, transform: `translateY(${(1 - enter) * 34 * u}px)` };
  const fine: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 19 * u,
    letterSpacing: '.14em',
    fontWeight: 500,
    color: dim,
  };
  const root: React.CSSProperties = {
    ...absolute,
    width: w,
    height: h,
    overflow: 'hidden',
    fontFamily: family,
    color: ink,
    background: transparent ? 'transparent' : base,
    opacity,
    transform: `translate(${Number(p.x || 0)}px,${Number(p.y || 0)}px) scale(${Number(p.scale || 1)})`,
    transformOrigin: 'center',
  };
  let content: React.ReactNode;
  if (presetId === 'phase-study')
    return (
      <div
        data-preset={presetId}
        style={{ ...root, opacity: Number(p.opacity ?? 1), background: 'transparent' }}
      >
        <PhaseCurtain width={w} height={h} frame={frame} fps={fps} props={p} />
      </div>
    );
  if (presetId === 'gradient-orbit')
    content = (
      <Orbit
        width={w}
        height={h}
        frame={frame}
        fps={fps}
        accent={accent}
        secondary={secondary}
        intensity={Number(p.intensity ?? 70) / 100}
      />
    );
  else if (presetId === 'contour-field') {
    const t = frame / fps,
      intensity = Number(p.intensity ?? 55) / 100;
    const cx = w * (portrait ? 0.56 : 0.64),
      cy = h * 0.53;
    content = (
      <>
        <div
          style={{
            ...absolute,
            background: `radial-gradient(ellipse at 65% 42%,${accent}22,transparent 67%)`,
          }}
        />
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          style={{ ...absolute, opacity: intensity }}
          aria-hidden="true"
        >
          {Array.from({ length: 36 }, (_, i) => {
            const radius = m * (0.047 + i * 0.033),
              path =
                Array.from({ length: 121 }, (_, k) => {
                  const theta = (tau * k) / 120,
                    warp =
                      1 +
                      0.12 * Math.sin(theta * 3 + t * 0.16 + i * 0.035) +
                      0.09 * Math.cos(theta * 2 - 0.5 - i * 0.065) +
                      0.038 * Math.sin(theta * 5 + t * 0.11);
                  const dx = Math.cos(theta) * radius * warp * 1.45,
                    dy = Math.sin(theta) * radius * warp * 0.79;
                  return `${k ? 'L' : 'M'}${(cx + dx + dy * 0.48).toFixed(1)} ${(cy + dy - dx * 0.12).toFixed(1)}`;
                }).join(' ') + ' Z';
            return (
              <path
                key={i}
                d={path}
                fill="none"
                stroke={accent}
                strokeWidth={(i % 5 === 0 ? 2.8 : 1.35) * u}
                opacity={i % 5 === 0 ? 0.96 : 0.65}
              />
            );
          })}
        </svg>
      </>
    );
  } else if (presetId === 'grid-light') {
    const grid = m * 0.085,
      t = frame / fps,
      intensity = Number(p.intensity ?? 55) / 100;
    const x = w * (0.5 + 0.27 * Math.sin(t * 0.32)),
      y = h * (0.5 + 0.23 * Math.cos(t * 0.28));
    content = (
      <>
        <div
          style={{
            ...absolute,
            background: `radial-gradient(ellipse at ${(x / w) * 100}% ${(y / h) * 100}%,${accent}60,transparent 57%)`,
            opacity: intensity,
          }}
        />
        <svg width={w} height={h} style={{ ...absolute, opacity: intensity }} aria-hidden="true">
          {Array.from({ length: Math.ceil(w / grid) + 1 }, (_, i) => (
            <line
              key={'x' + i}
              x1={i * grid}
              x2={i * grid}
              y1={0}
              y2={h}
              stroke={accent}
              opacity={i % 4 === 0 ? 0.6 : 0.35}
              strokeWidth={(i % 4 === 0 ? 2.9 : 1.7) * u}
            />
          ))}
          {Array.from({ length: Math.ceil(h / grid) + 1 }, (_, i) => (
            <line
              key={'y' + i}
              y1={i * grid}
              y2={i * grid}
              x1={0}
              x2={w}
              stroke={accent}
              opacity={i % 4 === 0 ? 0.6 : 0.35}
              strokeWidth={(i % 4 === 0 ? 2.9 : 1.7) * u}
            />
          ))}
          <path
            d={`M ${x} 0 V ${h} M 0 ${y} H ${w}`}
            fill="none"
            stroke={accent}
            strokeWidth={1.7 * u}
            opacity=".78"
          />
          <circle cx={x} cy={y} r={25 * u} fill="none" stroke={accent} strokeWidth={2.4 * u} />
          <circle cx={x} cy={y} r={5 * u} fill={accent} />
          {[0.16, 0.5, 0.84].flatMap((a, ix) =>
            [0.18, 0.5, 0.82].map((b, iy) => (
              <path
                key={`${ix}-${iy}`}
                d={`M${a * w - 7 * u} ${b * h}h${14 * u}M${a * w} ${b * h - 7 * u}v${14 * u}`}
                stroke={accent}
                strokeWidth={2.1 * u}
                opacity=".9"
              />
            )),
          )}
        </svg>
        <span
          style={{
            ...fine,
            position: 'absolute',
            left: padX,
            top: padY,
            color: ink,
            opacity: intensity,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          X {(x / w).toFixed(3)} / Y {(y / h).toFixed(3)}
        </span>
      </>
    );
  } else if (presetId === 'studio-title') {
    content = (
      <>
        {!transparent && (
          <div style={{ ...absolute, opacity: light ? 0.15 : 0.6 }}>
            <Orbit
              width={w}
              height={h}
              frame={frame + 45}
              fps={fps}
              accent={accent}
              secondary="#6274eb"
              intensity={0.55}
            />
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            left: padX,
            right: padX,
            top: h * (portrait ? 0.29 : 0.27),
            textAlign: 'center',
            ...motion,
          }}
        >
          {subtitle && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12 * u,
                padding: `${10 * u}px ${24 * u}px`,
                border: `1px solid ${accent}55`,
                borderRadius: 100,
                color: accent,
                background: light ? '#ffffffc0' : '#111620a0',
                fontFamily: mono,
                fontSize: 18 * u,
                letterSpacing: '.14em',
                marginBottom: 38 * u,
              }}
            >
              <span style={{ width: 6 * u, height: 6 * u, borderRadius: '50%', background: accent }} />{' '}
              {subtitle}
            </div>
          )}
          <TextBlock
            text={text}
            width={safeW}
            height={h * 0.31}
            size={size * 1.08}
            weight={650}
            style={{ textAlign: 'center', margin: '0 auto', letterSpacing: '-.055em' }}
          />
          <div
            style={{
              width: 64 * u,
              height: 3 * u,
              background: accent,
              margin: `${42 * u}px auto 0`,
              transform: `scaleX(${subEnter})`,
            }}
          />
        </div>
      </>
    );
  } else if (presetId === 'editorial-title') {
    content = (
      <>
        <div
          style={{
            position: 'absolute',
            left: padX,
            right: padX,
            top: padY,
            borderTop: `2px solid ${ink}`,
            opacity: enter,
          }}
        />
        <span
          style={{
            ...fine,
            position: 'absolute',
            left: padX,
            top: padY + 28 * u,
            color: ink,
            opacity: subEnter,
          }}
        >
          {textOf(p, 'label', 'FIELD NOTES')}
        </span>
        <div
          style={{
            position: 'absolute',
            right: padX,
            top: padY + 30 * u,
            width: 13 * u,
            height: 13 * u,
            borderRadius: '50%',
            background: accent,
            transform: `scale(${enter})`,
          }}
        />
        <div style={{ position: 'absolute', left: padX, top: h * 0.29, ...motion }}>
          <TextBlock text={text} width={safeW} height={h * 0.44} size={size * 1.3} weight={650} />
        </div>
        <div
          style={{
            ...fine,
            position: 'absolute',
            bottom: padY,
            left: padX,
            right: padX,
            paddingTop: 26 * u,
            borderTop: `1px solid ${light ? '#1112' : '#fff3'}`,
            opacity: subEnter,
          }}
        >
          {subtitle}
        </div>
      </>
    );
  } else if (presetId === 'split-title') {
    const split = portrait ? h * 0.52 : w * 0.51;
    content = (
      <>
        <div
          style={{
            position: 'absolute',
            left: portrait ? 0 : split,
            top: portrait ? split : 0,
            right: 0,
            bottom: 0,
            background: accent,
            transform: portrait
              ? `translateY(${(1 - enter) * h * 0.5}px)`
              : `translateX(${(1 - enter) * w * 0.5}px)`,
          }}
        />
        <div style={{ position: 'absolute', left: padX, top: portrait ? h * 0.2 : h * 0.36, ...motion }}>
          <TextBlock
            text={text}
            width={portrait ? safeW : w * 0.39}
            height={portrait ? h * 0.2 : h * 0.32}
            size={size * 1.16}
            weight={680}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            left: portrait ? padX : split + w * 0.065,
            top: portrait ? h * 0.64 : h * 0.36,
            opacity: subEnter,
            transform: `translateY(${(1 - subEnter) * 25 * u}px)`,
            color: '#10141c',
          }}
        >
          <TextBlock
            text={subtitle}
            width={portrait ? safeW : w * 0.36}
            height={portrait ? h * 0.2 : h * 0.32}
            size={size * 1.16}
            weight={680}
          />
        </div>
      </>
    );
  } else if (presetId === 'chapter-marker') {
    content = (
      <>
        <div
          style={{
            position: 'absolute',
            left: padX,
            top: h * 0.24,
            color: accent,
            fontFamily: mono,
            fontSize: 128 * u,
            fontWeight: 400,
            letterSpacing: '-.08em',
            ...motion,
          }}
        >
          {textOf(p, 'chapter', '01')}
        </div>
        <div
          style={{
            position: 'absolute',
            left: padX,
            top: h * 0.49,
            width: safeW,
            height: 2 * u,
            background: light ? '#1112' : '#fff2',
            transform: `scaleX(${subEnter})`,
            transformOrigin: 'left',
          }}
        >
          <div style={{ width: Math.min(safeW * 0.18, 190 * u), height: '100%', background: accent }} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: padX,
            top: h * 0.55,
            opacity: subEnter,
            transform: `translateY(${(1 - subEnter) * 25 * u}px)`,
          }}
        >
          <TextBlock text={text} width={safeW} height={h * 0.2} size={size * 0.82} weight={600} />
          <div style={{ ...fine, marginTop: 26 * u }}>{subtitle}</div>
        </div>
      </>
    );
  } else if (presetId === 'lower-third') {
    const boxW = Math.min(safeW, portrait ? safeW : 920 * u);
    content = (
      <div
        style={{
          position: 'absolute',
          left: padX,
          bottom: h * 0.12,
          width: boxW,
          display: 'flex',
          alignItems: 'stretch',
          opacity: enter,
          transform: `translateX(${(1 - enter) * -36 * u}px)`,
        }}
      >
        <div style={{ width: 5 * u, flexShrink: 0, background: accent, borderRadius: 4 * u }} />
        <div
          style={{
            padding: `${26 * u}px ${34 * u}px`,
            boxSizing: 'border-box',
            background: 'linear-gradient(110deg,#111720ec,#111720b8)',
            border: `1px solid #ffffff26`,
            borderLeft: 0,
            borderRadius: `0 ${12 * u}px ${12 * u}px 0`,
            color: '#f6f8fc',
            width: boxW - 5 * u,
            boxShadow: `0 ${10 * u}px ${32 * u}px #0003`,
          }}
        >
          <TextBlock text={text} width={boxW - 76 * u} height={124 * u} size={62 * u} weight={600} />
          <TextBlock
            text={subtitle}
            width={boxW - 76 * u}
            height={78 * u}
            size={27 * u}
            weight={400}
            style={{ color: '#c0c9d6', letterSpacing: '.025em', marginTop: 13 * u, opacity: subEnter }}
          />
        </div>
      </div>
    );
  } else if (presetId === 'end-card') {
    content = (
      <>
        <div
          style={{
            position: 'absolute',
            left: padX,
            top: padY,
            display: 'flex',
            alignItems: 'center',
            gap: 12 * u,
            fontSize: 22 * u,
            letterSpacing: '.1em',
            fontWeight: 600,
            color: accent,
            opacity: enter,
          }}
        >
          <div
            style={{
              width: 16 * u,
              height: 16 * u,
              border: `2px solid ${accent}`,
              transform: 'rotate(-12deg)',
              borderRadius: 5 * u,
            }}
          />
          {textOf(p, 'label', 'COCRAFT')}
        </div>
        <div style={{ position: 'absolute', left: padX, top: h * 0.32, ...motion }}>
          <TextBlock text={text} width={safeW} height={h * 0.32} size={size * 1.1} weight={650} />
          <div
            style={{
              fontFamily: mono,
              color: dim,
              fontSize: 21 * u,
              letterSpacing: '.1em',
              marginTop: 40 * u,
              opacity: subEnter,
            }}
          >
            {subtitle}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: padY,
            right: padX,
            width: 90 * u,
            height: 90 * u,
            borderRadius: '50%',
            border: `1px solid ${accent}60`,
            display: 'grid',
            placeItems: 'center',
            fontSize: 48 * u,
            color: accent,
            transform: `translateY(${(1 - subEnter) * 20 * u}px)`,
            opacity: subEnter,
          }}
        >
          ↗
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: padY,
            left: padX,
            width: safeW - 140 * u,
            height: 1,
            background: light ? '#1112' : '#fff2',
          }}
        />
      </>
    );
  } else if (presetId === 'glass-caption') {
    const maxW = Math.min(safeW, portrait ? safeW : 1500 * u);
    const fitted = fit(text, maxW - 64 * u, h * 0.22, 54 * u, 550);
    content = (
      <div
        style={{
          position: 'absolute',
          bottom: h * 0.12,
          left: w * 0.5,
          maxWidth: maxW,
          boxSizing: 'border-box',
          transform: `translate(-50%,${(1 - enter) * 18 * u}px)`,
          opacity: enter,
          padding: `${20 * u}px ${32 * u}px`,
          background: 'linear-gradient(135deg,#161d2be8,#131a28dc)',
          border: `1.5px solid #ffffff38`,
          borderRadius: 18 * u,
          boxShadow: `0 ${12 * u}px ${40 * u}px #0003`,
          borderTopColor: accent + '90',
          color: '#f8fafc',
          fontSize: fitted.font,
          fontWeight: 550,
          lineHeight: 1.28,
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          width: 'max-content',
        }}
      >
        {fitted.lines}
      </div>
    );
  } else if (presetId === 'kinetic-caption') {
    const chunks = text
      .trim()
      .split(/\s+/)
      .flatMap((segment) => {
        const groups: string[] = [];
        for (const token of phraseTokens(segment)) {
          const previous = groups.at(-1);
          if (previous && [...previous, ...token].length <= 7) groups[groups.length - 1] += token;
          else groups.push(token);
        }
        return groups;
      });
    const active = Math.min(
      chunks.length - 1,
      Math.floor(clamp((frame - fps * 0.25) / Math.max(1, duration - fps * 0.7)) * chunks.length),
    );
    const first = Math.max(0, Math.floor(active / 4) * 4),
      page = chunks.slice(first, first + 4);
    const f = fit(page.join(' '), safeW - 80 * u, h * 0.16, 64 * u, 650).font;
    content = (
      <div
        style={{
          position: 'absolute',
          left: padX,
          right: padX,
          bottom: h * 0.13,
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: 10 * u,
          opacity: enter,
        }}
      >
        {page.map((word, i) => (
          <span
            key={i}
            style={{
              display: 'inline-block',
              maxWidth: '100%',
              overflowWrap: 'anywhere',
              padding: `${12 * u}px ${20 * u}px`,
              borderRadius: 12 * u,
              background: i + first === active ? accent : '#121722ed',
              color: i + first === active ? '#141a20' : '#f5f7fb',
              fontSize: f,
              fontWeight: 650,
              lineHeight: 1.22,
              transform: `scale(${i + first === active ? 1.025 : 1})`,
              boxShadow: `0 ${5 * u}px ${14 * u}px #0002`,
            }}
          >
            {word}
          </span>
        ))}
      </div>
    );
  } else if (presetId === 'quote-card') {
    content = (
      <>
        <div
          style={{
            position: 'absolute',
            left: padX,
            top: h * 0.13,
            fontSize: 210 * u,
            lineHeight: 1,
            color: accent,
            fontFamily: 'Georgia,serif',
            opacity: enter,
          }}
        >
          “
        </div>
        <div style={{ position: 'absolute', left: padX, top: h * 0.33, ...motion }}>
          <TextBlock text={text} width={safeW} height={h * 0.37} size={size * 0.86} weight={550} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: padX,
            bottom: h * 0.13,
            display: 'flex',
            gap: 24 * u,
            alignItems: 'center',
            opacity: subEnter,
          }}
        >
          <span style={{ width: 50 * u, height: 2 * u, background: accent }} />
          <TextBlock
            text={subtitle}
            width={safeW - 80 * u}
            height={100 * u}
            size={25 * u}
            weight={450}
            style={{ color: dim, letterSpacing: '.02em' }}
          />
        </div>
      </>
    );
  } else if (presetId === 'stat-counter') {
    const value = Number(p.value ?? 86),
      count = Math.round(value * progress(frame, fps, 0.15, 1.15));
    const formatted = new Intl.NumberFormat('en-US').format(count);
    const numFont = fit(formatted, safeW * 0.78, h * 0.3, portrait ? 200 * u : 240 * u, 500).font;
    content = (
      <>
        <div style={{ position: 'absolute', left: padX, top: h * 0.16, color: dim, ...motion }}>
          <TextBlock text={text} width={safeW} height={h * 0.15} size={42 * u} weight={500} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: padX,
            top: h * 0.34,
            display: 'flex',
            alignItems: 'baseline',
            gap: 16 * u,
            opacity: enter,
          }}
        >
          <span
            style={{
              fontSize: numFont,
              fontWeight: 500,
              letterSpacing: '-.075em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              color: accent,
            }}
          >
            {formatted}
          </span>
          <span style={{ fontSize: 68 * u, color: ink, fontWeight: 400 }}>{textOf(p, 'suffix', '%')}</span>
        </div>
        <div
          style={{
            position: 'absolute',
            left: padX,
            right: padX,
            bottom: h * 0.21,
            height: 5 * u,
            background: light ? '#1111' : '#fff1',
            borderRadius: 5 * u,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress(frame, fps, 0.15, 1.15) * 100}%`,
              background: accent,
              borderRadius: 5 * u,
            }}
          />
        </div>
        <div
          style={{
            ...fine,
            position: 'absolute',
            left: padX,
            bottom: padY,
            opacity: subEnter,
            letterSpacing: '.03em',
          }}
        >
          {subtitle}
        </div>
      </>
    );
  } else if (presetId === 'comparison-bars') {
    const values = [Math.max(0, Number(p.valueA ?? 42)), Math.max(0, Number(p.valueB ?? 78))];
    const max = Math.max(1, ...values);
    content = (
      <>
        <div style={{ position: 'absolute', left: padX, top: h * 0.14, ...motion }}>
          <TextBlock text={text} width={safeW} height={h * 0.2} size={68 * u} weight={600} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: padX,
            right: padX,
            top: h * 0.4,
            display: 'flex',
            flexDirection: 'column',
            gap: 42 * u,
          }}
        >
          {values.map((value, i) => (
            <div key={i} style={{ opacity: progress(frame, fps, 0.15 + i * 0.17) }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 20 * u,
                  marginBottom: 16 * u,
                  fontSize: 25 * u,
                }}
              >
                <span>{textOf(p, i ? 'labelB' : 'labelA', i ? 'B' : 'A')}</span>
                <span style={{ fontFamily: mono, fontSize: 30 * u }}>
                  {new Intl.NumberFormat('en-US').format(value)}
                </span>
              </div>
              <div
                style={{
                  height: portrait ? 38 * u : 28 * u,
                  background: light ? '#1111' : '#fff1',
                  borderRadius: 5 * u,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(value / max) * progress(frame, fps, 0.3 + i * 0.2, 0.9) * 100}%`,
                    background: i ? accent : light ? '#8a909c' : '#596276',
                    borderRadius: 5 * u,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            ...fine,
            position: 'absolute',
            left: padX,
            bottom: padY,
            letterSpacing: '.02em',
            opacity: subEnter,
          }}
        >
          {subtitle}
        </div>
      </>
    );
  } else if (presetId === 'feature-stack') {
    const items = textOf(p, 'items').split('|').slice(0, 3);
    content = (
      <>
        <div style={{ position: 'absolute', left: padX, top: h * 0.14, ...motion }}>
          <div style={{ ...fine, color: accent, marginBottom: 22 * u }}>{subtitle}</div>
          <TextBlock text={text} width={safeW} height={h * 0.19} size={72 * u} weight={600} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: padX,
            right: padX,
            top: h * (portrait ? 0.39 : 0.44),
            display: 'grid',
            gridTemplateColumns: portrait ? '1fr' : 'repeat(3,1fr)',
            gap: 24 * u,
          }}
        >
          {items.map((item, i) => {
            const a = progress(frame, fps, 0.25 + i * 0.19, 0.6);
            const cardW = portrait ? safeW : (safeW - 48 * u) / 3;
            return (
              <div
                key={i}
                style={{
                  background: light ? '#ffffffa8' : '#171e2c',
                  border: `1px solid ${light ? '#19202d13' : '#ffffff16'}`,
                  borderRadius: 18 * u,
                  padding: `${32 * u}px`,
                  display: 'flex',
                  flexDirection: portrait ? 'row' : 'column',
                  alignItems: portrait ? 'center' : 'flex-start',
                  gap: portrait ? 26 * u : 44 * u,
                  transform: `translateY(${(1 - a) * 24 * u}px)`,
                  opacity: a,
                }}
              >
                <span style={{ fontFamily: mono, fontSize: 25 * u, color: accent }}>0{i + 1}</span>
                <TextBlock
                  text={item}
                  width={cardW - (portrait ? 150 : 64) * u}
                  height={portrait ? 90 * u : 120 * u}
                  size={36 * u}
                  weight={550}
                />
              </div>
            );
          })}
        </div>
      </>
    );
  } else if (presetId === 'focus-callout') {
    content = (
      <>
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          style={{ ...absolute, opacity: enter }}
          aria-hidden="true"
        >
          <circle cx={w * (portrait ? 0.35 : 0.3)} cy={h * 0.5} r={9 * u} fill={accent} />
          <circle
            cx={w * (portrait ? 0.35 : 0.3)}
            cy={h * 0.5}
            r={(18 + 7 * Math.sin(frame / fps)) * u}
            fill="none"
            stroke={accent}
            strokeWidth={1.5 * u}
            opacity={0.4}
          />
          <path
            d={
              portrait
                ? `M ${w * 0.35} ${h * 0.5} L ${w * 0.52} ${h * 0.42} L ${w * 0.81} ${h * 0.42}`
                : `M ${w * 0.3} ${h * 0.5} L ${w * 0.46} ${h * 0.36} L ${w * 0.73} ${h * 0.36}`
            }
            stroke={accent}
            strokeWidth={1.5 * u}
            fill="none"
            strokeDasharray={w * 2}
            strokeDashoffset={w * 2 * (1 - subEnter)}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            left: w * (portrait ? 0.15 : 0.48),
            top: h * (portrait ? 0.26 : 0.21),
            width: w * (portrait ? 0.7 : 0.4),
            boxSizing: 'border-box',
            background: '#101724e8',
            border: `1px solid ${accent}40`,
            borderRadius: 14 * u,
            padding: 22 * u,
            opacity: subEnter,
            transform: `translateY(${(1 - subEnter) * 20 * u}px)`,
            color: '#f4f7fc',
          }}
        >
          <TextBlock
            text={text}
            width={w * (portrait ? 0.7 : 0.4) - 44 * u}
            height={h * 0.1}
            size={41 * u}
            weight={550}
          />
          <TextBlock
            text={subtitle}
            width={w * (portrait ? 0.7 : 0.4) - 44 * u}
            height={h * 0.07}
            size={18 * u}
            weight={400}
            style={{ color: '#a8b3c8', letterSpacing: '.05em', marginTop: 13 * u }}
          />
        </div>
      </>
    );
  } else if (presetId === 'teardown-3d') {
    content = (
      <TeardownStage
        title={text}
        subtitle={subtitle}
        sceneType={textOf(p, 'sceneType', 'turbine')}
        cameraPreset={textOf(p, 'cameraPreset', 'orbit')}
        cameraYaw={Number(p.cameraYaw ?? 0)}
        cameraPitch={Number(p.cameraPitch ?? 0)}
        explode={Number(p.explode ?? 0.65)}
        speed={Number(p.speed ?? 1)}
        animateExplode={Boolean(p.animateExplode ?? true)}
        focusLabel={textOf(p, 'focusLabel', '')}
        accent={accent}
        secondary={secondary}
        surface={textOf(p, 'surface', 'dark')}
        modelUrl={assetKind === 'model-3d' ? assetUrl : undefined}
        frame={frame}
        fps={fps}
        width={w}
        height={h}
      />
    );
  } else if (presetId === 'seecode-architecture') {
    content = <SeeCodeRig width={w} height={h} frame={frame} fps={fps} duration={duration} props={p} />;
  } else if (presetId === 'tinycharts-state') {
    content = <TinychartsRig width={w} height={h} frame={frame} fps={fps} duration={duration} props={p} />;
  } else if (presetId === 'anatomy-telemetry') {
    content = <AnatomyRig width={w} height={h} frame={frame} fps={fps} duration={duration} props={p} />;
  } else if (presetId === 'screen-focus-rig') {
    content = (
      <ScreenFocusRig
        width={w}
        height={h}
        frame={frame}
        fps={fps}
        duration={duration}
        props={p}
        assetUrl={assetUrl}
        assetKind={assetKind}
        sourceIn={sourceIn}
      />
    );
  }
  return (
    <div data-preset={presetId} style={root}>
      {content}
    </div>
  );
}
export function PresetContent({
  clip,
  project,
  mediaOrigin,
}: {
  clip: Clip;
  project?: Project;
  mediaOrigin?: string;
}) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const linked = clip.assetId ? project?.assets.find((a) => a.id === clip.assetId) : undefined;
  const assetUrl =
    linked && mediaOrigin ? `${mediaOrigin}/media/${encodeURIComponent(linked.id)}` : undefined;
  const style = resolveProjectStyle(project);
  const resolvedProps: Record<string, unknown> = style
    ? {
        accent: style.primaryColor,
        secondary: style.secondaryColor,
        surface: isLightHex(style.backgroundColor) ? 'light' : 'dark',
        color: style.inkColor,
        ...clip.props,
      }
    : clip.props;
  return (
    <PresetFrame
      presetId={String(clip.props.presetId)}
      frame={frame + clip.sourceIn}
      fps={fps}
      duration={clip.duration + clip.sourceIn}
      width={width}
      height={height}
      props={resolvedProps}
      assetUrl={assetUrl}
      assetKind={linked?.kind}
      sourceIn={clip.sourceIn}
    />
  );
}
