import React from 'react';
import { Box, Code2, Film } from 'lucide-react';
import { mediaFrameUrl, mediaUrl } from '../composition/Film';
import { getPreset } from '../core/presets';
import { PresetPreview } from './PresetControls';
import type { CompositeShot } from '../core/storyboard';
import type { Clip, Project, Sequence } from '../core/types';

interface ShotCompositeThumbProps {
  project: Project;
  sequence: Sequence;
  shot: CompositeShot;
  previewOrigin: string;
}

const trackRank: Record<string, number> = {
  visual: 0,
  overlay: 1,
  caption: 2,
  audio: 3,
};

export function ShotCompositeThumb({ project, sequence, shot, previewOrigin }: ShotCompositeThumbProps) {
  const portrait = sequence.height > sequence.width;
  const activeStyle = (project.vault || []).find((v) => v.id === project.activeBrandId);
  const bg =
    activeStyle?.styleTokens?.backgroundColor ||
    activeStyle?.brand?.backgroundColor ||
    sequence.background ||
    '#0e1014';

  const sampleFrame = shot.start + Math.floor(shot.duration * 0.25);
  const activeLayers: Clip[] = [...shot.compositeClips, ...(shot.spanningOverlays || []), ...shot.captionClips]
    .filter((c) => sampleFrame >= c.start && sampleFrame < c.start + c.duration)
    .sort(
      (a, b) =>
        (trackRank[a.track] ?? 1) - (trackRank[b.track] ?? 1) || (a.layer ?? 0) - (b.layer ?? 0),
    );

  const layersToDraw = activeLayers.length > 0 ? activeLayers : [shot.anchorClip];
  const centeredTitleTexts = new Set(
    layersToDraw
      .filter((l) => l.kind === 'title' && (!l.props.position || l.props.position === 'center') && l.props.text)
      .map((l) => String(l.props.text).trim()),
  );
  const hasMultipleLayers = layersToDraw.length > 1;

  return (
    <div className="shot-composite-stage" style={{ background: bg }}>
      {layersToDraw.map((clip) => {
        const presetId = String(clip.props.presetId || '');
        const hasPreset = Boolean(getPreset(presetId));
        const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
        const opacity = Number(clip.props.opacity ?? 1);

        if (hasPreset) {
          return (
            <div key={clip.id} className="scs-layer" style={{ opacity }}>
              <PresetPreview presetId={presetId} values={clip.props} portrait={portrait} thumbnail />
            </div>
          );
        }

        if (asset) {
          if (!asset.offline && (asset.kind === 'video' || asset.thumbnail)) {
            const sourceSampleFrame =
              asset.kind === 'video'
                ? clip.sourceIn + Math.max(0, Math.min(clip.duration - 1, sampleFrame - clip.start))
                : 0;
            const thumbSrc =
              asset.kind === 'video'
                ? mediaFrameUrl(previewOrigin, asset.id, sourceSampleFrame, sequence.fps, asset.sha256)
                : mediaUrl(previewOrigin, asset.id, true);
            return (
              <div key={clip.id} className="scs-layer" style={{ opacity }}>
                <img
                  src={thumbSrc}
                  alt={clip.name}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: (clip.props.fit as 'cover' | 'contain') || 'cover',
                  }}
                />
              </div>
            );
          }
          if (asset.kind === 'model-3d') {
            return (
              <div key={clip.id} className="scs-layer scs-center" style={{ opacity }}>
                <Box size={22} />
                <span>{asset.name}</span>
              </div>
            );
          }
          return (
            <div key={clip.id} className="scs-layer scs-center" style={{ opacity }}>
              <Film size={20} />
              <span>{asset.name}</span>
            </div>
          );
        }

        if (clip.kind === 'code') {
          const comp = project.components.find((c) => c.id === clip.componentId);
          return (
            <div
              key={clip.id}
              className={hasMultipleLayers ? 'scs-code-corner' : 'scs-layer scs-code-badge'}
              style={{ opacity }}
            >
              <Code2 size={hasMultipleLayers ? 11 : 15} />
              <span>{String(clip.props.text || comp?.name || clip.name).slice(0, 20)}</span>
            </div>
          );
        }

        if (clip.kind === 'title' || clip.kind === 'caption') {
          const isCap = clip.kind === 'caption';
          const text = String(clip.props.text || clip.name || '');
          if (isCap && centeredTitleTexts.has(text.trim())) {
            return null;
          }
          const pos = String(clip.props.position || (isCap ? 'bottom' : 'center'));
          const align = String(clip.props.align || 'center');
          const sub = clip.props.subtitle ? String(clip.props.subtitle) : '';
          const blockBg = clip.props.background ? String(clip.props.background) : 'transparent';
          const isFullCard = !isCap && clip.track === 'visual' && blockBg !== 'transparent';

          return (
            <div
              key={clip.id}
              className={`scs-layer scs-text pos-${pos} align-${align}`}
              style={{
                opacity,
                background: isFullCard ? blockBg : 'transparent',
              }}
            >
              <div
                className={isCap ? 'scs-caption-chip' : 'scs-title-chip'}
                style={{
                  color: String(clip.props.color || '#f4f4f6'),
                  background: !isFullCard ? blockBg : 'transparent',
                }}
              >
                {sub && <small>{sub}</small>}
                <span>{text}</span>
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
