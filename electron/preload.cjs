const { contextBridge, ipcRenderer } = require('electron');

// The startup page shares the native window, but only the product's loopback
// document receives a desktop bridge. Main-process IPC also verifies the exact origin.
if (location.protocol === 'http:' && location.hostname === '127.0.0.1') contextBridge.exposeInMainWorld('desktop', Object.freeze({
  isElectron: true,
  platform: process.platform,
  version: process.versions.electron,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  openExternal: url => ipcRenderer.invoke('app:open-external', url),
  getSettings: () => ipcRenderer.invoke('settings:read'),
  getUiState: () => ipcRenderer.invoke('ui:read'),
  saveUiState: state => ipcRenderer.invoke('ui:save', state),
  getMapState: mode => ipcRenderer.invoke('map:read', mode),
  saveMapState: state => ipcRenderer.invoke('map:save', state),
  onBeforeClose: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = async (_event, id) => {
      let error = null;
      try { await callback(true); } catch (cause) { error = String(cause?.message || cause).slice(0, 500); }
      await ipcRenderer.invoke('ui:flush-complete', { id, error }).catch(() => {});
    };
    ipcRenderer.on('ui:flush', listener);
    const cancelled = () => { Promise.resolve().then(() => callback(false)).catch(() => {}); };
    ipcRenderer.on('ui:close-cancelled', cancelled);
    ipcRenderer.invoke('ui:flush-ready').catch(() => {});
    return () => { ipcRenderer.removeListener('ui:flush', listener); ipcRenderer.removeListener('ui:close-cancelled', cancelled); };
  },
  selectCodexPath: () => ipcRenderer.invoke('settings:choose-codex'),
  resetCodexPath: () => ipcRenderer.invoke('settings:reset-codex'),
  selectWorkDirectory: () => ipcRenderer.invoke('settings:choose-workspace'),
  setWorkDirectory: directory => ipcRenderer.invoke('settings:set-workspace',directory),
  onWindowState: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  }
}));
