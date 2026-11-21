import { PresetContent } from './Presets';
import { getPreset, isLightHex, resolveProjectStyle } from '../core/presets';
import { ThreeCanvas, TeardownStage } from './ThreeStage';
import React, { useMemo } from 'react';
import * as Remotion from 'remotion';
import * as JSXRuntime from 'react/jsx-runtime';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  AbsoluteFill,
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
import type { Project, Sequence as FilmSequence, Clip, CodeComponent } from '../core/types';

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
  const base = Number(clip.props.volume ?? 1);
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
  const previewGuard = paused && isSelected;
  const enter = animIn === 'none' ? 1 : spring({ frame, fps, config: { damping: 200 }, durationInFrames: animFrames });
  const fadeOpacity = previewGuard ? Math.max(0.92, rawIn * rawOut) : rawIn * rawOut;
  const isCaption = clip.kind === 'caption';
  const size = Number(p.fontSize || (isCaption ? 46 : 80));
  const text = String(p.text || '');
  const visible =
    animIn === 'type' && !previewGuard
      ? text.slice(0, Math.max(1, Math.floor((frame * text.length) / Math.max(1, animFrames))))
      : text;
  const pos = p.position || (isCaption ? 'bottom' : 'center');
  const align = (p.align as 'left' | 'center' | 'right') || 'center';
  const editorial = p.template === 'editorial';
  const scaleVal = Number(p.scale ?? 1);
  const rotation = Number(p.rotation ?? 0);
  const translateYAnim =
    previewGuard || animIn === 'none'
      ? 0
      : animIn === 'rise'
        ? (1 - enter) * 28
        : animOut === 'sink' && frame > clip.duration - animFrames
          ? (1 - rawOut) * 20
          : 0;
  const popScale = previewGuard || animIn !== 'pop' ? 1 : 0.78 + 0.22 * enter;
  const blurAnim = previewGuard || animIn !== 'blur-in' ? 0 : (1 - rawIn) * 10;

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
          {visible}
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

const componentCache = new Map<string, React.ComponentType<any>>();
function loadComponent(c: CodeComponent) {
  let component = componentCache.get(c.hash);
  if (component) return component;
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
    if (name === '@remotion/three') return { ThreeCanvas, TeardownStage };
    throw new Error(`组件不能加载 ${name}`);
  };
  new Function('require', 'module', 'exports', c.compiled)(require, module, module.exports);
  component = module.exports.default || module.exports.Component;
  if (typeof component !== 'function') throw new Error('代码组件必须导出 default React 组件');
  componentCache.set(c.hash, component!);
  return component!;
}

function Code({
  component,
  clip,
  project,
  mediaOrigin,
}: {
  component: CodeComponent;
  clip: Clip;
  project: Project;
  mediaOrigin: string;
}) {
  const Component = useMemo(() => loadComponent(component), [component.hash]);
  const x = Number(clip.props.x || 0);
  const y = Number(clip.props.y || 0);
  const scale = Number(clip.props.scale || 1);
  const opacity = Number(clip.props.opacity ?? 1);
  const hasTransform = x !== 0 || y !== 0 || scale !== 1 || opacity !== 1;
  const node = (
    <Component
      {...component.props}
      {...clip.props}
      assetUrl={(id: string) => mediaUrl(mediaOrigin, id)}
      assets={project.assets.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        url: mediaUrl(mediaOrigin, a.id),
      }))}
    />
  );
  if (!hasTransform) return node;
  return (
    <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity }}>
      {node}
    </AbsoluteFill>
  );
}

function Content({
  clip,
  project,
  mediaOrigin,
  audioMuted,
  paused,
  isSelected,
}: {
  clip: Clip;
  project: Project;
  mediaOrigin: string;
  audioMuted?: boolean;
  paused?: boolean;
  isSelected?: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rotation = Number(clip.props.rotation || 0);
  const borderRadius = Number(clip.props.borderRadius || 0);
  const filterCss = buildFilterCss(clip.props);
  const vignette = Number(clip.props.vignette || 0);

  if (getPreset(String(clip.props.presetId || ''))) {
    return (
      <AbsoluteFill
        style={{
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          filter: filterCss,
        }}
      >
        <PresetContent clip={clip} project={project} mediaOrigin={mediaOrigin} />
      </AbsoluteFill>
    );
  }
  const linkedAsset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  const projectStyle = resolveProjectStyle(project);
  if (linkedAsset?.kind === 'model-3d') {
    const modelSrc = mediaUrl(mediaOrigin, linkedAsset.id);
    return (
      <TeardownStage
        modelUrl={modelSrc}
        title={String(clip.props.text || clip.name)}
        subtitle={String(clip.props.subtitle || '三维模型舞台')}
        explode={Number(clip.props.explode ?? 0)}
        speed={Number(clip.props.speed ?? 1)}
        cameraPreset={String(clip.props.cameraPreset || 'orbit')}
        cameraYaw={Number(clip.props.cameraYaw ?? 0)}
        cameraPitch={Number(clip.props.cameraPitch ?? 0)}
        animateExplode={Boolean(clip.props.animateExplode ?? false)}
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
    if (!rotation && !filterCss) return <Code component={c} clip={clip} project={project} mediaOrigin={mediaOrigin} />;
    return (
      <AbsoluteFill
        style={{
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          filter: filterCss,
        }}
      >
        <Code component={c} clip={clip} project={project} mediaOrigin={mediaOrigin} />
      </AbsoluteFill>
    );
  }
  const src = mediaUrl(mediaOrigin, clip.assetId!);
  if (clip.kind === 'audio') {
    if (audioMuted) return null;
    return <Html5Audio src={src} startFrom={clip.sourceIn} volume={(f) => computeAudioVolume(f, clip, fps)} />;
  }
  const motion = clip.props.animation === 'none' ? 1 : 1 + Math.min(frame / (clip.duration || 1), 1) * 0.035;
  const boxScale = Number(clip.props.scale || 1) * (clip.kind === 'image' ? motion : 1);
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
    transform: `translate(${Number(clip.props.x || 0)}px,${Number(clip.props.y || 0)}px) rotate(${rotation}deg) scale(${boxScale})`,
    transformOrigin: 'center center',
    opacity: Number(clip.props.opacity ?? 1),
    filter: filterCss,
  };
  const videoVol = audioMuted ? 0 : (f: number) => computeAudioVolume(f, clip, fps);
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

function TransitionEnvelope({
  clip,
  paused = false,
  isSelected = false,
  children,
}: {
  clip: Clip;
  paused?: boolean;
  isSelected?: boolean;
  children: React.ReactNode;
}) {
  const f = useCurrentFrame();
  const tr = clip.transitionIn;
  if (!tr || clip.kind === 'audio') return <>{children}</>;
  const dur = Math.min(clip.duration, Math.max(1, tr.durationFrames || 1));
  if (f >= dur) return <>{children}</>;
  const raw = Math.max(0, Math.min(1, f / dur));
  const eased = 1 - Math.pow(1 - raw, 3);
  const p = paused && isSelected && f === 0 ? Math.max(0.88, eased) : eased;
  let style: React.CSSProperties = {};
  if (tr.type === 'dissolve') {
    style = { opacity: p };
  } else if (tr.type === 'slide-left') {
    style = { transform: `translateX(${((1 - p) * 100).toFixed(2)}%)` };
  } else if (tr.type === 'zoom-in') {
    style = { transform: `scale(${(0.86 + 0.14 * p).toFixed(4)})`, opacity: p };
  } else if (tr.type === 'blur') {
    style = { filter: `blur(${((1 - p) * 16).toFixed(2)}px)`, opacity: Math.min(1, p * 1.3) };
  } else if (tr.type === 'wipe') {
    style = { clipPath: `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)` };
  }
  return (
    <AbsoluteFill style={style}>
      {children}
      {tr.type === 'fade' && (
        <AbsoluteFill style={{ background: `rgba(0, 0, 0, ${(1 - p).toFixed(4)})`, pointerEvents: 'none' }} />
      )}
    </AbsoluteFill>
  );
}

export function Film({ project, sequenceId, mediaOrigin, paused, selectedClipId, liveOverride }: FilmProps) {
  const sequence: FilmSequence = project.sequences.find((s) => s.id === sequenceId) || project.sequences[0];
  const muted = new Set(sequence.mutedTracks || []);
  const layers = { visual: 0, audio: 1, overlay: 2, caption: 3 };
  return (
    <AbsoluteFill style={{ background: sequence.background }}>
      {[...sequence.clips]
        .filter((clip) => !muted.has(clip.track))
        .sort(
          (a, b) => layers[a.track] - layers[b.track] || (a.layer ?? 0) - (b.layer ?? 0) || a.start - b.start,
        )
        .map((origClip) => {
          const clip =
            liveOverride && liveOverride.clipId === origClip.id
              ? { ...origClip, props: { ...origClip.props, ...liveOverride.props } }
              : origClip;
          const isSelected = selectedClipId === clip.id;
          return (
            <Sequence
              key={clip.id}
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
                <TransitionEnvelope clip={clip} paused={paused} isSelected={isSelected}>
                  <Content
                    clip={clip}
                    project={project}
                    mediaOrigin={mediaOrigin}
                    audioMuted={muted.has('audio')}
                    paused={paused}
                    isSelected={isSelected}
                  />
                </TransitionEnvelope>
              </div>
            </Sequence>
          );
        })}
    </AbsoluteFill>
  );
}
