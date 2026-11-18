import { utilityProcess } from 'electron';
import { mkdir, readFile, writeFile, cp, realpath, lstat } from 'node:fs/promises';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { ProjectStore, atomicJSON } from './store';
import { compileComponent } from './code';
import { binary, importMedia } from './media';
import { uid, applyOperations } from '../src/core/project';
import type { Task, Settings, AgentEvent, ProjectEnvelope, Asset, CodeComponent } from '../src/core/types';
import type { JobService } from './jobs';
import type { GenerationService, GenerationRequest } from './generation';
import { chatEndpoint, collectGeneratedFile } from './generation';
import { importMaterialPack } from './packs';
import { stageStudioAsset } from './studio-media';
import { presetCatalog, createPresetClip } from '../src/core/presets';
interface Run {
  id: string;
  task: Task;
  store: ProjectStore;
  process: Electron.UtilityProcess;
  active: boolean;
  workspace: string;
  text: string;
  finished: boolean;
  assets: Map<string, Asset>;
  jobs: Set<string>;
  abort: AbortController;
  supportsImages: boolean;
  packEntries: Map<string, CodeComponent>;
  components: Map<string, CodeComponent>;
  componentAssets: Map<string, Asset[]>;
  closing?: Promise<void>;
}
type AgentSettings = Settings & { modelInput?: string[]; modelParameters?: Record<string, unknown> };
type SettingsSource = AgentSettings | (() => Promise<AgentSettings>);
export class AgentHost {
  private runs = new Map<string, Run>();
  private launching = new Map<string, { abort: AbortController; ready: Promise<{ runId: string }> }>();
  constructor(
    private workerPath: string,
    private skillsPath: string,
    private appRoot: string,
    private jobs: JobService,
    private emit: (e: AgentEvent) => void,
    private changed: (store: ProjectStore, envelope: ProjectEnvelope) => void,
    private generation?: GenerationService,
    private studioMedia: Asset[] = [],
  ) {}
  async start(
    store: ProjectStore,
    taskId: string,
    prompt: string,
    settings: SettingsSource,
    context: string,
  ): Promise<{ queued: true } | { runId: string }> {
    const existing = this.runs.get(taskId);
    if (existing?.active) {
      existing.process.postMessage({ type: 'steer', text: prompt });
      existing.task.messages.push({
        id: uid('msg'),
        role: 'user',
        text: prompt,
        createdAt: new Date().toISOString(),
      });
      await store.saveTask(existing.task);
      return { queued: true };
    }
    const pending = this.launching.get(taskId);
    if (pending) {
      await pending.ready;
      return this.start(store, taskId, prompt, settings, context);
    }
    const abort = new AbortController();
    const ready = this.launch(store, taskId, prompt, settings, context, abort);
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
  ) {
    const previous = this.runs.get(taskId);
    if (previous) await this.finish(previous);
    const settings = typeof source === 'function' ? await source() : source;
    if (!settings.apiKey || !settings.model) throw new Error('先在设置中连接模型，即可让 Agent 开始工作。');
    const connection = chatEndpoint(settings.provider, settings.baseUrl, settings.model);
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
    await cp(join(store.path, 'skills'), join(workspace, 'skills'), { recursive: true });
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
      finished: false,
      assets: new Map(),
      jobs: new Set(),
      abort,
      packEntries,
      components: new Map(),
      componentAssets: new Map(),
      supportsImages: settings.modelInput?.includes('image') ?? false,
    };
    this.runs.set(taskId, run);
    task.status = 'running';
    task.messages.push({ id: uid('msg'), role: 'user', text: prompt, createdAt: new Date().toISOString() });
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
      if (data.type === 'text') run.text += data.text;
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
      if (['text', 'tool-start', 'tool-end', 'error'].includes(data.type))
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
    worker.postMessage({
      type: 'start',
      cwd: workspace,
      agentDir: join(workspace, '.pi-runtime'),
      skillsPath: this.skillsPath,
      settings: {
        provider: settings.provider,
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
      context,
      appRoot: this.appRoot,
      mediaToolsPath: dirname(binary('ffmpeg')),
      assetPaths: project.assets.map((a) => a.path),
    });
    return { runId: id };
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
    if (run.text)
      run.task.messages.push({
        id: uid('msg'),
        role: 'assistant',
        text: run.text,
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
  private async request(run: Run, method: string, args: any): Promise<unknown> {
    if (method === 'read_project') {
      const project = await run.store.project();
      const paths = new Map([...run.packEntries].map(([entry, c]) => [c.id, relative(run.workspace, entry)]));
      return {
        ...project,
        components: project.components.map((c) => ({
          ...c,
          workspaceEntry: paths.get(c.id) || `components/${c.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.tsx`,
        })),
      };
    }
    if (method === 'list_presets')
      return presetCatalog.filter((p) => !args.category || p.category === args.category);
    if (method === 'list_studio_media') {
      return this.studioMedia
        .filter((a) => !args.kind || a.kind === args.kind)
        .map(({ id, name, kind, duration, width, height, source }) => ({
          id,
          name,
          kind,
          duration,
          width,
          height,
          source,
        }));
    }
    if (method === 'prepare_studio_media') {
      const source = this.studioMedia.find((a) => a.id === args.id);
      if (!source) throw new Error('随附素材不存在');
      const asset = await stageStudioAsset(run.store.path, source);
      run.abort.signal.throwIfAborted();
      run.assets.set(asset.id, asset);
      return { asset };
    }
    if (method === 'prepare_preset') {
      const project = await run.store.project();
      const sequence = project.sequences.find((s) => s.id === (args.sequenceId || run.task.sequenceId));
      if (!sequence) throw new Error('成片不存在');
      const clip = createPresetClip(args.presetId, args.start || 0, sequence.fps, args.props);
      if (args.duration !== undefined) {
        if (!Number.isInteger(args.duration) || args.duration < 1) throw new Error('时长需要是正整数帧');
        clip.duration = args.duration;
      }
      return { clip, operation: { type: 'addClip', sequenceId: sequence.id, clip } };
    }
    if (method === 'list_models') {
      if (!this.generation) throw new Error('素材模型服务尚未启动');
      return this.generation.availableModels(run.store);
    }
    if (['generate_media', 'transcribe_asset', 'inspect_media'].includes(method)) {
      const use =
        method === 'transcribe_asset' ? 'transcription' : method === 'inspect_media' ? 'vision' : args.use;
      if (method === 'generate_media' && !['image', 'video', 'speech'].includes(use))
        throw new Error('生成素材仅支持图像、视频或配音');
      return this.generate(run, { ...args, use });
    }
    if (method === 'publish_edit') {
      const before = await run.store.project();
      const required = new Map<string, Asset>();
      for (const op of args.operations) {
        if (op.type === 'addAsset') {
          const asset = run.assets.get(op.asset?.id);
          if (!asset)
            throw new Error('请先使用 import_asset、generate_media 或 prepare_studio_media 登记素材');
          op.asset = asset;
        }
        if (op.type === 'putComponent') {
          const compiled = run.components.get(op.component?.id);
          if (compiled) {
            op.component = compiled;
            for (const asset of run.componentAssets.get(compiled.id) || []) required.set(asset.id, asset);
          } else if (op.component?.pack) throw new Error('请先从任务工作区编译素材包组件');
        }
      }
      for (const id of before.assets.map((a) => a.id)) required.delete(id);
      for (const op of args.operations) if (op.type === 'addAsset') required.delete(op.asset.id);
      args.operations.unshift(...[...required.values()].map((asset) => ({ type: 'addAsset', asset })));
      if (args.operations.some((op: any) => op.type === 'putComponent'))
        await this.jobs.validateComponents(
          applyOperations(before, args.operations, 'agent'),
          args.operations,
          run.abort.signal,
        );
      const envelope = await run.store.edit({ ...args, author: 'agent', runId: run.id }, () => run.active);
      this.changed(run.store, envelope);
      return { revision: envelope.project.revision, changes: envelope.revisions[0].changes };
    }
    if (method === 'import_asset') {
      const file = await realpath(resolve(run.workspace, args.path));
      if (!file.startsWith((await realpath(run.workspace)) + '/'))
        throw new Error('新素材必须位于任务工作区');
      const destination = await collectGeneratedFile(file, run.store);
      const asset = await importMedia(destination, run.store.path);
      asset.name = args.name || asset.name;
      asset.source = { provider: 'Agent', license: '项目生成素材' };
      run.assets.set(asset.id, asset);
      return asset;
    }
    if (method === 'compile_component') {
      const file = await realpath(resolve(args.path));
      if (!file.startsWith((await realpath(run.workspace)) + '/')) throw new Error('组件必须位于任务工作区');
      const published = run.packEntries.get(file);
      let component: CodeComponent;
      if (published?.pack) {
        const pack = await importMaterialPack(dirname(file), run.store.path, await run.store.project());
        const entry = pack.components.find((c) => c.pack.entry === basename(file));
        if (!entry) throw new Error('在素材包清单中找不到这个入口');
        component = { ...entry, id: args.id, name: args.name, props: args.props || entry.props };
        run.componentAssets.set(args.id, pack.assets);
      } else {
        component = await compileComponent(
          await readFile(file, 'utf8'),
          args.id,
          args.name,
          run.workspace,
          args.props,
          dirname(file),
        );
      }
      run.abort.signal.throwIfAborted();
      run.components.set(component.id, component);
      return component;
    }
    if (method === 'preview_frame') {
      const project = await run.store.project();
      const output = join(run.workspace, `preview-${Date.now()}.png`);
      const job = await this.jobs.render(project, args.sequenceId, output, {
        still: true,
        frame: args.frame,
        scale: 0.5,
      });
      run.jobs.add(job.id);
      try {
        await this.jobs.wait(job.id, run.abort.signal);
      } finally {
        if (!run.active) await this.jobs.cancel(job.id);
        run.jobs.delete(job.id);
      }
      if (!run.supportsImages) {
        const asset = await importMedia(output, run.store.path);
        run.assets.set(asset.id, asset);
        return this.generate(run, {
          use: 'vision',
          assetId: asset.id,
          prompt:
            args.prompt || '检查这个视频画面的排版、文字溢出、层次、对比度和视觉质量，提供具体改进建议。',
        });
      }
      return { data: (await readFile(output)).toString('base64') };
    }
    throw new Error('未知 Agent 工具');
  }
  private async generate(run: Run, args: GenerationRequest) {
    if (!this.generation) throw new Error('素材模型服务尚未启动');
    if (!run.active) throw new Error('运行已停止');
    const job = await this.generation.start(run.store, args, {
      publish: false,
      assets: [...run.assets.values()],
      signal: run.abort.signal,
    });
    run.jobs.add(job.id);
    if (!run.active) {
      await this.jobs.cancel(job.id);
      throw new Error('运行已停止');
    }
    try {
      const result = await this.generation.wait(job.id, run.abort.signal);
      if (!run.active) throw new Error('运行已停止');
      if (result.asset) run.assets.set(result.asset.id, result.asset);
      return { ...result, jobId: job.id };
    } finally {
      run.jobs.delete(job.id);
    }
  }
}
