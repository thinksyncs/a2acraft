import {randomUUID} from 'node:crypto';

// Opening an already-running app must reveal hidden windows, not only focus
// them. All callers pass an app-owned window; no other apps are inspected.
export function revealWindow(window) {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return true;
}

// A failed save may be reported after the user hid or minimized the app.
// Reveal only the supplied app-owned window before presenting its decision.
export function revealForDialog(window, present) {
  return present(revealWindow(window) ? window : undefined);
}

export async function waitForWindowLoad(window, url, {timeoutMs = 30000, canReveal = () => true} = {}) {
  let timer, onClosed;
  const unavailable = () => {
    const error = Error('画面を開く前にウィンドウが閉じられました。');
    error.publicDiagnostic = error.message;
    return error;
  };
  if (window.isDestroyed()) throw unavailable();
  try {
    await Promise.race([
      new Promise((_, reject) => {
        onClosed = () => reject(unavailable());
        window.once('closed', onClosed);
        timer = setTimeout(() => {
          const error = Error('画面の読み込みがタイムアウトしました。再起動してお試しください。');
          error.publicDiagnostic = error.message;
          reject(error);
        }, timeoutMs);
      }),
      // Use a microtask so a synchronous loadURL failure still reaches cleanup.
      Promise.resolve().then(() => window.loadURL(url))
    ]);
    if (window.isDestroyed()) throw unavailable();
    if (canReveal()) revealWindow(window);
  } finally {
    clearTimeout(timer);
    window.removeListener('closed', onClosed);
  }
}

// A visible, inert native window covers settings/backend startup as well as a
// delayed first renderer frame. Its session is ephemeral, with no preload,
// application IPC or network content.
export function createStartupWindow(BrowserWindow, {onClose} = {}) {
  const window = new BrowserWindow({
    width: 540, height: 320, resizable: false, minimizable: true,
    title: 'A2ACraft · 起動中', backgroundColor: '#142426', show: true,
    autoHideMenuBar: true,
    webPreferences: {partition: 'a2acraft-startup-' + randomUUID(),
      contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true, webviewTag: false, devTools: false}
  });
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => {
    if (onClose) { event.preventDefault(); onClose(); }
  });
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>A2ACraft · 起動中</title><style>
html{color-scheme:dark;background:#142426;color:#f4e8c5;font:15px -apple-system,sans-serif}
body{margin:0;min-height:240px;display:grid;place-content:center;text-align:center;gap:12px}
h1{font-size:23px;margin:0}p{color:#bccfc7;margin:0;line-height:1.8}
</style><h1>A2ACraft</h1><p>保存した会話と地図を読み込んでいます…</p></html>`;
  // The native title/window remains visible even if this static page fails.
  void window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
  return window;
}
