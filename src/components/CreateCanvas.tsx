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
  X,
} from 'lucide-react';
import { pointerDrag } from '../lib/pointerDrag';
import { mediaUrl } from '../composition/Film';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import { PresetPreview } from './ResourceLibrary';
import { ShotCompositeThumb } from './ShotCompositeThumb';
import { createPresetClip, getPreset } from '../core/presets';
import {
  clone,
  createCompoundVaultItemFromClips,
  instantiateCompoundVaultItemOperations,
  newClip,
  timecode,
  uid,
} from '../core/project';
import {
  computePrimaryTimelineShots,
  moveCompositeShotOperations,
  scriptOutlineToShotOperations,
  updateShotScriptOperations,
  type CompositeShot,
} from '../core/storyboard';
import { ROLE_LABELS, inferAssetRole } from '../core/taxonomy';
import type {
  AssetLineageRef,
  AssetVariant,
  CanvasGroup,
  ChatContextRef,
  Clip,
  ClipTake,
  EditOperation,
  Project,
  Sequence,
  ShotBinding,
  VaultItem,
} from '../core/types';

interface CreateCanvasProps {
  project: Project;
  sequence: Sequence;
  selectedClipId: string | null;
  previewOrigin: string;
  leftOpen: boolean;
  rightOpen: boolean;
  rightAgentOpen?: boolean;
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
  onExportMaterialPack?: (payload: { name: string; assetIds: string[]; componentIds: string[] }) => Promise<void>;
  onSaveClipsAsAsset?: (clips: Clip[], customName?: string) => Promise<void>;
  onAddRefsToChat?: (refs: ChatContextRef[], openDrawer?: boolean) => void;
  chatRefs?: ChatContextRef[];
  onRemoveChatRef?: (key: string) => void;
  onSendCanvasInstruction: (prompt: string, scopeClip?: Clip) => void;
  onOpenGeneration: (opts: {
    use: 'image' | 'video' | 'speech' | 'transcription';
    prompt?: string;
    referenceAssetId?: string;
    assetId?: string;
  }) => void;
  onAskAgentForShot: (clip: Clip, prompt: string) => void;
}

interface Pt {
  x: number;
  y: number;
}

type PortSide = 'left' | 'right' | 'top' | 'bottom';

function computeSmartWire(
  fromPos: Pt,
  fromSz: { w: number; h: number },
  toPos: Pt,
  toSz: { w: number; h: number },
): { x1: number; y1: number; x2: number; y2: number; s1: PortSide; s2: PortSide } {
  const fc = { x: fromPos.x + fromSz.w / 2, y: fromPos.y + fromSz.h / 2 };
  const tc = { x: toPos.x + toSz.w / 2, y: toPos.y + toSz.h / 2 };
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  let s1: PortSide;
  let s2: PortSide;
  if (Math.abs(dx) >= Math.abs(dy) * 0.6) {
    s1 = dx >= 0 ? 'right' : 'left';
    s2 = dx >= 0 ? 'left' : 'right';
  } else {
    s1 = dy >= 0 ? 'bottom' : 'top';
    s2 = dy >= 0 ? 'top' : 'bottom';
  }
  const anchor = (pos: Pt, sz: { w: number; h: number }, side: PortSide): Pt => {
    if (side === 'right') return { x: pos.x + sz.w + 2, y: pos.y + Math.min(86, sz.h * 0.5) };
    if (side === 'left') return { x: pos.x - 2, y: pos.y + Math.min(86, sz.h * 0.5) };
    if (side === 'bottom') return { x: pos.x + sz.w * 0.5, y: pos.y + sz.h + 2 };
    return { x: pos.x + sz.w * 0.5, y: pos.y - 2 };
  };
  const p1 = anchor(fromPos, fromSz, s1);
  const p2 = anchor(toPos, toSz, s2);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, s1, s2 };
}

function bezierPathFor(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  s1: PortSide,
  s2: PortSide,
): string {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const cp = Math.max(24, Math.min(110, dist * 0.42));
  const offset = (x: number, y: number, side: PortSide): Pt => {
    if (side === 'right') return { x: x + cp, y };
    if (side === 'left') return { x: x - cp, y };
    if (side === 'bottom') return { x, y: y + cp };
    return { x, y: y - cp };
  };
  const c1 = offset(x1, y1, s1);
  const c2 = offset(x2, y2, s2);
  return `M ${x1} ${y1} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${x2} ${y2}`;
}

export function CreateCanvas({
  project,
  sequence,
  selectedClipId,
  previewOrigin,
  rightAgentOpen = false,
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
}: CreateCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const omnibarInputRef = useRef<HTMLInputElement>(null);
  const [pan, setPan] = useState<Pt>({ x: 96, y: 72 });
  const [zoom, setZoom] = useState(0.95);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current = pan;
  zoomRef.current = zoom;

  const [canvasTool, setCanvasTool] = useState<'select' | 'pan'>('select');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const [aiMode, setAiMode] = useState<'script' | 'subject' | 'shot' | 'agent'>('agent');
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

  // TapNow Popovers, Add Menu, Context Menu, Drop-to-Create Menu, Marquee Box
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<null | { clientX: number; clientY: number; nodeKey?: string }>(null);
  const [dropMenu, setDropMenu] = useState<null | {
    sourceKey: string;
    worldX: number;
    worldY: number;
    screenX: number;
    screenY: number;
  }>(null);
  const [marquee, setMarquee] = useState<null | { x1: number; y1: number; x2: number; y2: number }>(null);

  const [subjectModal, setSubjectModal] = useState<null | { mode: 'new' | 'variant'; entId?: string }>(null);
  const [subjRole, setSubjRole] = useState<'character' | 'product' | 'environment'>('character');
  const [subjName, setSubjName] = useState('');
  const [subjVar, setSubjVar] = useState('默认状态');
  const [subjDesc, setSubjDesc] = useState('');
  const [subjRef, setSubjRef] = useState('');
  const [rigPopoverFor, setRigPopoverFor] = useState<string | null>(null);
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

  const totalAssetCount = upstreamEntities.length + standaloneAssets.length + standaloneComponents.length;
  const assetCols = totalAssetCount > 3 ? 2 : 1;
  const shotLaneX = totalAssetCount > 0 ? (assetCols === 2 ? 684 : 372) : 80;

  const layout = useMemo(() => {
    const map: Record<string, Pt> = {};
    let idx = 0;
    const placeAsset = (key: string) => {
      const col = assetCols === 2 ? idx % 2 : 0;
      const row = assetCols === 2 ? Math.floor(idx / 2) : idx;
      map[key] = nodePositions[key] || {
        x: 40 + col * 308,
        y: 48 + row * 226,
      };
      idx++;
    };
    upstreamEntities.forEach((ent) => placeAsset(`ent:${ent.id}`));
    standaloneAssets.forEach((a) => placeAsset(`asset:${a.id}`));
    standaloneComponents.forEach((comp) => placeAsset(`comp:${comp.id}`));

    const cols = 6;
    shots.forEach((sh, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      map[`shot:${sh.id}`] = nodePositions[`shot:${sh.id}`] || {
        x: shotLaneX + col * 316,
        y: 44 + row * 246,
      };
    });
    return map;
  }, [upstreamEntities, standaloneAssets, standaloneComponents, assetCols, shotLaneX, shots, nodePositions]);

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

  const nodeSizeFor = useCallback(
    (key: string): { w: number; h: number } => {
      if (key.startsWith('shot:')) return { w: 284, h: 204 };
      if (key.startsWith('asset:')) {
        const a = project.assets.find((x) => `asset:${x.id}` === key);
        if (a?.kind === 'audio') return { w: 244, h: 82 };
      }
      return { w: 244, h: 174 };
    },
    [project.assets],
  );

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
  }, [onSelectClip]);

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

  function resetCanvasView() {
    setNodePositions({});
    nodePositionsRef.current = {};
    if (project.canvasLayout && Object.keys(project.canvasLayout).length > 0) {
      void onEdit('自动整理画布布局', [{ type: 'updateProject', changes: { canvasLayout: {} } }]);
    }
    setPan({ x: 96, y: 72 });
    setZoom(0.95);
  }

  function resolveShotGenContext(shot: CompositeShot): { prompt: string; refAssetId?: string } {
    const b =
      shot.bindings.find((item) => {
        const candidate = upstreamEntities.find((x) => x.id === item.entityId);
        return candidate && candidate.entityKind !== 'text';
      }) || shot.bindings[0];
    const ent = b ? upstreamEntities.find((x) => x.id === b.entityId) : undefined;
    const vr = ent
      ? ent.variants?.find((v) => v.id === b?.variantId) ||
        ent.variants?.find((v) => v.id === ent.defaultVariantId) ||
        ent.variants?.[0]
      : undefined;
    const anchorDesc = [ent?.textContent, ent?.promptAnchor, vr?.promptDelta].filter(Boolean).join('；');
    const subjectPhrase = ent ? `@${ent.name}${vr ? `:${vr.name}` : ''}（${anchorDesc || ent.name}）` : '';
    const baseText = shot.scriptText || String(shot.anchorClip.props.text || shot.anchorClip.name || '');
    return {
      prompt: [baseText, subjectPhrase].filter(Boolean).join('，'),
      refAssetId: vr?.assetId || ent?.assetId,
    };
  }

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
        await onExportMaterialPack({ name: packName, assetIds, componentIds });
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
          const dur = Math.max(15, Math.floor((a.kind === 'image' ? 5 : a.duration) * sequence.fps));
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
            const dur = Math.max(15, Math.floor(((a && a.kind !== 'image' ? a.duration : 5) || 5) * sequence.fps));
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
                    duration: Math.max(15, Math.min(sh.duration, Math.floor(a.duration * sequence.fps))),
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

  // Keyboard shortcuts while Canvas active (Escape deselect, T new text node, Cmd+A select all, Cmd+G group, Space pan)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input, textarea, select')) {
        setSpaceHeld(true);
      }
      const inField = Boolean((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]'));
      if (e.key === 'Escape') {
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
      if (!mod && e.key.toLowerCase() === 'v') setCanvasTool('select');
      if (!mod && e.key.toLowerCase() === 'h') setCanvasTool('pan');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [clearSelection, selectAllNodes, createGroupFromNodeKeys, createTextNode]);

  async function addQuickCanvasRigNode(presetId: string, role: VaultItem['role'], label: string) {
    setAddMenuOpen(false);
    const def = getPreset(presetId);
    const item: VaultItem = {
      id: uid('pvault'),
      name: label,
      entityKind: presetId === 'teardown-3d' ? 'three' : 'component',
      role,
      tags: [],
      category: 'rig',
      subkind: presetId === 'teardown-3d' ? 'three-rig' : 'motion-rig',
      description: def?.description || label,
      rig: {
        presetId,
        props: clone(def?.defaultProps || {}),
      },
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    await onEdit(`新建画布节点「${label}」`, [{ type: 'putVaultItem', item }]);
    setSelectedNodeIds([`ent:${item.id}`]);
    setRigPopoverFor(item.id);
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
                duration: Math.max(15, Math.min(sh.duration, Math.floor(a.duration * sequence.fps))),
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
    [upstreamEntities, shots, activeVarByEnt, project.assets, standaloneComponents, sequence.id, sequence.fps, onEdit],
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
    const movingKeys = selectedIdsRef.current.includes(nodeKey) ? selectedIdsRef.current : [nodeKey];
    const origMap = new Map<string, Pt>();
    for (const k of movingKeys) {
      origMap.set(k, { ...(layoutRef.current[k] || origPos) });
    }
    const sx = e.clientX;
    const sy = e.clientY;
    let dragged = false;
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

  // Compute SVG Bezier Wires: Bindings + Asset/Entity Lineage + Shot Clips with Adaptive Ports
  const wires = useMemo(() => {
    const list: {
      key: string;
      kind: 'binding' | 'asset-lineage' | 'entity-lineage' | 'shot-clip';
      fromKey: string;
      toKey: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      s1: PortSide;
      s2: PortSide;
      label: string;
      shotId: string;
      clipId: string;
      entityId: string;
      targetAssetId?: string;
      targetEntId?: string;
      sourceAssetId?: string;
      sourceVaultId?: string;
      removeClipId?: string;
      isLineage?: boolean;
      active: boolean;
    }[] = [];
    const selSet = new Set(selectedNodeIds);
    const pushWire = (
      base: Omit<(typeof list)[number], 'x1' | 'y1' | 'x2' | 'y2' | 's1' | 's2' | 'active'>,
    ) => {
      const p1 = layout[base.fromKey];
      const p2 = layout[base.toKey];
      if (!p1 || !p2) return;
      const smart = computeSmartWire(p1, nodeSizeFor(base.fromKey), p2, nodeSizeFor(base.toKey));
      list.push({
        ...base,
        ...smart,
        active: selSet.has(base.fromKey) || selSet.has(base.toKey),
      });
    };

    // A) Entity -> Shot bindings
    for (const sh of shots) {
      for (const b of sh.bindings) {
        const ent = upstreamEntities.find((x) => x.id === b.entityId);
        if (!ent) continue;
        const vr = ent.variants?.find((v) => v.id === b.variantId);
        pushWire({
          key: `${ent.id}->${sh.id}`,
          kind: 'binding',
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
            fromKey: `comp:${comp.id}`,
            toKey: `shot:${sh.id}`,
            label: comp.name.slice(0, 14),
            shotId: sh.id,
            clipId: sh.anchorClip.id,
            entityId: '',
            removeClipId: matchedComp.id,
          });
        }
      }
    }

    // D) Asset lineage: Asset/Ent/Shot -> Asset
    for (const a of standaloneAssets) {
      if (!a.derivedFrom?.length) continue;
      for (const ref of a.derivedFrom) {
        const fromKey = ref.vaultItemId?.startsWith('shot:')
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

    // E) Entity lineage: Asset/Ent -> Ent
    for (const ent of upstreamEntities) {
      if (!ent.derivedFrom?.length) continue;
      for (const ref of ent.derivedFrom) {
        const fromKey = ref.vaultItemId
          ? `ent:${ref.vaultItemId}`
          : ref.assetId
            ? `asset:${ref.assetId}`
            : '';
        if (!fromKey || !layout[fromKey]) continue;
        pushWire({
          key: `elin:${fromKey}->ent:${ent.id}`,
          kind: 'entity-lineage',
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
    return list;
  }, [
    shots,
    layout,
    upstreamEntities,
    standaloneAssets,
    standaloneComponents,
    sequence.clips,
    selectedNodeIds,
    nodeSizeFor,
  ]);

  const groupBoxes = useMemo(() => {
    return (project.canvasGroups || [])
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
      className={`create-canvas-viewport ${activePanMode ? 'pan-mode' : 'select-mode'}`}
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
            '.cc-node, .cc-bottom-dock, .cc-utility-pill, .cc-popover, .cc-multi-bar, .cc-group-frame',
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
            '.cc-node, .cc-bottom-dock, .cc-utility-pill, .cc-popover, .cc-empty-hero, .cc-multi-bar, .cc-lane-action, .cc-group-header, button, input, textarea, select, audio',
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

        const vp = viewportRef.current?.getBoundingClientRect();
        const shouldPan = activePanMode || e.button === 1;

        if (shouldPan) {
          const startX = e.clientX - panRef.current.x;
          const startY = e.clientY - panRef.current.y;
          pointerDrag(
            e,
            (mx, my) => setPan({ x: mx - startX, y: my - startY }),
            undefined,
            'grabbing',
          );
          return;
        }

        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const baseIds = additive ? selectedIdsRef.current : [];

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
            if (found) void appendShotFromRigOrBlank(undefined, found);
          } else {
            const media = project.assets.find((a) => a.id === assetToken);
            if (media) {
              const tail = sequence.clips.length
                ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
                : 0;
              const c = {
                ...newClip(media.kind === 'model-3d' ? 'shape' : media.kind, tail, media.id),
                name: media.name,
                duration: Math.max(1, Math.floor((media.kind === 'image' ? 5 : media.duration) * sequence.fps)),
              };
              void onEdit(`拖入镜头「${media.name}」`, [{ type: 'addClip', sequenceId: sequence.id, clip: c }]);
            }
          }
        }
      }}
    >
      {/* Top Floating Multi-Selection Action Bar */}
      {selectedNodeIds.length >= 2 && (
        <div className="cc-multi-bar" role="toolbar" aria-label="画布多选操作" onPointerDown={(e) => e.stopPropagation()}>
          <span className="cc-multi-count">已选 {selectedNodeIds.length} 项</span>
          <span className="cc-tb-sep" />
          <button
            type="button"
            onClick={() => {
              const refs = collectRefsFromNodeKeys(selectedNodeIds);
              if (onAddRefsToChat && refs.length) onAddRefsToChat(refs, false);
            }}
          >
            <AtSign size={11} /> 添加到对话
          </button>
          <button type="button" onClick={() => void createGroupFromNodeKeys(selectedNodeIds)}>
            <Group size={11} /> 成组
          </button>
          <button type="button" onClick={() => void packNodeKeys(selectedNodeIds, false)}>
            <Package size={11} /> 打成素材包
          </button>
          <button type="button" onClick={() => void linkSelectedNodes(selectedNodeIds)}>
            <Link2 size={11} /> 建立关联
          </button>
          <button type="button" onClick={() => void appendSelectedNodesToTimeline(selectedNodeIds)}>
            <Film size={11} /> 串入时间线
          </button>
          {selectedNodeIds.some((k) => k.startsWith('shot:')) && onSaveClipsAsAsset && (
            <button
              type="button"
              onClick={() => {
                const chosenShots = selectedNodeIds
                  .filter((k) => k.startsWith('shot:'))
                  .map((k) => shots.find((s) => `shot:${s.id}` === k))
                  .filter((x): x is CompositeShot => Boolean(x));
                const allClips = chosenShots.flatMap((s) => [...s.compositeClips, ...s.captionClips]);
                if (allClips.length) void onSaveClipsAsAsset(allClips);
              }}
            >
              <BookmarkPlus size={11} /> 存为资产
            </button>
          )}
          <button type="button" className="cc-multi-close" aria-label="取消多选" onClick={clearSelection}>
            <X size={11} />
          </button>
        </div>
      )}

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

      {/* Drop-to-Create Contextual Popover (TapNow wire-to-blank) */}
      {dropMenu && (
        <div
          className="cc-popover cc-tap-menu cc-drop-create"
          style={{ left: dropMenu.screenX, top: dropMenu.screenY }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="cc-menu-group">连线生成下游内容</div>
          {dropMenu.sourceKey.startsWith('ent:') &&
            upstreamEntities.find((e) => `ent:${e.id}` === dropMenu.sourceKey)?.entityKind === 'text' && (
              <button
                type="button"
                onClick={async () => {
                  const srcEnt = upstreamEntities.find((e) => `ent:${e.id}` === dropMenu.sourceKey);
                  setDropMenu(null);
                  if (!srcEnt?.textContent?.trim()) return;
                  const ops = scriptOutlineToShotOperations(sequence, srcEnt.textContent, {
                    entityId: srcEnt.id,
                    version: srcEnt.version,
                  });
                  if (ops.length) await onEdit(`从「${srcEnt.name}」拆解分镜`, ops);
                }}
              >
                <span className="cc-menu-item-label">
                  <Clapperboard size={13} /> 按行拆解为分镜序列
                </span>
                <kbd>S</kbd>
              </button>
            )}
          <button
            type="button"
            onClick={() => {
              const sk = dropMenu.sourceKey;
              const refs = collectRefsFromNodeKeys([sk]);
              setDropMenu(null);
              const promptBase = refs[0]?.label || '';
              onOpenGeneration({
                use: 'image',
                prompt: promptBase,
                referenceAssetId: sk.startsWith('asset:') ? sk.slice(6) : undefined,
              });
            }}
          >
            <span className="cc-menu-item-label">
              <Sparkles size={13} /> AI 生成概念画面
            </span>
            <kbd>I</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              const sk = dropMenu.sourceKey;
              setDropMenu(null);
              const ent = sk.startsWith('ent:')
                ? upstreamEntities.find((e) => `ent:${e.id}` === sk)
                : undefined;
              void appendShotFromRigOrBlank(undefined, ent);
            }}
          >
            <span className="cc-menu-item-label">
              <Film size={13} /> 派生至新分镜镜头
            </span>
            <kbd>N</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              const sk = dropMenu.sourceKey;
              setDropMenu(null);
              void appendSelectedNodesToTimeline([sk]);
            }}
          >
            <span className="cc-menu-item-label">
              <Scissors size={13} /> 直接放入时间线
            </span>
          </button>
        </div>
      )}

      {/* Right-Click TapNow Context Menu */}
      {contextMenu && (
        <div
          className="cc-popover cc-tap-menu cc-context-menu"
          style={{ left: contextMenu.clientX, top: contextMenu.clientY }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.nodeKey || selectedNodeIds.length > 0 ? (
            <>
              <div className="cc-menu-group">
                {selectedNodeIds.length > 1 ? `已选 ${selectedNodeIds.length} 个节点` : '节点操作'}
              </div>
              <button
                type="button"
                onClick={() => {
                  const targets = selectedNodeIds.length ? selectedNodeIds : contextMenu.nodeKey ? [contextMenu.nodeKey] : [];
                  const refs = collectRefsFromNodeKeys(targets);
                  setContextMenu(null);
                  if (onAddRefsToChat && refs.length) onAddRefsToChat(refs, true);
                }}
              >
                <span className="cc-menu-item-label">
                  <AtSign size={13} /> 添加到对话
                </span>
                <kbd>@</kbd>
              </button>
              {selectedNodeIds.length >= 2 && (
                <button
                  type="button"
                  onClick={() => {
                    setContextMenu(null);
                    void createGroupFromNodeKeys(selectedNodeIds);
                  }}
                >
                  <span className="cc-menu-item-label">
                    <Group size={13} /> 成组归类
                  </span>
                  <kbd>⌘G</kbd>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const targets = selectedNodeIds.length ? selectedNodeIds : contextMenu.nodeKey ? [contextMenu.nodeKey] : [];
                  setContextMenu(null);
                  void packNodeKeys(targets, false);
                }}
              >
                <span className="cc-menu-item-label">
                  <Package size={13} /> 打成素材包存入个人库
                </span>
              </button>
              {onExportMaterialPack && (
                <button
                  type="button"
                  onClick={() => {
                    const targets = selectedNodeIds.length ? selectedNodeIds : contextMenu.nodeKey ? [contextMenu.nodeKey] : [];
                    setContextMenu(null);
                    void packNodeKeys(targets, true);
                  }}
                >
                  <span className="cc-menu-item-label">
                    <Download size={13} /> 导出离线素材包…
                  </span>
                </button>
              )}
              <div className="cc-menu-divider" />
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  clearSelection();
                }}
              >
                <span className="cc-menu-item-label">
                  <X size={13} /> 取消选中
                </span>
                <kbd>Esc</kbd>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  onImportMedia();
                }}
              >
                <span className="cc-menu-item-label">
                  <Upload size={13} /> 上传素材
                </span>
                <kbd>U</kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  const wx = Math.round((contextMenu.clientX - panRef.current.x) / zoomRef.current);
                  const wy = Math.round((contextMenu.clientY - panRef.current.y) / zoomRef.current);
                  setContextMenu(null);
                  void createTextNode('', { x: wx, y: wy });
                }}
              >
                <span className="cc-menu-item-label">
                  <FileText size={13} /> 添加文本节点
                </span>
                <kbd>T</kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  setSubjectModal({ mode: 'new' });
                }}
              >
                <span className="cc-menu-item-label">
                  <UserCheck size={13} /> 添加角色 / 设定
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  void appendShotFromRigOrBlank();
                }}
              >
                <span className="cc-menu-item-label">
                  <Clapperboard size={13} /> 添加分镜镜头
                </span>
              </button>
              <div className="cc-menu-divider" />
              {onUndo && (
                <button
                  type="button"
                  disabled={!canUndo}
                  onClick={() => {
                    setContextMenu(null);
                    onUndo();
                  }}
                >
                  <span className="cc-menu-item-label">
                    <Undo2 size={13} /> 撤销
                  </span>
                  <kbd>⌘Z</kbd>
                </button>
              )}
              {onRedo && (
                <button
                  type="button"
                  disabled={!canRedo}
                  onClick={() => {
                    setContextMenu(null);
                    onRedo();
                  }}
                >
                  <span className="cc-menu-item-label">
                    <Redo2 size={13} /> 重做
                  </span>
                  <kbd>⇧⌘Z</kbd>
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  const wx = Math.round((contextMenu.clientX - panRef.current.x) / zoomRef.current);
                  const wy = Math.round((contextMenu.clientY - panRef.current.y) / zoomRef.current);
                  setContextMenu(null);
                  try {
                    const txt = await navigator.clipboard.readText();
                    await createTextNode(txt || '', { x: wx, y: wy });
                  } catch {
                    await createTextNode('', { x: wx, y: wy });
                  }
                }}
              >
                <span className="cc-menu-item-label">
                  <ClipboardPaste size={13} /> 粘贴为文本节点
                </span>
                <kbd>⌘V</kbd>
              </button>
            </>
          )}
        </div>
      )}

      {/* Subject / Variant Floating Popover */}
      {subjectModal && (
        <form
          className="cc-popover cc-modal-card"
          onPointerDown={(e) => e.stopPropagation()}
          onSubmit={(e) => void submitSubjectModal(e)}
        >
          <div className="cc-card-head">
            <b>{subjectModal.mode === 'variant' ? '新增主体状态分支' : '新建角色 / 产品 / 场景设定'}</b>
            <button type="button" onClick={() => setSubjectModal(null)} aria-label="关闭">
              <X size={13} />
            </button>
          </div>
          {subjectModal.mode === 'new' && (
            <div className="cc-grid-2">
              <select value={subjRole} onChange={(e) => setSubjRole(e.target.value as any)} aria-label="主体角色类型">
                <option value="character">角色形象</option>
                <option value="product">产品主体</option>
                <option value="environment">场景环境</option>
              </select>
              <input
                required
                autoFocus
                aria-label="主体名称"
                placeholder="名称（如：林夏）"
                value={subjName}
                onChange={(e) => setSubjName(e.target.value)}
              />
            </div>
          )}
          <div className="cc-grid-2">
            <input
              aria-label="状态分支名称"
              placeholder="状态（如：雨夜风衣态）"
              value={subjVar}
              onChange={(e) => setSubjVar(e.target.value)}
            />
            <select value={subjRef} onChange={(e) => setSubjRef(e.target.value)} aria-label="绑定参考图片">
              <option value="">无参考图（仅特征词）</option>
              {project.assets
                .filter((a) => a.kind === 'image')
                .map((img) => (
                  <option key={img.id} value={img.id}>
                    参考图：{img.name}
                  </option>
                ))}
            </select>
          </div>
          <textarea
            rows={2}
            aria-label="外观特征锁定描述"
            placeholder="特征锚点词（连线绑定到分镜后，AI 生成候选时自动带入）…"
            value={subjDesc}
            onChange={(e) => setSubjDesc(e.target.value)}
          />
          <div className="cc-card-foot">
            <button type="submit" className="button tiny primary">
              保存节点
            </button>
          </div>
        </form>
      )}

      {/* Clean Starter Guide on Empty Canvas */}
      {isEmpty && !subjectModal && (
        <div className="cc-empty-hero">
          <h2>以文本、参考素材与镜头节点自由串联创作</h2>
          <p>点击下方 ( + ) 添加文本或媒体，双击空白处新建文本节点，拖拽空白框选可多选编组与打包。</p>
          <div className="cc-starter-grid">
            <button type="button" className="cc-starter-card" onClick={() => void createTextNode('')}>
              <div className="cc-starter-head">
                <FileText size={15} />
                <span className="cc-starter-step">T</span>
              </div>
              <b>新建文本脚本节点</b>
              <small>写下分镜脚本，拖线拆解成片镜头或生成画面</small>
            </button>
            <button
              type="button"
              className="cc-starter-card"
              onClick={() => setSubjectModal({ mode: 'new' })}
            >
              <div className="cc-starter-head">
                <UserCheck size={15} />
                <span className="cc-starter-step">S</span>
              </div>
              <b>新建角色 / 设定</b>
              <small>锚定角色外观、产品形态与多状态参考图</small>
            </button>
            <button
              type="button"
              className="cc-starter-card"
              onClick={() => void addQuickCanvasRigNode('teardown-3d', 'product', '三维空间结构预演')}
            >
              <div className="cc-starter-head">
                <Box size={15} />
                <span className="cc-starter-step">C</span>
              </div>
              <b>三维与动态预演</b>
              <small>置入可交互运镜 3D 舞台或流程图解节点</small>
            </button>
          </div>
        </div>
      )}

      {/* Transformed Infinite World Layer */}
      <div
        className="cc-world"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* Spatial Canvas Groups Layer */}
        {groupBoxes.map(({ grp, x, y, w, h }) => (
          <div
            key={grp.id}
            className="cc-group-frame"
            style={{ left: x, top: y, width: w, height: h }}
          >
            <div
              className="cc-group-header"
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button, input')) return;
                e.stopPropagation();
                const origMap = new Map<string, Pt>();
                for (const id of grp.nodeIds) {
                  if (layoutRef.current[id]) origMap.set(id, { ...layoutRef.current[id] });
                }
                const sx = e.clientX;
                const sy = e.clientY;
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
                );
              }}
            >
              <Group size={11} />
              <span>{grp.name}</span>
              <div className="cc-group-acts">
                <button
                  type="button"
                  title="将整组节点添加到对话"
                  onClick={() => {
                    const refs = collectRefsFromNodeKeys(grp.nodeIds);
                    if (onAddRefsToChat && refs.length) onAddRefsToChat(refs, true);
                  }}
                >
                  <AtSign size={10} />
                </button>
                <button
                  type="button"
                  title="整组打成素材包"
                  onClick={() => void packNodeKeys(grp.nodeIds, false)}
                >
                  <Package size={10} />
                </button>
                <button
                  type="button"
                  title="解散此分组"
                  onClick={() =>
                    void onEdit('解散分组', [
                      {
                        type: 'updateProject',
                        changes: { canvasGroups: (project.canvasGroups || []).filter((g) => g.id !== grp.id) },
                      },
                    ])
                  }
                >
                  <X size={10} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* 1px Curved Bezier Relationship Wires */}
        <svg className="cc-wires-svg" width="4000" height="3000">
          {wires.map((w) => {
            const d = bezierPathFor(w.x1, w.y1, w.x2, w.y2, w.s1, w.s2);
            return (
              <g key={w.key} className="cc-wire-group">
                <path
                  d={d}
                  className={`cc-wire-path ${w.isLineage ? 'lineage' : ''} ${w.active ? 'active' : ''}`}
                />
                <circle cx={w.x1} cy={w.y1} r={3.5} className="cc-wire-dot" />
                <circle cx={w.x2} cy={w.y2} r={3.5} className="cc-wire-dot" />
              </g>
            );
          })}
          {wireDrag && (
            <path
              d={bezierPathFor(
                wireDrag.x1,
                wireDrag.y1,
                wireDrag.x2,
                wireDrag.y2,
                wireDrag.side,
                wireDrag.x2 >= wireDrag.x1 ? 'left' : 'right',
              )}
              className="cc-wire-path dragging"
            />
          )}
        </svg>

        {/* Zone Label Headers */}
        {totalAssetCount > 0 && (
          <div className="cc-lane-label" style={{ left: 40, top: 14 }}>
            <span>资产区 ({totalAssetCount})</span>
            <button
              type="button"
              className="cc-lane-action"
              onClick={() => setSubjectModal({ mode: 'new' })}
            >
              <UserCheck size={11} /> 新建角色 / 设定
            </button>
          </div>
        )}
        {shots.length > 0 && (
          <div className="cc-lane-label" style={{ left: shotLaneX, top: 14 }}>
            <span>
              成片分镜序列 ({sequence.name} · 共 {shots.length} 镜 ·{' '}
              {(shots.reduce((sum, s) => sum + s.duration, 0) / sequence.fps).toFixed(1)}s)
            </span>
            <button type="button" className="cc-lane-action" onClick={onSwitchToEdit}>
              进入剪辑精修 <ArrowRight size={11} />
            </button>
          </div>
        )}

        {/* Vault Entities: Text Nodes, Compound Saved Clips, Consistency Subjects & Dynamic Rigs */}
        {upstreamEntities.map((ent) => {
          const nodeKey = `ent:${ent.id}`;
          const pos = layout[nodeKey] || { x: 40, y: 44 };
          const selected = selectedNodeIds.includes(nodeKey);
          const isPrimarySelected = primarySelectedId === nodeKey && selectedNodeIds.length === 1;
          const isTextNote = ent.entityKind === 'text';
          const isCompound = ent.entityKind === 'compound';
          const variants = ent.variants || [];
          const activeVar =
            variants.find((v) => v.id === (activeVarByEnt[ent.id] || ent.defaultVariantId)) || variants[0];
          const refAssetId = activeVar?.assetId || ent.assetId;
          const refAsset = refAssetId ? project.assets.find((a) => a.id === refAssetId) : undefined;
          const hasRig = Boolean(ent.rig?.presetId && getPreset(ent.rig.presetId));

          return (
            <div
              key={nodeKey}
              data-node-id={nodeKey}
              className={`cc-node upstream ${isTextNote ? 'text-note' : ''} ${isCompound ? 'compound' : ''} ${selected ? 'selected' : ''} ${wireHoverKey === nodeKey ? 'wire-target' : ''}`}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={(e) => handleNodePointerDown(e, nodeKey, pos)}
              onClick={(e) => handleNodeCardClick(e, nodeKey)}
            >
              {isPrimarySelected && (
                <div className="cc-node-toolbar" onClick={(e) => e.stopPropagation()}>
                  {isTextNote ? (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          const rawContent = textDrafts[ent.id] ?? ent.textContent ?? '';
                          const content = rawContent.trim();
                          if (!content) return;
                          const dirty = rawContent !== (ent.textContent || '');
                          const saveOp: EditOperation[] = dirty
                            ? [
                                {
                                  type: 'putVaultItem',
                                  item: {
                                    ...clone(ent),
                                    textContent: rawContent,
                                    version: ent.version + 1,
                                    updatedAt: new Date().toISOString(),
                                  },
                                },
                              ]
                            : [];
                          const ops = scriptOutlineToShotOperations(sequence, content, {
                            entityId: ent.id,
                            version: ent.version + (dirty ? 1 : 0),
                          });
                          if (ops.length) await onEdit(`从「${ent.name}」拆解分镜`, [...saveOp, ...ops]);
                        }}
                      >
                        <Clapperboard size={12} /> 拆为分镜序列
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenGeneration({ use: 'image', prompt: textDrafts[ent.id] ?? ent.textContent ?? ent.name })
                        }
                      >
                        <Sparkles size={12} /> AI 生图
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenGeneration({ use: 'speech', prompt: textDrafts[ent.id] ?? ent.textContent ?? ent.name })
                        }
                      >
                        <AudioLines size={12} /> AI 配音
                      </button>
                    </>
                  ) : isCompound ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const tail = sequence.clips.length
                            ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
                            : 0;
                          const { operations, primaryClipId } = instantiateCompoundVaultItemOperations(
                            sequence.id,
                            ent,
                            tail,
                            sequence.fps,
                          );
                          if (operations.length) {
                            void onEdit(`置入复合资产「${ent.name}」`, operations).then(() => {
                              if (primaryClipId) onSelectClip(primaryClipId);
                            });
                          }
                        }}
                      >
                        <Plus size={12} /> 放入时间线
                      </button>
                      <button
                        type="button"
                        title="发布至跨项目个人库"
                        onClick={() => void onPublishToLibrary({ itemId: ent.id })}
                      >
                        ↑个人库
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenGeneration({
                            use: 'image',
                            prompt: `${ent.name}，${activeVar?.promptDelta || ent.promptAnchor || ''}`,
                            referenceAssetId: refAsset?.kind === 'image' ? refAsset.id : undefined,
                          })
                        }
                      >
                        <Sparkles size={12} /> AI 生成设定图
                      </button>
                      {hasRig ? (
                        <button
                          type="button"
                          onClick={() => setRigPopoverFor(rigPopoverFor === ent.id ? null : ent.id)}
                        >
                          <SlidersHorizontal size={12} /> 参数
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setSubjVar('');
                            setSubjDesc('');
                            setSubjectModal({ mode: 'variant', entId: ent.id });
                          }}
                        >
                          <GitBranch size={12} /> +状态
                        </button>
                      )}
                      <button type="button" onClick={() => void appendShotFromRigOrBlank(undefined, ent)}>
                        <Plus size={12} /> 派生镜头
                      </button>
                      <button
                        type="button"
                        title="发布至跨项目个人库"
                        onClick={() => void onPublishToLibrary({ itemId: ent.id })}
                      >
                        ↑个人库
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    title="移除节点"
                    onClick={() =>
                      void onEdit(`删除「${ent.name}」`, [{ type: 'removeVaultItem', itemId: ent.id }])
                    }
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}

              <button
                type="button"
                className="cc-port in"
                title="拖出或接收连线"
                aria-label={`${ent.name} 左侧连线端口`}
                onPointerDown={(e) => startWireDrag(e, nodeKey, 'left')}
              />

              <div className="cc-node-header">
                {isTextNote ? (
                  <FileText size={11} />
                ) : isCompound ? (
                  <Layers size={11} />
                ) : hasRig ? (
                  <Box size={11} />
                ) : (
                  <ImageIcon size={11} />
                )}
                <span>
                  {isTextNote ? ent.name : isCompound ? `精剪 · ${ent.name}` : `${ROLE_LABELS[inferAssetRole(ent)]} · ${ent.name}`}
                </span>
                <small>
                  {isCompound && ent.compound
                    ? `${(ent.compound.durationFrames / ent.compound.fps).toFixed(1)}s`
                    : `v${ent.version}`}
                </small>
              </div>

              <div className="cc-node-card">
                {isTextNote ? (
                  <textarea
                    className="cc-text-node-body"
                    rows={4}
                    aria-label="画布文本内容"
                    placeholder="输入分镜脚本（每行一镜）、创意构思或提示词…"
                    value={textDrafts[ent.id] ?? ent.textContent ?? ''}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const val = e.currentTarget.value;
                      setTextDrafts((prev) => ({ ...prev, [ent.id]: val }));
                    }}
                    onBlur={(e) => {
                      const val = e.currentTarget.value;
                      if (val !== (ent.textContent || '')) {
                        void onEdit(`更新文本「${ent.name}」`, [
                          {
                            type: 'putVaultItem',
                            item: {
                              ...clone(ent),
                              textContent: val,
                              version: ent.version + 1,
                              updatedAt: new Date().toISOString(),
                            },
                          },
                        ]);
                      }
                    }}
                  />
                ) : (
                  <>
                    <div className="cc-node-visual">
                      {hasRig ? (
                        <PresetPreview
                          presetId={ent.rig!.presetId!}
                          values={ent.rig!.props || {}}
                          playing={isPrimarySelected}
                          thumbnail={!isPrimarySelected}
                        />
                      ) : refAsset && !refAsset.offline && refAsset.thumbnail ? (
                        <img src={mediaUrl(previewOrigin, refAsset.id, true)} alt={ent.name} draggable={false} />
                      ) : isCompound ? (
                        <div className="cc-compound-placeholder">
                          <Layers size={18} />
                          <small>{ent.compound?.clips.length || 0} 层精剪组合</small>
                        </div>
                      ) : (
                        <div className="cc-anchor-text">
                          <p>{activeVar?.promptDelta || ent.promptAnchor || ent.description}</p>
                        </div>
                      )}
                    </div>

                    {variants.length > 0 && (
                      <div className="cc-node-variants">
                        {variants.map((vr) => (
                          <button
                            key={vr.id}
                            type="button"
                            className={vr.id === activeVar?.id ? 'active' : ''}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveVarByEnt((s) => ({ ...s, [ent.id]: vr.id }));
                            }}
                          >
                            {vr.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <button
                type="button"
                className="cc-port out"
                title="拖出连线至任意节点或空白画布派生"
                aria-label={`从 ${ent.name} 拖线`}
                onPointerDown={(e) => startWireDrag(e, nodeKey, 'right')}
              />

              {rigPopoverFor === ent.id && ent.rig?.presetId && (
                <div className="cc-popover cc-rig-inspector" onClick={(e) => e.stopPropagation()}>
                  <div className="cc-card-head">
                    <b>{ent.name} · 参数</b>
                    <button type="button" onClick={() => setRigPopoverFor(null)}>
                      <X size={12} />
                    </button>
                  </div>
                  <label className="cc-mini-field">
                    <span>主标题文案</span>
                    <input
                      value={String(ent.rig.props?.text || '')}
                      onChange={(e) => {
                        const nextProps = { ...(ent.rig?.props || {}), text: e.target.value };
                        void onEdit('更新画布组件文案', [
                          {
                            type: 'putVaultItem',
                            item: { ...clone(ent), rig: { ...ent.rig!, props: nextProps } },
                          },
                        ]);
                      }}
                    />
                  </label>
                  {ent.rig.presetId === 'teardown-3d' && (
                    <>
                      <label className="cc-mini-field">
                        <span>三维视角</span>
                        <select
                          value={String(ent.rig.props?.cameraPreset || 'orbit')}
                          onChange={(e) => {
                            const nextProps = { ...(ent.rig?.props || {}), cameraPreset: e.target.value };
                            void onEdit('切换三维视角', [
                              {
                                type: 'putVaultItem',
                                item: { ...clone(ent), rig: { ...ent.rig!, props: nextProps } },
                              },
                            ]);
                          }}
                        >
                          <option value="orbit">环绕审视</option>
                          <option value="isometric">等轴测俯视</option>
                          <option value="dolly-in">推近特写</option>
                          <option value="hero-low">低机位仰视</option>
                        </select>
                      </label>
                      <label className="cc-mini-field">
                        <span>拆解间距 ({Math.round(Number(ent.rig.props?.explode ?? 0.65) * 100)}%)</span>
                        <input
                          type="range"
                          min={0}
                          max={1.3}
                          step={0.05}
                          value={Number(ent.rig.props?.explode ?? 0.65)}
                          onChange={(e) => {
                            const nextProps = { ...(ent.rig?.props || {}), explode: Number(e.target.value) };
                            void onEdit('调整三维拆解间距', [
                              {
                                type: 'putVaultItem',
                                item: { ...clone(ent), rig: { ...ent.rig!, props: nextProps } },
                              },
                            ]);
                          }}
                        />
                      </label>
                    </>
                  )}
                  {ent.rig.presetId === 'screen-focus-rig' && (
                    <label className="cc-mini-field">
                      <span>设备外壳样式</span>
                      <select
                        value={String(ent.rig.props?.frameStyle || 'macos')}
                        onChange={(e) => {
                          const nextProps = { ...(ent.rig?.props || {}), frameStyle: e.target.value };
                          void onEdit('切换设备外壳', [
                            {
                              type: 'putVaultItem',
                              item: { ...clone(ent), rig: { ...ent.rig!, props: nextProps } },
                            },
                          ]);
                        }}
                      >
                        <option value="macos">macOS 圆角窗</option>
                        <option value="browser">极简浏览器框</option>
                        <option value="phone">竖屏手机壳</option>
                        <option value="terminal">暗色终端窗</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Standalone Project Media / Audio / 3D Asset Nodes */}
        {standaloneAssets.map((a) => {
          const nodeKey = `asset:${a.id}`;
          const pos = layout[nodeKey] || { x: 40, y: 44 };
          const selected = selectedNodeIds.includes(nodeKey);
          const isPrimarySelected = primarySelectedId === nodeKey && selectedNodeIds.length === 1;
          const isAudio = a.kind === 'audio';
          const kindLabel =
            isAudio ? '音频' : a.kind === 'video' ? '视频' : a.kind === 'model-3d' ? '三维模型' : '图片';
          const tail = sequence.clips.length
            ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
            : 0;

          return (
            <div
              key={nodeKey}
              data-node-id={nodeKey}
              className={`cc-node asset ${a.kind} ${selected ? 'selected' : ''} ${wireHoverKey === nodeKey ? 'wire-target' : ''}`}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={(e) => handleNodePointerDown(e, nodeKey, pos)}
              onClick={(e) => handleNodeCardClick(e, nodeKey)}
            >
              {isPrimarySelected && (
                <div className="cc-node-toolbar" onClick={(e) => e.stopPropagation()}>
                  {isAudio ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpenGeneration({ use: 'transcription', assetId: a.id })}
                      >
                        <FileText size={11} /> 转录字幕
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenGeneration({ use: 'speech', prompt: a.name })}
                      >
                        <Sparkles size={11} /> AI 配音
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const audioEnd = sequence.clips
                            .filter((c) => c.track === 'audio')
                            .reduce((m, c) => Math.max(m, c.start + c.duration), 0);
                          const c: Clip = {
                            ...newClip('audio', audioEnd, a.id),
                            name: a.name,
                            duration: Math.max(15, Math.floor(a.duration * sequence.fps)),
                          };
                          void onEdit(`铺入音频「${a.name}」`, [
                            { type: 'addClip', sequenceId: sequence.id, clip: c },
                          ]);
                        }}
                      >
                        <Plus size={11} /> 铺入音轨
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenGeneration({
                            use: 'image',
                            prompt: `${a.name.replace(/\.[^.]+$/, '')}，视觉变体延展`,
                            referenceAssetId: a.kind === 'image' ? a.id : undefined,
                          })
                        }
                      >
                        <Sparkles size={11} /> AI 派生
                      </button>
                      {a.kind === 'image' && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenGeneration({
                              use: 'video',
                              prompt: `${a.name.replace(/\.[^.]+$/, '')}，平滑镜头运动`,
                              referenceAssetId: a.id,
                            })
                          }
                        >
                          <Clapperboard size={11} /> 图生视频
                        </button>
                      )}
                      {a.kind === 'image' && (
                        <button
                          type="button"
                          onClick={() => {
                            setSubjName(a.name.replace(/\.[^.]+$/, '').slice(0, 16));
                            setSubjRef(a.id);
                            setSubjDesc('');
                            setSubjectModal({ mode: 'new' });
                          }}
                        >
                          <UserCheck size={11} /> 设为设定
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const c: Clip = {
                            ...newClip(a.kind === 'model-3d' ? 'shape' : a.kind, tail, a.id),
                            name: a.name,
                            duration: Math.max(
                              15,
                              Math.floor((a.kind === 'image' ? 5 : a.duration) * sequence.fps),
                            ),
                          };
                          void onEdit(`加入分镜「${a.name}」`, [
                            { type: 'addClip', sequenceId: sequence.id, clip: c },
                          ]);
                        }}
                      >
                        <Plus size={11} /> 入选镜头
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    title="发布至跨项目个人库"
                    onClick={() => void onPublishToLibrary({ assetId: a.id })}
                  >
                    ↑个人库
                  </button>
                  <button
                    type="button"
                    title="从工程移除素材"
                    onClick={() =>
                      void onEdit(`删除素材「${a.name}」`, [{ type: 'removeAsset', assetId: a.id }])
                    }
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}

              <button
                type="button"
                className="cc-port in"
                title="拖出或接收参考连线"
                aria-label={`${a.name} 左侧连线端口`}
                onPointerDown={(e) => startWireDrag(e, nodeKey, 'left')}
              />

              <div className="cc-node-header">
                {isAudio ? <AudioLines size={11} /> : a.kind === 'model-3d' ? <Box size={11} /> : <ImageIcon size={11} />}
                <span>
                  {kindLabel} · {a.name}
                </span>
                <small>{a.duration > 0 ? `${a.duration.toFixed(1)}s` : a.width ? `${a.width}px` : ''}</small>
              </div>

              <div className="cc-node-card asset-card">
                {isAudio ? (
                  <div className="cc-audio-card-body">
                    <AudioWaveformPlayer
                      id={a.id}
                      name={a.name}
                      url={mediaUrl(previewOrigin, a.id)}
                      duration={a.duration}
                      waveform={a.waveform}
                    />
                  </div>
                ) : a.thumbnail ? (
                  <div className="cc-node-preview">
                    <img src={mediaUrl(previewOrigin, a.id, true)} alt={a.name} draggable={false} />
                  </div>
                ) : (
                  <div className="cc-node-placeholder">
                    {a.kind === 'model-3d' ? <Box size={22} /> : <ImageIcon size={22} />}
                    <small>{kindLabel}资产</small>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="cc-port out"
                title="拖出连线建立参考关联或生成下游镜头"
                aria-label={`从 ${a.name} 拖线`}
                onPointerDown={(e) => startWireDrag(e, nodeKey, 'right')}
              />
            </div>
          );
        })}

        {/* Standalone Custom Code Components */}
        {standaloneComponents.map((comp) => {
          const nodeKey = `comp:${comp.id}`;
          const pos = layout[nodeKey] || { x: 40, y: 44 };
          const selected = selectedNodeIds.includes(nodeKey);
          const isPrimarySelected = primarySelectedId === nodeKey && selectedNodeIds.length === 1;
          const tail = sequence.clips.length
            ? Math.max(...sequence.clips.map((c) => c.start + c.duration))
            : 0;
          return (
            <div
              key={nodeKey}
              data-node-id={nodeKey}
              className={`cc-node asset component ${selected ? 'selected' : ''} ${wireHoverKey === nodeKey ? 'wire-target' : ''}`}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={(e) => handleNodePointerDown(e, nodeKey, pos)}
              onClick={(e) => handleNodeCardClick(e, nodeKey)}
            >
              {isPrimarySelected && (
                <div className="cc-node-toolbar" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => {
                      const c: Clip = {
                        ...newClip('code', tail),
                        name: comp.name,
                        componentId: comp.id,
                        props: { ...comp.props },
                      };
                      void onEdit(`加入组件「${comp.name}」`, [
                        { type: 'addClip', sequenceId: sequence.id, clip: c },
                      ]);
                    }}
                  >
                    <Plus size={11} /> 放入镜头
                  </button>
                  <button
                    type="button"
                    title="发布组件至个人库"
                    onClick={() => void onPublishToLibrary({ componentId: comp.id })}
                  >
                    ↑个人库
                  </button>
                </div>
              )}
              <button
                type="button"
                className="cc-port in"
                title="拖出或接收连线"
                aria-label={`${comp.name} 左侧连线端口`}
                onPointerDown={(e) => startWireDrag(e, nodeKey, 'left')}
              />
              <div className="cc-node-header">
                <Layers size={11} />
                <span>组件 · {comp.name}</span>
              </div>
              <div className="cc-node-card asset-card">
                <div className="cc-node-placeholder">
                  <Layers size={20} />
                  <small>TSX 动态组件</small>
                </div>
              </div>
              <button
                type="button"
                className="cc-port out"
                title="拖线挂载到分镜或时间线"
                aria-label={`从 ${comp.name} 拖线`}
                onPointerDown={(e) => startWireDrag(e, nodeKey, 'right')}
              />
            </div>
          );
        })}

        {/* Structured Storyboard Sequence Shot Nodes (TapNow Simplified Card Surface) */}
        {shots.map((shot) => {
          const nodeKey = `shot:${shot.id}`;
          const pos = layout[nodeKey] || { x: 340, y: 44 };
          const selected = selectedNodeIds.includes(nodeKey);
          const isPrimarySelected = primarySelectedId === nodeKey && selectedNodeIds.length === 1;
          const c = shot.anchorClip;
          const takes = c.takes || [];
          const primaryBinding = shot.bindings[0];
          const boundEnt = primaryBinding
            ? upstreamEntities.find((x) => x.id === primaryBinding.entityId)
            : undefined;
          const boundVar = boundEnt?.variants?.find((v) => v.id === primaryBinding?.variantId);

          return (
            <div
              key={nodeKey}
              data-node-id={nodeKey}
              data-shot-node-id={shot.id}
              className={`cc-node shot ${selected ? 'selected' : ''} ${wireHoverKey === nodeKey ? 'wire-target' : ''}`}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={(e) => handleNodePointerDown(e, nodeKey, pos)}
              onClick={(e) => handleNodeCardClick(e, nodeKey, c.id)}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/cocraft-entity')) e.preventDefault();
              }}
              onDrop={(e) => {
                const entPayload = e.dataTransfer.getData('application/cocraft-entity');
                if (entPayload && !shot.locked) {
                  e.preventDefault();
                  e.stopPropagation();
                  const [entityId, variantId] = entPayload.split(':');
                  void onEdit('绑定主体到分镜', [
                    {
                      type: 'updateClip',
                      sequenceId: sequence.id,
                      clipId: c.id,
                      changes: {
                        subjectBindings: [{ entityId, variantId: variantId || undefined }],
                        subjectIds: [entityId],
                      },
                    },
                  ]);
                }
              }}
            >
              {isPrimarySelected && (
                <div className="cc-node-toolbar" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    aria-label="前移镜头"
                    title="前移镜头（画面与字幕同步移动）"
                    disabled={shot.locked || shot.index === 1}
                    onClick={() => {
                      const ops = moveCompositeShotOperations(sequence, shots, shot.id, -1);
                      if (ops.length) void onEdit(`前移镜头 #${shot.index}`, ops);
                    }}
                  >
                    <ArrowLeft size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label="后移镜头"
                    title="后移镜头（画面与字幕同步移动）"
                    disabled={shot.locked || shot.index === shots.length}
                    onClick={() => {
                      const ops = moveCompositeShotOperations(sequence, shots, shot.id, 1);
                      if (ops.length) void onEdit(`后移镜头 #${shot.index}`, ops);
                    }}
                  >
                    <ArrowRight size={12} />
                  </button>
                  <span className="cc-tb-sep" />
                  <button
                    type="button"
                    aria-label={`镜头 ${shot.index} AI 生成候选`}
                    onClick={() => {
                      const ctx = resolveShotGenContext(shot);
                      onOpenGeneration({
                        use: 'image',
                        prompt: ctx.prompt,
                        referenceAssetId: ctx.refAssetId,
                      });
                    }}
                  >
                    <Sparkles size={12} /> 生图/视频
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAiMode('agent');
                      const ctx = resolveShotGenContext(shot);
                      setOmnibarDraft(`优化镜头 #${shot.index}（${ctx.prompt || c.name}）：`);
                      requestAnimationFrame(() => omnibarInputRef.current?.focus());
                    }}
                  >
                    <Wand2 size={11} /> 微调
                  </button>
                  <button
                    type="button"
                    aria-label={`为镜头 ${shot.index} 生产候选`}
                    onClick={() => setTakeMenuFor(takeMenuFor === shot.id ? null : shot.id)}
                  >
                    <Plus size={12} /> 候选
                  </button>
                  <button
                    type="button"
                    title="进入时间线在此位置精剪"
                    onClick={() => {
                      onSelectClip(c.id);
                      onSeek(shot.start);
                      onSwitchToEdit();
                    }}
                  >
                    <Scissors size={11} /> 精剪
                  </button>
                  {onSaveClipsAsAsset && (
                    <button
                      type="button"
                      aria-label="保存为项目资产"
                      title="将当前镜头整组保存为复合资产"
                      onClick={() => void onSaveClipsAsAsset([...shot.compositeClips, ...shot.captionClips], c.name)}
                    >
                      <BookmarkPlus size={11} /> 存资产
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={c.locked ? '解锁镜头' : '锁定镜头'}
                    onClick={() =>
                      void onEdit(c.locked ? '解锁镜头' : '锁定镜头', [
                        { type: 'updateClip', sequenceId: sequence.id, clipId: c.id, changes: { locked: !c.locked } },
                      ])
                    }
                  >
                    {c.locked ? <Lock size={11} /> : <Unlock size={11} />}
                  </button>
                  {!c.locked && (
                    <button
                      type="button"
                      aria-label={`删除镜头 ${shot.index}`}
                      title="删除此分镜"
                      onClick={() =>
                        void onEdit(`删除镜头 #${shot.index}`, [
                          { type: 'deleteClip', sequenceId: sequence.id, clipId: c.id },
                        ])
                      }
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              )}

              {takeMenuFor === shot.id && (
                <div className="cc-popover cc-take-menu" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => void addShotCandidateTake(shot, 'seecode-architecture')}>
                    + 流程指标图解候选
                  </button>
                  <button type="button" onClick={() => void addShotCandidateTake(shot, 'tinycharts-state')}>
                    + 手绘白板推演候选
                  </button>
                  <button type="button" onClick={() => void addShotCandidateTake(shot, 'teardown-3d')}>
                    + 三维空间结构候选
                  </button>
                  <button type="button" onClick={() => void addShotCandidateTake(shot, 'screen-focus-rig')}>
                    + 设备窗口特写候选
                  </button>
                  <button type="button" onClick={() => void addShotCandidateTake(shot, 'clone')}>
                    克隆当前画面为候选
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTakeMenuFor(null);
                      const ctx = resolveShotGenContext(shot);
                      onOpenGeneration({
                        use: 'image',
                        prompt: ctx.prompt,
                        referenceAssetId: ctx.refAssetId,
                      });
                    }}
                  >
                    <Sparkles size={12} /> AI 生图/生视频候选（带入台词与参考图）
                  </button>
                </div>
              )}

              <button
                type="button"
                className="cc-port in"
                title="拖出或接收上游设定或参考节点连线"
                aria-label={`镜头 ${shot.index} 左侧连线端口`}
                onPointerDown={(e) => startWireDrag(e, nodeKey, 'left')}
              />

              <div className="cc-node-header">
                <Film size={11} />
                <span>
                  镜头 {String(shot.index).padStart(2, '0')} · {timecode(shot.start, sequence.fps)}
                </span>
                <small>
                  {(shot.duration / sequence.fps).toFixed(1)}s
                  {shot.compositeClips.length > 1 ? ` · ${shot.compositeClips.length}层` : ''}
                </small>
              </div>

              <div className="cc-node-card shot-card-body">
                <div className="cc-shot-thumb">
                  <ShotCompositeThumb
                    project={project}
                    sequence={sequence}
                    shot={shot}
                    previewOrigin={previewOrigin}
                  />
                  {shot.locked && (
                    <span className="cc-lock-tag">
                      <Lock size={10} />
                    </span>
                  )}
                  {!selected && (shot.scriptText || boundEnt) && (
                    <div className="cc-shot-overlay-cap">
                      {boundEnt && <b>@{boundEnt.name}</b>}
                      <span>{shot.scriptText || c.name}</span>
                    </div>
                  )}
                </div>

                {selected && (
                  <div className="cc-shot-inspector-drawer" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      key={`${shot.id}-${shot.scriptText}`}
                      className="cc-shot-script"
                      rows={2}
                      aria-label={`镜头 ${shot.index} 旁白与字幕`}
                      placeholder="输入本镜台词或旁白（自动同步字幕轨）…"
                      defaultValue={shot.scriptText}
                      disabled={shot.locked}
                      onBlur={(e) => {
                        if (e.currentTarget.value.trim() !== shot.scriptText.trim()) {
                          void onEdit(
                            `更新镜头 #${shot.index} 台词`,
                            updateShotScriptOperations(sequence, shot, e.currentTarget.value),
                          );
                        }
                      }}
                    />
                    <div className="cc-shot-foot">
                      {shot.bindings.map((binding) => {
                        const ent = upstreamEntities.find((x) => x.id === binding.entityId);
                        if (!ent) return null;
                        const vr =
                          ent.variants?.find((v) => v.id === binding.variantId) ||
                          ent.variants?.find((v) => v.id === ent.defaultVariantId) ||
                          ent.variants?.[0];
                        return (
                          <span key={binding.entityId} className="cc-bound-pill" title="已通过画布连线绑定一致性特征">
                            @{ent.name}
                            {vr ? `:${vr.name}` : ''}
                            {!shot.locked && (
                              <button
                                type="button"
                                aria-label={`解除主体绑定 ${ent.name}`}
                                onClick={() => {
                                  const nextBindings = shot.bindings.filter((x) => x.entityId !== ent.id);
                                  void onEdit(`解除 @${ent.name} 绑定`, [
                                    {
                                      type: 'updateClip',
                                      sequenceId: sequence.id,
                                      clipId: c.id,
                                      changes: {
                                        subjectBindings: nextBindings,
                                        subjectIds: nextBindings.map((x) => x.entityId),
                                      },
                                    },
                                  ]);
                                }}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        );
                      })}
                      {!shot.locked && upstreamEntities.some((u) => !shot.bindings.some((b) => b.entityId === u.id)) ? (
                        <select
                          className="cc-bind-select"
                          aria-label={`镜头 ${shot.index} 绑定主体`}
                          value=""
                          onChange={(e) => {
                            const ent = upstreamEntities.find((x) => x.id === e.target.value);
                            if (!ent) return;
                            const vrId = activeVarByEnt[ent.id] || ent.defaultVariantId || ent.variants?.[0]?.id;
                            const nextBindings = [
                              ...shot.bindings.filter((x) => x.entityId !== ent.id),
                              { entityId: ent.id, variantId: vrId, pinnedVersion: ent.version },
                            ];
                            void onEdit(`绑定 @${ent.name}`, [
                              {
                                type: 'updateClip',
                                sequenceId: sequence.id,
                                clipId: c.id,
                                changes: {
                                  subjectBindings: nextBindings,
                                  subjectIds: nextBindings.map((x) => x.entityId),
                                },
                              },
                            ]);
                          }}
                        >
                          <option value="">+ 绑定节点…</option>
                          {upstreamEntities
                            .filter((u) => !shot.bindings.some((b) => b.entityId === u.id))
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                @{u.name}
                              </option>
                            ))}
                        </select>
                      ) : shot.bindings.length === 0 ? (
                        <span className="cc-muted-meta">{c.name.slice(0, 14)}</span>
                      ) : null}

                      <div className="cc-takes">
                        {takes.map((t, ti) => {
                          const isAct = c.activeTakeId === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              className={isAct ? 'active' : ''}
                              title={t.label}
                              disabled={c.locked}
                              onClick={() =>
                                void onEdit(`切换镜头 #${shot.index} 候选`, [
                                  { type: 'switchClipTake', sequenceId: sequence.id, clipId: c.id, takeId: t.id },
                                ])
                              }
                            >
                              {isAct && <Check size={9} />}T{ti + 1}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="cc-port out"
                title="拖出连线派生后续分镜或参考"
                aria-label={`从镜头 ${shot.index} 拖线`}
                onPointerDown={(e) => startWireDrag(e, nodeKey, 'right')}
              />
            </div>
          );
        })}

        {/* Add Trailing Shot Card */}
        {shots.length > 0 && (
          <button
            type="button"
            className="cc-append-shot-node"
            style={{
              left: shotLaneX + (shots.length % 6) * 316,
              top: 64 + Math.floor(shots.length / 6) * 246,
            }}
            onClick={() => void appendShotFromRigOrBlank()}
          >
            <Plus size={15} />
            <span>新增镜头 {String(shots.length + 1).padStart(2, '0')}</span>
          </button>
        )}

        {/* Clickable Bezier Wire Label Pills */}
        <svg className="cc-wires-svg cc-wire-pills-layer" width="4000" height="3000">
          {wires.map((w) => {
            const mx = (w.x1 + w.x2) / 2;
            const my = (w.y1 + w.y2) / 2;
            const pillW = Math.min(180, Math.max(64, w.label.length * 8.5 + 22));
            return (
              <g
                key={w.key}
                className={`cc-wire-pill ${w.isLineage ? 'lineage-pill' : ''}`}
                transform={`translate(${mx}, ${my})`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (w.kind === 'asset-lineage' && w.targetAssetId) {
                    const targetAsset = project.assets.find((x) => x.id === w.targetAssetId);
                    if (!targetAsset) return;
                    const nextDerived = (targetAsset.derivedFrom || []).filter((d) => {
                      if (w.sourceVaultId && d.vaultItemId === w.sourceVaultId) return false;
                      if (w.sourceAssetId && d.assetId === w.sourceAssetId && !w.sourceVaultId) return false;
                      return true;
                    });
                    void onEdit('解除参考关联连线', [
                      { type: 'updateAssetMeta', assetId: targetAsset.id, changes: { derivedFrom: nextDerived } },
                    ]);
                    return;
                  }
                  if (w.kind === 'entity-lineage' && w.targetEntId) {
                    const targetEnt = upstreamEntities.find((x) => x.id === w.targetEntId);
                    if (!targetEnt) return;
                    const nextDerived = (targetEnt.derivedFrom || []).filter((d) => {
                      if (w.sourceVaultId && d.vaultItemId === w.sourceVaultId) return false;
                      if (w.sourceAssetId && d.assetId === w.sourceAssetId) return false;
                      return true;
                    });
                    void onEdit('解除资产派生连线', [
                      {
                        type: 'putVaultItem',
                        item: {
                          ...clone(targetEnt),
                          derivedFrom: nextDerived,
                          updatedAt: new Date().toISOString(),
                        },
                      },
                    ]);
                    return;
                  }
                  if (w.kind === 'shot-clip' && w.removeClipId) {
                    const removeClip = sequence.clips.find((c) => c.id === w.removeClipId);
                    if (!removeClip || removeClip.locked) return;
                    void onEdit('移出分镜片段连线', [
                      { type: 'deleteClip', sequenceId: sequence.id, clipId: w.removeClipId },
                    ]);
                    return;
                  }
                  const clip = sequence.clips.find((c) => c.id === w.clipId);
                  if (!clip || clip.locked) return;
                  const nextBindings = (clip.subjectBindings || []).filter((x) => x.entityId !== w.entityId);
                  const nextSubjectIds = (clip.subjectIds || []).filter((id) => id !== w.entityId);
                  void onEdit(`解除 ${w.label} 绑定`, [
                    {
                      type: 'updateClip',
                      sequenceId: sequence.id,
                      clipId: clip.id,
                      changes: { subjectBindings: nextBindings, subjectIds: nextSubjectIds },
                    },
                  ]);
                }}
              >
                <title>点击解除「{w.label}」连线</title>
                <rect x={-pillW / 2} y={-10} width={pillW} height={20} rx={10} />
                <text x={0} y={3.5} textAnchor="middle">
                  {w.label.length > 16 ? `${w.label.slice(0, 15)}…` : w.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bottom-Right TapNow 3-in-1 Utility Capsule + Popover Minimap */}
      <div className="cc-bottom-right-controls" onPointerDown={(e) => e.stopPropagation()}>
        {showMinimap && minimapDots.length > 0 && (
          <div className="cc-minimap" aria-hidden="true">
            {minimapDots.map((dot) => (
              <i
                key={dot.key}
                className={dot.isShot ? 'shot-dot' : 'ent-dot'}
                style={{
                  left: `${dot.left}%`,
                  top: `${dot.top}%`,
                }}
              />
            ))}
          </div>
        )}
        <div className="cc-utility-pill" role="toolbar" aria-label="画布视图工具">
          {onToggleRightAgent && (
            <button
              type="button"
              className={rightAgentOpen ? 'active' : ''}
              title="展开 / 收起右侧 Agent 对话"
              aria-label="切换 Agent 对话面板"
              onClick={onToggleRightAgent}
            >
              <MessageSquare size={13} />
            </button>
          )}
          <button
            type="button"
            className={showMinimap ? 'active' : ''}
            title="显示 / 隐藏画布小地图"
            aria-label="切换画布小地图"
            onClick={() => setShowMinimap((v) => !v)}
          >
            <MapIcon size={13} />
          </button>
          <span className="cc-zoom-sep" />
          <button
            type="button"
            title="缩小画布"
            aria-label="缩小画布"
            disabled={zoom <= 0.45}
            onClick={() => setZoom((z) => Math.max(0.45, Math.round((z - 0.1) * 100) / 100))}
          >
            <ZoomOut size={12} />
          </button>
          <button
            type="button"
            className="cc-zoom-readout"
            title="自动整理节点与视角"
            onClick={resetCanvasView}
          >
            <LayoutGrid size={11} style={{ marginRight: 3 }} />
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            title="放大画布"
            aria-label="放大画布"
            disabled={zoom >= 1.5}
            onClick={() => setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 100) / 100))}
          >
            <ZoomIn size={12} />
          </button>
        </div>
      </div>

      {/* TapNow Bottom-Centered Dock: Omnibar + Independent Circular (+) FAB */}
      {!rightAgentOpen &&
        (() => {
          const singleRefs = selectedNodeIds.length > 0 ? collectRefsFromNodeKeys(selectedNodeIds) : [];
          const selectedShot =
            primarySelectedId?.startsWith('shot:')
              ? shots.find((s) => `shot:${s.id}` === primarySelectedId)
              : undefined;
          const selectedEnt =
            primarySelectedId?.startsWith('ent:')
              ? upstreamEntities.find((e) => `ent:${e.id}` === primarySelectedId)
              : undefined;
          const selectedAsset =
            primarySelectedId?.startsWith('asset:')
              ? standaloneAssets.find((a) => `asset:${a.id}` === primarySelectedId)
              : undefined;
          const activeVal = omnibarDraft || floatingPrompt;

          const handleOmnibarSubmit = async (e: React.FormEvent) => {
            e.preventDefault();
            const text = activeVal.trim();
            if (!text) return;
            if (aiMode === 'script') {
              if (text.includes('\n')) {
                const ops = scriptOutlineToShotOperations(sequence, text);
                if (ops.length) {
                  await onEdit('从指令舱脚本拆解分镜', ops);
                  setOmnibarDraft('');
                  onFloatingPromptChange('');
                }
              } else {
                onSendCanvasInstruction(
                  `请围绕以下创意主题为当前分支拆解生成多镜头分镜脚本、字幕与匹配画面：${text}`,
                  selectedShot?.anchorClip,
                );
                setOmnibarDraft('');
              }
              return;
            }
            if (aiMode === 'subject') {
              onOpenGeneration({
                use: 'image',
                prompt: `${text}，角色/主体设定参考图，特征稳定一致`,
              });
              setOmnibarDraft('');
              return;
            }
            if (aiMode === 'shot') {
              const shotCtx = selectedShot ? resolveShotGenContext(selectedShot) : undefined;
              const refEntAsset = selectedEnt
                ? selectedEnt.variants?.[0]?.assetId || selectedEnt.assetId
                : selectedAsset?.kind === 'image'
                  ? selectedAsset.id
                  : undefined;
              onOpenGeneration({
                use: 'image',
                prompt: [shotCtx?.prompt, ...singleRefs.map((r) => `@${r.label}`), text]
                  .filter(Boolean)
                  .join('，'),
                referenceAssetId: shotCtx?.refAssetId || refEntAsset,
              });
              setOmnibarDraft('');
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

          const omniModes = [
            { id: 'script' as const, label: '拆解分镜', icon: FileText },
            { id: 'subject' as const, label: '角色设定', icon: UserCheck },
            { id: 'shot' as const, label: '生成画面', icon: Clapperboard },
            { id: 'agent' as const, label: 'Agent 编排', icon: Sparkles },
          ];

          return (
            <div className="cc-bottom-dock" onPointerDown={(e) => e.stopPropagation()}>
              <form className="cc-ai-omnibar" onSubmit={(e) => void handleOmnibarSubmit(e)}>
                <div className="cc-omni-top">
                  <div className="cc-omni-modes" role="tablist" aria-label="AI 画布创作模式">
                    {omniModes.map((m) => {
                      const Icon = m.icon;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="tab"
                          aria-selected={aiMode === m.id}
                          className={`cc-omni-mode ${aiMode === m.id ? 'active' : ''}`}
                          onClick={() => setAiMode(m.id)}
                        >
                          <Icon size={11} />
                          <span>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {(singleRefs.length > 0 || chatRefs.length > 0) &&
                    (() => {
                      const uniqueSingle = singleRefs.filter((sr) => !chatRefs.some((cr) => cr.key === sr.key));
                      const shownChat = chatRefs.slice(0, 3);
                      const shownSingle = uniqueSingle.slice(0, Math.max(0, 3 - shownChat.length));
                      const totalCount = chatRefs.length + uniqueSingle.length;
                      const overflow = totalCount - (shownChat.length + shownSingle.length);
                      return (
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
                                onClick={() => setSelectedNodeIds((prev) => prev.filter((k) => k !== sr.key))}
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ))}
                          {overflow > 0 && <span className="cc-omni-ctx">+{overflow} 项</span>}
                        </div>
                      );
                    })()}
                </div>

                <div className="cc-omni-row">
                  <input
                    ref={omnibarInputRef}
                    aria-label="悬浮 Agent 指令输入"
                    placeholder={
                      aiMode === 'script'
                        ? '输入创意主题，或粘贴多行剧本拆解分镜…'
                        : aiMode === 'subject'
                          ? '描述要生成的角色或产品视觉设定…'
                          : aiMode === 'shot'
                            ? '结合选中设定或镜头上下文生成画面…'
                            : '输入指令，或点右侧 + 添加节点 / @ 引用资产…'
                    }
                    value={activeVal}
                    onChange={(e) => {
                      setOmnibarDraft(e.target.value);
                      onFloatingPromptChange(e.target.value);
                    }}
                  />
                  <button
                    type="button"
                    className={`cc-omni-tool ${canvasTool === 'select' ? 'active' : ''}`}
                    title={canvasTool === 'select' ? '当前：指针框选 (按空格拖拽平移，点此切换抓手 H)' : '当前：抓手平移 (点此切换回框选 V)'}
                    aria-label="切换框选或平移工具"
                    onClick={() => setCanvasTool((t) => (t === 'select' ? 'pan' : 'select'))}
                  >
                    {canvasTool === 'select' ? <MousePointer2 size={13} /> : <Hand size={13} />}
                  </button>
                  <button
                    type="submit"
                    className="cc-omni-send"
                    disabled={!activeVal.trim()}
                    aria-label="发送指令"
                  >
                    <ArrowUp size={13} />
                  </button>
                </div>
              </form>

              <div className="cc-fab-wrap">
                <button
                  type="button"
                  className={`cc-add-fab ${addMenuOpen ? 'open' : ''}`}
                  aria-label="添加画布节点"
                  title="添加节点 (文本 / 图片 / 视频 / 音频 / 组件)"
                  onClick={() => setAddMenuOpen((v) => !v)}
                >
                  <Plus size={18} />
                </button>

                {addMenuOpen && (
                  <div className="cc-popover cc-tap-menu cc-fab-menu" role="menu" aria-label="添加画布节点">
                    <div className="cc-menu-group">添加</div>
                    <button type="button" onClick={() => void createTextNode('')}>
                      <span className="cc-menu-item-label">
                        <FileText size={13} /> 文本
                      </span>
                      <kbd>T</kbd>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false);
                        onOpenGeneration({ use: 'image' });
                      }}
                    >
                      <span className="cc-menu-item-label">
                        <ImageIcon size={13} /> 图片
                      </span>
                      <kbd>I</kbd>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false);
                        onOpenGeneration({ use: 'video' });
                      }}
                    >
                      <span className="cc-menu-item-label">
                        <Clapperboard size={13} /> 视频
                      </span>
                      <kbd>V</kbd>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false);
                        onOpenGeneration({ use: 'speech' });
                      }}
                    >
                      <span className="cc-menu-item-label">
                        <AudioLines size={13} /> 音频
                      </span>
                      <kbd>A</kbd>
                    </button>
                    <div className="cc-menu-divider" />
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setSubjectModal({ mode: 'new' });
                      }}
                    >
                      <span className="cc-menu-item-label">
                        <UserCheck size={13} /> 角色 / 设定
                      </span>
                      <kbd>S</kbd>
                    </button>
                    <button
                      type="button"
                      onClick={() => void addQuickCanvasRigNode('teardown-3d', 'product', '三维空间结构预演')}
                    >
                      <span className="cc-menu-item-label">
                        <Box size={13} /> 3D 运镜组件
                      </span>
                      <kbd>C</kbd>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false);
                        onImportMedia();
                      }}
                    >
                      <span className="cc-menu-item-label">
                        <Upload size={13} /> 上传
                      </span>
                      <kbd>U</kbd>
                    </button>
                    <button type="button" onClick={() => void appendShotFromRigOrBlank()}>
                      <span className="cc-menu-item-label">
                        <Film size={13} /> 空白分镜
                      </span>
                      <kbd>N</kbd>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
