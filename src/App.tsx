import React, { useCallback, useEffect, useRef, useState } from 'react';
import { pointerDrag } from './lib/pointerDrag';
import { ResourceLibrary } from './components/ResourceLibrary';
import { GenerationDialog, type GenerationDraft } from './components/GenerationDialog';
import { BrandMark } from './components/BrandMark';
import { selectedModel } from './core/models';
import { createPresetClip } from './core/presets';
import { Markdown } from './components/Markdown';
import {
  PanelLeft,
  PanelRight,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Folder,
  Film,
  Clapperboard,
  Image,
  Music,
  AudioLines,
  Type,
  Layers,
  Code2,
  Settings as SettingsIcon,
  ArrowUpRight,
  ArrowUp,
  Upload,
  Download,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  Undo2,
  Redo2,
  Scissors,
  Trash2,
  Lock,
  Unlock,
  Magnet,
  ZoomIn,
  ZoomOut,
  Clock3,
  Check,
  CheckCheck,
  X,
  MoreHorizontal,
  FileText,
  LayoutGrid,
  GitBranch,
  Command,
  ArrowLeft,
  MessageSquare,
  SlidersHorizontal,
  Square,
  ExternalLink,
  Mic,
  Copy,
  GripHorizontal,
  RotateCcw,
  AlertCircle,
  ChevronUp,
} from 'lucide-react';
import type {
  BootData,
  ProjectEnvelope,
  Project,
  Sequence,
  Clip,
  EditOperation,
  ProjectSummary,
  Task,
  Settings,
  Job,
  AgentEvent,
  CodeComponent,
} from './core/types';
import { clone, durationOf, newClip, splitOperations, timecode, uid } from './core/project';
import { mediaUrl } from './composition/Film';
import { Timeline } from './components/Timeline';
import { Inspector } from './components/Inspector';
import { IconButton, Mark, Modal, Spinner } from './components/ui';
import { SettingsDialog, ExportDialog, CodeDialog, StockDialog } from './components/Dialogs';

type Dialog =
  | 'settings'
  | 'export'
  | 'new-project'
  | 'new-task'
  | 'command'
  | 'versions'
  | 'templates'
  | 'code'
  | 'stock'
  | 'generation'
  | 'job-result'
  | 'rename-task'
  | 'sequence'
  | null;
const api = <T,>(method: string, payload?: unknown) => window.cocraft.call<T>(method, payload);
const errorText = (e: unknown) =>
  String(e)
    .replace(/^Error: Error invoking remote method 'cocraft:call': Error: /, '')
    .replace(/^Error: /, '');
const dateLabel = (s: string) =>
  new Date(s).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

export function App() {
  const [boot, setBoot] = useState<BootData | null>(null),
    [env, setEnv] = useState<ProjectEnvelope | null>(null),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [settings, setSettings] = useState<Settings | null>(null),
    [jobs, setJobs] = useState<Job[]>([]);
  const [sequenceId, setSequenceId] = useState(''),
    [taskId, setTaskId] = useState(''),
    [connectingTask, setConnectingTask] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [frame, setFrame] = useState(70),
    [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false),
    [previewReady, setPreviewReady] = useState(false),
    [previewProject, setPreviewProject] = useState<Project | null>(null);
  const [nav, setNav] = useState<'projects' | 'assets'>('projects'),
    [doc, setDoc] = useState<'film' | 'brief'>('film'),
    [view, setView] = useState('timeline'),
    [right, setRight] = useState('agent'),
    [showNav, setShowNav] = useState(true),
    [showRight, setShowRight] = useState(true),
    [dialog, setDialog] = useState<Dialog>(null),
    [jobsOpen, setJobsOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null),
    [fatal, setFatal] = useState(''),
    [busy, setBusy] = useState(''),
    [zoom, setZoom] = useState(100),
    [snap, setSnap] = useState(true),
    [draggingFile, setDraggingFile] = useState(false),
    [timelineHeight, setTimelineHeight] = useState(Number(localStorage.getItem('cc-timeline-height')) || 278),
    [agentWidth, setAgentWidth] = useState(Number(localStorage.getItem('cc-agent-width')) || 350),
    [navWidth, setNavWidth] = useState(Number(localStorage.getItem('cc-nav-width')) || 240);
  const [prompt, setPrompt] = useState(''),
    [scope, setScope] = useState<Clip | null>(null),
    [stream, setStream] = useState<Record<string, string>>({}),
    [toolState, setToolState] = useState<Record<string, string>>({}),
    [briefDraft, setBriefDraft] = useState(''),
    [formName, setFormName] = useState(''),
    [command, setCommand] = useState(''),
    [codeComponent, setCodeComponent] = useState<CodeComponent | undefined>(),
    [generationDraft, setGenerationDraft] = useState<GenerationDraft>({ use: 'image' }),
    [settingsTab, setSettingsTab] = useState<string | undefined>(),
    [returnToStudio, setReturnToStudio] = useState(false),
    [modelOverride, setModelOverride] = useState(''),
    [resultJob, setResultJob] = useState<Job | undefined>(),
    [resultClip, setResultClip] = useState(''),
    [seqFormat, setSeqFormat] = useState('9:16'),
    [assetQuery, setAssetQuery] = useState('');
  const sending = useRef(false);
  const appRef = useRef<HTMLDivElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      dragCleanup.current?.();
    },
    [],
  );
  const previewState = useRef<{ project: Project | null; sequenceId: string; mediaOrigin: string }>({
    project: null,
    sequenceId: '',
    mediaOrigin: '',
  });
  previewState.current = { project: previewProject, sequenceId, mediaOrigin: boot?.previewOrigin || '' };
  const iframe = useRef<HTMLIFrameElement>(null),
    envRef = useRef<ProjectEnvelope | null>(null),
    queue = useRef(Promise.resolve()),
    playRef = useRef(false),
    frameRef = useRef(70),
    promptRef = useRef<HTMLTextAreaElement>(null),
    messagesEnd = useRef<HTMLDivElement>(null),
    notifyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(notifyTimer.current);
    notifyTimer.current = setTimeout(() => setToast(null), error ? 7000 : 3500);
  }, []);
  const accept = useCallback((next: ProjectEnvelope) => {
    envRef.current = next;
    setEnv(next);
    void api<ProjectSummary[]>('project.list').then(setProjects);
  }, []);
  const work = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(label);
      try {
        return await fn();
      } catch (e) {
        notify(errorText(e), true);
      } finally {
        setBusy('');
      }
    },
    [notify],
  );
  const post = useCallback(
    (type: string, more: Record<string, unknown> = {}) =>
      iframe.current?.contentWindow?.postMessage({ source: 'cocraft-workbench', type, ...more }, '*'),
    [],
  );
  const seek = useCallback(
    (n: number) => {
      const e = envRef.current;
      if (!e) return;
      const s = e.project.sequences.find((s) => s.id === sequenceId) || e.project.sequences[0];
      const f = Math.max(0, Math.min(durationOf(s) - 1, Math.round(n)));
      frameRef.current = f;
      setFrame(f);
      post('seek', { frame: f });
    },
    [sequenceId, post],
  );
  const pause = useCallback(() => {
    post('pause');
    playRef.current = false;
    setPlaying(false);
  }, [post]);
  const play = useCallback(() => {
    if (playRef.current) pause();
    else {
      post('play');
      playRef.current = true;
      setPlaying(true);
    }
  }, [post, pause]);
  const edit = useCallback(
    (name: string, operations: EditOperation[]) => {
      const projectId = envRef.current?.project.id;
      const next = queue.current.then(async () => {
        const current = envRef.current;
        if (!current || current.project.id !== projectId) throw new Error('工程已经切换，请在当前工程重试');
        const result = await api<ProjectEnvelope>('project.edit', {
          projectId,
          baseRevision: current.project.revision,
          name,
          operations,
        });
        if (envRef.current?.project.id === projectId) accept(result);
      });
      queue.current = next.catch((e) => {
        notify(errorText(e), true);
      });
      return next;
    },
    [accept, notify],
  );
  const switchProject = async (next: ProjectEnvelope) => {
    pause();
    accept(next);
    setSequenceId(next.project.sequences[0].id);
    setTaskId(next.tasks[0]?.id || '');
    setFrame(0);
    frameRef.current = 0;
    setSelected(null);
    setScope(null);
    setDoc('film');
    setModelOverride('');
    setPrompt('');
    setJobsOpen(false);
    setResultJob(undefined);
    setGenerationDraft({ use: 'image' });
    setBriefDraft(next.project.brief);
    void api<BootData['skills']>('skills.list').then((skills) => setBoot((b) => (b ? { ...b, skills } : b)));
  };
  const openSettings = (tab?: string, fromStudio = false) => {
    setSettingsTab(tab);
    setReturnToStudio(fromStudio);
    setDialog('settings');
  };
  const openStudio = (use: GenerationDraft['use'] = 'image', assetId?: string) => {
    setGenerationDraft({ use, assetId });
    setDialog('generation');
  };
  const openDialog = (name: Dialog) => {
    if (name === 'new-task') {
      setDialog(null);
      setTaskId('');
      setPrompt('');
      setScope(null);
      setRight('agent');
      setShowRight(true);
      requestAnimationFrame(() => promptRef.current?.focus());
      return;
    }
    setFormName('');
    setCommand('');
    setDialog(name);
  };
  useEffect(() => {
    const reset = () => {
      setNavWidth(240);
      setAgentWidth(350);
      setTimelineHeight(278);
    };
    window.addEventListener('cocraft:reset-layout', reset);
    return () => window.removeEventListener('cocraft:reset-layout', reset);
  }, []);
  const refreshSettings = async (s: Partial<Settings>) => {
    const next = await api<Settings>('settings.save', s);
    setSettings(next);
    notify('设置已保存');
  };
  useEffect(() => {
    api<BootData>('boot')
      .then((data) => {
        setBoot(data);
        accept(data.current);
        setProjects(data.projects);
        setSettings(data.settings);
        setJobs(data.jobs);
        setSequenceId(data.current.project.sequences[0].id);
        setTaskId(data.current.tasks[0]?.id || '');
        setBriefDraft(data.current.project.brief);
      })
      .catch((e) => setFatal(errorText(e)));
    const offProject = window.cocraft.on('project', (e: ProjectEnvelope) => accept(e));
    const offJobs = window.cocraft.on('jobs', (j: Job[]) => setJobs([...j]));
    const offAgent = window.cocraft.on('agent', (e: AgentEvent) => {
      if (e.type === 'text') setStream((s) => ({ ...s, [e.taskId]: (s[e.taskId] || '') + e.text }));
      if (e.type === 'tool-start') setToolState((s) => ({ ...s, [e.taskId]: e.tool || '工作中' }));
      if (e.type === 'done') {
        setStream((s) => ({ ...s, [e.taskId]: '' }));
        setToolState((s) => ({ ...s, [e.taskId]: '' }));
      }
      if (e.type === 'error') notify(e.text || 'Agent 执行失败', true);
    });
    return () => {
      offProject();
      offJobs();
      offAgent();
    };
  }, []);
  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.glass = settings.glass ? 'on' : 'off';
    document.documentElement.dataset.theme =
      settings.theme === 'system'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : settings.theme;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => {
      if (settings.theme === 'system')
        document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [settings?.theme, settings?.glass]);
  useEffect(() => {
    if (env && !playing) setPreviewProject(env.project);
  }, [env?.project.revision, env?.project.id, playing]);
  useEffect(() => {
    if (!previewReady || !previewProject || !boot || !sequenceId) return;
    post('load', {
      props: { project: previewProject, sequenceId, mediaOrigin: boot.previewOrigin },
      frame: frameRef.current,
    });
  }, [previewReady, previewProject, sequenceId, boot?.previewOrigin, post]);
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (e.source !== iframe.current?.contentWindow || e.data?.source !== 'cocraft-preview') return;
      const d = e.data;
      if (d.event === 'ready') {
        setPreviewReady(true);
        const current = previewState.current;
        const p = current.project || envRef.current?.project;
        if (p && current.mediaOrigin)
          post('load', {
            props: {
              project: p,
              sequenceId: p.sequences.some((s) => s.id === current.sequenceId)
                ? current.sequenceId
                : p.sequences[0].id,
              mediaOrigin: current.mediaOrigin,
            },
            frame: frameRef.current,
          });
      }
      if (d.event === 'frame') {
        setFrame(d.frame);
        frameRef.current = d.frame;
      }
      if (d.event === 'play') {
        setPlaying(true);
        playRef.current = true;
      }
      if (d.event === 'pause' || d.event === 'ended') {
        setPlaying(false);
        playRef.current = false;
      }
      if (d.event === 'error') notify('预览：' + d.message, true);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [taskId, stream[taskId], env?.tasks.find((t) => t.id === taskId)?.messages.length]);
  const project = env?.project,
    sequence = project?.sequences.find((s) => s.id === sequenceId) || project?.sequences[0],
    clip = sequence?.clips.find((c) => c.id === selected),
    task = env?.tasks.find((t) => t.id === taskId),
    duration = sequence ? durationOf(sequence) : 30;
  useEffect(() => {
    setModelOverride(task?.modelId || '');
  }, [taskId, task?.modelId, project?.id]);
  useEffect(() => {
    if (project && !project.sequences.some((s) => s.id === sequenceId)) {
      pause();
      setSequenceId(project.sequences[0].id);
      setFrame(0);
      frameRef.current = 0;
    }
  }, [project?.revision, project?.id, sequenceId]);
  const changeSequence = (id: string) => {
    pause();
    setSequenceId(id);
    setSelected(null);
    setScope(null);
    setDoc('film');
    setFrame(0);
    frameRef.current = 0;
  };
  const selectClip = (id: string | null) => {
    setSelected(id);
    if (id) setRight('inspector');
  };
  const addAsset = async (id: string, atFrame = frame) => {
    if (!project || !sequence) return;
    const asset = project.assets.find((a) => a.id === id);
    if (!asset) return;
    const c = {
      ...newClip(asset.kind, atFrame, asset.id),
      name: asset.name,
      duration: Math.max(1, Math.floor((asset.kind === 'image' ? 5 : asset.duration) * sequence.fps)),
    };
    await edit('添加素材到时间线', [{ type: 'addClip', sequenceId: sequence.id, clip: c }]);
    selectClip(c.id);
  };
  const addPreset = async (id: string, overrides?: Record<string, unknown>) => {
    if (!sequence) return;
    const c = createPresetClip(id, frame, sequence.fps, overrides);
    await edit('添加' + c.name, [{ type: 'addClip', sequenceId: sequence.id, clip: c }]);
    selectClip(c.id);
    setShowRight(true);
    notify('已添加到时间线');
  };
  const addCaption = async () => {
    if (!sequence) return;
    const c = newClip('caption', frame);
    c.name = '对白字幕';
    c.props.text = '输入字幕';
    await edit('添加字幕', [{ type: 'addClip', sequenceId: sequence.id, clip: c }]);
    selectClip(c.id);
    setShowRight(true);
  };
  const loadPack = async (example = false) => {
    const next = await api<ProjectEnvelope | null>('packs.import', { example });
    if (next) {
      accept(next);
      notify('素材包已载入项目');
    }
  };
  const openDemo = () =>
    work('打开示例工程', async () => {
      await switchProject(await api<ProjectEnvelope>('project.demo'));
      setDialog(null);
    });
  const askForMotion = (text: string) => {
    openDialog('new-task');
    setPrompt(text);
  };
  const importMedia = () =>
    work('正在导入素材', async () => {
      const e = await api<ProjectEnvelope | null>('media.import');
      if (e) {
        accept(e);
        setNav('assets');
        notify('素材已导入。拖入时间线或点击 ＋ 添加。');
      }
    });
  const undo = () =>
    work('撤销', async () => {
      accept(await api<ProjectEnvelope>('project.undo'));
      notify('已撤销上次修改');
    });
  const redo = () => work('重做', async () => accept(await api<ProjectEnvelope>('project.redo')));
  const split = () => {
    if (!sequence || !clip) return;
    try {
      void edit('分割片段', splitOperations(sequence, clip, frame));
    } catch (e) {
      notify(errorText(e), true);
    }
  };
  const remove = (ripple = false) => {
    if (sequence && clip)
      void edit(ripple ? '波纹删除片段' : '删除片段', [
        { type: 'deleteClip', sequenceId: sequence.id, clipId: clip.id, ripple },
      ]);
  };
  const reference = () => {
    if (clip) {
      setScope(clone(clip));
      setRight('agent');
      setShowRight(true);
      promptRef.current?.focus();
    }
  };
  const chatModel =
    settings &&
    (settings.models.find((m) => m.id === modelOverride && m.capabilities.includes('agent')) ||
      selectedModel(settings, 'agent', project?.modelDefaults));
  const chatProvider = settings?.providers.find((p) => p.id === chatModel?.providerId);
  const chatConnected = !!chatProvider && (!chatProvider.requiresKey || chatProvider.hasApiKey);
  const send = async () => {
    if (sending.current || !prompt.trim() || !sequence || !env) return;
    if (!chatConnected && task?.status !== 'running') {
      openSettings(
        chatModel
          ? 'providers'
          : settings?.models.some((m) => m.capabilities.includes('agent'))
            ? 'defaults'
            : 'providers',
      );
      return;
    }
    const text = prompt.trim();
    sending.current = true;
    try {
      await work('提交给 Agent', async () => {
        let currentTask = task;
        if (!currentTask) {
          currentTask = await api<Task>('tasks.create', {
            modelId: modelOverride || undefined,
            name: text
              .replace(/^[#\s]+/, '')
              .replace(/\s+/g, ' ')
              .slice(0, 24),
            sequenceId: sequence.id,
          });
          setTaskId(currentTask.id);
          accept({ ...envRef.current!, tasks: [...envRef.current!.tasks, currentTask] });
        }
        if (currentTask.status !== 'running') setConnectingTask(currentTask.id);
        setStream((s) => ({ ...s, [currentTask!.id]: '' }));
        await api('agent.start', {
          taskId: currentTask.id,
          prompt: text,
          modelId: chatModel?.id,
          context: JSON.stringify({
            sequenceId: sequence.id,
            frame,
            reference: scope
              ? { clipId: scope.id, name: scope.name, start: scope.start, duration: scope.duration }
              : undefined,
          }),
        });
        setPrompt((previous) => (previous.trim() === text ? '' : previous));
      });
    } finally {
      setConnectingTask('');
      sending.current = false;
    }
  };
  const commands = [
    { name: '导入素材', detail: '视频、音频、图片', key: '⌘ I', action: () => void importMedia() },
    { name: '添加标题', detail: '可编辑的动态文字', key: 'T', action: () => setDialog('templates') },
    { name: '添加字幕', detail: '文字与时间同步', key: '', action: () => void addCaption() },
    {
      name: '导入 SRT 字幕',
      detail: '从文稿继续剪辑',
      key: '',
      action: () =>
        void work('导入字幕', async () => {
          const e = await api<ProjectEnvelope | null>('captions.import', { sequenceId });
          if (e) accept(e);
        }),
    },
    {
      name: '让 Agent 新建画面',
      detail: '根据描述生成可编辑组件',
      key: '',
      action: () => askForMotion('为当前成片设计一段可编辑的动态画面。'),
    },
    {
      name: '动态素材库',
      detail: '标题、字幕、信息图形与背景',
      key: '',
      action: () => setDialog('templates'),
    },
    { name: '新建示例工程', detail: '相位之间 · 横版与竖版', key: '', action: () => void openDemo() },
    { name: '生成图像或视频', detail: '素材工作室', key: '', action: () => openStudio('image') },
    { name: '生成配音', detail: '本机或云端语音模型', key: '', action: () => openStudio('speech') },
    {
      name: '转录素材',
      detail: '识别音频并生成字幕',
      key: '',
      action: () => openStudio('transcription', clip?.assetId),
    },
    { name: '分析画面', detail: '多模态模型', key: '', action: () => openStudio('vision', clip?.assetId) },
    { name: '搜索素材', detail: 'Pexels 视频', key: '', action: () => setDialog('stock') },
    {
      name: '创建竖版 / 多平台版本',
      detail: '独立时间线，共享素材',
      key: '',
      action: () => openDialog('sequence'),
    },
    { name: '导出成片', detail: 'MP4 · 固定当前版本', key: '⌘ E', action: () => setDialog('export') },
    {
      name: '保存当前帧',
      detail: 'PNG 静帧',
      key: '',
      action: () =>
        void work('生成静帧', async () => {
          await api('export.still', { sequenceId, frame });
          setJobsOpen(true);
        }),
    },
    {
      name: '打开工程文件夹',
      detail: '源码、素材、Skills 与导出',
      key: '',
      action: () => void api('project.reveal'),
    },
    {
      name: '切换剪辑聚焦',
      detail: '收起 / 展开两侧面板',
      key: '',
      action: () => {
        setShowNav((v) => !v);
        setShowRight((v) => !v);
      },
    },
    { name: '设置', detail: '模型、外观与 Skills', key: '⌘ ,', action: () => openSettings() },
  ];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const input = (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]');
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openDialog('command');
        return;
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        openSettings();
        return;
      }
      if (dialog || input) return;
      if (e.code === 'Space') {
        e.preventDefault();
        play();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(frameRef.current + (e.shiftKey ? 10 : 1));
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(frameRef.current - (e.shiftKey ? 10 : 1));
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        split();
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        remove(e.shiftKey);
      }
      if (!mod && e.key.toLowerCase() === 'l' && clip && sequence)
        void edit(clip.locked ? '解锁片段' : '锁定片段', [
          { type: 'updateClip', sequenceId: sequence.id, clipId: clip.id, changes: { locked: !clip.locked } },
        ]);
      if (e.key === 'Escape') {
        setSelected(null);
        setScope(null);
        setJobsOpen(false);
      }
    };
    window.addEventListener('keydown', key);
    const off = window.cocraft.on('menu', (name: string) => {
      if (name === 'settings') openSettings();
      if (name === 'demo-project') void openDemo();
      if (name === 'command') openDialog('command');
      if (name === 'new-project') openDialog('new-project');
      if (name === 'open-project')
        void work('打开工程', async () => {
          const e = await api<ProjectEnvelope | null>('project.open');
          if (e) await switchProject(e);
        });
      if (name === 'import') void importMedia();
      if (name === 'export') setDialog('export');
      if (name === 'undo') {
        if ((document.activeElement as HTMLElement)?.matches('input,textarea')) document.execCommand('undo');
        else void undo();
      }
      if (name === 'redo') {
        if ((document.activeElement as HTMLElement)?.matches('input,textarea')) document.execCommand('redo');
        else void redo();
      }
    });
    return () => {
      window.removeEventListener('keydown', key);
      off();
    };
  }, [env, sequenceId, selected, dialog, playing, settings]);
  function resize(e: React.PointerEvent<HTMLElement>, axis: 'timeline' | 'agent' | 'nav') {
    dragCleanup.current?.();
    const x = e.clientX,
      y = e.clientY;
    const navSpace = showNav
      ? appRef.current?.querySelector('.sidebar')?.getBoundingClientRect().width || navWidth
      : 0;
    const agentSpace = showRight
      ? appRef.current?.querySelector('.right-panel')?.getBoundingClientRect().width || agentWidth
      : 0;
    const start =
      appRef.current
        ?.querySelector(axis === 'timeline' ? '.editor-panel' : axis === 'nav' ? '.sidebar' : '.right-panel')
        ?.getBoundingClientRect()[axis === 'timeline' ? 'height' : 'width'] ||
      (axis === 'timeline' ? timelineHeight : axis === 'nav' ? navWidth : agentWidth);
    const key = axis === 'timeline' ? '--timeline-height' : axis === 'nav' ? '--nav-width' : '--agent-width';
    let value = start;
    dragCleanup.current = pointerDrag(
      e,
      (px, py) => {
        const width = appRef.current?.clientWidth || window.innerWidth;
        value =
          axis === 'timeline'
            ? Math.max(180, Math.min(window.innerHeight - 330, start + y - py))
            : axis === 'nav'
              ? Math.max(190, Math.min(420, width - agentSpace - 420, start + px - x))
              : Math.max(290, Math.min(620, width - navSpace - 420, start + x - px));
        appRef.current?.style.setProperty(key, `${Math.round(value)}px`);
      },
      () => {
        value = Math.round(value);
        (axis === 'timeline' ? setTimelineHeight : axis === 'nav' ? setNavWidth : setAgentWidth)(value);
        localStorage.setItem(
          axis === 'timeline' ? 'cc-timeline-height' : axis === 'nav' ? 'cc-nav-width' : 'cc-agent-width',
          String(value),
        );
        dragCleanup.current = null;
      },
      axis === 'timeline' ? 'row-resize' : 'col-resize',
    );
  }
  function keyboardResize(e: React.KeyboardEvent<HTMLElement>, axis: 'nav' | 'agent' | 'timeline') {
    const positive = axis === 'nav' ? 'ArrowRight' : axis === 'agent' ? 'ArrowLeft' : 'ArrowUp';
    const negative = axis === 'nav' ? 'ArrowLeft' : axis === 'agent' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== positive && e.key !== negative && e.key !== 'Home') return;
    e.preventDefault();
    e.stopPropagation();
    const panel = e.currentTarget.parentElement!;
    const current =
      axis === 'timeline' ? panel.getBoundingClientRect().height : panel.getBoundingClientRect().width;
    const opposite =
      appRef.current?.querySelector(axis === 'nav' ? '.right-panel' : '.sidebar')?.getBoundingClientRect()
        .width || 0;
    const max =
      axis === 'timeline'
        ? window.innerHeight - 330
        : Math.min(axis === 'nav' ? 420 : 620, window.innerWidth - opposite - 420);
    const min = axis === 'nav' ? 190 : axis === 'agent' ? 290 : 180;
    const value =
      e.key === 'Home'
        ? axis === 'nav'
          ? 240
          : axis === 'agent'
            ? 350
            : 278
        : Math.max(min, Math.min(max, current + (e.key === positive ? 1 : -1) * (e.shiftKey ? 48 : 12)));
    (axis === 'nav' ? setNavWidth : axis === 'agent' ? setAgentWidth : setTimelineHeight)(value);
    localStorage.setItem(
      axis === 'nav' ? 'cc-nav-width' : axis === 'agent' ? 'cc-agent-width' : 'cc-timeline-height',
      String(value),
    );
  }
  if (fatal)
    return (
      <div className="boot-screen">
        <Mark />
        <h2>工作台暂时无法打开</h2>
        <p>{fatal}</p>
        <button className="button" onClick={() => location.reload()}>
          重新打开
        </button>
      </div>
    );
  if (!boot || !env || !project || !sequence || !settings)
    return (
      <div className="boot-screen">
        <Mark />
        <p>正在打开工程…</p>
      </div>
    );
  const runningJob = jobs.find((j) => j.status === 'running'),
    pendingVersion = playing && previewProject?.revision !== project.revision;
  const shownAssets = project.assets.filter((a) => a.name.toLowerCase().includes(assetQuery.toLowerCase()));
  return (
    <div
      ref={appRef}
      className={`app ${!showNav ? 'nav-hidden' : ''} ${!showRight ? 'right-hidden' : ''}`}
      style={
        {
          '--agent-width': `${agentWidth}px`,
          '--nav-width': `${navWidth}px`,
          '--timeline-height': `${timelineHeight}px`,
        } as React.CSSProperties
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDraggingFile(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDraggingFile(false);
      }}
      onDrop={(e) => {
        setDraggingFile(false);
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          const paths = window.cocraft.pathsForFiles(Array.from(e.dataTransfer.files));
          void work('正在导入素材', async () => {
            accept(await api<ProjectEnvelope>('media.import', { paths }));
            setNav('assets');
            notify('素材已导入');
          });
        }
      }}
    >
      <header className="titlebar">
        <div className="titlebar-left">
          <IconButton label="切换项目侧栏" active={!showNav} onClick={() => setShowNav((v) => !v)}>
            <PanelLeft size={16} />
          </IconButton>
          <span className="brand">
            <BrandMark size={18} />
            CoCraft
          </span>
          <span className="titlebar-divider" />
          <span className="titlebar-project">{project.name}</span>
        </div>
        <button className="command-launch" onClick={() => openDialog('command')}>
          <Search size={13} />
          <span>搜索、跳转或运行命令</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="titlebar-right">
          <IconButton label="后台作业" active={jobsOpen} onClick={() => setJobsOpen((v) => !v)}>
            {runningJob ? <Spinner /> : <Clock3 size={15} />}
          </IconButton>
          <IconButton label="切换右侧面板" active={!showRight} onClick={() => setShowRight((v) => !v)}>
            <PanelRight size={16} />
          </IconButton>
          <button className="export-button" onClick={() => setDialog('export')}>
            导出 <ArrowUpRight size={13} />
          </button>
        </div>
      </header>
      {showNav && (
        <aside className="sidebar">
          <div
            className="nav-resizer"
            role="separator"
            aria-label="调整左侧栏宽度"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuenow={navWidth}
            onKeyDown={(e) => keyboardResize(e, 'nav')}
            onPointerDown={(e) => resize(e, 'nav')}
          />
          <div className="nav-switch">
            <button className={nav === 'projects' ? 'active' : ''} onClick={() => setNav('projects')}>
              <Folder size={13} /> 项目
            </button>
            <button className={nav === 'assets' ? 'active' : ''} onClick={() => setNav('assets')}>
              <Layers size={13} /> 素材 <span>{project.assets.length}</span>
            </button>
          </div>
          {nav === 'projects' ? (
            <>
              <div className="sidebar-label">
                工作空间{' '}
                <IconButton label="新建项目" onClick={() => openDialog('new-project')}>
                  <Plus size={13} />
                </IconButton>
              </div>
              <div className="project-tree">
                <button className="project-active" onClick={() => setDoc('film')}>
                  <ChevronDown size={12} />
                  <span className="project-icon">
                    <Clapperboard size={14} />
                  </span>
                  <b>{project.name}</b>
                  <span className="project-dot" />
                </button>
                <div className="task-tree">
                  {env.tasks.map((t) => (
                    <button
                      key={t.id}
                      className={`task-item ${taskId === t.id ? 'active' : ''}`}
                      onClick={() => {
                        setTaskId(t.id);
                        setRight('agent');
                        if (t.sequenceId !== sequenceId) changeSequence(t.sequenceId);
                      }}
                    >
                      <span className={`task-dot ${t.status}`} />
                      <span>{t.name}</span>
                      {t.status === 'running' && <Spinner />}
                    </button>
                  ))}
                  {env.tasks.length === 0 && <div className="task-empty">从一个想法开始。</div>}
                  <button className="new-task" onClick={() => openDialog('new-task')}>
                    <Plus size={12} /> 新会话
                  </button>
                </div>
              </div>
              <div className="sidebar-label">项目内容</div>
              <div className="project-docs">
                {project.sequences.map((s) => (
                  <button
                    key={s.id}
                    className={sequenceId === s.id && doc === 'film' ? 'active' : ''}
                    onClick={() => changeSequence(s.id)}
                  >
                    <Film size={14} />
                    <span>{s.name}</span>
                    <span className="ratio-label">
                      {s.width > s.height ? '16:9' : s.width < s.height ? '9:16' : '1:1'}
                    </span>
                  </button>
                ))}
                <button
                  className={doc === 'brief' ? 'active' : ''}
                  onClick={() => {
                    setBriefDraft(project.brief);
                    setDoc('brief');
                  }}
                >
                  <FileText size={14} />
                  <span>创作约定</span>
                </button>
                <button onClick={() => openDialog('sequence')}>
                  <Plus size={14} />
                  <span>新建成片版本</span>
                </button>
              </div>
              {projects.filter((p) => p.id !== project.id).length > 0 && (
                <>
                  <div className="sidebar-label recent-label">最近项目</div>
                  {projects
                    .filter((p) => p.id !== project.id)
                    .slice(0, 6)
                    .map((p) => (
                      <button
                        className="recent-project"
                        key={p.id}
                        onClick={() =>
                          void work('打开工程', async () =>
                            switchProject(await api<ProjectEnvelope>('project.open', { path: p.path })),
                          )
                        }
                      >
                        <ChevronRight size={11} />
                        <Folder size={14} />
                        <span>{p.name}</span>
                      </button>
                    ))}
                </>
              )}
            </>
          ) : (
            <>
              <div className="asset-search">
                <Search size={12} />
                <input
                  aria-label="筛选项目素材"
                  placeholder="筛选素材…"
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                />
              </div>
              <button className="import-zone" onClick={() => void importMedia()}>
                <Upload size={17} />
                <span>导入素材</span>
                <small>或拖放到窗口</small>
              </button>
              <div className="sidebar-label">
                本项目 <span>{shownAssets.length}</span>
              </div>
              <div className="asset-list">
                {shownAssets.map((a) => (
                  <div
                    className="asset-item"
                    key={a.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('application/cocraft-asset', a.id)}
                  >
                    <div className="asset-thumb">
                      {a.thumbnail ? (
                        <img src={mediaUrl(boot.previewOrigin, a.id, true)} alt="" />
                      ) : (
                        <AudioLines size={20} />
                      )}
                    </div>
                    <div className="asset-copy">
                      <b title={a.name}>{a.name}</b>
                      <small>
                        {a.kind === 'audio' ? '音频' : a.kind === 'image' ? '图片' : '视频'} ·{' '}
                        {a.kind === 'image'
                          ? `${a.width || 1920} × ${a.height || 1080}`
                          : a.duration.toFixed(1) + ' s'}
                      </small>
                    </div>
                    <IconButton label={`添加 ${a.name}`} onClick={() => void addAsset(a.id)}>
                      <Plus size={13} />
                    </IconButton>
                  </div>
                ))}
              </div>
              <div className="sidebar-label">素材工具</div>
              <button className="resource-link" onClick={() => setDialog('templates')}>
                <Type size={14} /> 动态素材库 <ChevronRight size={12} />
              </button>
              <button className="resource-link" onClick={() => setDialog('stock')}>
                <Search size={14} /> 搜索 Pexels 素材 <ChevronRight size={12} />
              </button>
              <button className="resource-link" onClick={() => openStudio()}>
                <AudioLines size={14} /> 素材工作室 <ChevronRight size={12} />
              </button>
            </>
          )}
          <div className="sidebar-bottom">
            <button
              onClick={() =>
                void work('打开工程', async () => {
                  const e = await api<ProjectEnvelope | null>('project.open');
                  if (e) await switchProject(e);
                })
              }
            >
              <FolderOpen size={14} /> 打开项目…
            </button>
            <button onClick={() => openSettings()}>
              <SettingsIcon size={14} /> 设置 <kbd>⌘ ,</kbd>
            </button>
            <div className="workspace-label">
              <span className="local-dot" /> 本地工作空间 <span>0.2</span>
            </div>
          </div>
        </aside>
      )}
      <main className="workbench">
        <div className="document-tabs">
          {project.sequences.map((s) => (
            <button
              key={s.id}
              className={doc === 'film' && s.id === sequenceId ? 'active' : ''}
              onClick={() => changeSequence(s.id)}
            >
              <Film size={13} />
              {s.name}
              <span className="tab-dot" />
            </button>
          ))}
          <button
            className={doc === 'brief' ? 'active' : ''}
            onClick={() => {
              setBriefDraft(project.brief);
              setDoc('brief');
            }}
          >
            <FileText size={13} />
            创作约定
          </button>
          <button className="tab-add" aria-label="新建成片版本" onClick={() => openDialog('sequence')}>
            <Plus size={14} />
          </button>
        </div>
        {doc === 'brief' ? (
          <div className="brief-page">
            <div className="eyebrow">PROJECT BRIEF</div>
            <h1>创作约定</h1>
            <p>这里的约定会进入每个 Agent 任务。写下目标、受众、节奏，以及你想保留的细节。</p>
            <textarea
              aria-label="创作约定"
              value={briefDraft}
              onChange={(e) => setBriefDraft(e.target.value)}
              spellCheck={false}
            />
            <footer>
              <span>
                <FileText size={13} /> brief.md
              </span>
              <button
                className="button primary"
                onClick={() =>
                  void work('保存约定', async () => {
                    await edit('更新创作约定', [{ type: 'updateProject', changes: { brief: briefDraft } }]);
                    notify('创作约定已保存');
                  })
                }
              >
                <Check size={14} /> 保存约定
              </button>
            </footer>
          </div>
        ) : (
          <>
            <div className="viewer-bar">
              <div className="breadcrumbs">
                <span>{project.name}</span>
                <ChevronRight size={11} />
                <b>{sequence.name}</b>
              </div>
              <div className="viewer-actions">
                <button className="version-button" onClick={() => setDialog('versions')}>
                  <GitBranch size={12} /> v{project.revision}
                  <ChevronDown size={10} />
                </button>
                <span className="toolbar-divider" />
                <IconButton label="撤销 ⌘Z" disabled={!env.canUndo} onClick={() => void undo()}>
                  <Undo2 size={14} />
                </IconButton>
                <IconButton label="重做 ⇧⌘Z" disabled={!env.canRedo} onClick={() => void redo()}>
                  <Redo2 size={14} />
                </IconButton>
              </div>
            </div>
            <div className="viewer-area">
              <div className="preview-canvas">
                <iframe
                  ref={iframe}
                  src={boot.previewOrigin + '/ui/preview.html'}
                  title="成片预览"
                  sandbox="allow-scripts allow-same-origin"
                  allow="autoplay"
                />
                <span className="preview-corner top-left" />
                <span className="preview-corner top-right" />
                <span className="preview-corner bottom-left" />
                <span className="preview-corner bottom-right" />
                {sequence.clips.length === 0 && (
                  <div className="empty-canvas">
                    <Mark />
                    <h2>时间线为空</h2>
                    <p>导入素材，或让一个想法先变成画面。</p>
                    <div>
                      <button className="button primary" onClick={() => void importMedia()}>
                        <Upload size={14} /> 导入素材
                      </button>
                      <button className="button" onClick={() => setDialog('templates')}>
                        <Layers size={14} /> 从内置画面开始
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {pendingVersion && (
                <button className="pending-version" onClick={pause}>
                  <GitBranch size={12} /> 新版本已就绪 · 暂停后查看
                </button>
              )}
            </div>
            <div className="playback-bar">
              <div className="playback-time">
                <b>{timecode(frame, sequence.fps)}</b>
                <span>/ {timecode(duration, sequence.fps)}</span>
              </div>
              <div className="transport">
                <IconButton
                  label="上一个镜头"
                  onClick={() =>
                    seek(
                      [
                        ...sequence.clips
                          .filter((c) => c.track === 'visual' && c.start < frame)
                          .map((c) => c.start),
                      ].sort((a, b) => b - a)[0] || 0,
                    )
                  }
                >
                  <SkipBack size={14} />
                </IconButton>
                <button className="play-button" aria-label={playing ? '暂停' : '播放'} onClick={play}>
                  {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
                </button>
                <IconButton
                  label="下一个镜头"
                  onClick={() =>
                    seek(
                      sequence.clips
                        .filter((c) => c.track === 'visual' && c.start > frame)
                        .sort((a, b) => a.start - b.start)[0]?.start || duration - 1,
                    )
                  }
                >
                  <SkipForward size={14} />
                </IconButton>
              </div>
              <div className="playback-meta">
                <span>
                  {sequence.width} × {sequence.height}
                </span>
                <IconButton
                  label={muted ? '开启声音' : '静音'}
                  onClick={() => {
                    setMuted((v) => !v);
                    post('mute', { muted: !muted });
                  }}
                >
                  {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </IconButton>
                <IconButton
                  label="聚焦预览"
                  onClick={() => {
                    setShowNav((v) => !v);
                    setShowRight((v) => !v);
                  }}
                >
                  <Maximize2 size={13} />
                </IconButton>
              </div>
            </div>
            <section className="editor-panel">
              <div
                className="horizontal-resizer"
                role="separator"
                aria-label="调整时间线高度"
                aria-orientation="horizontal"
                tabIndex={0}
                aria-valuenow={timelineHeight}
                onKeyDown={(e) => keyboardResize(e, 'timeline')}
                onPointerDown={(e) => resize(e, 'timeline')}
                title="拖动调整时间线高度"
              />
              <div className="editor-toolbar">
                <div className="editor-tabs">
                  {[
                    ['timeline', '时间线'],
                    ['transcript', '文稿'],
                    ['storyboard', '分镜'],
                    ['changes', '修改'],
                  ].map(([id, title]) => (
                    <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
                      {title}
                      {id === 'changes' && project.revision > 0 && <span>{project.revision}</span>}
                    </button>
                  ))}
                </div>
                <div className="timeline-tools">
                  <IconButton label="分割片段 ⌘B" disabled={!clip || clip.locked} onClick={split}>
                    <Scissors size={14} />
                  </IconButton>
                  <IconButton label="删除片段 ⌫" disabled={!clip || clip.locked} onClick={() => remove()}>
                    <Trash2 size={13} />
                  </IconButton>
                  <IconButton
                    label={clip?.locked ? '解锁片段 L' : '锁定片段 L'}
                    disabled={!clip}
                    active={clip?.locked}
                    onClick={() =>
                      clip &&
                      void edit(clip.locked ? '解锁片段' : '锁定片段', [
                        {
                          type: 'updateClip',
                          sequenceId,
                          clipId: clip.id,
                          changes: { locked: !clip.locked },
                        },
                      ])
                    }
                  >
                    {clip?.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </IconButton>
                  <span className="toolbar-divider" />
                  <IconButton label="吸附" active={snap} onClick={() => setSnap((v) => !v)}>
                    <Magnet size={13} />
                  </IconButton>
                  <IconButton
                    label="缩小时间线"
                    disabled={zoom <= 100}
                    onClick={() => setZoom((z) => Math.max(100, z - 50))}
                  >
                    <ZoomOut size={13} />
                  </IconButton>
                  <IconButton
                    label="放大时间线"
                    disabled={zoom >= 400}
                    onClick={() => setZoom((z) => Math.min(400, z + 50))}
                  >
                    <ZoomIn size={13} />
                  </IconButton>
                  <button className="add-element" onClick={() => setDialog('templates')}>
                    <Plus size={13} /> 添加
                  </button>
                </div>
              </div>
              {view === 'timeline' && (
                <Timeline
                  project={project}
                  sequence={sequence}
                  frame={frame}
                  selected={selected}
                  onSelect={selectClip}
                  onSeek={seek}
                  onEdit={(n, o) => void edit(n, o)}
                  onAssetDrop={(id, f) => void addAsset(id, f)}
                  mediaOrigin={boot.previewOrigin}
                  zoom={zoom}
                  snap={snap}
                />
              )}
              {view === 'transcript' && (
                <div className="transcript-panel">
                  <div className="sub-toolbar">
                    <span>
                      {sequence.clips.filter((c) => c.kind === 'caption').length} 条字幕 ·
                      点击时间跳转，编辑文字后自动保存
                    </span>
                    <button
                      className="button tiny"
                      onClick={() =>
                        void work('导入字幕', async () => {
                          const e = await api<ProjectEnvelope | null>('captions.import', { sequenceId });
                          if (e) accept(e);
                        })
                      }
                    >
                      <Upload size={12} /> 导入 SRT
                    </button>
                    <button
                      className="button tiny"
                      onClick={() => openStudio('transcription', clip?.assetId)}
                    >
                      <AudioLines size={12} />
                      转录素材
                    </button>
                    <button
                      className="button tiny"
                      onClick={() => void api('captions.export', { sequenceId })}
                    >
                      导出 SRT
                    </button>
                  </div>
                  {sequence.clips
                    .filter((c) => c.kind === 'caption')
                    .sort((a, b) => a.start - b.start)
                    .map((c) => (
                      <div
                        className={`transcript-row ${frame >= c.start && frame < c.start + c.duration ? 'current' : ''}`}
                        key={c.id}
                      >
                        <button
                          onClick={() => {
                            seek(c.start);
                            selectClip(c.id);
                          }}
                        >
                          {timecode(c.start, sequence.fps)}
                        </button>
                        <input
                          aria-label={`字幕 ${c.name}`}
                          defaultValue={String(c.props.text || '')}
                          disabled={c.locked}
                          onBlur={(e) => {
                            if (e.target.value !== c.props.text)
                              void edit('修改字幕', [
                                {
                                  type: 'updateClip',
                                  sequenceId,
                                  clipId: c.id,
                                  changes: { props: { text: e.target.value } },
                                },
                              ]);
                          }}
                        />
                        <IconButton
                          label={`删除字幕 ${c.name}`}
                          disabled={c.locked}
                          onClick={() =>
                            void edit('删除字幕', [{ type: 'deleteClip', sequenceId, clipId: c.id }])
                          }
                        >
                          <X size={12} />
                        </IconButton>
                      </div>
                    ))}
                  {!sequence.clips.some((c) => c.kind === 'caption') && (
                    <div className="panel-empty">
                      <FileText size={23} />
                      <p>把对白与画面连接起来。</p>
                      <span>导入 SRT 字幕，或添加一条字幕开始编辑。</span>
                      <button className="button tiny" onClick={() => void addCaption()}>
                        <Plus size={12} /> 添加字幕
                      </button>
                    </div>
                  )}
                </div>
              )}
              {view === 'storyboard' && (
                <div className="storyboard-panel">
                  {sequence.clips
                    .filter((c) => c.track === 'visual')
                    .sort((a, b) => a.start - b.start)
                    .map((c, i) => {
                      const a = project.assets.find((a) => a.id === c.assetId);
                      return (
                        <button
                          className={`storyboard-card ${selected === c.id ? 'selected' : ''}`}
                          key={c.id}
                          onClick={() => {
                            selectClip(c.id);
                            seek(c.start);
                          }}
                        >
                          <div>
                            {a?.thumbnail ? (
                              <img src={mediaUrl(boot.previewOrigin, a.id, true)} alt="" />
                            ) : (
                              <Layers size={28} />
                            )}
                            <span>{String(i + 1).padStart(2, '0')}</span>
                          </div>
                          <b>{c.name}</b>
                          <small>
                            {timecode(c.start, sequence.fps)} · {(c.duration / sequence.fps).toFixed(1)} s
                          </small>
                        </button>
                      );
                    })}
                </div>
              )}
              {view === 'changes' && (
                <div className="changes-panel">
                  {env.revisions.map((r) => (
                    <div className="change-row" key={r.revision}>
                      <span className={`change-avatar ${r.author === 'agent' ? 'agent' : ''}`}>
                        {r.author === 'agent' ? <Mark small /> : <GitBranch size={14} />}
                      </span>
                      <div>
                        <b>{r.name}</b>
                        <p>{r.changes.join(' · ')}</p>
                      </div>
                      <span>v{r.revision}</span>
                      <small>{dateLabel(r.createdAt)}</small>
                      {r.revision === project.revision ? (
                        <span className="current-label">当前</span>
                      ) : (
                        <button
                          className="text-button"
                          onClick={() =>
                            void work('恢复版本', async () => {
                              accept(await api<ProjectEnvelope>('project.restore', { revision: r.revision }));
                              notify('已恢复，仍可撤销');
                            })
                          }
                        >
                          恢复
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="selection-bar">
                <span>
                  {clip ? (
                    <>
                      <span className={`selection-dot ${clip.kind}`} />
                      {clip.name}
                      <span className="selection-range">
                        {timecode(clip.start, sequence.fps)} —{' '}
                        {timecode(clip.start + clip.duration, sequence.fps)}
                      </span>
                      {clip.locked && <Lock size={11} />}
                    </>
                  ) : (
                    <>
                      <span className="muted-dot" />
                      {sequence.clips.length} 个片段
                      <span className="selection-range">拖动调整顺序 · 拖动边缘调整入出点</span>
                    </>
                  )}
                </span>
                {clip && (
                  <button onClick={reference}>
                    引用给 Agent <ArrowUpRight size={12} />
                  </button>
                )}
              </div>
            </section>
          </>
        )}
      </main>
      {showRight && (
        <aside className="right-panel">
          <div
            className="vertical-resizer"
            role="separator"
            aria-label="调整 Agent 面板宽度"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuenow={agentWidth}
            onKeyDown={(e) => keyboardResize(e, 'agent')}
            onPointerDown={(e) => resize(e, 'agent')}
          />
          <div className="right-tabs">
            <button className={right === 'agent' ? 'active' : ''} onClick={() => setRight('agent')}>
              <Mark small /> Agent
            </button>
            <button className={right === 'inspector' ? 'active' : ''} onClick={() => setRight('inspector')}>
              <SlidersHorizontal size={13} /> 属性
            </button>
            <IconButton label="新建 Agent 任务" onClick={() => openDialog('new-task')}>
              <Plus size={14} />
            </IconButton>
          </div>
          {right === 'inspector' ? (
            <Inspector
              clip={clip}
              sequence={sequence}
              project={project}
              onEdit={(n, o) => void edit(n, o)}
              onReference={reference}
              onCode={() => {
                setCodeComponent(project.components.find((c) => c.id === clip?.componentId));
                setDialog('code');
              }}
            />
          ) : (
            <div className="agent-panel">
              <div className="agent-task-heading">
                <div>
                  <b>{task?.name || '新会话'}</b>
                  <small>
                    <Film size={11} />
                    {sequence.name}
                    <span>·</span>
                    {task?.status === 'running'
                      ? '正在工作'
                      : task?.id && task.id === connectingTask
                        ? '正在连接模型…'
                        : '随时可以开始'}
                  </small>
                </div>
                {task?.status === 'running' || (!!task?.id && task.id === connectingTask) ? (
                  <button className="button tiny stop" onClick={() => void api('agent.stop', { taskId })}>
                    <Square size={10} fill="currentColor" /> 停止
                  </button>
                ) : (
                  task && (
                    <IconButton
                      label="重命名会话"
                      onClick={() => {
                        setFormName(task.name);
                        setDialog('rename-task');
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </IconButton>
                  )
                )}
              </div>
              <div className="agent-scroll">
                {(!task || task.messages.length === 0) && (
                  <div className="agent-welcome">
                    <div className="welcome-mark">
                      <Mark />
                    </div>
                    <h2>想怎样剪这条片？</h2>
                    <p>可以从素材、某个片段或一段新画面开始。</p>
                    <div className="prompt-suggestions">
                      {[
                        ['让开头更有吸引力', '分析当前素材，优化开场三秒的叙事与节奏，并直接完成修改。'],
                        [
                          '做一个更好的动态片头',
                          '制作一个专业的动态片头，结合当前内容选择合适的构图和节奏，保留可编辑参数。',
                        ],
                        ['整理一版竖屏预告', '基于主片新建一份 9:16 竖屏版本，重新安排标题位置，保留主片。'],
                      ].map(([title, text]) => (
                        <button
                          key={title}
                          onClick={() => {
                            setPrompt(text);
                            promptRef.current?.focus();
                          }}
                        >
                          {title}
                          <ArrowUpRight size={12} />
                        </button>
                      ))}
                    </div>
                    <div className="agent-capabilities">
                      <span>
                        <Scissors size={11} /> 剪辑
                      </span>
                      <span>
                        <Code2 size={12} /> 编码
                      </span>
                      <span>
                        <Layers size={11} /> Skills
                      </span>
                    </div>
                  </div>
                )}
                {task?.messages.map((m) =>
                  m.role === 'tool' ? (
                    m.status === 'tool-start' ? (
                      <details className="tool-message" key={m.id}>
                        <summary>
                          <TerminalIcon />
                          <span>
                            {(
                              {
                                read: '读取文件',
                                write: '编写文件',
                                edit: '编辑文件',
                                bash: '运行脚本',
                                read_project: '读取工程',
                                publish_edit: '发布剪辑修改',
                                compile_component: '编译画面组件',
                                preview_frame: '检查预览帧',
                              } as Record<string, string>
                            )[m.tool || ''] || m.tool}
                          </span>
                          <ChevronRight size={11} />
                        </summary>
                        <pre>{m.text}</pre>
                      </details>
                    ) : null
                  ) : (
                    <div className={`message ${m.role}`} key={m.id}>
                      {m.role === 'assistant' && (
                        <div className="assistant-label">
                          <Mark small /> CoCraft
                        </div>
                      )}
                      <Markdown text={m.text} />
                    </div>
                  ),
                )}
                {!!stream[taskId] && (
                  <div className="message assistant streaming">
                    <div className="assistant-label">
                      <Mark small /> CoCraft
                    </div>
                    <Markdown text={stream[taskId]} />
                  </div>
                )}
                {task?.status === 'running' && (
                  <div className="agent-working">
                    <Spinner />
                    <span>{toolState[taskId] || '正在思考与创作…'}</span>
                  </div>
                )}
                <div ref={messagesEnd} />
              </div>
              <div className="composer-wrap">
                {!chatConnected && (
                  <button
                    className="connect-hint"
                    onClick={() => openSettings(chatModel ? 'providers' : 'defaults')}
                  >
                    <span className="muted-dot" /> 连接模型，开启 Agent 创作 <ArrowUpRight size={11} />
                  </button>
                )}
                <div className="composer">
                  {scope && (
                    <div className="scope-chip">
                      <Film size={11} />
                      <span>{scope.name}</span>
                      <button aria-label="移除片段引用" onClick={() => setScope(null)}>
                        <X size={10} />
                      </button>
                    </div>
                  )}
                  <textarea
                    ref={promptRef}
                    aria-label="给 Agent 的指令"
                    placeholder={
                      task?.status === 'running' ? '补充方向，随时打断…' : '描述你想要的画面或修改…'
                    }
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="composer-bottom">
                    <div className="composer-model">
                      <span className={chatConnected ? 'connected-dot' : 'muted-dot'} />
                      <select
                        aria-label="会话模型"
                        value={modelOverride}
                        disabled={task?.status === 'running' || (!!task?.id && task.id === connectingTask)}
                        onChange={(e) => {
                          if (e.target.value === ':settings') openSettings('models');
                          else {
                            const value = e.target.value;
                            setModelOverride(value);
                            if (task)
                              void work('更新会话模型', async () => {
                                try {
                                  const updated = await api<Task>('tasks.model', {
                                    id: task.id,
                                    modelId: value,
                                  });
                                  const current = envRef.current;
                                  if (current?.project.id === project.id)
                                    accept({
                                      ...current,
                                      tasks: current.tasks.map((t) => (t.id === updated.id ? updated : t)),
                                    });
                                } catch (error) {
                                  setModelOverride(task.modelId || '');
                                  throw error;
                                }
                              });
                          }
                        }}
                      >
                        <option value="">
                          {selectedModel(settings, 'agent', project.modelDefaults)?.name || '选择模型'}
                        </option>
                        {settings.models
                          .filter((m) => m.capabilities.includes('agent'))
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} · {settings.providers.find((p) => p.id === m.providerId)?.name}
                            </option>
                          ))}
                        <option value=":settings">管理模型…</option>
                      </select>
                    </div>
                    <button
                      className="send-button"
                      aria-label="发送给 Agent"
                      disabled={!prompt.trim()}
                      onClick={() => void send()}
                    >
                      <ArrowUp size={16} />
                    </button>
                  </div>
                </div>
                <div className="composer-note">
                  <Lock size={10} /> 锁定的片段始终由你掌控<span>↵ 发送</span>
                </div>
              </div>
            </div>
          )}
        </aside>
      )}
      <footer className="statusbar">
        <div>
          <span className={busy ? 'busy-dot' : 'local-dot'} />
          {busy || '所有修改已保存'}
          {pendingVersion && <span>· 预览固定在 v{previewProject?.revision}</span>}
        </div>
        <div>
          {runningJob && (
            <button onClick={() => setJobsOpen(true)}>
              <Spinner />
              {runningJob.stage} {Math.round(runningJob.progress * 100)}%
            </button>
          )}
          <button onClick={() => void api('project.reveal')}>
            <Folder size={11} /> 本地工程
          </button>
          <span className="status-separator" />
          <span>{sequence.fps} fps</span>
          <span>SDR</span>
          <button onClick={() => openDialog('command')}>
            <Command size={11} />
          </button>
        </div>
      </footer>
      {draggingFile && (
        <div className="drop-overlay">
          <Upload size={34} />
          <h2>导入素材</h2>
          <p>视频、音频、图片 · 原文件保持不变</p>
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} role="status">
          {toast.error ? <AlertCircle size={15} /> : <Check size={15} />}
          <span>{toast.text}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={12} />
          </button>
        </div>
      )}
      {jobsOpen && (
        <div className="jobs-popover">
          <header>
            <b>后台作业</b>
            <IconButton label="关闭后台作业" onClick={() => setJobsOpen(false)}>
              <X size={14} />
            </IconButton>
          </header>
          {jobs.length === 0 ? (
            <div className="jobs-empty">导出、生成和分析作业会在这里显示。</div>
          ) : (
            jobs.slice(0, 12).map((j) => (
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
                <p>{j.error || j.stage}</p>
                {j.status === 'running' && (
                  <div className="job-progress">
                    <i style={{ width: `${j.progress * 100}%` }} />
                  </div>
                )}
                <div className="job-actions">
                  {j.status === 'completed' && j.output && j.type === 'export' && (
                    <>
                      <button onClick={() => void api('file.open', { jobId: j.id })}>
                        {j.output?.toLowerCase().endsWith('.png') ? '打开画面' : '打开成片'}{' '}
                        <ArrowUpRight size={11} />
                      </button>
                      <button onClick={() => void api('file.reveal', { jobId: j.id })}>
                        在 Finder 中显示
                      </button>
                    </>
                  )}
                  {j.status === 'completed' && j.result?.text && (
                    <button
                      onClick={() => {
                        setResultJob(j);
                        setResultClip(
                          sequence.clips.find(
                            (c) => c.id === selected && !!c.assetId && c.assetId === j.inputAssetId,
                          )?.id || '',
                        );
                        setJobsOpen(false);
                        setDialog('job-result');
                      }}
                    >
                      查看结果 <ArrowUpRight size={11} />
                    </button>
                  )}
                  {j.status === 'completed' &&
                    j.result?.asset &&
                    j.projectPath === env.path &&
                    project.assets.some((a) => a.id === j.result?.asset?.id) && (
                      <button
                        onClick={() =>
                          void work('添加素材', async () => {
                            await addAsset(j.result!.asset!.id);
                            setJobsOpen(false);
                          })
                        }
                      >
                        添加到时间线
                      </button>
                    )}
                  {(j.status === 'failed' || j.status === 'cancelled') &&
                    (j.remote || j.result?.asset) &&
                    !['failed', 'expired', 'canceled', 'cancelled'].includes(j.remote?.status || '') && (
                      <button
                        onClick={() => void work('继续查询', () => api('generation.resume', { id: j.id }))}
                      >
                        {j.result?.asset ? '恢复素材入库' : '继续查询原作业'}
                      </button>
                    )}
                  {j.status === 'running' && (
                    <button onClick={() => void api('jobs.cancel', { id: j.id })}>取消</button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {dialog === 'settings' && (
        <SettingsDialog
          projectDefaults={project.modelDefaults}
          onProjectDefaults={async (modelDefaults) => {
            await edit('更新项目模型默认值', [{ type: 'updateProject', changes: { modelDefaults } }]);
          }}
          settings={settings}
          initialTab={settingsTab}
          skills={boot.skills}
          onSave={refreshSettings}
          onClose={() => {
            setDialog(returnToStudio ? 'generation' : null);
            setReturnToStudio(false);
          }}
          onOpenSkills={() => void api('skills.open')}
        />
      )}
      {dialog === 'export' && (
        <ExportDialog
          sequence={sequence}
          revision={project.revision}
          onClose={() => setDialog(null)}
          onExport={async (scale, choose) => {
            const job = await api<Job | null>('export.start', { sequenceId, scale, choose });
            if (job) {
              setJobs((j) => [job, ...j.filter((x) => x.id !== job.id)]);
              setJobsOpen(true);
              notify('开始导出 v' + project.revision + '，你可以继续编辑。');
            }
          }}
        />
      )}
      {(dialog === 'new-project' || dialog === 'rename-task') && (
        <Modal
          title={dialog === 'new-project' ? '新建项目' : '重命名会话'}
          subtitle={
            dialog === 'new-project'
              ? '素材、成片、任务和版本都保存在这个工程。'
              : `共享「${project.name}」的素材与创作约定。`
          }
          onClose={() => setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const type = dialog;
              void work('正在创建', async () => {
                if (type === 'new-project')
                  await switchProject(
                    await api<ProjectEnvelope>('project.create', { name: formName.trim() || '未命名项目' }),
                  );
                else {
                  if (!task) return;
                  const t = await api<Task>('tasks.rename', { id: task.id, name: formName });
                  accept({
                    ...envRef.current!,
                    tasks: envRef.current!.tasks.map((v) => (v.id === t.id ? t : v)),
                  });
                }
                setDialog(null);
              });
            }}
          >
            <label className="field">
              <span>{dialog === 'new-project' ? '项目名称' : '会话名称'}</span>
              <input
                autoFocus
                aria-label={dialog === 'new-project' ? '项目名称' : '会话名称'}
                placeholder={dialog === 'new-project' ? '例如：一次沿海旅行' : '例如：打磨开场的节奏'}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </label>
            <footer className="modal-footer">
              <span className="help-copy">保存在本地，可随时重新打开。</span>
              <button
                className="button primary"
                type="submit"
                disabled={dialog === 'rename-task' && !formName.trim()}
              >
                {dialog === 'new-project' ? '创建' : '保存'} <ArrowUpRight size={14} />
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {dialog === 'sequence' && (
        <Modal
          title="新建成片版本"
          subtitle="复制当前成片，拥有独立的时间线和画幅。"
          onClose={() => setDialog(null)}
        >
          <label className="field">
            <span>成片名称</span>
            <input
              aria-label="成片名称"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="例如：竖屏预告"
            />
          </label>
          <label className="field">
            <span>画幅</span>
            <select aria-label="新成片画幅" value={seqFormat} onChange={(e) => setSeqFormat(e.target.value)}>
              <option>9:16</option>
              <option>16:9</option>
              <option>1:1</option>
            </select>
          </label>
          <p className="help-copy">视频与图片会按填充模式适应新画幅。你可以继续调整构图与标题位置。</p>
          <footer className="modal-footer">
            <span />
            <button
              className="button primary"
              onClick={async () => {
                const [width, height] =
                  seqFormat === '9:16' ? [1080, 1920] : seqFormat === '1:1' ? [1080, 1080] : [1920, 1080];
                const s = {
                  ...clone(sequence),
                  id: uid('seq'),
                  name:
                    formName.trim() ||
                    `${seqFormat === '9:16' ? '竖屏' : seqFormat === '1:1' ? '方形' : '横屏'}版本`,
                  width,
                  height,
                  clips: sequence.clips.map((c) => ({ ...clone(c), id: uid('clip'), locked: false })),
                };
                await edit('创建' + s.name, [{ type: 'addSequence', sequence: s }]);
                changeSequence(s.id);
                setDialog(null);
              }}
            >
              创建版本 <ArrowUpRight size={14} />
            </button>
          </footer>
        </Modal>
      )}
      {dialog === 'command' && (
        <Modal title="你想做什么？" onClose={() => setDialog(null)}>
          <div className="command-input">
            <Search size={17} />
            <input
              autoFocus
              aria-label="搜索命令"
              placeholder="搜索命令、素材或成片…"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="command-results">
            {commands
              .filter((c) => (c.name + c.detail).toLowerCase().includes(command.toLowerCase()))
              .map((c) => (
                <button
                  key={c.name}
                  onClick={() => {
                    setDialog(null);
                    c.action();
                  }}
                >
                  <span>
                    {c.name}
                    <small>{c.detail}</small>
                  </span>
                  <kbd>{c.key || <ArrowUpRight size={13} />}</kbd>
                </button>
              ))}
            {command &&
              project.assets
                .filter((a) => a.name.includes(command))
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      setDialog(null);
                      void addAsset(a.id);
                    }}
                  >
                    <span>
                      {a.name}
                      <small>添加素材到时间线</small>
                    </span>
                    <Plus size={14} />
                  </button>
                ))}
          </div>
        </Modal>
      )}
      {dialog === 'versions' && (
        <Modal
          title="每一步，都有来处。"
          subtitle="自动保存的工程版本。恢复操作本身也可以撤销。"
          onClose={() => setDialog(null)}
        >
          <div className="versions-list">
            {env.revisions.map((r) => (
              <div key={r.revision}>
                <span className="version-number">v{r.revision}</span>
                <div>
                  <b>{r.name}</b>
                  <p>
                    {r.author === 'agent' ? 'Agent' : r.author === 'you' ? '你' : 'CoCraft'} ·{' '}
                    {dateLabel(r.createdAt)}
                  </p>
                </div>
                {r.revision === project.revision ? (
                  <span className="current-label">当前</span>
                ) : (
                  <button
                    className="button tiny"
                    onClick={() =>
                      void work('恢复版本', async () => {
                        accept(await api<ProjectEnvelope>('project.restore', { revision: r.revision }));
                        setDialog(null);
                        notify('版本已恢复，可继续编辑或撤销');
                      })
                    }
                  >
                    <RotateCcw size={12} /> 恢复
                  </button>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
      {dialog === 'templates' && (
        <Modal title="动态素材库" onClose={() => setDialog(null)} className="material-shell" wide>
          <ResourceLibrary
            onAdd={addPreset}
            onGenerate={askForMotion}
            onImportPack={() => loadPack()}
            onImportExample={() => loadPack(true)}
            components={project.components}
            stockMedia={boot.studioMedia}
            onAddStock={async (id) => {
              const result = await api<{ envelope: ProjectEnvelope; clipId: string }>('studio.add', {
                id,
                sequenceId,
                projectId: project.id,
                at: frame,
              });
              accept(result.envelope);
              selectClip(result.clipId);
              setShowRight(true);
              notify('已添加到时间线');
            }}
            assets={project.assets}
            previewOrigin={boot.previewOrigin}
            onAddComponent={async (id, overrides) => {
              const component = project.components.find((c) => c.id === id);
              if (!component) return;
              const nc = {
                ...newClip('code', frame),
                componentId: id,
                name: component.name,
                props: { ...component.props, ...overrides },
                duration: Math.max(1, Math.round((component.pack?.durationSeconds || 5) * sequence.fps)),
              };
              await edit('添加' + component.name, [{ type: 'addClip', sequenceId, clip: nc }]);
              selectClip(nc.id);
              setShowRight(true);
              notify('已添加到时间线');
            }}
          />
        </Modal>
      )}
      {dialog === 'code' && (
        <CodeDialog
          component={codeComponent}
          onClose={() => setDialog(null)}
          onApply={async (c) => {
            const operations: EditOperation[] = [{ type: 'putComponent', component: c }];
            if (!codeComponent) {
              const nc = {
                ...newClip('code', frame),
                componentId: c.id,
                name: c.name,
                props: { ...c.props },
                duration: 150,
              };
              operations.push({ type: 'addClip', sequenceId, clip: nc });
              setSelected(nc.id);
            }
            await edit('应用代码画面', operations);
            setRight('inspector');
            notify('画面已编译并发布');
          }}
        />
      )}
      {dialog === 'stock' && (
        <StockDialog
          onClose={() => setDialog(null)}
          onSettings={() => openSettings('assets')}
          onImport={async (id) => {
            accept(await api<ProjectEnvelope>('stock.import', { id }));
            setNav('assets');
            notify('素材已导入项目');
          }}
        />
      )}
      {dialog === 'generation' && (
        <GenerationDialog
          settings={settings}
          project={project}
          initial={generationDraft}
          onClose={() => setDialog(null)}
          onConfigure={(draft) => {
            setGenerationDraft(draft);
            openSettings(
              settings.providers.some((p) => p.protocol !== 'system') ? 'models' : 'providers',
              true,
            );
          }}
          onStarted={(job) => {
            setDialog(null);
            setNav('assets');
            setJobs((list) => (list.some((j) => j.id === job.id) ? list : [job, ...list]));
            setJobsOpen(true);
          }}
        />
      )}
      {dialog === 'job-result' && resultJob && (
        <Modal title={resultJob.name} onClose={() => setDialog(null)}>
          <div className="result-transcript">{resultJob.result?.text}</div>
          {resultJob.result?.segments?.length && resultJob.projectPath === env.path ? (
            <div className="job-source">
              <label className="field">
                <span>字幕对齐到时间线片段</span>
                <select value={resultClip} onChange={(e) => setResultClip(e.target.value)}>
                  <option value="">选择同一来源的片段</option>
                  {sequence.clips
                    .filter((c) => c.assetId === resultJob.inputAssetId && c.assetId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {timecode(c.start, sequence.fps)}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button primary"
                disabled={!resultClip}
                onClick={() =>
                  void work('应用字幕', async () => {
                    const target = sequence.clips.find(
                      (c) => c.id === resultClip && c.assetId === resultJob.inputAssetId,
                    );
                    if (!target) return;
                    const ops: EditOperation[] = (resultJob.result?.segments || []).flatMap((segment) => {
                      const first = Math.max(target.sourceIn, Math.round(segment.start * sequence.fps)),
                        last = Math.min(
                          target.sourceIn + target.duration,
                          Math.round(segment.end * sequence.fps),
                        );
                      if (first >= last || !segment.text.trim()) return [];
                      const c = newClip('caption', target.start + first - target.sourceIn);
                      c.duration = last - first;
                      c.props.text = segment.text;
                      c.name = segment.text.slice(0, 28);
                      return [{ type: 'addClip', sequenceId, clip: c } as EditOperation];
                    });
                    if (!ops.length) throw new Error('所选片段范围内没有识别到字幕');
                    await edit('添加转录字幕', ops);
                    setDialog(null);
                    notify('已添加 ' + ops.length + ' 条字幕');
                  })
                }
              >
                添加字幕到时间线
              </button>
            </div>
          ) : null}
        </Modal>
      )}
    </div>
  );
}
const TerminalIcon = () => <Code2 size={12} />;
