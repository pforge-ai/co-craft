import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { nativeImage } from 'electron';
import type { Library } from './store';
import { newClip, uid } from '../src/core/project';
import { createPresetClip, phaseAtSecond } from '../src/core/presets';
import type { Asset, Clip, Sequence } from '../src/core/types';

const fps = 30;
const score = [
  {
    start: 0,
    end: 4.8,
    name: '相位之间',
    copy: '两道一样的声音，相加后能有多安静？',
    from: 0,
    to: 0,
    sweep: 1,
    photo: true,
  },
  {
    start: 4.8,
    end: 9,
    name: '波峰对齐',
    copy: '两道等幅的波同时起落。相加时，振幅正好翻倍。',
    from: 0,
    to: 0,
    sweep: 1,
    photo: false,
  },
  {
    start: 9,
    end: 15,
    name: '错开半周',
    copy: '把第二道波向前移半个周期。波峰遇上波谷，输出渐渐归零。',
    from: 0,
    to: 180,
    sweep: 3.6,
    photo: false,
  },
  {
    start: 15,
    end: 20,
    name: '声音回来',
    copy: '把两道波重新对齐。听，原来的脉动又回来了。',
    from: 180,
    to: 0,
    sweep: 2.8,
    photo: true,
  },
];
const durationSeconds = score.at(-1)!.end;

/** Phase-locked dual 220 Hz signals. The score and sound have the same transition curve. */
function synthesizeScore(): Buffer {
  const rate = 44100,
    samples = durationSeconds * rate,
    bytes = samples * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(bytes, 40);
  let scene = 0;
  const emphasis = [1, 0.66, 0.81, 0.55];
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    if (scene + 1 < score.length && t >= score[scene + 1].start) scene++;
    const { start, from, to, sweep } = score[scene];
    const phase = (phaseAtSecond(t - start, from, to, sweep) * Math.PI) / 180;
    const beat = Math.floor(t / 0.6),
      beatTime = t - beat * 0.6;
    const envelope =
      Math.min(1, beatTime / 0.025) *
      Math.exp(-4.8 * beatTime) *
      Math.min(1, (0.6 - beatTime) / 0.035) *
      emphasis[beat % emphasis.length];
    const carrier = 2 * Math.PI * 220 * t;
    const value =
      0.16 *
      envelope *
      (Math.sin(carrier) + Math.sin(carrier + phase)) *
      Math.min(1, t / 0.15, (durationSeconds - t) / 0.5);
    wav.writeInt16LE(Math.round(32767 * value), 44 + 2 * i);
  }
  return wav;
}

function demoSequence(portrait: boolean, photo: Asset, sound: Asset): Sequence {
  const clips: Clip[] = [];
  for (const beat of score) {
    const start = Math.round(beat.start * fps),
      duration = Math.round((beat.end - beat.start) * fps);
    if (beat.photo)
      clips.push({
        ...newClip('image', start, photo.id),
        name: '唱针与唱片',
        duration,
        props: { fit: 'cover', focalX: portrait ? 72 : 50, focalY: 50, animation: 'rise', volume: 0 },
      });
    const clip = createPresetClip('phase-study', start, fps, {
      text: beat.name,
      subtitle: beat.copy,
      layout: beat.photo ? 'photo' : 'diagram',
      phaseFrom: beat.from,
      phaseTo: beat.to,
      sweep: beat.sweep,
      accent: beat.photo ? '#f4af78' : '#a94728',
    });
    clip.duration = duration;
    clip.name = beat.name;
    clip.props.carrierOffset = beat.start;
    clips.push(clip);
  }
  clips.push({
    ...newClip('audio', 0, sound.id),
    name: '双波叠加 · 220 Hz',
    duration: durationSeconds * fps,
    props: { volume: 0.92 },
  });
  return {
    id: uid('seq'),
    name: portrait ? '竖版 · 相位之间' : '横版 · 相位之间',
    width: portrait ? 1080 : 1920,
    height: portrait ? 1920 : 1080,
    fps,
    clips,
    background: '#141b18',
  };
}

export async function createDemo(library: Library, resources: string) {
  const image = await readFile(join(resources, 'public', 'studio', 'phase-turntable.jpg'));
  const photoSize = nativeImage.createFromBuffer(image).getSize();
  if (!photoSize.width || !photoSize.height) throw new Error('示例摄影无法读取');
  const audio = synthesizeScore();
  const store = await library.create('相位之间');
  const project = await store.project(),
    createdAt = project.createdAt;
  const photoPath = join(store.path, 'assets', 'phase-turntable.jpg'),
    soundPath = join(store.path, 'assets', 'phase-study.wav');
  await Promise.all([writeFile(photoPath, image), writeFile(soundPath, audio)]);
  const photo: Asset = {
    id: uid('asset'),
    name: '唱针与唱片 · 原创生成摄影.jpg',
    kind: 'image',
    path: photoPath,
    thumbnail: photoPath,
    width: photoSize.width,
    height: photoSize.height,
    duration: durationSeconds,
    createdAt,
    source: {
      provider: 'OpenAI ImageGen',
      author: 'CoCraft 示例制作',
      license: '授权用于 CoCraft 工程及其成片',
    },
  };
  const waveform = Array.from({ length: 256 }, (_, b) => {
    let peak = 0;
    const begin = Math.floor((((audio.length - 44) / 2) * b) / 256),
      end = Math.floor((((audio.length - 44) / 2) * (b + 1)) / 256);
    for (let i = begin; i < end; i++) peak = Math.max(peak, Math.abs(audio.readInt16LE(44 + 2 * i)));
    return peak / 32767;
  });
  const max = Math.max(0.01, ...waveform);
  const sound: Asset = {
    id: uid('asset'),
    name: '相位实验 · 双波脉冲.wav',
    kind: 'audio',
    path: soundPath,
    duration: durationSeconds,
    createdAt,
    waveform: waveform.map((v) => Math.round(Math.sqrt(v / max) * 1000) / 1000),
    source: { provider: 'CoCraft Originals', author: 'CoCraft', license: 'CC0-1.0' },
  };
  project.assets = [photo, sound];
  project.sequences = [demoSequence(false, photo, sound), demoSequence(true, photo, sound)];
  project.brief =
    '《相位之间》是一支 20 秒的声音设计短片。\n\n唱片引出问题，示波图依次展示同相叠加、错开半周和恢复对齐。原始音轨是两道同频、等幅的 220 Hz 正弦波，带有相同的脉冲包络。在 180° 处合成信号归零。图中水平轴以慢速展示波形。\n\n两条成片分别为横版和竖版。四个叙事片段可独立修改标题、说明、相位区间与变化时长。音轨保存首次合成的实验，可以作为独立声音素材裁切和替换。封面摄影来自本片定制生成，声音和波形设计为 CoCraft 原创。';
  await store.init(project);
  await library.remember(store);
  return store;
}
