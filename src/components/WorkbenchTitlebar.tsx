import React from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  FolderOpen,
  GitBranch,
  LayoutGrid,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings as SettingsIcon,
  X,
} from 'lucide-react';
import type { EditOperation, Project, ProjectSummary, Sequence } from '../core/types';
import {
  WORKSPACE_LAYOUT_PRESETS,
  detectActiveLayoutPreset,
  type WorkspaceLayoutPresetId,
} from '../lib/workbenchState';
import { BrandMark } from './BrandMark';
import { IconButton, Spinner } from './ui';

export interface WorkbenchTitlebarProps {
  project: Project;
  projects: ProjectSummary[];
  sequence: Sequence;
  appMode: 'create' | 'edit';
  showBrief: boolean;
  showNav: boolean;
  showBottom: boolean;
  showRight: boolean;
  rightTab: string;
  offlineCount: number;
  projectMenuOpen: boolean;
  setProjectMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showStageFork: boolean;
  setShowStageFork: React.Dispatch<React.SetStateAction<boolean>>;
  stageForkName: string;
  setStageForkName: (val: string) => void;
  stageForkAspect: 'original' | 'portrait' | 'square';
  setStageForkAspect: (val: 'original' | 'portrait' | 'square') => void;
  layoutMenuOpen: boolean;
  setLayoutMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  jobsOpen: boolean;
  setJobsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  runningJob: boolean;
  onNewProject: () => void;
  onOpenProject: (path?: string) => void;
  onToggleBrief: () => void;
  onChangeSequence: (sequenceId: string) => void;
  onForkSubmit: (e: React.FormEvent) => Promise<void> | void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
  onOpenVersions: () => void;
  onOpenNav: () => void;
  onSwitchMode: (mode: 'create' | 'edit') => void;
  onToggleNav: () => void;
  onToggleBottom: () => void;
  onToggleRight: () => void;
  onApplyLayoutPreset: (presetId: WorkspaceLayoutPresetId) => void;
  onOpenCommand: () => void;
  onOpenSettings: () => void;
  onOpenExport: () => void;
}

export function WorkbenchTitlebar({
  project,
  projects,
  sequence,
  appMode,
  showBrief,
  showNav,
  showBottom,
  showRight,
  rightTab,
  offlineCount,
  projectMenuOpen,
  setProjectMenuOpen,
  showStageFork,
  setShowStageFork,
  stageForkName,
  setStageForkName,
  stageForkAspect,
  setStageForkAspect,
  layoutMenuOpen,
  setLayoutMenuOpen,
  jobsOpen,
  setJobsOpen,
  runningJob,
  onNewProject,
  onOpenProject,
  onToggleBrief,
  onChangeSequence,
  onForkSubmit,
  onEdit,
  onOpenVersions,
  onOpenNav,
  onSwitchMode,
  onToggleNav,
  onToggleBottom,
  onToggleRight,
  onApplyLayoutPreset,
  onOpenCommand,
  onOpenSettings,
  onOpenExport,
}: WorkbenchTitlebarProps) {
  return (
    <header className="titlebar ide-titlebar">
      <div className="titlebar-left">
        <div className="project-switcher-wrap">
          <button
            type="button"
            className="project-menu-btn"
            onClick={() => setProjectMenuOpen((v) => !v)}
            aria-label="切换或新建工程"
          >
            <BrandMark size={16} />
            <span>{project.name}</span>
            <ChevronDown size={11} />
          </button>
          {projectMenuOpen && (
            <div className="project-dropdown" role="menu">
              <button
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false);
                  onNewProject();
                }}
              >
                <Plus size={12} /> 新建空白工程…
              </button>
              <button
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false);
                  onOpenProject();
                }}
              >
                <FolderOpen size={12} /> 打开本地工程…
              </button>
              <button
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false);
                  onToggleBrief();
                }}
              >
                <FileText size={12} /> 项目创作约定 (brief.md)
              </button>
              {projects.length > 0 && <div className="proj-dd-sep" />}
              {projects.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={p.id === project.id ? 'current' : ''}
                  onClick={() => {
                    setProjectMenuOpen(false);
                    if (p.id !== project.id) onOpenProject(p.path);
                  }}
                >
                  <span>{p.name}</span>
                  {p.id === project.id && <Check size={11} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="titlebar-slash">/</span>

        <div className="branch-bar compact">
          <GitBranch size={11} />
          <select
            aria-label="当前成片分支"
            value={sequence.id}
            onChange={(e) => onChangeSequence(e.target.value)}
          >
            {project.sequences.map((s) => (
              <option key={s.id} value={s.id}>
                {s.isMainBranch ? '主干 · ' : '分支 · '}
                {s.name}
              </option>
            ))}
          </select>
          <div className="branch-fork-anchor">
            <button
              type="button"
              className={`branch-fork-btn ${showStageFork ? 'active' : ''}`}
              title="从当前版本派生平行实验分支"
              aria-expanded={showStageFork}
              aria-haspopup="dialog"
              onClick={() => {
                setProjectMenuOpen(false);
                setLayoutMenuOpen(false);
                setJobsOpen(false);
                setShowStageFork((v) => !v);
              }}
            >
              + 派生
            </button>
            {showStageFork && (
              <form
                className="branch-fork-popover"
                role="dialog"
                aria-label="派生平行实验分支"
                onSubmit={(e) => void onForkSubmit(e)}
              >
                <div className="branch-fork-head">
                  <span>
                    <GitBranch size={12} /> 从「{sequence.name} @ v{project.revision}」派生
                  </span>
                  <button
                    type="button"
                    className="icon-button tiny"
                    aria-label="关闭派生浮层"
                    onClick={() => setShowStageFork(false)}
                  >
                    <X size={12} />
                  </button>
                </div>
                <input
                  autoFocus
                  aria-label="派生分支名称"
                  placeholder="输入新分支名（如：30s紧凑版）"
                  value={stageForkName}
                  onChange={(e) => setStageForkName(e.target.value)}
                />
                <div className="branch-fork-chips">
                  {(
                    [
                      ['30s 紧凑版', 'original'],
                      ['竖屏 9:16', 'portrait'],
                      ['方形 1:1', 'square'],
                      ['风格试剪', 'original'],
                    ] as const
                  ).map(([presetName, aspect]) => (
                    <button
                      key={presetName}
                      type="button"
                      className={`branch-fork-chip ${stageForkName === presetName ? 'active' : ''}`}
                      onClick={() => {
                        setStageForkName(presetName);
                        setStageForkAspect(aspect);
                      }}
                    >
                      {presetName}
                    </button>
                  ))}
                </div>
                <div className="branch-fork-foot">
                  {!sequence.isMainBranch && project.sequences.length > 1 ? (
                    <button
                      type="button"
                      className="button tiny"
                      onClick={() => {
                        setShowStageFork(false);
                        void onEdit(`将「${sequence.name}」设为主干`, [
                          { type: 'promoteSequenceBranch', sequenceId: sequence.id },
                        ]);
                      }}
                    >
                      设为主干
                    </button>
                  ) : (
                    <span className="branch-fork-tip">
                      {stageForkAspect === 'portrait'
                        ? '1080×1920 智能构图 + 字幕安全区重排'
                        : stageForkAspect === 'square'
                          ? '1080×1080 智能裁切居中'
                          : '零破坏克隆当前时间线'}
                    </span>
                  )}
                  <button type="submit" className="button tiny primary">
                    创建并切换
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <button className="version-chip-btn" onClick={onOpenVersions} title="版本历史与历史派生">
          v{project.revision}
        </button>

        {offlineCount > 0 && (
          <button
            className="offline-pill"
            onClick={onOpenNav}
            title="部分源媒体文件离线，点击展开资产栏重连"
          >
            <AlertTriangle size={11} /> {offlineCount} 离线
          </button>
        )}
      </div>

      <div className="top-mode-capsule" role="tablist" aria-label="核心工作模式">
        <button
          type="button"
          role="tab"
          aria-selected={appMode === 'create' && !showBrief}
          className={appMode === 'create' && !showBrief ? 'active' : ''}
          onClick={() => onSwitchMode('create')}
        >
          创造
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={appMode === 'edit' && !showBrief}
          className={appMode === 'edit' && !showBrief ? 'active' : ''}
          onClick={() => onSwitchMode('edit')}
        >
          剪辑
        </button>
      </div>

      <div className="titlebar-right ide-toggles">
        <div className="ide-pane-group" role="group" aria-label="面板布局控制">
          <button
            type="button"
            className={`ide-pane-btn ${showNav ? 'active' : ''}`}
            aria-label="切换左侧资产栏"
            title="展开或折叠左侧资产列表 (⌘\)"
            onClick={onToggleNav}
          >
            <PanelLeft size={14} />
          </button>
          {appMode === 'edit' && (
            <button
              type="button"
              className={`ide-pane-btn ${showBottom ? 'active' : ''}`}
              aria-label="切换底部时间线"
              title="展开或折叠底部时间线面板 (⌘J)"
              onClick={onToggleBottom}
            >
              <PanelBottom size={14} />
            </button>
          )}
          <button
            type="button"
            className={`ide-pane-btn ${showRight ? 'active' : ''}`}
            aria-label="切换右侧协作栏"
            title="展开或折叠右侧 Agent / 属性面板"
            onClick={onToggleRight}
          >
            <PanelRight size={14} />
          </button>
          {appMode === 'edit' && (
            <div className="layout-preset-anchor">
              <button
                type="button"
                className={`ide-pane-btn ${layoutMenuOpen ? 'active' : ''}`}
                aria-label="切换工作区布局预设"
                aria-expanded={layoutMenuOpen}
                title="快速切换布局预设（看画面 / 精剪 / 协作）"
                onClick={() => setLayoutMenuOpen((v) => !v)}
              >
                <LayoutGrid size={13} />
              </button>
              {layoutMenuOpen && (
                <div className="layout-preset-popover" role="menu" aria-label="工作区布局预设">
                  {WORKSPACE_LAYOUT_PRESETS.map((preset) => {
                    const activePreset = detectActiveLayoutPreset({
                      showNav,
                      showBottom,
                      showRight,
                      rightTab,
                    });
                    const isActive = activePreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        className={isActive ? 'active' : ''}
                        onClick={() => onApplyLayoutPreset(preset.id)}
                      >
                        <span className="layout-preset-check">{isActive && <Check size={12} />}</span>
                        <span className="layout-preset-copy">
                          <b>{preset.name}</b>
                          <small>{preset.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <IconButton label="快速命令与搜索 ⌘K" onClick={onOpenCommand}>
          <Search size={14} />
        </IconButton>
        <IconButton label="设置 ⌘," onClick={onOpenSettings}>
          <SettingsIcon size={14} />
        </IconButton>

        <span className="titlebar-divider" />

        <IconButton
          label="后台作业"
          active={jobsOpen}
          className={runningJob ? 'jobs-active-glow' : ''}
          onClick={() => setJobsOpen((v) => !v)}
        >
          {runningJob ? <Spinner /> : <Clock3 size={14} />}
        </IconButton>
        <button className="export-button" onClick={onOpenExport}>
          导出
        </button>
      </div>
    </header>
  );
}
