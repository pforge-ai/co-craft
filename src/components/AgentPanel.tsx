import React from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Brain,
  Check,
  ChevronDown,
  Crosshair,
  FileText,
  Film,
  GitBranch,
  Image as ImageIcon,
  MoreHorizontal,
  Paperclip,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ChatContextRef,
  Clip,
  ComposerAttachment,
  ModelDefinition,
  Project,
  Sequence,
  Settings,
  SkillInfo,
  Task,
  ThinkingLevelChoice,
} from '../core/types';
import { buildMentionCandidates, friendlySkillTitle, type MentionCandidate } from '../core/taxonomy';
import {
  THINKING_OPTIONS,
  dateLabel,
  formatCompactTokens,
  matchMentionTrigger,
} from '../lib/workbenchState';
import { AgentThread, TOOL_LABELS } from './AgentThread';
import { IconButton, Mark, Spinner } from './ui';

export interface AgentPanelProps {
  project: Project;
  sequence: Sequence;
  sequenceId: string;
  tasks: Task[];
  task: Task | undefined;
  taskId: string;
  connectingTask: string;
  skills: SkillInfo[];
  settings: Settings;
  agentModels: ModelDefinition[];
  chatModel: ModelDefinition | null | undefined;
  chatConnected: boolean;
  thinkingLevel: ThinkingLevelChoice;
  streamText: string;
  thinkingStreamText: string;
  toolStatus: string;
  prompt: string;
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  mentionIndex: number;
  openComposerMenu: 'session' | 'model' | 'thinking' | null;
  scope: Clip | null;
  strictScope: boolean;
  stagePin: { x: number; y: number; frame: number } | undefined;
  chatRefs: ChatContextRef[];
  activeComposerSkills: string[];
  composerAttachments: ComposerAttachment[];
  onSetOpenComposerMenu: React.Dispatch<React.SetStateAction<'session' | 'model' | 'thinking' | null>>;
  onNewTask: () => void;
  onSelectTask: (task: Task) => void;
  onRenameTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onStopAgent: () => void;
  onSetPrompt: (next: string) => void;
  onSetMentionIndex: React.Dispatch<React.SetStateAction<number>>;
  onApplyMentionCandidate: (candidate: MentionCandidate) => void;
  onSeekTimecode: (seconds: number) => void;
  onOpenSettings: (tab: 'providers' | 'defaults' | 'models') => void;
  onComposerDrop: React.DragEventHandler<HTMLDivElement>;
  onComposerPaste: React.ClipboardEventHandler<HTMLTextAreaElement>;
  onRemoveComposerSkill: (skillName: string) => void;
  onToggleStrictScope: () => void;
  onClearScope: () => void;
  onClearStagePin: () => void;
  onRemoveChatRef: (key: string) => void;
  onRemoveAttachment: (id: string) => void;
  onAttachFiles: () => void;
  onSelectModel: (modelId: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevelChoice) => void;
  onSend: () => void;
}

export function AgentPanel({
  project,
  sequence,
  tasks,
  task,
  connectingTask,
  skills,
  settings,
  agentModels,
  chatModel,
  chatConnected,
  thinkingLevel,
  streamText,
  thinkingStreamText,
  toolStatus,
  prompt,
  promptRef,
  messagesEndRef,
  mentionIndex,
  openComposerMenu,
  scope,
  strictScope,
  stagePin,
  chatRefs,
  activeComposerSkills,
  composerAttachments,
  onSetOpenComposerMenu,
  onNewTask,
  onSelectTask,
  onRenameTask,
  onDeleteTask,
  onStopAgent,
  onSetPrompt,
  onSetMentionIndex,
  onApplyMentionCandidate,
  onSeekTimecode,
  onOpenSettings,
  onComposerDrop,
  onComposerPaste,
  onRemoveComposerSkill,
  onToggleStrictScope,
  onClearScope,
  onClearStagePin,
  onRemoveChatRef,
  onRemoveAttachment,
  onAttachFiles,
  onSelectModel,
  onSelectThinkingLevel,
  onSend,
}: AgentPanelProps) {
  const isBusy = task?.status === 'running' || (!!task?.id && task.id === connectingTask);

  const mentionCandidates = (() => {
    const tokenPrefix = matchMentionTrigger(prompt);
    if (!tokenPrefix) return [];
    const trigger = tokenPrefix[0] as '@' | '#' | '/';
    const keyword = tokenPrefix.slice(1).toLowerCase();
    return buildMentionCandidates(project, sequence, skills)
      .filter(
        (c) =>
          c.trigger === trigger &&
          (!keyword || c.label.toLowerCase().includes(keyword) || c.token.toLowerCase().includes(keyword)),
      )
      .slice(0, 8);
  })();

  return (
    <div className="agent-panel">
      <div className="agent-task-heading">
        <div className="agent-session-wrap" style={{ minWidth: 0, flex: 1 }}>
          <div className="agent-session-row">
            <button
              type="button"
              className="agent-session-trigger"
              aria-label="切换对话会话"
              aria-expanded={openComposerMenu === 'session'}
              onClick={() => onSetOpenComposerMenu((m) => (m === 'session' ? null : 'session'))}
            >
              <span className="agent-session-title">{task?.name || '新会话'}</span>
              <ChevronDown size={12} />
            </button>
          </div>
          {openComposerMenu === 'session' && (
            <div className="agent-session-popover" role="menu" aria-label="对话会话列表">
              <button
                type="button"
                className="session-pop-new"
                onClick={() => {
                  onSetOpenComposerMenu(null);
                  onNewTask();
                }}
              >
                <Plus size={12} />
                <span>新建对话</span>
              </button>
              {tasks.length > 0 && <div className="session-pop-sep" />}
              <div className="session-pop-list">
                {tasks.map((t) => {
                  const isCurrent = t.id === task?.id;
                  const seqLabel = project.sequences.find((s) => s.id === t.sequenceId)?.name || sequence.name;
                  const isRun = t.status === 'running';
                  return (
                    <div key={t.id} className={`session-pop-item ${isCurrent ? 'active' : ''}`}>
                      <button
                        type="button"
                        className="session-pop-main"
                        onClick={() => {
                          onSetOpenComposerMenu(null);
                          onSelectTask(t);
                        }}
                      >
                        <span className="session-pop-check">
                          {isRun ? <Spinner /> : isCurrent ? <Check size={12} /> : null}
                        </span>
                        <span className="session-pop-meta">
                          <b>{t.name}</b>
                          <small>
                            {seqLabel}
                            {t.usage && t.usage.totalTokens > 0
                              ? ` · ${formatCompactTokens(t.usage.totalTokens)} tok`
                              : ''}
                          </small>
                        </span>
                      </button>
                      <div className="session-pop-actions">
                        <button
                          type="button"
                          aria-label={`重命名会话 ${t.name}`}
                          title="重命名"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onSetOpenComposerMenu(null);
                            onRenameTask(t);
                          }}
                        >
                          <MoreHorizontal size={12} />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除会话 ${t.name}`}
                          title="删除"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onSetOpenComposerMenu(null);
                            onDeleteTask(t);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <small className="agent-task-submeta">
            <GitBranch size={11} />
            <span>{sequence.name}</span>
            <span>·</span>
            <span>
              {task?.status === 'running'
                ? '正在工作'
                : task?.id && task.id === connectingTask
                  ? '正在连接模型…'
                  : '就绪'}
            </span>
            {task?.usage && task.usage.totalTokens > 0 && (
              <>
                <span>·</span>
                <span>{formatCompactTokens(task.usage.totalTokens)} tok</span>
              </>
            )}
          </small>
        </div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <IconButton label="新建 Agent 任务" onClick={onNewTask}>
            <Plus size={14} />
          </IconButton>
          {isBusy && (
            <button className="button tiny stop" onClick={onStopAgent}>
              <Square size={10} fill="currentColor" /> 停止
            </button>
          )}
        </div>
      </div>

      <div className="agent-scroll">
        {(!task || task.messages.length === 0) && !streamText && !thinkingStreamText && (
          <div className="agent-welcome">
            <div className="welcome-mark">
              <Mark />
            </div>
            <h2>想生产什么资产或镜头？</h2>
            <p>输入 @ 引用角色状态与媒体、# 按自定义标签筛选、/ 选用剪辑规范或新建分支试剪。</p>
            <div className="prompt-suggestions">
              {[
                [
                  '新建分支大胆试剪',
                  '/新建分支试剪 在不影响主干的前提下，帮我重新编排一版节奏更紧凑的剪辑方案。',
                ],
                [
                  '生产一段动态逻辑图解',
                  '为当前成片主题制作一段清晰可改字的分步逻辑与数据对比动态组件，并放入时间线。',
                ],
                [
                  '整理项目资产与标签',
                  '查看当前项目资产，按内容用途打上清晰的结构化标签并整理镜头顺序。',
                ],
              ].map(([title, text]) => (
                <button
                  key={title}
                  onClick={() => {
                    onSetPrompt(text);
                    promptRef.current?.focus();
                  }}
                >
                  {title}
                  <ArrowUpRight size={12} />
                </button>
              ))}
            </div>
          </div>
        )}
        <AgentThread
          messages={task?.messages || []}
          liveText={streamText}
          liveThinking={thinkingStreamText}
          isRunning={task?.status === 'running'}
          dateLabel={dateLabel}
          onSeekTimecode={onSeekTimecode}
        />
        {task?.status === 'running' && (
          <div className="agent-working">
            <Spinner />
            <span>{TOOL_LABELS[toolStatus] || toolStatus || '正在思考与创作…'}</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer-wrap">
        {!chatConnected && (
          <button
            className="connect-hint"
            onClick={() => onOpenSettings(chatModel ? 'providers' : 'defaults')}
          >
            <span className="muted-dot" /> 连接模型，开启 Agent 创作 <ArrowUpRight size={11} />
          </button>
        )}
        <div
          className={`composer ${isBusy ? 'ai-active' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes('Files')) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onDrop={onComposerDrop}
        >
          {(scope || stagePin || chatRefs.length > 0 || activeComposerSkills.length > 0) && (
            <div className="scope-bar">
              {activeComposerSkills.map((sk) => (
                <div key={sk} className="scope-chip skill">
                  <span>/{friendlySkillTitle(sk)}</span>
                  <button
                    type="button"
                    aria-label={`移除规范 ${friendlySkillTitle(sk)}`}
                    onClick={() => onRemoveComposerSkill(sk)}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              {scope && (
                <div className="scope-chip">
                  <Film size={11} />
                  <span>{scope.name}</span>
                  <button
                    type="button"
                    className={`scope-strict-toggle ${strictScope ? 'active' : ''}`}
                    title="开启后强制要求 Agent 只允许修改此片段"
                    onClick={onToggleStrictScope}
                  >
                    {strictScope ? '仅改此处' : '参考'}
                  </button>
                  <button aria-label="移除片段引用" onClick={onClearScope}>
                    <X size={10} />
                  </button>
                </div>
              )}
              {stagePin && (
                <div className="scope-chip pin">
                  <Crosshair size={11} />
                  <span>
                    坐标 ({stagePin.x}%, {stagePin.y}%)
                  </span>
                  <button aria-label="移除画面坐标" onClick={onClearStagePin}>
                    <X size={10} />
                  </button>
                </div>
              )}
              {chatRefs.map((cr) => (
                <div key={cr.key} className="scope-chip">
                  <span>@{cr.label}</span>
                  <button aria-label={`移除引用 ${cr.label}`} onClick={() => onRemoveChatRef(cr.key)}>
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {composerAttachments.length > 0 && (
            <div className="composer-attachments" aria-label="已附带文件">
              {composerAttachments.map((att) => (
                <div key={att.id} className={`composer-att-chip ${att.kind}`}>
                  {att.previewDataUrl ? (
                    <img src={att.previewDataUrl} alt={att.name} className="composer-att-thumb" />
                  ) : (
                    <span className="composer-att-icon">
                      {att.kind === 'video' ? (
                        <Film size={12} />
                      ) : att.kind === 'audio' ? (
                        <AudioLines size={12} />
                      ) : att.kind === 'image' ? (
                        <ImageIcon size={12} />
                      ) : (
                        <FileText size={12} />
                      )}
                    </span>
                  )}
                  <span className="composer-att-name" title={att.path}>
                    {att.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除附件 ${att.name}`}
                    onClick={() => onRemoveAttachment(att.id)}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {mentionCandidates.length > 0 && (
            <div className="mention-popover" role="listbox" aria-label="引用建议">
              {mentionCandidates.map((cand, cIdx) => {
                const safeIdx = Math.min(mentionIndex, mentionCandidates.length - 1);
                return (
                  <button
                    key={cand.token}
                    type="button"
                    role="option"
                    aria-selected={cIdx === safeIdx}
                    className={cIdx === safeIdx ? 'active' : ''}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      onApplyMentionCandidate(cand);
                    }}
                  >
                    <b>{cand.label}</b>
                    <small>{cand.sublabel}</small>
                  </button>
                );
              })}
            </div>
          )}

          <textarea
            ref={promptRef}
            aria-label="给 Agent 的指令"
            placeholder={
              task?.status === 'running'
                ? '补充方向，随时打断…'
                : '描述画面或修改（输入 @ 引用、/ 选规范，可粘贴/拖放图片）…'
            }
            value={prompt}
            onPaste={onComposerPaste}
            onChange={(e) => {
              onSetPrompt(e.target.value);
              onSetMentionIndex(0);
            }}
            onKeyDown={(e) => {
              const composing =
                e.nativeEvent.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229;
              if (mentionCandidates.length > 0 && !composing) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  onSetMentionIndex((i) => (i + 1) % mentionCandidates.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  onSetMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
                  return;
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                  e.preventDefault();
                  const picked = mentionCandidates[Math.min(mentionIndex, mentionCandidates.length - 1)];
                  onApplyMentionCandidate(picked);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !composing) {
                e.preventDefault();
                onSend();
              }
            }}
          />

          <div className="composer-bottom">
            <div className="composer-tools-left">
              <button
                type="button"
                className="composer-icon-btn"
                aria-label="添加附件"
                title="添加参考图片、音视频或文稿 (支持直接粘贴截图与拖放文件)"
                onClick={onAttachFiles}
              >
                <Paperclip size={13} />
              </button>

              <div className="composer-popover-anchor">
                <button
                  type="button"
                  className="composer-pill-btn"
                  aria-label="会话模型"
                  aria-expanded={openComposerMenu === 'model'}
                  disabled={isBusy}
                  onClick={() => onSetOpenComposerMenu((m) => (m === 'model' ? null : 'model'))}
                >
                  <span className={chatConnected ? 'connected-dot' : 'muted-dot'} />
                  <span className="composer-pill-label">{chatModel?.name || '选择模型'}</span>
                  <ChevronDown size={11} />
                </button>
                {openComposerMenu === 'model' && (
                  <div className="composer-popover" role="menu" aria-label="选择会话模型">
                    {agentModels.map((m) => {
                      const pName = settings.providers.find((p) => p.id === m.providerId)?.name || '';
                      const active = chatModel?.id === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={active ? 'active' : ''}
                          onClick={() => onSelectModel(m.id)}
                        >
                          <span className="pop-check">{active && <Check size={12} />}</span>
                          <span className="pop-text">
                            <b>{m.name}</b>
                            {pName && <small>{pName}</small>}
                          </span>
                        </button>
                      );
                    })}
                    {agentModels.length > 0 && <div className="pop-sep" />}
                    <button
                      type="button"
                      onClick={() => {
                        onSetOpenComposerMenu(null);
                        onOpenSettings('models');
                      }}
                    >
                      <span className="pop-check" />
                      <span className="pop-text">
                        <b>管理模型…</b>
                      </span>
                    </button>
                  </div>
                )}
              </div>

              <div className="composer-popover-anchor">
                <button
                  type="button"
                  className="composer-pill-btn"
                  aria-label="思考深度"
                  title="调节模型推理 / 思考深度"
                  aria-expanded={openComposerMenu === 'thinking'}
                  disabled={isBusy}
                  onClick={() => onSetOpenComposerMenu((m) => (m === 'thinking' ? null : 'thinking'))}
                >
                  <Brain size={12} />
                  <span className="composer-pill-label">
                    {THINKING_OPTIONS.find((o) => o.id === thinkingLevel)?.label || '关闭'}
                  </span>
                  <ChevronDown size={11} />
                </button>
                {openComposerMenu === 'thinking' && (
                  <div className="composer-popover align-right" role="menu" aria-label="选择思考深度">
                    {THINKING_OPTIONS.map((opt) => {
                      const active = thinkingLevel === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={active ? 'active' : ''}
                          onClick={() => onSelectThinkingLevel(opt.id)}
                        >
                          <span className="pop-check">{active && <Check size={12} />}</span>
                          <span className="pop-text">
                            <b>{opt.label}</b>
                            <small>{opt.hint}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              className="send-button"
              aria-label="发送给 Agent"
              disabled={!prompt.trim() && composerAttachments.length === 0}
              onClick={onSend}
            >
              <ArrowUp size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
