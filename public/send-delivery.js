export function requestForSend(records,id,input,randomId=()=>crypto.randomUUID()){
  const fingerprint=JSON.stringify(input);
  if(records[id]?.fingerprint!==fingerprint||typeof records[id]?.requestId!=='string'||!/^[-A-Za-z0-9_]{1,120}$/.test(records[id].requestId))records[id]={requestId:randomId(),fingerprint};
  return records[id].requestId;
}

export function sendWasAccepted(chats,id,requestId,files=[]){
  return Boolean(chats.find(chat=>chat.id===id)?.messages?.some(message=>message.role==='user'&&(
    (typeof requestId==='string'&&Boolean(requestId)&&message.delivery?.requestId===requestId)||
    (!message.delivery&&files.length>0&&files.every(file=>message.attachments?.some(item=>item.id===file.id)))
  )));
}

export function restoreSendDraft(records,id,text,current=''){
  const restored=[text,current].filter(Boolean).join('\n\n');
  if(records[id])records[id].restoredDraft=restored;
  return restored;
}

export function recoverSendDrafts(records,chats,drafts){
  for(const [id,record] of Object.entries(records)){
    if(!record||typeof record!=='object')continue;
    let input;try{input=JSON.parse(record.fingerprint);}catch{continue;}
    if(!input||typeof input!=='object')continue;
    if(sendWasAccepted(chats,id,record.requestId)){
      // Only remove text that recovery itself inserted. A user edit, even an
      // identical new question, must not be consumed by an older receipt.
      if(typeof record.restoredDraft==='string'&&drafts[id]===record.restoredDraft&&typeof input.text==='string'){
        if(drafts[id]===input.text)drafts[id]='';
        else if(drafts[id].startsWith(input.text+'\n\n'))drafts[id]=drafts[id].slice(input.text.length+2);
      }
      delete records[id];continue;
    }
    if(!chats.some(chat=>chat.id===id)||typeof input.text!=='string'||!input.text)continue;
    // A desktop may close after dispatch but before the HTTP acknowledgement.
    // Keep its identity and recover its text without replacing a newer draft.
    if(!drafts[id])drafts[id]=restoreSendDraft(records,id,input.text);
    else if(drafts[id]!==input.text&&!drafts[id].startsWith(input.text+'\n\n'))drafts[id]=restoreSendDraft(records,id,input.text,drafts[id]);
  }
}
