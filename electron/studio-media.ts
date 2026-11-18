import { basename, join } from 'node:path';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { nativeImage } from 'electron';
import type { Asset, EditOperation } from '../src/core/types';
import { newClip } from '../src/core/project';
import type { ProjectStore } from './store';

const inventory = [
  ['phase-turntable.jpg', '唱针 · 黑胶纹理'],
  ['tram.jpg', '雨后的电车'],
  ['ridge.jpg', '山脊晨光'],
  ['glass-ident.wav', '玻璃音标'],
  ['soft-impact.wav', '柔和落点'],
  ['slipstream.wav', '滑过转场'],
  ['pulse-bed.wav', '脉冲底乐'],
] as const;
const released = '2026-11-18T00:00:00Z';

// Bundled audio is written by create-studio-audio as stereo PCM with a canonical 44-byte WAV header.
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
    inventory.map(async ([file, name]) => {
      const path = join(resources, 'public', 'studio', file),
        image = file.endsWith('.jpg');
      const meta = image
        ? { duration: 5, thumbnail: path, ...nativeImage.createFromPath(path).getSize() }
        : audioMetadata(await readFile(path));
      return {
        id: 'studio-v1-' + file.split('.')[0],
        name,
        kind: image ? 'image' : 'audio',
        path,
        createdAt: released,
        ...meta,
        source: {
          provider: 'CoCraft Studio',
          author: image ? 'CoCraft · ImageGen' : 'CoCraft',
          license: '可用于个人与商业成片，无需署名',
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
  if (!source) throw new Error('随附素材不存在');
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
