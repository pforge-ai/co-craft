import { basename, join } from 'node:path';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { nativeImage } from 'electron';
import type { Asset, AssetRole, EditOperation } from '../src/core/types';
import { newClip } from '../src/core/project';
import type { ProjectStore } from './store';

const inventory: readonly [string, string, AssetRole, string[]][] = [
  ['ui-click.wav', '清脆鼠标点击', 'sfx', ['点击', '界面演示', '卡点']],
  ['card-pop.wav', '卡片轻巧弹出', 'sfx', ['弹出', '图形入场', '卡点']],
  ['slipstream.wav', '柔和空气转场', 'sfx', ['转场', '推拉', '风声']],
  ['data-tick.wav', '数字滚动滴答', 'sfx', ['数据', '计数', '科技']],
  ['soft-impact.wav', '章节低频落定', 'sfx', ['章节', '重音', '片头']],
  ['glass-ident.wav', '清透玻璃音标', 'sfx', ['片头', '品牌音标']],
  ['pulse-bed.wav', '科技轻脉冲底乐', 'bgm', ['底乐', '科技', '预留人声']],
  ['warm-ambient.wav', '温暖极简环境底乐', 'bgm', ['底乐', '叙事', '预留人声']],
  ['phase-turntable.jpg', '精密金属暗调纹理', 'backdrop', ['背景底板', '暗调', '工业']],
  ['tram.jpg', '城市街景浅景深', 'backdrop', ['环境参考', '街景']],
  ['ridge.jpg', '山脊柔光晨雾', 'backdrop', ['背景底板', '自然']],
];
const released = '2026-11-18T00:00:00Z';

function audioMetadata(buffer: Buffer) {
  const frames = (buffer.length - 44) / 4,
    rate = buffer.readUInt32LE(24);
  const waveform = Array.from({ length: 128 }, (_, bucket) => {
    let peak = 0;
    for (let i = Math.floor((frames * bucket) / 128); i < Math.floor((frames * (bucket + 1)) / 128); i += 8)
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(44 + i * 4)) / 32768);
    return Math.sqrt(peak);
  });
  return { duration: frames / rate, waveform };
}

export async function studioCatalog(resources: string): Promise<Asset[]> {
  return Promise.all(
    inventory.map(async ([file, name, role, tags]) => {
      const path = join(resources, 'public', 'studio', file),
        image = file.endsWith('.jpg');
      const meta = image
        ? { duration: 5, thumbnail: path, ...nativeImage.createFromPath(path).getSize() }
        : audioMetadata(await readFile(path));
      return {
        id: 'studio-v1-' + file.split('.')[0],
        name,
        kind: image ? 'image' : 'audio',
        role,
        tags: [...tags],
        path,
        hasAudio: !image,
        createdAt: released,
        ...meta,
        source: {
          provider: 'CoCraft 内置积木',
          author: 'CoCraft',
          license: '离线内置，可用于个人与商业成片',
        },
      } satisfies Asset;
    }),
  );
}

export async function stageStudioAsset(projectPath: string, source: Asset): Promise<Asset> {
  const folder = join(projectPath, 'assets', 'cocraft-studio-v1');
  await mkdir(folder, { recursive: true });
  const path = join(folder, basename(source.path));
  try {
    await copyFile(source.path, path, constants.COPYFILE_EXCL);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  return { ...source, id: 'asset-' + source.id, path, thumbnail: source.kind === 'image' ? path : undefined };
}

export async function addStudioAsset(
  store: ProjectStore,
  catalog: Asset[],
  id: string,
  sequenceId: string,
  at: number,
  projectId: string,
) {
  const p = await store.project();
  const seq = p.sequences.find((s) => s.id === sequenceId);
  if (!seq || p.id !== projectId) throw new Error('工程或成片已经切换');
  const source = catalog.find((a) => a.id === id);
  if (!source) throw new Error('内置资产不存在');
  const existing = p.assets.find((a) => a.id === 'asset-' + source.id);
  const asset = existing || (await stageStudioAsset(store.path, source));
  const operations: EditOperation[] = existing ? [] : [{ type: 'addAsset', asset }];
  const clip = {
    ...newClip(asset.kind, Math.max(0, Math.round(at)), asset.id),
    name: asset.name,
    duration: Math.max(1, Math.round(asset.duration * seq.fps)),
  };
  operations.push({ type: 'addClip', sequenceId, clip });
  return {
    envelope: await store.edit({ baseRevision: p.revision, name: '添加' + asset.name, operations }),
    clipId: clip.id,
  };
}
