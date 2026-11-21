# CoCraft 技术架构（v0.3）

更新日期：2026 年 11 月 18 日。状态：v0.3 架构升级设计（承接 0.1/0.2 已落地底座，系统性解决 25 项审查问题并扩展双层资产、分镜候选与 2D/3D 可编程舞台）。

---

## 一、 核心架构原则

1. **单一确定性合成内核（Single Remotion + Three.js Kernel）**
   - 预览（`@remotion/player`）与导出（`@remotion/renderer`）100% 共享同一套 React 合成树：普通音视频、字幕包装、类 `open-slide` 分步演示页、录屏平滑推拉聚焦（`ScreenFocusRig`）、2D SVG/Canvas 科普图解（`SeeCode`/`Tinycharts`/`Anatomy`），以及基于 `@remotion/three` 的 Three.js 3D 拆解与 `.glb` 模型场景，全部由 `useCurrentFrame()` 帧级确定性驱动。
   - 不引入冗余的第二套幻灯片框架，也不在桌面端自研高权限负担的系统录屏采集器。
2. **双模同源状态（Dual-Mode, Single Source of Truth）**
   - 「分镜与资产编排台（Storyboard Mode）」与「舞台时间线（Timeline Mode）」读写同一个不可变 `Project` 快照中的 `Sequence`、`Shot` 与 `Clip` 结构，绝不维护两份脱节的数据副本。
3. **双层内容寻址资产库（Project Vault ⇄ Global Asset Library）**
   - 媒体文件、3D 模型（`.glb/.gltf`）、音频波形、转录结果与编译后的代码组件均采用内容哈希（SHA-256）寻址存储；版本快照（Revision）只存轻量引用与元数据，实现毫秒级保存、撤销与零闪屏预览更新。
4. **严格的执行、范围与安全边界**
   - 所有人工与 Agent 修改统一经 `ProjectCore` 校验基线版本、锁定状态、**选区范围约束（Scope Enforcement）** 与跨成片组件 **写时复制（Copy-on-Write）**。
   - 预览与导出渲染进程均强制施加 CSP 与按工程隔离的媒体访问令牌；脚本沙箱与远程下载严格执行最小权限与防 SSRF 校验。

---

## 二、 六大核心模块

### 1. Workbench（双模桌面工作台 · `src/`）
- **Dual-Mode Shell**：管理顶栏模式切换（分镜编排台 / 舞台时间线）、左侧双层资产树、右侧 Agent 与全量属性面板（Inspector）。
- **Interactive Stage Overlay（画布直接操控层）**：位于预览 iframe 上方的透明矢量交互层，暂停时映射合成坐标系（如 `1920×1080`）与视口缩放比，支持点击选中当前帧可见片段、拖拽平移（`x, y`）、控制柄缩放（`scale`）、焦点十字准星（`focalX, focalY`）及打点批注（Canvas Pin 引用给 Agent），同时将键盘事件无缝转发回主工作台，彻底解决 iframe 吞焦点问题。
- **Precision Timeline**：基于真实时间比例尺（`pxPerSecond`，支持大跨度缩放与滚轮缩放）、动态帧率标尺（`MM:SS:FF`）、双端裁切磁吸（Trim In/Out Snap）、音视频全波形绘制与轨道静音。

### 2. ProjectCore（工程、分镜与约束引擎 · `src/core/` & `electron/store.ts`）
- **统一工程模型（Schema v2，向下自动迁移 v1）**：
  - `Project`：包含 `assets`（项目资产清单）、`brandKit`、`components`、`recipes`、`sequences`。
  - `Sequence`：包含 `clips`（时间线精确片段）、`shots`（可选分镜卡列表：记录叙事目标、绑定主体资产 ID、候选列表 `takes[]` 及当前激活 `activeTakeId`，与对应时间区间的 `clips` 双向关联）及 `mutedTracks`。
- **强约束校验器（`validateAndApply`）**：
  - **Scope 强校验**：当 Agent 运行携带 `EditScope`（指定 `sequenceId`、`clipIds` 或帧区间）时，越界修改直接拒绝并返回结构化冲突说明，引导 Agent 在授权范围内重算。
  - **组件 Copy-on-Write**：当修改已被其他成片（如竖版）或锁定片段引用的 `CodeComponent` 时，自动派生新组件版本 ID 更新目标片段，绝不静默污染其他成片。
  - **智能波纹编辑**：`deleteClip(ripple: true)` 仅平移同轨或关联组下游片段，遇跨切点长背景音乐保持不动，遇下游锁定片段提前报错保护。
- **O(1) 轻量版本索引**：`.cocraft/head.json` 维护指针，`.cocraft/revisions-index.json` 维护全量版本摘要列表；`envelope()` 无需再遍历解析历史全量快照文件。

### 3. AssetVault（双层资产与重连服务 · `electron/vault.ts` & `electron/media.ts`）
- **双层目录结构**：
  - 全局库：`~/Library/Application Support/CoCraft/Library/`（`catalog.json` + `blobs/` + `rigs/` + `recipes/`）。
  - 项目库：`<project>.cocraft/assets/` 与 `.cocraft/analysis/`。
- **全媒体探测与离线重连**：
  - `importMedia` 统一探测 `hasAudio`、帧率、色彩信息，并为**所有含音轨的视频和音频**生成缓存波形。
  - 每次打开工程或导出前执行轻量 `stat` 在线核验，标记 `offline: true` 的外部引用资产，提供按文件名/大小/哈希快速重连（Relink）入口。

### 4. Stage & RenderHost（2D/3D 合成与预检渲染引擎 · `src/composition/` & `electron/render-worker.ts`）
- **无缝热更新预览（Zero-Flash Player）**：
  - `preview.tsx` 仅以 `sequenceId`（及组件崩溃恢复计数）作为 `ErrorBoundary` 的 key，不再使用 `revision` 作为 key，使 `<Player>` 在连续调参、拖动时间线和文案编辑时保持挂载、零闪烁实时响应。
- **2D + Three.js 3D 统一舞台**：
  - 内置 `react`、`remotion`、`three`、`@remotion/three` 运行时模块注入，供内置装置、素材包与 Agent 编译的 TSX 组件直接 `import` 使用。
  - 支持加载工程内的 `.glb` / `.gltf` 资产（通过受控 `assetUrl(id)`），提供标准 `CameraRig` 与 `ScreenFocusRig` 辅助原语。
- **静默校验与导出前预检（Preflight）**：
  - 内部 `validateComponents` 使用独立内存通道渲染候选静帧，**不再写入用户可见的 `jobs.json` 列表**。
  - 正式导出前运行 `preflightCheck(project, sequenceId)`，集中报告离线资产、未填充的分镜占位（Placeholder）、首尾黑场空洞与超界片段。

### 5. AgentHost & Skill Matrix（编码与创作代理宿主 · `electron/agents.ts` & `electron/agent-worker.ts`）
- **内置「8 合 4」Skill 包（`resources/skills/`）**：
  - `cocraft-editing`（工程协议、资产与分镜操作、约束遵守）
  - `cocraft-seecode`（数据图表、系统架构与分步演示甲板）
  - `cocraft-tinycharts`（手绘等轴测与状态机推演）
  - `cocraft-anatomy`（等轴测精密剖面、生物/工程机制与实时遥测面板）
  - `cocraft-teardown-3d`（Three.js 爆炸拆解、机械运转、产线沙盘与 3D 机位预演）
  - `remotion-best-practices`（帧确定性动画与合成规范）
- **严格流式消息时序与中断**：
  - 当运行中收到 `steer`（补充指令）时，先将当前已流式产出的 `assistant` 文本段封存落盘，再追加用户的 `steer` 消息，保证持久化历史严格按真实时间顺序排列。
- **用量统计**：解析并累计每次模型响应的 `usage`（input/output tokens）与生成作业次数，持久化到 `Task` 与项目统计中。

### 6. Security & Sandbox Layer（安全隔离层）
- **同源与 CSP 加固**：`MediaServer` 同时为 `/ui/preview.html` 和 `/render/index.html` 下发严格 CSP（`connect-src 'self'`，禁止一切外网连接）；媒体路由按当前活跃工程白名单校验资产归属，防止第三方组件枚举跨工程文件；`postMessage` 显式绑定目标 `origin` 而非 `'*'`。
- **SSRF 防护**：远程生成产物下载器（`download()`）解析主机名并拒绝回环地址（`127.0.0.0/8`、`::1`、`localhost`）、链路本地与私网段（除非用户显式标记为本地模型连接端点）。
- **收紧 `sandbox-exec`**：脚本执行配置改为显式只读系统运行库路径 + 当前任务工作区读写，禁止读取 `/Volumes`、`/tmp` 全局目录及其他用户敏感挂载区。

---

## 三、 工程目录结构演进（Schema v2 兼容 v1）

```text
my-project.cocraft/
  project.json                  可读工程镜像（Schema v2，自动兼容打开 v1）
  brief.md                      创作目标、受众与风格约定
  assets/                       收集的生成媒体、3D 模型（.glb）与随附资产
  components/                   独立 TSX 组件与导入的素材包源码快照
  recipes/                      本项目保存的可复用工作流配方
  skills/                       项目级自定义或外部导入的标准 SKILL.md
  exports/                      MP4 成片、PNG 静帧与 SRT 字幕导出
  .cocraft/
    head.json                   唯一原子发布指针（current / undo / redo）
    revisions-index.json        轻量版本历史摘要索引（O(1) 读取）
    revisions/                  不可变工程版本快照
    analysis/                   峰值波形（音频+视频）与持久化转录分段缓存
    workspaces/                 各 Agent 任务的隔离工作副本
    sessions/                   Pi 会话上下文与用量记录
```
