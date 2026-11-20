// The caller supplies the work area of the window's own display. Preserve its
// size where possible and support displays to the left/above the main display.
export function fitWindowBounds(bounds, workArea) {
  const valid = rect => rect && ['x','y','width','height'].every(key => Number.isSafeInteger(rect[key]))
    && rect.width > 0 && rect.height > 0;
  if (!valid(bounds) || !valid(workArea)) return null;
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)),
    width, height
  };
}

export function fitWindowToWorkArea(window, workArea) {
  if (!window || window.isDestroyed() || window.isFullScreen() || window.isMaximized()
      || window.isSimpleFullScreen?.()) return false;
  const bounds = window.getBounds(), fitted = fitWindowBounds(bounds, workArea);
  if (!fitted) return false;
  let changed = false;
  // Electron otherwise clamps setBounds back to its larger native minimum.
  if (typeof window.getMinimumSize === 'function' && typeof window.setMinimumSize === 'function') {
    const minimum = window.getMinimumSize();
    if (Array.isArray(minimum) && minimum.length === 2 && minimum.every(value => Number.isSafeInteger(value) && value >= 0)) {
      const width = Math.min(minimum[0], workArea.width), height = Math.min(minimum[1], workArea.height);
      if (width !== minimum[0] || height !== minimum[1]) {
        window.setMinimumSize(width, height);
        changed = true;
      }
    }
  }
  if (['x','y','width','height'].some(key => bounds[key] !== fitted[key])) {
    window.setBounds(fitted, false);
    changed = true;
  }
  return changed;
}

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

// Keep the same native window across startup, navigation and activation so
// accessibility and capture clients can track it by its original window ID.
export function startupPageURL() {
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>A2ACraft · 起動中</title><style>
html{color-scheme:dark;background:#142426;color:#f4e8c5;font:15px -apple-system,sans-serif}
body{margin:0;min-height:240px;display:grid;place-content:center;text-align:center;gap:12px}
h1{font-size:23px;margin:0}p{color:#bccfc7;margin:0;line-height:1.8}
</style><h1>A2ACraft</h1><p>保存した会話と地図を読み込んでいます…</p></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

// The returned navigation is bound to the same native window that the OS sees
// during launch, even if startup takes several seconds to prepare the session.
export function beginWindowSession(window, reveal = revealWindow) {
  reveal(window);
  void window.loadURL(startupPageURL()).catch(() => {});
  return (url, options) => waitForWindowLoad(window, url, options);
}
