import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { uid } from '../../src/core/project';
import { findFreeCanvasPlacement } from '../../src/lib/canvasLayout';
import {
  DEFAULT_SPATIAL_BOOKMARKS,
  computeStageSceneSignature,
  normalizeCameraBookmarks,
  normalizeStageShots,
  type SpatialCameraBookmark,
  type SpatialDirectorShot,
} from '../../src/core/spatialStage';
import type { Asset, Clip, EditOperation, Project, Sequence } from '../../src/core/types';
import { importMedia } from '../media';
import type { IpcHandlerMap } from './types';

function resolveStageSources(p: Project, baseSeq: Sequence, arg: any) {
  const srcClip = arg.clipId ? baseSeq.clips.find((c) => c.id === arg.clipId) : undefined;
  const srcVault = arg.vaultItemId ? (p.vault || []).find((v) => v.id === arg.vaultItemId) : undefined;
  const srcAsset = arg.assetId ? p.assets.find((a) => a.id === arg.assetId) : undefined;
  const srcComp = arg.componentId
    ? p.components.find((c) => c.id === arg.componentId)
    : srcClip?.componentId
      ? p.components.find((c) => c.id === srcClip.componentId)
      : undefined;
  const isCodeStage = Boolean(srcComp || srcClip?.kind === 'code');
  return { srcClip, srcVault, srcAsset, srcComp, isCodeStage };
}

export const stageIpcHandlers: IpcHandlerMap = {
  'stage.captureReference': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const baseSeq = p.sequences.find((s) => s.id === arg.sequenceId) || p.sequences[0];
    let targetSeqId = baseSeq.id;
    let frame = Math.max(0, Math.round(Number(arg.frame ?? 0)));
    let sourceBaseProject = p;
    let sourceLabel = baseSeq.name;

    const { srcClip: srcClipForCap, srcComp: srcCompForCap } = resolveStageSources(p, baseSeq, arg);
    if (arg.vaultItemId || arg.assetId || arg.componentId || srcClipForCap) {
      const cloned = structuredClone(p);
      const vItem = arg.vaultItemId
        ? (cloned.vault || []).find((v) => v.id === arg.vaultItemId)
        : undefined;
      const mAsset = arg.assetId ? cloned.assets.find((a) => a.id === arg.assetId) : undefined;
      const tempSeqId = uid('seq_cap');
      const isCodeTarget = Boolean(srcCompForCap || srcClipForCap?.kind === 'code');
      const rawCapProps: Record<string, unknown> = isCodeTarget
        ? { ...(srcCompForCap?.props || {}), ...(srcClipForCap?.props || {}) }
        : srcClipForCap
          ? { ...srcClipForCap.props, showHud: false }
          : vItem?.rig?.presetId
            ? { ...(vItem.rig.props || {}), presetId: vItem.rig.presetId, showHud: false }
            : { cameraPreset: 'orbit', cameraLens: 35, showHud: false };
      const clipProps: Record<string, unknown> = {
        ...rawCapProps,
        _studioInteractive: false,
        _showCameraPath: false,
        _selectedObjectId: null,
      };
      const tempClip: Clip = {
        id: uid('clip_cap'),
        name: srcClipForCap?.name || srcCompForCap?.name || vItem?.name || mAsset?.name || '空间摄影棚',
        kind: isCodeTarget ? 'code' : srcClipForCap ? srcClipForCap.kind : 'shape',
        track: 'visual',
        layer: 0,
        start: 0,
        duration: srcClipForCap ? Math.max(30, srcClipForCap.duration) : Math.max(30, baseSeq.fps * 3),
        sourceIn: srcClipForCap?.sourceIn || 0,
        assetId: srcClipForCap?.assetId || mAsset?.id || vItem?.assetId,
        componentId: isCodeTarget ? srcCompForCap?.id || srcClipForCap?.componentId : undefined,
        locked: false,
        keyframes: srcClipForCap?.keyframes ? structuredClone(srcClipForCap.keyframes) : undefined,
        props: clipProps,
      };
      cloned.sequences.push({
        ...baseSeq,
        id: tempSeqId,
        name: tempClip.name,
        clips: [tempClip],
      });
      sourceBaseProject = cloned;
      targetSeqId = tempSeqId;
      sourceLabel = tempClip.name;
      frame = Math.max(
        0,
        Math.min(
          tempClip.duration - 1,
          Math.round(Number(arg.frame ?? Math.round(baseSeq.fps * 0.5))),
        ),
      );
    }

    const assetsDir = join(target.path, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const requestedPasses: ('beauty' | 'clay' | 'depth' | 'normal' | 'wireframe')[] =
      Array.isArray(arg.passes) && arg.passes.length > 0 ? arg.passes : [arg.pass || 'beauty'];

    const passMeta: Record<
      string,
      {
        label: string;
        via: 'capture-3d' | 'capture-depth' | 'capture-normal' | 'capture-clay';
        tags: string[];
        anchor: string;
      }
    > = {
      beauty: {
        label: '透视构图参考',
        via: 'capture-3d',
        tags: ['透视参考', '舞台抽帧'],
        anchor: '严格对齐参考图中的三维透视机位、主体方位与光影构图',
      },
      clay: {
        label: '白模构图参考',
        via: 'capture-clay',
        tags: ['白模预演', '透视参考'],
        anchor: '按三维白模中的人物站位、镜头焦段与空间透视绘制高清风格画面',
      },
      depth: {
        label: '深度图 Depth',
        via: 'capture-depth',
        tags: ['深度图', 'Depth', '空间控制'],
        anchor: '严格遵循深度图近白远黑的纵深层次与前景/主体/远景遮挡关系',
      },
      normal: {
        label: '法线图 Normal',
        via: 'capture-normal',
        tags: ['法线图', 'Normal', '空间控制'],
        anchor: '严格遵循法线图中的物体朝向、体块转折与受光面角度',
      },
      wireframe: {
        label: '线框结构参考',
        via: 'capture-3d',
        tags: ['线框结构', '空间控制'],
        anchor: '按线框几何结构与透视灭点绘制清晰线稿与场景构图',
      },
    };

    const operations: EditOperation[] = [];
    const captured: { pass: string; asset: Asset }[] = [];
    const nextLayout: Record<string, { x: number; y: number }> = { ...(p.canvasLayout || {}) };

    for (let i = 0; i < requestedPasses.length; i++) {
      const pass = requestedPasses[i];
      const meta = passMeta[pass] || passMeta.beauty;
      const fileName = `previs-${pass}-${uid('frame')}.png`;
      const outPath = join(assetsDir, fileName);
      let renderProject = sourceBaseProject;
      if (pass !== 'beauty') {
        const cloned = structuredClone(sourceBaseProject);
        const clonedSeq = cloned.sequences.find((s) => s.id === targetSeqId) || cloned.sequences[0];
        for (const clip of clonedSeq.clips) {
          if (frame < clip.start || frame >= clip.start + clip.duration) continue;
          const pid = String(clip.props?.presetId || '');
          const linked = clip.assetId ? cloned.assets.find((a) => a.id === clip.assetId) : undefined;
          if (
            clip.kind === 'code' ||
            pid === 'spatial-stage' ||
            pid === 'teardown-3d' ||
            linked?.kind === 'model-3d'
          ) {
            clip.props = {
              ...clip.props,
              renderPass: pass,
              showHud: false,
              _studioInteractive: false,
              _showCameraPath: false,
              _selectedObjectId: null,
            };
          }
        }
        renderProject = cloned;
      }
      const job = await ctx.jobs.render(renderProject, targetSeqId, outPath, {
        still: true,
        frame,
        scale: 1,
        silent: true,
      });
      await ctx.jobs.wait(job.id);
      const asset = await importMedia(outPath, target.path);
      asset.name =
        requestedPasses.length === 1 && arg.name
          ? arg.name
          : `${meta.label} · ${sourceLabel} f${frame}`;
      asset.role = 'environment';
      asset.tags = meta.tags;
      asset.category = 'subject';
      asset.subkind = 'environment';
      asset.derivedFrom = [
        {
          ...(arg.vaultItemId ? { vaultItemId: String(arg.vaultItemId) } : {}),
          ...(arg.assetId ? { assetId: String(arg.assetId) } : {}),
          via: meta.via,
          note: `捕获自「${sourceLabel}」第 ${frame} 帧（${pass} 通道）`,
        },
      ];
      operations.push({ type: 'addAsset', asset });
      if (arg.placement) {
        nextLayout[`asset:${asset.id}`] = findFreeCanvasPlacement(
          nextLayout,
          { x: Number(arg.placement.x), y: Number(arg.placement.y) + i * 195 },
          { w: 256, h: 172 },
          `asset:${asset.id}`,
        );
      }
      captured.push({ pass, asset });
    }
    if (arg.placement) {
      operations.push({ type: 'updateProject', changes: { canvasLayout: nextLayout } });
    }

    const envelope = await target.edit({
      baseRevision: p.revision,
      name:
        captured.length > 1
          ? `捕获多通道空间参考（${captured.map((c) => c.pass).join(' + ')}）`
          : `捕获预演构图真值「${captured[0]?.asset.name || ''}」`,
      operations,
    });
    await ctx.changed(target, envelope);
    return {
      envelope,
      asset: captured[0]?.asset,
      captured,
    };
  },
  'stage.bakeSpatialVideo': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const baseSeq = p.sequences.find((s) => s.id === arg.sequenceId) || p.sequences[0];
    const fps = baseSeq.fps || 30;
    const durationSec = Math.max(1, Math.min(10, Number(arg.durationSeconds ?? 3)));
    const durationFrames = Math.max(fps, Math.round(durationSec * fps));
    const pass: 'beauty' | 'clay' | 'depth' | 'normal' | 'wireframe' =
      arg.pass === 'clay' || arg.pass === 'depth' || arg.pass === 'normal' || arg.pass === 'wireframe'
        ? arg.pass
        : 'beauty';

    const cloned = structuredClone(p);
    const { srcClip, srcVault, srcAsset, srcComp, isCodeStage: isCodeBake } = resolveStageSources(p, baseSeq, arg);

    const baseProps: Record<string, unknown> = isCodeBake
      ? { ...(srcComp?.props || {}), ...(srcClip?.props || {}) }
      : srcClip
        ? { ...srcClip.props }
        : srcVault?.rig?.presetId
          ? { ...(srcVault.rig.props || {}), presetId: srcVault.rig.presetId }
          : srcAsset?.kind === 'model-3d'
            ? { cameraPreset: 'orbit', cameraLens: 35 }
            : { presetId: 'spatial-stage', sceneType: 'previs-blocking', ...(arg.props || {}) };

    const mergedProps: Record<string, unknown> = {
      ...baseProps,
      ...(arg.props || {}),
      renderPass: pass,
      showHud: false,
      _studioInteractive: false,
      _showCameraPath: false,
      _selectedObjectId: null,
    };
    const tempSeqId = uid('seq_bake');
    const bakeName =
      String(arg.name || '').trim() ||
      `3D预演视频 · ${srcClip?.name || srcComp?.name || srcVault?.name || srcAsset?.name || '空间摄影棚'}${!isCodeBake && pass !== 'beauty' ? ` (${pass})` : ''}`;

    const tempClip: Clip = {
      id: uid('clip_bake'),
      name: bakeName,
      kind: isCodeBake ? 'code' : srcClip ? srcClip.kind : 'shape',
      track: 'visual',
      layer: 0,
      start: 0,
      duration: srcClip ? Math.min(durationFrames, Math.max(fps, srcClip.duration)) : durationFrames,
      sourceIn: srcClip?.sourceIn || 0,
      assetId: isCodeBake ? undefined : srcClip?.assetId || srcAsset?.id || srcVault?.assetId,
      componentId: isCodeBake ? srcComp?.id || srcClip?.componentId : undefined,
      locked: false,
      keyframes: srcClip?.keyframes ? structuredClone(srcClip.keyframes) : undefined,
      props: mergedProps,
    };

    const rawScale = Math.max(0.4, Math.min(1, Number(arg.scale ?? 2 / 3)));
    const bakeWidth = Math.max(320, Math.round((baseSeq.width * rawScale) / 2) * 2);
    const bakeHeight = Math.max(320, Math.round((baseSeq.height * rawScale) / 2) * 2);

    cloned.sequences.push({
      ...baseSeq,
      id: tempSeqId,
      name: bakeName,
      width: bakeWidth,
      height: bakeHeight,
      clips: [tempClip],
    });

    const assetsDir = join(target.path, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const outPath = join(assetsDir, `spatial-previs-${pass}-${uid('vid')}.mp4`);
    const job = await ctx.jobs.render(cloned, tempSeqId, outPath, {
      scale: 1,
      preferOffscreenVideo: true,
      projectPath: target.path,
    });
    await ctx.jobs.wait(job.id);

    const asset = await importMedia(outPath, target.path);
    asset.name = bakeName;
    asset.role = 'footage';
    asset.tags = ['3D预演视频', pass === 'depth' ? '深度视频' : '空间运镜驱动'];
    asset.derivedFrom = [
      {
        ...(srcVault ? { vaultItemId: srcVault.id } : {}),
        ...(srcAsset ? { assetId: srcAsset.id } : {}),
        via: 'bake-3d-video',
        note: `由 3D 空间摄影棚录制（${pass} 通道，${(tempClip.duration / fps).toFixed(1)}s），可直接用于动作迁移、视频换人或参考生视频`,
      },
    ];

    const operations: EditOperation[] = [{ type: 'addAsset', asset }];
    if (arg.placement) {
      const freePos = findFreeCanvasPlacement(
        p.canvasLayout,
        { x: Number(arg.placement.x), y: Number(arg.placement.y) },
        { w: 256, h: 172 },
        `asset:${asset.id}`,
      );
      operations.push({
        type: 'updateProject',
        changes: {
          canvasLayout: {
            ...(p.canvasLayout || {}),
            [`asset:${asset.id}`]: freePos,
          },
        },
      });
    }
    const latest = await target.project();
    const envelope = await target.edit({
      baseRevision: latest.revision,
      name: `录制 3D 预演视频「${bakeName}」`,
      operations,
    });
    await ctx.changed(target, envelope);
    return { envelope, asset };
  },
  'stage.captureSpatialPair': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const baseSeq = p.sequences.find((s) => s.id === arg.sequenceId) || p.sequences[0];
    const { srcClip, srcVault, srcAsset, srcComp, isCodeStage: isCodePair } = resolveStageSources(p, baseSeq, arg);
    const baseProps: Record<string, unknown> = isCodePair
      ? { ...(srcComp?.props || {}), ...(srcClip?.props || {}) }
      : srcClip
        ? { ...srcClip.props }
        : srcVault?.rig?.presetId
          ? { ...(srcVault.rig.props || {}), presetId: srcVault.rig.presetId }
          : { cameraPreset: 'orbit', cameraLens: 35 };
    const allBookmarks = normalizeCameraBookmarks(baseProps.cameraBookmarks);
    const bmA =
      allBookmarks.find((b) => b.id === (arg.startBookmarkId || 'cam-a')) ||
      allBookmarks[0] ||
      DEFAULT_SPATIAL_BOOKMARKS[0];
    const bmB =
      allBookmarks.find((b) => b.id === (arg.endBookmarkId || 'cam-b')) ||
      allBookmarks[1] ||
      allBookmarks[0] ||
      DEFAULT_SPATIAL_BOOKMARKS[1];

    const assetsDir = join(target.path, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const pairAssets: Asset[] = [];
    const pairOps: EditOperation[] = [];
    const nextLayout: Record<string, { x: number; y: number }> = { ...(p.canvasLayout || {}) };
    const codeDur = srcClip ? Math.max(baseSeq.fps * 2, srcClip.duration) : baseSeq.fps * 4;

    for (const [idx, bm] of [bmA, bmB].entries()) {
      const cloned = structuredClone(p);
      const tempSeqId = uid('seq_pair');
      const tempClip: Clip = {
        id: uid('clip_pair'),
        name: isCodePair ? (idx === 0 ? '开场首帧' : '收尾末帧') : `${bm.shortKey}机帧`,
        kind: isCodePair ? 'code' : 'shape',
        track: 'visual',
        layer: 0,
        start: 0,
        duration: isCodePair ? codeDur : baseSeq.fps * 2,
        sourceIn: 0,
        assetId: isCodePair ? undefined : srcClip?.assetId || srcAsset?.id || srcVault?.assetId,
        componentId: isCodePair ? srcComp?.id || srcClip?.componentId : undefined,
        locked: false,
        keyframes: isCodePair && srcClip?.keyframes ? structuredClone(srcClip.keyframes) : undefined,
        props: isCodePair
          ? { ...baseProps }
          : {
              ...baseProps,
              cameraPreset: bm.cameraPreset,
              cameraLens: bm.cameraLens,
              cameraYaw: bm.cameraYaw,
              cameraPitch: bm.cameraPitch,
              cameraDistance: bm.cameraDistance,
              cameraPanX: bm.cameraPanX ?? 0,
              cameraPanY: bm.cameraPanY ?? 0,
              renderPass: arg.pass || 'beauty',
              showHud: false,
            },
      };
      cloned.sequences.push({ ...baseSeq, id: tempSeqId, name: tempClip.name, clips: [tempClip] });
      const outPath = join(assetsDir, `spatial-pair-${bm.shortKey.toLowerCase()}-${uid('f')}.png`);
      const targetFrame = isCodePair
        ? idx === 0
          ? Math.min(codeDur - 1, Math.round(baseSeq.fps * 0.25))
          : Math.max(1, Math.min(codeDur - 1, Math.round(codeDur * 0.85)))
        : idx === 0
          ? 0
          : Math.round(baseSeq.fps * 0.8);
      const job = await ctx.jobs.render(cloned, tempSeqId, outPath, {
        still: true,
        frame: targetFrame,
        scale: 1,
        silent: true,
      });
      await ctx.jobs.wait(job.id);
      const asset = await importMedia(outPath, target.path);
      const srcName = srcComp?.name || srcVault?.name || srcClip?.name || '空间机位';
      asset.name = isCodePair
        ? `${idx === 0 ? '首帧' : '尾帧'} · ${srcName} (${idx === 0 ? '开场' : '收尾'})`
        : `${idx === 0 ? '首帧' : '尾帧'} · ${srcName} (${bm.shortKey}机 ${bm.cameraLens}mm)`;
      asset.role = 'environment';
      asset.tags = ['3D机位帧', idx === 0 ? '首帧' : '尾帧'];
      asset.derivedFrom = [
        {
          ...(srcVault ? { vaultItemId: srcVault.id } : {}),
          ...(srcAsset ? { assetId: srcAsset.id } : {}),
          via: 'capture-3d',
          note: `拍自空间机位 ${bm.label}`,
        },
      ];
      pairAssets.push(asset);
      pairOps.push({ type: 'addAsset', asset });
      if (arg.placement) {
        nextLayout[`asset:${asset.id}`] = findFreeCanvasPlacement(
          nextLayout,
          { x: Number(arg.placement.x), y: Number(arg.placement.y) + (idx === 0 ? -68 : 118) },
          { w: 256, h: 172 },
          `asset:${asset.id}`,
        );
      }
    }
    if (arg.placement) {
      pairOps.push({ type: 'updateProject', changes: { canvasLayout: nextLayout } });
    }
    const latest = await target.project();
    const envelope = await target.edit({
      baseRevision: latest.revision,
      name: `拍摄 3D 首尾机位帧（${bmA.shortKey}机 → ${bmB.shortKey}机）`,
      operations: pairOps,
    });
    await ctx.changed(target, envelope);
    return { envelope, startAsset: pairAssets[0], endAsset: pairAssets[1] };
  },
  'stage.captureMultiCamStoryboard': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const baseSeq = p.sequences.find((s) => s.id === arg.sequenceId) || p.sequences[0];
    const fps = baseSeq.fps || 30;
    const { srcClip, srcVault, srcAsset, srcComp, isCodeStage } = resolveStageSources(p, baseSeq, arg);

    const baseProps: Record<string, unknown> = isCodeStage
      ? { ...(srcComp?.props || {}), ...(srcClip?.props || {}), ...(arg.propsOverride || {}) }
      : srcClip
        ? { ...srcClip.props, ...(arg.propsOverride || {}) }
        : srcVault?.rig?.presetId
          ? { ...(srcVault.rig.props || {}), presetId: srcVault.rig.presetId, ...(arg.propsOverride || {}) }
          : { cameraPreset: 'orbit', cameraLens: 35, ...(arg.propsOverride || {}) };

    const cameras: SpatialCameraBookmark[] = normalizeCameraBookmarks(
      Array.isArray(arg.cameras) && arg.cameras.length > 0 ? arg.cameras : baseProps.cameraBookmarks,
    );
    const includeDepth = Boolean(arg.includeDepth);
    const addToTimeline = arg.addToTimeline !== false;
    const srcName = srcClip?.name || srcComp?.name || srcVault?.name || srcAsset?.name || '3D 导演棚';
    const targetFrame = Math.max(0, Math.round(Number(arg.frame ?? 0)));
    const clipDuration = srcClip ? Math.max(30, srcClip.duration) : Math.max(30, fps * 3);

    const assetsDir = join(target.path, 'assets');
    await mkdir(assetsDir, { recursive: true });

    const ops: EditOperation[] = [];
    const createdAssets: Asset[] = [];
    const shotClipIds: string[] = [];
    const nextLayout: Record<string, { x: number; y: number }> = { ...(p.canvasLayout || {}) };
    const existingCoords = Object.values(nextLayout);
    const baseX = existingCoords.length ? Math.max(...existingCoords.map((c) => c.x)) + 280 : 120;
    const baseY = existingCoords.length ? Math.min(...existingCoords.map((c) => c.y)) : 120;

    let timelineTail = baseSeq.clips.length
      ? Math.max(...baseSeq.clips.map((c) => c.start + c.duration))
      : 0;
    const shotDur = Math.round(fps * 3);
    const passesToShoot: ('beauty' | 'depth')[] = includeDepth ? ['beauty', 'depth'] : ['beauty'];

    for (let i = 0; i < cameras.length; i++) {
      const bm = cameras[i];
      for (let pIdx = 0; pIdx < passesToShoot.length; pIdx++) {
        const pass = passesToShoot[pIdx];
        const cloned = structuredClone(p);
        const tempSeqId = uid('seq_mc');
        const camProps: Record<string, unknown> = {
          ...baseProps,
          cameraPreset: bm.cameraPreset,
          cameraLens: bm.cameraLens,
          cameraYaw: bm.cameraYaw,
          cameraPitch: bm.cameraPitch,
          cameraDistance: bm.cameraDistance,
          cameraPanX: bm.cameraPanX ?? 0,
          cameraPanY: bm.cameraPanY ?? 0,
          renderPass: pass,
          showHud: false,
          _studioInteractive: false,
          _showCameraPath: false,
          _selectedObjectId: null,
        };
        const tempClip: Clip = {
          id: uid('clip_mc'),
          name: `${bm.shortKey}机 · ${bm.label}`,
          kind: isCodeStage ? 'code' : srcClip ? srcClip.kind : 'shape',
          track: 'visual',
          layer: 0,
          start: 0,
          duration: clipDuration,
          sourceIn: srcClip?.sourceIn || 0,
          assetId: isCodeStage ? undefined : srcClip?.assetId || srcAsset?.id || srcVault?.assetId,
          componentId: isCodeStage ? srcComp?.id || srcClip?.componentId : undefined,
          locked: false,
          props: camProps,
        };
        cloned.sequences.push({ ...baseSeq, id: tempSeqId, name: tempClip.name, clips: [tempClip] });
        const outPath = join(assetsDir, `multicam-${bm.shortKey.toLowerCase()}-${pass}-${uid('shot')}.png`);
        const job = await ctx.jobs.render(cloned, tempSeqId, outPath, {
          still: true,
          frame: Math.min(clipDuration - 1, targetFrame),
          scale: 1,
          silent: true,
        });
        await ctx.jobs.wait(job.id);
        const asset = await importMedia(outPath, target.path);
        asset.name =
          pass === 'depth'
            ? `分镜深度 · ${bm.label} (${bm.cameraLens}mm)`
            : `分镜 ${i + 1} · ${bm.label} (${bm.cameraLens}mm)`;
        asset.role = 'environment';
        asset.tags =
          pass === 'depth'
            ? ['多机位分镜', '深度图', `${bm.shortKey}机`]
            : ['多机位分镜', '透视参考', `${bm.shortKey}机`];
        asset.category = 'subject';
        asset.subkind = 'environment';
        asset.derivedFrom = [
          {
            ...(srcVault ? { vaultItemId: srcVault.id } : {}),
            ...(srcAsset ? { assetId: srcAsset.id } : {}),
            via: pass === 'depth' ? 'capture-depth' : 'capture-3d',
            note: `多机位批量出分镜：${srcName} · ${bm.label}（Yaw ${Math.round(bm.cameraYaw)}° / Pitch ${Math.round(bm.cameraPitch)}° / ${bm.cameraLens}mm）`,
          },
        ];
        createdAssets.push(asset);
        ops.push({ type: 'addAsset', asset });
        nextLayout[`asset:${asset.id}`] = findFreeCanvasPlacement(
          nextLayout,
          { x: baseX + i * 260, y: baseY + pIdx * 200 },
          { w: 256, h: 172 },
          `asset:${asset.id}`,
        );

        if (addToTimeline && pass === 'beauty') {
          const shotClip: Clip = {
            id: uid('clip'),
            name: `${bm.label} (${bm.cameraLens}mm)`,
            kind: 'image',
            track: 'visual',
            layer: 0,
            start: timelineTail,
            duration: shotDur,
            sourceIn: 0,
            assetId: asset.id,
            locked: false,
            props: { fit: 'cover', opacity: 1, scale: 1 },
          };
          timelineTail += shotDur;
          shotClipIds.push(shotClip.id);
          ops.push({ type: 'addClip', sequenceId: baseSeq.id, clip: shotClip });
        }
      }
    }

    ops.push({ type: 'updateProject', changes: { canvasLayout: nextLayout } });
    const latest = await target.project();
    const envelope = await target.edit({
      baseRevision: latest.revision,
      name: `多机位批量出分镜（${cameras.length} 个机位${includeDepth ? ' + Depth' : ''}）`,
      operations: ops,
    });
    await ctx.changed(target, envelope);
    return { envelope, assets: createdAssets, shotClipIds };
  },
  'stage.shootDirectorShots': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const baseSeq = p.sequences.find((s) => s.id === arg.sequenceId) || p.sequences[0];
    const fps = baseSeq.fps || 30;
    const { srcClip, srcVault, srcAsset, srcComp, isCodeStage } = resolveStageSources(p, baseSeq, arg);

    const baseProps: Record<string, unknown> = isCodeStage
      ? { ...(srcComp?.props || {}), ...(srcClip?.props || {}), ...(arg.propsOverride || {}) }
      : srcClip
        ? { ...srcClip.props, ...(arg.propsOverride || {}) }
        : srcVault?.rig?.presetId
          ? { ...(srcVault.rig.props || {}), presetId: srcVault.rig.presetId, ...(arg.propsOverride || {}) }
          : { presetId: 'spatial-stage', sceneType: 'previs-blocking', ...(arg.propsOverride || {}) };

    const allShotsRaw =
      Array.isArray(arg.allShots) && arg.allShots.length > 0
        ? arg.allShots
        : (baseProps.stageShots ??
          (typeof baseProps.stageShotsJson === 'string'
            ? (() => {
                try {
                  return JSON.parse(baseProps.stageShotsJson);
                } catch {
                  return undefined;
                }
              })()
            : undefined));
    const allShots: SpatialDirectorShot[] = normalizeStageShots(allShotsRaw, baseProps.cameraBookmarks);
    const shotIdsToRun: string[] =
      Array.isArray(arg.shotIds) && arg.shotIds.length > 0
        ? arg.shotIds.map(String)
        : allShots.map((s) => s.id);
    const shotsToRun = allShots.filter((s) => shotIdsToRun.includes(s.id));
    if (!shotsToRun.length) throw new Error('没有可拍摄的镜头');

    const includeDepthNormal = Boolean(arg.includeDepthNormal);
    const motionOutput: 'video' | 'pair' | 'live-3d' =
      arg.motionOutput === 'pair' || arg.motionOutput === 'live-3d' ? arg.motionOutput : 'video';
    const addToTimeline = arg.addToTimeline !== false;
    const sceneSignature =
      typeof arg.sceneSignature === 'string' && arg.sceneSignature
        ? arg.sceneSignature
        : computeStageSceneSignature(baseProps);
    const srcName = srcClip?.name || srcComp?.name || srcVault?.name || srcAsset?.name || '3D 导演片场';

    const assetsDir = join(target.path, 'assets');
    await mkdir(assetsDir, { recursive: true });

    const ops: EditOperation[] = [];
    const createdAssets: Asset[] = [];
    const createdClipIds: string[] = [];
    const nextLayout: Record<string, { x: number; y: number }> = { ...(p.canvasLayout || {}) };

    const sourceLayoutKey = srcVault
      ? `vault:${srcVault.id}`
      : srcComp
        ? `comp:${srcComp.id}`
        : srcAsset
          ? `asset:${srcAsset.id}`
          : undefined;
    const srcCoord = sourceLayoutKey ? nextLayout[sourceLayoutKey] : undefined;
    const existingCoords = Object.values(nextLayout);
    const baseX = srcCoord
      ? srcCoord.x + 300
      : existingCoords.length
        ? Math.max(...existingCoords.map((c) => c.x)) + 280
        : 120;
    const baseY = srcCoord
      ? srcCoord.y
      : existingCoords.length
        ? Math.min(...existingCoords.map((c) => c.y))
        : 120;

    let timelineTail = baseSeq.clips.length
      ? Math.max(...baseSeq.clips.map((c) => c.start + c.duration))
      : 0;

    const updatedOutputMap = new Map<string, SpatialDirectorShot['output']>();

    const buildCleanPropsForShot = (
      shot: SpatialDirectorShot,
      passOverride: 'beauty' | 'clay' | 'depth' | 'normal' | 'wireframe',
    ): Record<string, unknown> => {
      const hasManualKf = Boolean(
        shot.mode === 'motion' &&
          shot.keyframes &&
          Object.values(shot.keyframes).some((arr) => Array.isArray(arr) && arr.length > 0),
      );
      return {
        ...baseProps,
        cameraPreset: shot.mode === 'still' || hasManualKf ? 'static' : shot.camera.cameraPreset || 'dolly-in',
        cameraLens: shot.camera.cameraLens,
        cameraYaw: shot.camera.cameraYaw,
        cameraPitch: shot.camera.cameraPitch,
        cameraDistance: shot.camera.cameraDistance,
        cameraPanX: shot.camera.cameraPanX ?? 0,
        cameraPanY: shot.camera.cameraPanY ?? 0,
        ...(shot.actorAction ? { actorAction: shot.actorAction } : {}),
        ...(shot.actorPath ? { actorPath: shot.actorPath } : {}),
        renderPass: passOverride,
        showHud: false,
        _studioInteractive: false,
        _showCameraPath: false,
        _selectedObjectId: null,
      };
    };

    for (let i = 0; i < shotsToRun.length; i++) {
      const shot = shotsToRun[i];
      const shotDurFrames = Math.max(fps, Math.round((shot.durationSec || (shot.mode === 'motion' ? 4 : 3)) * fps));
      const shotAssetIds: string[] = [];
      let primaryAssetId: string | undefined;
      let outClipId: string | undefined;
      let outKind: NonNullable<SpatialDirectorShot['output']>['kind'] = 'still';

      if (shot.mode === 'still') {
        const passes: ('beauty' | 'clay' | 'depth' | 'normal' | 'wireframe')[] = includeDepthNormal
          ? ['beauty', 'depth', 'normal']
          : [shot.renderPass || 'beauty'];
        outKind = passes.length > 1 ? 'multipass' : 'still';
        for (let pIdx = 0; pIdx < passes.length; pIdx++) {
          const pass = passes[pIdx];
          const cloned = structuredClone(p);
          const tempSeqId = uid('seq_shot');
          const tempClip: Clip = {
            id: uid('clip_shot'),
            name: `${shot.shortKey} · ${shot.name}`,
            kind: isCodeStage ? 'code' : srcClip ? srcClip.kind : 'shape',
            track: 'visual',
            layer: 0,
            start: 0,
            duration: Math.max(30, fps * 2),
            sourceIn: srcClip?.sourceIn || 0,
            assetId: isCodeStage ? undefined : srcClip?.assetId || srcAsset?.id || srcVault?.assetId,
            componentId: isCodeStage ? srcComp?.id || srcClip?.componentId : undefined,
            locked: false,
            props: buildCleanPropsForShot(shot, pass),
          };
          cloned.sequences.push({ ...baseSeq, id: tempSeqId, name: tempClip.name, clips: [tempClip] });
          const outPath = join(assetsDir, `shot-${shot.shortKey.toLowerCase()}-${pass}-${uid('f')}.png`);
          const job = await ctx.jobs.render(cloned, tempSeqId, outPath, {
            still: true,
            frame: 0,
            scale: 1,
            silent: true,
          });
          await ctx.jobs.wait(job.id);
          const asset = await importMedia(outPath, target.path);
          const passTag =
            pass === 'depth' ? '深度 Depth' : pass === 'normal' ? '法线 Normal' : pass === 'clay' ? '白模' : '';
          asset.name = passTag
            ? `${shot.shortKey} · ${shot.name} (${passTag})`
            : `${shot.shortKey} · ${shot.name} (${Math.round(shot.camera.cameraLens)}mm)`;
          asset.role = 'environment';
          asset.tags = passTag ? ['3D镜头素材', shot.shortKey, passTag] : ['3D镜头素材', shot.shortKey, '定机位'];
          asset.category = 'subject';
          asset.subkind = 'environment';
          asset.derivedFrom = [
            {
              ...(srcVault ? { vaultItemId: srcVault.id } : {}),
              ...(srcAsset ? { assetId: srcAsset.id } : {}),
              via: pass === 'depth' ? 'capture-depth' : pass === 'normal' ? 'capture-normal' : 'capture-3d',
              note: `拍自片场「${srcName}」· ${shot.shortKey} ${shot.name} (${shot.id})`,
            },
          ];
          createdAssets.push(asset);
          shotAssetIds.push(asset.id);
          if (pIdx === 0) primaryAssetId = asset.id;
          ops.push({ type: 'addAsset', asset });
          nextLayout[`asset:${asset.id}`] = findFreeCanvasPlacement(
            nextLayout,
            { x: baseX + i * 265, y: baseY + pIdx * 196 },
            { w: 256, h: 172 },
            `asset:${asset.id}`,
          );

          if (addToTimeline && pIdx === 0) {
            const imgClip: Clip = {
              id: uid('clip'),
              name: `${shot.shortKey} · ${shot.name}`,
              kind: 'image',
              track: 'visual',
              layer: 0,
              start: timelineTail,
              duration: Math.round(fps * 3),
              sourceIn: 0,
              assetId: asset.id,
              locked: false,
              props: { fit: 'cover', opacity: 1, scale: 1 },
            };
            timelineTail += imgClip.duration;
            outClipId = imgClip.id;
            createdClipIds.push(imgClip.id);
            ops.push({ type: 'addClip', sequenceId: baseSeq.id, clip: imgClip });
          }
        }
      } else if (motionOutput === 'live-3d') {
        outKind = 'live-3d';
        const liveClip: Clip = {
          id: uid('clip'),
          name: `${shot.shortKey} · ${shot.name}`,
          kind: isCodeStage ? 'code' : srcClip ? srcClip.kind : 'shape',
          track: 'visual',
          layer: 0,
          start: timelineTail,
          duration: shotDurFrames,
          sourceIn: 0,
          assetId: isCodeStage ? undefined : srcClip?.assetId || srcAsset?.id || srcVault?.assetId,
          componentId: isCodeStage ? srcComp?.id || srcClip?.componentId : undefined,
          locked: false,
          keyframes: shot.keyframes ? structuredClone(shot.keyframes) : undefined,
          props: buildCleanPropsForShot(shot, shot.renderPass || 'beauty'),
        };
        timelineTail += shotDurFrames;
        outClipId = liveClip.id;
        createdClipIds.push(liveClip.id);
        ops.push({ type: 'addClip', sequenceId: baseSeq.id, clip: liveClip });
      } else if (motionOutput === 'pair') {
        outKind = 'pair';
        const pairFrames = [0, Math.max(1, shotDurFrames - 1)];
        for (let fIdx = 0; fIdx < pairFrames.length; fIdx++) {
          const fNum = pairFrames[fIdx];
          const cloned = structuredClone(p);
          const tempSeqId = uid('seq_mpair');
          const tempClip: Clip = {
            id: uid('clip_mpair'),
            name: `${shot.shortKey} · ${fIdx === 0 ? '首帧' : '尾帧'}`,
            kind: isCodeStage ? 'code' : srcClip ? srcClip.kind : 'shape',
            track: 'visual',
            layer: 0,
            start: 0,
            duration: shotDurFrames,
            sourceIn: 0,
            assetId: isCodeStage ? undefined : srcClip?.assetId || srcAsset?.id || srcVault?.assetId,
            componentId: isCodeStage ? srcComp?.id || srcClip?.componentId : undefined,
            locked: false,
            keyframes: shot.keyframes ? structuredClone(shot.keyframes) : undefined,
            props: buildCleanPropsForShot(shot, shot.renderPass || 'beauty'),
          };
          cloned.sequences.push({ ...baseSeq, id: tempSeqId, name: tempClip.name, clips: [tempClip] });
          const outPath = join(
            assetsDir,
            `shot-${shot.shortKey.toLowerCase()}-${fIdx === 0 ? 'start' : 'end'}-${uid('f')}.png`,
          );
          const job = await ctx.jobs.render(cloned, tempSeqId, outPath, {
            still: true,
            frame: fNum,
            scale: 1,
            silent: true,
          });
          await ctx.jobs.wait(job.id);
          const asset = await importMedia(outPath, target.path);
          asset.name = `${shot.shortKey} · ${shot.name} (${fIdx === 0 ? '首帧' : '尾帧'})`;
          asset.role = 'environment';
          asset.tags = ['3D镜头素材', shot.shortKey, fIdx === 0 ? '首帧' : '尾帧'];
          asset.derivedFrom = [
            {
              ...(srcVault ? { vaultItemId: srcVault.id } : {}),
              ...(srcAsset ? { assetId: srcAsset.id } : {}),
              via: 'capture-3d',
              note: `拍自片场「${srcName}」· ${shot.shortKey} ${shot.name} ${fIdx === 0 ? '起镜首帧' : '落镜尾帧'}`,
            },
          ];
          createdAssets.push(asset);
          shotAssetIds.push(asset.id);
          if (fIdx === 0) primaryAssetId = asset.id;
          ops.push({ type: 'addAsset', asset });
          nextLayout[`asset:${asset.id}`] = findFreeCanvasPlacement(
            nextLayout,
            { x: baseX + i * 265, y: baseY + fIdx * 196 },
            { w: 256, h: 172 },
            `asset:${asset.id}`,
          );
        }
      } else {
        outKind = 'video';
        const cloned = structuredClone(p);
        const tempSeqId = uid('seq_mvid');
        const bakeW = Math.max(320, Math.round((baseSeq.width * (2 / 3)) / 2) * 2);
        const bakeH = Math.max(320, Math.round((baseSeq.height * (2 / 3)) / 2) * 2);
        const tempClip: Clip = {
          id: uid('clip_mvid'),
          name: `${shot.shortKey} · ${shot.name}`,
          kind: isCodeStage ? 'code' : srcClip ? srcClip.kind : 'shape',
          track: 'visual',
          layer: 0,
          start: 0,
          duration: shotDurFrames,
          sourceIn: 0,
          assetId: isCodeStage ? undefined : srcClip?.assetId || srcAsset?.id || srcVault?.assetId,
          componentId: isCodeStage ? srcComp?.id || srcClip?.componentId : undefined,
          locked: false,
          keyframes: shot.keyframes ? structuredClone(shot.keyframes) : undefined,
          props: buildCleanPropsForShot(shot, shot.renderPass || 'beauty'),
        };
        cloned.sequences.push({
          ...baseSeq,
          id: tempSeqId,
          name: tempClip.name,
          width: bakeW,
          height: bakeH,
          clips: [tempClip],
        });
        const outPath = join(assetsDir, `shot-${shot.shortKey.toLowerCase()}-${uid('vid')}.mp4`);
        const job = await ctx.jobs.render(cloned, tempSeqId, outPath, {
          scale: 1,
          preferOffscreenVideo: true,
          projectPath: target.path,
        });
        await ctx.jobs.wait(job.id);
        const asset = await importMedia(outPath, target.path);
        asset.name = `${shot.shortKey} · ${shot.name} (${shot.durationSec}s 预演视频)`;
        asset.role = 'footage';
        asset.tags = ['3D镜头素材', '3D预演视频', shot.shortKey];
        asset.derivedFrom = [
          {
            ...(srcVault ? { vaultItemId: srcVault.id } : {}),
            ...(srcAsset ? { assetId: srcAsset.id } : {}),
            via: 'bake-3d-video',
            note: `录自片场「${srcName}」· ${shot.shortKey} ${shot.name} (${shot.durationSec}s)`,
          },
        ];
        createdAssets.push(asset);
        shotAssetIds.push(asset.id);
        primaryAssetId = asset.id;
        ops.push({ type: 'addAsset', asset });
        nextLayout[`asset:${asset.id}`] = findFreeCanvasPlacement(
          nextLayout,
          { x: baseX + i * 265, y: baseY },
          { w: 256, h: 172 },
          `asset:${asset.id}`,
        );
        if (addToTimeline) {
          const vidClip: Clip = {
            id: uid('clip'),
            name: `${shot.shortKey} · ${shot.name}`,
            kind: 'video',
            track: 'visual',
            layer: 0,
            start: timelineTail,
            duration: shotDurFrames,
            sourceIn: 0,
            assetId: asset.id,
            locked: false,
            props: { fit: 'cover', opacity: 1, scale: 1 },
          };
          timelineTail += shotDurFrames;
          outClipId = vidClip.id;
          createdClipIds.push(vidClip.id);
          ops.push({ type: 'addClip', sequenceId: baseSeq.id, clip: vidClip });
        }
      }

      updatedOutputMap.set(shot.id, {
        assetIds: shotAssetIds,
        primaryAssetId,
        clipId: outClipId,
        kind: outKind,
        shotAt: new Date().toISOString(),
        sceneSignature,
      });
    }

    const nextAllShots = allShots.map((s) =>
      updatedOutputMap.has(s.id) ? { ...s, output: updatedOutputMap.get(s.id) } : s,
    );
    if (srcClip) {
      ops.push({
        type: 'updateClip',
        sequenceId: baseSeq.id,
        clipId: srcClip.id,
        changes: { props: { stageShots: nextAllShots } },
      });
    } else if (srcVault) {
      ops.push({
        type: 'putVaultItem',
        item: {
          ...srcVault,
          rig: {
            ...(srcVault.rig || { presetId: 'spatial-stage' }),
            props: { ...(srcVault.rig?.props || {}), stageShots: nextAllShots },
          },
          updatedAt: new Date().toISOString(),
        },
      });
    } else if (srcComp) {
      ops.push({
        type: 'putComponent',
        component: {
          ...srcComp,
          props: { ...(srcComp.props || {}), stageShotsJson: JSON.stringify(nextAllShots) },
        },
      });
    }

    ops.push({ type: 'updateProject', changes: { canvasLayout: nextLayout } });
    const latest = await target.project();
    const envelope = await target.edit({
      baseRevision: latest.revision,
      name:
        shotsToRun.length === 1
          ? `拍摄 3D 镜头「${shotsToRun[0].shortKey} · ${shotsToRun[0].name}」`
          : `批量拍摄本场 ${shotsToRun.length} 个 3D 镜头`,
      operations: ops,
    });
    await ctx.changed(target, envelope);
    return { envelope, assets: createdAssets, clipIds: createdClipIds, stageShots: nextAllShots };
  },
  'stage.componentPoster': async (arg, ctx) => {
    const p = await ctx.getStore().project();
    const componentId = String(arg?.componentId || '');
    if (!componentId) return { url: null };
    const fileName = await ctx.jobs.ensureComponentPoster(
      p,
      componentId,
      arg?.clipProps && typeof arg.clipProps === 'object' ? arg.clipProps : undefined,
      typeof arg?.frame === 'number' ? arg.frame : undefined,
    );
    return { url: fileName ? `${ctx.media.origin}/poster/${fileName}` : null };
  },
};
