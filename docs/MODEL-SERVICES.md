# CoCraft 0.2 模型服务

2026 年 11 月 18 日核对。应用分别保存提供商连接、模型和用途默认值。可以给剪辑 Agent 配置一个文本模型，再用其他模型完成画面分析、转录、配音、图片或视频生成。

## 配置与使用

1. 在设置中添加提供商，填写协议、服务地址和 API Key。本地免密服务支持关闭密钥要求。检测连接会读取模型目录。服务未开放目录时可手动填写模型 ID 或接入点 ID。
2. 为每个模型选用与服务匹配的接口，再分配用途。文本模型只需启用「剪辑与编排」；可实际接收图片的对话模型可启用「画面理解」。确认采样方式、音色、尺寸等参数受所选模型支持。
3. 为需要的用途选择默认模型。项目可覆盖全局默认，单次请求也可以指定已注册模型。项目仅保存这些模型的本地注册 ID。密钥由应用的系统安全存储加密。
4. 工作台发起的生成作业完成后把素材收集到当前工程；Agent 工具先返回暂存素材 ID，再由 Agent 将采用的素材与片段一起发布。录音转录支持音频和带声音的视频，选择支持时间戳的模型可得到源素材时间范围。

## 接口与适用范围

| 用途 | 接口与行为 |
| --- | --- |
| 剪辑 Agent | Pi SDK 调用已配置的 OpenAI Chat Completions 兼容、Anthropic Messages、Google Gemini 或方舟对话接口。模型需支持流式对话与工具调用。能力勾选决定输入中是否包含图像。 |
| 画面理解 | 对所选模型发送 OpenAI 兼容 `chat/completions`、Anthropic `v1/messages` 或 Gemini `models/{id}:generateContent`。图片使用像素数据；视频在开头、约 35% 和 70% 处尝试取帧，结果中保留位置。文本型 Agent 的 `preview_frame` 会委托视觉模型分析一次渲染帧。 |
| OpenAI Images 兼容 | 文生图发送 `POST images/generations`；有参考图时把 PNG 文件通过 multipart 上传到 `POST images/edits`。读取响应首张图片的 base64 数据或下载地址，按实际字节识别格式并导入。 |
| 方舟图片 | `POST images/generations` 支持文本和一张参考图。传入接入点或模型 ID、提示词及可选尺寸，读取 `data[0].b64_json` 或地址。 |
| 配音 | 本机使用 macOS 已安装的语音离线输出 WAV；OpenAI Audio 兼容服务通过 `POST audio/speech` 提交模型、正文与音色并收取 WAV。 |
| 转录 | FFmpeg 提取每段最多 300 秒的 16 kHz 单声道 WAV，作为 multipart 上传到 `POST audio/transcriptions`。对模型实际返回的时间段累加分块偏移。支持纯文本、JSON 及带时间戳 JSON，文稿可独立于字幕保存。 |
| 方舟视频 | `POST contents/generations/tasks` 提交文本与可选首帧图像，取得任务 ID 后轮询对应 GET 路由。成功后从 `content.video_url` 下载 MP4 并探测真实时长。 |
| 自定义 Videos 兼容 | 适用于仍提供此协议的第三方端点。使用 multipart 提交 `POST videos`，轮询 `GET videos/{id}`，完成后从 `GET videos/{id}/content` 下载。OpenAI 官方已于 2026 年 9 月 24 日关闭此服务，应用会在创建请求之前提示。 |

方舟的模型代际决定参考图、画幅、分辨率、时长、同步音频和格式的组合。Seedance 2.5 首帧任务的画幅由参考图决定，使用该模式时可留空尺寸或选择模型支持的自适应参数。根据实际响应保存结果，预览中显示媒体实测时长。[方舟图片接口](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh) · [创建视频任务](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh) · [查询视频任务](https://docs.volcengine.com/docs/ark/get-video-generation-task-api?lang=zh)

OpenAI 图像编辑支持 multipart 图片；语音接口支持 WAV。转录模型的返回格式各异，普通文本结果没有可直接用于字幕的分段时间。OpenAI 已公告部分旧转录模型的后续退役日期，模型注册支持按需更改。[图像编辑](https://developers.openai.com/api/reference/resources/images/methods/edit) · [生成语音](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create) · [文件转录](https://developers.openai.com/api/docs/guides/speech-to-text) · [服务退役记录](https://developers.openai.com/api/docs/deprecations)

Google Gemini 原生协议的地址可使用服务根或带版本的 API 基址，目录返回的 `models/` 前缀会规范化。自定义网关请填写实际版本路径。Anthropic 的原生连接可填写服务根或结尾带 `/v1` 的地址。[Gemini 内容生成协议](https://ai.google.dev/api/generate-content) · [Anthropic Messages](https://platform.claude.com/docs/en/api/messages)

## 作业恢复、归档与停止

- 视频提交前写入本地作业。收到服务商任务 ID 后立即保存。重启时中断的作业保留状态，在后台作业中选择继续查询，使用原连接、原编号。服务商已确认失败、取消或过期的任务显示终态。获取不到编号的请求需要人工核对服务商记录。
- 点击取消立即停止本地等待并撤销此次发布资格。若视频创建请求已经发出，应用会短暂等候服务商的受理编号，以便稍后查询。服务商可能继续执行和计费。再次选择继续查询或收集已生成结果只影响素材库。
- 收到文件后先固定本地内容与素材 ID，再进入可撤销的发布入口。项目内 `.cocraft/generation/<作业编号>/` 保存结果和生成素材来源；原始文件由引用的来源位置持有，生成媒体收集在工程 assets 目录中。
- 连接绑定提供商、协议和地址。检测、生成与模型 SDK 的带密钥请求会拒绝重定向。下载服务商提供的媒体链接使用独立请求。任务工作进程只接收所选剪辑模型的凭据，私有素材服务由桌面主进程调用。

## 验证

在 Apple Silicon Mac 项目根目录运行以下命令。测试会创建并清理独立临时工程，用回环 HTTP 服务响应各家接口；系统配音、媒体解码、抽帧、Pi 执行、工程版本发布和桌面重启均实际运行。

```bash
npm run build
node scripts/generation-smoke.mjs
```

协议验收覆盖随附声音的暂存与采用、含相对引用的素材包源码编辑、参考图上传、图像与 WAV/MP4 导入、带时间戳和纯文本转录、三种视觉接口、文本 Agent 的预览分析、作业取消、重启后并发继续查询，以及项目文件中密钥不落明文。云端模型的实际可用性、生成质量与计费由配置的账户、模型和服务商决定。该协议验收仅使用临时服务和测试凭据。

独立的真实账户验收使用打包的 CoCraft 0.2 和 `deepseek-flash`。模型读取工程、挑选 `focus-callout` 并发布了「现场录音」角标。横版成片以 30 fps 在第 240 帧开始，片段持续 90 帧，分别对应用户指定的第 8 秒和 3 秒时长。此任务完成了时间线编辑；该账户此次未配置视觉模型，预览帧的视觉评估单独留待验证。云端图像、视频、配音和转录服务的协议验收采用上述回环夹具。[打包版实测记录](verification/v2/deepseek-edit.json)


第二次真实 DeepSeek 验收要求从空白 TSX 设计透明的双通道电平表，模型调用代码写入、编译与发布工具。右上电平格按帧数生成动画，标题、色彩和格数可以在属性面板调整。验收将产出的源码包重新导入最终应用，比较跨剪点的导出帧。[代码与参数](../examples/packs/stereo-meter/) · [运行记录](verification/v2/deepseek-component.json)
