const boolean = value => typeof value === 'boolean' ? value : null;
const integer = value => Number.isSafeInteger(value) ? value : null;
const read = action => { try { return action(); } catch { return null; } };
const validRect = value => value && ['x','y','width','height'].every(key => Number.isSafeInteger(value[key]))
  && value.width > 0 && value.height > 0;

// Window/process state only. Never query renderer content, its URL, cookies,
// account details, titles, arguments or other applications' windows.
export function createWindowDiagnostics({getWindow, version, writeReport, present, logPath = '',
  text = ja => ja, getWorkArea, now = () => new Date(), timeoutMs = 2000}) {
  const yesNo = value => value === true ? text('はい', 'Yes') : value === false ? text('いいえ', 'No') : text('不明', 'Unknown');
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
      const states = {'not-created':text('未作成', 'Not created'),created:text('作成済み', 'Created'),loading:text('読込中', 'Loading'),loaded:text('読込完了', 'Loaded'),
        'load-failed':text('読込失敗', 'Failed to load'),'renderer-gone':text('画面の処理が終了', 'Window process exited'),closed:text('閉じています', 'Closed')};
      const responses = {unknown:text('未検出', 'Unknown'),responsive:text('応答あり', 'Responsive'),unresponsive:text('応答なし', 'Unresponsive')};
      const detail = [
        text('バージョン: ', 'Version: ')+report.appVersion,
        text('ウィンドウID: ', 'Window ID: ')+(w.electronId ?? text('なし', 'None')),
        text('表示: ', 'Visible: ')+yesNo(w.visible)+text(' / 最小化: ', ' / Minimized: ')+yesNo(w.minimized)+text(' / フォーカス: ', ' / Focused: ')+yesNo(w.focused),
        text('フルスクリーン: ', 'Full screen: ')+yesNo(w.fullScreen),
        text('位置・大きさ: ', 'Window bounds: ')+(w.bounds ? `${w.bounds.x}, ${w.bounds.y} / ${w.bounds.width} × ${w.bounds.height}` : text('不明', 'Unknown')),
        text('画面の作業領域: ', 'Available area: ')+(w.workArea ? `${w.workArea.x}, ${w.workArea.y} / ${w.workArea.width} × ${w.workArea.height}` : text('不明', 'Unknown')),
        text('ウィンドウ全体が作業領域内: ', 'Window fits available area: ')+yesNo(w.fullyWithinWorkArea),
        text('画面の読込: ', 'Page status: ')+states[r.loadState]+text(' / 読込中: ', ' / Loading: ')+yesNo(r.loading),
        text('応答の通知: ', 'Response status: ')+responses[r.responsiveness]+text(' / クラッシュ: ', ' / Crashed: ')+yesNo(r.crashed),
        text('読込エラー番号: ', 'Load error code: ')+(r.lastErrorCode ?? text('なし', 'None')),
        text('直近の状態: ', 'Recent events: ')+report.events.slice(-8).map(event => event.event).join(' → '),
        saved === 'saved' ? text('保存先: ', 'Saved to: ')+logPath : saved === 'timed-out' ? text('診断の保存が時間内に完了しませんでした。', 'Saving the report timed out.') : text('診断を保存できませんでした。', 'Could not save the report.'),
        text('会話本文・URL・認証情報・画面画像は含みません。', 'The report contains only window and process status.')
      ].join('\n');
      await present(parent, {type:'info',title:text('表示の診断', 'Window Diagnostics'),message:text('A2ACraftの表示状態', 'A2ACraft Window Status'),
        detail,buttons:[text('閉じる', 'Close')],defaultId:0,cancelId:0,noLink:true});
      return {report, saved};
    })().finally(() => { pending = null; });
    return pending;
  }
  return {observe, snapshot, show};
}
