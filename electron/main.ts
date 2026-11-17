import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename, resolve } from 'node:path';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Library, ProjectStore } from './store';
import { SettingsStore } from './settings';
import { MediaServer } from './server';
import { JobService } from './jobs';
import { AgentHost } from './agents';
import { createDemo } from './demo';
import { importMedia, run, binary } from './media';
import { compileComponent } from './code';
import { newClip, uid, applyOperations } from '../src/core/project';
import type { EditOperation, ProjectEnvelope, StockVideo, Task } from '../src/core/types';

const here = dirname(fileURLToPath(import.meta.url));
if (process.env.COCRAFT_DATA_DIR) app.setPath('userData', resolve(process.env.COCRAFT_DATA_DIR));
app.setName('CoCraft');
let win: BrowserWindow,
  store: ProjectStore,
  library: Library,
  settings: SettingsStore,
  media: MediaServer,
  jobs: JobService,
  agents: AgentHost;
const resources = app.isPackaged ? join(process.resourcesPath, 'resources') : join(here, '../resources');
const renderDir = app.isPackaged ? join(process.resourcesPath, 'render-bundle') : join(here, 'render-bundle');
const knownStock = new Map<number, StockVideo>();
const emit = (channel: string, data: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send('cocraft:' + channel, data);
};
async function changed(target: ProjectStore, envelope: ProjectEnvelope) {
  media.register(envelope.project.assets);
  await library.remember(target);
  if (store.path === target.path) emit('project', envelope);
}
async function importFiles(paths: string[], append = false) {
  const target = store;
  const p = await target.project();
  const operations: EditOperation[] = [];
  let start = Math.max(
    0,
    ...p.sequences[0].clips.filter((c) => c.track === 'visual').map((c) => c.start + c.duration),
  );
  for (const path of paths) {
    const a = await importMedia(path, target.path);
    operations.push({ type: 'addAsset', asset: a });
    if (append) {
      const c = {
        ...newClip(a.kind, start, a.id),
        name: a.name,
        duration: Math.max(1, Math.floor(a.duration * p.sequences[0].fps)),
      };
      operations.push({ type: 'addClip', sequenceId: p.sequences[0].id, clip: c });
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
function parseSRT(text: string, fps: number) {
  const frame = (s: string) => {
    const [h, m, rest] = s.replace(',', '.').split(':');
    return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(rest)) * fps);
  };
  const rows = text
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n/);
  return rows.flatMap((row) => {
    const lines = row.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) return [];
    const [from, to] = lines[ti].split('-->').map((s) => s.trim().split(' ')[0]);
    const start = frame(from),
      end = frame(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [
      {
        ...newClip('caption', start),
        duration: end - start,
        name:
          lines
            .slice(ti + 1)
            .join(' ')
            .slice(0, 24) || '字幕',
        props: {
          text: lines.slice(ti + 1).join('\n'),
          fontSize: 46,
          color: '#fff',
          position: 'bottom' as const,
          background: '#00000080',
          animation: 'none' as const,
        },
      },
    ];
  });
}
async function handle(method: string, arg: any = {}) {
  switch (method) {
    case 'boot':
      return {
        projects: await library.list(),
        current: await store.envelope(),
        settings: await settings.get(),
        jobs: jobs.jobs,
        previewOrigin: media.origin,
        version: app.getVersion(),
        skills: await listSkills(),
      };
    case 'project.list':
      return library.list();
    case 'project.create': {
      store = await library.create(String(arg.name || '未命名项目'));
      media.register((await store.project()).assets);
      return store.envelope();
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
      media.register(e.project.assets);
      return e;
    }
    case 'project.reveal':
      shell.showItemInFolder(join(store.path, 'project.json'));
      return true;
    case 'project.edit': {
      const target = store;
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
    case 'media.import': {
      let paths = arg.paths;
      if (!paths) {
        const d = await dialog.showOpenDialog(win, {
          title: '导入素材',
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: '视频、图片与音频',
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
              ],
            },
          ],
        });
        if (d.canceled) return null;
        paths = d.filePaths;
      }
      return importFiles(paths, arg.append);
    }
    case 'captions.import': {
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
      const p = await store.project(),
        s = p.sequences.find((s) => s.id === arg.sequenceId) || p.sequences[0];
      const clips = parseSRT(text, s.fps);
      if (!clips.length) throw new Error('没有读取到有效的 SRT 字幕');
      const e = await store.edit({
        baseRevision: p.revision,
        name: `导入 ${clips.length} 条字幕`,
        operations: clips.map((clip) => ({ type: 'addClip', sequenceId: s.id, clip })),
      });
      await changed(store, e);
      return e;
    }
    case 'captions.export': {
      const p = await store.project(),
        s = p.sequences.find((s) => s.id === arg.sequenceId)!;
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
        defaultPath: join(store.path, 'exports', s.name + '.srt'),
        filters: [{ name: '字幕', extensions: ['srt'] }],
      });
      if (d.canceled || !d.filePath) return null;
      await writeFile(d.filePath, content);
      return d.filePath;
    }
    case 'code.compile':
      return compileComponent(
        arg.source,
        arg.id || uid('component'),
        arg.name || '自定义画面',
        store.path,
        arg.props,
      );
    case 'tasks.create': {
      const task: Task = {
        id: uid('task'),
        name: arg.name || '新的创作',
        sequenceId: arg.sequenceId,
        createdAt: new Date().toISOString(),
        messages: [],
        status: 'idle',
      };
      await store.saveTask(task);
      return task;
    }
    case 'agent.start':
      return agents.start(store, arg.taskId, arg.prompt, await settings.get(true), arg.context || '');
    case 'agent.stop':
      return agents.stop(arg.taskId);
    case 'settings.get':
      return settings.get();
    case 'settings.save': {
      const s = await settings.save(arg);
      nativeTheme.themeSource = s.theme;
      return s;
    }
    case 'export.start': {
      const p = await store.project(),
        seq = p.sequences.find((s) => s.id === arg.sequenceId)!;
      if (!seq) throw new Error('成片不存在');
      if (!seq.clips.length) throw new Error('先添加一些画面，再导出成片');
      const name = `${seq.name}-v${p.revision}-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
      let output = join(store.path, 'exports', name);
      if (arg.choose) {
        const d = await dialog.showSaveDialog(win, {
          title: '导出成片',
          defaultPath: output,
          filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
        });
        if (d.canceled || !d.filePath) return null;
        output = d.filePath;
      }
      return jobs.render(p, seq.id, output, { scale: arg.scale || 1 });
    }
    case 'export.still': {
      const p = await store.project();
      const output = join(store.path, 'exports', `画面-v${p.revision}-${Date.now()}.png`);
      return jobs.render(p, arg.sequenceId, output, { still: true, frame: arg.frame || 0, scale: 1 });
    }
    case 'jobs.cancel':
      await jobs.cancel(arg.id);
      return true;
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
    case 'skills.open':
      await shell.openPath(join(store.path, 'skills'));
      return true;
    case 'stock.search': {
      const s = await settings.get(true);
      if (!s.pexelsKey) throw new Error('在设置中填写 Pexels API Key，即可搜索视频素材。');
      const response = await fetch(
        'https://api.pexels.com/v1/videos/search?' +
          new URLSearchParams({
            query: arg.query,
            per_page: '12',
            orientation: arg.orientation || 'landscape',
          }),
        { headers: { Authorization: s.pexelsKey } },
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
      const item = knownStock.get(arg.id);
      if (!item?.download) throw new Error('请先重新搜索这条素材');
      const response = await fetch(item.download);
      if (!response.ok) throw new Error('素材下载失败');
      const file = join(store.path, 'assets', `pexels-${item.id}.mp4`);
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      const asset = await importMedia(file, store.path);
      asset.source = { provider: 'Pexels', url: item.url, author: item.author, license: 'Pexels License' };
      const p = await store.project();
      const e = await store.edit({
        baseRevision: p.revision,
        name: '添加 Pexels 素材',
        operations: [{ type: 'addAsset', asset }],
      });
      await changed(store, e);
      return e;
    }
    case 'voice.generate': {
      if (!String(arg.text || '').trim()) throw new Error('先输入配音文稿');
      const file = join(store.path, 'assets', `voice-${Date.now()}.wav`);
      const voices = await run('/usr/bin/say', ['-v', '?']);
      const preferred =
        voices
          .split('\n')
          .find((l) => l.includes('zh_CN'))
          ?.split(/\s{2,}/)[0] || 'Tingting';
      await run('/usr/bin/say', [
        '-v',
        preferred,
        '-r',
        String(arg.rate || 175),
        '--file-format=WAVE',
        '--data-format=LEI16@24000',
        '-o',
        file,
        '--',
        arg.text,
      ]);
      const asset = await importMedia(file, store.path);
      asset.name = '配音 · ' + arg.text.slice(0, 16);
      asset.source = { provider: 'macOS', license: '系统语音' };
      const p = await store.project();
      const e = await store.edit({
        baseRevision: p.revision,
        name: '生成本地配音',
        operations: [{ type: 'addAsset', asset }],
      });
      await changed(store, e);
      return e;
    }
    default:
      throw new Error('未知操作：' + method);
  }
}
async function listSkills() {
  const result = [];
  for (const root of [join(resources, 'skills'), join(store.path, 'skills')]) {
    for (const f of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!f.isDirectory()) continue;
      const path = join(root, f.name, 'SKILL.md');
      try {
        const source = await readFile(path, 'utf8');
        result.push({
          name: source.match(/^name:\s*(.+)$/m)?.[1] || f.name,
          description: source.match(/^description:\s*(.+)$/m)?.[1] || '',
          path,
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
    trafficLightPosition: { x: 18, y: 19 },
    backgroundColor: '#181a1d',
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
    if (url.startsWith('https:')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  if (process.env.COCRAFT_DEV_URL) await win.loadURL(process.env.COCRAFT_DEV_URL);
  else await win.loadFile(join(here, 'renderer/index.html'));
}
app
  .whenReady()
  .then(async () => {
    const root = app.getPath('userData');
    await mkdir(root, { recursive: true });
    library = new Library(root);
    settings = new SettingsStore(root);
    nativeTheme.themeSource = (await settings.get()).theme;
    const list = await library.list();
    if (list.length) {
      try {
        store = await library.open(list[0].path);
      } catch {
        store = await createDemo(library, resources);
      }
    } else store = await createDemo(library, resources);
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
    media.register((await store.project()).assets);
    jobs = new JobService(
      root,
      join(here, 'render-worker.mjs'),
      renderDir,
      media,
      (j) => emit('jobs', j),
      app.isPackaged ? undefined : join(here, '..'),
    );
    await jobs.init();
    agents = new AgentHost(
      join(here, 'agent-worker.mjs'),
      join(resources, 'skills'),
      app.getAppPath(),
      jobs,
      (e) => emit('agent', e),
      (s, e) => void changed(s, e),
    );
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
app.on('window-all-closed', () => app.quit());
