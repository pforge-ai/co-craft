import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  FileText,
  Sparkles,
  Map as MapIcon,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Lock,
  Unlock,
  GitBranch,
  Image as ImageIcon,
  Film,
  Clapperboard,
  AtSign,
  ZoomIn,
  ZoomOut,
  Box,
  Layers,
  Upload,
  SlidersHorizontal,
  AudioLines,
  Scissors,
  Trash2,
  Wand2,
  UserCheck,
  MousePointer2,
  Hand,
  MessageSquare,
  Group,
  Package,
  BookmarkPlus,
  LayoutGrid,
  Link2,
  Download,
  Undo2,
  Redo2,
  ClipboardPaste,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Camera,
  Play,
  RotateCcw,
  RotateCw,
  Tag,
  LayoutList,
  X,
} from 'lucide-react';
import { pointerDrag } from '../lib/pointerDrag';
import {
  CANVAS_LANE_TOP,
  computeTidyCanvasLayout,
  estimateCanvasNodeSize,
  formatAssetCardMeta,
  formatCanvasDisplayName,
  resolveNonOverlappingCanvasLayout,
} from '../lib/canvasLayout';
import { mediaUrl } from '../composition/Film';
import { modelInputCapabilities } from '../core/models';
import {
  buildSpatialStageProps,
  DEFAULT_SPATIAL_BOOKMARKS,
  SPATIAL_ACTOR_ACTION_OPTIONS,
  SPATIAL_ACTOR_PATH_OPTIONS,
  SPATIAL_ENVIRONMENT_OPTIONS,
  SPATIAL_RENDER_PASS_OPTIONS,
  type SpatialSceneMode,
} from '../core/spatialStage';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import { CanvasQuickLook } from './CanvasQuickLook';
import { CodeComponentThumb } from './CodeComponentThumb';
import { CanvasUtilityControls } from './CanvasUtilityControls';
import type { SpatialDirectorTarget } from './SpatialDirectorStudio';
import {
  CanvasWirePillsSvg,
  CanvasWiresSvg,
  computeSmartWire,
  computeTraceGraph,
  type CanvasPt as Pt,
  type CanvasWireCategory,
  type CanvasWireDisplayMode,
  type CanvasWireDrag,
  type CanvasWireItem,
  type PortSide,
} from './CanvasWiresLayer';
import { CanvasAnimaticModal } from './canvas/CanvasAnimaticModal';
import { CanvasAssetCard } from './canvas/CanvasAssetCard';
import { CanvasComponentCard } from './canvas/CanvasComponentCard';
import { CanvasContextMenu, CanvasSubjectModal } from './canvas/CanvasContextMenu';
import { CanvasDropMenu, type CanvasDropMenuState } from './canvas/CanvasDropMenu';
import { CanvasForkPopover, type ForkSourceTarget } from './canvas/CanvasForkPopover';
import { CanvasFramesLayer } from './canvas/CanvasFramesLayer';
import {
  CanvasGeneratorNodeCard,
  GENERATOR_ACTION_META,
  SLOT_LABELS,
} from './canvas/CanvasGeneratorNode';
import { CanvasGhostCard } from './canvas/CanvasGhostCard';
import { CanvasLeftToolbar } from './canvas/CanvasLeftToolbar';
import { CanvasMultiBar } from './canvas/CanvasMultiBar';
import { CanvasOmnibar, type OmnibarSlashAction } from './canvas/CanvasOmnibar';
import { CanvasShotCard } from './canvas/CanvasShotCard';
import { CanvasStarterGuide } from './canvas/CanvasStarterGuide';
import { CanvasTopHud, type CanvasAssetFilter } from './canvas/CanvasTopHud';
import { CanvasVaultCard } from './canvas/CanvasVaultCard';
import {
  collectVisualSelection,
  resolveShotGenContextFull,
  type CanvasGenerationOptions,
} from './canvas/types';
import { PresetPreview } from './PresetControls';
import { createPresetClip, getPreset } from '../core/presets';
import {
  buildDeleteAssetOperations,
  buildDeleteComponentOperations,
  clone,
  createCompoundVaultItemFromClips,
  inferDefaultAudioAttachMode,
  instantiateCompoundVaultItemOperations,
  newClip,
  timecode,
  uid,
} from '../core/project';
import {
  combineVisualAndAudioToShotOperations,
  computePrimaryTimelineShots,
  reorderCompositeShotOperations,
  scriptOutlineToShotOperations,
  type CompositeShot,
} from '../core/storyboard';
import { ROLE_LABELS, inferAssetRole } from '../core/taxonomy';
import { routeOmnibarLocally, type OmnibarLocalIntent } from '../core/system1Rules';
import type {
  AssetLineageRef,
  AssetRole,
  AssetVariant,
  CanvasGeneratorAction,
  CanvasGeneratorInput,
  CanvasGeneratorNode,
  CanvasGroup,
  ChatContextRef,
  Clip,
  ClipTake,
  EditOperation,
  Job,
  Project,
  Sequence,
  Settings,
  ShotBinding,
  VaultItem,
} from '../core/types';

const CONTEXT_ROLES = new Set<AssetRole>(['character', 'environment', 'product', 'visual-style']);
const QUICK_ASSET_ROLES: { id: AssetRole; label: string }[] = [
  { id: 'character', label: '角色' },
  { id: 'environment', label: '场景' },
  { id: 'product', label: '道具 / 主体' },
  { id: 'visual-style', label: '风格参考' },
];

interface CreateCanvasProps {
  project: Project;
  sequence: Sequence;
  selectedClipId: string | null;
  previewOrigin: string;
  modalOpen?: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  rightAgentOpen?: boolean;
  aiBusy?: boolean;
  floatingPrompt: string;
  onFloatingPromptChange: (val: string) => void;
  onFloatingSubmit: () => void;
  onToggleLeft: () => void;
  onToggleRightAgent?: () => void;
  onSelectClip: (clipId: string | null, additive?: boolean) => void;
  onSeek: (frame: number) => void;
  onSwitchToEdit: () => void;
  onImportMedia: () => void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onPublishToLibrary: (payload: {
    itemId?: string;
    assetId?: string;
    componentId?: string;
    pack?: { name: string; assetIds?: string[]; componentIds?: string[]; vaultIds?: string[] };
  }) => Promise<void>;
  onExportMaterialPack?: (payload: {
    name: string;
    assetIds: string[];
    componentIds: string[];
    vaultIds?: string[];
  }) => Promise<void>;
  onSaveClipsAsAsset?: (
    clips: Clip[],
    customName?: string,
    clipWindow?: { start: number; duration: number },
  ) => Promise<void>;
  onAddRefsToChat?: (refs: ChatContextRef[], openDrawer?: boolean) => void;
  chatRefs?: ChatContextRef[];
  onRemoveChatRef?: (key: string) => void;
  onSendCanvasInstruction: (prompt: string, scopeClip?: Clip) => void;
  onOpenGeneration: (opts: CanvasGenerationOptions) => void;
  onAskAgentForShot: (clip: Clip, prompt: string) => void;
  jobs?: Job[];
  settings?: Settings;
  onCancelJob?: (jobId: string) => void;
  onJobsStarted?: (jobs: Job[]) => void;
  onExtractVideoFrame?: (
    assetId: string,
    mode: 'first' | 'last',
    placement?: Pt,
  ) => Promise<import('../core/types').Asset | undefined>;
  onDetachVideoAudio?: (assetId: string, placement?: Pt) => Promise<void>;
  onNormalizeAudio?: (assetId: string, placement?: Pt) => Promise<void>;
  onTrimAudioSilence?: (assetId: string, placement?: Pt) => Promise<void>;
  onVisionDescribeAsset?: (assetId: string, placement?: Pt) => Promise<void>;
  onTriageAssets?: (assetIds: string[]) => Promise<void>;
  onAutoTagAssets?: (assetIds: string[]) => Promise<void>;
  onAutoReframeVertical?: () => Promise<void>;
  onBakeSpatialVideo?: (opts: {
    vaultItemId?: string;
    assetId?: string;
    componentId?: string;
    clipId?: string;
    durationSeconds?: number;
    pass?: string;
    placement?: Pt;
  }) => Promise<import('../core/types').Asset | undefined>;
  onCaptureSpatialPair?: (opts: {
    vaultItemId?: string;
    assetId?: string;
    componentId?: string;
    clipId?: string;
    startBookmarkId?: string;
    endBookmarkId?: string;
    placement?: Pt;
  }) => Promise<{ startAsset: import('../core/types').Asset; endAsset: import('../core/types').Asset } | undefined>;
  onCaptureSpatialReference?: (opts: {
    vaultItemId?: string;
    assetId?: string;
    componentId?: string;
    clipId?: string;
    passes?: string[];
    placement?: Pt;
  }) => Promise<{ asset?: import('../core/types').Asset; captured?: { pass: string; asset: import('../core/types').Asset }[] } | undefined>;
  onOpenSpatialDirector?: (target: SpatialDirectorTarget) => void;
  onOpenQuickSetup?: () => void;
}

export function CreateCanvas({
  project,
  sequence,
  selectedClipId,
  previewOrigin,
  modalOpen = false,
  rightAgentOpen = false,
  aiBusy = false,
  floatingPrompt,
  onFloatingPromptChange,
  onToggleRightAgent,
  onSelectClip,
  onSeek,
  onSwitchToEdit,
  onImportMedia,
  onEdit,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onPublishToLibrary,
  onExportMaterialPack,
  onSaveClipsAsAsset,
  onAddRefsToChat,
  chatRefs = [],
  onRemoveChatRef,
  onSendCanvasInstruction,
  onOpenGeneration,
  jobs = [],
  settings,
  onCancelJob,
  onJobsStarted,
  onExtractVideoFrame,
  onDetachVideoAudio,
  onNormalizeAudio,
  onTrimAudioSilence,
  onVisionDescribeAsset,
  onTriageAssets,
  onAutoTagAssets,
  onAutoReframeVertical,
  onBakeSpatialVideo,
  onCaptureSpatialPair,
  onCaptureSpatialReference,
  onOpenSpatialDirector,
  onOpenQuickSetup,
}: CreateCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const omnibarInputRef = useRef<HTMLTextAreaElement>(null);
  const proximityRafRef = useRef<number>(0);
  const proximityPtRef = useRef<{ x: number; y: number } | null>(null);
  const litElsRef = useRef<Set<HTMLElement>>(new Set());
  useEffect(() => {
    return () => {
      if (proximityRafRef.current) cancelAnimationFrame(proximityRafRef.current);
    };
  }, []);
  const [pan, setPan] = useState<Pt>({ x: 96, y: 80 });
  const [zoom, setZoom] = useState(0.95);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current = pan;
  zoomRef.current = zoom;

  const [canvasTool, setCanvasTool] = useState<'select' | 'pan'>('select');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const [omnibarDraft, setOmnibarDraft] = useState('');

  const [nodePositions, setNodePositions] = useState<Record<string, Pt>>(() => project.canvasLayout || {});
  const nodePositionsRef = useRef<Record<string, Pt>>(project.canvasLayout || {});
  nodePositionsRef.current = nodePositions;

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const selectedIdsRef = useRef(selectedNodeIds);
  selectedIdsRef.current = selectedNodeIds;
  const primarySelectedId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;

  const [activeVarByEnt, setActiveVarByEnt] = useState<Record<string, string>>({});
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [rigExplodeDrafts, setRigExplodeDrafts] = useState<Record<string, number>>({});
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  const startManagedDrag = useCallback((cleanup: () => void) => {
    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = cleanup;
  }, []);

  useEffect(
    () => () => {
      activeDragCleanupRef.current?.();
      activeDragCleanupRef.current = null;
    },
    [],
  );

  // Clear local textDrafts whenever project revision changes externally (Undo/Redo/Agent edit)
  useEffect(() => {
    setTextDrafts({});
  }, [project.revision]);

  // TapNow Popovers, Add Menu, Context Menu, Drop-to-Create Menu, Marquee Box
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<null | { clientX: number; clientY: number; nodeKey?: string }>(null);
  const [dropMenu, setDropMenu] = useState<CanvasDropMenuState | null>(null);
  const [marquee, setMarquee] = useState<null | { x1: number; y1: number; x2: number; y2: number }>(null);
  const [animaticOpen, setAnimaticOpen] = useState(false);
  const [forkSource, setForkSource] = useState<ForkSourceTarget | null>(null);
  const [justCompletedKeys, setJustCompletedKeys] = useState<Record<string, number>>({});
  const [shotReorderDrag, setShotReorderDrag] = useState<null | {
    fromShotId: string;
    targetShotId: string | null;
    side: 'before' | 'after';
  }>(null);
  const prevActiveJobIdsRef = useRef<Set<string>>(new Set());

  const [subjectModal, setSubjectModal] = useState<null | { mode: 'new' | 'variant'; entId?: string }>(null);
  const [subjRole, setSubjRole] = useState<'character' | 'product' | 'environment'>('character');
  const [subjName, setSubjName] = useState('');
  const [subjVar, setSubjVar] = useState('默认状态');
  const [subjDesc, setSubjDesc] = useState('');
  const [subjRef, setSubjRef] = useState('');
  const [rigPopoverFor, setRigPopoverFor] = useState<string | null>(null);
  const [compPopoverFor, setCompPopoverFor] = useState<string | null>(null);
  const [compPromptDraft, setCompPromptDraft] = useState('');
  const [voicePopoverFor, setVoicePopoverFor] = useState<string | null>(null);
  const [takeMenuFor, setTakeMenuFor] = useState<string | null>(null);

  const [wireDrag, setWireDrag] = useState<null | {
    fromNodeId: string;
    side: PortSide;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>(null);
  const [wireHoverKey, setWireHoverKey] = useState<string | null>(null);
  const [hoveredNodeKey, setHoveredNodeKey] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState<CanvasAssetFilter>('all');
  const [wireMode, setWireMode] = useState<CanvasWireDisplayMode>('focus');
  const [wireTypeFilter, setWireTypeFilter] = useState<Record<CanvasWireCategory, boolean>>({
    binding: true,
    lineage: true,
    sequence: true,
    assembly: true,
  });
  const [tracedNodeKey, setTracedNodeKey] = useState<string | null>(null);
  const [roleMenuFor, setRoleMenuFor] = useState<string | null>(null);
  const [deriveMenuFor, setDeriveMenuFor] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [quickLookKey, setQuickLookKey] = useState<string | null>(null);
  const spaceDownRef = useRef<{ time: number; panned: boolean } | null>(null);
  const lastGroupDownRef = useRef<{ id: string; time: number } | null>(null);
  const lastCardDownRef = useRef<{ key: string; time: number; x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);

  const shots = useMemo(() => computePrimaryTimelineShots(sequence), [sequence]);
  const upstreamEntities = useMemo(
    () => (project.vault || []).filter((v) => !v.styleTokens && !v.brand),
    [project.vault],
  );
  const entityBoundAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ent of upstreamEntities) {
      if (ent.entityKind === 'compound') continue;
      if (ent.assetId) ids.add(ent.assetId);
      for (const vr of ent.variants || []) {
        if (vr.assetId) ids.add(vr.assetId);
      }
    }
    return ids;
  }, [upstreamEntities]);
  const standaloneAssets = useMemo(
    () =>
      project.assets.filter(
        (a) =>
          a.kind === 'audio' ||
          !entityBoundAssetIds.has(a.id) ||
          (a.derivedFrom?.length ?? 0) > 0 ||
          Boolean(project.canvasLayout?.[`asset:${a.id}`]),
      ),
    [project.assets, entityBoundAssetIds, project.canvasLayout],
  );
  const standaloneComponents = useMemo(() => {
    const boundCompIds = new Set(upstreamEntities.map((e) => e.rig?.componentId).filter(Boolean));
    return project.components.filter((c) => !boundCompIds.has(c.id));
  }, [project.components, upstreamEntities]);

  const hiddenNodeIds = useMemo(
    () => project.canvasHiddenNodeIds || [],
    [project.canvasHiddenNodeIds],
  );
  const hiddenNodeSet = useMemo(() => new Set(hiddenNodeIds), [hiddenNodeIds]);

  const collapsedNodeSet = useMemo(() => {
    const set = new Set<string>();
    for (const grp of project.canvasGroups || []) {
      if (grp.collapsed) {
        for (const id of grp.nodeIds) set.add(id);
      }
    }
    return set;
  }, [project.canvasGroups]);

  const usedNodeSet = useMemo(() => {
    const set = new Set<string>();
    for (const sh of shots) {
      for (const b of sh.bindings) set.add(`ent:${b.entityId}`);
      for (const c of sh.compositeClips) {
        if (c.assetId) set.add(`asset:${c.assetId}`);
        if (c.componentId) set.add(`comp:${c.componentId}`);
      }
    }
    for (const c of sequence.clips) {
      if (c.assetId) set.add(`asset:${c.assetId}`);
      if (c.componentId) set.add(`comp:${c.componentId}`);
    }
    for (const grp of project.canvasGroups || []) {
      for (const id of grp.nodeIds) set.add(id);
    }
    for (const a of standaloneAssets) {
      if (a.derivedFrom?.length) {
        set.add(`asset:${a.id}`);
        for (const d of a.derivedFrom) {
          if (d.assetId) set.add(`asset:${d.assetId}`);
          if (d.vaultItemId) set.add(`ent:${d.vaultItemId}`);
        }
      }
    }
    for (const ent of upstreamEntities) {
      if (ent.entityKind === 'text' || ent.derivedFrom?.length) set.add(`ent:${ent.id}`);
    }
    return set;
  }, [shots, sequence.clips, project.canvasGroups, standaloneAssets, upstreamEntities]);

  const canvasGenerators = useMemo(() => project.canvasGenerators || [], [project.canvasGenerators]);
  const collapsedZoneSet = useMemo(() => new Set(project.canvasCollapsedZones || []), [project.canvasCollapsedZones]);

  const isContextAsset = useCallback(
    (a: { role?: AssetRole }) => Boolean(a.role && CONTEXT_ROLES.has(a.role)),
    [],
  );

  const visibleUpstreamEntities = useMemo(
    () =>
      upstreamEntities.filter((ent) => {
        const key = `ent:${ent.id}`;
        if (hiddenNodeSet.has(key) || collapsedNodeSet.has(key) || collapsedZoneSet.has('context')) return false;
        if (assetFilter === 'audio') return false;
        if (assetFilter === 'used' && !usedNodeSet.has(key)) return false;
        return true;
      }),
    [upstreamEntities, hiddenNodeSet, collapsedNodeSet, collapsedZoneSet, assetFilter, usedNodeSet],
  );
  const visibleStandaloneAssets = useMemo(
    () =>
      standaloneAssets.filter((a) => {
        const key = `asset:${a.id}`;
        const inContextZone = isContextAsset(a);
        if (hiddenNodeSet.has(key) || collapsedNodeSet.has(key)) return false;
        if (inContextZone && collapsedZoneSet.has('context')) return false;
        if (!inContextZone && collapsedZoneSet.has('explore')) return false;
        if (assetFilter === 'context' && !inContextZone) return false;
        if (assetFilter === 'visual' && a.kind === 'audio') return false;
        if (assetFilter === 'audio' && a.kind !== 'audio') return false;
        if (assetFilter === 'used' && !usedNodeSet.has(key)) return false;
        return true;
      }),
    [standaloneAssets, isContextAsset, hiddenNodeSet, collapsedNodeSet, collapsedZoneSet, assetFilter, usedNodeSet],
  );
  const visibleStandaloneComponents = useMemo(
    () =>
      standaloneComponents.filter((c) => {
        const key = `comp:${c.id}`;
        if (hiddenNodeSet.has(key) || collapsedNodeSet.has(key) || collapsedZoneSet.has('explore')) return false;
        if (assetFilter === 'context' || assetFilter === 'audio') return false;
        if (assetFilter === 'used' && !usedNodeSet.has(key)) return false;
        return true;
      }),
    [standaloneComponents, hiddenNodeSet, collapsedNodeSet, collapsedZoneSet, assetFilter, usedNodeSet],
  );
  const visibleGenerators = useMemo(
    () =>
      canvasGenerators.filter((g) => {
        const key = `gen:${g.id}`;
        if (hiddenNodeSet.has(key) || collapsedNodeSet.has(key) || collapsedZoneSet.has('explore')) return false;
        if (assetFilter === 'context') return false;
        if (assetFilter === 'audio' && g.use !== 'speech') return false;
        return true;
      }),
    [canvasGenerators, hiddenNodeSet, collapsedNodeSet, collapsedZoneSet, assetFilter],
  );
  const visibleShots = useMemo(
    () => (collapsedZoneSet.has('shots') ? [] : shots),
    [shots, collapsedZoneSet],
  );

  const contextAllKeys = useMemo(
    () => [
      ...upstreamEntities.map((e) => `ent:${e.id}`),
      ...standaloneAssets.filter((a) => isContextAsset(a)).map((a) => `asset:${a.id}`),
    ],
    [upstreamEntities, standaloneAssets, isContextAsset],
  );
  const exploreAllKeys = useMemo(
    () => [
      ...canvasGenerators.map((g) => `gen:${g.id}`),
      ...standaloneAssets.filter((a) => !isContextAsset(a)).map((a) => `asset:${a.id}`),
      ...standaloneComponents.map((c) => `comp:${c.id}`),
    ],
    [canvasGenerators, standaloneAssets, standaloneComponents, isContextAsset],
  );

  const totalAssetCount =
    upstreamEntities.length + standaloneAssets.length + standaloneComponents.length + canvasGenerators.length;
  const visibleAssetCount =
    visibleUpstreamEntities.length +
    visibleStandaloneAssets.length +
    visibleStandaloneComponents.length +
    visibleGenerators.length;
  const hudCounts = useMemo(
    () => ({
      all: totalAssetCount,
      context: contextAllKeys.length,
      visual:
        upstreamEntities.filter((e) => e.entityKind !== 'text').length +
        standaloneAssets.filter((a) => a.kind !== 'audio').length,
      audio: standaloneAssets.filter((a) => a.kind === 'audio').length,
      used: usedNodeSet.size,
    }),
    [totalAssetCount, contextAllKeys.length, upstreamEntities, standaloneAssets, usedNodeSet.size],
  );

  const hiddenAssetEntries = useMemo(() => {
    const items: { key: string; label: string }[] = [];
    for (const key of hiddenNodeIds) {
      if (key.startsWith('asset:')) {
        const a = standaloneAssets.find((x) => `asset:${x.id}` === key);
        if (a) items.push({ key, label: formatCanvasDisplayName(a.name) });
      } else if (key.startsWith('ent:')) {
        const e = upstreamEntities.find((x) => `ent:${x.id}` === key);
        if (e) items.push({ key, label: formatCanvasDisplayName(e.name, e.entityKind === 'compound') });
      } else if (key.startsWith('comp:')) {
        const c = standaloneComponents.find((x) => `comp:${x.id}` === key);
        if (c) items.push({ key, label: c.name });
      }
    }
    return items;
  }, [hiddenNodeIds, standaloneAssets, upstreamEntities, standaloneComponents]);

  const assetCols = visibleAssetCount > 8 ? 3 : visibleAssetCount > 3 ? 2 : 1;
  const shotLaneX = visibleAssetCount > 0 || collapsedZoneSet.has('context') || collapsedZoneSet.has('explore')
    ? 40 + assetCols * 304 + 68
    : 80;

  const nodeSizeFor = useCallback(
    (key: string): { w: number; h: number } =>
      estimateCanvasNodeSize(key, {
        assets: project.assets,
        entities: upstreamEntities,
        generators: canvasGenerators,
      }),
    [project.assets, upstreamEntities, canvasGenerators],
  );

  const collapsedGroups = useMemo(() => {
    return (project.canvasGroups || [])
      .filter((grp) => grp.collapsed)
      .map((grp, gIdx) => {
        const savedPts = grp.nodeIds
          .map((id) => nodePositions[id])
          .filter((p): p is Pt => Boolean(p));
        // Anchor stack directly at its first member's real position (never a checkerboard minX/minY corner!)
        const anchor = savedPts.length
          ? savedPts[0]
          : { x: 40 + (gIdx % 2) * 304, y: CANVAS_LANE_TOP + Math.floor(gIdx / 2) * 214 };
        const previews: string[] = [];
        for (const id of grp.nodeIds) {
          if (previews.length >= 3) break;
          if (id.startsWith('asset:')) {
            const a = project.assets.find((x) => `asset:${x.id}` === id);
            if (a && a.thumbnail && !a.offline) previews.push(mediaUrl(previewOrigin, a.id, true));
          } else if (id.startsWith('ent:')) {
            const e = upstreamEntities.find((x) => `ent:${x.id}` === id);
            const aid = e?.variants?.[0]?.assetId || e?.assetId;
            const a = aid ? project.assets.find((x) => x.id === aid) : undefined;
            if (a && a.thumbnail && !a.offline) previews.push(mediaUrl(previewOrigin, a.id, true));
          }
        }
        return { grp, x: anchor.x, y: anchor.y, previews };
      });
  }, [project.canvasGroups, nodePositions, project.assets, upstreamEntities, previewOrigin]);

  const layout = useMemo(() => {
    const assetNodeKeys = [
      ...visibleUpstreamEntities.map((e) => `ent:${e.id}`),
      ...visibleStandaloneAssets.filter((a) => isContextAsset(a)).map((a) => `asset:${a.id}`),
      ...visibleGenerators.map((g) => `gen:${g.id}`),
      ...visibleStandaloneAssets.filter((a) => !isContextAsset(a)).map((a) => `asset:${a.id}`),
      ...visibleStandaloneComponents.map((c) => `comp:${c.id}`),
    ];
    const shotNodeKeys = visibleShots.map((sh) => `shot:${sh.id}`);
    const occupiedRects = collapsedGroups.map((cg) => ({
      pos: { x: cg.x, y: cg.y },
      sz: { w: 248, h: 178 },
    }));
    return resolveNonOverlappingCanvasLayout({
      assetNodeKeys,
      shotNodeKeys,
      savedPositions: nodePositions,
      occupiedRects,
      assetCols,
      shotLaneX,
      getSize: nodeSizeFor,
    });
  }, [
    visibleUpstreamEntities,
    visibleStandaloneAssets,
    visibleStandaloneComponents,
    visibleGenerators,
    visibleShots,
    isContextAsset,
    collapsedGroups,
    assetCols,
    shotLaneX,
    nodePositions,
    nodeSizeFor,
  ]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    setNodePositions(project.canvasLayout || {});
  }, [project.canvasLayout]);

  const prevPropSelectedClipRef = useRef<string | null>(selectedClipId);
  useEffect(() => {
    if (selectedClipId && selectedClipId !== prevPropSelectedClipRef.current) {
      const hit = shots.find((s) => s.compositeClips.some((m) => m.id === selectedClipId));
      if (hit) setSelectedNodeIds([`shot:${hit.id}`]);
    }
    prevPropSelectedClipRef.current = selectedClipId;
  }, [selectedClipId, shots]);

  const viewportCenterWorld = useCallback((): Pt => {
    const box = viewportRef.current?.getBoundingClientRect();
    const w = box ? box.width : 900;
    const h = box ? box.height : 600;
    return {
      x: Math.round((w * 0.45 - panRef.current.x) / zoomRef.current),
      y: Math.round((h * 0.36 - panRef.current.y) / zoomRef.current),
    };
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedNodeIds([]);
    onSelectClip(null);
    setAddMenuOpen(false);
    setContextMenu(null);
    setDropMenu(null);
    setTakeMenuFor(null);
    setRigPopoverFor(null);
    setCompPopoverFor(null);
    setForkSource(null);
    setRoleMenuFor(null);
    setDeriveMenuFor(null);
    setTracedNodeKey(null);
  }, [onSelectClip]);

  const toggleSemanticZone = useCallback(
    async (zoneId: 'context' | 'explore' | 'shots') => {
      const prev = project.canvasCollapsedZones || [];
      const exists = prev.includes(zoneId);
      const next = exists ? prev.filter((id) => id !== zoneId) : [...prev, zoneId];
      await onEdit(exists ? '展开语义分区' : '折叠语义分区', [
        { type: 'updateProject', changes: { canvasCollapsedZones: next } },
      ]);
    },
    [project.canvasCollapsedZones, onEdit],
  );

  const spawnGeneratorNode = useCallback(
    async (opts: {
      use: 'image' | 'video' | 'speech';
      action: CanvasGeneratorAction;
      inputs?: CanvasGeneratorInput[];
      prompt?: string;
      modelId?: string;
      params?: CanvasGeneratorNode['params'];
      placement?: Pt;
    }) => {
      setAddMenuOpen(false);
      setDropMenu(null);
      setContextMenu(null);
      setDeriveMenuFor(null);
      const meta = GENERATOR_ACTION_META[opts.action] || GENERATOR_ACTION_META['text-to-image'];
      const id = uid('gen');
      const node: CanvasGeneratorNode = {
        id,
        use: opts.use,
        action: opts.action,
        modelId: opts.modelId,
        prompt: opts.prompt !== undefined ? opts.prompt : meta.defaultPrompt,
        inputs: opts.inputs || [],
        params: {
          ...(opts.action === 'cutout' ? { background: 'transparent' as const } : {}),
          ...(opts.params || {}),
        },
        outputAssetIds: [],
        updatedAt: new Date().toISOString(),
      };
      const pos = opts.placement || viewportCenterWorld();
      const nextLayout = {
        ...nodePositionsRef.current,
        [`gen:${id}`]: { x: Math.round(pos.x), y: Math.round(pos.y) },
      };
      nodePositionsRef.current = nextLayout;
      setNodePositions(nextLayout);
      const nextGens = [...(project.canvasGenerators || []), node];
      const nextCollapsed = (project.canvasCollapsedZones || []).filter((z) => z !== 'explore');
      await onEdit(`新建「${meta.label}」工坊卡`, [
        {
          type: 'updateProject',
          changes: {
            canvasGenerators: nextGens,
            canvasLayout: nextLayout,
            canvasCollapsedZones: nextCollapsed,
          },
        },
      ]);
      setSelectedNodeIds([`gen:${id}`]);
    },
    [project.canvasGenerators, project.canvasCollapsedZones, viewportCenterWorld, onEdit],
  );

  const updateGeneratorNode = useCallback(
    async (nodeId: string, patch: Partial<CanvasGeneratorNode>) => {
      const nextGens = (project.canvasGenerators || []).map((g) =>
        g.id === nodeId ? { ...g, ...patch, updatedAt: new Date().toISOString() } : g,
      );
      await onEdit('更新工坊节点配置', [
        { type: 'updateProject', changes: { canvasGenerators: nextGens } },
      ]);
    },
    [project.canvasGenerators, onEdit],
  );

  const deleteGeneratorNode = useCallback(
    async (nodeId: string) => {
      const nextGens = (project.canvasGenerators || []).filter((g) => g.id !== nodeId);
      setSelectedNodeIds((prev) => prev.filter((k) => k !== `gen:${nodeId}`));
      await onEdit('移除工坊节点', [
        { type: 'updateProject', changes: { canvasGenerators: nextGens } },
      ]);
    },
    [project.canvasGenerators, onEdit],
  );

  /** Freezes a tuned CanvasGeneratorNode (action, typed input slots, model, prompt & params) as a reusable Recipe VaultItem. */
  const saveGeneratorAsRecipe = useCallback(
    async (genNode: CanvasGeneratorNode) => {
      const meta = GENERATOR_ACTION_META[genNode.action] || GENERATOR_ACTION_META['text-to-image'];
      const inputSlots = genNode.inputs.length
        ? genNode.inputs.map((i) => i.slot)
        : genNode.action === 'motion-transfer' || genNode.action === 'character-replace'
          ? (['subject', 'motion-video'] as CanvasGeneratorInput['slot'][])
          : genNode.action === 'lip-sync'
            ? (['subject', 'driver-audio'] as CanvasGeneratorInput['slot'][])
            : (['subject'] as CanvasGeneratorInput['slot'][]);
      const slotLabels = inputSlots.map((s) => SLOT_LABELS[s] || s);
      const count = upstreamEntities.filter((e) => e.subkind === 'recipe').length + 1;
      const recipeName = `${meta.label}配方 ${count}`;
      const originPos = layoutRef.current[`gen:${genNode.id}`] || viewportCenterWorld();
      const item: VaultItem = {
        id: uid('pvault'),
        name: recipeName,
        entityKind: 'skill',
        role: 'animation-skill',
        tags: ['工坊配方', meta.label],
        category: 'recipe',
        subkind: 'recipe',
        description: `槽位：${slotLabels.join(' + ')} → ${meta.label}`,
        derivedFrom: [
          {
            vaultItemId: `gen:${genNode.id}`,
            via: 'manual-ref',
            note: '存为配方',
          },
        ],
        recipe: {
          skillId: 'canvas-workshop',
          slots: slotLabels,
          promptTemplate: genNode.prompt || '',
          workshop: {
            use: genNode.use,
            action: genNode.action,
            modelId: genNode.modelId,
            prompt: genNode.prompt || '',
            inputSlots,
            params: genNode.params ? { ...genNode.params } : undefined,
          },
        },
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      const nextLayout = {
        ...nodePositionsRef.current,
        [`ent:${item.id}`]: { x: Math.round(originPos.x), y: Math.round(originPos.y + 300) },
      };
      nodePositionsRef.current = nextLayout;
      setNodePositions(nextLayout);
      await onEdit(`保存工坊配方「${recipeName}」`, [
        { type: 'putVaultItem', item },
        { type: 'updateProject', changes: { canvasLayout: nextLayout } },
      ]);
      setSelectedNodeIds([`ent:${item.id}`]);
    },
    [upstreamEntities, viewportCenterWorld, onEdit],
  );

  /** Spawns a fresh live CanvasGeneratorNode from a saved Recipe VaultItem, auto-wiring any compatible selected nodes. */
  const instantiateWorkshopRecipe = useCallback(
    async (ent: VaultItem, originPos: Pt) => {
      const ws = ent.recipe?.workshop;
      if (!ws) return;
      const inputs: CanvasGeneratorInput[] = [];
      const extraSelected = selectedIdsRef.current.filter((k) => k !== `ent:${ent.id}`);
      const usedKeys = new Set<string>();
      for (const slot of ws.inputSlots) {
        let matchKey: string | undefined;
        if (slot === 'motion-video') {
          matchKey = extraSelected.find((k) => {
            if (usedKeys.has(k) || !k.startsWith('asset:')) return false;
            return project.assets.some((a) => `asset:${a.id}` === k && a.kind === 'video');
          });
        } else if (slot === 'driver-audio') {
          matchKey = extraSelected.find((k) => {
            if (usedKeys.has(k) || !k.startsWith('asset:')) return false;
            return project.assets.some((a) => `asset:${a.id}` === k && a.kind === 'audio');
          });
        } else if (slot === 'prompt-text') {
          matchKey = extraSelected.find((k) => {
            if (usedKeys.has(k) || !k.startsWith('ent:')) return false;
            return upstreamEntities.some((e) => `ent:${e.id}` === k && e.entityKind === 'text');
          });
        } else {
          matchKey = extraSelected.find((k) => {
            if (usedKeys.has(k)) return false;
            if (k.startsWith('asset:')) return project.assets.some((a) => `asset:${a.id}` === k && a.kind === 'image');
            if (k.startsWith('ent:')) return upstreamEntities.some((e) => `ent:${e.id}` === k && e.entityKind !== 'text');
            return false;
          });
        }
        if (matchKey) {
          usedKeys.add(matchKey);
          inputs.push({ nodeKey: matchKey, slot });
        }
      }
      await spawnGeneratorNode({
        use: ws.use,
        action: ws.action,
        modelId: ws.modelId,
        prompt: ws.prompt,
        params: ws.params,
        inputs,
        placement: { x: Math.round(originPos.x + 306), y: Math.round(originPos.y) },
      });
    },
    [project.assets, upstreamEntities, spawnGeneratorNode],
  );

  const createTextNode = useCallback(
    async (initialText = '', worldPos?: Pt) => {
      setAddMenuOpen(false);
      setContextMenu(null);
      setDropMenu(null);
      const count = upstreamEntities.filter((e) => e.entityKind === 'text').length + 1;
      const item: VaultItem = {
        id: uid('pvault'),
        name: `脚本文本 ${count}`,
        entityKind: 'text',
        role: 'title-chapter',
        tags: ['画布文本'],
        category: 'subject',
        subkind: 'text-note',
        textContent: initialText,
        description: '画布自由文本节点，支持连线生图、配音或按行拆解为分镜序列。',
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      if (worldPos) {
        const nextLayout = { ...nodePositionsRef.current, [`ent:${item.id}`]: worldPos };
        nodePositionsRef.current = nextLayout;
        setNodePositions(nextLayout);
        await onEdit(`新建文本节点「${item.name}」`, [
          { type: 'putVaultItem', item },
          { type: 'updateProject', changes: { canvasLayout: nextLayout } },
        ]);
      } else {
        await onEdit(`新建文本节点「${item.name}」`, [{ type: 'putVaultItem', item }]);
      }
      setSelectedNodeIds([`ent:${item.id}`]);
    },
    [upstreamEntities, viewportCenterWorld, onEdit],
  );

  const selectAllNodes = useCallback(() => {
    setSelectedNodeIds(Object.keys(layoutRef.current));
  }, []);

  /** Fits viewport pan & zoom to show all nodes WITHOUT overwriting manual node positions (Review #11). */
  function fitCanvasToNodes() {
    const entries = Object.entries(layoutRef.current);
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!entries.length || !vp || vp.width < 100 || vp.height < 100) {
      setPan({ x: 96, y: 72 });
      setZoom(0.95);
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [k, pos] of entries) {
      const w = k.startsWith('shot:') ? 286 : 264;
      const h = k.startsWith('shot:') ? 220 : 210;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + w);
      maxY = Math.max(maxY, pos.y + h);
    }
    const contentW = Math.max(240, maxX - minX);
    const contentH = Math.max(200, maxY - minY);
    const padX = 72;
    const padY = 96;
    const nextZoom = Math.max(
      0.35,
      Math.min(1.1, Math.min((vp.width - padX * 2) / contentW, (vp.height - padY * 2) / contentH)),
    );
    const roundedZoom = Math.round(nextZoom * 100) / 100;
    const nextPanX = Math.round((vp.width - contentW * roundedZoom) / 2 - minX * roundedZoom);
    const nextPanY = Math.round((vp.height - contentH * roundedZoom) / 2 - minY * roundedZoom);
    setZoom(roundedZoom);
    setPan({ x: nextPanX, y: nextPanY });
  }

  /** Stows asset/entity/component cards off the canvas desktop WITHOUT deleting underlying project files (undoable). */
  const hideNodeKeysFromCanvas = useCallback(
    async (keys: string[]) => {
      const hideable = keys.filter(
        (k) => k.startsWith('asset:') || k.startsWith('ent:') || k.startsWith('comp:'),
      );
      if (!hideable.length) return;
      const nextHidden = [...new Set([...hiddenNodeIds, ...hideable])];
      setSelectedNodeIds((prev) => prev.filter((k) => !hideable.includes(k)));
      await onEdit(
        hideable.length === 1 ? '将素材移出画布（保留工程资产）' : `将 ${hideable.length} 项素材移出画布`,
        [{ type: 'updateProject', changes: { canvasHiddenNodeIds: nextHidden } }],
      );
    },
    [hiddenNodeIds, onEdit],
  );

  /** Atomically deletes selected assets, components, entities, generators, or unlocked shots from the project (undoable via Cmd+Z; respects clip locks). */
  const deleteNodeKeysFromProject = useCallback(
    async (keys: string[]) => {
      const unique = Array.from(new Set(keys));
      if (!unique.length) return;
      const ops: EditOperation[] = [];
      const deletedClipIds = new Set<string>();
      const removedGenIds = new Set<string>();
      const pushUniqueOp = (op: EditOperation) => {
        if (op.type === 'deleteClip') {
          const k = `${op.sequenceId}:${op.clipId}`;
          if (deletedClipIds.has(k)) return;
          deletedClipIds.add(k);
        }
        ops.push(op);
      };

      for (const key of unique) {
        if (key.startsWith('asset:')) {
          const assetId = key.slice(6);
          try {
            for (const op of buildDeleteAssetOperations(project, assetId)) pushUniqueOp(op);
          } catch {
            // Fall through to raw op so backend surfaces the exact lock error toast
            pushUniqueOp({ type: 'removeAsset', assetId });
          }
        } else if (key.startsWith('comp:')) {
          const componentId = key.slice(5);
          try {
            for (const op of buildDeleteComponentOperations(project, componentId)) pushUniqueOp(op);
          } catch {
            pushUniqueOp({ type: 'removeComponent', componentId });
          }
        } else if (key.startsWith('ent:')) {
          pushUniqueOp({ type: 'removeVaultItem', itemId: key.slice(4) });
        } else if (key.startsWith('gen:')) {
          removedGenIds.add(key.slice(4));
        } else if (key.startsWith('shot:')) {
          const sh = shots.find((s) => `shot:${s.id}` === key);
          if (sh && !sh.locked) {
            pushUniqueOp({ type: 'deleteClip', sequenceId: sequence.id, clipId: sh.anchorClip.id });
          }
        }
      }

      if (removedGenIds.size > 0) {
        const nextGens = (project.canvasGenerators || []).filter((g) => !removedGenIds.has(g.id));
        ops.push({ type: 'updateProject', changes: { canvasGenerators: nextGens } });
      }
      if (!ops.length) return;

      setSelectedNodeIds((prev) => prev.filter((k) => !unique.includes(k)));
      setCompPopoverFor(null);
      setRigPopoverFor(null);
      await onEdit(unique.length === 1 ? '删除所选资产' : `删除 ${unique.length} 项资产`, ops);
    },
    [project, sequence.id, shots, onEdit],
  );

  const restoreNodeKeysToCanvas = useCallback(
    async (keys?: string[]) => {
      const nextHidden = keys ? hiddenNodeIds.filter((k) => !keys.includes(k)) : [];
      await onEdit(
        keys && keys.length === 1 ? '将素材放回画布' : '恢复画布已收起素材',
        [{ type: 'updateProject', changes: { canvasHiddenNodeIds: nextHidden } }],
      );
    },
    [hiddenNodeIds, onEdit],
  );

  const tidyCanvasNodes = useCallback(async () => {
    const assetNodeKeys = [
      ...visibleUpstreamEntities.map((e) => `ent:${e.id}`),
      ...visibleStandaloneAssets.filter((a) => isContextAsset(a)).map((a) => `asset:${a.id}`),
      ...visibleGenerators.map((g) => `gen:${g.id}`),
      ...visibleStandaloneAssets.filter((a) => !isContextAsset(a)).map((a) => `asset:${a.id}`),
      ...visibleStandaloneComponents.map((c) => `comp:${c.id}`),
    ];
    const shotNodeKeys = visibleShots.map((sh) => `shot:${sh.id}`);
    const { positions } = computeTidyCanvasLayout({
      assetNodeKeys,
      shotNodeKeys,
      groups: project.canvasGroups || [],
      getSize: nodeSizeFor,
    });
    const merged = { ...nodePositionsRef.current, ...positions };
    nodePositionsRef.current = merged;
    setNodePositions(merged);
    await onEdit('整理画布排版', [{ type: 'updateProject', changes: { canvasLayout: merged } }]);
    requestAnimationFrame(() => fitCanvasToNodes());
  }, [
    visibleUpstreamEntities,
    visibleStandaloneAssets,
    visibleStandaloneComponents,
    visibleGenerators,
    visibleShots,
    isContextAsset,
    project.canvasGroups,
    nodeSizeFor,
    onEdit,
  ]);

  const renameCanvasGroup = useCallback(
    async (groupId: string, nextName: string) => {
      const trimmed = nextName.trim();
      setEditingGroupId(null);
      if (!trimmed) return;
      const existing = project.canvasGroups || [];
      const target = existing.find((g) => g.id === groupId);
      if (!target || target.name === trimmed) return;
      const nextGroups = existing.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g));
      await onEdit(`重命名分组「${trimmed}」`, [{ type: 'updateProject', changes: { canvasGroups: nextGroups } }]);
    },
    [project.canvasGroups, onEdit],
  );

  const toggleCollapseGroup = useCallback(
    async (groupId: string) => {
      const existing = project.canvasGroups || [];
      const target = existing.find((g) => g.id === groupId);
      if (!target) return;
      const nextCollapsed = !target.collapsed;
      // Save current member positions before collapsing so expanding returns every card accurately
      const nextLayout = { ...nodePositionsRef.current };
      if (nextCollapsed) {
        for (const id of target.nodeIds) {
          if (layoutRef.current[id]) nextLayout[id] = layoutRef.current[id];
        }
        nodePositionsRef.current = nextLayout;
        setNodePositions(nextLayout);
        setSelectedNodeIds((prev) => prev.filter((id) => !target.nodeIds.includes(id)));
      }
      const nextGroups = existing.map((g) => (g.id === groupId ? { ...g, collapsed: nextCollapsed } : g));
      await onEdit(`${nextCollapsed ? '折叠' : '展开'}分组「${target.name}」`, [
        { type: 'updateProject', changes: { canvasGroups: nextGroups, canvasLayout: nextLayout } },
      ]);
    },
    [project.canvasGroups, onEdit],
  );

  const resolveShotGenContext = useCallback(
    (shot: CompositeShot) => resolveShotGenContextFull(shot, upstreamEntities, project.assets, activeVarByEnt),
    [upstreamEntities, project.assets, activeVarByEnt],
  );

  // Active in-place generation jobs for the current project (both Shot-targeted & Standalone Ghost Cards)
  const activeCanvasJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.type === 'generate' &&
          (j.status === 'running' || j.status === 'queued') &&
          (!j.projectId || j.projectId === project.id),
      ),
    [jobs, project.id],
  );

  const shotActiveJobs = useMemo(() => {
    const map = new Map<string, Job>();
    for (const j of activeCanvasJobs) {
      if (j.target?.clipId && !map.has(j.target.clipId)) {
        map.set(j.target.clipId, j);
      }
    }
    return map;
  }, [activeCanvasJobs]);

  const ghostJobs = useMemo(() => {
    const standalone = activeCanvasJobs.filter((j) => !j.target?.clipId);
    return standalone.map((job, idx) => {
      const sourceKeys = Array.from(
        new Set([
          ...(job.canvas?.sourceNodeKeys || []),
          ...(job.canvas?.referenceAssetIds || []).map((id) => `asset:${id}`),
          ...(job.canvas?.lastFrameAssetId ? [`asset:${job.canvas.lastFrameAssetId}`] : []),
        ]),
      ).filter((k) => Boolean(layout[k]));

      let pos: Pt | undefined = job.canvas?.placement
        ? { x: Math.round(job.canvas.placement.x), y: Math.round(job.canvas.placement.y) }
        : undefined;
      if (!pos && sourceKeys.length > 0) {
        const srcPts = sourceKeys.map((k) => layout[k]).filter((p): p is Pt => Boolean(p));
        const maxX = Math.max(...srcPts.map((p) => p.x));
        const avgY = srcPts.reduce((s, p) => s + p.y, 0) / srcPts.length;
        pos = { x: Math.round(maxX + 312), y: Math.round(avgY + idx * 198) };
      }
      if (!pos) {
        pos = { x: 40 + assetCols * 300, y: CANVAS_LANE_TOP + idx * 198 };
      }
      return { job, pos, sourceKeys };
    });
  }, [activeCanvasJobs, layout, assetCols]);

  // Brief optical micro-sheen when an active canvas generation finishes and materializes
  useEffect(() => {
    const prevIds = prevActiveJobIdsRef.current;
    const nextActive = new Set<string>();
    const freshlyDone: string[] = [];
    for (const j of jobs) {
      if (j.type !== 'generate') continue;
      if (j.status === 'running' || j.status === 'queued') {
        nextActive.add(j.id);
      } else if (j.status === 'completed' && prevIds.has(j.id)) {
        if (j.target?.clipId) {
          const hitShot = shots.find((s) => s.anchorClip.id === j.target!.clipId);
          if (hitShot) freshlyDone.push(`shot:${hitShot.id}`);
        } else if (j.result?.asset?.id) {
          freshlyDone.push(`asset:${j.result.asset.id}`);
        }
      }
    }
    prevActiveJobIdsRef.current = nextActive;
    if (!freshlyDone.length) return;
    const now = Date.now();
    setJustCompletedKeys((prev) => {
      const next = { ...prev };
      for (const k of freshlyDone) next[k] = now;
      return next;
    });
    const timer = window.setTimeout(() => {
      setJustCompletedKeys((prev) => {
        const next = { ...prev };
        for (const k of freshlyDone) {
          if (next[k] === now) delete next[k];
        }
        return next;
      });
    }, 1350);
    return () => window.clearTimeout(timer);
  }, [jobs, shots]);

  const visualSelection = useMemo(
    () => collectVisualSelection(selectedNodeIds, project, upstreamEntities, shots, activeVarByEnt, layout),
    [selectedNodeIds, project, upstreamEntities, shots, activeVarByEnt, layout],
  );

  const collectRefsFromNodeKeys = useCallback(
    (keys: string[]): ChatContextRef[] => {
      const refs: ChatContextRef[] = [];
      for (const key of keys) {
        if (key.startsWith('ent:')) {
          const ent = upstreamEntities.find((e) => `ent:${e.id}` === key);
          if (ent) {
            refs.push({
              key,
              kind: ent.entityKind === 'text' ? 'text' : 'entity',
              id: ent.id,
              label: ent.name,
            });
          }
        } else if (key.startsWith('asset:')) {
          const a = standaloneAssets.find((x) => `asset:${x.id}` === key);
          if (a) refs.push({ key, kind: 'asset', id: a.id, label: a.name });
        } else if (key.startsWith('comp:')) {
          const c = standaloneComponents.find((x) => `comp:${x.id}` === key);
          if (c) refs.push({ key, kind: 'component', id: c.id, label: c.name });
        } else if (key.startsWith('shot:')) {
          const sh = shots.find((s) => `shot:${s.id}` === key);
          if (sh) {
            refs.push({
              key,
              kind: 'shot',
              id: sh.id,
              label: `镜头 ${String(sh.index).padStart(2, '0')}`,
              clipId: sh.anchorClip.id,
            });
          }
        }
      }
      return refs;
    },
    [upstreamEntities, standaloneAssets, standaloneComponents, shots],
  );

  const createGroupFromNodeKeys = useCallback(
    async (keys: string[]) => {
      if (keys.length < 2) return;
      const existing = project.canvasGroups || [];
      const grp: CanvasGroup = {
        id: uid('grp'),
        name: `素材组 ${existing.length + 1}`,
        nodeIds: [...new Set(keys)],
      };
      const ops: EditOperation[] = [
        { type: 'updateProject', changes: { canvasGroups: [...existing, grp] } },
      ];
      for (const k of keys) {
        if (k.startsWith('asset:')) {
          ops.push({ type: 'updateAssetMeta', assetId: k.slice(6), changes: { collection: grp.name } });
        }
      }
      await onEdit(`创建分组「${grp.name}」`, ops);
    },
    [project.canvasGroups, onEdit],
  );

  const packNodeKeys = useCallback(
    async (keys: string[], exportOffline = false) => {
      const assetIds = keys.filter((k) => k.startsWith('asset:')).map((k) => k.slice(6));
      const componentIds = keys.filter((k) => k.startsWith('comp:')).map((k) => k.slice(5));
      const vaultIds = keys.filter((k) => k.startsWith('ent:')).map((k) => k.slice(4));
      const shotObjs = keys
        .filter((k) => k.startsWith('shot:'))
        .map((k) => shots.find((s) => `shot:${s.id}` === k))
        .filter((x): x is CompositeShot => Boolean(x));

      const ops: EditOperation[] = [];
      for (const sh of shotObjs) {
        const compVault = createCompoundVaultItemFromClips(
          project,
          sequence,
          [...sh.compositeClips, ...sh.captionClips],
          `镜头 ${String(sh.index).padStart(2, '0')} · ${sh.anchorClip.name}`,
        );
        ops.push({ type: 'putVaultItem', item: compVault });
        vaultIds.push(compVault.id);
      }
      if (ops.length) await onEdit('打包前保存分镜组合', ops);

      const packName = `${project.name}-素材包 (${keys.length}项)`;
      if (exportOffline && onExportMaterialPack) {
        await onExportMaterialPack({ name: packName, assetIds, componentIds, vaultIds });
        return;
      }
      await onPublishToLibrary({
        pack: { name: packName, assetIds, componentIds, vaultIds },
      });
    },
    [shots, project, sequence, onEdit, onPublishToLibrary, onExportMaterialPack],
  );

  const appendSelectedNodesToTimeline = useCallback(
    async (keys: string[]) => {
      const ops: EditOperation[] = [];
      let vCursor = sequence.clips
        .filter((c) => c.track === 'visual')
        .reduce((m, c) => Math.max(m, c.start + c.duration), 0);
      let aCursor = sequence.clips
        .filter((c) => c.track === 'audio')
        .reduce((m, c) => Math.max(m, c.start + c.duration), 0);

      for (const key of keys) {
        if (key.startsWith('asset:')) {
          const a = standaloneAssets.find((x) => `asset:${x.id}` === key);
          if (!a) continue;
          const dur =
            a.kind === 'image' || a.kind === 'model-3d'
              ? Math.max(15, Math.round(5 * sequence.fps))
              : Math.max(1, Math.floor(a.duration * sequence.fps));
          const isAudio = a.kind === 'audio';
          const c: Clip = {
            ...newClip(a.kind === 'model-3d' ? 'shape' : a.kind, isAudio ? aCursor : vCursor, a.id),
            name: a.name,
            duration: dur,
          };
          ops.push({ type: 'addClip', sequenceId: sequence.id, clip: c });
          if (isAudio) aCursor += dur;
          else vCursor += dur;
        } else if (key.startsWith('comp:')) {
          const comp = standaloneComponents.find((x) => `comp:${x.id}` === key);
          if (!comp) continue;
          const dur = Math.round((comp.pack?.durationSeconds || 5) * sequence.fps);
          const c: Clip = {
            ...newClip('code', vCursor),
            name: comp.name,
            duration: dur,
            componentId: comp.id,
            props: { ...comp.props },
          };
          ops.push({ type: 'addClip', sequenceId: sequence.id, clip: c });
          vCursor += dur;
        } else if (key.startsWith('ent:')) {
          const ent = upstreamEntities.find((x) => `ent:${x.id}` === key);
          if (!ent) continue;
          if (ent.compound?.clips.length) {
            const inst = instantiateCompoundVaultItemOperations(sequence.id, ent, vCursor, sequence.fps);
            ops.push(...inst.operations);
            vCursor += Math.max(1, ent.compound.durationFrames);
          } else if (ent.assetId) {
            const a = project.assets.find((x) => x.id === ent.assetId);
            const dur =
              !a || a.kind === 'image' || a.kind === 'model-3d'
                ? Math.max(15, Math.round(5 * sequence.fps))
                : Math.max(1, Math.floor(a.duration * sequence.fps));
            const c: Clip = {
              ...newClip(a?.kind === 'video' ? 'video' : 'image', vCursor, ent.assetId),
              name: ent.name,
              duration: dur,
              subjectBindings: [{ entityId: ent.id, pinnedVersion: ent.version }],
              subjectIds: [ent.id],
            };
            ops.push({ type: 'addClip', sequenceId: sequence.id, clip: c });
            vCursor += dur;
          }
        }
      }
      if (ops.length) await onEdit(`批量串联 ${ops.length} 项到时间线`, ops);
    },
    [sequence, standaloneAssets, standaloneComponents, upstreamEntities, project.assets, onEdit],
  );

  const linkSelectedNodes = useCallback(
    async (keys: string[]) => {
      if (keys.length < 2) return;
      const targetShotKey = keys.find((k) => k.startsWith('shot:'));
      const ops: EditOperation[] = [];
      if (targetShotKey) {
        const sh = shots.find((s) => `shot:${s.id}` === targetShotKey);
        if (sh && !sh.locked) {
          for (const k of keys) {
            if (k === targetShotKey) continue;
            if (k.startsWith('ent:')) {
              const ent = upstreamEntities.find((e) => `ent:${e.id}` === k);
              if (ent) {
                ops.push({
                  type: 'updateClip',
                  sequenceId: sequence.id,
                  clipId: sh.anchorClip.id,
                  changes: {
                    subjectBindings: [
                      ...(sh.anchorClip.subjectBindings || []).filter((b) => b.entityId !== ent.id),
                      { entityId: ent.id, pinnedVersion: ent.version },
                    ],
                    subjectIds: [...new Set([...(sh.anchorClip.subjectIds || []), ent.id])],
                  },
                });
              }
            } else if (k.startsWith('asset:')) {
              const a = standaloneAssets.find((x) => `asset:${x.id}` === k);
              if (a?.kind === 'audio') {
                ops.push({
                  type: 'addClip',
                  sequenceId: sequence.id,
                  clip: {
                    ...newClip('audio', sh.start, a.id),
                    name: a.name,
                    audioAttachMode: 'shot',
                    duration: Math.max(1, Math.min(sh.duration, Math.floor(a.duration * sequence.fps))),
                  },
                });
              }
            }
          }
        }
      } else {
        const assetKeys = keys.filter((k) => k.startsWith('asset:'));
        for (let i = 1; i < assetKeys.length; i++) {
          const parentAid = assetKeys[i - 1].slice(6);
          const childAsset = standaloneAssets.find((x) => x.id === assetKeys[i].slice(6));
          if (!childAsset) continue;
          const prev = childAsset.derivedFrom || [];
          if (!prev.some((d) => d.assetId === parentAid)) {
            const nextRefs: AssetLineageRef[] = [
              ...prev,
              { assetId: parentAid, via: 'manual-ref', note: '参考关联' },
            ];
            ops.push({ type: 'updateAssetMeta', assetId: childAsset.id, changes: { derivedFrom: nextRefs } });
          }
        }
      }
      if (ops.length) await onEdit('建立多选素材关联', ops);
    },
    [shots, upstreamEntities, standaloneAssets, sequence.id, sequence.fps, onEdit],
  );

  // Keyboard shortcuts while Canvas active (Escape deselect, Space tap Quick Look / Space hold pan, T new text node, S new subject, Cmd+A select all, Cmd+G group)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (modalOpen || subjectModal || quickLookKey || editingGroupId || animaticOpen || forkSource) return;
      if (e.isComposing) return;
      const inField = Boolean((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]'));
      if (e.code === 'Space' && !inField) {
        if (!e.repeat) {
          spaceDownRef.current = { time: Date.now(), panned: false };
        }
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (e.key === 'Escape') {
        if (inField) {
          (e.target as HTMLElement).blur();
          return;
        }
        clearSelection();
        return;
      }
      if (inField) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllNodes();
        return;
      }
      if (mod && e.key.toLowerCase() === 'g' && selectedIdsRef.current.length >= 2) {
        e.preventDefault();
        void createGroupFromNodeKeys(selectedIdsRef.current);
        return;
      }
      if (!mod && e.key.toLowerCase() === 't') {
        e.preventDefault();
        void createTextNode('');
        return;
      }
      if (!mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        void spawnGeneratorNode({ use: 'image', action: 'text-to-image' });
        return;
      }
      if (!mod && (e.key === 'Backspace' || e.key === 'Delete') && selectedIdsRef.current.length > 0) {
        e.preventDefault();
        void deleteNodeKeysFromProject(selectedIdsRef.current);
        return;
      }
      if (!mod && e.key.toLowerCase() === 'v') setCanvasTool('select');
      if (!mod && e.key.toLowerCase() === 'h') setCanvasTool('pan');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false);
        const down = spaceDownRef.current;
        spaceDownRef.current = null;
        if (
          down &&
          !down.panned &&
          Date.now() - down.time < 320 &&
          !modalOpen &&
          !subjectModal &&
          !editingGroupId &&
          !animaticOpen &&
          !forkSource &&
          selectedIdsRef.current.length === 1
        ) {
          setQuickLookKey(selectedIdsRef.current[0]);
        }
      }
    };
    const onBlur = () => {
      setSpaceHeld(false);
      spaceDownRef.current = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [
    modalOpen,
    subjectModal,
    quickLookKey,
    editingGroupId,
    animaticOpen,
    forkSource,
    clearSelection,
    selectAllNodes,
    createGroupFromNodeKeys,
    createTextNode,
    deleteNodeKeysFromProject,
    spawnGeneratorNode,
  ]);

  async function addQuickCanvasRigNode(
    presetId: string,
    role: VaultItem['role'],
    label: string,
    extraProps?: Record<string, unknown>,
    derivedFrom?: VaultItem['derivedFrom'],
    placement?: { x: number; y: number },
    openRigPopover = true,
  ): Promise<VaultItem> {
    setAddMenuOpen(false);
    const def = getPreset(presetId);
    const isThree = presetId === 'spatial-stage' || presetId === 'teardown-3d';
    const item: VaultItem = {
      id: uid('pvault'),
      name: label,
      entityKind: isThree ? 'three' : 'component',
      role,
      tags: isThree ? ['空间摄影棚', 'L1零视频费'] : [],
      category: 'rig',
      subkind: isThree ? 'three-rig' : 'motion-rig',
      description: def?.description || label,
      derivedFrom,
      rig: {
        presetId,
        props: { ...clone(def?.defaultProps || {}), ...(extraProps || {}) },
      },
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    const ops: EditOperation[] = [{ type: 'putVaultItem', item }];
    if (placement) {
      const nextLayout = {
        ...(project.canvasLayout || {}),
        [`ent:${item.id}`]: { x: Math.round(placement.x), y: Math.round(placement.y) },
      };
      ops.push({ type: 'updateProject', changes: { canvasLayout: nextLayout } });
    }
    await onEdit(`新建画布节点「${label}」`, ops);
    setSelectedNodeIds([`ent:${item.id}`]);
    if (openRigPopover) setRigPopoverFor(item.id);
    return item;
  }

  async function createSpatialStageFromAssets(
    assetIds: string[],
    sceneMode: SpatialSceneMode,
    placement?: { x: number; y: number },
  ) {
    setDeriveMenuFor(null);
    const validAssets = assetIds
      .map((id) => project.assets.find((a) => a.id === id))
      .filter((a): a is Project['assets'][number] => Boolean(a));
    if (!validAssets.length) return;
    const isDevice = sceneMode === 'device-showcase';
    const label = isDevice
      ? `3D 贴屏 · ${formatCanvasDisplayName(validAssets[0].name, true)}`
      : validAssets.length > 1
        ? `2.5D 多层空间镜 (${validAssets.length}层)`
        : `2.5D 空间镜 · ${formatCanvasDisplayName(validAssets[0].name, true)}`;
    const props = buildSpatialStageProps({
      sceneMode,
      title: label,
      layerAssetIds: isDevice ? undefined : validAssets.map((a) => a.id),
      screenAssetId: isDevice ? validAssets[0].id : undefined,
      cameraPreset: isDevice ? 'orbit' : 'dolly-in',
      particles3D: isDevice ? 'none' : 'dust',
      showHud: false,
    });
    const derivedFrom: VaultItem['derivedFrom'] = validAssets.map((a) => ({
      assetId: a.id,
      via: 'spatial-25d',
      note: isDevice ? '贴屏至 3D 硬件样机舞台' : '立为 2.5D 立体空间镜',
    }));
    await addQuickCanvasRigNode('spatial-stage', isDevice ? 'product' : 'environment', label, props, derivedFrom, placement);
  }

  async function bakeSpatialSourceToAiVideo(sourceKey: string, placement: Pt) {
    if (!onBakeSpatialVideo) return;
    const isEnt = sourceKey.startsWith('ent:');
    const isAsset = sourceKey.startsWith('asset:');
    const isComp = sourceKey.startsWith('comp:');
    const isShot = sourceKey.startsWith('shot:');
    const shotHit = isShot ? shots.find((s) => `shot:${s.id}` === sourceKey) : undefined;
    const vid = await onBakeSpatialVideo({
      vaultItemId: isEnt ? sourceKey.slice(4) : undefined,
      assetId: isAsset ? sourceKey.slice(6) : undefined,
      componentId: isComp ? sourceKey.slice(5) : undefined,
      clipId: shotHit?.anchorClip.id,
      durationSeconds: shotHit
        ? Math.max(2, Math.min(5, shotHit.duration / Math.max(1, sequence.fps)))
        : 3,
      placement,
    });
    if (vid) {
      const hasMotionModel = Boolean(
        settings?.models?.some(
          (m) => m.capabilities.includes('video') && modelInputCapabilities(m).supportsMotionVideo,
        ),
      );
      if (hasMotionModel || !onExtractVideoFrame) {
        await spawnGeneratorNode({
          use: 'video',
          action: 'motion-transfer',
          inputs: [{ nodeKey: `asset:${vid.id}`, slot: 'motion-video' }],
          prompt: '严格遵循 3D 预演视频中的摄像机运镜轨迹、建筑/主体透视与运动节奏，渲染电影级真实光影与质感',
          placement: { x: Math.round(placement.x + 306), y: Math.round(placement.y) },
        });
      } else {
        const firstFrame = await onExtractVideoFrame(vid.id, 'first', {
          x: Math.round(placement.x + 286),
          y: Math.round(placement.y),
        });
        await spawnGeneratorNode({
          use: 'video',
          action: 'image-to-video',
          inputs: firstFrame
            ? [{ nodeKey: `asset:${firstFrame.id}`, slot: 'first-frame' }]
            : [{ nodeKey: `asset:${vid.id}`, slot: 'source' }],
          prompt: '严格遵循 3D 预演运镜轨迹、建筑空间透视与光影层次，生成电影级写实动态镜头',
          placement: {
            x: Math.round(placement.x + (firstFrame ? 572 : 306)),
            y: Math.round(placement.y),
          },
        });
      }
    }
  }

  async function captureSpatialPairToAiVideo(sourceKey: string, placement: Pt) {
    if (!onCaptureSpatialPair) return;
    const isEnt = sourceKey.startsWith('ent:');
    const isAsset = sourceKey.startsWith('asset:');
    const isComp = sourceKey.startsWith('comp:');
    const isShot = sourceKey.startsWith('shot:');
    const shotHit = isShot ? shots.find((s) => `shot:${s.id}` === sourceKey) : undefined;
    const pair = await onCaptureSpatialPair({
      vaultItemId: isEnt ? sourceKey.slice(4) : undefined,
      assetId: isAsset ? sourceKey.slice(6) : undefined,
      componentId: isComp ? sourceKey.slice(5) : undefined,
      clipId: shotHit?.anchorClip.id,
      startBookmarkId: 'cam-a',
      endBookmarkId: 'cam-b',
      placement,
    });
    if (pair?.startAsset && pair?.endAsset) {
      await spawnGeneratorNode({
        use: 'video',
        action: 'first-last-video',
        inputs: [
          { nodeKey: `asset:${pair.startAsset.id}`, slot: 'first-frame' },
          { nodeKey: `asset:${pair.endAsset.id}`, slot: 'last-frame' },
        ],
        prompt:
          isComp || shotHit?.anchorClip.kind === 'code'
            ? '从 3D 开场首帧平滑运镜过渡至收尾末帧，保持建筑结构、空间透视与电影级真实光影严格连贯'
            : '从 A 机位构图平滑过渡到 B 机位过肩反打构图，保持角色站位、服装与三维透视严格连贯',
        placement: { x: Math.round(placement.x + 306), y: Math.round(placement.y) },
      });
    }
  }

  async function captureSpatialRefToAiImage(sourceKey: string, placement: Pt) {
    if (!onCaptureSpatialReference) return;
    const isEnt = sourceKey.startsWith('ent:');
    const isAsset = sourceKey.startsWith('asset:');
    const isComp = sourceKey.startsWith('comp:');
    const isShot = sourceKey.startsWith('shot:');
    const shotHit = isShot ? shots.find((s) => `shot:${s.id}` === sourceKey) : undefined;
    const isCodeTarget = isComp || shotHit?.anchorClip.kind === 'code';
    const res = await onCaptureSpatialReference({
      vaultItemId: isEnt ? sourceKey.slice(4) : undefined,
      assetId: isAsset ? sourceKey.slice(6) : undefined,
      componentId: isComp ? sourceKey.slice(5) : undefined,
      clipId: shotHit?.anchorClip.id,
      passes: isCodeTarget ? ['beauty'] : ['beauty', 'depth'],
      placement,
    });
    const first = res?.captured?.[0]?.asset || res?.asset;
    if (first) {
      const inputs: CanvasGeneratorInput[] = [{ nodeKey: `asset:${first.id}`, slot: 'scene' }];
      const depthItem = res?.captured?.find((c) => c.pass === 'depth')?.asset;
      if (depthItem) inputs.push({ nodeKey: `asset:${depthItem.id}`, slot: 'style' });
      await spawnGeneratorNode({
        use: 'image',
        action: 'image-edit',
        inputs,
        prompt: '严格遵循 3D 机位透视、空间结构与景深层次，重绘为高精度电影级实拍/建筑写实光影画面',
        placement: { x: Math.round(placement.x + 306), y: Math.round(placement.y) },
      });
    }
  }

  async function spawnSpatialMultiCamShots(sourceKey: string) {
    const ent = sourceKey.startsWith('ent:')
      ? upstreamEntities.find((e) => `ent:${e.id}` === sourceKey)
      : undefined;
    const asset = sourceKey.startsWith('asset:')
      ? project.assets.find((a) => `asset:${a.id}` === sourceKey)
      : undefined;
    if (!ent && !asset) return;
    const tail = sequence.clips.length
      ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
      : 0;
    const dur = Math.max(sequence.fps * 2, sequence.fps * 3);
    const baseProps: Record<string, unknown> = ent?.rig?.presetId
      ? { ...(ent.rig.props || {}), presetId: ent.rig.presetId }
      : { cameraPreset: 'orbit', cameraLens: 35 };
    const baseName = ent?.name || asset?.name || '空间摄影棚';
    const ops: EditOperation[] = DEFAULT_SPATIAL_BOOKMARKS.slice(0, 3).map((bm, idx) => ({
      type: 'addClip',
      sequenceId: sequence.id,
      clip: {
        id: uid('clip'),
        name: `${baseName} · ${bm.label}`,
        kind: 'shape',
        track: 'visual',
        layer: 0,
        start: tail + idx * dur,
        duration: dur,
        sourceIn: 0,
        assetId: asset?.id || ent?.assetId,
        locked: false,
        props: {
          ...clone(baseProps),
          activeBookmarkId: bm.id,
          cameraPreset: bm.cameraPreset,
          cameraLens: bm.cameraLens,
          cameraYaw: bm.cameraYaw,
          cameraPitch: bm.cameraPitch,
          cameraDistance: bm.cameraDistance,
          cameraPanX: bm.cameraPanX ?? 0,
          cameraPanY: bm.cameraPanY ?? 0,
        },
      },
    }));
    await onEdit(`一键派生 A/B/C 三机位分镜组「${baseName}」`, ops);
  }

  async function appendShotFromRigOrBlank(presetId?: string, fromItem?: VaultItem) {
    setAddMenuOpen(false);
    const tail = sequence.clips.length
      ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
      : 0;
    if (fromItem?.compound?.clips.length) {
      const { operations, primaryClipId } = instantiateCompoundVaultItemOperations(
        sequence.id,
        fromItem,
        tail,
        sequence.fps,
      );
      if (operations.length) {
        await onEdit(`置入复合资产「${fromItem.name}」`, operations);
        if (primaryClipId) onSelectClip(primaryClipId);
        onSeek(tail);
      }
      return;
    }
    let clip: Clip;
    if (fromItem?.rig?.presetId) {
      clip = createPresetClip(fromItem.rig.presetId, tail, sequence.fps, fromItem.rig.props || {}, project);
      clip.name = fromItem.name;
    } else if (presetId) {
      clip = createPresetClip(presetId, tail, sequence.fps, {}, project);
    } else {
      clip = {
        ...newClip('title', tail),
        track: 'visual',
        name: `镜头 ${String(shots.length + 1).padStart(2, '0')}`,
        duration: Math.round(sequence.fps * 4),
        props: {
          text: `镜头 ${shots.length + 1}`,
          fontSize: 58,
          color: '#f4f4f6',
          background: '#121316',
          position: 'center',
          align: 'center',
          animation: 'none',
        },
      };
    }
    clip.track = 'visual';
    if (fromItem && !fromItem.rig?.presetId) {
      const defVar =
        fromItem.variants?.find((v) => v.id === (activeVarByEnt[fromItem.id] || fromItem.defaultVariantId)) ||
        fromItem.variants?.[0];
      const aid = defVar?.assetId || fromItem.assetId;
      if (aid) {
        clip.kind = 'image';
        clip.assetId = aid;
      } else if (fromItem.entityKind === 'text' && fromItem.textContent) {
        clip.props.text = fromItem.textContent.slice(0, 32);
        clip.shotNotes = fromItem.textContent;
      }
      clip.subjectBindings = [{ entityId: fromItem.id, variantId: defVar?.id, pinnedVersion: fromItem.version }];
      clip.subjectIds = [fromItem.id];
      clip.name = defVar ? `${fromItem.name} · ${defVar.name}` : fromItem.name;
    }
    await onEdit(`新增镜头 #${shots.length + 1}`, [{ type: 'addClip', sequenceId: sequence.id, clip }]);
    onSelectClip(clip.id);
    onSeek(clip.start);
  }

  async function addShotCandidateTake(
    shot: CompositeShot,
    variant: 'clone' | 'seecode-architecture' | 'tinycharts-state' | 'teardown-3d' | 'screen-focus-rig',
  ) {
    const clip = shot.anchorClip;
    const nextIdx = (clip.takes?.length ? clip.takes.length : 1) + 1;
    let take: ClipTake;
    if (variant === 'clone') {
      take = {
        id: uid('take'),
        label: `T${nextIdx} · 副本`,
        kind: clip.kind,
        sourceIn: clip.sourceIn,
        assetId: clip.assetId,
        componentId: clip.componentId,
        props: clone(clip.props),
        createdAt: new Date().toISOString(),
      };
    } else {
      const pClip = createPresetClip(
        variant,
        clip.start,
        sequence.fps,
        {
          text: shot.scriptText.slice(0, 22) || String(clip.props.text || clip.name),
        },
        project,
      );
      const tagMap: Record<string, string> = {
        'seecode-architecture': '流程对比',
        'tinycharts-state': '手绘推演',
        'teardown-3d': '三维结构',
        'screen-focus-rig': '设备特写',
      };
      take = {
        id: uid('take'),
        label: `T${nextIdx} · ${tagMap[variant] || '候选'}`,
        kind: pClip.kind,
        sourceIn: 0,
        props: clone(pClip.props),
        createdAt: new Date().toISOString(),
      };
    }
    setTakeMenuFor(null);
    await onEdit(`新增镜头 #${shot.index} 候选 ${take.label}`, [
      { type: 'addClipTake', sequenceId: sequence.id, clipId: clip.id, take, activate: true },
    ]);
  }

  async function submitSubjectModal(e: React.FormEvent) {
    e.preventDefault();
    if (!subjectModal) return;
    const now = new Date().toISOString();
    if (subjectModal.mode === 'variant' && subjectModal.entId) {
      const target = upstreamEntities.find((x) => x.id === subjectModal.entId);
      if (!target) return;
      const nv: AssetVariant = {
        id: uid('var'),
        name: subjVar.trim() || `状态 ${(target.variants?.length || 1) + 1}`,
        version: 1,
        assetId: subjRef || undefined,
        promptDelta: subjDesc.trim() || undefined,
        tags: [],
        updatedAt: now,
      };
      const vars = [...(target.variants || []), nv];
      await onEdit(`新增状态「${nv.name}」`, [
        {
          type: 'putVaultItem',
          item: { ...clone(target), variants: vars, version: target.version + 1, updatedAt: now },
        },
      ]);
      setActiveVarByEnt((s) => ({ ...s, [target.id]: nv.id }));
    } else if (subjName.trim()) {
      const vid = uid('var');
      const item: VaultItem = {
        id: uid('pvault'),
        name: subjName.trim(),
        entityKind: 'image',
        role: subjRole,
        tags: [],
        category: 'subject',
        subkind: subjRole,
        promptAnchor: subjDesc.trim() || `${subjName.trim()}，跨镜头保持外观特征一致`,
        assetId: subjRef || undefined,
        assetKind: subjRef ? 'image' : undefined,
        defaultVariantId: vid,
        variants: [
          {
            id: vid,
            name: subjVar.trim() || '默认状态',
            version: 1,
            assetId: subjRef || undefined,
            promptDelta: subjDesc.trim() || undefined,
            tags: [],
            updatedAt: now,
          },
        ],
        version: 1,
        updatedAt: now,
      };
      await onEdit(`创建设定节点「${item.name}」`, [{ type: 'putVaultItem', item }]);
      setSelectedNodeIds([`ent:${item.id}`]);
    }
    setSubjectModal(null);
    setSubjName('');
    setSubjDesc('');
  }

  // Handle wire drop onto any target node (supports bidirectional & cross-kind wiring)
  const completeWireToNode = useCallback(
    async (fromKey: string, toKey: string) => {
      if (fromKey === toKey) return;
      // 0. Any upstream asset/entity/shot -> Generator Node (typed input slot!)
      if (toKey.startsWith('gen:') && !fromKey.startsWith('gen:')) {
        const genId = toKey.slice(4);
        const targetGen = canvasGenerators.find((g) => g.id === genId);
        if (!targetGen) return;
        if (targetGen.inputs.some((x) => x.nodeKey === fromKey)) return;
        let slot: CanvasGeneratorInput['slot'] = 'source';
        let nextActionPatch: Partial<CanvasGeneratorNode> = {};
        if (fromKey.startsWith('ent:')) {
          const ent = upstreamEntities.find((e) => `ent:${e.id}` === fromKey);
          if (ent?.entityKind === 'text') slot = 'prompt-text';
          else if (targetGen.use === 'video') {
            const isPerf =
              targetGen.action === 'motion-transfer' ||
              targetGen.action === 'character-replace' ||
              targetGen.action === 'lip-sync';
            slot = isPerf
              ? 'subject'
              : targetGen.inputs.some((x) => x.slot === 'first-frame')
                ? targetGen.inputs.some((x) => x.slot === 'last-frame')
                  ? 'subject'
                  : 'last-frame'
                : 'first-frame';
          } else if (ent?.role === 'environment') slot = 'scene';
          else if (ent?.role === 'visual-style') slot = 'style';
          else slot = 'subject';
        } else if (fromKey.startsWith('asset:') || fromKey.startsWith('shot:')) {
          const a = fromKey.startsWith('asset:')
            ? project.assets.find((x) => `asset:${x.id}` === fromKey)
            : undefined;
          if (a?.kind === 'video') {
            slot = 'motion-video';
            if (targetGen.action !== 'motion-transfer' && targetGen.action !== 'character-replace') {
              nextActionPatch = { use: 'video', action: 'motion-transfer', modelId: undefined };
            }
          } else if (a?.kind === 'audio') {
            slot = 'driver-audio';
            if (targetGen.action !== 'lip-sync') {
              nextActionPatch = { use: 'video', action: 'lip-sync', modelId: undefined };
            }
          } else if (targetGen.use === 'video') {
            const isPerf =
              targetGen.action === 'motion-transfer' ||
              targetGen.action === 'character-replace' ||
              targetGen.action === 'lip-sync';
            slot = isPerf
              ? 'subject'
              : targetGen.inputs.some((x) => x.slot === 'first-frame')
                ? targetGen.inputs.some((x) => x.slot === 'last-frame')
                  ? 'subject'
                  : 'last-frame'
                : 'first-frame';
          } else if (a?.role === 'environment' || a?.role === 'backdrop') slot = 'scene';
          else if (a?.role === 'visual-style') slot = 'style';
          else slot = 'subject';
        }
        const nextInputs = [...targetGen.inputs, { nodeKey: fromKey, slot }];
        await updateGeneratorNode(genId, { ...nextActionPatch, inputs: nextInputs });
        return;
      }
      // 1. Ent <-> Shot: subject / script / compound binding wire
      if (
        (fromKey.startsWith('ent:') && toKey.startsWith('shot:')) ||
        (fromKey.startsWith('shot:') && toKey.startsWith('ent:'))
      ) {
        const entKey = fromKey.startsWith('ent:') ? fromKey : toKey;
        const shotKey = fromKey.startsWith('shot:') ? fromKey : toKey;
        const ent = upstreamEntities.find((e) => `ent:${e.id}` === entKey);
        const targetShot = shots.find((s) => `shot:${s.id}` === shotKey);
        if (!ent || !targetShot || targetShot.locked) return;
        const vrId = activeVarByEnt[ent.id] || ent.defaultVariantId || ent.variants?.[0]?.id;
        const binding: ShotBinding = { entityId: ent.id, variantId: vrId, pinnedVersion: ent.version };
        await onEdit(`连线绑定 @${ent.name} 至镜头 #${targetShot.index}`, [
          {
            type: 'updateClip',
            sequenceId: sequence.id,
            clipId: targetShot.anchorClip.id,
            changes: {
              subjectBindings: [
                ...(targetShot.anchorClip.subjectBindings || []).filter((b) => b.entityId !== ent.id),
                binding,
              ],
              subjectIds: [...new Set([...(targetShot.anchorClip.subjectIds || []), ent.id])],
            },
          },
        ]);
        return;
      }
      // 2. Ent -> Asset: lineage reference onto media asset
      if (fromKey.startsWith('ent:') && toKey.startsWith('asset:')) {
        const ent = upstreamEntities.find((e) => `ent:${e.id}` === fromKey);
        const toAsset = project.assets.find((a) => `asset:${a.id}` === toKey);
        if (!ent || !toAsset) return;
        const prev = toAsset.derivedFrom || [];
        if (prev.some((d) => d.vaultItemId === ent.id)) return;
        const nextRefs: AssetLineageRef[] = [
          ...prev,
          { vaultItemId: ent.id, via: 'manual-ref', note: `@${ent.name}` },
        ];
        await onEdit(`建立 @${ent.name} → ${toAsset.name} 关联`, [
          { type: 'updateAssetMeta', assetId: toAsset.id, changes: { derivedFrom: nextRefs } },
        ]);
        return;
      }
      // 3. Asset -> Asset: reference / derived lineage wire
      if (fromKey.startsWith('asset:') && toKey.startsWith('asset:')) {
        const fromId = fromKey.slice(6);
        const srcAsset = project.assets.find((a) => a.id === fromId);
        const toAsset = project.assets.find((a) => `asset:${a.id}` === toKey);
        if (!toAsset) return;
        const prev = toAsset.derivedFrom || [];
        if (prev.some((d) => d.assetId === fromId)) return;
        const nextRefs: AssetLineageRef[] = [
          ...prev,
          { assetId: fromId, via: 'manual-ref', note: srcAsset ? srcAsset.name.slice(0, 14) : '参考关联' },
        ];
        await onEdit('建立素材参考连线', [
          { type: 'updateAssetMeta', assetId: toAsset.id, changes: { derivedFrom: nextRefs } },
        ]);
        return;
      }
      // 4. Asset -> Ent: attach lineage reference without hiding standalone asset
      if (fromKey.startsWith('asset:') && toKey.startsWith('ent:')) {
        const srcAsset = project.assets.find((a) => `asset:${a.id}` === fromKey);
        const ent = upstreamEntities.find((e) => `ent:${e.id}` === toKey);
        if (!srcAsset || !ent) return;
        const prev = ent.derivedFrom || [];
        if (prev.some((d) => d.assetId === srcAsset.id)) return;
        const nextEnt = clone(ent);
        nextEnt.derivedFrom = [
          ...prev,
          { assetId: srcAsset.id, via: 'manual-ref', note: srcAsset.name.slice(0, 14) },
        ];
        nextEnt.version = ent.version + 1;
        nextEnt.updatedAt = new Date().toISOString();
        await onEdit(`建立 ${srcAsset.name} → ${ent.name} 关联`, [{ type: 'putVaultItem', item: nextEnt }]);
        return;
      }
      // 5. Ent -> Ent: upstream lineage/reference between vault nodes
      if (fromKey.startsWith('ent:') && toKey.startsWith('ent:')) {
        const fromEnt = upstreamEntities.find((e) => `ent:${e.id}` === fromKey);
        const toEnt = upstreamEntities.find((e) => `ent:${e.id}` === toKey);
        if (!fromEnt || !toEnt) return;
        const prev = toEnt.derivedFrom || [];
        if (prev.some((d) => d.vaultItemId === fromEnt.id)) return;
        const nextEnt = clone(toEnt);
        nextEnt.derivedFrom = [
          ...prev,
          { vaultItemId: fromEnt.id, via: 'manual-ref', note: `@${fromEnt.name}` },
        ];
        nextEnt.version = toEnt.version + 1;
        nextEnt.updatedAt = new Date().toISOString();
        await onEdit(`建立 @${fromEnt.name} → @${toEnt.name} 关联`, [{ type: 'putVaultItem', item: nextEnt }]);
        return;
      }
      // 6. Asset -> Shot: audio inserts aligned to shot.start, visual replaces placeholder or overlays
      if (fromKey.startsWith('asset:') && toKey.startsWith('shot:')) {
        const a = project.assets.find((x) => `asset:${x.id}` === fromKey);
        const sh = shots.find((s) => `shot:${s.id}` === toKey);
        if (!a || !sh || sh.locked) return;
        if (a.kind === 'audio') {
          await onEdit(`为镜头 #${sh.index} 配属音频「${a.name}」`, [
            {
              type: 'addClip',
              sequenceId: sequence.id,
              clip: {
                ...newClip('audio', sh.start, a.id),
                name: a.name,
                audioAttachMode: 'shot',
                duration: Math.max(1, Math.min(sh.duration, Math.floor(a.duration * sequence.fps))),
              },
            },
          ]);
        } else if (sh.anchorClip.kind === 'title' && !sh.anchorClip.assetId) {
          await onEdit(`填充镜头 #${sh.index} 画面「${a.name}」`, [
            {
              type: 'updateClip',
              sequenceId: sequence.id,
              clipId: sh.anchorClip.id,
              changes: { kind: a.kind === 'video' ? 'video' : 'image', assetId: a.id, name: a.name },
            },
          ]);
        } else {
          await onEdit(`叠加素材至镜头 #${sh.index}`, [
            {
              type: 'addClip',
              sequenceId: sequence.id,
              clip: {
                ...newClip(a.kind === 'model-3d' ? 'shape' : a.kind, sh.start, a.id),
                track: 'overlay',
                name: a.name,
                duration: sh.duration,
              },
            },
          ]);
        }
        return;
      }
      // 7. Shot -> Asset: lineage reference back to asset
      if (fromKey.startsWith('shot:') && toKey.startsWith('asset:')) {
        const sh = shots.find((s) => `shot:${s.id}` === fromKey);
        const toAsset = project.assets.find((a) => `asset:${a.id}` === toKey);
        if (!sh || !toAsset) return;
        const shotMarker = `shot:${sh.id}`;
        const prev = toAsset.derivedFrom || [];
        if (prev.some((d) => d.vaultItemId === shotMarker)) return;
        const nextRefs: AssetLineageRef[] = [
          ...prev,
          {
            vaultItemId: shotMarker,
            ...(sh.anchorClip.assetId ? { assetId: sh.anchorClip.assetId } : {}),
            via: 'manual-ref',
            note: `镜头 #${sh.index}`,
          },
        ];
        await onEdit(`建立镜头 #${sh.index} → ${toAsset.name} 关联`, [
          { type: 'updateAssetMeta', assetId: toAsset.id, changes: { derivedFrom: nextRefs } },
        ]);
        return;
      }
      // 8. From Component -> Shot: add code overlay aligned to shot
      if (fromKey.startsWith('comp:') && toKey.startsWith('shot:')) {
        const comp = standaloneComponents.find((c) => `comp:${c.id}` === fromKey);
        const sh = shots.find((s) => `shot:${s.id}` === toKey);
        if (!comp || !sh || sh.locked) return;
        await onEdit(`挂载组件「${comp.name}」到镜头 #${sh.index}`, [
          {
            type: 'addClip',
            sequenceId: sequence.id,
            clip: {
              ...newClip('code', sh.start),
              track: 'overlay',
              duration: sh.duration,
              name: comp.name,
              componentId: comp.id,
              props: { ...comp.props },
            },
          },
        ]);
        return;
      }
      // 9. Shot -> Shot: append continuity reference note if unlocked
      if (fromKey.startsWith('shot:') && toKey.startsWith('shot:')) {
        const fromShot = shots.find((s) => `shot:${s.id}` === fromKey);
        const toShot = shots.find((s) => `shot:${s.id}` === toKey);
        if (!fromShot || !toShot || toShot.locked) return;
        const tag = `衔接镜头 #${fromShot.index}`;
        const prevNote = toShot.anchorClip.shotNotes || '';
        if (prevNote.includes(tag)) return;
        await onEdit(`建立分镜衔接 #${fromShot.index} → #${toShot.index}`, [
          {
            type: 'updateClip',
            sequenceId: sequence.id,
            clipId: toShot.anchorClip.id,
            changes: { shotNotes: prevNote ? `${prevNote} · ${tag}` : tag },
          },
        ]);
      }
    },
    [
      canvasGenerators,
      updateGeneratorNode,
      upstreamEntities,
      shots,
      activeVarByEnt,
      project.assets,
      standaloneComponents,
      sequence.id,
      sequence.fps,
      onEdit,
    ],
  );

  const screenToWorld = useCallback((cx: number, cy: number): Pt | null => {
    const vpRect = viewportRef.current?.getBoundingClientRect();
    if (!vpRect) return null;
    return {
      x: (cx - vpRect.left - panRef.current.x) / zoomRef.current,
      y: (cy - vpRect.top - panRef.current.y) / zoomRef.current,
    };
  }, []);

  const findHitNodeKey = useCallback(
    (cx: number, cy: number, excludeKey: string): string | null => {
      const wPt = screenToWorld(cx, cy);
      if (wPt) {
        const entries = Object.entries(layoutRef.current);
        for (let i = entries.length - 1; i >= 0; i--) {
          const [k, p] = entries[i];
          if (k === excludeKey) continue;
          const sz = nodeSizeFor(k);
          if (wPt.x >= p.x - 14 && wPt.x <= p.x + sz.w + 14 && wPt.y >= p.y - 14 && wPt.y <= p.y + sz.h + 14) {
            return k;
          }
        }
      }
      const el = document.elementFromPoint(cx, cy);
      const targetEl = el?.closest('[data-node-id]') as HTMLElement | null;
      const k = targetEl?.dataset.nodeId;
      return k && k !== excludeKey ? k : null;
    },
    [screenToWorld, nodeSizeFor],
  );

  const startWireDrag = (e: React.PointerEvent<HTMLElement>, fromNodeId: string, side: PortSide = 'right') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pos = layoutRef.current[fromNodeId] || layout[fromNodeId];
    if (!pos) return;
    const sz = nodeSizeFor(fromNodeId);
    const x1 = side === 'left' ? pos.x - 2 : pos.x + sz.w + 2;
    const y1 = pos.y + Math.min(86, sz.h * 0.5);
    const startWorld = screenToWorld(e.clientX, e.clientY);
    const initX2 = startWorld ? startWorld.x : x1 + (side === 'left' ? -24 : 24);
    const initY2 = startWorld ? startWorld.y : y1;
    setWireDrag({ fromNodeId, side, x1, y1, x2: initX2, y2: initY2 });
    startManagedDrag(
      pointerDrag(
        e,
        (mx, my) => {
          const wPt = screenToWorld(mx, my);
          if (wPt) {
            setWireDrag({ fromNodeId, side, x1, y1, x2: wPt.x, y2: wPt.y });
          }
          setWireHoverKey(findHitNodeKey(mx, my, fromNodeId));
        },
        (upX, upY) => {
          const hitKey = findHitNodeKey(upX, upY, fromNodeId);
          setWireHoverKey(null);
          setWireDrag(null);
          if (hitKey) {
            void completeWireToNode(fromNodeId, hitKey);
          } else {
            const vpRect = viewportRef.current?.getBoundingClientRect();
            if (vpRect) {
              const worldX = Math.round((upX - vpRect.left - panRef.current.x) / zoomRef.current);
              const worldY = Math.round((upY - vpRect.top - panRef.current.y) / zoomRef.current);
              setDropMenu({
                sourceKey: fromNodeId,
                worldX,
                worldY,
                screenX: Math.min(vpRect.width - 200, Math.max(16, upX - vpRect.left)),
                screenY: Math.min(vpRect.height - 180, Math.max(16, upY - vpRect.top)),
              });
            }
          }
        },
        'crosshair',
      ),
    );
  };

  // Drag anywhere on node card/header to reposition node(s) cleanly past 4px threshold
  const handleNodePointerDown = (e: React.PointerEvent<HTMLElement>, nodeKey: string, origPos: Pt) => {
    if (e.button !== 0) return;
    if (
      (e.target as HTMLElement).closest(
        'button, input, textarea, select, [role="slider"], .cc-port, .cc-popover, .cc-audio-wave, .cc-node-toolbar',
      )
    ) {
      return;
    }
    e.stopPropagation();
    setRigPopoverFor(null);
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      return;
    }
    const targetEl = e.target as HTMLElement;
    const isPreviewArea = Boolean(targetEl.closest('.cc-node-visual, .cc-node-card.asset-card'));
    const now = Date.now();
    if (
      isPreviewArea &&
      lastCardDownRef.current?.key === nodeKey &&
      now - lastCardDownRef.current.time < 260 &&
      Math.hypot(e.clientX - lastCardDownRef.current.x, e.clientY - lastCardDownRef.current.y) < 8
    ) {
      e.preventDefault();
      lastCardDownRef.current = null;
      setQuickLookKey(nodeKey);
      return;
    }
    lastCardDownRef.current = isPreviewArea
      ? { key: nodeKey, time: now, x: e.clientX, y: e.clientY }
      : null;
    const movingKeys = selectedIdsRef.current.includes(nodeKey) ? selectedIdsRef.current : [nodeKey];
    const origMap = new Map<string, Pt>();
    for (const k of movingKeys) {
      origMap.set(k, { ...(layoutRef.current[k] || origPos) });
    }
    const sx = e.clientX;
    const sy = e.clientY;
    let dragged = false;
    startManagedDrag(
      pointerDrag(
        e,
        (mx, my) => {
          if (!dragged && Math.hypot(mx - sx, my - sy) <= 4) return;
          if (!dragged) {
            dragged = true;
            suppressNextClickRef.current = true;
            if (!selectedIdsRef.current.includes(nodeKey)) setSelectedNodeIds([nodeKey]);
          }
          const dx = Math.round((mx - sx) / zoomRef.current);
          const dy = Math.round((my - sy) / zoomRef.current);
          const next = { ...nodePositionsRef.current };
          for (const [k, op] of origMap) {
            next[k] = { x: op.x + dx, y: op.y + dy };
          }
          nodePositionsRef.current = next;
          setNodePositions(next);
        },
        () => {
          if (dragged) {
            requestAnimationFrame(() => {
              suppressNextClickRef.current = false;
            });
            void onEdit('更新画布节点布局', [
              { type: 'updateProject', changes: { canvasLayout: nodePositionsRef.current } },
            ]);
          }
        },
        'grabbing',
      ),
    );
  };

  const handleNodeCardClick = (e: React.MouseEvent, nodeKey: string, clipToSelect?: string) => {
    e.stopPropagation();
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setContextMenu(null);
    setDropMenu(null);
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelectedNodeIds((prev) =>
        prev.includes(nodeKey) ? prev.filter((k) => k !== nodeKey) : [...prev, nodeKey],
      );
      return;
    }
    setSelectedNodeIds([nodeKey]);
    if (clipToSelect) onSelectClip(clipToSelect);
  };

  useEffect(() => {
    // Also clean up fork popover when selection resets externally
  }, []);

  const startShotReorderDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, fromShot: CompositeShot) => {
      if (e.button !== 0 || fromShot.locked || shots.length < 2) return;
      e.stopPropagation();
      const fromIdx = shots.findIndex((s) => s.id === fromShot.id);
      if (fromIdx < 0) return;

      let latestTarget: { targetShotId: string | null; side: 'before' | 'after' } = {
        targetShotId: null,
        side: 'before',
      };
      setShotReorderDrag({ fromShotId: fromShot.id, targetShotId: null, side: 'before' });

      const hitShotSlot = (cx: number, cy: number): { targetShotId: string | null; side: 'before' | 'after' } => {
        const wPt = screenToWorld(cx, cy);
        if (!wPt) return { targetShotId: null, side: 'before' };
        let best: { shotId: string; dist: number; side: 'before' | 'after' } | null = null;
        for (const sh of shots) {
          if (sh.id === fromShot.id || sh.locked) continue;
          const p = layoutRef.current[`shot:${sh.id}`];
          if (!p) continue;
          const cxCard = p.x + 144;
          const cyCard = p.y + 102;
          const dx = wPt.x - cxCard;
          const dy = wPt.y - cyCard;
          // Within generous capture zone around a shot card
          if (Math.abs(dx) <= 172 && Math.abs(dy) <= 135) {
            const dist = Math.hypot(dx, dy);
            if (!best || dist < best.dist) {
              best = { shotId: sh.id, dist, side: dx < 0 ? 'before' : 'after' };
            }
          }
        }
        return best ? { targetShotId: best.shotId, side: best.side } : { targetShotId: null, side: 'before' };
      };

      startManagedDrag(
        pointerDrag(
          e,
          (mx, my) => {
            const next = hitShotSlot(mx, my);
            if (next.targetShotId !== latestTarget.targetShotId || next.side !== latestTarget.side) {
              latestTarget = next;
              setShotReorderDrag({ fromShotId: fromShot.id, ...next });
            }
          },
          () => {
            const drop = latestTarget;
            setShotReorderDrag(null);
            if (!drop.targetShotId) return;
            const targetIdx = shots.findIndex((s) => s.id === drop.targetShotId);
            if (targetIdx < 0) return;
            let insertIdx = drop.side === 'before' ? targetIdx : targetIdx + 1;
            if (fromIdx < insertIdx) insertIdx -= 1;
            insertIdx = Math.max(0, Math.min(shots.length - 1, insertIdx));
            if (insertIdx === fromIdx) return;
            const ops = reorderCompositeShotOperations(sequence, shots, fromShot.id, insertIdx);
            if (!ops.length) return;
            // If affected shots had manual canvasLayout positions, remap them cleanly so cards match new order
            const saved = nodePositionsRef.current;
            const lo = Math.min(fromIdx, insertIdx);
            const hi = Math.max(fromIdx, insertIdx);
            const slice = shots.slice(lo, hi + 1);
            if (slice.some((sh) => Boolean(saved[`shot:${sh.id}`]))) {
              const slotPts = slice.map((sh) => layoutRef.current[`shot:${sh.id}`] || saved[`shot:${sh.id}`]);
              const reordered = [...slice];
              const [moved] = reordered.splice(fromIdx - lo, 1);
              reordered.splice(insertIdx - lo, 0, moved);
              const nextLayout = { ...saved };
              reordered.forEach((sh, i) => {
                if (slotPts[i]) nextLayout[`shot:${sh.id}`] = slotPts[i];
              });
              nodePositionsRef.current = nextLayout;
              setNodePositions(nextLayout);
              ops.push({ type: 'updateProject', changes: { canvasLayout: nextLayout } });
            }
            void onEdit(`拖拽重排镜头 #${fromShot.index} → #${insertIdx + 1}`, ops);
          },
          'grabbing',
        ),
      );
    },
    [shots, sequence, screenToWorld, startManagedDrag, onEdit],
  );

  // Compute SVG Bezier Wires: Bindings + Asset/Entity Lineage + Shot Clips + Live Ghost Wires with Adaptive Ports
  const wires = useMemo(() => {
    const list: CanvasWireItem[] = [];
    const selSet = new Set(selectedNodeIds);
    const pushWire = (
      base: Omit<CanvasWireItem, 'x1' | 'y1' | 'x2' | 'y2' | 's1' | 's2' | 'active'>,
      overrideTo?: { pos: Pt; sz: { w: number; h: number } },
    ) => {
      const p1 = layout[base.fromKey];
      const p2 = overrideTo?.pos || layout[base.toKey];
      if (!p1 || !p2) return;
      const smart = computeSmartWire(
        p1,
        nodeSizeFor(base.fromKey),
        p2,
        overrideTo?.sz || nodeSizeFor(base.toKey),
      );
      list.push({
        ...base,
        ...smart,
        active: base.kind === 'ghost-generation' || selSet.has(base.fromKey) || selSet.has(base.toKey),
      });
    };

    // A) Entity -> Shot bindings
    for (const sh of visibleShots) {
      for (const b of sh.bindings) {
        const ent = upstreamEntities.find((x) => x.id === b.entityId);
        if (!ent) continue;
        const vr = ent.variants?.find((v) => v.id === b.variantId);
        pushWire({
          key: `${ent.id}->${sh.id}`,
          kind: 'binding',
          category: 'binding',
          semantic: 'binding',
          fromKey: `ent:${ent.id}`,
          toKey: `shot:${sh.id}`,
          label: vr ? `@${ent.name}:${vr.name}` : `@${ent.name}`,
          shotId: sh.id,
          clipId: sh.anchorClip.id,
          entityId: ent.id,
        });
      }
      // B) Standalone Asset -> Shot (clips aligned inside shot interval)
      for (const a of standaloneAssets) {
        const matchedClip = sequence.clips.find(
          (c) => c.assetId === a.id && c.start >= sh.start && c.start < sh.start + sh.duration,
        );
        if (matchedClip) {
          pushWire({
            key: `clip:${a.id}->${sh.id}`,
            kind: 'shot-clip',
            category: 'assembly',
            semantic: 'shot-clip',
            fromKey: `asset:${a.id}`,
            toKey: `shot:${sh.id}`,
            label: a.name.slice(0, 14),
            shotId: sh.id,
            clipId: sh.anchorClip.id,
            entityId: '',
            removeClipId: matchedClip.id,
          });
        }
      }
      // C) Standalone Component -> Shot
      for (const comp of standaloneComponents) {
        const matchedComp = sh.compositeClips.find((c) => c.componentId === comp.id);
        if (matchedComp) {
          pushWire({
            key: `comp:${comp.id}->${sh.id}`,
            kind: 'shot-clip',
            category: 'assembly',
            semantic: 'shot-clip',
            fromKey: `comp:${comp.id}`,
            toKey: `shot:${sh.id}`,
            label: '驱动画面',
            shotId: sh.id,
            clipId: sh.anchorClip.id,
            entityId: '',
            removeClipId: matchedComp.id,
          });
        }
      }
    }

    // C2) Sequence Narrative Flow: Shot[i] -> Shot[i+1]
    for (let i = 0; i < visibleShots.length - 1; i++) {
      const curSh = visibleShots[i];
      const nextSh = visibleShots[i + 1];
      pushWire({
        key: `seq:${curSh.id}->${nextSh.id}`,
        kind: 'sequence-flow',
        category: 'sequence',
        semantic: 'sequence',
        fromKey: `shot:${curSh.id}`,
        toKey: `shot:${nextSh.id}`,
        label: '',
        shotId: curSh.id,
        clipId: curSh.anchorClip.id,
        entityId: '',
      });
    }

    // D) Asset lineage: Asset/Ent/Shot/Gen -> Asset
    for (const a of standaloneAssets) {
      if (!a.derivedFrom?.length) continue;
      for (const ref of a.derivedFrom) {
        const fromKey =
          ref.vaultItemId?.startsWith('shot:') || ref.vaultItemId?.startsWith('gen:')
            ? ref.vaultItemId
            : ref.vaultItemId
              ? `ent:${ref.vaultItemId}`
              : ref.assetId
                ? `asset:${ref.assetId}`
                : '';
        if (!fromKey || !layout[fromKey]) continue;
        pushWire({
          key: `lin:${fromKey}->asset:${a.id}`,
          kind: 'asset-lineage',
          category: 'lineage',
          semantic: ref.via === 'first-last-frame' ? 'first-last' : 'lineage',
          fromKey,
          toKey: `asset:${a.id}`,
          shotId: '',
          clipId: '',
          entityId: '',
          sourceAssetId: ref.assetId,
          sourceVaultId: ref.vaultItemId,
          targetAssetId: a.id,
          isLineage: true,
          label: ref.note || ref.via || '关联',
        });
      }
    }

    // E) Entity lineage: Asset/Ent/Gen/Shot -> Ent
    for (const ent of upstreamEntities) {
      if (!ent.derivedFrom?.length) continue;
      for (const ref of ent.derivedFrom) {
        const fromKey =
          ref.vaultItemId?.startsWith('gen:') || ref.vaultItemId?.startsWith('shot:')
            ? ref.vaultItemId
            : ref.vaultItemId
              ? `ent:${ref.vaultItemId}`
              : ref.assetId
                ? `asset:${ref.assetId}`
                : '';
        if (!fromKey || !layout[fromKey]) continue;
        pushWire({
          key: `elin:${fromKey}->ent:${ent.id}`,
          kind: 'entity-lineage',
          category: 'lineage',
          semantic: 'lineage',
          fromKey,
          toKey: `ent:${ent.id}`,
          shotId: '',
          clipId: '',
          entityId: '',
          sourceAssetId: ref.assetId,
          sourceVaultId: ref.vaultItemId,
          targetEntId: ent.id,
          isLineage: true,
          label: ref.note || ref.via || '关联',
        });
      }
    }

    // F) Generator Node Typed Inputs: upstream -> gen:<id>
    for (const gen of visibleGenerators) {
      const toKey = `gen:${gen.id}`;
      if (!layout[toKey]) continue;
      for (const inp of gen.inputs) {
        if (!layout[inp.nodeKey]) continue;
        const isFirstLast = inp.slot === 'first-frame' || inp.slot === 'last-frame';
        pushWire({
          key: `genin:${inp.nodeKey}->${toKey}`,
          kind: 'generator-input',
          category: 'lineage',
          semantic: isFirstLast ? 'first-last' : 'gen-input',
          fromKey: inp.nodeKey,
          toKey,
          shotId: '',
          clipId: '',
          entityId: '',
          generatorId: gen.id,
          inputSlot: inp.slot,
          isLineage: true,
          label: SLOT_LABELS[inp.slot] || '输入',
        });
      }
    }

    // G) Live Ghost Generation Wires: upstream reference/source nodes -> in-place Ghost card
    for (const g of ghostJobs) {
      const isAudioGhost = g.job.canvas?.use === 'speech';
      const ghostSz = isAudioGhost ? { w: 248, h: 108 } : { w: 248, h: 162 };
      for (const srcKey of g.sourceKeys) {
        if (!layout[srcKey]) continue;
        pushWire(
          {
            key: `ghost:${srcKey}->${g.job.id}`,
            kind: 'ghost-generation',
            category: 'lineage',
            semantic: 'ghost',
            fromKey: srcKey,
            toKey: `ghost:${g.job.id}`,
            shotId: '',
            clipId: '',
            entityId: '',
            isLineage: true,
            label: '生成中',
          },
          { pos: g.pos, sz: ghostSz },
        );
      }
    }
    return list;
  }, [
    visibleShots,
    visibleGenerators,
    layout,
    upstreamEntities,
    standaloneAssets,
    standaloneComponents,
    sequence.clips,
    selectedNodeIds,
    nodeSizeFor,
    ghostJobs,
  ]);

  const filteredWires = useMemo(
    () => wires.filter((w) => w.kind === 'ghost-generation' || wireTypeFilter[w.category]),
    [wires, wireTypeFilter],
  );

  // Per-node connection counters (for subtle collapsed port badges <- N / N ->)
  const wireDegrees = useMemo(() => {
    const map = new Map<string, { inCount: number; outCount: number }>();
    const bump = (key: string, dir: 'in' | 'out') => {
      const cur = map.get(key) || { inCount: 0, outCount: 0 };
      if (dir === 'in') cur.inCount += 1;
      else cur.outCount += 1;
      map.set(key, cur);
    };
    for (const w of filteredWires) {
      if (w.kind === 'sequence-flow' || w.kind === 'ghost-generation') continue;
      bump(w.fromKey, 'out');
      bump(w.toKey, 'in');
    }
    return map;
  }, [filteredWires]);

  // Trace Spotlight graph (BFS upstream + downstream when user clicks any port counter badge)
  const traceGraph = useMemo(() => {
    if (!tracedNodeKey) return null;
    return computeTraceGraph(tracedNodeKey, filteredWires);
  }, [tracedNodeKey, filteredWires]);

  const toggleTraceNode = useCallback((nodeKey: string) => {
    setTracedNodeKey((prev) => (prev === nodeKey ? null : nodeKey));
  }, []);

  const isNodeDimmed = useCallback(
    (nodeKey: string) => Boolean(traceGraph && !traceGraph.nodeKeys.has(nodeKey)),
    [traceGraph],
  );

  // Semantic Zone bounding boxes & collapsed mosaic decks (3-B: 剧本与设定 / 探索工坊 / 成片分镜序列)
  const semanticZoneMeta = useMemo(() => {
    const buildPreviews = (keys: readonly string[]) => {
      const out: string[] = [];
      for (const k of keys) {
        if (out.length >= 3) break;
        if (k.startsWith('asset:')) {
          const a = project.assets.find((x) => `asset:${x.id}` === k);
          if (a?.thumbnail && !a.offline) out.push(mediaUrl(previewOrigin, a.id, true));
        } else if (k.startsWith('ent:')) {
          const e = upstreamEntities.find((x) => `ent:${x.id}` === k);
          const aid = e?.variants?.[0]?.assetId || e?.assetId;
          const a = aid ? project.assets.find((x) => x.id === aid) : undefined;
          if (a?.thumbnail && !a.offline) out.push(mediaUrl(previewOrigin, a.id, true));
        } else if (k.startsWith('shot:')) {
          const sh = shots.find((s) => `shot:${s.id}` === k);
          const a = sh?.anchorClip.assetId ? project.assets.find((x) => x.id === sh.anchorClip.assetId) : undefined;
          if (a?.thumbnail && !a.offline) out.push(mediaUrl(previewOrigin, a.id, true));
        }
      }
      return out;
    };

    const defs: {
      id: 'context' | 'explore' | 'shots';
      label: string;
      allKeys: string[];
      visibleKeys: string[];
      fallbackPos: Pt;
    }[] = [
      {
        id: 'context',
        label: '剧本与设定',
        allKeys: contextAllKeys,
        visibleKeys: [
          ...visibleUpstreamEntities.map((e) => `ent:${e.id}`),
          ...visibleStandaloneAssets.filter((a) => isContextAsset(a)).map((a) => `asset:${a.id}`),
        ],
        fallbackPos: { x: 40, y: CANVAS_LANE_TOP },
      },
      {
        id: 'explore',
        label: '探索工坊',
        allKeys: exploreAllKeys,
        visibleKeys: [
          ...visibleGenerators.map((g) => `gen:${g.id}`),
          ...visibleStandaloneAssets.filter((a) => !isContextAsset(a)).map((a) => `asset:${a.id}`),
          ...visibleStandaloneComponents.map((c) => `comp:${c.id}`),
        ],
        fallbackPos: { x: 40, y: CANVAS_LANE_TOP + 224 },
      },
      {
        id: 'shots',
        label: '成片分镜序列',
        allKeys: shots.map((s) => `shot:${s.id}`),
        visibleKeys: visibleShots.map((s) => `shot:${s.id}`),
        fallbackPos: { x: shotLaneX, y: CANVAS_LANE_TOP },
      },
    ];

    return defs.map((d) => {
      const collapsed = collapsedZoneSet.has(d.id);
      const pts = d.visibleKeys
        .map((k) => ({ pos: layout[k], sz: nodeSizeFor(k) }))
        .filter((x) => Boolean(x.pos));
      const frame =
        !collapsed && pts.length > 0
          ? {
              x: Math.min(...pts.map((p) => p.pos!.x)) - 22,
              y: Math.min(...pts.map((p) => p.pos!.y)) - 58,
              w: Math.max(...pts.map((p) => p.pos!.x + p.sz.w)) - Math.min(...pts.map((p) => p.pos!.x)) + 44,
              h: Math.max(...pts.map((p) => p.pos!.y + p.sz.h)) - Math.min(...pts.map((p) => p.pos!.y)) + 80,
            }
          : null;
      const savedAnchor = d.allKeys.map((k) => nodePositions[k]).find(Boolean) || d.fallbackPos;
      return {
        id: d.id,
        label: d.label,
        count: d.allKeys.length,
        collapsed,
        frame,
        deckPos: savedAnchor,
        previews: collapsed ? buildPreviews(d.allKeys) : [],
      };
    });
  }, [
    contextAllKeys,
    exploreAllKeys,
    shots,
    visibleUpstreamEntities,
    visibleStandaloneAssets,
    visibleStandaloneComponents,
    visibleGenerators,
    visibleShots,
    isContextAsset,
    collapsedZoneSet,
    layout,
    nodeSizeFor,
    nodePositions,
    shotLaneX,
    project.assets,
    upstreamEntities,
    previewOrigin,
  ]);

  const groupBoxes = useMemo(() => {
    return (project.canvasGroups || [])
      .filter((grp) => !grp.collapsed)
      .map((grp) => {
        const pts = grp.nodeIds
          .map((id) => ({ id, pos: layout[id], sz: nodeSizeFor(id) }))
          .filter((x) => Boolean(x.pos));
        if (!pts.length) return null;
        const minX = Math.min(...pts.map((p) => p.pos!.x)) - 16;
        const minY = Math.min(...pts.map((p) => p.pos!.y)) - 34;
        const maxX = Math.max(...pts.map((p) => p.pos!.x + p.sz.w)) + 16;
        const maxY = Math.max(...pts.map((p) => p.pos!.y + p.sz.h)) + 16;
        return { grp, x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      })
      .filter((x): x is { grp: CanvasGroup; x: number; y: number; w: number; h: number } => Boolean(x));
  }, [project.canvasGroups, layout, nodeSizeFor]);

  const quickLookNavKeys = useMemo(
    () => [
      ...visibleUpstreamEntities.map((e) => `ent:${e.id}`),
      ...visibleStandaloneAssets.map((a) => `asset:${a.id}`),
      ...shots.map((sh) => `shot:${sh.id}`),
    ],
    [visibleUpstreamEntities, visibleStandaloneAssets, shots],
  );

  const minimapDots = useMemo(() => {
    const entries = Object.entries(layout);
    if (!entries.length) return [];
    const xs = entries.map(([, p]) => p.x);
    const ys = entries.map(([, p]) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + 300;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + 220;
    const spanX = Math.max(400, maxX - minX);
    const spanY = Math.max(300, maxY - minY);
    return entries.map(([k, p]) => ({
      key: k,
      isShot: k.startsWith('shot:'),
      left: Math.min(90, Math.max(6, ((p.x - minX) / spanX) * 84 + 6)),
      top: Math.min(86, Math.max(8, ((p.y - minY) / spanY) * 76 + 8)),
    }));
  }, [layout]);

  const isEmpty = totalAssetCount === 0 && shots.length === 0;
  const activePanMode = canvasTool === 'pan' || spaceHeld;

  return (
    <div
      ref={viewportRef}
      className={`create-canvas-viewport ${activePanMode ? 'pan-mode' : 'select-mode'} ${wireDrag ? 'is-wiring' : ''}`}
      onPointerMove={(e) => {
        if (document.documentElement.dataset.glow === 'off') return;
        proximityPtRef.current = { x: e.clientX, y: e.clientY };
        if (proximityRafRef.current) return;
        proximityRafRef.current = requestAnimationFrame(() => {
          proximityRafRef.current = 0;
          const pt = proximityPtRef.current;
          const vp = viewportRef.current;
          if (!pt || !vp) return;
          const vpRect = vp.getBoundingClientRect();
          vp.style.setProperty('--vx', `${Math.round(pt.x - vpRect.left)}px`);
          vp.style.setProperty('--vy', `${Math.round(pt.y - vpRect.top)}px`);
          vp.dataset.pointerIn = '1';

          const radius = 195;
          const nextLit = new Set<HTMLElement>();
          const targets = vp.querySelectorAll<HTMLElement>(
            '.cc-node-card, .cc-left-rail, .cc-hud-pill, .cc-hud-btn, .cc-utility-pill',
          );
          for (let i = 0; i < targets.length; i++) {
            const el = targets[i];
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            if (
              pt.x >= r.left - radius &&
              pt.x <= r.right + radius &&
              pt.y >= r.top - radius &&
              pt.y <= r.bottom + radius
            ) {
              el.style.setProperty('--lx', `${Math.round(pt.x - r.left)}px`);
              el.style.setProperty('--ly', `${Math.round(pt.y - r.top)}px`);
              if (el.dataset.lit !== '1') el.dataset.lit = '1';
              nextLit.add(el);
            }
          }
          for (const prev of litElsRef.current) {
            if (!nextLit.has(prev)) delete prev.dataset.lit;
          }
          litElsRef.current = nextLit;
        });
      }}
      onPointerLeave={() => {
        if (proximityRafRef.current) {
          cancelAnimationFrame(proximityRafRef.current);
          proximityRafRef.current = 0;
        }
        proximityPtRef.current = null;
        if (viewportRef.current) delete viewportRef.current.dataset.pointerIn;
        for (const prev of litElsRef.current) delete prev.dataset.lit;
        litElsRef.current.clear();
      }}
      onWheel={(e) => {
        if ((e.target as HTMLElement).closest('textarea, input, select, .cc-popover')) return;
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.07 : 0.93;
          setZoom((z) => Math.max(0.45, Math.min(1.5, Number((z * factor).toFixed(2)))));
        } else {
          setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
        }
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('input, textarea, select')) return;
        e.preventDefault();
        setAddMenuOpen(false);
        setDropMenu(null);
        const vp = viewportRef.current?.getBoundingClientRect();
        if (!vp) return;
        const nodeEl = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null;
        const nodeKey = nodeEl?.dataset.nodeId;
        if (nodeKey && !selectedIdsRef.current.includes(nodeKey)) {
          setSelectedNodeIds([nodeKey]);
        }
        setContextMenu({
          clientX: Math.min(vp.width - 190, Math.max(12, e.clientX - vp.left)),
          clientY: Math.min(vp.height - 230, Math.max(12, e.clientY - vp.top)),
          nodeKey,
        });
      }}
      onDoubleClick={(e) => {
        if (
          (e.target as HTMLElement).closest(
            '.cc-node, .cc-bottom-dock, .cc-bottom-right-controls, .cc-utility-pill, .cc-top-hud, .cc-left-rail-wrap, .cc-popover, .cc-multi-bar, .cc-group-frame, .cc-group-stack, .cc-zone-frame, .cc-zone-stack, .cc-hidden-popover, .cc-quicklook-backdrop, .cc-animatic-backdrop',
          )
        ) {
          return;
        }
        const vp = viewportRef.current?.getBoundingClientRect();
        if (!vp) return;
        const wx = Math.round((e.clientX - vp.left - panRef.current.x) / zoomRef.current);
        const wy = Math.round((e.clientY - vp.top - panRef.current.y) / zoomRef.current);
        void createTextNode('', { x: wx - 110, y: wy - 60 });
      }}
      onPointerDown={(e) => {
        if (
          (e.target as HTMLElement).closest(
            '.cc-node, .cc-bottom-dock, .cc-bottom-right-controls, .cc-utility-pill, .cc-top-hud, .cc-left-rail-wrap, .cc-popover, .cc-empty-hero, .cc-multi-bar, .cc-zone-header, .cc-zone-stack, .cc-hidden-popover, .cc-group-header, .cc-group-stack, .cc-quicklook-backdrop, .cc-animatic-backdrop, button, input, textarea, select, audio',
          )
        ) {
          return;
        }
        if (e.button === 2) return;
        setContextMenu(null);
        setAddMenuOpen(false);
        setDropMenu(null);
        setTakeMenuFor(null);
        setRigPopoverFor(null);
        setForkSource(null);
        setRoleMenuFor(null);
        setDeriveMenuFor(null);

        const vp = viewportRef.current?.getBoundingClientRect();
        const shouldPan = activePanMode || e.button === 1;

        if (shouldPan) {
          if (spaceDownRef.current) spaceDownRef.current.panned = true;
          const startX = e.clientX - panRef.current.x;
          const startY = e.clientY - panRef.current.y;
          startManagedDrag(
            pointerDrag(
              e,
              (mx, my) => setPan({ x: mx - startX, y: my - startY }),
              undefined,
              'grabbing',
            ),
          );
          return;
        }

        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const baseIds = additive ? selectedIdsRef.current : [];

        startManagedDrag(
          pointerDrag(
            e,
            (mx, my) => {
              if (!vp) return;
              if (Math.hypot(mx - startClientX, my - startClientY) < 4) return;
              const x1 = Math.min(startClientX, mx) - vp.left;
              const y1 = Math.min(startClientY, my) - vp.top;
              const x2 = Math.max(startClientX, mx) - vp.left;
              const y2 = Math.max(startClientY, my) - vp.top;
              setMarquee({ x1, y1, x2, y2 });

              const wx1 = (x1 - panRef.current.x) / zoomRef.current;
              const wy1 = (y1 - panRef.current.y) / zoomRef.current;
              const wx2 = (x2 - panRef.current.x) / zoomRef.current;
              const wy2 = (y2 - panRef.current.y) / zoomRef.current;

              const hits: string[] = [...baseIds];
              for (const [k, pos] of Object.entries(layoutRef.current)) {
                const sz = nodeSizeFor(k);
                const intersects =
                  pos.x <= wx2 && pos.x + sz.w >= wx1 && pos.y <= wy2 && pos.y + sz.h >= wy1;
                if (intersects && !hits.includes(k)) hits.push(k);
              }
              setSelectedNodeIds(hits);
            },
            (mx, my) => {
              setMarquee(null);
              if (Math.hypot(mx - startClientX, my - startClientY) < 4 && !additive) {
                clearSelection();
              }
            },
            'crosshair',
          ),
        );
      }}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes('application/cocraft-asset') ||
          e.dataTransfer.types.includes('application/cocraft-entity')
        ) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        const assetToken = e.dataTransfer.getData('application/cocraft-asset');
        if (assetToken && !assetToken.startsWith('shot:')) {
          e.preventDefault();
          if (assetToken.startsWith('preset:')) {
            void appendShotFromRigOrBlank(assetToken.slice(7));
          } else if (assetToken.startsWith('vault:')) {
            const vId = assetToken.split(':')[1];
            const found = (project.vault || []).find((v) => v.id === vId);
            if (hiddenNodeSet.has(`ent:${vId}`)) {
              void restoreNodeKeysToCanvas([`ent:${vId}`]);
            }
            if (found) void appendShotFromRigOrBlank(undefined, found);
          } else {
            const media = project.assets.find((a) => a.id === assetToken);
            if (media) {
              const ops: EditOperation[] = [];
              if (hiddenNodeSet.has(`asset:${media.id}`)) {
                ops.push({
                  type: 'updateProject',
                  changes: { canvasHiddenNodeIds: hiddenNodeIds.filter((k) => k !== `asset:${media.id}`) },
                });
              }
              const tail = sequence.clips.length
                ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
                : 0;
              const c = {
                ...newClip(media.kind === 'model-3d' ? 'shape' : media.kind, tail, media.id),
                name: media.name,
                duration: Math.max(1, Math.floor((media.kind === 'image' ? 5 : media.duration) * sequence.fps)),
              };
              ops.push({ type: 'addClip', sequenceId: sequence.id, clip: c });
              void onEdit(`拖入镜头「${media.name}」`, ops);
            }
          }
        }
      }}
    >
      {/* Stationary Top Canvas View HUD (Zoom-independent: Filters, Collapsible Zones, 4-Type Wire Control, Animatic) */}
      {!isEmpty && (
        <CanvasTopHud
          assetFilter={assetFilter}
          onAssetFilterChange={setAssetFilter}
          counts={hudCounts}
          zones={semanticZoneMeta.map((z) => ({
            id: z.id,
            label: z.label,
            count: z.count,
            collapsed: z.collapsed,
          }))}
          onToggleZone={(zoneId) => void toggleSemanticZone(zoneId)}
          wireMode={wireMode}
          onWireModeChange={setWireMode}
          wireTypeFilter={wireTypeFilter}
          onToggleWireType={(cat) =>
            setWireTypeFilter((prev) => ({ ...prev, [cat]: !prev[cat] }))
          }
          hiddenEntries={hiddenAssetEntries}
          onRestoreHidden={(keys) => void restoreNodeKeysToCanvas(keys)}
          tracedInfo={
            tracedNodeKey && traceGraph
              ? {
                  label: collectRefsFromNodeKeys([tracedNodeKey])[0]?.label || '当前节点',
                  count: traceGraph.nodeKeys.size,
                }
              : null
          }
          onClearTrace={() => setTracedNodeKey(null)}
          shotCount={shots.length}
          totalDurationSec={shots.reduce((sum, s) => sum + s.duration, 0) / Math.max(1, sequence.fps)}
          onOpenAnimatic={() => setAnimaticOpen(true)}
          onSwitchToEdit={onSwitchToEdit}
        />
      )}

      {/* Left-Centered Vertical Darkroom Creation Rail (1-A) */}
      <CanvasLeftToolbar
        canvasTool={canvasTool}
        addMenuOpen={addMenuOpen}
        canGroupSelected={selectedNodeIds.length >= 2}
        onSelectTool={setCanvasTool}
        onToggleAddMenu={() => setAddMenuOpen((v) => !v)}
        onCloseAddMenu={() => setAddMenuOpen(false)}
        onCreateGenerator={(use, action) => void spawnGeneratorNode({ use, action })}
        onCreateTextNode={() => void createTextNode('')}
        onCreateRig3D={() => void addQuickCanvasRigNode('spatial-stage', 'environment', '统一空间摄影棚')}
        onImportMedia={onImportMedia}
        onAppendShot={() => void appendShotFromRigOrBlank()}
        onGroupSelected={() => void createGroupFromNodeKeys(selectedNodeIds)}
        onTidyCanvas={() => void tidyCanvasNodes()}
        onOpenStudioDialog={() => onOpenGeneration({ use: 'image' })}
      />

      {/* Top Floating Multi-Selection Smart Action Bar */}
      <CanvasMultiBar
        selectedNodeIds={selectedNodeIds}
        visualSelection={visualSelection}
        shots={shots}
        canAddToChat={Boolean(onAddRefsToChat)}
        canSaveClipsAsAsset={Boolean(onSaveClipsAsAsset)}
        onCollectRefs={collectRefsFromNodeKeys}
        onAddRefsToChat={onAddRefsToChat}
        onSpawnGeneratorNode={(opts) => void spawnGeneratorNode(opts)}
        onBridgeTwoVideos={
          onExtractVideoFrame
            ? async (vidAId, vidBId, anchorPt) => {
                const frameA = await onExtractVideoFrame(vidAId, 'last', {
                  x: Math.round(anchorPt.x),
                  y: Math.round(anchorPt.y - 70),
                });
                const frameB = await onExtractVideoFrame(vidBId, 'first', {
                  x: Math.round(anchorPt.x),
                  y: Math.round(anchorPt.y + 116),
                });
                if (frameA && frameB) {
                  await spawnGeneratorNode({
                    use: 'video',
                    action: 'first-last-video',
                    inputs: [
                      { nodeKey: `asset:${frameA.id}`, slot: 'first-frame' },
                      { nodeKey: `asset:${frameB.id}`, slot: 'last-frame' },
                    ],
                    prompt: '从前镜尾帧自然连贯运镜过渡到后镜首帧，无缝无缝衔接镜头运动',
                    placement: { x: Math.round(anchorPt.x + 306), y: Math.round(anchorPt.y) },
                  });
                }
              }
            : undefined
        }
        onCombineVisualAudio={(visualId, audioId) => {
          const vis = project.assets.find((a) => a.id === visualId);
          const aud = project.assets.find((a) => a.id === audioId);
          if (!vis || !aud) return;
          const { operations } = combineVisualAndAudioToShotOperations(sequence, vis, aud, {
            enableL1Cinema: vis.kind === 'image',
            wordHighlight: true,
          });
          if (operations.length) {
            void onEdit(`声画直合分镜「${vis.name}」`, operations);
          }
        }}
        onCreateSpatial25D={(imgIds, anchorPt) =>
          void createSpatialStageFromAssets(imgIds, 'parallax-25d', anchorPt)
        }
        onTriageAssets={onTriageAssets ? (ids) => void onTriageAssets(ids) : undefined}
        onAutoTagAssets={onAutoTagAssets ? (ids) => void onAutoTagAssets(ids) : undefined}
        onCreateGroup={(keys) => void createGroupFromNodeKeys(keys)}
        onPackNodes={(keys) => void packNodeKeys(keys, false)}
        onLinkNodes={(keys) => void linkSelectedNodes(keys)}
        onAppendToTimeline={(keys) => void appendSelectedNodesToTimeline(keys)}
        onHideNodes={(keys) => void hideNodeKeysFromCanvas(keys)}
        onDeleteNodes={(keys) => void deleteNodeKeysFromProject(keys)}
        onSaveClipsAsAsset={onSaveClipsAsAsset ? (clips) => void onSaveClipsAsAsset(clips) : undefined}
        onClearSelection={clearSelection}
      />

      {/* Marquee Selection Rectangle */}
      {marquee && (
        <div
          className="cc-marquee-box"
          style={{
            left: marquee.x1,
            top: marquee.y1,
            width: marquee.x2 - marquee.x1,
            height: marquee.y2 - marquee.y1,
          }}
        />
      )}

      {/* Drop-to-Create Contextual Popover (Spawns In-Canvas Generator Nodes directly at Drop Coords) */}
      {dropMenu && (
        <CanvasDropMenu
          dropMenu={dropMenu}
          project={project}
          sequence={sequence}
          upstreamEntities={upstreamEntities}
          shots={shots}
          activeVarByEnt={activeVarByEnt}
          textDrafts={textDrafts}
          onClose={() => setDropMenu(null)}
          onCollectRefs={collectRefsFromNodeKeys}
          onSpawnGeneratorNode={(opts) => void spawnGeneratorNode(opts)}
          onAppendShot={(ent) => void appendShotFromRigOrBlank(undefined, ent)}
          onAppendToTimeline={(keys) => void appendSelectedNodesToTimeline(keys)}
          onBakeSpatialToAiVideo={(sk, pt) => void bakeSpatialSourceToAiVideo(sk, pt)}
          onCapturePairToAiVideo={(sk, pt) => void captureSpatialPairToAiVideo(sk, pt)}
          onCaptureRefToAiImage={(sk, pt) => void captureSpatialRefToAiImage(sk, pt)}
          onSpawnSpatialMultiCam={(sk) => void spawnSpatialMultiCamShots(sk)}
          onEdit={onEdit}
        />
      )}

      {/* One-Click Side-by-Side Variant Fork Popover */}
      {forkSource && (
        <CanvasForkPopover
          source={forkSource}
          project={project}
          settings={settings}
          onClose={() => setForkSource(null)}
          onJobsStarted={onJobsStarted}
          onOpenGeneration={onOpenGeneration}
        />
      )}

      {/* Right-Click TapNow Context Menu */}
      {contextMenu && (
        <CanvasContextMenu
          contextMenu={contextMenu}
          selectedNodeIds={selectedNodeIds}
          pan={panRef.current}
          zoom={zoomRef.current}
          canUndo={canUndo}
          canRedo={canRedo}
          collectRefsFromNodeKeys={collectRefsFromNodeKeys}
          onAddRefsToChat={onAddRefsToChat}
          onCreateGroup={createGroupFromNodeKeys}
          onPackNodes={packNodeKeys}
          onExportMaterialPack={onExportMaterialPack}
          onDeleteNodes={deleteNodeKeysFromProject}
          onClearSelection={clearSelection}
          onImportMedia={onImportMedia}
          onCreateTextNode={createTextNode}
          onOpenNewSubject={() => setSubjectModal({ mode: 'new' })}
          onAppendShot={() => appendShotFromRigOrBlank()}
          onUndo={onUndo}
          onRedo={onRedo}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Subject / Variant Floating Popover */}
      {subjectModal && (
        <CanvasSubjectModal
          modal={subjectModal}
          imageAssets={project.assets.filter((a) => a.kind === 'image')}
          subjRole={subjRole}
          subjName={subjName}
          subjVar={subjVar}
          subjRef={subjRef}
          subjDesc={subjDesc}
          onChangeRole={setSubjRole}
          onChangeName={setSubjName}
          onChangeVar={setSubjVar}
          onChangeRef={setSubjRef}
          onChangeDesc={setSubjDesc}
          onSubmit={submitSubjectModal}
          onClose={() => setSubjectModal(null)}
        />
      )}

      {/* Clean Starter Guide on Empty Canvas (3-Min First-Film Mainlines) */}
      {isEmpty && !subjectModal && (
        <CanvasStarterGuide
          settings={settings}
          onStartSpatialDirector={() => {
            void addQuickCanvasRigNode(
              'spatial-stage',
              'environment',
              '3D 导演摄影棚',
              { sceneType: 'previs-blocking', environmentPreset: 'rooftop-night', actorAction: 'walk', actorPath: 'approach' },
              undefined,
              undefined,
              !onOpenSpatialDirector,
            ).then((item) => {
              if (onOpenSpatialDirector) {
                onOpenSpatialDirector({ kind: 'vault', vaultItemId: item.id });
              }
            });
          }}
          onCreateScriptNode={() => void createTextNode('')}
          onStartCodeMotion={() =>
            void addQuickCanvasRigNode('whiteboard-sketch', 'whiteboard', '可编程科普图解')
          }
          onImportAndEdit={onImportMedia}
          onCreateSubject={() => setSubjectModal({ mode: 'new' })}
          onOpenQuickSetup={onOpenQuickSetup}
        />
      )}

      {/* Transformed Infinite World Layer */}
      <div
        className="cc-world"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* Spatial Canvas Groups & Semantic Collapsible Zone Frames */}
        <CanvasFramesLayer
          groupBoxes={groupBoxes}
          collapsedGroups={collapsedGroups}
          semanticZoneMeta={semanticZoneMeta}
          editingGroupId={editingGroupId}
          groupNameDraft={groupNameDraft}
          onGroupHeaderPointerDown={(e, grp) => {
            if ((e.target as HTMLElement).closest('button, input')) return;
            e.stopPropagation();
            const now = Date.now();
            if (lastGroupDownRef.current?.id === grp.id && now - lastGroupDownRef.current.time < 380) {
              e.preventDefault();
              lastGroupDownRef.current = null;
              setEditingGroupId(grp.id);
              setGroupNameDraft(grp.name);
              return;
            }
            lastGroupDownRef.current = { id: grp.id, time: now };
            const origMap = new Map<string, Pt>();
            for (const id of grp.nodeIds) {
              if (layoutRef.current[id]) origMap.set(id, { ...layoutRef.current[id] });
            }
            const sx = e.clientX;
            const sy = e.clientY;
            startManagedDrag(
              pointerDrag(
                e,
                (mx, my) => {
                  const dx = Math.round((mx - sx) / zoomRef.current);
                  const dy = Math.round((my - sy) / zoomRef.current);
                  const next = { ...nodePositionsRef.current };
                  for (const [k, op] of origMap) next[k] = { x: op.x + dx, y: op.y + dy };
                  nodePositionsRef.current = next;
                  setNodePositions(next);
                },
                (mx, my) => {
                  if (mx !== sx || my !== sy) {
                    void onEdit('移动画布分组', [
                      { type: 'updateProject', changes: { canvasLayout: nodePositionsRef.current } },
                    ]);
                  }
                },
                'grabbing',
              ),
            );
          }}
          onStartRenameGroup={(grp) => {
            setEditingGroupId(grp.id);
            setGroupNameDraft(grp.name);
          }}
          onChangeGroupNameDraft={setGroupNameDraft}
          onCommitRenameGroup={renameCanvasGroup}
          onCancelRenameGroup={() => setEditingGroupId(null)}
          onToggleCollapseGroup={toggleCollapseGroup}
          onDissolveGroup={(groupId) =>
            onEdit('解散分组', [
              {
                type: 'updateProject',
                changes: { canvasGroups: (project.canvasGroups || []).filter((g) => g.id !== groupId) },
              },
            ])
          }
          collectRefsFromNodeKeys={collectRefsFromNodeKeys}
          onAddRefsToChat={onAddRefsToChat}
          onPackNodes={packNodeKeys}
          onToggleSemanticZone={toggleSemanticZone}
        />

        {/* 1px Curved Bezier Relationship Wires (Focus Mode Default + 4 Semantic Categories + Trace Spotlight) */}
        <CanvasWiresSvg
          wires={filteredWires}
          hoveredNodeKey={hoveredNodeKey}
          wireDrag={wireDrag}
          wireMode={wireMode}
          tracedWireKeys={traceGraph?.wireKeys || null}
        />

        {/* Vault Entities: Text Nodes, Compound Saved Clips, Consistency Subjects & Dynamic Rigs */}
        {visibleUpstreamEntities.map((ent) => {
          const nodeKey = `ent:${ent.id}`;
          const pos = layout[nodeKey] || { x: 40, y: 44 };
          return (
            <CanvasVaultCard
              key={nodeKey}
              ent={ent}
              nodeKey={nodeKey}
              pos={pos}
              selected={selectedNodeIds.includes(nodeKey)}
              isPrimarySelected={primarySelectedId === nodeKey && selectedNodeIds.length === 1}
              isWireTarget={wireHoverKey === nodeKey}
              isDimmed={isNodeDimmed(nodeKey)}
              deg={wireDegrees.get(nodeKey)}
              project={project}
              sequence={sequence}
              previewOrigin={previewOrigin}
              upstreamEntities={upstreamEntities}
              activeVariantId={activeVarByEnt[ent.id]}
              textDraft={textDrafts[ent.id]}
              rigExplodeDraft={rigExplodeDrafts[ent.id]}
              voicePopoverOpen={voicePopoverFor === ent.id}
              rigPopoverOpen={rigPopoverFor === ent.id}
              onHoverChange={(h) => setHoveredNodeKey((k) => (h ? nodeKey : k === nodeKey ? null : k))}
              onPointerDown={(e) => handleNodePointerDown(e, nodeKey, pos)}
              onClick={(e) => handleNodeCardClick(e, nodeKey)}
              onStartWireDrag={(e, side) => startWireDrag(e, nodeKey, side)}
              onToggleTrace={() => toggleTraceNode(nodeKey)}
              onSelectVariant={(variantId) => setActiveVarByEnt((s) => ({ ...s, [ent.id]: variantId }))}
              onTextDraftChange={(val) => setTextDrafts((prev) => ({ ...prev, [ent.id]: val }))}
              onTextDraftClear={(expectedVal) =>
                setTextDrafts((prev) => {
                  if (!(ent.id in prev)) return prev;
                  if (expectedVal !== undefined && prev[ent.id] !== expectedVal) return prev;
                  const next = { ...prev };
                  delete next[ent.id];
                  return next;
                })
              }
              onRigExplodeDraftChange={(val) =>
                setRigExplodeDrafts((prev) => {
                  if (val === undefined) {
                    if (!(ent.id in prev)) return prev;
                    const next = { ...prev };
                    delete next[ent.id];
                    return next;
                  }
                  return { ...prev, [ent.id]: val };
                })
              }
              onToggleVoicePopover={() => setVoicePopoverFor((prev) => (prev === ent.id ? null : ent.id))}
              onToggleRigPopover={() => setRigPopoverFor((prev) => (prev === ent.id ? null : ent.id))}
              onOpenNewVariant={() => {
                setSubjVar('');
                setSubjDesc('');
                setSubjectModal({ mode: 'variant', entId: ent.id });
              }}
              onOpenQuickLook={() => setQuickLookKey(nodeKey)}
              onHideFromCanvas={() => void hideNodeKeysFromCanvas([nodeKey])}
              onSelectClip={onSelectClip}
              onEdit={onEdit}
              onOpenGeneration={onOpenGeneration}
              onPublishToLibrary={onPublishToLibrary}
              onInstantiateWorkshopRecipe={instantiateWorkshopRecipe}
              onAppendShotFromEnt={(item) => appendShotFromRigOrBlank(undefined, item)}
              onBakeSpatialToAiVideo={bakeSpatialSourceToAiVideo}
              onCaptureSpatialPairToAiVideo={captureSpatialPairToAiVideo}
              onSpawnSpatialMultiCamShots={spawnSpatialMultiCamShots}
              onOpenSpatialDirector={onOpenSpatialDirector}
            />
          );
        })}

        {/* Standalone Project Media / Audio / 3D Asset Nodes */}
        {visibleStandaloneAssets.map((a) => {
          const nodeKey = `asset:${a.id}`;
          const pos = layout[nodeKey] || { x: 40, y: CANVAS_LANE_TOP };
          return (
            <CanvasAssetCard
              key={nodeKey}
              asset={a}
              nodeKey={nodeKey}
              pos={pos}
              selected={selectedNodeIds.includes(nodeKey)}
              isPrimarySelected={primarySelectedId === nodeKey && selectedNodeIds.length === 1}
              isWireTarget={wireHoverKey === nodeKey}
              isDimmed={isNodeDimmed(nodeKey)}
              justCompleted={Boolean(justCompletedKeys[nodeKey])}
              deg={wireDegrees.get(nodeKey)}
              sequence={sequence}
              shots={shots}
              previewOrigin={previewOrigin}
              deriveMenuOpen={deriveMenuFor === a.id}
              roleMenuOpen={roleMenuFor === a.id}
              onHoverChange={(h) => setHoveredNodeKey((k) => (h ? nodeKey : k === nodeKey ? null : k))}
              onPointerDown={(e) => handleNodePointerDown(e, nodeKey, pos)}
              onClick={(e) => handleNodeCardClick(e, nodeKey)}
              onStartWireDrag={(e, side) => startWireDrag(e, nodeKey, side)}
              onToggleTrace={() => toggleTraceNode(nodeKey)}
              onToggleDeriveMenu={() => {
                setRoleMenuFor(null);
                setDeriveMenuFor((prev) => (prev === a.id ? null : a.id));
              }}
              onToggleRoleMenu={() => {
                setDeriveMenuFor(null);
                setRoleMenuFor((prev) => (prev === a.id ? null : a.id));
              }}
              onCloseRoleMenu={() => setRoleMenuFor(null)}
              onOpenForkPopover={setForkSource}
              onUpgradeToSubject={(asset) => {
                setSubjName(asset.name.replace(/\.[^.]+$/, '').slice(0, 16));
                setSubjRef(asset.id);
                setSubjDesc('');
                setSubjectModal({ mode: 'new' });
              }}
              onOpenQuickLook={() => setQuickLookKey(nodeKey)}
              onHideFromCanvas={() => void hideNodeKeysFromCanvas([nodeKey])}
              onDeleteFromProject={() => void deleteNodeKeysFromProject([nodeKey])}
              onEdit={onEdit}
              onOpenGeneration={onOpenGeneration}
              onPublishToLibrary={onPublishToLibrary}
              onSpawnGeneratorNode={async (opts) => {
                await spawnGeneratorNode(opts);
              }}
              onCreateSpatialStageFromAssets={createSpatialStageFromAssets}
              onTrimAudioSilence={onTrimAudioSilence}
              onNormalizeAudio={onNormalizeAudio}
              onExtractVideoFrame={onExtractVideoFrame}
              onDetachVideoAudio={onDetachVideoAudio}
              onVisionDescribeAsset={onVisionDescribeAsset}
              onOpenSpatialDirector={onOpenSpatialDirector}
            />
          );
        })}

        {/* Standalone Custom Code Components */}
        {visibleStandaloneComponents.map((comp) => {
          const nodeKey = `comp:${comp.id}`;
          const pos = layout[nodeKey] || { x: 40, y: CANVAS_LANE_TOP };
          return (
            <CanvasComponentCard
              key={nodeKey}
              comp={comp}
              nodeKey={nodeKey}
              pos={pos}
              selected={selectedNodeIds.includes(nodeKey)}
              isPrimarySelected={primarySelectedId === nodeKey && selectedNodeIds.length === 1}
              isWireTarget={wireHoverKey === nodeKey}
              sequence={sequence}
              popoverOpen={compPopoverFor === comp.id}
              promptDraft={compPromptDraft}
              onPromptDraftChange={setCompPromptDraft}
              onTogglePopover={() => setCompPopoverFor((prev) => (prev === comp.id ? null : comp.id))}
              onClosePopover={() => setCompPopoverFor(null)}
              onHoverChange={(h) => setHoveredNodeKey((k) => (h ? nodeKey : k === nodeKey ? null : k))}
              onPointerDown={(e) => handleNodePointerDown(e, nodeKey, pos)}
              onClick={(e) => handleNodeCardClick(e, nodeKey)}
              onStartWireDrag={(e, side) => startWireDrag(e, nodeKey, side)}
              onEdit={onEdit}
              onPublishToLibrary={onPublishToLibrary}
              onHideFromCanvas={() => void hideNodeKeysFromCanvas([nodeKey])}
              onDeleteFromProject={() => void deleteNodeKeysFromProject([nodeKey])}
              onSendCanvasInstruction={onSendCanvasInstruction}
              hasBakeSpatialVideo={Boolean(onBakeSpatialVideo)}
              hasCaptureSpatialPair={Boolean(onCaptureSpatialPair)}
              onBakeSpatialToAiVideo={bakeSpatialSourceToAiVideo}
              onCaptureSpatialPairToAiVideo={captureSpatialPairToAiVideo}
              onOpenSpatialDirector={onOpenSpatialDirector}
            />
          );
        })}

        {/* In-Canvas Live Generator / Transform Nodes (Asset -> New Asset Workbench Cards) */}
        {visibleGenerators.map((genNode) => {
          const nodeKey = `gen:${genNode.id}`;
          const pos = layout[nodeKey] || { x: 240, y: CANVAS_LANE_TOP };
          const selected = selectedNodeIds.includes(nodeKey);
          const deg = wireDegrees.get(nodeKey);
          const matchingJobs = activeCanvasJobs.filter((j) =>
            j.canvas?.sourceNodeKeys?.includes(nodeKey),
          );
          return (
            <CanvasGeneratorNodeCard
              key={nodeKey}
              node={genNode}
              pos={pos}
              project={project}
              settings={settings}
              upstreamEntities={upstreamEntities}
              shots={shots}
              activeVarByEnt={activeVarByEnt}
              previewOrigin={previewOrigin}
              selected={selected}
              wireTarget={wireHoverKey === nodeKey}
              dimmed={isNodeDimmed(nodeKey)}
              activeJobs={matchingJobs}
              inDegree={deg?.inCount || 0}
              outDegree={deg?.outCount || 0}
              onMouseEnter={setHoveredNodeKey}
              onMouseLeave={(k) => setHoveredNodeKey((prev) => (prev === k ? null : prev))}
              onPointerDown={handleNodePointerDown}
              onClick={(e, k) => handleNodeCardClick(e, k)}
              onStartWireDrag={startWireDrag}
              onTraceNode={toggleTraceNode}
              onUpdateNode={(id, patch) => void updateGeneratorNode(id, patch)}
              onDeleteNode={(id) => void deleteGeneratorNode(id)}
              onSaveRecipe={(g) => void saveGeneratorAsRecipe(g)}
              onJobsStarted={onJobsStarted}
              onExtractVideoFrame={onExtractVideoFrame}
              onOpenGeneration={onOpenGeneration}
            />
          );
        })}

        {/* In-Place Active Generation Ghost Cards */}
        {ghostJobs.map(({ job, pos }) => (
          <CanvasGhostCard key={`ghost-${job.id}`} job={job} pos={pos} onCancel={onCancelJob} />
        ))}

        {/* Structured Storyboard Sequence Shot Nodes (Extracted CanvasShotCard) */}
        {visibleShots.map((shot) => {
          const nodeKey = `shot:${shot.id}`;
          const pos = layout[nodeKey] || { x: 340, y: 44 };
          const selected = selectedNodeIds.includes(nodeKey);
          const isPrimarySelected = primarySelectedId === nodeKey && selectedNodeIds.length === 1;
          const deg = wireDegrees.get(nodeKey);
          const reorderDropSide =
            shotReorderDrag && shotReorderDrag.targetShotId === shot.id ? shotReorderDrag.side : null;
          return (
            <CanvasShotCard
              key={nodeKey}
              project={project}
              sequence={sequence}
              shot={shot}
              shots={shots}
              pos={pos}
              previewOrigin={previewOrigin}
              selected={selected}
              isPrimarySelected={isPrimarySelected}
              wireTarget={wireHoverKey === nodeKey}
              upstreamEntities={upstreamEntities}
              activeVarByEnt={activeVarByEnt}
              takeMenuOpen={takeMenuFor === shot.id}
              activeJob={shotActiveJobs.get(shot.anchorClip.id)}
              justCompleted={Boolean(justCompletedKeys[nodeKey])}
              reorderDropSide={reorderDropSide}
              isReorderingSource={shotReorderDrag?.fromShotId === shot.id}
              dimmed={isNodeDimmed(nodeKey)}
              inDegree={deg?.inCount || 0}
              outDegree={deg?.outCount || 0}
              onTraceNode={toggleTraceNode}
              onMouseEnter={setHoveredNodeKey}
              onMouseLeave={(k) => setHoveredNodeKey((prev) => (prev === k ? null : prev))}
              onPointerDown={handleNodePointerDown}
              onClick={handleNodeCardClick}
              onStartWireDrag={startWireDrag}
              onStartReorderDrag={startShotReorderDrag}
              onQuickLook={setQuickLookKey}
              onToggleTakeMenu={(id) => setTakeMenuFor((prev) => (prev === id ? null : id))}
              onAddCandidateTake={(sh, v) => void addShotCandidateTake(sh, v)}
              onOpenGeneration={onOpenGeneration}
              onBakeShotToAiVideo={
                onBakeSpatialVideo
                  ? (sh, p) => void bakeSpatialSourceToAiVideo(`shot:${sh.id}`, { x: p.x + 312, y: p.y })
                  : undefined
              }
              onCaptureShotPairToAiVideo={
                onCaptureSpatialPair
                  ? (sh, p) => void captureSpatialPairToAiVideo(`shot:${sh.id}`, { x: p.x + 312, y: p.y })
                  : undefined
              }
              onCaptureShotRefToAiImage={
                onCaptureSpatialReference
                  ? (sh, p) => void captureSpatialRefToAiImage(`shot:${sh.id}`, { x: p.x + 312, y: p.y })
                  : undefined
              }
              onOpenShotInDirector={
                onOpenSpatialDirector
                  ? (sh) =>
                      onOpenSpatialDirector({
                        kind: 'clip',
                        sequenceId: sequence.id,
                        clipId: sh.anchorClip.id,
                      })
                  : undefined
              }
              onForkShotVariants={(sh, p) => {
                const ctx = resolveShotGenContext(sh);
                setForkSource({
                  label: `镜头 #${sh.index}`,
                  basePrompt: ctx.prompt || sh.anchorClip.name,
                  refAssetIds: ctx.refAssetIds,
                  sourceNodeKeys: ctx.sourceNodeKeys,
                  anchorPos: p,
                });
              }}
              onTweakShotWithAgent={(_sh, draftPrompt) => {
                setOmnibarDraft(draftPrompt);
                requestAnimationFrame(() => omnibarInputRef.current?.focus());
              }}
              onJumpToEdit={(clipId, startFrame) => {
                onSelectClip(clipId);
                onSeek(startFrame);
                onSwitchToEdit();
              }}
              onSaveClipsAsAsset={onSaveClipsAsAsset}
              onCancelJob={onCancelJob}
              onEdit={onEdit}
            />
          );
        })}

        {/* Add Trailing Shot Card */}
        {visibleShots.length > 0 && (
          <button
            type="button"
            className="cc-append-shot-node"
            style={{
              left: shotLaneX + (shots.length % 6) * 316,
              top: CANVAS_LANE_TOP + 20 + Math.floor(shots.length / 6) * 246,
            }}
            onClick={() => void appendShotFromRigOrBlank()}
          >
            <Plus size={15} />
            <span>新增镜头 {String(shots.length + 1).padStart(2, '0')}</span>
          </button>
        )}

        {/* Clickable Bezier Wire Label Pills (only visible when related node/wire is hovered or selected) */}
        <CanvasWirePillsSvg
          wires={filteredWires}
          hoveredNodeKey={hoveredNodeKey}
          wireDrag={wireDrag}
          wireMode={wireMode}
          tracedWireKeys={traceGraph?.wireKeys || null}
          project={project}
          sequence={sequence}
          upstreamEntities={upstreamEntities}
          onEdit={onEdit}
        />
      </div>

      {/* Unified Bottom Responsive Bar: Center Omnibar + Right Utility Controls (Zero Collision at Any Width) */}
      <div className="cc-bottom-bar">
        <div className="cc-bottom-spacer" aria-hidden="true" />
        {!rightAgentOpen ? (
          (() => {
            const singleRefs = selectedNodeIds.length > 0 ? collectRefsFromNodeKeys(selectedNodeIds) : [];
            const selectedShot =
              primarySelectedId?.startsWith('shot:')
                ? shots.find((s) => `shot:${s.id}` === primarySelectedId)
                : undefined;
            const activeVal = omnibarDraft || floatingPrompt;

            const handleSlashAction = (cmd: OmnibarSlashAction) => {
              const text = activeVal.replace(/^\/\S*\s*/, '').trim();
              if (cmd === 'tidy') {
                void tidyCanvasNodes();
                return;
              }
              if (cmd === 'new-text') {
                void createTextNode(text);
                setOmnibarDraft('');
                onFloatingPromptChange('');
                return;
              }
              if (cmd === 'gen-image') {
                const inputs: CanvasGeneratorInput[] = visualSelection.sourceNodeKeys
                  .slice(0, 6)
                  .map((k, idx) => ({ nodeKey: k, slot: idx === 0 ? 'subject' : 'style' }));
                void spawnGeneratorNode({
                  use: 'image',
                  action: inputs.length >= 2 ? 'multi-ref-image' : inputs.length === 1 ? 'image-edit' : 'text-to-image',
                  inputs,
                  prompt: text || undefined,
                  placement: inputs.length > 0 ? visualSelection.anchorPlacement : viewportCenterWorld(),
                });
                setOmnibarDraft('');
                onFloatingPromptChange('');
                return;
              }
              if (cmd === 'gen-video') {
                const imgKeys = visualSelection.sourceNodeKeys;
                const inputs: CanvasGeneratorInput[] =
                  imgKeys.length === 2
                    ? [
                        { nodeKey: imgKeys[0], slot: 'first-frame' },
                        { nodeKey: imgKeys[1], slot: 'last-frame' },
                      ]
                    : imgKeys.slice(0, 4).map((k, idx) => ({
                        nodeKey: k,
                        slot: idx === 0 ? 'first-frame' : 'subject',
                      }));
                void spawnGeneratorNode({
                  use: 'video',
                  action: imgKeys.length === 2 ? 'first-last-video' : imgKeys.length >= 3 ? 'ref-video' : 'image-to-video',
                  inputs,
                  prompt: text || undefined,
                  placement: inputs.length > 0 ? visualSelection.anchorPlacement : viewportCenterWorld(),
                });
                setOmnibarDraft('');
                onFloatingPromptChange('');
                return;
              }
              if (cmd === 'gen-speech') {
                void spawnGeneratorNode({
                  use: 'speech',
                  action: 'tts',
                  prompt: text,
                  placement: viewportCenterWorld(),
                });
                setOmnibarDraft('');
                onFloatingPromptChange('');
                return;
              }
              if (cmd === 'breakdown') {
                if (text.includes('\n')) {
                  const ops = scriptOutlineToShotOperations(sequence, text, undefined, upstreamEntities);
                  if (ops.length) {
                    void onEdit('从指令舱脚本拆解分镜', ops);
                    setOmnibarDraft('');
                    onFloatingPromptChange('');
                  }
                } else {
                  onSendCanvasInstruction(
                    text
                      ? `请围绕以下创意主题为当前分支拆解生成多镜头分镜脚本、字幕与匹配画面：${text}`
                      : '请根据当前画布上的剧本与设定资产拆解生成多镜头分镜序列。',
                    selectedShot?.anchorClip,
                  );
                  setOmnibarDraft('');
                  onFloatingPromptChange('');
                }
              }
            };

            const handleOmnibarSubmit = async () => {
              const text = activeVal.trim();
              if (!text) return;
              // Fast 0-cost local intent check (and optional System 1 router when explicitly enabled)
              let intent: OmnibarLocalIntent = 'agent';
              const localHit = routeOmnibarLocally(text);
              if (localHit.intent !== 'agent' && localHit.confidence >= 0.85) {
                intent = localHit.intent;
              } else if (
                settings?.system1 &&
                settings.system1.mode !== 'off' &&
                settings.system1.features?.omnibarRouter
              ) {
                try {
                  const res = await window.cocraft.call<{ intent: OmnibarLocalIntent; confidence: number }>(
                    'system1.routeOmnibar',
                    { text },
                  );
                  if (res?.intent && res.intent !== 'agent' && res.confidence >= 0.75) {
                    intent = res.intent;
                  }
                } catch {
                  intent = 'agent';
                }
              }
              if (intent === 'tidy') {
                void tidyCanvasNodes();
                setOmnibarDraft('');
                onFloatingPromptChange('');
                return;
              }
              if (intent === 'new-text') {
                const cleaned = text.replace(/^(新建|加一个?|创建)(文本|便签|剧本|脚本)(卡|节点)?[:：]?\s*/i, '').trim();
                void createTextNode(cleaned);
                setOmnibarDraft('');
                onFloatingPromptChange('');
                return;
              }
              if (intent === 'breakdown' && text.includes('\n')) {
                const ops = scriptOutlineToShotOperations(sequence, text, undefined, upstreamEntities);
                if (ops.length) {
                  void onEdit('从指令舱脚本拆解分镜', ops);
                  setOmnibarDraft('');
                  onFloatingPromptChange('');
                  return;
                }
              }
              if (intent === 'reframe-vertical' && onAutoReframeVertical) {
                void onAutoReframeVertical();
                setOmnibarDraft('');
                onFloatingPromptChange('');
                return;
              }
              const ctxPrefix =
                singleRefs.length > 0 || chatRefs.length > 0
                  ? `参考上下文（${[...chatRefs, ...singleRefs].map((r) => `@${r.label}`).join('、')}）：`
                  : '';
              onSendCanvasInstruction(`${ctxPrefix}${text}`, selectedShot?.anchorClip);
              setOmnibarDraft('');
              onFloatingPromptChange('');
            };

            return (
              <div className="cc-bottom-dock" onPointerDown={(e) => e.stopPropagation()}>
                <CanvasOmnibar
                  aiBusy={aiBusy}
                  value={activeVal}
                  onChange={(val) => {
                    setOmnibarDraft(val);
                    onFloatingPromptChange(val);
                  }}
                  onSubmit={handleOmnibarSubmit}
                  onSlashAction={handleSlashAction}
                  inputRef={omnibarInputRef}
                  chatRefs={chatRefs}
                  singleRefs={singleRefs}
                  onRemoveChatRef={onRemoveChatRef}
                  onRemoveCanvasRef={(key) => setSelectedNodeIds((prev) => prev.filter((k) => k !== key))}
                  onAttachSelectedToChat={
                    onAddRefsToChat && singleRefs.length > 0
                      ? () => onAddRefsToChat(singleRefs, false)
                      : undefined
                  }
                />
              </div>
            );
          })()
        ) : (
          <div className="cc-bottom-spacer" aria-hidden="true" />
        )}

        {/* Bottom-Right TapNow 3-in-1 Utility Capsule + Popover Minimap */}
        <CanvasUtilityControls
          showMinimap={showMinimap}
          onToggleMinimap={() => setShowMinimap((v) => !v)}
          minimapDots={minimapDots}
          rightAgentOpen={rightAgentOpen}
          onToggleRightAgent={onToggleRightAgent}
          zoom={zoom}
          onZoomOut={() => setZoom((z) => Math.max(0.45, Math.round((z - 0.1) * 100) / 100))}
          onZoomIn={() => setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 100) / 100))}
          onTidy={() => void tidyCanvasNodes()}
          onFit={fitCanvasToNodes}
        />
      </div>

      {/* Space / Double-Click Quick Look Lightbox */}
      {quickLookKey && (
        <CanvasQuickLook
          nodeKey={quickLookKey}
          navigableKeys={quickLookNavKeys}
          project={project}
          sequence={sequence}
          shots={shots}
          previewOrigin={previewOrigin}
          onNavigate={setQuickLookKey}
          onClose={() => setQuickLookKey(null)}
          onJumpToEdit={(clipId, startFrame) => {
            onSelectClip(clipId);
            onSeek(startFrame);
            onSwitchToEdit();
          }}
        />
      )}

      {/* In-Canvas Storyboard Animatic Player */}
      {animaticOpen && shots.length > 0 && (
        <CanvasAnimaticModal
          project={project}
          sequence={sequence}
          shots={shots}
          previewOrigin={previewOrigin}
          initialShotIndex={Math.max(
            0,
            shots.findIndex((s) => `shot:${s.id}` === primarySelectedId),
          )}
          onClose={() => setAnimaticOpen(false)}
          onEdit={onEdit}
          onJumpToEdit={(clipId, startFrame) => {
            onSelectClip(clipId);
            onSeek(startFrame);
            onSwitchToEdit();
          }}
          onRegenerateShot={(sh) => {
            const ctx = resolveShotGenContext(sh);
            onOpenGeneration({
              use: 'image',
              prompt: ctx.prompt,
              referenceAssetId: ctx.refAssetId,
              referenceAssetIds: ctx.refAssetIds.length ? ctx.refAssetIds : undefined,
              target: {
                sequenceId: sequence.id,
                clipId: sh.anchorClip.id,
                shotLabel: `镜头 #${sh.index} · ${sh.anchorClip.name}`,
                mode: 'take',
              },
              canvas: {
                sourceNodeKeys: ctx.sourceNodeKeys,
                referenceAssetIds: ctx.refAssetIds.length ? ctx.refAssetIds : undefined,
              },
            });
          }}
        />
      )}
    </div>
  );
}
