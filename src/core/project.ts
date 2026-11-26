import type {
  Project,
  Sequence,
  Clip,
  Asset,
  AssetLineageRef,
  ClipTake,
  EditOperation,
  EditScope,
  PreflightIssue,
  CodeComponent,
  Track,
  VaultItem,
} from './types';
import { applyStyleTokensToClip, resolveProjectStyle } from './presets';
import { scaleKeyframesForFps, splitKeyframesForSplit } from './keyframes';
import { reframeClipForTargetAspect } from './system1Rules';

export { reframeClipForTargetAspect };

export const uid = (prefix = 'id') => `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
export const clone = <T>(v: T): T => structuredClone(v);
export const durationOf = (s: Sequence) => Math.max(s.fps, ...s.clips.map((c) => c.start + c.duration));

export const timecode = (frames: number, fps = 30) => {
  const f = Math.max(0, Math.round(frames));
  return (
    `${Math.floor(f / fps / 60)
      .toString()
      .padStart(2, '0')}:${Math.floor(f / fps) % 60}`.replace(/:(\d)$/g, ':0$1') +
    `.` +
    String(Math.floor(((f % fps) / fps) * 100)).padStart(2, '0')
  );
};

export const timecodeFrames = (frames: number, fps = 30) => {
  const f = Math.max(0, Math.round(frames));
  const m = Math.floor(f / fps / 60);
  const s = Math.floor(f / fps) % 60;
  const rem = f % fps;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
};

export function newProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: uid('project'),
    name,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    brief: '创作一支有节奏、有呼吸感的短片。先保证叙事清楚，再打磨画面与声音。',
    assets: [],
    components: [],
    sequences: [
      {
        id: uid('seq'),
        name: '主片',
        branchName: 'main',
        isMainBranch: true,
        width: 1920,
        height: 1080,
        fps: 30,
        clips: [],
        background: '#10161c',
      },
    ],
  };
}

export const newClip = (rawKind: Clip['kind'] | 'model-3d', start = 0, assetId?: string): Clip => {
  const kind: Clip['kind'] = rawKind === 'model-3d' ? 'shape' : rawKind;
  return {
    id: uid('clip'),
    name:
      rawKind === 'model-3d'
        ? '3D 模型舞台'
        : kind === 'title'
          ? '新的标题'
          : kind === 'caption'
            ? '字幕'
            : kind === 'shape'
              ? '氛围背景'
              : '新片段',
    kind,
  track:
    kind === 'audio'
      ? 'audio'
      : kind === 'caption'
        ? 'caption'
        : kind === 'title' || kind === 'code'
          ? 'overlay'
          : 'visual',
  start,
  duration: kind === 'caption' ? 90 : 150,
  sourceIn: 0,
  assetId,
  locked: false,
  props:
    kind === 'title'
      ? {
          text: '输入主标题',
          fontSize: 80,
          fontWeight: 700,
          color: '#f5f5f7',
          position: 'center',
          align: 'center',
          animation: 'none',
          template: 'clean',
        }
      : kind === 'caption'
        ? {
            text: '输入字幕',
            fontSize: 46,
            fontWeight: 600,
            color: '#ffffff',
            position: 'bottom',
            align: 'center',
            background: '#0c0d10',
            bgEnabled: true,
            bgOpacity: 0.76,
            bgRadius: 8,
            bgPaddingX: 22,
            bgPaddingY: 10,
            animation: 'none',
          }
        : {
            volume: kind === 'audio' ? 0.35 : 1,
            opacity: 1,
            scale: 1,
            fit: 'cover',
            template: 'aurora',
            color: '#8faac2',
          },
  };
};

export function validateProject(p: Project): void {
  if (p.schemaVersion !== 1 || !p.id || !Array.isArray(p.sequences) || !p.sequences.length)
    throw new Error('工程格式无效');
  const assets = new Set(p.assets.map((a) => a.id)),
    components = new Set(p.components.map((c) => c.id));
  const ids = new Set<string>();
  for (const s of p.sequences) {
    if (ids.has(s.id)) throw new Error('成片标识重复');
    ids.add(s.id);
    if (
      !Number.isInteger(s.fps) ||
      s.fps < 1 ||
      s.fps > 120 ||
      !Number.isInteger(s.width) ||
      !Number.isInteger(s.height) ||
      s.width < 16 ||
      s.height < 16 ||
      s.width > 7680 ||
      s.height > 7680
    )
      throw new Error('画幅或帧率无效');
    if (
      s.mutedTracks !== undefined &&
      (!Array.isArray(s.mutedTracks) ||
        s.mutedTracks.some((t) => !['visual', 'overlay', 'caption', 'audio'].includes(t)))
    )
      throw new Error('静音轨道配置无效');
    if (s.mutedVideoAudio !== undefined && typeof s.mutedVideoAudio !== 'boolean')
      throw new Error('视频原声静音配置无效');
    if (s.tracks !== undefined) {
      if (!Array.isArray(s.tracks)) throw new Error('多轨轨道配置无效');
      const seenTrackIds = new Set<string>();
      for (const tr of s.tracks) {
        if (
          !tr ||
          typeof tr.id !== 'string' ||
          !tr.id.trim() ||
          seenTrackIds.has(tr.id) ||
          !['visual', 'overlay', 'caption', 'audio'].includes(tr.kind) ||
          typeof tr.name !== 'string' ||
          !tr.name.trim() ||
          !Number.isSafeInteger(tr.layer)
        ) {
          throw new Error('轨道定义无效或标识重复');
        }
        seenTrackIds.add(tr.id);
      }
    }
    for (const c of s.clips) {
      if (ids.has(c.id)) throw new Error('片段标识重复');
      ids.add(c.id);
      if (
        !['video', 'image', 'audio', 'title', 'caption', 'shape', 'code'].includes(c.kind) ||
        !['visual', 'overlay', 'caption', 'audio'].includes(c.track)
      )
        throw new Error('片段类型无效');
      if (c.audioAttachMode !== undefined && !['shot', 'timeline'].includes(c.audioAttachMode))
        throw new Error('音频附着模式无效');
      if (
        !Number.isInteger(c.start) ||
        !Number.isInteger(c.duration) ||
        !Number.isInteger(c.sourceIn) ||
        c.start < 0 ||
        c.duration < 1 ||
        c.sourceIn < 0
      )
        throw new Error('片段时间必须是有效帧数');
      if (c.layer !== undefined && !Number.isSafeInteger(c.layer)) throw new Error('片段图层序号无效');
      if (c.transitionIn) {
        if (!Number.isInteger(c.transitionIn.durationFrames) || c.transitionIn.durationFrames < 1) {
          throw new Error('转场时长必须是正整数帧');
        }
      }
      if (c.assetId && !assets.has(c.assetId)) throw new Error('引用的素材不存在');
      if (['video', 'audio', 'image'].includes(c.kind) && !c.assetId) throw new Error('媒体片段缺少素材');
      if (c.kind === 'code' && (!c.componentId || !components.has(c.componentId)))
        throw new Error('代码组件不存在');
      const a = p.assets.find((a) => a.id === c.assetId);
      if (
        a &&
        (a.kind === 'video' || a.kind === 'audio') &&
        a.duration > 0 &&
        c.sourceIn + c.duration > Math.ceil(a.duration * s.fps) + 1
      )
        throw new Error(`「${c.name}」超出了原素材时长`);
    }
  }
}

/**
 * Copy-on-Write helper: if a component is referenced by clips in other sequences
 * or locked clips in the same sequence, returns a forked component ID + updated operations
 * so editing one sequence's code never silently mutates another sequence.
 */
export function prepareScopedComponentOperations(
  project: Project,
  sequenceId: string,
  component: CodeComponent,
  clipId?: string,
): EditOperation[] {
  const usedElsewhere = project.sequences.some((s) =>
    s.clips.some(
      (c) =>
        c.componentId === component.id &&
        (s.id !== sequenceId || c.locked || (clipId !== undefined && c.id !== clipId)),
    ),
  );
  if (!usedElsewhere) return [{ type: 'putComponent', component }];
  const forked: CodeComponent = { ...clone(component), id: uid('component') };
  const ops: EditOperation[] = [{ type: 'putComponent', component: forked }];
  const seq = project.sequences.find((s) => s.id === sequenceId);
  for (const c of seq?.clips || []) {
    if (c.componentId === component.id && !c.locked && (!clipId || c.id === clipId)) {
      ops.push({ type: 'updateClip', sequenceId, clipId: c.id, changes: { componentId: forked.id } });
    }
  }
  return ops;
}

/**
 * Builds an atomic, undoable, lock-safe deletion batch for a project media Asset.
 * - Refuses if referenced by any locked clip or locked clip take.
 * - Cleans unlocked clips, takes, and vault wrapper references before removing the asset.
 */
export function buildDeleteAssetOperations(project: Project, assetId: string): EditOperation[] {
  const lockedRef = project.sequences.some((s) =>
    s.clips.some(
      (c) =>
        c.locked &&
        (c.assetId === assetId || c.takes?.some((t) => t.assetId === assetId)),
    ),
  );
  if (lockedRef) {
    throw new Error('该素材正被已锁定镜头引用，请先解锁对应镜头后再删除');
  }
  const ops: EditOperation[] = [];
  for (const seq of project.sequences) {
    for (const c of seq.clips) {
      if (c.assetId === assetId) {
        ops.push({ type: 'deleteClip', sequenceId: seq.id, clipId: c.id });
      } else if (c.takes?.some((t) => t.assetId === assetId)) {
        ops.push({
          type: 'updateClip',
          sequenceId: seq.id,
          clipId: c.id,
          changes: { takes: c.takes.filter((t) => t.assetId !== assetId) },
        });
      }
    }
  }
  for (const v of project.vault || []) {
    const usesDirectly = v.assetId === assetId;
    const usesVariant = v.variants?.some((vr) => vr.assetId === assetId);
    const usesCompound = v.compound?.clips.some((c) => c.assetId === assetId);
    const usesPack = v.packItems?.some((pi) => pi.assetId === assetId);
    if (!usesDirectly && !usesVariant && !usesCompound && !usesPack) continue;
    const nextItem = clone(v);
    if (nextItem.assetId === assetId) delete nextItem.assetId;
    if (nextItem.variants) {
      nextItem.variants = nextItem.variants.map((vr) =>
        vr.assetId === assetId ? { ...vr, assetId: undefined } : vr,
      );
    }
    if (nextItem.compound) {
      nextItem.compound = {
        ...nextItem.compound,
        clips: nextItem.compound.clips.filter((c) => c.assetId !== assetId),
      };
    }
    if (nextItem.packItems) {
      nextItem.packItems = nextItem.packItems.filter((pi) => pi.assetId !== assetId);
    }
    const isEmptyWrapper =
      !nextItem.assetId &&
      !nextItem.textContent &&
      !nextItem.rig &&
      !nextItem.recipe &&
      !nextItem.styleTokens &&
      (!nextItem.variants || nextItem.variants.every((vr) => !vr.assetId)) &&
      (!nextItem.compound || nextItem.compound.clips.length === 0) &&
      (!nextItem.packItems || nextItem.packItems.length === 0);
    if (isEmptyWrapper) {
      ops.push({ type: 'removeVaultItem', itemId: v.id });
    } else {
      ops.push({ type: 'putVaultItem', item: nextItem });
    }
  }
  ops.push({ type: 'removeAsset', assetId });
  return ops;
}

/**
 * Builds an atomic, undoable, lock-safe deletion batch for a custom TSX CodeComponent.
 * - Refuses if referenced by any locked clip or locked clip take.
 * - Removes unlocked clips referencing the component before removing the component itself.
 */
export function buildDeleteComponentOperations(project: Project, componentId: string): EditOperation[] {
  const lockedRef = project.sequences.some((s) =>
    s.clips.some(
      (c) =>
        c.locked &&
        (c.componentId === componentId || c.takes?.some((t) => t.componentId === componentId)),
    ),
  );
  if (lockedRef) {
    throw new Error('该组件正被已锁定镜头引用，请先解锁对应镜头后再删除');
  }
  const ops: EditOperation[] = [];
  for (const seq of project.sequences) {
    for (const c of seq.clips) {
      if (c.componentId === componentId) {
        ops.push({ type: 'deleteClip', sequenceId: seq.id, clipId: c.id });
      } else if (c.takes?.some((t) => t.componentId === componentId)) {
        ops.push({
          type: 'updateClip',
          sequenceId: seq.id,
          clipId: c.id,
          changes: { takes: c.takes.filter((t) => t.componentId !== componentId) },
        });
      }
    }
  }
  ops.push({ type: 'removeComponent', componentId });
  return ops;
}

export function applyOperations(
  input: Project,
  operations: EditOperation[],
  author: 'you' | 'agent' = 'you',
  scope?: EditScope,
): Project {
  const p = clone(input);
  const enforceStrict = author === 'agent' && scope?.strict;
  const only = (value: object, keys: string[]) => {
    if (!value || Object.keys(value).some((k) => !keys.includes(k)))
      throw new Error('修改包含不支持的字段，请使用对应的编辑操作');
  };
  for (const op of operations) {
    if (enforceStrict) {
      if (
        scope?.sequenceId &&
        'sequenceId' in op &&
        op.sequenceId &&
        op.sequenceId !== scope.sequenceId
      ) {
        throw new Error('超出当前锁定的成片修改范围，请只修改指定成片');
      }
      if (
        scope?.sequenceId &&
        (op.type === 'addSequence' ||
          op.type === 'forkSequenceBranch' ||
          op.type === 'promoteSequenceBranch' ||
          op.type === 'deleteSequence')
      ) {
        throw new Error('当前已开启范围锁定，不允许新建、切换或删除其他成片分支');
      }
      if (scope?.clipIds?.length) {
        if (
          (op.type === 'updateClip' ||
            op.type === 'deleteClip' ||
            op.type === 'addClipTake' ||
            op.type === 'switchClipTake') &&
          !scope.clipIds.includes(op.clipId)
        ) {
          throw new Error('超出用户指定的片段修改范围（仅改此处模式下只能修改选定片段）');
        }
        if (
          op.type === 'reorderClips' &&
          op.orderedClipIds.some((id) => !scope.clipIds!.includes(id))
        ) {
          throw new Error('超出用户指定的片段修改范围（仅改此处模式下不允许重排其他镜头）');
        }
        if (op.type === 'updateSequence') {
          throw new Error('超出用户指定的片段修改范围（仅改此处模式下不允许修改整条成片设置）');
        }
        if (op.type === 'addClip') {
          const targetSeq = p.sequences.find((sq) => sq.id === op.sequenceId);
          const scopedClips = targetSeq?.clips.filter((cl) => scope.clipIds!.includes(cl.id)) || [];
          if (scopedClips.length > 0) {
            const minS = Math.min(...scopedClips.map((cl) => cl.start));
            const maxE = Math.max(...scopedClips.map((cl) => cl.start + cl.duration));
            const newEnd = op.clip.start + op.clip.duration;
            if (newEnd <= minS || op.clip.start >= maxE) {
              throw new Error('超出用户指定的片段修改范围（仅允许在选定镜头时间区间内叠加内容）');
            }
          }
        }
      }
    }
    if (op.type === 'updateProject') {
      only(op.changes, [
        'name',
        'brief',
        'workflowIntent',
        'activeSkillIds',
        'modelDefaults',
        'canvasLayout',
        'canvasGroups',
        'canvasHiddenNodeIds',
        'canvasGenerators',
        'canvasCollapsedZones',
      ]);
      Object.assign(p, op.changes);
      continue;
    }
    if (op.type === 'addAsset') {
      if (!p.assets.some((a) => a.id === op.asset.id)) p.assets.push(clone(op.asset));
      continue;
    }
    if (op.type === 'updateAssetMeta') {
      const a = p.assets.find((x) => x.id === op.assetId);
      if (!a) throw new Error('资产不存在');
      if (op.changes.name !== undefined && op.changes.name.trim()) a.name = op.changes.name.trim();
      if (op.changes.role === null) delete a.role;
      else if (op.changes.role !== undefined) a.role = op.changes.role;
      if (op.changes.tags !== undefined) a.tags = [...new Set(op.changes.tags.map((t) => t.trim()).filter(Boolean))];
      if (op.changes.collection !== undefined) a.collection = op.changes.collection || undefined;
      if (op.changes.derivedFrom !== undefined) a.derivedFrom = clone(op.changes.derivedFrom);
      if (op.changes.qualityScore === null) delete a.qualityScore;
      else if (op.changes.qualityScore !== undefined) a.qualityScore = clone(op.changes.qualityScore);
      continue;
    }
    if (op.type === 'removeAsset') {
      if (
        p.sequences.some((s) =>
          s.clips.some(
            (c) => c.assetId === op.assetId || c.takes?.some((t) => t.assetId === op.assetId),
          ),
        )
      )
        throw new Error('该资产仍在成片时间线或镜头候选中引用，请先移除相关片段');
      if (
        (p.vault || []).some(
          (v) =>
            v.assetId === op.assetId ||
            v.variants?.some((vr) => vr.assetId === op.assetId) ||
            v.compound?.clips.some((c) => c.assetId === op.assetId) ||
            v.packItems?.some((pi) => pi.assetId === op.assetId),
        )
      )
        throw new Error('该文件被资产实体的状态变体或组合包引用，请先解除关联');
      p.assets = p.assets.filter((a) => a.id !== op.assetId);
      const nodeKey = `asset:${op.assetId}`;
      if (p.canvasLayout?.[nodeKey]) {
        p.canvasLayout = { ...p.canvasLayout };
        delete p.canvasLayout[nodeKey];
      }
      if (p.canvasHiddenNodeIds?.includes(nodeKey)) {
        p.canvasHiddenNodeIds = p.canvasHiddenNodeIds.filter((k) => k !== nodeKey);
      }
      if (p.canvasGroups?.length) {
        p.canvasGroups = p.canvasGroups
          .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((k) => k !== nodeKey) }))
          .filter((g) => g.nodeIds.length > 0);
      }
      if (p.canvasGenerators?.length) {
        p.canvasGenerators = p.canvasGenerators.map((g) => ({
          ...g,
          inputs: g.inputs.filter((inp) => inp.nodeKey !== nodeKey),
          outputAssetIds: (g.outputAssetIds || []).filter((id) => id !== op.assetId),
        }));
      }
      continue;
    }
    if (op.type === 'relinkAsset') {
      const a = p.assets.find((x) => x.id === op.assetId);
      if (!a) throw new Error('待重连的资产不存在');
      const sameContent = Boolean(a.sha256 && op.sha256 && a.sha256 === op.sha256);
      const lockedRefs = p.sequences.flatMap((s) =>
        s.clips.filter(
          (c) =>
            c.locked &&
            (c.assetId === op.assetId || c.takes?.some((t) => t.assetId === op.assetId)),
        ),
      );
      if (!sameContent && lockedRefs.length > 0) {
        const names = lockedRefs
          .map((c) => c.name)
          .slice(0, 3)
          .join('、');
        throw new Error(
          `素材「${a.name}」被已锁定镜头「${names}」引用，禁止替换为不同内容；请找回原文件，或先解锁／仅替换未锁定镜头`,
        );
      }
      a.path = op.path;
      a.offline = false;
      if (op.sha256 !== undefined) a.sha256 = op.sha256;
      if (op.byteSize !== undefined) a.byteSize = op.byteSize;
      if (op.duration !== undefined) a.duration = op.duration;
      if (op.width !== undefined) a.width = op.width;
      if (op.height !== undefined) a.height = op.height;
      if (op.thumbnail !== undefined) a.thumbnail = op.thumbnail;
      if (op.waveform !== undefined) a.waveform = op.waveform;
      if (op.hasAudio !== undefined) a.hasAudio = op.hasAudio;
      if (!sameContent || op.clearTranscript) delete a.transcript;
      continue;
    }
    if (op.type === 'updateAssetTranscript') {
      const a = p.assets.find((x) => x.id === op.assetId);
      if (!a) throw new Error('资产不存在');
      a.transcript = clone(op.transcript);
      continue;
    }
    if (op.type === 'putComponent') {
      if (
        p.sequences.some((s) =>
          s.clips.some(
            (c) =>
              c.locked &&
              (c.componentId === op.component.id ||
                c.takes?.some((t) => t.componentId === op.component.id)),
          ),
        )
      )
        throw new Error('组件被锁定片段或其候选引用，请创建新组件');
      const i = p.components.findIndex((c) => c.id === op.component.id);
      if (i < 0) p.components.push(clone(op.component));
      else p.components[i] = clone(op.component);
      continue;
    }
    if (op.type === 'removeComponent') {
      if (
        p.sequences.some((s) =>
          s.clips.some(
            (c) =>
              c.componentId === op.componentId ||
              c.takes?.some((t) => t.componentId === op.componentId),
          ),
        )
      )
        throw new Error('该组件仍在成片时间线或镜头候选中引用，请先移除相关片段');
      p.components = p.components.filter((c) => c.id !== op.componentId);
      const nodeKey = `comp:${op.componentId}`;
      if (p.canvasLayout?.[nodeKey]) {
        p.canvasLayout = { ...p.canvasLayout };
        delete p.canvasLayout[nodeKey];
      }
      if (p.canvasHiddenNodeIds?.includes(nodeKey)) {
        p.canvasHiddenNodeIds = p.canvasHiddenNodeIds.filter((k) => k !== nodeKey);
      }
      if (p.canvasGroups?.length) {
        p.canvasGroups = p.canvasGroups
          .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((k) => k !== nodeKey) }))
          .filter((g) => g.nodeIds.length > 0);
      }
      if (p.canvasGenerators?.length) {
        p.canvasGenerators = p.canvasGenerators.map((g) => ({
          ...g,
          inputs: g.inputs.filter((inp) => inp.nodeKey !== nodeKey),
        }));
      }
      continue;
    }
    if (op.type === 'putVaultItem') {
      p.vault = p.vault ? [...p.vault] : [];
      const idx = p.vault.findIndex((v) => v.id === op.item.id);
      if (idx < 0) p.vault.push(clone(op.item));
      else p.vault[idx] = clone(op.item);
      continue;
    }
    if (op.type === 'removeVaultItem') {
      const boundInLockedShot = p.sequences.some((s) =>
        s.clips.some(
          (c) =>
            c.locked &&
            (c.subjectIds?.includes(op.itemId) ||
              c.subjectBindings?.some((b) => b.entityId === op.itemId)),
        ),
      );
      if (boundInLockedShot) throw new Error('该资产被已锁定的分镜绑定引用，请先解锁对应镜头');
      p.vault = (p.vault || []).filter((v) => v.id !== op.itemId);
      if (p.activeBrandId === op.itemId) p.activeBrandId = undefined;
      const nodeKey = `ent:${op.itemId}`;
      if (p.canvasLayout?.[nodeKey]) {
        p.canvasLayout = { ...p.canvasLayout };
        delete p.canvasLayout[nodeKey];
      }
      if (p.canvasHiddenNodeIds?.includes(nodeKey)) {
        p.canvasHiddenNodeIds = p.canvasHiddenNodeIds.filter((k) => k !== nodeKey);
      }
      if (p.canvasGroups?.length) {
        p.canvasGroups = p.canvasGroups
          .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((k) => k !== nodeKey) }))
          .filter((g) => g.nodeIds.length > 0);
      }
      if (p.canvasGenerators?.length) {
        p.canvasGenerators = p.canvasGenerators.map((g) => ({
          ...g,
          inputs: g.inputs.filter((inp) => inp.nodeKey !== nodeKey),
        }));
      }
      continue;
    }
    if (op.type === 'setActiveBrand') {
      p.activeBrandId = op.itemId;
      if (op.itemId) {
        const styleTokens = resolveProjectStyle(p);
        if (styleTokens) {
          for (const seq of p.sequences) {
            if (!seq.clips.some((c) => c.locked)) {
              seq.background = styleTokens.backgroundColor;
            }
            for (const c of seq.clips) {
              if (!c.locked) {
                applyStyleTokensToClip(c, styleTokens);
              }
            }
          }
        }
      } else {
        for (const seq of p.sequences) {
          if (!seq.clips.some((c) => c.locked)) {
            seq.background = '#10161c';
          }
        }
      }
      continue;
    }
    if (op.type === 'upsertCustomTag') {
      const cleanName = op.tag.name.trim();
      if (!cleanName) continue;
      p.customTags = p.customTags ? [...p.customTags] : [];
      const idx = p.customTags.findIndex((t) => t.name === cleanName);
      if (idx < 0) p.customTags.push({ name: cleanName, color: op.tag.color || '#3b82f6' });
      else p.customTags[idx] = { name: cleanName, color: op.tag.color || p.customTags[idx].color };
      continue;
    }
    if (op.type === 'removeCustomTag') {
      p.customTags = (p.customTags || []).filter((t) => t.name !== op.tagName);
      for (const a of p.assets) {
        if (a.tags?.length) a.tags = a.tags.filter((t) => t !== op.tagName);
      }
      for (const v of p.vault || []) {
        if (v.tags?.length) v.tags = v.tags.filter((t) => t !== op.tagName);
        for (const vr of v.variants || []) {
          if (vr.tags?.length) vr.tags = vr.tags.filter((t) => t !== op.tagName);
        }
      }
      continue;
    }
    if (op.type === 'forkSequenceBranch') {
      const src = p.sequences.find((s) => s.id === op.sourceSequenceId) || p.sequences[0];
      if (!src) throw new Error('源成片分支不存在');
      const cleanBranch = op.branchName.trim() || `branch-${p.sequences.length}`;
      const dstW = op.width || src.width;
      const dstH = op.height || src.height;
      const aspectChanged = Math.abs(dstW / dstH - src.width / src.height) > 0.08;
      const shouldReframe = Boolean(op.autoReframe || aspectChanged);
      const forked: Sequence = {
        ...clone(src),
        id: op.newSequenceId || uid('seq'),
        name: cleanBranch,
        branchName: cleanBranch,
        parentSequenceId: src.id,
        forkedAtRevision: p.revision,
        isMainBranch: false,
        width: dstW,
        height: dstH,
        clips: src.clips.map((c) => {
          const nextClip: Clip = { ...clone(c), id: uid('clip'), locked: false };
          if (!shouldReframe) return nextClip;
          const override = op.focalOverrides?.[c.id] || (c.assetId ? op.focalOverrides?.[c.assetId] : undefined);
          return reframeClipForTargetAspect(nextClip, src.width, src.height, dstW, dstH, override);
        }),
      };
      p.sequences.push(forked);
      continue;
    }
    if (op.type === 'promoteSequenceBranch') {
      const targetSeq = p.sequences.find((s) => s.id === op.sequenceId);
      if (!targetSeq) throw new Error('目标分支不存在');
      for (const seq of p.sequences) {
        seq.isMainBranch = seq.id === targetSeq.id;
      }
      continue;
    }
    if (op.type === 'addSequence') {
      p.sequences.push(clone(op.sequence));
      continue;
    }
    if (op.type === 'deleteSequence') {
      if (p.sequences.length <= 1) throw new Error('至少需要保留一份成片');
      const target = p.sequences.find((s) => s.id === op.sequenceId);
      if (!target) throw new Error('成片不存在');
      if (author === 'agent' && target.clips.some((c) => c.locked))
        throw new Error('成片包含锁定片段，不能删除');
      p.sequences = p.sequences.filter((s) => s.id !== op.sequenceId);
      continue;
    }
    const s = p.sequences.find((s) => s.id === op.sequenceId);
    if (!s) throw new Error('成片不存在');
    if (op.type === 'updateSequence') {
      only(op.changes, [
        'name',
        'width',
        'height',
        'fps',
        'background',
        'tracks',
        'mutedTracks',
        'soloTracks',
        'mutedVideoAudio',
        'branchName',
        'workflowIntent',
      ]);
      if (
        author === 'agent' &&
        s.clips.some((c) => c.locked) &&
        Object.keys(op.changes).some((k) => ['width', 'height', 'fps'].includes(k))
      )
        throw new Error('成片包含锁定片段，不能修改画幅与帧率');
      Object.assign(s, op.changes);
      continue;
    }
    if (op.type === 'addClip') {
      const added = clone(op.clip);
      if (!added.id || typeof added.id !== 'string' || !added.id.trim() || s.clips.some((x) => x.id === added.id)) {
        added.id = uid('clip');
      }
      if (!added.props || typeof added.props !== 'object') {
        added.props = {};
      }
      if (added.layer === undefined)
        added.layer =
          s.clips.reduce(
            (top, other) => (other.track === added.track ? Math.max(top, other.layer ?? 0) : top),
            0,
          ) + 1;
      s.clips.push(added);
      continue;
    }
    if (op.type === 'reorderClips') {
      const targetSet = new Set(op.orderedClipIds);
      const targets = op.orderedClipIds
        .map((id) => s.clips.find((x) => x.id === id))
        .filter((x): x is Clip => Boolean(x));
      if (targets.length >= 2) {
        if (targets.some((x) => x.locked)) throw new Error('包含已锁定镜头，不能重排顺序');
        // Snapshot each target's original span and co-moving overlays/captions so subtitles NEVER desync!
        const claimedCompanionIds = new Set<string>();
        const slices = targets.map((item) => {
          const oldStart = item.start;
          const oldEnd = item.start + item.duration;
          const companions = s.clips.filter((cand) => {
            if (targetSet.has(cand.id) || claimedCompanionIds.has(cand.id)) return false;
            const isShotAudio = cand.track === 'audio' && cand.audioAttachMode === 'shot';
            if (cand.track !== 'caption' && cand.kind !== 'caption' && cand.track !== 'overlay' && !isShotAudio)
              return false;
            if (cand.duration > item.duration + 4) return false;
            const mid = cand.start + cand.duration / 2;
            return mid >= oldStart && mid < oldEnd;
          });
          for (const comp of companions) claimedCompanionIds.add(comp.id);
          return {
            item,
            oldStart,
            companions: companions.map((comp) => ({ comp, relOffset: comp.start - oldStart })),
          };
        });
        if (slices.some((sl) => sl.companions.some((c) => c.comp.locked))) {
          throw new Error('包含已锁定的同步字幕、叠加层或随镜声音，不能重排顺序');
        }
        let cursor = Math.min(...slices.map((sl) => sl.oldStart));
        for (const sl of slices) {
          sl.item.start = cursor;
          for (const { comp, relOffset } of sl.companions) {
            comp.start = Math.max(0, cursor + relOffset);
          }
          cursor += sl.item.duration;
        }
      }
      continue;
    }
    const c = s.clips.find((c) => c.id === op.clipId);
    if (!c) throw new Error('片段不存在');
    if (
      c.locked &&
      (author === 'agent' ||
        op.type === 'deleteClip' ||
        op.type === 'addClipTake' ||
        op.type === 'switchClipTake' ||
        (op.type === 'updateClip' && Object.keys(op.changes).some((k) => k !== 'locked')))
    )
      throw new Error(`「${c.name}」已锁定，请先解锁`);
    if (op.type === 'addClipTake') {
      if (!c.takes || c.takes.length === 0) {
        const initialTake: ClipTake = {
          id: c.activeTakeId || uid('take'),
          label: '候选 1 · 初始镜头',
          kind: c.kind,
          sourceIn: c.sourceIn,
          assetId: c.assetId,
          componentId: c.componentId,
          props: clone(c.props),
          createdAt: new Date().toISOString(),
        };
        c.takes = [initialTake];
        c.activeTakeId = initialTake.id;
      } else if (c.activeTakeId) {
        const cur = c.takes.find((t) => t.id === c.activeTakeId);
        if (cur) {
          cur.kind = c.kind;
          cur.sourceIn = c.sourceIn;
          cur.assetId = c.assetId;
          cur.componentId = c.componentId;
          cur.props = clone(c.props);
        }
      }
      const nextTake = clone(op.take);
      c.takes.push(nextTake);
      if (op.activate !== false) {
        c.activeTakeId = nextTake.id;
        c.kind = nextTake.kind;
        c.sourceIn = nextTake.sourceIn;
        c.assetId = nextTake.assetId;
        c.componentId = nextTake.componentId;
        c.props = clone(nextTake.props);
      }
    } else if (op.type === 'switchClipTake') {
      const targetTake = c.takes?.find((t) => t.id === op.takeId);
      if (!targetTake) throw new Error('目标镜头候选不存在');
      if (c.activeTakeId && c.takes) {
        const cur = c.takes.find((t) => t.id === c.activeTakeId);
        if (cur) {
          cur.kind = c.kind;
          cur.sourceIn = c.sourceIn;
          cur.assetId = c.assetId;
          cur.componentId = c.componentId;
          cur.props = clone(c.props);
        }
      }
      c.activeTakeId = targetTake.id;
      c.kind = targetTake.kind;
      c.sourceIn = targetTake.sourceIn;
      c.assetId = targetTake.assetId;
      c.componentId = targetTake.componentId;
      c.props = clone(targetTake.props);
    } else if (op.type === 'updateClip') {
      only(op.changes, [
        'name',
        'kind',
        'track',
        'trackId',
        'layer',
        'start',
        'duration',
        'sourceIn',
        'assetId',
        'componentId',
        'locked',
        'audioAttachMode',
        'muted',
        'transitionIn',
        'keyframes',
        'takes',
        'activeTakeId',
        'subjectIds',
        'subjectBindings',
        'shotNotes',
        'props',
      ]);
      const { id, ...changes } = op.changes;
      Object.assign(c, changes, changes.props ? { props: { ...c.props, ...changes.props } } : {});
      if (changes.transitionIn === null) delete c.transitionIn;
      if ('keyframes' in changes && (!changes.keyframes || Object.keys(changes.keyframes).length === 0)) {
        delete c.keyframes;
      }
    } else if (op.type === 'deleteClip') {
      const cutEnd = c.start + c.duration;
      s.clips = s.clips.filter((x) => x.id !== c.id);
      if (op.ripple) {
        for (const next of s.clips) {
          // Track-aware ripple: deleting a non-primary clip (e.g. caption/overlay/sfx) only ripples its own track;
          // deleting a primary visual clip ripples synced downstream clips without shifting bed tracks spanning across c.start.
          const shouldShift =
            c.track === 'visual' ? next.start >= cutEnd : next.track === c.track && next.start >= cutEnd;
          if (shouldShift) {
            if (next.locked) throw new Error('波纹删除会移动锁定片段');
            next.start -= c.duration;
          }
        }
      }
    }
  }
  validateProject(p);
  return p;
}

export function splitOperations(sequence: Sequence, clip: Clip, at: number): EditOperation[] {
  const offset = at - clip.start;
  if (offset <= 0 || offset >= clip.duration) throw new Error('将播放头移到片段内部再分割');
  const splitKf = splitKeyframesForSplit(clip.keyframes, offset);
  const secondHalf: Clip = {
    ...clone(clip),
    layer: clip.layer ?? 0,
    id: uid('clip'),
    name: clip.name + ' · 2',
    start: at,
    duration: clip.duration - offset,
    sourceIn: clip.kind === 'image' ? 0 : clip.sourceIn + offset,
  };
  delete secondHalf.transitionIn;
  if (splitKf.right) secondHalf.keyframes = splitKf.right;
  else delete secondHalf.keyframes;
  const firstChanges: Partial<Clip> = { duration: offset };
  if (clip.keyframes) firstChanges.keyframes = splitKf.left;
  return [
    { type: 'updateClip', sequenceId: sequence.id, clipId: clip.id, changes: firstChanges },
    {
      type: 'addClip',
      sequenceId: sequence.id,
      clip: secondHalf,
    },
  ];
}

/**
 * Pro NLE Audio/Video Detach (J/L Cut):
 * Mutes the video clip's embedded audio and spawns a frame-aligned, source-synced
 * independent audio clip on A1 (`audioAttachMode: 'timeline'`) that can be trimmed
 * independently for J-Cuts (audio leads video) or L-Cuts (audio trails video).
 */
export function detachAudioFromClipOperations(
  sequence: Sequence,
  clip: Clip,
): { operations: EditOperation[]; audioClipId: string } {
  if (clip.locked) throw new Error('片段已锁定，请先解锁再分离音画');
  if (clip.kind !== 'video' || !clip.assetId) throw new Error('仅支持对包含素材的视频片段执行音画分离');
  const audioClipId = uid('clip');
  const detached: Clip = {
    ...newClip('audio', clip.start, clip.assetId),
    id: audioClipId,
    name: `${clip.name} · 分离音轨`,
    duration: clip.duration,
    sourceIn: clip.sourceIn,
    audioAttachMode: 'timeline',
    props: {
      volume: clip.props.volume !== undefined ? Number(clip.props.volume) : 1,
      ...(clip.props.fadeIn !== undefined ? { fadeIn: Number(clip.props.fadeIn) } : {}),
      ...(clip.props.fadeOut !== undefined ? { fadeOut: Number(clip.props.fadeOut) } : {}),
    },
    ...(clip.keyframes?.volume?.length ? { keyframes: { volume: clone(clip.keyframes.volume) } } : {}),
  };
  const videoChanges: Partial<Clip> = { muted: true };
  if (clip.keyframes?.volume) {
    const restKf = clone(clip.keyframes);
    delete restKf.volume;
    videoChanges.keyframes = Object.keys(restKf).length ? restKf : undefined;
  }
  return {
    audioClipId,
    operations: [
      { type: 'updateClip', sequenceId: sequence.id, clipId: clip.id, changes: videoChanges },
      { type: 'addClip', sequenceId: sequence.id, clip: detached },
    ],
  };
}

export function parseSRTText(text: string, fps: number): Clip[] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  if (!clean) return [];
  const toFrames = (s: string) => {
    const parts = s.replace(',', '.').split(':');
    if (parts.length !== 3) return NaN;
    return Math.round((Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])) * fps);
  };
  const stripMarkup = (s: string) =>
    s
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      .trim();

  const rows = clean.split(/\n\s*\n/);
  const result: Clip[] = [];
  let prevEnd = 0;
  for (const row of rows) {
    const lines = row.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [from, to] = lines[ti].split('-->').map((s) => s.trim().split(/\s+/)[0]);
    let start = toFrames(from);
    const end = toFrames(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    // Prevent 1-frame rounding overlaps between back-to-back subtitles.
    if (start < prevEnd && prevEnd - start <= 1 && end > prevEnd) start = prevEnd;
    const body = stripMarkup(lines.slice(ti + 1).join('\n'));
    if (!body) continue;
    prevEnd = Math.max(prevEnd, end);
    result.push({
      ...newClip('caption', start),
      duration: end - start,
      name: body.replace(/\s+/g, ' ').slice(0, 24) || '字幕',
      props: {
        text: body,
        fontSize: 46,
        color: '#ffffff',
        position: 'bottom' as const,
        background: '#00000080',
        animation: 'none' as const,
      },
    });
  }
  return result;
}

export function preflightSequence(
  project: Project,
  sequenceId: string,
  missingAssetIds: string[] = [],
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const seq = project.sequences.find((s) => s.id === sequenceId);
  if (!seq) {
    issues.push({ id: 'no-seq', severity: 'blocker', title: '成片不存在', detail: '未找到要导出的目标成片。' });
    return issues;
  }
  if (!seq.clips.length) {
    issues.push({
      id: 'empty',
      severity: 'blocker',
      title: '时间线为空',
      detail: '请先添加视频、图片或动态画面后再导出。',
    });
    return issues;
  }

  const missingSet = new Set(missingAssetIds);
  const componentSet = new Set(project.components.map((c) => c.id));
  const muted = new Set(seq.mutedTracks || []);

  // 1. Offline / Missing assets & missing code components check (Blocker per PRD R06/R26)
  for (const c of seq.clips) {
    if (muted.has(c.track)) continue;
    if (c.assetId && missingSet.has(c.assetId)) {
      const asset = project.assets.find((a) => a.id === c.assetId);
      issues.push({
        id: `offline-${c.id}`,
        severity: 'blocker',
        title: `素材离线：${asset?.name || c.name}`,
        detail: `片段「${c.name}」（${timecode(c.start, seq.fps)}）引用的原始文件已移动或缺失，请先在左侧资产面板重新定位文件。`,
        frame: c.start,
        clipId: c.id,
        assetId: c.assetId,
      });
    }
    if (c.kind === 'code' && (!c.componentId || !componentSet.has(c.componentId))) {
      issues.push({
        id: `missing-comp-${c.id}`,
        severity: 'blocker',
        title: `代码组件缺失：${c.name}`,
        detail: `片段「${c.name}」（${timecode(c.start, seq.fps)}）引用的代码组件不存在，无法正常渲染。`,
        frame: c.start,
        clipId: c.id,
      });
    }
  }

  // 2. Complete visual coverage check: empty visual, leading gap, middle gaps, AND trailing gap (Warning)
  const soloSet = new Set(seq.soloTracks || []);
  const trackActive = (track: Track) => !muted.has(track) && (soloSet.size === 0 || soloSet.has(track));
  if (soloSet.size > 0) {
    const trackNames: Record<Track, string> = { visual: 'V1 画面', overlay: 'V2+ 叠加', caption: 'T1 字幕', audio: 'A1 声音' };
    issues.push({
      id: 'solo-tracks-active',
      severity: 'warning',
      title: '当前开启了轨道独奏（Solo）',
      detail: `仅 ${[...soloSet].map((t) => trackNames[t]).join('、')} 会参与导出，其余轨道将被跳过。如非刻意测试单轨，建议先取消独奏。`,
      frame: 0,
    });
  }
  const total = durationOf(seq);
  const gapThreshold = Math.max(1, Math.round(seq.fps * 0.5));
  const visibleClips = seq.clips
    .filter((c) => (c.track === 'visual' || c.track === 'overlay') && trackActive(c.track) && c.kind !== 'audio')
    .sort((a, b) => a.start - b.start);

  if (visibleClips.length === 0) {
    issues.push({
      id: 'gap-all-empty',
      severity: 'warning',
      title: '全片没有可见画面',
      detail: `当前成片总长 ${(total / seq.fps).toFixed(1)}s，但视觉轨与叠加轨均为空或已隐藏，导出画面将只有背景色。`,
      frame: 0,
    });
  } else {
    let coveredUntil = 0;
    for (const c of visibleClips) {
      if (c.start > coveredUntil && c.start - coveredUntil >= gapThreshold) {
        const isHead = coveredUntil === 0;
        issues.push({
          id: `${isHead ? 'gap-head' : 'gap'}-${coveredUntil}`,
          severity: 'warning',
          title: isHead ? '片头存在无画面区间' : '时间线存在无画面区间',
          detail: `${timecode(coveredUntil, seq.fps)} — ${timecode(c.start, seq.fps)} 没有任何视觉或包装片段覆盖，将呈现纯背景色。`,
          frame: coveredUntil,
        });
      }
      coveredUntil = Math.max(coveredUntil, c.start + c.duration);
    }
    if (total > coveredUntil && total - coveredUntil >= gapThreshold) {
      issues.push({
        id: `gap-tail-${coveredUntil}`,
        severity: 'warning',
        title: '片尾存在无画面留白',
        detail: `${timecode(coveredUntil, seq.fps)} — ${timecode(total, seq.fps)}（约 ${((total - coveredUntil) / seq.fps).toFixed(1)}s）没有任何视觉或包装片段覆盖，将呈现纯背景色（通常由更长的声音或字幕轨拉长所致）。`,
        frame: coveredUntil,
      });
    }
  }

  // 2b. Muted audio track / embedded video audio notice (Warning)
  const hasVideoWithAudio = seq.clips.some(
    (c) =>
      c.kind === 'video' &&
      !muted.has(c.track) &&
      !c.muted &&
      project.assets.find((a) => a.id === c.assetId)?.hasAudio,
  );
  const hasAudioClips = seq.clips.some((c) => c.track === 'audio' && !c.muted);
  if (seq.mutedVideoAudio && hasVideoWithAudio && (muted.has('audio') || !hasAudioClips)) {
    issues.push({
      id: 'muted-all-audio',
      severity: 'warning',
      title: '当前视频原声与声音轨均已静音',
      detail: '导出成片将没有任何声音。如需保留同期声，请在时间线 V1 轨道恢复视频原声。',
      frame: 0,
    });
  } else if (seq.mutedVideoAudio && hasVideoWithAudio) {
    issues.push({
      id: 'muted-video-audio',
      severity: 'warning',
      title: '视频原声（V1）已静音',
      detail: '时间线已关闭视频内嵌同期声，导出成片将仅保留 A1 独立声音轨。',
      frame: 0,
    });
  }

  // 3. Caption overflow check (Warning)
  for (const c of seq.clips) {
    if (c.kind !== 'caption' || muted.has('caption')) continue;
    const text = String(c.props.text || '');
    const longestLine = Math.max(0, ...text.split('\n').map((l) => l.length));
    const maxRecommended = seq.width < seq.height ? 18 : 34;
    if (longestLine > maxRecommended) {
      issues.push({
        id: `overflow-${c.id}`,
        severity: 'warning',
        title: `字幕单行过长：${c.name}`,
        detail: `${timecode(c.start, seq.fps)} 处单行达 ${longestLine} 字，建议断行或精简以免超出画幅安全区。`,
        frame: c.start,
        clipId: c.id,
      });
    }
  }

  // 4. Audio peak / clipping risk check (Warning)
  for (const c of seq.clips) {
    if ((c.kind !== 'audio' && c.kind !== 'video') || muted.has(c.track)) continue;
    const vol = Number(c.props.volume ?? 1);
    if (vol > 1.5) {
      issues.push({
        id: `loud-${c.id}`,
        severity: 'warning',
        title: `音量增益偏高：${c.name}`,
        detail: `当前音量设为 ${Math.round(vol * 100)}%，导出时可能产生削波爆音。`,
        frame: c.start,
        clipId: c.id,
      });
    }
  }

  return issues;
}

export function diffSummary(a: Project, b: Project): string[] {
  const result: string[] = [];
  if (a.name !== b.name) result.push(`项目更名为 ${b.name}`);
  if (a.brief !== b.brief) result.push('更新创作约定');
  for (const s of b.sequences) {
    const old = a.sequences.find((x) => x.id === s.id);
    if (!old) {
      result.push(`新建成片「${s.name}」`);
      continue;
    }
    for (const c of s.clips) {
      const before = old.clips.find((x) => x.id === c.id);
      if (!before) result.push(`添加「${c.name}」`);
      else if (JSON.stringify(before) !== JSON.stringify(c))
        result.push(`${before.locked !== c.locked ? (c.locked ? '锁定' : '解锁') : '调整'}「${c.name}」`);
    }
    for (const c of old.clips) if (!s.clips.some((x) => x.id === c.id)) result.push(`移除「${c.name}」`);
    if (s.width !== old.width || s.height !== old.height) result.push(`调整「${s.name}」画幅`);
    if (JSON.stringify(s.mutedTracks || []) !== JSON.stringify(old.mutedTracks || []))
      result.push(`更新「${s.name}」轨道静音`);
    if (Boolean(s.mutedVideoAudio) !== Boolean(old.mutedVideoAudio))
      result.push(`${s.mutedVideoAudio ? '静音' : '恢复'}「${s.name}」视频原声`);
  }
  for (const old of a.sequences) {
    if (!b.sequences.some((s) => s.id === old.id)) result.push(`删除成片「${old.name}」`);
  }
  if (b.assets.length > a.assets.length) result.push(`导入 ${b.assets.length - a.assets.length} 个资产`);
  if (b.assets.length < a.assets.length) result.push(`移除 ${a.assets.length - b.assets.length} 个资产`);
  if (a.activeBrandId !== b.activeBrandId) result.push(b.activeBrandId ? '切换视觉风格' : '恢复默认视觉风格');
  if (JSON.stringify(a.canvasLayout || {}) !== JSON.stringify(b.canvasLayout || {})) result.push('更新画布节点布局');
  if (JSON.stringify(a.canvasGroups || []) !== JSON.stringify(b.canvasGroups || [])) result.push('更新画布分组');
  if (JSON.stringify(a.canvasHiddenNodeIds || []) !== JSON.stringify(b.canvasHiddenNodeIds || []))
    result.push('更新画布可见资产');
  if (JSON.stringify(a.canvasGenerators || []) !== JSON.stringify(b.canvasGenerators || []))
    result.push('更新画布生成节点');
  if (JSON.stringify(a.canvasCollapsedZones || []) !== JSON.stringify(b.canvasCollapsedZones || []))
    result.push('切换画布分区折叠');
  if (JSON.stringify(a.components) !== JSON.stringify(b.components)) result.push('更新代码组件');
  if (JSON.stringify(a.vault || []) !== JSON.stringify(b.vault || [])) result.push('更新项目资产库');
  return result.length ? result : ['更新工程'];
}

export function transcriptToCaptionClips(sequence: Sequence, asset: Asset): Clip[] {
  const segs = asset.transcript?.segments || [];
  if (!segs.length) return [];
  const placements = sequence.clips
    .filter((c) => c.assetId === asset.id && (c.kind === 'video' || c.kind === 'audio'))
    .sort((a, b) => a.start - b.start);
  const fps = sequence.fps;
  const out: Clip[] = [];
  if (placements.length === 0) {
    for (const seg of segs) {
      const start = Math.max(0, Math.round(seg.start * fps));
      const end = Math.max(start + 1, Math.round(seg.end * fps));
      if (!seg.text.trim()) continue;
      out.push({
        ...newClip('caption', start),
        duration: end - start,
        name: seg.text.trim().slice(0, 22) || '字幕',
        props: {
          text: seg.text.trim(),
          fontSize: 44,
          color: '#ffffff',
          position: 'bottom',
          background: '#00000085',
          animation: 'none',
        },
      });
    }
    return out;
  }
  for (const pl of placements) {
    const srcStartSec = pl.sourceIn / fps;
    const srcEndSec = (pl.sourceIn + pl.duration) / fps;
    for (const seg of segs) {
      const ovStart = Math.max(srcStartSec, seg.start);
      const ovEnd = Math.min(srcEndSec, seg.end);
      if (ovEnd - ovStart < 0.08 || !seg.text.trim()) continue;
      const timelineStart = pl.start + Math.round((ovStart - srcStartSec) * fps);
      const timelineEnd = Math.max(timelineStart + 1, pl.start + Math.round((ovEnd - srcStartSec) * fps));
      out.push({
        ...newClip('caption', timelineStart),
        duration: timelineEnd - timelineStart,
        name: seg.text.trim().slice(0, 22) || '字幕',
        props: {
          text: seg.text.trim(),
          fontSize: 44,
          color: '#ffffff',
          position: 'bottom',
          background: '#00000085',
          animation: 'none',
        },
      });
    }
  }
  return out;
}

/**
 * Infer default NLE audio attachment mode for a newly placed audio clip:
 * - Short SFX / voiceover / cue clips default to 'shot' (move with owning shot on reorder).
 * - Long BGM / music beds (>10s or tagged/named bgm/music) default to 'timeline' (stay pinned).
 */
export function inferDefaultAudioAttachMode(
  asset?: Pick<Asset, 'name' | 'role' | 'duration'>,
  durationFrames?: number,
  fps = 30,
): 'shot' | 'timeline' {
  if (asset?.role === 'bgm') return 'timeline';
  if (asset?.role === 'sfx' || asset?.role === 'voiceover') return 'shot';
  const name = asset?.name || '';
  if (/\b(bgm|music|bed|ambience)\b|背景音|底乐|配乐/i.test(name)) return 'timeline';
  const sec = durationFrames !== undefined ? durationFrames / Math.max(1, fps) : asset?.duration || 0;
  return sec > 10 ? 'timeline' : 'shot';
}

/**
 * Snapshot one or more edited timeline clips (including trimmed sourceIn, duration,
 * color adjustments, transitions, styling, overlays, captions & shot-attached audio)
 * as a reusable Compound Asset.
 */
export function createCompoundVaultItemFromClips(
  project: Project,
  sequence: Sequence,
  clips: Clip[],
  customName?: string,
  clipWindow?: { start: number; duration: number },
): VaultItem {
  if (!clips.length) throw new Error('请选择至少一个片段以保存为资产');
  const sorted = [...clips].sort((a, b) => a.start - b.start || (a.layer ?? 0) - (b.layer ?? 0));
  const minStart = clipWindow ? clipWindow.start : Math.min(...sorted.map((c) => c.start));
  const maxEnd = clipWindow
    ? clipWindow.start + clipWindow.duration
    : Math.max(...sorted.map((c) => c.start + c.duration));
  const normalized: Clip[] = [];
  for (const c of sorted) {
    const cEnd = c.start + c.duration;
    const clampedStart = Math.max(minStart, c.start);
    const clampedEnd = Math.min(maxEnd, cEnd);
    const clampedDuration = clampedEnd - clampedStart;
    if (clampedDuration < 1) continue;
    const trimDelta = clampedStart - c.start;
    const cloned = clone(c);
    normalized.push({
      ...cloned,
      start: Math.max(0, clampedStart - minStart),
      duration: clampedDuration,
      sourceIn: cloned.kind === 'image' ? 0 : Math.max(0, cloned.sourceIn + trimDelta),
      locked: false,
    });
  }
  if (!normalized.length) throw new Error('选定区间内没有可沉淀的片段');
  const visualLead =
    normalized.find((c) => c.track === 'visual' && (c.kind === 'video' || c.kind === 'image') && c.assetId) ||
    normalized.find((c) => (c.kind === 'video' || c.kind === 'image') && c.assetId) ||
    normalized.find((c) => Boolean(c.assetId)) ||
    normalized[0];
  const linkedAsset = visualLead?.assetId ? project.assets.find((a) => a.id === visualLead.assetId) : undefined;
  const derivedFrom: AssetLineageRef[] = Array.from(
    new Set(normalized.map((c) => c.assetId).filter((id): id is string => Boolean(id))),
  ).map((assetId) => ({
    assetId,
    via: 'compound-save' as const,
    note: `沉淀自「${sequence.name}」精剪片段`,
  }));
  const componentSources: Record<
    string,
    { name: string; source: string; props: Record<string, string | number | boolean> }
  > = {};
  for (const c of normalized) {
    if (c.componentId) {
      const comp = project.components.find((x) => x.id === c.componentId);
      if (comp) {
        componentSources[comp.id] = { name: comp.name, source: comp.source, props: clone(comp.props) };
      }
    }
  }
  const primaryTitle = visualLead?.name || '精剪片段';
  const durationFrames = Math.max(1, maxEnd - minStart);
  const label =
    customName?.trim() ||
    (normalized.length > 1
      ? `${primaryTitle} 等${normalized.length}层组合`
      : `${primaryTitle} · ${(durationFrames / sequence.fps).toFixed(1)}s`);
  const inferredRole =
    linkedAsset?.role ||
    (visualLead?.kind === 'audio'
      ? visualLead.audioAttachMode === 'shot'
        ? 'sfx'
        : 'bgm'
      : visualLead?.kind === 'video' || visualLead?.kind === 'image'
        ? 'footage'
        : visualLead?.kind === 'title'
          ? 'title-chapter'
          : 'footage');
  return {
    id: uid('pvault'),
    name: label,
    entityKind: 'compound',
    role: inferredRole,
    tags: ['精剪资产', `${normalized.length}层`],
    category: linkedAsset?.kind === 'model-3d' ? 'rig' : 'media',
    subkind: 'compound-clip',
    description: `包含 ${normalized.length} 个片段（${(durationFrames / sequence.fps).toFixed(1)}s），完整保留裁切入出点、转场、字幕与调色样式。`,
    assetId: linkedAsset?.id,
    assetKind: linkedAsset?.kind,
    derivedFrom,
    compound: {
      clips: normalized,
      durationFrames,
      fps: sequence.fps,
      width: sequence.width,
      height: sequence.height,
      ...(Object.keys(componentSources).length > 0 ? { componentSources } : {}),
    },
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Instantiate a saved Compound Asset onto a target sequence at `atFrame`,
 * preserving relative offsets, sourceIn trims (scaled across FPS), transitions, and styling.
 */
export function instantiateCompoundVaultItemOperations(
  sequenceId: string,
  item: VaultItem,
  atFrame: number,
  targetFps: number,
): { operations: EditOperation[]; primaryClipId?: string } {
  const bundle = item.compound;
  if (!bundle?.clips.length) return { operations: [] };
  const ratio = bundle.fps > 0 && targetFps !== bundle.fps ? targetFps / bundle.fps : 1;
  const operations: EditOperation[] = [];
  let primaryClipId: string | undefined;
  for (const orig of bundle.clips) {
    const newId = uid('clip');
    const c: Clip = {
      ...clone(orig),
      id: newId,
      start: Math.max(0, Math.round(atFrame + orig.start * ratio)),
      duration: Math.max(1, Math.round(orig.duration * ratio)),
      sourceIn: orig.kind === 'image' ? 0 : Math.max(0, Math.round((orig.sourceIn || 0) * ratio)),
      ...(orig.transitionIn
        ? {
            transitionIn: {
              ...orig.transitionIn,
              durationFrames: Math.max(1, Math.round(orig.transitionIn.durationFrames * ratio)),
            },
          }
        : {}),
      ...(orig.keyframes ? { keyframes: scaleKeyframesForFps(orig.keyframes, ratio) } : {}),
      locked: false,
    };
    if (!primaryClipId || c.track === 'visual') primaryClipId = newId;
    operations.push({ type: 'addClip', sequenceId, clip: c });
  }
  return { operations, primaryClipId };
}
