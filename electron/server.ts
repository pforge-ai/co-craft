import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Asset } from '../src/core/types';

const mime: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const PREVIEW_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' http://127.0.0.1:* http://localhost:* data: blob:; media-src 'self' http://127.0.0.1:* http://localhost:* blob: data:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* blob: data:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'";

const RENDER_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' http://127.0.0.1:* http://localhost:* data: blob:; media-src 'self' http://127.0.0.1:* http://localhost:* blob: data:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* blob: data:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'";

export class MediaServer {
  private studioAssets = new Map<string, Asset>();
  private projectAssets = new Map<string, Asset>();
  private renderAssets = new Map<string, Asset>();
  private token = randomBytes(24).toString('hex');
  origin = '';

  constructor(
    private rendererDir: string,
    private renderDir: string,
    private devUrl?: string,
  ) {}

  registerStudio(assets: Asset[]) {
    for (const a of assets) this.studioAssets.set(a.id, a);
  }

  /** Replaces active project asset scope so switched-away projects cannot be enumerated. */
  setProjectAssets(assets: Asset[]) {
    this.projectAssets.clear();
    for (const a of assets) this.projectAssets.set(a.id, a);
  }

  /** Registers assets needed by in-flight background render jobs or temporary component checks. */
  register(assets: Asset[]) {
    for (const a of assets) this.renderAssets.set(a.id, a);
  }

  unregisterRenderAssets(ids: string[]) {
    for (const id of ids) this.renderAssets.delete(id);
  }

  private lookupAsset(id: string): Asset | undefined {
    return this.projectAssets.get(id) || this.studioAssets.get(id) || this.renderAssets.get(id);
  }

  async start() {
    const server = createServer(
      (req, res) =>
        void this.serve(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(404);
          res.end();
        }),
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as { port: number };
    this.origin = `http://127.0.0.1:${addr.port}/${this.token}`;
    return this.origin;
  }

  private async serve(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', this.origin);
    const prefix = `/${this.token}/`;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const route = decodeURIComponent(url.pathname.slice(prefix.length));
    let file: string | undefined;
    if (route.startsWith('media/')) {
      const asset = this.lookupAsset(route.slice(6));
      file = url.searchParams.has('thumbnail') ? asset?.thumbnail : asset?.path;
    } else if (route.startsWith('render/')) {
      const candidate = resolve(this.renderDir, route.slice(7));
      if (candidate.startsWith(resolve(this.renderDir) + '/')) file = candidate;
    } else if (route.startsWith('ui/')) {
      const candidate = resolve(this.rendererDir, route.slice(3));
      if (candidate.startsWith(resolve(this.rendererDir) + '/')) file = candidate;
    }
    if (!file || !existsSync(file)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (route === 'ui/preview.html') {
      res.setHeader('Content-Security-Policy', PREVIEW_CSP);
    } else if (route === 'render/index.html') {
      // Enforce CSP on headless render composition too so untrusted TSX cannot exfiltrate over network.
      res.setHeader('Content-Security-Policy', RENDER_CSP);
    }
    res.setHeader('Content-Type', mime[extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', route.startsWith('media/') ? 'private, max-age=3600' : 'no-cache');
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    let start = 0,
      end = info.size - 1;
    if (range) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), end) : end;
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Content-Length': end - start + 1,
      });
    } else res.writeHead(200, { 'Content-Length': info.size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file, { start, end });
    stream.pipe(res);
    res.on('close', () => stream.destroy());
  }
}
