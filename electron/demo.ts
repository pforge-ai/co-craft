import { join } from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';
import { Library } from './store';
import { newClip, uid } from '../src/core/project';
import type { Asset, Clip } from '../src/core/types';
import { waveformFor } from './media';
export async function createDemo(library: Library, resources: string) {
  const store = await library.create('沿海公路');
  const p = await store.project();
  const names = ['海岸公路', '风经过沙丘', '天亮之前'];
  const files = ['coast.svg', 'dunes.svg', 'night.svg'];
  const assets: Asset[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = join(store.path, 'assets', files[i]);
    await copyFile(join(resources, 'public', files[i]), file);
    assets.push({
      id: uid('asset'),
      name: names[i] + '.svg',
      kind: 'image',
      path: file,
      thumbnail: file,
      width: 1920,
      height: 1080,
      duration: 8,
      createdAt: new Date().toISOString(),
      source: { provider: 'CoCraft', author: 'CoCraft', license: '原创示例，可自由用于你的作品' },
    });
  }
  const clips: Clip[] = assets.map((a, i) => ({
    ...newClip('image', i * 240, a.id),
    name: names[i],
    duration: 240,
    props: { scale: 1, fit: 'cover' as const, opacity: 1, volume: 0 },
  }));
  clips.push({
    ...newClip('title', 24),
    name: '片头 · 沿海公路',
    duration: 180,
    props: {
      text: '沿海公路',
      subtitle: 'A LITTLE CLOSER TO THE SEA',
      fontSize: 112,
      color: '#f0ede4',
      template: 'editorial',
      position: 'center',
      align: 'center',
      animation: 'rise',
    },
  });
  clips.push({
    ...newClip('title', 300),
    name: '第二章 · 慢下来',
    duration: 156,
    props: {
      text: '把时间，交给风。',
      subtitle: 'TAKE THE LONG WAY HOME',
      fontSize: 72,
      color: '#f0ede4',
      template: 'editorial',
      position: 'center',
      align: 'center',
      animation: 'fade',
    },
  });
  clips.push({
    ...newClip('title', 528),
    name: '尾声 · 天亮见',
    duration: 156,
    props: {
      text: '下一站，天亮见。',
      subtitle: 'SOMEWHERE ALONG THE COAST',
      fontSize: 76,
      color: '#f0ede4',
      template: 'editorial',
      position: 'center',
      align: 'center',
      animation: 'rise',
    },
  });
  const audioPath = join(resources, 'public', 'coast-ambient.wav');
  try {
    const dst = join(store.path, 'assets', 'coast-ambient.wav');
    await copyFile(audioPath, dst);
    const a: Asset = {
      id: uid('asset'),
      name: '海边 · 合成氛围音.wav',
      kind: 'audio',
      path: dst,
      duration: 24,
      createdAt: new Date().toISOString(),
      source: { provider: 'CoCraft', license: '原创合成音频' },
    };
    a.waveform = await waveformFor(dst, store.path, a.id);
    assets.push(a);
    clips.push({ ...newClip('audio', 0, a.id), duration: 720, name: '海边 · 氛围', props: { volume: 0.6 } });
  } catch {}
  p.assets = assets;
  p.sequences[0].clips = clips;
  p.brief =
    '一场不赶时间的沿海旅行。\n\n调性：安静、克制、有呼吸感。\n画面：青灰色海岸、柔和光线、宽阔留白。\n节奏：三段式，24 秒；标题跟随画面缓缓出现。\n\n这是一份可编辑的示例工程。插画与合成氛围音为 CoCraft 原创，可自由修改与导出。';
  await store.init(p);
  await library.remember(store);
  return store;
}
