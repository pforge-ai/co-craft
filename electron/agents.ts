import { nativeImage, utilityProcess } from 'electron';
import { mkdir, readFile, writeFile, cp, realpath, lstat, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { ProjectStore, atomicJSON } from './store';
import { binary } from './media';
import { uid } from '../src/core/project';
import type {
  Task,
  Settings,
  AgentEvent,
  ProjectEnvelope,
  Asset,
  CodeComponent,
  EditScope,
  ComposerAttachment,
  ThinkingLevelChoice,
} from '../src/core/types';
import type { JobService } from './jobs';
import type { GenerationService } from './generation';
import { chatEndpoint } from './generation';
import type { GlobalVault } from './vault';
import { CoCraftToolService, type ToolExecutionContext } from './tool-service';
import type { McpClientManager } from './mcp-client';
interface Run {
  id: string;
  task: Task;
  store: ProjectStore;
  process: Electron.UtilityProcess;
  active: boolean;
  workspace: string;
  text: string;
  thinking: string;
  finished: boolean;
  assets: Map<string, Asset>;
  jobs: Set<string>;
  abort: AbortController;
  supportsImages: boolean;
  packEntries: Map<string, CodeComponent>;
  components: Map<string, CodeComponent>;
  componentAssets: Map<string, Asset[]>;
  scope?: EditScope;
  closing?: Promise<void>;
}
type AgentSettings = Settings & {
  protocol?: string;
  modelInput?: string[];
  modelParameters?: Record<string, unknown>;
};
function encodeImageAttachments(attachments: ComposerAttachment[], supportsImages: boolean) {
  const images: { type: 'image'; data: string; mimeType: string }[] = [];
  if (!supportsImages) return images;
  for (const att of attachments) {
    if (att.kind !== 'image') continue;
    try {
      const img = nativeImage.createFromPath(att.path);
      if (!img.isEmpty()) {
        const sz = img.getSize();
        const scaled =
          Math.max(sz.width, sz.height) > 1568
            ? img.resize(sz.width >= sz.height ? { width: 1568 } : { height: 1568 })
            : img;
        images.push({
          type: 'image',
          data: scaled.toJPEG(85).toString('base64'),
          mimeType: 'image/jpeg',
        });
      }
    } catch {}
  }
  return images;
}
type SettingsSource = AgentSettings | (() => Promise<AgentSettings>);
type AgentStartOptions = {
  thinkingLevel?: ThinkingLevelChoice;
  attachments?: ComposerAttachment[];
  skillIds?: string[];
};
export class AgentHost {
  private runs = new Map<string, Run>();
  private launching = new Map<string, { abort: AbortController; ready: Promise<{ runId: string }> }>();
  private fallbackTools?: CoCraftToolService;
  constructor(
    private workerPath: string,
    private skillsPath: string,
    private appRoot: string,
    private jobs: JobService,
    private emit: (e: AgentEvent) => void,
    private changed: (store: ProjectStore, envelope: ProjectEnvelope) => void,
    private generation?: GenerationService,
    private studioMedia: Asset[] = [],
    private _globalVault?: GlobalVault,
    private userSkillsPath?: string,
    private toolService?: CoCraftToolService,
    private mcpClient?: McpClientManager,
  ) {}

  private resolveTools(store: ProjectStore): CoCraftToolService {
    if (this.toolService) return this.toolService;
    if (!this.fallbackTools) {
      this.fallbackTools = new CoCraftToolService({
        getStore: () => store,
        jobs: this.jobs,
        generation: this.generation,
        globalVault: this._globalVault,
        getStudioMedia: () => this.studioMedia,
        changed: (s, env) => this.changed(s, env),
      });
    }
    return this.fallbackTools;
  }
  async start(
    store: ProjectStore,
    taskId: string,
    prompt: string,
    settings: SettingsSource,
    context: string,
    scope?: EditScope,
    options?: AgentStartOptions,
  ): Promise<{ queued: true } | { runId: string }> {
    const existing = this.runs.get(taskId);
    if (existing?.active && !existing.finished) {
      // Flush any streamed assistant text before appending the user's mid-run steer so history stays strictly chronological.
      if (existing.text.trim() || existing.thinking.trim()) {
        existing.task.messages.push({
          id: uid('msg'),
          role: 'assistant',
          text: existing.text,
          ...(existing.thinking ? { thinking: existing.thinking } : {}),
          createdAt: new Date().toISOString(),
        });
        existing.text = '';
        existing.thinking = '';
        this.emit({ taskId, runId: existing.id, type: 'text-commit' });
      }
      if (scope) existing.scope = scope;
      const steerAtts = options?.attachments || [];
      const steerImages = encodeImageAttachments(steerAtts, existing.supportsImages);
      const steerAttNote = steerAtts.length
        ? `\n[附带文件: ${steerAtts.map((a) => `${a.name} (${a.path})`).join(', ')}]`
        : '';
      existing.process.postMessage({
        type: 'steer',
        text: prompt + steerAttNote,
        images: steerImages,
        extraReadPaths: steerAtts.map((a) => a.path).filter(Boolean),
      });
      existing.task.messages.push({
        id: uid('msg'),
        role: 'user',
        text: prompt,
        ...(steerAtts.length
          ? {
              attachments: steerAtts.map(({ id, name, kind, previewDataUrl }) => ({
                id,
                name,
                kind,
                previewDataUrl,
              })),
            }
          : {}),
        ...(options?.skillIds?.length ? { skillIds: options.skillIds } : {}),
        createdAt: new Date().toISOString(),
      });
      await store.saveTask(existing.task);
      this.changed(store, await store.envelope());
      return { queued: true };
    }
    const pending = this.launching.get(taskId);
    if (pending) {
      await pending.ready;
      return this.start(store, taskId, prompt, settings, context, scope, options);
    }
    const abort = new AbortController();
    const ready = this.launch(store, taskId, prompt, settings, context, abort, scope, options);
    this.launching.set(taskId, { abort, ready });
    try {
      return await ready;
    } finally {
      if (this.launching.get(taskId)?.ready === ready) this.launching.delete(taskId);
    }
  }
  private async launch(
    store: ProjectStore,
    taskId: string,
    prompt: string,
    source: SettingsSource,
    context: string,
    abort: AbortController,
    scope?: EditScope,
    options?: AgentStartOptions,
  ) {
    const previous = this.runs.get(taskId);
    if (previous) await this.finish(previous);
    const settings = typeof source === 'function' ? await source() : source;
    if (!settings.apiKey || !settings.model) throw new Error('先在设置中连接模型，即可让 Agent 开始工作。');
    const connection = chatEndpoint(settings.protocol || settings.provider, settings.baseUrl, settings.model);
    abort.signal.throwIfAborted();
    const task = (await store.tasks()).find((t) => t.id === taskId);
    if (!task) throw new Error('任务不存在');
    const project = await store.project(),
      id = uid('run');
    const workspacePath = join(store.path, '.cocraft', 'workspaces', taskId);
    await mkdir(workspacePath, { recursive: true });
    const workspace = await realpath(workspacePath);
    await mkdir(join(workspace, 'components'), { recursive: true });
    await atomicJSON(join(workspace, 'project.json'), project);
    await writeFile(join(workspace, 'brief.md'), project.brief, 'utf8');
    // Project skills are passed read-only outside writable workspace (prevents tampering & stale copies).
    const projectSkillsPath = join(store.path, 'skills');
    await mkdir(projectSkillsPath, { recursive: true });
    await rm(join(workspace, 'skills'), { recursive: true, force: true }).catch(() => {});
    const agentRuntimeDir = join(store.path, '.cocraft', 'agent-runtime', taskId);
    await mkdir(agentRuntimeDir, { recursive: true });
    const packEntries = new Map<string, CodeComponent>();
    const copiedPacks = new Set<string>();
    for (const c of project.components) {
      if (c.pack?.entry) {
        const packsRoot = await realpath(join(store.path, 'components', 'packs'));
        const packDir = await realpath(c.pack.sourceDirectory);
        if (dirname(packDir) !== packsRoot || basename(c.pack.entry) !== c.pack.entry)
          throw new Error('素材包源码目录无效');
        const original = await readFile(join(packDir, c.pack.entry), 'utf8');
        const variant =
          c.source === original ? '' : '-' + createHash('sha256').update(c.source).digest('hex').slice(0, 16);
        const copy = join(workspace, 'components', 'packs', basename(packDir) + variant);
        if (!copiedPacks.has(copy)) {
          await cp(packDir, copy, {
            recursive: true,
            force: false,
            errorOnExist: false,
            filter: async (path) =>
              path === packDir ||
              (!basename(path).startsWith('.') &&
                basename(path) !== 'node_modules' &&
                !(await lstat(path)).isSymbolicLink()),
          });
          copiedPacks.add(copy);
        }
        const entry = join(copy, c.pack.entry);
        // The saved source includes entry changes made in the properties editor.
        if (c.source !== original && (await readFile(entry, 'utf8')) === original)
          await writeFile(entry, c.source);
        packEntries.set(entry, c);
        continue;
      }
      await writeFile(
        join(workspace, 'components', c.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.tsx'),
        c.source,
        'utf8',
      );
    }
    const sessionDir = join(store.path, '.cocraft', 'sessions', taskId);
    await mkdir(sessionDir, { recursive: true });
    abort.signal.throwIfAborted();
    const env = Object.fromEntries(
      ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', '__CF_USER_TEXT_ENCODING'].flatMap(
        (key) => (process.env[key] ? [[key, process.env[key]!]] : []),
      ),
    );
    const worker = utilityProcess.fork(this.workerPath, [], {
      env,
      stdio: 'pipe',
      serviceName: 'CoCraft Agent',
    });
    const run: Run = {
      id,
      task,
      store,
      process: worker,
      active: true,
      workspace,
      text: '',
      thinking: '',
      finished: false,
      assets: new Map(),
      jobs: new Set(),
      abort,
      packEntries,
      components: new Map(),
      componentAssets: new Map(),
      scope,
      supportsImages: settings.modelInput?.includes('image') ?? false,
    };
    const attachments = options?.attachments || [];
    const activeSkills = Array.from(new Set([...(project.activeSkillIds || []), ...(options?.skillIds || [])]));
    const images = encodeImageAttachments(attachments, run.supportsImages);
    let enrichedContext = context;
    if (attachments.length || activeSkills.length) {
      try {
        const parsed = context ? JSON.parse(context) : {};
        if (attachments.length) {
          parsed.attachments = attachments.map((a) => ({ name: a.name, kind: a.kind, path: a.path }));
        }
        if (activeSkills.length) parsed.activeSkills = activeSkills;
        enrichedContext = JSON.stringify(parsed);
      } catch {
        enrichedContext = `${context}\n${attachments.length ? `Attachments: ${attachments.map((a) => `${a.name} (${a.path})`).join(', ')}` : ''}`;
      }
    }
    try {
      this.runs.set(taskId, run);
      task.status = 'running';
      task.messages.push({
        id: uid('msg'),
        role: 'user',
        text: prompt,
        ...(attachments.length
          ? {
              attachments: attachments.map(({ id: attId, name, kind, previewDataUrl }) => ({
                id: attId,
                name,
                kind,
                previewDataUrl,
              })),
            }
          : {}),
        ...(options?.skillIds?.length ? { skillIds: options.skillIds } : {}),
        createdAt: new Date().toISOString(),
      });
      await store.saveTask(task);
      abort.signal.throwIfAborted();
      this.changed(store, await store.envelope());
      let stderr = '';
      worker.stderr?.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
      worker.on('message', async (data: any) => {
        if (data.type === 'request') {
          try {
            if (!run.active) throw new Error('运行已停止');
            const result = await this.request(run, data.method, data.payload);
            if (run.active) worker.postMessage({ type: 'response', id: data.id, result });
          } catch (e) {
            if (run.active)
              worker.postMessage({
                type: 'response',
                id: data.id,
                error: e instanceof Error ? e.message : String(e),
              });
          }
          return;
        }
        if (!run.active) return;
        if (data.type === 'session') {
          task.sessionPath = data.path;
          await store.saveTask(task);
          return;
        }
        if (run.finished) return;
        if (data.type === 'usage' && data.usage) {
          const prev = task.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
          task.usage = {
            inputTokens: prev.inputTokens + (Number(data.usage.input) || 0),
            outputTokens: prev.outputTokens + (Number(data.usage.output) || 0),
            totalTokens: prev.totalTokens + (Number(data.usage.total) || 0),
            requests: prev.requests + 1,
          };
          return;
        }
        if (data.type === 'text') run.text += data.text;
        if (data.type === 'thinking') run.thinking += data.text || '';
        if (data.type === 'tool-start' || data.type === 'tool-end')
          task.messages.push({
            id: uid('msg'),
            role: 'tool',
            tool: data.tool,
            text: data.text || (data.type === 'tool-start' ? '' : '完成'),
            status: data.type,
            createdAt: new Date().toISOString(),
          });
        if (data.type === 'error') {
          task.status = 'error';
          task.messages.push({
            id: uid('msg'),
            role: 'system',
            text: data.text,
            createdAt: new Date().toISOString(),
          });
        }
        if (['text', 'thinking', 'tool-start', 'tool-end', 'error'].includes(data.type))
          this.emit({ taskId, runId: id, ...data });
        if (data.type === 'done') await this.finish(run);
      });
      worker.on('exit', async (code) => {
        if (!run.finished) {
          if (run.active && code !== 0) {
            task.status = 'error';
            task.messages.push({
              id: uid('msg'),
              role: 'system',
              text: stderr.replaceAll(settings.apiKey!, '[密钥已隐藏]') || `Agent 进程退出 (${code})`,
              createdAt: new Date().toISOString(),
            });
          }
          await this.finish(run);
        }
      });
      abort.signal.throwIfAborted();
      const mcpDiscovery = this.mcpClient
        ? await this.mcpClient.listEnabledTools().catch(() => ({ tools: [], statuses: [] }))
        : { tools: [], statuses: [] };
      abort.signal.throwIfAborted();
      worker.postMessage({
        type: 'start',
        cwd: workspace,
        agentDir: agentRuntimeDir,
        skillsPath: this.skillsPath,
        projectSkillsPath,
        userSkillsPath: this.userSkillsPath,
        activeSkills,
        thinkingLevel: options?.thinkingLevel || 'off',
        images,
        mcpTools: mcpDiscovery.tools,
        settings: {
          provider: settings.provider,
          protocol: settings.protocol || settings.provider,
          model: connection.modelId,
          baseUrl: connection.baseUrl,
          apiKey: settings.apiKey,
          modelInput: run.supportsImages ? ['text', 'image'] : ['text'],
          maxTokens: Number(settings.modelParameters?.maxTokens) || 16000,
          contextWindow: Number(settings.modelParameters?.contextWindow) || 128000,
          allowShell: settings.allowShell,
          allowNetwork: settings.allowNetwork,
        },
        sessionPath: task.sessionPath,
        sessionDir,
        prompt,
        context: enrichedContext,
        appRoot: this.appRoot,
        mediaToolsPath: dirname(binary('ffmpeg')),
        assetPaths: [...project.assets.map((a) => a.path), ...attachments.map((a) => a.path)].filter(
          (p): p is string => typeof p === 'string' && p.length > 0,
        ),
      });
      return { runId: id };
    } catch (err) {
      run.active = false;
      run.finished = true;
      worker.kill();
      if (this.runs.get(taskId) === run) this.runs.delete(taskId);
      if (task.status === 'running') {
        task.status = 'idle';
        await store.saveTask(task).catch(() => {});
        this.changed(store, await store.envelope().catch(() => null as any));
      }
      throw err;
    }
  }
  private finish(run: Run) {
    if (run.closing) return run.closing;
    run.finished = true;
    run.active = false;
    run.abort.abort(new Error('运行已结束'));
    run.closing = this.closeRun(run);
    return run.closing;
  }
  private async closeRun(run: Run) {
    await Promise.all([...run.jobs].map((id) => this.jobs.cancel(id)));
    if (run.text || run.thinking)
      run.task.messages.push({
        id: uid('msg'),
        role: 'assistant',
        text: run.text,
        ...(run.thinking ? { thinking: run.thinking } : {}),
        createdAt: new Date().toISOString(),
      });
    if (run.task.status === 'running') run.task.status = 'idle';
    await run.store.saveTask(run.task);
    this.emit({ taskId: run.task.id, runId: run.id, type: 'done' });
    this.changed(run.store, await run.store.envelope());
    run.process.kill();
    if (this.runs.get(run.task.id) === run) this.runs.delete(run.task.id);
  }
  async stop(taskId: string) {
    const run = this.runs.get(taskId);
    if (!run) {
      this.launching.get(taskId)?.abort.abort(new Error('运行已停止'));
      return { stopped: true };
    }
    if (!run.active) {
      this.launching.get(taskId)?.abort.abort(new Error('运行已停止'));
      await this.finish(run);
      return { stopped: true };
    }
    // Revoke publication before aborting remote work or the model process.
    run.active = false;
    run.abort.abort(new Error('运行已停止'));
    run.process.postMessage({ type: 'stop' });
    run.task.messages.push({
      id: uid('msg'),
      role: 'system',
      text: '已停止。已发布的修改保留，未发布的工作留在任务目录。',
      createdAt: new Date().toISOString(),
    });
    await this.finish(run);
    return { stopped: true };
  }
  async stopAll() {
    for (const pending of this.launching.values()) {
      pending.abort.abort(new Error('应用退出'));
    }
    const ids = [...this.runs.keys()];
    await Promise.allSettled(ids.map((id) => this.stop(id)));
  }
  private async request(run: Run, method: string, args: any): Promise<unknown> {
    if (method === '__mcp_call__') {
      if (!this.mcpClient) throw new Error('外部 MCP 客户端服务未启用');
      const qualifiedName = String(args?.qualifiedName || '');
      const toolArgs = args?.args && typeof args.args === 'object' ? args.args : {};
      return this.mcpClient.callTool(qualifiedName, toolArgs, run.abort.signal);
    }
    const ctx: ToolExecutionContext = {
      source: 'agent',
      store: run.store,
      defaultSequenceId: run.task.sequenceId,
      scope: run.scope,
      runId: run.id,
      abortSignal: run.abort.signal,
      isActive: () => run.active,
      stagedAssets: run.assets,
      stagedComponents: run.components,
      stagedComponentAssets: run.componentAssets,
      packEntries: run.packEntries,
      workspace: run.workspace,
      supportsImages: run.supportsImages,
      publishGeneratedAssets: false,
      trackJob: (jobId) => {
        run.jobs.add(jobId);
      },
      untrackJob: (jobId) => {
        run.jobs.delete(jobId);
      },
    };
    return this.resolveTools(run.store).execute(method, args || {}, ctx);
  }
}
