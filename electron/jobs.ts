import { utilityProcess } from 'electron';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { atomicJSON, readJSON } from './store';
import type { Project, Job, EditOperation } from '../src/core/types';
import { uid, clone, newClip } from '../src/core/project';
import type { MediaServer } from './server';
export class JobService {
  jobs: Job[] = [];
  private processes = new Map<string, Electron.UtilityProcess>();
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
        job.error = '应用关闭时作业中断，可重新导出';
        job.stage = '需要重新导出';
      }
    await this.persist();
  }
  private async persist() {
    await atomicJSON(join(this.root, 'jobs.json'), this.jobs);
    this.onChange(this.jobs);
  }
  async validateComponents(project: Project, operations: EditOperation[]) {
    for (const op of operations) {
      if (op.type !== 'putComponent') continue;
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
      await new Promise<void>((resolve, reject) => {
        const timer = setInterval(() => {
          if (job.status === 'completed') {
            clearInterval(timer);
            resolve();
          }
          if (job.status === 'failed' || job.status === 'cancelled') {
            clearInterval(timer);
            reject(new Error('画面检查未通过，原版本已保留：' + (job.error || '检查已取消')));
          }
        }, 100);
      });
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
    job.stage = '已取消';
    const worker = this.processes.get(id);
    worker?.postMessage({ type: 'cancel' });
    setTimeout(() => worker?.kill(), 1500);
    this.processes.delete(id);
    await this.persist();
  }
}
