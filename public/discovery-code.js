// This envelope deliberately cannot carry conversation text, names or files.
export const discoveryKinds=Object.freeze({idea:'ひらめき',method:'進め方',comparison:'比較',validation:'確かめ方'});
export const MAX_DISCOVERIES=2000;
const keys=['discoveryId','kind','questId'];
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{22}$/.test(value);
export function validateDiscovery(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    JSON.stringify(Object.keys(value).sort())!==JSON.stringify(keys)||
    !identifier(value.questId)||!identifier(value.discoveryId)||typeof value.kind!=='string'||!Object.hasOwn(discoveryKinds,value.kind))
    throw Error('発見コードの形式を確認してください。');
  return {questId:value.questId,discoveryId:value.discoveryId,kind:value.kind};
}
export function encodeDiscovery(value){
  const json=JSON.stringify(validateDiscovery(value));
  return 'A2A1.'+btoa(json).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function decodeDiscovery(code){
  if(typeof code!=='string'||code.length>320)throw Error('発見コードを1つ貼り付けてください。');
  const trimmed=code.trim();
  if(!/^A2A1\.[A-Za-z0-9_-]+$/.test(trimmed))throw Error('発見コードを1つ貼り付けてください。');
  try{
    const payload=trimmed.slice(5),value=validateDiscovery(JSON.parse(atob(payload.replaceAll('-','+').replaceAll('_','/'))));
    if(encodeDiscovery(value)!==trimmed)throw Error('noncanonical');
    return value;
  }catch{throw Error('発見コードの形式を確認してください。');}
}
export function validateDiscoveryState(value){
  if(!value||value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.items)||value.items.length>MAX_DISCOVERIES)
    throw Error('共有した発見の記録を確認してください。');
  const seen=new Set();
  for(const item of value.items){
    const row=validateDiscovery(item),key=row.questId+':'+row.discoveryId;
    if(seen.has(key))throw Error('共有した発見の記録が重複しています。');
    seen.add(key);
  }
  return {version:1,revision:value.revision,items:value.items.map(validateDiscovery)};
}
export function importDiscovery(saved,code){
  const state=validateDiscoveryState(saved),finding=decodeDiscovery(code);
  const previous=state.items.find(item=>item.questId===finding.questId&&item.discoveryId===finding.discoveryId);
  if(previous){
    if(previous.kind!==finding.kind)throw Error('同じ発見IDの種類が異なります。元のコードを確認してください。');
    return {state,added:false};
  }
  if(state.items.length>=MAX_DISCOVERIES)throw Error('共有できる発見の上限に達しました。');
  return {state:{...state,revision:state.revision+1,items:[...state.items,finding]},added:true};
}
export const emptyDiscoveryState=()=>({version:1,revision:0,items:[]});
export const discoveryProgress=value=>({count:value?.items?.length||0,lit:Boolean(value?.items?.length)});
