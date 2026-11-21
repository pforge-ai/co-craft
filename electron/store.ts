import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  private get revisionsIndexPath() {
    return join(this.meta, 'revisions-index.json');
  }
  private snapshotPath(n: number) {
    return join(this.meta, 'revisions', String(n) + '.json');
  }

  async init(p: Project) {
    validateProject(p);
    await mkdir(join(this.meta, 'revisions'), { recursive: true });
    for (const folder of ['assets', 'components', 'scripts', 'skills', 'exports', 'recipes'])
      await mkdir(join(this.path, folder), { recursive: true });
    const initialRevision: Revision = {
      revision: p.revision,
      name: '创建工程',
      author: 'system',
      createdAt: p.createdAt,
      changes: ['创建工程'],
    };
    await atomicJSON(this.snapshotPath(p.revision), {
      project: p,
      revision: initialRevision,
    });
    await atomicJSON(this.revisionsIndexPath, [initialRevision]);
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

  private async loadRevisionsIndex(maxExclusive: number): Promise<Revision[]> {
    let indexed = await readJSON<Revision[] | null>(this.revisionsIndexPath, null);
    if (!indexed) {
      // One-time migration for 0.1/0.2 projects without revisions-index.json
      const files = await readdir(join(this.meta, 'revisions'));
      indexed = (
        await Promise.all(
          files
            .filter((x) => x.endsWith('.json'))
            .map(
              async (f) => (await readJSON<{ revision: Revision }>(join(this.meta, 'revisions', f))).revision,
            ),
        )
      ).sort((a, b) => b.revision - a.revision);
      await atomicJSON(this.revisionsIndexPath, indexed).catch(() => {});
    }
    return indexed.filter((r) => r.revision < maxExclusive).sort((a, b) => b.revision - a.revision);
  }

  async envelope(): Promise<ProjectEnvelope> {
    const head = await readJSON<Head>(this.headPath);
    const p = await this.project();
    const revisions = await this.loadRevisionsIndex(head.next);
    const offlineAssetIds = p.assets.filter((a) => a.path && !existsSync(a.path)).map((a) => a.id);
    await Promise.all(
      p.assets.map(async (a) => {
        a.offline = offlineAssetIds.includes(a.id);
        if (!a.transcript && a.kind !== 'image') {
          const cached = await readJSON<import('../src/core/types').TranscriptData | null>(
            join(this.meta, 'analysis', `transcript-${a.id}.json`),
            null,
          );
          if (cached) a.transcript = cached;
        }
      }),
    );
    return {
      project: p,
      path: this.path,
      tasks: await this.tasks(),
      revisions,
      canUndo: head.undo.length > 0,
      canRedo: head.redo.length > 0,
      offlineAssetIds,
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

  async deleteTask(id: string) {
    return this.serial(async () => {
      const tasks = await this.tasks();
      const target = tasks.find((t) => t.id === id);
      if (!target) return tasks;
      if (target.status === 'running') throw new Error('请先停止正在运行的会话，再删除');
      const next = tasks.filter((t) => t.id !== id);
      await atomicJSON(join(this.meta, 'tasks.json'), next);
      return next;
    });
  }

  async updateTaskDetails(id: string, changes: Pick<Partial<Task>, 'name' | 'modelId' | 'sequenceId'>) {
    return this.serial(async () => {
      const tasks = await this.tasks();
      const task = tasks.find((t) => t.id === id);
      if (!task) throw new Error('会话不存在');
      if (changes.name !== undefined && !changes.name.trim()) throw new Error('请输入有效的会话名称');
      if (task.status === 'running') throw new Error('会话运行结束后可以修改');
      if (changes.name !== undefined) task.name = changes.name.trim().slice(0, 100);
      if ('modelId' in changes) task.modelId = changes.modelId;
      if (changes.sequenceId !== undefined && changes.sequenceId) task.sequenceId = changes.sequenceId;
      await atomicJSON(join(this.meta, 'tasks.json'), tasks);
      return task;
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
      const p = applyOperations(before, req.operations, req.author || 'you', req.scope);
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
    const prevIndex = await this.loadRevisionsIndex(head.next);
    p.revision = head.next++;
    p.updatedAt = new Date().toISOString();
    // Strip transient runtime flags before persisting snapshot
    for (const a of p.assets) delete a.offline;
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
    await atomicJSON(this.revisionsIndexPath, [revision, ...prevIndex.filter((r) => r.revision !== p.revision)]);
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
  private stores = new Map<string, ProjectStore>();
  private indexWrite: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}

  private get index() {
    return join(this.root, 'projects.json');
  }

  async list(): Promise<ProjectSummary[]> {
    await mkdir(this.root, { recursive: true });
    return readJSON(this.index, []);
  }

  remember(store: ProjectStore, activate = true) {
    const operation = this.indexWrite.then(async () => {
      const project = await store.project();
      const items = await this.list();
      const entry = { id: project.id, name: project.name, path: store.path, updatedAt: project.updatedAt };
      const exists = items.some((item) => item.id === project.id);
      const next =
        activate || !exists
          ? [entry, ...items.filter((item) => item.id !== project.id)]
          : items.map((item) => (item.id === project.id ? entry : item));
      await atomicJSON(this.index, next);
      return next;
    });
    this.indexWrite = operation.catch(() => {});
    return operation;
  }

  async create(name: string, baseDir?: string) {
    const p = newProject(name);
    const path = join(
      baseDir || join(this.root, 'Projects'),
      `${name.replace(/[\/:*?"<>|]/g, '-')}-${p.id.slice(-6)}.cocraft`,
    );
    const store = new ProjectStore(path);
    await store.init(p);
    this.stores.set(store.path, store);
    await this.remember(store);
    return store;
  }

  async resolveStore(path: string) {
    const key = resolve(path);
    let store = this.stores.get(key);
    if (!store) {
      store = new ProjectStore(key);
      this.stores.set(key, store);
    }
    await store.project();
    return store;
  }

  async open(path: string) {
    const store = await this.resolveStore(path);
    await this.remember(store);
    return store;
  }
}
