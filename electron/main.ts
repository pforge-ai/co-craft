import { app, BrowserWindow, clipboard, ipcMain, dialog, Menu, shell, nativeTheme, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve, basename } from 'node:path';
import { mkdir, readFile, writeFile, readdir, rm, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Library, ProjectStore } from './store';
import { SettingsStore } from './settings';
import { MediaServer } from './server';
import { JobService } from './jobs';
import { AgentHost } from './agents';
import { studioCatalog, addStudioAsset } from './studio-media';
import { GenerationService, downloadToFile } from './generation';
import { importMaterialPack, exportMaterialPack } from './packs';
import { createDemo } from './demo';
import { binary, importMedia, run } from './media';
import { compileComponent } from './code';
import { GlobalVault } from './vault';
import { McpBridgeServer } from './mcp-bridge';
import { CoCraftToolService } from './tool-service';
import {
  newClip,
  uid,
  clone,
  applyOperations,
  parseSRTText,
  preflightSequence,
  inferDefaultAudioAttachMode,
} from '../src/core/project';
import { friendlySkillTitle } from '../src/core/taxonomy';
import type {
  Asset,
  ComposerAttachment,
  EditOperation,
  ProjectEnvelope,
  SkillInfo,
  StockVideo,
  Task,
  VaultItem,
} from '../src/core/types';

const here = dirname(fileURLToPath(import.meta.url));
if (process.env.COCRAFT_DATA_DIR) {
  app.setPath('userData', resolve(process.env.COCRAFT_DATA_DIR));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
app.setName('CoCraft');

let win: BrowserWindow,
  store: ProjectStore,
  library: Library,
  settings: SettingsStore,
  media: MediaServer,
  jobs: JobService,
  generation: GenerationService,
  agents: AgentHost,
  globalVault: GlobalVault,
  toolService: CoCraftToolService,
  mcpBridge: McpBridgeServer;

const sanitizeFileName = (raw: string, fallback = 'export') =>
  String(raw || fallback)
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 64) || fallback;

const resources = app.isPackaged ? join(process.resourcesPath, 'resources') : join(here, '../resources');
const renderDir = app.isPackaged ? join(process.resourcesPath, 'render-bundle') : join(here, 'render-bundle');
let studioMedia: Asset[] = [];
const knownStock = new Map<number, StockVideo>();

const emit = (channel: string, data: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send('cocraft:' + channel, data);
};

async function changed(target: ProjectStore, envelope: ProjectEnvelope) {
  await library.remember(target, false);
  if (store.path === target.path) {
    media.setProjectAssets(envelope.project.assets, target.path);
    emit('project', envelope);
  }
}

async function importFiles(paths: string[], append = false, sequenceId?: string) {
  const target = store;
  const p = await target.project();
  const seq = p.sequences.find((s) => s.id === sequenceId) || p.sequences[0];
  const operations: EditOperation[] = [];
  let start = Math.max(
    0,
    ...seq.clips.filter((c) => c.track === 'visual').map((c) => c.start + c.duration),
  );
  for (const path of paths) {
    const a = await importMedia(path, target.path);
    operations.push({ type: 'addAsset', asset: a });
    if (append) {
      const clipKind = a.kind === 'model-3d' ? 'shape' : a.kind;
      const dur = Math.max(1, Math.floor(a.duration * seq.fps));
      const c = {
        ...newClip(clipKind, start, a.id),
        name: a.name,
        duration: dur,
        ...(a.kind === 'audio' ? { audioAttachMode: inferDefaultAudioAttachMode(a, dur, seq.fps) } : {}),
      };
      operations.push({ type: 'addClip', sequenceId: seq.id, clip: c });
      if (a.kind !== 'audio') start += c.duration;
    }
  }
  if (!operations.length) return target.envelope();
  const result = await target.edit({
    baseRevision: p.revision,
    name: `导入 ${paths.length} 个素材`,
    operations,
  });
  await changed(target, result);
  return result;
}

async function handle(method: string, arg: any = {}) {
  switch (method) {
    case 'boot': {
      const current = await store.envelope();
      media.setProjectAssets(current.project.assets, store.path);
      return {
        projects: await library.list(),
        current,
        settings: await settings.get(),
        jobs: jobs.jobs,
        studioMedia,
        previewOrigin: media.origin,
        version: app.getVersion(),
        skills: await listSkills(),
        globalVault: await globalVault.list(),
      };
    }
    case 'project.list':
      return library.list();
    case 'project.demo': {
      store = await createDemo(library, resources);
      const envelope = await store.envelope();
      media.setProjectAssets(envelope.project.assets, store.path);
      return envelope;
    }
    case 'project.create': {
      store = await library.create(String(arg.name || '未命名项目'));
      const envelope = await store.envelope();
      media.setProjectAssets(envelope.project.assets, store.path);
      return envelope;
    }
    case 'project.open': {
      let path = arg.path;
      if (!path) {
        const selected = await dialog.showOpenDialog(win, {
          title: '打开 CoCraft 工程',
          properties: ['openDirectory'],
        });
        if (selected.canceled) return null;
        path = selected.filePaths[0];
      }
      store = await library.open(extname(path) === '.json' ? dirname(path) : path);
      const e = await store.envelope();
      media.setProjectAssets(e.project.assets, store.path);
      return e;
    }
    case 'project.reveal':
      shell.showItemInFolder(join(store.path, 'project.json'));
      return true;
    case 'project.edit': {
      const target = store;
      if (arg.projectId && (await target.project()).id !== arg.projectId) throw new Error('工程已经切换');
      for (const op of (arg.operations || []) as EditOperation[]) {
        if (op.type === 'addAsset' || op.type === 'relinkAsset') {
          throw new Error('请使用专用素材导入或重连接口登记本地文件');
        }
      }
      if (arg.operations.some((op: EditOperation) => op.type === 'putComponent'))
        await jobs.validateComponents(
          applyOperations(await target.project(), arg.operations, 'you'),
          arg.operations,
        );
      const e = await target.edit(arg);
      await changed(target, e);
      return e;
    }
    case 'project.undo': {
      const target = store;
      const e = await target.undo();
      await changed(target, e);
      return e;
    }
    case 'project.redo': {
      const target = store;
      const e = await target.redo();
      await changed(target, e);
      return e;
    }
    case 'project.restore': {
      const target = store;
      const e = await target.restore(arg.revision);
      await changed(target, e);
      return e;
    }
    case 'project.snapshot':
      return store.snapshot(arg.revision);
    case 'project.forkFromRevision': {
      const target = store;
      const rev = Number(arg.revision);
      const snap = await target.snapshot(rev);
      const current = await target.project();
      const sourceSeq = snap.sequences.find((s) => s.id === arg.sequenceId) || snap.sequences[0];
      if (!sourceSeq) throw new Error('历史版本成片不存在');
      const newSeqId = uid('seq');
      const branchLabel = String(arg.branchName || `${sourceSeq.name}-源自v${rev}`).trim();
      const ops: EditOperation[] = [];
      for (const comp of snap.components) {
        if (!current.components.some((c) => c.id === comp.id)) ops.push({ type: 'putComponent', component: comp });
      }
      for (const asset of snap.assets) {
        if (!current.assets.some((a) => a.id === asset.id)) ops.push({ type: 'addAsset', asset });
      }
      ops.push({
        type: 'addSequence',
        sequence: {
          ...structuredClone(sourceSeq),
          id: newSeqId,
          name: branchLabel,
          branchName: branchLabel,
          parentSequenceId: sourceSeq.id,
          forkedAtRevision: rev,
          isMainBranch: false,
          clips: sourceSeq.clips.map((c) => ({ ...structuredClone(c), id: uid('clip'), locked: false })),
        },
      });
      const envelope = await target.edit({
        baseRevision: current.revision,
        name: `从 v${rev} 派生平行分支「${branchLabel}」`,
        operations: ops,
      });
      await changed(target, envelope);
      return { envelope, newSequenceId: newSeqId };
    }
    case 'media.import': {
      let paths = arg.paths;
      if (!paths) {
        const d = await dialog.showOpenDialog(win, {
          title: '导入素材',
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: '视频、图片、音频与 3D 模型',
              extensions: [
                'mp4',
                'mov',
                'm4v',
                'webm',
                'mkv',
                'png',
                'jpg',
                'jpeg',
                'webp',
                'svg',
                'gif',
                'mp3',
                'wav',
                'm4a',
                'aac',
                'flac',
                'glb',
                'gltf',
              ],
            },
          ],
        });
        if (d.canceled) return null;
        paths = d.filePaths;
      }
      return importFiles(paths, arg.append, arg.sequenceId);
    }
    case 'media.relink': {
      const target = store;
      const p = await target.project();
      const asset = p.assets.find((a) => a.id === arg.assetId);
      if (!asset) throw new Error('待重连的资产不存在');
      let filePath: string | undefined = arg.path;
      if (!filePath) {
        const d = await dialog.showOpenDialog(win, {
          title: `重新定位「${asset.name}」`,
          properties: ['openFile'],
          filters: [
            {
              name:
                asset.kind === 'image'
                  ? '图片'
                  : asset.kind === 'audio'
                    ? '音频'
                    : asset.kind === 'model-3d'
                      ? '3D 模型'
                      : '视频',
              extensions:
                asset.kind === 'image'
                  ? ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif']
                  : asset.kind === 'audio'
                    ? ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
                    : asset.kind === 'model-3d'
                      ? ['glb', 'gltf']
                      : ['mp4', 'mov', 'm4v', 'webm', 'mkv'],
            },
          ],
        });
        if (d.canceled || !d.filePaths[0]) return null;
        filePath = d.filePaths[0];
      }
      const thumbDir = join(target.path, '.cocraft', 'thumbnails');
      const tempThumb =
        asset.kind === 'video' ? join(thumbDir, `${asset.id}.relink-${Date.now()}.jpg`) : undefined;
      const finalThumb = asset.kind === 'video' ? join(thumbDir, `${asset.id}.jpg`) : undefined;
      let probed: Asset;
      try {
        probed = await importMedia(filePath, target.path, asset.id, { thumbnailPath: tempThumb });
      } catch (err) {
        if (tempThumb) await rm(tempThumb, { force: true }).catch(() => {});
        throw err;
      }
      if (probed.kind !== asset.kind) {
        if (tempThumb) await rm(tempThumb, { force: true }).catch(() => {});
        throw new Error('所选文件类型与原资产不一致');
      }
      const sameContent = Boolean(asset.sha256 && probed.sha256 && asset.sha256 === probed.sha256);
      const lockedRefs = p.sequences.flatMap((s) =>
        s.clips.filter(
          (c) =>
            c.locked &&
            (c.assetId === asset.id || c.takes?.some((t) => t.assetId === asset.id)),
        ),
      );
      if (!sameContent && lockedRefs.length > 0 && arg.mode === 'fork-unlocked') {
        const newAssetId = uid('asset');
        let forkedThumb = probed.thumbnail;
        if (tempThumb && existsSync(tempThumb)) {
          forkedThumb = join(thumbDir, `${newAssetId}.jpg`);
          await rename(tempThumb, forkedThumb);
        }
        const forkedAsset: Asset = { ...probed, id: newAssetId, thumbnail: forkedThumb };
        const ops: EditOperation[] = [{ type: 'addAsset', asset: forkedAsset }];
        for (const seq of p.sequences) {
          for (const clip of seq.clips) {
            if (clip.locked) continue;
            const changes: Partial<typeof clip> = {};
            if (clip.assetId === asset.id) changes.assetId = newAssetId;
            if (clip.takes?.some((t) => t.assetId === asset.id)) {
              changes.takes = clip.takes.map((t) =>
                t.assetId === asset.id ? { ...clone(t), assetId: newAssetId } : clone(t),
              );
            }
            if (Object.keys(changes).length > 0) {
              ops.push({ type: 'updateClip', sequenceId: seq.id, clipId: clip.id, changes });
            }
          }
        }
        const e = await target.edit({
          baseRevision: p.revision,
          name: `派生新素材替换未锁定镜头「${asset.name}」`,
          operations: ops,
        });
        await changed(target, e);
        return e;
      }
      try {
        const e = await target.edit({
          baseRevision: p.revision,
          name: sameContent ? `找回原素材「${asset.name}」` : `重连并替换素材「${asset.name}」`,
          operations: [
            {
              type: 'relinkAsset',
              assetId: asset.id,
              path: probed.path,
              sha256: probed.sha256,
              byteSize: probed.byteSize,
              duration: probed.duration,
              width: probed.width,
              height: probed.height,
              thumbnail: finalThumb || probed.thumbnail,
              waveform: probed.waveform,
              hasAudio: probed.hasAudio,
              clearTranscript: !sameContent,
            },
          ],
        });
        if (tempThumb && finalThumb && existsSync(tempThumb)) {
          await rename(tempThumb, finalThumb);
        }
        if (!sameContent) {
          await rm(join(target.path, '.cocraft', 'analysis', `transcript-${asset.id}.json`), {
            force: true,
          }).catch(() => {});
        }
        await changed(target, e);
        return e;
      } catch (err) {
        if (tempThumb) await rm(tempThumb, { force: true }).catch(() => {});
        throw err;
      }
    }
    case 'captions.import': {
      const target = store;
      let text = arg.text;
      if (!text) {
        const d = await dialog.showOpenDialog(win, {
          title: '导入字幕',
          properties: ['openFile'],
          filters: [{ name: 'SubRip 字幕', extensions: ['srt'] }],
        });
        if (d.canceled) return null;
        text = await readFile(d.filePaths[0], 'utf8');
      }
      const p = await target.project(),
        s = p.sequences.find((s) => s.id === arg.sequenceId) || p.sequences[0];
      const clips = parseSRTText(text, s.fps);
      if (!clips.length) throw new Error('没有读取到有效的 SRT 字幕');
      const e = await target.edit({
        baseRevision: p.revision,
        name: `导入 ${clips.length} 条字幕`,
        operations: clips.map((clip) => ({ type: 'addClip', sequenceId: s.id, clip })),
      });
      await changed(target, e);
      return e;
    }
    case 'captions.export': {
      const p = await store.project(),
        s = p.sequences.find((s) => s.id === arg.sequenceId);
      if (!s) throw new Error('成片不存在');
      const stamp = (f: number) => {
        const ms = Math.round((f / s.fps) * 1000);
        return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
      };
      const content = s.clips
        .filter((c) => c.kind === 'caption')
        .sort((a, b) => a.start - b.start)
        .map(
          (c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.start + c.duration)}\n${c.props.text || ''}\n`,
        )
        .join('\n');
      const d = await dialog.showSaveDialog(win, {
        defaultPath: join(store.path, 'exports', sanitizeFileName(s.name, 'captions') + '.srt'),
        filters: [{ name: '字幕', extensions: ['srt'] }],
      });
      if (d.canceled || !d.filePath) return null;
      await writeFile(d.filePath, content);
      return d.filePath;
    }
    case 'code.compile': {
      const target = store;
      const existing = (await target.project()).components.find((c) => c.id === arg.id);
      const pack = existing?.pack;
      const component = await compileComponent(
        arg.source,
        arg.id || uid('component'),
        arg.name || '自定义画面',
        target.path,
        arg.props,
        pack ? dirname(join(pack.sourceDirectory, pack.entry || 'index.tsx')) : target.path,
      );
      return pack ? { ...component, pack } : component;
    }
    case 'studio.add': {
      const target = store;
      const result = await addStudioAsset(target, studioMedia, arg.id, arg.sequenceId, arg.at, arg.projectId);
      await changed(target, result.envelope);
      return result;
    }
    case 'packs.import': {
      const target = store;
      let directory = join(resources, 'packs', 'studio-signature');
      if (arg.directory) {
        directory = String(arg.directory);
      } else if (!arg.example) {
        const picked = await dialog.showOpenDialog(win, {
          title: '选择含 cocraft-pack.json 的素材包',
          properties: ['openDirectory'],
        });
        if (picked.canceled) return null;
        directory = picked.filePaths[0];
      }
      const project = await target.project();
      const pack = await importMaterialPack(directory, target.path, project);
      if (!pack.operations.length) return target.envelope();
      await jobs.validateComponents(applyOperations(project, pack.operations, 'you'), pack.operations);
      const next = await target.edit({
        baseRevision: project.revision,
        name: '导入素材包 · ' + pack.packName,
        operations: pack.operations,
      });
      await changed(target, next);
      return next;
    }
    case 'tasks.model': {
      const target = store;
      if (
        arg.modelId &&
        !(await settings.get()).models.some((m) => m.id === arg.modelId && m.capabilities.includes('agent'))
      )
        throw new Error('会话模型已移除');
      return target.updateTaskDetails(arg.id, { modelId: arg.modelId || undefined });
    }
    case 'tasks.rename':
      return store.updateTaskDetails(arg.id, { name: String(arg.name || '') });
    case 'tasks.retarget':
      return store.updateTaskDetails(arg.id, { sequenceId: String(arg.sequenceId || '') });
    case 'tasks.delete': {
      const target = store;
      await target.deleteTask(arg.id);
      const e = await target.envelope();
      await changed(target, e);
      return e;
    }
    case 'tasks.create': {
      const task: Task = {
        id: uid('task'),
        name: arg.name || '新会话',
        modelId: arg.modelId || undefined,
        sequenceId: arg.sequenceId,
        createdAt: new Date().toISOString(),
        messages: [],
        status: 'idle',
      };
      await store.saveTask(task);
      return task;
    }
    case 'agent.attachFiles': {
      let paths: string[] = Array.isArray(arg.paths) ? arg.paths.map(String).filter(Boolean) : [];
      if (!paths.length) {
        const picked = await dialog.showOpenDialog(win, {
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
    }
    case 'agent.attachPaste': {
      const target = store;
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
      return await buildComposerAttachment(filePath, String(arg.name || `粘贴图片.${safeExt}`));
    }
    case 'agent.start': {
      const target = store;
      return agents.start(
        target,
        arg.taskId,
        arg.prompt,
        async () => settings.agent(arg.modelId, (await target.project()).modelDefaults),
        arg.context || '',
        arg.scope,
        {
          thinkingLevel: arg.thinkingLevel,
          attachments: arg.attachments,
          skillIds: arg.skillIds,
        },
      );
    }
    case 'agent.stop':
      return agents.stop(arg.taskId);
    case 'providers.inspect':
      return generation.inspectProvider(arg);
    case 'generation.start':
      return generation.start(store, arg);
    case 'generation.resume':
      return generation.resume(arg.id);
    case 'settings.get':
      return settings.get();
    case 'settings.save': {
      const s = await settings.save(arg);
      nativeTheme.themeSource = s.theme;
      if (s.mcpBridgeEnabled) {
        await mcpBridge.start().catch((err) => console.error('启动本地 MCP 服务失败', err));
      } else {
        await mcpBridge.stop().catch(() => {});
      }
      emit('settings', s);
      return s;
    }
    case 'mcp.status':
      return { ...mcpBridge.status(), clientConfigJson: mcpBridge.clientConfigJson() };
    case 'mcp.copyConfig': {
      const json = mcpBridge.clientConfigJson();
      clipboard.writeText(json);
      return { copied: true, clientConfigJson: json };
    }
    case 'export.preflight': {
      const p = await store.project();
      const missing = p.assets.filter((a) => a.path && !existsSync(a.path)).map((a) => a.id);
      return preflightSequence(p, arg.sequenceId, missing);
    }
    case 'export.start': {
      const target = store;
      const p = await target.project(),
        seq = p.sequences.find((s) => s.id === arg.sequenceId)!;
      if (!seq) throw new Error('成片不存在');
      if (!seq.clips.length) throw new Error('先添加一些画面，再导出成片');
      const missing = p.assets.filter((a) => a.path && !existsSync(a.path)).map((a) => a.id);
      const issues = preflightSequence(p, seq.id, missing);
      const blocker = issues.find((i) => i.severity === 'blocker');
      if (blocker) throw new Error(`${blocker.title}：${blocker.detail}`);
      const name = `${sanitizeFileName(seq.name, 'film')}-v${p.revision}-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
      let output = join(target.path, 'exports', name);
      if (arg.choose) {
        const d = await dialog.showSaveDialog(win, {
          title: '导出成片',
          defaultPath: output,
          filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
        });
        if (d.canceled || !d.filePath) return null;
        output = d.filePath;
      }
      return jobs.render(p, seq.id, output, { scale: arg.scale || 1, projectPath: target.path });
    }
    case 'export.still': {
      const p = await store.project();
      const output = join(store.path, 'exports', `画面-v${p.revision}-${Date.now()}.png`);
      return jobs.render(p, arg.sequenceId, output, { still: true, frame: arg.frame || 0, scale: 1 });
    }
    case 'jobs.cancel':
      await jobs.cancel(arg.id);
      return true;
    case 'jobs.clear':
      return jobs.clearFinished();
    case 'file.reveal': {
      const job = jobs.jobs.find((j) => j.id === arg.jobId);
      if (job?.output) shell.showItemInFolder(job.output);
      return true;
    }
    case 'file.open': {
      const job = jobs.jobs.find((j) => j.id === arg.jobId);
      if (job?.output && job.status === 'completed') await shell.openPath(job.output);
      return true;
    }
    case 'link.open': {
      const url = new URL(arg.url);
      if (url.protocol !== 'https:') throw new Error('只支持 HTTPS 链接');
      await shell.openExternal(url.href);
      return true;
    }
    case 'skills.list':
      return listSkills();
    case 'skills.save': {
      const scope = arg.scope === 'user' ? 'user' : 'project';
      const rawSlug = String(arg.slug || arg.name || '')
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(rawSlug)) {
        throw new Error('Skill 标识仅支持 2~49 位小写字母、数字、中划线或下划线，且以字母或数字开头');
      }
      const description = String(arg.description || '').replace(/\r?\n/g, ' ').trim();
      const body = String(arg.body || '').trim();
      if (!description || !body) throw new Error('请填写 Skill 简介和规范正文');
      const root = scope === 'user' ? join(app.getPath('userData'), 'skills') : join(store.path, 'skills');
      const skillDir = join(root, rawSlug);
      await mkdir(skillDir, { recursive: true });
      const content = `---\nname: ${rawSlug}\ndescription: ${description}\n---\n\n${body}\n`;
      await writeFile(join(skillDir, 'SKILL.md'), content, 'utf8');
      return listSkills();
    }
    case 'skills.delete': {
      if (arg.scope === 'builtin') throw new Error('内置规范不支持删除，可在项目内新建覆盖');
      const scope = arg.scope === 'user' ? 'user' : 'project';
      const root = await realpathSafe(
        scope === 'user' ? join(app.getPath('userData'), 'skills') : join(store.path, 'skills'),
      );
      const list = await listSkills();
      const target = list.find((s) => s.scope === scope && s.name === String(arg.name || ''));
      if (!target) throw new Error('未找到指定的自定义 Skill');
      const skillFile = await realpathSafe(target.path);
      const skillDir = dirname(skillFile);
      if (dirname(skillDir) !== root) throw new Error('Skill 路径无效');
      await rm(skillDir, { recursive: true, force: true });
      return listSkills();
    }
    case 'skills.import': {
      let sourcePath = arg.sourcePath ? String(arg.sourcePath) : '';
      if (!sourcePath) {
        const picked = await dialog.showOpenDialog(win, {
          title: '导入 SKILL.md',
          properties: ['openFile'],
          filters: [{ name: 'Skill 文档', extensions: ['md'] }],
        });
        if (picked.canceled || !picked.filePaths[0]) return null;
        sourcePath = picked.filePaths[0];
      }
      if (extname(sourcePath).toLowerCase() !== '.md') {
        throw new Error('仅支持导入 .md 格式的 Skill 文档');
      }
      const info = await stat(sourcePath);
      if (!info.isFile() || info.size > 512 * 1024) {
        throw new Error('Skill 文档无效或体积超过 512KB 上限');
      }
      const raw = await readFile(sourcePath, 'utf8');
      const parsed = parseSkillMarkdown(raw, basename(dirname(sourcePath)));
      const scope = arg.scope === 'user' ? 'user' : 'project';
      const root = scope === 'user' ? join(app.getPath('userData'), 'skills') : join(store.path, 'skills');
      const skillDir = join(root, parsed.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---\nname: ${parsed.name}\ndescription: ${parsed.description || parsed.name}\n---\n\n${parsed.body}\n`,
        'utf8',
      );
      return listSkills();
    }
    case 'skills.open':
      await mkdir(join(store.path, 'skills'), { recursive: true });
      await shell.openPath(join(store.path, 'skills'));
      return true;
    case 'stock.search': {
      const pexelsKey = await settings.stockKey();
      if (!pexelsKey) throw new Error('在设置中填写 Pexels API Key，即可搜索视频素材。');
      const response = await fetch(
        'https://api.pexels.com/v1/videos/search?' +
          new URLSearchParams({
            query: arg.query,
            per_page: '12',
            orientation: arg.orientation || 'landscape',
          }),
        { headers: { Authorization: pexelsKey } },
      );
      if (!response.ok) throw new Error(`Pexels 搜索失败 (${response.status})`);
      const data = (await response.json()) as any;
      return data.videos.map((v: any) => {
        const files = v.video_files
          .filter((f: any) => f.file_type === 'video/mp4')
          .sort((a: any, b: any) => Math.abs(a.width - 1920) - Math.abs(b.width - 1920));
        const f = files[0];
        const item: StockVideo = {
          id: v.id,
          name: `Pexels · ${v.id}`,
          thumbnail: v.image,
          url: v.url,
          download: f?.link,
          author: v.user.name,
          duration: v.duration,
          width: f?.width,
          height: f?.height,
        };
        knownStock.set(item.id, item);
        return item;
      });
    }
    case 'stock.import': {
      // Capture target store BEFORE async network download to prevent cross-project race condition!
      const target = store;
      const item = knownStock.get(arg.id);
      if (!item?.download) throw new Error('请先重新搜索这条素材');
      const file = join(target.path, 'assets', `pexels-${item.id}-${Date.now()}.mp4`);
      await mkdir(dirname(file), { recursive: true });
      await downloadToFile(item.download, file, new AbortController().signal);
      const asset = await importMedia(file, target.path);
      asset.source = { provider: 'Pexels', url: item.url, author: item.author, license: 'Pexels License' };
      const p = await target.project();
      const e = await target.edit({
        baseRevision: p.revision,
        name: '添加 Pexels 素材',
        operations: [{ type: 'addAsset', asset }],
      });
      await changed(target, e);
      return e;
    }
    case 'voice.generate': {
      const target = store;
      const job = await generation.start(target, {
        use: 'speech',
        prompt: arg.text,
        parameters: arg.rate ? { rate: arg.rate } : {},
      });
      await generation.wait(job.id);
      return target.envelope();
    }
    case 'vault.list':
      return globalVault.list();
    case 'vault.promote':
      return globalVault.promoteFromProject(store, arg);
    case 'vault.pull': {
      const target = store;
      const res = await globalVault.pullToProject(target, String(arg.id));
      await changed(target, res.envelope);
      return res;
    }
    case 'vault.remove':
    case 'vault.removeGlobal':
      return globalVault.removeGlobal(String(arg.id));
    case 'packs.export': {
      let targetDir = arg.targetDir ? String(arg.targetDir) : '';
      if (!targetDir) {
        const picked = await dialog.showOpenDialog(win, {
          title: '选择素材包导出目录',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (picked.canceled || !picked.filePaths[0]) return null;
        targetDir = picked.filePaths[0];
      }
      return exportMaterialPack(store, {
        targetDir,
        name: arg.name,
        assetIds: arg.assetIds,
        componentIds: arg.componentIds,
        vaultIds: arg.vaultIds,
      });
    }
    case 'stage.captureReference': {
      const target = store;
      const p = await target.project();
      const seq = p.sequences.find((s) => s.id === arg.sequenceId) || p.sequences[0];
      const frame = Math.max(0, Math.round(Number(arg.frame ?? 0)));
      const assetsDir = join(target.path, 'assets');
      await mkdir(assetsDir, { recursive: true });
      const fileName = `previs-${uid('frame')}.png`;
      const outPath = join(assetsDir, fileName);
      const job = await jobs.render(p, seq.id, outPath, {
        still: true,
        frame,
        scale: 1,
        silent: true,
      });
      await jobs.wait(job.id);
      const asset = await importMedia(outPath, target.path);
      asset.name = arg.name || `透视构图参考 · ${seq.name} f${frame}`;
      asset.role = 'environment';
      asset.tags = ['透视参考', '舞台抽帧'];
      asset.category = 'subject';
      asset.subkind = 'environment';
      asset.derivedFrom = [
        {
          via: 'capture-3d',
          note: `捕获自成片「${seq.name}」第 ${frame} 帧`,
        },
      ];
      const vaultItem: VaultItem = {
        id: uid('pvault'),
        name: asset.name,
        entityKind: 'image',
        role: 'environment',
        tags: ['透视参考', '舞台抽帧'],
        category: 'subject',
        subkind: 'environment',
        description: `捕获自「${seq.name}」第 ${frame} 帧，可用作分镜生图/生视频的精确透视构图参考。`,
        promptAnchor: arg.promptAnchor || '严格对齐参考图中的三维透视机位、主体方位与光影构图',
        assetId: asset.id,
        assetKind: 'image',
        derivedFrom: asset.derivedFrom,
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      const envelope = await target.edit({
        baseRevision: p.revision,
        name: `捕获预演构图真值「${asset.name}」`,
        operations: [
          { type: 'addAsset', asset },
          { type: 'putVaultItem', item: vaultItem },
        ],
      });
      await changed(target, envelope);
      return { envelope, asset, vaultItem };
    }
    case 'asset.extractFrame': {
      const target = store;
      const p = await target.project();
      const src = p.assets.find((a) => a.id === arg.assetId);
      if (!src || src.kind !== 'video') throw new Error('仅支持对视频素材抽取静态帧');
      if (src.offline || !existsSync(src.path)) throw new Error('视频素材文件离线或不存在');
      const mode: 'first' | 'last' | 'time' =
        arg.mode === 'last' ? 'last' : arg.mode === 'time' ? 'time' : 'first';
      const dur = Math.max(0, src.duration || 0);
      const targetSec =
        mode === 'last'
          ? Math.max(0, dur - 0.12)
          : mode === 'time'
            ? Math.max(0, Math.min(dur > 0.1 ? dur - 0.05 : 0, Number(arg.seconds ?? 0)))
            : 0;
      const assetsDir = join(target.path, 'assets');
      await mkdir(assetsDir, { recursive: true });
      const outPath = join(assetsDir, `frame-${uid('ext')}.png`);
      await run(binary('ffmpeg'), [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        targetSec.toFixed(3),
        '-i',
        src.path,
        '-frames:v',
        '1',
        outPath,
      ]);
      const frameAsset = await importMedia(outPath, target.path);
      const tagLabel = mode === 'last' ? '尾帧' : mode === 'time' ? `${targetSec.toFixed(1)}s 帧` : '首帧';
      const baseTitle = src.name.replace(/\.[^.]+$/, '').slice(0, 22);
      frameAsset.name = `${baseTitle} · ${tagLabel}`;
      frameAsset.derivedFrom = [
        {
          assetId: src.id,
          via: 'extract-frame',
          note: `抽取${tagLabel}`,
        },
      ];
      const ops: EditOperation[] = [{ type: 'addAsset', asset: frameAsset }];
      if (arg.placement && Number.isFinite(arg.placement.x) && Number.isFinite(arg.placement.y)) {
        ops.push({
          type: 'updateProject',
          changes: {
            canvasLayout: {
              ...(p.canvasLayout || {}),
              [`asset:${frameAsset.id}`]: {
                x: Math.round(arg.placement.x),
                y: Math.round(arg.placement.y),
              },
            },
          },
        });
      }
      const envelope = await target.edit({
        baseRevision: p.revision,
        name: `抽取视频${tagLabel}「${frameAsset.name}」`,
        operations: ops,
      });
      await changed(target, envelope);
      return { envelope, asset: frameAsset };
    }
    case 'asset.detachAudio': {
      const target = store;
      const p = await target.project();
      const src = p.assets.find((a) => a.id === arg.assetId);
      if (!src || src.kind !== 'video') throw new Error('仅支持对视频素材提取音轨');
      if (src.offline || !existsSync(src.path)) throw new Error('视频素材文件离线或不存在');
      const assetsDir = join(target.path, 'assets');
      await mkdir(assetsDir, { recursive: true });
      const outPath = join(assetsDir, `audio-${uid('ext')}.wav`);
      try {
        await run(binary('ffmpeg'), [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          src.path,
          '-vn',
          '-c:a',
          'pcm_s16le',
          '-ar',
          '44100',
          outPath,
        ]);
      } catch (err) {
        await rm(outPath, { force: true }).catch(() => {});
        if (String(err).includes('matches no streams') || String(err).includes('Stream map')) {
          throw new Error('该视频不包含可提取的音轨');
        }
        throw err;
      }
      const audioAsset = await importMedia(outPath, target.path);
      const baseTitle = src.name.replace(/\.[^.]+$/, '').slice(0, 22);
      audioAsset.name = `${baseTitle} · 提取音轨`;
      audioAsset.derivedFrom = [
        {
          assetId: src.id,
          via: 'detach-audio',
          note: '提取音轨',
        },
      ];
      const ops: EditOperation[] = [{ type: 'addAsset', asset: audioAsset }];
      if (arg.placement && Number.isFinite(arg.placement.x) && Number.isFinite(arg.placement.y)) {
        ops.push({
          type: 'updateProject',
          changes: {
            canvasLayout: {
              ...(p.canvasLayout || {}),
              [`asset:${audioAsset.id}`]: {
                x: Math.round(arg.placement.x),
                y: Math.round(arg.placement.y),
              },
            },
          },
        });
      }
      const envelope = await target.edit({
        baseRevision: p.revision,
        name: `提取视频音轨「${audioAsset.name}」`,
        operations: ops,
      });
      await changed(target, envelope);
      return { envelope, asset: audioAsset };
    }
    default:
      throw new Error('未知操作：' + method);
  }
}

async function realpathSafe(target: string) {
  try {
    const { realpath } = await import('node:fs/promises');
    return await realpath(target);
  } catch {
    return resolve(target);
  }
}

function parseSkillMarkdown(source: string, fallbackSlug: string) {
  const normalized = source.replace(/\r\n/g, '\n');
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = fmMatch ? fmMatch[1] : '';
  const body = (fmMatch ? fmMatch[2] : normalized).trim();
  const rawName = (fm.match(/^name:\s*(.+)$/m)?.[1] || fallbackSlug || 'custom-skill')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  const name = /^[a-z0-9]/.test(rawName) && rawName.length >= 2 ? rawName.slice(0, 48) : 'custom-skill';
  const description = (fm.match(/^description:\s*(.+)$/m)?.[1] || '').trim();
  return { name, description, body };
}

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
      const thumb = Math.max(sz.width, sz.height) > 120 ? img.resize(sz.width >= sz.height ? { width: 120 } : { height: 120 }) : img;
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

async function listSkills(): Promise<SkillInfo[]> {
  const result: SkillInfo[] = [];
  const seen = new Set<string>();
  const roots: [string, SkillInfo['scope']][] = [
    [join(store.path, 'skills'), 'project'],
    [join(app.getPath('userData'), 'skills'), 'user'],
    [join(resources, 'skills'), 'builtin'],
  ];
  for (const [root, scope] of roots) {
    for (const f of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!f.isDirectory()) continue;
      const path = join(root, f.name, 'SKILL.md');
      try {
        const source = await readFile(path, 'utf8');
        const parsed = parseSkillMarkdown(source, f.name);
        if (seen.has(parsed.name)) continue;
        seen.add(parsed.name);
        result.push({
          name: parsed.name,
          title: friendlySkillTitle(parsed.name),
          description: parsed.description,
          path,
          scope,
          body: parsed.body,
        });
      } catch {}
    }
  }
  return result;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1536,
    height: 980,
    minWidth: 1080,
    minHeight: 720,
    title: 'CoCraft',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#101218',
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') void shell.openExternal(parsed.toString());
    } catch {}
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  if (process.env.COCRAFT_DEV_URL) await win.loadURL(process.env.COCRAFT_DEV_URL);
  else await win.loadFile(join(here, 'renderer/index.html'));
}

async function runBuiltInAgentFromMcp(params: Record<string, unknown>): Promise<unknown> {
  const target = store;
  const prompt = String(params.prompt || '').trim();
  if (!prompt) throw new Error('prompt 不能为空');
  const p = await target.project();
  const seqId = String(params.sequenceId || p.sequences[0]?.id || '');
  let taskId = typeof params.taskId === 'string' ? params.taskId : '';
  if (!taskId) {
    const task: Task = {
      id: uid('task'),
      name: `MCP 协同 · ${prompt.slice(0, 18)}`,
      modelId: typeof params.modelId === 'string' ? params.modelId : undefined,
      sequenceId: seqId,
      createdAt: new Date().toISOString(),
      messages: [],
      status: 'idle',
    };
    await target.saveTask(task);
    taskId = task.id;
  }
  const modelOverride = typeof params.modelId === 'string' ? params.modelId : undefined;
  await agents.start(
    target,
    taskId,
    prompt,
    async () => settings.agent(modelOverride, (await target.project()).modelDefaults),
    typeof params.context === 'string' ? params.context : '',
    undefined,
    {
      thinkingLevel:
        params.thinkingLevel === 'off' ||
        params.thinkingLevel === 'low' ||
        params.thinkingLevel === 'medium' ||
        params.thinkingLevel === 'high'
          ? params.thinkingLevel
          : undefined,
    },
  );
  const timeoutMs = Math.max(10000, Math.min(300000, Number(params.timeoutMs ?? 180000)));
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 400));
    const tasks = await target.tasks();
    const cur = tasks.find((t) => t.id === taskId);
    if (cur && cur.status !== 'running') {
      const latest = await target.project();
      const lastAssistant = [...cur.messages].reverse().find((m) => m.role === 'assistant');
      const toolMessages = cur.messages.filter((m) => m.role === 'tool' && m.tool);
      return {
        taskId,
        status: cur.status,
        revision: latest.revision,
        reply: lastAssistant?.text || '',
        toolCalls: toolMessages.map((m) => ({ name: m.tool, text: m.text.slice(0, 140) })),
      };
    }
  }
  await agents.stop(taskId);
  throw new Error(`Agent 运行超时 (${Math.round(timeoutMs / 1000)}s)`);
}

app
  .whenReady()
  .then(async () => {
    const root = app.getPath('userData');
    await mkdir(root, { recursive: true });
    library = new Library(root);
    settings = new SettingsStore(root);
    globalVault = new GlobalVault(join(root, 'Library'));
    await globalVault.init();
    nativeTheme.themeSource = (await settings.get()).theme;
    const list = await library.list();
    const createInitialProject = () =>
      process.env.COCRAFT_LEGACY_DEMO === '1'
        ? createDemo(library, resources)
        : library.create('未命名创作');
    if (list.length) {
      try {
        store = await library.open(list[0].path);
      } catch {
        store = await createInitialProject();
      }
    } else store = await createInitialProject();
    for (const task of await store.tasks())
      if (task.status === 'running') {
        task.status = 'idle';
        task.messages.push({
          id: uid('msg'),
          role: 'system',
          text: '上次运行已结束，可继续这个任务。',
          createdAt: new Date().toISOString(),
        });
        await store.saveTask(task);
      }
    media = new MediaServer(join(here, 'renderer'), renderDir, process.env.COCRAFT_DEV_URL);
    await media.start();
    studioMedia = await studioCatalog(resources);
    media.registerStudio(studioMedia);
    media.setProjectAssets((await store.project()).assets, store.path);
    jobs = new JobService(
      root,
      join(here, 'render-worker.mjs'),
      renderDir,
      media,
      (j) => emit('jobs', j),
      app.isPackaged ? undefined : join(here, '..'),
    );
    await jobs.init();
    generation = new GenerationService(settings, jobs, changed, (path) => library.resolveStore(path));
    toolService = new CoCraftToolService({
      appVersion: app.getVersion(),
      getStore: () => store,
      setStore: (next) => {
        store = next;
      },
      library,
      settings,
      jobs,
      generation,
      globalVault,
      getStudioMedia: () => studioMedia,
      changed: (s, e) => changed(s, e),
      importFiles: (paths, append, seqId) => importFiles(paths, append, seqId),
      getMcpStatus: () => mcpBridge.status(),
      runBuiltInAgent: (params) => runBuiltInAgentFromMcp(params),
    });
    agents = new AgentHost(
      join(here, 'agent-worker.mjs'),
      join(resources, 'skills'),
      app.getAppPath(),
      jobs,
      (e) => emit('agent', e),
      (s, e) => void changed(s, e),
      generation,
      studioMedia,
      globalVault,
      join(root, 'skills'),
      toolService,
    );
    const mcpScriptPath = app.isPackaged
      ? join(process.resourcesPath, 'mcp', 'cocraft-mcp.mjs')
      : resolve(here, '../scripts/cocraft-mcp.mjs');
    mcpBridge = new McpBridgeServer(root, app.getVersion(), mcpScriptPath, async (action, params) =>
      toolService.executeMcp(action, params),
    );
    if ((await settings.get()).mcpBridgeEnabled || process.env.COCRAFT_MCP_ENABLED === '1') {
      await mcpBridge.start().catch((err) => console.error('启动本地 MCP 服务失败', err));
    }
    ipcMain.handle('cocraft:call', async (event, method, payload) => {
      if (event.sender.id !== win.webContents.id || event.senderFrame !== win.webContents.mainFrame)
        throw new Error('无权限调用应用接口');
      try {
        return await handle(method, payload || {});
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e));
      }
    });
    const action = (name: string) => () => emit('menu', name);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'CoCraft',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { label: '设置…', accelerator: 'CmdOrCtrl+,', click: action('settings') },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        {
          label: '文件',
          submenu: [
            { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: action('new-project') },
            { label: '新建示例工程', click: action('demo-project') },
            { label: '打开项目', accelerator: 'CmdOrCtrl+O', click: action('open-project') },
            { label: '导入素材', accelerator: 'CmdOrCtrl+I', click: action('import') },
            { type: 'separator' },
            { label: '导出成片', accelerator: 'CmdOrCtrl+E', click: action('export') },
          ],
        },
        {
          label: '编辑',
          submenu: [
            { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: action('undo') },
            { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: action('redo') },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        {
          label: '视图',
          submenu: [
            { label: '命令面板', accelerator: 'CmdOrCtrl+K', click: action('command') },
            { role: 'togglefullscreen' },
            ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
          ],
        },
        { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
      ]),
    );
    await createWindow();
  })
  .catch((e) => {
    console.error(e);
    dialog.showErrorBox('CoCraft 启动失败', String(e));
    app.quit();
  });

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void Promise.allSettled([
    mcpBridge?.stop(),
    agents?.stopAll(),
    jobs?.shutdownWorkers(),
  ])
    .catch(() => {})
    .finally(() => {
      media?.close();
      app.exit(0);
    });
});

app.on('window-all-closed', () => app.quit());
