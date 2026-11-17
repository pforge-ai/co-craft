import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    rollupOptions: { input: { main: resolve('index.html'), preview: resolve('preview.html') } },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
