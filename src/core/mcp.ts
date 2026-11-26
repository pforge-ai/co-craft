import type { McpServerConfig } from './types';
import { uid } from './project';

export interface McpServerPreset {
  id: string;
  label: string;
  description: string;
  hint: string;
  config: Omit<McpServerConfig, 'id'>;
}

export const MCP_SERVER_PRESETS: McpServerPreset[] = [
  {
    id: 'blender',
    label: 'Blender MCP',
    description: '连接本机运行中的 Blender，让内置 Agent 直接建模、布光、摆机位、导出 .glb 与渲染通道图',
    hint: '需先在 Blender 中启用 BlenderMCP 插件并安装 uv（uvx blender-mcp）',
    config: {
      name: 'Blender',
      enabled: true,
      transport: 'stdio',
      command: 'uvx',
      args: ['blender-mcp'],
      preset: 'blender',
    },
  },
  {
    id: 'fetch',
    label: 'Fetch MCP',
    description: '抓取网页资料、参考文档或公开接口内容辅助脚本与分镜调研',
    hint: '通过 uvx mcp-server-fetch 本地启动',
    config: {
      name: 'Fetch',
      enabled: true,
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      preset: 'fetch',
    },
  },
  {
    id: 'http-custom',
    label: 'HTTP / SSE 远端 MCP',
    description: '连接符合 MCP Streamable HTTP / SSE 协议的本地或远程工具服务',
    hint: '填写完整 http(s):// 地址，可选加密鉴权 Header',
    config: {
      name: 'HTTP MCP 服务',
      enabled: true,
      transport: 'http',
      url: 'http://127.0.0.1:8000/mcp',
      preset: 'http-custom',
    },
  },
];

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
 * Parses standard Claude Desktop / Cursor `{ "mcpServers": { ... } }` or bare server-map JSON
 * into CoCraft `McpServerConfig[]`.
 */
export function parseMcpServersJson(raw: string): McpServerConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('无法解析 JSON，请检查格式是否完整（如标准 mcpServers 配置）');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 顶层必须是对象，例如 { "mcpServers": { "blender": { "command": "uvx", "args": ["blender-mcp"] } } }');
  }
  const obj = parsed as Record<string, unknown>;
  const root =
    obj.mcpServers && typeof obj.mcpServers === 'object' && !Array.isArray(obj.mcpServers)
      ? (obj.mcpServers as Record<string, unknown>)
      : obj;

  const out: McpServerConfig[] = [];
  for (const [key, entry] of Object.entries(root)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const hasUrl = typeof rec.url === 'string' && rec.url.trim().length > 0;
    const hasCommand = typeof rec.command === 'string' && rec.command.trim().length > 0;
    if (!hasUrl && !hasCommand) continue;

    const env: Record<string, string> = {};
    if (rec.env && typeof rec.env === 'object' && !Array.isArray(rec.env)) {
      for (const [ek, ev] of Object.entries(rec.env as Record<string, unknown>)) {
        if (ek.trim() && ev !== undefined && ev !== null) env[ek.trim()] = String(ev);
      }
    }
    const headers: Record<string, string> = {};
    if (rec.headers && typeof rec.headers === 'object' && !Array.isArray(rec.headers)) {
      for (const [hk, hv] of Object.entries(rec.headers as Record<string, unknown>)) {
        if (hk.trim() && hv !== undefined && hv !== null) headers[hk.trim()] = String(hv);
      }
    }
    const args = Array.isArray(rec.args) ? rec.args.map((a) => String(a)) : [];
    const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : key.trim() || 'MCP 服务';
    const isBlender = /blender/i.test(name) || args.some((a) => /blender/i.test(a));

    out.push({
      id: uid('mcp'),
      name,
      enabled: rec.disabled === true ? false : rec.enabled === false ? false : true,
      transport: hasUrl && !hasCommand ? 'http' : 'stdio',
      ...(hasCommand ? { command: String(rec.command).trim(), args } : {}),
      ...(typeof rec.cwd === 'string' && rec.cwd.trim() ? { cwd: rec.cwd.trim() } : {}),
      ...(Object.keys(env).length ? { env, envKeys: Object.keys(env) } : {}),
      ...(hasUrl ? { url: String(rec.url).trim() } : {}),
      ...(Object.keys(headers).length ? { headers, headerKeys: Object.keys(headers) } : {}),
      ...(isBlender ? { preset: 'blender' } : {}),
    });
  }
  if (!out.length) {
    throw new Error('未在 JSON 中发现包含 command 或 url 的有效 MCP 服务条目');
  }
  return out;
}
