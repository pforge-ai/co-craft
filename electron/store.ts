import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { applyOperations, clone, diffSummary, newProject, validateProject } from '../src/core/project';
import type {
  Project,
  ProjectEnvelope,
  Revision,
  Task,
  EditRequest,
  ProjectSummary,
} from '../src/core/types';

export async function atomicJSON(path: string, value: unknown, mayCommit?: () => boolean) {
  const temp = path + `.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  if (mayCommit) {
    if (!mayCommit()) {
      unlinkSync(temp);
      throw new Error('本次运行已停止，修改未发布');
    }
    // Permission check and pointer swap cannot be interleaved by a stop event.
    renameSync(temp, path);
  } else await rename(temp, path);
}
export async function readJSON<T>(path: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (fallback !== undefined && (e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw e;
  }
}
interface Head {
  current: number;
  next: number;
  undo: number[];
  redo: number[];
}
export class ProjectStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly path: string) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
  private get meta() {
    return join(this.path, '.cocraft');
  }
  private get headPath() {
    return join(this.meta, 'head.json');
  }
  private snapshotPath(n: number) {
    return join(this.meta, 'revisions', String(n) + '.json');
  }
  async init(p: Project) {
    validateProject(p);
    await mkdir(join(this.meta, 'revisions'), { recursive: true });
    for (const folder of ['assets', 'components', 'scripts', 'skills', 'exports'])
      await mkdir(join(this.path, folder), { recursive: true });
    await atomicJSON(this.snapshotPath(p.revision), {
      project: p,
      revision: {
        revision: p.revision,
        name: '创建工程',
        author: 'system',
        createdAt: p.createdAt,
        changes: ['创建工程'],
      } satisfies Revision,
    });
    await atomicJSON(this.headPath, { current: p.revision, next: p.revision + 1, undo: [], redo: [] });
    await atomicJSON(join(this.path, 'project.json'), p);
    await writeFile(join(this.path, 'brief.md'), p.brief, 'utf8');
    await atomicJSON(join(this.meta, 'tasks.json'), []);
    return this.envelope();
  }
  async project(): Promise<Project> {
    const h = await readJSON<Head>(this.headPath);
    return (await readJSON<{ project: Project }>(this.snapshotPath(h.current))).project;
  }
  async envelope(): Promise<ProjectEnvelope> {
    const head = await readJSON<Head>(this.headPath),
      p = await this.project();
    const files = await readdir(join(this.meta, 'revisions'));
    const revisions = (
      await Promise.all(
        files
          .filter((x) => x.endsWith('.json'))
          .map(
            async (f) => (await readJSON<{ revision: Revision }>(join(this.meta, 'revisions', f))).revision,
          ),
      )
    ).sort((a, b) => b.revision - a.revision);
    return {
      project: p,
      path: this.path,
      tasks: await this.tasks(),
      revisions: revisions.filter((r) => r.revision < head.next),
      canUndo: head.undo.length > 0,
      canRedo: head.redo.length > 0,
    };
  }
  async tasks(): Promise<Task[]> {
    return readJSON(join(this.meta, 'tasks.json'), []);
  }
  async saveTask(task: Task) {
    return this.serial(async () => {
      const tasks = await this.tasks();
      const i = tasks.findIndex((t) => t.id === task.id);
      if (i >= 0) tasks[i] = task;
      else tasks.push(task);
      await atomicJSON(join(this.meta, 'tasks.json'), tasks);
    });
  }
  async snapshot(revision: number) {
    return (await readJSON<{ project: Project }>(this.snapshotPath(revision))).project;
  }
  async edit(req: EditRequest, isActive: () => boolean = () => true) {
    return this.serial(async () => {
      if (!isActive()) throw new Error('本次运行已停止，修改未发布');
      const before = await this.project();
      if (before.revision !== req.baseRevision)
        throw new Error('工程已有新修改。请读取最新版本后重试，人工修改已保留。');
      const p = applyOperations(before, req.operations, req.author || 'you');
      return this.publish(before, p, req.name, req.author || 'you', 'edit', isActive);
    });
  }
  private async publish(
    before: Project,
    p: Project,
    name: string,
    author: Revision['author'],
    mode: 'edit' | 'undo' | 'redo',
    isActive: () => boolean = () => true,
  ) {
    const head = await readJSON<Head>(this.headPath);
    p.revision = head.next++;
    p.updatedAt = new Date().toISOString();
    const revision: Revision = {
      revision: p.revision,
      name,
      author,
      createdAt: p.updatedAt,
      changes: diffSummary(before, p),
    };
    if (mode === 'edit') {
      head.undo.push(before.revision);
      head.redo = [];
    } else if (mode === 'undo') {
      head.undo.pop();
      head.redo.push(before.revision);
    } else {
      head.redo.pop();
      head.undo.push(before.revision);
    }
    validateProject(p);
    // A complete immutable snapshot is durable before the authoritative pointer moves.
    await atomicJSON(this.snapshotPath(p.revision), { project: p, revision });
    if (!isActive()) throw new Error('本次运行已停止，修改未发布');
    head.current = p.revision;
    await atomicJSON(this.headPath, head, isActive);
    await atomicJSON(join(this.path, 'project.json'), p);
    await writeFile(join(this.path, 'brief.md'), p.brief, 'utf8');
    return this.envelope();
  }
  async undo() {
    return this.serial(async () => {
      const h = await readJSON<Head>(this.headPath);
      if (!h.undo.length) return this.envelope();
      const before = await this.project();
      return this.publish(before, clone(await this.snapshot(h.undo.at(-1)!)), '撤销上次修改', 'you', 'undo');
    });
  }
  async redo() {
    return this.serial(async () => {
      const h = await readJSON<Head>(this.headPath);
      if (!h.redo.length) return this.envelope();
      const before = await this.project();
      return this.publish(before, clone(await this.snapshot(h.redo.at(-1)!)), '重做修改', 'you', 'redo');
    });
  }
  async restore(revision: number) {
    return this.serial(async () => {
      const before = await this.project();
      return this.publish(before, clone(await this.snapshot(revision)), `恢复到 v${revision}`, 'you', 'edit');
    });
  }
}
export class Library {
  constructor(readonly root: string) {}
  private get index() {
    return join(this.root, 'projects.json');
  }
  async list(): Promise<ProjectSummary[]> {
    await mkdir(this.root, { recursive: true });
    return readJSON(this.index, []);
  }
  async remember(store: ProjectStore) {
    const p = await store.project();
    const list = await this.list();
    const next = [
      { id: p.id, name: p.name, path: store.path, updatedAt: p.updatedAt },
      ...list.filter((x) => x.id !== p.id),
    ];
    await atomicJSON(this.index, next);
    return next;
  }
  async create(name: string, baseDir?: string) {
    const p = newProject(name);
    const path = join(
      baseDir || join(this.root, 'Projects'),
      `${name.replace(/[\/:*?"<>|]/g, '-')}-${p.id.slice(-6)}.cocraft`,
    );
    const store = new ProjectStore(path);
    await store.init(p);
    await this.remember(store);
    return store;
  }
  async open(path: string) {
    const store = new ProjectStore(path);
    await store.project();
    await this.remember(store);
    return store;
  }
}
