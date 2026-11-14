const reasons = {
  workspace_unavailable: '作業場所を開けません。下の「作業フォルダ」で利用できる場所を選び、アプリを開き直してください。',
  sandbox_initialization_denied: 'Macに実行準備を拒否されました。A2ACraftを終了し、Finderから開き直して再確認してください。',
  instructions_unavailable: '作業場所の指示を読み込めません。下の「作業フォルダ」で指定した場所を確認してください。',
  permission_mismatch: '必要な実行範囲とMacの管理設定が一致しません。保護を維持して設定を調整した後は、A2ACraftを終了して開き直してください。',
  thread_start_failed: 'Codexの準備に失敗しました。接続状態を更新して再確認してください。'
};

export function readinessSummary(result) {
  if (!result || result.modelTurnStarted !== false ||
      !['chat', 'work'].every(key => ['ready', 'blocked'].includes(result[key]?.status))) {
    throw Error('接続確認の結果を受け取れませんでした。もう一度確認してください。');
  }
  return ['chat', 'work'].map(key => ({
    label: key === 'chat' ? '会話' : 'ファイル作業',
    ready: result[key].status === 'ready',
    text: result[key].status === 'ready' ? '接続準備OK' : reasons[result[key].code] || reasons.thread_start_failed,
    diagnostics: result[key].code === 'permission_mismatch' ? safeDiagnostics(result[key].diagnostics) : null
  }));
}

function safeDiagnostics(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['cwdMatches', 'writableRootsWithinScope', 'profileMatches', 'networkAccess', 'excludeTmpdirEnvVar', 'excludeSlashTmp'])
    if (typeof value[key] === 'boolean') result[key] = value[key];
  for (const [key, values] of Object.entries({
    approvalPolicy: ['never', 'on-request', 'on-failure', 'untrusted', 'unknown'],
    sandboxType: ['readOnly', 'workspaceWrite', 'dangerFullAccess', 'externalSandbox', 'unknown']
  })) if (values.includes(value[key])) result[key] = value[key];
  if (Number.isSafeInteger(value.writableRootsCount) && value.writableRootsCount >= 0)
    result.writableRootsCount = value.writableRootsCount;
  if (Array.isArray(value.responsePolicyFields)) result.responsePolicyFields = [
    'sandbox', 'sandboxPolicy', 'permissions', 'activePermissionProfile', 'permissionProfile',
    'permissionsProfile', 'permissionProfileName', 'approvalPolicy', 'cwd'
  ].filter(key => value.responsePolicyFields.includes(key));
  return result;
}

export function initConnectionReadiness({root = document, api, getState, isBlocked, onConnect, onBusyChange = () => {}, demo = false}) {
  const connect = root.getElementById('settings-connect-btn');
  const check = root.getElementById('codex-readiness-btn');
  const status = root.getElementById('codex-readiness-status');
  const results = root.getElementById('codex-readiness-results');
  let busy = false, summary = null, message = '', rendered = '';
  function render() {
    const state = getState(), authenticated = state.connected && state.account?.type === 'chatgpt';
    const blocked = isBlocked();
    connect.disabled = demo || busy || blocked;
    connect.textContent = authenticated ? '接続状態を更新' : 'Codexに接続';
    check.disabled = demo || busy || blocked || !authenticated;
    check.textContent = busy ? '接続を確認中…' : '会話・作業の接続を確認';
    status.setAttribute('aria-busy', String(busy));
    status.textContent = busy ? '会話とファイル作業の準備を確認しています。AIへの送信は行いません。' :
      demo ? '実接続モードで確認できます。' : message || (!authenticated ? '「Codexに接続」してから確認できます。' : 'AIへの送信をせずに、会話とファイル作業の準備を確認できます。');
    const signature = JSON.stringify([summary, busy, authenticated]);
    if (signature === rendered) return;
    rendered = signature;
    results.replaceChildren();
    if (summary && !busy && authenticated) for (const row of summary) {
      const item = root.createElement('p');
      item.textContent = `${row.label}：${row.text}`;
      results.append(item);
      if (row.diagnostics) {
        const details = root.createElement('details'), label = root.createElement('summary'), value = root.createElement('pre');
        label.textContent = `${row.label}の確認詳細`; value.textContent = JSON.stringify(row.diagnostics, null, 2);
        details.append(label); details.append(value); results.append(details);
      }
    }
    results.hidden = !summary || busy || !authenticated;
  }
  function reset() { summary = null; message = ''; render(); }
  async function run() {
    const state = getState();
    if (demo || busy || isBlocked() || !state.connected || state.account?.type !== 'chatgpt') return;
    busy = true; summary = null; message = ''; render(); onBusyChange(true);
    try {
      summary = readinessSummary(await api('codex/readiness'));
      message = summary.every(row => row.ready) ? '接続準備を確認しました。AIの返信・ファイル作成はまだ実行していません。' : '確認できなかった項目があります。下の案内を確認してください。';
    } catch {
      message = '接続確認を完了できませんでした。Codexへの接続を確認して、もう一度お試しください。';
    } finally { busy = false; render(); onBusyChange(false); }
  }
  connect.addEventListener('click', () => { if (!demo && !busy && !isBlocked()) onConnect(); });
  check.addEventListener('click', run);
  return {render, reset, run, get busy() { return busy; }};
}
