import { contextBridge, ipcRenderer, webUtils } from 'electron';
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('cocraft', {
    call: (method: string, payload: unknown) => ipcRenderer.invoke('cocraft:call', method, payload),
    on: (channel: string, fn: (data: unknown) => void) => {
      if (!['project', 'agent', 'jobs', 'menu'].includes(channel)) throw new Error('Unknown event');
      const cb = (_: unknown, data: unknown) => fn(data);
      ipcRenderer.on('cocraft:' + channel, cb);
      return () => ipcRenderer.removeListener('cocraft:' + channel, cb);
    },
    pathsForFiles: (files: File[]) => files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  });
}
