import { PresetContent } from './Presets';
import { getPreset } from '../core/presets';
import React, { useMemo } from 'react';
import * as Remotion from 'remotion';
import * as JSXRuntime from 'react/jsx-runtime';
import {
  AbsoluteFill,
  Sequence,
  Img,
  OffthreadVideo,
  Html5Video,
  Html5Audio,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  getRemotionEnvironment,
} from 'remotion';
import type { Project, Sequence as FilmSequence, Clip, CodeComponent } from '../core/types';

export interface FilmProps extends Record<string, unknown> {
  project: Project;
  sequenceId: string;
  mediaOrigin: string;
}
export const mediaUrl = (origin: string, id: string, thumbnail = false) =>
  `${origin}/media/${encodeURIComponent(id)}${thumbnail ? '?thumbnail=1' : ''}`;
const bounded = (n: number) => Math.max(0, Math.min(1, n));
const ease = (f: number, duration: number, fps: number) =>
  Math.min(bounded(f / (fps * 0.4)), bounded((duration - f) / Math.max(1, fps * 0.4)));

function Title({ clip }: { clip: Clip }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const p = clip.props;
  const fade = p.animation === 'none' ? 1 : ease(frame, clip.duration, fps);
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.round(fps * 0.9) });
  const isCaption = clip.kind === 'caption',
    size = Number(p.fontSize || (isCaption ? 48 : 88));
  const text = String(p.text || '');
  const visible =
    p.animation === 'type' ? text.slice(0, Math.floor((frame * text.length) / (fps * 0.8))) : text;
  const pos = p.position || 'center';
  const align = p.align || 'center';
  const editorial = p.template === 'editorial';
  return (
    <AbsoluteFill
      style={{
        justifyContent: pos === 'bottom' ? 'flex-end' : pos === 'top' ? 'flex-start' : 'center',
        alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        padding: `${height * 0.09}px ${width * 0.075}px`,
        opacity: fade * Number(p.opacity ?? 1),
        transform: `translate(${Number(p.x || 0)}px, ${Number(p.y || 0) + (p.animation === 'rise' ? (1 - enter) * 30 : 0)}px)`,
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: '100%',
          textAlign: align,
          background: p.background || 'transparent',
          padding: isCaption ? '12px 24px' : undefined,
          borderRadius: isCaption ? 8 : 0,
          color: String(p.color || '#f4f0e8'),
          textShadow: isCaption ? '0 2px 12px #0006' : undefined,
        }}
      >
        {p.subtitle && editorial && (
          <div
            style={{
              fontSize: size * 0.18,
              letterSpacing: size * 0.065,
              marginBottom: size * 0.4,
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
            fontWeight: editorial ? 400 : 600,
            lineHeight: 1.28,
            letterSpacing: editorial ? size * 0.04 : 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
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
              margin: align === 'center' ? `${size * 0.38}px auto 0` : `${size * 0.38}px 0 0`,
            }}
          />
        )}
        {p.subtitle && !editorial && (
          <div style={{ fontSize: size * 0.26, letterSpacing: 3, marginTop: 20, opacity: 0.8 }}>
            {String(p.subtitle)}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
function Background({ clip }: { clip: Clip }) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig();
  const t = frame / fps;
  const p = clip.props;
  if (p.template === 'solid') return <AbsoluteFill style={{ background: String(p.color || '#19232f') }} />;
  if (p.template === 'grid')
    return (
      <AbsoluteFill
        style={{
          backgroundColor: '#10171d',
          backgroundImage: `linear-gradient(${p.color || '#4a626e'}30 1px,transparent 1px),linear-gradient(90deg,${p.color || '#4a626e'}30 1px,transparent 1px)`,
          backgroundSize: '80px 80px',
          backgroundPosition: `${t * 5}px ${t * 5}px`,
        }}
      />
    );
  return (
    <AbsoluteFill style={{ background: '#101722', overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at ${25 + Math.sin(t * 0.2) * 15}% 70%, ${p.color || '#56708b'} 0,transparent 55%),radial-gradient(ellipse at 75% ${30 + Math.cos(t * 0.15) * 15}%, #6b556e 0,transparent 60%)`,
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
  return (
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
}
function Content({ clip, project, mediaOrigin }: { clip: Clip; project: Project; mediaOrigin: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (getPreset(String(clip.props.presetId || ''))) return <PresetContent clip={clip} />;
  if (clip.kind === 'title' || clip.kind === 'caption') return <Title clip={clip} />;
  if (clip.kind === 'shape') return <Background clip={clip} />;
  if (clip.kind === 'code') {
    const c = project.components.find((c) => c.id === clip.componentId);
    return c ? <Code component={c} clip={clip} project={project} mediaOrigin={mediaOrigin} /> : null;
  }
  const src = mediaUrl(mediaOrigin, clip.assetId!);
  const volume = Number(clip.props.volume ?? 1);
  if (clip.kind === 'audio')
    return (
      <Html5Audio
        src={src}
        startFrom={clip.sourceIn}
        volume={(f) =>
          volume * Math.min(bounded(f / (fps * 0.5)), bounded((clip.duration - f) / (fps * 0.8)))
        }
      />
    );
  const motion = clip.props.animation === 'none' ? 1 : 1 + Math.min(frame / (clip.duration || 1), 1) * 0.035;
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectPosition: `${Math.max(0, Math.min(100, Number(clip.props.focalX ?? 50)))}% ${Math.max(0, Math.min(100, Number(clip.props.focalY ?? 50)))}%`,
    objectFit: clip.props.fit || 'cover',
    transform: `translate(${Number(clip.props.x || 0)}px,${Number(clip.props.y || 0)}px) scale(${Number(clip.props.scale || 1) * (clip.kind === 'image' ? motion : 1)})`,
    opacity: Number(clip.props.opacity ?? 1),
  };
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {clip.kind === 'image' ? (
        <Img src={src} style={style} />
      ) : getRemotionEnvironment().isRendering ? (
        <OffthreadVideo src={src} startFrom={clip.sourceIn} volume={volume} style={style} />
      ) : (
        <Html5Video src={src} startFrom={clip.sourceIn} volume={volume} style={style} />
      )}
    </AbsoluteFill>
  );
}
export function Film({ project, sequenceId, mediaOrigin }: FilmProps) {
  const sequence: FilmSequence = project.sequences.find((s) => s.id === sequenceId) || project.sequences[0];
  const layers = { visual: 0, audio: 1, overlay: 2, caption: 3 };
  return (
    <AbsoluteFill style={{ background: sequence.background }}>
      {[...sequence.clips]
        .sort(
          (a, b) => layers[a.track] - layers[b.track] || (a.layer ?? 0) - (b.layer ?? 0) || a.start - b.start,
        )
        .map((clip) => (
          <Sequence
            key={clip.id}
            from={clip.start}
            durationInFrames={clip.duration}
            name={clip.name}
            layout="absolute-fill"
          >
            <Content clip={clip} project={project} mediaOrigin={mediaOrigin} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
}
