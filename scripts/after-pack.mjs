import { existsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const KEEP_LOCALES = new Set(['en.lproj', 'en_GB.lproj', 'zh_CN.lproj', 'zh_TW.lproj']);

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else if (entry.isFile()) total += (await stat(p)).size;
  }
  return total;
}

/**
 * electron-builder afterPack hook:
 * Trims 200+ unused Chromium/Electron .lproj locale packs on macOS while preserving
 * English & Simplified/Traditional Chinese.
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = join(context.appOutDir, `${appName}.app`);
  const electronResDir = join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources',
  );
  if (!existsSync(electronResDir)) return;

  let removedCount = 0;
  let savedBytes = 0;
  for (const entry of await readdir(electronResDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.lproj')) continue;
    if (KEEP_LOCALES.has(entry.name)) continue;
    const target = join(electronResDir, entry.name);
    savedBytes += await dirSize(target);
    await rm(target, { recursive: true, force: true });
    removedCount++;
  }
  console.log(
    `  • afterPack       trimmed ${removedCount} unused .lproj locale bundles (saved ${(savedBytes / 1024 / 1024).toFixed(1)} MB)`,
  );
}
