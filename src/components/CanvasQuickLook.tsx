import React, { useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Box,
  Film,
  Image as ImageIcon,
  Layers,
  Sparkles,
  X,
} from 'lucide-react';
import { mediaUrl } from '../composition/Film';
import type { Asset, Project, Sequence, VaultItem } from '../core/types';
import type { CompositeShot } from '../core/storyboard';
import { getPreset } from '../core/presets';
import { formatAssetCardMeta, formatCanvasDisplayName } from '../lib/canvasLayout';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import { PresetPreview } from './PresetControls';
import { ShotCompositeThumb } from './ShotCompositeThumb';

export interface CanvasQuickLookProps {
  nodeKey: string;
  navigableKeys: string[];
  project: Project;
  sequence: Sequence;
  shots: CompositeShot[];
  previewOrigin: string;
  onNavigate: (nextKey: string) => void;
  onClose: () => void;
  onJumpToEdit?: (clipId: string, startFrame: number) => void;
}

export function CanvasQuickLook({
  nodeKey,
  navigableKeys,
  project,
  sequence,
  shots,
  previewOrigin,
  onNavigate,
  onClose,
  onJumpToEdit,
}: CanvasQuickLookProps) {
  const idx = navigableKeys.indexOf(nodeKey);
  const canPrev = idx > 0;
  const canNext = idx >= 0 && idx < navigableKeys.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft' && canPrev) {
        e.preventDefault();
        onNavigate(navigableKeys[idx - 1]);
      } else if (e.key === 'ArrowRight' && canNext) {
        e.preventDefault();
        onNavigate(navigableKeys[idx + 1]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [canPrev, canNext, idx, navigableKeys, onClose, onNavigate]);

  let title = '';
  let subtitle = '';
  let body: React.ReactNode = null;
  let footerAction: React.ReactNode = null;

  if (nodeKey.startsWith('asset:')) {
    const asset: Asset | undefined = project.assets.find((a) => `asset:${a.id}` === nodeKey);
    if (!asset) return null;
    title = formatCanvasDisplayName(asset.name);
    subtitle = [
      asset.kind === 'video' ? '视频素材' : asset.kind === 'audio' ? '音频素材' : asset.kind === 'model-3d' ? '三维模型' : '图片素材',
      formatAssetCardMeta(asset),
      asset.source?.provider,
    ]
      .filter(Boolean)
      .join(' · ');

    if (asset.kind === 'video') {
      body = (
        <video
          key={asset.id}
          className="cc-ql-media"
          src={mediaUrl(previewOrigin, asset.id)}
          controls
          autoPlay
          loop
          playsInline
        />
      );
    } else if (asset.kind === 'audio') {
      body = (
        <div className="cc-ql-audio">
          <AudioLines size={28} />
          <AudioWaveformPlayer
            id={`ql-${asset.id}`}
            name={asset.name}
            url={mediaUrl(previewOrigin, asset.id)}
            duration={asset.duration}
            waveform={asset.waveform}
          />
        </div>
      );
    } else if (asset.kind === 'image') {
      body = (
        <img
          className="cc-ql-media"
          src={mediaUrl(previewOrigin, asset.id)}
          alt={asset.name}
        />
      );
    } else {
      body = (
        <div className="cc-ql-placeholder">
          <Box size={36} />
          <span>{asset.name}（GLB 三维模型）</span>
        </div>
      );
    }
  } else if (nodeKey.startsWith('ent:')) {
    const ent: VaultItem | undefined = (project.vault || []).find((v) => `ent:${v.id}` === nodeKey);
    if (!ent) return null;
    const isCompound = ent.entityKind === 'compound';
    title = formatCanvasDisplayName(ent.name, isCompound);
    subtitle = isCompound && ent.compound
      ? `精剪复合资产 · ${ent.compound.clips.length} 层 · ${(ent.compound.durationFrames / ent.compound.fps).toFixed(1)}s`
      : ent.entityKind === 'text'
        ? `画布脚本文本 · v${ent.version}`
        : `一致设定 · v${ent.version}`;

    const refAssetId = ent.variants?.[0]?.assetId || ent.assetId;
    const refAsset = refAssetId ? project.assets.find((a) => a.id === refAssetId) : undefined;
    const hasRig = Boolean(ent.rig?.presetId && getPreset(ent.rig.presetId));

    if (ent.entityKind === 'text') {
      body = <div className="cc-ql-text">{ent.textContent || '（空文本）'}</div>;
    } else if (hasRig) {
      body = (
        <div className="cc-ql-preset-wrap">
          <PresetPreview presetId={ent.rig!.presetId!} values={ent.rig!.props} playing />
        </div>
      );
    } else if (refAsset && !refAsset.offline) {
      body =
        refAsset.kind === 'video' ? (
          <video
            key={refAsset.id}
            className="cc-ql-media"
            src={mediaUrl(previewOrigin, refAsset.id)}
            controls
            autoPlay
            loop
            playsInline
          />
        ) : (
          <img className="cc-ql-media" src={mediaUrl(previewOrigin, refAsset.id)} alt={ent.name} />
        );
    } else {
      body = (
        <div className="cc-ql-placeholder">
          {isCompound ? <Layers size={32} /> : <ImageIcon size={32} />}
          <span>{ent.promptAnchor || ent.description || ent.name}</span>
        </div>
      );
    }
  } else if (nodeKey.startsWith('shot:')) {
    const shot = shots.find((s) => `shot:${s.id}` === nodeKey);
    if (!shot) return null;
    title = `镜头 ${String(shot.index).padStart(2, '0')} · ${shot.anchorClip.name}`;
    subtitle = `${(shot.duration / sequence.fps).toFixed(1)}s · ${shot.compositeClips.length} 层合成`;
    const anchorAsset = shot.anchorClip.assetId
      ? project.assets.find((a) => a.id === shot.anchorClip.assetId)
      : undefined;
    body = (
      <div className="cc-ql-shot">
        <div className="cc-ql-shot-stage">
          {anchorAsset && anchorAsset.kind === 'video' && !anchorAsset.offline ? (
            <video
              key={anchorAsset.id}
              className="cc-ql-media"
              src={mediaUrl(previewOrigin, anchorAsset.id)}
              controls
              autoPlay
              loop
              playsInline
            />
          ) : (
            <ShotCompositeThumb
              project={project}
              sequence={sequence}
              shot={shot}
              previewOrigin={previewOrigin}
            />
          )}
        </div>
        {shot.scriptText && <p className="cc-ql-script">{shot.scriptText}</p>}
      </div>
    );
    if (onJumpToEdit) {
      footerAction = (
        <button
          type="button"
          className="button tiny primary"
          onClick={() => {
            onClose();
            onJumpToEdit(shot.anchorClip.id, shot.start);
          }}
        >
          <Film size={12} /> 在剪辑台精调
        </button>
      );
    }
  } else {
    return null;
  }

  return (
    <div
      className="cc-quicklook-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`快速预览 ${title}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cc-quicklook-card">
        <header className="cc-quicklook-head">
          <div className="cc-quicklook-meta">
            <b>{title}</b>
            {subtitle && <small>{subtitle}</small>}
          </div>
          <div className="cc-quicklook-nav">
            {navigableKeys.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="上一项"
                  disabled={!canPrev}
                  onClick={() => canPrev && onNavigate(navigableKeys[idx - 1])}
                >
                  <ArrowLeft size={14} />
                </button>
                <span>
                  {idx + 1} / {navigableKeys.length}
                </span>
                <button
                  type="button"
                  aria-label="下一项"
                  disabled={!canNext}
                  onClick={() => canNext && onNavigate(navigableKeys[idx + 1])}
                >
                  <ArrowRight size={14} />
                </button>
              </>
            )}
            <button type="button" aria-label="关闭快速预览" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </header>
        <div className="cc-quicklook-body">{body}</div>
        <footer className="cc-quicklook-foot">
          <span>
            <Sparkles size={11} /> 空格 / ESC 关闭 · ← → 切换卡片
          </span>
          {footerAction}
        </footer>
      </div>
    </div>
  );
}
