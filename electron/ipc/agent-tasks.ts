import { dialog, nativeImage } from 'electron';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { uid } from '../../src/core/project';
import type { ComposerAttachment, Task } from '../../src/core/types';
import type { IpcHandlerMap } from './types';

async function buildComposerAttachment(filePath: string, overrideName?: string): Promise<ComposerAttachment> {
  const abs = resolve(filePath);
  const info = await stat(abs);
  const ext = extname(abs).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.srt': 'text/plain',
    '.json': 'application/json',
  };
  const kind: ComposerAttachment['kind'] = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)
    ? 'image'
    : ['.mp4', '.mov', '.webm'].includes(ext)
      ? 'video'
      : ['.mp3', '.wav', '.m4a'].includes(ext)
        ? 'audio'
        : 'file';
  let previewDataUrl: string | undefined;
  if (kind === 'image') {
    const img = nativeImage.createFromPath(abs);
    if (!img.isEmpty()) {
      const sz = img.getSize();
      const thumb =
        Math.max(sz.width, sz.height) > 120
          ? img.resize(sz.width >= sz.height ? { width: 120 } : { height: 120 })
          : img;
      previewDataUrl = thumb.toDataURL();
    }
  }
  return {
    id: uid('att'),
    name: overrideName || basename(abs),
    path: abs,
    mimeType: mimeMap[ext] || 'application/octet-stream',
    kind,
    previewDataUrl,
    sizeBytes: info.size,
  };
}

export const agentTasksIpcHandlers: IpcHandlerMap = {
  'tasks.model': async (arg, ctx) => {
    const target = ctx.getStore();
    if (
      arg.modelId &&
      !(await ctx.settings.get()).models.some((m) => m.id === arg.modelId && m.capabilities.includes('agent'))
    ) {
      throw new Error('会话模型已移除');
    }
    return target.updateTaskDetails(arg.id, { modelId: arg.modelId || undefined });
  },
  'tasks.rename': (arg, ctx) => ctx.getStore().updateTaskDetails(arg.id, { name: String(arg.name || '') }),
  'tasks.retarget': (arg, ctx) =>
    ctx.getStore().updateTaskDetails(arg.id, { sequenceId: String(arg.sequenceId || '') }),
  'tasks.delete': async (arg, ctx) => {
    const target = ctx.getStore();
    await target.deleteTask(arg.id);
    const e = await target.envelope();
    await ctx.changed(target, e);
    return e;
  },
  'tasks.create': async (arg, ctx) => {
    const task: Task = {
      id: uid('task'),
      name: arg.name || '新会话',
      modelId: arg.modelId || undefined,
      sequenceId: arg.sequenceId,
      createdAt: new Date().toISOString(),
      messages: [],
      status: 'idle',
    };
    await ctx.getStore().saveTask(task);
    return task;
  },
  'agent.attachFiles': async (arg, ctx) => {
    let paths: string[] = Array.isArray(arg.paths) ? arg.paths.map(String).filter(Boolean) : [];
    if (!paths.length) {
      const picked = await dialog.showOpenDialog(ctx.getWin(), {
        title: '选择对话参考附件',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: '媒体与文稿',
            extensions: [
              'png',
              'jpg',
              'jpeg',
              'webp',
              'gif',
              'svg',
              'mp4',
              'mov',
              'webm',
              'mp3',
              'wav',
              'm4a',
              'txt',
              'md',
              'srt',
              'json',
            ],
          },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (picked.canceled || !picked.filePaths.length) return null;
      paths = picked.filePaths;
    }
    const list: ComposerAttachment[] = [];
    for (const p of paths) {
      const built = await buildComposerAttachment(p).catch(() => null);
      if (built) list.push(built);
    }
    return list;
  },
  'agent.attachPaste': async (arg, ctx) => {
    const target = ctx.getStore();
    const b64 = String(arg.dataBase64 || '').replace(/^data:[^,]+,/, '');
    if (!b64) throw new Error('粘贴内容为空');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 20 * 1024 * 1024) throw new Error('粘贴附件超过 20MB 上限');
    const rawExt = String(arg.ext || 'png')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'md'].includes(rawExt) ? rawExt : 'png';
    const dir = join(target.path, '.cocraft', 'attachments');
    await mkdir(dir, { recursive: true });
    const fileName = `${uid('paste')}.${safeExt}`;
    const filePath = join(dir, fileName);
    await writeFile(filePath, buf);
    return buildComposerAttachment(filePath, String(arg.name || `粘贴图片.${safeExt}`));
  },
  'agent.start': (arg, ctx) => {
    const target = ctx.getStore();
    return ctx.agents.start(
      target,
      arg.taskId,
      arg.prompt,
      async () => ctx.settings.agent(arg.modelId, (await target.project()).modelDefaults),
      arg.context || '',
      arg.scope,
      {
        thinkingLevel: arg.thinkingLevel,
        attachments: arg.attachments,
        skillIds: arg.skillIds,
      },
    );
  },
  'agent.stop': (arg, ctx) => ctx.agents.stop(arg.taskId),
  'providers.inspect': (arg, ctx) => ctx.generation.inspectProvider(arg),
  'generation.start': (arg, ctx) => ctx.generation.start(ctx.getStore(), arg),
  'generation.resume': (arg, ctx) => ctx.generation.resume(arg.id),
};
