const { contextBridge, ipcRenderer } = require('electron');

// 只暴露固定操作，不把 ipcRenderer、文件路径读写或命令执行能力交给页面。
contextBridge.exposeInMainWorld('wenyunDesktop', {
  version: 1,
  downloads: {
    info: () => ipcRenderer.invoke('desktop:download-info'),
    choose: () => ipcRenderer.invoke('desktop:download-choose'),
    disable: () => ipcRenderer.invoke('desktop:download-disable'),
    save: (filename, bytes) => ipcRenderer.invoke('desktop:download-save', filename, bytes),
  },
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  info: () => ipcRenderer.invoke('desktop:info'),
  openDataDirectory: () => ipcRenderer.invoke('desktop:open-data'),
  changeDataDirectory: () => ipcRenderer.invoke('desktop:change-data'),
  openPayment: (order) => ipcRenderer.invoke('desktop:open-payment', order),
  storage: {
    get: (scope, key) => ipcRenderer.invoke('desktop:store', 'get', scope, key),
    all: (scope) => ipcRenderer.invoke('desktop:store', 'all', scope),
    keys: (scope) => ipcRenderer.invoke('desktop:store', 'keys', scope),
    put: (scope, key, value) => ipcRenderer.invoke('desktop:store', 'put', scope, key, value),
    remove: (scope, key) => ipcRenderer.invoke('desktop:store', 'remove', scope, key),
    clear: (scope) => ipcRenderer.invoke('desktop:store', 'clear', scope),
    replace: (scope, values) => ipcRenderer.invoke('desktop:store', 'replace', scope, values),
    flush: () => ipcRenderer.invoke('desktop:flush'),
  },
  agent: {
    ensure: () => ipcRenderer.invoke('desktop:agent-start'),
    login: () => ipcRenderer.invoke('desktop:agent-login'),
  },
  onBeforeClose: (prepare) => {
    const listener = async (_event, id) => {
      try {
        const result = await prepare();
        ipcRenderer.send('desktop:close-ready', id, result);
      } catch (error) {
        ipcRenderer.send('desktop:close-ready', id, { error: String(error?.message || error) });
      }
    };
    ipcRenderer.on('desktop:prepare-close', listener);
    return () => ipcRenderer.removeListener('desktop:prepare-close', listener);
  },
});
