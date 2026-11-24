# CoCraft 迭代与重构计划（ROADMAP）

更新日期：2026 年 11 月 24 日（完成 macOS Apple Silicon 正式发布管线：`Developer ID Application` 由内而外 Mach-O 精准签名 + Apple Notarization 公证 + `.dmg/.app` 双端票据装订 + Hardened Runtime 干净挂载实测全绿）。

遵循小时级可运行、可演示、可验证增量交付约定。每次交付包含实际构建、可复现步骤、自动化与真机验证结果、已知边界和下一项最小目标。

---

## 当前基线与验收状态

11 月 18 日补充实测：0.4.0 打包版既有五项回归再次通过。独立剪辑任务发现锁定素材重连、音轨静音、分镜文稿与镜头复用等问题，列为专业交付待修项。复现步骤、实拍与解码结果见[桌面版产品实测评审](reviews/2026-11-18-v0.4/REVIEW.md)。

- **历史基线**：`0.1`（基础 Electron + Remotion + Pi 闭环）、`0.2`（多提供商模型目录、17 项预设、离线素材包、DeepSeek 实模剪辑验收）与 `0.3`（双层资产底座、Three.js 3D 舞台与多候选分镜）。
- **v0.4 单色专业 IDE 外骨骼、`[创造 | 剪辑]` 双模融合与交付阻断清零（已通过打包版实测验收 ✅）**：针对首轮实机复验发现的 1 项 P0、4 项 P1 及体验割裂问题完成根治（本轮耗时约 66 分钟），并在重新打包的 `release/0.4/mac-arm64/CoCraft.app` 上走完「真实 MP4 入轨 → 分镜换序与字幕同步 → Agent `/新建分支试剪` 严格分支隔离 → 默认导出并 `ffprobe` 校验成片」完整闭环。规格见 [PRD.md](PRD.md)。

---

## v0.4 升级验收清单

### 增量 1 & 1.5：单色 IDE 双模架构、资产-分镜-剪辑联动与交付阻断清零（已验收 ✅）

| 子项 | 核心交付内容 | 验收状态 |
| --- | --- | --- |
| **4.1 macOS Tahoe 图标与单色专业 IDE 外骨骼** | 保留光学双光圈标识，单母版 `sips` 缩放管线与 `iconutil` 往返校验；废弃割裂资产与剪辑的四栏糖果色旧壳，重构为深炭黑 `#0D0E10` / 暖米纸白 `#F6F5F1` 单色专业 IDE 外骨骼 + 统一 `38px` 顶栏（项目/成片分支切换、`[创造 \| 剪辑]` 分段切换、`◧ 左栏 / ⬓ 底栏 / ◨ 右栏` 独立折叠开关） | **已验收**（深浅双主题全套实拍与 `iconutil` 校验通过） |
| **4.2 「创造」无限节点画布与「剪辑」可折叠资产树联动** | 「创造」模式落地 TapNow 风格点阵缩放/平移无限画布、左悬浮工具胶囊、小地图、上游设定节点至下游合成分镜节点的 `1px` SVG 贝塞尔连线及右栏收起时的 Codex 风格底部悬浮指令框；「剪辑」模式支持直接导入与左侧可折叠高密度 `AssetExplorer`（分镜镜头 / 设定变体 / 媒体 / 母版，带 `Nx` 引用徽标、拖放上轨与「沉淀当前镜」反向入库） | **已验收**（`v05-acceptance.mjs` 画布拖拽连线、双模互切与零断行核验通过） |
| **4.3 三层正交资产分类学、多状态分支与解耦内置积木** | 解耦 `Skill`（6 套方法论）× `Style`（4 套内建纯视觉变量）× `Component`（设备外壳 + 8 条合成点缀音效）；落地 `载体类型 × 创作角色 × 自由标签` 正交筛选、主体多状态变体树、`derivedFrom` 血缘与单工程自包含策略；全界面零内部技术代号泄漏 | **已验收**（`smoke:agent`、`smoke:models` 与正交资产测试全绿） |
| **4.4 交付阻断根治：真实 MP4 导出、分镜字幕原子换序与 Agent 严格边界** | ① **P0 修复**：`server.ts` 放行 `127.0.0.1/localhost` 本机回环端口，根治 `@remotion/renderer` 取帧代理被 `RENDER_CSP` 拦截导致 MP4 导出失败，并修正 `render-worker.ts` 错误归因；② **P1 修复**：重写 `computeCompositeShots` 为无间隙不重叠区间切分（100% 覆盖长底图首尾），升级 `reorderClips` 与 `moveCompositeShotOperations` 使画面、叠加层与字幕原子同步换序，整镜改台词自动清理同镜旧多余字幕，补齐剪辑底栏分镜卡换序与绑定控件；③ **P1 修复**：`enforceStrict` 补全对 `reorderClips` / `addClipTake` / `switchClipTake` / `sequenceId` 的服务端强拦截，已有会话执行 `/新建分支试剪` 自动改派 `tasks.retarget` 并锁定新分支；④ **P1 与日常体验修复**：AI 候选入口自动注入本镜台词、`@主体:状态` 与 `referenceAssetId`；历史版本弹窗与修改面板新增一键「派生分支」 | **已验收**（打包版 `CoCraft.app` 实机跑通 `v05-acceptance.mjs` 全部 5 关，导出 5.01s H.264/AAC MP4 经 `ffprobe` 核验通过；本地协议夹具验证通过，云端在线实模待连网复验） |

### 11 月 18 日打包版复验与修复闭环记录

- **首轮实机复验（约 12 分钟，发现阻断）**：
  - 独立工程通过媒体导入、入轨、播放、逐帧定位、分割、撤销重做和手动分支隔离检查。
  - **原导出阻断（P0，已根治）**：空白工程导入 5 秒 H.264/AAC MP4 默认导出失败，`RENDER_CSP` 中 `connect-src 'self'` 拦截了 Remotion 本机取帧回环端口且报错提示失准。
  - **原编辑阻断（P1，已根治）**：分镜换序仅移动 `visual` 导致字幕错配；长底图叠短标题丢首尾或重叠；多字幕整镜改词残留旧句；AI 候选入口丢失文稿与参考图。
  - **原协作阻断（P1，已根治）**：「仅改此处」未拦截 `reorderClips`；已有会话 `/新建分支试剪` 未改派会话绑定分支。
- **次轮打包版闭环复验（`COCRAFT_PACKAGED_EXECUTABLE=release/0.4/mac-arm64/CoCraft.app/Contents/MacOS/CoCraft`）**：
  - `npm run test:unit`、`npm run smoke:agent`、`npm run smoke:models` 与打包版 `v05-acceptance.mjs` 5/5 全绿通过：5 秒真实 H.264/AAC MP4 入轨切双镜配双字幕 → 剪辑底栏分镜「后移镜头」画面与字幕 100% 同步对调 → 已有会话及实机 MP4 工程触发 `/新建分支试剪` 时越界改主片被服务端当场拒绝、仅实验分支更新 → 默认导出成功生成 `523,200 bytes`、`5.01s` 标准 `h264 + aac` MP4 成片。
- **产品级深度重构、全界面去 Emoji 专业化与用户动线重塑（已通过打包版实机与全截图审查 ✅）**：
  - **剪映五分类 × Figma 三层资产库 + 个人跨项目库复活**：重构 `AssetExplorer.tsx` 为 `媒体 / 音频 / 文本 / 转场 / 组件` 左侧导航与双列卡片流；在 `媒体 / 音频 / 组件` 呈现 `全部 / 当前项目 / 个人库 / 官方内置` 来源筛选（`文本 / 转场` 自动收敛空壳页签），打通 `vault.promote / pull / remove` 跨项目复用与 Agent `search_assets(personal)`，移除左侧 4 色风格胶囊条并在右侧无选区时呈现 Figma 式「成片画布」属性面板（比例/底色/风格换肤 + 方正取色块）。
  - **AI 原生「创造」画布与单焦点交互**：新增 TapNow/Lovart 风格底部 `AI Omnibar`（4 模式 + `@/Film` 节点上下文芯片）及选中节点上方 AI 浮动工具条；`创造` 默认全屏展开、收起右侧栏并展示 `01/02/03` 三步开局引导与 `6` 列横向分镜带（附 `进入剪辑精修 →`），展开右侧 `Agent` 抽屉时自动隐藏底部 `Omnibar` 避免双框并存；左悬浮工具栏去重至 4 项、左下角改用单色缩放步进器。
  - **专业 NLE 剪辑工具集、直击舞台改字与一等转场（Transitions）**：
    - `StageOverlay.tsx` / `Film.tsx` / `preview.tsx` 彻底废除字符估算选框，改为真实 DOM `[data-clip-box]` 实时像素测量与 `live-transform` 60fps 跟手拖拽，并补齐浅色底字色适配、去除 `CREATED WITH COCRAFT` 默认水印及暂停选中片段首帧保底可见（`animation: 'none'` 默认无隐身陷阱）；
    - 回放栏沉浸预览（`Minimize2 / Maximize2`）与静音按钮补齐按下态 `active` 高亮与 `Esc` 恢复；
    - `Timeline.tsx` 拆分不依赖 `frame` 的 `TimelineTrackLabels / TimelineRuler / TimelineLanes` `React.memo` 零重绘子树、`WaveformSvg` 单 SVG 路径替换百个 DOM 节拍条及 GPU `translate3d` 播放头解决搓擦卡顿；修正 `V2 / V3 / V4` 叠加轨号不再重复 `V2`；新增 `transitionIn` 数据模型与 `<TransitionEnvelope>` 渲染；
    - **全界面零 Emoji 减法 + Figma×CapCut 高密度属性栏 + 全品类画布资产区**：清零所有彩色 Emoji 与 `✦` 星号；`Inspector.tsx` 重构为 `26px` `ScrubInput` 拖值框、`AlignBar` 六向画布对齐、按需启用描边/背景/阴影/副标题与 `[样式/动效]` / `[画面/调节/音频]` 二级页（打通旋转/混合模式/圆角/字体字重/6 项调色滤镜预览导出一致生效）；`CreateCanvas.tsx` 将 `.toast` 上移至顶部彻底解放 Omnibar 输入焦距，引入 `computePrimaryTimelineShots` 避免叠字切碎主镜，并将独立图片、视频与可试听音频作为一等资产卡呈现在画布。
  - **打包版最终复验（`release/0.4/mac-arm64/CoCraft.app`）**：`npm run test:unit`、`npm run smoke:models`、`npm run package`、`COCRAFT_SMOKE_EXECUTABLE=... npm run smoke:agent` 与 `COCRAFT_PACKAGED_EXECUTABLE=... npm run test:v04` 全部 PASS（含真实鼠标点击 Omnibar 输入、画布音频资产卡、浅底首帧可见、`[data-clip-box]` 与 `.stage-gizmo` 像素框零错位、唯一轨道号 `['V3','V2']`、不碎裂镜头核验及 5s H.264/AAC MP4 实机导出 `ffprobe` 校验）。
- **v0.5.2 TapNow 画布交互、音频可拖试听、多选编组与打包、高频无卡顿时间线与精剪沉淀（已通过打包版实测与全截图审计 ✅）**：
  - **1. 素材工作室固定弹窗尺寸**：`GenerationDialog.tsx` 采用 `.generation-body` 独立滚动与固定 `.modal.generation-shell`（`560×496px`），实测切换 `图像 / 视频 / 配音 / 转录 / 画面分析` 5 个页签尺寸零跳动。
  - **2. 多选、取消选中与资产关系/素材包体系**：画布支持空白/阶段/`Esc` 清零选区，拖拽框选（Marquee）与 `Shift/⌘+Click` 多选；顶部浮动多选胶囊支持 `@ 添加到对话`、`⌘G 成组`（`canvasGroups`）、`打成素材包`（个人库 `pack` 及离线 `cocraft-pack.json` 导出/导入往返）、`建立关联`（`derivedFrom`）、`串入时间线` 与 `存为资产`；镜头卡片支持多主体+文本绑定（优先非文本设定用于 AI 生图提示）。
  - **3. TapNow 原生画布交互与微动效**：移除左侧 `.cc-float-rail` 与拆解弹窗，改为底部 `( + )` FAB 菜单、右键菜单、画布内联实时可编辑文本节点（支持直接点「拆为分镜序列 / AI 生图 / AI 配音」）、Drop-to-Create 拖线弹出下游菜单、万能端口互连及右下三合一缩放/小地图/对话开关。
  - **4. 可交互单色音频波形播放器（`AudioWaveformPlayer.tsx`）**：提供波形条拖拽/点击寻址、`1.5px` 指针与实时 `01.4s / 10.8s` 进度读数，在创造画布、左侧资产栏与右侧音频属性中全端打通。
  - **5. 高频 `PlayheadClock` 解耦消除时间线卡顿**：新增 `PlayheadClock` 外部订阅时钟、`PlayheadTimecode` 局部渲染及 `rAF` 节流 `seek(..., { scrubbing: true })`，搓擦与播放期间不触发根组件树重绘并冻结舞台 `measureVisibleBoxes` 测量。
  - **6. macOS 顶栏对齐与全界面专业减法**：调整 `trafficLightPosition: { x: 14, y: 13 }` 与 `padding-left: 74px`；移除全局双层焦点框、`Inspector` 文本原生滑条与底部 `.composer-note`，收紧 `Inspector` 填充行及 `Agent` 默认宽度（`296px`）。
  - **7. 剪辑片段回存为项目复合资产**：支持把已裁剪、调色或带转场的多层时间线选区通过 `保存为项目资产`（`createCompoundVaultItemFromClips`）沉淀为 `compound` 资产条目，并从资产栏或画布一键再入轨（`instantiateCompoundVaultItemOperations`）。
  - **最终全量验收结果**：`npm run test:unit`、`npm run smoke:models`、`npm run package`、`COCRAFT_SMOKE_EXECUTABLE=release/0.4/mac-arm64/CoCraft.app/Contents/MacOS/CoCraft npm run smoke:agent` 与 `COCRAFT_PACKAGED_EXECUTABLE=release/0.4/mac-arm64/CoCraft.app/Contents/MacOS/CoCraft npm run test:v04`（含截图 `02`/`07`/`08`/`09`/`10` 视觉核验与 `822,482 bytes / 5.01s` 真实 H.264/AAC MP4 `ffprobe` 校验）全部通过（退出码 0）。
- **v0.5.3 阿里千问/百炼全模态集成、Skill 工作台、Agent 会话与画布全向连线优化（已通过打包版实测与全截图审计 ✅）**：
  - **1. 阿里百炼 / 千问全模态可扩展适配**：新增 `'dashscope'` 协议及 `dashscope-image`（`qwen-image-plus` / `wan2.6-t2i`）、`dashscope-video`（`wan2.6-t2v` / `wan2.6-i2v` 异步任务轮询与崩溃续传，同步前置 I2V 参考图校验）、`dashscope-speech`（`qwen3-tts-flash` WAV/MP3 头探测）、`dashscope-transcription`（`qwen3-asr-flash` 本地音轨切片 Base64 直传识别）与通用 `providerModelSuites`（设置页「一键添加推荐全模态模型 (6 项)」）。
  - **2. 可视化 Skill 工作台与多模态规范**：新增内置 `cocraft-multimodal` SKILL.md，实现 `project -> user -> builtin` 三层优先级加载与 `skills.save / delete / import` IPC（修正 macOS 软链路径规范化），设置页开放 Skill 新建、内置派生覆盖、Markdown 编辑与项目常驻开关。
  - **3. Agent 会话列表、Composer 与对话渲染全面升级**：废弃系统 `<select>`，落地自定义单色会话切换弹窗（`+ 新建对话`、分支、紧凑 Token 读数、内联重命名/删除）、紧凑型模型与思考深度弹窗（`off/low/medium/high` 直通 Pi SDK）、曲别针/粘贴/拖放多模态附件、`28×28` 圆形发送按钮；新增 `AgentThread` 折叠思考块、同回合顺序配对折叠工具组与带语言头/复制键/时间码跳转的 `Markdown` 渲染。
  - **4. 画布全向连线与组件细节打磨**：支持全部节点卡片任意位置直接拖移（提升 `.cc-node` `z-index` 解决斜线 pill 遮挡卡面拖拽问题）、自适应 4 向端口贝塞尔弧线消除 `S` 形回环、双向端口拖线及全 4 类连线点击徽章解绑；移除画布属性冗余 `成片视觉风格` 4 张卡片并修复 `.switch` 滑块溢出。
  - **打包版最终复验结果**：`npm run package`、`npm run test:unit`、`npm run smoke:models`（含 DashScope 5 类全模态及 I2V 无图拦截测试）、打包版 `npm run smoke:agent` 与打包版 `npm run test:v04`（含 `[6/6]` 与截图 `11`/`12`/`13` 视觉复审及 `822,946 bytes / 5.01s` MP4 `ffprobe` 校验）全部通过（退出码 0）。
- **v0.5.4 Wave A 止血加固：安全沙箱封口、模型兼容路由、3D/预览稳定性与 P0 界面缺陷清零（已通过打包版全套验收 ✅，耗时约 44 分钟）**：
  - **1. 安全与隔离封口**：
    - `electron/agent-worker.ts` & `electron/agents.ts`：重写 `guard()` 递归解析符号链接堵住悬空软链逃逸，清理 `readRoots` 空字符串边界；将 macOS `sandbox-exec` 改为经实测验证的 `(deny default)` 最小白名单（阻断 `~/.ssh`、`/private/tmp`、`pbpaste`、`open`、Keychain、AppleEvents 与工作区外写入，开启联网时同时封锁本机回环）；封禁 Agent 与原始 `project.edit` 直接调用 `relinkAsset` / `addAsset`；强化 `putComponent` 的编译前置校验与跨序列 CoW 检查；将 `agentDir` 与项目 Skills 移出可写工作区；补齐进程终止 `SIGTERM -> 2s SIGKILL`、`stopAll()`、中段停止孤儿进程清理、补全 `steer` 图片/路径与尾段排空，以及 `pull_vault_item` / `preflight_sequence` 工具。
    - `electron/generation.ts` & `electron/server.ts` & `electron/main.ts`：SSRF 校验增加 `dns.lookup(..., { all: true })`、IPv6 私有/链路本地段、IPv4 映射 IPv6（`::ffff:127.0.0.1`）、CGNAT 及阿里云元数据 `100.100.100.200` 拦截，并改用流式 `downloadToFile`（512MB 上限与失败清理）；`MediaServer` 对 `renderAssets` 引入引用计数释放、动态收紧 `PREVIEW_CSP` 到精确 `selfHost`、增加 `nosniff` 与 SVG `sandbox` 头；`main.ts` 对 `skills.import` 限制 `.md` 与 512KB、对导出文件名清洗路径字符、对粘贴附件限 20MB、新增单实例锁与退出清理；`preview.tsx` / `App.tsx` 将预览热键与播放通道升级为私有 `MessageChannel` / `MessagePort`，阻断不受信任 TSX 伪造 `window.postMessage` 热键。
  - **2. 模型路由与持久化可靠性**：
    - 保留 `SettingsStore.agent()` 的 `protocol`，修复 DashScope 主 Agent 误打 `/v1/chat/completions` 404 问题（现准确命中 `/compatible-mode/v1/chat/completions`）；为 Pi SDK 注入精确 `compat` 与 `modelSupportsReasoning()`，停止向普通兼容模型发送 `reasoning_effort` / `role: developer` / `max_completion_tokens`，为 Qwen3 思考模式映射原生 `thinkingFormat: 'qwen'`（`enable_thinking`）；修正 `wan2.6` 冲突参数与 I2V 大图压缩、ASR 分块重叠去重与按句切分、15 分钟轮询超时与瞬断重试、`vision` `max_tokens`。
    - `store.ts` / `vault.ts` / `packs.ts` / `jobs.ts` / `render-worker.ts`：串行化 `envelope()` 并自动重建缺失/损坏的 `revisions-index.json`；`copyIntoLibrary` 改用流式 SHA-256 防大视频 OOM 并堵住 `stageLibraryFile` 路径穿越；支持 `packs.export` 携带 `vaultIds` 完整导出实体与复合资产；`render-worker.ts` 兼容 exFAT/FAT32 `link()` 降级 `rename()` 并清理 `.rendering.*` 临时文件，`before-quit` 仅终止本地导出子进程而不破坏云端作业崩溃续传语义。
  - **3. 3D / 合成一致性与前端 P0/P1 修复**：
    - `ThreeStage.tsx` / `Film.tsx` / `preview.tsx`：修复异步加载 GLB / 暂停改参后 3D 白屏，递归释放几何/材质/纹理并调用 `forceContextLoss()`，小尺寸卡片缩略图渲染一帧转静态 PNG 后立刻释放 WebGL 上下文；去除 `Film.tsx` 暂停选中时的表现偏差，增加 `componentCache` LRU(64) 与每片段 `<ClipErrorBoundary>`，修复 `Code` 变换顺序与 `preview.tsx` 崩溃恢复后 `<Player>` 监听重绑。
    - `App.tsx` / `CreateCanvas.tsx` / `Inspector.tsx` / `Timeline.tsx` / `AssetExplorer.tsx` / `SettingsDialog.tsx`：修复初始帧硬编码 70 → `0`、默认思考深度 `off`、音频试听跨切残留、全量拖拽遮罩卸载清理、`textDrafts` 撤销重置与工具栏失焦竞态、Modal `z-index` 被顶栏遮挡与弹窗内全局快捷键误触、标尺标签重叠、属性栏音频页签切图片白屏、画布底色重复输入、文字填充 `透 100 %` 截断、思考深度弹窗右溢视口、素材栏跨分类隐藏筛选与设置页一键套件 React 18 批处理覆盖。
  - **打包版全量验收结果**：`npm run test:unit`、`npm run smoke`、`npm run smoke:models`（含 `100.100.100.200` 与 `::ffff:127.0.0.1` SSRF 拦截）、打包版 `npm run smoke:agent`（含悬空软链逃逸、`relinkAsset` 拦截、deny-default 沙箱与 DashScope `enable_thinking` 路由）、打包版 `verify_wave_a.mjs`（9 项实机交互/安全/UI 断言 + 0 控制台/页面报错）与打包版 `npm run test:v04`（`[1/5]`–`[6/6]` + `823,745 bytes / 5.01s` H.264/AAC MP4 `ffprobe` 校验）全部 PASS（退出码 0）。
- **v0.5.5 Wave B 创作者交付信任、专业 NLE 标准对齐与联网沙箱热修（已通过打包版 6 套全量验收 ✅，耗时约 38 分钟）**：
  - **0. 联网沙箱热修（`allowNetwork: true` 退出码 65）**：[electron/agent-worker.ts](../electron/agent-worker.ts) 修正 macOS Seatbelt `(deny network-outbound ...)` 仅接受 `"localhost:*"` 的语法约束（改用 TCP/UDP 0ms 即时拦截本机回环）、提前创建工作区 `.tmp`/`.npm-cache` 并设定 `HOME: cwd`、调整 `PATH` 使本机完整 `ffmpeg` 优先于内置精简版且改用 `DYLD_FALLBACK_LIBRARY_PATH`，彻底恢复 Agent 在沙箱内运行 Python/FFmpeg 合成音频与脚本能力，同时保持本机回环与 `~/.ssh` 严格隔离。
  - **1. 11/18 评审前 10 项全量清零**：
    - **#1 内容指纹锁保护重连**：`Asset` 记录流式 `sha256` 与 `byteSize`；同哈希换路径在锁定镜头下直接找回，异内容换片（即使时长分辨率完全一致）触发锁定保护拦截，并提供「派生新素材仅替换未锁定镜头（`fork-unlocked`）」；重连先探临时缩略图避免失败污染，异内容自动清理陈旧转录，补齐 `.glb/.gltf` 筛选。
    - **#2 专业 NLE 三路独立音频**：拆分为 **A1 声音轨静音（`mutedTracks`）**、**V1 视频原声静音（`mutedVideoAudio` + 片段级 `muted`）** 与 **预览监听静音（不影响导出）**；`Film.tsx` 与 `ScreenFocusRig` 全量接入，`Timeline` V1 轨头新增独立视频原声静音按钮。
    - **#3 拆镜数字逐字保留与单份文案**：新增 `stripExplicitListMarker` 仅剥离显式列表符，逐字保留 `2026 年`、`3.5 倍`、`35mm`、`100%`、`-15℃`；光标改按非音频轨计算，不再把标题与字幕在画面上双写重复文案。
    - **#4 分句 SRT 时码保留**：`StoryboardStudio` 与 `CreateCanvas` 对多句对时字幕提供逐句改字（`updateSingleCaptionTextOperations` 完整保留每句起止帧）与独立旁白备注，合并重排改为显式确认操作。
    - **#5 + 统一单分镜模型 + 随镜音频归属**：`computeCompositeShots` 与 `computePrimaryTimelineShots` 统一为单一主镜轨模型，跨镜水印划入 `spanningOverlays` 不再阻断换序；音频片段新增显式 `audioAttachMode: 'shot' | 'timeline'`（短音效/配音默认 `随镜`，长底乐默认 `固定时间线`，支持时间线徽标查看与属性栏切换），换序原子同步画面、局部叠加、字幕与随镜声音。
    - **#6 复合镜头整栈沉淀**：`collectShotClipsForCompound` + `createCompoundVaultItemFromClips` 保留裁切 `sourceIn`、时长、字幕与随镜声音并修复素材角色标注；`instantiateCompoundVaultItemOperations` 跨帧率等比缩放 `sourceIn` 与转场时长。
    - **#7 冷启动空工程舞台手柄即时生效**：`StageOverlay.tsx` 增加 `visible` 联动 `useLayoutEffect` 与实时 DOM 尺寸兜底，`preview.tsx` 在工程版本/片段数变化后主动重测 `[data-clip-root]`，冷启动空工程入轨即刻生成 `.stage-viewport` 与 4 角缩放手柄。
    - **#8 逐帧精确分镜缩略图**：`media.ts` / `server.ts` 新增 `/media/<id>?frame=<n>&fps=<fps>` 缓存抽帧端点（按 `sha256` 标签自动失效），`ShotCompositeThumb` 按 `clip.sourceIn + offset` 取真实代表帧。
    - **#9 AI 候选自动回挂原镜头**：`GenerationRequest`/`Job` 携带 `target` 目标镜头，生图/生视频完成后原子 `addAsset` + 追加未激活 `ClipTake`（不覆盖当前镜头），目标锁定/删除时安全降级入库并在后台作业面板提示原因。
    - **#10 完整导出预检与异常显性化**：`preflightSequence` 补齐空视觉、片头、中段、片尾空黑与静音提示；`Dialogs.tsx` 不再吞没预检异常，提供重试入口。
  - **2. 专业 NLE 真 A/B 交叉叠化转场 & 高频体验打磨（#11/#12/#14/#15/#16/#17/#18/#20/#21/#22）**：`Film.tsx` 为相邻同轨转场渲染出画桥接层（有余量播放真实尾帧并交叉淡出原声，无余量用 `Freeze` 稳住末帧，`dissolve/wipe/slide-left/zoom-in/blur` 全程无黑闪，`fade` 为标准 Dip-to-Black）；`splitOperations` 不再向后半段克隆 `transitionIn`；修复适应画布不清空手动排版、滑杆松手单次提交（防刷爆版本历史）、样式继承与演示样例指标分离、中文无空格 `@` 触发与 IME 护栏、按工程记忆界面位置/播放头、空舞台已有素材一键入轨、时间码点击按帧/秒跳转、命令面板空态与后台作业「本工程 / 全部」筛选。
  - **3. 固定红蓝片端到端回归（`npm run test:redblue`）与打包版 6 套全绿验收**：在 `release/0.4/mac-arm64/CoCraft.app` 上全部跑通 `test:unit`、`smoke`、`smoke:models`、`smoke:agent`（含 `allowNetwork=true` 音频合成与本机回环拦截）、`test:redblue`（实测解码验证红蓝代表帧 `(254,0,0)`/`(1,0,254)`、A/B 叠化中点 `(198,0,55)`、静音 A1 保留 V1 同期声 `-24.7 dB` 与独立静音 V1 无声）、`verify_wave_a.mjs` 与 `test:v04`（`823,447 bytes / 5.01s` MP4）。
- **v0.5.6 Wave C 前端架构拆分、统一资产搜索、CSS 去债与 `1080×720` 小屏布局（已通过打包版 8 套全量验收 ✅，耗时约 21 分钟）**：
  - **1. 统一资产搜索与载体分组（Review #13）**：新增共用检索内核 [src/core/catalog.ts](../src/core/catalog.ts)（支持多词 AND、关键词 `keywords`、组件包与载体严格分离），抽离共用 [src/components/PresetControls.tsx](../src/components/PresetControls.tsx)；`AssetExplorer` 补齐关键词检索、实时命中计数条（`命中 N 项`）、零命中空态与一键清空/切全来源/直达「母版库」入口；`ResourceLibrary`（`T` 弹窗）将「摄影与声音」按真实载体明确分为「随附摄影与环境底板」与「随附音效与氛围音」两组，两端检索语义 1:1 对齐；清除 `StoryboardStudio.tsx` 从未传入的死分支 `fullMode`（`725 → 607` 行）。
  - **2. 巨型 `App.tsx` 模块化拆分（`4,133 → 3,365` 行，-768 行）**：抽离纯逻辑模块 [src/lib/workbenchState.ts](../src/lib/workbenchState.ts)（UI 状态持久化、中文 `@/#//` 触发解析、时间码解析、布局预设定义），以及四个独立 UI 模块 [src/components/AgentPanel.tsx](../src/components/AgentPanel.tsx)、[src/components/JobsPopover.tsx](../src/components/JobsPopover.tsx)、[src/components/CommandPaletteModal.tsx](../src/components/CommandPaletteModal.tsx)、[src/components/TranscriptPanel.tsx](../src/components/TranscriptPanel.tsx)，并补齐 `catalog.ts` 与 `workbenchState.ts` 单元测试。
  - **3. 3 套工作区布局预设与 `1080×720` 小屏适配（Review #19）**：顶栏面板控制区与 `⌘K` 命令面板均内置 **「看画面 / 精剪 / 协作」** 3 套工作区布局预设；`window.innerWidth <= 1140` 切入剪辑模式默认收起左栏（实测 `1080×720` 中心舞台宽度由 `524px` 提升至 `802px`），同时通过 `@media (max-width: 1220px)` 收紧三栏上限与 `10px` 裁切手柄，三栏全开仍保留 `586px` 舞台宽且零横向溢出。
  - **4. CSS 去债与权威 `--z-*` 层级标尺**：在 `src/styles.css` `:root` 建立统一 `--z-*` 令牌梯队，将两份样式表全部 **49 处裸数字 `z-index` 归零**；经全仓 AST/正则核查安全清除 228 处 v0.1–v0.3 历史死规则及 60 条阴影重复属性（`src/styles.css` `2,993 → 2,245` 行、`src/workbench.css` `7,033 → 6,518` 行，合计净削减 `1,263` 行；主样式产物收窄至 `145.17 kB / gzip 26.68 kB`）。
  - **5. 打包版 8 套全量验收结果**：`test:unit`、`smoke`、`smoke:models`、打包版 `smoke:agent`、打包版 `test:redblue`、打包版 `verify_wave_a.mjs`、打包版 `test:v04`（`823,563 bytes / 5.01s` MP4）及 Wave C 专项打包验证（含 `1080×720` 双布局实拍视觉复审，0 console/page errors）全部 100% PASS。
- **v0.5.7 创造画布视觉降噪与桌面级交互升级（Option B，已通过打包版 6 套全量验收 ✅，耗时约 25 分钟）**：
  - **1. 端口与连线按需显影**：`.cc-port` 端口圆点默认隐藏（`opacity: 0`），仅在 hover/选中卡片或拖线期间平滑浮现；连线与胶囊默认压轻降噪，仅当关联节点被 hover/选中时高亮浮现于非选中卡片上方（`--z-canvas-pill-active: 15`），静默态完全不拦截拖拽；未聚焦卡片顶栏降噪（`opacity: 0.64`）。
  - **2. 根治卡片叠压、锚点悬空、元数据失准与分区冲突**：新增纯布局与格式模块 [src/lib/canvasLayout.ts](../src/lib/canvasLayout.ts)，自动排格严格避让已保存位置与折叠卡叠（并自动拆解历史叠压坐标），精准匹配 `162px` 卡片渲染高度消除底端连线白点悬空，图片显示 `SVG`/`宽×高` 而非误标 `8.0s`、剥离重复时长与后缀，首行起始纵坐标留足 `104px` 让首行分组标题不再吞并「画布资产」分区栏；右下角新增一键「整理画布排版（Tidy Up）」。
  - **3. 画布与资产仓库解耦、分组双击改名/折叠卡叠与 `Space` 灯箱快看**：`Project` 新增可撤销持久化字段 `canvasHiddenNodeIds`、`CanvasGroup` 新增 `collapsed`，支持按「全部 / 在用 / 仅画面」筛选、单选/多选「移出画布（保留工程资产）」与一键放回；分组支持双击内联改名与一键折叠为三图拼接紧凑卡叠；新增 [src/components/CanvasQuickLook.tsx](../src/components/CanvasQuickLook.tsx)，选中卡片轻按 `Space` 或双击画面即开大图/视频/音频波形快看并支持 `← →` 切换。
  - **4. 打包版全量验收**：`test:unit`、画布 B 方案 7 项打包专项验证（含静默态/折叠卡叠/`Space` 灯箱实拍复审，0 console/page errors）、Wave A、Wave C、`test:v04`（`824,029 bytes / 5.01s` MP4）与 `test:redblue` 全部 PASS。
- **v0.5.8 Milestone 1 — 专业 NLE 关键帧缓动、人声自动闪避、J/L Cut 音画分离与轨道独奏（已通过打包版真机 MP4 解码验收 ✅，耗时约 24 分钟）**：
  - **1. 帧级关键帧引擎（[src/core/keyframes.ts](../src/core/keyframes.ts)）**：支持 `x / y / scale / rotation / opacity / volume / cameraYaw / cameraPitch / explode` 9 类属性与 `linear / ease-in / ease-out / ease-in-out / hold` 5 种缓动曲线，刀片分割自动在切口插值保连续，复合资产跨帧率等比缩放。
  - **2. 属性栏与时间线全链路交互**：新增 [src/components/KeyframeSection.tsx](../src/components/KeyframeSection.tsx)（订阅 `PlayheadClock` 零卡顿、`◀ F<n> ▶` 跳帧步进、SVG 实时曲线预览、一键 `慢推镜 / 缓拉镜 / 横移 / 淡入淡出` 与 `人声闪避 Auto-Duck`），时间线渲染可点击跳转与左右拖拽改时的 `.clip-kf-diamond` 菱形关键帧，属性栏调节已有关键帧属性自动在当前帧写入关键帧。
  - **3. J/L Cut 音画分离与轨道独奏 (`S`)**：`detachAudioFromClipOperations` 一键静音 V1 视频原声并在 A1 生成帧对齐 `timeline` 独立音频片段（同步迁移 `volume` 关键帧，支持属性栏与 `⌘K` 触发）；轨道头新增 `S` 独奏开关（非独奏轨灰显，导出预检主动提示 `solo-tracks-active`），并将 `.track-labels` 扩宽至 `146px` 消除标签截断。
  - **4. 打包版真机 MP4 解码验收**：实机渲染 MP4 经 `ffmpeg` 逐帧核验 `F0 RGB(17,22,28) -> F45 RGB(32,103,252)` 淡入关键帧动画及 `BGM pre=-29dB -> duck=-38.5dB (-9.5dB) -> recover=-29dB` 真实人声闪避降幅，5/5 全绿。
- **v0.5.9 Milestone 2 — Three.js PBR `RoomEnvironment` 棚光、实时 3D 舞台运镜、RoughJS 手绘引擎与画布解耦（已通过打包版视觉验收 ✅，耗时约 20 分钟）**：
  - **1. Three.js PBR 影棚环境光与精密建模**：[src/composition/ThreeStage.tsx](../src/composition/ThreeStage.tsx) 接入 `PMREMGenerator + RoomEnvironment` IBL 环境反射与 `studio / dramatic / soft` 三档布光预设，卸载严格释放 `envRT / envScene / pmrem` 零 WebGL 泄漏，并升级同轴光学组件为高分段金属环与高折射晶体玻璃材质、避免背面遮挡与底栏字幕撞车。
  - **2. 实时 3D 舞台交互运镜联动关键帧**：修复 [src/components/StageOverlay.tsx](../src/components/StageOverlay.tsx) 拖拽 3D 视角时未推送 `onLiveTransform` 导致画面不跟手的问题，同步接入 `soloTracks` 过滤与已有关键帧自动更新。
  - **3. RoughJS 确定性手绘白板引擎**：新增 [src/composition/RoughPrimitives.tsx](../src/composition/RoughPrimitives.tsx)（固定 `seed` 导出零帧闪烁 + `progress` 逐笔绘制动画），通过 `electron/code.ts` 与 `Film.tsx` 开放 `cocraft/rough` 与 `roughjs` 给用户/Agent TSX 组件；重写 `tinycharts-state` 替换损坏 SVG 滤镜并新增 `whiteboard-sketch` 预设（含底部字幕安全区）。
  - **4. `CreateCanvas.tsx` 渐进解耦**：抽离 [src/components/CanvasWiresLayer.tsx](../src/components/CanvasWiresLayer.tsx) 与 [src/components/CanvasUtilityControls.tsx](../src/components/CanvasUtilityControls.tsx)，零回归通过画布与 Wave C 打包验收。
- **v0.6.0 Milestone 3 — 内置受控本地 MCP 服务端、DashScope 生图回退热修与真实云端模型短片《光，没有时间》导演剪辑版验收（已通过打包版与真机实模验收 ✅，耗时约 35 分钟）**：
  - **1. 内置本地 MCP 服务**：新增 [electron/mcp-bridge.ts](../electron/mcp-bridge.ts) 与独立零依赖 stdio 服务端 [scripts/cocraft-mcp.mjs](../scripts/cocraft-mcp.mjs)（22 个工具覆盖工程读写、原子编辑、预设、关键帧、J/L 分离、TSX 编译验画、预览 PNG 帧、预检、MP4 导出、多模态模型生成与内置 Agent 协作）；设置页「通用」新增默认关闭的开关、实时端口状态与一键复制客户端配置；`npm run smoke:mcp` 7/7 通过（含 `0600` 权限、错误 Token 401 拒绝、零 API Key 泄露、真机 PNG 预览与 MP4 导出）。
  - **2. 实模联调发现并修复 DashScope 生图接口回退**：[electron/generation.ts](../electron/generation.ts) 为 `qwen-image-*` 增加 `multimodal-generation` 404 时自动回退 `text2image/image-synthesis` 异步路径的兼容保护。
  - **3. 真实云端模型从零制作短片验收**：通过内置 MCP 在独立新工程中实机调用 **`wan2.6-t2v`**（5.01s 暗房光学棱镜折射视频）、**`qwen3-tts-flash`**（4 段真实中文配音）与 **`deepseek-flash`** 内置 Agent，结合定制编译的闵可夫斯基时空光锥、Three.js PBR 迈克尔逊光学干涉仪、暗曜石 RoughJS 物理三联图、双光圈光子落版尾卡及四段底乐 Auto-Ducking，逐帧视觉复审 5 幕后导出 `36.885s / 1920×1080 / 30fps / 16.88 MB` 真实 H.264/AAC MP4（`light-has-no-time-directors-cut-1080p.mp4`）。
  - **4. 设置页模型选择与手动新增体验升级**：重构 [src/components/SettingsDialog.tsx](../src/components/SettingsDialog.tsx) 与 [src/core/models.ts](../src/core/models.ts)，将裸文本 `模型 ID` 升级为可搜索下拉选择器 + 行内「拉取在线模型列表」+ 一键推荐模型快捷标签（含 `qwen-image-2.0-pro` / `qwen-image-2.0` / `qwen-image-max` / `wan2.6-t2i` 等各厂商按接口匹配的常用模型）+ 自由输入自定义 ID 并自动推断接口适配与默认能力；打包版 Playwright 交互与视觉截图验收通过。
  - **5. 「一核两口」统一工具服务层 + 内置影院级音效重建 & 样片混音重制**：新增 [electron/tool-service.ts](../electron/tool-service.ts) 统一内置 Pi Agent 与本地 MCP 全部 19 项核心能力（消除 `agents.ts` 与 `main.ts` 合计 755 行重复分发代码，内置 Agent 新增 `apply_keyframe_preset` / `detach_audio` / `export_sequence`，MCP 扩至 25 项工具补齐 `cocraft_search_assets` / `cocraft_pull_vault_item` / `cocraft_inspect_media` 并保留内置沙箱与作用域隔离）；重写 [scripts/create-studio-audio.mjs](../scripts/create-studio-audio.mjs) 以粉红噪声状态变量扫频、毛毡电钢/马林巴合成与 Freeverb 立体声混响全面替换原纯正弦测试音，并重制《光，没有时间》样片配乐与转场混音。
  - **6. macOS 正式分发管线（Developer ID 签名 + Apple 公证 + 票据装订，已验收 ✅）**：新增 [scripts/release-mac.mjs](../scripts/release-mac.mjs) 与 [build/entitlements.mac.plist](../build/entitlements.mac.plist)（`npm run package:release`），自动读取钥匙串 `Developer ID Application` 证书与 `notarytool` 凭证（仓库零硬编码密钥），跳过非 Mach-O 语言包冗余签名，以由内而外精准签名 38 个 Mach-O 二进制与 8 个嵌套 Bundle + TSA 瞬断重试完成 Hardened Runtime 签名、DMG 封装、Apple Notarization（`Accepted`）及 `.dmg`/`.app` 双端装订；经 `xcrun stapler validate`、`spctl`（`source=Notarized Developer ID`）及干净挂载 DMG 启动（内置 `ffmpeg/ffprobe` 正常执行、0 控制台/页面报错）全量验收通过。
  - **7. 自有插件式多提供商驱动架构（`electron/providers/`）与「素材工作室」多图/首尾帧升级（已验收 ✅）**：将厂商请求契约从 [electron/generation.ts](../electron/generation.ts) 解耦为纯 Node 驱动模块 `electron/providers/{types,dashscope,ark,minimax,openai,index}.ts`（完整保留 `job.remote` 崩溃续传与 `apiVersion` 持久化、SSRF 与 512MB 流式下载）；在 [src/core/models.ts](../src/core/models.ts) 新增声明式 `modelInputCapabilities(model)` 与三家一键全模态套件——**阿里百炼**补齐 `qwen-image-3.0-pro/edit`、`wan2.7-image-pro`、`z-image-turbo`、`wan3.0-video`、`wan2.7-t2v/i2v/r2v`、`happyhorse-1.1/1.0-t2v/i2v/r2v` 及百炼托管 `kling/kling-v3-*`；**火山方舟**升级 `doubao-seedream-5-5`（多图 + 透明底 PNG）与 `doubao-seedance-2-5/2-0/1-5-pro`；新增 **MiniMax** 协议（国内 `api.minimaxi.com` / 国际 `api.minimax.io`、`MiniMax-H3` v2、`Hailuo-2.3/02` v1 + `files/retrieve` 两步取回、`MiniMax-H3-Image` JSON 多图编辑、`image-01`、`speech-2.8/2.6` hex 解码及 `base_resp` 错误拦截）；「素材工作室」、内置 Agent 与 MCP 工具同步支持 `referenceAssetIds`、`lastFrameAssetId`、`resolution`、`aspectRatio`、`generateAudio`、`background`；`test:unit`、`smoke:models`、打包版 `smoke:agent`、`smoke:mcp` 与打包版 5 屏视觉验收全部 PASS（0 console/page errors）。

---

## Alpha 与实机真实模型回片记录

- **11 月 22 日 · 《光，没有时间 · 相对论短片》（导演剪辑版，经内置 MCP 实模制作）**：在打包版 `CoCraft.app` 上通过本地 MCP 驱动 `wan2.6-t2v` 真实文生视频、`qwen3-tts-flash` 四段真实配音、`deepseek-flash` 内置 Agent 与四套自定义 Remotion/Three.js/RoughJS 组件，完成 5 幕 36.9s 1080p H.264/AAC 成片导出与 5 帧视觉复审。
- **11 月 18 日 · Alpha 用户回片**：用本机 0.4.0 打包应用手动选择 `wan2.6-i2v` 生成 1280×720 / 5s H.264/AAC 素材并完成 `城市清晨` 全流程实录。[回执摘要](../artifacts/alpha-intro/source/video-job.json) · [生成结果](../artifacts/alpha-intro/media/wan.mp4) · [实录与片源](../artifacts/alpha-intro/README.md)

## 下一阶段最小目标

1. **多轨自由增删与关键帧时间线曲线展开抽屉**：支持在时间线片段下方就地展开关键帧值曲线（贝塞尔手柄微调），以及从固定四轨演进到自由命名增删的多层视音频轨。
2. **`CreateCanvas.tsx` 持续拆解与安装包体瘦身**：继续将 `CreateCanvas.tsx` 剩余节点卡片/弹窗拆分为独立模块，并评估精简 Electron 未用小语种 `.lproj` 与去重 `media-tools` 以收窄 DMG 体积。

---

## v0.3 三阶段升级验收清单

### 阶段 ①：根治底座顽疾 + 专业时间线与可交互舞台 + 品牌图标焕新（已验收 ✅）

| 子项 | 核心交付内容 | 验收状态 |
| --- | --- | --- |
| **1A. 品牌图标与工作台视觉焕新** | 重制光学双光圈 `.icns` 应用图标（10 张标准 `.iconset`，零边缘截断）与同源 `BrandMark`；另备 6 款非字母立体图标提案；升级清澈钴蓝 UI 强调色并修复设置折行、Modal 焦点抢占等视觉与交互瑕疵 | **已验收**（实测深浅色主题与 Dock 渲染复核通过） |
| **1B. 零闪屏预览、O(1) 快照索引与安全加固** | 修复 `preview.tsx` 按 `revision` 重建 `<Player>` 闪屏；分离 `.cocraft/revisions-index.json`；静默化内部组件检查作业；补齐 `/render/` CSP、按工程隔离媒体访问、SSRF 拦截、`sandbox-exec` 收紧、Agent `steer` 消息保序、组件写时复制（CoW）与 `scope` 服务端强校验 | **已验收**（`npm run test:unit`、`phase1-ui-check.mjs`、`smoke:models` 全绿） |
| **1C. 像素级专业时间线、全波形与可交互预览舞台** | 时间线改为真实 `px/sec` 无级缩放（突破 400% 上限）+ 自适应 `MM:SS:FF` 帧标尺 + 入出点裁切磁吸 + 实时时间码 HUD + 视频音轨真实波形 + 可调淡入淡出 + `⌘C/⌘V/⌘D` 复制与轨道静音；预览舞台支持暂停态直接拖拽缩放、画布打点引用、补齐 `focalX/Y` 与 `opacity`、快捷键转发；补齐离线素材重连（Relink）、导出预检（Preflight）与会话/成片/资产清理 | **已验收**（`phase1-ui-check.mjs` 与 `test:ui` 全绿） |

### 阶段 ②：双层资产体系（Asset v2）+ 分镜与候选编排台 + 文稿精剪联动（已验收 ✅）

| 子项 | 核心交付内容 | 验收状态 |
| --- | --- | --- |
| **2A. 双层资产中心（Project Vault ⇄ Global Library）** | 落地 `electron/vault.ts` 与 `AssetVaultPanel.tsx`，支持主体一致性锚点（`character` / `product` / `environment`）、媒体与 `.glb` 模型、品牌色板（`brand-kit`）、舞台装置与配方（`recipe`）在项目库与全局个人库双向一键沉淀与引入 | **已验收**（跨项目 A → 全局库 → 项目 B 实测通过） |
| **2B. 双模工作台：分镜编排台与多候选（Takes）** | 顶栏一键零重载切换「舞台剪辑」与「分镜编排」；支持分镜卡预览、前后重排、主体锚点绑定、单镜头多候选（`T1/T2...`）并存对比与零位移切换采用 | **已验收**（`v03-full-check.mjs` 与 `v03-storyboard-studio.png` 验收通过） |
| **2C. 重叠窗口转录、持久化文稿联动与用量统计** | 长音频带 4 秒 Overlap 分块转录与中点去重（防断词、防无音轨崩溃），转录结果持久化至 `.cocraft/analysis/`；文稿面板支持词句检索、一键铺入时间线字幕与单句切片入轨；Agent 面板实时展示 Token 用量 | **已验收**（`test:unit` 与 `smoke:models` 验证通过） |

### 阶段 ③：科普/演示动画「8 合 4」矩阵 + Three.js 3D 舞台与机位预演（已验收 ✅）

| 子项 | 核心交付内容 | 验收状态 |
| --- | --- | --- |
| **3A. Three.js（`@remotion/three`）3D 舞台与 `.glb/.gltf` 资产支持** | 集成 `three`，实现帧级确定性 `ThreeStage.tsx`（同时支持实时预览、预设缩略卡、自定义代码组件与无头导出）及 `.glb/.gltf` 模型导入、包围盒归一化与质心径向爆炸拆解 | **已验收**（自定义 Three.js 组件编译验画 + H.264 MP4 实测导出通过） |
| **3B. 「8 合 4」内置创造 Skill 与精选演示装置库** | 落地 `cocraft-seecode`、`cocraft-tinycharts`、`cocraft-anatomy`、`cocraft-teardown-3d` 四大内置 `SKILL.md` 及对应内置可调舞台装置 + `ScreenFocusRig` 录屏平滑推拉聚焦窗；支持全局与项目级外部 `SKILL.md` 发现 | **已验收**（`v03-full-check.mjs` 与 `v03-three-stage.png` 验证通过） |
| **3C. 3D 机位预演反哺生成（Previs-to-Video）与 Recipe 复用** | 舞台顶栏内置「捕获当前帧为构图参考真值」（`stage.captureReference`），一键将任意 3D 机位或合成画面定格为项目主体参考图资产，直接用于后续分镜图像/视频生成 | **已验收**（`stage.captureReference` 实测渲染入库通过） |

---

## 历史交付记录（保留备查）

- **2026-11-18 · 0.1.0 本地 Alpha**：完成基础工作台、媒体导入播放、标题/SRT 编辑、H.264 导出与 Pi SDK 本地协议夹具验证（耗时约 76 分钟）。详见 [DELIVERY-0.1.md](DELIVERY-0.1.md)。
- **2026-11-18 · 0.2.0 本机交付**：完成提供商与模型目录分离、17 项内置预设、素材包导入与两次真实 DeepSeek 编辑/编码发布（耗时约 62 分钟）。详见 [DELIVERY-0.2.md](DELIVERY-0.2.md)。
- **2026-11-18 · 0.3.0 全栈升级交付**：完成 25 项底座问题根治、双层资产库、双模分镜多候选工作台、Three.js 3D 舞台与「8 合 4」科普演示 Skill 矩阵（耗时约 85 分钟）。详见 [DELIVERY-0.3.md](DELIVERY-0.3.md)。
