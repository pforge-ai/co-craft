import { utilityProcess } from 'electron';
import { mkdir, readFile, writeFile, cp, realpath, copyFile } from 'node:fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { ProjectStore, atomicJSON } from './store';
import { compileComponent } from './code';
import { binary, importMedia } from './media';
import { uid, applyOperations } from '../src/core/project';
import type { Task, Settings, AgentEvent, ProjectEnvelope, Asset } from '../src/core/types';
import type { JobService } from './jobs';
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
}
export class AgentHost {
  private runs = new Map<string, Run>();
  constructor(
    private workerPath: string,
    private skillsPath: string,
    private appRoot: string,
    private jobs: JobService,
    private emit: (e: AgentEvent) => void,
    private changed: (store: ProjectStore, envelope: ProjectEnvelope) => void,
  ) {}
  async start(store: ProjectStore, taskId: string, prompt: string, settings: Settings, context: string) {
    if (!settings.apiKey) throw new Error('先在设置中连接模型，即可让 Agent 开始工作。');
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
    const task = (await store.tasks()).find((t) => t.id === taskId);
    if (!task) throw new Error('任务不存在');
    const project = await store.project(),
      id = uid('run');
    const workspace = join(store.path, '.cocraft', 'workspaces', taskId);
    await mkdir(workspace, { recursive: true });
    await mkdir(join(workspace, 'components'), { recursive: true });
    await atomicJSON(join(workspace, 'project.json'), project);
    await writeFile(join(workspace, 'brief.md'), project.brief, 'utf8');
    await cp(join(store.path, 'skills'), join(workspace, 'skills'), { recursive: true });
    for (const c of project.components)
      await writeFile(
        join(workspace, 'components', c.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.tsx'),
        c.source,
        'utf8',
      );
    const sessionDir = join(store.path, '.cocraft', 'sessions', taskId);
    await mkdir(sessionDir, { recursive: true });
    const worker = utilityProcess.fork(this.workerPath, [], { stdio: 'pipe', serviceName: 'CoCraft Agent' });
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
    };
    this.runs.set(taskId, run);
    task.status = 'running';
    task.messages.push({ id: uid('msg'), role: 'user', text: prompt, createdAt: new Date().toISOString() });
    await store.saveTask(task);
    this.changed(store, await store.envelope());
    let stderr = '';
    worker.stderr?.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    worker.on('message', async (data: any) => {
      if (data.type === 'request') {
        try {
          if (!run.active) throw new Error('运行已停止');
          const result = await this.request(run, data.method, data.payload);
          worker.postMessage({ type: 'response', id: data.id, result });
        } catch (e) {
          worker.postMessage({
            type: 'response',
            id: data.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
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
          text: data.type === 'tool-start' ? data.text : '完成',
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
            text: stderr || `Agent 进程退出 (${code})`,
            createdAt: new Date().toISOString(),
          });
        }
        await this.finish(run);
      }
    });
    worker.postMessage({
      type: 'start',
      cwd: workspace,
      agentDir: join(workspace, '.pi-runtime'),
      skillsPath: this.skillsPath,
      settings,
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
  private async finish(run: Run) {
    if (run.finished) return;
    run.finished = true;
    run.active = false;
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
    this.runs.delete(run.task.id);
  }
  async stop(taskId: string) {
    const run = this.runs.get(taskId);
    if (!run) return;
    run.active = false;
    run.process.postMessage({ type: 'stop' });
    run.task.messages.push({
      id: uid('msg'),
      role: 'system',
      text: '已停止。已发布的修改保留，未发布的工作留在任务目录。',
      createdAt: new Date().toISOString(),
    });
    setTimeout(() => void this.finish(run), 2000);
    return { stopped: true };
  }
  private async request(run: Run, method: string, args: any): Promise<unknown> {
    if (method === 'read_project') return run.store.project();
    if (method === 'publish_edit') {
      for (const op of args.operations) {
        if (op.type === 'addAsset') {
          const asset = run.assets.get(op.asset?.id);
          if (!asset) throw new Error('新增素材必须先通过 import_asset 登记');
          op.asset = asset;
        }
      }
      if (args.operations.some((op: any) => op.type === 'putComponent'))
        await this.jobs.validateComponents(
          applyOperations(await run.store.project(), args.operations, 'agent'),
          args.operations,
        );
      const envelope = await run.store.edit({ ...args, author: 'agent', runId: run.id }, () => run.active);
      this.changed(run.store, envelope);
      return { revision: envelope.project.revision, changes: envelope.revisions[0].changes };
    }
    if (method === 'import_asset') {
      const file = await realpath(resolve(run.workspace, args.path));
      if (!file.startsWith((await realpath(run.workspace)) + '/'))
        throw new Error('新素材必须位于任务工作区');
      const hash = createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
        .slice(0, 24);
      const destination = join(run.store.path, 'assets', `generated-${hash}${extname(file)}`);
      try {
        await copyFile(file, destination, constants.COPYFILE_EXCL);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      const asset = await importMedia(destination, run.store.path);
      asset.name = args.name || asset.name;
      asset.source = { provider: 'Agent', license: '项目生成素材' };
      run.assets.set(asset.id, asset);
      return asset;
    }
    if (method === 'compile_component') {
      const file = await realpath(resolve(args.path));
      if (!file.startsWith((await realpath(run.workspace)) + '/')) throw new Error('组件必须位于任务工作区');
      return compileComponent(await readFile(file, 'utf8'), args.id, args.name, run.workspace, args.props);
    }
    if (method === 'preview_frame') {
      const project = await run.store.project();
      const output = join(run.workspace, `preview-${Date.now()}.png`);
      const job = await this.jobs.render(project, args.sequenceId, output, {
        still: true,
        frame: args.frame,
        scale: 0.5,
      });
      await new Promise<void>((resolvePromise, reject) => {
        const timer = setInterval(() => {
          if (!run.active) {
            clearInterval(timer);
            void this.jobs.cancel(job.id);
            reject(new Error('运行已停止'));
          } else if (job.status === 'completed') {
            clearInterval(timer);
            resolvePromise();
          } else if (job.status === 'failed' || job.status === 'cancelled') {
            clearInterval(timer);
            reject(new Error(job.error || '预览取消'));
          }
        }, 250);
      });
      return { data: (await readFile(output)).toString('base64') };
    }
    throw new Error('未知 Agent 工具');
  }
}
