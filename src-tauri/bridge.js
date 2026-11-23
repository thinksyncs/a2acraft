// The native command also checks the window label and the exact loopback origin.
// Before the authenticated origin is known, the native host permits only its
// packaged loading page. Later it permits only the sidecar origin it verified.
if (window.top === window && location.protocol === "http:" && location.hostname === "127.0.0.1") {
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
      // A timeout can lead to a second flush before the first one settles.
      // Only the current request may finish; the native dialog owns cancellation.
      let pending = null;
      const flush = async event => {
        const id = event.detail;
        if (!Number.isSafeInteger(id) || id < 1) return;
        pending = id;
        let ok = true;
        try { await callback(true); } catch { ok = false; }
        if (pending !== id) return;
        pending = null;
        await invoke('flushComplete', {id, ok}).catch(() => {});
      };
      const cancel = () => { pending = null; return callback(false); };
      window.addEventListener('a2acraft-native-close', flush);
      window.addEventListener('a2acraft-close-cancelled', cancel);
      invoke('flushRegistered').catch(() => {});
      return () => {
        pending = null;
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
