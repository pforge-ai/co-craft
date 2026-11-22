import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface McpBridgeStatus {
  running: boolean;
  port: number | null;
  discoveryFile: string;
  scriptPath: string;
  startedAt?: string;
}

export type McpActionHandler = (action: string, params: Record<string, unknown>) => Promise<unknown>;

const MAX_BODY_BYTES = 10 * 1024 * 1024;

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('请求体超过 10MB 限制'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed = text.trim() ? JSON.parse(text) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('请求体必须是 JSON 对象'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error('无法解析 JSON 请求体'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/**
 * Opt-in strictly-local authenticated HTTP bridge for CoCraft's built-in MCP server.
 *
 * Security invariants:
 * - Binds strictly to 127.0.0.1 ephemeral port (never 0.0.0.0).
 * - Authenticates every request with a cryptographically random 32-byte Bearer token via timingSafeEqual.
 * - Writes discovery metadata with 0600 permissions under userData/mcp-bridge.json and removes it on stop.
 * - Never exposes raw API keys or safeStorage secrets.
 */
export class McpBridgeServer {
  private server: Server | null = null;
  private port: number | null = null;
  private token: Buffer | null = null;
  private startedAt?: string;
  readonly discoveryFile: string;

  constructor(
    private dataRoot: string,
    private appVersion: string,
    private scriptPath: string,
    private handler: McpActionHandler,
  ) {
    this.discoveryFile = join(dataRoot, 'mcp-bridge.json');
  }

  status(): McpBridgeStatus {
    return {
      running: this.server !== null && this.port !== null,
      port: this.port,
      discoveryFile: this.discoveryFile,
      scriptPath: this.scriptPath,
      startedAt: this.startedAt,
    };
  }

  clientConfigJson(): string {
    return JSON.stringify(
      {
        mcpServers: {
          cocraft: {
            command: 'node',
            args: [this.scriptPath],
            env: {
              COCRAFT_MCP_DISCOVERY: this.discoveryFile,
            },
          },
        },
      },
      null,
      2,
    );
  }

  private verifyAuth(req: IncomingMessage): boolean {
    if (!this.token) return false;
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
    const provided = Buffer.from(header.slice(7).trim(), 'utf8');
    if (provided.length !== this.token.length) return false;
    return timingSafeEqual(provided, this.token);
  }

  async start(): Promise<McpBridgeStatus> {
    if (this.server && this.port !== null) return this.status();
    const tokenHex = randomBytes(32).toString('hex');
    this.token = Buffer.from(tokenHex, 'utf8');

    const server = createServer(async (req, res) => {
      try {
        if (req.method !== 'POST' || req.url !== '/rpc') {
          sendJson(res, 404, { ok: false, error: 'Not found' });
          return;
        }
        if (!this.verifyAuth(req)) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized: invalid or missing MCP bearer token' });
          return;
        }
        const body = await readJsonBody(req);
        const action = typeof body.action === 'string' ? body.action.trim() : '';
        const params =
          body.params && typeof body.params === 'object' && !Array.isArray(body.params)
            ? (body.params as Record<string, unknown>)
            : {};
        if (!action) {
          sendJson(res, 400, { ok: false, error: 'Missing action' });
          return;
        }
        const data = await this.handler(action, params);
        sendJson(res, 200, { ok: true, data });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, { ok: false, error: message });
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('无法获取本地 MCP 服务监听端口');
    }

    this.server = server;
    this.port = address.port;
    this.startedAt = new Date().toISOString();

    await mkdir(this.dataRoot, { recursive: true });
    const tmpFile = `${this.discoveryFile}.${process.pid}.tmp`;
    const meta = {
      host: '127.0.0.1',
      port: this.port,
      token: tokenHex,
      pid: process.pid,
      appVersion: this.appVersion,
      startedAt: this.startedAt,
    };
    await writeFile(tmpFile, JSON.stringify(meta, null, 2), { encoding: 'utf8', mode: 0o600 });
    await chmod(tmpFile, 0o600).catch(() => {});
    await rename(tmpFile, this.discoveryFile);
    await chmod(this.discoveryFile, 0o600).catch(() => {});

    return this.status();
  }

  async stop(): Promise<void> {
    const srv = this.server;
    this.server = null;
    this.port = null;
    this.token = null;
    this.startedAt = undefined;
    if (srv) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
    await rm(this.discoveryFile, { force: true }).catch(() => {});
  }
}
