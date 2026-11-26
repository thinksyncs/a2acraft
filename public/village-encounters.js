import {getLocale, setWorldLabel, worldText} from './i18n-world.js';

const contactRadius = 18;
const separationRadius = 28;

// A contact begins only when two already visible, distinct chats move together.
// Reloading, emerging into the viewport, or merely standing together is not a bump.
export function createBumpDetector() {
  let previousIds = new Set();
  let touching = new Set();

  function reset() {
    previousIds.clear();
    touching.clear();
  }

  function sample(actors, viewport) {
    const visible = new Map();
    for (const actor of actors) {
      const {conversationId: id, x, y} = actor;
      if (!id || !Number.isFinite(x) || !Number.isFinite(y) ||
          x < viewport.left || x > viewport.right || y < viewport.top || y > viewport.bottom) continue;
      visible.set(id, actor);
    }
    const cells = new Map(), nextTouching = new Set(), entries = [];
    for (const [id, actor] of visible) {
      const col = Math.floor(actor.x / separationRadius), row = Math.floor(actor.y / separationRadius);
      for (let x = col - 1; x <= col + 1; x++) {
        for (let y = row - 1; y <= row + 1; y++) {
          for (const other of cells.get(x + ',' + y) || []) {
            const distance = Math.hypot(actor.x - other.x, actor.y - other.y);
            if (distance > separationRadius) continue;
            const pair = [id, other.conversationId].sort(), key = JSON.stringify(pair);
            if (distance > contactRadius && !touching.has(key)) continue;
            nextTouching.add(key);
            if (!touching.has(key) && previousIds.has(id) && previousIds.has(other.conversationId)) {
              entries.push({pair, distance, key});
            }
          }
        }
      }
      const cell = col + ',' + row;
      if (!cells.has(cell)) cells.set(cell, []);
      cells.get(cell).push(actor);
    }
    previousIds = new Set(visible.keys());
    touching = nextTouching;
    return entries.sort((a,b) => a.distance - b.distance || a.key.localeCompare(b.key)).map(entry => entry.pair);
  }

  return {reset, sample};
}

const statuses = {
  talking: '対話中', dispatching: 'タスクを準備中', completed: '対話完了',
  failed: '対話に失敗しました', interrupted: '対話が中断されました',
};

export function createVillageEncounters({host, frame, api, getState, getChats, actions}) {
  const make = (tag, label) => {
    const el = document.createElement(tag);
    if (label) setWorldLabel(el, label);
    return el;
  };
  const section = make('details'), summary = make('summary', '住民の出会い');
  section.id = 'village-encounters';
  const label = make('label'), enabled = make('input'), help = make('p', '住民がぶつかると、Codexの利用枠を使い、それぞれの最近の発言をもとに話します。二人が合意した文章作成や検討をTODOに追加し、自動で開始します。');
  enabled.type = 'checkbox';
  enabled.id = 'village-encounters-enabled';
  help.id = 'village-encounters-help';
  enabled.setAttribute('aria-describedby', help.id);
  label.append(enabled, make('span', '出会いからタスクを作る'));
  const select = make('select'), detail = make('div'), error = make('p');
  setWorldLabel(select, '出会いの記録', 'aria-label');
  error.className = 'module-error';
  error.setAttribute('role', 'status');
  section.append(summary, label, help, select, detail, error);
  host.append(section);

  const notice = make('button');
  notice.id = 'village-encounter-notice';
  notice.type = 'button';
  notice.hidden = true;
  notice.setAttribute('aria-controls', section.id);
  setWorldLabel(notice, '出会いの記録を開く', 'title');
  frame.append(notice);

  const detector = createBumpDetector();
  let lastSample = -Infinity, nextRequest = 0, sending = false, changing = false;
  let selectedId = null, lastState, lastLocale, lastTodos;
  let active = false, knownIds = null, noticeId = null, hideNotice = null;

  function dismissNotice() {
    clearTimeout(hideNotice);
    hideNotice = null;
    noticeId = null;
    notice.hidden = true;
  }

  function updateNotice(state, records, name) {
    if (!active || !state) return;
    const fresh = knownIds && records.find(item => !knownIds.has(item.id) && ['talking','dispatching'].includes(item.status));
    knownIds = new Set(records.map(item => item.id));
    if (fresh) {
      dismissNotice();
      noticeId = fresh.id;
    }
    const item = records.find(row => row.id === noticeId);
    if (!item) return;
    const pair = item.participants.map(name).join(' / ');
    const last = item.turns.at(-1);
    const lines = [worldText('村で出会いました · {names}', {names:pair})];
    if (last) lines.push(name(last.conversationId) + ' · ' + last.text);
    notice.textContent = lines.join('\n');
    notice.hidden = false;
    if (!hideNotice && !['talking','dispatching'].includes(item.status)) {
      hideNotice = setTimeout(dismissNotice, 8_000);
    }
  }

  notice.onclick = () => {
    selectedId = noticeId;
    host.open = true;
    section.open = true;
    dismissNotice();
    render(true);
    select.focus();
  };

  function showError(message = '') {
    error.textContent = message;
    error.hidden = !message;
  }

  function reset() {
    lastSample = -Infinity;
    detector.reset();
  }

  function render(force = false) {
    const {encounters: state, todos} = getState();
    enabled.disabled = !state || changing;
    enabled.checked = Boolean(state?.enabled);
    if (!force && lastState === state && lastLocale === getLocale() && lastTodos === todos) return;
    if (lastState?.enabled !== state?.enabled) reset();
    lastState = state;
    lastLocale = getLocale();
    lastTodos = todos;
    const records = [...(state?.encounters || [])].sort((a,b) => b.createdAt - a.createdAt);
    const record = records.find(item => item.id === selectedId) || records[0];
    const names = new Map(getChats().map(chat => [chat.id, chat.characterName || chat.title]));
    const name = id => names.get(id) || id;
    updateNotice(state, records, name);
    select.replaceChildren();
    for (const item of records) {
      const option = make('option');
      option.value = item.id;
      option.textContent = item.participants.map(name).join(' / ') + ' · ' + new Date(item.createdAt).toLocaleString(getLocale());
      select.append(option);
    }
    select.hidden = !record;
    detail.replaceChildren();
    if (!record) {
      if (state?.enabled) detail.append(make('p', '村で住民が出会うと、ここに会話が表示されます。'));
      return;
    }
    select.value = record.id;
    const status = make('p', statuses[record.status] || '対話中');
    status.setAttribute('role', 'status');
    detail.append(status);
    for (const turn of record.turns) {
      const line = make('p'), speaker = make('strong'), body = make('span');
      speaker.textContent = name(turn.conversationId) + ' ';
      body.textContent = turn.text;
      line.append(speaker, body);
      detail.append(line);
    }
    if (record.error) {
      const message = make('p');
      message.textContent = record.error;
      detail.append(message);
    }
    if (!record.task) {
      if (record.status === 'completed') detail.append(make('p', 'この対話ではタスクは生まれませんでした。'));
      return;
    }
    const title = make('p');
    title.textContent = record.task.title;
    detail.append(title);
    if (todos?.items?.some(item => item.id === record.task.id)) {
      const open = make('button', 'TODOで進行と結果を見る');
      open.type = 'button';
      open.onclick = () => actions.openTodo(record.task.id);
      detail.append(open);
    }
  }

  async function request(route, body) {
    const previous = getState().encounters;
    const next = await api('encounters/' + route, body);
    // A newer snapshot can arrive over SSE before an earlier HTTP response.
    if (getState().encounters === previous) actions.receive(next);
    render();
  }

  enabled.onchange = async () => {
    if (changing) return;
    changing = true;
    const value = enabled.checked;
    enabled.disabled = true;
    reset();
    showError();
    try { await request('settings', {enabled:value}); }
    catch (err) { showError(err.message); }
    finally { changing = false; render(); }
  };
  select.onchange = () => { selectedId = select.value; render(true); };
  showError();
  render(true);

  function setActive(value) {
    if (active === value) return;
    active = value;
    const snapshot = getState().encounters;
    knownIds = snapshot ? new Set(snapshot.encounters.map(item => item.id)) : null;
    dismissNotice();
    reset();
    if (active) request('state', {}).catch(err => showError(err.message));
  }

  function observe(time, actors, viewport) {
    const state = getState().encounters;
    if (!active || changing || !state?.enabled || !actions.connected()) {
      if (Number.isFinite(lastSample)) reset();
      return;
    }
    if (time - lastSample < 120) return;
    lastSample = time;
    const pairs = detector.sample(actors(), viewport);
    if (sending || !pairs.length || time < nextRequest ||
        state.encounters.some(item => ['talking','dispatching'].includes(item.status))) return;
    const chats = getChats();
    const pair = pairs.find(ids => ids.every(id => chats.some(chat => chat.id === id && !chat.project && !chat.migration)));
    if (!pair) return;
    sending = true;
    nextRequest = time + 5_000;
    showError();
    request('contact', {conversationIds:pair, locale:getLocale(), model:actions.model()})
      .catch(err => showError(err.message)).finally(() => { sending = false; });
  }

  return {setActive, render, observe, reset};
}
