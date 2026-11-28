# CoCraft macOS 自动发布指南（Tag + GitHub Actions）

CoCraft 通过 GitHub Actions 工作流 [release-mac.yml](../.github/workflows/release-mac.yml) 在 `macos-15`（Apple Silicon `arm64`）上自动完成检查、打包、校验与 GitHub Release 发布，产出可直接拖拽安装的 `.dmg` 安装包与 `SHA256SUMS.txt`。

---

## 1. 日常发版流程（推送 Tag 自动发布）

1. 确认 `package.json` 中的 `version` 已更新为目标版本（例如 `0.6.1`）。
2. 提交并推送至 `main`：
   ```bash
   git push origin main
   ```
3. 打版本 Tag 并推送（Tag 必须与 `package.json` 版本对齐，支持 `vX.Y.Z` 或预发布后缀 `vX.Y.Z-rc.1`）：
   ```bash
   git tag -a v0.6.1 -m "Release v0.6.1"
   git push origin v0.6.1
   ```
4. GitHub Actions 将自动执行：
   - 校验 Tag 与 `package.json` 版本号对齐
   - `npm ci` + `npx tsc --noEmit` + `npm run test:unit` + `npm run smoke`
   - 构建与封装 `CoCraft-<version>-arm64.dmg`（自动裁剪 216 项非中英文语言包）
   - 只读挂载 DMG 校验 `CoCraft.app`、`Applications` 软链与签名完整性，生成 `SHA256SUMS.txt`
   - 自动创建（或更新）对应 Tag 的 GitHub Release，并附带安装包、校验文件与提交变更日志

> **提示**：也可以在 GitHub 仓库的 **Actions → Release macOS Installer → Run workflow** 中手动试跑构建（默认仅上传 Workflow Artifact，不创建公开 Release；勾选 `create_release` 可同时发布）。

---

## 2. 签名与公证模式（自动双轨切换）

工作流会自动检测仓库 Secrets 配置并切换模式，**任何证书与密码均只存放在 GitHub Secrets，绝不进入代码仓库**：

| 模式 | 所需 GitHub Secrets | 产出说明 |
| --- | --- | --- |
| **Apple 公证正式版（推荐）** | `MAC_CERT_BASE64`、`MAC_CERT_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` | 调用 [scripts/release-mac.mjs](../scripts/release-mac.mjs) 完成 Developer ID Hardened Runtime 由内而外签名、DMG 签名、Apple Notarization 公证与 `.dmg`/`.app` 双端装订；用户下载拖拽安装即可直接打开，零 Gatekeeper 拦截。 |
| **仅签名版** | `MAC_CERT_BASE64`、`MAC_CERT_PASSWORD` | 完成 Developer ID 签名（跳过公证）。 |
| **Ad-hoc 免配置版（默认回退）** | 无需配置任何 Secret | 直接产出可拖拽安装的 `CoCraft-<version>-arm64.dmg`。首次打开如遇 macOS 提示“无法验证开发者”或“应用已损坏”，用户执行 `xattr -cr /Applications/CoCraft.app` 即可打开。 |

### 如何配置 Apple Developer 签名与公证 Secrets

在 GitHub 仓库进入 **Settings → Secrets and variables → Actions → New repository secret**，依次添加：

1. **`MAC_CERT_BASE64`**：从本机钥匙串导出 `Developer ID Application` 证书及私钥为 `.p12` 后，转为单行 Base64：
   ```bash
   base64 -i DeveloperIDApplication.p12 | tr -d '\n' | pbcopy
   ```
2. **`MAC_CERT_PASSWORD`**：导出 `.p12` 时设置的密码。
3. **`APPLE_ID`**：Apple Developer 账号邮箱。
4. **`APPLE_APP_SPECIFIC_PASSWORD`**：在 [appleid.apple.com](https://appleid.apple.com) 生成的 App 专用密码（形如 `xxxx-xxxx-xxxx-xxxx`）。
5. **`APPLE_TEAM_ID`**：Apple Developer 10 位 Team ID。

---

## 3. 本地打包命令对照

```bash
npm run package          # 仅构建 release/0.6/mac-arm64/CoCraft.app（日常开发验收最快）
npm run package:dmg      # 本地构建 Ad-hoc 签名安装包 release/0.6/CoCraft-<version>-arm64.dmg
npm run package:release  # 使用本机钥匙串 Developer ID 证书 + cocraft-notary 凭证执行完整签名与公证
```
