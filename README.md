# CoCraft

CoCraft 是一款面向 Apple Silicon macOS 的 **「3D 导演控镜 + 可编程创造 + AI 分镜资产 + 专业多轨剪辑」** 一体化桌面创作工作台（`[创造 | 剪辑]` 双模 + 独立全屏「3D 导演棚」）。你可以直接在点阵无限画布、3D 导演棚和专业多轨时间线上创作，也可以让内置编码 Agent 或外部 MCP 客户端设计画面、调用多云全模态模型、读写项目文件并发布可撤销的剪辑。

当前可运行版本为 **0.6.0**（Wave D 架构减债 + 1 分钟快速配置向导 + 3 分钟首片主线 + 完整版 3D 导演棚 + 双向 MCP + 自由多轨与贝塞尔关键帧曲线），支持 Developer ID 签名与 Apple 公证分发。

## 直接体验

退出旧版后打开 CoCraft。当前本机构建产物位于 [Mac 应用](release/0.6/mac-arm64/CoCraft.app)。

- **3 分钟出首片（零配置即可开干）**：新建空白工程后，从 4 条开箱主线任选其一——① **3D 导演棚 → AI 控镜短片**（摆布景、走线与多机位，录真 MP4 或拍首尾帧/Depth+Normal 直连 AI 重绘）；② **文稿拆镜 · L1 零视频费大片**（2.5D 视差、呼吸运镜、逐词高亮字幕与 FFmpeg 本地去静音/-14 LUFS）；③ **可编程科普 / 动态图解**（RoughJS 手绘白板、数据架构与 TSX 组件）；④ **导入实拍 / 录屏精剪**（自由多轨、真 A/B 叠化与就地贝塞尔曲线）。
- **1 分钟一键配齐 AI 引擎**：点击画布顶部状态条或「设置 → 快速配置」，选一家主力生态（**阿里百炼 / 千问**、**火山方舟 · 豆包**、**MiniMax**、**DeepSeek**、**OpenAI** 或免密钥 **Ollama 本地模型**），填一个 API Key，一键完成推荐全模态模型写入、六类用途默认路由分配与真实在线连通测试。
- **创造画布 & 3D 导演棚**：在无限画布串联文本、演员声纹、设定多状态变体、原位 AI 工坊卡（支持多图融合、首尾帧、动作迁移、换人与对口型）、3D 空间摄影棚与分镜序列；从任意 3D 卡、GLB/3DGS 模型或 TSX 3D 组件一键进入「3D 导演棚」，按 `场景（片场）→ 调度（定机位 / 运镜镜头单）→ 素材（批量拍摄与场景变更重拍）` 组织拍摄。
- **专业剪辑与交付**：支持自由增删命名多轨（视频/声音/字幕）、刀片直切、J/L Cut 音画分离、轨道独奏、片段正下方 1:1 帧对齐贝塞尔关键帧曲线抽屉、成片平行分支（含真 9:16 Auto-Reframe）、内容指纹锁保护重连、导出预检与 H.264/AAC MP4 交付。

[愿景](docs/VISION.md) · [PRD](docs/PRD.md) · [技术架构 v0.6](docs/ARCHITECTURE.md) · [决策记录](docs/DECISIONS.md) · [迭代验收](docs/ROADMAP.md) · [CI 发布指南](docs/RELEASE.md) · [横版样片](artifacts/CoCraft-Phase-Study-1080p.mp4)

## 源码运行

要求 Node.js 22.19+、npm、Apple Silicon Mac（`macOS 13+`，推荐 `macOS 15+`）。

```bash
npm install
npm run build
npm start
```

```bash
npm run dev             # 桌面开发（Vite 热更新 + 自动准备预览与合成 bundle）
npm run test:unit       # 54 组核心领域单测（工程/关键帧/3D导演棚/多轨/快速配置/IPC）
npm run smoke           # 工程编辑、锁定、冲突、撤销重做和重开
npm run smoke:agent     # 本地协议夹具驱动真实 Pi SDK 与沙箱边界，不调用付费模型
npm run smoke:models    # 多厂商协议、SSRF 防护、OSS 直传、入库和作业恢复
npm run smoke:mcp       # 内置本地受控 MCP 服务端（0600 鉴权 + 真机预览与导出）
npm run test:redblue    # 固定红蓝片创作者交付信任回归（像素 RGB 与音轨 dB 实测解码）
npm run test:v04        # 打包版全流程端到端验收与真实 MP4 导出
npm run package         # 构建 Apple Silicon .app（输出至 release/0.6/mac-arm64/CoCraft.app）
npm run package:dmg     # 构建 macOS Apple Silicon DMG 安装包（release/0.6/CoCraft-<version>-arm64.dmg）
npm run package:release # Hardened Runtime 签名 + DMG 封装 + Apple Notarization 公证装订
# 推送版本 Tag（如 git tag -a v0.6.0 -m "Release v0.6.0" && git push origin v0.6.0）即可触发 GitHub Actions 自动产出 macOS .dmg Release，详见 docs/RELEASE.md
```

如果 npm 被全局配置为忽略安装脚本，需要执行 `node node_modules/electron/install.js` 安装 Electron 运行时。

## 核心能力全景（v0.6.0）

| 领域 | 当前实现 |
| --- | --- |
| **工程与版本** | 多项目、成片平行分支树（含 9:16/1:1 Auto-Reframe）、原子快照与 O(1) 索引、撤销重做、内容指纹（SHA-256）锁定重连保护 |
| **创造画布** | 无限画布、三段可折叠语义分区、多选编组/折叠卡叠、4 类聚焦/溯源连线、原位 AI 工坊卡与配方（Recipe）、Animatic 串播、`Space` 灯箱 |
| **空间摄影棚与 3D 导演棚** | 2.5D 立体升维、3D 白模 5 场景/6 动作/6 走线、3D 硬件贴屏、`.glb` 骨骼动画、`.spz/.splat/.ksplat/.ply` 原生 WebGL2 3DGS；全屏导演棚三层模型（片场/镜头单/出片重拍）、2D 俯视雷达图、TSX 3D 零改码接管、Metal GPU 零 Chrome 离屏拍帧与录片 |
| **专业多轨剪辑** | 自由增删/命名多轨、真 A/B 交叉叠化转场、9 属性帧级贝塞尔关键帧曲线抽屉、Auto-Ducking、J/L Cut 音画分离、三路独立音频静音与轨道独奏 `S`、直击舞台 60fps 拖拽与改字 |
| **可编程视觉与生态** | Remotion + Three.js + RoughJS 确定性渲染、TSX 实时编辑与编译验画、三元解耦（`Skill × Style × Component`）、三层资产库（项目/个人/内置）、标准 `SKILL.md` 整目录全局/项目导入 |
| **多云全模态与智能辅助** | 1 分钟快速配置向导；独立插件式驱动直连 **阿里百炼**（Qwen3.5/Qwen-Image 3.0/Wan 3.0 & 2.7/HappyHorse 1.1/Animate Move&Mix/S2V/Kling v3）、**火山方舟**（Seedream 5.5/Seedance 2.5）、**MiniMax**（H3/Hailuo 2.3/Speech 2.8）与 OpenAI/DeepSeek/Anthropic/Gemini/Ollama；默认全关的可选三档 System 1 |
| **双向 MCP 与安全隔离** | 「一核两口」`CoCraftToolService`（20 项核心工具）同时驱动内置 Pi Coding Agent 与 Opt-in 本地受控 MCP 服务端；官方 `@modelcontextprotocol/sdk` 纯 URL MCP 客户端（JSON 配置 + 内联图片/资源预览）；macOS `sandbox-exec` `(deny default)` 沙箱、DNS/IPv6 SSRF 防护与私有 `MessageChannel` |
| **交付与分发** | 导出前全覆盖预检（Preflight）、后台 H.264/AAC MP4 与 PNG 静帧导出、Electron Metal GPU 离屏录片、Developer ID 签名与 Apple 公证 DMG 管线 |

## 代码结构

```text
src/
  core/                 工程模型、多轨、贝塞尔关键帧、空间摄影棚、多云能力、快速配置与检索
  composition/          Player / 离屏 Metal GPU / MP4 共用的 2D / Three.js / RoughJS 合成内核
  components/           时间线、属性、设置与快速配置向导、3D 导演棚、Agent 面板与对话框
  components/canvas/    创造画布模块化组件（工坊卡、镜头卡、实体/资产/组件卡、HUD、Omnibar、起点向导）
  styles/               按域拆分的样式模块（foundation / ide-shell / canvas / inspector-nle / director-studio / quickstart 等）
  lib/                  外部 PlayheadClock、画布避让排版、工作区状态与拖拽工具
  App.tsx               主工作台状态与视图协调
  preview.tsx           零桌面权限的独立预览沙箱页

electron/
  main.ts               桌面生命周期、服务装配、应用菜单与单通道 IPC 入口
  ipc/                  按域拆分的 78 项主进程 IPC 模块（project / media-vault / agent-tasks / skills / stage / asset-ops / system1）
  providers/            纯 Node 多云驱动（dashscope / ark / minimax / openai）
  tool-service.ts       「一核两口」统一工具服务层（内置 Agent 与外部 MCP 共用 20 项核心工具）
  offscreen-capture.ts  Electron 内置 Metal GPU 离屏抓帧、验画与 3D 预演录片引擎
  agents.ts             Pi Agent 宿主、任务并发隔离与停止即吊销提交权
  agent-worker.ts       独立 Pi 进程、软链防护、deny-default 沙箱与受限脚本执行
  mcp-bridge.ts         Opt-in 本地 127.0.0.1 Bearer 鉴权 MCP 桥接服务端
  mcp-client.ts         官方 @modelcontextprotocol/sdk 纯 URL MCP 客户端（Streamable HTTP + SSE）
  store.ts / vault.ts   不可变快照发布指针、O(1) 版本索引与双层内容寻址资产库
  generation.ts / jobs.ts  持久化多模态作业、崩溃续传、SSRF 防护与流式落盘
  render-worker.ts      独立 Remotion MP4 渲染进程
  media.ts / server.ts / settings.ts / system1.ts / packs.ts / code.ts

resources/              应用图标、10 套内置标准 Skills、随附摄影与影院级合成音效
scripts/                构建、签名公证、MCP stdio 服务端与 8 套自动化回归/真机验收脚本
docs/                   愿景、PRD、技术架构 v0.6、决策记录、迭代验收与评审档案
```

## 数据与运行边界

默认工程位于 `~/Library/Application Support/CoCraft/Projects`。原始导入媒体保持不变，工程默认引用原路径；Agent 与工坊生成的媒体、3D 预演录片与抽取帧会自动收集到工程 `assets/` 目录。

API 密钥与 MCP 自定义 Headers 均通过 Electron `safeStorage` 使用 macOS 系统钥匙串加密保存，不写入工程文件、不暴露给外部 MCP 工具。脚本执行与脚本联网默认关闭且按需授权，启用后经 macOS `sandbox-exec` `(deny default)` 限制写入任务工作区并阻断本机回环与敏感目录访问。
