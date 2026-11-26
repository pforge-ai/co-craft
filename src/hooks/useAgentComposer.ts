import { useRef, useState } from 'react';
import type {
  ChatContextRef,
  Clip,
  ComposerAttachment,
  ThinkingLevelChoice,
} from '../core/types';

export function useAgentComposer() {
  const [taskId, setTaskId] = useState('');
  const [connectingTask, setConnectingTask] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scope, setScope] = useState<Clip | null>(null);
  const [strictScope, setStrictScope] = useState(false);
  const [stagePin, setStagePin] = useState<{ x: number; y: number; frame: number } | undefined>();
  const [chatRefs, setChatRefs] = useState<ChatContextRef[]>([]);
  const [stream, setStream] = useState<Record<string, string>>({});
  const [thinkingStream, setThinkingStream] = useState<Record<string, string>>({});
  const [toolState, setToolState] = useState<Record<string, string>>({});
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelChoice>(
    () => (localStorage.getItem('cc-thinking-level') as ThinkingLevelChoice) || 'off',
  );
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [activeComposerSkills, setActiveComposerSkills] = useState<string[]>([]);
  const [openComposerMenu, setOpenComposerMenu] = useState<'session' | 'model' | 'thinking' | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [modelOverride, setModelOverride] = useState('');

  const sending = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);

  return {
    taskId,
    setTaskId,
    connectingTask,
    setConnectingTask,
    prompt,
    setPrompt,
    scope,
    setScope,
    strictScope,
    setStrictScope,
    stagePin,
    setStagePin,
    chatRefs,
    setChatRefs,
    stream,
    setStream,
    thinkingStream,
    setThinkingStream,
    toolState,
    setToolState,
    thinkingLevel,
    setThinkingLevel,
    composerAttachments,
    setComposerAttachments,
    activeComposerSkills,
    setActiveComposerSkills,
    openComposerMenu,
    setOpenComposerMenu,
    mentionIndex,
    setMentionIndex,
    modelOverride,
    setModelOverride,
    sending,
    promptRef,
    messagesEnd,
  };
}
