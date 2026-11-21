import type {
  Asset,
  AssetEntityKind,
  AssetRole,
  CodeComponent,
  Project,
  Sequence,
  VaultItem,
} from './types';

export const KIND_META: { id: 'all' | AssetEntityKind; label: string }[] = [
  { id: 'all', label: '全部类型' },
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
  { id: 'audio', label: '音频' },
  { id: 'component', label: '动态组件' },
  { id: 'three', label: '三维资产' },
  { id: 'style', label: '视觉风格' },
  { id: 'skill', label: '创作 Skill' },
];

export const ROLE_LABELS: Record<AssetRole, string> = {
  character: '角色形象',
  product: '产品主体',
  environment: '场景环境',
  'screen-recording': '界面录屏',
  footage: '实拍画面',
  voiceover: '人声旁白',
  sfx: '点缀音效',
  bgm: '背景音乐',
  'title-chapter': '标题章节',
  'caption-style': '字幕样式',
  'logic-diagram': '数据与逻辑图解',
  whiteboard: '手绘推演',
  'device-frame': '设备外壳',
  backdrop: '背景底板',
  'editing-skill': '剪辑叙事规范',
  'animation-skill': '动画创造规范',
  'visual-style': '视觉风格变量',
};

export const ROLE_GROUPS: { group: string; roles: AssetRole[] }[] = [
  { group: '主体与空间', roles: ['character', 'product', 'environment'] },
  { group: '画面与录屏', roles: ['screen-recording', 'footage', 'backdrop', 'device-frame'] },
  { group: '声音角色', roles: ['voiceover', 'sfx', 'bgm'] },
  { group: '演示与包装', roles: ['title-chapter', 'caption-style', 'logic-diagram', 'whiteboard'] },
  { group: '风格与规范', roles: ['visual-style', 'editing-skill', 'animation-skill'] },
];

export const TAG_PALETTE = [
  '#3b82f6',
  '#14b8a6',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#22c55e',
  '#ef4444',
  '#64748b',
];

export function inferAssetEntityKind(item: Asset | VaultItem): AssetEntityKind {
  if ('path' in item) {
    if (item.kind === 'model-3d') return 'three';
    return item.kind;
  }
  if (item.entityKind) return item.entityKind;
  if (item.styleTokens || item.brand || item.category === 'brand') return 'style';
  if (item.subkind === 'three-rig' || item.subkind === 'model-3d' || item.assetKind === 'model-3d') return 'three';
  if (item.category === 'rig' || item.rig) return 'component';
  if (item.category === 'recipe') return 'skill';
  if (item.assetKind === 'video' || item.assetKind === 'audio') return item.assetKind;
  return 'image';
}

export function inferAssetRole(item: Asset | VaultItem): AssetRole {
  if (item.role) return item.role;
  if ('path' in item) {
    if (item.kind === 'model-3d') return 'product';
    if (item.kind === 'audio') {
      if (item.transcript) return 'voiceover';
      return item.duration <= 3.5 ? 'sfx' : 'bgm';
    }
    if (item.kind === 'image') return 'footage';
    return 'footage';
  }
  if (item.styleTokens || item.brand || item.category === 'brand') return 'visual-style';
  if (item.subkind === 'character') return 'character';
  if (item.subkind === 'product') return 'product';
  if (item.subkind === 'environment') return 'environment';
  if (item.subkind === 'screen-recording') return 'screen-recording';
  if (item.category === 'recipe') return 'editing-skill';
  return 'logic-diagram';
}

export interface MentionCandidate {
  token: string;
  trigger: '@' | '#' | '/';
  label: string;
  sublabel: string;
  entityId?: string;
  variantId?: string;
  assetId?: string;
  skillName?: string;
}

export function buildMentionCandidates(
  project: Project,
  sequence: Sequence,
  skills: { name: string; description: string }[],
): MentionCandidate[] {
  const list: MentionCandidate[] = [];

  // 1. @ Asset Entities & their State Variants
  for (const v of project.vault || []) {
    const roleLabel = ROLE_LABELS[inferAssetRole(v)];
    list.push({
      token: `@${v.name}`,
      trigger: '@',
      label: v.name,
      sublabel: `${roleLabel} · v${v.version}`,
      entityId: v.id,
      variantId: v.defaultVariantId,
    });
    for (const vr of v.variants || []) {
      list.push({
        token: `@${v.name}:${vr.name}`,
        trigger: '@',
        label: `${v.name} : ${vr.name}`,
        sublabel: `状态分支 · v${vr.version}${vr.tags.length ? ' · #' + vr.tags.join(' #') : ''}`,
        entityId: v.id,
        variantId: vr.id,
      });
    }
  }

  // 2. @ Local Media / 3D / Code Components
  for (const a of project.assets) {
    list.push({
      token: `@${a.name}`,
      trigger: '@',
      label: a.name,
      sublabel: `${ROLE_LABELS[inferAssetRole(a)]} · ${a.kind.toUpperCase()}`,
      assetId: a.id,
    });
  }
  for (const c of project.components as CodeComponent[]) {
    list.push({
      token: `@${c.name}`,
      trigger: '@',
      label: c.name,
      sublabel: '动态组件',
    });
  }

  // 3. @ Film Branches
  for (const s of project.sequences) {
    const bName = s.branchName || s.name;
    list.push({
      token: `@分支:${bName}`,
      trigger: '@',
      label: `成片分支 · ${s.name}`,
      sublabel: s.isMainBranch ? '主干 (main)' : `实验分支${s.forkedAtRevision !== undefined ? ` (源自 v${s.forkedAtRevision})` : ''}`,
    });
  }

  // 4. # Custom Tags & Facets
  const allTags = new Set<string>((project.customTags || []).map((t) => t.name));
  for (const a of project.assets) for (const t of a.tags || []) allTags.add(t);
  for (const v of project.vault || []) {
    for (const t of v.tags || []) allTags.add(t);
    for (const vr of v.variants || []) for (const t of vr.tags || []) allTags.add(t);
  }
  for (const tag of allTags) {
    list.push({
      token: `#${tag}`,
      trigger: '#',
      label: `#${tag}`,
      sublabel: tag.includes(':') ? '分面标签筛选' : '自定义标签筛选',
    });
  }

  // 5. / Decoupled Skills & Branch Actions
  for (const sk of skills) {
    if (sk.name === 'cocraft-editing' || sk.name === 'remotion-best-practices') continue;
    const friendly = friendlySkillTitle(sk.name);
    list.push({
      token: `/${friendly}`,
      trigger: '/',
      label: friendly,
      sublabel: sk.description.split(/[。（(]/)[0].slice(0, 22),
      skillName: sk.name,
    });
  }
  list.push({
    token: '/新建分支试剪',
    trigger: '/',
    label: '在新建实验分支上试剪',
    sublabel: `从「${sequence.name}」派生平行分支执行本次修改，保护原主干`,
  });

  return list;
}

export function friendlySkillTitle(rawName: string): string {
  const map: Record<string, string> = {
    'cocraft-demo-edit': '产品功能演示剪辑',
    'cocraft-talking-cut': '口播去废话精剪',
    'cocraft-multimodal': '多模态生图生视频与配音规范',
    'cocraft-seecode': '架构与数据图解规范',
    'cocraft-tinycharts': '手绘白板推演规范',
    'cocraft-anatomy': '科学机制剖面规范',
    'cocraft-teardown-3d': '三维结构与运镜规范',
    'cocraft-motion': '片头与字幕包装规范',
    'cocraft-editing': '基础工程剪辑与组件开发规范',
  };
  return map[rawName] || rawName;
}
