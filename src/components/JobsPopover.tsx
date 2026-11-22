import React from 'react';
import { AlertCircle, ArrowUpRight, CheckCheck, X } from 'lucide-react';
import type { Job, Project, Sequence } from '../core/types';
import { IconButton, Spinner } from './ui';

export interface JobsPopoverProps {
  jobs: Job[];
  jobsScope: 'project' | 'all';
  project: Project;
  projectPath: string;
  sequence: Sequence;
  sequenceId: string;
  selectedClipId: string | null;
  onChangeScope: (scope: 'project' | 'all') => void;
  onClearCompleted: () => void;
  onClose: () => void;
  onOpenFile: (jobId: string) => void;
  onRevealFile: (jobId: string) => void;
  onInspectResult: (job: Job, matchedClipId: string) => void;
  onJumpToCandidate: (job: Job) => void;
  onAddAssetToTimeline: (assetId: string) => void;
  onResumeJob: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
}

export function JobsPopover({
  jobs,
  jobsScope,
  project,
  projectPath,
  sequence,
  selectedClipId,
  onChangeScope,
  onClearCompleted,
  onClose,
  onOpenFile,
  onRevealFile,
  onInspectResult,
  onJumpToCandidate,
  onAddAssetToTimeline,
  onResumeJob,
  onCancelJob,
}: JobsPopoverProps) {
  const visibleJobs =
    jobsScope === 'project'
      ? jobs.filter(
          (j) =>
            (!j.projectId && !j.projectPath) ||
            j.projectId === project.id ||
            j.projectPath === projectPath,
        )
      : jobs;

  return (
    <div className="jobs-popover">
      <header>
        <b>后台作业</b>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="jobs-scope-seg" role="group" aria-label="作业筛选">
            <button
              type="button"
              className={jobsScope === 'project' ? 'active' : ''}
              onClick={() => onChangeScope('project')}
            >
              本工程
            </button>
            <button
              type="button"
              className={jobsScope === 'all' ? 'active' : ''}
              onClick={() => onChangeScope('all')}
            >
              全部 ({jobs.length})
            </button>
          </div>
          {jobs.some((j) => j.status !== 'running' && j.status !== 'queued') && (
            <button className="text-button" onClick={onClearCompleted}>
              清理已完成
            </button>
          )}
          <IconButton label="关闭后台作业" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      </header>
      {visibleJobs.length === 0 ? (
        <div className="jobs-empty">
          {jobsScope === 'project' && jobs.length > 0
            ? '当前工程暂无后台作业，可切换「全部」查看其他工程记录。'
            : '导出、生成和分析作业会在这里显示。'}
        </div>
      ) : (
        visibleJobs.slice(0, 14).map((j) => {
          const isSameProject =
            (!j.projectId && j.projectPath === projectPath) || j.projectId === project.id;
          const attachedTarget =
            j.status === 'completed' && j.target && j.targetAttachment?.applied && isSameProject;
          return (
            <div className="job-item" key={j.id}>
              <div className="job-top">
                {j.status === 'running' ? (
                  <Spinner />
                ) : j.status === 'completed' ? (
                  <CheckCheck size={15} />
                ) : (
                  <AlertCircle size={15} />
                )}
                <b>{j.name}</b>
                <span>{j.status === 'running' ? Math.round(j.progress * 100) + '%' : ''}</span>
              </div>
              {(j.projectName || j.branchName) && (
                <div className="job-meta-pill">
                  {j.projectName || '当前工程'}
                  {j.branchName ? ` · ${j.branchName}` : ''}
                </div>
              )}
              <p>
                {j.error ||
                  (j.targetAttachment?.applied
                    ? '已完成 · 已自动挂载为镜头未激活候选'
                    : j.targetAttachment?.reason || j.stage)}
              </p>
              {j.status === 'running' && (
                <div className="job-progress">
                  <i style={{ width: `${j.progress * 100}%` }} />
                </div>
              )}
              <div className="job-actions">
                {j.status === 'completed' && j.output && j.type === 'export' && (
                  <>
                    <button onClick={() => onOpenFile(j.id)}>
                      {j.output?.toLowerCase().endsWith('.png') ? '打开画面' : '打开成片'}{' '}
                      <ArrowUpRight size={11} />
                    </button>
                    <button onClick={() => onRevealFile(j.id)}>在 Finder 中显示</button>
                  </>
                )}
                {j.status === 'completed' && j.result?.text && (
                  <button
                    onClick={() => {
                      const matched =
                        sequence.clips.find(
                          (c) => c.id === selectedClipId && !!c.assetId && c.assetId === j.inputAssetId,
                        )?.id || '';
                      onInspectResult(j, matched);
                    }}
                  >
                    查看结果 <ArrowUpRight size={11} />
                  </button>
                )}
                {attachedTarget && j.target && (
                  <button onClick={() => onJumpToCandidate(j)}>
                    查看镜头候选 <ArrowUpRight size={11} />
                  </button>
                )}
                {j.status === 'completed' &&
                  j.result?.asset &&
                  !attachedTarget &&
                  isSameProject &&
                  project.assets.some((a) => a.id === j.result?.asset?.id) && (
                    <button onClick={() => onAddAssetToTimeline(j.result!.asset!.id)}>添加到时间线</button>
                  )}
                {(j.status === 'failed' || j.status === 'cancelled') &&
                  (j.remote || j.result?.asset) &&
                  !['failed', 'expired', 'canceled', 'cancelled'].includes(j.remote?.status || '') && (
                    <button onClick={() => onResumeJob(j.id)}>
                      {j.result?.asset ? '恢复素材入库' : '继续查询原作业'}
                    </button>
                  )}
                {j.status === 'running' && <button onClick={() => onCancelJob(j.id)}>取消</button>}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
