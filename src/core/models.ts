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
  { id: 'dashscope-image', name: '阿里百炼 / 千问 · 图像生成 (Qwen-Image / 万相 / Z-Image / 可灵)', uses: ['image'] },
  { id: 'dashscope-video', name: '阿里百炼 / 千问 · 视频生成 (Wan 3.0 / 2.7 / HappyHorse / 可灵)', uses: ['video'] },
  { id: 'dashscope-speech', name: '阿里百炼 / 千问 · 语音合成 (Qwen-TTS)', uses: ['speech'] },
  { id: 'dashscope-transcription', name: '阿里百炼 / 千问 · 语音识别 (Qwen-ASR)', uses: ['transcription'] },
  { id: 'ark-image', name: '火山方舟 · Seedream 图像生成', uses: ['image'] },
  { id: 'ark-video', name: '火山方舟 · Seedance 视频生成', uses: ['video'] },
  { id: 'minimax-image', name: 'MiniMax · 图像生成 (H3-Image / image-01)', uses: ['image'] },
  { id: 'minimax-video', name: 'MiniMax · 视频生成 (H3 / 海螺 Hailuo)', uses: ['video'] },
  { id: 'minimax-speech', name: 'MiniMax · 语音合成 (Speech 2.8 / 2.6)', uses: ['speech'] },
  { id: 'openai-image', name: 'OpenAI Images', uses: ['image'] },
  { id: 'openai-speech', name: 'OpenAI Audio · 配音', uses: ['speech'] },
  { id: 'openai-transcription', name: 'OpenAI Audio · 转录', uses: ['transcription'] },
  { id: 'openai-video', name: 'Videos 兼容接口 · 自定义服务', uses: ['video'] },
  { id: 'system-speech', name: 'macOS 本地语音', uses: ['speech'] },
];

export const DASHSCOPE_VOICES = ['Cherry', 'Serena', 'Ethan', 'Chelsie'];
export const MINIMAX_VOICES = [
  'male-qn-qingse',
  'female-shaonv',
  'female-yujie',
  'presenter_male',
  'presenter_female',
  'audiobook_male_1',
  'audiobook_female_1',
];

export const providerPresets: Omit<ProviderConnection, 'id' | 'hasApiKey'>[] = [
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
  {
    name: '火山方舟 (Seedream / Seedance)',
    protocol: 'ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    requiresKey: true,
  },
  {
    name: 'MiniMax 开放平台 (国内)',
    protocol: 'minimax',
    baseUrl: 'https://api.minimaxi.com',
    requiresKey: true,
  },
  {
    name: 'MiniMax Global (国际)',
    protocol: 'minimax',
    baseUrl: 'https://api.minimax.io',
    requiresKey: true,
  },
  { name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', requiresKey: true },
  { name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', requiresKey: true },
  { name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', requiresKey: true },
  {
    name: 'Google AI',
    protocol: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
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
    label: '一键添加百炼推荐全模态套件 (9 项)',
    models: [
      {
        name: '千问 Qwen3.5 Plus · 编排与视觉',
        modelId: 'qwen3.5-plus',
        capabilities: ['agent', 'vision'],
        adapter: 'chat',
        parameters: {},
      },
      {
        name: '千问 Qwen-Image 3.0 Pro · 旗舰生图与修图',
        modelId: 'qwen-image-3.0-pro',
        capabilities: ['image'],
        adapter: 'dashscope-image',
        parameters: { size: '1280*720', prompt_extend: true, watermark: false },
      },
      {
        name: '通义万相 Wan 2.7 Pro · 4K 统一生图编辑',
        modelId: 'wan2.7-image-pro',
        capabilities: ['image'],
        adapter: 'dashscope-image',
        parameters: { size: '2K', watermark: false },
      },
      {
        name: 'Z-Image Turbo · 极速写实生图',
        modelId: 'z-image-turbo',
        capabilities: ['image'],
        adapter: 'dashscope-image',
        parameters: { size: '1280*720', prompt_extend: true },
      },
      {
        name: '通义万相 Wan 2.7 · 文生视频',
        modelId: 'wan2.7-t2v',
        capabilities: ['video'],
        adapter: 'dashscope-video',
        parameters: { resolution: '720P', ratio: '16:9', duration: 5, prompt_extend: true, watermark: false },
      },
      {
        name: '通义万相 Wan 2.7 · 首尾帧图生视频',
        modelId: 'wan2.7-i2v',
        capabilities: ['video'],
        adapter: 'dashscope-video',
        parameters: { resolution: '720P', duration: 5, prompt_extend: true, watermark: false },
      },
      {
        name: '快乐马 HappyHorse 1.1 · 文生视频',
        modelId: 'happyhorse-1.1-t2v',
        capabilities: ['video'],
        adapter: 'dashscope-video',
        parameters: { resolution: '720P', ratio: '16:9', duration: 5, watermark: false },
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
      image: 'qwen-image-3.0-pro',
      video: 'wan2.7-t2v',
      speech: 'qwen3-tts-flash',
      transcription: 'qwen3-asr-flash',
    },
  },
  ark: {
    label: '一键添加方舟 Seedream / Seedance 套件 (5 项)',
    models: [
      {
        name: '豆包 Seed 1.6 · 编排与视觉',
        modelId: 'doubao-seed-1-6',
        capabilities: ['agent', 'vision'],
        adapter: 'chat',
        parameters: {},
      },
      {
        name: 'Seedream 5.5 · 旗舰生图（多图/透明底）',
        modelId: 'doubao-seedream-5-5-261028',
        capabilities: ['image'],
        adapter: 'ark-image',
        parameters: { size: '2K', watermark: false },
      },
      {
        name: 'Seedream 5.0 Pro · 高清生图',
        modelId: 'doubao-seedream-5-0-pro-260628',
        capabilities: ['image'],
        adapter: 'ark-image',
        parameters: { size: '2K', watermark: false },
      },
      {
        name: 'Seedance 2.5 · 旗舰视频（长时序/音画同步）',
        modelId: 'doubao-seedance-2-5',
        capabilities: ['video'],
        adapter: 'ark-video',
        parameters: { resolution: '720p', ratio: '16:9', duration: 5, generate_audio: true, watermark: false },
      },
      {
        name: 'Seedance 2.0 · 电影级视频',
        modelId: 'doubao-seedance-2-0-260128',
        capabilities: ['video'],
        adapter: 'ark-video',
        parameters: { resolution: '720p', ratio: '16:9', duration: 5, generate_audio: true, watermark: false },
      },
    ],
    defaultRoles: {
      agent: 'doubao-seed-1-6',
      vision: 'doubao-seed-1-6',
      image: 'doubao-seedream-5-5-261028',
      video: 'doubao-seedance-2-5',
    },
  },
  minimax: {
    label: '一键添加 MiniMax 全模态套件 (5 项)',
    models: [
      {
        name: 'MiniMax M2.5 · 编排对话',
        modelId: 'MiniMax-M2.5',
        capabilities: ['agent'],
        adapter: 'chat',
        parameters: {},
      },
      {
        name: 'MiniMax H3-Image · 旗舰生图与多图编辑',
        modelId: 'MiniMax-H3-Image',
        capabilities: ['image'],
        adapter: 'minimax-image',
        parameters: { size: '2048x1152' },
      },
      {
        name: 'MiniMax H3 · 2K 立体声全能视频',
        modelId: 'MiniMax-H3',
        capabilities: ['video'],
        adapter: 'minimax-video',
        parameters: { resolution: '1080P', ratio: '16:9', duration: 6, generate_audio: true },
      },
      {
        name: '海螺 Hailuo 2.3 · 高动态运镜视频',
        modelId: 'MiniMax-Hailuo-2.3',
        capabilities: ['video'],
        adapter: 'minimax-video',
        parameters: { resolution: '1080P', duration: 6, prompt_optimizer: true },
      },
      {
        name: 'MiniMax Speech 2.8 HD · 情感配音',
        modelId: 'speech-2.8-hd',
        capabilities: ['speech'],
        adapter: 'minimax-speech',
        parameters: { voice: 'male-qn-qingse', speed: 1 },
      },
    ],
    defaultRoles: {
      agent: 'MiniMax-M2.5',
      image: 'MiniMax-H3-Image',
      video: 'MiniMax-H3',
      speech: 'speech-2.8-hd',
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
    // Image — Qwen-Image 3.0 / 2.1 / 2.0 / Edit, Wan 2.7 / 2.6, Z-Image, Hosted Kling v3
    { modelId: 'qwen-image-3.0-pro', name: '千问 Qwen-Image 3.0 Pro · 复杂排版与精准文字', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-3.0', name: '千问 Qwen-Image 3.0 · 通用生图与修图', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'wan2.7-image-pro', name: '通义万相 Wan 2.7 Pro · 4K 多图编辑', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '2K', watermark: false } },
    { modelId: 'wan2.7-image', name: '通义万相 Wan 2.7 · 统一生图编辑', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '2K', watermark: false } },
    { modelId: 'z-image-turbo', name: 'Z-Image Turbo · 极速高性价比写实生图', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true } },
    { modelId: 'qwen-image-edit-max', name: '千问 Image Edit Max · 自然语言免 Mask 修图', adapter: 'dashscope-image', capabilities: ['image'], parameters: { prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-edit-plus', name: '千问 Image Edit Plus · 快速修图', adapter: 'dashscope-image', capabilities: ['image'], parameters: { prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-2.1-pro', name: '千问 Qwen-Image 2.1 Pro', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-2.1-turbo', name: '千问 Qwen-Image 2.1 Turbo', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-2.0-pro', name: '千问 Qwen-Image 2.0 Pro', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-2.0', name: '千问 Qwen-Image 2.0', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-max', name: '千问 Qwen-Image Max', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'qwen-image-plus', name: '千问 Qwen-Image Plus', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'wan2.6-image', name: '通义万相 Wan 2.6 · 生图与编辑', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'wan2.6-t2i', name: '通义万相 Wan 2.6 · 文生图', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },
    { modelId: 'kling/kling-v3-image-generation', name: '可灵 Kling v3（百炼托管）· 生图', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1344*768', prompt_extend: true } },
    { modelId: 'kling/kling-v3-omni-image-generation', name: '可灵 Kling v3 Omni（百炼托管）· 多图生图', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1344*768', prompt_extend: true } },
    { modelId: 'wanx2.1-t2i-turbo', name: '通义万相 2.1 Turbo · 生图', adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720', prompt_extend: true, watermark: false } },

    // Video — Wan 3.0, Wan 2.7, HappyHorse 1.1 / 1.0, Wan 2.6, Hosted Kling v3
    { modelId: 'wan3.0-video', name: '通义万相 Wan 3.0 · 全能视频（最长 30s + 音频）', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', aspect_ratio: '16:9', duration: 5, audio: true, prompt_extend: true, watermark: false } },
    { modelId: 'wan3.0-video-prime', name: '通义万相 Wan 3.0 Prime · 极速全能视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', aspect_ratio: '16:9', duration: 5, audio: true, prompt_extend: true, watermark: false } },
    { modelId: 'wan2.7-t2v', name: '通义万相 Wan 2.7 · 文生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', ratio: '16:9', duration: 5, prompt_extend: true, watermark: false } },
    { modelId: 'wan2.7-i2v', name: '通义万相 Wan 2.7 · 首尾帧图生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, prompt_extend: true, watermark: false } },
    { modelId: 'wan2.7-r2v', name: '通义万相 Wan 2.7 · 多主体参考视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, prompt_extend: true, watermark: false } },
    { modelId: 'happyhorse-1.1-t2v', name: '快乐马 HappyHorse 1.1 · 文生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', ratio: '16:9', duration: 5, watermark: false } },
    { modelId: 'happyhorse-1.1-i2v', name: '快乐马 HappyHorse 1.1 · 首尾帧图生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, watermark: false } },
    { modelId: 'happyhorse-1.1-r2v', name: '快乐马 HappyHorse 1.1 · 多图参考视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, watermark: false } },
    { modelId: 'happyhorse-1.0-t2v', name: '快乐马 HappyHorse 1.0 · 文生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', ratio: '16:9', duration: 5, watermark: false } },
    { modelId: 'happyhorse-1.0-i2v', name: '快乐马 HappyHorse 1.0 · 图生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, watermark: false } },
    { modelId: 'happyhorse-1.0-r2v', name: '快乐马 HappyHorse 1.0 · 参考视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, watermark: false } },
    { modelId: 'wan2.6-t2v', name: '通义万相 Wan 2.6 · 文生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, prompt_extend: true } },
    { modelId: 'wan2.6-i2v', name: '通义万相 Wan 2.6 · 图生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, prompt_extend: true } },
    { modelId: 'wan2.6-i2v-flash', name: '通义万相 Wan 2.6 Flash · 极速图生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5, prompt_extend: true } },
    { modelId: 'wan2.6-r2v', name: '通义万相 Wan 2.6 · 主体参考视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5 } },
    { modelId: 'wan2.6-r2v-flash', name: '通义万相 Wan 2.6 Flash · 极速参考视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5 } },
    { modelId: 'kling/kling-v3-video-generation', name: '可灵 Kling v3（百炼托管）· 视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { aspect_ratio: '16:9', duration: 5, audio: true, watermark: false } },
    { modelId: 'kling/kling-v3-turbo-video-generation', name: '可灵 Kling v3 Turbo（百炼托管）· 极速视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { aspect_ratio: '16:9', duration: 5, audio: true, watermark: false } },
    { modelId: 'kling/kling-v3-omni-video-generation', name: '可灵 Kling v3 Omni（百炼托管）· 全能参考视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { aspect_ratio: '16:9', duration: 5, audio: true, watermark: false } },
    { modelId: 'wan2.2-kf2v-flash', name: '通义万相 Wan 2.2 · 首尾帧过渡视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5 } },
    { modelId: 'wan2.5-t2v-preview', name: '通义万相 Wan 2.5 · 文生视频', adapter: 'dashscope-video', capabilities: ['video'], parameters: { resolution: '720P', duration: 5 } },

    // Speech, ASR, Chat
    { modelId: 'qwen3-tts-flash', name: '千问 Qwen3-TTS Flash · 配音', adapter: 'dashscope-speech', capabilities: ['speech'], parameters: { voice: 'Cherry', language_type: 'Chinese' } },
    { modelId: 'qwen3-asr-flash', name: '千问 Qwen3-ASR Flash · 转录', adapter: 'dashscope-transcription', capabilities: ['transcription'], parameters: { language: 'zh' } },
    { modelId: 'qwen3.5-plus', name: '千问 Qwen3.5 Plus · 编排与视觉', adapter: 'chat', capabilities: ['agent', 'vision'] },
    { modelId: 'qwen3-max', name: '千问 Qwen3 Max · 深度编排', adapter: 'chat', capabilities: ['agent'] },
    { modelId: 'qwen-vl-max', name: '千问 Qwen-VL Max · 视觉理解', adapter: 'chat', capabilities: ['agent', 'vision'] },
  ],
  ark: [
    { modelId: 'doubao-seed-1-6', name: '豆包 Seed 1.6 · 编排与视觉', adapter: 'chat', capabilities: ['agent', 'vision'] },
    { modelId: 'doubao-seedream-5-5-261028', name: 'Seedream 5.5 · 旗舰生图（多图/透明底）', adapter: 'ark-image', capabilities: ['image'], parameters: { size: '2K', watermark: false } },
    { modelId: 'doubao-seedream-5-0-pro-260628', name: 'Seedream 5.0 Pro · 专业生图', adapter: 'ark-image', capabilities: ['image'], parameters: { size: '2K', watermark: false } },
    { modelId: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0 Lite · 高速生图', adapter: 'ark-image', capabilities: ['image'], parameters: { size: '2048x2048', watermark: false } },
    { modelId: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5 · 多图融合生图', adapter: 'ark-image', capabilities: ['image'], parameters: { size: '2K', watermark: false } },
    { modelId: 'doubao-seedream-3-0-t2i', name: 'Seedream 3.0 · 经典文生图', adapter: 'ark-image', capabilities: ['image'], parameters: { watermark: false } },
    { modelId: 'doubao-seedance-2-5', name: 'Seedance 2.5 · 旗舰视频（30s/全模态/音频）', adapter: 'ark-video', capabilities: ['video'], parameters: { resolution: '720p', ratio: '16:9', duration: 5, generate_audio: true, watermark: false } },
    { modelId: 'doubao-seedance-2-5-flash', name: 'Seedance 2.5 Flash · 极速旗舰视频', adapter: 'ark-video', capabilities: ['video'], parameters: { resolution: '720p', ratio: '16:9', duration: 5, generate_audio: true, watermark: false } },
    { modelId: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0 · 电影级视频', adapter: 'ark-video', capabilities: ['video'], parameters: { resolution: '720p', ratio: '16:9', duration: 5, generate_audio: true, watermark: false } },
    { modelId: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast · 高速视频', adapter: 'ark-video', capabilities: ['video'], parameters: { resolution: '720p', ratio: '16:9', duration: 5, generate_audio: true, watermark: false } },
    { modelId: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro · 音画同步视频', adapter: 'ark-video', capabilities: ['video'], parameters: { resolution: '720p', ratio: '16:9', duration: 5, generate_audio: true, watermark: false } },
    { modelId: 'doubao-seedance-1-0-pro', name: 'Seedance 1.0 Pro · 经典视频', adapter: 'ark-video', capabilities: ['video'], parameters: { resolution: '720p', ratio: '16:9', duration: 5, watermark: false } },
  ],
  minimax: [
    { modelId: 'MiniMax-M2.5', name: 'MiniMax M2.5 · 编排与推理', adapter: 'chat', capabilities: ['agent'] },
    { modelId: 'MiniMax-M2.7', name: 'MiniMax M2.7 · 新一代编排', adapter: 'chat', capabilities: ['agent'] },
    { modelId: 'MiniMax-H3-Image', name: 'MiniMax H3-Image · 旗舰生图与多图编辑 (4K)', adapter: 'minimax-image', capabilities: ['image'], parameters: { size: '2048x1152' } },
    { modelId: 'MiniMax-H3-Image-Highspeed', name: 'MiniMax H3-Image Highspeed · 极速生图', adapter: 'minimax-image', capabilities: ['image'], parameters: { size: '2048x1152' } },
    { modelId: 'image-01', name: 'MiniMax image-01 · 经典文生图/人物参考', adapter: 'minimax-image', capabilities: ['image'], parameters: { aspect_ratio: '16:9' } },
    { modelId: 'image-01-live', name: 'MiniMax image-01-live · 动漫/手绘风格图', adapter: 'minimax-image', capabilities: ['image'], parameters: { aspect_ratio: '16:9' } },
    { modelId: 'MiniMax-H3', name: 'MiniMax H3 · 2K 立体声全能视频（最长 15s）', adapter: 'minimax-video', capabilities: ['video'], parameters: { resolution: '1080P', ratio: '16:9', duration: 6, generate_audio: true } },
    { modelId: 'MiniMax-Hailuo-2.3', name: '海螺 Hailuo 2.3 · 物理与动态表现视频', adapter: 'minimax-video', capabilities: ['video'], parameters: { resolution: '1080P', duration: 6, prompt_optimizer: true } },
    { modelId: 'MiniMax-Hailuo-2.3-Fast', name: '海螺 Hailuo 2.3 Fast · 极速视频', adapter: 'minimax-video', capabilities: ['video'], parameters: { resolution: '768P', duration: 6, prompt_optimizer: true } },
    { modelId: 'MiniMax-Hailuo-02', name: '海螺 Hailuo 02 · 首尾帧与导演运镜', adapter: 'minimax-video', capabilities: ['video'], parameters: { resolution: '1080P', duration: 6, prompt_optimizer: true } },
    { modelId: 'T2V-01-Director', name: '海螺 T2V-01 Director · 运镜指令文生视频', adapter: 'minimax-video', capabilities: ['video'], parameters: { prompt_optimizer: true } },
    { modelId: 'I2V-01-live', name: '海螺 I2V-01 Live · 2D/插画图生视频', adapter: 'minimax-video', capabilities: ['video'], parameters: { prompt_optimizer: true } },
    { modelId: 'speech-2.8-hd', name: 'MiniMax Speech 2.8 HD · 旗舰情感配音', adapter: 'minimax-speech', capabilities: ['speech'], parameters: { voice: 'male-qn-qingse', speed: 1 } },
    { modelId: 'speech-2.8-turbo', name: 'MiniMax Speech 2.8 Turbo · 低延迟配音', adapter: 'minimax-speech', capabilities: ['speech'], parameters: { voice: 'male-qn-qingse', speed: 1 } },
    { modelId: 'speech-2.6-hd', name: 'MiniMax Speech 2.6 HD · 经典高保真配音', adapter: 'minimax-speech', capabilities: ['speech'], parameters: { voice: 'male-qn-qingse', speed: 1 } },
    { modelId: 'speech-2.6-turbo', name: 'MiniMax Speech 2.6 Turbo · 极速配音', adapter: 'minimax-speech', capabilities: ['speech'], parameters: { voice: 'male-qn-qingse', speed: 1 } },
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
  system: [],
};

export interface ModelInputCapabilities {
  maxReferences: number;
  referenceMode: 'none' | 'image-ref' | 'first-frame' | 'multi-ref' | 'media-flex';
  requiresReference: boolean;
  supportsLastFrame: boolean;
  supportsResolution: boolean;
  resolutions?: string[];
  supportsAspectRatio: boolean;
  aspectRatios?: string[];
  supportsSizeInput: boolean;
  supportsAudioToggle: boolean;
  supportsTransparentBg: boolean;
  durationRange?: [number, number];
  voices?: string[];
  hint?: string;
}

/**
 * Pure declarative capability profile for any configured model (curated or user-entered).
 * Drives both GenerationDialog dynamic controls and backend validation consistently.
 */
export function modelInputCapabilities(
  model?: Pick<ModelDefinition, 'adapter' | 'modelId'>,
): ModelInputCapabilities {
  const base: ModelInputCapabilities = {
    maxReferences: 1,
    referenceMode: 'image-ref',
    requiresReference: false,
    supportsLastFrame: false,
    supportsResolution: false,
    supportsAspectRatio: false,
    supportsSizeInput: true,
    supportsAudioToggle: false,
    supportsTransparentBg: false,
  };
  if (!model) return base;
  const id = (model.modelId || '').toLowerCase();
  const adapter = model.adapter;

  if (adapter === 'dashscope-image') {
    if (/^z-image/i.test(id)) {
      return {
        ...base,
        maxReferences: 0,
        referenceMode: 'none',
        hint: 'Z-Image Turbo 面向极速文生图，支持宽*高像素（如 1280*720 / 1024*1024）',
      };
    }
    if (/^wan2\.7-image/i.test(id)) {
      return {
        ...base,
        maxReferences: 9,
        referenceMode: 'multi-ref',
        supportsResolution: true,
        resolutions: ['1K', '2K', '4K'],
        supportsSizeInput: true,
        hint: 'Wan 2.7 图像支持文生图与最多 9 张参考图一致性编辑（支持 1K/2K/4K）',
      };
    }
    if (/^qwen-image-edit/i.test(id)) {
      return {
        ...base,
        maxReferences: 3,
        referenceMode: 'multi-ref',
        requiresReference: true,
        supportsSizeInput: false,
        hint: 'Qwen-Image-Edit 免 Mask 修图：至少选择 1 张原图（最多 3 张）并描述修改要求',
      };
    }
    if (/^qwen-image-3|^qwen-image-2/i.test(id)) {
      return {
        ...base,
        maxReferences: 3,
        referenceMode: 'multi-ref',
        hint: '支持文生图及最多 3 张参考图编辑与小字多语排版',
      };
    }
    if (/^kling\//i.test(id)) {
      return {
        ...base,
        maxReferences: id.includes('omni') ? 4 : 1,
        referenceMode: id.includes('omni') ? 'multi-ref' : 'image-ref',
        hint: '百炼托管可灵 v3 图像生成（异步任务，完成后自动入库）',
      };
    }
    return {
      ...base,
      maxReferences: /wan2\.6-image|i2i/i.test(id) ? 4 : 1,
      referenceMode: /wan2\.6-image|i2i/i.test(id) ? 'multi-ref' : 'image-ref',
    };
  }

  if (adapter === 'dashscope-video') {
    if (/^wan3\.0/i.test(id)) {
      return {
        ...base,
        maxReferences: 8,
        referenceMode: 'media-flex',
        supportsLastFrame: true,
        supportsResolution: true,
        resolutions: ['480P', '720P', '1080P'],
        supportsAspectRatio: true,
        aspectRatios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'],
        supportsSizeInput: false,
        supportsAudioToggle: true,
        durationRange: [2, 30],
        hint: 'Wan 3.0 全能视频：可纯文生、首尾帧过渡或多图主体参考，原生支持音画同步（2–30s）',
      };
    }
    if (/^(wan2\.7|happyhorse)/i.test(id)) {
      const isR2V = /-r2v/i.test(id);
      const isI2V = /-i2v/i.test(id);
      return {
        ...base,
        maxReferences: isR2V ? 5 : isI2V ? 1 : 0,
        referenceMode: isR2V ? 'multi-ref' : isI2V ? 'first-frame' : 'none',
        requiresReference: isR2V || isI2V,
        supportsLastFrame: isI2V,
        supportsResolution: true,
        resolutions: ['720P', '1080P'],
        supportsAspectRatio: !isI2V,
        aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        supportsSizeInput: false,
        supportsAudioToggle: true,
        durationRange: [2, 15],
        hint: isR2V
          ? '多主体参考生视频：最多选择 5 张参考图，在描述中引用「图1 / 图2」保持主体一致'
          : isI2V
            ? '图生视频：必选首帧图，可选尾帧图控制起止过渡'
            : '文生视频：选择清晰度与画幅比例即可直出',
      };
    }
    if (/^kling\//i.test(id)) {
      const isOmni = id.includes('omni');
      return {
        ...base,
        maxReferences: isOmni ? 4 : 1,
        referenceMode: isOmni ? 'media-flex' : 'first-frame',
        supportsLastFrame: true,
        supportsResolution: false,
        supportsAspectRatio: true,
        aspectRatios: ['16:9', '9:16', '1:1'],
        supportsSizeInput: false,
        supportsAudioToggle: true,
        durationRange: [3, 15],
        hint: '百炼托管可灵 v3 视频生成：支持原生音画同步与首尾帧控制',
      };
    }
    if (/-kf2v/i.test(id)) {
      return {
        ...base,
        maxReferences: 1,
        referenceMode: 'first-frame',
        requiresReference: true,
        supportsLastFrame: true,
        supportsResolution: true,
        resolutions: ['480P', '720P', '1080P'],
        supportsSizeInput: false,
        durationRange: [3, 10],
        hint: '首尾帧过渡模型：选择首帧图与尾帧图生成平滑过渡镜头',
      };
    }
    if (/-r2v/i.test(id)) {
      return {
        ...base,
        maxReferences: 5,
        referenceMode: 'multi-ref',
        requiresReference: true,
        supportsResolution: true,
        resolutions: ['720P', '1080P'],
        supportsSizeInput: true,
        supportsAudioToggle: true,
        durationRange: [3, 10],
        hint: '参考生视频：选择 1–5 张主体参考图，并在描述中使用 character1 等标识',
      };
    }
    const isI2V = /-i2v/i.test(id);
    return {
      ...base,
      maxReferences: isI2V ? 1 : 0,
      referenceMode: isI2V ? 'first-frame' : 'none',
      requiresReference: isI2V,
      supportsResolution: true,
      resolutions: ['480P', '720P', '1080P'],
      supportsSizeInput: true,
      supportsAudioToggle: /wan2\.6/i.test(id),
      durationRange: [3, 10],
    };
  }

  if (adapter === 'ark-image') {
    const isV5 = /seedream-5|seedream-4-5/i.test(id);
    const isV55 = /seedream-5-5|seedream-5\.5/i.test(id);
    return {
      ...base,
      maxReferences: isV5 ? 10 : /seedream-4/i.test(id) ? 4 : 1,
      referenceMode: isV5 ? 'multi-ref' : 'image-ref',
      supportsResolution: isV5,
      resolutions: isV55 ? ['1K', '1.5K', '2K'] : ['1K', '2K'],
      supportsSizeInput: true,
      supportsTransparentBg: /seedream-5/i.test(id),
      hint: isV55
        ? 'Seedream 5.5 支持最多 10 张多图融合与透明背景 PNG（可直接做前景贴片）'
        : isV5
          ? 'Seedream 4.5 / 5.0 支持多图融合与 2K 高清尺寸'
          : '支持文生图与单图参考',
    };
  }

  if (adapter === 'ark-video') {
    const isV2 = /seedance-2|seedance-1-5/i.test(id);
    return {
      ...base,
      maxReferences: /seedance-2/i.test(id) ? 6 : 1,
      referenceMode: /seedance-2/i.test(id) ? 'media-flex' : 'first-frame',
      supportsLastFrame: true,
      supportsResolution: true,
      resolutions: ['480p', '720p', '1080p'],
      supportsAspectRatio: true,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
      supportsSizeInput: false,
      supportsAudioToggle: isV2,
      durationRange: /seedance-2-5|seedance-2\.5/i.test(id) ? [4, 30] : [3, 12],
      hint: /seedance-2/i.test(id)
        ? 'Seedance 2.x 支持首尾帧、多图主体参考与原生音画同步（可在模型 ID 填推理接入点 ep-xxx）'
        : 'Seedance 支持首尾帧控制与画面比例选择',
    };
  }

  if (adapter === 'minimax-image') {
    const isH3 = /h3-image/i.test(id);
    return {
      ...base,
      maxReferences: isH3 ? 16 : 1,
      referenceMode: isH3 ? 'multi-ref' : 'image-ref',
      supportsAspectRatio: true,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      supportsSizeInput: isH3,
      hint: isH3
        ? 'MiniMax H3-Image 支持文生图与 1–16 张参考图多图编辑（最高 4K）'
        : 'MiniMax image-01 支持人物主体参考（选 1 张人像图）与画幅比例',
    };
  }

  if (adapter === 'minimax-video') {
    const isH3 = /minimax-h3/i.test(id);
    const isI2VOnly = /^i2v-/i.test(id);
    const isT2VOnly = /^t2v-/i.test(id);
    return {
      ...base,
      maxReferences: isH3 ? 6 : isT2VOnly ? 0 : 1,
      referenceMode: isH3 ? 'media-flex' : isT2VOnly ? 'none' : 'first-frame',
      requiresReference: isI2VOnly,
      supportsLastFrame: isH3 || /hailuo-(2|02)/i.test(id),
      supportsResolution: true,
      resolutions: isH3 ? ['720P', '1080P', '2K'] : ['768P', '1080P'],
      supportsAspectRatio: isH3,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      supportsSizeInput: false,
      supportsAudioToggle: isH3,
      durationRange: isH3 ? [4, 15] : [6, 10],
      hint: isH3
        ? 'MiniMax H3 支持 2K 原生立体声、首尾帧与多图参考；提示词可写 [Push in] / [Pan right] 等运镜指令'
        : '海螺视频支持首尾帧与运镜指令语法（如 [Push in]、[Pan left]、[Zoom in]）',
    };
  }

  if (adapter === 'openai-image') {
    return {
      ...base,
      maxReferences: 1,
      referenceMode: 'image-ref',
      supportsTransparentBg: /gpt-image/i.test(id),
    };
  }

  if (adapter === 'dashscope-speech') {
    return { ...base, maxReferences: 0, referenceMode: 'none', supportsSizeInput: false, voices: DASHSCOPE_VOICES };
  }
  if (adapter === 'minimax-speech') {
    return {
      ...base,
      maxReferences: 0,
      referenceMode: 'none',
      supportsSizeInput: false,
      voices: MINIMAX_VOICES,
      hint: 'Speech 2.8 支持在文稿中穿插 (laughs) / (sighs) 等自然语气词',
    };
  }

  return base;
}

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
    if (/(qwen-image|z-image|wan2\.7-image|wan2\.6-image|wanx|t2i|i2i|image-generation|reference2image|flux|stable-diffusion)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'dashscope-image', capabilities: ['image'], parameters: { size: '1280*720' } };
    }
    if (/(happyhorse|wan\d|t2v|i2v|r2v|kf2v|video|pixverse|vidu)/i.test(lower)) {
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
      return { name: id, modelId: id, adapter: 'ark-image', capabilities: ['image'], parameters: { size: '2K', watermark: false } };
    }
    if (/(seedance|video|t2v|i2v)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'ark-video', capabilities: ['video'], parameters: { resolution: '720p', ratio: '16:9', duration: 5 } };
    }
  } else if (protocol === 'minimax') {
    if (/(h3-image|image-01|image)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'minimax-image', capabilities: ['image'], parameters: {} };
    }
    if (/(minimax-h3|hailuo|t2v|i2v|s2v|video)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'minimax-video', capabilities: ['video'], parameters: { resolution: '1080P', duration: 6 } };
    }
    if (/(speech|t2a)/i.test(lower)) {
      return { name: id, modelId: id, adapter: 'minimax-speech', capabilities: ['speech'], parameters: { voice: 'male-qn-qingse', speed: 1 } };
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
  const hasVision = /(vl|vision|4o|4\.1|5\.|gemini|claude|seed-1|qwen3\.5)/i.test(lower);
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

export function minimaxEndpoints(baseUrl: string) {
  const normalized = normalizeProviderUrl(baseUrl);
  const root = normalized.replace(/\/v[12]$/i, '');
  return {
    root,
    v1Base: `${root}/v1`,
    v2Base: `${root}/v2`,
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
    if (protocol === 'minimax') return a.id.startsWith('minimax-');
    return protocol === 'openai' && a.id.startsWith('openai-');
  });
}

/**
 * Recommends the best available (preferring connected) model for a given use and input profile
 * (first+last frame video, transparent PNG cutout, multi-ref image/video, or single image ref).
 * Shared consistently by both GenerationDialog and in-canvas CanvasGeneratorNode.
 */
export function recommendModelForInputs(
  settings: Settings,
  use: Exclude<ModelUse, 'agent'>,
  opts: {
    projectDefaults?: Partial<Record<ModelUse, string>>;
    preferredModelId?: string;
    refCount?: number;
    hasLastFrame?: boolean;
    transparentBg?: boolean;
  } = {},
): ModelDefinition | undefined {
  const models = settings.models.filter((m) => m.capabilities.includes(use));
  const defaultModel = selectedModel(settings, use, opts.projectDefaults);
  if (opts.preferredModelId) {
    const explicit = models.find((m) => m.id === opts.preferredModelId);
    if (explicit) return explicit;
  }
  const isConnected = (m: ModelDefinition) => {
    const p = settings.providers.find((x) => x.id === m.providerId);
    return Boolean(p && (p.hasApiKey || !p.requiresKey));
  };
  const defCaps = modelInputCapabilities(defaultModel);
  const refCount = opts.refCount ?? 0;

  if (use === 'image' && opts.transparentBg && !defCaps.supportsTransparentBg) {
    const hit =
      models.find((m) => isConnected(m) && modelInputCapabilities(m).supportsTransparentBg) ||
      models.find((m) => modelInputCapabilities(m).supportsTransparentBg);
    if (hit) return hit;
  }
  if (use === 'video' && opts.hasLastFrame && !defCaps.supportsLastFrame) {
    const hit =
      models.find((m) => isConnected(m) && modelInputCapabilities(m).supportsLastFrame) ||
      models.find((m) => modelInputCapabilities(m).supportsLastFrame);
    if (hit) return hit;
  }
  if ((use === 'image' || use === 'video') && refCount >= 2 && defCaps.maxReferences < 2) {
    const hit =
      models.find((m) => isConnected(m) && modelInputCapabilities(m).maxReferences >= 2) ||
      models.find((m) => modelInputCapabilities(m).maxReferences >= 2);
    if (hit) return hit;
  }
  if ((use === 'image' || use === 'video') && refCount >= 1 && defCaps.maxReferences < 1) {
    const hit =
      models.find((m) => isConnected(m) && modelInputCapabilities(m).maxReferences >= 1) ||
      models.find((m) => modelInputCapabilities(m).maxReferences >= 1);
    if (hit) return hit;
  }
  return defaultModel;
}
