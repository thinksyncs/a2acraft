const text=value=>typeof value==='string'?value:'';
const normalized=value=>text(value).normalize('NFKC').toLocaleLowerCase('ja');

function timestamp(value){
  if(typeof value==='number')return Number.isFinite(value)&&Math.abs(value)<=8640000000000000?value:null;
  // Local date strings do not identify an instant and depend on the device's timezone.
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value))return null;
  const day=value.slice(0,10),midnight=Date.parse(day+'T00:00:00Z');
  if(!Number.isFinite(midnight)||new Date(midnight).toISOString().slice(0,10)!==day)return null;
  const date=Date.parse(value);
  return Number.isFinite(date)?date:null;
}

/** Read the app's existing visible transcript without changing saved conversations. */
export function historyEntries(chats,{query=''}={}){
  const terms=normalized(query).trim().split(/\s+/u).filter(Boolean),entries=[],seen=new Set();
  for(const chat of Array.isArray(chats)?chats:[]){
    if(!chat||typeof chat.id!=='string'||!chat.id||seen.has(chat.id))continue;
    const messages=(Array.isArray(chat.messages)?chat.messages:[]).filter(message=>['user','assistant'].includes(message?.role));
    if(!messages.length)continue;
    const title=text(chat.title).trim()||'会話',characterName=text(chat.characterName).trim();
    const searchable=normalized([title,characterName,...messages.map(message=>text(message.text))].join('\n'));
    if(!terms.every(term=>searchable.includes(term)))continue;
    const times=[timestamp(chat.updatedAt),...messages.map(message=>timestamp(message.createdAt))].filter(value=>value!==null);
    const latestText=messages.findLast(message=>text(message.text).trim());
    const previewCharacters=Array.from(text(latestText?.text).trim().replace(/\s+/gu,' '));
    const preview=previewCharacters.length>160?previewCharacters.slice(0,159).join('')+'…':previewCharacters.join('');
    entries.push({id:chat.id,title,characterName,status:text(chat.status)||'idle',updatedAt:times.reduce((latest,time)=>latest===null||time>latest?time:latest,null),messageCount:messages.length,preview});
    seen.add(chat.id);
  }
  // Stable ties preserve existing group order, including legacy undated histories.
  return entries.sort((a,b)=>(b.updatedAt??-Infinity)-(a.updatedAt??-Infinity)||0);
}
