import { renderMedia, renderStill, selectComposition, makeCancelSignal } from '@remotion/renderer';
import { existsSync, readdirSync } from 'node:fs';
import { link, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

function findHeadlessBrowser(): string | undefined {
  // Prefer headless shell (zero macOS Dock bounce!) before falling back to full desktop Chrome.
  const shellRoots = [
    join(process.cwd(), 'node_modules', '.remotion', 'chrome-headless-shell'),
    join(homedir(), 'Library', 'Caches', 'remotion', 'chrome-headless-shell'),
  ];
  for (const root of shellRoots) {
    if (!existsSync(root)) continue;
    try {
      for (const dir of readdirSync(root)) {
        const candidate = join(root, dir, 'chrome-headless-shell');
        if (existsSync(candidate)) return candidate;
      }
    } catch {}
  }
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find(existsSync);
}

const port = (process as any).parentPort;
const send = (data: unknown) => port.postMessage(data);
const { cancel, cancelSignal } = makeCancelSignal();

let devBundleCache: Promise<string> | undefined;

port.on('message', async ({ data }: any) => {
  if (data.type === 'cancel') {
    cancel();
    return;
  }
  if (data.type !== 'render') return;
  const temporary = data.output + '.rendering' + (data.still ? '.png' : '.mp4');
  try {
    const browserExecutable = findHeadlessBrowser();
    let serveUrl: string | undefined = data.serveUrl;
    if (!serveUrl && data.entryPoint) {
      send({ type: 'progress', progress: 0.02, stage: '准备开发合成包' });
      if (!devBundleCache) {
        const { bundle } = await import('@remotion/bundler');
        devBundleCache = bundle({
          entryPoint: data.entryPoint,
          outDir: join(process.cwd(), 'dev-render-bundle'),
          publicDir: data.publicDir || null,
        });
      }
      serveUrl = await devBundleCache;
    }
    if (!serveUrl) throw new Error('合成引擎未就绪，请先运行 npm run build');
    const inputProps = data.props;
    const binariesDirectory = data.binariesDirectory;
    const chromiumOptions = process.platform === 'darwin' ? { gl: 'angle' as const } : undefined;
    send({ type: 'progress', progress: 0.03, stage: '读取固定版本' });
    const composition = await selectComposition({
      serveUrl,
      id: 'CoCraft',
      inputProps,
      browserExecutable,
      binariesDirectory,
      chromiumOptions,
    });
    if (data.still) {
      await renderStill({
        composition,
        serveUrl,
        inputProps,
        output: temporary,
        frame: data.frame || 0,
        browserExecutable,
        binariesDirectory,
        chromiumOptions,
        imageFormat: 'png',
        scale: data.scale || 0.5,
      });
    } else
      await renderMedia({
        composition,
        serveUrl,
        inputProps,
        codec: 'h264',
        outputLocation: temporary,
        browserExecutable,
        binariesDirectory,
        chromiumOptions,
        crf: data.crf || 20,
        pixelFormat: 'yuv420p',
        scale: data.scale || 1,
        concurrency: 2,
        cancelSignal,
        overwrite: false,
        onProgress: (p) =>
          send({
            type: 'progress',
            progress: Math.max(0.05, p.progress),
            stage: p.progress < 0.9 ? '渲染画面与声音' : '封装 MP4',
          }),
      });
    try {
      await link(temporary, data.output);
      await unlink(temporary);
    } catch (linkErr) {
      const code = (linkErr as NodeJS.ErrnoException).code;
      // External drives (exFAT/FAT32) reject hard links; fall back to atomic rename.
      if (code === 'ENOTSUP' || code === 'EPERM' || code === 'EXDEV') {
        await rename(temporary, data.output);
      } else {
        throw linkErr;
      }
    }
    send({ type: 'done', output: data.output });
  } catch (e) {
    await unlink(temporary).catch(() => {});
    const raw = e instanceof Error ? e.message : String(e);
    let summary = raw;
    if (/Content Security Policy|CSP|ERR_BLOCKED/i.test(raw)) {
      summary = `本机渲染安全策略拦截了画面或取帧请求：${raw.split('\n')[0]}`;
    } else if (/ENOSPC/i.test(raw)) {
      summary = `磁盘可用空间不足，无法写入导出文件`;
    } else if (/extract frame|compositor/i.test(raw)) {
      summary = `视频取帧或解码失败（并非必定磁盘空间问题）：${raw.split('\n')[0]}`;
    }
    send({ type: 'error', error: summary });
  }
});
