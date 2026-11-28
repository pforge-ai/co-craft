# CoCraft 开发约定

## 产品与协作

- 开始工作先读 `README.md`、`docs/DECISIONS.md` 和本轮涉及的规格。遵循用户最新指令。
- 用户希望由开发 Agent 实现产品，按小时交付可运行增量。将每轮工作切成一个可演示、可验证的结果；记录实际耗时与未完成项。
- 默认沿用已选的“协作工作台”。界面密度、焦点、快捷键、拖放、面板和动效属于功能验收的一部分。
- 保留产品 Agent 的编码、脚本执行和 Skill 生态。不能将它缩减为固定剪辑工具菜单。
- 区分开发本应用的 Agent 与应用内面向用户的 Agent；当前对话的工具、登录态和连接服务不会自动成为产品能力。

## 实现方向

- 当前建议从 Electron、React、TypeScript、Pi、Remotion、FFmpeg 验证；按 `docs/ARCHITECTURE.md` 的模块边界实施，具体版本以首次安装和测试结果锁定。
- 优先做完整的短片闭环，再扩展长素材、多轨和专业能力。保留三类场景共用的工程模型。
- 复用已有框架、SDK、Skill 和媒体工具。性能问题以测量为依据，原生桥只处理已确认的瓶颈。
- 数据、代码组件、组件参数、素材引用和任务记录必须能持久化。普通用户无需编辑源码。
- 不承诺把任意代码无损还原成可视化图层；参数协议之外的效果可以作为有源码的片段使用。

## 编辑与执行

- 原素材保持不变；人工与 Agent 的修改经过统一校验和版本发布入口。
- 检查基线版本、稳定对象标识、选区与锁定。锁定内容还需固定组件和素材版本，避免间接覆盖。
- 播放和导出绑定不可变快照；新代码编译或检查失败时，保留最后可用版本。
- 停止先撤销该次运行的提交资格，再取消模型和后台任务。旧运行不能在稍后返回时继续发布修改。
- 工程状态独立于聊天历史。后台作业持久化，重试前核对外部任务状态。
- 进程隔离不等于文件和网络权限隔离。第三方脚本的执行边界必须实际验证，不用改变工作目录冒充沙箱。
- 项目密钥、凭据、用户原始媒体和私人转录不进入代码仓库。依赖与素材保留来源及适用许可。

## 交付与记录

- 每轮交付：运行入口或构建、可复现步骤、实际验证结果、已知边界、下一项最小目标。
- 原型、模拟响应和真实集成必须明确区分；模型连接未配置时，不用模拟输出冒充执行完成。
- 对编辑命令、恢复、冲突和导出运行必要验证；文案或低风险样式修改只做相称检查。
- 更新 `docs/ROADMAP.md` 中已验收状态。方向改变时更新 `docs/DECISIONS.md`，保留必要历史。
- 与用户保持中文沟通；开发细节写入技术资料，产品主界面优先显示创作内容与结果。
- 每次完成代码修改并通过打包构建（`npm run package`）后，主动关闭旧进程并启动最新的 `release/0.6/mac-arm64/CoCraft.app`（或告知已拉起前台），方便用户直接上手试用查看。

## 发版与安装包（macOS Release）

- **绝不把任何证书（`.p12` / `.p8`）、密码、Apple ID 或团队凭据写入代码仓库或提交历史**；所有云端签名凭据仅通过 GitHub Actions Secrets 注入，本地凭据仅存于 macOS 钥匙串。
- **方式 A · 云端 Tag + GitHub Actions 自动发版（推荐，日常主力）**：
  1. 确保 `package.json` 的 `version` 与目标版本一致，工作区仅提交已验收的干净改动并推送 `origin main`。
  2. 打注解 Tag 并推送：`git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push origin vX.Y.Z`（预发布可用 `vX.Y.Z-rc.1`），自动触发 `.github/workflows/release-mac.yml` 在 `macos-15` 完成 `tsc` / `test:unit` / `smoke` 门禁、`.dmg` 封装、只读挂载校验、`SHA256SUMS.txt` 与 GitHub Release 发布。
  3. 云端公证优先使用 **`.p12` 证书 + App Store Connect API Key（`.p8`，推荐）**，也兼容 **Apple ID + App 专用密码**；若仓库尚未配置 Secrets，工作流会自动回退产出 Ad-hoc `.dmg`。配置方法见 `docs/RELEASE.md`。
- **方式 B · 本地签名公证后上传 Release（证书不出本机）**：
  1. 在干净版本上执行 `npm run package:release`（调用 `scripts/release-mac.mjs`，自动复用本机钥匙串中的 `Developer ID Application` 证书与 `cocraft-notary` 公证凭证，完成 Hardened Runtime 签名、DMG 封装、Apple 公证与双端装订）。
  2. 生成校验文件：`(cd release/0.6 && shasum -a 256 CoCraft-<version>-arm64.dmg > SHA256SUMS.txt)`。
  3. 上传至对应 Tag 的 GitHub Release（在网页 Release 编辑页替换附件，或使用 `gh release upload vX.Y.Z release/0.6/CoCraft-<version>-arm64.dmg release/0.6/SHA256SUMS.txt --clobber`）。
- **发版纪律**：工作区存在并行未提交改动时，禁止 `git add .` 误提交无关 WIP 文件，须精确暂存并通过隔离干净 worktree 或 CI 验证后再打 Tag。
