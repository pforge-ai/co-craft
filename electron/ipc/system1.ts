import { existsSync } from 'node:fs';
import { uid } from '../../src/core/project';
import type { EditOperation } from '../../src/core/types';
import type { IpcHandlerMap } from './types';

export const system1IpcHandlers: IpcHandlerMap = {
  'system1.status': (_arg, ctx) => ctx.system1.status(),
  'system1.test': (_arg, ctx) => ctx.system1.testConnection(),
  'system1.resetUsage': (_arg, ctx) => ctx.system1.resetUsage(),
  'system1.routeOmnibar': (arg, ctx) => ctx.system1.routeOmnibar(String(arg.text || '')),
  'system1.autoReframeBranch': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const src = p.sequences.find((s) => s.id === arg.sequenceId) || p.sequences[0];
    if (!src) throw new Error('源成片分支不存在');
    const newSequenceId = String(arg.newSequenceId || uid('seq'));
    const branchName = String(arg.branchName || `${src.name}-竖屏9:16`).trim();
    const width = Number(arg.width) || 1080;
    const height = Number(arg.height) || 1920;

    // Optional System 1 Box localization per visual clip (strictly zero paid calls when OFF or feature toggle OFF)
    const focalOverrides: Record<string, { focalX: number; focalY: number }> = {};
    const boxProviders = new Set<string>();
    const s1Status = await ctx.system1.status();
    if (s1Status.mode !== 'off' && s1Status.features.autoReframeBox && !s1Status.capReached) {
      const seenAssets = new Set<string>();
      for (const clip of src.clips) {
        if ((clip.kind !== 'image' && clip.kind !== 'video') || !clip.assetId) continue;
        if (seenAssets.has(clip.assetId)) continue;
        seenAssets.add(clip.assetId);
        const asset = p.assets.find((a) => a.id === clip.assetId);
        const samplePath = asset?.kind === 'image' ? asset.path : asset?.thumbnail;
        if (!samplePath || !existsSync(samplePath)) continue;
        const res = await ctx.system1.locateSubjectFocal(samplePath, clip.shotNotes || clip.name);
        if (res) {
          focalOverrides[clip.assetId] = { focalX: res.focalX, focalY: res.focalY };
          boxProviders.add(res.provider);
        }
      }
    }

    const latest = await target.project();
    const envelope = await target.edit({
      baseRevision: latest.revision,
      name: `智能画幅派生「${branchName}」(${width}×${height})`,
      operations: [
        {
          type: 'forkSequenceBranch',
          sourceSequenceId: src.id,
          newSequenceId,
          branchName,
          width,
          height,
          autoReframe: true,
          ...(Object.keys(focalOverrides).length ? { focalOverrides } : {}),
        },
      ],
    });
    await ctx.changed(target, envelope);
    return {
      envelope,
      sequenceId: newSequenceId,
      focalCount: Object.keys(focalOverrides).length,
      provider: boxProviders.size > 0 ? Array.from(boxProviders)[0] : 'local',
    };
  },
  'system1.triageAssets': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const ids = Array.isArray(arg.assetIds)
      ? arg.assetIds.filter((x: unknown): x is string => typeof x === 'string')
      : [];
    const targets = p.assets.filter((a) => ids.includes(a.id) && a.kind === 'image');
    if (targets.length < 2) throw new Error('请至少选中 2 张图片候选进行质检挑优');
    const promptHint = String(arg.prompt || '').trim();
    const { scores, provider, fallbackNotice } = await ctx.system1.triageCandidates(targets, promptHint);
    const ops: EditOperation[] = Object.entries(scores).map(([assetId, qualityScore]) => ({
      type: 'updateAssetMeta',
      assetId,
      changes: { qualityScore },
    }));
    const latest = await target.project();
    const envelope = await target.edit({
      baseRevision: latest.revision,
      name: `候选质检挑优（${targets.length} 张 · ${provider === 'local' ? '本地免费' : provider}）`,
      operations: ops,
    });
    await ctx.changed(target, envelope);
    return { envelope, scores, provider, fallbackNotice };
  },
  'system1.autoTagAssets': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const ids = Array.isArray(arg.assetIds)
      ? arg.assetIds.filter((x: unknown): x is string => typeof x === 'string')
      : [];
    const targets = p.assets.filter((a) => ids.includes(a.id));
    if (!targets.length) throw new Error('请先选中需要归类的素材');
    const { roles, provider } = await ctx.system1.classifyAssetRoles(targets);
    const ops: EditOperation[] = Object.entries(roles).map(([assetId, role]) => ({
      type: 'updateAssetMeta',
      assetId,
      changes: { role },
    }));
    const latest = await target.project();
    const envelope = await target.edit({
      baseRevision: latest.revision,
      name: `智能标角色（${targets.length} 项 · ${provider === 'local' ? '本地免费' : provider}）`,
      operations: ops,
    });
    await ctx.changed(target, envelope);
    return { envelope, roles, provider };
  },
};
