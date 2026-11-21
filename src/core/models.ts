import type { ModelAdapter, ModelDefinition, ModelUse, ProviderConnection, Settings } from './types';

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
  { id: 'dashscope-image', name: '阿里百炼 / 千问 · 图像生成 (Qwen-Image / 万相)', uses: ['image'] },
  { id: 'dashscope-video', name: '阿里百炼 / 万相 · 视频生成 (Wan T2V / I2V)', uses: ['video'] },
  { id: 'dashscope-speech', name: '阿里百炼 / 千问 · 语音合成 (Qwen-TTS)', uses: ['speech'] },
  { id: 'dashscope-transcription', name: '阿里百炼 / 千问 · 语音识别 (Qwen-ASR)', uses: ['transcription'] },
  { id: 'openai-image', name: 'OpenAI Images', uses: ['image'] },
  { id: 'ark-image', name: '火山方舟 Images', uses: ['image'] },
  { id: 'openai-speech', name: 'OpenAI Audio · 配音', uses: ['speech'] },
  { id: 'openai-transcription', name: 'OpenAI Audio · 转录', uses: ['transcription'] },
  { id: 'openai-video', name: 'Videos 兼容接口 · 自定义服务', uses: ['video'] },
  { id: 'ark-video', name: '火山方舟 Videos', uses: ['video'] },
  { id: 'system-speech', name: 'macOS 本地语音', uses: ['speech'] },
];

export const DASHSCOPE_VOICES = ['Cherry', 'Serena', 'Ethan', 'Chelsie'];

export const providerPresets: Omit<ProviderConnection, 'id' | 'hasApiKey'>[] = [
  { name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', requiresKey: true },
  { name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', requiresKey: true },
  {
    name: '阿里百炼 / 千问 (DashScope)',
    protocol: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    requiresKey: true,
  },
  {
    name: '千问 AI 平台 (Qianwen MaaS)',
    protocol: 'dashscope',
    baseUrl: 'https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1',
    requiresKey: true,
  },
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
  { name: '本地模型', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', requiresKey: false },
  { name: '自定义连接', protocol: 'openai', baseUrl: '', requiresKey: true },
];

/** Extensible curated suites per provider protocol — adding new cloud ecosystems only appends entries here. */
export const providerModelSuites: Partial<
  Record<
    ProviderConnection['protocol'],
    {
      label: string;
      models: Omit<ModelDefinition, 'id' | 'providerId'>[];
      defaultRoles: Partial<Record<ModelUse, string>>;
    }
  >
> = {
  dashscope: {
    label: '一键添加推荐全模态模型 (6 项)',
    models: [
      {
        name: '千问 Qwen3.5 Plus · 编排与视觉',
        modelId: 'qwen3.5-plus',
        capabilities: ['agent', 'vision'],
        adapter: 'chat',
        parameters: {},
      },
      {
        name: '千问 Qwen-Image Plus · 图像生成',
        modelId: 'qwen-image-plus',
        capabilities: ['image'],
        adapter: 'dashscope-image',
        parameters: { size: '1280*720', prompt_extend: true, watermark: false },
      },
      {
        name: '通义万相 Wan 2.6 · 文生视频',
        modelId: 'wan2.6-t2v',
        capabilities: ['video'],
        adapter: 'dashscope-video',
        parameters: { resolution: '720P', duration: 5, prompt_extend: true },
      },
      {
        name: '通义万相 Wan 2.6 · 图生视频',
        modelId: 'wan2.6-i2v',
        capabilities: ['video'],
        adapter: 'dashscope-video',
        parameters: { resolution: '720P', duration: 5, prompt_extend: true },
      },
      {
        name: '千问 Qwen3-TTS Flash · 配音',
        modelId: 'qwen3-tts-flash',
        capabilities: ['speech'],
        adapter: 'dashscope-speech',
        parameters: { voice: 'Cherry', language_type: 'Chinese' },
      },
      {
        name: '千问 Qwen3-ASR Flash · 语音转录',
        modelId: 'qwen3-asr-flash',
        capabilities: ['transcription'],
        adapter: 'dashscope-transcription',
        parameters: { language: 'zh' },
      },
    ],
    defaultRoles: {
      agent: 'qwen3.5-plus',
      vision: 'qwen3.5-plus',
      image: 'qwen-image-plus',
      video: 'wan2.6-t2v',
      speech: 'qwen3-tts-flash',
      transcription: 'qwen3-asr-flash',
    },
  },
};

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

export function dashscopeEndpoints(baseUrl: string) {
  const normalized = normalizeProviderUrl(baseUrl);
  const root = normalized
    .replace(/\/compatible-mode\/v1$/i, '')
    .replace(/\/compatible-v1$/i, '')
    .replace(/\/api\/v1$/i, '')
    .replace(/\/v1$/i, '');
  return {
    root,
    nativeBase: `${root}/api/v1`,
    compatBase: `${root}/compatible-mode/v1`,
  };
}

export function compatibleAdapters(provider?: ProviderConnection) {
  const protocol = provider?.protocol;
  return adapters.filter((a) => {
    if (protocol === 'system') return a.id === 'system-speech';
    if (!protocol || a.id === 'system-speech') return false;
    if (a.id === 'chat') return true;
    if (protocol === 'dashscope') return a.id.startsWith('dashscope-') || a.id === 'openai-image';
    if (protocol === 'ark') return a.id === 'ark-image' || a.id === 'ark-video';
    return protocol === 'openai' && a.id.startsWith('openai-');
  });
}
