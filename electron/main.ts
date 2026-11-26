import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { Library, ProjectStore } from './store';
import { SettingsStore } from './settings';
import { MediaServer } from './server';
import { OffscreenCaptureService } from './offscreen-capture';
import { JobService } from './jobs';
import { AgentHost } from './agents';
import { studioCatalog } from './studio-media';
import { GenerationService } from './generation';
import { createDemo } from './demo';
import { importMedia } from './media';
import { GlobalVault } from './vault';
import { McpBridgeServer } from './mcp-bridge';
import { McpClientManager } from './mcp-client';
import { CoCraftToolService } from './tool-service';
import { System1Service } from './system1';
import { dispatchIpcCall, listSkillsFromRoots, type IpcContext } from './ipc/index';
import { inferDefaultAudioAttachMode, newClip, uid } from '../src/core/project';
import type { Asset, EditOperation, ProjectEnvelope, StockVideo, Task } from '../src/core/types';

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
  mcpBridge: McpBridgeServer,
  mcpClient: McpClientManager,
  system1: System1Service,
  ipcContext: IpcContext;

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
  win.once('ready-to-show', () => {
    if (process.env.COCRAFT_HIDDEN_TEST !== '1') win.show();
  });
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
    for (const task of await store.tasks()) {
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
    }
    media = new MediaServer(join(here, 'renderer'), renderDir, process.env.COCRAFT_DEV_URL);
    await media.start();
    studioMedia = await studioCatalog(resources);
    media.registerStudio(studioMedia);
    media.setProjectAssets((await store.project()).assets, store.path);
    const offscreenCapture = new OffscreenCaptureService(media, process.env.COCRAFT_DEV_URL);
    jobs = new JobService(
      root,
      join(here, 'render-worker.mjs'),
      renderDir,
      media,
      (j) => emit('jobs', j),
      app.isPackaged ? undefined : join(here, '..'),
      offscreenCapture,
    );
    await jobs.init();
    system1 = new System1Service(settings, root);
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
    mcpClient = new McpClientManager(settings, app.getVersion());
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
      mcpClient,
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

    ipcContext = {
      getWin: () => win,
      getStore: () => store,
      setStore: (next) => {
        store = next;
      },
      library,
      settings,
      media,
      jobs,
      generation,
      agents,
      globalVault,
      mcpBridge,
      mcpClient,
      system1,
      resources,
      getStudioMedia: () => studioMedia,
      knownStock,
      emit,
      changed,
      importFiles,
      listSkills: () => listSkillsFromRoots(store.path, resources),
      sanitizeFileName,
    };

    ipcMain.handle('cocraft:call', async (event, method, payload) => {
      if (event.sender.id !== win.webContents.id || event.senderFrame !== win.webContents.mainFrame) {
        throw new Error('无权限调用应用接口');
      }
      try {
        return await dispatchIpcCall(method, payload || {}, ipcContext);
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
    mcpClient?.stopAll(),
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
