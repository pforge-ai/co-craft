import { newClip } from './project';
import type { Clip } from './types';

export type PresetCategory = 'titles' | 'captions' | 'graphics' | 'backgrounds';
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
  parameters: PresetParameter[];
  license: string;
}
export const presetCategories = [
  { id: 'all', name: '全部' },
  { id: 'titles', name: '标题包装' },
  { id: 'captions', name: '字幕' },
  { id: 'graphics', name: '信息图形' },
  { id: 'backgrounds', name: '动态背景' },
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
export function createPresetClip(
  id: string,
  start = 0,
  fps = 30,
  overrides: Record<string, unknown> = {},
): Clip {
  const preset = getPreset(id);
  if (!preset) throw new Error('素材预设不存在');
  return {
    ...newClip(preset.kind, Math.max(0, Math.round(start))),
    name: preset.name,
    duration: Math.max(1, Math.round(preset.durationSeconds * fps)),
    props: { ...normalizePresetProps(id, overrides), presetId: id, presetVersion: preset.version },
  };
}
