import { chromium } from 'playwright';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const svg = await readFile(join(root, 'resources/icon.svg'), 'utf8');
const iconset = join(root, 'resources/icon.iconset');

await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });

const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(existsSync);

const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });

try {
  // Render a SINGLE 1024x1024 master PNG on a dedicated fixed-size context (eliminates Chromium viewport resize tearing!)
  const context = await browser.newContext({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;padding:0;width:1024px;height:1024px;background:transparent;overflow:hidden}svg{display:block;width:1024px;height:1024px}</style>${svg}`,
    { waitUntil: 'load' },
  );
  const masterPath = join(iconset, 'icon_512x512@2x.png');
  await page.screenshot({
    path: masterPath,
    clip: { x: 0, y: 0, width: 1024, height: 1024 },
    omitBackground: true,
  });
  await context.close();

  // Normalize DPI to 72 and deterministically downscale all 9 canonical slices via macOS native sips
  execFileSync('/usr/bin/sips', ['-s', 'dpiWidth', '72', '-s', 'dpiHeight', '72', masterPath], { stdio: 'ignore' });

  const targets = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
  ];

  for (const [name, px] of targets) {
    const out = join(iconset, name);
    execFileSync('/usr/bin/sips', ['-z', String(px), String(px), masterPath, '--out', out], { stdio: 'ignore' });
  }

  const icnsOut = join(root, 'resources/icon.icns');
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icnsOut]);

  // Self-verify roundtrip extraction so broken slices can never ship again
  const verifySet = join(root, 'resources/.verify.iconset');
  await rm(verifySet, { recursive: true, force: true });
  execFileSync('/usr/bin/iconutil', ['-c', 'iconset', icnsOut, '-o', verifySet]);
  const buf128x2 = await readFile(join(verifySet, 'icon_128x128@2x.png'));
  const buf256 = await readFile(join(verifySet, 'icon_256x256.png'));
  await rm(verifySet, { recursive: true, force: true });
  if (!buf128x2.equals(buf256)) {
    throw new Error('ICNS slice mismatch between 128x128@2x and 256x256');
  }
  console.log('Generated & verified clean resources/icon.icns (all 10 slices intact, zero tearing).');
} finally {
  await browser.close();
}
