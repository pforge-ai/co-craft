import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { uid } from '../../src/core/project';
import { findFreeCanvasPlacement } from '../../src/lib/canvasLayout';
import type { EditOperation, VaultItem } from '../../src/core/types';
import { binary, importMedia, parseSilenceDetectLog, run } from '../media';
import type { IpcHandlerMap } from './types';

function placementOperation(
  existingLayout: Record<string, { x: number; y: number }> | undefined,
  nodeKey: string,
  placement: any,
): EditOperation[] {
  if (!placement || !Number.isFinite(placement.x) || !Number.isFinite(placement.y)) return [];
  const freePos = findFreeCanvasPlacement(
    existingLayout,
    { x: Number(placement.x), y: Number(placement.y) },
    nodeKey.startsWith('ent:') ? { w: 280, h: 156 } : { w: 256, h: 172 },
    nodeKey,
  );
  return [
    {
      type: 'updateProject',
      changes: {
        canvasLayout: {
          ...(existingLayout || {}),
          [nodeKey]: freePos,
        },
      },
    },
  ];
}

export const assetOpsIpcHandlers: IpcHandlerMap = {
  'asset.extractFrame': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const src = p.assets.find((a) => a.id === arg.assetId);
    if (!src || src.kind !== 'video') throw new Error('仅支持对视频素材抽取静态帧');
    if (src.offline || !existsSync(src.path)) throw new Error('视频素材文件离线或不存在');
    const mode: 'first' | 'last' | 'time' =
      arg.mode === 'last' ? 'last' : arg.mode === 'time' ? 'time' : 'first';
    const dur = Math.max(0, src.duration || 0);
    const targetSec =
      mode === 'last'
        ? Math.max(0, dur - 0.12)
        : mode === 'time'
          ? Math.max(0, Math.min(dur > 0.1 ? dur - 0.05 : 0, Number(arg.seconds ?? 0)))
          : 0;
    const assetsDir = join(target.path, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const outPath = join(assetsDir, `frame-${uid('ext')}.png`);
    await run(binary('ffmpeg'), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      targetSec.toFixed(3),
      '-i',
      src.path,
      '-frames:v',
      '1',
      outPath,
    ]);
    const frameAsset = await importMedia(outPath, target.path);
    const tagLabel = mode === 'last' ? '尾帧' : mode === 'time' ? `${targetSec.toFixed(1)}s 帧` : '首帧';
    const baseTitle = src.name.replace(/\.[^.]+$/, '').slice(0, 22);
    frameAsset.name = `${baseTitle} · ${tagLabel}`;
    frameAsset.derivedFrom = [
      {
        assetId: src.id,
        via: 'extract-frame',
        note: `抽取${tagLabel}`,
      },
    ];
    const ops: EditOperation[] = [
      { type: 'addAsset', asset: frameAsset },
      ...placementOperation(p.canvasLayout, `asset:${frameAsset.id}`, arg.placement),
    ];
    const envelope = await target.edit({
      baseRevision: p.revision,
      name: `抽取视频${tagLabel}「${frameAsset.name}」`,
      operations: ops,
    });
    await ctx.changed(target, envelope);
    return { envelope, asset: frameAsset };
  },
  'asset.detachAudio': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const src = p.assets.find((a) => a.id === arg.assetId);
    if (!src || src.kind !== 'video') throw new Error('仅支持对视频素材提取音轨');
    if (src.offline || !existsSync(src.path)) throw new Error('视频素材文件离线或不存在');
    const assetsDir = join(target.path, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const outPath = join(assetsDir, `audio-${uid('ext')}.wav`);
    try {
      await run(binary('ffmpeg'), [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        src.path,
        '-vn',
        '-c:a',
        'pcm_s16le',
        '-ar',
        '44100',
        outPath,
      ]);
    } catch (err) {
      await rm(outPath, { force: true }).catch(() => {});
      if (String(err).includes('matches no streams') || String(err).includes('Stream map')) {
        throw new Error('该视频不包含可提取的音轨');
      }
      throw err;
    }
    const audioAsset = await importMedia(outPath, target.path);
    const baseTitle = src.name.replace(/\.[^.]+$/, '').slice(0, 22);
    audioAsset.name = `${baseTitle} · 提取音轨`;
    audioAsset.derivedFrom = [
      {
        assetId: src.id,
        via: 'detach-audio',
        note: '提取音轨',
      },
    ];
    const ops: EditOperation[] = [
      { type: 'addAsset', asset: audioAsset },
      ...placementOperation(p.canvasLayout, `asset:${audioAsset.id}`, arg.placement),
    ];
    const envelope = await target.edit({
      baseRevision: p.revision,
      name: `提取视频音轨「${audioAsset.name}」`,
      operations: ops,
    });
    await ctx.changed(target, envelope);
    return { envelope, asset: audioAsset };
  },
  'asset.normalizeAudio': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const src = p.assets.find((a) => a.id === arg.assetId);
    if (!src || (src.kind !== 'audio' && src.kind !== 'video')) {
      throw new Error('仅支持对音频或视频素材做响度标准化');
    }
    if (src.offline || !existsSync(src.path)) throw new Error('素材文件离线或不存在');
    const assetsDir = join(target.path, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const outPath = join(assetsDir, `norm-${uid('aud')}.wav`);
    try {
      await run(binary('ffmpeg'), [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        src.path,
        '-vn',
        '-af',
        'loudnorm=I=-14:TP=-1.5:LRA=11',
        '-c:a',
        'pcm_s16le',
        '-ar',
        '44100',
        outPath,
      ]);
    } catch (err) {
      await rm(outPath, { force: true }).catch(() => {});
      throw err;
    }
    const normAsset = await importMedia(outPath, target.path);
    const baseTitle = src.name.replace(/\.[^.]+$/, '').slice(0, 20);
    normAsset.name = `${baseTitle} · -14 LUFS`;
    normAsset.derivedFrom = [
      {
        assetId: src.id,
        via: 'audio-normalize',
        note: '响度标准化 (-14 LUFS)',
      },
    ];
    const ops: EditOperation[] = [
      { type: 'addAsset', asset: normAsset },
      ...placementOperation(p.canvasLayout, `asset:${normAsset.id}`, arg.placement),
    ];
    const envelope = await target.edit({
      baseRevision: p.revision,
      name: `人声响度标准化「${normAsset.name}」`,
      operations: ops,
    });
    await ctx.changed(target, envelope);
    return { envelope, asset: normAsset };
  },
  'asset.trimSilence': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const src = p.assets.find((a) => a.id === arg.assetId);
    if (!src || (src.kind !== 'audio' && src.kind !== 'video')) {
      throw new Error('仅支持对音频或视频素材去除气口静音');
    }
    if (src.offline || !existsSync(src.path)) throw new Error('素材文件离线或不存在');
    const thresholdDb = Number.isFinite(Number(arg.thresholdDb)) ? Number(arg.thresholdDb) : -38;
    const minSilenceSec = Number.isFinite(Number(arg.minSilenceSec)) ? Number(arg.minSilenceSec) : 0.35;
    const detectStderr = await run(
      binary('ffmpeg'),
      [
        '-hide_banner',
        '-i',
        src.path,
        '-vn',
        '-af',
        `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}`,
        '-f',
        'null',
        '-',
      ],
      { captureStderr: true },
    );
    const { kept, removedSeconds } = parseSilenceDetectLog(detectStderr, src.duration || 0, 0.06);
    if (!kept.length) throw new Error('音频整体低于静音阈值，未执行裁切');
    if (removedSeconds < 0.15) throw new Error('未检测到超过 0.35s 的明显静音停顿');

    const assetsDir = join(target.path, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const outPath = join(assetsDir, `trim-${uid('aud')}.wav`);
    const filterParts: string[] = [];
    const labels: string[] = [];
    kept.forEach((seg, idx) => {
      filterParts.push(
        `[0:a]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[a${idx}]`,
      );
      labels.push(`[a${idx}]`);
    });
    const filterComplex =
      kept.length === 1
        ? `${filterParts[0]}`
        : `${filterParts.join(';')};${labels.join('')}concat=n=${kept.length}:v=0:a=1[aout]`;
    const mapLabel = kept.length === 1 ? '[a0]' : '[aout]';
    try {
      await run(binary('ffmpeg'), [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        src.path,
        '-filter_complex',
        filterComplex,
        '-map',
        mapLabel,
        '-c:a',
        'pcm_s16le',
        '-ar',
        '44100',
        outPath,
      ]);
    } catch (err) {
      await rm(outPath, { force: true }).catch(() => {});
      throw err;
    }
    const trimmedAsset = await importMedia(outPath, target.path);
    const baseTitle = src.name.replace(/\.[^.]+$/, '').slice(0, 20);
    trimmedAsset.name = `${baseTitle} · 去静音`;
    trimmedAsset.derivedFrom = [
      {
        assetId: src.id,
        via: 'silence-trim',
        note: `裁去 ${removedSeconds.toFixed(1)}s 静音`,
      },
    ];
    const ops: EditOperation[] = [
      { type: 'addAsset', asset: trimmedAsset },
      ...placementOperation(p.canvasLayout, `asset:${trimmedAsset.id}`, arg.placement),
    ];
    const envelope = await target.edit({
      baseRevision: p.revision,
      name: `去除静音气口「${trimmedAsset.name}」`,
      operations: ops,
    });
    await ctx.changed(target, envelope);
    return { envelope, asset: trimmedAsset, removedSeconds };
  },
  'asset.visionDescribe': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const src = p.assets.find((a) => a.id === arg.assetId);
    if (!src || (src.kind !== 'image' && src.kind !== 'video')) {
      throw new Error('仅支持对图片或视频反推视觉提示词');
    }
    if (src.offline || !existsSync(src.path)) throw new Error('素材文件离线或不存在');
    const visionPrompt =
      typeof arg.prompt === 'string' && arg.prompt.trim()
        ? arg.prompt.trim()
        : '请用简洁、精准、可直接用于 AI 生图或改图的中文视觉提示词描述这张画面：依次涵盖主体外貌/服饰、姿态表情、场景环境、光影色调、景别构图与美术风格。不要输出解释性客套话，直接输出一段可编辑提示词。';
    const job = await ctx.generation.start(target, {
      use: 'vision',
      assetId: src.id,
      modelId: arg.modelId,
      prompt: visionPrompt,
    });
    const result = await ctx.jobs.wait(job.id);
    const described = String(result.text || '').trim();
    if (!described) throw new Error('视觉模型未返回有效画面描述');
    const latest = await target.project();
    const baseTitle = src.name.replace(/\.[^.]+$/, '').slice(0, 18);
    const textItem: VaultItem = {
      id: uid('pvault'),
      name: `${baseTitle} · 反推提示词`,
      entityKind: 'text',
      category: 'subject',
      subkind: 'text-note',
      textContent: described,
      derivedFrom: [
        {
          assetId: src.id,
          via: 'vision-describe',
          note: '视觉反推提示词',
        },
      ],
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    const ops: EditOperation[] = [
      { type: 'putVaultItem', item: textItem },
      ...placementOperation(latest.canvasLayout, `ent:${textItem.id}`, arg.placement),
    ];
    const envelope = await target.edit({
      baseRevision: latest.revision,
      name: `反推画面提示词「${textItem.name}」`,
      operations: ops,
    });
    await ctx.changed(target, envelope);
    return { envelope, vaultItem: textItem };
  },
};
