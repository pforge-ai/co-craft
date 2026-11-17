import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { bundle } from '@remotion/bundler';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all([
  build({
    entryPoints: ['electron/main.ts', 'electron/agent-worker.ts', 'electron/render-worker.ts'],
    outdir: 'dist',
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outExtension: { '.js': '.mjs' },
    sourcemap: true,
  }),
  build({
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist/preload.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  viteBuild(),
]);
await bundle({
  entryPoint: resolve('src/composition/register.tsx'),
  outDir: resolve('dist/render-bundle'),
  publicDir: resolve('resources/public'),
});
console.log('CoCraft desktop + preview + render bundle ready.');
