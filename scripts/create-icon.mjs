import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const svg = await readFile(join(root, 'resources/icon.svg'), 'utf8');
const markSource = await readFile(join(root, 'src/components/BrandMark.tsx'), 'utf8');
const geometry = Object.fromEntries(
  ['regularTop', 'regularBottom', 'compactTop', 'compactBottom'].map((name) => {
    const value = markSource.match(new RegExp(`const\\s+${name}\\s*=\\s*'([^']+)';`))?.[1];
    if (!value) throw new Error(`Missing brand geometry: ${name}`);
    return [name, value];
  }),
);
for (const [svgId, componentKey] of [
  ['brand-top', 'regularTop'],
  ['brand-bottom', 'regularBottom'],
]) {
  if (svg.match(new RegExp(`id="${svgId}" d="([^"]+)"`))?.[1] !== geometry[componentKey]) {
    throw new Error(`Application and workspace geometry disagree: ${svgId}`);
  }
}
const iconset = join(root, 'resources/icon.iconset');
await mkdir(iconset, { recursive: true });
const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const compactSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32"><defs><linearGradient id="bg" x2=".8" y2="1"><stop stop-color="#333a49"/><stop offset="1" stop-color="#15171e"/></linearGradient></defs><rect x="3" y="3" width="26" height="26" rx="6" fill="url(#bg)"/><rect x="3.15" y="3.15" width="25.7" height="25.7" rx="5.85" fill="none" stroke="#909eb8" stroke-opacity=".38" stroke-width=".3"/><g transform="translate(3.1 3.2) scale(.9 .8)" fill="#f0f3fc"><path d="${geometry.compactTop}"/><path d="${geometry.compactBottom}"/></g></svg>`;
try {
  for (const size of [16, 32, 128, 256, 512]) {
    for (const density of [1, 2]) {
      const pixels = size * density;
      await page.setViewportSize({ width: pixels, height: pixels });
      const artwork = pixels <= 64 ? compactSvg : svg;
      await page.setContent(
        `<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:100vw;height:100vh}</style>${artwork}`,
      );
      await page.screenshot({
        path: join(iconset, `icon_${size}x${size}${density === 2 ? '@2x' : ''}.png`),
        omitBackground: true,
      });
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(root, 'resources/icon.icns')]);
  const mono = (size, theme) =>
    `<svg width="${size}" height="${size}" viewBox="${size <= 20 ? '-1.5' : '-1.75'} 0 32 32" fill="${theme === 'dark' ? '#f0f3fb' : '#242732'}"><path d="${size <= 20 ? geometry.compactTop : geometry.regularTop}"/><path d="${size <= 20 ? geometry.compactBottom : geometry.regularBottom}"/></svg>`;
  const appData = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const sheet = `<style>*{box-sizing:border-box}body{margin:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#f4f5f8;color:#242732}.stage{display:grid;grid-template-columns:1fr 1fr}.theme{padding:40px;min-width:0}.dark{background:#15171c;color:#edf0f8}.label{font-size:12px;letter-spacing:.08em;color:#747d90;margin-bottom:24px}.line{display:flex;align-items:center;gap:22px;margin-top:26px}.word{display:flex;align-items:center;gap:10px;font-size:22px;font-weight:600;letter-spacing:-.6px}.app{display:block;width:256px;height:256px;margin:0 auto 12px}.caption{font-size:12px;color:#7c8494}.sizes{display:flex;align-items:end;gap:26px}.sizes>div{display:flex;flex-direction:column;align-items:center;gap:12px}.footer{padding:22px 40px;border-top:1px solid #dfe3eb;display:flex;align-items:center;gap:28px}img{display:block}.mono16{width:16px;height:16px}</style><div class="stage">${['light', 'dark'].map((theme) => `<div class="theme ${theme}"><div class="label">COCRAFT · ${theme.toUpperCase()}</div><img class="app" src="${appData}"/><div class="line"><span class="word">${mono(28, theme)}CoCraft</span></div><div class="line sizes">${[16, 24, 32, 64].map((size) => `<div>${mono(size, theme)}<span class="caption">${size}px</span></div>`).join('')}</div></div>`).join('')}</div><div class="footer"><span class="caption">macOS · native pixels</span>${[16, 32, 128].map((size) => `<img src="file://${join(iconset, `icon_${size}x${size}.png`)}" width="${size}" height="${size}"/>`).join('')}</div>`;
  // File URL lets Chromium inspect the actual exported native-size PNGs.
  const proofPath = join(iconset, 'brand-proof.html');
  await writeFile(proofPath, sheet);
  await page.setViewportSize({ width: 960, height: 730 });
  await page.goto('file://' + proofPath);
  await page.screenshot({ path: join(iconset, 'brand-proof.png'), fullPage: true });
  console.log('Wrote icon.icns, ten native-size PNGs, and brand-proof.png');
} finally {
  await browser.close();
}
