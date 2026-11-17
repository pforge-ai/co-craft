import type { Project, Sequence, Clip, EditOperation } from './types';
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
      { id: uid('seq'), name: '主片', width: 1920, height: 1080, fps: 30, clips: [], background: '#10161c' },
    ],
  };
}
export const newClip = (kind: Clip['kind'], start = 0, assetId?: string): Clip => ({
  id: uid('clip'),
  name:
    kind === 'title' ? '新的标题' : kind === 'caption' ? '字幕' : kind === 'shape' ? '氛围背景' : '新片段',
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
          text: '让想法，成为画面。',
          subtitle: 'CREATED WITH COCRAFT',
          fontSize: 84,
          color: '#f5f2e9',
          position: 'center',
          align: 'center',
          animation: 'rise',
          template: 'editorial',
        }
      : kind === 'caption'
        ? {
            text: '在这里写下你的故事',
            fontSize: 46,
            color: '#ffffff',
            position: 'bottom',
            background: '#00000080',
            animation: 'fade',
          }
        : {
            volume: kind === 'audio' ? 0.35 : 1,
            opacity: 1,
            scale: 1,
            fit: 'cover',
            template: 'aurora',
            color: '#8faac2',
          },
});
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
    for (const c of s.clips) {
      if (ids.has(c.id)) throw new Error('片段标识重复');
      ids.add(c.id);
      if (
        !['video', 'image', 'audio', 'title', 'caption', 'shape', 'code'].includes(c.kind) ||
        !['visual', 'overlay', 'caption', 'audio'].includes(c.track)
      )
        throw new Error('片段类型无效');
      if (
        !Number.isInteger(c.start) ||
        !Number.isInteger(c.duration) ||
        !Number.isInteger(c.sourceIn) ||
        c.start < 0 ||
        c.duration < 1 ||
        c.sourceIn < 0
      )
        throw new Error('片段时间必须是有效帧数');
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
export function applyOperations(
  input: Project,
  operations: EditOperation[],
  author: 'you' | 'agent' = 'you',
): Project {
  const p = clone(input);
  const only = (value: object, keys: string[]) => {
    if (!value || Object.keys(value).some((k) => !keys.includes(k)))
      throw new Error('修改包含不支持的字段，请使用对应的编辑操作');
  };
  for (const op of operations) {
    if (op.type === 'updateProject') {
      only(op.changes, ['name', 'brief']);
      Object.assign(p, op.changes);
      continue;
    }
    if (op.type === 'addAsset') {
      if (!p.assets.some((a) => a.id === op.asset.id)) p.assets.push(clone(op.asset));
      continue;
    }
    if (op.type === 'putComponent') {
      if (p.sequences.some((s) => s.clips.some((c) => c.locked && c.componentId === op.component.id)))
        throw new Error('组件被锁定片段引用，请创建新组件');
      const i = p.components.findIndex((c) => c.id === op.component.id);
      if (i < 0) p.components.push(clone(op.component));
      else p.components[i] = clone(op.component);
      continue;
    }
    if (op.type === 'addSequence') {
      p.sequences.push(clone(op.sequence));
      continue;
    }
    const s = p.sequences.find((s) => s.id === op.sequenceId);
    if (!s) throw new Error('成片不存在');
    if (op.type === 'updateSequence') {
      only(op.changes, ['name', 'width', 'height', 'fps', 'background']);
      if (author === 'agent' && s.clips.some((c) => c.locked))
        throw new Error('成片包含锁定片段，不能修改画幅与帧率');
      Object.assign(s, op.changes);
      continue;
    }
    if (op.type === 'addClip') {
      s.clips.push(clone(op.clip));
      continue;
    }
    const c = s.clips.find((c) => c.id === op.clipId);
    if (!c) throw new Error('片段不存在');
    if (
      c.locked &&
      (author === 'agent' ||
        op.type === 'deleteClip' ||
        (op.type === 'updateClip' && Object.keys(op.changes).some((k) => k !== 'locked')))
    )
      throw new Error(`「${c.name}」已锁定，请先解锁`);
    if (op.type === 'updateClip') {
      only(op.changes, [
        'name',
        'kind',
        'track',
        'start',
        'duration',
        'sourceIn',
        'assetId',
        'componentId',
        'locked',
        'props',
      ]);
      const { id, ...changes } = op.changes;
      Object.assign(c, changes, changes.props ? { props: { ...c.props, ...changes.props } } : {});
    } else if (op.type === 'deleteClip') {
      s.clips = s.clips.filter((x) => x.id !== c.id);
      if (op.ripple)
        for (const next of s.clips) {
          if (next.start >= c.start + c.duration) {
            if (next.locked) throw new Error('波纹删除会移动锁定片段');
            next.start -= c.duration;
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
  return [
    { type: 'updateClip', sequenceId: sequence.id, clipId: clip.id, changes: { duration: offset } },
    {
      type: 'addClip',
      sequenceId: sequence.id,
      clip: {
        ...clone(clip),
        id: uid('clip'),
        name: clip.name + ' · 2',
        start: at,
        duration: clip.duration - offset,
        sourceIn: clip.sourceIn + offset,
      },
    },
  ];
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
  }
  if (b.assets.length > a.assets.length) result.push(`导入 ${b.assets.length - a.assets.length} 个素材`);
  if (JSON.stringify(a.components) !== JSON.stringify(b.components)) result.push('更新代码组件');
  return result.length ? result : ['更新工程'];
}
