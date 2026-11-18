# CoCraft 0.2 动态素材与外部素材包

核对日期为 2026 年 11 月 18 日。本版以工程内可重现的画面为交付单位。素材库、应用内 Agent 和导出器共用同一成片对象。

## 素材的三个层次

| 对象 | 保存内容 | 使用方式 |
| --- | --- | --- |
| 内置参数组件 | 预设 ID、实现版本、可调参数、分类、默认时长、许可 | 搜索用途，试听或预览，调整文字、颜色、数据或相位，再添加到时间线 |
| 项目代码组件 | 源码、已编译浏览器代码、组件标识、内容指纹和默认值。导入包另存完整源码目录、作者、版本、许可和参数控件 | 选择项目组件，在独立播放器中查看画面，按需调整实例参数；需要新行为时改源码并发布 |
| 图片、视频、声音 | 项目素材 ID、文件、可读取的尺寸或时长、缩略图或波形、来源 | 可作时间线镜头、配音、音效，或作为组件内的替换输入 |

标准几何图形、光域、线场和曲线均由当前帧计算。文字的实测字宽与画幅决定断行；竖版对照图和流程会重新排版。标题、字幕、背景等效果可以逐层组合。将预设加入成片时，参数复制到片段，时间用该成片的整数帧表示。播放器与导出共同使用这份片段定义。Remotion 在序列内提供相对于该序列的帧号。[Remotion 时间语义](https://www.remotion.dev/docs/use-current-frame)

动态示例《相位之间》有两条独立成片，共用原创录音实验与摄影素材。0–4.8 秒提出问题，4.8–9 秒显示同相输入，9–15 秒逐步错开半周，15–20 秒恢复对齐。声音来自本地产生的两道同频、等幅 220 Hz 信号，合成相对振幅为 `2 × |cos(φ/2)|`。显示的波形减慢了横向运动，音轨保留实际频率。角度曲线也决定音频合成时的相位变化，导入后的 WAV 可独立裁切。首尾唱机图由本片定制生成，工程素材中保留其来源。[OpenStax 波的叠加与干涉](https://openstax.org/books/university-physics-volume-1/pages/16-5-interference-of-waves)

## 外部生态的实际入口

| 来源形式 | CoCraft 0.2 的接入方式 | 上游依据 |
| --- | --- | --- |
| Remotion 社区组件、Elements 或自制 React 画面 | 提取要使用的默认导出组件和可分发源码，用 CoCraft 清单描述参数、时长与媒体。根入口可引用包内相对 JS、TS、JSX、TSX 和 JSON 模块。直接可加载的宿主模块为 React、React JSX runtime 和 Remotion | [Remotion Elements](https://www.remotion.dev/docs/elements) |
| Remotion Starter Template | 这些模板包括视频工程、服务端应用和编辑器。移植其中的合成组件，分别处理场景注册、服务调用、媒体地址及三方依赖。CoCraft 提供自己的时间线、Player 和导出作业 | [官方模板目录](https://www.remotion.dev/templates) |
| Remotion Studio 的媒体和交互参数 | 将 `staticFile()` 对应文件列入清单，改用 `assetUrl(媒体ID)`。将作者希望开放的控件映射为下面的参数列表。Studio 的多图层交互元数据需要单独的编辑器适配 | [Remotion 素材加载](https://www.remotion.dev/docs/assets) · [Elements 控件与安装模式](https://www.remotion.dev/docs/elements) |
| Lottie JSON、Rive 文件 | 可以使用作者已导出的普通媒体。原生可编辑播放分别需要 Lottie/Rive 适配器及其依赖、资源解析和导出校验；当前无对应文件导入入口 | [Remotion Lottie](https://www.remotion.dev/docs/lottie/lottie) · [Remotion Rive](https://www.remotion.dev/docs/rive) · [Rive Web runtime](https://rive.app/docs/runtimes/web/web-js) |
| Premiere / After Effects 的 .mogrt、Motion Canvas 场景 | 原宿主导出的视频、画面或声音可以作为媒体使用。保留参数化能力需要根据有授权的源设计，在 CoCraft 重新实现动作和值域 | [Adobe Motion Graphics templates](https://helpx.adobe.com/premiere/desktop/add-text-images/use-motion-graphics-templates/add-motion-graphic-templates-to-a-sequence.html) · [Motion Canvas 动画工程](https://motioncanvas.io/docs/quickstart/) |
| 标准 Agent Skill、Remotion 制作 Skill | Pi 发现内置或工程目录下的 `SKILL.md` 并按需读取。技能可说明如何选择、编写、修改和验画。脚本、模型、远端服务的可用性由该工程所在的运行环境决定 | [Agent Skills 规范](https://agentskills.io/specification) · [Pi Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) · [Remotion Agent Skills](https://www.remotion.dev/docs/ai/skills) |
| Pexels 等授权媒体源 | 现有 Pexels 视频搜索使用独立连接和 API Key。选中的文件进入工程，并保留作者及来源页。其他提供方可以先导入有权使用的本地成品 | [Pexels API](https://www.pexels.com/api/documentation/) · [Pexels 许可](https://www.pexels.com/license/) |

Remotion Studio 的 Element 安装流程会复制源码并安装声明的依赖。本版的离线包入口只复制本地文件和编译受支持的源码，未实现在线商店、任意 npm 自动安装、宿主插件安装和远端模板 URL 安装。移植时分别核对组件代码、字体、音乐、图片和运行时许可；上游页面标注的“免费模板”不足以确定其中所有素材的再分发范围。原创预设及 Signature 示例使用 CC0，生成摄影的使用授权见对应媒体，React、Remotion 和其他依赖使用各自的许可。[Remotion Elements](https://www.remotion.dev/docs/elements) · [Remotion 许可](https://www.remotion.dev/pricing) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)

## 可导入的目录格式

打开「动态素材库 → 载入随附素材包」即可导入 Studio Signature。也可选「导入素材包」并选择包含 `cocraft-pack.json` 的目录。完整可运行的清单位于 [随附实例](../resources/packs/studio-signature/cocraft-pack.json)，包含 TSX 入口、排字辅助模块、SVG 标记和许可文本。

| 字段 | 规则 |
| --- | --- |
| `schemaVersion`、`id`、`name`、`version`、`author`、`license` | schema 版本为 1。包、模板与媒体标识使用小写字母、数字、点、下划线或短横线，以字母或数字开头，最长 64 字符 |
| `templates[]` | 每项包含 `id`、`name`、根目录中的 `entry` 和 `durationSeconds`。支持只含媒体的包、只含模板的包或混合包 |
| `defaultProps` | 每一项是字符串、有限数字或布尔值。媒体引用用字符串 `@asset/标识`，导入时替换成该版本的项目素材 ID |
| `parameters[]` | 每项有与默认值一致的 `key`、可读 `label` 及 `type`。控件支持 text、color、number、select、boolean；数字可设 min、max、step，枚举可设一组 label/value，颜色使用六位十六进制 |
| `assets[]` | 每项含唯一 `id` 和目录内的 `path`，可提供 `name`、`license`、`sourceUrl`。媒体复用应用的本地探测和缩略图流程 |
| `homepage` | 可选来源页。媒体有独立来源页时优先记录其链接 |

源码组件默认导出 React 函数，以 `useCurrentFrame()` 和 `useVideoConfig()` 取得帧号、时长和画幅。项目组件额外接收 `assetUrl(id)` 和 `assets`。包内的源码依赖可分目录保存；请把需要运行的纯浏览器模块放入包内并保留许可证。大型原始视频只需列入媒体清单，不应嵌进 JS 字符串。

导入先将源码和声明媒体复制到临时目录，按排序后的相对路径与文件字节分别计算 SHA-256，再合成完整目录的指纹。清单中的版本、默认参数、依赖源码、媒体和随附许可文件都参与计算。编译读取这个临时副本，同一版本的目录通过重命名一次安装。源码包、媒体和组件绑定内容指纹，重新导入相同包会复用已登记项，改变资源会产生新对象。全部待选组件由导出器取一次候选帧，工程随后执行一次版本发布。清单、编译或帧检查失败时，当前版本仍可播放；通过目录准备但未发布的内容可能作为未引用缓存留存在工程中。

内置素材缩略图由已打包的可信组件绘制。导入组件的素材库预览使用独立来源的受限 iframe，工作台进程只传参数和媒体地址；候选帧在导出进程检查。单次候选帧检查覆盖该时间点的编译与运行情况，其他时间点的视觉质量通过具体镜头的抽帧和播放验收。

## 开发复核

`node scripts/material-check.mjs` 在独立临时目录创建工程，验证源码依赖和媒体的版本隔离、失败后已发布版本、重复导入、纯媒体包和示例组件渲染，并生成素材的横竖版联系表和示例关键帧。`node scripts/material-check.mjs --movies` 另行导出两部全尺寸 H.264/AAC 成片并解码检查帧数、尺寸和相消区间的实际音量。测试在当前 Apple Silicon 开发环境下使用已安装的 Chrome，运行结果目录在终端输出。

## 这一版实际检查了什么

内置目录为 17 项，包含 6 项标题包装、2 项字幕、6 项信息图形及 3 项动态背景。另有 3 张摄影和 4 条声音，均可从「摄影与声音」离线加入工程。随附素材包增加一个带本地 TS 模块、品牌标志与可见性开关的源码组件。

在临时工程中逐项渲染横、竖画幅与默认、长中文文案，68 个组合通过文字画幅边界和交叠检查。联系表审阅后处理了中文句末标点单独成行、细线背景缩略后丢失、字幕缩略图缺少对照底图的问题。额外检查了实际 Electron 父窗口和素材包预览子 frame，包画面能显示参数变更，子 frame 无桌面 IPC 对象。属性面板连续输入只在离焦时形成一次改动。

示例的两个 MP4 均含 600 帧、30 fps、H.264 视频和 AAC 音频。对成品音频解码后，14.0–14.8 秒区间的 RMS 为 0；2.1–3.0 秒和 18.5–19.1 秒区间的 RMS 分别约 0.0465 和 0.0311。画面证明从最终 MP4 提取，分别选取第 60 帧和第 360 帧。[横版画面](verification/v2/phase-study-wide.jpg) · [竖版画面](verification/v2/phase-study-portrait.jpg)

验证未调用外部付费模型。上述波形、媒体包和编译测试主要覆盖本版随附素材与清单协议，对其他来源的素材仍需做相应的依赖、许可与实际渲染核对。
