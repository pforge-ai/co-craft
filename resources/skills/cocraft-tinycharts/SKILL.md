---
name: cocraft-tinycharts
description: 用亲切的手绘白板质感结合清晰状态分支，推演业务规则、博弈决策与正常/异常路径对比（纯叙事推演规范，与纸面/深色风格解耦）。
---

# Tinycharts · 手绘状态机与规则推演范式

当用户希望把抽象规则、并发锁、权限校验、协议握手或日常生活原理讲得既通俗亲切又逻辑严密时，启用本范式。

## 快速选择：内置装置 vs 新编组件

1. **标准三态流转或拦截**：直接调用 `prepare_preset({presetId: "tinycharts-state", sequenceId, start, duration, props: {text, subtitle, states: "状态一|状态二|状态三", mode: "pass" | "reject", guardNote, accent, surface}})`。
2. **多分支循环或博弈树**：编写自定义 Remotion SVG 组件并通过 `compile_component` 发布。

## 视觉与状态机规范

- **温暖手绘纸面质感**：默认使用米白点阵纸底（`#fbf9f3`）或暗板底（`#111622`），矩形节点采用 **双层轻微错位描边（Double-Stroke Marker）** 营造手绘草图呼吸感，同时文字保持清晰易读的无衬线正体。
- **显式状态令牌（Token）运动**：用一枚高对比圆点代表当前请求/主体，沿连接线在状态框之间平滑移动：
  - **正常流转（Pass）**：守卫条件满足，令牌顺利抵达终态并点亮确认态。
  - **守卫拦截（Guard Reject）**：当展示错误示范或边界保护时，令牌撞上虚线拦截门后按正弦弹性回退（Bounce Back），同步浮现清晰的红色拦截原因说明。
- **收尾核验**：发布后调用 `preview_frame` 检查最长状态名在节点框内不溢出、连线箭头不穿字。
