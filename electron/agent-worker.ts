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
import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent';
const port = (process as any).parentPort;
let session: AgentSession | undefined;
let stopped = false;
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
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cwd, '.tmp'), { recursive: true });
  const writeRoots = [await realpath(cwd)],
    readRoots = [
      ...writeRoots,
      await realpath(skillsPath),
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
    {
      name: 'preview_frame',
      label: '检查预览帧',
      description:
        'Render a still of a published sequence at an integer frame. Returns image data for visual inspection.',
      parameters: Type.Object({ sequenceId: Type.String(), frame: Type.Number() }) as any,
      execute: async (_id, args) => {
        const response = await request('preview_frame', args);
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
              const profile = `(version 1)(allow default)(deny file-write*)(deny file-read* (subpath ${quote(homedir())}))(allow file-read* ${[cwd, data.appRoot, skillsPath, data.mediaToolsPath, ...assetPaths].map((s: string) => `(subpath ${quote(s)})`).join(' ')})(allow file-write* (subpath ${quote(cwd)}) (literal "/dev/null"))${settings.allowNetwork ? '' : '(deny network*)'}`;
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
  const provider = settings.provider;
  if (settings.baseUrl || !runtime.getModel(provider, settings.model)) {
    const baseUrl =
      settings.baseUrl ||
      (provider === 'deepseek'
        ? 'https://api.deepseek.com/v1'
        : provider === 'anthropic'
          ? 'https://api.anthropic.com'
          : 'https://api.openai.com/v1');
    runtime.registerProvider(provider, {
      baseUrl,
      api: provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      apiKey: settings.apiKey,
      models: [
        {
          id: settings.model,
          name: settings.model,
          reasoning: false,
          input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16000,
        },
      ],
    } as any);
  } else await runtime.setRuntimeApiKey(provider, settings.apiKey);
  const model = runtime.getModel(provider, settings.model);
  if (!model) throw new Error('未找到所选模型，请检查设置');
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 1 },
  });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalSkillPaths: [skillsPath, join(cwd, 'skills')],
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: [
      `You are CoCraft, a professional video editing and coding collaborator. The user remains in control. Read the cocraft-editing Skill before editing. Your cwd is a staging workspace. Read and write tools are scoped to this workspace and explicitly shared assets. Publish through publish_edit only. Locked clips are immutable. Read the latest project revision before every edit. Use Chinese. ${settings.allowShell ? `The bash tool is enabled with filesystem writes limited to the workspace. Network access is ${settings.allowNetwork ? 'enabled by the user' : 'disabled'}.` : 'Shell execution is disabled; file editing, compilation, media inspection, and publishing are available.'} Current task context: ${data.context}`,
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
    thinkingLevel: 'low',
  });
  session = created.session;
  send({ type: 'session', path: manager.getSessionFile() });
  session.subscribe((event: any) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')
      send({ type: 'text', text: event.assistantMessageEvent.delta });
    if (event.type === 'tool_execution_start')
      send({ type: 'tool-start', tool: event.toolName, text: JSON.stringify(event.args).slice(0, 500) });
    if (event.type === 'tool_execution_end')
      send({ type: 'tool-end', tool: event.toolName, text: event.isError ? '工具执行失败' : '完成' });
    if (event.type === 'message_end' && event.message?.role === 'assistant' && event.message?.errorMessage)
      send({ type: 'error', text: event.message.errorMessage });
  });
  await session.prompt(prompt);
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
    await session?.abort();
    session?.dispose();
    send({ type: 'done' });
    return;
  }
  if (data.type === 'steer') {
    await session?.steer(data.text);
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
