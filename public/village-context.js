const excerpt = value => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 96 ? text.slice(0, 95) + '…' : text;
};

// Display the user's actual request, never a fabricated description or a tool log.
export function villageConversationContext(chat = {}) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const request = messages.filter(message => message?.role === 'user' && String(message.text || '').trim()).at(-1);
  const reply = messages.filter(message => message?.role === 'assistant' && String(message.text || '').trim()).at(-1);
  return request ? {label:'直近の依頼', text:excerpt(request.text)} :
    reply ? {label:'直近の返答', text:excerpt(reply.text)} : {label:'会話', text:'履歴を開いて内容を確認できます。'};
}

export function nearbyVillageConversations({residents = [], homes, point, limit = 2}) {
  if (!homes || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return [];
  return residents.filter(person => homes.has(person.conversationId)).map(person => {
    const home = homes.get(person.conversationId);
    return {...person, distance:Math.hypot(home.x - point.x, home.y - point.y)};
  }).sort((a,b) => a.distance-b.distance || a.conversationId.localeCompare(b.conversationId)).slice(0,limit);
}

export function createVillageContext({onTalk}) {
  const panel = document.createElement('details');
  panel.className = 'village-context'; panel.id = 'village-context'; panel.open = true;
  const summary = document.createElement('summary'); summary.textContent = 'この辺りの会話';
  const hint = document.createElement('p'); hint.textContent = '選ぶと、その村人まで歩いて話しかけます。';
  const list = document.createElement('div'); list.className = 'village-context-list';
  panel.append(summary,hint,list);
  let signature = '';
  return {element:panel, update({residents, homes, point, chats = [], hidden = false, revision = ''}) {
    panel.hidden = hidden || !residents.length;
    if (panel.hidden) return;
    const rows = nearbyVillageConversations({residents,homes,point});
    const byId = new Map(chats.map(chat => [chat.id,chat]));
    const data = rows.map(person => ({person, context:villageConversationContext(byId.get(person.conversationId))}));
    const next = JSON.stringify([revision,data.map(({person,context}) => [person.conversationId,person.name,person.title,context])]);
    if (signature === next) return;
    signature = next; list.replaceChildren();
    for (const {person,context} of data) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'village-context-row';
      row.setAttribute('aria-label',person.name+'に話しかける · '+person.title);
      const title = document.createElement('strong'); title.textContent = person.title;
      const name = document.createElement('small'); name.textContent = person.name;
      const text = document.createElement('span'); text.textContent = context.label+'：'+context.text;
      row.append(title,name,text); row.onclick = () => onTalk(person.conversationId); list.append(row);
    }
  }};
}
