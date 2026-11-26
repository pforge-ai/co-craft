import { providerModelSuites } from './models';
import { uid } from './project';
import type { ModelDefinition, ModelUse, ProviderConnection, Settings } from './types';

export type QuickstartProfileId = 'dashscope' | 'ark' | 'minimax' | 'deepseek' | 'openai' | 'local';

export interface QuickstartProfile {
  id: QuickstartProfileId;
  name: string;
  badge: string;
  tagline: string;
  protocol: ProviderConnection['protocol'];
  defaultBaseUrl: string;
  requiresKey: boolean;
  keyPlaceholder: string;
  keyHint: string;
  capabilitiesSummary: string[];
  models: Omit<ModelDefinition, 'id' | 'providerId'>[];
  defaultRoles: Partial<Record<ModelUse, string>>;
  editableModelId?: boolean;
}

const dashscopeSuite = providerModelSuites.dashscope!;
const arkSuite = providerModelSuites.ark!;
const minimaxSuite = providerModelSuites.minimax!;

export const QUICKSTART_PROFILES: QuickstartProfile[] = [
  {
    id: 'dashscope',
    name: '阿里百炼 / 千问',
    badge: '推荐 · 全模态一站配齐',
    tagline: '一个 Key 同时打通对话编排、视觉、生图、万相/快乐马视频、配音与转录',
    protocol: 'dashscope',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    requiresKey: true,
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
    keyHint: '在阿里云百炼控制台获取 API Key（支持中国内地默认接入点）',
    capabilitiesSummary: ['编排', '视觉', '生图', '视频', '配音', '转录'],
    models: dashscopeSuite.models,
    defaultRoles: dashscopeSuite.defaultRoles,
  },
  {
    id: 'ark',
    name: '火山方舟 · 豆包',
    badge: 'Seedream + Seedance',
    tagline: '旗舰多图透明底生图与音画同步视频生成，适合漫剧与高质感视觉短片',
    protocol: 'ark',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    requiresKey: true,
    keyPlaceholder: '输入火山方舟 API Key',
    keyHint: '需在方舟控制台开通对应豆包 / Seedream / Seedance 推理模型',
    capabilitiesSummary: ['编排', '视觉', '生图', '视频'],
    models: arkSuite.models,
    defaultRoles: arkSuite.defaultRoles,
  },
  {
    id: 'minimax',
    name: 'MiniMax 开放平台',
    badge: '海螺视频 + 情感配音',
    tagline: '高动态运镜视频（H3 / Hailuo 2.3）与极具表现力的中文情感语音合成',
    protocol: 'minimax',
    defaultBaseUrl: 'https://api.minimaxi.com',
    requiresKey: true,
    keyPlaceholder: '输入 MiniMax API Key',
    keyHint: '默认中国内地接口 api.minimaxi.com，国际版可展开地址改为 api.minimax.io',
    capabilitiesSummary: ['编排', '生图', '视频', '配音'],
    models: minimaxSuite.models,
    defaultRoles: minimaxSuite.defaultRoles,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    badge: '轻量 · 编码与剪辑大脑',
    tagline: '高性价比编排、拆镜与 TSX 动态图形编码，搭配本地免费配音与 L1 引擎',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    requiresKey: true,
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
    keyHint: '适合专注可编程科普动画、字幕精剪与 3D 导演棚的用户',
    capabilitiesSummary: ['编排', '编码', '深度思考'],
    models: [
      {
        name: 'DeepSeek Chat · 剪辑与编码',
        modelId: 'deepseek-chat',
        capabilities: ['agent'],
        adapter: 'chat',
        parameters: {},
      },
      {
        name: 'DeepSeek Reasoner · 深度推理',
        modelId: 'deepseek-reasoner',
        capabilities: ['agent'],
        adapter: 'chat',
        parameters: {},
      },
    ],
    defaultRoles: {
      agent: 'deepseek-chat',
    },
  },
  {
    id: 'openai',
    name: 'OpenAI 官方',
    badge: '国际通用',
    tagline: 'GPT-5.4 编排视觉 + GPT Image 生图 + 语音合成与高精度转录',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    keyPlaceholder: 'sk-proj-xxxxxxxxxxxxxxxx',
    keyHint: '使用兼容代理网关时，可展开下方自定义接口地址',
    capabilitiesSummary: ['编排', '视觉', '生图', '配音', '转录'],
    models: [
      {
        name: 'GPT-5.4 · 编排与视觉',
        modelId: 'gpt-5.4',
        capabilities: ['agent', 'vision'],
        adapter: 'chat',
        parameters: {},
      },
      {
        name: 'GPT Image 1.5 · 图像生成',
        modelId: 'gpt-image-1.5',
        capabilities: ['image'],
        adapter: 'openai-image',
        parameters: { size: '1536x1024' },
      },
      {
        name: 'GPT-4o Mini TTS · 配音',
        modelId: 'gpt-4o-mini-tts',
        capabilities: ['speech'],
        adapter: 'openai-speech',
        parameters: { voice: 'alloy' },
      },
      {
        name: 'GPT-4o Mini Transcribe · 转录',
        modelId: 'gpt-4o-mini-transcribe',
        capabilities: ['transcription'],
        adapter: 'openai-transcription',
        parameters: {},
      },
    ],
    defaultRoles: {
      agent: 'gpt-5.4',
      vision: 'gpt-5.4',
      image: 'gpt-image-1.5',
      speech: 'gpt-4o-mini-tts',
      transcription: 'gpt-4o-mini-transcribe',
    },
  },
  {
    id: 'local',
    name: '本地模型 (Ollama / LM Studio)',
    badge: '免密钥 · 纯离线',
    tagline: '连接本机 OpenAI 兼容端点，零外网隐私运行 Agent 编排与代码生成',
    protocol: 'openai',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    requiresKey: false,
    keyPlaceholder: '本地端点通常无需填写',
    keyHint: '请先在本机启动 Ollama 或 LM Studio 并加载对应模型',
    capabilitiesSummary: ['本地编排', '隐私离线'],
    editableModelId: true,
    models: [
      {
        name: '本地模型 · 编排与编码',
        modelId: 'qwen2.5:14b',
        capabilities: ['agent'],
        adapter: 'chat',
        parameters: {},
      },
    ],
    defaultRoles: {
      agent: 'qwen2.5:14b',
    },
  },
];

export function normalizeBaseUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function findMatchingProvider(
  settings: Settings,
  profile: QuickstartProfile,
  baseUrl?: string,
): ProviderConnection | undefined {
  const targetUrl = normalizeBaseUrl(baseUrl || profile.defaultBaseUrl).toLowerCase();
  return settings.providers.find(
    (p) =>
      p.protocol === profile.protocol &&
      normalizeBaseUrl(p.baseUrl).toLowerCase() === targetUrl,
  );
}

export interface QuickstartApplyInput {
  profileId: QuickstartProfileId;
  apiKey?: string;
  baseUrl?: string;
  customModelId?: string;
  overwriteDefaults?: boolean;
}

export interface QuickstartApplyResult {
  nextSettings: Settings;
  provider: ProviderConnection;
  reusedProvider: boolean;
  addedModelCount: number;
  assignedUses: ModelUse[];
}

export function applyQuickstartProfile(
  current: Settings,
  input: QuickstartApplyInput,
): QuickstartApplyResult {
  const profile = QUICKSTART_PROFILES.find((p) => p.id === input.profileId);
  if (!profile) throw new Error('未知快速配置方案');

  const trimmedUrl = normalizeBaseUrl(input.baseUrl || profile.defaultBaseUrl);
  if (!trimmedUrl) throw new Error('请填写有效的接口地址');
  const trimmedKey = String(input.apiKey || '').trim();

  const next = structuredClone(current);
  const existingProvider = findMatchingProvider(next, profile, trimmedUrl);
  const reusedProvider = Boolean(existingProvider);

  let provider: ProviderConnection;
  if (existingProvider) {
    provider = existingProvider;
    provider.baseUrl = trimmedUrl;
    provider.requiresKey = profile.requiresKey;
    if (trimmedKey) provider.apiKey = trimmedKey;
  } else {
    provider = {
      id: uid('provider'),
      name: profile.name,
      protocol: profile.protocol,
      baseUrl: trimmedUrl,
      requiresKey: profile.requiresKey,
      hasApiKey: false,
      ...(trimmedKey ? { apiKey: trimmedKey } : {}),
    };
    next.providers.push(provider);
  }

  if (profile.requiresKey && !trimmedKey && !provider.hasApiKey && !provider.apiKey) {
    throw new Error(`请填写 ${profile.name} 的 API Key`);
  }

  const modelsToEnsure = profile.models.map((m, idx) => {
    if (profile.editableModelId && idx === 0 && input.customModelId?.trim()) {
      const cid = input.customModelId.trim();
      return { ...m, modelId: cid, name: `${cid} · 本地编排` };
    }
    return m;
  });

  const existingByModelId = new Map<string, ModelDefinition>();
  for (const m of next.models) {
    if (m.providerId === provider.id) existingByModelId.set(m.modelId, m);
  }

  let addedModelCount = 0;
  for (const tpl of modelsToEnsure) {
    if (!existingByModelId.has(tpl.modelId)) {
      const created: ModelDefinition = {
        id: uid('model'),
        providerId: provider.id,
        name: tpl.name,
        modelId: tpl.modelId,
        capabilities: [...tpl.capabilities],
        adapter: tpl.adapter,
        parameters: { ...tpl.parameters },
      };
      next.models.push(created);
      existingByModelId.set(tpl.modelId, created);
      addedModelCount++;
    }
  }

  const assignedUses: ModelUse[] = [];
  const defaultRoles: Partial<Record<ModelUse, string>> = { ...profile.defaultRoles };
  if (profile.editableModelId && input.customModelId?.trim()) {
    defaultRoles.agent = input.customModelId.trim();
  }

  const overwrite = input.overwriteDefaults !== false;
  for (const [use, mId] of Object.entries(defaultRoles) as [ModelUse, string][]) {
    const target = existingByModelId.get(mId);
    if (!target) continue;
    const prevId = next.defaults[use];
    const shouldAssign =
      overwrite || !prevId || (use === 'speech' && prevId === 'system-speech');
    if (shouldAssign) {
      next.defaults[use] = target.id;
      assignedUses.push(use);
    }
  }

  return {
    nextSettings: next,
    provider,
    reusedProvider,
    addedModelCount,
    assignedUses,
  };
}
