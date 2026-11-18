import { build } from 'esbuild';
import { bundle } from '@remotion/bundler';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import electron from 'electron';

const root = resolve(import.meta.dirname, '..');
const out = await mkdtemp(join(tmpdir(), 'cocraft-materials-'));
await mkdir(join(out, 'gallery'));
await mkdir(join(out, 'player'));
await symlink(join(root, 'node_modules'), join(out, 'node_modules'), 'dir');
process.stdout.write('本轮素材检查输出 ' + out + '\n');
await Promise.all([
  build({
    entryPoints: [join(root, 'scripts/material-check.host.ts')],
    outfile: join(out, 'host.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
  }),
  build({
    entryPoints: [join(root, 'scripts/material-check.browser.tsx')],
    outfile: join(out, 'gallery/check.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
  }),
  build({
    entryPoints: [join(root, 'src/preview.tsx')],
    outfile: join(out, 'player/preview.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
  }),
  build({
    entryPoints: [join(root, 'electron/preload.ts')],
    outfile: join(out, 'preload.cjs'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron'],
  }),
  bundle({
    entryPoint: join(root, 'src/composition/register.tsx'),
    outDir: join(out, 'render'),
    publicDir: null,
  }),
]);
await writeFile(
  join(out, 'gallery/check.html'),
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="check.css"><body style="margin:0"><div id="root"></div><script src="check.js"></script></body></html>',
);
await writeFile(
  join(out, 'player/preview.html'),
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;background:#141b18;overflow:hidden"><div id="root"></div><script src="preview.js"></script></body></html>',
);
const child = spawn(
  electron,
  ['--user-data-dir=' + join(out, 'electron'), join(out, 'host.mjs'), root, out, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (code) => resolve(code ?? 1));
});
