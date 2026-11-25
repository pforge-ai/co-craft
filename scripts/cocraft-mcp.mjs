#!/usr/bin/env node
/**
 * CoCraft Built-in Local MCP Server (JSON-RPC 2.0 over stdio).
 * Connects to the opt-in strictly-local authenticated CoCraft bridge on 127.0.0.1.
 *
 * Discovery order:
 *   1. COCRAFT_MCP_DISCOVERY env var (path to mcp-bridge.json)
 *   2. <COCRAFT_DATA_DIR>/mcp-bridge.json
 *   3. ~/Library/Application Support/CoCraft/mcp-bridge.json
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'cocraft-mcp', version: '0.4.0' };

const TOOLS = [
  {
    name: 'cocraft_status',
    description: 'Inspect running CoCraft status, active project metadata, sequences, and running background jobs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cocraft_list_projects',
    description: 'List all CoCraft projects stored in the local library.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cocraft_create_project',
    description: 'Create and open a brand-new isolated CoCraft project without modifying existing user projects.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', description: 'Display name of the new project' } },
    },
  },
  {
    name: 'cocraft_open_project',
    description: 'Open an existing CoCraft project directory by absolute path.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string', description: 'Absolute path to project directory or project.json' } },
    },
  },
  {
    name: 'cocraft_read_project',
    description: 'Read the complete current published CoCraft project (sequences, clips, keyframes, assets, vault, components, revision).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cocraft_list_models',
    description: 'List configured AI models, capabilities, ready state, and defaults (metadata only, never exposes API keys).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cocraft_list_presets',
    description: 'List built-in editable motion, 3D PBR stage, and RoughJS whiteboard presets with their parameter schemas.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['all', 'stages', 'graphics', 'titles', 'captions', 'backgrounds'] },
      },
    },
  },
  {
    name: 'cocraft_add_preset_clip',
    description: 'Create and publish a built-in preset clip (e.g. teardown-3d, whiteboard-sketch, tinycharts-state, studio-title) onto the timeline.',
    inputSchema: {
      type: 'object',
      required: ['presetId'],
      properties: {
        presetId: { type: 'string' },
        sequenceId: { type: 'string' },
        name: { type: 'string' },
        track: { type: 'string', enum: ['visual', 'overlay', 'caption', 'audio'] },
        start: { type: 'integer', minimum: 0 },
        duration: { type: 'integer', minimum: 1 },
        props: { type: 'object' },
        transitionIn: { type: 'object' },
        keyframes: { type: 'object' },
      },
    },
  },
  {
    name: 'cocraft_list_studio_media',
    description: 'List bundled offline studio photography and audio/SFX assets.',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['image', 'audio'] } },
    },
  },
  {
    name: 'cocraft_prepare_studio_media',
    description: 'Add a bundled studio image or audio asset into the current project (and optionally append to timeline).',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        sequenceId: { type: 'string' },
        at: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'cocraft_publish_edit',
    description: 'Atomically publish an undoable edit group (updateClip, addClip, deleteClip, updateSequence, etc.) with revision & lock checks.',
    inputSchema: {
      type: 'object',
      required: ['baseRevision', 'name', 'operations'],
      properties: {
        baseRevision: { type: 'integer' },
        name: { type: 'string' },
        operations: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'cocraft_apply_keyframe_preset',
    description: 'Apply one-click keyframe curves to a clip: zoom-in, zoom-out, pan-right, fade-in-out, or auto-duck (for BGM audio).',
    inputSchema: {
      type: 'object',
      required: ['clipId', 'preset'],
      properties: {
        sequenceId: { type: 'string' },
        clipId: { type: 'string' },
        preset: { type: 'string', enum: ['zoom-in', 'zoom-out', 'pan-right', 'fade-in-out', 'auto-duck'] },
        duckVolume: { type: 'number' },
        rampFrames: { type: 'integer' },
      },
    },
  },
  {
    name: 'cocraft_detach_audio',
    description: 'J/L Cut audio detach: mutes a video clip and creates a frame-aligned timeline audio clip on A1.',
    inputSchema: {
      type: 'object',
      required: ['clipId'],
      properties: {
        sequenceId: { type: 'string' },
        clipId: { type: 'string' },
      },
    },
  },
  {
    name: 'cocraft_compile_component',
    description: 'Compile and validate a custom React/Remotion/Three.js/cocraft/rough TSX component and register it into the project (optionally placing a clip on the timeline).',
    inputSchema: {
      type: 'object',
      required: ['name', 'source'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        source: { type: 'string', description: 'Complete TSX source with default export React component' },
        props: { type: 'object' },
        addClip: { type: 'boolean' },
        sequenceId: { type: 'string' },
        track: { type: 'string', enum: ['visual', 'overlay'] },
        start: { type: 'integer', minimum: 0 },
        duration: { type: 'integer', minimum: 1 },
      },
    },
  },
  {
    name: 'cocraft_import_asset',
    description: 'Import one or more local image/video/audio/GLB files into immutable project asset storage.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' } },
        append: { type: 'boolean' },
        sequenceId: { type: 'string' },
      },
    },
  },
  {
    name: 'cocraft_generate_media',
    description: 'Generate an image, video, speech audio, or transcription using the user-configured models inside CoCraft. Supports multi-reference images, first/last frame video control, resolution, aspect ratio, native audio toggle, and transparent PNG output.',
    inputSchema: {
      type: 'object',
      required: ['use'],
      properties: {
        use: { type: 'string', enum: ['image', 'video', 'speech', 'transcription'] },
        prompt: { type: 'string' },
        modelId: { type: 'string' },
        referenceAssetId: { type: 'string' },
        referenceAssetIds: { type: 'array', items: { type: 'string' } },
        lastFrameAssetId: { type: 'string' },
        assetId: { type: 'string' },
        size: { type: 'string' },
        resolution: { type: 'string' },
        aspectRatio: { type: 'string' },
        seconds: { type: 'integer' },
        generateAudio: { type: 'boolean' },
        background: { type: 'string', enum: ['auto', 'opaque', 'transparent'] },
        voice: { type: 'string' },
        language: { type: 'string' },
        wait: { type: 'boolean' },
      },
    },
  },
  {
    name: 'cocraft_search_assets',
    description: 'Search assets across the current project, personal cross-project library, built-in visual styles, and bundled studio media by kind, role, tags, or keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        role: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        query: { type: 'string' },
        scope: { type: 'string', enum: ['project', 'personal', 'studio'] },
      },
    },
  },
  {
    name: 'cocraft_pull_vault_item',
    description: 'Pull an asset, character entity, style, component, or compound clip from the personal cross-project library into the current project.',
    inputSchema: {
      type: 'object',
      required: ['itemId'],
      properties: { itemId: { type: 'string' } },
    },
  },
  {
    name: 'cocraft_inspect_media',
    description: 'Ask the configured vision model inside CoCraft to inspect an image or sampled video frames and return a visual critique/description.',
    inputSchema: {
      type: 'object',
      required: ['assetId'],
      properties: {
        assetId: { type: 'string' },
        modelId: { type: 'string' },
        prompt: { type: 'string' },
      },
    },
  },
  {
    name: 'cocraft_preview_frame',
    description: 'Render a real PNG still frame of the published sequence at an integer frame and return the image for visual inspection.',
    inputSchema: {
      type: 'object',
      required: ['frame'],
      properties: {
        sequenceId: { type: 'string' },
        frame: { type: 'integer', minimum: 0 },
        scale: { type: 'number', minimum: 0.25, maximum: 1 },
      },
    },
  },
  {
    name: 'cocraft_preflight',
    description: 'Run CoCraft delivery preflight checks (offline media, gaps, audio clipping, solo track warnings).',
    inputSchema: {
      type: 'object',
      properties: { sequenceId: { type: 'string' } },
    },
  },
  {
    name: 'cocraft_export',
    description: 'Export a sequence to a real H.264/AAC MP4 file via CoCraft Remotion + FFmpeg renderer.',
    inputSchema: {
      type: 'object',
      properties: {
        sequenceId: { type: 'string' },
        scale: { type: 'number', minimum: 0.25, maximum: 2 },
        fileName: { type: 'string' },
        wait: { type: 'boolean' },
      },
    },
  },
  {
    name: 'cocraft_bake_spatial_video',
    description: 'Render a choreographed 3D Spatial Stage OR custom 3D TSX CodeComponent (camera, actorAction, actorPath, environmentPreset, 2.5D layers, .glb, .spz, or componentId/clipId) into a real local MP4 video asset for timeline use or downstream AI video reference/motion-transfer.',
    inputSchema: {
      type: 'object',
      properties: {
        sequenceId: { type: 'string' },
        clipId: { type: 'string' },
        componentId: { type: 'string' },
        vaultItemId: { type: 'string' },
        assetId: { type: 'string' },
        name: { type: 'string' },
        durationSeconds: { type: 'number', minimum: 1, maximum: 10 },
        pass: { type: 'string', enum: ['beauty', 'clay', 'depth', 'normal', 'wireframe'] },
        scale: { type: 'number', minimum: 0.4, maximum: 1 },
        props: { type: 'object' },
      },
    },
  },
  {
    name: 'cocraft_run_agent',
    description: 'Send a creative/editing prompt to CoCraft built-in Pi Agent using the user-configured agent model and wait for completion.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        sequenceId: { type: 'string' },
        taskId: { type: 'string' },
        modelId: { type: 'string' },
        context: { type: 'string' },
        thinkingLevel: { type: 'string', enum: ['off', 'low', 'medium', 'high'] },
        timeoutMs: { type: 'integer' },
      },
    },
  },
  {
    name: 'cocraft_undo',
    description: 'Undo the latest revision in the current project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cocraft_redo',
    description: 'Redo the next revision in the current project.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const TOOL_TO_ACTION = {
  cocraft_status: 'status',
  cocraft_list_projects: 'projects.list',
  cocraft_create_project: 'projects.create',
  cocraft_open_project: 'projects.open',
  cocraft_read_project: 'project.read',
  cocraft_list_models: 'models.list',
  cocraft_list_presets: 'presets.list',
  cocraft_add_preset_clip: 'presets.addClip',
  cocraft_list_studio_media: 'studio.list',
  cocraft_prepare_studio_media: 'studio.prepare',
  cocraft_publish_edit: 'project.edit',
  cocraft_apply_keyframe_preset: 'clip.applyPresetKeyframes',
  cocraft_detach_audio: 'clip.detachAudio',
  cocraft_compile_component: 'component.compile',
  cocraft_import_asset: 'media.import',
  cocraft_generate_media: 'media.generate',
  cocraft_search_assets: 'assets.search',
  cocraft_pull_vault_item: 'vault.pull',
  cocraft_inspect_media: 'media.inspect',
  cocraft_preview_frame: 'preview.frame',
  cocraft_preflight: 'export.preflight',
  cocraft_export: 'export.start',
  cocraft_bake_spatial_video: 'stage.bakeSpatialVideo',
  cocraft_run_agent: 'agent.run',
  cocraft_undo: 'project.undo',
  cocraft_redo: 'project.redo',
};

function candidateDiscoveryPaths() {
  const list = [];
  if (process.env.COCRAFT_MCP_DISCOVERY) list.push(process.env.COCRAFT_MCP_DISCOVERY);
  if (process.env.COCRAFT_DATA_DIR) list.push(join(process.env.COCRAFT_DATA_DIR, 'mcp-bridge.json'));
  const home = homedir();
  list.push(join(home, 'Library', 'Application Support', 'CoCraft', 'mcp-bridge.json'));
  list.push(join(home, 'Library', 'Application Support', 'cocraft', 'mcp-bridge.json'));
  return list;
}

async function resolveBridge() {
  for (const file of candidateDiscoveryPaths()) {
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      if (raw && typeof raw.port === 'number' && typeof raw.token === 'string' && raw.token.length >= 16) {
        return { host: raw.host || '127.0.0.1', port: raw.port, token: raw.token, file };
      }
    } catch {}
  }
  throw new Error(
    '未检测到运行中的 CoCraft 本地 MCP 桥接服务。请先启动 CoCraft，并在「设置 → 通用 → 本地 MCP 服务」中开启该开关。',
  );
}

async function callBridge(action, params = {}) {
  const bridge = await resolveBridge();
  const res = await fetch(`http://${bridge.host}:${bridge.port}/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bridge.token}`,
    },
    body: JSON.stringify({ action, params }),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `CoCraft MCP Bridge 返回错误 (HTTP ${res.status})`);
  }
  return json.data;
}

let useFraming = false;

function writeMessage(msg) {
  const body = JSON.stringify(msg);
  if (useFraming) {
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
    process.stdout.write(header + body);
  } else {
    process.stdout.write(body + '\n');
  }
}

async function handleRpc(req) {
  const { id, method, params } = req;
  // Notifications have no id and expect no reply
  if (id === undefined || id === null) return;

  try {
    if (method === 'initialize') {
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        },
      });
      return;
    }
    if (method === 'ping') {
      writeMessage({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    if (method === 'tools/list') {
      writeMessage({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    }
    if (method === 'tools/call') {
      const toolName = String(params?.name || '');
      const action = TOOL_TO_ACTION[toolName];
      if (!action) {
        writeMessage({
          jsonrpc: '2.0',
          id,
          result: { isError: true, content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] },
        });
        return;
      }
      const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const data = await callBridge(action, args);
      if (toolName === 'cocraft_preview_frame' && data && typeof data.base64 === 'string') {
        const { base64, ...meta } = data;
        writeMessage({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              { type: 'image', data: base64, mimeType: data.mimeType || 'image/png' },
              { type: 'text', text: JSON.stringify(meta, null, 2) },
            ],
          },
        });
        return;
      }
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        },
      });
      return;
    }
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (method === 'tools/call') {
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: { isError: true, content: [{ type: 'text', text: message }] },
      });
    } else {
      writeMessage({ jsonrpc: '2.0', id, error: { code: -32000, message } });
    }
  }
}

// Stdio transport supporting both newline-delimited JSON-RPC (MCP 2024-11-05+) and Content-Length framing
let buffer = Buffer.alloc(0);

function processBuffer() {
  while (buffer.length > 0) {
    // Strip leading whitespace/newlines when parsing newline-delimited JSON
    const headStr = buffer.slice(0, Math.min(buffer.length, 64)).toString('utf8');
    if (headStr.startsWith('Content-Length:')) {
      useFraming = true;
      const sepIdx = buffer.indexOf('\r\n\r\n');
      if (sepIdx === -1) return;
      const header = buffer.slice(0, sepIdx).toString('utf8');
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) {
        buffer = buffer.slice(sepIdx + 4);
        continue;
      }
      const len = parseInt(m[1], 10);
      const total = sepIdx + 4 + len;
      if (buffer.length < total) return;
      const body = buffer.slice(sepIdx + 4, total).toString('utf8');
      buffer = buffer.slice(total);
      try {
        void handleRpc(JSON.parse(body));
      } catch {}
    } else {
      const nlIdx = buffer.indexOf('\n');
      if (nlIdx === -1) return;
      const line = buffer.slice(0, nlIdx).toString('utf8').trim();
      buffer = buffer.slice(nlIdx + 1);
      if (!line) continue;
      try {
        void handleRpc(JSON.parse(line));
      } catch {}
    }
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  processBuffer();
});

process.stdin.resume();
