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
        name: '千问 Qwen-Image 2.0 Pro · 图像生成',
        modelId: 'qwen-image-2.0-pro',
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
      image: 'qwen-image-2.0-pro',
      video: 'wan2.6-t2v',
      speech: 'qwen3-tts-flash',
      transcription: 'qwen3-asr-flash',
    },
  },
};

export interface CuratedModelOption {
  modelId: string;
  name: string;
  adapter: ModelAdapter;
  capabilities: ModelUse[];
  parameters?: Record<string, string | number | boolean>;
}

export const curatedModelsByProtocol: Record<ProviderConnection['protocol'], CuratedModelOption[]> = {
  dashscope: [
    { modelId: 'qwen-image-2.0-pro', name: '千问 Qwen-Image 2.0 Pro', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-2.0', name: '千问 Qwen-Image 2.0', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-max', name: '千问 Qwen-Image Max', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-plus', name: '千问 Qwen-Image Plus', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'wan2.6-t2i', name: '通义万相 Wan 2.6 · 生图', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'wanx2.1-t2i-turbo', name: '通义万相 2.1 Turbo · 生图', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'wan2.6-t2v', name: '通义万相 Wan 2.6 · 文生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, prompt_extend: true } },
    { modelId: 'wan2.6-i2v', name: '通义万相 Wan 2.6 · 图生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, prompt_extend: true } },
    { modelId: 'wan2.5-t2v-preview', name: '通义万相 Wan 2.5 · 文生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5 } },
    { modelId: 'qwen3-tts-flash', name: '千问 Qwen3-TTS Flash · 配音', adapter: 'dashscope-speech', capabilities: ['speech'], parameters: { voice: 'Cherry', language_type: 'Chinese' } },
    { modelId: 'qwen3-asr-flash', name: '千问 Qwen3-ASR Flash · 转录', adapter: 'dashscope-transcription', capabilities: ['transcription'], parameters: { language: 'zh' } },
    { modelId: 'qwen3.5-plus', name: '千问 Qwen3.5 Plus · 编排与视觉', adapter: 'chat', capabilities: ['agent', 'vision'] },
    { modelId: 'qwen3-max', name: '千问 Qwen3 Max · 深度编排', adapter: 'chat', capabilities: ['agent'] },
    { modelId: 'qwen-vl-max', name: '千问 Qwen-VL Max · 视觉理解', adapter: 'chat', capabilities: ['agent', 'vision'] },
  ],
  openai: [
    { modelId: 'gpt-5.4', name: 'GPT-5.4 · 编排与视觉', adapter: 'chat', capabilities: ['agent', 'vision'] },
    { modelId: 'gpt-4.1', name: 'GPT-4.1 · 编排与视觉', adapter: 'chat', capabilities: ['agent', 'vision'] },
    { modelId: 'deepseek-chat', name: 'DeepSeek Chat', adapter: 'chat', capabilities: ['agent'] },
    { modelId: 'deepseek-reasoner', name: 'DeepSeek Reasoner', adapter: 'chat', capabilities: ['agent'] },
    { modelId: 'gpt-image-1', name: 'GPT Image 1 · 图像生成', adapter: 'openai-image', capabilities: ['image'], parameters: { size: '1536x1024' } },
    { modelId: 'dall-e-3', name: 'DALL·E 3 · 图像生成', adapter: 'openai-image', capabilities: ['image'], parameters: { size: '1792x1024' } },
    { modelId: 'gpt-4o-mini-tts', name: 'GPT-4o Mini TTS · 配音', adapter: 'openai-speech', capabilities: ['speech'] },
    { modelId: 'gpt-4o-transcribe', name: 'GPT-4o Transcribe · 转录', adapter: 'openai-transcription', capabilities: ['transcription'] },
    { modelId: 'whisper-1', name: 'Whisper-1 · 转录', adapter: 'openai-transcription', capabilities: ['transcription'] },
    { modelId: 'sora-2', name: 'Sora 2 · 视频生成', adapter: 'openai-video', capabilities: ['video'], parameters: { size: '1280x720', seconds: 5 } },
  ],
  anthropic: [
    { modelId: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 · 编排与视觉', adapter: 'chat', capabilities: ['agent', 'vision'] },
    { modelId: 'claude-opus-4-1', name: 'Claude Opus 4.1 · 深度编排', adapter: 'chat', capabilities: ['agent', 'vision'] },
  ],
  google: [
    { modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro · 编排与视觉', adapter: 'chat', capabilities: ['agent', 'vision'] },
    { modelId: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash · 极速编排', adapter: 'chat', capabilities: ['agent', 'vision'] },
  ],
  ark: [
    { modelId: 'doubao-seed-1-6', name: '豆包 Seed 1.6 · 编排与视觉', adapter: 'chat', capabilities: ['agent', 'vision'] },
    { modelId: 'doubao-seedream-3-0-t2i', name: '豆包 Seedream 3.0 · 生图', adapter: 'ark-image', capabilities: ['image'] },
    { modelId: 'doubao-seedance-1-0-pro', name: '豆包 Seedance 1.0 Pro · 视频', adapter: 'ark-video', capabilities: ['video'], parameters: { resolution: '720p', ratio: '16:9', duration: 5 } },
  ],
  system: [],
};

export function suggestedModelsFor(
  protocol?: ProviderConnection['protocol'],
  adapter?: ModelAdapter,
): CuratedModelOption[] {
  if (!protocol) return [];
  const list = curatedModelsByProtocol[protocol] || [];
  if (!adapter) return list;
  const matched = list.filter((m) => m.adapter === adapter);
  return matched.length ? matched : list;
}

export function inferModelFromId(
  rawId: string,
  protocol: ProviderConnection['protocol'] = 'openai',
): Omit<ModelDefinition, 'id' | 'providerId'> {
  const id = rawId.trim();
  const curated = (curatedModelsByProtocol[protocol] || []).find(
    (m) => m.modelId.toLowerCase() === id.toLowerCase(),
  );
  if (curated) {
    return {
      name: curated.name,
      modelId: curated.modelId,
      adapter: curated.adapter,
      capabilities: [...curated.capabilities],
      parameters: { ...(curated.parameters || {}) },
    };
  }
  const lower = id.toLowerCase();
  if (protocol === 'dashscope') {
    if (/(qwen-image|wanx|t2i|i2i|flux|stable-diffusion)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720' } };
    }
    if (/(wan\d|t2v|i2v|video)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5 } };
    }
    if (/(tts|cosyvoice|sambert)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'dashscope-speech', capabilities: ['speech'], parameters: { voice: 'Cherry', language_type: 'Chinese' } };
    }
    if (/(asr|paraformer|sensevoice)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'dashscope-transcription', capabilities: ['transcription'], parameters: { language: 'zh' } };
    }
  } else if (protocol === 'ark') {
    if (/(seedream|image|t2i)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'ark-image', capabilities: ['image'], parameters: {} };
    }
    if (/(seedance|video|t2v|i2v)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'ark-video', capabilities: ['video'], parameters: { resolution: '720p', ratio: '16:9', duration: 5 } };
    }
  } else if (protocol === 'openai') {
    if (/(gpt-image|dall-e|image|flux)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'openai-image', capabilities: ['image'], parameters: { size: '1024x1024' } };
    }
    if (/(tts|speech)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'openai-speech', capabilities: ['speech'], parameters: {} };
    }
    if (/(whisper|transcribe)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'openai-transcription', capabilities: ['transcription'], parameters: {} };
    }
    if (/(sora|video)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'openai-video', capabilities: ['video'], parameters: {} };
    }
  }
  const hasVision = /(vl|vision|4o|4\.1|5\.|gemini|claude|seed-1)/i.test(lower);
  return {
    name: id || '新模型',
    modelId: id,
    adapter: 'chat',
    capabilities: hasVision ? ['agent', 'vision'] : ['agent'],
    parameters: {},
  };
}

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
