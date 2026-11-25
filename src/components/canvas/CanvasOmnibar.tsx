import React, { useEffect, useState } from 'react';
import {
  ArrowUp,
  AtSign,
  AudioLines,
  Clapperboard,
  FileText,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Slash,
  Sparkles,
  X,
} from 'lucide-react';
import type { ChatContextRef } from '../../core/types';

export type OmnibarSlashAction =
  | 'breakdown'
  | 'gen-image'
  | 'gen-video'
  | 'gen-speech'
  | 'new-text'
  | 'tidy';

interface CanvasOmnibarProps {
  aiBusy: boolean;
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void | Promise<void>;
  onSlashAction: (action: OmnibarSlashAction) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  chatRefs: readonly ChatContextRef[];
  singleRefs: readonly ChatContextRef[];
  onRemoveChatRef?: (key: string) => void;
  onRemoveCanvasRef: (key: string) => void;
  onAttachSelectedToChat?: () => void;
}

const SLASH_COMMANDS: {
  id: OmnibarSlashAction;
  cmd: string;
  label: string;
  hint: string;
  icon: typeof Sparkles;
}[] = [
  { id: 'breakdown', cmd: '/拆解分镜', label: '拆解分镜', hint: '按行或交由 Agent 拆解成片分镜序列', icon: FileText },
  { id: 'gen-image', cmd: '/生成图像', label: 'AI 生图工坊卡', hint: '在画布原地创建生图/融合/改图节点', icon: ImageIcon },
  { id: 'gen-video', cmd: '/生成视频', label: 'AI 视频工坊卡', hint: '在画布原地创建图生视频/首尾帧节点', icon: Clapperboard },
  { id: 'gen-speech', cmd: '/生成配音', label: 'AI 配音工坊卡', hint: '在画布原地创建语音合成节点', icon: AudioLines },
  { id: 'new-text', cmd: '/新建文本', label: '脚本文本卡', hint: '在画布放置可编辑剧本或设定文本节点', icon: FileText },
  { id: 'tidy', cmd: '/整理画布', label: '按分区整理排版', hint: '将画布卡片按语义分区整齐排列', icon: LayoutGrid },
];

export const CanvasOmnibar = React.memo(function CanvasOmnibar({
  aiBusy,
  value,
  onChange,
  onSubmit,
  onSlashAction,
  inputRef,
  chatRefs,
  singleRefs,
  onRemoveChatRef,
  onRemoveCanvasRef,
  onAttachSelectedToChat,
}: CanvasOmnibarProps) {
  const [slashOpen, setSlashOpen] = useState(false);

  // Auto-resize textarea up to ~5 lines (116px)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextH = Math.min(116, Math.max(24, el.scrollHeight));
    el.style.height = `${nextH}px`;
  }, [value, inputRef]);

  const trimmedStart = value.trimStart();
  const slashQuery = trimmedStart.startsWith('/') ? trimmedStart.slice(1).toLowerCase() : '';
  const showSlashPopover = slashOpen || (trimmedStart.startsWith('/') && !trimmedStart.includes('\n') && trimmedStart.length <= 16);
  const filteredCommands = SLASH_COMMANDS.filter(
    (c) => !slashQuery || c.cmd.toLowerCase().includes(slashQuery) || c.label.toLowerCase().includes(slashQuery),
  );

  const uniqueSingle = singleRefs.filter((sr) => !chatRefs.some((cr) => cr.key === sr.key));
  const shownChat = chatRefs.slice(0, 3);
  const shownSingle = uniqueSingle.slice(0, Math.max(0, 3 - shownChat.length));
  const totalCount = chatRefs.length + uniqueSingle.length;
  const overflow = totalCount - (shownChat.length + shownSingle.length);

  const triggerSlash = (cmdId: OmnibarSlashAction) => {
    setSlashOpen(false);
    if (trimmedStart.startsWith('/')) onChange('');
    onSlashAction(cmdId);
  };

  return (
    <div className="cc-omnibar-shell">
      {showSlashPopover && filteredCommands.length > 0 && (
        <div className="cc-popover cc-slash-popover" role="menu" aria-label="快捷创作指令">
          <div className="cc-menu-group">快捷创作动作</div>
          {filteredCommands.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className="cc-slash-item"
                onClick={() => triggerSlash(item.id)}
              >
                <Icon size={13} />
                <div className="cc-slash-copy">
                  <b>{item.label}</b>
                  <small>{item.hint}</small>
                </div>
                <code>{item.cmd}</code>
              </button>
            );
          })}
        </div>
      )}

      <form
        className={`cc-ai-omnibar unified ${aiBusy ? 'ai-active' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          setSlashOpen(false);
          void onSubmit();
        }}
      >
        {totalCount > 0 && (
          <div className="cc-omni-ctx-row">
            <div className="cc-omni-ctx-list">
              {shownChat.map((cr) => (
                <span key={cr.key} className="cc-omni-ctx">
                  <AtSign size={10} />
                  <span>{cr.label}</span>
                  {onRemoveChatRef && (
                    <button
                      type="button"
                      onClick={() => onRemoveChatRef(cr.key)}
                      aria-label={`移除 ${cr.label}`}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
              {shownSingle.map((sr) => (
                <span key={sr.key} className="cc-omni-ctx">
                  <Film size={10} />
                  <span>{sr.label}</span>
                  <button
                    type="button"
                    aria-label="移除画布上下文"
                    onClick={() => onRemoveCanvasRef(sr.key)}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              {overflow > 0 && <span className="cc-omni-ctx">+{overflow} 项</span>}
            </div>
          </div>
        )}

        <div className="cc-omni-row">
          <textarea
            ref={inputRef}
            rows={1}
            aria-label="悬浮 Agent 指令输入"
            placeholder="告诉 Agent 想创作或修改什么，或输入 / 快捷创建节点、粘贴多行剧本拆镜…"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              if (!e.target.value.startsWith('/')) setSlashOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && showSlashPopover) {
                e.preventDefault();
                setSlashOpen(false);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (trimmedStart.startsWith('/') && filteredCommands.length > 0) {
                  triggerSlash(filteredCommands[0].id);
                  return;
                }
                if (value.trim()) {
                  setSlashOpen(false);
                  void onSubmit();
                }
              }
            }}
          />
          <div className="cc-omni-actions">
            <button
              type="button"
              className={`cc-omni-tool ${showSlashPopover ? 'active' : ''}`}
              title="快捷创作指令 (/ 拆镜 · 生图 · 生视频 · 配音)"
              aria-label="打开快捷创作指令"
              onClick={() => setSlashOpen((v) => !v)}
            >
              <Slash size={12} />
            </button>
            {onAttachSelectedToChat && singleRefs.length > 0 && (
              <button
                type="button"
                className="cc-omni-tool"
                title="将已选画布节点固定引用到 Agent 对话"
                aria-label="固定引用到对话"
                onClick={onAttachSelectedToChat}
              >
                <AtSign size={12} />
              </button>
            )}
            <button
              type="submit"
              className="cc-omni-send"
              disabled={!value.trim()}
              aria-label="发送指令"
            >
              <ArrowUp size={13} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
});
