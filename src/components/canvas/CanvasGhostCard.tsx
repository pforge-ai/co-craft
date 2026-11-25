import React from 'react';
import { AudioLines, Clapperboard, Image as ImageIcon, Sparkles, X } from 'lucide-react';
import type { Job } from '../../core/types';
import type { CanvasPt } from '../CanvasWiresLayer';

interface CanvasGhostCardProps {
  job: Job;
  pos: CanvasPt;
  onCancel?: (jobId: string) => void;
}

export const CanvasGhostCard = React.memo(function CanvasGhostCard({
  job,
  pos,
  onCancel,
}: CanvasGhostCardProps) {
  const useKind = job.canvas?.use || 'image';
  const pct = Math.max(0, Math.min(100, Math.round((job.progress || 0) * 100)));
  const isAudio = useKind === 'speech';
  const isVideo = useKind === 'video';
  const Icon = isAudio ? AudioLines : isVideo ? Clapperboard : ImageIcon;
  const kindLabel = isAudio ? 'AI 配音' : isVideo ? 'AI 视频' : 'AI 图像';
  const hasLastFrame = Boolean(job.canvas?.lastFrameAssetId);
  const refCount = job.canvas?.referenceAssetIds?.length || 0;
  const modeTag = hasLastFrame
    ? '首尾帧'
    : refCount >= 2
      ? `${refCount} 图参考`
      : refCount === 1
        ? isVideo
          ? '图生视频'
          : '图生图'
        : '';

  return (
    <div
      data-node-id={`ghost:${job.id}`}
      className={`cc-node asset cc-ghost-node ${isAudio ? 'audio' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="cc-node-header cc-ghost-header">
        <Icon size={11} />
        <span>
          {kindLabel}
          {modeTag ? ` · ${modeTag}` : ''}
        </span>
        <small>{pct > 0 ? `${pct}%` : '渲染中'}</small>
      </div>
      <div className="cc-node-card asset-card cc-ghost-card">
        <div className="cc-ghost-fluid" aria-hidden="true" />
        <div className="cc-ghost-body">
          <div className="cc-ghost-top-row">
            <span className="cc-ghost-pill">
              <Sparkles size={10} />
              <span>{job.stage || '正在生成'}</span>
            </span>
            {onCancel && (
              <button
                type="button"
                className="cc-ghost-cancel"
                title="取消生成任务"
                aria-label={`取消 ${job.name}`}
                onClick={() => onCancel(job.id)}
              >
                <X size={11} />
              </button>
            )}
          </div>
          <p className="cc-ghost-prompt" title={job.canvas?.promptPreview || job.name}>
            {job.canvas?.promptPreview || job.name}
          </p>
          <div className="cc-ghost-progress-track">
            <div
              className={`cc-ghost-progress-fill ${pct <= 0 ? 'indeterminate' : ''}`}
              style={pct > 0 ? { width: `${Math.max(8, pct)}%` } : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
