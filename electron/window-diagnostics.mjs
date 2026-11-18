const boolean = value => typeof value === 'boolean' ? value : null;
const integer = value => Number.isSafeInteger(value) ? value : null;
const read = action => { try { return action(); } catch { return null; } };
const yesNo = value => value === true ? 'はい' : value === false ? 'いいえ' : '不明';
const validRect = value => value && ['x','y','width','height'].every(key => Number.isSafeInteger(value[key]))
  && value.width > 0 && value.height > 0;

// Window/process state only. Never query renderer content, its URL, cookies,
// account details, titles, arguments or other applications' windows.
export function createWindowDiagnostics({getWindow, version, writeReport, present, logPath = '',
  getWorkArea, now = () => new Date(), timeoutMs = 2000}) {
  let loadState = 'not-created', responsiveness = 'unknown', lastErrorCode = null;
  let sequence = 0, events = [], pending = null, detach = () => {};
  const timestamp = () => now().toISOString();
  const record = event => {
    events.push({sequence:++sequence, at:timestamp(), event});
    if (events.length > 24) events.shift();
  };
  function observe(window) {
    detach(); loadState = 'created'; responsiveness = 'unknown'; lastErrorCode = null;
    const subscriptions = [];
    const listen = (target, name, handler) => {
      target.on(name, handler); subscriptions.push(() => target.removeListener(name, handler));
    };
    for (const event of ['show','hide','focus','blur','minimize','restore','enter-full-screen','leave-full-screen'])
      listen(window, event, () => record(event));
    for (const state of ['responsive','unresponsive'])
      listen(window, state, () => { responsiveness = state; record(state); });
    listen(window, 'closed', () => { loadState = 'closed'; record('closed'); detach(); });
    const contents = window.webContents;
    listen(contents, 'did-start-loading', () => { loadState = 'loading'; lastErrorCode = null; record('loading'); });
    listen(contents, 'did-finish-load', () => { loadState = 'loaded'; record('loaded'); });
    listen(contents, 'did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (!mainFrame || code === -3) return;
      loadState = 'load-failed'; lastErrorCode = integer(code); record('load-failed');
    });
    listen(contents, 'render-process-gone', () => { loadState = 'renderer-gone'; record('renderer-gone'); });
    detach = () => { for (const unsubscribe of subscriptions.splice(0)) unsubscribe(); };
    record('created');
  }
  function snapshot() {
    const window = getWindow(), destroyed = !window || read(() => window.isDestroyed()) !== false;
    const contents = !destroyed && window.webContents;
    const rendererDestroyed = !contents || read(() => contents.isDestroyed()) !== false;
    const bounds = !destroyed ? read(() => window.getBounds()) : null;
    // Query only the display selected for this app-owned window. Keep no
    // display identifiers, names, scaling metadata or other display inventory.
    const workArea = !destroyed && typeof getWorkArea === 'function' ? read(() => {
      const value = getWorkArea(window);
      return validRect(value) ? Object.fromEntries(['x','y','width','height'].map(key => [key,value[key]])) : null;
    }) : null;
    const fullyWithinWorkArea = validRect(bounds) && workArea ?
      bounds.x >= workArea.x && bounds.y >= workArea.y &&
      bounds.x + bounds.width <= workArea.x + workArea.width &&
      bounds.y + bounds.height <= workArea.y + workArea.height : null;
    return {
      schema:1, capturedAt:timestamp(),
      appVersion:/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) ? version : 'unknown',
      window:{electronId:!destroyed ? integer(window.id) : null, destroyed,
        visible:!destroyed ? boolean(read(() => window.isVisible())) : false,
        minimized:!destroyed ? boolean(read(() => window.isMinimized())) : null,
        focused:!destroyed ? boolean(read(() => window.isFocused())) : false,
        fullScreen:!destroyed ? boolean(read(() => window.isFullScreen())) : null,
        bounds:bounds ? Object.fromEntries(['x','y','width','height'].map(key => [key,integer(bounds[key])])) : null,
        workArea, fullyWithinWorkArea},
      renderer:{destroyed:rendererDestroyed,
        loading:!rendererDestroyed ? boolean(read(() => contents.isLoadingMainFrame())) : null,
        crashed:!rendererDestroyed ? boolean(read(() => contents.isCrashed())) : null,
        loadState, responsiveness, lastErrorCode},
      events:events.map(event => ({...event}))
    };
  }
  async function save(snapshot) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => writeReport(snapshot)).then(() => 'saved', () => 'failed'),
        new Promise(resolve => { timer = setTimeout(() => resolve('timed-out'), timeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
  }
  function show() {
    if (pending) return pending;
    pending = (async () => {
      // Snapshot before opening the native dialog, whose focus changes would
      // otherwise obscure the window state that the user wanted to diagnose.
      const report = snapshot(), saved = await save(report), window = getWindow();
      const parent = window && read(() => window.isDestroyed()) === false ? window : undefined;
      const w = report.window, r = report.renderer;
      const states = {'not-created':'未作成',created:'作成済み',loading:'読込中',loaded:'読込完了',
        'load-failed':'読込失敗','renderer-gone':'画面の処理が終了',closed:'閉じています'};
      const responses = {unknown:'未検出',responsive:'応答あり',unresponsive:'応答なし'};
      const detail = [
        'バージョン: '+report.appVersion,
        'ウィンドウID: '+(w.electronId ?? 'なし'),
        '表示: '+yesNo(w.visible)+' / 最小化: '+yesNo(w.minimized)+' / フォーカス: '+yesNo(w.focused),
        'フルスクリーン: '+yesNo(w.fullScreen),
        '位置・大きさ: '+(w.bounds ? `${w.bounds.x}, ${w.bounds.y} / ${w.bounds.width} × ${w.bounds.height}` : '不明'),
        '画面の作業領域: '+(w.workArea ? `${w.workArea.x}, ${w.workArea.y} / ${w.workArea.width} × ${w.workArea.height}` : '不明'),
        'ウィンドウ全体が作業領域内: '+yesNo(w.fullyWithinWorkArea),
        '画面の読込: '+states[r.loadState]+' / 読込中: '+yesNo(r.loading),
        '応答の通知: '+responses[r.responsiveness]+' / クラッシュ: '+yesNo(r.crashed),
        '読込エラー番号: '+(r.lastErrorCode ?? 'なし'),
        '直近の状態: '+report.events.slice(-8).map(event => event.event).join(' → '),
        saved === 'saved' ? '保存先: '+logPath : saved === 'timed-out' ? '診断の保存が時間内に完了しませんでした。' : '診断を保存できませんでした。',
        '会話本文・URL・認証情報・画面画像は含みません。'
      ].join('\n');
      await present(parent, {type:'info',title:'表示の診断',message:'A2ACraftの表示状態',
        detail,buttons:['閉じる'],defaultId:0,cancelId:0,noLink:true});
      return {report, saved};
    })().finally(() => { pending = null; });
    return pending;
  }
  return {observe, snapshot, show};
}
