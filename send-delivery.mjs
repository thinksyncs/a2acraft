import {createHash} from 'node:crypto';

// A request identifier survives an HTTP response loss. Accepted identifiers
// live with the conversation, so reopening the app cannot send them again.
const running=new WeakMap();
export async function deliverSend(conversation,input,execute){
  const requestId=input.requestId;
  if(requestId===undefined)return execute(null); // Older local clients.
  if(typeof requestId!=='string'||!/^[-A-Za-z0-9_]{1,120}$/.test(requestId))throw Error('送信IDを確認してください。');
  const fingerprint=createHash('sha256').update(JSON.stringify({
    kind:input.kind||'send',text:input.text,model:input.model||null,
    effort:input.effort||'medium',expectedTurnId:input.expectedTurnId||null,
    attachmentIds:input.attachmentIds||[],
    ...(input.residentVisit?{residentVisit:input.residentVisit}:{})
  })).digest('hex');
  const receipt={requestId,fingerprint};
  const accepted=conversation.messages.find(message=>message.role==='user'&&message.delivery?.requestId===requestId);
  if(accepted){
    if(accepted.delivery.fingerprint!==fingerprint)throw Error('同じ送信IDで内容が変わっています。');
    return {accepted:true,replayed:true};
  }
  let pending=running.get(conversation);
  if(!pending){pending=new Map();running.set(conversation,pending);}
  const existing=pending.get(requestId);
  if(existing){
    if(existing.fingerprint!==fingerprint)throw Error('同じ送信IDで内容が変わっています。');
    return existing.promise;
  }
  const promise=Promise.resolve().then(()=>execute(receipt)).finally(()=>pending.delete(requestId));
  pending.set(requestId,{fingerprint,promise});
  return promise;
}
