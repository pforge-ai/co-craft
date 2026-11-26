import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpRemoteToolInfo, McpServerConfig, McpServerStatus } from '../src/core/types';
import { qualifyMcpToolName, sanitizeMcpSlug } from '../src/core/mcp';
import type { SettingsStore } from './settings';

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
}

interface McpTransportConn {
  request(method: string, params?: Record<string, unknown>, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<any>;
  notify(method: string, params?: Record<string, unknown>): void;
  close(): Promise<void>;
  readonly alive: boolean;
}

function augmentedPath(basePath?: string): string {
  const home = homedir();
  const extras = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    join(home, '.local', 'bin'),
    join(home, '.cargo', 'bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  const parts = new Set<string>([...(basePath ? basePath.split(':').filter(Boolean) : []), ...extras]);
  return Array.from(parts).join(':');
}

class StdioMcpConnection implements McpTransportConn {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private buffer = Buffer.alloc(0);
  private stderrTail = '';
  private closed = false;

  constructor(config: McpServerConfig) {
    if (!config.command) throw new Error('stdio MCP 缺少启动命令');
    const safeEnv: Record<string, string> = {};
    for (const key of ['HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL', 'TERM']) {
      if (process.env[key]) safeEnv[key] = process.env[key]!;
    }
    safeEnv.PATH = augmentedPath(process.env.PATH);
    if (config.env) {
      for (const [k, v] of Object.entries(config.env)) {
        if (k && v !== undefined) safeEnv[k] = String(v);
      }
    }

    this.proc = spawn(config.command, config.args || [], {
      cwd: config.cwd || homedir(),
      env: safeEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-2000);
    });
    this.proc.on('error', (err) => {
      this.closed = true;
      this.failAll(new Error(`无法启动 MCP 命令「${config.command}」：${err.message}`));
    });
    this.proc.on('close', (code) => {
      this.closed = true;
      const hint = this.stderrTail.trim() ? `：${this.stderrTail.trim().slice(-240)}` : '';
      this.failAll(new Error(`MCP 进程已退出 (${code ?? 'signal'})${hint}`));
    });
  }

  get alive() {
    return !this.closed && !this.proc.killed;
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length > 0) {
      // Support both LSP/MCP Content-Length framing and newline-delimited JSON-RPC
      const head = this.buffer.subarray(0, Math.min(32, this.buffer.length)).toString('utf8');
      if (/^Content-Length:\s*\d+/i.test(head)) {
        const sep = this.buffer.indexOf('\r\n\r\n');
        if (sep < 0) return;
        const headerText = this.buffer.subarray(0, sep).toString('utf8');
        const m = /Content-Length:\s*(\d+)/i.exec(headerText);
        if (!m) {
          this.buffer = this.buffer.subarray(sep + 4);
          continue;
        }
        const len = Number(m[1]);
        const bodyStart = sep + 4;
        if (this.buffer.length < bodyStart + len) return;
        const body = this.buffer.subarray(bodyStart, bodyStart + len).toString('utf8');
        this.buffer = this.buffer.subarray(bodyStart + len);
        this.handleLine(body);
        continue;
      }

      const nl = this.buffer.indexOf(10); // '\n'
      if (nl < 0) return;
      const line = this.buffer.subarray(0, nl).toString('utf8').replace(/\r$/, '').trim();
      this.buffer = this.buffer.subarray(nl + 1);
      if (line) this.handleLine(line);
    }
  }

  private handleLine(raw: string) {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id !== 'number') return;
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) {
      entry.reject(new Error(msg.error.message || `MCP 错误 (${msg.error.code ?? -1})`));
    } else {
      entry.resolve(msg.result);
    }
  }

  notify(method: string, params?: Record<string, unknown>) {
    if (!this.alive) return;
    try {
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n');
    } catch {}
  }

  request(
    method: string,
    params?: Record<string, unknown>,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<any> {
    if (!this.alive) return Promise.reject(new Error('MCP 连接已关闭'));
    if (opts.signal?.aborted) return Promise.reject(new Error('请求已取消'));
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? 60_000;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        clearTimeout(timer);
        this.notify('notifications/cancelled', { requestId: id, reason: 'Cancelled by user' });
        reject(new Error('MCP 工具调用已停止'));
      };
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        opts.signal?.removeEventListener('abort', onAbort);
        reject(new Error(`MCP 请求超时（${Math.round(timeoutMs / 1000)}s）：${method}`));
      }, timeoutMs);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (v) => {
          opts.signal?.removeEventListener('abort', onAbort);
          resolve(v);
        },
        reject: (e) => {
          opts.signal?.removeEventListener('abort', onAbort);
          reject(e);
        },
        timer,
      });
      try {
        this.proc.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n',
        );
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error('MCP 连接已主动关闭'));
    try {
      this.proc.stdin.end();
      this.proc.kill('SIGTERM');
    } catch {}
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          this.proc.kill('SIGKILL');
        } catch {}
        resolve();
      }, 1000);
      this.proc.once('close', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

class HttpMcpConnection implements McpTransportConn {
  private nextId = 1;
  private sessionId: string | null = null;
  private closed = false;

  constructor(private config: McpServerConfig) {
    if (!config.url) throw new Error('HTTP MCP 缺少服务地址');
  }

  get alive() {
    return !this.closed;
  }

  private buildHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.config.headers || {}),
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }

  notify(method: string, params?: Record<string, unknown>) {
    if (this.closed || !this.config.url) return;
    void fetch(this.config.url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<any> {
    if (this.closed || !this.config.url) throw new Error('HTTP MCP 连接已关闭');
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    const res = await fetch(this.config.url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP MCP 请求失败 (${res.status})：${txt.slice(0, 240)}`);
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const raw = await res.text();
    let rpc: JsonRpcResponse | undefined;
    if (ct.includes('text/event-stream')) {
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as JsonRpcResponse;
          if (parsed.id === id || parsed.result !== undefined || parsed.error !== undefined) {
            rpc = parsed;
          }
        } catch {}
      }
    } else if (raw.trim()) {
      rpc = JSON.parse(raw) as JsonRpcResponse;
    }

    if (!rpc) throw new Error('HTTP MCP 返回了空响应');
    if (rpc.error) throw new Error(rpc.error.message || `HTTP MCP 错误 (${rpc.error.code ?? -1})`);
    return rpc.result;
  }

  async close() {
    this.closed = true;
    this.sessionId = null;
  }
}

interface ActiveServerEntry {
  fingerprint: string;
  config: McpServerConfig;
  conn: McpTransportConn;
  tools: McpRemoteToolInfo[];
  lastCheckedAt: string;
}

/**
 * Host-managed MCP Client Manager for CoCraft's built-in Agent.
 * Connects enabled external stdio / Streamable HTTP MCP servers (such as Blender MCP),
 * discovers tools, namespaces them cleanly (`mcp__<server>__<tool>`), and forwards calls
 * with AbortSignal cancellation while keeping all env/header secrets strictly in main process.
 */
export class McpClientManager {
  private active = new Map<string, ActiveServerEntry>();
  private lastErrors = new Map<string, string>();

  constructor(
    private settings: SettingsStore,
    private appVersion = '0.4.0',
  ) {}

  private fingerprint(c: McpServerConfig): string {
    return JSON.stringify({
      transport: c.transport,
      command: c.command,
      args: c.args,
      cwd: c.cwd,
      url: c.url,
      env: c.env,
      headers: c.headers,
    });
  }

  private async connectAndDiscover(config: McpServerConfig, timeoutMs = 20_000): Promise<{ conn: McpTransportConn; tools: McpRemoteToolInfo[] }> {
    const conn: McpTransportConn =
      config.transport === 'http' ? new HttpMcpConnection(config) : new StdioMcpConnection(config);
    try {
      await conn.request(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'CoCraft', version: this.appVersion },
        },
        { timeoutMs },
      );
      conn.notify('notifications/initialized');
      const listed = await conn.request('tools/list', {}, { timeoutMs });
      const rawTools = Array.isArray(listed?.tools) ? listed.tools : [];
      const slug = sanitizeMcpSlug(config.name || config.id);
      const tools: McpRemoteToolInfo[] = rawTools
        .filter((t: any) => typeof t?.name === 'string' && t.name.trim())
        .map((t: any) => ({
          serverId: config.id,
          serverName: config.name,
          serverSlug: slug,
          qualifiedName: qualifyMcpToolName(slug, String(t.name)),
          name: String(t.name),
          description: typeof t.description === 'string' ? t.description : '',
          inputSchema:
            t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
              ? t.inputSchema
              : { type: 'object', properties: {} },
        }));
      return { conn, tools };
    } catch (err) {
      await conn.close().catch(() => {});
      throw err;
    }
  }

  private async ensureServer(config: McpServerConfig): Promise<ActiveServerEntry> {
    const fp = this.fingerprint(config);
    const existing = this.active.get(config.id);
    if (existing && existing.conn.alive && existing.fingerprint === fp) {
      existing.config = config;
      return existing;
    }
    if (existing) {
      await existing.conn.close().catch(() => {});
      this.active.delete(config.id);
    }
    const { conn, tools } = await this.connectAndDiscover(config);
    const entry: ActiveServerEntry = {
      fingerprint: fp,
      config,
      conn,
      tools,
      lastCheckedAt: new Date().toISOString(),
    };
    this.active.set(config.id, entry);
    this.lastErrors.delete(config.id);
    return entry;
  }

  async syncWithSettings(): Promise<McpServerStatus[]> {
    const configs = await this.settings.mcpServersWithSecrets();
    const enabledIds = new Set(configs.filter((c) => c.enabled).map((c) => c.id));
    for (const [id, entry] of this.active.entries()) {
      if (!enabledIds.has(id)) {
        await entry.conn.close().catch(() => {});
        this.active.delete(id);
      }
    }
    return this.getStatuses(configs);
  }

  async getStatuses(preloaded?: McpServerConfig[]): Promise<McpServerStatus[]> {
    const configs = preloaded || (await this.settings.mcpServersWithSecrets());
    return configs.map((c) => {
      const entry = this.active.get(c.id);
      const connected = Boolean(entry && entry.conn.alive);
      return {
        id: c.id,
        name: c.name,
        enabled: c.enabled,
        transport: c.transport,
        connected,
        error: connected ? undefined : this.lastErrors.get(c.id),
        tools: entry?.tools || [],
        lastCheckedAt: entry?.lastCheckedAt,
      };
    });
  }

  async testServer(draft: McpServerConfig): Promise<{ ok: boolean; tools: McpRemoteToolInfo[]; error?: string }> {
    const saved = (await this.settings.mcpServersWithSecrets()).find((s) => s.id === draft.id);
    const merged: McpServerConfig = {
      ...draft,
      env: draft.env !== undefined ? draft.env : saved?.env,
      headers: draft.headers !== undefined ? draft.headers : saved?.headers,
    };
    try {
      if (merged.enabled && saved && this.fingerprint(merged) === this.fingerprint(saved)) {
        const entry = await this.ensureServer(merged);
        return { ok: true, tools: entry.tools };
      }
      const { conn, tools } = await this.connectAndDiscover(merged, 20_000);
      await conn.close().catch(() => {});
      this.lastErrors.delete(merged.id);
      return { ok: true, tools };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastErrors.set(merged.id, msg);
      return { ok: false, tools: [], error: msg };
    }
  }

  async listEnabledTools(): Promise<{ tools: McpRemoteToolInfo[]; statuses: McpServerStatus[] }> {
    const configs = await this.settings.mcpServersWithSecrets();
    const enabled = configs.filter((c) => c.enabled);
    const tools: McpRemoteToolInfo[] = [];

    await Promise.all(
      enabled.map(async (c) => {
        try {
          const entry = await this.ensureServer(c);
          const disabled = new Set(c.disabledTools || []);
          for (const t of entry.tools) {
            if (!disabled.has(t.name)) tools.push(t);
          }
        } catch (err) {
          this.lastErrors.set(c.id, err instanceof Error ? err.message : String(err));
        }
      }),
    );

    // Deduplicate qualified names if two servers share identical slug+toolName
    const seen = new Set<string>();
    const uniqueTools = tools.filter((t) => {
      if (seen.has(t.qualifiedName)) return false;
      seen.add(t.qualifiedName);
      return true;
    });

    return { tools: uniqueTools, statuses: await this.getStatuses(configs) };
  }

  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const configs = await this.settings.mcpServersWithSecrets();
    for (const c of configs) {
      if (!c.enabled) continue;
      let entry = this.active.get(c.id);
      if (!entry || !entry.conn.alive) {
        try {
          entry = await this.ensureServer(c);
        } catch {
          continue;
        }
      }
      const tool = entry.tools.find((t) => t.qualifiedName === qualifiedName);
      if (!tool) continue;
      if ((c.disabledTools || []).includes(tool.name)) {
        throw new Error(`工具「${tool.name}」已在设置中禁用`);
      }
      const res = await entry.conn.request(
        'tools/call',
        { name: tool.name, arguments: args || {} },
        { timeoutMs: 90_000, signal },
      );
      if (res?.isError) {
        const errText = Array.isArray(res.content)
          ? res.content
              .map((item: any) => (item?.type === 'text' ? item.text : ''))
              .filter(Boolean)
              .join('\n')
          : '外部 MCP 工具返回错误';
        throw new Error(`[${c.name}] ${errText || '执行失败'}`);
      }
      return {
        server: c.name,
        tool: tool.name,
        content: res?.content ?? res,
        ...(res?.structuredContent ? { structuredContent: res.structuredContent } : {}),
      };
    }
    throw new Error(`未找到已启用的外部 MCP 工具：${qualifiedName}`);
  }

  async stopAll() {
    const entries = [...this.active.values()];
    this.active.clear();
    await Promise.allSettled(entries.map((e) => e.conn.close()));
  }
}
