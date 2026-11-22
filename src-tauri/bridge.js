// The native command also checks the window label and the exact loopback origin.
if (window.top === window && location.origin === __CHAT_UI_ORIGIN__) {
  const invoke = (action, value = null) => window.__TAURI__.core.invoke('desktop_request', {action, value});
  Object.defineProperty(window, 'desktop', {value: Object.freeze({
    isTauri: true, practice: __CHAT_UI_PRACTICE__, platform: __CHAT_UI_PLATFORM__, version: __CHAT_UI_VERSION__,
    minimize: () => invoke('minimize'), toggleMaximize: () => invoke('toggleMaximize'), close: () => invoke('close'),
    openExternal: url => invoke('openExternal', url), getSettings: () => invoke('settingsRead'),
    getUiState: () => invoke('uiRead'), saveUiState: state => invoke('uiSave', state),
    getMapState: mode => invoke('mapRead', mode), saveMapState: state => invoke('mapSave', state),
    selectCodexPath: () => invoke('settingsChooseCodex'), resetCodexPath: () => invoke('settingsResetCodex'),
    selectWorkDirectory: () => invoke('settingsChooseWorkspace'), setWorkDirectory: dir => invoke('settingsSetWorkspace', dir),
    onBeforeClose(callback) {
      const flush = async event => {
        const id = event.detail;
        try { await callback(true); }
        catch { await callback(false); await invoke('flushComplete', {id, ok:false}); return; }
        await invoke('flushComplete', {id, ok:true});
      };
      const cancel = () => callback(false);
      window.addEventListener('a2acraft-native-close', flush);
      window.addEventListener('a2acraft-close-cancelled', cancel);
      invoke('flushRegistered').catch(() => {});
      return () => {
        window.removeEventListener('a2acraft-native-close', flush);
        window.removeEventListener('a2acraft-close-cancelled', cancel);
      };
    },
    onWindowState(callback) {
      const update = () => invoke('windowState').then(callback).catch(() => {});
      window.addEventListener('resize', update); update();
      return () => window.removeEventListener('resize', update);
    }
  }), writable: false, configurable:false});
}
