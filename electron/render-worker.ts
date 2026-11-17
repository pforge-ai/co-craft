import { renderMedia, renderStill, selectComposition, makeCancelSignal } from '@remotion/renderer';
import { existsSync } from 'node:fs';
import { link, unlink } from 'node:fs/promises';
const port = (process as any).parentPort;
const send = (data: unknown) => port.postMessage(data);
const { cancel, cancelSignal } = makeCancelSignal();
port.on('message', async ({ data }: any) => {
  if (data.type === 'cancel') {
    cancel();
    return;
  }
  if (data.type !== 'render') return;
  try {
    const browserExecutable = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ].find(existsSync);
    let serveUrl = data.serveUrl;
    if (data.entryPoint) throw new Error('合成引擎尚未构建，请先运行 npm run build');
    const inputProps = data.props;
    const binariesDirectory = data.binariesDirectory;
    const temporary = data.output + '.rendering' + (data.still ? '.png' : '.mp4');
    send({ type: 'progress', progress: 0.03, stage: '读取固定版本' });
    const composition = await selectComposition({
      serveUrl,
      id: 'CoCraft',
      inputProps,
      browserExecutable,
      binariesDirectory,
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
    await link(temporary, data.output);
    await unlink(temporary);
    send({ type: 'done', output: data.output });
  } catch (e) {
    send({ type: 'error', error: e instanceof Error ? e.message : String(e) });
  }
});
