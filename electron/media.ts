import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, stat, readFile, rm } from 'node:fs/promises';
import { basename, extname, join, dirname } from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { nativeImage } from 'electron';
import { dir as compositorDir } from '@remotion/compositor-darwin-arm64';
import { uid } from '../src/core/project';
import type { Asset } from '../src/core/types';

export async function hashFile(file: string): Promise<{ sha256: string; byteSize: number }> {
  const info = await stat(file);
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return { sha256: hash.digest('hex'), byteSize: info.size };
}

const inFlightFrames = new Map<string, Promise<string>>();

/**
 * Extracts and caches a frame-accurate JPEG thumbnail for a video asset at `timeSec`.
 * Keyed by assetId + content fingerprint + millisecond timestamp so relinking invalidates stale frames automatically.
 */
export async function extractVideoFrame(
  file: string,
  projectPath: string,
  assetId: string,
  timeSec: number,
  durationSec = 0,
  cacheTag = '',
): Promise<string> {
  const safeSec = Math.max(0, durationSec > 0 ? Math.min(Math.max(0, durationSec - 0.04), timeSec) : timeSec);
  const ms = Math.round(safeSec * 1000);
  const safeId = assetId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const tag = cacheTag ? `-${cacheTag.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}` : '';
  const dir = join(projectPath, '.cocraft', 'thumbnails', 'frames');
  const out = join(dir, `${safeId}${tag}-${ms}.jpg`);
  if (existsSync(out)) return out;
  const inflightKey = out;
  const existing = inFlightFrames.get(inflightKey);
  if (existing) return existing;
  const task = (async () => {
    await mkdir(dir, { recursive: true });
    const tmp = `${out}.${process.pid}.${Date.now()}.tmp.jpg`;
    try {
      await run(binary('ffmpeg'), [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        safeSec.toFixed(3),
        '-i',
        file,
        '-frames:v',
        '1',
        '-vf',
        'scale=360:-2',
        '-q:v',
        '4',
        tmp,
      ]);
      const { rename } = await import('node:fs/promises');
      await rename(tmp, out);
      return out;
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => {});
      throw err;
    } finally {
      inFlightFrames.delete(inflightKey);
    }
  })();
  inFlightFrames.set(inflightKey, task);
  return task;
}

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

function parseFrameRate(raw?: string): number | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const [num, den] = raw.split('/').map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
    const fps = num / den;
    return fps > 0 && fps <= 240 ? Math.round(fps * 100) / 100 : undefined;
  }
  const direct = Number(raw);
  return Number.isFinite(direct) && direct > 0 && direct <= 240 ? direct : undefined;
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
  } finally {
    await rm(output, { force: true }).catch(() => {});
  }
}

export async function importMedia(
  file: string,
  projectPath: string,
  existingId?: string,
  options?: { thumbnailPath?: string },
): Promise<Asset> {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('请选择媒体文件');
  const { sha256, byteSize } = await hashFile(file);
  const ext = extname(file).toLowerCase();
  const kind: Asset['kind'] = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'].includes(ext)
    ? 'image'
    : ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)
      ? 'audio'
      : ['.glb', '.gltf'].includes(ext)
        ? 'model-3d'
        : 'video';
  const id = existingId || uid('asset');
  let duration = kind === 'model-3d' ? 6 : 5,
    width: number | undefined,
    height: number | undefined,
    fps: number | undefined,
    hasAudio = kind === 'audio',
    thumbnail: string | undefined;
  if (kind === 'image') {
    const size = nativeImage.createFromPath(file).getSize();
    width = size.width || undefined;
    height = size.height || undefined;
  } else if (kind === 'model-3d') {
    hasAudio = false;
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
    const a = meta.streams?.find((s: any) => s.codec_type === 'audio');
    if (kind === 'video' && !v) throw new Error('这个文件不包含可读取的视频');
    hasAudio = kind === 'audio' ? true : !!a;
    duration = Number(meta.format?.duration || v?.duration || a?.duration || 0);
    width = v?.width;
    height = v?.height;
    fps = parseFrameRate(v?.avg_frame_rate) || parseFrameRate(v?.r_frame_rate);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取媒体时长');
  }
  if (kind === 'video') {
    const dir = join(projectPath, '.cocraft', 'thumbnails');
    await mkdir(dir, { recursive: true });
    thumbnail = options?.thumbnailPath || join(dir, id + '.jpg');
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
  // Extract real audio waveform for both audio files AND videos containing an audio stream.
  const waveform = kind === 'audio' || (kind === 'video' && hasAudio) ? await waveformFor(file, projectPath, id) : undefined;
  return {
    id,
    name: basename(file),
    kind,
    category: kind === 'model-3d' ? 'rig' : 'media',
    subkind: kind === 'model-3d' ? 'model-3d' : 'media',
    path: file,
    duration,
    sha256,
    byteSize,
    hasAudio,
    fps,
    width,
    height,
    thumbnail,
    waveform,
    createdAt: new Date().toISOString(),
    source: { provider: 'local', license: '用户提供' },
  };
}
