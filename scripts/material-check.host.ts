import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { chromium } from 'playwright';
import { openBrowser, selectComposition, renderStill, renderMedia } from '@remotion/renderer';
import { createDemo } from '../electron/demo';
import { importMaterialPack } from '../electron/packs';
import { Library } from '../electron/store';
import { MediaServer } from '../electron/server';
import { run, binary } from '../electron/media';
import { studioCatalog } from '../electron/studio-media';
import { applyOperations, durationOf, newClip } from '../src/core/project';
import { presetCatalog } from '../src/core/presets';

const [root, out, ...options] = process.argv.slice(
  process.argv.findIndex((arg) => arg.endsWith('/host.mjs')) + 1,
);
const screen = join(out, 'gallery'),
  browserExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
app.setPath('userData', join(out, 'electron'));
app.dock?.hide();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const store = await createDemo(new Library(join(out, 'library')), join(root, 'resources'));
    const project = await store.project(),
      before = JSON.stringify(project);
    assert.equal(project.sequences.length, 2);
    assert.ok(project.sequences.every((s) => durationOf(s) === 600 && s.clips.length === 7));
    const source = join(out, 'source-pack');
    await cp(join(root, 'resources/packs/studio-signature'), source, { recursive: true });
    const first = await importMaterialPack(source, store.path, project);
    const candidate = applyOperations(project, first.operations);
    const comp = first.components[0],
      asset = first.assets[0];
    const seq = candidate.sequences[0];
    const clip = { ...newClip('code'), componentId: comp.id, props: comp.props, locked: true };
    seq.clips = [clip];
    assert.equal(comp.props.markAssetId, asset.id);
    const restored = await importMaterialPack(source, store.path, candidate);
    assert.equal(restored.operations.length, 0);
    assert.equal(restored.components[0].id, comp.id);
    const helper = join(source, 'lib/typeset.ts');
    const originalHelper = await readFile(helper, 'utf8');
    await writeFile(helper, originalHelper + '\nexport const edition = 2;\n');
    const changedHelper = await importMaterialPack(source, store.path, candidate);
    assert.notEqual(comp.id, changedHelper.components[0].id);
    assert.notEqual(comp.hash, changedHelper.components[0].hash);
    assert.equal(await readFile(join(comp.pack.sourceDirectory, 'lib/typeset.ts'), 'utf8'), originalHelper);
    await writeFile(helper, originalHelper);
    const mark = join(source, 'mark.svg'),
      originalImage = await readFile(mark, 'utf8');
    await writeFile(mark, originalImage.replace('#e2d9ff', '#86cabe'));
    const changedMedia = await importMaterialPack(source, store.path, candidate);
    assert.notEqual(comp.hash, changedMedia.components[0].hash);
    assert.notEqual(comp.id, changedMedia.components[0].id);
    assert.notEqual(asset.id, changedMedia.assets[0].id);
    assert.equal(await readFile(asset.path, 'utf8'), originalImage);
    applyOperations(candidate, changedMedia.operations);
    const entry = join(source, 'Signature.tsx');
    await writeFile(entry, 'export default function Broken( {');
    await assert.rejects(() => importMaterialPack(source, store.path, candidate));
    assert.equal(JSON.stringify(await store.project()), before);
    assert.ok((await readdir(join(store.path, 'components/packs'))).every((p) => !p.startsWith('.import-')));
    const onlyMedia = join(out, 'media-only');
    await mkdir(onlyMedia);
    await cp(mark, join(onlyMedia, 'mark.svg'));
    await writeFile(
      join(onlyMedia, 'cocraft-pack.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'just-media',
        name: '媒体包',
        version: '1.0',
        author: 'CoCraft',
        license: 'CC0-1.0',
        assets: [{ id: 'mark', path: 'mark.svg' }],
      }),
    );
    assert.deepEqual(
      (await importMaterialPack(onlyMedia, store.path)).operations.map((o) => o.type),
      ['addAsset'],
    );
    const server = new MediaServer(screen, join(out, 'render'));
    server.register([...project.assets, ...first.assets]);
    const origin = await server.start(),
      serveUrl = origin + '/render/index.html';
    const chrome = await chromium.launch({ executablePath: browserExecutable, headless: true });
    const page = await chrome.newPage({ viewport: { width: 1220, height: 1250 }, deviceScaleFactor: 1 });
    await page.goto(origin + '/ui/check.html');
    await page.waitForFunction(() => Boolean((window as any).inspectMaterials));
    const layout = await page.evaluate(() => (window as any).inspectMaterials());
    for (const portrait of [false, true])
      for (const stress of [false, true]) {
        await page.evaluate(([p, s]) => (window as any).board(p, s), [portrait, stress]);
        await page
          .locator('#board')
          .screenshot({
            path: join(
              screen,
              `presets-${portrait ? 'portrait' : 'wide'}-${stress ? 'long' : 'default'}.png`,
            ),
          });
      }
    await page.evaluate(() => (window as any).mountEditing());
    const title = page.getByRole('textbox', { name: '主文案' });
    await title.fill('修改中文');
    await title.press('End');
    await title.press('1');
    await title.press('2');
    assert.deepEqual(await page.evaluate(() => (window as any).getCommits()), []);
    await title.press('Tab');
    assert.deepEqual(await page.evaluate(() => (window as any).getCommits()), [
      { key: 'text', value: '修改中文12' },
    ]);
    const isolated = new MediaServer(join(out, 'player'), join(out, 'render'));
    const stock = await studioCatalog(join(root, 'resources'));
    isolated.register([...stock, ...first.assets]);
    const previewOrigin = await isolated.start();
    await page.evaluate(
      ({ comp, assets, origin, stock }) => (window as any).mountLibrary(comp, assets, origin, stock),
      { comp, assets: first.assets, origin: previewOrigin, stock },
    );
    await page.getByRole('button', { name: /摄影与声音/ }).click();
    const audioStock = stock.find((a) => a.kind === 'audio')!;
    await page
      .getByRole('button', { name: new RegExp(audioStock.name) })
      .first()
      .click();
    await page.waitForFunction(() =>
      Boolean(document.querySelector('audio') && document.querySelector('audio')!.readyState >= 1),
    );
    await page.getByRole('button', { name: '添加到时间线' }).click();
    assert.equal((await page.evaluate(() => (window as any).getAdditions()))[0].id, audioStock.id);
    await page.getByRole('button', { name: /项目组件/ }).click();
    await page.getByRole('textbox', { name: '主文案' }).fill('验证随附署名');
    await page
      .frameLocator('iframe[title="项目组件独立预览"]')
      .getByText('验证随附署名', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: '添加到时间线' }).click();
    assert.equal((await page.evaluate(() => (window as any).getAdditions()))[1].props.text, '验证随附署名');
    const isolatedWindow = new BrowserWindow({
      show: false,
      width: 1100,
      height: 780,
      webPreferences: {
        preload: join(out, 'preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    await isolatedWindow.loadURL(origin + '/ui/check.html');
    await isolatedWindow.webContents.executeJavaScript(
      'window.mountLibrary(' +
        [comp, first.assets, previewOrigin, stock].map((x) => JSON.stringify(x)).join(',') +
        ');document.querySelectorAll("nav button").forEach(b=>{if(b.textContent.includes("项目组件")) b.click()})',
    );
    assert.equal(await isolatedWindow.webContents.executeJavaScript('typeof window.cocraft'), 'object');
    let isolatedChild = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const child = isolatedWindow.webContents.mainFrame.frames.find((f) =>
        f.url.startsWith(previewOrigin + '/ui/preview.html'),
      );
      if (
        child &&
        (await child.executeJavaScript('document.body.innerText.includes("Made with intention.")'))
      ) {
        assert.equal(await child.executeJavaScript('typeof window.cocraft'), 'undefined');
        isolatedChild = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    isolatedWindow.destroy();
    assert.ok(isolatedChild, '项目组件应在无 preload 的独立 frame 呈现');
    const issues = layout.filter((i: any) => i.issues.length);
    const report: any = {
      out,
      presets: presetCatalog.length,
      layoutCases: layout.length,
      issues,
      library: {
        singleBlurCommit: true,
        stockAudioMetadata: true,
        customizedPackPreview: true,
        isolatedElectronFrame: isolatedChild,
      },
      pack: {
        hash: comp.pack.fingerprint,
        dependencyRevision: changedHelper.components[0].pack.fingerprint,
        mediaRevision: changedMedia.components[0].pack.fingerprint,
        unchangedImportOperations: restored.operations.length,
      },
      sequences: [],
      movies: [],
    };
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('排版检查', layout.length, '个组合，需检查', issues);
    const engine = await openBrowser('chrome', { browserExecutable });
    try {
      const props = (p: typeof project, id: string) => ({ project: p, sequenceId: id, mediaOrigin: origin });
      const sample = props(candidate, seq.id),
        packComposition = await selectComposition({
          serveUrl,
          id: 'CoCraft',
          inputProps: sample,
          puppeteerInstance: engine,
        });
      await renderStill({
        serveUrl,
        composition: packComposition,
        inputProps: sample,
        frame: 40,
        scale: 0.5,
        output: join(screen, 'imported-signature.png'),
        puppeteerInstance: engine,
      });
      if (!options.includes('--gallery-only'))
        for (const s of project.sequences) {
          const inputProps = props(project, s.id);
          const composition = await selectComposition({
            serveUrl,
            id: 'CoCraft',
            inputProps,
            puppeteerInstance: engine,
          });
          const aspect = s.width > s.height ? 'wide' : 'portrait',
            frames = [0, 60, 190, 360, 417, 547];
          for (const frame of frames)
            await renderStill({
              serveUrl,
              composition,
              inputProps,
              frame,
              scale: 0.5,
              output: join(screen, `phase-${aspect}-${frame}.png`),
              puppeteerInstance: engine,
            });
          await page.setContent('<body style="margin:0;background:#263030">');
          await page.evaluate(
            ({ frames, aspect, origin }) => {
              const main = document.createElement('main');
              main.style.cssText =
                'background:#263030;padding:12px;display:grid;gap:9px;width:max-content;grid-template-columns:repeat(3, 1fr)';
              for (const f of frames) {
                const div = document.createElement('div'),
                  img = document.createElement('img'),
                  tag = document.createElement('p');
                img.style.cssText = 'display:block;width:' + (aspect === 'wide' ? '370' : '190') + 'px';
                img.src = origin + '/ui/phase-' + aspect + '-' + f + '.png';
                tag.textContent = (f / 30).toFixed(2) + ' s';
                tag.style.cssText = 'font:12px monospace;color:#eae3d5;margin:5px 0';
                div.append(img, tag);
                main.append(div);
              }
              document.body.append(main);
            },
            { frames, aspect, origin },
          );
          await page
            .locator('img')
            .evaluateAll(async (list) =>
              Promise.all((list as HTMLImageElement[]).map((img) => img.decode())),
            );
          await page.locator('main').screenshot({ path: join(screen, 'story-' + aspect + '.png') });
          report.sequences.push({ aspect, frames, width: s.width, height: s.height, fps: s.fps });
          if (options.includes('--movies')) {
            const file = join(out, 'phase-' + aspect + '.mp4');
            let last = -1;
            await renderMedia({
              serveUrl,
              composition,
              inputProps,
              codec: 'h264',
              outputLocation: file,
              crf: 19,
              concurrency: 3,
              scale: 1,
              puppeteerInstance: engine,
              onProgress: ({ progress }) => {
                const bucket = Math.floor(progress * 4);
                if (bucket > last) {
                  last = bucket;
                  console.log(aspect, bucket * 25 + '%');
                }
              },
            });
            const probe = JSON.parse(
              await run(binary('ffprobe'), [
                '-v',
                'error',
                '-show_format',
                '-show_streams',
                '-of',
                'json',
                file,
              ]),
            );
            const video = probe.streams.find((x: any) => x.codec_type === 'video'),
              audio = probe.streams.find((x: any) => x.codec_type === 'audio');
            assert.equal(video.width, s.width);
            assert.equal(video.height, s.height);
            assert.equal(video.nb_frames, '600');
            assert.equal(audio.codec_name, 'aac');
            const pcm = join(out, aspect + '-decoded.wav');
            await run(binary('ffmpeg'), [
              '-v',
              'error',
              '-i',
              file,
              '-vn',
              '-ac',
              '1',
              '-ar',
              '11025',
              '-c:a',
              'pcm_s16le',
              pcm,
            ]);
            const wav = await readFile(pcm);
            let offset = 12;
            while (offset + 8 <= wav.length && wav.toString('ascii', offset, offset + 4) !== 'data') {
              const length = wav.readUInt32LE(offset + 4);
              offset += 8 + length + (length % 2);
            }
            assert.ok(offset + 8 < wav.length);
            const samples = wav.subarray(offset + 8);
            const rms = (from: number, to: number) => {
              let sum = 0;
              for (let i = Math.floor(from * 11025); i < Math.floor(to * 11025); i++)
                sum += (samples.readInt16LE(i * 2) / 32768) ** 2;
              return Math.sqrt(sum / Math.floor((to - from) * 11025));
            };
            const levels = [rms(2.1, 3), rms(14, 14.8), rms(18.5, 19.1)];
            assert.ok(levels[0] > 0.015 && levels[1] < 0.0005 && levels[2] > 0.015);
            report.movies.push({
              file,
              width: video.width,
              height: video.height,
              fps: video.avg_frame_rate,
              frames: video.nb_frames,
              audio: audio.codec_name,
              seconds: probe.format.duration,
              rms: levels,
            });
          }
        }
    } finally {
      await engine.close({ silent: true });
      await chrome.close();
    }
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('结果', join(out, 'report.json'));
    app.exit(issues.length ? 1 : 0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
