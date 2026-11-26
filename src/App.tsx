import React, { useCallback, useEffect, useRef, useState } from 'react';
import { pointerDrag } from './lib/pointerDrag';
import { PlayheadClock } from './lib/playheadClock';
import { stopAllAudioPreviews } from './components/AudioWaveformPlayer';
import { ResourceLibrary } from './components/ResourceLibrary';
import { GenerationDialog, type GenerationDraft } from './components/GenerationDialog';
import { BrandMark } from './components/BrandMark';
import { StageOverlay, type StageDomBox } from './components/StageOverlay';
import { SpatialDirectorStudio, type SpatialDirectorTarget } from './components/SpatialDirectorStudio';
import { AssetExplorer, type AssetCategory } from './components/AssetExplorer';
import { CreateCanvas } from './components/CreateCanvas';
import { StoryboardStudio } from './components/StoryboardStudio';
import { buildMentionCandidates, friendlySkillTitle, type MentionCandidate } from './core/taxonomy';
import { collectShotClipsForCompound, computeCompositeShots } from './core/storyboard';
import { selectedModel } from './core/models';
import { BUILT_IN_TRANSITIONS, createPresetClip } from './core/presets';
import { AgentPanel } from './components/AgentPanel';
import { JobsPopover } from './components/JobsPopover';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { TranscriptPanel } from './components/TranscriptPanel';
import {
  WORKSPACE_LAYOUT_PRESETS,
  dateLabel,
  detectActiveLayoutPreset,
  errorText,
  parseTimecodeInput,
  readProjectUi,
  writeProjectUi,
  type WorkspaceLayoutPresetId,
} from './lib/workbenchState';
import { Markdown } from './components/Markdown';
import {
  PanelLeft,
  PanelBottom,
  PanelRight,
  LayoutGrid,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Folder,
  Film,
  AudioLines,
  Layers,
  Settings as SettingsIcon,
  ArrowUpRight,
  Upload,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  MousePointer2,
  ScissorsLineDashed,
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
  X,
  FileText,
  GitBranch,
  Command,
  SlidersHorizontal,
  RotateCcw,
  AlertCircle,
  AlertTriangle,
  Crosshair,
  Camera,
  BookmarkPlus,
} from 'lucide-react';
import type {
  Asset,
  BootData,
  ProjectEnvelope,
  Project,
  Clip,
  EditOperation,
  EditScope,
  ProjectSummary,
  Task,
  Settings,
  Job,
  AgentEvent,
  CodeComponent,
  PreflightIssue,
  TransitionType,
  VaultItem,
  ChatContextRef,
  ComposerAttachment,
  ThinkingLevelChoice,
  SkillInfo,
} from './core/types';
import {
  clone,
  createCompoundVaultItemFromClips,
  detachAudioFromClipOperations,
  durationOf,
  inferDefaultAudioAttachMode,
  instantiateCompoundVaultItemOperations,
  newClip,
  prepareScopedComponentOperations,
  splitOperations,
  timecode,
  transcriptToCaptionClips,
  uid,
} from './core/project';
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

const PlayheadTimecode = React.memo(function PlayheadTimecode({
  clock,
  fps,
}: {
  clock: PlayheadClock;
  fps: number;
}) {
  const [f, setF] = useState(() => clock.get());
  useEffect(() => {
    setF(clock.get());
    return clock.subscribe(setF);
  }, [clock, fps]);
  return <>{timecode(f, fps)}</>;
});

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
    [selectedIds, setSelectedIds] = useState<string[]>([]),
    [frame, setFrame] = useState(0),
    [isScrubbing, setIsScrubbing] = useState(false),
    [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false),
    [previewReady, setPreviewReady] = useState(false),
    [previewProject, setPreviewProject] = useState<Project | null>(null),
    [stageBoxes, setStageBoxes] = useState<Record<string, StageDomBox>>({});
  const [appMode, setAppMode] = useState<'create' | 'edit'>('create'),
    [showBrief, setShowBrief] = useState(false),
    [mentionIndex, setMentionIndex] = useState(0),
    [showStageFork, setShowStageFork] = useState(false),
    [stageForkName, setStageForkName] = useState(''),
    [stageForkAspect, setStageForkAspect] = useState<'original' | 'portrait' | 'square'>('original'),
    [projectMenuOpen, setProjectMenuOpen] = useState(false),
    [layoutMenuOpen, setLayoutMenuOpen] = useState(false),
    [view, setView] = useState('timeline'),
    [right, setRight] = useState('inspector'),
    [showNav, setShowNav] = useState(false),
    [showBottom, setShowBottom] = useState(false),
    [showRight, setShowRight] = useState(false),
    [dialog, setDialog] = useState<Dialog>(null),
    [spatialStudio, setSpatialStudio] = useState<SpatialDirectorTarget | null>(null),
    [jobsOpen, setJobsOpen] = useState(false),
    [jobsScope, setJobsScope] = useState<'project' | 'all'>('project'),
    [editingTimecode, setEditingTimecode] = useState(false),
    [tcDraft, setTcDraft] = useState('');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null),
    [fatal, setFatal] = useState(''),
    [busy, setBusy] = useState(''),
    [zoom, setZoom] = useState(100),
    [snap, setSnap] = useState(true),
    [pinMode, setPinMode] = useState(false),
    [stagePin, setStagePin] = useState<{ x: number; y: number; frame: number } | undefined>(),
    [strictScope, setStrictScope] = useState(false),
    [personalLibrary, setPersonalLibrary] = useState<VaultItem[]>([]),
    [assetCategory, setAssetCategory] = useState<AssetCategory>('media'),
    [timelineTool, setTimelineTool] = useState<'select' | 'razor'>('select'),
    [scriptQuery, setScriptQuery] = useState(''),
    [draggingFile, setDraggingFile] = useState(false),
    [timelineHeight, setTimelineHeight] = useState(Number(localStorage.getItem('cc-timeline-height')) || 278),
    [agentWidth, setAgentWidth] = useState(Number(localStorage.getItem('cc-agent-width')) || 316),
    [navWidth, setNavWidth] = useState(Number(localStorage.getItem('cc-nav-width')) || 240);
  const [prompt, setPrompt] = useState(''),
    [scope, setScope] = useState<Clip | null>(null),
    [chatRefs, setChatRefs] = useState<ChatContextRef[]>([]),
    [stream, setStream] = useState<Record<string, string>>({}),
    [thinkingStream, setThinkingStream] = useState<Record<string, string>>({}),
    [toolState, setToolState] = useState<Record<string, string>>({}),
    [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelChoice>(
      () => (localStorage.getItem('cc-thinking-level') as ThinkingLevelChoice) || 'off',
    ),
    [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]),
    [activeComposerSkills, setActiveComposerSkills] = useState<string[]>([]),
    [openComposerMenu, setOpenComposerMenu] = useState<'session' | 'model' | 'thinking' | null>(null),
    [briefDraft, setBriefDraft] = useState(''),
    [formName, setFormName] = useState(''),
    [command, setCommand] = useState(''),
    [cmdIndex, setCmdIndex] = useState(0),
    [codeComponent, setCodeComponent] = useState<CodeComponent | undefined>(),
    [generationDraft, setGenerationDraft] = useState<GenerationDraft>({ use: 'image' }),
    [settingsTab, setSettingsTab] = useState<string | undefined>(),
    [returnToStudio, setReturnToStudio] = useState(false),
    [modelOverride, setModelOverride] = useState(''),
    [resultJob, setResultJob] = useState<Job | undefined>(),
    [resultClip, setResultClip] = useState(''),
    [seqFormat, setSeqFormat] = useState('9:16');

  const sending = useRef(false);
  const clipboardClip = useRef<Clip | null>(null);
  const savedPanesRef = useRef({ nav: true, right: true, bottom: true });
  const appRef = useRef<HTMLDivElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const playheadClockRef = useRef<PlayheadClock | null>(null);
  if (!playheadClockRef.current) playheadClockRef.current = new PlayheadClock(0);
  const previewPortRef = useRef<MessagePort | null>(null);
  const scrubRafRef = useRef<number>(0);
  const scrubLatestRef = useRef<number>(0);
  useEffect(
    () => () => {
      dragCleanup.current?.();
      clearTimeout(notifyTimer.current);
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current);
      if (previewPortRef.current) {
        previewPortRef.current.onmessage = null;
        previewPortRef.current.close();
        previewPortRef.current = null;
      }
      stopAllAudioPreviews();
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
    frameRef = useRef(0),
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

  const targetOrigin = boot?.previewOrigin ? new URL(boot.previewOrigin).origin : '*';
  const post = useCallback(
    (type: string, more: Record<string, unknown> = {}) => {
      const msg = { source: 'cocraft-workbench', type, ...more };
      if (previewPortRef.current) {
        previewPortRef.current.postMessage(msg);
      } else {
        iframe.current?.contentWindow?.postMessage(msg, targetOrigin);
      }
    },
    [targetOrigin],
  );

  const seek = useCallback(
    (n: number, options?: { scrubbing?: boolean }) => {
      const e = envRef.current;
      if (!e) return;
      const s = e.project.sequences.find((s) => s.id === sequenceId) || e.project.sequences[0];
      const f = Math.max(0, Math.min(durationOf(s) - 1, Math.round(n)));
      if (options?.scrubbing && playRef.current) {
        post('pause');
        playRef.current = false;
        setPlaying(false);
      }
      frameRef.current = f;
      playheadClockRef.current?.set(f);
      if (options?.scrubbing) {
        scrubLatestRef.current = f;
        setIsScrubbing(true);
        if (!scrubRafRef.current) {
          scrubRafRef.current = requestAnimationFrame(() => {
            scrubRafRef.current = 0;
            post('seek', { frame: scrubLatestRef.current, scrubbing: true });
          });
        }
      } else {
        if (scrubRafRef.current) {
          cancelAnimationFrame(scrubRafRef.current);
          scrubRafRef.current = 0;
        }
        setIsScrubbing(false);
        setFrame(f);
        post('seek', { frame: f, scrubbing: false });
      }
    },
    [sequenceId, post],
  );

  const endScrub = useCallback(
    (finalFrame?: number) => {
      if (scrubRafRef.current) {
        cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = 0;
      }
      const e = envRef.current;
      const s = e ? e.project.sequences.find((seq) => seq.id === sequenceId) || e.project.sequences[0] : null;
      const maxF = s ? Math.max(0, durationOf(s) - 1) : Infinity;
      const raw = finalFrame !== undefined ? Math.round(finalFrame) : frameRef.current;
      const f = Math.max(0, Math.min(maxF, raw));
      frameRef.current = f;
      playheadClockRef.current?.set(f);
      setIsScrubbing(false);
      setFrame(f);
      post('scrub-end', { frame: f });
    },
    [sequenceId, post],
  );

  const pause = useCallback(() => {
    if (scrubRafRef.current) {
      cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = 0;
    }
    post('pause');
    playRef.current = false;
    setPlaying(false);
    setIsScrubbing(false);
    setFrame(frameRef.current);
  }, [post]);

  const play = useCallback(() => {
    if (playRef.current) pause();
    else {
      stopAllAudioPreviews();
      setPinMode(false);
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
    stopAllAudioPreviews();
    accept(next);
    const savedUi = readProjectUi(next.project.id);
    const restoredSeq =
      (savedUi?.sequenceId && next.project.sequences.find((s) => s.id === savedUi.sequenceId)) ||
      next.project.sequences[0];
    setSequenceId(restoredSeq.id);
    setTaskId(next.tasks[0]?.id || '');
    setConnectingTask('');
    setStream({});
    setThinkingStream({});
    setToolState({});
    const restoredFrame =
      restoredSeq.clips.length > 0 && typeof savedUi?.frame === 'number'
        ? Math.max(0, Math.min(durationOf(restoredSeq) - 1, Math.round(savedUi.frame)))
        : 0;
    setFrame(restoredFrame);
    frameRef.current = restoredFrame;
    playheadClockRef.current?.set(restoredFrame);
    setIsScrubbing(false);
    setSelected(null);
    setSelectedIds([]);
    setScope(null);
    setChatRefs([]);
    setComposerAttachments([]);
    setActiveComposerSkills([]);
    setOpenComposerMenu(null);
    setStagePin(undefined);
    setPinMode(false);
    const hasClips = Boolean(restoredSeq?.clips.length);
    setAppMode(savedUi?.appMode || (hasClips ? 'edit' : 'create'));
    setShowNav(savedUi?.showNav ?? hasClips);
    setShowBottom(savedUi?.showBottom ?? hasClips);
    setShowRight(savedUi?.showRight ?? hasClips);
    setRight(hasClips ? 'inspector' : 'agent');
    setAssetCategory('media');
    setToast(null);
    setShowBrief(false);
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

  const openStudio = (
    useOrDraft: GenerationDraft['use'] | GenerationDraft = 'image',
    assetId?: string,
  ) => {
    if (typeof useOrDraft === 'string') {
      setGenerationDraft({ use: useOrDraft, assetId });
    } else {
      setGenerationDraft(useOrDraft);
    }
    setDialog('generation');
  };

  const openDialog = (name: Dialog) => {
    if (name === 'new-task') {
      setDialog(null);
      setTaskId('');
      setPrompt('');
      setScope(null);
      setComposerAttachments([]);
      setActiveComposerSkills([]);
      setOpenComposerMenu(null);
      setStagePin(undefined);
      setRight('agent');
      setShowRight(true);
      requestAnimationFrame(() => promptRef.current?.focus());
      return;
    }
    setFormName('');
    setCommand('');
    setCmdIndex(0);
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
    const pid = env?.project.id;
    if (!pid || !sequenceId) return;
    writeProjectUi(pid, {
      appMode,
      sequenceId,
      frame: frameRef.current,
      showNav,
      showBottom,
      showRight,
    });
  }, [env?.project.id, appMode, sequenceId, frame, showNav, showBottom, showRight]);

  useEffect(() => {
    api<BootData>('boot')
      .then((data) => {
        setBoot(data);
        setPersonalLibrary(data.globalVault || []);
        accept(data.current);
        setProjects(data.projects);
        setSettings(data.settings);
        setJobs(data.jobs);
        const savedUi = readProjectUi(data.current.project.id);
        const initialSeq =
          (savedUi?.sequenceId && data.current.project.sequences.find((s) => s.id === savedUi.sequenceId)) ||
          data.current.project.sequences[0];
        setSequenceId(initialSeq.id);
        setTaskId(data.current.tasks[0]?.id || '');
        setBriefDraft(data.current.project.brief);
        const enterEdit = Boolean(initialSeq?.clips.length);
        const restoredFrame =
          enterEdit && typeof savedUi?.frame === 'number'
            ? Math.max(0, Math.min(durationOf(initialSeq) - 1, Math.round(savedUi.frame)))
            : 0;
        setFrame(restoredFrame);
        frameRef.current = restoredFrame;
        playheadClockRef.current?.set(restoredFrame);
        setAppMode(savedUi?.appMode || (enterEdit ? 'edit' : 'create'));
        setShowNav(savedUi?.showNav ?? enterEdit);
        setShowBottom(savedUi?.showBottom ?? enterEdit);
        setShowRight(savedUi?.showRight ?? enterEdit);
        setRight(enterEdit ? 'inspector' : 'agent');
        setAssetCategory('media');
      })
      .catch((e) => setFatal(errorText(e)));
    const offProject = window.cocraft.on('project', (e: ProjectEnvelope) => accept(e));
    const offJobs = window.cocraft.on('jobs', (j: Job[]) => setJobs([...j]));
    const offSettings = window.cocraft.on('settings', (s: Settings) => setSettings(s));
    const offAgent = window.cocraft.on('agent', (e: AgentEvent) => {
      if (e.type === 'text') setStream((s) => ({ ...s, [e.taskId]: (s[e.taskId] || '') + e.text }));
      if (e.type === 'thinking')
        setThinkingStream((s) => ({ ...s, [e.taskId]: (s[e.taskId] || '') + e.text }));
      if (e.type === 'text-commit') {
        setStream((s) => ({ ...s, [e.taskId]: '' }));
        setThinkingStream((s) => ({ ...s, [e.taskId]: '' }));
      }
      if (e.type === 'tool-start') setToolState((s) => ({ ...s, [e.taskId]: e.tool || '工作中' }));
      if (e.type === 'done') {
        setStream((s) => ({ ...s, [e.taskId]: '' }));
        setThinkingStream((s) => ({ ...s, [e.taskId]: '' }));
        setToolState((s) => ({ ...s, [e.taskId]: '' }));
      }
      if (e.type === 'error') notify(e.text || 'Agent 执行失败', true);
    });
    return () => {
      offProject();
      offJobs();
      offSettings();
      offAgent();
    };
  }, []);

  useEffect(() => {
    if (!openComposerMenu && !layoutMenuOpen && !showStageFork) return;
    const onDown = (e: MouseEvent) => {
      if (
        openComposerMenu &&
        !(e.target as HTMLElement)?.closest('.agent-session-wrap, .composer-popover-anchor')
      ) {
        setOpenComposerMenu(null);
      }
      if (layoutMenuOpen && !(e.target as HTMLElement)?.closest('.layout-preset-anchor')) {
        setLayoutMenuOpen(false);
      }
      if (showStageFork && !(e.target as HTMLElement)?.closest('.branch-fork-anchor')) {
        setShowStageFork(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenComposerMenu(null);
        setLayoutMenuOpen(false);
        setShowStageFork(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [openComposerMenu, layoutMenuOpen, showStageFork]);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.glass = settings.glass ? 'on' : 'off';
    document.documentElement.dataset.glow = settings.glow || 'subtle';
    document.documentElement.dataset.glowColor = settings.glowColor || 'emerald';
    document.documentElement.dataset.motion = settings.motionEffects === false ? 'off' : 'on';
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
  }, [settings?.theme, settings?.glass, settings?.glow, settings?.glowColor, settings?.motionEffects]);

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
    if (previewReady) post('selection', { selectedClipId: selected });
  }, [selected, previewReady, post]);

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
      playheadClockRef.current?.set(0);
    }
  }, [project?.revision, project?.id, sequenceId]);

  const applyLayoutPreset = (presetId: WorkspaceLayoutPresetId) => {
    const preset = WORKSPACE_LAYOUT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setShowBrief(false);
    setAppMode('edit');
    setShowNav(preset.showNav);
    setShowBottom(preset.showBottom);
    setShowRight(preset.showRight);
    if (preset.rightTab) setRight(preset.rightTab);
    setLayoutMenuOpen(false);
    notify(`已切换布局：${preset.name}`);
  };

  const switchMode = (nextMode: 'create' | 'edit') => {
    if (nextMode === 'create') pause();
    setShowBrief(false);
    setAppMode(nextMode);
    if (nextMode === 'edit') {
      setShowBottom(true);
      // On compact laptop viewports (e.g. 1080x720), keep left explorer collapsed by default
      // so the stage + timeline keep generous breathing room (Review #19).
      setShowNav(window.innerWidth > 1140);
      setShowRight(true);
      if (task?.status !== 'running') setRight('inspector');
    } else {
      setShowBottom(false);
      setShowNav(false);
      if (task?.status !== 'running') setShowRight(false);
    }
  };

  const changeSequence = (id: string) => {
    pause();
    setSequenceId(id);
    setSelected(null);
    setSelectedIds([]);
    setScope(null);
    setStagePin(undefined);
    setShowBrief(false);
    setFrame(0);
    frameRef.current = 0;
    playheadClockRef.current?.set(0);
  };

  const selectClip = useCallback((id: string | null, additive = false) => {
    if (id === null) {
      setSelected(null);
      setSelectedIds([]);
      return;
    }
    if (additive) {
      setSelectedIds((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        setSelected((curr) =>
          curr === id && !next.includes(id) ? (next[next.length - 1] ?? null) : next.includes(id) ? id : curr,
        );
        return next;
      });
      setRight('inspector');
      return;
    }
    setSelected(id);
    setSelectedIds([id]);
    setRight('inspector');
  }, []);

  const addAsset = async (payload: string, atFrame = frameRef.current) => {
    if (!project || !sequence) return;
    if (payload.startsWith('preset:')) {
      const c = createPresetClip(payload.slice(7), atFrame, sequence.fps, {}, project);
      await edit('拖入动态组件', [{ type: 'addClip', sequenceId: sequence.id, clip: c }]);
      selectClip(c.id);
      return;
    }
    if (payload.startsWith('studio:')) {
      const res = await api<{ envelope: ProjectEnvelope; clipId: string }>('studio.add', {
        id: payload.slice(7),
        sequenceId: sequence.id,
        projectId: project.id,
        at: atFrame,
      });
      accept(res.envelope);
      selectClip(res.clipId);
      return;
    }
    if (payload.startsWith('shot:')) {
      const shId = payload.slice(5);
      const sh = computeCompositeShots(sequence).find((x) => x.id === shId);
      if (!sh) return;
      const ops: EditOperation[] = [...sh.compositeClips, ...sh.captionClips].map((orig) => ({
        type: 'addClip',
        sequenceId: sequence.id,
        clip: {
          ...clone(orig),
          id: uid('clip'),
          start: Math.max(0, atFrame + (orig.start - sh.start)),
          locked: false,
        },
      }));
      await edit(`插入分镜「镜头 ${sh.index}」副本`, ops);
      return;
    }
    if (payload.startsWith('vault:')) {
      const [, vId, varId] = payload.split(':');
      const v = (project.vault || []).find((x) => x.id === vId);
      if (!v) return;
      if (v.compound?.clips.length) {
        const { operations, primaryClipId } = instantiateCompoundVaultItemOperations(
          sequence.id,
          v,
          atFrame,
          sequence.fps,
        );
        if (operations.length) {
          await edit(`插入精剪资产「${v.name}」`, operations);
          if (primaryClipId) selectClip(primaryClipId);
        }
        return;
      }
      if (v.rig?.presetId) {
        const c = createPresetClip(v.rig.presetId, atFrame, sequence.fps, v.rig.props || {}, project);
        c.name = v.name;
        await edit(`添加「${v.name}」`, [{ type: 'addClip', sequenceId: sequence.id, clip: c }]);
        selectClip(c.id);
        return;
      }
      const vr = v.variants?.find((x) => x.id === varId) || v.variants?.[0];
      const aid = vr?.assetId || v.assetId;
      if (!aid) return;
      payload = aid;
    }
    const asset = project.assets.find((a) => a.id === payload);
    if (!asset) return;
    const dur = Math.max(1, Math.floor((asset.kind === 'image' ? 5 : asset.duration) * sequence.fps));
    const c = {
      ...newClip(asset.kind === 'model-3d' ? 'shape' : asset.kind, atFrame, asset.id),
      name: asset.name,
      duration: dur,
      ...(asset.kind === 'audio' ? { audioAttachMode: inferDefaultAudioAttachMode(asset, dur, sequence.fps) } : {}),
    };
    await edit('添加素材到时间线', [{ type: 'addClip', sequenceId: sequence.id, clip: c }]);
    selectClip(c.id);
  };

  const relinkAsset = (assetId: string) =>
    work('正在重新定位素材', async () => {
      try {
        const next = await api<ProjectEnvelope | null>('media.relink', { assetId });
        if (next) {
          accept(next);
          notify('素材已重新定位并恢复在线');
        }
      } catch (err) {
        const msg = errorText(err);
        if (msg.includes('禁止替换为不同内容') && project) {
          const unlockedExists = project.sequences.some((s) =>
            s.clips.some(
              (c) => !c.locked && (c.assetId === assetId || c.takes?.some((t) => t.assetId === assetId)),
            ),
          );
          if (
            unlockedExists &&
            window.confirm(`${msg}\n\n是否派生为新素材并仅替换未锁定的镜头？（锁定镜头保持原内容不变）`)
          ) {
            const forked = await api<ProjectEnvelope | null>('media.relink', {
              assetId,
              mode: 'fork-unlocked',
            });
            if (forked) {
              accept(forked);
              notify('已派生新素材替换未锁定镜头，锁定镜头保持原样');
            }
            return;
          }
        }
        throw err;
      }
    });

  const addPreset = async (id: string, overrides?: Record<string, unknown>) => {
    if (!sequence) return;
    const c = createPresetClip(id, frameRef.current, sequence.fps, overrides, project || undefined);
    await edit('添加' + c.name, [{ type: 'addClip', sequenceId: sequence.id, clip: c }]);
    selectClip(c.id);
    setShowRight(true);
    notify('已添加到时间线');
  };

  const addCaption = async () => {
    if (!sequence) return;
    const c = newClip('caption', frameRef.current);
    c.name = '对白字幕';
    c.props.text = '输入字幕';
    await edit('添加字幕', [{ type: 'addClip', sequenceId: sequence.id, clip: c }]);
    selectClip(c.id);
    setShowRight(true);
  };

  const applyTransitionToActiveClip = async (trId: TransitionType) => {
    if (!sequence) return;
    const curFrame = frameRef.current;
    const target =
      (clip && clip.kind !== 'audio' ? clip : undefined) ||
      sequence.clips.find(
        (c) => c.track === 'visual' && !c.locked && curFrame >= c.start && curFrame < c.start + c.duration,
      ) ||
      sequence.clips.find((c) => c.kind !== 'audio' && !c.locked);
    if (!target || target.locked) {
      notify('请先选择要应用转场的未锁定画面片段', true);
      return;
    }
    const meta = BUILT_IN_TRANSITIONS.find((t) => t.id === trId);
    const durationFrames = Math.max(
      3,
      Math.min(target.duration, Math.round((meta?.defaultSeconds || 0.6) * sequence.fps)),
    );
    await edit(`设置转场「${meta?.name || trId}」`, [
      {
        type: 'updateClip',
        sequenceId: sequence.id,
        clipId: target.id,
        changes: { transitionIn: { type: trId, durationFrames } },
      },
    ]);
    selectClip(target.id);
    notify(`已为「${target.name}」添加 ${meta?.name || trId}`);
  };

  const publishToLibrary = async (payload: {
    itemId?: string;
    assetId?: string;
    componentId?: string;
    pack?: { name: string; assetIds?: string[]; componentIds?: string[]; vaultIds?: string[] };
  }) => {
    await work('发布到个人库', async () => {
      const res = await api<{ globalVault: VaultItem[]; promoted: VaultItem }>('vault.promote', payload);
      setPersonalLibrary(res.globalVault);
      notify(`已发布「${res.promoted.name}」到个人库`);
    });
  };

  const exportMaterialPack = async (payload: {
    name: string;
    assetIds: string[];
    componentIds: string[];
    vaultIds?: string[];
  }) => {
    await work('导出素材包', async () => {
      const res = await api<{ manifest?: { name?: string }; directory?: string } | null>(
        'packs.export',
        payload,
      );
      if (res?.directory) notify(`已导出素材包「${res.manifest?.name || payload.name}」`);
    });
  };

  const saveClipsAsAsset = async (
    clipsToSave: Clip[],
    customName?: string,
    clipWindow?: { start: number; duration: number },
  ) => {
    if (!project || !sequence || !clipsToSave.length) return;
    const item = createCompoundVaultItemFromClips(project, sequence, clipsToSave, customName, clipWindow);
    await edit(`保存为项目资产「${item.name}」`, [{ type: 'putVaultItem', item }]);
    notify(`已将 ${clipsToSave.length} 个片段保存为项目资产「${item.name}」`);
  };

  const saveSelectedClipsAsAsset = async () => {
    if (!sequence) return;
    if (selectedIds.length > 1) {
      const picked = sequence.clips.filter((c) => selectedIds.includes(c.id));
      if (picked.length) await saveClipsAsAsset(picked);
      return;
    }
    if (!clip) return;
    // Review #6: When promoting a primary visual shot, capture its full stack (trims, overlays, captions, shot-attached audio)!
    const owningShot = computeCompositeShots(sequence).find(
      (sh) => sh.anchorClip.id === clip.id || (clip.track === 'visual' && sh.id === clip.id),
    );
    if (owningShot) {
      const stack = collectShotClipsForCompound(sequence, owningShot);
      await saveClipsAsAsset(stack, clip.name, { start: owningShot.start, duration: owningShot.duration });
      return;
    }
    await saveClipsAsAsset([clip]);
  };

  const addRefsToChat = useCallback((refs: ChatContextRef[], openDrawer = true) => {
    if (!refs.length) return;
    setChatRefs((prev) => {
      const map = new Map(prev.map((r) => [r.key, r]));
      for (const r of refs) map.set(r.key, r);
      return [...map.values()];
    });
    if (openDrawer) {
      setRight('agent');
      setShowRight(true);
      requestAnimationFrame(() => promptRef.current?.focus());
    }
  }, []);

  const removeChatRef = useCallback((key: string) => {
    setChatRefs((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const pullFromLibrary = async (globalId: string) => {
    await work('从个人库引入', async () => {
      const res = await api<{ envelope: ProjectEnvelope; item: VaultItem }>('vault.pull', { id: globalId });
      accept(res.envelope);
      notify(`已引入「${res.item.name}」到当前项目`);
    });
  };

  const removeFromLibrary = async (globalId: string) => {
    await work('从个人库移除', async () => {
      const next = await api<VaultItem[]>('vault.remove', { id: globalId });
      setPersonalLibrary(next);
      notify('已从个人库移除');
    });
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
        setShowNav(true);
        notify('素材已导入工程');
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
      void edit('分割片段', splitOperations(sequence, clip, frameRef.current));
    } catch (e) {
      notify(errorText(e), true);
    }
  };

  const remove = (ripple = false) => {
    if (!sequence) return;
    const targetIds = selectedIds.length > 1 ? selectedIds : clip ? [clip.id] : [];
    const unlocked = targetIds
      .map((id) => sequence.clips.find((c) => c.id === id))
      .filter((c): c is Clip => Boolean(c && !c.locked));
    if (!unlocked.length) return;
    void edit(
      unlocked.length > 1 ? `删除 ${unlocked.length} 个片段` : ripple ? '波纹删除片段' : '删除片段',
      unlocked.map((c) => ({ type: 'deleteClip', sequenceId: sequence.id, clipId: c.id, ripple })),
    );
    selectClip(null);
  };

  const reference = () => {
    if (clip) {
      setScope(clone(clip));
      setRight('agent');
      setShowRight(true);
      requestAnimationFrame(() => promptRef.current?.focus());
    }
  };

  const chatModel =
    settings &&
    (settings.models.find((m) => m.id === modelOverride && m.capabilities.includes('agent')) ||
      selectedModel(settings, 'agent', project?.modelDefaults));
  const chatProvider = settings?.providers.find((p) => p.id === chatModel?.providerId);
  const chatConnected = !!chatProvider && (!chatProvider.requiresKey || chatProvider.hasApiKey);
  const agentModels = settings?.models.filter((m) => m.capabilities.includes('agent')) || [];

  const selectAgentModel = (value: string) => {
    setOpenComposerMenu(null);
    setModelOverride(value);
    if (task) {
      void work('更新会话模型', async () => {
        try {
          const updated = await api<Task>('tasks.model', {
            id: task.id,
            modelId: value,
          });
          const current = envRef.current;
          if (current && current.project.id === project?.id)
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
  };

  const attachFilesToComposer = async (paths?: string[]) => {
    try {
      const added = await api<ComposerAttachment[] | null>('agent.attachFiles', paths ? { paths } : {});
      if (!added?.length) return;
      setComposerAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.path));
        return [...prev, ...added.filter((a) => !seen.has(a.path))];
      });
    } catch (e) {
      notify(errorText(e), true);
    }
  };

  const handleComposerPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (imgItem) {
      const blob = imgItem.getAsFile();
      if (blob) {
        e.preventDefault();
        const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          void api<ComposerAttachment>('agent.attachPaste', {
            dataBase64: dataUrl,
            mimeType: blob.type,
            ext,
            name: `剪贴板图片.${ext}`,
          })
            .then((att) => setComposerAttachments((prev) => [...prev, att]))
            .catch((err) => notify(errorText(err), true));
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
    const pastedFiles = Array.from(e.clipboardData?.files || []);
    if (pastedFiles.length) {
      const paths = window.cocraft.pathsForFiles(pastedFiles);
      if (paths.length) {
        e.preventDefault();
        void attachFilesToComposer(paths);
      }
    }
  };

  const handleComposerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.files?.length) return;
    const paths = window.cocraft.pathsForFiles(Array.from(e.dataTransfer.files));
    if (!paths.length) return;
    e.preventDefault();
    e.stopPropagation();
    void attachFilesToComposer(paths);
  };

  const applyMentionCandidate = (cand: MentionCandidate) => {
    if (cand.skillName) {
      setActiveComposerSkills((prev) => (prev.includes(cand.skillName!) ? prev : [...prev, cand.skillName!]));
      setPrompt(prompt.replace(/([@#/][^\s@#/]*)$/, '').replace(/\s+$/, ''));
    } else {
      setPrompt(prompt.replace(/([@#/][^\s@#/]*)$/, `${cand.token} `));
    }
    setMentionIndex(0);
    promptRef.current?.focus();
  };

  const send = async (promptOverride?: string, scopeClipOverride?: Clip) => {
    const rawText = (promptOverride ?? prompt).trim();
    if (sending.current || (!rawText && composerAttachments.length === 0) || !sequence || !env) return;
    const effectiveRawText = rawText || '请结合附带的参考文件协助我继续创作。';
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
    const activeScope = scopeClipOverride ?? scope;
    const attachmentsToSend = [...composerAttachments];
    const skillsToSend = [...activeComposerSkills];
    sending.current = true;
    try {
      await work('提交给 Agent', async () => {
        let targetSeq = sequence;
        let text = effectiveRawText;
        let isBranchTrial = false;

        // If user invoked /新建分支试剪, fork an experimental branch AND lock task + server scope strictly to it!
        if (text.includes('/新建分支试剪')) {
          isBranchTrial = true;
          const newSeqId = uid('seq');
          const bName = `${sequence.name}-试剪-${envRef.current?.project.sequences.length || 1}`;
          await edit(`派生实验分支「${bName}」`, [
            { type: 'forkSequenceBranch', sourceSequenceId: sequence.id, newSequenceId: newSeqId, branchName: bName },
          ]);
          const found = envRef.current?.project.sequences.find((s) => s.id === newSeqId);
          if (found) {
            targetSeq = found;
            setSequenceId(newSeqId);
          }
          text = text.replace('/新建分支试剪', '').trim() || '请在这条新建实验分支上优化剪辑节奏。';
        }

        let currentTask = task;
        if (!currentTask) {
          currentTask = await api<Task>('tasks.create', {
            modelId: modelOverride || undefined,
            name:
              text
                .replace(/^[@#/\s]+/, '')
                .replace(/\s+/g, ' ')
                .slice(0, 24) || '新创作会话',
            sequenceId: targetSeq.id,
          });
          setTaskId(currentTask.id);
          accept({ ...envRef.current!, tasks: [...envRef.current!.tasks, currentTask] });
        } else if (currentTask.sequenceId !== targetSeq.id && currentTask.status !== 'running') {
          currentTask = await api<Task>('tasks.retarget', {
            id: currentTask.id,
            sequenceId: targetSeq.id,
          });
          accept({
            ...envRef.current!,
            tasks: envRef.current!.tasks.map((t) => (t.id === currentTask!.id ? currentTask! : t)),
          });
        }
        if (currentTask.status !== 'running') setConnectingTask(currentTask.id);
        setStream((s) => ({ ...s, [currentTask!.id]: '' }));
        setThinkingStream((s) => ({ ...s, [currentTask!.id]: '' }));
        const extraClipIds = chatRefs
          .map((r) => r.clipId || (r.kind === 'clip' ? r.id : undefined))
          .filter((id): id is string => Boolean(id));
        const scopedClipIds = Array.from(
          new Set([...(activeScope ? [activeScope.id] : []), ...extraClipIds]),
        );
        const editScope: EditScope | undefined =
          isBranchTrial || activeScope || stagePin || extraClipIds.length > 0
            ? {
                sequenceId: targetSeq.id,
                clipIds: scopedClipIds.length > 0 ? scopedClipIds : undefined,
                strict: isBranchTrial || (strictScope && !!activeScope),
                pin: stagePin,
              }
            : undefined;
        await api('agent.start', {
          taskId: currentTask.id,
          prompt: text,
          modelId: chatModel?.id,
          scope: editScope,
          thinkingLevel,
          attachments: attachmentsToSend,
          skillIds: skillsToSend,
          context: JSON.stringify({
            sequenceId: targetSeq.id,
            branchName: targetSeq.branchName || targetSeq.name,
            frame: frameRef.current,
            strictScope: strictScope && !!activeScope,
            activeStyleId: project?.activeBrandId,
            reference: activeScope
              ? { clipId: activeScope.id, name: activeScope.name, start: activeScope.start, duration: activeScope.duration }
              : undefined,
            references: chatRefs.length > 0 ? chatRefs : undefined,
            pin: stagePin
              ? { xPercent: stagePin.x, yPercent: stagePin.y, frame: stagePin.frame }
              : undefined,
          }),
        });
        setPrompt((previous) => (previous.trim() === rawText ? '' : previous));
        setComposerAttachments([]);
        setActiveComposerSkills([]);
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
      key: 'T',
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
    { name: '导出成片', detail: 'MP4 · 交付预检与固定版本', key: '⌘ E', action: () => setDialog('export') },
    {
      name: '保存当前帧',
      detail: 'PNG 静帧',
      key: '',
      action: () =>
        void work('生成静帧', async () => {
          await api('export.still', { sequenceId, frame: frameRef.current });
          setJobsOpen(true);
        }),
    },
    {
      name: '打开工程文件夹',
      detail: '源码、素材、Skills 与导出',
      key: '',
      action: () => void api('project.reveal'),
    },
    ...WORKSPACE_LAYOUT_PRESETS.map((preset) => ({
      name: `布局：${preset.name}`,
      detail: preset.description,
      key: '',
      action: () => applyLayoutPreset(preset.id),
    })),
    {
      name: '切换剪辑聚焦',
      detail: '收起 / 展开两侧面板',
      key: '',
      action: () => {
        setShowNav((v) => !v);
        setShowRight((v) => !v);
      },
    },
    ...(clip && clip.kind === 'video' && clip.assetId && !clip.muted && !clip.locked
      ? [
          {
            name: '分离当前视频音画 (J/L Cut)',
            detail: '静音原视频声音并在 A1 轨生成独立音轨',
            key: '',
            action: () => {
              if (!sequence || !clip) return;
              const res = detachAudioFromClipOperations(sequence, clip);
              void edit(`分离「${clip.name}」音画 (J/L Cut)`, res.operations).then(() =>
                selectClip(res.audioClipId),
              );
            },
          },
        ]
      : []),
    { name: '设置', detail: '模型、外观与 Skills', key: '⌘ ,', action: () => openSettings() },
  ];

  // Unified shortcut executor shared by main window AND preview iframe forwarded hotkeys
  const handleShortcutRef = useRef<(k: {
    key: string;
    code: string;
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    preventDefault?: () => void;
  }) => void>(() => {});

  handleShortcutRef.current = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const lower = e.key.toLowerCase();
    if (mod && lower === 'k') {
      e.preventDefault?.();
      openDialog('command');
      return;
    }
    if (mod && e.key === ',') {
      e.preventDefault?.();
      openSettings();
      return;
    }
    if (dialog) return;
    if (mod && e.key === '1') {
      e.preventDefault?.();
      stopAllAudioPreviews();
      switchMode('create');
      return;
    }
    if (mod && e.key === '2') {
      e.preventDefault?.();
      stopAllAudioPreviews();
      switchMode('edit');
      return;
    }
    if (mod && e.key === '\\') {
      e.preventDefault?.();
      setShowNav((v) => !v);
      return;
    }
    if (mod && lower === 'j') {
      e.preventDefault?.();
      setShowBottom((v) => !v);
      return;
    }
    if (mod && lower === 'z') {
      e.preventDefault?.();
      if (e.shiftKey) void redo();
      else void undo();
      return;
    }
    if (mod && lower === 'c' && clip) {
      if (window.getSelection()?.toString()) return;
      e.preventDefault?.();
      clipboardClip.current = clone(clip);
      notify(`已复制「${clip.name}」`);
      return;
    }
    if (mod && lower === 'v' && clipboardClip.current && sequence) {
      e.preventDefault?.();
      const pasted: Clip = {
        ...clone(clipboardClip.current),
        id: uid('clip'),
        name: clipboardClip.current.name + ' · 副本',
        start: frameRef.current,
        locked: false,
      };
      void edit('粘贴片段', [{ type: 'addClip', sequenceId: sequence.id, clip: pasted }]).then(() =>
        selectClip(pasted.id),
      );
      return;
    }
    if (mod && lower === 'd' && clip && sequence) {
      e.preventDefault?.();
      const dup: Clip = {
        ...clone(clip),
        id: uid('clip'),
        name: clip.name + ' · 副本',
        start: clip.start + clip.duration,
        locked: false,
      };
      void edit('复制片段', [{ type: 'addClip', sequenceId: sequence.id, clip: dup }]).then(() =>
        selectClip(dup.id),
      );
      return;
    }
    if (e.code === 'Space' && appMode === 'edit') {
      e.preventDefault?.();
      play();
      return;
    }
    if (e.key === 'ArrowRight' && appMode === 'edit') {
      e.preventDefault?.();
      seek(frameRef.current + (e.shiftKey ? 10 : 1));
      return;
    }
    if (e.key === 'ArrowLeft' && appMode === 'edit') {
      e.preventDefault?.();
      seek(frameRef.current - (e.shiftKey ? 10 : 1));
      return;
    }
    if (mod && lower === 'b' && appMode === 'edit') {
      e.preventDefault?.();
      split();
      return;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && appMode === 'edit') {
      e.preventDefault?.();
      remove(e.shiftKey);
      return;
    }
    if (!mod && lower === 'l' && clip && sequence) {
      e.preventDefault?.();
      void edit(clip.locked ? '解锁片段' : '锁定片段', [
        { type: 'updateClip', sequenceId: sequence.id, clipId: clip.id, changes: { locked: !clip.locked } },
      ]);
      return;
    }
    if (!mod && lower === 'v' && appMode === 'edit' && view === 'timeline') {
      e.preventDefault?.();
      setTimelineTool('select');
      return;
    }
    if (!mod && lower === 'b' && appMode === 'edit' && view === 'timeline') {
      e.preventDefault?.();
      setTimelineTool('razor');
      return;
    }
    if (!mod && lower === 't' && appMode === 'edit') {
      e.preventDefault?.();
      setDialog('templates');
      return;
    }
    if (e.key === 'Escape') {
      if (selected || selectedIds.length > 0 || pinMode || jobsOpen) {
        setSelected(null);
        setSelectedIds([]);
        setPinMode(false);
        setJobsOpen(false);
      } else if (appMode === 'edit' && !showNav && !showRight && !showBottom) {
        const saved = savedPanesRef.current;
        const restoreAny = saved.nav || saved.right || saved.bottom;
        setShowNav(restoreAny ? saved.nav : true);
        setShowRight(restoreAny ? saved.right : true);
        setShowBottom(restoreAny ? saved.bottom : true);
      }
    }
  };

  useEffect(() => {
    const handlePreviewEvent = (d: any) => {
      if (!d || d.source !== 'cocraft-preview') return;
      if (d.event === 'ready') {
        setPreviewReady(true);
        const current = previewState.current;
        const p = current.project || envRef.current?.project;
        if (p && current.mediaOrigin) {
          const loadMsg = {
            source: 'cocraft-workbench',
            type: 'load',
            props: {
              project: p,
              sequenceId: p.sequences.some((s) => s.id === current.sequenceId)
                ? current.sequenceId
                : p.sequences[0].id,
              mediaOrigin: current.mediaOrigin,
            },
            frame: frameRef.current,
          };
          if (previewPortRef.current) previewPortRef.current.postMessage(loadMsg);
          else iframe.current?.contentWindow?.postMessage(loadMsg, new URL(current.mediaOrigin).origin);
        }
      }
      if (d.event === 'frame') {
        frameRef.current = d.frame;
        playheadClockRef.current?.set(d.frame);
        // Keep paused React state in sync (e.g. after clamp or initial load) so StageOverlay never desyncs.
        if (!d.playing && !playRef.current) {
          setFrame(d.frame);
        }
      }
      if (d.event === 'boxes' && d.boxes) {
        setStageBoxes(d.boxes as Record<string, StageDomBox>);
      }
      if (d.event === 'play') {
        setPlaying(true);
        playRef.current = true;
      }
      if (d.event === 'pause' || d.event === 'ended') {
        setPlaying(false);
        playRef.current = false;
        setFrame(frameRef.current);
      }
      if (d.event === 'hotkey') {
        handleShortcutRef.current(d);
      }
      if (d.event === 'error') notify('预览：' + d.message, true);
    };
    const receive = (e: MessageEvent) => {
      if (e.source !== iframe.current?.contentWindow || e.data?.source !== 'cocraft-preview') return;
      const expectedOrigin = previewState.current.mediaOrigin
        ? new URL(previewState.current.mediaOrigin).origin
        : '';
      if (expectedOrigin && e.origin !== expectedOrigin) return;
      // Only accept initial handshake over window.message; bind a private MessagePort so untrusted TSX
      // inside Film.tsx cannot spoof hotkey/state events via parent.postMessage.
      if (e.data.event === 'ready') {
        if (previewPortRef.current) {
          previewPortRef.current.onmessage = null;
          previewPortRef.current.close();
        }
        const channel = new MessageChannel();
        previewPortRef.current = channel.port1;
        channel.port1.onmessage = (pe) => handlePreviewEvent(pe.data);
        channel.port1.start();
        iframe.current?.contentWindow?.postMessage(
          { source: 'cocraft-workbench', type: 'init-channel' },
          expectedOrigin || '*',
          [channel.port2],
        );
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [notify]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [taskId, stream[taskId], env?.tasks.find((t) => t.id === taskId)?.messages.length]);

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
      if (input) return;
      handleShortcutRef.current(e);
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
        if (!(document.activeElement as HTMLElement)?.matches('input,textarea,[contenteditable]')) void undo();
      }
      if (name === 'redo') {
        if (!(document.activeElement as HTMLElement)?.matches('input,textarea,[contenteditable]')) void redo();
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
      ? appRef.current?.querySelector('.asset-explorer-wrap')?.getBoundingClientRect().width || navWidth
      : 0;
    const agentSpace = showRight
      ? appRef.current?.querySelector('.right-panel')?.getBoundingClientRect().width || agentWidth
      : 0;
    const start =
      appRef.current
        ?.querySelector(axis === 'timeline' ? '.editor-panel' : axis === 'nav' ? '.asset-explorer-wrap' : '.right-panel')
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
              : Math.max(268, Math.min(620, width - navSpace - 420, start + x - px));
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
    const min = axis === 'nav' ? 190 : axis === 'agent' ? 268 : 180;
    const value =
      e.key === 'Home'
        ? axis === 'nav'
          ? 240
          : axis === 'agent'
            ? 296
            : 278
        : Math.max(min, Math.min(max, current + (e.key === positive ? 1 : -1) * (e.shiftKey ? 48 : 12)));
    (axis === 'nav' ? setNavWidth : axis === 'agent' ? setAgentWidth : setTimelineHeight)(value);
    localStorage.setItem(
      axis === 'nav' ? 'cc-nav-width' : axis === 'agent' ? 'cc-agent-width' : 'cc-timeline-height',
      String(value),
    );
  }

  const latestActionsRef = useRef({
    addAsset,
    importMedia,
    relinkAsset,
    openStudio,
    publishToLibrary,
    pullFromLibrary,
    removeFromLibrary,
    applyTransitionToActiveClip,
    reference,
    saveSelectedClipsAsAsset,
    addStudioMedia: async (studioId: string) => {
      await work('添加音效/底板', async () => {
        if (!project || !sequence) return;
        const res = await api<{ envelope: ProjectEnvelope; clipId: string }>('studio.add', {
          id: studioId,
          sequenceId: sequence.id,
          at: frameRef.current,
          projectId: project.id,
        });
        accept(res.envelope);
        selectClip(res.clipId);
      });
    },
    openCode: () => {
      if (!project) return;
      setCodeComponent(project.components.find((c) => c.id === clip?.componentId));
      setDialog('code');
    },
  });
  latestActionsRef.current = {
    addAsset,
    importMedia,
    relinkAsset,
    openStudio,
    publishToLibrary,
    pullFromLibrary,
    removeFromLibrary,
    applyTransitionToActiveClip,
    reference,
    saveSelectedClipsAsAsset,
    addStudioMedia: async (studioId: string) => {
      await work('添加音效/底板', async () => {
        if (!project || !sequence) return;
        const res = await api<{ envelope: ProjectEnvelope; clipId: string }>('studio.add', {
          id: studioId,
          sequenceId: sequence.id,
          at: frameRef.current,
          projectId: project.id,
        });
        accept(res.envelope);
        selectClip(res.clipId);
      });
    },
    openCode: () => {
      if (!project) return;
      setCodeComponent(project.components.find((c) => c.id === clip?.componentId));
      setDialog('code');
    },
  };

  const getPlayheadCb = useCallback(() => frameRef.current, []);
  const editVoidCb = useCallback((n: string, o: EditOperation[]) => {
    void edit(n, o);
  }, [edit]);
  const editPromiseCb = useCallback((n: string, o: EditOperation[]) => edit(n, o).then(() => {}), [edit]);
  const clearSelectCb = useCallback(() => selectClip(null), [selectClip]);
  const handleLiveTransformCb = useCallback(
    (override: { clipId: string; props: Record<string, unknown> } | null) => post('live-transform', { override }),
    [post],
  );
  const importMediaCb = useCallback(() => void latestActionsRef.current.importMedia(), []);
  const relinkCb = useCallback((id: string) => void latestActionsRef.current.relinkAsset(id), []);
  const openStudioCb = useCallback(
    (use: 'image' | 'video' | 'speech' | 'transcription', assetId?: string) =>
      latestActionsRef.current.openStudio(use, assetId),
    [],
  );
  const publishCb = useCallback(
    (payload: {
      itemId?: string;
      assetId?: string;
      componentId?: string;
      pack?: { name: string; assetIds?: string[]; componentIds?: string[]; vaultIds?: string[] };
    }) => latestActionsRef.current.publishToLibrary(payload),
    [],
  );
  const pullCb = useCallback((id: string) => latestActionsRef.current.pullFromLibrary(id), []);
  const removeLibCb = useCallback((id: string) => latestActionsRef.current.removeFromLibrary(id), []);
  const addTransitionCb = useCallback(
    (trId: TransitionType) => latestActionsRef.current.applyTransitionToActiveClip(trId),
    [],
  );
  const addStudioCb = useCallback((studioId: string) => latestActionsRef.current.addStudioMedia(studioId), []);
  const addAssetCb = useCallback((id: string, f: number) => void latestActionsRef.current.addAsset(id, f), []);
  const referenceCb = useCallback(() => latestActionsRef.current.reference(), []);
  const saveSelectedClipsAsAssetCb = useCallback(
    () => void latestActionsRef.current.saveSelectedClipsAsAsset(),
    [],
  );
  const openCodeCb = useCallback(() => latestActionsRef.current.openCode(), []);

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
  const offlineCount = env.offlineAssetIds?.length || 0;
  const transcribedAssets = project.assets.filter((a) => a.transcript?.text);

  const filteredCommands = [
    ...commands
      .filter((c) => (c.name + c.detail).toLowerCase().includes(command.toLowerCase()))
      .map((c) => ({ id: 'cmd:' + c.name, name: c.name, detail: c.detail, key: c.key, run: c.action })),
    ...(command
      ? project.assets
          .filter((a) => a.name.toLowerCase().includes(command.toLowerCase()))
          .map((a) => ({
            id: 'asset:' + a.id,
            name: a.name,
            detail: '添加素材到时间线',
            key: '+',
            run: () => void addAsset(a.id),
          }))
      : []),
  ];

  const renderAgentPanel = () => (
    <AgentPanel
      project={project}
      sequence={sequence}
      sequenceId={sequenceId}
      tasks={env.tasks}
      task={task}
      taskId={taskId}
      connectingTask={connectingTask}
      skills={boot.skills}
      settings={settings}
      agentModels={agentModels}
      chatModel={chatModel}
      chatConnected={chatConnected}
      thinkingLevel={thinkingLevel}
      streamText={stream[taskId] || ''}
      thinkingStreamText={thinkingStream[taskId] || ''}
      toolStatus={toolState[taskId] || ''}
      prompt={prompt}
      promptRef={promptRef}
      messagesEndRef={messagesEnd}
      mentionIndex={mentionIndex}
      openComposerMenu={openComposerMenu}
      scope={scope}
      strictScope={strictScope}
      stagePin={stagePin}
      chatRefs={chatRefs}
      activeComposerSkills={activeComposerSkills}
      composerAttachments={composerAttachments}
      onSetOpenComposerMenu={setOpenComposerMenu}
      onNewTask={() => openDialog('new-task')}
      onSelectTask={(t) => {
        setTaskId(t.id);
        if (t.sequenceId !== sequenceId) changeSequence(t.sequenceId);
      }}
      onRenameTask={(t) => {
        setTaskId(t.id);
        setFormName(t.name);
        setDialog('rename-task');
      }}
      onDeleteTask={(t) => {
        void work('删除会话', async () => {
          const next = await api<ProjectEnvelope>('tasks.delete', { id: t.id });
          accept(next);
          if (taskId === t.id) setTaskId(next.tasks[0]?.id || '');
        });
      }}
      onStopAgent={() => void api('agent.stop', { taskId })}
      onSetPrompt={setPrompt}
      onSetMentionIndex={setMentionIndex}
      onApplyMentionCandidate={applyMentionCandidate}
      onSeekTimecode={(sec) => {
        pause();
        seek(Math.round(sec * sequence.fps));
      }}
      onOpenSettings={openSettings}
      onComposerDrop={handleComposerDrop}
      onComposerPaste={handleComposerPaste}
      onRemoveComposerSkill={(sk) =>
        setActiveComposerSkills((prev) => prev.filter((x) => x !== sk))
      }
      onToggleStrictScope={() => setStrictScope((v) => !v)}
      onClearScope={() => setScope(null)}
      onClearStagePin={() => setStagePin(undefined)}
      onRemoveChatRef={removeChatRef}
      onRemoveAttachment={(id) =>
        setComposerAttachments((prev) => prev.filter((x) => x.id !== id))
      }
      onAttachFiles={() => void attachFilesToComposer()}
      onSelectModel={selectAgentModel}
      onSelectThinkingLevel={(level) => {
        setThinkingLevel(level);
        localStorage.setItem('cc-thinking-level', level);
        setOpenComposerMenu(null);
      }}
      onSend={() => void send()}
    />
  );

  return (
    <div
      ref={appRef}
      className={`app ide-shell mode-${appMode} ${!showNav ? 'nav-hidden' : ''} ${!showRight ? 'right-hidden' : ''}`}
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
            setShowNav(true);
            notify('素材已导入工程');
          });
        }
      }}
    >
      {/* Unified 38px Monochrome IDE Titlebar */}
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
                    openDialog('new-project');
                  }}
                >
                  <Plus size={12} /> 新建空白工程…
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProjectMenuOpen(false);
                    void work('打开工程', async () => {
                      const e = await api<ProjectEnvelope | null>('project.open');
                      if (e) await switchProject(e);
                    });
                  }}
                >
                  <FolderOpen size={12} /> 打开本地工程…
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProjectMenuOpen(false);
                    setBriefDraft(project.brief);
                    setShowBrief((v) => !v);
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
                      if (p.id !== project.id) {
                        void work('切换工程', async () => {
                          await switchProject(await api<ProjectEnvelope>('project.open', { path: p.path }));
                        });
                      }
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

          {/* Film Branch Switcher & Fork */}
          <div className="branch-bar compact">
            <GitBranch size={11} />
            <select
              aria-label="当前成片分支"
              value={sequence.id}
              onChange={(e) => changeSequence(e.target.value)}
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
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const newId = uid('seq');
                    const bName =
                      stageForkName.trim() ||
                      (stageForkAspect === 'portrait'
                        ? '竖屏 9:16'
                        : stageForkAspect === 'square'
                          ? '方形 1:1'
                          : `${sequence.name}-试剪${project.sequences.length}`);
                    const wantPortrait = stageForkAspect === 'portrait' || /9\s*[:：]\s*16|竖屏/.test(bName);
                    const wantSquare = stageForkAspect === 'square' || /1\s*[:：]\s*1|方形/.test(bName);
                    if (wantPortrait || wantSquare) {
                      const targetW = 1080;
                      const targetH = wantPortrait ? 1920 : 1080;
                      await work(`智能重排画幅「${bName}」`, async () => {
                        const res = await api<{
                          envelope: ProjectEnvelope;
                          sequenceId: string;
                          focalCount: number;
                          provider: string;
                        }>('system1.autoReframeBranch', {
                          sequenceId: sequence.id,
                          newSequenceId: newId,
                          branchName: bName,
                          width: targetW,
                          height: targetH,
                        });
                        accept(res.envelope);
                        notify(
                          `已派生 ${targetW}×${targetH} 智能重排分支「${bName}」${res.focalCount > 0 ? `（${res.provider} 已锁 ${res.focalCount} 镜主体焦点）` : '（本地免费构图 + 字幕安全区已适配）'}`,
                        );
                      });
                    } else {
                      await edit(`派生平行分支「${bName}」`, [
                        {
                          type: 'forkSequenceBranch',
                          sourceSequenceId: sequence.id,
                          newSequenceId: newId,
                          branchName: bName,
                        },
                      ]);
                    }
                    setStageForkName('');
                    setStageForkAspect('original');
                    setShowStageFork(false);
                    changeSequence(newId);
                  }}
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
                          void edit(`将「${sequence.name}」设为主干`, [
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

          <button className="version-chip-btn" onClick={() => setDialog('versions')} title="版本历史与历史派生">
            v{project.revision}
          </button>

          {offlineCount > 0 && (
            <button
              className="offline-pill"
              onClick={() => setShowNav(true)}
              title="部分源媒体文件离线，点击展开资产栏重连"
            >
              <AlertTriangle size={11} /> {offlineCount} 离线
            </button>
          )}
        </div>

        {/* Top-Center Dual-Mode Switch: [ 创造 | 剪辑 ] */}
        <div className="top-mode-capsule" role="tablist" aria-label="核心工作模式">
          <button
            type="button"
            role="tab"
            aria-selected={appMode === 'create' && !showBrief}
            className={appMode === 'create' && !showBrief ? 'active' : ''}
            onClick={() => switchMode('create')}
          >
            创造
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={appMode === 'edit' && !showBrief}
            className={appMode === 'edit' && !showBrief ? 'active' : ''}
            onClick={() => switchMode('edit')}
          >
            剪辑
          </button>
        </div>

        {/* Top-Right IDE Pane Toggles (Left Explorer / Bottom Timeline / Right Agent / Search / Settings / Export) */}
        <div className="titlebar-right ide-toggles">
          <div className="ide-pane-group" role="group" aria-label="面板布局控制">
            <button
              type="button"
              className={`ide-pane-btn ${showNav ? 'active' : ''}`}
              aria-label="切换左侧资产栏"
              title="展开或折叠左侧资产列表 (⌘\)"
              onClick={() => setShowNav((v) => !v)}
            >
              <PanelLeft size={14} />
            </button>
            {appMode === 'edit' && (
              <button
                type="button"
                className={`ide-pane-btn ${showBottom ? 'active' : ''}`}
                aria-label="切换底部时间线"
                title="展开或折叠底部时间线面板 (⌘J)"
                onClick={() => setShowBottom((v) => !v)}
              >
                <PanelBottom size={14} />
              </button>
            )}
            <button
              type="button"
              className={`ide-pane-btn ${showRight ? 'active' : ''}`}
              aria-label="切换右侧协作栏"
              title="展开或折叠右侧 Agent / 属性面板"
              onClick={() => setShowRight((v) => !v)}
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
                        rightTab: right,
                      });
                      const isActive = activePreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isActive}
                          className={isActive ? 'active' : ''}
                          onClick={() => applyLayoutPreset(preset.id)}
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

          <IconButton label="快速命令与搜索 ⌘K" onClick={() => openDialog('command')}>
            <Search size={14} />
          </IconButton>
          <IconButton label="设置 ⌘," onClick={() => openSettings()}>
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
          <button className="export-button" onClick={() => setDialog('export')}>
            导出
          </button>
        </div>
      </header>

      {/* Collapsible Left Asset & Shot Explorer (shared across Create & Edit!) */}
      {showNav && (
        <div className="asset-explorer-wrap">
          <AssetExplorer
            project={project}
            sequence={sequence}
            getPlayheadFrame={getPlayheadCb}
            previewOrigin={boot.previewOrigin}
            personalLibrary={personalLibrary}
            studioMedia={boot.studioMedia}
            activeCategory={assetCategory}
            onCategoryChange={setAssetCategory}
            onSelectClip={selectClip}
            onSeek={seek}
            onImportMedia={importMediaCb}
            onRelinkAsset={relinkCb}
            onOpenGeneration={openStudioCb}
            onEdit={editPromiseCb}
            onPublishToLibrary={publishCb}
            onPullFromLibrary={pullCb}
            onRemoveFromLibrary={removeLibCb}
            onAddTransition={addTransitionCb}
            onAddStudioMedia={addStudioCb}
            onAddRefsToChat={addRefsToChat}
            onOpenTemplateLibrary={() => setDialog('templates')}
          />
          <div
            className="vertical-resizer left-resizer"
            role="separator"
            aria-label="调整左侧资产栏宽度"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuenow={navWidth}
            onKeyDown={(e) => keyboardResize(e, 'nav')}
            onPointerDown={(e) => resize(e, 'nav')}
          />
        </div>
      )}

      <main className="workbench">
        {/* Project Brief Drawer */}
        {showBrief ? (
          <div className="brief-page">
            <div className="eyebrow">PROJECT BRIEF</div>
            <h1>创作约定</h1>
            <p>这里的约定会进入每个 Agent 任务。写下目标、受众、节奏与保留细节。</p>
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
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="button" onClick={() => setShowBrief(false)}>
                  返回
                </button>
                <button
                  className="button primary"
                  onClick={() =>
                    void work('保存约定', async () => {
                      await edit('更新创作约定', [{ type: 'updateProject', changes: { brief: briefDraft } }]);
                      setShowBrief(false);
                      notify('创作约定已保存');
                    })
                  }
                >
                  <Check size={14} /> 保存
                </button>
              </div>
            </footer>
          </div>
        ) : (
          <div className="stage-and-storyboard-host">
            {/* Mode 1: Infinite Creation Canvas (Nodes + Bezier Wires + Storyboard Sequence) */}
            {appMode === 'create' && (
              <CreateCanvas
                key={project.id}
                project={project}
                sequence={sequence}
                selectedClipId={selected}
                previewOrigin={boot.previewOrigin}
                modalOpen={Boolean(dialog)}
                leftOpen={showNav}
                rightOpen={showRight}
                rightAgentOpen={showRight && right === 'agent'}
                aiBusy={Boolean(runningJob || task?.status === 'running' || connectingTask)}
                floatingPrompt={prompt}
                onFloatingPromptChange={setPrompt}
                onFloatingSubmit={() => void send()}
                onToggleLeft={() => setShowNav((v) => !v)}
                onToggleRightAgent={() => {
                  setRight('agent');
                  setShowRight((v) => !v);
                }}
                onSelectClip={selectClip}
                onSeek={seek}
                onSwitchToEdit={() => switchMode('edit')}
                onImportMedia={() => void importMedia()}
                onEdit={(n, ops) => edit(n, ops).then(() => {})}
                onUndo={() => void undo()}
                onRedo={() => void redo()}
                canUndo={env.canUndo}
                canRedo={env.canRedo}
                onPublishToLibrary={publishToLibrary}
                onExportMaterialPack={exportMaterialPack}
                onSaveClipsAsAsset={saveClipsAsAsset}
                onAddRefsToChat={addRefsToChat}
                chatRefs={chatRefs}
                onRemoveChatRef={removeChatRef}
                onSendCanvasInstruction={(instruction, scopeClip) => {
                  if (scopeClip) setScope(clone(scopeClip));
                  setRight('agent');
                  setShowRight(true);
                  void send(instruction, scopeClip);
                }}
                onOpenGeneration={(opts) => openStudio(opts)}
                jobs={jobs}
                settings={settings}
                onCancelJob={(jobId) => void api('jobs.cancel', { id: jobId })}
                onJobsStarted={(started) => {
                  setJobs((list) => {
                    const next = [...list];
                    for (const j of started) {
                      if (!next.some((x) => x.id === j.id)) next.unshift(j);
                    }
                    return next;
                  });
                }}
                onExtractVideoFrame={async (assetId, mode, placement) => {
                  return await work(`抽取视频${mode === 'last' ? '尾帧' : '首帧'}`, async () => {
                    const res = await api<{ envelope: ProjectEnvelope; asset: Asset }>('asset.extractFrame', {
                      assetId,
                      mode,
                      placement,
                    });
                    accept(res.envelope);
                    notify(`已抽取新图片资产「${res.asset.name}」`);
                    return res.asset;
                  });
                }}
                onDetachVideoAudio={async (assetId, placement) => {
                  await work('提取视频音轨', async () => {
                    const res = await api<{ envelope: ProjectEnvelope; asset: Asset }>('asset.detachAudio', {
                      assetId,
                      placement,
                    });
                    accept(res.envelope);
                    notify(`已提取音轨「${res.asset.name}」`);
                  });
                }}
                onNormalizeAudio={async (assetId, placement) => {
                  await work('响度标准化 (-14 LUFS)', async () => {
                    const res = await api<{ envelope: ProjectEnvelope; asset: Asset }>('asset.normalizeAudio', {
                      assetId,
                      placement,
                    });
                    accept(res.envelope);
                    notify(`已完成响度标准化「${res.asset.name}」`);
                  });
                }}
                onTrimAudioSilence={async (assetId, placement) => {
                  await work('自动去除气口静音', async () => {
                    const res = await api<{
                      envelope: ProjectEnvelope;
                      asset: Asset;
                      removedSeconds: number;
                    }>('asset.trimSilence', {
                      assetId,
                      placement,
                    });
                    accept(res.envelope);
                    notify(`已裁去 ${res.removedSeconds.toFixed(1)}s 静音气口，生成「${res.asset.name}」`);
                  });
                }}
                onVisionDescribeAsset={async (assetId, placement) => {
                  await work('反推画面视觉提示词', async () => {
                    const res = await api<{ envelope: ProjectEnvelope; vaultItem: VaultItem }>(
                      'asset.visionDescribe',
                      { assetId, placement },
                    );
                    accept(res.envelope);
                    notify(`已生成可编辑提示词卡「${res.vaultItem.name}」`);
                  });
                }}
                onTriageAssets={async (assetIds) => {
                  await work('候选图质检挑优', async () => {
                    const res = await api<{
                      envelope: ProjectEnvelope;
                      provider: string;
                      fallbackNotice?: string;
                    }>('system1.triageAssets', { assetIds });
                    accept(res.envelope);
                    notify(
                      res.fallbackNotice ||
                        `已完成 ${assetIds.length} 张候选图质检挑优并标星推荐（${res.provider === 'local' ? '本地免费' : res.provider}）`,
                    );
                  });
                }}
                onAutoTagAssets={async (assetIds) => {
                  await work('素材智能标角色', async () => {
                    const res = await api<{ envelope: ProjectEnvelope; provider: string }>(
                      'system1.autoTagAssets',
                      { assetIds },
                    );
                    accept(res.envelope);
                    notify(
                      `已为 ${assetIds.length} 项素材完成角色归类（${res.provider === 'local' ? '本地免费' : res.provider}）`,
                    );
                  });
                }}
                onAutoReframeVertical={async () => {
                  const newId = uid('seq');
                  await work('派生 9:16 竖屏重排分支', async () => {
                    const res = await api<{
                      envelope: ProjectEnvelope;
                      sequenceId: string;
                      focalCount: number;
                      provider: string;
                    }>('system1.autoReframeBranch', {
                      sequenceId: sequence.id,
                      newSequenceId: newId,
                      branchName: '竖屏 9:16',
                      width: 1080,
                      height: 1920,
                    });
                    accept(res.envelope);
                    changeSequence(res.sequenceId);
                    notify(
                      `已派生 9:16 竖屏分支${res.focalCount > 0 ? `（${res.provider} 已锁 ${res.focalCount} 镜主体）` : '（本地免费智能重排）'}`,
                    );
                  });
                }}
                onBakeSpatialVideo={async (opts) => {
                  let created: Asset | undefined;
                  await work('录制 3D 预演视频', async () => {
                    const res = await api<{ envelope: ProjectEnvelope; asset: Asset }>(
                      'stage.bakeSpatialVideo',
                      { sequenceId: sequence.id, ...opts },
                    );
                    accept(res.envelope);
                    created = res.asset;
                    notify(`已录制 3D 预演视频「${res.asset.name}」，已接入画布并可用于动作迁移/参考生视频`);
                  });
                  return created;
                }}
                onCaptureSpatialPair={async (opts) => {
                  let pair: { startAsset: Asset; endAsset: Asset } | undefined;
                  await work('双拍 A→B 空间首尾机位帧', async () => {
                    const res = await api<{
                      envelope: ProjectEnvelope;
                      startAsset: Asset;
                      endAsset: Asset;
                    }>('stage.captureSpatialPair', { sequenceId: sequence.id, ...opts });
                    accept(res.envelope);
                    pair = { startAsset: res.startAsset, endAsset: res.endAsset };
                    notify('已拍下 A机→B机 首尾透视帧，已连入首尾帧生视频工坊');
                  });
                  return pair;
                }}
                onCaptureSpatialReference={async (opts) => {
                  let captured: { asset?: Asset; captured?: { pass: string; asset: Asset }[] } | undefined;
                  await work('拍摄空间机位与深度图', async () => {
                    const res = await api<{
                      envelope: ProjectEnvelope;
                      asset?: Asset;
                      captured?: { pass: string; asset: Asset }[];
                    }>('stage.captureReference', { sequenceId: sequence.id, ...opts });
                    accept(res.envelope);
                    captured = { asset: res.asset, captured: res.captured };
                    notify(`已捕获 ${res.captured?.length || 1} 通道空间参考图，已接入 AI 生图工坊`);
                  });
                  return captured;
                }}
                onOpenSpatialDirector={(t) => {
                  pause();
                  setSpatialStudio(t);
                }}
                onAskAgentForShot={(shotClip, draftPrompt) => {
                  setScope(clone(shotClip));
                  setStrictScope(true);
                  setPrompt(draftPrompt);
                  setRight('agent');
                  setShowRight(true);
                  requestAnimationFrame(() => promptRef.current?.focus());
                }}
              />
            )}

            {/* Mode 2: Precision Edit Stage (kept mounted with display:none in Create mode for instant zero-flicker toggle) */}
            <div className="viewer-bar" style={appMode !== 'edit' ? { display: 'none' } : undefined}>
              <div className="breadcrumbs">
                <span className="dim-meta">
                  {sequence.width} × {sequence.height} · {sequence.fps} fps
                </span>
              </div>
              <div className="viewer-actions">
                <IconButton
                  label="捕获当前画面为参考图资产"
                  disabled={playing || sequence.clips.length === 0}
                  onClick={() =>
                    void work('捕获参考帧', async () => {
                      const res = await api<{ envelope: ProjectEnvelope; asset: { id: string; name: string } }>(
                        'stage.captureReference',
                        { sequenceId: sequence.id, frame: frameRef.current },
                      );
                      accept(res.envelope);
                      notify(`已存参考图「${res.asset.name}」`);
                    })
                  }
                >
                  <Camera size={14} />
                </IconButton>
                <IconButton
                  label="画面打点引用给 Agent"
                  active={pinMode}
                  disabled={playing || sequence.clips.length === 0}
                  onClick={() => {
                    pause();
                    setPinMode((v) => !v);
                  }}
                >
                  <Crosshair size={14} />
                </IconButton>
                <span className="toolbar-divider" />
                <IconButton label="撤销 ⌘Z" disabled={!env.canUndo} onClick={() => void undo()}>
                  <Undo2 size={14} />
                </IconButton>
                <IconButton label="重做 ⇧⌘Z" disabled={!env.canRedo} onClick={() => void redo()}>
                  <Redo2 size={14} />
                </IconButton>
              </div>
            </div>

            <div
              className="viewer-area"
              style={appMode !== 'edit' ? { display: 'none' } : undefined}
              onClick={(e) => {
                if (e.target === e.currentTarget) selectClip(null);
              }}
            >
              <div className="preview-canvas">
                <iframe
                  ref={iframe}
                  src={boot.previewOrigin + '/ui/preview.html'}
                  title="成片预览"
                  sandbox="allow-scripts allow-same-origin"
                  allow="autoplay"
                />
                <StageOverlay
                  project={project}
                  sequence={sequence}
                  frame={frame}
                  playing={playing}
                  scrubbing={isScrubbing}
                  visible={appMode === 'edit'}
                  selectedId={selected}
                  pinMode={pinMode}
                  activePin={stagePin}
                  domBoxes={stageBoxes}
                  onLiveTransform={handleLiveTransformCb}
                  onSelect={selectClip}
                  onEdit={editVoidCb}
                  onCaptureSpatialMultiPass={(targetClip) =>
                    void work(
                      targetClip.kind === 'code' ? '拍摄当前组件参考帧' : '捕获 3 通道空间参考',
                      async () => {
                        const res = await api<{
                          envelope: ProjectEnvelope;
                          captured?: { pass: string; asset: { id: string; name: string } }[];
                        }>('stage.captureReference', {
                          sequenceId: sequence.id,
                          clipId: targetClip.id,
                          frame: Math.max(0, frameRef.current - targetClip.start),
                          passes: targetClip.kind === 'code' ? ['beauty'] : ['beauty', 'depth', 'normal'],
                        });
                        accept(res.envelope);
                        const count = res.captured?.length || 1;
                        notify(
                          targetClip.kind === 'code'
                            ? '已拍下当前 3D 画面参考帧并送入「创造」画布，可直接连线 AI 重绘'
                            : `已捕获 ${count} 通道空间参考（构图 + 深度图 Depth + 法线图 Normal），已送入画布资产库`,
                        );
                      },
                    )
                  }
                  onCaptureSpatialPair={(targetClip) =>
                    void work('拍摄开场/收尾两帧', async () => {
                      const res = await api<{ envelope: ProjectEnvelope; startAsset: Asset; endAsset: Asset }>(
                        'stage.captureSpatialPair',
                        { sequenceId: sequence.id, clipId: targetClip.id },
                      );
                      accept(res.envelope);
                      notify('已拍下开场与收尾两帧送入「创造」画布，可直接选中做首尾帧生视频');
                    })
                  }
                  onDirectClipWithAgent={(targetClip) => {
                    setScope(clone(targetClip));
                    setRight('agent');
                    setShowRight(true);
                    setPrompt(`请帮我调度「${targetClip.name}」的3D摄像机运镜、视角走线或光影氛围：`);
                    requestAnimationFrame(() => promptRef.current?.focus());
                  }}
                  onOpenSpatialDirector={(targetClip) => {
                    pause();
                    setSpatialStudio({ kind: 'clip', sequenceId: sequence.id, clipId: targetClip.id });
                  }}
                  onBakeSpatialVideo={(targetClip) =>
                    void work('录制 3D 预演视频', async () => {
                      const res = await api<{ envelope: ProjectEnvelope; asset: Asset }>(
                        'stage.bakeSpatialVideo',
                        {
                          sequenceId: sequence.id,
                          clipId: targetClip.id,
                          durationSeconds: Math.max(2, Math.min(5, targetClip.duration / Math.max(1, sequence.fps))),
                          pass: String(targetClip.props.renderPass || 'beauty'),
                        },
                      );
                      accept(res.envelope);
                      notify(`已录制 3D 预演视频「${res.asset.name}」，切换「创造」画布即可连线做动作迁移/参考生视频`);
                    })
                  }
                  onSpawnCameraShot={(targetClip) => {
                    const tail = sequence.clips.length
                      ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
                      : 0;
                    const clonedClip: Clip = {
                      ...clone(targetClip),
                      id: uid('clip'),
                      name: `${targetClip.name} · 机位 ${Math.round(Number(targetClip.props.cameraLens ?? 35))}mm`,
                      start: tail,
                      locked: false,
                    };
                    void edit(`以当前机位新添一镜「${clonedClip.name}」`, [
                      { type: 'addClip', sequenceId: sequence.id, clip: clonedClip },
                    ]).then(() => {
                      selectClip(clonedClip.id);
                      seek(tail);
                    });
                  }}
                  onPin={({ x, y, frame: pinFrame, clipId }) => {
                    setStagePin({ x, y, frame: pinFrame });
                    setPinMode(false);
                    if (clipId) {
                      const hit = sequence.clips.find((c) => c.id === clipId);
                      if (hit) setScope(clone(hit));
                      setSelected(clipId);
                    }
                    setRight('agent');
                    setShowRight(true);
                    requestAnimationFrame(() => promptRef.current?.focus());
                    notify(`已标记画面坐标 (${x}%, ${y}%)`);
                  }}
                />
                {sequence.clips.length === 0 && (
                  <div className="empty-canvas">
                    <h2>时间线为空</h2>
                    <p>
                      {project.assets.length > 0
                        ? `项目素材库已有 ${project.assets.length} 个素材，可直接加入主片或继续导入。`
                        : '从左侧导入媒体，或切换至「创造」画布拆解分镜。'}
                    </p>
                    <div>
                      {project.assets.length > 0 && (
                        <button
                          className="button primary"
                          onClick={() => {
                            let vCursor = 0;
                            let aCursor = 0;
                            const ops: EditOperation[] = [];
                            let firstId: string | undefined;
                            for (const a of project.assets) {
                              const dur = Math.max(
                                1,
                                Math.floor((a.kind === 'image' ? 5 : a.duration) * sequence.fps),
                              );
                              const isAudio = a.kind === 'audio';
                              const c: Clip = {
                                ...newClip(a.kind === 'model-3d' ? 'shape' : a.kind, isAudio ? aCursor : vCursor, a.id),
                                name: a.name,
                                duration: dur,
                                ...(isAudio
                                  ? { audioAttachMode: inferDefaultAudioAttachMode(a, dur, sequence.fps) }
                                  : {}),
                              };
                              if (!firstId) firstId = c.id;
                              ops.push({ type: 'addClip', sequenceId: sequence.id, clip: c });
                              if (isAudio) aCursor += dur;
                              else vCursor += dur;
                            }
                            if (ops.length) {
                              void edit('将已有素材加入主片', ops).then(() => {
                                if (firstId) selectClip(firstId);
                              });
                            }
                          }}
                        >
                          <Plus size={13} /> 将已有素材加入主片 ({project.assets.length})
                        </button>
                      )}
                      <button
                        className={`button ${project.assets.length === 0 ? 'primary' : ''}`}
                        onClick={() => void importMedia()}
                      >
                        <Upload size={13} /> 导入素材
                      </button>
                      <button className="button" onClick={() => switchMode('create')}>
                        进入创造画布
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

            <div className="playback-bar" style={appMode !== 'edit' ? { display: 'none' } : undefined}>
              <div className="playback-time">
                {editingTimecode ? (
                  <input
                    autoFocus
                    className="tc-jump-input"
                    aria-label="跳转时间码或帧号"
                    placeholder="如 70f / 2.5s / 00:02:10"
                    value={tcDraft}
                    onChange={(e) => setTcDraft(e.target.value)}
                    onBlur={() => {
                      const parsed = parseTimecodeInput(tcDraft, sequence.fps);
                      setEditingTimecode(false);
                      if (parsed !== null) seek(parsed);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        const parsed = parseTimecodeInput(tcDraft, sequence.fps);
                        setEditingTimecode(false);
                        if (parsed !== null) seek(parsed);
                      } else if (e.key === 'Escape') {
                        setEditingTimecode(false);
                      }
                    }}
                  />
                ) : (
                  <b
                    title="点击按帧号或时间码跳转（如 70f / 2.5s / 00:02:10）"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setTcDraft(`${frameRef.current}f`);
                      setEditingTimecode(true);
                    }}
                  >
                    <PlayheadTimecode clock={playheadClockRef.current!} fps={sequence.fps} />
                  </b>
                )}
                <span>/ {timecode(duration, sequence.fps)}</span>
              </div>
              <div className="transport">
                <IconButton
                  label="上一个镜头"
                  onClick={() => {
                    const curFrame = frameRef.current;
                    seek(
                      [
                        ...sequence.clips
                          .filter((c) => c.track === 'visual' && c.start < curFrame)
                          .map((c) => c.start),
                      ].sort((a, b) => b - a)[0] || 0,
                    );
                  }}
                >
                  <SkipBack size={14} />
                </IconButton>
                <button className="play-button" aria-label={playing ? '暂停' : '播放'} onClick={play}>
                  {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                </button>
                <IconButton
                  label="下一个镜头"
                  onClick={() => {
                    const curFrame = frameRef.current;
                    seek(
                      sequence.clips
                        .filter((c) => c.track === 'visual' && c.start > curFrame)
                        .sort((a, b) => a.start - b.start)[0]?.start || duration - 1,
                    );
                  }}
                >
                  <SkipForward size={14} />
                </IconButton>
              </div>
              <div className="playback-meta">
                <IconButton
                  label={muted ? '开启声音' : '静音'}
                  active={muted}
                  onClick={() => {
                    setMuted((v) => !v);
                    post('mute', { muted: !muted });
                  }}
                >
                  {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </IconButton>
                {(() => {
                  const isImmersive = !showNav && !showRight && !showBottom;
                  return (
                    <IconButton
                      label={isImmersive ? '退出沉浸预览 (Esc)' : '沉浸预览'}
                      active={isImmersive}
                      onClick={() => {
                        if (!isImmersive) {
                          savedPanesRef.current = { nav: showNav, right: showRight, bottom: showBottom };
                          setShowNav(false);
                          setShowRight(false);
                          setShowBottom(false);
                        } else {
                          const saved = savedPanesRef.current;
                          const any = saved.nav || saved.right || saved.bottom;
                          setShowNav(any ? saved.nav : true);
                          setShowRight(any ? saved.right : true);
                          setShowBottom(any ? saved.bottom : true);
                        }
                      }}
                    >
                      {isImmersive ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                    </IconButton>
                  );
                })()}
              </div>
            </div>

            {/* Dockable Bottom Timeline Panel (controlled by IDE Bottom Toggle ⬓ in BOTH Create & Edit modes!) */}
            <section className="editor-panel" style={!showBottom ? { display: 'none' } : undefined}>
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
                    ['storyboard', '分镜'],
                    ['transcript', '文稿'],
                    ['changes', '历史'],
                  ].map(([id, title]) => (
                    <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
                      {title}
                      {id === 'changes' && project.revision > 0 && <span>{project.revision}</span>}
                    </button>
                  ))}
                </div>
                <div className="timeline-tools">
                  <div className="tl-mode-group" role="group" aria-label="时间线工具模式">
                    <button
                      type="button"
                      className={`tl-mode-btn ${timelineTool === 'select' ? 'active' : ''}`}
                      title="选择与拖拽工具 (V)"
                      aria-label="选择工具 V"
                      aria-pressed={timelineTool === 'select'}
                      onClick={() => setTimelineTool('select')}
                    >
                      <MousePointer2 size={12} />
                    </button>
                    <button
                      type="button"
                      className={`tl-mode-btn ${timelineTool === 'razor' ? 'active' : ''}`}
                      title="刀片切割工具：点击片段直接切开 (B)"
                      aria-label="刀片切割工具 B"
                      aria-pressed={timelineTool === 'razor'}
                      onClick={() => setTimelineTool((m) => (m === 'razor' ? 'select' : 'razor'))}
                    >
                      <ScissorsLineDashed size={12} />
                    </button>
                  </div>
                  <IconButton label="在播放头分割片段 ⌘B" disabled={!clip || clip.locked} onClick={split}>
                    <Scissors size={13} />
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
                  <IconButton
                    label="保存为项目资产"
                    disabled={!clip && selectedIds.length === 0}
                    onClick={saveSelectedClipsAsAssetCb}
                  >
                    <BookmarkPlus size={13} />
                  </IconButton>
                  <span className="toolbar-divider" />
                  <IconButton label="吸附" active={snap} onClick={() => setSnap((v) => !v)}>
                    <Magnet size={13} />
                  </IconButton>
                  <IconButton
                    label="缩小时间线"
                    disabled={zoom <= 50}
                    onClick={() => setZoom((z) => Math.max(50, Math.round(z / 1.4)))}
                  >
                    <ZoomOut size={13} />
                  </IconButton>
                  {zoom !== 100 && (
                    <button
                      type="button"
                      className="zoom-reset-btn"
                      title="适应窗口 (100%)"
                      onClick={() => setZoom(100)}
                    >
                      {zoom}%
                    </button>
                  )}
                  <IconButton
                    label="放大时间线"
                    disabled={zoom >= 3200}
                    onClick={() => setZoom((z) => Math.min(3200, Math.round(z * 1.4)))}
                  >
                    <ZoomIn size={13} />
                  </IconButton>
                </div>
              </div>
              {view === 'timeline' && (
                <Timeline
                  project={project}
                  sequence={sequence}
                  playheadClock={playheadClockRef.current!}
                  selected={selected}
                  selectedIds={selectedIds}
                  onSelect={selectClip}
                  onSeek={seek}
                  onEndScrub={endScrub}
                  onEdit={editVoidCb}
                  onAssetDrop={addAssetCb}
                  mediaOrigin={boot.previewOrigin}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  snap={snap}
                  toolMode={timelineTool}
                />
              )}
              {view === 'transcript' && (
                <TranscriptPanel
                  sequence={sequence}
                  sequenceId={sequenceId}
                  frame={frame}
                  selectedClip={clip}
                  transcribedAssets={transcribedAssets}
                  scriptQuery={scriptQuery}
                  onScriptQueryChange={setScriptQuery}
                  onImportSrt={() =>
                    void work('导入字幕', async () => {
                      const e = await api<ProjectEnvelope | null>('captions.import', { sequenceId });
                      if (e) accept(e);
                    })
                  }
                  onTranscribe={(assetId) => openStudio('transcription', assetId)}
                  onExportSrt={() => void api('captions.export', { sequenceId })}
                  onAddCaption={() => void addCaption()}
                  onSeek={seek}
                  onSelectClip={selectClip}
                  onEdit={editVoidCb}
                />
              )}
              {view === 'storyboard' && (
                <StoryboardStudio
                  project={project}
                  sequence={sequence}
                  selectedClipId={selected}
                  previewOrigin={boot.previewOrigin}
                  onSelectClip={selectClip}
                  onSeek={seek}
                  onEdit={(n, ops) => edit(n, ops)}
                  onOpenGenerationForShot={(genPrompt, refAssetId, target) => {
                    openStudio({ use: 'image', prompt: genPrompt, referenceAssetId: refAssetId, target });
                  }}
                  onAskAgentForShot={(targetClip, text) => {
                    setScope(clone(targetClip));
                    setStrictScope(true);
                    setPrompt(text);
                    setRight('agent');
                    setShowRight(true);
                    requestAnimationFrame(() => promptRef.current?.focus());
                  }}
                />
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
                      <button
                        className="text-button"
                        onClick={() =>
                          void work('从历史版本派生分支', async () => {
                            const res = await api<{ envelope: ProjectEnvelope; newSequenceId: string }>(
                              'project.forkFromRevision',
                              { revision: r.revision, sequenceId: sequence.id },
                            );
                            accept(res.envelope);
                            changeSequence(res.newSequenceId);
                            notify(`已从 v${r.revision} 派生平行试剪分支`);
                          })
                        }
                      >
                        派生分支
                      </button>
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
            </section>
          </div>
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
            <button className={right === 'inspector' ? 'active' : ''} onClick={() => setRight('inspector')}>
              <SlidersHorizontal size={13} /> 属性
            </button>
            <button className={right === 'agent' ? 'active' : ''} onClick={() => setRight('agent')}>
              <Mark small /> Agent
            </button>
          </div>
          {right === 'inspector' ? (
            <Inspector
              clip={clip}
              selectedClipIds={selectedIds}
              sequence={sequence}
              project={project}
              previewOrigin={boot.previewOrigin}
              playheadClock={playheadClockRef.current ?? undefined}
              onSeek={seek}
              onSelectClip={selectClip}
              onEdit={editVoidCb}
              onReference={referenceCb}
              onSaveAsAsset={saveSelectedClipsAsAssetCb}
              onRelink={relinkCb}
              onClearSelect={clearSelectCb}
              onCode={openCodeCb}
              onBakeClipVideo={(targetClip) =>
                void work('录制 3D 预演视频', async () => {
                  const res = await api<{ envelope: ProjectEnvelope; asset: Asset }>(
                    'stage.bakeSpatialVideo',
                    {
                      sequenceId: sequence.id,
                      clipId: targetClip.id,
                      durationSeconds: Math.max(2, Math.min(5, targetClip.duration / Math.max(1, sequence.fps))),
                    },
                  );
                  accept(res.envelope);
                  notify(`已录制预演视频「${res.asset.name}」，切换「创造」画布即可连线 AI 生视频`);
                })
              }
              onCaptureClipPair={(targetClip) =>
                void work('拍摄开场/收尾两帧', async () => {
                  const res = await api<{ envelope: ProjectEnvelope; startAsset: Asset; endAsset: Asset }>(
                    'stage.captureSpatialPair',
                    { sequenceId: sequence.id, clipId: targetClip.id },
                  );
                  accept(res.envelope);
                  notify('已拍下开场与收尾两帧并送入「创造」画布，可直接用于首尾帧生视频');
                })
              }
              onCaptureClipFrame={(targetClip) =>
                void work('拍摄当前画面参考帧', async () => {
                  const res = await api<{ envelope: ProjectEnvelope }>('stage.captureReference', {
                    sequenceId: sequence.id,
                    clipId: targetClip.id,
                    frame: Math.max(0, frameRef.current - targetClip.start),
                    passes: ['beauty'],
                  });
                  accept(res.envelope);
                  notify('已拍下当前画面参考帧送入「创造」画布，可用于 AI 重绘');
                })
              }
              onDirectClipWithAgent={(targetClip) => {
                setScope(clone(targetClip));
                setRight('agent');
                setShowRight(true);
                setPrompt(`请帮我调度「${targetClip.name}」的3D摄像机运镜、视角走线或光影氛围：`);
                requestAnimationFrame(() => promptRef.current?.focus());
              }}
              onOpenSpatialDirector={(targetClip) => {
                pause();
                setSpatialStudio({ kind: 'clip', sequenceId: sequence.id, clipId: targetClip.id });
              }}
            />
          ) : !spatialStudio ? (
            renderAgentPanel()
          ) : null}
        </aside>
      )}
      <footer className="statusbar">
        <div>
          <span className={busy ? 'busy-dot' : 'local-dot'} />
          {busy || '所有修改已保存'}
          {pendingVersion && <span>· 预览固定在 v{previewProject?.revision}</span>}
          {appMode === 'edit' && clip && (
            <span className="statusbar-clip-ctx">
              <span className={`selection-dot ${clip.kind}`} />
              <b>{clip.name}</b>
              <span>
                {timecode(clip.start, sequence.fps)}—{timecode(clip.start + clip.duration, sequence.fps)}
              </span>
              {clip.locked && <Lock size={10} />}
              <button type="button" className="statusbar-ref-btn" onClick={reference}>
                引用给 Agent <ArrowUpRight size={11} />
              </button>
            </span>
          )}
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
          <button onClick={() => openDialog('command')} title="快速命令与搜索 (⌘K)">
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
      {toast ? (
        <div className={`toast ${toast.error ? 'error' : ''}`} role="status">
          {toast.error ? <AlertCircle size={15} /> : <Check size={15} />}
          <span>{toast.text}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={12} />
          </button>
        </div>
      ) : busy ? (
        <div className="toast busy-toast" role="status">
          <Spinner />
          <span>{busy.startsWith('正在') ? busy : `正在${busy}`}…</span>
        </div>
      ) : null}
      {jobsOpen && (
        <JobsPopover
          jobs={jobs}
          jobsScope={jobsScope}
          project={project}
          projectPath={env.path}
          sequence={sequence}
          sequenceId={sequenceId}
          selectedClipId={selected}
          onChangeScope={setJobsScope}
          onClearCompleted={() => void api<Job[]>('jobs.clear').then(setJobs)}
          onClose={() => setJobsOpen(false)}
          onOpenFile={(jobId) => void api('file.open', { jobId })}
          onRevealFile={(jobId) => void api('file.reveal', { jobId })}
          onInspectResult={(job, matchedClipId) => {
            setResultJob(job);
            setResultClip(matchedClipId);
            setJobsOpen(false);
            setDialog('job-result');
          }}
          onJumpToCandidate={(job) => {
            if (!job.target) return;
            if (job.target.sequenceId !== sequenceId) changeSequence(job.target.sequenceId);
            const targetSeq = project.sequences.find((s) => s.id === job.target!.sequenceId);
            const targetClip = targetSeq?.clips.find((c) => c.id === job.target!.clipId);
            if (targetClip) {
              selectClip(targetClip.id);
              seek(targetClip.start);
            }
            setView('storyboard');
            setShowBottom(true);
            setJobsOpen(false);
          }}
          onAddAssetToTimeline={(assetId) =>
            void work('添加素材', async () => {
              await addAsset(assetId);
              setJobsOpen(false);
            })
          }
          onResumeJob={(jobId) => void work('继续查询', () => api('generation.resume', { id: jobId }))}
          onCancelJob={(jobId) => void api('jobs.cancel', { id: jobId })}
        />
      )}
      {spatialStudio && (
        <SpatialDirectorStudio
          target={spatialStudio}
          returnLabel={appMode === 'create' ? '返回画布' : '返回剪辑'}
          project={project}
          sequence={sequence}
          settings={settings}
          previewOrigin={boot.previewOrigin}
          onClose={() => setSpatialStudio(null)}
          onEdit={(n, ops) => edit(n, ops).then(() => {})}
          onCaptureReference={async (opts) => {
            await work('拍摄 3D 空间参考帧', async () => {
              const res = await api<{ envelope: ProjectEnvelope; captured?: { pass: string; asset: Asset }[] }>(
                'stage.captureReference',
                { sequenceId: sequence.id, ...opts },
              );
              accept(res.envelope);
              notify(`已拍摄 ${res.captured?.length || 1} 张参考图并送入「创造」画布`);
            });
          }}
          onCapturePair={async (opts) => {
            await work('拍摄 3D 首尾两帧', async () => {
              const res = await api<{ envelope: ProjectEnvelope; startAsset: Asset; endAsset: Asset }>(
                'stage.captureSpatialPair',
                { sequenceId: sequence.id, ...opts },
              );
              accept(res.envelope);
              notify('已拍摄首尾两帧并送入「创造」画布，可直接做首尾帧生视频');
            });
          }}
          onBakeVideo={async (opts) => {
            await work('录制 3D 预演视频', async () => {
              const res = await api<{ envelope: ProjectEnvelope; asset: Asset }>(
                'stage.bakeSpatialVideo',
                { sequenceId: sequence.id, ...opts },
              );
              accept(res.envelope);
              notify(`已录制 3D 预演视频「${res.asset.name}」并送入「创造」画布`);
            });
          }}
          onAskAgent={(instruction, scopeClip) => {
            if (scopeClip) setScope(clone(scopeClip));
            void send(instruction, scopeClip);
          }}
          onOpenCodeEditor={(compId) => {
            const comp = project.components.find((c) => c.id === compId);
            if (!comp) return;
            setCodeComponent(comp);
            setDialog('code');
          }}
          onOpenMcpSettings={() => openSettings('mcp')}
          agentSlot={renderAgentPanel()}
        />
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
          onRefreshSkills={(nextSkills: SkillInfo[]) =>
            setBoot((b) => (b ? { ...b, skills: nextSkills } : b))
          }
          activeSkillIds={project.activeSkillIds || []}
          onToggleProjectSkill={async (skillName, enabled) => {
            const current = project.activeSkillIds || [];
            const next = enabled
              ? [...new Set([...current, skillName])]
              : current.filter((x) => x !== skillName);
            await edit(`${enabled ? '常驻启用' : '取消常驻'} Skill「${friendlySkillTitle(skillName)}」`, [
              { type: 'updateProject', changes: { activeSkillIds: next } },
            ]);
          }}
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
          onJumpToIssue={(issue: PreflightIssue) => {
            if (issue.assetId) {
              setShowNav(true);
            }
            if (issue.frame !== undefined) seek(issue.frame);
            if (issue.clipId) selectClip(issue.clipId);
          }}
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
        <CommandPaletteModal
          query={command}
          activeIndex={cmdIndex}
          items={filteredCommands}
          onQueryChange={setCommand}
          onActiveIndexChange={setCmdIndex}
          onClose={() => setDialog(null)}
        />
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    className="button tiny"
                    onClick={() =>
                      void work('从历史版本派生分支', async () => {
                        const res = await api<{ envelope: ProjectEnvelope; newSequenceId: string }>(
                          'project.forkFromRevision',
                          { revision: r.revision, sequenceId: sequence.id },
                        );
                        accept(res.envelope);
                        changeSequence(res.newSequenceId);
                        setDialog(null);
                        notify(`已从 v${r.revision} 派生平行分支，原成片未受影响`);
                      })
                    }
                  >
                    <GitBranch size={12} /> 派生分支
                  </button>
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
                at: frameRef.current,
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
                ...newClip('code', frameRef.current),
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
            // Copy-on-Write: if another sequence or locked clip shares this component ID, fork cleanly!
            const operations: EditOperation[] = codeComponent
              ? prepareScopedComponentOperations(project, sequenceId, c, clip?.id)
              : [{ type: 'putComponent', component: c }];
            if (!codeComponent) {
              const nc = {
                ...newClip('code', frameRef.current),
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
            setShowNav(true);
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
            setJobs((list) => (list.some((j) => j.id === job.id) ? list : [job, ...list]));
            if (appMode !== 'create') {
              setShowNav(true);
              setJobsOpen(true);
            }
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
