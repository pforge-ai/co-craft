# CoCraft 迭代与重构计划（ROADMAP）

更新日期：2026 年 11 月 18 日（完成单色 IDE 双模架构重构与打包版 `CoCraft.app` 阻断项清零复验）。

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

---

## Alpha 用户演示与真实模型回片

- 11 月 18 日，用本机 0.4.0 打包应用手动选择 `wan2.6-i2v`，将内置电车参考图提交给阿里百炼。远端作业成功，CoCraft 下载并登记了 1280×720、30 fps、约 5 秒的 H.264/AAC 素材。通过后台作业面板添加到时间线后，实机播放并核对了 150 帧片段。此次实测覆盖图生视频。[回执摘要](../artifacts/alpha-intro/source/video-job.json) · [生成结果](../artifacts/alpha-intro/media/wan.mp4)
- `城市清晨` 的同一脚本在创造画布拆为三镜后进入剪辑工作台；实录验证了字幕编辑、项目 Skill 的保存、试剪分支独立换序、跨项目个人库引入与 MP4 导出。[实录与片源](../artifacts/alpha-intro/README.md)

## 下一阶段演进方向（v0.4 增量 2 最小目标）

1. **PBR 摄影棚高光环境反射（`RoomEnvironment`）与三维零件引线标注**：补充真实金属/玻璃反光反射与 3D 零件交互引出说明。
2. **`roughjs` 真矢量手绘笔触、多段平滑光标推拉与相邻双向交叉叠化**：升级手绘白板推演为真实矢量双描边手绘路径，支持录屏多焦点关键帧推拉与 A/B 双轨交叉叠化/J-L Cut 音频延展。

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

## Alpha 用户演示与真实模型回片

- 11 月 18 日，用本机 0.4.0 打包应用手动选择 `wan2.6-i2v`，将内置电车参考图提交给阿里百炼。远端作业成功，CoCraft 下载并登记了 1280×720、30 fps、约 5 秒的 H.264/AAC 素材。通过后台作业面板添加到时间线后，实机播放并核对了 150 帧片段。此次实测覆盖图生视频。[回执摘要](../artifacts/alpha-intro/source/video-job.json) · [生成结果](../artifacts/alpha-intro/media/wan.mp4)
- `城市清晨` 的同一脚本在创造画布拆为三镜后进入剪辑工作台；实录验证了字幕编辑、项目 Skill 的保存、试剪分支独立换序、跨项目个人库引入与 MP4 导出。[实录与片源](../artifacts/alpha-intro/README.md)

## 下一阶段演进方向（v0.4 最小目标）

1. **交互式 3D 轨道球操控器（Orbit Gizmo）与关键帧曲线编辑器**：在暂停态预览舞台上直接鼠标拖拽旋转 Three.js 3D 相机视角并写入关键帧曲线。
2. **多轨自由增删与 J/L Cut 音画分离微调**：从固定四类语义轨道演进到可自由命名增删的多层视音频轨道与独立音频交叉过渡手柄。

---

## 历史交付记录（保留备查）

- **2026-11-18 · 0.1.0 本地 Alpha**：完成基础工作台、媒体导入播放、标题/SRT 编辑、H.264 导出与 Pi SDK 本地协议夹具验证（耗时约 76 分钟）。详见 [DELIVERY-0.1.md](DELIVERY-0.1.md)。
- **2026-11-18 · 0.2.0 本机交付**：完成提供商与模型目录分离、17 项内置预设、素材包导入与两次真实 DeepSeek 编辑/编码发布（耗时约 62 分钟）。详见 [DELIVERY-0.2.md](DELIVERY-0.2.md)。
- **2026-11-18 · 0.3.0 全栈升级交付**：完成 25 项底座问题根治、双层资产库、双模分镜多候选工作台、Three.js 3D 舞台与「8 合 4」科普演示 Skill 矩阵（耗时约 85 分钟）。详见 [DELIVERY-0.3.md](DELIVERY-0.3.md)。
