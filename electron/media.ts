import { spawn } from 'node:child_process';
import { mkdir, stat, readFile } from 'node:fs/promises';
import { basename, extname, join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { nativeImage } from 'electron';
import { dir as compositorDir } from '@remotion/compositor-darwin-arm64';
import { uid } from '../src/core/project';
import type { Asset } from '../src/core/types';
export const binary = (name: string) => {
  const paths = [
    join(process.resourcesPath || '', 'media-tools', name),
    join(compositorDir.replace('app.asar/', 'app.asar.unpacked/'), name),
    join(process.resourcesPath || '', 'resources', 'bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  return paths.find(existsSync) || name;
};
export function run(
  command: string,
  args: string[],
  opts: { cwd?: string; signal?: AbortSignal } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...opts,
      env: existsSync(join(dirname(command), 'libavutil.dylib'))
        ? { ...process.env, DYLD_LIBRARY_PATH: dirname(command) }
        : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      error = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => {
      error = (error + d).slice(-6000);
    });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(error || `${command} 退出 (${code})`)),
    );
  });
}
export async function waveformFor(
  file: string,
  projectPath: string,
  id: string,
): Promise<number[] | undefined> {
  const dir = join(projectPath, '.cocraft', 'analysis');
  await mkdir(dir, { recursive: true });
  const output = join(dir, id + '.wav');
  try {
    await run(binary('ffmpeg'), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      file,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '2000',
      '-c:a',
      'pcm_s16le',
      output,
    ]);
    const data = await readFile(output);
    let pos = 12,
      start = 0,
      end = data.length;
    while (pos + 8 < data.length) {
      const size = data.readUInt32LE(pos + 4);
      if (data.toString('ascii', pos, pos + 4) === 'data') {
        start = pos + 8;
        end = Math.min(start + size, data.length);
        break;
      }
      pos += 8 + size + (size % 2);
    }
    if (!start) return undefined;
    const count = Math.floor((end - start) / 2),
      bins = 256,
      peaks: number[] = [];
    for (let b = 0; b < bins; b++) {
      let peak = 0;
      for (let i = Math.floor((b * count) / bins); i < Math.floor(((b + 1) * count) / bins); i++)
        peak = Math.max(peak, Math.abs(data.readInt16LE(start + i * 2)) / 32768);
      peaks.push(peak);
    }
    const max = Math.max(...peaks, 0.01);
    return peaks.map((n) => Math.round(Math.sqrt(n / max) * 1000) / 1000);
  } catch {
    return undefined;
  }
}
export async function importMedia(file: string, projectPath: string): Promise<Asset> {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('请选择媒体文件');
  const ext = extname(file).toLowerCase();
  const kind = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'].includes(ext)
    ? 'image'
    : ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)
      ? 'audio'
      : 'video';
  const id = uid('asset');
  let duration = 5,
    width: number | undefined,
    height: number | undefined,
    thumbnail: string | undefined;
  if (kind === 'image') {
    const size = nativeImage.createFromPath(file).getSize();
    width = size.width || undefined;
    height = size.height || undefined;
  } else {
    const meta = JSON.parse(
      await run(binary('ffprobe'), [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        file,
      ]),
    );
    const v = meta.streams?.find((s: any) => s.codec_type === 'video');
    if (kind === 'video' && !v) throw new Error('这个文件不包含可读取的视频');
    duration = Number(meta.format?.duration || v?.duration || 0);
    width = v?.width;
    height = v?.height;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取媒体时长');
  }
  if (kind === 'video') {
    const dir = join(projectPath, '.cocraft', 'thumbnails');
    await mkdir(dir, { recursive: true });
    thumbnail = join(dir, id + '.jpg');
    await run(binary('ffmpeg'), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(Math.min(0.5, duration / 2)),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-2',
      thumbnail,
    ]);
  } else if (kind === 'image') thumbnail = file;
  const waveform = kind === 'audio' ? await waveformFor(file, projectPath, id) : undefined;
  return {
    id,
    name: basename(file),
    kind,
    path: file,
    duration,
    width,
    height,
    thumbnail,
    waveform,
    createdAt: new Date().toISOString(),
    source: { provider: 'local', license: '用户提供' },
  };
}
