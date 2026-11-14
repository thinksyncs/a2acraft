import path from 'node:path';
import {writeFile,rename} from 'node:fs/promises';
import {LocalStore} from './local-store.mjs';

const kinds=new Set(['auto','software','resident']);
const stages=new Set(['auto','planned','building','testing','complete']);
export const MAX_VILLAGE_OVERRIDES=5000;
const idValid=value=>typeof value==='string'&&Boolean(value.trim())&&value.length<=512&&!/[\u0000-\u001f]/.test(value);

function configuration(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!idValid(input.conversationId))throw Error('村に表示する会話を選んでください。');
 if(!kinds.has(input.kind))throw Error('村人・ソフト開発・自動判定から表示方法を選んでください。');
 if(!stages.has(input.stage))throw Error('建設の進み具合を選んでください。');
 if(input.kind==='resident'&&input.stage!=='auto')throw Error('村人として表示する会話には建設段階を設定できません。');
 return {conversationId:input.conversationId,kind:input.kind,stage:input.stage};
}

// These are explicit display corrections, not claims about repository state.
// Chat text and inferred progress remain in the conversation's existing store.
export class VillageStore extends LocalStore {
 constructor(directory,onChange){super(path.join(directory,'village.json'),{version:1,revision:0,overrides:[]},onChange);}
 async load(){
  await super.load(value=>{
   const invalid=()=>{throw Error('村の記録を読み込めません。village.jsonを保持したまま内容を確認してください。');};
   if(value?.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.overrides)||value.overrides.length>MAX_VILLAGE_OVERRIDES)invalid();
   const seen=new Set();
   for(const row of value.overrides){
    try{configuration(row);}catch{invalid();}
    if(Object.keys(row).length!==3||Object.keys(row).some(key=>!['conversationId','kind','stage'].includes(key))||seen.has(row.conversationId)||row.kind==='auto'&&row.stage==='auto')invalid();
    seen.add(row.conversationId);
   }
  });
  return this;
 }
 async configure(input){
  const record=configuration(input);
  this.writing=this.writing.catch(()=>{}).then(async()=>{
   const next=this.public(),index=next.overrides.findIndex(row=>row.conversationId===record.conversationId);
   if(record.kind==='auto'&&record.stage==='auto'){
    if(index<0)return this.public();
    next.overrides.splice(index,1);
   }else if(index<0){
    if(next.overrides.length>=MAX_VILLAGE_OVERRIDES)throw Error('村の表示設定は5000件まで保存できます。使わない設定を自動判定に戻してください。');
    next.overrides.push(record);
   }else{
    const old=next.overrides[index];
    if(old.kind===record.kind&&old.stage===record.stage)return this.public();
    next.overrides[index]=record;
   }
   if(!Number.isSafeInteger(next.revision+1))throw Error('村の保存番号を更新できません。保存ファイルを確認してください。');
   next.revision++;
   await writeFile(this.file+'.tmp',JSON.stringify(next),{mode:0o600});
   await rename(this.file+'.tmp',this.file);
   this.value=next;
   this.onChange(this.public());
   return this.public();
  });
  return this.writing;
 }
}
