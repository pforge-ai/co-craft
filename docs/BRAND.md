# CoCraft 标识

2026-11-18 · 0.2 实现

标识采用一个在中部剪开的 C。两段共用轮廓和基线，开口处保留约 60° 切角：以一个清楚的字母形态表达剪接，不叠加播放三角、摄像机或 AI 星形。

## 工作台

`src/components/BrandMark.tsx` 导出 `BrandMark({ size = 24, className, tone = 'inherit', label })`。

- 常规尺寸 24 或 32 px；紧凑标识用 16 px，建议不再使用旧版的 13 px。
- 默认继承 `currentColor`；深浅主题用各自的主文字色。需要强调时可传 `tone="accent"`，读取 `--brand-accent`，回退到工作台 `--accent`。
- 20 px 及以下采用专门的光学版本：增大剪接缝、加厚细部并校正横向居中。
- 标识本身不旋转、不加外框、不循环闪烁。与 CoCraft 字标间隔约 8 px，字标沿用工作台字体与 600 字重。
- 默认作为装饰图形隐藏于辅助技术；作为单独品牌图时传入 `label="CoCraft"`。
- 不沿用 `.cocraft-mark` 的四块图形样式，它包含旧旋转和尺寸规则。

```tsx
import { BrandMark } from './BrandMark';

<BrandMark size={24} />
<BrandMark size={16} tone="accent" />
```

## macOS 应用图标

`resources/icon.svg` 是可编辑矢量源，`resources/icon.icns` 是应用包资源。圆角底座在 1024 px 画布内留出透明边距；底座用石墨色玻璃边缘，标识用银白材质，仅在剪接缝引入少量冷色反射。阴影和高光服务于层次，图形识别不依赖这些效果。

16、32、64 px 栅格使用简化材质和放大后的光学图形；128 px 以上从完整 SVG 原生尺寸渲染。深浅桌面使用同一个应用图标，工作台内使用单色版本。

运行 `node scripts/create-icon.mjs` 会生成标准 `.iconset` 的十个 PNG 与 `.icns`，并生成 `resources/icon.iconset/brand-proof.png` 检查图。脚本使用现有 Playwright、系统 Chrome/Chromium 和 macOS `iconutil`，不会修改系统设置。生成器同时检查应用图标与工作台常规标识的路径是否一致。

本轮已检查 16 / 24 / 32 / 64 px 工作台标识、16 / 32 / 128 / 512 px 应用图标，以及浅色和深色底图。16 px 使用光学版本后剪接缝可辨，应用图标透明边界保留正常。图形为本项目原创矢量。
