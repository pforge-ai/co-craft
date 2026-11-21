import { nativeImage, utilityProcess } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, cp, realpath, lstat, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore, atomicJSON } from './store';
import { compileComponent } from './code';
import { binary, importMedia } from './media';
import { uid, applyOperations, preflightSequence } from '../src/core/project';
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
import type { GenerationService, GenerationRequest } from './generation';
import { chatEndpoint, collectGeneratedFile } from './generation';
import { importMaterialPack } from './packs';
import { stageStudioAsset } from './studio-media';
import type { GlobalVault } from './vault';
import { BUILT_IN_STYLES, presetCatalog, createPresetClip } from '../src/core/presets';
import { inferAssetEntityKind, inferAssetRole } from '../src/core/taxonomy';
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
  ) {}
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
    if (method === 'read_project') {
      const project = await run.store.project();
      const paths = new Map([...run.packEntries].map(([entry, c]) => [c.id, relative(run.workspace, entry)]));
      return {
        ...project,
        // Strip heavy waveform arrays and compiled JS bundles to save LLM context tokens.
        assets: project.assets.map(({ waveform: _w, ...rest }) => rest),
        components: project.components.map(({ compiled: _c, ...c }) => ({
          ...c,
          workspaceEntry: paths.get(c.id) || `components/${c.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.tsx`,
        })),
      };
    }
    if (method === 'list_presets')
      return presetCatalog.filter((p) => !args.category || p.category === args.category);
    if (method === 'search_assets') {
      const project = await run.store.project();
      const q = String(args.query || '').trim().toLowerCase();
      const reqTags: string[] = Array.isArray(args.tags) ? args.tags.map((t: string) => t.toLowerCase()) : [];
      const matchTags = (itemTags: string[] = []) =>
        !reqTags.length || reqTags.every((rt) => itemTags.some((it) => it.toLowerCase().includes(rt)));
      const matchQuery = (name: string, desc = '') =>
        !q || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);

      const results: any[] = [];
      if (!args.scope || args.scope === 'project') {
        for (const v of project.vault || []) {
          const kind = inferAssetEntityKind(v);
          const role = inferAssetRole(v);
          const allTags = [...(v.tags || []), ...(v.variants?.flatMap((vr) => vr.tags) || [])];
          if (args.kind && kind !== args.kind) continue;
          if (args.role && role !== args.role) continue;
          if (!matchTags(allTags) || !matchQuery(v.name, v.description || v.promptAnchor)) continue;
          results.push({
            source: 'project-vault',
            id: v.id,
            name: v.name,
            kind,
            role,
            tags: v.tags || [],
            version: v.version,
            variants: (v.variants || []).map((vr) => ({
              id: vr.id,
              name: vr.name,
              version: vr.version,
              assetId: vr.assetId,
              tags: vr.tags,
            })),
          });
        }
        for (const a of project.assets) {
          const kind = inferAssetEntityKind(a);
          const role = inferAssetRole(a);
          if (args.kind && kind !== args.kind) continue;
          if (args.role && role !== args.role) continue;
          if (!matchTags(a.tags) || !matchQuery(a.name)) continue;
          results.push({
            source: 'project-media',
            id: a.id,
            name: a.name,
            kind,
            role,
            tags: a.tags || [],
            duration: a.duration,
            hasTranscript: Boolean(a.transcript),
          });
        }
      }
      if ((!args.scope || args.scope === 'personal') && this._globalVault) {
        for (const g of await this._globalVault.list()) {
          const kind = inferAssetEntityKind(g);
          const role = inferAssetRole(g);
          if (args.kind && kind !== args.kind) continue;
          if (args.role && role !== args.role) continue;
          if (!matchTags(g.tags) || !matchQuery(g.name, g.description || g.promptAnchor)) continue;
          results.push({
            source: 'personal-library',
            id: g.id,
            name: g.name,
            kind,
            role,
            tags: g.tags || [],
            version: g.version,
          });
        }
      }
      if (!args.scope || args.scope === 'studio') {
        for (const st of BUILT_IN_STYLES) {
          const kind = inferAssetEntityKind(st);
          const role = inferAssetRole(st);
          if (args.kind && kind !== args.kind) continue;
          if (args.role && role !== args.role) continue;
          if (!matchTags(st.tags) || !matchQuery(st.name, st.description)) continue;
          results.push({
            source: 'built-in-style',
            id: st.id,
            name: st.name,
            kind,
            role,
            tags: st.tags || [],
            description: st.description,
            styleTokens: st.styleTokens,
          });
        }
        for (const s of this.studioMedia) {
          const kind = inferAssetEntityKind(s);
          const role = inferAssetRole(s);
          if (args.kind && kind !== args.kind) continue;
          if (args.role && role !== args.role) continue;
          if (!matchTags(s.tags) || !matchQuery(s.name)) continue;
          results.push({
            source: 'built-in-studio',
            id: s.id,
            name: s.name,
            kind,
            role,
            tags: s.tags || [],
            duration: s.duration,
          });
        }
      }
      return results;
    }
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
      const clip = createPresetClip(args.presetId, args.start || 0, sequence.fps, args.props, project);
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
        if (op.type === 'relinkAsset') {
          throw new Error('Agent 不能直接重连素材路径，请由用户在界面中重新定位素材');
        }
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
          } else {
            throw new Error('请先使用 compile_component 编译任务工作区中的组件，再通过 putComponent 发布');
          }
          // Protect other sequences (Copy-on-Write boundary): refuse overwriting a component referenced outside the active sequence.
          const targetSeqId = run.scope?.sequenceId || run.task.sequenceId;
          const usedElsewhere = before.sequences.some(
            (s) =>
              s.id !== targetSeqId &&
              s.clips.some(
                (c) =>
                  c.componentId === op.component.id ||
                  (c.takes || []).some((t) => t.componentId === op.component.id),
              ),
          );
          if (usedElsewhere) {
            throw new Error(
              `组件 ${op.component.id} 正被其他成片分支引用，请使用新的组件 ID 编译后再发布，以免影响其他成片`,
            );
          }
        }
      }
      for (const id of before.assets.map((a) => a.id)) required.delete(id);
      for (const op of args.operations) if (op.type === 'addAsset') required.delete(op.asset.id);
      args.operations.unshift(...[...required.values()].map((asset) => ({ type: 'addAsset', asset })));
      if (args.operations.some((op: any) => op.type === 'putComponent'))
        await this.jobs.validateComponents(
          applyOperations(before, args.operations, 'agent', run.scope),
          args.operations,
          run.abort.signal,
        );
      const envelope = await run.store.edit(
        { ...args, author: 'agent', runId: run.id, scope: run.scope },
        () => run.active,
      );
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
      const seq = project.sequences.find((s) => s.id === args.sequenceId) || project.sequences[0];
      const frame = Math.max(0, Math.round(Number(args.frame || 0)));
      const output = join(run.workspace, '.tmp', `preview-${randomUUID()}.png`);
      await mkdir(dirname(output), { recursive: true });
      const job = await this.jobs.render(project, seq.id, output, {
        still: true,
        frame,
        scale: 0.5,
        silent: true,
      });
      run.jobs.add(job.id);
      try {
        await this.jobs.wait(job.id, run.abort.signal);
      } finally {
        if (!run.active) await this.jobs.cancel(job.id);
        run.jobs.delete(job.id);
      }
      try {
        if (!run.supportsImages) {
          let tempAssetId: string | undefined;
          try {
            const asset = await importMedia(output, run.store.path);
            tempAssetId = asset.id;
            run.assets.set(asset.id, asset);
            return await this.generate(run, {
              use: 'vision',
              assetId: asset.id,
              prompt:
                args.prompt || '检查这个视频画面的排版、文字溢出、层次、对比度和视觉质量，提供具体改进建议。',
            });
          } catch (err) {
            if (/(未配置|请在「设置|用途默认值|缺少提供商|保存 API Key)/.test(String(err))) {
              const activeClips = seq.clips
                .filter((c) => frame >= c.start && frame < c.start + c.duration)
                .map((c) => ({
                  id: c.id,
                  name: c.name,
                  track: c.track,
                  kind: c.kind,
                  text: c.props.text || undefined,
                  presetId: c.props.presetId || undefined,
                }));
              return {
                renderedOk: true,
                text: '静帧已成功实际渲染（无代码或画面异常）；当前未单独配置视觉理解模型，已返回该帧可见图层结构摘要。',
                sequence: seq.name,
                dimensions: `${seq.width}x${seq.height}`,
                frame,
                visibleLayers: activeClips,
              };
            }
            throw err;
          } finally {
            if (tempAssetId) run.assets.delete(tempAssetId);
          }
        }
        return { data: (await readFile(output)).toString('base64') };
      } finally {
        await rm(output, { force: true }).catch(() => {});
      }
    }
    if (method === 'pull_vault_item') {
      if (!this._globalVault) throw new Error('个人资产库未初始化');
      if (!args.itemId || typeof args.itemId !== 'string') throw new Error('缺少 itemId');
      const pulled = await this._globalVault.pullToProject(run.store, args.itemId);
      this.changed(run.store, pulled.envelope);
      return {
        revision: pulled.envelope.project.revision,
        item: pulled.item,
        asset: pulled.asset ? { id: pulled.asset.id, name: pulled.asset.name, kind: pulled.asset.kind } : undefined,
      };
    }
    if (method === 'preflight_sequence') {
      const project = await run.store.project();
      const targetSeqId = args.sequenceId || run.task.sequenceId || project.sequences[0]?.id;
      const missing = project.assets.filter((a) => a.path && !existsSync(a.path)).map((a) => a.id);
      const issues = preflightSequence(project, targetSeqId, missing);
      return { sequenceId: targetSeqId, issueCount: issues.length, issues };
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
