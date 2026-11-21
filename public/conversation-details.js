import {renderMessageMarkdown} from './message-markdown.js';
import {conversationMessageText, mapTranscriptText} from './world-dialogue.js';

// Show the current exchange verbatim. A previous answer must not be presented
// as the answer to a newer request, and tool records are not conversation text.
function readExchange(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const result = [];
  let requestIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'user' && (message?.role !== 'assistant' || result.length)) continue;
    const text = conversationMessageText(message);
    if (!text) continue;
    if (message.role === 'user') {
      requestIndex = i;
      result.unshift({label:'最新の依頼', text});
      break;
    }
    result.push({label:'最新の返答', text});
  }
  return {requestIndex, entries:result};
}

export function latestConversationExchange(chat) {
  return readExchange(chat).entries;
}

function passage(text, limit) {
  if (text.length <= limit) return text;
  const chars = Array.from(text.slice(0, limit * 2 + 2));
  if (chars.length <= limit) return text;
  const head = chars.slice(0, limit).join('');
  const end = Math.max(...['。','！','？','\n'].map(mark => head.lastIndexOf(mark)));
  return (end >= limit / 2 ? head.slice(0, end + 1) : head).trimEnd() + '…';
}

const continuation = /^(?:続けて(?:ください|ほしい)?|(?:再度|もう一度)?継続して(?:ください)?|もう一度|お願いします|はい|お願い|どうぞ|continue|go ahead|yes|please continue)[。！.!\s]*$/iu;

export function encounterContextRows(chat, report = null) {
  const {requestIndex, entries:exchange} = readExchange(chat);
  const request = requestIndex >= 0 ? exchange[0].text : '';
  const rows = [];
  const topic = mapTranscriptText(chat?.title).trim();
  if (topic && topic !== request && !/^(?:会話(?:\s*\d+)?|チャット\s*\d+|Codexから移行(?:\s.*)?)$/iu.test(topic))
    rows.push({label:'話題', text:passage(topic, 80)});
  if (report?.key && !report.key.startsWith('message:') && !report.key.startsWith('introduction:'))
    rows.push({label:report.label || '進捗', text:passage(mapTranscriptText(report.text), 160)});
  if (continuation.test(request.trim())) {
    for (let i = requestIndex - 1; i >= 0; i--) {
      if (chat.messages[i]?.role !== 'user') continue;
      const earlier = conversationMessageText(chat.messages[i]).trim();
      if (!earlier || continuation.test(earlier)) continue;
      if (earlier !== topic) rows.push({label:'これまでの依頼', text:passage(earlier, 120)});
      break;
    }
  }
  for (const entry of exchange) rows.push({...entry, text:passage(entry.text, 180)});
  if (request && exchange.at(-1)?.label !== '最新の返答') rows.push({label:'返答', text:'この依頼への返答はまだありません。'});
  if (report?.key?.startsWith('message:') && !exchange.some(entry => entry.text.trim() === report.text.trim())) {
    const text = mapTranscriptText(report.text);
    if (text) rows.push({label:'以前の' + report.label, text:passage(text, 100)});
  }
  if (!exchange.length && rows.every(row => row.label === '話題'))
    rows.push({label:'会話', text:'表示できる依頼や返答はまだありません。'});
  return rows;
}

export function renderEncounterContext(element, chat, report) {
  element.classList.add('resident-encounter-context');
  element.replaceChildren(...encounterContextRows(chat, report).map(row => {
    const section = document.createElement('section');
    const label = document.createElement('strong');
    label.textContent = row.label;
    const text = document.createElement('div');
    renderMessageMarkdown(text, row.text);
    section.append(label, text);
    return section;
  }));
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
