import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const baseline = process.argv.includes('--baseline');
const data = await mkdtemp(join(tmpdir(), 'cocraft-v2-check-'));
const executablePath = process.env.COCRAFT_FUNCTIONAL_EXECUTABLE;
const launch = () =>
  electron.launch({
    executablePath,
    args: [...(executablePath ? [] : ['.']), '--use-mock-keychain'],
    env: { ...process.env, COCRAFT_DATA_DIR: data },
  });
let app = await launch();
console.log('Artifacts:', data);

try {
  let page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  await page.locator('.preview-canvas iframe').waitFor();
  const checkCatalog = async () => {
    const fixtureKey = 'cocraft-fixture-secret-not-a-real-key';
    const modelId = 'fixture-legacy-model';
    const ciphertext = await app.evaluate(({ safeStorage }, secret) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Fixture could not be encrypted');
      return safeStorage.encryptString(secret).toString('base64');
    }, fixtureKey);
    const settingsFile = join(data, 'settings.json');
    await app.close();
    await writeFile(
      settingsFile,
      JSON.stringify({
        provider: 'custom',
        model: modelId,
        baseUrl: 'http://127.0.0.1:1/v1',
        apiKeyEncrypted: ciphertext,
      }),
    );
    app = await launch();
    page = await app.firstWindow();
    await page.locator('.preview-canvas iframe').waitFor();
    const read = () => page.evaluate(() => window.cocraft.call('settings.get'));
    const migrated = await read();
    assert.equal(migrated.models.find((model) => model.id === migrated.defaults.agent).modelId, modelId);
    assert.equal(migrated.providers.find((provider) => provider.id === 'legacy').hasApiKey, true);
    const providers = [
      ...migrated.providers,
      {
        id: 'fixture-connection',
        name: '本地验收连接',
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:1/v1',
        requiresKey: true,
        apiKey: fixtureKey,
      },
    ];
    const models = [
      ...migrated.models,
      {
        id: 'fixture-model',
        providerId: 'fixture-connection',
        name: '本地验收模型',
        modelId: 'fixture-model-id',
        adapter: 'chat',
        capabilities: ['agent'],
        parameters: {},
      },
    ];
    const defaults = { ...migrated.defaults, agent: 'fixture-model' };
    await page.evaluate((input) => window.cocraft.call('settings.save', input), {
      providers,
      models,
      defaults,
    });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('.preview-canvas iframe').waitFor();
    const reopened = await read();
    assert.equal(reopened.defaults.agent, 'fixture-model');
    assert.equal(reopened.providers.find((provider) => provider.id === 'fixture-connection').hasApiKey, true);
    assert(!JSON.stringify(reopened).includes(fixtureKey));
    assert(!JSON.stringify(reopened).includes(ciphertext));
    assert(!(await readFile(settingsFile, 'utf8')).includes(fixtureKey));
    console.log('PASS catalog save, relaunch and encrypted migration');
  };
  const checkConversation = async () => {
    const received = [];
    const server = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      received.push(body.model);
      const id = 'cocraft-markdown-fixture';
      const chunk = (delta, finish_reason = null) => ({
        id,
        object: 'chat.completion.chunk',
        created: 1,
        model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      });
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        'data: ' +
          JSON.stringify(
            chunk({
              role: 'assistant',
              content: '## 验收小节\n\n- **已格式化**\n\n```js\nlet preview = 1;\n```',
            }),
          ) +
          '\n\n',
      );
      response.end('data: ' + JSON.stringify(chunk({}, 'stop')) + '\n\ndata: [DONE]\n\n');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
      await page.evaluate(async (baseUrl) => {
        const settings = await window.cocraft.call('settings.get');
        await window.cocraft.call('settings.save', {
          providers: [
            ...settings.providers,
            {
              id: 'fixture-connection',
              name: '本地验收连接',
              protocol: 'openai',
              baseUrl,
              requiresKey: true,
              apiKey: 'fixture-only',
            },
          ],
          models: [
            ...settings.models,
            ...['default', 'project', 'override'].map((id) => ({
              id,
              providerId: 'fixture-connection',
              name: `fixture-${id}`,
              modelId: `fixture-${id}`,
              adapter: 'chat',
              capabilities: ['agent'],
              parameters: {},
            })),
          ],
          defaults: { ...settings.defaults, agent: 'default' },
        });
      }, baseUrl);
      await page.reload();
      await page.locator('.preview-canvas iframe').waitFor();
      await page.locator('.new-task').click();
      const composer = page.getByLabel('给 Agent 的指令');
      await composer.fill('验收 Markdown 渲染');
      await composer.press('Enter');
      await page.locator('.markdown-body').getByRole('heading', { name: '验收小节' }).waitFor();
      await page.locator('.markdown-body li strong').getByText('已格式化').waitFor();
      await page.locator('.markdown-body pre code').getByText('let preview = 1;').waitFor();
      assert.equal(received[0], 'fixture-default');
      await page.getByRole('button', { name: /^设置/ }).first().click();
      const modal = page.getByRole('dialog');
      await modal.getByRole('button', { name: '用途默认值' }).click();
      await modal.getByRole('button', { name: '当前项目', exact: true }).click();
      await modal.getByLabel('项目剪辑与编排模型').selectOption('project');
      await modal.getByRole('button', { name: '保存设置', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });
      for (const [selection, model] of [
        ['', 'fixture-project'],
        ['override', 'fixture-override'],
      ]) {
        const expectedCount = received.length + 1;
        await page.locator('.new-task').click();
        await page.getByLabel('会话模型').selectOption(selection);
        await composer.fill(`验收模型 ${model}`);
        await composer.press('Enter');
        await page.locator('.markdown-body').getByRole('heading', { name: '验收小节' }).waitFor();
        assert.equal(received.length, expectedCount);
        assert.equal(received.at(-1), model);
      }
      await page.screenshot({ path: join(data, 'markdown-conversation.png'), scale: 'css' });
      console.log(
        'PASS no-title composer → local model via real Pi SDK → rendered heading, list, bold and code',
      );
    } finally {
      server.closeAllConnections();
      server.close();
    }
  };
  const checkMaterials = async () => {
    const button = (name) => page.getByRole('button', { name, exact: true });
    const clipCount = () => page.locator('.timeline-clip').count();
    const before = await clipCount();
    const openLibrary = () => page.getByRole('button', { name: '动态素材库', exact: true }).click();
    await page.locator('.nav-switch').getByRole('button', { name: /^素材/ }).click();
    await openLibrary();
    const categories = await page.locator('.resource-nav > button > span:not([class])').allTextContents();
    assert.deepEqual(categories, [
      '全部',
      '标题包装',
      '字幕',
      '信息图形',
      '动态背景',
      '摄影与声音',
      '收藏',
      '项目组件',
    ]);
    await page
      .locator('.resource-nav')
      .getByRole('button', { name: /^摄影与声音/ })
      .click();
    assert((await page.locator('.resource-card').count()) > 0);
    await page.screenshot({ path: join(data, 'photo-and-sound.png'), scale: 'css' });
    await page.locator('.resource-nav').getByRole('button', { name: /^全部/ }).click();
    await button('收藏素材').click();
    await page.getByRole('button', { name: /^收藏\s*1$/ }).click();
    assert.equal(await page.locator('.resource-card').count(), 1);
    await page.getByLabel('素材预览画幅').selectOption('9:16');
    await page.locator('.resource-detail').getByLabel('主文案', { exact: true }).fill('验收素材');
    await page.locator('.resource-preview-box').getByText('验收素材').waitFor();
    await page.screenshot({ path: join(data, 'material-library.png'), scale: 'css' });
    await button('添加到时间线').click();
    const timelineCount = (n) =>
      page.waitForFunction((value) => document.querySelectorAll('.timeline-clip').length === value, n);
    const library = page.locator('.resource-library');
    if (!(await library.isVisible())) await openLibrary();
    const pack = resolve('resources/packs/studio-signature');
    await app.evaluate(({ dialog }, packPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [packPath] });
    }, pack);
    await button('导入素材包').click();
    const component = page.locator('.component-library-item').filter({ hasText: 'Signature · 品牌署名' });
    await component.waitFor({ timeout: 30000 });
    await component.click();
    await page.locator('.resource-detail').getByLabel('主文案', { exact: true }).fill('导入包验收');
    await page
      .frameLocator('iframe[title="项目组件独立预览"]')
      .getByText('导入包验收', { exact: true })
      .waitFor();
    await page.screenshot({ path: join(data, 'source-package.png'), scale: 'css' });
    await button('添加到时间线').click();
    if (await library.isVisible()) await page.keyboard.press('Escape');
    await timelineCount(before + 2);
    const readProject = () => page.evaluate(async () => (await window.cocraft.call('boot')).current.project);
    const clips = (await readProject()).sequences[0].clips;
    const preset = clips.find((clip) => clip.props.text === '验收素材');
    assert(preset, 'Preset text persists in the timeline');
    const packed = clips.find(
      (clip) => clip.name.includes('品牌署名') && clip.componentId && clip.props.text === '导入包验收',
    );
    assert(packed, 'Source package parameters persist in the timeline');
    await page.getByRole('button', { name: `片段 ${packed.name}`, exact: true }).click();
    await button('锁定片段 L').click();
    await page.waitForFunction(async (id) => {
      const { current } = await window.cocraft.call('boot');
      return current.project.sequences[0].clips.find((clip) => clip.id === id)?.locked;
    }, packed.id);
    if (process.argv.includes('--render')) {
      await button('导出').click();
      await page.getByLabel('输出尺寸').selectOption('0.5');
      await button('导出成片').click();
      let job;
      const deadline = Date.now() + 120000;
      while (!job && Date.now() < deadline) {
        job = await page.evaluate(async () => {
          const { jobs } = await window.cocraft.call('boot');
          return jobs.find(
            (job) => ['failed', 'completed'].includes(job.status) && job.output?.endsWith('.mp4'),
          );
        });
        if (!job) await delay(500);
      }
      assert(job, 'MP4 finishes within two minutes');
      assert.equal(job.status, 'completed', job.error || job.stage);
      assert.equal(job.revision, (await readProject()).revision);
      execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', job.output, '-f', 'null', '-']);
      console.log('PASS real MP4 export and decode', job.output);
    }
    console.log(
      'PASS material favorite, preview parameters, source package import, two timeline additions and clip lock',
    );
  };
  if (process.argv.includes('--catalog-only')) await checkCatalog();
  else if (process.argv.includes('--conversation-only')) await checkConversation();
  else if (process.argv.includes('--materials-only')) await checkMaterials();
  else {
    if (!baseline) {
      await page
        .frameLocator('.preview-canvas iframe')
        .getByText('相位之间', { exact: true })
        .first()
        .waitFor();
      await page.screenshot({ path: join(data, 'workbench.png'), scale: 'css' });
    }
    const settings = page.getByRole('button', { name: /^设置/ }).first();
    await settings.click();
    const modal = page.getByRole('dialog');
    const boxes = [];
    const tabs = baseline
      ? ['模型连接', '素材服务', '工作台', 'Skills 与执行']
      : ['常规', '外观', '提供商', '模型', '用途默认值', '素材服务', 'Skills 与工具'];
    for (const tab of tabs) {
      const control = modal.getByRole('button', { name: tab, exact: true });
      await control.click();
      await modal.evaluate(async (element) => {
        await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
      });
      const { x, y, width, height } = await modal.boundingBox();
      boxes.push({ tab, x, y, width, height });
    }
    console.log('Settings rectangles:', boxes);
    await page.screenshot({ path: join(data, 'settings.png'), scale: 'css' });
    if (!baseline) {
      const close = modal.getByRole('button', { name: '关闭', exact: true });
      await close.focus();
      await page.keyboard.press('Shift+Tab');
      assert(await modal.evaluate((dialog) => dialog.contains(document.activeElement)));
      assert(!(await close.evaluate((button) => button === document.activeElement)));
      await page.keyboard.press('Tab');
      assert(await close.evaluate((button) => button === document.activeElement));
    }
    await page.keyboard.press('Escape');
    if (!baseline) await modal.waitFor({ state: 'hidden' });
    if (await modal.isVisible()) await modal.getByRole('button', { name: '关闭', exact: true }).click();

    const nextPaint = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    const drag = async (handle, measured, axis, fromLeft = false) => {
      const box = await handle.boundingBox();
      const iframe = await page.locator('.preview-canvas iframe').boundingBox();
      const before = (await measured.boundingBox())[axis];
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(axis === 'width' ? x + (fromLeft ? 25 : -25) : x, axis === 'height' ? y - 25 : y);
      const start = await measured.boundingBox();
      const drop = {
        x: fromLeft ? iframe.x + 120 : iframe.x + iframe.width - 160,
        y: iframe.y + iframe.height - 90,
      };
      await page.mouse.move(drop.x, drop.y, { steps: 6 });
      await page.mouse.up();
      await nextPaint();
      const released = await measured.boundingBox();
      await page.mouse.move(x - 75, y + 30, { steps: 4 });
      await nextPaint();
      const moved = await measured.boundingBox();
      return { before, beforeDrop: start[axis], released: released[axis], moved: moved[axis] };
    };
    const right = await drag(page.locator('.vertical-resizer').last(), page.locator('.right-panel'), 'width');
    const timeline = await drag(page.locator('.horizontal-resizer'), page.locator('.editor-panel'), 'height');
    const left = baseline
      ? null
      : await drag(page.locator('.nav-resizer'), page.locator('.sidebar'), 'width', true);
    console.log('Cross iframe:', { right, timeline, left });
    console.log(
      'Left dividers:',
      await page.locator('.sidebar [class*="resizer"], .sidebar-resizer').count(),
    );
    await page.locator('.new-task').click();
    console.log('New conversation:', {
      dialog: await modal.isVisible(),
      titleField: await page.getByLabel('任务名称', { exact: true }).isVisible(),
    });
    await page.screenshot({ path: join(data, 'new-conversation.png'), scale: 'css' });
    if (!baseline) {
      for (const [name, size] of Object.entries({ right, left, timeline })) {
        assert.notEqual(size.before, size.beforeDrop, `${name} divider actually moves`);
        assert.equal(size.released, size.moved, `${name} divider releases over the preview`);
      }
      for (const { tab, ...rect } of boxes) {
        const { tab: first, ...expected } = boxes[0];
        assert.deepEqual(rect, expected, `${tab} matches the ${first} settings panel`);
      }
      assert(!(await modal.isVisible()));
      assert(!(await page.getByLabel('任务名称', { exact: true }).isVisible()));
      await nextPaint();
      assert(await page.getByLabel('给 Agent 的指令').evaluate((input) => input === document.activeElement));

      for (const [selector, event] of [
        ['.nav-resizer', 'blur'],
        ['.vertical-resizer', 'pointercancel'],
      ]) {
        const handle = page.locator(selector);
        const panel = page.locator(selector === '.nav-resizer' ? '.sidebar' : '.right-panel');
        const { x, y, width, height } = await handle.boundingBox();
        const startX = x + width / 2;
        const startY = y + height / 2;
        await page.mouse.move(startX, startY);
        const original = (await panel.boundingBox()).width;
        await page.mouse.down();
        await page.mouse.move(startX - 20, startY);
        assert.notEqual((await panel.boundingBox()).width, original);
        await page.evaluate(
          (type) =>
            window.dispatchEvent(
              type === 'blur' ? new Event(type) : new PointerEvent(type, { pointerId: 1 }),
            ),
          event,
        );
        const stopped = (await panel.boundingBox()).width;
        await page.mouse.move(startX - 50, startY);
        await nextPaint();
        assert.equal((await panel.boundingBox()).width, stopped, event);
        await page.mouse.up();
      }

      const panels = [
        ['.sidebar', 'width'],
        ['.right-panel', 'width'],
        ['.editor-panel', 'height'],
      ];
      const sizes = () =>
        Promise.all(
          panels.map(async ([selector, axis]) => (await page.locator(selector).boundingBox())[axis]),
        );
      const beforeReload = await sizes();
      await page.reload();
      await page.locator('.preview-canvas iframe').waitFor();
      assert.deepEqual(await sizes(), beforeReload);
      console.log('PASS layout reload, Escape, composer focus and drag interruption');
      await settings.click();
      await modal.getByRole('button', { name: '外观', exact: true }).click();
      await modal.getByRole('button', { name: '浅色', exact: true }).click();
      await modal.getByRole('button', { name: '保存设置', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });
      await settings.click();
      await modal.getByRole('button', { name: '提供商', exact: true }).click();
      await page.screenshot({ path: join(data, 'settings-light.png'), scale: 'css' });
    }
  }
} finally {
  await app.close();
}
