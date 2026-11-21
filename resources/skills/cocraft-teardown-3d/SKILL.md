---
name: cocraft-teardown-3d
description: 制作三维立体结构爆炸拆解、多层架构透视、空间节点沙盘或 .glb 模型环绕运镜（纯空间运镜规范，可搭配任意灯光与品牌材质）。
---

# Teardown 3D · 三维爆炸拆解与流转沙盘范式

当用户要求 3D 产品/机械结构拆解、半导体叠层展示、高并发工厂流水线三维沙盘，或为 AI 视频生成摆设精确透视三维机位预演（Previs）时，启用本范式。

## 快速选择：内置 3D 舞台 vs 自定义 Three.js 组件

1. **内置 Three.js 拆解舞台**：直接调用 `prepare_preset({presetId: "teardown-3d", sequenceId, start, duration, props: {text, subtitle, sceneType: "turbine" | "chip-stack" | "factory-flow", cameraPreset: "orbit" | "isometric" | "dolly-in" | "top-down" | "hero-low", explode: 0.65, speed: 1, focusLabel, accent, secondary}})`。
2. **导入本地 `.glb` / `.gltf` 模型**：工程中已有 `kind === "model-3d"` 资产时，直接放置引用该 `assetId` 的视觉片段（或绑定到 `teardown-3d`），通过 `explode`（`0–1.4`）即可将子网格从质心径向平滑拆解展开。
3. **编写全新 Three.js 场景组件**：在 `.tsx` 组件中可直接导入宿主内置的 `three` 与 `@remotion/three`（无需额外 npm 安装）：

```tsx
import React, { useCallback } from 'react';
import * as THREE from 'three';
import { ThreeCanvas } from '@remotion/three';

export default function CustomRig({ explode = 0.5, accent = '#3b82f6' }) {
  const setup = useCallback((scene: THREE.Scene) => {
    scene.add(new THREE.AmbientLight('#ffffff', 0.9));
    const dir = new THREE.DirectionalLight('#ffffff', 2.2);
    dir.position.set(5, 8, 6);
    scene.add(dir);
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.1, 1),
      new THREE.MeshStandardMaterial({ color: accent, metalness: 0.6, roughness: 0.2 })
    );
    core.name = 'core';
    scene.add(core);
  }, [accent]);

  const onFrame = useCallback(({ scene, camera, time }: any) => {
    camera.position.set(Math.cos(time * 0.5) * 5, 2.4 + explode, Math.sin(time * 0.5) * 5);
    camera.lookAt(0, 0, 0);
    const core = scene.getObjectByName('core');
    if (core) core.rotation.y = time * 0.8;
  }, [explode]);

  return <ThreeCanvas setup={setup} onFrame={onFrame} />;
}
```

## 必须暴露的标准参数

任何新建 3D 组件均应在默认 `props` 中暴露：`explode`（拆解度 `0–1`）、`speed`（运转速率）、`accent`（主光/材质强调色），方便用户无需改代码即可在属性面板拉动滑杆调节镜头。
