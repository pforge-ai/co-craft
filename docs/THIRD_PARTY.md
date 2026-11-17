# 第三方组件与分发

这是本机开发和评估构建。依赖的准确版本以 package-lock.json 为准。

| 组件 | 用途 | 来源与许可说明 |
| --- | --- | --- |
| Electron | macOS 桌面与独立进程 | https://www.electronjs.org/ · MIT；Chromium / Node 含各自许可 |
| React / Vite / TypeScript / esbuild | 工作台与构建 | 各项目官方 npm 包；许可保留在依赖中 |
| Pi coding agent | SDK、文件工具、会话与 Skills | https://github.com/earendil-works/pi · 包内许可 |
| Remotion | 预览与合成 | https://www.remotion.dev/docs/licensing · 不是对任意公司规模/产品嵌入一概免费的 MIT 组件；公开商业分发前确认适用授权 |
| Remotion compositor / FFmpeg | 媒体探测、缩略图、编码 | 随对应 Remotion 平台包固定版本，相关动态库与 LICENSE.md 保留于 resources/media-tools；公开分发前核对该二进制的 FFmpeg 构建选项及源码提供义务 |
| Lucide | UI 图标 | https://lucide.dev/ · ISC |
| Remotion best practices Skill | 编码 Agent 的视频知识 | 从本机已安装 Skill 镜像，原始路径 /Users/cuiyubao/.agents/skills/remotion-best-practices；生态入口 https://www.remotion.dev/docs/ai/skills |
| Pexels API | 可选视频搜索/导入 | https://www.pexels.com/api/documentation/ 与 https://www.pexels.com/license/；保存素材摄影师与来源，显示 Pexels 标识 |

CoCraft 内置海岸/沙丘/夜色 SVG、图标和合成氛围音为本轮原创，不是远程素材下载。macOS 本地配音调用用户系统已安装的声音。

包体没有打包用户当前的 Chrome。渲染优先寻找系统 Chrome/Chromium；缺失时由 Remotion 下载官方渲染浏览器到应用缓存。
