---
name: cocraft-anatomy
description: 制作精密结构剖面、底层原理具象化或信号传导动态图解，配合粒子流动与实时状态指标（纯动画规范，可自由搭配任意视觉风格色板）。
---

# Anatomy · 精密剖面与科学机制图解范式

融合工程内部机制剖面（`Anatomy`）与生命科学信号通路可视化（`Anima`），适合解释限流器、缓存淘汰、发动机腔体、细胞受体、神经递质或物理化学反应过程。

## 快速选择：内置装置 vs 新编组件

1. **标准腔体剖面 / 突触传导**：调用 `prepare_preset({presetId: "anatomy-telemetry", sequenceId, start, duration, props: {text, subtitle, domain: "engineering" | "biomed", flowRate, citation, accent}})`。
2. **专属结构剖面定制**：在任务工作区编写 SVG 剖面结构 + 确定性粒子计算组件，通过 `compile_component` 编译发布。

## 核心构图规范

- **中央主剖面 + 外围遥测读数（Telemetry Readouts）**：
  - 画面中央 `60%` 区域展示剖开的腔体、管道、膜结构或阀门；
  - 底部或侧边用等宽字体（Monospace）实时跳动 2–3 项与动画强绑定的物理/系统读数（如通量 `FLUX`、压力/浓度、延迟 `JITTER`）。
- **100% 帧确定性粒子流**：严禁使用 `Math.random()` 逐帧抖动！所有分子、电子或数据包粒子的坐标必须由 `(index / count + frame / fps * speed) % 1` 与正弦微扰确定性算出，确保拖动时间线与导出成片丝滑一致。
- **科学严谨性与溯源角标**：涉及医学、药理或工程标准时，在右下角保留低干扰 `citation` 溯源角标，不夸大未经证实的定量结论。
