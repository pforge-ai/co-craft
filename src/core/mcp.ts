import type { McpServerConfig, McpServerTransport } from './types';
import { uid } from './project';

/** Sentinel displayed in the JSON editor for encrypted header values already stored on disk */
export const MCP_MASKED_HEADER_VALUE = '••••••••';

export function normalizeMcpTransport(raw: unknown): McpServerTransport {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'sse') return 'sse';
  if (s === 'streamable-http' || s === 'streamablehttp' || s === 'streamable_http') {
    return 'streamable-http';
  }
  return 'auto';
}

export function validateMcpUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw new Error('请填写运行中的 MCP 服务地址（http:// 或 https://）');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`MCP 服务地址格式无效：${trimmed}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`MCP 服务地址仅支持 http:// 或 https:// 协议：${trimmed}`);
  }
  return parsed.toString();
}

export function sanitizeMcpSlug(raw: string): string {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return cleaned || 'server';
}

export function qualifyMcpToolName(serverSlug: string, toolName: string): string {
  const safeServer = sanitizeMcpSlug(serverSlug);
  const safeTool = String(toolName || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `mcp__${safeServer}__${safeTool || 'tool'}`;
}

export function parseMcpToolName(qualifiedName: string): { serverSlug: string; toolName: string } | null {
  const m = /^mcp__([a-z0-9_]+)__(.+)$/.exec(String(qualifiedName || ''));
  if (!m) return null;
  return { serverSlug: m[1], toolName: m[2] };
}

export function formatMcpToolLabel(qualifiedName: string): string | null {
  const parsed = parseMcpToolName(qualifiedName);
  if (!parsed) return null;
  return `MCP · ${parsed.serverSlug} · ${parsed.toolName}`;
}

/**
 * Serializes CoCraft `McpServerConfig[]` to standard `{ "mcpServers": { ... } }` JSON.
 * Secret header values already encrypted on disk are rendered as masked sentinels so users
 * can edit the JSON freely without losing saved tokens.
 */
export function serializeMcpServersToJson(servers: McpServerConfig[]): string {
  const map: Record<string, Record<string, unknown>> = {};
  const usedNames = new Set<string>();
  for (const srv of servers || []) {
    let key = String(srv.name || '').trim() || srv.id || 'server';
    if (usedNames.has(key)) {
      let n = 2;
      while (usedNames.has(`${key}-${n}`)) n++;
      key = `${key}-${n}`;
    }
    usedNames.add(key);

    const entry: Record<string, unknown> = {
      url: srv.url,
    };
    const transport = normalizeMcpTransport(srv.transport);
    if (transport !== 'auto') entry.transport = transport;
    if (srv.headers && Object.keys(srv.headers).length > 0) {
      entry.headers = { ...srv.headers };
    } else if (srv.headerKeys && srv.headerKeys.length > 0) {
      entry.headers = Object.fromEntries(srv.headerKeys.map((k) => [k, MCP_MASKED_HEADER_VALUE]));
    }
    if (srv.enabled === false) entry.disabled = true;
    if (srv.disabledTools && srv.disabledTools.length > 0) entry.disabledTools = [...srv.disabledTools];
    map[key] = entry;
  }
  return JSON.stringify({ mcpServers: map }, null, 2);
}

/**
 * Parses standard URL-based MCP server configuration JSON:
 * `{ "mcpServers": { "service": { "url": "http://127.0.0.1:8000/mcp", "headers": { ... } } } }`
 * or `{ "servers": { ... } }` or a bare server map.
 * CoCraft strictly connects to already-running MCP endpoints (Streamable HTTP / SSE) and never spawns local commands.
 * Pass `existing` to preserve stable server IDs, disabledTools, and masked encrypted headers across edits.
 */
export function parseMcpServersJson(
  raw: string,
  existing: McpServerConfig[] = [],
  opts: { allowEmpty?: boolean } = {},
): McpServerConfig[] {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    if (opts.allowEmpty) return [];
    throw new Error('请粘贴有效的 MCP JSON 配置');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('JSON 语法有误，请检查括号、引号与逗号');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'JSON 顶层必须是对象，例如 { "mcpServers": { "my-service": { "url": "http://127.0.0.1:8000/mcp" } } }',
    );
  }
  const obj = parsed as Record<string, unknown>;
  const hasWrapper =
    (obj.mcpServers && typeof obj.mcpServers === 'object' && !Array.isArray(obj.mcpServers)) ||
    (obj.servers && typeof obj.servers === 'object' && !Array.isArray(obj.servers));
  const root =
    obj.mcpServers && typeof obj.mcpServers === 'object' && !Array.isArray(obj.mcpServers)
      ? (obj.mcpServers as Record<string, unknown>)
      : obj.servers && typeof obj.servers === 'object' && !Array.isArray(obj.servers)
        ? (obj.servers as Record<string, unknown>)
        : obj;

  const entries = Object.entries(root);
  if (entries.length === 0) {
    if (opts.allowEmpty || hasWrapper) return [];
    throw new Error('未在 JSON 中发现 MCP 服务配置');
  }

  const out: McpServerConfig[] = [];
  const usedExistingIds = new Set<string>();
  let sawCommandOnly = false;

  for (const [key, entry] of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const rawUrl =
      typeof rec.url === 'string' && rec.url.trim()
        ? rec.url.trim()
        : typeof rec.serverUrl === 'string' && rec.serverUrl.trim()
          ? rec.serverUrl.trim()
          : '';
    if (!rawUrl) {
      if (typeof rec.command === 'string' && rec.command.trim()) sawCommandOnly = true;
      continue;
    }

    const url = validateMcpUrl(rawUrl);
    const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : key.trim() || 'MCP 服务';
    const prev = existing.find(
      (s) =>
        !usedExistingIds.has(s.id) &&
        (s.name.trim().toLowerCase() === name.toLowerCase() || s.url.trim() === url),
    );
    if (prev) usedExistingIds.add(prev.id);

    const parsedHeaders: Record<string, string> = {};
    const hasHeadersField = rec.headers !== undefined;
    if (rec.headers && typeof rec.headers === 'object' && !Array.isArray(rec.headers)) {
      for (const [hk, hv] of Object.entries(rec.headers as Record<string, unknown>)) {
        if (hk.trim() && hv !== undefined && hv !== null) parsedHeaders[hk.trim()] = String(hv);
      }
    }
    const headerKeys = Object.keys(parsedHeaders);
    const allHeadersMaskedAndUnchanged =
      Boolean(prev) &&
      prev!.url.trim() === url &&
      headerKeys.length > 0 &&
      headerKeys.length === (prev!.headerKeys?.length || 0) &&
      headerKeys.every(
        (k) => parsedHeaders[k] === MCP_MASKED_HEADER_VALUE && prev!.headerKeys?.includes(k),
      );

    const transport = normalizeMcpTransport(rec.transport ?? rec.type);
    const disabledTools = Array.isArray(rec.disabledTools)
      ? Array.from(new Set(rec.disabledTools.map(String).filter(Boolean)))
      : prev?.disabledTools || [];

    out.push({
      id: prev?.id || uid('mcp'),
      name,
      enabled: rec.disabled === true ? false : rec.enabled === false ? false : true,
      url,
      transport,
      ...(allHeadersMaskedAndUnchanged
        ? { headerKeys: prev!.headerKeys }
        : hasHeadersField
          ? { headers: parsedHeaders, headerKeys }
          : { headers: {}, headerKeys: [] }),
      ...(disabledTools.length ? { disabledTools } : {}),
    });
  }

  if (!out.length) {
    if (sawCommandOnly) {
      throw new Error(
        'CoCraft 仅连接运行中的 MCP 服务 URL（Streamable HTTP / SSE），不代为启动本地命令行进程（stdio）；请先自行启动服务并填写其 http(s):// 地址',
      );
    }
    if (opts.allowEmpty) return [];
    throw new Error('未在 JSON 中发现包含有效 http(s):// url 的 MCP 服务条目');
  }
  return out;
}
