import assert from 'node:assert/strict';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const data = await mkdtemp(join(tmpdir(), 'cocraft-p1-ui-'));
const verifyOut = resolve('docs/verification/v3');
const app = await electron.launch({
  args: ['.', '--use-mock-keychain'],
  env: { ...process.env, COCRAFT_DATA_DIR: data },
});

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.locator('.preview-canvas iframe').waitFor();
  const previewFrame = page.frameLocator('.preview-canvas iframe');
  await previewFrame.getByText('相位之间', { exact: true }).first().waitFor();

  // Capture fresh v0.3 dark workbench screenshot
  await page.screenshot({ path: join(verifyOut, 'v03-workbench-dark.png'), scale: 'css' });

  // 1. Verify Zero-Flash Player: editing clip props must NOT unmount/remount Player DOM inside preview iframe!
  const playerFrameObj = page.frames().find((f) => f.url().includes('/ui/preview.html'));
  assert(playerFrameObj, 'Preview iframe loaded');
  await playerFrameObj.evaluate(() => {
    window.__ccRootChild = document.querySelector('#root > div');
  });
  const firstClip = page.locator('.timeline-clip').first();
  await firstClip.click();
  const titleInput = page.locator('.inspector').getByLabel('主文案', { exact: true });
  await titleInput.fill('零闪验收');
  await titleInput.blur();
  await previewFrame.getByText('零闪验收', { exact: true }).first().waitFor();
  const preservedMount = await playerFrameObj.evaluate(
    () => window.__ccRootChild === document.querySelector('#root > div'),
  );
  assert.equal(preservedMount, true, 'Remotion Player stayed mounted across project revision update (Zero Flash)');
  console.log('PASS · Zero-flash Player hot update without remounting');

  // 2. Verify Stage Direct Manipulation Gizmo (drag clip on canvas updates x/y props)
  const gizmo = page.locator('.stage-gizmo');
  await gizmo.waitFor();
  const gBox = await gizmo.boundingBox();
  assert(gBox, 'Stage gizmo visible when paused with selected clip');
  await page.mouse.move(gBox.x + gBox.width / 2, gBox.y + gBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gBox.x + gBox.width / 2 + 40, gBox.y + gBox.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(async () => {
    const b = await window.cocraft.call('boot');
    return b.current.project.sequences[0].clips.some((c) => Number(c.props.x) !== 0);
  });
  console.log('PASS · StageOverlay direct canvas drag updates clip x/y');

  // 3. Verify T shortcut & Command Palette (⌘K) ArrowDown + Enter navigation
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  const libModal = page.getByRole('dialog', { name: '动态素材库' });
  await libModal.waitFor();
  await page.keyboard.press('Escape');
  await libModal.waitFor({ state: 'hidden' });

  await page.keyboard.press('Meta+k');
  const cmdDialog = page.getByRole('dialog', { name: '你想做什么？' });
  await cmdDialog.waitFor();
  await page.keyboard.press('ArrowDown');
  const secondOptionSelected = await cmdDialog
    .locator('.command-results > button')
    .nth(1)
    .getAttribute('aria-selected');
  assert.equal(secondOptionSelected, 'true', 'ArrowDown highlights second command item');
  await page.keyboard.press('Escape');
  await cmdDialog.waitFor({ state: 'hidden' });
  console.log('PASS · T shortcut and Command Palette keyboard navigation');

  // 4. Verify timeline high-precision zoom (> 400%) & track mute
  const zoomInBtn = page.getByRole('button', { name: '放大时间线', exact: true });
  for (let i = 0; i < 6; i++) await zoomInBtn.click();
  const zoomBadge = await page.locator('.zoom-reset-btn').textContent();
  assert(parseInt(zoomBadge || '0', 10) > 400, `Timeline zoom exceeded legacy 400% cap: ${zoomBadge}`);
  await page.locator('.zoom-reset-btn').click();
  console.log('PASS · Pixel-based timeline zoom beyond 400% and 1-click fit reset');

  // 5. Verify Settings -> Providers "0 个连接" single-line fix & silent component validation
  await page.getByRole('button', { name: /^设置/ }).first().click();
  const settingsModal = page.getByRole('dialog', { name: '设置' });
  await settingsModal.getByRole('button', { name: '外观', exact: true }).click();
  await settingsModal.getByRole('button', { name: '浅色', exact: true }).click();
  await settingsModal.getByRole('button', { name: '保存设置', exact: true }).click();
  await settingsModal.waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: /^设置/ }).first().click();
  await settingsModal.getByRole('button', { name: '提供商', exact: true }).click();
  const countSpanBox = await settingsModal.locator('.section-toolbar > span').boundingBox();
  assert(countSpanBox && countSpanBox.height < 26, `"0 个连接" must stay on 1 line, got height=${countSpanBox?.height}`);
  await page.screenshot({ path: join(verifyOut, 'v03-settings-light.png'), scale: 'css' });
  await page.keyboard.press('Escape');
  await settingsModal.waitFor({ state: 'hidden' });
  console.log('PASS · Settings light theme & single-line toolbar layout');

  // 6. Verify silent component check (does not pollute jobs) + Preflight & Offline blocker/relink
  const packRes = await page.evaluate(() => window.cocraft.call('packs.import', { example: true }));
  assert(packRes, 'Example pack imported');
  const bootAfterPack = await page.evaluate(() => window.cocraft.call('boot'));
  assert.equal(
    bootAfterPack.jobs.filter((j) => String(j.name).startsWith('检查画面')).length,
    0,
    'Internal component validation must not pollute user jobs list',
  );

  await page.getByRole('button', { name: '导出', exact: true }).click();
  const exportModal = page.getByRole('dialog', { name: '导出成片' });
  await exportModal.locator('.preflight-ok').waitFor();
  await page.keyboard.press('Escape');
  await exportModal.waitFor({ state: 'hidden' });

  // Move photo asset temporarily to trigger offline detection & export blocker
  const photoAsset = bootAfterPack.current.project.assets.find((a) => a.kind === 'image');
  const backupPath = photoAsset.path.replace(/(\.[^.]+)$/, '.moved$1');
  await rename(photoAsset.path, backupPath);
  try {
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await exportModal.locator('.preflight-item.blocker').first().waitFor();
    const exportSubmitDisabled = await exportModal
      .getByRole('button', { name: '导出成片', exact: true })
      .isDisabled();
    assert.equal(exportSubmitDisabled, true, 'Export button is disabled when offline media blocker is present');
    await page.keyboard.press('Escape');
    await exportModal.waitFor({ state: 'hidden' });

    // Relink directly via IPC to restored path
    const relinked = await page.evaluate(
      ({ assetId, path }) => window.cocraft.call('media.relink', { assetId, path }),
      { assetId: photoAsset.id, path: backupPath },
    );
    assert.deepEqual(relinked.offlineAssetIds, [], 'Relink cleared offline status');
  } finally {
    await rename(backupPath, photoAsset.path).catch(() => {});
  }
  console.log('PASS · Silent validation, Export Preflight, Offline blocker & Relink');
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
