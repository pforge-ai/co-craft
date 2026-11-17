import { createServer } from 'vite';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { existsSync } from 'node:fs';
if (!existsSync('dist/render-bundle/index.html') || !existsSync('dist/renderer/preview.html'))
  await import('./build.mjs');
await build({
  entryPoints: ['electron/main.ts', 'electron/agent-worker.ts', 'electron/render-worker.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outExtension: { '.js': '.mjs' },
  sourcemap: true,
});
await build({
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, COCRAFT_DEV_URL: 'http://127.0.0.1:5173' },
});
child.on('exit', () => {
  server.close();
  process.exit(0);
});
