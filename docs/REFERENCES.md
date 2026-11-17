# CoCraft 参考资料

调研整理日期：2026 年 11 月 17 至 18 日。优先保存官方入口、相关能力与采用判断，不复制整套第三方文档或代码。依赖的实际版本、能力和分发条件在集成时重新核对。

## 编码 Agent 与 Skill

| 官方资料 | 用于什么 |
| --- | --- |
| [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) | 嵌入、会话、流式事件、追加意见、中断和恢复 |
| [Pi Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) | Skill 发现、按需加载与脚本资源 |
| [Agent Skills 规范](https://agentskills.io/specification) | SKILL.md 格式、依赖与配套目录 |
| [DeepSeek Harness 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) | 插件服务和可替换运行时设计；后续适配候选 |
| [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness) | 版本、当前状态和分发方式 |

当前建议使用一个成熟运行时接通真实闭环；首版不同时维护多个 Agent 实现。标准格式兼容与工具执行环境兼容分别验证。

## 桌面与媒体

| 官方资料 | 用于什么 |
| --- | --- |
| [Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model) | 工作台、主进程、Agent 与媒体作业的分工 |
| [Remotion Player](https://www.remotion.dev/docs/player) | 嵌入可交互视频预览 |
| [Remotion 代码复用](https://www.remotion.dev/docs/player/integration) | 同组件用于预览与渲染；构建配置需要协调 |
| [Remotion renderMedia](https://www.remotion.dev/docs/renderer/render-media) | 固定组件、输入参数、编码与输出 |
| [Remotion Agent Skills](https://www.remotion.dev/docs/ai/skills) | 编码制作、字幕、渲染和项目集成工作流 |
| [Remotion 许可](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) | 使用与分发边界 |
| [Remotion 定价](https://www.remotion.dev/pricing) | 适用许可与产品嵌入成本，不能将依赖当成无条件免费 |
| [FFmpeg 文档](https://ffmpeg.org/documentation.html) | 媒体探测、处理与编码的集成入口；具体命令按实施验证 |
| [AVVideoCompositing](https://developer.apple.com/documentation/avfoundation/avvideocompositing) | 后续原生合成研究；当前不作为首版默认引擎 |

## 工作台与协作体验

| 官方资料 | 借鉴方向 |
| --- | --- |
| [Codex 项目与会话](https://learn.chatgpt.com/docs/projects) | 长期项目、独立任务、共享材料与约定 |
| [Codex Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees) | 独立尝试和工作副本；视频素材应共享，剪辑方案分别保存 |
| [VS Code 布局](https://code.visualstudio.com/docs/configure/custom-layout) | 面板、内容区域、聚焦和布局记忆 |
| [Cursor 修改审阅](https://cursor.com/learn/reviewing-testing) | 观看实际变化、打断、定位和回退 |
| [Apple 动效指南](https://developer.apple.com/design/human-interface-guidelines/motion) | 以反馈和状态连续性为目的的动效 |
| [Fleet 产品方向](https://blog.jetbrains.com/fleet/2025/12/the-future-of-fleet/) | 轻量工作台与 Agent 工作流的背景材料；视觉参考和产品状态分开 |

以上用于交互设计，不代表各产品采用相同技术栈，也不构成性能对比。

## 素材

| 官方资料 | 用于什么 |
| --- | --- |
| [Pexels API](https://www.pexels.com/api/documentation/) | 图片与视频检索、资源标识、平台链接和 API 使用规则 |
| [Pexels 素材许可](https://www.pexels.com/license/) | 素材用途与限制；与 API 规则同时考虑 |

配音、图片与视频生成供应商尚未锁定。音乐与音效必须有对应使用及分发依据，搜索可见或可下载不等于可重新打包为素材库。

## 剪辑产品参考

以下为原 PRD 的调研入口。关注其工作流设计，实际剪辑质量需要同素材评测。

| 产品 | 入口 | 关注点 |
| --- | --- | --- |
| ChatCut | [官方说明](https://chatcut.io/docs/what-is-chatcut) | 对话与可编辑时间线 |
| CapCut | [官方发布](https://www.capcut.com/newsroom/capcut-world-la) | 自然语言编辑和画面选择 |
| Premiere | [Assistant FAQ](https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/assistant-faq.html) | 专业工程中的 Agent 协作 |
| Descript | [Underlord](https://www.descript.com/underlord) | 文稿驱动剪辑与多版本 |
| PilotCut | [官网](https://www.pilotcut.com/) | 本地工作流和可接管编辑 |

## 本地材料与 Skill 入口

- [当前工作台与布局探索](../design/README.md) 已保存在项目目录。
- [历史 PRD](archive/PRD-v0.1-2026-11-17.md) 保留早期范围与估算，可追溯但不作为当前排期。
- 开发环境已有 `/Users/cuiyubao/.agents/skills/remotion-best-practices/SKILL.md`；实际应用集成应锁定需要的 Skill 版本和来源，不依赖开发者个人绝对路径。
- 之前保存的 [Pages PRD](https://chatgpt.com/space/page_061f3c17494c8191afaf6f22c0ddc639) 是旧草案，本次整理未修改远端页面。
