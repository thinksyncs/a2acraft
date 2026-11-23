import {ui} from './interface-language.js';
import {conversationMessageText} from './world-dialogue.js';

// A team flag never supplies an address. Resolve the current worker (or leader)
// against both the selected roster and the conversations in this profile.
export function teamChatRecipient(squad, chats) {
  const id = squad?.details?.current?.conversationId || squad?.leaderId;
  if (!id || !squad.members?.some(member => member.conversationId === id)) return null;
  return chats.find(chat => chat.id === id) || null;
}

export function createTeamChat({target, messaging}) {
  function node(tag, suffix) {
    const element = document.createElement(tag);
    element.className = 'village-quest-chat-' + suffix;
    return element;
  }
  const form = node('form', 'form'), label = node('label', 'label'), history = node('div', 'recent');
  const controls = node('div', 'controls'), input = node('textarea', 'input'), send = node('button', 'send');
  const hint = node('small', 'hint'), refresh = node('button', 'refresh');
  form.id = 'village-team-chat';
  input.id = 'village-team-message';
  input.rows = 1;
  input.placeholder = ui('メッセージを入力…', "Write a message…");
  label.htmlFor = input.id;
  send.type = 'submit';
  send.textContent = ui('送信', "Send");
  hint.id = 'village-team-message-status';
  hint.setAttribute('role', 'status');
  input.setAttribute('aria-describedby', hint.id);
  controls.append(input, send);
  refresh.id = 'village-team-quota-refresh';
  refresh.type = 'button';
  refresh.textContent = ui('残量を更新', "Refresh quota");
  refresh.hidden = true;
  form.append(label, history, controls, hint, refresh);
  form.hidden = true;
  let shown = null, historyKey = '', refreshing = false;

  function render(fresh = false) {
    shown = messaging ? target(fresh) : null;
    form.hidden = !shown;
    if (!shown) return;
    const {chat, permitted} = shown;
    const name = chat.characterName || chat.title;
    label.textContent = name + ui('と会話', " · chat");
    const messages = [];
    for (let i = (chat.messages?.length || 0) - 1; i >= 0 && messages.length < 2; i--) {
      const message = chat.messages[i];
      if (!['user', 'assistant'].includes(message?.role)) continue;
      const text = conversationMessageText(message).trim();
      if (text) messages.unshift([message.role === 'user' ? ui('あなた', "You") : name, text.length > 320 ? text.slice(0, 319) + '…' : text]);
    }
    const key = JSON.stringify([chat.id, messages]);
    if (key !== historyKey) {
      historyKey = key;
      history.replaceChildren(...messages.map(([speaker, text]) => {
        const row = node('div', 'line'), author = node('strong', 'speaker'), body = node('span', 'text');
        author.textContent = speaker;
        body.textContent = text;
        row.append(author, body);
        return row;
      }));
    }
    history.hidden = !messages.length;
    const {draft, reason, refreshQuota} = messaging.read(chat.id);
    if (input.value !== draft) input.value = draft;
    const unavailable = permitted ? reason : ui('この隊は現在、閲覧のみです。', "This party is currently read-only.");
    input.readOnly = !permitted || Boolean(chat.project);
    hint.textContent = unavailable || '';
    hint.hidden = !unavailable;
    refresh.hidden = !permitted || !refreshQuota || !messaging.refreshQuota;
    refresh.disabled = refreshing;
    refresh.textContent = refreshing ? ui('更新中…', "Updating…") : ui('残量を更新', "Refresh quota");
    send.disabled = Boolean(unavailable) || refreshing || !input.value.trim();
  }
  refresh.onclick = async () => {
    render(true);
    if (form.hidden || refresh.hidden || refreshing) return;
    refreshing = true;
    render();
    try { await messaging.refreshQuota(); }
    finally { refreshing = false; render(true); }
  };
  input.oninput = () => {
    if (!shown || input.readOnly) return;
    messaging.write(shown.chat.id, input.value);
    render();
  };
  input.onkeydown = event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!send.disabled) form.requestSubmit();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const before = shown;
    // A runner can start, finish, or change its current worker while this card is open.
    render(true);
    if (!shown || before?.squadId !== shown.squadId || before.chat.id !== shown.chat.id || send.disabled) return;
    try { await messaging.send(shown.chat.id, shown.squadId); }
    finally { render(); }
  };
  return {element: form, render};
}
