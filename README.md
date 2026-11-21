# CoCraft

CoCraft 是一款 macOS 视频创作与剪辑协作工作台（`[创造 | 剪辑]` 双模）。你可以直接操作无限节点画布与专业时间线，也可以让编码 Agent 设计画面、调用全模态模型、读写项目文件并发布可撤销的剪辑。当前可运行版本为 **0.4.0**（v0.5.4 Wave A 加固版），面向 Apple Silicon。

## 直接体验

退出旧版后打开 CoCraft。已有用户会打开最近使用的工程，旧模型连接会自动迁移。当前本机构建产物位于 [Mac 应用](release/0.4/mac-arm64/CoCraft.app)。

- 用空格播放示例，在横版和竖版标签之间切换。选择片段后在右侧调整文案、颜色或时间。拖动左右面板和时间线边界可调整工作空间。
- 在时间线点击「添加」，从 17 项动态素材、三张原创生成摄影和四段原创声音中选择。库内可试听、横竖版预览和改参数。导入源码素材包后还可以继续使用它的资源和参数。
- 点击「新会话」并直接输入想做的修改。会话从首条指令自动命名。也可以先选中一个片段，在属性里「引用给 Agent」。
- 在「设置 → 提供商」保存连接，在「模型」登记模型与能力，在「用途默认值」选择全局或项目默认。通过「素材 → 素材工作室」配音、转录、分析画面或生成图像与视频。
- 用「导出」渲染当前版本。后台生成的素材可入轨，转录结果可对齐源片段生成字幕。

[交付与验收](docs/DELIVERY-0.2.md) · [横版样片](artifacts/CoCraft-Phase-Study-1080p.mp4) · [竖版样片](artifacts/CoCraft-Phase-Study-vertical.mp4) · [工作台实拍](docs/verification/v2/v02-workbench-dark.png)

## 源码运行

要求 Node.js 22.19+、npm、Apple Silicon Mac。当前包体目标为 macOS 15+。

```bash
npm install
npm run build
npm start
```

```bash
npm run dev          # 桌面开发；首次自动准备预览与合成 bundle
npm run smoke        # 工程编辑、锁定、冲突、撤销重做和重开
npm run smoke:agent  # 本地协议夹具驱动真实 Pi SDK，不调用付费模型
npm run smoke:models # 本地多媒体协议、入库和作业恢复
npm run test:ui      # 独立临时工程的 Electron 功能验收
npm run package     # 构建 Apple Silicon .app
```

开发模式下工作台支持 Vite 热更新；修改预览组件、桌面服务或渲染入口后重新构建/启动。打包后不需要 Node.js。媒体工具随包分发。导出优先使用本机 Chrome / Chromium；没有浏览器时，Remotion 会下载渲染浏览器到应用缓存。

如果 npm 被全局配置为忽略安装脚本，需要执行 `node node_modules/electron/install.js` 安装 Electron 运行时。项目未改变你的全局 npm 配置。

## 已实现的闭环

| 工作 | 当前实现 |
| --- | --- |
| 工程 | 多项目、独立成片、任务对话、创作约定、原子版本发布、撤销重做、版本恢复、关闭重开 |
| 剪辑 | 本机素材导入、拖放、移动、裁切、分割、复制、删除/波纹删除、锁定、画幅副本 |
| 预览 | 实际 Remotion Player、逐帧跳转、镜头导航、音量、播放中的版本固定 |
| 文字 | 标题/下三分之一/字幕，参数编辑，按帧动画，SRT 导入导出与文稿编辑 |
| 编码 | TSX 编辑与编译，参数化代码片段，标准 Skills，Pi 文件工具与可选受限脚本 |
| 素材 | 参数化画面、随附摄影与音频、带来源的 Pexels 视频、可导入的源码包 |
| 模型 | 分离的提供商和模型目录、六类用途、项目与全局默认值、生成作业和结果 |
| 交付 | 后台 H.264/AAC MP4、PNG 静帧、进度/取消、固定导出版本、完成后打开 |

DeepSeek 实际通过工具读取示例工程、制备模板并发布了指定时间段的片段。云端媒体接口使用本地协议服务、真实媒体文件、Pi 和 Electron 验收。按供应商协议与账号可调用范围登记模型。[真实剪辑记录](docs/verification/v2/deepseek-edit.json) · [模型服务](docs/MODEL-SERVICES.md) · [素材包和生态](docs/MATERIAL-ECOSYSTEM.md)

## 代码结构

```text
src/
  core/             工程模型、编辑操作、校验与差异
  composition/      Player 与 MP4 共用的画面定义
  components/       时间线、属性、对话框及基础 UI
  App.tsx           工作台交互与状态协调
  preview.tsx       不含桌面权限的独立预览页
  styles.css        Graphite / Paper 工作台样式与动效

electron/
  main.ts           桌面生命周期、文件选择与窄 IPC
  store.ts          项目、不可变快照与发布指针
  agents.ts         Pi 生命周期、任务与发布授权
  agent-worker.ts   独立 Pi 进程、工具、Skill 与脚本执行
  jobs.ts           持久化作业与取消
  render-worker.ts  独立 Remotion 导出进程
  media.ts          媒体探测、缩略图、真实音频波形
  code.ts           TSX 组件构建适配器
  server.ts         有随机令牌的本机媒体/预览服务
  settings.ts       模型目录、默认路由与加密凭据
  generation.ts     视觉、生成、配音与转录协议
  packs.ts          素材包验证、依赖快照与导入
  studio-media.ts   随附摄影与声音入库

resources/          原创示例、应用图标、内置 Skills
scripts/            构建、开发与必要 smoke / 功能验收
artifacts/          可观看的实际导出
release/            本机 .app 构建产物（不进 Git）
docs/               产品、架构、迭代与验收材料
design/             早期设计原型与截图，保留作对照
```

## 数据与运行边界

默认工程位于 `~/Library/Application Support/CoCraft/Projects`。在命令面板中「打开工程文件夹」即可访问。原始导入媒体保持不变；工程默认引用其原路径，因此移动原文件前请保留副本。Agent 新生成并登记的媒体会收集到工程素材目录。

密钥通过 Electron safeStorage 使用 macOS 系统能力加密，不写入工程。没有自动读取 Codex 的登录态。Agent 默认可在任务工作区编辑源码；脚本执行和脚本联网分别在设置中启用。脚本写入被限制在任务工作区，已发布工程通过受控发布入口修改。第三方任意扩展的完整安全兼容性仍需逐项验证。

0.2 的 Apple Silicon 包使用本地 ad-hoc 签名。公开分发还需 Developer ID 签名、公证、更新渠道和相应的商业分发许可。[分发记录](docs/THIRD_PARTY.md)

## 产品材料

[愿景](docs/VISION.md) · [PRD](docs/PRD.md) · [架构](docs/ARCHITECTURE.md) · [决策](docs/DECISIONS.md) · [迭代记录](docs/ROADMAP.md) · [素材与 Skills](docs/ASSETS_AND_SKILLS.md) · [官方参考](docs/REFERENCES.md) · [设计原型](design/README.md)
