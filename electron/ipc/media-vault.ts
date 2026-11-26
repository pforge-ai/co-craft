import { dialog } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { applyOperations, clone, parseSRTText, uid } from '../../src/core/project';
import type { Asset, EditOperation, StockVideo } from '../../src/core/types';
import { compileComponent } from '../code';
import { downloadToFile } from '../generation';
import { importMedia } from '../media';
import { exportMaterialPack, importMaterialPack } from '../packs';
import { addStudioAsset } from '../studio-media';
import type { IpcHandlerMap } from './types';

export const mediaVaultIpcHandlers: IpcHandlerMap = {
  'media.import': async (arg, ctx) => {
    let paths = arg.paths;
    if (!paths) {
      const d = await dialog.showOpenDialog(ctx.getWin(), {
        title: '导入素材',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: '视频、图片、音频与 3D 模型',
            extensions: [
              'mp4',
              'mov',
              'm4v',
              'webm',
              'mkv',
              'png',
              'jpg',
              'jpeg',
              'webp',
              'svg',
              'gif',
              'mp3',
              'wav',
              'm4a',
              'aac',
              'flac',
              'glb',
              'gltf',
              'spz',
              'splat',
              'ksplat',
              'ply',
            ],
          },
        ],
      });
      if (d.canceled) return null;
      paths = d.filePaths;
    }
    return ctx.importFiles(paths, arg.append, arg.sequenceId);
  },
  'media.relink': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const asset = p.assets.find((a) => a.id === arg.assetId);
    if (!asset) throw new Error('待重连的资产不存在');
    let filePath: string | undefined = arg.path;
    if (!filePath) {
      const d = await dialog.showOpenDialog(ctx.getWin(), {
        title: `重新定位「${asset.name}」`,
        properties: ['openFile'],
        filters: [
          {
            name:
              asset.kind === 'image'
                ? '图片'
                : asset.kind === 'audio'
                  ? '音频'
                  : asset.kind === 'model-3d'
                    ? '3D 模型'
                    : '视频',
            extensions:
              asset.kind === 'image'
                ? ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif']
                : asset.kind === 'audio'
                  ? ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
                  : asset.kind === 'model-3d'
                    ? ['glb', 'gltf', 'spz', 'splat', 'ksplat', 'ply']
                    : ['mp4', 'mov', 'm4v', 'webm', 'mkv'],
          },
        ],
      });
      if (d.canceled || !d.filePaths[0]) return null;
      filePath = d.filePaths[0];
    }
    const thumbDir = join(target.path, '.cocraft', 'thumbnails');
    const tempThumb =
      asset.kind === 'video' ? join(thumbDir, `${asset.id}.relink-${Date.now()}.jpg`) : undefined;
    const finalThumb = asset.kind === 'video' ? join(thumbDir, `${asset.id}.jpg`) : undefined;
    let probed: Asset;
    try {
      probed = await importMedia(filePath, target.path, asset.id, { thumbnailPath: tempThumb });
    } catch (err) {
      if (tempThumb) await rm(tempThumb, { force: true }).catch(() => {});
      throw err;
    }
    if (probed.kind !== asset.kind) {
      if (tempThumb) await rm(tempThumb, { force: true }).catch(() => {});
      throw new Error('所选文件类型与原资产不一致');
    }
    const sameContent = Boolean(asset.sha256 && probed.sha256 && asset.sha256 === probed.sha256);
    const lockedRefs = p.sequences.flatMap((s) =>
      s.clips.filter(
        (c) => c.locked && (c.assetId === asset.id || c.takes?.some((t) => t.assetId === asset.id)),
      ),
    );
    if (!sameContent && lockedRefs.length > 0 && arg.mode === 'fork-unlocked') {
      const newAssetId = uid('asset');
      let forkedThumb = probed.thumbnail;
      if (tempThumb && existsSync(tempThumb)) {
        forkedThumb = join(thumbDir, `${newAssetId}.jpg`);
        await rename(tempThumb, forkedThumb);
      }
      const forkedAsset: Asset = { ...probed, id: newAssetId, thumbnail: forkedThumb };
      const ops: EditOperation[] = [{ type: 'addAsset', asset: forkedAsset }];
      for (const seq of p.sequences) {
        for (const clip of seq.clips) {
          if (clip.locked) continue;
          const changes: Partial<typeof clip> = {};
          if (clip.assetId === asset.id) changes.assetId = newAssetId;
          if (clip.takes?.some((t) => t.assetId === asset.id)) {
            changes.takes = clip.takes.map((t) =>
              t.assetId === asset.id ? { ...clone(t), assetId: newAssetId } : clone(t),
            );
          }
          if (Object.keys(changes).length > 0) {
            ops.push({ type: 'updateClip', sequenceId: seq.id, clipId: clip.id, changes });
          }
        }
      }
      const e = await target.edit({
        baseRevision: p.revision,
        name: `派生新素材替换未锁定镜头「${asset.name}」`,
        operations: ops,
      });
      await ctx.changed(target, e);
      return e;
    }
    try {
      const e = await target.edit({
        baseRevision: p.revision,
        name: sameContent ? `找回原素材「${asset.name}」` : `重连并替换素材「${asset.name}」`,
        operations: [
          {
            type: 'relinkAsset',
            assetId: asset.id,
            path: probed.path,
            sha256: probed.sha256,
            byteSize: probed.byteSize,
            duration: probed.duration,
            width: probed.width,
            height: probed.height,
            thumbnail: finalThumb || probed.thumbnail,
            waveform: probed.waveform,
            hasAudio: probed.hasAudio,
            clearTranscript: !sameContent,
          },
        ],
      });
      if (tempThumb && finalThumb && existsSync(tempThumb)) {
        await rename(tempThumb, finalThumb);
      }
      if (!sameContent) {
        await rm(join(target.path, '.cocraft', 'analysis', `transcript-${asset.id}.json`), {
          force: true,
        }).catch(() => {});
      }
      await ctx.changed(target, e);
      return e;
    } catch (err) {
      if (tempThumb) await rm(tempThumb, { force: true }).catch(() => {});
      throw err;
    }
  },
  'captions.import': async (arg, ctx) => {
    const target = ctx.getStore();
    let text = arg.text;
    if (!text) {
      const d = await dialog.showOpenDialog(ctx.getWin(), {
        title: '导入字幕',
        properties: ['openFile'],
        filters: [{ name: 'SubRip 字幕', extensions: ['srt'] }],
      });
      if (d.canceled) return null;
      text = await readFile(d.filePaths[0], 'utf8');
    }
    const p = await target.project();
    const s = p.sequences.find((seq) => seq.id === arg.sequenceId) || p.sequences[0];
    const clips = parseSRTText(text, s.fps);
    if (!clips.length) throw new Error('没有读取到有效的 SRT 字幕');
    const e = await target.edit({
      baseRevision: p.revision,
      name: `导入 ${clips.length} 条字幕`,
      operations: clips.map((clip) => ({ type: 'addClip', sequenceId: s.id, clip })),
    });
    await ctx.changed(target, e);
    return e;
  },
  'captions.export': async (arg, ctx) => {
    const store = ctx.getStore();
    const p = await store.project();
    const s = p.sequences.find((seq) => seq.id === arg.sequenceId);
    if (!s) throw new Error('成片不存在');
    const stamp = (f: number) => {
      const ms = Math.round((f / s.fps) * 1000);
      return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
    };
    const content = s.clips
      .filter((c) => c.kind === 'caption')
      .sort((a, b) => a.start - b.start)
      .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.start + c.duration)}\n${c.props.text || ''}\n`)
      .join('\n');
    const d = await dialog.showSaveDialog(ctx.getWin(), {
      defaultPath: join(store.path, 'exports', ctx.sanitizeFileName(s.name, 'captions') + '.srt'),
      filters: [{ name: '字幕', extensions: ['srt'] }],
    });
    if (d.canceled || !d.filePath) return null;
    await writeFile(d.filePath, content);
    return d.filePath;
  },
  'code.compile': async (arg, ctx) => {
    const target = ctx.getStore();
    const existing = (await target.project()).components.find((c) => c.id === arg.id);
    const pack = existing?.pack;
    const component = await compileComponent(
      arg.source,
      arg.id || uid('component'),
      arg.name || '自定义画面',
      target.path,
      arg.props,
      pack ? dirname(join(pack.sourceDirectory, pack.entry || 'index.tsx')) : target.path,
    );
    return pack ? { ...component, pack } : component;
  },
  'studio.add': async (arg, ctx) => {
    const target = ctx.getStore();
    const result = await addStudioAsset(
      target,
      ctx.getStudioMedia(),
      arg.id,
      arg.sequenceId,
      arg.at,
      arg.projectId,
    );
    await ctx.changed(target, result.envelope);
    return result;
  },
  'packs.import': async (arg, ctx) => {
    const target = ctx.getStore();
    let directory = join(ctx.resources, 'packs', 'studio-signature');
    if (arg.directory) {
      directory = String(arg.directory);
    } else if (!arg.example) {
      const picked = await dialog.showOpenDialog(ctx.getWin(), {
        title: '选择含 cocraft-pack.json 的素材包',
        properties: ['openDirectory'],
      });
      if (picked.canceled) return null;
      directory = picked.filePaths[0];
    }
    const project = await target.project();
    const pack = await importMaterialPack(directory, target.path, project);
    if (!pack.operations.length) return target.envelope();
    await ctx.jobs.validateComponents(applyOperations(project, pack.operations, 'you'), pack.operations);
    const next = await target.edit({
      baseRevision: project.revision,
      name: '导入素材包 · ' + pack.packName,
      operations: pack.operations,
    });
    await ctx.changed(target, next);
    return next;
  },
  'packs.export': async (arg, ctx) => {
    let targetDir = arg.targetDir ? String(arg.targetDir) : '';
    if (!targetDir) {
      const picked = await dialog.showOpenDialog(ctx.getWin(), {
        title: '选择素材包导出目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || !picked.filePaths[0]) return null;
      targetDir = picked.filePaths[0];
    }
    return exportMaterialPack(ctx.getStore(), {
      targetDir,
      name: arg.name,
      assetIds: arg.assetIds,
      componentIds: arg.componentIds,
      vaultIds: arg.vaultIds,
    });
  },
  'stock.search': async (arg, ctx) => {
    const pexelsKey = await ctx.settings.stockKey();
    if (!pexelsKey) throw new Error('在设置中填写 Pexels API Key，即可搜索视频素材。');
    const response = await fetch(
      'https://api.pexels.com/v1/videos/search?' +
        new URLSearchParams({
          query: arg.query,
          per_page: '12',
          orientation: arg.orientation || 'landscape',
        }),
      { headers: { Authorization: pexelsKey } },
    );
    if (!response.ok) throw new Error(`Pexels 搜索失败 (${response.status})`);
    const data = (await response.json()) as any;
    return data.videos.map((v: any) => {
      const files = v.video_files
        .filter((f: any) => f.file_type === 'video/mp4')
        .sort((a: any, b: any) => Math.abs(a.width - 1920) - Math.abs(b.width - 1920));
      const f = files[0];
      const item: StockVideo = {
        id: v.id,
        name: `Pexels · ${v.id}`,
        thumbnail: v.image,
        url: v.url,
        download: f?.link,
        author: v.user.name,
        duration: v.duration,
        width: f?.width,
        height: f?.height,
      };
      ctx.knownStock.set(item.id, item);
      return item;
    });
  },
  'stock.import': async (arg, ctx) => {
    // Capture target store BEFORE async network download to prevent cross-project race condition!
    const target = ctx.getStore();
    const item = ctx.knownStock.get(arg.id);
    if (!item?.download) throw new Error('请先重新搜索这条素材');
    const file = join(target.path, 'assets', `pexels-${item.id}-${Date.now()}.mp4`);
    await mkdir(dirname(file), { recursive: true });
    await downloadToFile(item.download, file, new AbortController().signal);
    const asset = await importMedia(file, target.path);
    asset.source = { provider: 'Pexels', url: item.url, author: item.author, license: 'Pexels License' };
    const p = await target.project();
    const e = await target.edit({
      baseRevision: p.revision,
      name: '添加 Pexels 素材',
      operations: [{ type: 'addAsset', asset }],
    });
    await ctx.changed(target, e);
    return e;
  },
  'voice.generate': async (arg, ctx) => {
    const target = ctx.getStore();
    const job = await ctx.generation.start(target, {
      use: 'speech',
      prompt: arg.text,
      parameters: arg.rate ? { rate: arg.rate } : {},
    });
    await ctx.generation.wait(job.id);
    return target.envelope();
  },
  'vault.list': (_arg, ctx) => ctx.globalVault.list(),
  'vault.promote': (arg, ctx) => ctx.globalVault.promoteFromProject(ctx.getStore(), arg),
  'vault.pull': async (arg, ctx) => {
    const target = ctx.getStore();
    const res = await ctx.globalVault.pullToProject(target, String(arg.id));
    await ctx.changed(target, res.envelope);
    return res;
  },
  'vault.remove': (arg, ctx) => ctx.globalVault.removeGlobal(String(arg.id)),
  'vault.removeGlobal': (arg, ctx) => ctx.globalVault.removeGlobal(String(arg.id)),
};
