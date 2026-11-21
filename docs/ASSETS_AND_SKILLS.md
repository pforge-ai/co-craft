# CoCraft 双层资产体系与科普/演示 Skill 矩阵

更新日期：2026 年 11 月 18 日（v0.3 架构升级）。

CoCraft 将传统剪辑器里扁平的“本地媒体文件（素材）”全面升级为结构化、可锁定一致性、可跨项目复用的 **「资产体系（Asset v2）」**，并将开源社区最优秀的科普/演示动画能力提炼为 **「8 合 4 可编程创造 Skill 矩阵」**，统一运行在 **Remotion + Three.js（`@remotion/three`）** 内核之上。

---

## 一、 双层资产架构（Project Vault ⇄ Global Library）

借鉴 UpDream 的双层资产管理与 TapNow 的 Ground Truth 一致性锚定机制，所有资产在两个层级间自由流转：

1. **当前项目资产库（Project Vault，位于 `<project>/assets/`）**
   - 保存当前工程实际采用或暂存候选的资产快照、内容哈希与版本锁。
   - 工程移动、重开或回退历史版本时，成片引用的资产版本严格固定，不受外部修改污染。
2. **全局个人资产库（Global Asset Library，位于 `~/Library/Application Support/CoCraft/Library/`）**
   - 跨项目沉淀用户的常驻角色、产品主体、品牌规范、精调过的代码/3D 动画装置与生成配方。
   - 在任意新项目中支持「一键引入到当前工程」，在项目中打磨成熟的组件或角色也支持「一键沉淀到全局资产库」。

### 五大一等资产类型（Asset Kinds）

| 资产大类 | 包含子类型 | 核心保留字段与一致性能力 |
| --- | --- | --- |
| **1. 主体与一致性资产（Subject）** | `character`（角色/出镜人）<br>`product`（产品主体/UI 截图）<br>`environment`（场景参考） | 多视角标准参考图（Ground Truth）、特征固定描述词、绑定默认音色（Voice ID）、透明通道标记；在分镜生图/生视频时自动注入参考以防人物/产品漂移 |
| **2. 媒体与录屏资产（Media）** | `video` / `screen-recording`<br>`audio` / `voiceover` / `sfx`<br>`image` | 真实时长、分辨率、帧率、音轨存在性（`hasAudio`）、256 桶峰值波形（含视频音轨波形）、转录文稿与时间戳缓存、离线状态与原路径重连指纹、来源与许可 |
| **3. 品牌与风格规范（Brand Kit）** | `brand-kit` | 主辅色板、标题/正文字体组合、字幕安全区与底栏样式、背景纹理与动效阻尼偏好；可设为项目默认视觉规范，被所有内置预设与 Agent 新建组件自动读取 |
| **4. 舞台与 3D 装置（Stage Rig）** | `motion-rig`（2D/SVG/UI 演示组件）<br>`three-rig`（Three.js 3D 场景/拆解器）<br>`model-3d`（`.glb` / `.gltf` 模型预留） | 不可变源码版本、编译哈希、语义化参数 Schema（文字/颜色/数值/枚举/开关/资产槽位）、推荐时长、横竖屏自适应声明、3D 相机预设（环绕/推拉/爆炸度） |
| **5. 工作流配方（Recipe）** | `recipe`（TapNow 式生产配方） | 输入资产槽位定义（如“替换产品图 + 输入 3 条卖点”）、关联 Skill 标识、目标模型用途路由、参数模板与审片检查项；实现“调试一次流水线，换资产无限套用” |

---

## 二、 科普与演示动画「8 合 4」Skill 矩阵

针对社区代表性的 8 个编码可视化与仿真项目（`SeeCode`、`Tinycharts`、`Anatomy`、`Anima`、`Teardown`、`machine-skill`、`factory-skill`、`open-slide`），CoCraft 去重取精，收敛为 **4 大内置创造范式 + 1 套演示/录屏聚焦组件族**，全部直接产出帧级确定性的 Remotion / `@remotion/three` 组件，同时保持对外部原始 `SKILL.md` 的读取兼容：

| 内置 Skill 标识 | 吸收融合的源范式 | 适用创作场景 | 核心视觉特征与暴露给 UI 的标准参数 |
| --- | --- | --- | --- |
| **`cocraft-seecode`**<br>数据与架构图解 | `SeeCode` + `open-slide` 分步版式 | 商业发布、技术架构演进、对比评测、代码走读、章节演示页（Deck） | 杂志编辑级排版、高对比网格、45+ 图表/时序/流向结构、按 `step` 或配音时间点逐级揭示；暴露文案、数据序列、主题色与高亮节点参数 |
| **`cocraft-tinycharts`**<br>手绘状态推演 | `Tinycharts` | 通俗原理科普、规则/博弈解释、用户交互链路、产品逻辑说明 | 手绘马克笔/等轴测笔触质感 + 严格状态机（Statechart）步进转换（正常流转 vs 非法拦截动画）；暴露状态节点文案、当前步进阶段与笔触强调色 |
| **`cocraft-anatomy`**<br>精密剖面与科学机制 | 合并 `Anatomy` + `Anima` | 计算机底层机制（如限流器/缓存）具象化、生物医学/神经药理信号传导科普 | 等轴测精密仪器或生物组织剖面（SVG + Canvas 粒子流）+ 周边实时遥测仪表盘（Telemetry Readouts）+ 可选科学文献溯源角标；支持 `engineering` / `biomed` 领域预设切换 |
| **`cocraft-teardown-3d`**<br>3D 机械拆解与产线沙盘 | 融合 `Teardown` + `machine-skill` + `factory-skill` | 硬件/机械原理爆炸拆解、物理运转演示、微缩工厂/高并发流水线吞吐与瓶颈模拟、3D 机位预演 | 基于 `@remotion/three`（Three.js）的程序化 3D 几何或导入 `.glb` 模型；标准暴露 `explode`（爆炸拆解度 `0–1`）、`speed`（运转/吞吐速率）、`focusPart`（高亮部件标签）与 `cameraPreset`（环绕/推近/俯视等轴测） |

### 演示页与录屏聚焦方案（不造冗余轮子）

经架构评估，CoCraft **不单独引入 `open-slide` 运行时，也不自研系统级桌面录屏采集器**，统一用 Remotion 超集更干净地解决：
1. **分步演示镜头（Deck Scene）**：由 `cocraft-seecode` 与内置章节预设直接在 Remotion 中渲染 `1920×1080` / `1080×1920` 自适应演示页，矢量文字直至导出最后一刻均可无损修改。
2. **录屏聚焦包装（`ScreenFocusRig`）**：用户使用 macOS 原生 `⇧⌘5` 等工具录制真实软件操作视频导入为 `screen-recording` 资产后，直接套用内置的弹簧推拉聚焦参数（指定目标区域 `focalX`、`focalY`、`zoom`、圆角阴影窗体底板），即刻获得平滑的产品演示特写质感。
3. **外部社区 Skill 兼容**：用户在全局或项目 `skills/` 目录放入社区标准 `SKILL.md`（例如原版 `anima` 或其他领域 Skill）时，Agent 读取其领域视觉与叙事规范，并遵循 `cocraft-editing` 协议编译为 CoCraft 可参数化组件发布入轨。

---

## 三、 3D 建模与空间预演（Previs）平滑演进抽象

为避免前期过度复杂、同时确保未来无缝引入重度 3D 建模与 UpDream 式空间导演能力，底层数据模型预留以下标准契约：
- **模型资产槽位（`model-3d`）**：支持登记 `.glb` / `.gltf` 本地内容寻址资产，记录包围盒尺寸、材质数与默认朝向。
- **相机与灯光轨道参数（`CameraRigSpec`）**：统一以 `{ position, target, fov, preset, keyframes }` 描述三维机位。
- **3D 预演转 AI 生成（Previs-to-Video）**：任何 `three-rig` 镜头均可通过 `preview_frame` 渲染出精确透视构图静帧，直接作为 `referenceAssetId` 喂给方舟/图像/视频生成模型，用确定性 3D 空间消灭云端视频运镜抽卡。
