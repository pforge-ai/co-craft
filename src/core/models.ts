import type { ModelAdapter, ModelUse, ProviderConnection, Settings } from './types';

export const modelUses: { id: ModelUse; name: string; description: string }[] = [
  { id: 'agent', name: '剪辑与编排', description: '理解需求、编写画面、调用工具并修改工程' },
  { id: 'vision', name: '画面理解', description: '分析镜头、参考图与生成结果' },
  { id: 'transcription', name: '语音转录', description: '识别语音，生成带时间的文稿与字幕' },
  { id: 'speech', name: '配音', description: '将文稿转换成声音' },
  { id: 'image', name: '图像生成', description: '创作背景、分镜和补充画面' },
  { id: 'video', name: '视频生成', description: '生成视频镜头，跟踪云端作业' },
];
export const adapters: { id: ModelAdapter; name: string; uses: ModelUse[] }[] = [
  { id: 'chat', name: '对话 / 多模态', uses: ['agent', 'vision'] },
  { id: 'openai-image', name: 'OpenAI Images', uses: ['image'] },
  { id: 'ark-image', name: '火山方舟 Images', uses: ['image'] },
  { id: 'openai-speech', name: 'OpenAI Audio · 配音', uses: ['speech'] },
  { id: 'openai-transcription', name: 'OpenAI Audio · 转录', uses: ['transcription'] },
  { id: 'openai-video', name: 'Videos 兼容接口 · 自定义服务', uses: ['video'] },
  { id: 'ark-video', name: '火山方舟 Videos', uses: ['video'] },
  { id: 'system-speech', name: 'macOS 本地语音', uses: ['speech'] },
];
export const providerPresets: Omit<ProviderConnection, 'id' | 'hasApiKey'>[] = [
  { name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', requiresKey: true },
  { name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', requiresKey: true },
  { name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', requiresKey: true },
  {
    name: 'Google AI',
    protocol: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresKey: true,
  },
  {
    name: '火山方舟',
    protocol: 'ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    requiresKey: true,
  },
  { name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', requiresKey: true },
  {
    name: '阿里百炼 · 兼容接口',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    requiresKey: true,
  },
  { name: '本地模型', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', requiresKey: false },
  { name: '自定义连接', protocol: 'openai', baseUrl: '', requiresKey: true },
];
export const localProvider: ProviderConnection = {
  id: 'system',
  name: '本机',
  protocol: 'system',
  baseUrl: '',
  hasApiKey: false,
  requiresKey: false,
};
export const localSpeech = {
  id: 'system-speech',
  providerId: 'system',
  name: '系统中文语音',
  modelId: 'system',
  capabilities: ['speech'] as ModelUse[],
  adapter: 'system-speech' as ModelAdapter,
  parameters: { rate: 175 },
};
export function selectedModel(
  settings: Settings,
  use: ModelUse,
  overrides?: Partial<Record<ModelUse, string>>,
) {
  const compatible = (id?: string) =>
    settings.models.find((m) => m.id === id && m.capabilities.includes(use));
  return compatible(overrides?.[use]) || compatible(settings.defaults[use]);
}

export function normalizeProviderUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('请输入完整的 HTTP 或 HTTPS 服务地址');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('服务地址仅包含域名和路径，密钥请填入 API Key 字段');
  return url.href.replace(/\/+$/, '');
}

export function compatibleAdapters(provider?: ProviderConnection) {
  const protocol = provider?.protocol;
  return adapters.filter((a) => {
    if (protocol === 'system') return a.id === 'system-speech';
    if (!protocol || a.id === 'system-speech') return false;
    if (a.id === 'chat') return true;
    if (protocol === 'ark') return a.id === 'ark-image' || a.id === 'ark-video';
    return protocol === 'openai' && a.id.startsWith('openai-');
  });
}
