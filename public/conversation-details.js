import {renderMessageMarkdown} from './message-markdown.js';
import {conversationMessageText} from './world-dialogue.js';

// Show the current exchange verbatim. A previous answer must not be presented
// as the answer to a newer request, and tool records are not conversation text.
export function latestConversationExchange(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const visible = messages.filter(message => message?.role === 'user' ||
    message?.role === 'assistant' && conversationMessageText(message));
  const requestIndex = visible.findLastIndex(message => message.role === 'user');
  const reply = visible.slice(requestIndex + 1).findLast(message => message.role === 'assistant');
  return [
    ...(requestIndex >= 0 ? [{label:'最新の依頼',text:conversationMessageText(visible[requestIndex])}] : []),
    ...(reply ? [{label:'最新の返答',text:conversationMessageText(reply)}] : []),
  ];
}

const rendered = new WeakMap();
export function renderConversationDetails(element, chat) {
  const entries = latestConversationExchange(chat);
  const signature = JSON.stringify(entries);
  if (rendered.get(element) === signature) return;
  rendered.set(element, signature);
  element.classList.add('map-conversation-details');
  const sections = entries.map(entry => {
    const section = document.createElement('section');
    const heading = document.createElement('h3'); heading.textContent = entry.label;
    const body = document.createElement('div');
    renderMessageMarkdown(body, entry.text);
    section.append(heading, body);
    return section;
  });
  if (!entries.length || entries.at(-1).label === '最新の依頼') {
    const empty = document.createElement('p');
    empty.textContent = entries.length ? 'この依頼への返答はまだありません。' : '会話はまだありません。';
    sections.push(empty);
  }
  element.replaceChildren(...sections);
}
