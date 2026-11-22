import type { ThinkingLevelChoice } from '../core/types';

export interface SavedProjectUi {
  appMode?: 'create' | 'edit';
  sequenceId?: string;
  frame?: number;
  showNav?: boolean;
  showBottom?: boolean;
  showRight?: boolean;
}

export function readProjectUi(projectId: string): SavedProjectUi | null {
  try {
    const raw = localStorage.getItem(`cocraft:ui:${projectId}`);
    return raw ? (JSON.parse(raw) as SavedProjectUi) : null;
  } catch {
    return null;
  }
}

export function writeProjectUi(projectId: string, state: SavedProjectUi): void {
  try {
    localStorage.setItem(`cocraft:ui:${projectId}`, JSON.stringify(state));
  } catch {}
}

/**
 * Triggers `@` / `#` / `/` immediately after Chinese or punctuation too,
 * while ignoring email/URL substrings (Review #16).
 */
export function matchMentionTrigger(text: string): string | null {
  const m = text.match(/(?:^|[^a-zA-Z0-9._-])([@#/][^\s@#/]*)$/);
  return m ? m[1] : null;
}

/**
 * Parses frame number (`70`, `70f`), seconds (`2.5s`), `MM:SS.cc`, or `MM:SS:FF`
 * into an integer frame index (Review #20).
 */
export function parseTimecodeInput(raw: string, fps: number): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+f?$/i.test(s)) return Math.max(0, parseInt(s, 10));
  if (/^\d+(?:\.\d+)?s$/i.test(s)) return Math.max(0, Math.round(parseFloat(s) * fps));
  const mmssff = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (mmssff) {
    return Math.max(0, (Number(mmssff[1]) * 60 + Number(mmssff[2])) * fps + Number(mmssff[3]));
  }
  const mmsscc = s.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (mmsscc) {
    const frac = mmsscc[3] ? Number(`0.${mmsscc[3]}`) : 0;
    return Math.max(0, Math.round((Number(mmsscc[1]) * 60 + Number(mmsscc[2]) + frac) * fps));
  }
  const num = Number(s);
  return Number.isFinite(num) && num >= 0 ? Math.round(num * fps) : null;
}

export const errorText = (e: unknown): string =>
  String(e)
    .replace(/^Error: Error invoking remote method 'cocraft:call': Error: /, '')
    .replace(/^Error: /, '');

export const dateLabel = (s: string): string =>
  new Date(s).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

export const formatCompactTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export const THINKING_OPTIONS: { id: ThinkingLevelChoice; label: string; hint: string }[] = [
  { id: 'off', label: '关闭', hint: '最快响应，直接执行' },
  { id: 'low', label: '低', hint: '轻量快速推理' },
  { id: 'medium', label: '中', hint: '均衡理解与规划' },
  { id: 'high', label: '高', hint: '深度拆解复杂工程' },
];

export type WorkspaceLayoutPresetId = 'focus' | 'edit' | 'collab';

export interface WorkspaceLayoutPreset {
  id: WorkspaceLayoutPresetId;
  name: string;
  description: string;
  showNav: boolean;
  showBottom: boolean;
  showRight: boolean;
  rightTab?: 'inspector' | 'agent';
}

export const WORKSPACE_LAYOUT_PRESETS: WorkspaceLayoutPreset[] = [
  {
    id: 'focus',
    name: '看画面',
    description: '收起左右两栏，最大化舞台与时间线审片',
    showNav: false,
    showBottom: true,
    showRight: false,
  },
  {
    id: 'edit',
    name: '精剪',
    description: '资产栏 + 舞台 + 时间线 + 属性检查器完整布局',
    showNav: true,
    showBottom: true,
    showRight: true,
    rightTab: 'inspector',
  },
  {
    id: 'collab',
    name: '协作',
    description: '宽幅舞台与时间线 + 右侧 Agent 对话协作（小屏推荐）',
    showNav: false,
    showBottom: true,
    showRight: true,
    rightTab: 'agent',
  },
];

export function detectActiveLayoutPreset(state: {
  showNav: boolean;
  showBottom: boolean;
  showRight: boolean;
  rightTab: string;
}): WorkspaceLayoutPresetId | null {
  if (!state.showNav && state.showBottom && !state.showRight) return 'focus';
  if (state.showNav && state.showBottom && state.showRight && state.rightTab === 'inspector') return 'edit';
  if (!state.showNav && state.showBottom && state.showRight && state.rightTab === 'agent') return 'collab';
  return null;
}
