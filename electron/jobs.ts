import { utilityProcess } from 'electron';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { dir as compositorDir } from '@remotion/compositor-darwin-arm64';
import { atomicJSON, readJSON } from './store';
import type { Project, Job, EditOperation } from '../src/core/types';
import { uid, clone, newClip } from '../src/core/project';
import type { MediaServer } from './server';
import type { OffscreenCaptureService } from './offscreen-capture';

export class JobService {
  jobs: Job[] = [];
  private internalJobs = new Map<string, Job>();
  private posterPending = new Map<string, Promise<string | null>>();
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
    private capture?: OffscreenCaptureService,
  ) {}

  async init() {
    await mkdir(join(this.root, 'render-cache'), { recursive: true });
    const posterDir = join(this.root, 'posters');
    await mkdir(posterDir, { recursive: true });
    this.media.setPosterDir(posterDir);
    const saved = await readJSON<Job[]>(join(this.root, 'jobs.json'), []);
    // Strip any historical internal validation check jobs left by 0.2 / 0.3 preview_frame
    this.jobs = saved.filter(
      (j) => !j.name.startsWith('检查画面 · ') && !String(j.output || '').includes('/.cocraft/workspaces/'),
    );
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

  async clearFinished() {
    this.jobs = this.jobs.filter((j) => j.status === 'running' || j.status === 'queued');
    await this.persist();
    return this.jobs;
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

  private lookup(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id) || this.internalJobs.get(id);
  }

  async wait(id: string, signal?: AbortSignal): Promise<NonNullable<Job['result']>> {
    while (true) {
      signal?.throwIfAborted();
      const job = this.lookup(id);
      if (!job) throw new Error('作业不存在');
      if (job.status === 'completed') return job.result || {};
      if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error || job.stage);
      await sleep(80, undefined, { signal });
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
      const thumbW = Math.max(320, Math.round((sequence.width * 0.35) / 2) * 2);
      const thumbH = Math.max(180, Math.round((sequence.height * 0.35) / 2) * 2);
      candidate.sequences = [
        {
          ...sequence,
          width: thumbW,
          height: thumbH,
          name: `检查画面 · ${op.component.name}`,
          clips: [{ ...clip, start: 0 }],
        },
      ];
      const output = join(this.root, 'render-cache', `${uid('check')}.png`);
      // Silent internal validation: never pollutes user-facing background jobs list!
      const job = await this.render(candidate, sequence.id, output, {
        still: true,
        frame: Math.min(clip.duration - 1, Math.round(sequence.fps * 0.5)),
        scale: 1,
        silent: true,
      });
      const cancel = () => {
        void this.cancel(job.id);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        await this.wait(job.id, signal);
        // Keep the already-rendered validation frame as an instant poster thumbnail!
        const safeHash = op.component.hash.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
        if (safeHash && existsSync(output)) {
          const posterPath = join(this.root, 'posters', `${safeHash}.png`);
          await rename(output, posterPath).catch(() => copyFile(output, posterPath).catch(() => {}));
        }
      } catch (error) {
        cancel();
        throw new Error(
          '画面检查未通过，原版本已保留：' + (error instanceof Error ? error.message : String(error)),
        );
      } finally {
        signal?.removeEventListener('abort', cancel);
        this.internalJobs.delete(job.id);
        await rm(output, { force: true }).catch(() => {});
      }
    }
  }

  /**
   * Renders and caches a real sandboxed PNG poster thumbnail for a compiled CodeComponent.
   * Deduplicates concurrent requests for the same (hash + props) so Component & Shot cards share one render.
   */
  async ensureComponentPoster(
    project: Project,
    componentId: string,
    clipProps?: Record<string, unknown>,
    sampleFrame?: number,
  ): Promise<string | null> {
    const comp = project.components.find((c) => c.id === componentId);
    if (!comp) return null;
    const baseHash = comp.hash.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'comp';
    const hasCustomProps =
      clipProps &&
      Object.keys(clipProps).some((k) => {
        const v = clipProps[k];
        return v !== undefined && v !== (comp.props as Record<string, unknown>)?.[k];
      });
    const key = hasCustomProps
      ? `${baseHash.slice(0, 24)}_${createHash('sha1')
          .update(
            JSON.stringify(
              Object.keys(clipProps!)
                .sort()
                .map((k) => [k, clipProps![k]]),
            ),
          )
          .digest('hex')
          .slice(0, 16)}`
      : baseHash;
    const fileName = `${key}.png`;
    const posterDir = join(this.root, 'posters');
    const posterPath = join(posterDir, fileName);
    if (existsSync(posterPath)) return fileName;

    const inflight = this.posterPending.get(key);
    if (inflight) return inflight;

    const task = (async (): Promise<string | null> => {
      await mkdir(posterDir, { recursive: true });
      const candidate = clone(project);
      const seq = candidate.sequences[0];
      if (!seq) return null;
      const thumbW = Math.max(320, Math.round((seq.width * 0.35) / 2) * 2);
      const thumbH = Math.max(180, Math.round((seq.height * 0.35) / 2) * 2);
      const fps = seq.fps || 30;
      const dur = Math.max(fps * 2, 60);
      const tempSeqId = uid('seq_poster');
      candidate.sequences.push({
        ...seq,
        id: tempSeqId,
        width: thumbW,
        height: thumbH,
        name: `组件缩略图 · ${comp.name}`,
        clips: [
          {
            ...newClip('code', 0),
            name: comp.name,
            duration: dur,
            componentId: comp.id,
            props: { ...comp.props, ...(clipProps || {}) },
          },
        ],
      });
      const tmpOut = join(this.root, 'render-cache', `${uid('poster')}.png`);
      const job = await this.render(candidate, tempSeqId, tmpOut, {
        still: true,
        frame: Math.max(0, Math.min(dur - 1, Math.round(sampleFrame ?? fps * 0.5))),
        scale: 1,
        silent: true,
      });
      try {
        await this.wait(job.id);
        if (existsSync(tmpOut)) {
          await rename(tmpOut, posterPath).catch(() => copyFile(tmpOut, posterPath));
          return existsSync(posterPath) ? fileName : null;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.internalJobs.delete(job.id);
        await rm(tmpOut, { force: true }).catch(() => {});
        this.posterPending.delete(key);
      }
    })();

    this.posterPending.set(key, task);
    return task;
  }

  async render(
    project: Project,
    sequenceId: string,
    output: string,
    options: {
      scale?: number;
      still?: boolean;
      frame?: number;
      silent?: boolean;
      preferOffscreenVideo?: boolean;
      projectPath?: string;
    } = {},
  ): Promise<Job> {
    await mkdir(join(output, '..'), { recursive: true });
    if (existsSync(output)) throw new Error('导出文件已存在，请使用新文件名');
    const seq = project.sequences.find((s) => s.id === sequenceId);
    if (!seq) throw new Error('成片不存在');
    const silent = !!options.silent;
    const job: Job = {
      id: uid('job'),
      name: `${seq.name} · v${project.revision}`,
      type: 'export',
      status: 'running',
      progress: 0,
      stage: options.still ? '生成预览帧' : options.preferOffscreenVideo ? '准备 GPU 录制' : '准备导出',
      output,
      createdAt: new Date().toISOString(),
      revision: project.revision,
      projectId: project.id,
      projectName: project.name,
      branchName: seq.branchName || seq.name,
      projectPath: options.projectPath,
    };
    if (silent) {
      this.internalJobs.set(job.id, job);
    } else {
      this.jobs.unshift(job);
      await this.persist();
    }

    // Fast Metal GPU offscreen capture path inside Electron — zero Google Chrome launches, zero Dock bounces!
    if (this.capture && (options.still || options.preferOffscreenVideo)) {
      const controller = new AbortController();
      this.controllers.set(job.id, controller);
      let lastPush = 0;
      const runCapture = async () => {
        try {
          if (options.still) {
            await this.capture!.captureStill(project, sequenceId, output, {
              frame: options.frame,
              scale: options.scale,
              signal: controller.signal,
            });
          } else {
            await this.capture!.renderSilentVideo(project, sequenceId, output, {
              scale: options.scale,
              signal: controller.signal,
              onProgress: (progress, stage) => {
                if (job.status !== 'running') return;
                job.progress = progress;
                job.stage = stage;
                if (!silent && Date.now() - lastPush > 200) {
                  lastPush = Date.now();
                  this.onChange(this.jobs);
                }
              },
            });
          }
          if (job.status === 'running') {
            job.status = 'completed';
            job.progress = 1;
            job.stage = options.still ? '已完成' : '录制完成';
            if (!silent) await this.persist();
          }
        } catch (err) {
          if (controller.signal.aborted || job.status === 'cancelled') return;
          job.status = 'failed';
          job.error = err instanceof Error ? err.message : String(err);
          job.stage = options.still ? '生成失败' : '录制失败';
          if (!silent) await this.persist();
        } finally {
          this.controllers.delete(job.id);
        }
      };
      void runCapture();
      return job;
    }

    const registeredAssetIds = this.media.register(project.assets);
    let assetsReleased = false;
    const releaseAssets = () => {
      if (assetsReleased) return;
      assetsReleased = true;
      this.media.unregisterRenderAssets(registeredAssetIds);
    };
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
        if (!silent && Date.now() - last > 250) {
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
        releaseAssets();
        worker.kill();
        if (!silent) await this.persist();
      }
    });
    worker.on('exit', async (code) => {
      this.processes.delete(job.id);
      releaseAssets();
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = stderr || `渲染进程退出 (${code})`;
        job.stage = '导出失败';
        if (!silent) await this.persist();
      }
    });
    const hasBundle = existsSync(join(this.renderDir, 'index.html'));
    const unpackedCompositorDir = compositorDir.replace('app.asar/', 'app.asar.unpacked/');
    const binariesDirectory = existsSync(join(process.resourcesPath || '', 'media-tools', 'ffmpeg'))
      ? join(process.resourcesPath, 'media-tools')
      : existsSync(join(unpackedCompositorDir, 'ffmpeg'))
        ? unpackedCompositorDir
        : undefined;
    worker.postMessage({
      type: 'render',
      serveUrl: hasBundle ? this.media.origin + '/render/index.html' : undefined,
      entryPoint: hasBundle ? undefined : this.devRoot ? join(this.devRoot, 'src/composition/register.tsx') : undefined,
      publicDir: this.devRoot ? join(this.devRoot, 'resources/public') : undefined,
      props: { project, sequenceId, mediaOrigin: this.media.origin },
      binariesDirectory,
      output,
      ...options,
    });
    return job;
  }

  async shutdownWorkers() {
    this.capture?.dispose();
    for (const [id, worker] of this.processes.entries()) {
      const job = this.lookup(id);
      try {
        worker.postMessage({ type: 'cancel' });
        worker.kill();
      } catch {}
      if (job?.output) {
        await rm(job.output + '.rendering.mp4', { force: true }).catch(() => {});
        await rm(job.output + '.rendering.png', { force: true }).catch(() => {});
      }
    }
    this.processes.clear();
  }

  async cancel(id: string) {
    const job = this.lookup(id);
    if (!job || job.status !== 'running') return;
    const isInternal = this.internalJobs.has(id);
    job.status = 'cancelled';
    job.stage = job.remote || job.stage === '正在提交云端任务' ? '已停止等待，云端可能继续执行' : '已取消';
    this.controllers.get(id)?.abort(new Error('已停止等待'));
    const worker = this.processes.get(id);
    worker?.postMessage({ type: 'cancel' });
    setTimeout(() => worker?.kill(), 1500);
    this.processes.delete(id);
    if (job.output) {
      await rm(job.output + '.rendering.mp4', { force: true }).catch(() => {});
      await rm(job.output + '.rendering.png', { force: true }).catch(() => {});
    }
    if (!isInternal) await this.persist();
  }
}
