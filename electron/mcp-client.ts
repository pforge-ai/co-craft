import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { McpRemoteToolInfo, McpServerConfig, McpServerStatus } from '../src/core/types';
import {
  MCP_MASKED_HEADER_VALUE,
  normalizeMcpTransport,
  qualifyMcpToolName,
  sanitizeMcpSlug,
  validateMcpUrl,
} from '../src/core/mcp';
import type { SettingsStore } from './settings';

type ActiveTransportMode = 'streamable-http' | 'sse';

interface ActiveServerEntry {
  fingerprint: string;
  config: McpServerConfig;
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
  activeTransport: ActiveTransportMode;
  alive: boolean;
  tools: McpRemoteToolInfo[];
  serverVersion?: { name: string; version: string };
  lastCheckedAt: string;
}

function isFatalWithoutFallback(err: unknown): boolean {
  if (err instanceof StreamableHTTPError && (err.code === 401 || err.code === 403)) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|CERT_|ERR_TLS/i.test(msg)) {
    return true;
  }
  const cause = (err as any)?.cause;
  if (cause && /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET/i.test(String(cause.code || cause.message || ''))) {
    return true;
  }
  return false;
}

function formatSdkError(err: unknown): string {
  if (err instanceof Error) {
    const causeMsg = (err as any)?.cause?.message;
    if (causeMsg && !err.message.includes(causeMsg)) {
      return `${err.message} (${causeMsg})`;
    }
    return err.message;
  }
  return String(err);
}

/**
 * Host-managed MCP Client built on the official `@modelcontextprotocol/sdk`.
 * Strictly connects to already-running external MCP server URLs via standard
 * Streamable HTTP (`StreamableHTTPClientTransport`) with SSE fallback (`SSEClientTransport`).
 * Never spawns local subprocesses; keeps all auth headers strictly inside main process.
 */
export class McpClientManager {
  private active = new Map<string, ActiveServerEntry>();
  private lastErrors = new Map<string, string>();

  constructor(
    private settings: SettingsStore,
    private appVersion = '0.6.0',
  ) {}

  private fingerprint(c: McpServerConfig): string {
    return JSON.stringify({
      url: c.url,
      transport: normalizeMcpTransport(c.transport),
      headers: c.headers,
    });
  }

  private async closeClientAndTransport(
    client: Client,
    transport: StreamableHTTPClientTransport | SSEClientTransport,
    mode: ActiveTransportMode,
  ) {
    if (mode === 'streamable-http' && transport instanceof StreamableHTTPClientTransport) {
      await transport.terminateSession().catch(() => {});
    }
    await client.close().catch(() => {});
  }

  private async openSdkConnection(
    url: URL,
    mode: ActiveTransportMode,
    headers: Record<string, string> | undefined,
    timeoutMs: number,
  ): Promise<{ client: Client; transport: StreamableHTTPClientTransport | SSEClientTransport; mode: ActiveTransportMode }> {
    const client = new Client(
      { name: 'CoCraft', version: this.appVersion },
      { capabilities: {} },
    );
    const requestInit: RequestInit | undefined =
      headers && Object.keys(headers).length ? { headers } : undefined;
    const transport =
      mode === 'streamable-http'
        ? new StreamableHTTPClientTransport(url, { requestInit })
        : new SSEClientTransport(url, { requestInit });

    try {
      await client.connect(transport, { timeout: timeoutMs });
      return { client, transport, mode };
    } catch (err) {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      throw err;
    }
  }

  private async connectAndDiscover(
    config: McpServerConfig,
    timeoutMs = 15_000,
  ): Promise<{
    client: Client;
    transport: StreamableHTTPClientTransport | SSEClientTransport;
    activeTransport: ActiveTransportMode;
    tools: McpRemoteToolInfo[];
    serverVersion?: { name: string; version: string };
  }> {
    const url = new URL(validateMcpUrl(config.url));
    const pref = normalizeMcpTransport(config.transport);

    let opened: {
      client: Client;
      transport: StreamableHTTPClientTransport | SSEClientTransport;
      mode: ActiveTransportMode;
    };

    if (pref === 'streamable-http') {
      opened = await this.openSdkConnection(url, 'streamable-http', config.headers, timeoutMs);
    } else if (pref === 'sse') {
      opened = await this.openSdkConnection(url, 'sse', config.headers, timeoutMs);
    } else {
      // Standard MCP 2025-03-26 negotiation: try Streamable HTTP first, fall back to legacy SSE.
      try {
        opened = await this.openSdkConnection(url, 'streamable-http', config.headers, timeoutMs);
      } catch (streamableErr) {
        if (isFatalWithoutFallback(streamableErr)) {
          throw new Error(`无法连接 MCP 服务（${url.href}）：${formatSdkError(streamableErr)}`);
        }
        try {
          opened = await this.openSdkConnection(url, 'sse', config.headers, timeoutMs);
        } catch (sseErr) {
          throw new Error(
            `无法通过 Streamable HTTP 或 SSE 连接 MCP 服务（${url.href}）：${formatSdkError(streamableErr)}；SSE 回退失败：${formatSdkError(sseErr)}`,
          );
        }
      }
    }

    try {
      const slug = sanitizeMcpSlug(config.name || config.id);
      const tools: McpRemoteToolInfo[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const listed = await opened.client.listTools(cursor ? { cursor } : undefined, { timeout: timeoutMs });
        for (const t of listed.tools || []) {
          if (!t?.name) continue;
          tools.push({
            serverId: config.id,
            serverName: config.name,
            serverSlug: slug,
            qualifiedName: qualifyMcpToolName(slug, t.name),
            name: t.name,
            description: typeof t.description === 'string' ? t.description : '',
            inputSchema:
              t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
                ? (t.inputSchema as Record<string, unknown>)
                : { type: 'object', properties: {} },
          });
        }
        if (!listed.nextCursor) break;
        cursor = listed.nextCursor;
      }

      const ver = opened.client.getServerVersion();
      return {
        client: opened.client,
        transport: opened.transport,
        activeTransport: opened.mode,
        tools,
        serverVersion: ver?.name ? { name: ver.name, version: ver.version || '' } : undefined,
      };
    } catch (err) {
      await this.closeClientAndTransport(opened.client, opened.transport, opened.mode);
      throw err;
    }
  }

  private async ensureServer(config: McpServerConfig): Promise<ActiveServerEntry> {
    const fp = this.fingerprint(config);
    const existing = this.active.get(config.id);
    if (existing && existing.alive && existing.fingerprint === fp) {
      existing.config = config;
      return existing;
    }
    if (existing) {
      existing.alive = false;
      this.active.delete(config.id);
      await this.closeClientAndTransport(existing.client, existing.transport, existing.activeTransport);
    }

    const { client, transport, activeTransport, tools, serverVersion } = await this.connectAndDiscover(config);
    const entry: ActiveServerEntry = {
      fingerprint: fp,
      config,
      client,
      transport,
      activeTransport,
      alive: true,
      tools,
      serverVersion,
      lastCheckedAt: new Date().toISOString(),
    };
    client.onclose = () => {
      entry.alive = false;
    };
    transport.onclose = () => {
      entry.alive = false;
    };
    this.active.set(config.id, entry);
    this.lastErrors.delete(config.id);
    return entry;
  }

  async syncWithSettings(): Promise<McpServerStatus[]> {
    const configs = await this.settings.mcpServersWithSecrets();
    const byId = new Map(configs.filter((c) => c.enabled).map((c) => [c.id, c]));
    for (const [id, entry] of this.active.entries()) {
      const next = byId.get(id);
      if (!next || this.fingerprint(next) !== entry.fingerprint) {
        entry.alive = false;
        this.active.delete(id);
        await this.closeClientAndTransport(entry.client, entry.transport, entry.activeTransport);
      }
    }
    return this.getStatuses(configs);
  }

  async getStatuses(preloaded?: McpServerConfig[]): Promise<McpServerStatus[]> {
    const configs = preloaded || (await this.settings.mcpServersWithSecrets());
    return configs.map((c) => {
      const entry = this.active.get(c.id);
      const connected = Boolean(entry && entry.alive);
      return {
        id: c.id,
        name: c.name,
        enabled: c.enabled,
        url: c.url,
        transport: normalizeMcpTransport(c.transport),
        activeTransport: connected ? entry?.activeTransport : undefined,
        connected,
        serverVersion: connected ? entry?.serverVersion : undefined,
        error: connected ? undefined : this.lastErrors.get(c.id),
        tools: entry?.tools || [],
        lastCheckedAt: entry?.lastCheckedAt,
      };
    });
  }

  async testServer(
    draft: McpServerConfig,
  ): Promise<{
    ok: boolean;
    tools: McpRemoteToolInfo[];
    activeTransport?: ActiveTransportMode;
    serverVersion?: { name: string; version: string };
    error?: string;
  }> {
    const saved = (await this.settings.mcpServersWithSecrets()).find((s) => s.id === draft.id);
    let resolvedHeaders: Record<string, string> | undefined;
    if (draft.headers !== undefined) {
      resolvedHeaders = {};
      for (const [k, v] of Object.entries(draft.headers)) {
        if (v === MCP_MASKED_HEADER_VALUE) {
          if (saved?.headers && saved.url === draft.url && typeof saved.headers[k] === 'string') {
            resolvedHeaders[k] = saved.headers[k];
          }
        } else {
          resolvedHeaders[k] = v;
        }
      }
    } else if (saved && saved.url === draft.url) {
      resolvedHeaders = saved.headers;
    }
    const merged: McpServerConfig = {
      ...draft,
      transport: normalizeMcpTransport(draft.transport),
      headers: resolvedHeaders,
    };
    try {
      if (merged.enabled && saved && this.fingerprint(merged) === this.fingerprint(saved)) {
        const entry = await this.ensureServer(merged);
        return {
          ok: true,
          tools: entry.tools,
          activeTransport: entry.activeTransport,
          serverVersion: entry.serverVersion,
        };
      }
      const { client, transport, activeTransport, tools, serverVersion } = await this.connectAndDiscover(
        merged,
        15_000,
      );
      await this.closeClientAndTransport(client, transport, activeTransport);
      this.lastErrors.delete(merged.id);
      return { ok: true, tools, activeTransport, serverVersion };
    } catch (err) {
      const msg = formatSdkError(err);
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
          this.lastErrors.set(c.id, formatSdkError(err));
        }
      }),
    );

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
      if (!entry || !entry.alive) {
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

      const res: any = await entry.client.callTool(
        { name: tool.name, arguments: args || {} },
        undefined,
        { timeout: 90_000, signal },
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
    await Promise.allSettled(
      entries.map((e) => {
        e.alive = false;
        return this.closeClientAndTransport(e.client, e.transport, e.activeTransport);
      }),
    );
  }
}
