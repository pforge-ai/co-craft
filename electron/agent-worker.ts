import {
  createAgentSession,
  ModelRuntime,
  DefaultResourceLoader,
  SettingsManager,
  SessionManager,
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
  createBashToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile, mkdir, realpath, access, lstat, readlink } from 'node:fs/promises';
import { resolve, dirname, join, extname, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent';
const port = (process as any).parentPort;
let session: AgentSession | undefined;
let stopped = false;
let activeReadRoots: string[] = [];
const earlySteers: { text: string; images?: any[]; extraReadPaths?: string[] }[] = [];
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const send = (data: unknown) => port.postMessage(data);
function request(method: string, payload: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    if (stopped) return reject(new Error('运行已停止'));
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    send({ type: 'request', id, method, payload });
  });
}
const result = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  details: {},
});
const optionalText = Type.Optional(Type.String());
const parameterMap = Type.Optional(
  Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
);
function hostTool(
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
): ToolDefinition<any, any, any> {
  return {
    name,
    label,
    description,
    parameters: parameters as any,
    execute: async (_id, args) => result(await request(name, args)),
  };
}
function isWithinRoots(resolved: string, roots: string[]): boolean {
  const validRoots = roots.filter((r) => typeof r === 'string' && r.length > 0 && isAbsolute(r));
  return validRoots.some((root) => resolved === root || resolved.startsWith(root + '/'));
}
async function guard(file: string, roots: string[], write = false, depth = 0): Promise<string> {
  if (depth > 8) throw new Error('符号链接层级过深');
  const path = resolve(file);
  let probe = path;
  while (true) {
    try {
      // Check lstat first so a dangling symlink inside cwd pointing outside roots is NEVER followed!
      const st = await lstat(probe);
      if (st.isSymbolicLink()) {
        const linkTarget = await readlink(probe);
        const resolvedTarget = resolve(dirname(probe), linkTarget);
        const remainder = path.slice(probe.length);
        return guard(resolvedTarget + remainder, roots, write, depth + 1);
      }
      const real = await realpath(probe);
      const resolved = real + path.slice(probe.length);
      if (!isWithinRoots(resolved, roots)) throw new Error('路径超出任务工作区');
      return resolved;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || !write) throw e;
      const parent = dirname(probe);
      if (parent === probe) throw e;
      probe = parent;
    }
  }
}
function modelSupportsReasoning(modelId: string, protocol: string, baseUrl: string): boolean {
  const id = modelId.toLowerCase();
  const url = baseUrl.toLowerCase();
  if (/^(o1|o3|o4|gpt-5)/.test(id)) return true;
  if (/claude-(3-7|sonnet-4|opus-4|haiku-4|4)/.test(id)) return true;
  if (/gemini-(2\.5|3|.*thinking)/.test(id)) return true;
  if (/deepseek-(r1|reasoner)/.test(id)) return true;
  if (/(thinking|reasoner|-r1\b|qwq|qvq)/.test(id)) return true;
  if ((protocol === 'dashscope' || url.includes('dashscope') || url.includes('qianwen')) && /^qwen3/.test(id))
    return true;
  return false;
}
function buildOpenAICompat(
  protocol: string,
  baseUrl: string,
  supportsReasoning: boolean,
): Record<string, unknown> | undefined {
  const url = baseUrl.toLowerCase();
  const isOfficialOpenAI = url.includes('api.openai.com');
  if (isOfficialOpenAI) return undefined;
  const isDashscope = protocol === 'dashscope' || url.includes('dashscope') || url.includes('qianwen');
  if (isDashscope) {
    return {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'qwen',
    };
  }
  const isDeepSeek = url.includes('deepseek.com');
  if (isDeepSeek) {
    return {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: supportsReasoning,
      maxTokensField: 'max_tokens',
    };
  }
  return {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: supportsReasoning,
    maxTokensField: 'max_tokens',
  };
}
async function resolveValidPaths(paths: unknown[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== 'string' || !raw.trim() || !isAbsolute(raw)) continue;
    try {
      const rp = await realpath(raw);
      if (rp && isAbsolute(rp)) out.push(rp);
    } catch {}
  }
  return Array.from(new Set(out));
}
async function start(data: any) {
  const { cwd, agentDir, skillsPath, projectSkillsPath, settings, sessionPath, sessionDir, prompt, assetPaths } = data;
  stopped = false;
  // One utility process serves one configured Agent connection, including the SDK's global-fetch transports.
  const origin = new URL(settings.baseUrl).origin;
  const http = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) throw new Error('模型请求目标与所选提供商不同');
    const response = await http(input, { ...init, redirect: 'error', credentials: 'omit' });
    if (response.ok) return response;
    const message = (await response.text()).replaceAll(settings.apiKey, '[密钥已隐藏]');
    return new Response(message, {
      status: response.status,
      statusText: response.statusText,
      headers: { 'Content-Type': response.headers.get('Content-Type') || 'text/plain' },
    });
  };
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cwd, '.tmp'), { recursive: true });
  const userSkillsReal = data.userSkillsPath ? await realpath(data.userSkillsPath).catch(() => null) : null;
  const projectSkillsReal = projectSkillsPath ? await realpath(projectSkillsPath).catch(() => null) : null;
  const resolvedAssets = await resolveValidPaths(Array.isArray(assetPaths) ? assetPaths : []);
  const writeRoots = [await realpath(cwd)];
  const readRoots = [
    ...writeRoots,
    await realpath(skillsPath),
    ...(projectSkillsReal ? [projectSkillsReal] : []),
    ...(userSkillsReal ? [userSkillsReal] : []),
    ...resolvedAssets,
  ];
  activeReadRoots = readRoots;
  const read = async (p: string) => readFile(await guard(p, activeReadRoots));
  const write = async (p: string, content: string) => {
    if (stopped) throw new Error('运行已停止');
    await writeFile(await guard(p, writeRoots, true), content, 'utf8');
  };
  const customTools: ToolDefinition<any, any, any>[] = [
    createReadToolDefinition(cwd, {
      operations: {
        readFile: read,
        access: async (p) => {
          await access(await guard(p, activeReadRoots));
        },
        detectImageMimeType: async (p) =>
          ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[
            extname(p).toLowerCase()
          ] || null,
      },
    }),
    createWriteToolDefinition(cwd, {
      operations: {
        writeFile: write,
        mkdir: async (p) => {
          await mkdir(await guard(p, writeRoots, true), { recursive: true });
        },
      },
    }),
    createEditToolDefinition(cwd, {
      operations: {
        readFile: read,
        writeFile: write,
        access: async (p) => {
          await access(await guard(p, writeRoots));
        },
      },
    }),
    {
      name: 'read_project',
      label: '读取工程',
      description: 'Read the latest published project, including IDs, clips, locks, assets, and revision.',
      parameters: Type.Object({}) as any,
      execute: async () => result(await request('read_project', {})),
    },
    {
      name: 'publish_edit',
      label: '发布剪辑修改',
      description:
        'Atomically publish an undoable edit group. Integer frames. Rejects locked clips and stale baseRevision. Operations follow the cocraft-editing skill.',
      parameters: Type.Object({
        baseRevision: Type.Number(),
        name: Type.String(),
        operations: Type.Array(Type.Any()),
      }) as any,
      execute: async (_id, args) => result(await request('publish_edit', args)),
    },
    {
      name: 'compile_component',
      label: '编译画面组件',
      description:
        'Compile a TSX file in this workspace to a reusable Remotion component. Returns a component for putComponent. Default export must be a React component.',
      parameters: Type.Object({
        path: Type.String(),
        id: Type.String(),
        name: Type.String(),
        props: Type.Optional(
          Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
        ),
      }) as any,
      execute: async (_id, args: any) =>
        result(
          await request('compile_component', {
            ...args,
            path: await guard(resolve(cwd, args.path), writeRoots),
          }),
        ),
    },
    {
      name: 'import_asset',
      label: '登记生成素材',
      description:
        'Import an image/video/audio generated in the task workspace into immutable project storage. Returns an asset for an addAsset operation. Does not publish automatically.',
      parameters: Type.Object({ path: Type.String(), name: Type.Optional(Type.String()) }) as any,
      execute: async (_id, args: any) =>
        result(
          await request('import_asset', { ...args, path: await guard(resolve(cwd, args.path), writeRoots) }),
        ),
    },
    hostTool(
      'list_models',
      '查看创作模型',
      'List the configured models, their capabilities, connection status, and project defaults. Use a returned model id to override a default for one job.',
      Type.Object({}),
    ),
    hostTool(
      'list_studio_media',
      '浏览随附素材',
      'List bundled photography and audio that can be used offline, with dimensions, duration and license.',
      Type.Object({ kind: Type.Optional(Type.Union([Type.Literal('image'), Type.Literal('audio')])) }),
    ),
    hostTool(
      'prepare_studio_media',
      '准备随附素材',
      'Stage a bundled photo or sound by its catalog id. Returns an asset for addAsset and addClip in the next edit.',
      Type.Object({ id: Type.String() }),
    ),
    hostTool(
      'list_presets',
      '浏览动态组件母版',
      'Find a built-in editable motion or 3D component template by purpose and see its parameter schema, default props, duration and license.',
      Type.Object({
        category: Type.Optional(
          Type.Union([
            Type.Literal('stages'),
            Type.Literal('titles'),
            Type.Literal('captions'),
            Type.Literal('graphics'),
            Type.Literal('backgrounds'),
          ]),
        ),
      }),
    ),
    hostTool(
      'search_assets',
      '检索项目、个人库与官方资产',
      'Search assets across current project, personal library, built-in visual styles, and built-in studio SFX/backdrops by objective kind, usage role, custom tags, or keyword.',
      Type.Object({
        kind: optionalText,
        role: optionalText,
        tags: Type.Optional(Type.Array(Type.String())),
        query: optionalText,
        scope: Type.Optional(
          Type.Union([Type.Literal('project'), Type.Literal('personal'), Type.Literal('studio')]),
        ),
      }),
    ),
    hostTool(
      'prepare_preset',
      '准备预设片段',
      'Prepare an editable preset by ID with overrides and integer frame timing. The returned operation can be included in publish_edit.',
      Type.Object({
        presetId: Type.String(),
        sequenceId: optionalText,
        start: Type.Optional(Type.Integer({ minimum: 0 })),
        duration: Type.Optional(Type.Integer({ minimum: 1 })),
        props: parameterMap,
      }),
    ),
    hostTool(
      'generate_media',
      '生成创作素材',
      'Generate an image, video or speech using the selected media model. Waits for the provider and returns a staged asset. To adopt, publish addAsset with its ID and addClip in one group. Supports single/multi reference images (referenceAssetId / referenceAssetIds), optional video end frame (lastFrameAssetId), resolution, aspectRatio, generateAudio, and transparent background.',
      Type.Object({
        use: Type.Union([Type.Literal('image'), Type.Literal('video'), Type.Literal('speech')]),
        prompt: Type.String(),
        modelId: optionalText,
        referenceAssetId: optionalText,
        referenceAssetIds: Type.Optional(Type.Array(Type.String())),
        lastFrameAssetId: optionalText,
        size: optionalText,
        resolution: optionalText,
        aspectRatio: optionalText,
        seconds: Type.Optional(Type.Integer({ minimum: 1 })),
        generateAudio: Type.Optional(Type.Boolean()),
        background: Type.Optional(
          Type.Union([Type.Literal('auto'), Type.Literal('opaque'), Type.Literal('transparent')]),
        ),
        voice: optionalText,
        parameters: parameterMap,
      }),
    ),
    hostTool(
      'transcribe_asset',
      '转录项目素材',
      'Transcribe speech from a project or staged asset. Returns text and only the timestamped segments actually supplied by the transcription provider, in seconds relative to source media.',
      Type.Object({
        assetId: Type.String(),
        modelId: optionalText,
        language: optionalText,
        prompt: optionalText,
      }),
    ),
    hostTool(
      'inspect_media',
      '分析素材画面',
      'Ask the selected vision model to inspect an image or sampled video frames and return text. Works with text-only editing models. Accepts project and staged asset IDs.',
      Type.Object({ assetId: Type.String(), modelId: optionalText, prompt: optionalText }),
    ),
    {
      name: 'preview_frame',
      label: '检查预览帧',
      description:
        'Render a still of a published sequence at an integer frame. Image-capable agents receive the frame. Text-only agents receive an analysis by the configured vision model.',
      parameters: Type.Object({
        sequenceId: Type.String(),
        frame: Type.Integer({ minimum: 0 }),
        prompt: optionalText,
      }) as any,
      execute: async (_id, args) => {
        const response = await request('preview_frame', args);
        if (!response.data) return result(response);
        return {
          content: [{ type: 'image' as const, data: response.data, mimeType: 'image/png' }],
          details: {},
        };
      },
    },
    hostTool(
      'apply_keyframe_preset',
      '应用关键帧曲线与自动闪避',
      'Apply one-click keyframe animation or voice-aware auto-ducking to a clip: zoom-in, zoom-out, pan-right, fade-in-out, or auto-duck (for BGM audio). Respects clip locks and active scope.',
      Type.Object({
        sequenceId: optionalText,
        clipId: Type.String(),
        preset: Type.Union([
          Type.Literal('zoom-in'),
          Type.Literal('zoom-out'),
          Type.Literal('pan-right'),
          Type.Literal('fade-in-out'),
          Type.Literal('auto-duck'),
        ]),
        duckVolume: Type.Optional(Type.Number()),
        rampFrames: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
    ),
    hostTool(
      'detach_audio',
      '音画分离 (J/L Cut)',
      'Detach a video clip audio track: mutes the video clip native audio and creates a frame-aligned timeline audio clip on A1.',
      Type.Object({
        sequenceId: optionalText,
        clipId: Type.String(),
      }),
    ),
    hostTool(
      'pull_vault_item',
      '从个人库引入资产',
      'Pull an asset, character entity, style, component, or compound clip from the personal cross-project library (discovered via search_assets scope="personal") into the current project.',
      Type.Object({ itemId: Type.String() }),
    ),
    hostTool(
      'preflight_sequence',
      '交付预检检查',
      'Run export preflight checks on a sequence to detect missing/offline media, visual black gaps, caption overflow, or audio clipping risks before finishing.',
      Type.Object({ sequenceId: optionalText }),
    ),
    hostTool(
      'export_sequence',
      '导出 MP4 成片',
      'Run preflight and render the published sequence to a real H.264/AAC MP4 file inside the project exports directory. Use only when the user explicitly asks to export/render the video.',
      Type.Object({
        sequenceId: optionalText,
        scale: Type.Optional(Type.Number({ minimum: 0.25, maximum: 2 })),
        fileName: optionalText,
      }),
    ),
    hostTool(
      'bake_spatial_video',
      '录制 3D 空间预演视频',
      'Render a choreographed 3D Spatial Stage OR custom 3D TSX CodeComponent (camera trajectory, actorAction, actorPath, environmentPreset, 2.5D layers, .glb/.spz, or componentId/clipId) into a real local MP4 video asset in the project vault so it can be placed on the timeline OR passed into generate_media as a driving/reference video.',
      Type.Object({
        sequenceId: optionalText,
        clipId: optionalText,
        componentId: optionalText,
        vaultItemId: optionalText,
        assetId: optionalText,
        name: optionalText,
        durationSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
        pass: Type.Optional(
          Type.Union([
            Type.Literal('beauty'),
            Type.Literal('clay'),
            Type.Literal('depth'),
            Type.Literal('normal'),
            Type.Literal('wireframe'),
          ]),
        ),
        scale: Type.Optional(Type.Number({ minimum: 0.4, maximum: 1 })),
        props: Type.Optional(Type.Record(Type.String(), Type.Any())),
      }),
    ),
  ];
  const skillsReal = await realpath(skillsPath);
  const mediaToolsReal =
    typeof data.mediaToolsPath === 'string' && isAbsolute(data.mediaToolsPath)
      ? await realpath(data.mediaToolsPath).catch(() => null)
      : null;
  if (settings.allowShell) {
    customTools.push(
      createBashToolDefinition(cwd, {
        exposeSessionEnvironment: false,
        operations: {
          exec: (command, _cwd, options) =>
            new Promise((resolvePromise, reject) => {
              const q = (s: string) => JSON.stringify(s);
              const readSubpaths = [
                cwd,
                skillsReal,
                ...(projectSkillsReal ? [projectSkillsReal] : []),
                ...(userSkillsReal ? [userSkillsReal] : []),
                ...(mediaToolsReal ? [mediaToolsReal] : []),
              ]
                .filter((s) => Boolean(s) && isAbsolute(s))
                .map((s) => `(subpath ${q(s)})`)
                .join(' ');
              const assetLiterals = activeReadRoots
                .filter((s) => s !== cwd && s !== skillsReal && s !== projectSkillsReal && s !== userSkillsReal)
                .map((s) => `(literal ${q(s)})`)
                .join(' ');
              const networkRules = settings.allowNetwork
                ? [
                    '(allow network-outbound (remote tcp "*:*"))',
                    '(allow network-outbound (remote udp "*:*"))',
                    // macOS Seatbelt SBPL only accepts "*" or "localhost" as host in (remote ...);
                    // "localhost:*" blocks both IPv4 127.0.0.1 and IPv6 ::1 loopback immediately.
                    '(deny network-outbound (remote ip "localhost:*"))',
                    '(deny network-outbound (remote tcp "localhost:*"))',
                    '(deny network-outbound (remote udp "localhost:*"))',
                    '(allow mach-lookup (global-name "com.apple.SystemConfiguration.configd") (global-name "com.apple.trustd.agent") (global-name "com.apple.dnssd.service") (global-name "com.apple.mDNSResponder"))',
                  ].join('\n')
                : '';
              const tmpDir = join(cwd, '.tmp');
              const npmCacheDir = join(cwd, '.npm-cache');
              try {
                mkdirSync(tmpDir, { recursive: true });
                mkdirSync(npmCacheDir, { recursive: true });
              } catch {}
              const profile = [
                '(version 1)',
                '(deny default)',
                '(allow process-exec)',
                '(allow process-fork)',
                '(allow process-info* (target same-sandbox))',
                '(allow signal (target same-sandbox))',
                '(allow sysctl-read)',
                '(allow pseudo-tty)',
                '(allow file-ioctl (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
                '(allow file-read-metadata)',
                '(allow file-map-executable)',
                `(allow file-read* (literal "/") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/System") (subpath "/Library/Frameworks") (subpath "/Library/Preferences") (subpath "/Library/Apple") (subpath "/Library/Developer/CommandLineTools") (subpath "/opt/homebrew") (subpath "/usr/local") (subpath "/private/etc") (subpath "/dev") (literal "/etc") (literal "/var") (literal "/tmp") (subpath "/private/var/db/timezone") (subpath "/private/var/select") ${readSubpaths} ${assetLiterals})`,
                '(deny file-read* (subpath "/private/etc/ssh") (subpath "/private/etc/master.passwd"))',
                `(allow file-write* (subpath ${q(cwd)}) (literal "/dev/null") (literal "/dev/dtracehelper"))`,
                '(allow mach-lookup (global-name "com.apple.system.logger") (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.system.notification_center"))',
                networkRules,
              ]
                .filter(Boolean)
                .join('\n');
              const proc = spawn(
                '/usr/bin/sandbox-exec',
                [
                  '-p',
                  profile,
                  '/bin/bash',
                  '--noprofile',
                  '--norc',
                  '-c',
                  `${mediaToolsReal ? `export DYLD_FALLBACK_LIBRARY_PATH='${mediaToolsReal.replace(/'/g, "'\\''")}'\n` : ''}${command}`,
                ],
                {
                  cwd,
                  env: {
                    PATH:
                      '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' +
                      (mediaToolsReal ? ':' + mediaToolsReal : ''),
                    LANG: 'en_US.UTF-8',
                    HOME: cwd,
                    TMPDIR: tmpDir,
                    npm_config_cache: npmCacheDir,
                  },
                  stdio: ['ignore', 'pipe', 'pipe'],
                  detached: true,
                },
              );
              proc.stdout.on('data', options.onData);
              proc.stderr.on('data', options.onData);
              let killEscalation: ReturnType<typeof setTimeout> | undefined;
              const kill = () => {
                try {
                  process.kill(-proc.pid!, 'SIGTERM');
                } catch {}
                if (!killEscalation) {
                  killEscalation = setTimeout(() => {
                    try {
                      process.kill(-proc.pid!, 'SIGKILL');
                    } catch {}
                  }, 2000);
                }
              };
              options.signal?.addEventListener('abort', kill, { once: true });
              const timeout = setTimeout(kill, Math.min(options.timeout || 60, 180) * 1000);
              proc.on('error', (err) => {
                clearTimeout(timeout);
                if (killEscalation) clearTimeout(killEscalation);
                reject(err);
              });
              proc.on('close', (code) => {
                clearTimeout(timeout);
                if (killEscalation) clearTimeout(killEscalation);
                options.signal?.removeEventListener('abort', kill);
                resolvePromise({ exitCode: code });
              });
            }),
        },
      }),
    );
  }
  const mcpTools: Array<{
    serverName: string;
    serverSlug: string;
    qualifiedName: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> = Array.isArray(data.mcpTools) ? data.mcpTools : [];
  for (const mt of mcpTools) {
    if (!mt?.qualifiedName || customTools.some((t) => t.name === mt.qualifiedName)) continue;
    const rawSchema =
      mt.inputSchema && typeof mt.inputSchema === 'object' && !Array.isArray(mt.inputSchema)
        ? mt.inputSchema
        : { type: 'object', properties: {} };
    const safeSchema = {
      type: 'object',
      properties: {},
      ...rawSchema,
    };
    customTools.push({
      name: mt.qualifiedName,
      label: `[${mt.serverName}] ${mt.name}`,
      description: `[External MCP · ${mt.serverName}] ${mt.description || mt.name}`,
      parameters: safeSchema as any,
      execute: async (_id, args) => {
        const raw = await request('__mcp_call__', { qualifiedName: mt.qualifiedName, args: args || {} });
        if (raw && typeof raw === 'object' && Array.isArray((raw as any).__llmImages)) {
          const { __llmImages, ...clean } = raw as Record<string, unknown>;
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify(clean) },
              ...(__llmImages as Array<{ type: 'image'; data: string; mimeType: string }>),
            ],
            details: {},
          };
        }
        return result(raw);
      },
    });
  }
  const connectedMcpServers = Array.from(new Set(mcpTools.map((t) => t.serverName)));
  const mcpPromptNote = connectedMcpServers.length
    ? ` External MCP servers connected via MCP Client: ${connectedMcpServers.join(', ')} (tools prefixed with mcp__). When any external MCP tool exports local media or 3D files (.glb / PNG / MP4 / WAV), save them into the task workspace (${cwd}) so you can call import_asset to bring them cleanly into CoCraft.`
    : '';
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'unused-auth.json'),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const provider =
    'cocraft-' +
    createHash('sha256')
      .update((settings.protocol || settings.provider) + settings.baseUrl)
      .digest('hex')
      .slice(0, 16);
  const requestedThinking = ['off', 'low', 'medium', 'high'].includes(data.thinkingLevel)
    ? data.thinkingLevel
    : 'off';
  const supportsReasoning = modelSupportsReasoning(
    settings.model,
    settings.protocol || settings.provider,
    settings.baseUrl,
  );
  const effectiveThinking = supportsReasoning ? requestedThinking : 'off';
  const apiKind =
    settings.provider === 'anthropic'
      ? 'anthropic-messages'
      : settings.provider === 'google'
        ? 'google-generative-ai'
        : 'openai-completions';
  const compat =
    apiKind === 'openai-completions'
      ? buildOpenAICompat(settings.protocol || settings.provider, settings.baseUrl, supportsReasoning)
      : undefined;
  runtime.registerProvider(provider, {
    baseUrl: settings.baseUrl,
    api: apiKind,
    models: [
      {
        id: settings.model,
        name: settings.model,
        reasoning: supportsReasoning && effectiveThinking !== 'off',
        input: settings.modelInput,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: settings.contextWindow,
        maxTokens: settings.maxTokens,
        ...(compat ? { compat } : {}),
      } as any,
    ],
  });
  await runtime.setRuntimeApiKey(provider, settings.apiKey);
  const model = runtime.getModel(provider, settings.model);
  if (!model) throw new Error('未找到所选模型，请检查设置');
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 1 },
  });
  const activeSkillsNote =
    Array.isArray(data.activeSkills) && data.activeSkills.length > 0
      ? ` Active Skills requested for this task: ${data.activeSkills.join(', ')}. Read their SKILL.md files before executing creative or editing steps.`
      : '';
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalSkillPaths: [
      ...(projectSkillsReal ? [projectSkillsReal] : []),
      ...(userSkillsReal ? [userSkillsReal] : []),
      skillsReal,
    ],
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: [
      `You are CoCraft, a professional video editing and coding collaborator. Work in Chinese. Read the cocraft-editing Skill before editing. Read the latest project revision. Preserve locks and publish through publish_edit. Use list_presets and prepare_preset for editable motion (including spatial-stage for 2.5D layered parallax, 3D choreographed camera/actorAction/actorPath/environmentPreset previs, 3D hardware screens, and .glb/.spz worlds). When building a custom 3D TSX CodeComponent, expose editable camera/scene props (e.g. cameraYaw, cameraPitch, cameraDistance, cameraSpeed, lightingMood) in component.props so the user can direct and keyframe the shot. Call bake_spatial_video (accepting spatial-stage clipId/vaultItemId/assetId OR custom 3D TSX componentId) to record any choreographed 3D scene into a real MP4 video asset that can drive downstream AI video generation via generate_media, apply_keyframe_preset for smooth Ken Burns / fade / BGM auto-ducking, detach_audio for J/L cut audio separation, or develop a custom component in your staging workspace. Use list_models for available creative services. The dedicated media tools operate through the user's configured connections. Call inspect_media for a vision report and transcribe_asset for actual spoken words. Call pull_vault_item to adopt assets from the personal library, preflight_sequence to verify export readiness, and export_sequence when the user asks to render MP4. Only report completed tool results. ${settings.allowShell ? `Workspace shell is enabled. Script networking is ${settings.allowNetwork ? 'enabled' : 'disabled'}.` : 'The bash tool is unavailable. Use read, write, edit, compile_component, the media tools, and publish_edit to finish the request. Call only tools in the supplied tool list.'}${activeSkillsNote}${mcpPromptNote} Current task context: ${data.context}`,
    ],
  });
  await loader.reload();
  const manager = sessionPath
    ? SessionManager.open(sessionPath, sessionDir, cwd)
    : SessionManager.create(cwd, sessionDir);
  const created = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime: runtime,
    model: model as any,
    resourceLoader: loader,
    settingsManager,
    sessionManager: manager,
    customTools,
    tools: customTools.map((t) => t.name),
    thinkingLevel: effectiveThinking as any,
  });
  session = created.session;
  send({ type: 'session', path: manager.getSessionFile() });
  session.subscribe((event: any) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')
      send({ type: 'text', text: event.assistantMessageEvent.delta });
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta')
      send({ type: 'thinking', text: event.assistantMessageEvent.delta });
    if (event.type === 'tool_execution_start')
      send({ type: 'tool-start', tool: event.toolName, text: JSON.stringify(event.args).slice(0, 500) });
    if (event.type === 'tool_execution_end')
      send({ type: 'tool-end', tool: event.toolName, text: event.isError ? '工具执行失败' : '完成' });
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      if (event.message?.usage) {
        const u = event.message.usage;
        send({
          type: 'usage',
          usage: {
            input: u.input ?? u.prompt_tokens ?? 0,
            output: u.output ?? u.completion_tokens ?? 0,
            total: u.totalTokens ?? u.total_tokens ?? (u.input || 0) + (u.output || 0),
          },
        });
      }
      if (event.message?.errorMessage) send({ type: 'error', text: event.message.errorMessage });
    }
  });
  const response = session.prompt(
    prompt,
    Array.isArray(data.images) && data.images.length ? { images: data.images } : undefined,
  );
  for (const item of earlySteers.splice(0)) {
    if (item.extraReadPaths?.length) {
      const extra = await resolveValidPaths(item.extraReadPaths);
      activeReadRoots = Array.from(new Set([...activeReadRoots, ...extra]));
    }
    await session.steer(item.text, item.images?.length ? item.images : undefined);
  }
  await response;
  // Drain any steer messages that arrived right as the previous turn ended (prevents silent drops).
  while (earlySteers.length > 0 && !stopped) {
    const next = earlySteers.shift()!;
    if (next.extraReadPaths?.length) {
      const extra = await resolveValidPaths(next.extraReadPaths);
      activeReadRoots = Array.from(new Set([...activeReadRoots, ...extra]));
    }
    await session.prompt(next.text, next.images?.length ? { images: next.images } : undefined);
  }
  send({ type: 'done' });
  session.dispose();
  session = undefined;
}
port.on('message', async ({ data }: any) => {
  if (data.type === 'response') {
    const p = pending.get(data.id);
    if (p) {
      pending.delete(data.id);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
    }
    return;
  }
  if (data.type === 'stop') {
    stopped = true;
    for (const call of pending.values()) call.reject(new Error('运行已停止'));
    pending.clear();
    await session?.abort();
    session?.dispose();
    session = undefined;
    send({ type: 'done' });
    return;
  }
  if (data.type === 'steer') {
    if (!stopped) {
      if (Array.isArray(data.extraReadPaths) && data.extraReadPaths.length) {
        const extra = await resolveValidPaths(data.extraReadPaths);
        activeReadRoots = Array.from(new Set([...activeReadRoots, ...extra]));
      }
      const imgs = Array.isArray(data.images) && data.images.length ? data.images : undefined;
      if (session?.isStreaming) await session.steer(data.text, imgs);
      else earlySteers.push({ text: data.text, images: imgs, extraReadPaths: data.extraReadPaths });
    }
    return;
  }
  if (data.type === 'start')
    try {
      await start(data);
    } catch (e) {
      send({ type: 'error', text: e instanceof Error ? e.message : String(e) });
      send({ type: 'done' });
    }
});
