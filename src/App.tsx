import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  | 'voice'
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
    [agentWidth, setAgentWidth] = useState(Number(localStorage.getItem('cc-agent-width')) || 318);
  const [prompt, setPrompt] = useState(''),
    [scope, setScope] = useState<Clip | null>(null),
    [stream, setStream] = useState<Record<string, string>>({}),
    [toolState, setToolState] = useState<Record<string, string>>({}),
    [briefDraft, setBriefDraft] = useState(''),
    [formName, setFormName] = useState(''),
    [command, setCommand] = useState(''),
    [codeComponent, setCodeComponent] = useState<CodeComponent | undefined>(),
    [voiceText, setVoiceText] = useState('沿着海岸，慢一点。把时间，交给风。'),
    [seqFormat, setSeqFormat] = useState('9:16'),
    [assetQuery, setAssetQuery] = useState('');
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
      const next = queue.current.then(async () => {
        const current = envRef.current;
        if (!current) throw new Error('工程尚未加载');
        const result = await api<ProjectEnvelope>('project.edit', {
          baseRevision: current.project.revision,
          name,
          operations,
        });
        accept(result);
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
    setBriefDraft(next.project.brief);
  };
  const openDialog = (name: Dialog) => {
    setFormName('');
    setCommand('');
    setDialog(name);
  };
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
  }, [settings?.theme]);
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
  const addBuiltin = async (kind: Clip['kind'], template = 'editorial') => {
    if (!sequence) return;
    const c = newClip(kind, frame);
    c.props.template = template;
    if (template === 'lower-third') {
      c.props.text = '人物姓名';
      c.props.subtitle = '身份 · 介绍';
      c.props.position = 'bottom';
      c.props.align = 'left';
      c.props.fontSize = 72;
    }
    if (template === 'clean') {
      c.props.text = '保持好奇，继续出发。';
      c.props.fontSize = 84;
    }
    await edit('添加' + c.name, [{ type: 'addClip', sequenceId: sequence.id, clip: c }]);
    selectClip(c.id);
    setDialog(null);
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
  const send = async () => {
    if (!prompt.trim() || !sequence || !env) return;
    if (!settings?.hasApiKey) {
      setDialog('settings');
      return;
    }
    const text = prompt.trim();
    await work('提交给 Agent', async () => {
      let currentTask = task;
      if (!currentTask) {
        currentTask = await api<Task>('tasks.create', { name: text.slice(0, 18), sequenceId: sequence.id });
        setTaskId(currentTask.id);
        accept({ ...envRef.current!, tasks: [...envRef.current!.tasks, currentTask] });
      }
      setStream((s) => ({ ...s, [currentTask!.id]: '' }));
      await api('agent.start', {
        taskId: currentTask.id,
        prompt: text,
        context: JSON.stringify({
          sequenceId: sequence.id,
          frame,
          reference: scope
            ? { clipId: scope.id, name: scope.name, start: scope.start, duration: scope.duration }
            : undefined,
        }),
      });
      setPrompt('');
    });
  };
  const commands = [
    { name: '导入素材', detail: '视频、音频、图片', key: '⌘ I', action: () => void importMedia() },
    { name: '添加标题', detail: '可编辑的动态文字', key: 'T', action: () => void addBuiltin('title') },
    { name: '添加字幕', detail: '文字与时间同步', key: '', action: () => void addBuiltin('caption') },
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
      name: '新建可编程画面',
      detail: 'React + Remotion',
      key: '',
      action: () => {
        setCodeComponent(undefined);
        setDialog('code');
      },
    },
    { name: '生成配音', detail: '使用本机 macOS 语音', key: '', action: () => setDialog('voice') },
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
    { name: '设置', detail: '模型、外观与 Skills', key: '⌘ ,', action: () => setDialog('settings') },
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
      if (name === 'settings') setDialog('settings');
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
  function resize(e: React.PointerEvent, axis: 'timeline' | 'agent') {
    e.preventDefault();
    const x = e.clientX,
      y = e.clientY,
      start = axis === 'timeline' ? timelineHeight : agentWidth;
    let value = start;
    const move = (ev: PointerEvent) => {
      value =
        axis === 'timeline'
          ? Math.max(190, Math.min(450, start + y - ev.clientY))
          : Math.max(278, Math.min(450, start + x - ev.clientX));
      axis === 'timeline' ? setTimelineHeight(value) : setAgentWidth(value);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      localStorage.setItem(axis === 'timeline' ? 'cc-timeline-height' : 'cc-agent-width', String(value));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
        <p>正在准备创作空间…</p>
      </div>
    );
  const runningJob = jobs.find((j) => j.status === 'running'),
    pendingVersion = playing && previewProject?.revision !== project.revision;
  const shownAssets = project.assets.filter((a) => a.name.toLowerCase().includes(assetQuery.toLowerCase()));
  return (
    <div
      className={`app ${!showNav ? 'nav-hidden' : ''} ${!showRight ? 'right-hidden' : ''}`}
      style={
        {
          '--agent-width': `${agentWidth}px`,
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
          <span className="brand">CoCraft</span>
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
                创作空间{' '}
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
                    <Plus size={12} /> 新任务
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
              <div className="sidebar-label">拓展创作</div>
              <button className="resource-link" onClick={() => setDialog('templates')}>
                <Type size={14} /> 内置画面与字幕 <ChevronRight size={12} />
              </button>
              <button className="resource-link" onClick={() => setDialog('stock')}>
                <Search size={14} /> 搜索 Pexels 素材 <ChevronRight size={12} />
              </button>
              <button className="resource-link" onClick={() => setDialog('voice')}>
                <Mic size={14} /> 生成本地配音 <ChevronRight size={12} />
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
            <button onClick={() => setDialog('settings')}>
              <SettingsIcon size={14} /> 设置 <kbd>⌘ ,</kbd>
            </button>
            <div className="workspace-label">
              <span className="local-dot" /> 本地工作空间 <span>0.1</span>
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
            <h1>先对齐故事，再一起创作。</h1>
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
                    <h2>下一个故事，从这里开始。</h2>
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
                      <button className="button tiny" onClick={() => void addBuiltin('caption')}>
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
          <div className="vertical-resizer" onPointerDown={(e) => resize(e, 'agent')} />
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
                  <b>{task?.name || '新的创作'}</b>
                  <small>
                    <Film size={11} />
                    {sequence.name}
                    <span>·</span>
                    {task?.status === 'running' ? '正在工作' : '随时可以开始'}
                  </small>
                </div>
                {task?.status === 'running' ? (
                  <button className="button tiny stop" onClick={() => void api('agent.stop', { taskId })}>
                    <Square size={10} fill="currentColor" /> 停止
                  </button>
                ) : (
                  <IconButton label="任务设置" onClick={() => openDialog('new-task')}>
                    <MoreHorizontal size={16} />
                  </IconButton>
                )}
              </div>
              <div className="agent-scroll">
                {(!task || task.messages.length === 0) && (
                  <div className="agent-welcome">
                    <div className="welcome-mark">
                      <Mark />
                    </div>
                    <span className="eyebrow">YOUR CREATIVE PARTNER</span>
                    <h2>
                      一起，把故事
                      <br />
                      剪出来。
                    </h2>
                    <p>
                      说说你想要的感觉。
                      <br />
                      我来剪辑、编码，打磨每一帧。
                      <br />
                      你随时接管。
                    </p>
                    <div className="prompt-suggestions">
                      {[
                        [
                          '让开头更有吸引力',
                          '帮我让开头更有吸引力，保留安静、有呼吸感的风格。先读工程和 Skill。',
                        ],
                        [
                          '做一个更好的动态片头',
                          '用 Remotion 编写一个与当前画面气质一致的动态片头，替换现有片头。保留可编辑的文案参数。',
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
                      <p>{m.text}</p>
                    </div>
                  ),
                )}
                {!!stream[taskId] && (
                  <div className="message assistant streaming">
                    <div className="assistant-label">
                      <Mark small /> CoCraft
                    </div>
                    <p>{stream[taskId]}</p>
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
                {!settings.hasApiKey && (
                  <button className="connect-hint" onClick={() => setDialog('settings')}>
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
                    <button className="model-picker" onClick={() => setDialog('settings')}>
                      <span className={settings.hasApiKey ? 'connected-dot' : 'muted-dot'} />
                      {settings.hasApiKey ? settings.model : '选择模型'}
                      <ChevronDown size={10} />
                    </button>
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
          <h2>把素材带进来。</h2>
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
            <div className="jobs-empty">导出任务会在这里显示。</div>
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
                  {j.status === 'completed' && (
                    <>
                      <button onClick={() => void api('file.open', { jobId: j.id })}>
                        打开成片 <ArrowUpRight size={11} />
                      </button>
                      <button onClick={() => void api('file.reveal', { jobId: j.id })}>
                        在 Finder 中显示
                      </button>
                    </>
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
          settings={settings}
          skills={boot.skills}
          onSave={refreshSettings}
          onClose={() => setDialog(null)}
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
      {(dialog === 'new-project' || dialog === 'new-task') && (
        <Modal
          title={dialog === 'new-project' ? '新的故事，新的空间。' : '一起完成下一次创作。'}
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
                  const t = await api<Task>('tasks.create', {
                    name: formName.trim() || '新的创作',
                    sequenceId,
                  });
                  accept({ ...envRef.current!, tasks: [...envRef.current!.tasks, t] });
                  setTaskId(t.id);
                  setRight('agent');
                }
                setDialog(null);
              });
            }}
          >
            <label className="field">
              <span>{dialog === 'new-project' ? '项目名称' : '这次想做什么？'}</span>
              <input
                autoFocus
                aria-label={dialog === 'new-project' ? '项目名称' : '任务名称'}
                placeholder={dialog === 'new-project' ? '例如：一次沿海旅行' : '例如：打磨开场的节奏'}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </label>
            <footer className="modal-footer">
              <span className="help-copy">保存在本地，可随时重新打开。</span>
              <button className="button primary" type="submit">
                创建 <ArrowUpRight size={14} />
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {dialog === 'sequence' && (
        <Modal
          title="同一个故事，更多种表达。"
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
        <Modal
          title="好画面，从一个好起点开始。"
          subtitle="内置组件完全可编辑，也可以交给 Agent 继续创作。"
          onClose={() => setDialog(null)}
          wide
        >
          <div className="template-grid">
            {[
              {
                kind: 'title',
                template: 'editorial',
                name: '叙事片头',
                tag: '文字 · 缓缓浮现',
                text: '让故事\n自然发生。',
              },
              {
                kind: 'title',
                template: 'clean',
                name: '简洁标题',
                tag: '文字 · 居中',
                text: 'Less, but better.',
              },
              {
                kind: 'title',
                template: 'lower-third',
                name: '人物介绍',
                tag: '文字 · 下三分之一',
                text: '关于那些\n认真生活的人。',
              },
              {
                kind: 'caption',
                template: 'caption',
                name: '对白字幕',
                tag: '字幕 · 易读',
                text: '每句话，都有它的位置。',
              },
              { kind: 'shape', template: 'aurora', name: '流动光晕', tag: '背景 · 按帧运动', text: '' },
              { kind: 'shape', template: 'grid', name: '动态网格', tag: '背景 · 参数化', text: '' },
            ].map((t) => (
              <button
                className={`template-card ${t.template}`}
                key={t.template}
                onClick={() => void addBuiltin(t.kind as Clip['kind'], t.template)}
              >
                <div>
                  <span>{t.text}</span>
                  {!t.text && <Layers size={24} />}
                  <i>
                    <Plus size={16} />
                  </i>
                </div>
                <b>{t.name}</b>
                <small>{t.tag}</small>
              </button>
            ))}
          </div>
          <footer className="modal-footer">
            <span className="help-copy">还有一个不受模板限制的入口。</span>
            <button
              className="button"
              onClick={() => {
                setCodeComponent(undefined);
                setDialog('code');
              }}
            >
              <Code2 size={14} /> 编写自己的画面
            </button>
          </footer>
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
          onSettings={() => setDialog('settings')}
          onImport={async (id) => {
            accept(await api<ProjectEnvelope>('stock.import', { id }));
            setNav('assets');
            notify('素材已导入项目');
          }}
        />
      )}
      {dialog === 'voice' && (
        <Modal
          title="给故事，一个声音。"
          subtitle="使用 macOS 中文语音在本机生成，无需模型密钥。"
          onClose={() => setDialog(null)}
        >
          <label className="field">
            <span>配音文稿</span>
            <textarea
              aria-label="配音文稿"
              value={voiceText}
              onChange={(e) => setVoiceText(e.target.value)}
              rows={6}
            />
          </label>
          <p className="help-copy">
            生成后的音频进入素材库，可自由剪辑与调节音量。音色取决于本机已安装的系统语音。
          </p>
          <footer className="modal-footer">
            <span className="muted">
              <Mic size={12} /> 本地生成
            </span>
            <button
              className="button primary"
              disabled={!!busy || !voiceText.trim()}
              onClick={() =>
                void work('正在生成配音', async () => {
                  accept(await api<ProjectEnvelope>('voice.generate', { text: voiceText }));
                  setDialog(null);
                  setNav('assets');
                  notify('配音已生成，可以添加到时间线');
                })
              }
            >
              {busy ? <Spinner /> : <AudioLines size={15} />} 生成配音
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
const TerminalIcon = () => <Code2 size={12} />;
