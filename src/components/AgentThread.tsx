import React, { useState } from 'react';
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Film,
  AudioLines,
} from 'lucide-react';
import { Markdown } from './Markdown';
import { Mark, Spinner } from './ui';
import { friendlySkillTitle } from '../core/taxonomy';
import type { Message } from '../core/types';

export const TOOL_LABELS: Record<string, string> = {
  read: '读取工作区文件',
  write: '编写组件源码',
  edit: '修改组件源码',
  bash: '执行工作区脚本',
  read_project: '读取工程结构',
  search_assets: '检索项目资产',
  list_models: '检查可用模型',
  list_presets: '检索动态母版',
  prepare_preset: '配置动态组件',
  list_studio_media: '检索内置音效',
  prepare_studio_media: '载入内置音效',
  import_asset: '登记生成资产',
  publish_edit: '发布剪辑修改',
  compile_component: '编译画面组件',
  preview_frame: '渲染验证帧',
  generate_media: '调用多模态生成',
  transcribe_asset: '语音识别转字幕',
  inspect_media: '分析媒体画面',
};

function summarizeToolArgs(tool: string, rawText: string): string {
  if (!rawText) return '';
  try {
    const args = JSON.parse(rawText);
    if (args.path) return String(args.path).split('/').pop() || String(args.path);
    if (args.name) return String(args.name);
    if (tool === 'generate_media' && args.use) {
      const useMap: Record<string, string> = { image: '生图', video: '生视频', speech: '配音' };
      return `${useMap[args.use] || args.use}${args.prompt ? ` · ${String(args.prompt).slice(0, 26)}` : ''}`;
    }
    if (tool === 'publish_edit' && Array.isArray(args.operations)) {
      return `${args.operations.length} 项原子操作`;
    }
    if (tool === 'prepare_preset' && args.presetId) return String(args.presetId);
    if (tool === 'preview_frame' && args.frame !== undefined) return `第 ${args.frame} 帧`;
    if (tool === 'search_assets' && args.query) return `“${String(args.query).slice(0, 20)}”`;
    if (tool === 'transcribe_asset' && args.language) return `语言 ${args.language}`;
  } catch {}
  return '';
}

export interface ToolStepItem {
  id: string;
  tool: string;
  label: string;
  summary: string;
  argsText: string;
  endText?: string;
  failed: boolean;
  done: boolean;
}

export type ThreadEntry =
  | { kind: 'user'; msg: Message }
  | { kind: 'system'; msg: Message }
  | {
      kind: 'assistant';
      id: string;
      createdAt: string;
      thinking?: string;
      steps: ToolStepItem[];
      texts: { id: string; text: string }[];
    };

export function groupMessagesIntoTurns(messages: Message[]): ThreadEntry[] {
  const entries: ThreadEntry[] = [];
  let currentTurn: Extract<ThreadEntry, { kind: 'assistant' }> | null = null;
  const openStepByTool = new Map<string, ToolStepItem[]>();

  const flushTurn = () => {
    if (
      currentTurn &&
      (currentTurn.thinking || currentTurn.steps.length > 0 || currentTurn.texts.length > 0)
    ) {
      entries.push(currentTurn);
    }
    currentTurn = null;
    openStepByTool.clear();
  };

  const ensureTurn = (msg: Message) => {
    if (!currentTurn) {
      currentTurn = {
        kind: 'assistant',
        id: msg.id,
        createdAt: msg.createdAt,
        steps: [],
        texts: [],
      };
    }
    return currentTurn;
  };

  for (const m of messages) {
    if (m.role === 'user') {
      flushTurn();
      entries.push({ kind: 'user', msg: m });
      continue;
    }
    if (m.role === 'system') {
      flushTurn();
      entries.push({ kind: 'system', msg: m });
      continue;
    }
    if (m.role === 'tool') {
      const turn = ensureTurn(m);
      const tName = m.tool || 'tool';
      if (m.status === 'tool-start') {
        const step: ToolStepItem = {
          id: m.id,
          tool: tName,
          label: TOOL_LABELS[tName] || tName,
          summary: summarizeToolArgs(tName, m.text),
          argsText: m.text,
          failed: false,
          done: false,
        };
        turn.steps.push(step);
        const q = openStepByTool.get(tName) || [];
        q.push(step);
        openStepByTool.set(tName, q);
      } else if (m.status === 'tool-end') {
        const q = openStepByTool.get(tName);
        const target = q?.shift();
        if (target) {
          target.done = true;
          target.endText = m.text;
          target.failed = m.text.includes('失败');
        }
      }
      continue;
    }
    if (m.role === 'assistant') {
      const turn = ensureTurn(m);
      if (m.thinking) {
        turn.thinking = turn.thinking ? `${turn.thinking}\n${m.thinking}` : m.thinking;
      }
      if (m.text.trim()) {
        turn.texts.push({ id: m.id, text: m.text });
      }
    }
  }
  flushTurn();
  return entries;
}

function ToolGroupCard({
  steps,
  streaming,
}: {
  steps: ToolStepItem[];
  streaming?: boolean;
}) {
  if (!steps.length) return null;
  const doneCount = steps.filter((s) => s.done).length;
  const hasRunning = Boolean(streaming && doneCount < steps.length);
  const failedCount = steps.filter((s) => s.failed).length;
  const latestRunning = [...steps].reverse().find((s) => !s.done);
  const heading = hasRunning
    ? `正在${latestRunning?.label || '处理'} (${doneCount + 1}/${steps.length})`
    : failedCount > 0
      ? `执行了 ${steps.length} 步操作（${failedCount} 项异常）`
      : `已完成 ${steps.length} 项创作步骤`;

  return (
    <details className="agent-tool-group" open={hasRunning}>
      <summary>
        {hasRunning ? (
          <Spinner />
        ) : (
          <span className={`tool-group-badge ${failedCount ? 'err' : 'ok'}`}>
            {failedCount ? '!' : <Check size={10} />}
          </span>
        )}
        <span className="tool-group-title">{heading}</span>
        <ChevronDown size={12} className="tool-group-chev" />
      </summary>
      <div className="agent-tool-steps">
        {steps.map((s) => (
          <details key={s.id} className={`agent-tool-step ${s.failed ? 'failed' : ''}`}>
            <summary>
              <span className={`tool-status-dot ${s.failed ? 'err' : s.done ? 'ok' : 'run'}`}>
                {s.failed ? '!' : s.done ? '✓' : '·'}
              </span>
              <span className="tool-step-label">{s.label}</span>
              {s.summary && <span className="tool-step-meta">{s.summary}</span>}
              <ChevronRight size={10} />
            </summary>
            <pre>{s.endText ? `${s.argsText}\n→ ${s.endText}` : s.argsText}</pre>
          </details>
        ))}
      </div>
    </details>
  );
}

function ThinkingBlock({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  if (!text.trim()) return null;
  return (
    <details className="agent-thinking-block" open={streaming}>
      <summary>
        <Brain size={11} />
        <span>{streaming ? '深度思考中…' : '已深度思考'}</span>
        <small>{text.length} 字</small>
        <ChevronDown size={11} />
      </summary>
      <div className="agent-thinking-body">{text}</div>
    </details>
  );
}

function CopyTurnButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      className="turn-copy-btn"
      title="复制此条回复"
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

export function AgentThread({
  messages,
  liveText,
  liveThinking,
  isRunning,
  onSeekTimecode,
  dateLabel,
}: {
  messages: Message[];
  liveText: string;
  liveThinking: string;
  isRunning: boolean;
  onSeekTimecode?: (seconds: number) => void;
  dateLabel: (iso: string) => string;
}) {
  const entries = groupMessagesIntoTurns(messages);
  const lastEntry = entries.at(-1);
  const mergeStreamIntoLast = Boolean(lastEntry?.kind === 'assistant' && isRunning);
  const showStandaloneStream = Boolean(
    !mergeStreamIntoLast && (liveText || liveThinking),
  );

  return (
    <>
      {entries.map((entry, idx) => {
        if (entry.kind === 'user') {
          const m = entry.msg;
          return (
            <div className="message user" key={m.id}>
              {(m.attachments?.length || m.skillIds?.length) && (
                <div className="user-msg-chips">
                  {m.skillIds?.map((sk) => (
                    <span key={sk} className="user-msg-tag">
                      /{friendlySkillTitle(sk)}
                    </span>
                  ))}
                  {m.attachments?.map((att) => (
                    <span key={att.id} className="user-msg-att">
                      {att.previewDataUrl ? (
                        <img src={att.previewDataUrl} alt={att.name} />
                      ) : att.kind === 'video' ? (
                        <Film size={11} />
                      ) : att.kind === 'audio' ? (
                        <AudioLines size={11} />
                      ) : (
                        <FileText size={11} />
                      )}
                      <span>{att.name}</span>
                    </span>
                  ))}
                </div>
              )}
              <Markdown text={m.text} onSeekTimecode={onSeekTimecode} />
            </div>
          );
        }
        if (entry.kind === 'system') {
          return (
            <div className="message system" key={entry.msg.id}>
              <Markdown text={entry.msg.text} onSeekTimecode={onSeekTimecode} />
            </div>
          );
        }
        const isLastRunning = mergeStreamIntoLast && idx === entries.length - 1;
        const combinedThinking =
          (entry.thinking || '') + (isLastRunning ? liveThinking : '');
        const fullText = [
          ...entry.texts.map((t) => t.text),
          ...(isLastRunning && liveText ? [liveText] : []),
        ].join('\n\n');
        return (
          <div className={`assistant-turn ${isLastRunning ? 'streaming' : ''}`} key={entry.id}>
            <div className="assistant-label">
              <Mark small />
              <span>CoCraft</span>
              <time>{dateLabel(entry.createdAt)}</time>
              {!isLastRunning && <CopyTurnButton text={fullText} />}
            </div>
            <ThinkingBlock
              text={combinedThinking}
              streaming={isLastRunning && Boolean(liveThinking) && !liveText}
            />
            <ToolGroupCard steps={entry.steps} streaming={isLastRunning} />
            {entry.texts.map((t) => (
              <div className="message assistant" key={t.id}>
                <Markdown text={t.text} onSeekTimecode={onSeekTimecode} />
              </div>
            ))}
            {isLastRunning && liveText && (
              <div className="message assistant streaming">
                <Markdown text={liveText} onSeekTimecode={onSeekTimecode} />
              </div>
            )}
          </div>
        );
      })}
      {showStandaloneStream && (
        <div className="assistant-turn streaming">
          <div className="assistant-label">
            <Mark small />
            <span>CoCraft</span>
          </div>
          <ThinkingBlock text={liveThinking} streaming={Boolean(liveThinking) && !liveText} />
          {liveText && (
            <div className="message assistant streaming">
              <Markdown text={liveText} onSeekTimecode={onSeekTimecode} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
