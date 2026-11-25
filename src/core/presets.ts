import { newClip } from './project';
import type { Clip, Project, StyleTokens, TransitionType, VaultItem } from './types';

export const BUILT_IN_STYLES: VaultItem[] = [
  {
    id: 'gstyle_cobalt_night',
    name: '深空钴蓝',
    entityKind: 'style',
    role: 'visual-style',
    tags: ['科技发布', '暗色高对比'],
    category: 'brand',
    subkind: 'brand-kit',
    description: '深海夜空底色搭配电光钴蓝与青翠双强调色，适合产品功能演示、系统架构与数据发布。',
    styleTokens: {
      primaryColor: '#3b82f6',
      secondaryColor: '#14b8a6',
      backgroundColor: '#0b101d',
      surfaceColor: '#131c31',
      inkColor: '#f8fafc',
      captionColor: '#f8fafc',
      lightingPreset: 'cyber-rim',
      cornerRadius: 16,
    },
    brand: {
      primaryColor: '#3b82f6',
      secondaryColor: '#14b8a6',
      backgroundColor: '#0b101d',
      captionColor: '#f8fafc',
    },
    version: 1,
    updatedAt: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'gstyle_warm_paper',
    name: '暖米纸白',
    entityKind: 'style',
    role: 'visual-style',
    tags: ['知识科普', '手绘白板', '浅色'],
    category: 'brand',
    subkind: 'brand-kit',
    description: '温润点阵纸白底色搭配墨蓝与琥珀标注色，适合原理科普、手绘状态推演与深度阅读。',
    styleTokens: {
      primaryColor: '#2563eb',
      secondaryColor: '#d97706',
      backgroundColor: '#fbf9f3',
      surfaceColor: '#ffffff',
      inkColor: '#0f172a',
      captionColor: '#0f172a',
      lightingPreset: 'porcelain-soft',
      cornerRadius: 14,
    },
    brand: {
      primaryColor: '#2563eb',
      secondaryColor: '#d97706',
      backgroundColor: '#fbf9f3',
      captionColor: '#0f172a',
    },
    version: 1,
    updatedAt: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'gstyle_obsidian_titanium',
    name: '黑曜钛金',
    entityKind: 'style',
    role: 'visual-style',
    tags: ['硬件拆解', '商业质感', '三维'],
    category: 'brand',
    subkind: 'brand-kit',
    description: '黑曜石哑光底搭配香槟钛金与冷银高光，适合硬件结构拆解、工业产品展示与品牌成片。',
    styleTokens: {
      primaryColor: '#f59e0b',
      secondaryColor: '#94a3b8',
      backgroundColor: '#09090c',
      surfaceColor: '#14151a',
      inkColor: '#f8fafc',
      captionColor: '#fef3c7',
      lightingPreset: 'titanium-dark',
      cornerRadius: 12,
    },
    brand: {
      primaryColor: '#f59e0b',
      secondaryColor: '#94a3b8',
      backgroundColor: '#09090c',
      captionColor: '#fef3c7',
    },
    version: 1,
    updatedAt: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'gstyle_mist_minimal',
    name: '浅雾极简',
    entityKind: 'style',
    role: 'visual-style',
    tags: ['清爽教程', '日常汇报', '浅色'],
    category: 'brand',
    subkind: 'brand-kit',
    description: '清透浅灰雾面底色搭配青碧主色，干净不抢戏，适合软件操作教程、口播知识分享与汇报。',
    styleTokens: {
      primaryColor: '#0d9488',
      secondaryColor: '#6366f1',
      backgroundColor: '#f1f5f9',
      surfaceColor: '#ffffff',
      inkColor: '#0f172a',
      captionColor: '#0f172a',
      lightingPreset: 'porcelain-soft',
      cornerRadius: 18,
    },
    brand: {
      primaryColor: '#0d9488',
      secondaryColor: '#6366f1',
      backgroundColor: '#f1f5f9',
      captionColor: '#0f172a',
    },
    version: 1,
    updatedAt: '2026-11-18T00:00:00.000Z',
  },
];

export function isLightHex(hex?: string): boolean {
  if (!hex || !hex.startsWith('#')) return false;
  const clean = hex.slice(1);
  if (clean.length !== 6 && clean.length !== 3) return false;
  const full =
    clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 155;
}

export function resolveStyleItem(project?: Project, brandId?: string): VaultItem | undefined {
  const id = brandId ?? project?.activeBrandId;
  if (!id) return undefined;
  return (
    (project?.vault || []).find((v) => v.id === id && (v.styleTokens || v.brand)) ||
    BUILT_IN_STYLES.find((v) => v.id === id)
  );
}

export function resolveProjectStyle(project?: Project): StyleTokens | undefined {
  const item = resolveStyleItem(project);
  if (!item) return undefined;
  if (item.styleTokens) return item.styleTokens;
  if (item.brand) {
    return {
      primaryColor: item.brand.primaryColor,
      secondaryColor: item.brand.secondaryColor,
      backgroundColor: item.brand.backgroundColor,
      surfaceColor: isLightHex(item.brand.backgroundColor) ? '#ffffff' : '#161b26',
      inkColor: isLightHex(item.brand.backgroundColor) ? '#0f172a' : '#f8fafc',
      captionColor: item.brand.captionColor,
    };
  }
  return undefined;
}

export const BUILT_IN_TRANSITIONS: {
  id: TransitionType;
  name: string;
  description: string;
  defaultSeconds: number;
}[] = [
  { id: 'dissolve', name: '叠化过渡', description: '平滑透明度叠加淡入画面', defaultSeconds: 0.6 },
  { id: 'fade', name: '黑场淡入', description: '经由纯黑转场揭示下一镜', defaultSeconds: 0.6 },
  { id: 'slide-left', name: '平滑推入', description: '由右侧横向切入当前画幅', defaultSeconds: 0.5 },
  { id: 'zoom-in', name: '镜头推近', description: '微妙推镜缩放聚焦入场', defaultSeconds: 0.5 },
  { id: 'blur', name: '柔焦过渡', description: '高光失焦至清晰锐利焦点', defaultSeconds: 0.6 },
  { id: 'wipe', name: '线性擦除', description: '硬边划像揭示后续画面', defaultSeconds: 0.5 },
];

export type PresetCategory = 'titles' | 'captions' | 'graphics' | 'stages' | 'backgrounds';
export type PresetValue = string | number | boolean;
export interface PresetParameter {
  key: string;
  label: string;
  type: 'text' | 'color' | 'number' | 'select' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
}
export interface PresetDefinition {
  id: string;
  version: 1;
  name: string;
  category: PresetCategory;
  description: string;
  kind: 'title' | 'caption' | 'shape';
  durationSeconds: number;
  keywords: string[];
  defaultProps: Record<string, PresetValue>;
  /** Clean defaults used when instantiating a new timeline clip (separates showcase demo metrics from real edits). */
  instanceDefaults?: Record<string, PresetValue>;
  parameters: PresetParameter[];
  license: string;
}
export const presetCategories = [
  { id: 'all', name: '全部' },
  { id: 'stages', name: '演示与三维' },
  { id: 'graphics', name: '数据图表' },
  { id: 'titles', name: '标题章节' },
  { id: 'captions', name: '字幕样式' },
  { id: 'backgrounds', name: '背景底板' },
] as const;
const title: PresetParameter = { key: 'text', label: '主文案', type: 'text' };
const subtitle: PresetParameter = { key: 'subtitle', label: '补充文案', type: 'text' };
const accent: PresetParameter = { key: 'accent', label: '强调色', type: 'color' };
const surface: PresetParameter = {
  key: 'surface',
  label: '底色',
  type: 'select',
  options: [
    { value: 'dark', label: '深色' },
    { value: 'light', label: '浅色' },
    { value: 'transparent', label: '透明叠加' },
  ],
};
const amount = (key: string, label: string, max = 100): PresetParameter => ({
  key,
  label,
  type: 'number',
  min: 0,
  max,
  step: 1,
});
const define = (p: Omit<PresetDefinition, 'version' | 'license'>): PresetDefinition => ({
  version: 1,
  license: 'CoCraft Originals · CC0-1.0',
  ...p,
});

export const presetCatalog: PresetDefinition[] = [
  define({
    id: 'phase-study',
    name: '声场 · 相位实验',
    category: 'graphics',
    kind: 'title',
    durationSeconds: 6,
    description: '两道等幅正弦波与合成结果共用一条时间轴。可以改变相位区间，或把画面切成摄影叠字。',
    keywords: ['声学', '波形', '科普', '实验', '示波器', '摄影'],
    defaultProps: {
      text: '错开半周',
      subtitle: '把第二道波推迟半个周期，波峰与波谷恰好相遇。',
      label: '声学手记',
      layout: 'diagram',
      phaseFrom: 0,
      phaseTo: 180,
      sweep: 3.6,
      accent: '#af492d',
    },
    parameters: [
      title,
      subtitle,
      { key: 'label', label: '系列名称', type: 'text' },
      {
        key: 'layout',
        label: '版式',
        type: 'select',
        options: [
          { value: 'diagram', label: '纸本波形图' },
          { value: 'photo', label: '摄影叠字' },
        ],
      },
      amount('phaseFrom', '起始相位差（度）', 360),
      amount('phaseTo', '结束相位差（度）', 360),
      { key: 'sweep', label: '相位变化时长（秒）', type: 'number', min: 0.2, max: 30, step: 0.1 },
      accent,
    ],
  }),
  define({
    id: 'studio-title',
    name: '焦点 · 主标题',
    category: 'titles',
    kind: 'title',
    durationSeconds: 5,
    description: '用一行明确的观点开场。柔和光环与分层入场为文字建立焦点。',
    keywords: ['产品', '发布', '开场', '科技'],
    defaultProps: {
      text: '声音，从这里出发。',
      subtitle: 'FIELD RECORDINGS / VOL. 01',
      accent: '#9df3cd',
      surface: 'dark',
    },
    parameters: [title, subtitle, accent, surface],
  }),
  define({
    id: 'editorial-title',
    name: '版式 · 双行标题',
    category: 'titles',
    kind: 'title',
    durationSeconds: 5,
    description: '有力度的字重、细边线和编辑式留白，适合纪录、品牌与专题。',
    keywords: ['品牌', '杂志', '纪录', '标题'],
    defaultProps: {
      text: '城市醒来\n之前。',
      subtitle: '一份听觉观察手记',
      label: 'FIELD NOTES / CITY EDITION',
      accent: '#f5a67c',
      surface: 'light',
    },
    parameters: [title, subtitle, { key: 'label', label: '刊头', type: 'text' }, accent, surface],
  }),
  define({
    id: 'split-title',
    name: '分野 · 对比标题',
    category: 'titles',
    kind: 'title',
    durationSeconds: 5,
    description: '两段文案在清晰的色块中建立对照，适合观点转折与章节开场。',
    keywords: ['对比', '章节', '发布'],
    defaultProps: { text: '捕捉现场', subtitle: '重构声场', accent: '#a8b8ff', surface: 'dark' },
    parameters: [title, subtitle, accent, surface],
  }),
  define({
    id: 'chapter-marker',
    name: '序章 · 章节标记',
    category: 'titles',
    kind: 'title',
    durationSeconds: 4,
    description: '编号先出现，分隔线与章节标题依次建立阅读顺序。',
    keywords: ['章节', '课程', '纪录'],
    defaultProps: {
      text: '走进录音棚',
      subtitle: 'FIELD RECORDINGS / CHAPTER ONE',
      chapter: '01',
      accent: '#86c8ff',
      surface: 'dark',
    },
    parameters: [{ key: 'chapter', label: '章节编号', type: 'text' }, title, subtitle, accent, surface],
  }),
  define({
    id: 'lower-third',
    name: '署名 · 人物介绍',
    category: 'titles',
    kind: 'title',
    durationSeconds: 5,
    description: '贴近画面底部的清晰署名。自动避开四周安全区，不抢人物焦点。',
    keywords: ['采访', '人物', '署名', '下三分之一'],
    defaultProps: { text: '林予安', subtitle: '声音设计师', accent: '#a8b8ff', surface: 'transparent' },
    parameters: [title, subtitle, accent],
  }),
  define({
    id: 'end-card',
    name: '落幕 · 行动收尾',
    category: 'titles',
    kind: 'title',
    durationSeconds: 5,
    description: '一个明确的收尾观点与行动信息，适合短片结束和品牌落款。',
    keywords: ['片尾', '行动', '品牌', '落款'],
    defaultProps: {
      text: '下次，带上耳机。',
      subtitle: '声音手记 · 下一辑见',
      label: 'FIELD RECORDINGS',
      accent: '#a5edca',
      surface: 'dark',
    },
    parameters: [title, subtitle, { key: 'label', label: '品牌落款', type: 'text' }, accent, surface],
  }),
  define({
    id: 'glass-caption',
    name: '清晰 · 浮层字幕',
    category: 'captions',
    kind: 'caption',
    durationSeconds: 3.5,
    description: '高可读性半透明字幕底板，兼容明暗镜头。字幕按段进出。',
    keywords: ['字幕', '口播', '双行', '访谈'],
    defaultProps: { text: '地铁门合上，雨声留在站台。', accent: '#b6d3ff', surface: 'transparent' },
    parameters: [title, accent],
  }),
  define({
    id: 'kinetic-caption',
    name: '强调 · 分词字幕',
    category: 'captions',
    kind: 'caption',
    durationSeconds: 4,
    description: '根据均分节奏逐段强调重点词。精确逐字对齐请用转录时间戳。',
    keywords: ['字幕', '重点', '口播', '强调'],
    defaultProps: { text: '听见 城市的呼吸', accent: '#c8ff6b', surface: 'transparent' },
    parameters: [title, accent],
  }),
  define({
    id: 'quote-card',
    name: '引言 · 关键观点',
    category: 'graphics',
    kind: 'title',
    durationSeconds: 6,
    description: '以引号、观点和出处组成稳定的信息层级，适合金句与采访摘要。',
    keywords: ['引用', '金句', '观点', '采访'],
    defaultProps: {
      text: '开始录音，我才听见街道的另一面。',
      subtitle: '示例引言 · 城市采声手记',
      accent: '#f6bb88',
      surface: 'light',
    },
    parameters: [title, subtitle, accent, surface],
  }),
  define({
    id: 'stat-counter',
    name: '刻度 · 数据强调',
    category: 'graphics',
    kind: 'title',
    durationSeconds: 5,
    description: '大数字按帧递增，配合单位与来源。数据需由使用者提供。',
    keywords: ['数字', '数据', '汇报', '指标'],
    defaultProps: {
      text: '本次采样时长',
      subtitle: '示例数据 · 现场采样片段',
      value: 48,
      suffix: '秒',
      accent: '#7de5b4',
      surface: 'dark',
    },
    parameters: [
      title,
      amount('value', '数值', 1000000),
      { key: 'suffix', label: '单位', type: 'text' },
      subtitle,
      accent,
      surface,
    ],
  }),
  define({
    id: 'comparison-bars',
    name: '对照 · 双项比较',
    category: 'graphics',
    kind: 'title',
    durationSeconds: 6,
    description: '两组数值使用同一比例尺，标注单位与来源，避免误导性比较。',
    keywords: ['数据', '比较', '图表', '汇报'],
    defaultProps: {
      text: '两次采样的时长',
      labelA: '清晨',
      labelB: '傍晚',
      valueA: 42,
      valueB: 78,
      subtitle: '示例数据 · 单位为秒',
      accent: '#8baaff',
      surface: 'dark',
    },
    parameters: [
      title,
      { key: 'labelA', label: '项目 A', type: 'text' },
      amount('valueA', '数值 A', 1000000),
      { key: 'labelB', label: '项目 B', type: 'text' },
      amount('valueB', '数值 B', 1000000),
      subtitle,
      accent,
      surface,
    ],
  }),
  define({
    id: 'feature-stack',
    name: '要点 · 三步展开',
    category: 'graphics',
    kind: 'title',
    durationSeconds: 6,
    description: '三项内容顺序进入。竖屏自动切换纵向布局，适合流程和产品说明。',
    keywords: ['步骤', '要点', '产品', '说明'],
    defaultProps: {
      text: '一次街头采声',
      items: '选定声源|记录环境|回听整理',
      subtitle: 'FIELD RECORDING PROCESS',
      accent: '#aab7ff',
      surface: 'dark',
    },
    parameters: [
      title,
      { key: 'items', label: '三个要点（用 | 分隔）', type: 'text' },
      subtitle,
      accent,
      surface,
    ],
  }),
  define({
    id: 'focus-callout',
    name: '聚焦 · 信息注释',
    category: 'graphics',
    kind: 'title',
    durationSeconds: 5,
    description: '细线、定位点与短说明用于解释画面细节，可叠加在镜头上。',
    keywords: ['注释', '产品', '说明', '标注'],
    defaultProps: {
      text: '唱针落下的瞬间',
      subtitle: '唱针接触位置',
      accent: '#9ee7ff',
      surface: 'transparent',
    },
    parameters: [title, subtitle, accent],
  }),
  define({
    id: 'gradient-orbit',
    name: '光域 · 流动光环',
    category: 'backgrounds',
    kind: 'shape',
    durationSeconds: 8,
    description: '深色空间中的有机光环。慢速轨道运动，适合产品与标题底图。',
    keywords: ['背景', '科技', '渐变', '光'],
    defaultProps: { accent: '#9b93ff', secondary: '#45ddb4', surface: 'dark', intensity: 70 },
    parameters: [
      accent,
      { key: 'secondary', label: '辅助色', type: 'color' },
      amount('intensity', '光照强度'),
    ],
  }),
  define({
    id: 'contour-field',
    name: '等高 · 线条场',
    category: 'backgrounds',
    kind: 'shape',
    durationSeconds: 8,
    description: '连续变化的等高线形成深度，适合品牌包装与冷静的信息展示。',
    keywords: ['背景', '线条', '数据', '品牌'],
    defaultProps: { accent: '#8ae2c6', surface: 'dark', intensity: 55 },
    parameters: [accent, amount('intensity', '线条强度'), surface],
  }),
  define({
    id: 'grid-light',
    name: '坐标 · 精密网格',
    category: 'backgrounds',
    kind: 'shape',
    durationSeconds: 8,
    description: '网格、坐标与缓慢移动的光带构成有秩序的科技底图。',
    keywords: ['背景', '网格', '科技', '数据'],
    defaultProps: { accent: '#83a9ff', surface: 'dark', intensity: 55 },
    parameters: [accent, amount('intensity', '光照强度'), surface],
  }),
  define({
    id: 'spatial-stage',
    name: '统一空间摄影棚 (2.5D / 3D / 3DGS)',
    category: 'stages',
    kind: 'shape',
    durationSeconds: 6,
    description:
      '零建模 2.5D 立体漫剧视差镜头、导演 3D 白模多机位预演、3D 硬件贴屏与 .glb/.spz 空间世界统一摄影棚，支持一键输出深度/法线图反哺 AI 工坊。',
    keywords: ['空间', '摄影棚', '2.5D', '3D', '视差', '白模', '预演', '机位', '深度', '漫剧', '3DGS', 'spz', 'glb'],
    defaultProps: {
      text: '立体空间镜头',
      subtitle: 'SPATIAL STAGE',
      sceneType: 'parallax-25d',
      cameraPreset: 'dolly-in',
      cameraLens: 35,
      cameraYaw: 0,
      cameraPitch: 0,
      cameraDistance: 1,
      cameraPanX: 0,
      cameraPanY: 0,
      lightingPreset: 'studio',
      lookPreset: 'cinema',
      renderPass: 'beauty',
      particles3D: 'dust',
      depthStrength: 0.65,
      depthSpread: 1.0,
      dofStrength: 24,
      bloomStrength: 22,
      explode: 0,
      speed: 1,
      animateExplode: false,
      animationIndex: 0,
      blockingPose: 'standoff',
      actorAction: 'walk',
      actorPath: 'approach',
      environmentPreset: 'rooftop-night',
      deviceType: 'phone',
      showHud: false,
      focusLabel: '',
      accent: '#3b82f6',
      secondary: '#14b8a6',
      surface: 'dark',
    },
    parameters: [
      {
        key: 'sceneType',
        label: '空间置景模式',
        type: 'select',
        options: [
          { value: 'parallax-25d', label: '2.5D 立体漫剧/原画' },
          { value: 'previs-blocking', label: '导演白模预演棚' },
          { value: 'device-showcase', label: '3D 硬件动态贴屏' },
          { value: 'turbine', label: '同轴光学镜组拆解' },
          { value: 'chip-stack', label: 'AI 芯片叠层架构' },
          { value: 'factory-flow', label: '高并发流水线沙盘' },
        ],
      },
      {
        key: 'cameraPreset',
        label: '导演运镜轨迹',
        type: 'select',
        options: [
          { value: 'dolly-in', label: '平滑推镜 (Dolly In)' },
          { value: 'dolly-zoom', label: '希区柯克变焦 (Vertigo)' },
          { value: 'orbit', label: '环绕运镜 (Orbit)' },
          { value: 'pan-sweep', label: '横摇巡视 (Pan Sweep)' },
          { value: 'crane-up', label: '大摇臂升降 (Crane Up)' },
          { value: 'hero-low', label: '低机位仰拍 (Hero Low)' },
          { value: 'top-down', label: '垂直俯瞰 (Top Down)' },
          { value: 'isometric', label: '等轴测斜俯视' },
          { value: 'static', label: '锁定机位 (Static)' },
        ],
      },
      { key: 'cameraLens', label: '焦段 (mm)', type: 'number', min: 18, max: 135, step: 1 },
      { key: 'cameraDistance', label: '机位远近倍率', type: 'number', min: 0.5, max: 2.2, step: 0.05 },
      { key: 'cameraYaw', label: '水平偏航角 (°)', type: 'number', min: -180, max: 180, step: 2 },
      { key: 'cameraPitch', label: '垂直俯仰角 (°)', type: 'number', min: -60, max: 60, step: 2 },
      {
        key: 'renderPass',
        label: '渲染输出通道',
        type: 'select',
        options: [
          { value: 'beauty', label: '成片渲染 (Beauty)' },
          { value: 'clay', label: '导演白模 (Clay)' },
          { value: 'depth', label: '深度图 (Depth · 控 AI)' },
          { value: 'normal', label: '法线图 (Normal · 控 AI)' },
          { value: 'wireframe', label: '结构线框 (Wireframe)' },
        ],
      },
      {
        key: 'lookPreset',
        label: '影棚风格与光影',
        type: 'select',
        options: [
          { value: 'cinema', label: '电影影棚 PBR' },
          { value: 'anime-npr', label: '漫剧描边 (Anime NPR)' },
          { value: 'noir-dramatic', label: '暗夜硬轮廓光' },
          { value: 'clean-studio', label: '白箱柔光产品棚' },
        ],
      },
      {
        key: 'particles3D',
        label: '3D 空间体积粒子',
        type: 'select',
        options: [
          { value: 'none', label: '关闭' },
          { value: 'dust', label: '电影浮尘光粒' },
          { value: 'rain', label: '三维空间雨丝' },
          { value: 'snow', label: '立体飘雪' },
          { value: 'embers', label: '炽热火星' },
        ],
      },
      {
        key: 'blockingPose',
        label: '白模站位预设',
        type: 'select',
        options: [
          { value: 'standoff', label: '双人对峙 (适合正反打)' },
          { value: 'dialogue', label: '近景对话站位' },
          { value: 'action-dash', label: '走廊冲刺纵深' },
          { value: 'hero-solo', label: '单主角高台孤影' },
        ],
      },
      {
        key: 'actorAction',
        label: '人物动作表演',
        type: 'select',
        options: [
          { value: 'walk', label: '迈步行走 (Walk)' },
          { value: 'run', label: '前倾疾跑 (Run)' },
          { value: 'confront', label: '抬手对峙 (Confront)' },
          { value: 'turn', label: '转身回眸 (Turn)' },
          { value: 'wave', label: '挥手呼喊 (Wave)' },
          { value: 'idle', label: '呼吸待机 (Idle)' },
        ],
      },
      {
        key: 'actorPath',
        label: '人物走线轨迹',
        type: 'select',
        options: [
          { value: 'hold', label: '原地表演 (Hold)' },
          { value: 'approach', label: '向镜头走近 (Approach)' },
          { value: 'cross-left-right', label: '左进右出横穿 (L → R)' },
          { value: 'cross-right-left', label: '右进左出横穿 (R → L)' },
          { value: 'circle-rival', label: '绕对手走位对峙 (Circle)' },
          { value: 'retreat', label: '后退拉远 (Retreat)' },
        ],
      },
      {
        key: 'environmentPreset',
        label: '3D 场景环境',
        type: 'select',
        options: [
          { value: 'rooftop-night', label: '雨夜天台都市' },
          { value: 'neon-alley', label: '赛博霓虹窄巷' },
          { value: 'cyber-corridor', label: '纵深科幻长廊' },
          { value: 'open-horizon', label: '极简地平线逆光' },
          { value: 'studio-grid', label: '标准白箱导演棚' },
        ],
      },
      {
        key: 'deviceType',
        label: '硬件样机形态',
        type: 'select',
        options: [
          { value: 'phone', label: '钛金属旗舰手机' },
          { value: 'laptop', label: '超薄专业笔记本' },
          { value: 'cinema-display', label: '悬浮电影级巨幕' },
        ],
      },
      { key: 'depthStrength', label: '2.5D 立体浮雕强度', type: 'number', min: 0, max: 1.4, step: 0.05 },
      { key: 'depthSpread', label: '多图层 Z 轴间距', type: 'number', min: 0.3, max: 2.0, step: 0.05 },
      { key: 'dofStrength', label: '光学景深暗角', type: 'number', min: 0, max: 100, step: 2 },
      { key: 'bloomStrength', label: '电影光晕 (Bloom)', type: 'number', min: 0, max: 100, step: 2 },
      { key: 'speed', label: '运镜与动画速率', type: 'number', min: 0, max: 3, step: 0.1 },
      { key: 'showHud', label: '显示导演信息角标', type: 'boolean' },
      title,
      subtitle,
      accent,
      { key: 'secondary', label: '辅助光色', type: 'color' },
      surface,
    ],
  }),
  define({
    id: 'teardown-3d',
    name: '三维空间与结构拆解',
    category: 'stages',
    kind: 'shape',
    durationSeconds: 6,
    description: '三维机械、芯片叠层与节点沙盘的立体拆解展示，支持切换摄影棚机位或绑定本地 .glb 模型。',
    keywords: ['三维', '3D', '拆解', '芯片', '机械', '沙盘', '模型'],
    defaultProps: {
      text: '精密结构分层解析',
      subtitle: '三维空间展示',
      sceneType: 'turbine',
      cameraPreset: 'orbit',
      cameraYaw: 0,
      cameraPitch: 0,
      lightingPreset: 'studio',
      explode: 0.65,
      speed: 1,
      animateExplode: true,
      focusLabel: '核心光学镜组与同轴转子',
      accent: '#3b82f6',
      secondary: '#14b8a6',
      surface: 'dark',
    },
    parameters: [
      title,
      subtitle,
      {
        key: 'sceneType',
        label: '三维结构类型',
        type: 'select',
        options: [
          { value: 'turbine', label: '同轴涡轮与光学镜组' },
          { value: 'chip-stack', label: '多层芯片与架构叠层' },
          { value: 'factory-flow', label: '节点流转微缩沙盘' },
        ],
      },
      {
        key: 'cameraPreset',
        label: '摄像机视角',
        type: 'select',
        options: [
          { value: 'orbit', label: '环绕审视' },
          { value: 'isometric', label: '等轴测斜俯视' },
          { value: 'dolly-in', label: '平滑推近特写' },
          { value: 'top-down', label: '垂直俯视' },
          { value: 'hero-low', label: '低机位仰视' },
        ],
      },
      { key: 'cameraYaw', label: '水平偏航角 (°)', type: 'number', min: -180, max: 180, step: 2 },
      { key: 'cameraPitch', label: '垂直俯仰角 (°)', type: 'number', min: -60, max: 60, step: 2 },
      {
        key: 'lightingPreset',
        label: 'PBR 环境布光',
        type: 'select',
        options: [
          { value: 'studio', label: '影棚白箱 PBR' },
          { value: 'dramatic', label: '戏剧轮廓硬光' },
          { value: 'soft', label: '柔光均布漫射' },
        ],
      },
      { key: 'explode', label: '爆炸拆解间距', type: 'number', min: 0, max: 1.4, step: 0.05 },
      { key: 'speed', label: '运转与运镜速率', type: 'number', min: 0, max: 3, step: 0.1 },
      { key: 'animateExplode', label: '自动缓入展开', type: 'boolean' },
      { key: 'focusLabel', label: '部件标注说明', type: 'text' },
      accent,
      { key: 'secondary', label: '辅助光色', type: 'color' },
      surface,
    ],
  }),
  define({
    id: 'seecode-architecture',
    name: '分步架构与流程演示',
    category: 'stages',
    kind: 'shape',
    durationSeconds: 6,
    description: '高对比编辑排版的流程演进与关键指标对比页，按节拍逐级点亮核心阶段，横竖屏自适应。',
    keywords: ['架构', '流程', '方案', '对比', '图表', '演示'],
    defaultProps: {
      text: '三阶段实时处理流程',
      subtitle: '系统方案概览',
      nodes: '信号接入|核心处理|结果输出',
      metrics: '99.4% 准确率 · 3.2x 效率提升 · <8ms 响应延迟',
      activeStep: 3,
      accent: '#3b82f6',
      surface: 'dark',
    },
    instanceDefaults: {
      text: '核心流程标题',
      subtitle: '',
      nodes: '阶段一|阶段二|阶段三',
      metrics: '',
    },
    parameters: [
      title,
      subtitle,
      { key: 'nodes', label: '阶段名称 (用 | 分隔)', type: 'text' },
      { key: 'metrics', label: '底部关键指标 (用 · 分隔)', type: 'text' },
      { key: 'activeStep', label: '点亮至第几步', type: 'number', min: 1, max: 4, step: 1 },
      accent,
      surface,
    ],
  }),
  define({
    id: 'tinycharts-state',
    name: '手绘白板状态推演',
    category: 'stages',
    kind: 'shape',
    durationSeconds: 6,
    description: '温暖手绘马克笔点阵纸面质感，直观推演规则正常通过与条件拦截回退两种路径。',
    keywords: ['手绘', '白板', '状态', '规则', '原理', '科普'],
    defaultProps: {
      text: '请求校验与状态流转规则',
      subtitle: '规则逻辑推演',
      states: '提交请求|条件校验|完成发布',
      mode: 'pass',
      guardNote: '满足前置条件 → 顺利进入下一阶段',
      accent: '#2563eb',
      surface: 'light',
    },
    parameters: [
      title,
      subtitle,
      { key: 'states', label: '节点文案 (用 | 分隔)', type: 'text' },
      {
        key: 'mode',
        label: '推演结果',
        type: 'select',
        options: [
          { value: 'pass', label: '条件满足 · 顺利通过' },
          { value: 'reject', label: '条件不符 · 拦截回退' },
        ],
      },
      { key: 'guardNote', label: '底部结论批注', type: 'text' },
      accent,
      surface,
    ],
  }),
  define({
    id: 'whiteboard-sketch',
    name: '手绘白板概念卡片',
    category: 'stages',
    kind: 'shape',
    durationSeconds: 6,
    description: '基于 RoughJS 确定性手绘引擎，按时间轴逐笔绘制斜线阴影卡片与箭头，导出零帧闪烁。',
    keywords: ['手绘', '白板', '科普', '概念', '步骤', 'roughjs', '草图'],
    defaultProps: {
      text: '三步看懂核心机制',
      subtitle: 'SKETCH EXPLAINER · WHITEBOARD',
      points: '发现瓶颈|拆解路径|稳定落地',
      callout: '手绘白板 · 确定性种子逐笔渲染',
      accent: '#d97706',
      surface: 'light',
    },
    parameters: [
      title,
      subtitle,
      { key: 'points', label: '三步卡片内容 (用 | 分隔)', type: 'text' },
      { key: 'callout', label: '底部说明批注', type: 'text' },
      accent,
      surface,
    ],
  }),
  define({
    id: 'anatomy-telemetry',
    name: '原理机制与粒子剖面',
    category: 'stages',
    kind: 'shape',
    durationSeconds: 6,
    description: '内部腔体与传导路径剖面动态示意，配确定性粒子流动与实时数值读数。',
    keywords: ['剖面', '原理', '粒子', '科学', '机制', '科普'],
    defaultProps: {
      text: '缓冲限流与平稳放行原理',
      subtitle: '内部机制动态示意',
      domain: 'engineering',
      flowRate: 78,
      citation: '示意图：稳态通量控制模型',
      accent: '#14b8a6',
      surface: 'dark',
    },
    parameters: [
      title,
      subtitle,
      {
        key: 'domain',
        label: '结构类型',
        type: 'select',
        options: [
          { value: 'engineering', label: '工程腔体 · 缓冲与阀门' },
          { value: 'biomed', label: '微观传导 · 信号与受体' },
        ],
      },
      { key: 'flowRate', label: '流动速率 (%)', type: 'number', min: 10, max: 100, step: 5 },
      { key: 'citation', label: '底部来源说明', type: 'text' },
      accent,
      surface,
    ],
  }),
  define({
    id: 'screen-focus-rig',
    name: '设备外壳与录屏特写',
    category: 'stages',
    kind: 'shape',
    durationSeconds: 6,
    description: '支持 macOS 窗口、浏览器、手机样机与终端四种设备外壳，将录屏或截图平滑推拉放大至操作焦点。',
    keywords: ['录屏', '产品演示', '外壳', '样机', '聚焦', '放大', '浏览器', '手机'],
    defaultProps: {
      text: '聚焦展示核心交互细节',
      subtitle: 'cocraft.studio/demo',
      frameStyle: 'macos',
      zoomLevel: 1.75,
      focusX: 68,
      focusY: 36,
      showRing: true,
      accent: '#3b82f6',
      surface: 'dark',
    },
    parameters: [
      title,
      subtitle,
      {
        key: 'frameStyle',
        label: '设备外壳样式',
        type: 'select',
        options: [
          { value: 'macos', label: 'macOS 圆角毛玻璃窗' },
          { value: 'browser', label: '极简浏览器地址栏框' },
          { value: 'phone', label: '竖屏手机样机外壳' },
          { value: 'terminal', label: '暗色命令行终端窗' },
        ],
      },
      { key: 'zoomLevel', label: '焦点放大倍率', type: 'number', min: 1, max: 2.8, step: 0.05 },
      { key: 'focusX', label: '焦点水平位置 (%)', type: 'number', min: 10, max: 90, step: 1 },
      { key: 'focusY', label: '焦点垂直位置 (%)', type: 'number', min: 10, max: 90, step: 1 },
      { key: 'showRing', label: '显示光标聚光环', type: 'boolean' },
      accent,
      surface,
    ],
  }),
];
export function getPreset(id: string, version?: number) {
  return presetCatalog.find((p) => p.id === id && (version === undefined || p.version === version));
}
// A half-cosine ramp has zero velocity at both ends. The original demo sound
// and its plotted amplitudes use this same phase, including during each hold.
export function phaseAtSecond(seconds: number, from: number, to: number, sweep: number) {
  const progress = Math.max(0, Math.min(1, (seconds - 0.6) / Math.max(0.2, sweep)));
  return from + ((to - from) * (1 - Math.cos(Math.PI * progress))) / 2;
}
export function normalizePresetProps(id: string, overrides: Record<string, unknown> = {}) {
  const preset = getPreset(id);
  if (!preset) throw new Error('素材预设不存在');
  const props: Record<string, PresetValue> = { ...preset.defaultProps };
  for (const parameter of preset.parameters) {
    const value = overrides[parameter.key];
    if (value === undefined) continue;
    if (parameter.type === 'number') {
      const n = Number(value);
      if (Number.isFinite(n))
        props[parameter.key] = Math.max(parameter.min ?? -Infinity, Math.min(parameter.max ?? Infinity, n));
    } else if (parameter.type === 'select') {
      if (parameter.options?.some((o) => o.value === value)) props[parameter.key] = String(value);
    } else if (parameter.type === 'color') {
      if (/^#[0-9a-f]{6}$/i.test(String(value))) props[parameter.key] = String(value);
    } else if (parameter.type === 'boolean') {
      if (typeof value === 'boolean') props[parameter.key] = value;
    } else props[parameter.key] = String(value).slice(0, 500);
  }
  return props;
}
export function applyStyleTokensToClip(clip: Clip, style: StyleTokens): void {
  if (clip.locked) return;
  const overrides = Array.isArray(clip.props._styleOverrides)
    ? new Set((clip.props._styleOverrides as unknown[]).map(String))
    : new Set<string>();
  const isLight = isLightHex(style.backgroundColor);
  const targetSurface = isLight ? 'light' : 'dark';
  const presetId = clip.props.presetId ? String(clip.props.presetId) : '';
  if (presetId) {
    const preset = getPreset(presetId);
    if (!overrides.has('accent')) clip.props.accent = style.primaryColor;
    if (preset?.parameters.some((param) => param.key === 'secondary') && !overrides.has('secondary')) {
      clip.props.secondary = style.secondaryColor;
    }
    if (
      preset?.parameters.some((param) => param.key === 'surface') &&
      clip.props.surface !== 'transparent' &&
      !overrides.has('surface')
    ) {
      clip.props.surface = targetSurface;
    }
    if (!overrides.has('color')) clip.props.color = style.inkColor;
    return;
  }
  if (clip.kind === 'title') {
    if (!overrides.has('color')) clip.props.color = style.inkColor;
    if (clip.props.background && clip.props.background !== 'transparent' && !overrides.has('background')) {
      clip.props.background = style.surfaceColor;
    }
  } else if (clip.kind === 'caption') {
    if (!overrides.has('color')) clip.props.color = style.captionColor;
    if (!overrides.has('background')) {
      clip.props.background = isLight ? 'rgba(255,255,255,0.88)' : 'rgba(12,13,16,0.75)';
    }
  } else if (clip.kind === 'shape') {
    if (!overrides.has('color')) clip.props.color = style.primaryColor;
  }
}

export function createPresetClip(
  id: string,
  start = 0,
  fps = 30,
  overrides: Record<string, unknown> = {},
  project?: Project,
): Clip {
  const preset = getPreset(id);
  if (!preset) throw new Error('素材预设不存在');
  const style = resolveProjectStyle(project);
  const baseOverrides: Record<string, unknown> = {
    ...(preset.instanceDefaults || {}),
    ...overrides,
  };
  const clip: Clip = {
    ...newClip(preset.kind, Math.max(0, Math.round(start))),
    name: preset.name,
    duration: Math.max(1, Math.round(preset.durationSeconds * fps)),
    props: { ...normalizePresetProps(id, baseOverrides), presetId: id, presetVersion: preset.version },
  };
  if (style) {
    applyStyleTokensToClip(clip, style);
    // Only re-apply explicit overrides for style keys when caller intentionally deviated from preset defaultProps
    if (overrides.accent !== undefined && overrides.accent !== preset.defaultProps.accent)
      clip.props.accent = overrides.accent;
    if (overrides.secondary !== undefined && overrides.secondary !== preset.defaultProps.secondary)
      clip.props.secondary = overrides.secondary;
    if (overrides.surface !== undefined && overrides.surface !== preset.defaultProps.surface)
      clip.props.surface = overrides.surface;
  }
  return clip;
}
