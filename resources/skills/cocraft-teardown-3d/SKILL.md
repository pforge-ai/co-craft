---
name: cocraft-teardown-3d
description: 使用 CoCraft 统一空间摄影棚（Spatial Stage）编排 3D 摄像机、人物动作（walk/run/confront/turn/wave/idle）、走线路径、场景环境与 2.5D 立体漫剧镜头，一键调用 bake_spatial_video 录制成真实 MP4 预演视频反哺 AI 动作迁移/参考生视频，或导入 .glb/.spz 模型。
---

# Spatial Stage · CoCraft 统一空间摄影棚与 3D→AI 视频闭环范式

当用户要求 **2.5D 立体原画/漫剧推拉镜头、3D 导演走线预演（摄像机 + 人物动作 + 走线 + 环境）、把 3D 场景录成预演视频再参考生成最终 AI 视频、3D 手机/电脑产品贴屏演示、`.glb` 骨骼动画、`.spz/.splat` 3D 高斯泼溅实景世界，或 3D 机械/芯片结构拆解**时，统一启用本范式。

## 1. 3D 导演编排 → 录为预演视频 → 参考生成最终 AI 视频（黄金闭环）

1. **编排 3D 场景参数（`spatial-stage`）**：
   - `sceneType`: `"previs-blocking"`（3D 走线导演棚）| `"parallax-25d"`（2.5D 多层立体原画）| `"device-showcase"`（3D 硬件贴屏）| `"turbine"` / `"chip-stack"` / `"factory-flow"`
   - `environmentPreset`: `"rooftop-night"`（雨夜天台都市）| `"neon-alley"`（赛博霓虹窄巷）| `"cyber-corridor"`（科幻长廊）| `"open-horizon"`（开阔逆光）| `"studio-grid"`（白箱影棚）
   - `actorAction`: `"walk"` | `"run"` | `"confront"` | `"turn"` | `"wave"` | `"idle"`
   - `actorPath`: `"approach"` | `"cross-left-right"` | `"cross-right-left"` | `"circle-rival"` | `"retreat"` | `"hold"`，或直接传入精确坐标 `actorStartX / actorStartZ / actorEndX / actorEndZ`！
   - `cameraPreset`: `"dolly-in"` | `"dolly-zoom"` | `"orbit"` | `"pan-sweep"` | `"crane-up"` | `"hero-low"` | `"top-down"`，配合 `cameraLens: 24 | 35 | 50 | 85` 与 `particles3D: "rain" | "dust" | "snow" | "embers"`。
2. **录制为真实 MP4 预演视频**：
   - 直接调用 `bake_spatial_video({ props: {...}, durationSeconds: 3, pass: "beauty" | "depth" })`（或引用已有 `clipId` / `vaultItemId` / `assetId`）。
   - 返回的 `assetId` 即为项目内真实 MP4 视频资产，可直接放上时间线，或作为驱动/参考视频喂给 `generate_media`（如 `wan2.2-animate-move` 动作迁移、`wan2.2-animate-mix` 视频换人或参考生视频）！

## 2. 导入 `.glb/.gltf`（含骨骼动画）与 `.spz/.splat/.ksplat/.ply`（3DGS 世界模型）

- 工程中已有 `kind === "model-3d"` 资产时，直接放置引用该 `assetId` 的片段：
  - `.glb/.gltf` 自动启用 PBR 棚光、软阴影、径向 `explode` 及内置 `AnimationMixer` 骨骼动画播放（`animationIndex`）。
  - `.spz/.splat/.ksplat/.ply` 自动走 WebGL2 确定性深度排序高斯泼溅渲染器，帧同步导出 MP4。

## 3. 编写全新自定义 Three.js 组件

在 `.tsx` 组件中可直接导入宿主内置的 `three`、`GLTFLoader` 与 `@remotion/three`（含 `ThreeCanvas`、`SpatialStage`、`TeardownStage`，无需额外 npm 安装），并建议暴露 `cameraLens`、`cameraYaw`、`cameraPitch`、`explode`、`speed`、`accent` 参数供右侧属性面板无代码微调。
