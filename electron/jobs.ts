import { utilityProcess } from 'electron';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { atomicJSON, readJSON } from './store';
import type { Project, Job, EditOperation } from '../src/core/types';
import { uid, clone, newClip } from '../src/core/project';
import type { MediaServer } from './server';
export class JobService {
  jobs: Job[] = [];
  private processes = new Map<string, Electron.UtilityProcess>();
  private controllers = new Map<string, AbortController>();
  private settling = new Map<string, Promise<void>>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private root: string,
    private workerPath: string,
    private renderDir: string,
    private media: MediaServer,
    private onChange: (jobs: Job[]) => void,
    private devRoot?: string,
  ) {}
  async init() {
    await mkdir(join(this.root, 'render-cache'), { recursive: true });
    this.jobs = await readJSON(join(this.root, 'jobs.json'), []);
    for (const job of this.jobs)
      if (job.status === 'running' || job.status === 'queued') {
        job.status = 'failed';
        if (job.result) {
          job.error = '结果已保存，可以继续处理本地结果';
          job.stage = '可恢复结果';
        } else if (job.remote) {
          job.error = '应用已停止等待。可以用原任务编号继续查询';
          job.stage = '可恢复查询';
        } else {
          job.error =
            job.type === 'export'
              ? '应用关闭时导出中断，可重新导出'
              : '应用关闭时请求中断。再次提交前请核对服务商记录';
          job.stage = '已中断';
        }
      }
    await this.persist();
  }
  private async persist() {
    const snapshot = structuredClone(this.jobs);
    const write = this.writes.then(() => atomicJSON(join(this.root, 'jobs.json'), snapshot));
    this.writes = write.catch(() => {});
    await write;
    this.onChange(this.jobs);
  }
  async update(job: Job, patch: Partial<Job>) {
    Object.assign(job, patch);
    await this.persist();
  }
  async runTask(
    job: Job,
    task: (signal: AbortSignal) => Promise<Job['result']>,
    owner?: AbortSignal,
    stage?: string,
  ): Promise<Job> {
    if (job.status === 'completed') return job;
    // A cancelled POST may still be receiving its remote ID. Only one invocation owns the job at a time.
    if (this.controllers.has(job.id)) {
      if (job.status === 'running') return job;
      await this.settling.get(job.id);
      return this.runTask(job, task, owner, stage);
    }
    owner?.throwIfAborted();
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const cancel = () => {
      void this.cancel(job.id);
    };
    owner?.addEventListener('abort', cancel, { once: true });
    if (!this.jobs.some((j) => j.id === job.id)) this.jobs.unshift(job);
    Object.assign(job, { status: 'running', error: undefined, ...(stage ? { stage } : {}) });
    const started = this.persist();
    const done = (async () => {
      try {
        await started;
        controller.signal.throwIfAborted();
        const result = await task(controller.signal);
        // The task checks abort at its commit point. Once it has committed, expose that actual result.
        Object.assign(job, { result, status: 'completed', progress: 1, stage: '已完成' });
      } catch (error) {
        if (controller.signal.aborted || job.status === 'cancelled') return;
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.stage = job.result
          ? '结果已保存'
          : job.remote && !['failed', 'expired', 'cancelled', 'canceled'].includes(job.remote.status || '')
            ? '查询中断 · 可继续查询'
            : '未完成';
      } finally {
        owner?.removeEventListener('abort', cancel);
        await this.persist();
      }
    })().finally(() => {
      this.controllers.delete(job.id);
      this.settling.delete(job.id);
    });
    this.settling.set(job.id, done);
    void done.catch((error) => console.error('无法保存作业状态', error));
    await started;
    return job;
  }
  async wait(id: string, signal?: AbortSignal): Promise<NonNullable<Job['result']>> {
    while (true) {
      signal?.throwIfAborted();
      const job = this.jobs.find((j) => j.id === id);
      if (!job) throw new Error('作业不存在');
      if (job.status === 'completed') return job.result || {};
      if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error || job.stage);
      await sleep(100, undefined, { signal });
    }
  }
  async validateComponents(project: Project, operations: EditOperation[], signal?: AbortSignal) {
    for (const op of operations) {
      if (op.type !== 'putComponent') continue;
      signal?.throwIfAborted();
      const candidate = clone(project);
      const existing = candidate.sequences
        .flatMap((s) => s.clips.map((c) => ({ s, c })))
        .find((x) => x.c.componentId === op.component.id);
      const sequence = existing?.s || candidate.sequences[0];
      const clip = existing?.c || {
        ...newClip('code'),
        componentId: op.component.id,
        props: { ...op.component.props },
      };
      candidate.sequences = [
        { ...sequence, name: `检查画面 · ${op.component.name}`, clips: [{ ...clip, start: 0 }] },
      ];
      const output = join(this.root, 'render-cache', `${uid('check')}.png`);
      const job = await this.render(candidate, sequence.id, output, {
        still: true,
        frame: Math.min(clip.duration - 1, Math.round(sequence.fps * 0.5)),
        scale: 0.25,
      });
      const cancel = () => {
        void this.cancel(job.id);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        await this.wait(job.id, signal);
      } catch (error) {
        cancel();
        throw new Error(
          '画面检查未通过，原版本已保留：' + (error instanceof Error ? error.message : String(error)),
        );
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    }
  }
  async render(
    project: Project,
    sequenceId: string,
    output: string,
    options: { scale?: number; still?: boolean; frame?: number } = {},
  ): Promise<Job> {
    this.media.register(project.assets);
    await mkdir(join(output, '..'), { recursive: true });
    if (existsSync(output)) throw new Error('导出文件已存在，请使用新文件名');
    const seq = project.sequences.find((s) => s.id === sequenceId);
    if (!seq) throw new Error('成片不存在');
    const job: Job = {
      id: uid('job'),
      name: `${seq.name} · v${project.revision}`,
      type: 'export',
      status: 'running',
      progress: 0,
      stage: options.still ? '生成预览帧' : '准备导出',
      output,
      createdAt: new Date().toISOString(),
      revision: project.revision,
    };
    this.jobs.unshift(job);
    await this.persist();
    const worker = utilityProcess.fork(this.workerPath, [], {
      stdio: 'pipe',
      serviceName: 'CoCraft Renderer',
      cwd: join(this.root, 'render-cache'),
    });
    this.processes.set(job.id, worker);
    let stderr = '';
    worker.stderr?.on('data', (data) => (stderr = (stderr + data).slice(-2000)));
    let last = 0;
    worker.on('message', async (data: any) => {
      if (job.status !== 'running') return;
      if (data.type === 'progress') {
        job.progress = data.progress;
        job.stage = data.stage;
        if (Date.now() - last > 250) {
          last = Date.now();
          this.onChange(this.jobs);
        }
      }
      if (data.type === 'done' || data.type === 'error') {
        job.status = data.type === 'done' ? 'completed' : 'failed';
        job.progress = data.type === 'done' ? 1 : job.progress;
        job.stage = data.type === 'done' ? '导出完成' : '导出失败';
        job.error = data.error;
        this.processes.delete(job.id);
        worker.kill();
        await this.persist();
      }
    });
    worker.on('exit', async (code) => {
      this.processes.delete(job.id);
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = stderr || `渲染进程退出 (${code})`;
        job.stage = '导出失败';
        await this.persist();
      }
    });
    const hasBundle = existsSync(join(this.renderDir, 'index.html'));
    worker.postMessage({
      type: 'render',
      serveUrl: this.media.origin + '/render/index.html',
      entryPoint: hasBundle ? undefined : join(this.devRoot!, 'src/composition/register.tsx'),
      publicDir: this.devRoot ? join(this.devRoot, 'resources/public') : undefined,
      props: { project, sequenceId, mediaOrigin: this.media.origin },
      binariesDirectory: existsSync(join(process.resourcesPath || '', 'media-tools', 'ffmpeg'))
        ? join(process.resourcesPath, 'media-tools')
        : undefined,
      output,
      ...options,
    });
    return job;
  }
  async cancel(id: string) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status !== 'running') return;
    job.status = 'cancelled';
    job.stage = job.remote || job.stage === '正在提交云端任务' ? '已停止等待，云端可能继续执行' : '已取消';
    this.controllers.get(id)?.abort(new Error('已停止等待'));
    const worker = this.processes.get(id);
    worker?.postMessage({ type: 'cancel' });
    setTimeout(() => worker?.kill(), 1500);
    this.processes.delete(id);
    await this.persist();
  }
}
