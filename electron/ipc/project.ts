import { app, clipboard, dialog, nativeTheme, shell } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { applyOperations, preflightSequence, uid } from '../../src/core/project';
import type { EditOperation } from '../../src/core/types';
import { createDemo } from '../demo';
import type { IpcHandlerMap } from './types';

export const projectIpcHandlers: IpcHandlerMap = {
  boot: async (_arg, ctx) => {
    const store = ctx.getStore();
    const current = await store.envelope();
    ctx.media.setProjectAssets(current.project.assets, store.path);
    return {
      projects: await ctx.library.list(),
      current,
      settings: await ctx.settings.get(),
      jobs: ctx.jobs.jobs,
      studioMedia: ctx.getStudioMedia(),
      previewOrigin: ctx.media.origin,
      version: app.getVersion(),
      skills: await ctx.listSkills(),
      globalVault: await ctx.globalVault.list(),
    };
  },
  'project.list': (_arg, ctx) => ctx.library.list(),
  'project.demo': async (_arg, ctx) => {
    const next = await createDemo(ctx.library, ctx.resources);
    ctx.setStore(next);
    const envelope = await next.envelope();
    ctx.media.setProjectAssets(envelope.project.assets, next.path);
    return envelope;
  },
  'project.create': async (arg, ctx) => {
    const next = await ctx.library.create(String(arg.name || '未命名项目'));
    ctx.setStore(next);
    const envelope = await next.envelope();
    ctx.media.setProjectAssets(envelope.project.assets, next.path);
    return envelope;
  },
  'project.open': async (arg, ctx) => {
    let path = arg.path;
    if (!path) {
      const selected = await dialog.showOpenDialog(ctx.getWin(), {
        title: '打开 CoCraft 工程',
        properties: ['openDirectory'],
      });
      if (selected.canceled) return null;
      path = selected.filePaths[0];
    }
    const next = await ctx.library.open(extname(path) === '.json' ? dirname(path) : path);
    ctx.setStore(next);
    const e = await next.envelope();
    ctx.media.setProjectAssets(e.project.assets, next.path);
    return e;
  },
  'project.reveal': (_arg, ctx) => {
    shell.showItemInFolder(join(ctx.getStore().path, 'project.json'));
    return true;
  },
  'project.edit': async (arg, ctx) => {
    const target = ctx.getStore();
    if (arg.projectId && (await target.project()).id !== arg.projectId) throw new Error('工程已经切换');
    for (const op of (arg.operations || []) as EditOperation[]) {
      if (op.type === 'addAsset' || op.type === 'relinkAsset') {
        throw new Error('请使用专用素材导入或重连接口登记本地文件');
      }
    }
    if (arg.operations.some((op: EditOperation) => op.type === 'putComponent')) {
      await ctx.jobs.validateComponents(
        applyOperations(await target.project(), arg.operations, 'you'),
        arg.operations,
      );
    }
    const e = await target.edit(arg);
    await ctx.changed(target, e);
    return e;
  },
  'project.undo': async (_arg, ctx) => {
    const target = ctx.getStore();
    const e = await target.undo();
    await ctx.changed(target, e);
    return e;
  },
  'project.redo': async (_arg, ctx) => {
    const target = ctx.getStore();
    const e = await target.redo();
    await ctx.changed(target, e);
    return e;
  },
  'project.restore': async (arg, ctx) => {
    const target = ctx.getStore();
    const e = await target.restore(arg.revision);
    await ctx.changed(target, e);
    return e;
  },
  'project.snapshot': (arg, ctx) => ctx.getStore().snapshot(arg.revision),
  'project.forkFromRevision': async (arg, ctx) => {
    const target = ctx.getStore();
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
    await ctx.changed(target, envelope);
    return { envelope, newSequenceId: newSeqId };
  },
  'settings.get': (_arg, ctx) => ctx.settings.get(),
  'settings.save': async (arg, ctx) => {
    const s = await ctx.settings.save(arg);
    nativeTheme.themeSource = s.theme;
    if (s.mcpBridgeEnabled) {
      await ctx.mcpBridge.start().catch((err) => console.error('启动本地 MCP 服务失败', err));
    } else {
      await ctx.mcpBridge.stop().catch(() => {});
    }
    await ctx.mcpClient.syncWithSettings().catch(() => {});
    ctx.emit('settings', s);
    return s;
  },
  'mcp.status': (_arg, ctx) => ({
    ...ctx.mcpBridge.status(),
    clientConfigJson: ctx.mcpBridge.clientConfigJson(),
  }),
  'mcp.copyConfig': (_arg, ctx) => {
    const json = ctx.mcpBridge.clientConfigJson();
    clipboard.writeText(json);
    return { copied: true, clientConfigJson: json };
  },
  'mcp.client.status': (_arg, ctx) => ctx.mcpClient.getStatuses(),
  'mcp.client.refresh': (_arg, ctx) => ctx.mcpClient.listEnabledTools(),
  'mcp.client.test': (arg, ctx) => ctx.mcpClient.testServer(arg.server),
  'export.preflight': async (arg, ctx) => {
    const p = await ctx.getStore().project();
    const missing = p.assets.filter((a) => a.path && !existsSync(a.path)).map((a) => a.id);
    return preflightSequence(p, arg.sequenceId, missing);
  },
  'export.start': async (arg, ctx) => {
    const target = ctx.getStore();
    const p = await target.project();
    const seq = p.sequences.find((s) => s.id === arg.sequenceId)!;
    if (!seq) throw new Error('成片不存在');
    if (!seq.clips.length) throw new Error('先添加一些画面，再导出成片');
    const missing = p.assets.filter((a) => a.path && !existsSync(a.path)).map((a) => a.id);
    const issues = preflightSequence(p, seq.id, missing);
    const blocker = issues.find((i) => i.severity === 'blocker');
    if (blocker) throw new Error(`${blocker.title}：${blocker.detail}`);
    const name = `${ctx.sanitizeFileName(seq.name, 'film')}-v${p.revision}-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
    let output = join(target.path, 'exports', name);
    if (arg.choose) {
      const d = await dialog.showSaveDialog(ctx.getWin(), {
        title: '导出成片',
        defaultPath: output,
        filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
      });
      if (d.canceled || !d.filePath) return null;
      output = d.filePath;
    }
    return ctx.jobs.render(p, seq.id, output, { scale: arg.scale || 1, projectPath: target.path });
  },
  'export.still': async (arg, ctx) => {
    const store = ctx.getStore();
    const p = await store.project();
    const output = join(store.path, 'exports', `画面-v${p.revision}-${Date.now()}.png`);
    return ctx.jobs.render(p, arg.sequenceId, output, { still: true, frame: arg.frame || 0, scale: 1 });
  },
  'jobs.cancel': async (arg, ctx) => {
    await ctx.jobs.cancel(arg.id);
    return true;
  },
  'jobs.clear': (_arg, ctx) => ctx.jobs.clearFinished(),
  'file.reveal': (arg, ctx) => {
    const job = ctx.jobs.jobs.find((j) => j.id === arg.jobId);
    if (job?.output) shell.showItemInFolder(job.output);
    return true;
  },
  'file.open': async (arg, ctx) => {
    const job = ctx.jobs.jobs.find((j) => j.id === arg.jobId);
    if (job?.output && job.status === 'completed') await shell.openPath(job.output);
    return true;
  },
  'link.open': async (arg) => {
    const url = new URL(arg.url);
    if (url.protocol !== 'https:') throw new Error('只支持 HTTPS 链接');
    await shell.openExternal(url.href);
    return true;
  },
};
