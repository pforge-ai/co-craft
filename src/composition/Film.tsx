import { PresetContent } from './Presets';
import { getPreset, isLightHex, resolveProjectStyle } from '../core/presets';
import { evaluateKeyframeTrack, resolveClipPropsAtFrame } from '../core/keyframes';
import { getClipCompositingOrder, isClipTrackActive } from '../core/tracks';
import { ThreeCanvas, TeardownStage } from './ThreeStage';
import { SpatialStage } from './SpatialStage';
import { DirectorStageProvider, useDirectorStage } from './DirectorContext';
import type { SpatialRenderPass } from '../core/spatialStage';
import RoughPrimitives, { rough } from './RoughPrimitives';
import React, { useMemo } from 'react';
import * as Remotion from 'remotion';
import * as JSXRuntime from 'react/jsx-runtime';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  AbsoluteFill,
  Freeze,
  Sequence,
  Img,
  OffthreadVideo,
  Html5Video,
  Html5Audio,
  useCurrentFrame,
  useVideoConfig,
  spring,
  getRemotionEnvironment,
} from 'remotion';
import type { Project, Sequence as FilmSequence, Clip, CodeComponent, TransitionType } from '../core/types';

export interface FilmProps extends Record<string, unknown> {
  project: Project;
  sequenceId: string;
  mediaOrigin: string;
  paused?: boolean;
  selectedClipId?: string | null;
  liveOverride?: { clipId: string; props: Record<string, unknown> } | null;
}

export const mediaUrl = (origin: string, id: string, thumbnail = false) =>
  `${origin}/media/${encodeURIComponent(id)}${thumbnail ? '?thumbnail=1' : ''}`;

export const mediaFrameUrl = (origin: string, id: string, frame: number, fps = 30, cacheTag?: string) =>
  `${origin}/media/${encodeURIComponent(id)}?frame=${Math.max(0, Math.round(frame))}&fps=${fps}${cacheTag ? `&v=${encodeURIComponent(cacheTag.slice(0, 8))}` : ''}`;

const bounded = (n: number) => Math.max(0, Math.min(1, n));

function rgbaFromColor(hex: string, alpha: number): string {
  const c = hex.trim();
  const a = bounded(alpha);
  if (c.startsWith('#') && (c.length === 7 || c.length === 9)) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }
  return c;
}

function resolveFontStack(familyKey: unknown): string {
  switch (String(familyKey || 'sans')) {
    case 'serif':
      return '"Songti SC", "Noto Serif SC", Georgia, serif';
    case 'mono':
      return '"SF Mono", Menlo, Monaco, Consolas, monospace';
    case 'rounded':
      return '"PingFang SC", "Hiragino Maru Gothic ProN", "SF Pro Rounded", sans-serif';
    default:
      return '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif';
  }
}

function buildFilterCss(p: Record<string, unknown>): string | undefined {
  const bright = Number(p.brightness || 0);
  const contrast = Number(p.contrast || 0);
  const sat = Number(p.saturation || 0);
  const temp = Number(p.temperature || 0);
  const blur = Number(p.blur || 0);
  const parts: string[] = [];
  if (bright !== 0) parts.push(`brightness(${Math.max(0.2, 1 + bright / 100).toFixed(2)})`);
  if (contrast !== 0) parts.push(`contrast(${Math.max(0.2, 1 + contrast / 100).toFixed(2)})`);
  if (sat !== 0) parts.push(`saturate(${Math.max(0, 1 + sat / 100).toFixed(2)})`);
  if (temp !== 0) {
    if (temp > 0) parts.push(`sepia(${Math.min(0.45, temp / 220).toFixed(2)})`);
    else parts.push(`hue-rotate(${Math.round(temp * 0.25)}deg)`);
  }
  if (blur > 0) parts.push(`blur(${blur.toFixed(1)}px)`);
  return parts.length ? parts.join(' ') : undefined;
}

function computeAudioVolume(f: number, clip: Clip, fps: number): number {
  const staticBase = Number(clip.props.volume ?? 1);
  const base = Math.max(0, evaluateKeyframeTrack(clip.keyframes?.volume, f, staticBase));
  if (base <= 0) return 0;
  const clipSec = clip.duration / fps;
  const defaultIn = clip.kind === 'audio' ? Math.min(0.45, clipSec * 0.18) : Math.min(0.05, clipSec * 0.1);
  const defaultOut = clip.kind === 'audio' ? Math.min(0.7, clipSec * 0.22) : Math.min(0.05, clipSec * 0.1);
  const fadeInSec = clip.props.fadeIn !== undefined ? Math.max(0, Number(clip.props.fadeIn)) : defaultIn;
  const fadeOutSec = clip.props.fadeOut !== undefined ? Math.max(0, Number(clip.props.fadeOut)) : defaultOut;
  const inGain = fadeInSec > 0 ? bounded(f / Math.max(1, fadeInSec * fps)) : 1;
  const outGain = fadeOutSec > 0 ? bounded((clip.duration - f) / Math.max(1, fadeOutSec * fps)) : 1;
  return base * Math.min(inGain, outGain);
}

/**
 * Splits Chinese/English caption strings into rhythmic karaoke tokens
 * so word-level kinetic highlighting works deterministically with or without explicit wordTimings.
 */
function tokenizeCaptionUnits(text: string): string[] {
  const out: string[] = [];
  const re = /([a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*\s*|[\u4e00-\u9fff]{1,2}[，。！？、；：,.!?;:]*\s*|\s+|[^\sa-zA-Z0-9\u4e00-\u9fff]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0]) out.push(m[0]);
  }
  return out.length ? out : [text];
}

/**
 * Deterministic L1 Zero-Video-Cost Cinema Finish Overlay:
 * Renders frame-accurate film grain, floating dust motes, diagonal cinema rain, or manga radial speedlines.
 */
function CinematicFinishOverlay({
  frame,
  fps,
  filmGrain = 0,
  overlayEffect = 'none',
}: {
  frame: number;
  fps: number;
  filmGrain?: number;
  overlayEffect?: string;
}) {
  const t = frame / Math.max(1, fps);
  const grainAlpha = Math.max(0, Math.min(1, filmGrain / 100));
  const grainStep = Math.floor(frame / 2);
  const gx = (grainStep * 47) % 160;
  const gy = (grainStep * 73) % 160;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {overlayEffect === 'dust' && (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {Array.from({ length: 24 }).map((_, i) => {
            const seedX = ((i * 239 + 113) % 1920);
            const seedY = ((i * 197 + 71) % 1080);
            const r = 2 + (i % 5) * 1.6;
            const speed = 14 + (i % 7) * 5;
            const x = (seedX + t * speed + Math.sin(t * 0.9 + i) * 28 + 1920) % 1920;
            const y = (seedY - t * (speed * 0.65) + Math.cos(t * 0.7 + i * 1.4) * 22 + 1080) % 1080;
            const op = 0.16 + 0.22 * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 2.1));
            return (
              <circle
                key={i}
                cx={x.toFixed(1)}
                cy={y.toFixed(1)}
                r={r}
                fill={i % 3 === 0 ? '#fef3c7' : '#ffffff'}
                opacity={op.toFixed(3)}
              />
            );
          })}
        </svg>
      )}
      {overlayEffect === 'rain' && (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {Array.from({ length: 42 }).map((_, i) => {
            const laneX = (i * 193 + 41) % 2100 - 90;
            const spd = 920 + (i % 5) * 210;
            const len = 48 + (i % 4) * 26;
            const yStart = ((i * 173 + t * spd) % 1280) - 120;
            const xStart = laneX - yStart * 0.16;
            const op = 0.18 + (i % 3) * 0.12;
            return (
              <line
                key={i}
                x1={xStart.toFixed(1)}
                y1={yStart.toFixed(1)}
                x2={(xStart - len * 0.16).toFixed(1)}
                y2={(yStart + len).toFixed(1)}
                stroke="#e0f2fe"
                strokeWidth={i % 4 === 0 ? 2.1 : 1.25}
                strokeLinecap="round"
                opacity={op.toFixed(2)}
              />
            );
          })}
        </svg>
      )}
      {overlayEffect === 'speedlines' && (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {Array.from({ length: 56 }).map((_, i) => {
            const angle = ((i / 56) * Math.PI * 2) + Math.sin(Math.floor(frame / 2) * 1.7 + i) * 0.015;
            const pulse = 0.5 + 0.5 * Math.sin(Math.floor(frame / 2) * 2.3 + i * 3.1);
            const innerR = 460 + (i % 5) * 42 + pulse * 65;
            const outerR = 1180;
            const cx = 960;
            const cy = 540;
            const x1 = cx + Math.cos(angle) * innerR;
            const y1 = cy + Math.sin(angle) * innerR;
            const x2 = cx + Math.cos(angle) * outerR;
            const y2 = cy + Math.sin(angle) * outerR;
            return (
              <line
                key={i}
                x1={x1.toFixed(1)}
                y1={y1.toFixed(1)}
                x2={x2.toFixed(1)}
                y2={y2.toFixed(1)}
                stroke="#ffffff"
                strokeWidth={(1.2 + (i % 3) * 1.4).toFixed(1)}
                opacity={(0.22 + pulse * 0.34).toFixed(2)}
              />
            );
          })}
        </svg>
      )}
      {grainAlpha > 0.01 && (
        <div
          style={{
            position: 'absolute',
            inset: '-160px',
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg viewBox=%270 0 160 160%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27g%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.85%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23g)%27/%3E%3C/svg%3E")',
            backgroundSize: '160px 160px',
            transform: `translate(${gx}px, ${gy}px)`,
            opacity: Number((grainAlpha * 0.32).toFixed(3)),
            mixBlendMode: 'overlay',
          }}
        />
      )}
    </div>
  );
}

function Title({
  clip,
  project,
  paused = false,
  isSelected = false,
}: {
  clip: Clip;
  project?: Project;
  paused?: boolean;
  isSelected?: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const p = clip.props;
  const style = resolveProjectStyle(project);
  const inkFallback = style ? (clip.kind === 'caption' ? style.captionColor : style.inkColor) : '#f4f0e8';
  const animIn = String(p.animation || 'none');
  const animOut = String(p.outAnimation || 'none');
  const animFrames = Math.max(4, Math.min(clip.duration, Math.round(Number(p.animDuration ?? 0.45) * fps)));
  const rawIn = animIn === 'none' ? 1 : bounded(frame / animFrames);
  const rawOut = animOut === 'none' ? 1 : bounded((clip.duration - frame) / animFrames);
  const enter = animIn === 'none' ? 1 : spring({ frame, fps, config: { damping: 200 }, durationInFrames: animFrames });
  const fadeOpacity = rawIn * rawOut;
  const isCaption = clip.kind === 'caption';
  const size = Number(p.fontSize || (isCaption ? 46 : 80));
  const text = String(p.text || '');
  const visible =
    animIn === 'type'
      ? text.slice(0, Math.max(1, Math.floor((frame * text.length) / Math.max(1, animFrames))))
      : text;
  const pos = p.position || (isCaption ? 'bottom' : 'center');
  const align = (p.align as 'left' | 'center' | 'right') || 'center';
  const editorial = p.template === 'editorial';
  const scaleVal = p.scale !== undefined ? Number(p.scale) : 1;
  const rotation = Number(p.rotation ?? 0);
  const translateYAnim =
    animIn === 'none'
      ? 0
      : animIn === 'rise'
        ? (1 - enter) * 28
        : animOut === 'sink' && frame > clip.duration - animFrames
          ? (1 - rawOut) * 20
          : 0;
  const popScale = animIn !== 'pop' ? 1 : 0.78 + 0.22 * enter;
  const blurAnim = animIn !== 'blur-in' ? 0 : (1 - rawIn) * 10;

  const hasLegacyBg = Boolean(p.background && p.background !== 'transparent');
  const bgOn = p.bgEnabled !== undefined ? Boolean(p.bgEnabled) : isCaption || hasLegacyBg;
  const bgColor = bgOn
    ? p.bgOpacity !== undefined
      ? rgbaFromColor(String(p.background || '#0c0d10'), Number(p.bgOpacity))
      : String(p.background || 'rgba(12,13,16,0.76)')
    : 'transparent';
  const padX = bgOn ? Number(p.bgPaddingX ?? (isCaption ? 22 : 20)) : 0;
  const padY = bgOn ? Number(p.bgPaddingY ?? (isCaption ? 10 : 10)) : 0;
  const radius = bgOn ? Number(p.bgRadius ?? (isCaption ? 8 : 10)) : 0;
  const shadowCss = p.shadowEnabled
    ? `0 ${Number(p.shadowOffsetY ?? 4)}px ${Number(p.shadowBlur ?? 14)}px ${String(p.shadowColor || 'rgba(0,0,0,0.65)')}`
    : isCaption && !bgOn
      ? '0 2px 12px rgba(0,0,0,0.6)'
      : undefined;

  return (
    <AbsoluteFill
      style={{
        justifyContent: pos === 'bottom' ? 'flex-end' : pos === 'top' ? 'flex-start' : 'center',
        alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        padding: `${height * 0.08}px ${width * 0.07}px`,
        fontFamily: resolveFontStack(p.fontFamily),
      }}
    >
      <div
        data-clip-box={clip.id}
        style={{
          display: 'inline-block',
          maxWidth: '92%',
          textAlign: align,
          background: bgColor,
          padding: bgOn ? `${padY}px ${padX}px` : '4px 6px',
          borderRadius: radius,
          color: String(p.color || inkFallback),
          textShadow: shadowCss,
          opacity: fadeOpacity * Number(p.opacity ?? 1),
          filter: blurAnim > 0.1 ? `blur(${blurAnim.toFixed(1)}px)` : undefined,
          transformOrigin: 'center center',
          transform: `translate(${Number(p.x || 0)}px, ${Number(p.y || 0) + translateYAnim}px) rotate(${rotation}deg) scale(${scaleVal * popScale})`,
        }}
      >
        {p.subtitle && editorial && (
          <div
            style={{
              fontSize: size * 0.18,
              letterSpacing: size * 0.065,
              marginBottom: size * 0.35,
              opacity: 0.85,
              fontWeight: 500,
            }}
          >
            {String(p.subtitle)}
          </div>
        )}
        <div
          style={{
            fontSize: size,
            fontWeight: Number(p.fontWeight ?? (editorial ? 400 : 650)),
            fontStyle: p.italic ? 'italic' : 'normal',
            textDecoration: p.underline ? 'underline' : 'none',
            lineHeight: Number(p.lineHeight ?? 1.28),
            letterSpacing: p.letterSpacing !== undefined ? Number(p.letterSpacing) : editorial ? size * 0.04 : 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            WebkitTextStroke: p.strokeEnabled
              ? `${Number(p.strokeWidth ?? 2)}px ${String(p.strokeColor || '#000000')}`
              : undefined,
            paintOrder: 'stroke fill',
          }}
        >
          {p.wordHighlight && animIn !== 'type' ? (() => {
            const hlColor = String(p.wordHighlightColor || '#fde047');
            const explicitTimings = Array.isArray(p.wordTimings)
              ? (p.wordTimings as { word: string; startSec: number; endSec: number }[])
              : null;
            if (explicitTimings && explicitTimings.length > 0) {
              const tSec = frame / Math.max(1, fps);
              return explicitTimings.map((wt, i) => {
                const isActive = tSec >= wt.startSec && tSec <= wt.endSec;
                const isPast = tSec > wt.endSec;
                return (
                  <span
                    key={i}
                    style={{
                      display: 'inline-block',
                      color: isActive ? hlColor : undefined,
                      opacity: isActive || isPast ? 1 : 0.62,
                      transform: isActive ? 'scale(1.06)' : undefined,
                      transformOrigin: 'center bottom',
                    }}
                  >
                    {wt.word}
                  </span>
                );
              });
            }
            const tokens = tokenizeCaptionUnits(visible);
            const weights = tokens.map((tk) => Math.max(1, tk.trim().length));
            const totalW = weights.reduce((a, b) => a + b, 0);
            const progressW = (frame / Math.max(1, clip.duration - 1)) * totalW;
            let acc = 0;
            return tokens.map((tk, i) => {
              const startW = acc;
              acc += weights[i];
              const isActive = progressW >= startW && progressW <= acc + 0.001;
              const isPast = progressW > acc + 0.001;
              if (!tk.trim()) return <React.Fragment key={i}>{tk}</React.Fragment>;
              return (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    color: isActive ? hlColor : undefined,
                    opacity: isActive || isPast ? 1 : 0.64,
                    transform: isActive ? 'scale(1.06)' : undefined,
                    transformOrigin: 'center bottom',
                  }}
                >
                  {tk}
                </span>
              );
            });
          })() : (
            visible
          )}
        </div>
        {editorial && (
          <div
            style={{
              height: 2,
              width: 48,
              background: 'currentColor',
              opacity: 0.6,
              margin: align === 'center' ? `${size * 0.32}px auto 0` : `${size * 0.32}px 0 0`,
            }}
          />
        )}
        {p.subtitle && !editorial && (
          <div style={{ fontSize: size * 0.28, letterSpacing: 2, marginTop: 12, opacity: 0.82 }}>
            {String(p.subtitle)}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

function Background({ clip, project }: { clip: Clip; project?: Project }) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig();
  const t = frame / fps;
  const p = clip.props;
  const style = resolveProjectStyle(project);
  const opacity = Number(p.opacity ?? 1);
  if (p.template === 'solid')
    return <AbsoluteFill style={{ background: String(p.color || style?.surfaceColor || '#19232f'), opacity }} />;
  if (p.template === 'grid')
    return (
      <AbsoluteFill
        style={{
          backgroundColor: style?.backgroundColor || '#10171d',
          backgroundImage: `linear-gradient(${p.color || style?.primaryColor || '#4a626e'}30 1px,transparent 1px),linear-gradient(90deg,${p.color || style?.primaryColor || '#4a626e'}30 1px,transparent 1px)`,
          backgroundSize: '80px 80px',
          backgroundPosition: `${t * 5}px ${t * 5}px`,
          opacity,
        }}
      />
    );
  return (
    <AbsoluteFill style={{ background: style?.backgroundColor || '#101722', overflow: 'hidden', opacity }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at ${25 + Math.sin(t * 0.2) * 15}% 70%, ${p.color || style?.primaryColor || '#56708b'} 0,transparent 55%),radial-gradient(ellipse at 75% ${30 + Math.cos(t * 0.15) * 15}%, ${style?.secondaryColor || '#6b556e'} 0,transparent 60%)`,
          filter: 'blur(60px)',
          transform: 'scale(1.15)',
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=%270 0 180 180%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%27.8%27 numOctaves=%273%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 opacity=%27.12%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")',
          opacity: 0.25,
        }}
      />
    </AbsoluteFill>
  );
}

const MAX_COMPONENT_CACHE = 64;
const componentCache = new Map<string, React.ComponentType<any>>();
function loadComponent(c: CodeComponent) {
  let component = componentCache.get(c.hash);
  if (component) {
    // Refresh LRU order
    componentCache.delete(c.hash);
    componentCache.set(c.hash, component);
    return component;
  }
  const module = { exports: {} as any };
  const require = (name: string) => {
    if (name === 'react') return React;
    if (name === 'remotion') return Remotion;
    if (name === 'react/jsx-runtime') return JSXRuntime;
    if (name === 'three') return THREE;
    if (
      name === 'three/examples/jsm/loaders/GLTFLoader.js' ||
      name === 'three/addons/loaders/GLTFLoader.js'
    )
      return { GLTFLoader };
    if (name === '@remotion/three') return { ThreeCanvas, TeardownStage, SpatialStage, useDirectorStage };
    if (name === 'cocraft/director') return { useDirectorStage };
    if (name === 'roughjs') return rough;
    if (name === 'cocraft/rough') return RoughPrimitives;
    throw new Error(`组件不能加载 ${name}`);
  };
  new Function('require', 'module', 'exports', c.compiled)(require, module, module.exports);
  component = module.exports.default || module.exports.Component;
  if (typeof component !== 'function') throw new Error('代码组件必须导出 default React 组件');
  if (componentCache.size >= MAX_COMPONENT_CACHE) {
    const oldestKey = componentCache.keys().next().value;
    if (oldestKey) componentCache.delete(oldestKey);
  }
  componentCache.set(c.hash, component!);
  return component!;
}

class ClipErrorBoundary extends React.Component<
  { resetKey: string; clipName: string; children: React.ReactNode },
  { error: string }
> {
  state = { error: '' };
  static getDerivedStateFromError(e: Error) {
    return { error: e?.message || String(e) };
  }
  componentDidUpdate(prevProps: { resetKey: string }) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: '' });
    }
  }
  render() {
    if (this.state.error) {
      if (getRemotionEnvironment().isRendering) {
        throw new Error(`代码组件「${this.props.clipName}」运行错误：${this.state.error}`);
      }
      return (
        <AbsoluteFill
          data-clip-error={this.state.error}
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            background: 'rgba(24, 16, 18, 0.88)',
            color: '#f5b4ac',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: 24,
            padding: 32,
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>组件运行异常：{this.props.clipName}</div>
            <div style={{ fontSize: 16, opacity: 0.85 }}>{this.state.error}</div>
          </div>
        </AbsoluteFill>
      );
    }
    return this.props.children;
  }
}

const DIRECTOR_MANAGED_CAMERA_KEYS = new Set([
  'cameraPreset',
  'cameraYaw',
  'cameraPitch',
  'cameraDistance',
  'cameraPanX',
  'cameraPanY',
  'cameraLens',
  'renderPass',
  'cameraBookmarks',
  'cameraBookmarksJson',
  'activeBookmarkId',
  'stageShots',
  'stageShotsJson',
  'activeShotId',
  '_studioInteractive',
  '_selectedObjectId',
  '_showCameraPath',
]);

function stripDirectorCameraProps(raw?: Record<string, unknown>): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!DIRECTOR_MANAGED_CAMERA_KEYS.has(k)) out[k] = v;
  }
  return out;
}

function Code({
  component,
  clip,
  project,
  mediaOrigin,
  rotation = 0,
  filterCss,
}: {
  component: CodeComponent;
  clip: Clip;
  project: Project;
  mediaOrigin: string;
  rotation?: number;
  filterCss?: string;
}) {
  const Component = useMemo(() => loadComponent(component), [component.hash]);
  const x = Number(clip.props.x || 0);
  const y = Number(clip.props.y || 0);
  const scale = clip.props.scale !== undefined ? Number(clip.props.scale) : 1;
  const opacity = Number(clip.props.opacity ?? 1);
  const hasTransform = x !== 0 || y !== 0 || scale !== 1 || opacity !== 1 || rotation !== 0 || Boolean(filterCss);
  const rawPass = String(clip.props.renderPass || 'beauty');
  const resolvedPass: SpatialRenderPass =
    rawPass === 'clay' || rawPass === 'depth' || rawPass === 'normal' || rawPass === 'wireframe'
      ? rawPass
      : 'beauty';
  // Only opt out of automatic ThreeCanvas camera override when the TSX component explicitly opts into
  // CoCraft's Director Studio contract via `useDirectorStage()`.
  // Components declaring generic props like `cameraDistance = 40` (world meters) keep their native
  // default camera pose untouched, while ThreeCanvas applies Director Studio's relative yaw/pitch/distance/pan/lens on top!
  const compUsesDirectorHook = Boolean(component.source && /\buseDirectorStage\b/.test(component.source));
  const directorState = useMemo(
    () => ({
      active: true,
      applyCameraOverride: !compUsesDirectorHook,
      cameraYaw: Number(clip.props.cameraYaw ?? 0),
      cameraPitch: Number(clip.props.cameraPitch ?? 0),
      cameraDistance: clip.props.cameraDistance !== undefined ? Number(clip.props.cameraDistance) : 1,
      cameraPanX: Number(clip.props.cameraPanX ?? 0),
      cameraPanY: Number(clip.props.cameraPanY ?? 0),
      cameraLens:
        clip.props.cameraLens !== undefined && Number(clip.props.cameraLens) > 0
          ? Number(clip.props.cameraLens)
          : undefined,
      renderPass: resolvedPass,
      keyLightYaw: clip.props.keyLightYaw !== undefined ? Number(clip.props.keyLightYaw) : undefined,
      keyLightTemp: clip.props.keyLightTemp !== undefined ? Number(clip.props.keyLightTemp) : undefined,
      showStudioGuides: Boolean(clip.props._studioInteractive),
      selectedObjectId:
        typeof clip.props._selectedObjectId === 'string' ? clip.props._selectedObjectId : null,
    }),
    [
      compUsesDirectorHook,
      clip.props.cameraYaw,
      clip.props.cameraPitch,
      clip.props.cameraDistance,
      clip.props.cameraPanX,
      clip.props.cameraPanY,
      clip.props.cameraLens,
      resolvedPass,
      clip.props.keyLightYaw,
      clip.props.keyLightTemp,
      clip.props._studioInteractive,
      clip.props._selectedObjectId,
    ],
  );
  const componentPassProps = useMemo(
    () =>
      compUsesDirectorHook
        ? { ...component.props, ...clip.props }
        : { ...stripDirectorCameraProps(component.props), ...stripDirectorCameraProps(clip.props) },
    [compUsesDirectorHook, component.props, clip.props],
  );
  const node = (
    <DirectorStageProvider value={directorState}>
      <Component
        {...componentPassProps}
        assetUrl={(id: string) => mediaUrl(mediaOrigin, id)}
        assets={project.assets.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          url: mediaUrl(mediaOrigin, a.id),
        }))}
      />
    </DirectorStageProvider>
  );
  if (!hasTransform) return node;
  return (
    <AbsoluteFill
      style={{
        transformOrigin: 'center center',
        transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`,
        opacity,
        filter: filterCss,
      }}
    >
      {node}
    </AbsoluteFill>
  );
}

function Content({
  clip: rawClip,
  liveOverrideProps,
  project,
  mediaOrigin,
  audioTrackMuted,
  videoAudioMuted,
  audioGainScale,
  paused,
  isSelected,
}: {
  clip: Clip;
  liveOverrideProps?: Record<string, unknown>;
  project: Project;
  mediaOrigin: string;
  audioTrackMuted?: boolean;
  videoAudioMuted?: boolean;
  audioGainScale?: (f: number) => number;
  paused?: boolean;
  isSelected?: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const keyframedProps = resolveClipPropsAtFrame(rawClip, frame);
  const resolvedProps = liveOverrideProps ? { ...keyframedProps, ...liveOverrideProps } : keyframedProps;
  const clip = resolvedProps === rawClip.props ? rawClip : { ...rawClip, props: resolvedProps };
  const rotation = Number(clip.props.rotation || 0);
  const borderRadius = Number(clip.props.borderRadius || 0);
  const filterCss = buildFilterCss(clip.props);
  const vignette = Number(clip.props.vignette || 0);
  const effectiveVideoMuted = Boolean(videoAudioMuted || clip.muted);
  const effectiveAudioMuted = Boolean(audioTrackMuted || clip.muted);
  const videoVol: number | ((f: number) => number) = effectiveVideoMuted
    ? 0
    : (f: number) => computeAudioVolume(f, clip, fps) * (audioGainScale ? audioGainScale(f) : 1);

  if (getPreset(String(clip.props.presetId || ''))) {
    const px = Number(clip.props.x || 0);
    const py = Number(clip.props.y || 0);
    const pScale = clip.props.scale !== undefined ? Number(clip.props.scale) : 1;
    const pOpacity = clip.props.opacity !== undefined ? Number(clip.props.opacity) : 1;
    const hasPresetXform = px !== 0 || py !== 0 || pScale !== 1 || rotation !== 0;
    return (
      <AbsoluteFill
        style={{
          transformOrigin: 'center center',
          transform: hasPresetXform
            ? `translate(${px}px, ${py}px) rotate(${rotation}deg) scale(${pScale})`
            : undefined,
          opacity: pOpacity,
          filter: filterCss,
        }}
      >
        <PresetContent clip={clip} project={project} mediaOrigin={mediaOrigin} videoVolume={videoVol} />
      </AbsoluteFill>
    );
  }
  const linkedAsset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  const projectStyle = resolveProjectStyle(project);
  if (linkedAsset?.kind === 'model-3d') {
    const modelSrc = mediaUrl(mediaOrigin, linkedAsset.id);
    return (
      <SpatialStage
        modelUrl={modelSrc}
        modelFilename={linkedAsset.name || linkedAsset.path}
        title={String(clip.props.text || clip.name)}
        subtitle={String(clip.props.subtitle || (linkedAsset.subkind === 'splat-3d' ? '3DGS 空间世界' : '三维模型舞台'))}
        explode={Number(clip.props.explode ?? 0)}
        speed={Number(clip.props.speed ?? 1)}
        cameraPreset={String(clip.props.cameraPreset || 'orbit')}
        cameraLens={Number(clip.props.cameraLens ?? 35)}
        cameraYaw={Number(clip.props.cameraYaw ?? 0)}
        cameraPitch={Number(clip.props.cameraPitch ?? 0)}
        cameraDistance={Number(clip.props.cameraDistance ?? 1)}
        cameraPanX={Number(clip.props.cameraPanX ?? 0)}
        cameraPanY={Number(clip.props.cameraPanY ?? 0)}
        lightingPreset={String(clip.props.lightingPreset || 'studio')}
        lookPreset={String(clip.props.lookPreset || 'cinema')}
        renderPass={String(clip.props.renderPass || 'beauty')}
        particles3D={String(clip.props.particles3D || 'none')}
        dofStrength={Number(clip.props.dofStrength ?? 16)}
        bloomStrength={Number(clip.props.bloomStrength ?? 20)}
        animationIndex={Number(clip.props.animationIndex ?? 0)}
        animateExplode={Boolean(clip.props.animateExplode ?? false)}
        showHud={Boolean(clip.props.showHud ?? false)}
        focusLabel={String(clip.props.focusLabel || linkedAsset.name)}
        accent={String(clip.props.accent || projectStyle?.primaryColor || '#3b82f6')}
        secondary={String(clip.props.secondary || projectStyle?.secondaryColor || '#14b8a6')}
        surface={String(clip.props.surface || (projectStyle && isLightHex(projectStyle.backgroundColor) ? 'light' : 'dark'))}
      />
    );
  }
  if (clip.kind === 'title' || clip.kind === 'caption') {
    return <Title clip={clip} project={project} paused={paused} isSelected={isSelected} />;
  }
  if (clip.kind === 'shape') return <Background clip={clip} project={project} />;
  if (clip.kind === 'code') {
    const c = project.components.find((c) => c.id === clip.componentId);
    if (!c) return null;
    return (
      <ClipErrorBoundary resetKey={`${c.hash}:${clip.id}`} clipName={clip.name || c.name}>
        <Code
          component={c}
          clip={clip}
          project={project}
          mediaOrigin={mediaOrigin}
          rotation={rotation}
          filterCss={filterCss}
        />
      </ClipErrorBoundary>
    );
  }
  const src = mediaUrl(mediaOrigin, clip.assetId!);
  if (clip.kind === 'audio') {
    if (effectiveAudioMuted) return null;
    return (
      <Html5Audio
        src={src}
        startFrom={clip.sourceIn}
        volume={(f) => computeAudioVolume(f, clip, fps) * (audioGainScale ? audioGainScale(f) : 1)}
      />
    );
  }
  const motion = clip.props.animation === 'none' ? 1 : 1 + Math.min(frame / (clip.duration || 1), 1) * 0.035;
  const cameraBreath = Math.max(0, Math.min(100, Number(clip.props.cameraBreath || 0)));
  const filmGrain = Math.max(0, Math.min(100, Number(clip.props.filmGrain || 0)));
  const overlayEffect = String(clip.props.overlayEffect || 'none');
  const breathAmt = cameraBreath / 100;
  const bt = frame / Math.max(1, fps);
  const breathX = breathAmt > 0 ? (Math.sin(bt * 0.85) * 9 + Math.sin(bt * 1.9 + 1.2) * 3) * breathAmt : 0;
  const breathY = breathAmt > 0 ? Math.cos(bt * 0.72 + 0.5) * 6.5 * breathAmt : 0;
  const breathRot = breathAmt > 0 ? Math.sin(bt * 0.55) * 0.45 * breathAmt : 0;
  const breathScale = breathAmt > 0 ? 1 + 0.034 * breathAmt + Math.sin(bt * 0.65) * 0.012 * breathAmt : 1;
  const boxScale = Number(clip.props.scale || 1) * (clip.kind === 'image' ? motion : 1) * breathScale;
  const mediaStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectPosition: `${Math.max(0, Math.min(100, Number(clip.props.focalX ?? 50)))}% ${Math.max(0, Math.min(100, Number(clip.props.focalY ?? 50)))}%`,
    objectFit: clip.props.fit || 'cover',
  };
  const boxStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius,
    overflow: 'hidden',
    transform: `translate(${(Number(clip.props.x || 0) + breathX).toFixed(2)}px,${(Number(clip.props.y || 0) + breathY).toFixed(2)}px) rotate(${(rotation + breathRot).toFixed(3)}deg) scale(${boxScale.toFixed(4)})`,
    transformOrigin: 'center center',
    opacity: Number(clip.props.opacity ?? 1),
    filter: filterCss,
  };
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <div data-clip-box={clip.id} style={boxStyle}>
        {clip.kind === 'image' ? (
          <Img src={src} style={mediaStyle} />
        ) : getRemotionEnvironment().isRendering ? (
          <OffthreadVideo src={src} startFrom={clip.sourceIn} volume={videoVol} style={mediaStyle} />
        ) : (
          <Html5Video src={src} startFrom={clip.sourceIn} volume={videoVol} style={mediaStyle} />
        )}
        {(filmGrain > 0 || overlayEffect !== 'none') && (
          <CinematicFinishOverlay
            frame={frame}
            fps={fps}
            filmGrain={filmGrain}
            overlayEffect={overlayEffect}
          />
        )}
        {vignette > 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: `radial-gradient(circle, transparent ${Math.max(25, 72 - vignette * 0.45)}%, rgba(0,0,0,${Math.min(0.85, vignette / 115).toFixed(2)}) 100%)`,
            }}
          />
        )}
      </div>
    </AbsoluteFill>
  );
}

function OutgoingTransitionEnvelope({
  type,
  durationFrames,
  children,
}: {
  type: TransitionType;
  durationFrames: number;
  children: React.ReactNode;
}) {
  const f = useCurrentFrame();
  const dur = Math.max(1, durationFrames);
  const raw = bounded(f / dur);
  const p = 1 - Math.pow(1 - raw, 3);
  let style: React.CSSProperties = {};
  if (type === 'slide-left') {
    style = { transform: `translateX(${(-p * 100).toFixed(2)}%)` };
  } else if (type === 'zoom-in') {
    style = { transform: `scale(${(1 + 0.08 * p).toFixed(4)})` };
  } else if (type === 'blur') {
    style = { filter: `blur(${(p * 14).toFixed(2)}px)` };
  } else if (type === 'fade') {
    // Pro NLE Dip-to-Black: first half fades outgoing clip A smoothly to black
    style = { opacity: raw < 0.5 ? Math.max(0, 1 - raw * 2) : 0 };
  }
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
}

function TransitionEnvelope({
  clip,
  hasOutgoing = false,
  children,
}: {
  clip: Clip;
  hasOutgoing?: boolean;
  children: React.ReactNode;
}) {
  const f = useCurrentFrame();
  const tr = clip.transitionIn;
  if (!tr || clip.kind === 'audio') return <>{children}</>;
  const dur = Math.min(clip.duration, Math.max(1, tr.durationFrames || 1));
  if (f >= dur) return <>{children}</>;
  const raw = Math.max(0, Math.min(1, f / dur));
  const p = 1 - Math.pow(1 - raw, 3);
  let style: React.CSSProperties = {};
  if (tr.type === 'dissolve') {
    style = { opacity: p };
  } else if (tr.type === 'slide-left') {
    style = { transform: `translateX(${((1 - p) * 100).toFixed(2)}%)` };
  } else if (tr.type === 'zoom-in') {
    style = { transform: `scale(${(0.88 + 0.12 * p).toFixed(4)})`, opacity: p };
  } else if (tr.type === 'blur') {
    style = { filter: `blur(${((1 - p) * 14).toFixed(2)}px)`, opacity: p };
  } else if (tr.type === 'wipe') {
    style = { clipPath: `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)` };
  } else if (tr.type === 'fade') {
    if (hasOutgoing) {
      // Second half of Dip-to-Black: incoming clip B fades up from black
      style = { opacity: raw < 0.5 ? 0 : bounded((raw - 0.5) * 2) };
    }
  }
  return (
    <AbsoluteFill style={style}>
      {children}
      {tr.type === 'fade' && !hasOutgoing && (
        <AbsoluteFill style={{ background: `rgba(0, 0, 0, ${(1 - p).toFixed(4)})`, pointerEvents: 'none' }} />
      )}
    </AbsoluteFill>
  );
}

export function Film({ project, sequenceId, mediaOrigin, paused, selectedClipId, liveOverride }: FilmProps) {
  const sequence: FilmSequence = project.sequences.find((s) => s.id === sequenceId) || project.sequences[0];
  const muted = new Set(sequence.mutedTracks || []);
  const solo = new Set(sequence.soloTracks || []);
  const isTrackActive = (t: Clip['track']) => !muted.has(t) && (solo.size === 0 || solo.has(t));
  const a1TrackMuted = !isTrackActive('audio');
  const v1VideoAudioMuted = Boolean(sequence.mutedVideoAudio) || !isTrackActive('visual');
  const sortedClips = [...sequence.clips]
    .filter((clip) => isClipTrackActive(sequence, clip))
    .sort((a, b) => getClipCompositingOrder(sequence, a) - getClipCompositingOrder(sequence, b) || a.start - b.start);

  return (
    <AbsoluteFill style={{ background: sequence.background }}>
      {sortedClips.map((origClip) => {
        const clipOverride = liveOverride && liveOverride.clipId === origClip.id ? liveOverride.props : undefined;
        const clip = origClip;
        const isSelected = selectedClipId === clip.id;

        // Pro NLE True A/B Cross-Transition Bridge: when an incoming clip has transitionIn and touches a preceding
        // clip on the same track, render outgoing footage (tail handle or held last frame) seamlessly underneath!
        const tr = clip.transitionIn;
        const trDur = tr && clip.kind !== 'audio' ? Math.min(clip.duration, Math.max(1, tr.durationFrames || 1)) : 0;
        const outgoingClip =
          tr && trDur > 0
            ? sortedClips.find(
                (prev) =>
                  prev.id !== clip.id &&
                  prev.track === clip.track &&
                  prev.kind !== 'audio' &&
                  Math.abs(prev.start + prev.duration - clip.start) <= 1,
              )
            : undefined;

        let outgoingBridge: React.ReactNode = null;
        if (outgoingClip && tr && trDur > 0) {
          const outAsset = outgoingClip.assetId
            ? project.assets.find((a) => a.id === outgoingClip.assetId)
            : undefined;
          const outAssetFrames =
            outAsset && outAsset.duration > 0 ? Math.floor(outAsset.duration * sequence.fps) : 0;
          const hasTailHandle =
            outgoingClip.kind === 'video' &&
            outAssetFrames > 0 &&
            outgoingClip.sourceIn + outgoingClip.duration + trDur <= outAssetFrames;
          const bridgeClip: Clip =
            outgoingClip.kind === 'video'
              ? {
                  ...outgoingClip,
                  sourceIn: hasTailHandle
                    ? outgoingClip.sourceIn + outgoingClip.duration
                    : Math.max(0, outgoingClip.sourceIn + outgoingClip.duration - 1),
                  duration: trDur,
                  muted: hasTailHandle ? outgoingClip.muted : true,
                }
              : outgoingClip;
          const bridgeInner = (
            <Content
              clip={bridgeClip}
              project={project}
              mediaOrigin={mediaOrigin}
              audioTrackMuted={a1TrackMuted}
              videoAudioMuted={v1VideoAudioMuted || !hasTailHandle}
              audioGainScale={hasTailHandle ? (f) => bounded(1 - f / trDur) : undefined}
              paused={paused}
              isSelected={false}
            />
          );
          outgoingBridge = (
            <Sequence
              key={`${clip.id}-tr-out`}
              from={clip.start}
              durationInFrames={trDur}
              name={`${outgoingClip.name} (转场出画)`}
              layout="absolute-fill"
            >
              <OutgoingTransitionEnvelope type={tr.type} durationFrames={trDur}>
                {hasTailHandle ? (
                  bridgeInner
                ) : (
                  <Freeze frame={outgoingClip.kind === 'video' ? 0 : Math.max(0, outgoingClip.duration - 1)}>
                    {bridgeInner}
                  </Freeze>
                )}
              </OutgoingTransitionEnvelope>
            </Sequence>
          );
        }

        const incomingAudioCrossfade =
          outgoingClip && trDur > 0 && clip.kind === 'video' ? (f: number) => bounded(f / trDur) : undefined;

        return (
          <React.Fragment key={clip.id}>
            {outgoingBridge}
            <Sequence
              from={clip.start}
              durationInFrames={clip.duration}
              name={clip.name}
              layout="absolute-fill"
            >
              <div
                data-clip-root={clip.id}
                data-clip-kind={clip.kind}
                data-clip-track={clip.track}
                style={{
                  position: 'absolute',
                  inset: 0,
                  mixBlendMode: (clip.props.blendMode as React.CSSProperties['mixBlendMode']) || 'normal',
                }}
              >
                <TransitionEnvelope clip={clip} hasOutgoing={Boolean(outgoingClip)}>
                  <Content
                    clip={clip}
                    liveOverrideProps={clipOverride}
                    project={project}
                    mediaOrigin={mediaOrigin}
                    audioTrackMuted={a1TrackMuted}
                    videoAudioMuted={v1VideoAudioMuted}
                    audioGainScale={incomingAudioCrossfade}
                    paused={paused}
                    isSelected={isSelected}
                  />
                </TransitionEnvelope>
              </div>
            </Sequence>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
}
