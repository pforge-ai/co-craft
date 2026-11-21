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
import { readFile, writeFile, mkdir, realpath, access } from 'node:fs/promises';
import { resolve, dirname, join, extname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent';
const port = (process as any).parentPort;
let session: AgentSession | undefined;
let stopped = false;
const earlySteers: string[] = [];
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
async function guard(file: string, roots: string[], write = false) {
  let path = resolve(file),
    probe = path;
  while (true) {
    try {
      const real = await realpath(probe);
      const resolved = real + path.slice(probe.length);
      if (!roots.some((root) => resolved === root || resolved.startsWith(root + '/')))
        throw new Error('路径超出任务工作区');
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || !write) throw e;
      const parent = dirname(probe);
      if (parent === probe) throw e;
      probe = parent;
    }
  }
}
async function start(data: any) {
  const { cwd, agentDir, skillsPath, settings, sessionPath, sessionDir, prompt, assetPaths } = data;
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
  const writeRoots = [await realpath(cwd)],
    readRoots = [
      ...writeRoots,
      await realpath(skillsPath),
      ...(userSkillsReal ? [userSkillsReal] : []),
      ...(await Promise.all((assetPaths || []).map((p: string) => realpath(p).catch(() => p)))),
    ];
  const read = async (p: string) => readFile(await guard(p, readRoots));
  const write = async (p: string, content: string) => {
    if (stopped) throw new Error('运行已停止');
    await writeFile(await guard(p, writeRoots, true), content, 'utf8');
  };
  const customTools: ToolDefinition<any, any, any>[] = [
    createReadToolDefinition(cwd, {
      operations: {
        readFile: read,
        access: async (p) => {
          await access(await guard(p, readRoots));
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
      'Generate an image, video or speech using the selected media model. Waits for the provider and returns a staged asset. To adopt, publish addAsset with its ID and addClip in one group. A remote job can be billable. Use a project image ID as optional reference.',
      Type.Object({
        use: Type.Union([Type.Literal('image'), Type.Literal('video'), Type.Literal('speech')]),
        prompt: Type.String(),
        modelId: optionalText,
        referenceAssetId: optionalText,
        size: optionalText,
        seconds: Type.Optional(Type.Integer({ minimum: 1 })),
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
  ];
  if (settings.allowShell) {
    customTools.push(
      createBashToolDefinition(cwd, {
        exposeSessionEnvironment: false,
        operations: {
          exec: (command, _cwd, options) =>
            new Promise((resolvePromise, reject) => {
              const quote = (s: string) => JSON.stringify(s);
              const profile = `(version 1)(allow default)(deny file-write*)(deny file-read* (subpath ${quote(homedir())}) (subpath "/Users") (subpath "/Volumes") (subpath "/private/etc/ssh"))(allow file-read* ${[cwd, data.appRoot, skillsPath, data.mediaToolsPath, ...assetPaths].map((s: string) => `(subpath ${quote(s)})`).join(' ')})(allow file-write* (subpath ${quote(cwd)}) (literal "/dev/null"))${settings.allowNetwork ? '' : '(deny network*)'}`;
              const proc = spawn(
                '/usr/bin/sandbox-exec',
                [
                  '-p',
                  profile,
                  '/bin/bash',
                  '--noprofile',
                  '--norc',
                  '-c',
                  `export DYLD_LIBRARY_PATH='${String(data.mediaToolsPath).replace(/'/g, "'\\''")}'\n${command}`,
                ],
                {
                  cwd,
                  env: {
                    PATH:
                      data.mediaToolsPath + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
                    LANG: 'en_US.UTF-8',
                    TMPDIR: join(cwd, '.tmp'),
                    npm_config_cache: join(cwd, '.npm-cache'),
                  },
                  stdio: ['ignore', 'pipe', 'pipe'],
                  detached: true,
                },
              );
              proc.stdout.on('data', options.onData);
              proc.stderr.on('data', options.onData);
              const kill = () => {
                try {
                  process.kill(-proc.pid!, 'SIGTERM');
                } catch {}
              };
              options.signal?.addEventListener('abort', kill, { once: true });
              const timeout = setTimeout(kill, Math.min(options.timeout || 60, 180) * 1000);
              proc.on('error', reject);
              proc.on('close', (code) => {
                clearTimeout(timeout);
                options.signal?.removeEventListener('abort', kill);
                resolvePromise({ exitCode: code });
              });
            }),
        },
      }),
    );
  }
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'unused-auth.json'),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const provider =
    'cocraft-' +
    createHash('sha256')
      .update(settings.provider + settings.baseUrl)
      .digest('hex')
      .slice(0, 16);
  const thinkingLevel = ['off', 'low', 'medium', 'high'].includes(data.thinkingLevel)
    ? data.thinkingLevel
    : 'low';
  runtime.registerProvider(provider, {
    baseUrl: settings.baseUrl,
    api:
      settings.provider === 'anthropic'
        ? 'anthropic-messages'
        : settings.provider === 'google'
          ? 'google-generative-ai'
          : 'openai-completions',
    models: [
      {
        id: settings.model,
        name: settings.model,
        reasoning: thinkingLevel !== 'off',
        input: settings.modelInput,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: settings.contextWindow,
        maxTokens: settings.maxTokens,
      },
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
      join(cwd, 'skills'),
      ...(userSkillsReal ? [userSkillsReal] : []),
      skillsPath,
    ],
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: [
      `You are CoCraft, a professional video editing and coding collaborator. Work in Chinese. Read the cocraft-editing Skill before editing. Read the latest project revision. Preserve locks and publish through publish_edit. Use list_presets and prepare_preset for editable motion, or develop a custom component in your staging workspace. Use list_models for available creative services. The dedicated media tools operate through the user's configured connections. Call inspect_media for a vision report and transcribe_asset for actual spoken words. Only report completed tool results. ${settings.allowShell ? `Workspace shell is enabled. Script networking is ${settings.allowNetwork ? 'enabled' : 'disabled'}.` : 'The bash tool is unavailable. Use read, write, edit, compile_component, the media tools, and publish_edit to finish the request. Call only tools in the supplied tool list.'}${activeSkillsNote} Current task context: ${data.context}`,
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
    thinkingLevel: thinkingLevel as any,
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
  for (const message of earlySteers.splice(0)) await session.steer(message);
  await response;
  send({ type: 'done' });
  session.dispose();
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
    send({ type: 'done' });
    return;
  }
  if (data.type === 'steer') {
    if (!stopped) {
      if (session) await session.steer(data.text);
      else earlySteers.push(data.text);
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
