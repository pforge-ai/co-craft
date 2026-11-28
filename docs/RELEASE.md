# CoCraft macOS 发布指南（云端 CI 自动发版 & 本地公证上传）

CoCraft 支持两种 macOS Apple Silicon（`arm64`）正式安装包（`.dmg`）发布方式，共用同一套打包与签名公证内核 [scripts/release-mac.mjs](../scripts/release-mac.mjs)：

| 维度 | 方式 A：云端 CI 自动签名与公证（行业标准，推荐） | 方式 B：本地公证后上传（证书不出本机） |
| --- | --- | --- |
| **触发成本** | 一行 `git push origin vX.Y.Z` 全自动出公证版 `.dmg` | 需在本机跑 `npm run package:release` 后上传 |
| **构建环境** | GitHub `macos-15` 干净环境（不受本机残留/WIP 影响） | 依赖本机环境与钥匙串 |
| **凭据存放** | GitHub Encrypted Secrets（运行结束自动销毁临时钥匙串） | 仅存本机 macOS 登录钥匙串 |
| **适合场景** | 持续迭代、多人协作、标准 CI/CD 发布 | 个人短期发版或不想把 `.p12` 放到云端 |

> **安全红线**：任何 `.p12` 证书、`.p8` API Key、密码或 Apple ID **绝不进入代码仓库**。

---

## 方式 A：云端 Tag + GitHub Actions 自动发布（推荐）

工作流文件：[release-mac.yml](../.github/workflows/release-mac.yml)

### 1. 日常发版步骤

1. 确认 `package.json` 的 `version` 已更新（例如 `0.6.1`），提交并推送至 `main`：
   ```bash
   git push origin main
   ```
2. 打版本 Tag 并推送（支持 `vX.Y.Z` 或预发布后缀 `vX.Y.Z-rc.1`）：
   ```bash
   git tag -a v0.6.1 -m "Release v0.6.1"
   git push origin v0.6.1
   ```
3. GitHub Actions 在 `macos-15` 上自动完成：
   - 校验 Tag 与 `package.json` 版本号一致
   - `npm ci` + `npx tsc --noEmit` + `npm run test:unit` + `npm run smoke`
   - 构建与封装 `CoCraft-<version>-arm64.dmg`（自动裁剪 216 个非中英文 `.lproj`）
   - 若已配 Secrets：创建临时钥匙串 → Developer ID 由内而外签名 → Apple Notarization 公证 → `.dmg`/`.app` 双端装订 → `if: always()` 彻底删除临时钥匙串与证书文件
   - 若未配 Secrets：自动回退构建 Ad-hoc `.dmg`（Release 说明自动附带 `xattr -cr` 命令）
   - 只读挂载 DMG 校验 `CoCraft.app`、`Applications` 软链与签名完整性，生成 `SHA256SUMS.txt`
   - 自动创建或更新对应 Tag 的 GitHub Release

> 也可在 GitHub **Actions → Release macOS Installer → Run workflow** 手动试跑（默认仅上传 Artifact，勾选 `create_release` 时同时发布 Release）。

### 2. 配置云端 Apple 签名与公证 Secrets（一次性配置）

进入 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret**。

#### 第一步：证书 Secrets（必选 2 项）

1. 打开 macOS **钥匙串访问（Keychain Access）→ 登录 → 我的证书**，找到 `Developer ID Application: ...`（注意展开确认包含**私钥**），右键选择 **导出为 `.p12`** 并设置一个导出密码。
2. 将 `.p12` 转为单行 Base64 复制到剪贴板（切勿把 `.p12` 放在仓库目录内）：
   ```bash
   base64 -i ~/Desktop/DeveloperIDApplication.p12 | tr -d '\n' | pbcopy
   ```
3. 在 GitHub Secrets 添加：
   - `MAC_CERT_BASE64`：上一步复制的 Base64 字符串
   - `MAC_CERT_PASSWORD`：导出 `.p12` 时设置的密码

#### 第二步：Apple 公证 Secrets（二选一，推荐选项 1）

- **选项 1 · App Store Connect API Key（行业最佳实践，推荐）**
  - 不绑定个人 Apple ID 密码，可随时独立吊销。
  - 在 [App Store Connect → 用户和访问 → 集成 → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api) 生成一个密钥（Role 选 `Developer` 即可），下载 `.p8` 文件，并记录 **Issuer ID** 和 **Key ID**。
  - 转单行 Base64：`base64 -i ~/Downloads/AuthKey_XXXXXXXXXX.p8 | tr -d '\n' | pbcopy`
  - 在 GitHub Secrets 添加 3 项：
    - `APPLE_API_KEY_BASE64`：`.p8` 单行 Base64
    - `APPLE_API_KEY_ID`：Key ID（10 位字母数字）
    - `APPLE_API_ISSUER_ID`：Issuer ID（UUID）

- **选项 2 · Apple ID + App 专用密码（最简单，复用个人账号）**
  - 在 GitHub Secrets 添加 3 项：
    - `APPLE_ID`：Apple Developer 账号邮箱
    - `APPLE_APP_SPECIFIC_PASSWORD`：在 [appleid.apple.com](https://appleid.apple.com) 生成的 App 专用密码（`xxxx-xxxx-xxxx-xxxx`）
    - `APPLE_TEAM_ID`：10 位 Apple Team ID（在 `security find-identity -v -p codesigning` 括号内可见）

> **安全加固建议**：由于 `release-mac.yml` 仅响应 `v*` Tag 推送和手动触发（不响应 PR），普通 PR 无法读取签名 Secrets。如需进一步审批管控，可在 GitHub 仓库创建 `release` Environment 并限定仅 `v*` Tag 分支策略与审批人。

---

## 方式 B：本地签名公证后上传 Release（证书不出本机）

如果你已在本机钥匙串装好 `Developer ID Application` 证书和 `cocraft-notary` 凭证（且不想把 `.p12` 传到 GitHub Secrets）：

1. 确保当前处于干净的发版提交（或检出对应 Tag 的干净 worktree）。
2. 一键执行完整签名、DMG 封装、Apple 公证与 `spctl` Gatekeeper 校验：
   ```bash
   npm run package:release
   ```
   产物位于 `release/0.6/CoCraft-<version>-arm64.dmg`（若需首次在本机配置 `cocraft-notary` 凭证，运行 `xcrun notarytool store-credentials cocraft-notary --apple-id <email> --team-id <TEAM_ID> --password <app-specific-password>`）。
3. 生成校验和：
   ```bash
   (cd release/0.6 && shasum -a 256 CoCraft-0.6.0-arm64.dmg > SHA256SUMS.txt)
   ```
4. 上传到对应 Tag 的 GitHub Release（可直接覆盖 CI 产出的 Ad-hoc 包）：
   - **网页上传**：打开对应 Release 页面（如 `https://github.com/pforge-ai/co-craft/releases/tag/v0.6.0`）→ 点右上角 **Edit** → 删掉旧 `.dmg` 并拖入本机公证版 `.dmg` 与 `SHA256SUMS.txt` → 保存。
   - **命令行上传**（如已 `brew install gh && gh auth login`）：
     ```bash
     gh release upload v0.6.0 \
       release/0.6/CoCraft-0.6.0-arm64.dmg \
       release/0.6/SHA256SUMS.txt \
       --clobber
     ```

---

## 常用本地命令速查

```bash
npm run package          # 仅构建 release/0.6/mac-arm64/CoCraft.app（日常开发验证最快）
npm run package:dmg      # 本地构建 Ad-hoc 签名安装包 release/0.6/CoCraft-<version>-arm64.dmg
npm run package:release  # 本机 Developer ID 签名 + DMG 封装 + Apple Notarization 公证装订
```
