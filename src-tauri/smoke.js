// The debug host injects this only for a separate test profile and the local
// fake-codex executable. Exercise the same controls as a person in the webview.
(() => {
  if (window.top !== window || !window.desktop?.isTauri) return;
  const report = value => window.__TAURI__.core.invoke('desktop_request', {action:'qaReport', value});
  const find = selector => document.querySelector(selector);
  const visible = node => Boolean(node?.getClientRects().length);
  const promptText = 'Tauri conversation check';
  const savedText = '未送信の下書き\nTauri';
  const reloadKey = 'a2acraft-native-fixture-reload';
  let stage = 'Open fixture chat';

  async function until(description, check) {
    stage = description;
    const deadline = Date.now() + 20000;
    do {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw Error('Window condition timed out');
  }
  function enter(text) {
    const input = find('#prompt');
    input.value = text;
    input.dispatchEvent(new Event('input', {bubbles:true}));
  }
  async function openChat() {
    await until('Connect control', () => visible(find('#workspace')) ||
      (visible(find('#start-connect')) && !find('#start-connect').disabled));
    if (!visible(find('#workspace'))) find('#start-connect').click();
    await until('Connected to fixture', () => visible(find('#workspace')) && find('#model')?.value === 'fixture-model');
    find('#town-nav-chat').click();
    await until('Chat composer', () => visible(find('#prompt')));
  }
  async function run() {
    const resuming = sessionStorage.getItem(reloadKey);
    await openChat();
    if (resuming) {
      await until('Draft after reload', () => find('#prompt').value === savedText);
      stage = 'Restored conversation';
      const pane = find('.chat-panel.selected');
      const sent = [...pane.querySelectorAll('.msg-text')].map(node => node.textContent);
      if (sent.filter(text => text === promptText).length !== 1 || !sent.includes('Fixture result 1')) {
        throw Error('Saved messages changed');
      }
      sessionStorage.removeItem(reloadKey);
      await report({ok:true, checks:['connect', 'four-panes', 'send', 'reply', 'reload-draft']});
      return;
    }
    stage = 'An empty test profile is required';
    const initial = await window.desktop.getUiState();
    if (initial.loadError || Object.keys(initial.drafts).length || Object.keys(initial.sendRequests).length ||
      document.querySelector('.chat-panel .msg-text')) throw Error('An empty test profile is required');
    find('[data-layout="4"]').click();
    await until('Four conversation panes', () => [...document.querySelectorAll('#grid .chat-panel')].filter(visible).length === 4);
    enter(promptText);
    await until('Enabled send control', () => !find('#send-btn').disabled);
    find('#send-btn').click();
    await until('Fixture reply', () => [...document.querySelectorAll('.chat-panel.selected .msg-text')]
      .some(node => visible(node) && node.textContent === 'Fixture result 1'));
    enter(savedText);
    await until('Saved draft', async () => {
      const state = await window.desktop.getUiState();
      return state.drafts[state.selected] === savedText;
    });
    sessionStorage.setItem(reloadKey, 'yes');
    location.reload();
  }
  const start = () => run().catch(() => report({ok:false, check:stage}));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
