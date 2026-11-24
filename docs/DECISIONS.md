# CoCraft 决策记录

更新日期：2026 年 11 月 24 日（完成自有插件式多提供商驱动架构 `electron/providers/`、阿里百炼新代含 HappyHorse 快乐马/Wan 3.0/Wan 2.7/Qwen-Image 3.0/Z-Image、火山方舟 Seedream 5.5/Seedance 2.5 与 MiniMax 全模态直连，以及「素材工作室」B 方案多图参考与首尾帧升级）。

“已对齐”记录用户明确表达或拍板的方向；“当前建议”保留技术评估方案与待验证条件；“已替代”防止后续沿用旧前提。能力是否已经实现，以 [迭代计划](ROADMAP.md) 的验收记录为准。

## 已对齐

| 日期 | 方向 | 对实现的影响 |
| --- | --- | --- |
| 11 月 17 日 | Mac app，Agent 持续工作，用户随时预览、打断和局部修改 | 工程独立保存，支持固定播放快照、编辑组与人工保护 |
| 11 月 18 日 | UI、动效和操作感参考高水准现代桌面工具 | 布局、密度、快捷键、焦点、拖放和流畅度进入每轮验收 |
| 11 月 18 日 | 由开发 Agent 实现，按可演示、可验证增量交付 | 记录真实耗时和结果，每完成一阶段实机自检过关再交付 |
| 11 月 18 日 | 保留 Agent 编码能力与标准 Skill 生态 | 支持文件、脚本、标准 `SKILL.md` 与可编程画面，不退化为固定剪辑菜单 |
| 11 月 18 日 | **重「生产资产的能力」，去「无意义预制样片」与「内部技术黑话」** | 取消打开即塞假故事样片的做法，改为意图驱动的创作起点向导 + 资产生产工坊；界面清零 `SeeCode`/`Tinycharts`/`Anatomy`/`Teardown` 等内部代号；开箱仅内置纯净高频实用积木（风格变量、外壳、通用母版、3D 棚光、离线音效、解耦 Skill） |
| 11 月 18 日 | **顶层收敛为「IDE 极简无彩色外骨骼 + `[创造 | 剪辑]` 平权双模」，砍掉独立开始页** | 对齐 Codex 与 TapNow 的克制无彩色质感（深色 `#0D0E10`、浅色温润纸灰 `#F8F7F4`、黑白反差主胶囊）；顶栏集成 `[创造 | 剪辑]` 模式切换与右上角 IDE 面板开关（`◧ 左资产栏 / ⬓ 底时间线 / ◨ 右 Agent 栏`）；`创造` 模式采用点阵无限画布（元素/3D/图解节点贝塞尔连线派生 + 结构化分镜序列槽）；`剪辑` 模式支持直接导入与左侧可折叠紧凑资产树，分镜作为一等复合镜头资产双向同步 |
| 11 月 18 日 | **`创作 Skill` × `视觉风格（Style）` × `组件模板（Component）` 三元彻底解耦** | `Skill` 仅定义剪辑/动画方法论与结构规范，不绑死特定配色或固定几块模板；`Style` 独立注入色板/字体/圆角/灯光变量；`Component` 独立提供版式骨架并响应当前 `Style` |
| 11 月 18 日 | **资产采用「客观类型 `Kind` × 创作角色 `Role` × 自由自定义标签 `Custom Tags`」正交标识与关系图谱** | 明确分开图片/视频/音频/组件/三维/风格/Skill 等客观载体与角色/产品/环境/录屏/音效等用途角色；支持完全自由的自定义标签（含 `维度:值` 分面标签）与集合；显式记录实体状态变体、派生血缘（`derivedFrom`）、组件槽位挂载与跨库快照同步关系 |
| 11 月 18 日 | **双树非破坏演进：资产多状态变体树 + 成片平行分支树（Branches）** | 同一角色/环境/组件实体下支持多状态分支（如日常态/雨夜态、横竖屏分支）与版本锁定；成片支持从任意历史版本节点 Fork 实验剪辑分支，支持 Agent 在独立分支安全试剪及多分支对比切换 |
| 11 月 18 日 | **真正的「一镜一卡（Composite Scene Shot）」分镜台 + 统一 `@ / # / /` 引用协议** | 分镜卡按叙事镜头区间聚合合成预览、旁白文案、绑定主体状态与多候选 `Takes`；支持 `@资产:状态`、`#自定义标签`、`/Skill` 及语境感知拖放调用 |
| 11 月 18 日 | **沿用光学双光圈品牌标识，修复切片生成管线** | 保留光学双光圈视觉方案；改用单张 `1024×1024` 母版 + 原生 `sips -z` 等比生成 `.iconset`，消除无头浏览器循环改视口导致的 `128x128@2x` 撕裂与 macOS Tahoe 灰框 |
| 11 月 18 日 | **单一合成内核：`Remotion + Three.js` + FFmpeg** | 统一承载 2D 动态图形、录屏聚焦外壳与可鼠标交互运镜（Orbit）的 PBR 3D 舞台，确保实时预览与无头导出逐帧一致 |
| 11 月 18 日 | **恢复并升级「Figma 三层资产库（当前项目 / 个人库 / 官方内置）× 剪映五分类资源栏」** | 依据用户实际试用深度评审，用剪映式五分类（`媒体 / 音频 / 文本 / 转场 / 组件`）与 Figma 式来源治理（`全部 / 当前项目 / 个人库 / 官方内置`）替代杂乱混合列表；支持实体/媒体/组件 `↑ 个人库` 跨项目复用与 `+ 引入项目`；移除左侧无意义的 4 色风格胶囊条，将画幅比例、底色与 4 套全片换肤风格收入右侧「属性」面板默认无选区时的「成片画布」设置区 |
| 11 月 18 日 | **全界面去 Emoji 专业化、单焦点 AI 动线与信息减法重构** | 全界面清零 Unicode 彩色 Emoji 与装饰星号（统一线性单色矢量图标）；`创造` 模式默认全屏点阵画布与底部唯一 `AI Omnibar`（展开右侧 `Agent` 抽屉时自动退场避让双输入框），横向 `6` 列分镜序列直连 `进入剪辑精修 →`；`剪辑` 模式默认展开左栏与右侧 `属性`（`属性` 在左、`Agent` 在右），时间线移除冗余 `+ 添加` 与 `.selection-bar`，把选中片段上下文与 `引用给 Agent` 归并入单一底部状态栏 |
| 11 月 18 日 | **专业 NLE 剪辑工具集与一等转场效果（Transitions）** | `Clip` 模型正式新增 `transitionIn`（`dissolve / fade / slide-left / zoom-in / blur / wipe`），`<TransitionEnvelope>` 实现渲染与实时预览帧级一致；视觉轨道改用 `Eye / EyeOff` 显隐开关与升序叠加轨编号（`V2/V3/V4`，主镜 `V1`），声音独占静音按钮；新增 `[选择 V | 刀片切割 B]` 点击直切与全片黑底高对比轨道条；舞台采用真实 DOM `[data-clip-box]` 像素测量与 60fps `live-transform` 跟手拖拽 + 首帧可见保护；时间线拆分不依赖 `frame` 的 `React.memo` 轨道树与单 SVG 波形实现播放零卡顿 |
| 11 月 18 日 | **Figma × CapCut Pro 高密度属性栏 & 创造画布全品类资产演化** | 右侧 `Inspector` 升级为 `26px` `ScrubInput` 前缀拖值 + `AlignBar` 六向对齐 + `PropToggleSection` 按需启用描边/背景/阴影/副标题 + `[样式/动效]` 与 `[画面/调节/音频]` 二级属性；`CreateCanvas` 以 `computePrimaryTimelineShots` 保持主镜不因叠字碎片化，并将独立图片、视频与可试听音频/组件卡统一纳入画布资产区与血缘连线；`.toast` 上移至顶部标题栏下避让底部 Omnibar 输入框 |
| 11 月 18 日 | **TapNow 原生画布交互 × 高频时钟时间线解耦 × 多选编组/素材包与剪辑资产沉淀（v0.5.2）** | ① 移除创造画布左悬浮条 `.cc-float-rail` 与拆解模态框，改为底部 `( + )` FAB + 右键菜单 + Drop-to-Create + 画布内联可编辑文本节点（`entityKind: 'text'`）+ 右下三合一胶囊 + 全向连线；② 新增统一取消选中（点空白/`Esc`）与多选框选/`Shift/⌘+Click`（支持 `@ 添加到对话`、`⌘G 成组`、`打成素材包` 个人库/离线 `cocraft-pack.json`、`建立关联`、`串入时间线`、`存为资产`）；③ 建立独立外部 `PlayheadClock` 驱动播放头 `translate3d` 与独立 `<PlayheadTimecode>`，`rAF` 节流预览 `seek` 并冻结搓擦期间的 `measureVisibleBoxes`，彻底消除时间线拖动/播放卡顿；④ 对齐 macOS `38px` 顶栏红绿灯（`y: 13`），移除双层焦点轮廓、`input[type="range"]` 粗滑条与底部 `.composer-note`，`Inspector` 全量收敛至 `24px` 精度（单行填充+不透明+混合）；⑤ 新增 `AudioWaveformPlayer` 单色可拖拽进度音频试听组件与 `compound` 精剪资产沉淀（`createCompoundVaultItemFromClips` / `instantiateCompoundVaultItemOperations`），支持将裁剪与调色转场后的时间线选区回存至资产库并跨项目封装 |
| 11 月 18 日 | **阿里百炼 / 千问全模态可扩展接入 × 可视化 Skill 工作台 × 对话与画布交互深化（v0.5.3）** | ① 在 `ProviderConnection['protocol']` 中抽象原生+兼容双模路由协议 `'dashscope'`（及可复用 `providerModelSuites` 推荐模型套件注册表），一个连接与 API Key 同时打通千问对话/视觉（`/compatible-mode/v1`）、千问生图/万相生图（`dashscope-image`）、万相文生/图生视频异步任务及崩溃恢复（`dashscope-video`）、千问 TTS 语音合成（`dashscope-speech`）与本地音视频切片 Base64 直传 ASR 转录（`dashscope-transcription`），后续扩展新云厂商仅需注册套件与适配器；② 开放设置页 `Skills 与工具` 工作台（项目/全局/内置三层优先级加载、`cocraft-multimodal` 全流程 Skill、内置派生覆盖、自定义 `SKILL.md` 新建/导入/编辑/常驻开关）；③ 废弃原生系统 `<select>`，重构 Agent 自定义单色会话弹窗、紧凑无间距模型选择器、可调思考深度（`off/low/medium/high` 直通 Pi SDK）、剪贴板/拖放/选择多模态附件与圆形发送按钮，并以 `AgentThread` 折叠思考过程、顺序配对工具执行时间线及可点击时间码增强会话可读性；④ 重构画布全向自适应 4 向端口连线、全卡表面拖拽（节点层级置于线标签层之上防止斜线遮挡）、去除画布属性冗余 `成片视觉风格` 4 张模板卡并修复全局 `.switch` 滑块溢出 |
| 11 月 22 日 | **暂停新功能扩张，按路线 C 执行三波次稳定化、专业 NLE 对齐与还债** | 暂缓 PBR `RoomEnvironment`、`roughjs`、关键帧曲线等新特性，先收口三波次：① **Wave A（止血与安全封口）** 封堵 P0 安全/沙箱/SSRF/MediaServer/预览通道与 DashScope/3D/UI 高危阻断；② **Wave B（创作者交付信任 + 专业 NLE 标准）** 清零 11/18 评审前 10 项并按专业剪辑软件标准改造转场（真 A/B 交叠）、统一创造/剪辑单一分镜模型、明确音频附着模式（`随镜` vs `固定时间线`）与三路音频独立静音，落地固定红蓝片端到端回归；③ **Wave C（前端架构与 CSS 减债）** 统一 `AssetExplorer` / `ResourceLibrary`、拆分 `App.tsx` 并收拢冗余样式与 `z-index` 层级体系 |
| 11 月 22 日 | **专业 NLE 关键帧曲线、J/L Cut 音画分离与轨道独奏（Milestone 1）** | `Clip` 新增 `keyframes` 帧级曲线（支持 `x / y / scale / rotation / opacity / volume / cameraYaw / cameraPitch / explode` 与 `linear / ease-in / ease-out / ease-in-out / hold` 5 种缓动），时间线渲染可拖拽菱形关键帧，内置一键 Ken Burns 与人声闪避（Auto-Ducking），刀片分割与跨帧率复合资产无缝保持曲线连续；新增视频 J/L Cut 一键音画分离（原视频静音并在 A1 生成帧对齐独立时间线音轨）与轨道独奏 `S`（含导出预检提醒） |
| 11 月 22 日 | **Three.js PBR `RoomEnvironment` 环境光、实时 3D 舞台交互运镜与 `roughjs` 确定性手绘引擎（Milestone 2）** | `ThreeStage.tsx` 全量接入 `PMREMGenerator + RoomEnvironment` IBL 环境反射及 `studio / dramatic / soft` 三档布光预设（卸载严格释放 GPU 纹理防 WebGL 泄漏）；`StageOverlay.tsx` 打通 3D 实时 `live-transform` 拖拽旋转并自动写入已有关键帧；引入 `roughjs` 与固定 `seed` 确定性 SVG 渲染原语 `RoughPrimitives`（同步开放 `cocraft/rough` 与 `roughjs` 给用户/Agent TSX 组件），升级 `tinycharts-state` 并新增 `whiteboard-sketch` 预设 |
| 11 月 22 日 | **内置 Opt-in 本地受控 MCP 服务端（Milestone 3）** | 在设置页提供默认关闭、用户按需启用的本地 MCP 桥接服务（`electron/mcp-bridge.ts` + 独立零依赖 stdio 服务端 `scripts/cocraft-mcp.mjs`）：仅监听 `127.0.0.1` 随机端口、32 字节随机 Bearer Token 以 `0600` 权限落盘 `<userData>/mcp-bridge.json`（退出自动清理）、`timingSafeEqual` 鉴权、零 API 密钥暴露，全部编辑经统一 `ProjectStore` 版本锁与实时 UI 推送；外部 MCP 客户端可直接协同创作、预览帧、编译 TSX、调用已配置模型并导出 MP4 |
| 11 月 22 日 | **「一核两口」统一工具服务层（`CoCraftToolService`）与内置影院级音效重建** | 消除内置剪辑 Agent（`electron/agents.ts`）与外部 MCP（`electron/main.ts`）的能力漂移，统一收拢至 `electron/tool-service.ts` 共享 19 项核心工具实现：内置 Agent 走进程内 IPC 保留 `run.scope` 严格隔离、停止即撤销提交资格与 `sandbox-exec` 封死本机回环的安全边界（同步补齐 `apply_keyframe_preset` / `detach_audio` / `export_sequence`），外部 MCP 作为轻薄适配器自动对齐 `search_assets` / `pull_vault_item` / `inspect_media`（25 项工具）；同步重写 `scripts/create-studio-audio.mjs` 彻底淘汰纯正弦占位音，升级为粉红噪声带通扫频、毛毡电钢/马林巴与 Freeverb 立体声混响 |
| 11 月 24 日 | **自有插件式多提供商驱动层（不接 fal / 不引入重封装 SDK）× 声明式模型能力 × B 方案多图/首尾帧** | 保留 CoCraft 作业持久化、`remote.id` 崩溃续传、SSRF 防护与流式下载底座，将厂商协议从 `electron/generation.ts` 拆分为纯 Node 独立驱动 `electron/providers/{dashscope,ark,minimax,openai}.ts`；新增纯函数 `modelInputCapabilities(model)` 统一驱动前端表单与后端校验；官方直连升级 **阿里百炼**（Qwen-Image 3.0/2.1/Edit、Wan 2.7 Image、Z-Image Turbo、Wan 3.0、Wan 2.7、**HappyHorse 1.1/1.0 快乐马**、百炼托管可灵 v3）、**火山方舟**（Seedream 5.5/5.0/4.5 含多图与透明底 PNG、Seedance 2.5/2.0/1.5）与新增 **MiniMax**（国内/国际双区、H3 v2、Hailuo 2.3/02 v1 两步取回、H3-Image、image-01、Speech 2.8/2.6、M2.5/M2.7）；「素材工作室」、内置 Agent 与 MCP 工具同步支持多图参考（`referenceAssetIds`）、视频首尾帧（`lastFrameAssetId`）、清晰度/画幅比例、原生音画同步与透明底 PNG |
| 11 月 25 日 | **A+B 光学微光系统（暗房银白液态玻璃 + AI 活跃态棱镜流光，1–5 部位全落地）** | 新增独立样式层 `src/optical-light.css`（纯 GPU 合成与 CSS 变量，预览画面内零染色、时间线 60fps 零重绘）；静态全局采用暗房银白液态玻璃 `1px` 顶边折射、画布暗房纵深、节点光标追随镜面高光与舞台外缘微晕，仅在 AI 输入聚焦/思考/云端生成时触发 Apple Intelligence 风格 `1px` 旋转棱镜流光与 SVG 连线光脉冲，并在完成 Toast 与主操作按钮叠加瞬态扫光；设置页「外观」新增持久化且即时预览的 **「界面光效（关闭 / 细腻 / 灵动）」** 与 **「光效动画」** 开关（同步遵循系统 `prefers-reduced-motion`） |

## 已替代的前提

- “创造画布保留左悬浮工具胶囊与独立拆解文稿弹窗、仅支持单一绑定与基础下拉选单”已被替代为 **TapNow 式底部 `( + )` FAB + 右键与拖线菜单 + 内联文本节点 + 多选浮动条 / 空间分组 / 万能节点端口**。
- “通过根组件 `frame` React state 每帧重绘时间线与播放时间码、以及使用浏览器默认焦框/原生 range slider”已被替代为 **外部 `PlayheadClock` 零重绘播放头与 `24px` Figma `ScrubInput` + 自定义 `2px` 细轨滑条**。

- “移除跨项目个人库并把 4 套视觉风格平铺在左侧顶部胶囊栏”已被替代为 **Figma 三层资产库（当前项目 / 个人库 / 官方内置）× 剪映五分类左栏 + 无选区「成片画布」属性面板**。
- “允许创造模式下双 AI 输入框并存、时间线堆叠 `+ 添加` 与双底栏 `.selection-bar`、界面内出现装饰性 Emoji/星号”已被替代为 **单一焦点动线、全单色线性图标与精简单一状态栏**。

- “用预制故事样片（如《沿海公路》《相位之间》）或虚构人物卡作为默认开局体验”已被替代为**意图驱动创作起点 + 纯净实用基础积木 + 用户自产资产工坊**。
- “把资产库塞进静态表单侧栏”、“把开始/资产/分镜/剪辑割裂成四张独立页面”以及“把底图与同时间段叠字拆成并列分镜卡”已被替代为**单色专业 IDE 外骨骼 + `[创造 | 剪辑]` 双核模式（点阵无限画布连线 + 剪辑内可折叠高密度资产树）与无间隙「一镜一卡」合成分镜**。
- “把图片/视频与角色/产品混在同一层分类”及“把剪辑流派、配色和固定模板强绑死为一个包”已被替代为**三层正交标识（`Kind × Role × Custom Tags`）与三元解耦（`Skill × Style × Component`）**。
- “单线程线性成片版本与扁平单文件资产”已被替代为**资产多状态变体树 + 成片平行分支树**。
- “0.2 石墨深色底座单色 C 图标”及“无头浏览器循环缩放截图生成 `.iconset`”已被替代。

## 历史实现记录（保留备查）

- **0.1 本地 Alpha（11 月 18 日）**：锁定 Electron 45.3.3、React 19、Pi 1.5.2、Remotion 4.0.544；跑通 JSON 快照发布指针、独立预览 frame、基础剪辑导出与 Pi 本地协议夹具验证。
- **0.2 本机交付（11 月 18 日）**：实现提供商与模型分离目录、六类用途路由、17 项内置预设、离线素材包导入与 DeepSeek 实模工具链调用。
- **0.3 首轮探索与实机复盘（11 月 18 日）**：完成 `<Player>` 零闪屏、O(1) 版本索引、像素级时间线、画布 2D 拖拽、基础双层资产与 Three.js 首版集成；实机走查识别出窄栏拥挤、技术黑话外露、分镜颗粒度错位、3D/图解质感单薄、Agent 闲聊乱调工具及 `.icns` 128@2x 切片撕裂问题，据此重对齐形成 [PRD v0.4](PRD.md)。
