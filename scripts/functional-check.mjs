import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const data = await mkdtemp(join(tmpdir(), 'cocraft-functional-check-'));
console.log('Artifacts:', data);
const errors = [];
const executablePath = process.env.COCRAFT_FUNCTIONAL_EXECUTABLE;
const launch = () =>
  electron.launch({
    executablePath,
    args: executablePath ? [] : ['.'],
    env: { ...process.env, COCRAFT_DATA_DIR: data },
  });
let app = await launch();
async function check() {
  const watch = async () => {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().replace(/(data:[^,]+,)[^'\s]+/g, '$1…'));
    });
    win.setDefaultTimeout(8000);
    return win;
  };
  let page = await watch();
  const button = (name) => page.getByRole('button', { name, exact: true });
  const call = (method, arg) => page.evaluate(([m, a]) => window.cocraft.call(m, a), [method, arg]);
  const cmd = async (name) => {
    await page.locator('.command-launch').click();
    await page.getByLabel('搜索命令').fill(name);
    await page.locator('.command-results button').first().click();
  };
  await button('播放').waitFor();
  const preview = () => page.frameLocator('iframe[title="成片预览"]');
  await preview().getByText('沿海公路', { exact: true }).waitFor();
  await page.screenshot({ path: join(data, 'workbench.png'), scale: 'css' });
  const time = page.locator('.playback-time b');
  const before = await time.textContent();
  await button('播放').click();
  await page.waitForFunction((t) => document.querySelector('.playback-time b').textContent !== t, before);
  await button('暂停').click();
  const paused = await time.textContent();
  await button('下一个镜头').click();
  await page.waitForFunction((t) => document.querySelector('.playback-time b').textContent !== t, paused);
  console.log('PASS play, pause and seek');
  if (process.argv.includes('--preview-only')) {
    assert.deepEqual(errors, []);
    return;
  }
  if (!['--package-check', '--media-only', '--code-only'].some((flag) => process.argv.includes(flag))) {
    const title = page.locator('.timeline-clip.title').first();
    await title.click();
    const text = page.getByLabel('文案', { exact: true });
    const old = await text.inputValue();
    const changed = '自动验收标题';
    await text.fill(changed);
    await text.blur();
    await title.dblclick();
    const persisted = async (value) =>
      page.waitForFunction(
        async (v) =>
          (await window.cocraft.call('boot')).current.project.sequences[0].clips.some(
            (c) => c.props.text === v,
          ),
        value,
      );
    await persisted(changed);
    await preview().getByText(changed, { exact: true }).waitFor();
    await button('锁定片段 L').click();
    await page.waitForFunction(() => document.querySelector('[aria-label="文案"]').disabled);
    assert(await button('分割片段 ⌘B').isDisabled());
    await button('撤销 ⌘Z').click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="文案"]').disabled);
    await button('撤销 ⌘Z').click();
    await persisted(old);
    await button('重做 ⇧⌘Z').click();
    await persisted(changed);
    console.log('PASS title edit, lock, undo and redo');
    const titlesBefore = await page.locator('.timeline-clip.title').count();
    await cmd('添加标题');
    await page.waitForFunction(
      (n) => document.querySelectorAll('.timeline-clip.title').length === n + 1,
      titlesBefore,
    );
    await page.locator('.playback-time').click();
    await page.keyboard.press('ArrowRight');
    const n = await page.locator('.timeline-clip').count();
    await button('分割片段 ⌘B').click();
    await page.waitForFunction((n) => document.querySelectorAll('.timeline-clip').length > n, n);
    console.log('PASS add and split');
    const srt = join(data, 'sample.srt');
    await writeFile(srt, '1\n00:00:00,200 --> 00:00:01,500\nFor smoke only\n');
    // Supply a real subtitle file at the native chooser seam.
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, srt);
    await cmd('导入 SRT 字幕');
    await persisted('For smoke only');
    await page
      .locator('.timeline-clip.caption')
      .filter({ hasText: /For smoke only/ })
      .last()
      .click();
    await text.fill('已修改的字幕');
    await text.blur();
    await persisted('已修改的字幕');
    console.log('PASS SRT import and edit');
    await page.locator('.tab-add').click();
    await page.getByLabel('成片名称').fill('验收竖版');
    await button('创建版本').click();
    await page.locator('.playback-meta').getByText('1080 × 1920').waitFor();
    await button('Agent').click();
    await page.getByText('连接模型，开启 Agent 创作').click();
    assert.equal(await page.getByLabel('模型 API Key').inputValue(), '');
    await button('关闭').click();
    console.log('PASS vertical version and missing model prompt');
  }
  const newProject = async (name) => {
    await button('新建项目').click();
    await page.getByLabel('项目名称').fill(name);
    await button('创建').click();
    await page.locator('.titlebar-project').getByText(name, { exact: true }).waitFor();
  };
  if (!process.argv.includes('--media-only')) {
    await newProject('验收代码');
    await cmd('新建可编程画面');
    await button('编译并应用').click();
    const codeClip = page.locator('.timeline-clip.code');
    const codeError = page.locator('.code-error');
    await codeClip.or(codeError).waitFor({ timeout: 30000 });
    if (await codeError.isVisible()) throw new Error(await codeError.innerText());
    await preview().getByText('每一个想法，都值得成为画面。', { exact: true }).waitFor();
    console.log('PASS code build and preview');

    const project = (await call('boot')).current;
    await app.close();
    app = await launch();
    page = await watch();
    await page.locator('.titlebar-project').getByText('验收代码').waitFor();
    await page.locator('.timeline-clip.code').waitFor();
    assert.equal((await call('boot')).current.project.revision, project.project.revision);
    await preview().getByText('每一个想法，都值得成为画面。', { exact: true }).waitFor();
    console.log('PASS relaunch preserves code project');
    if (process.argv.includes('--code-only')) {
      assert.deepEqual(errors, []);
      return;
    }
  }
  await newProject('验收导出');
  const video = join(data, 'smoke-video.mp4'),
    audio = join(data, 'smoke-audio.wav');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30',
    '-t',
    '3',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    video,
  ]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '2',
    audio,
  ]);
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
    },
    [video, audio],
  );
  await cmd('导入素材');
  await button('添加 smoke-video.mp4').click();
  const set = async (label, value) => {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    await field.blur();
  };
  await set('时长', '2');
  await set('原素材入点', '0.5');
  await button('添加 smoke-audio.wav').click();
  await page.waitForFunction(async () => {
    const clips = (await window.cocraft.call('boot')).current.project.sequences[0].clips;
    return (
      clips.some((c) => c.kind === 'video' && c.start === 0 && c.duration === 60 && c.sourceIn === 15) &&
      clips.some((c) => c.kind === 'audio' && c.start === 0 && c.duration === 60)
    );
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.timeline-clip.audio .waveform i')].some(bar => Number.parseFloat(bar.style.height) > 5),
  );
  const observedVideo = preview().locator('video');
  await observedVideo.waitFor();
  await button('播放').click();
  await observedVideo.evaluate(
    (v) =>
      new Promise((resolve, reject) => {
        if (v.readyState >= 2) return resolve();
        v.addEventListener('loadeddata', resolve, { once: true });
        setTimeout(() => reject(new Error('Preview video did not load')), 5000);
      }),
  );
  await button('暂停').click();
  await button('导出').click();
  await page.getByLabel('输出尺寸').selectOption('0.5');
  await button('导出成片').click();
  await button('打开成片').waitFor({ timeout: 120000 });
  const job = (await call('boot')).jobs.find((j) => j.status === 'completed' && j.output?.endsWith('.mp4'));
  assert(job, 'Export job has a completed MP4 path');
  const metadata = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name,width,height,r_frame_rate:format=duration',
        '-of',
        'json',
        job.output,
      ],
      { encoding: 'utf8' },
    ),
  );
  assert(Math.abs(Number(metadata.format.duration) - 2) <= 1 / 30, 'Duration within one video frame');
  const { codec_name, width, height, r_frame_rate } = metadata.streams[0];
  assert.deepEqual(
    { codec_name, width, height, r_frame_rate },
    { codec_name: 'h264', width: 960, height: 540, r_frame_rate: '30/1' },
  );
  assert.equal(metadata.streams[1].codec_name, 'aac');
  execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', job.output, '-f', 'null', '-']);

  assert.deepEqual(errors, []);
  console.log('PASS video and audio import, trim, playback and MP4 export', metadata);
}
try {
  await check();
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: join(data, 'failure.png'), scale: 'css' })
    .catch(() => {});
  throw error;
} finally {
  console.log('Renderer errors:', errors);
  await app.close();
}
