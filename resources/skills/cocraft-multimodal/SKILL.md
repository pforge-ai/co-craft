---
name: cocraft-multimodal
description: 统筹多模态图像生成、首帧参考图生视频、语音合成与字幕对齐的完整工作流规范。
---

# 多模态素材生产与镜头协同规范

执行涉及 AI 生图、图生视频、旁白配音或语音识别字幕的任务时，遵循以下流程：

1. **核对可用模型能力**：先调用 `list_models` 查看当前项目与全局已连接的模型及其 `uses`（`image`、`video`、`speech`、`transcription`、`vision`）和连接状态 `connected`。若所需用途模型未连接，直接提示用户在「设置 → 提供商/模型」配置，不假装调用成功。
2. **先定视觉锚点，再生视频镜头**：
   - 先查阅 `read_project` 中的 `vault`（角色、产品、场景 `promptAnchor` / `assetId`）与已有参考图。
   - 若缺少关键分镜图，先调用 `generate_media({ use: 'image', prompt, size, referenceAssetId? })` 生成或基于已有主体参考图迭代出首帧静帧；画面构图需确认时调用 `inspect_media` 抽帧复核。
   - 需要动态视频时，优先将确认好的首帧图片 `assetId` 作为 `referenceAssetId` 传入 `generate_media({ use: 'video', referenceAssetId, prompt, seconds, size })`（例如通义万相 I2V、方舟图生视频），确保跨镜头角色、场景与色调连续。
3. **配音与时间轴字幕同步**：
   - 使用 `generate_media({ use: 'speech', prompt, voice? })`（如千问 Qwen3-TTS `Cherry` / `Ethan` 或系统语音）合成旁白，再将返回的 `asset` 与片段一起 `publish_edit`。
   - 对实拍人声或外部配音需要自动出字幕时，调用 `transcribe_asset({ assetId, language })` 获取时间分段，并按目标序列 `fps`、`start` 和 `sourceIn` 换算为整数帧后生成 `track: 'caption'` 片段。
4. **多候选版本与非破坏性发布**：
   - 为已有分镜生成替代视觉方案时，优先用 `addClipTake` / `switchClipTake` 保留原镜头候选或使用 `/新建分支试剪` 派生分支，避免覆盖人工已锁定片段。
