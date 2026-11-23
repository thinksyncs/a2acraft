import {projectText, projectLabel, writeProjectLabel} from './i18n-projects.js';
import {encodeDiscovery,decodeDiscovery,importDiscovery,validateDiscoveryState,emptyDiscoveryState,discoveryProgress} from './discovery-code.js';

const make=(tag,text,className)=>{const node=document.createElement(tag);writeProjectLabel(node,text);if(className)node.className=className;return node;};
const demoKey='a2acraft-demo-discoveries-v1';
const demoFinding={questId:'demo-quest'.padEnd(22,'0'),discoveryId:'demo-finding'.padEnd(22,'0'),kind:'idea'};

export function initDiscoverySharing({host,api,demo=false,getState,getAdventure,onState=()=>{},notify=()=>{}}){
  if(!host)return {render(){}};
  const root=make('section',undefined,'discovery-sharing');root.setAttribute('aria-label',projectText('発見を持ち寄る工房'));
  const workshop=make('div',undefined,'discovery-workshop');workshop.setAttribute('aria-hidden','true');
  workshop.innerHTML='<svg viewBox="0 0 100 82"><path class="workshop-wall" d="M15 34H85V76H15Z"/><path class="workshop-roof" d="M7 35L50 7L93 35Z"/><path class="workshop-door" d="M43 76V49H59V76"/><path class="workshop-window" d="M23 43H36V57H23ZM67 43H80V57H67Z"/><path class="workshop-beam" d="M15 37H85M49 10V35M12 76H89"/></svg>';
  const copy=make('button',projectLabel('発見をコピー'),'outline'),receive=make('button',projectLabel('相手の発見を取り込む'),'primary');copy.type=receive.type='button';
  const content=make('div',undefined,'discovery-copy'),title=make('strong',projectLabel('発見を持ち寄る工房')),count=make('span',undefined,'discovery-count');
  count.setAttribute('aria-live','polite');const actions=make('div',undefined,'discovery-actions');actions.append(copy,receive);
  const hint=make('small'),status=make('p',undefined,'discovery-status');status.setAttribute('role','status');
  content.append(title,count,actions,hint,status);root.append(workshop,content);host.append(root);
  const dialog=make('dialog',undefined,'discovery-import-dialog'),form=make('form'),label=make('label',projectLabel('相手から届いた発見コード'));
  const input=make('textarea');input.rows=3;input.maxLength=320;input.autocomplete='off';input.spellcheck=false;input.required=true;input.setAttribute('aria-label',projectText('発見コード'));label.append(input);
  const error=make('p',undefined,'discovery-error');error.setAttribute('role','alert');error.hidden=true;
  const importButtons=make('div',undefined,'discovery-actions'),cancel=make('button',projectLabel('閉じる'),'outline'),submit=make('button',projectLabel('取り込む'),'primary');cancel.type='button';submit.type='submit';importButtons.append(cancel,submit);form.append(label,error,importButtons);dialog.append(form);root.append(dialog);
  const manual=make('dialog',undefined,'discovery-import-dialog'),manualTitle=make('p',projectLabel('このコードをコピーして相手に渡してください。')),codeField=make('textarea');codeField.rows=3;codeField.readOnly=true;codeField.setAttribute('aria-label',projectText('コピーする発見コード'));
  const closeCode=make('button',projectLabel('閉じる'),'outline');closeCode.type='button';manual.append(manualTitle,codeField,closeCode);root.append(manual);
  let busy=false,notice='',demoState=emptyDiscoveryState(),demoLoadError='',pulseTimer;
  if(demo)try{const saved=localStorage.getItem(demoKey);if(saved)demoState=validateDiscoveryState(JSON.parse(saved));}catch{demoLoadError=projectText('発見の保存記録を読み込めません。再読み込みしてください。');}
  function current(){return demo?demoState:getState?.()||emptyDiscoveryState();}
  function latest(){return getAdventure?.()?.journal?.at(-1);}
  function render(){
    const progress=discoveryProgress(current()),entry=latest();root.dataset.lit=String(progress.lit);root.dataset.count=String(progress.count);
    count.textContent=progress.count?projectText("{n}件の発見 · 工房に明かりが灯っています",{n:progress.count}):projectText('まだ発見が届いていません');
    copy.disabled=busy||Boolean(demoLoadError)||(!demo&&!entry);receive.disabled=busy||Boolean(demoLoadError);submit.disabled=busy;cancel.disabled=busy;
    hint.textContent=demo?projectText('お試しの発見をコピーして、別のプレイヤーに渡せます。'):entry?projectText('クエストID・発見ID・種類だけをコピーします。'): projectText('冒険の成果を受け取ると、発見をコピーできます。');
    status.textContent=demoLoadError||notice;status.hidden=!status.textContent;
  }
  copy.onclick=async()=>{
    if(copy.disabled)return;busy=true;notice='';render();
    try{
      const result=demo?{code:encodeDiscovery(demoFinding)}:await api('discoveries/copy',{questId:latest()?.questId});
      const code=encodeDiscovery(decodeDiscovery(result.code));
      // Only write the deliberately minimal code; never read the clipboard.
      try{await navigator.clipboard.writeText(code);notice=projectText('発見コードをコピーしました。相手に渡してください。');}
      catch{codeField.value=code;manual.showModal();codeField.focus();codeField.select();notice=projectText('コードを選んでコピーできます。');}
    }catch(reason){notice=reason.message||projectText('発見をコピーできませんでした。');}
    finally{busy=false;render();}
  };
  receive.onclick=()=>{if(receive.disabled)return;input.value='';error.hidden=true;dialog.showModal();input.focus();};
  cancel.onclick=()=>dialog.close();closeCode.onclick=()=>manual.close();
  form.onsubmit=async event=>{
    event.preventDefault();if(busy)return;busy=true;error.hidden=true;render();
    try{
      let result;
      if(demo){
        result=importDiscovery(demoState,input.value);
        if(result.added){localStorage.setItem(demoKey,JSON.stringify(result.state));demoState=result.state;}
      }else result=await api('discoveries/import',{code:input.value});
      onState({...result.state,...discoveryProgress(result.state)});
      notice=result.added?projectText('発見を受け取りました。工房に明かりが灯りました。'):projectText('この発見は取り込み済みです。');
      dialog.close();
      if(result.added){clearTimeout(pulseTimer);root.dataset.arrival='true';pulseTimer=setTimeout(()=>{delete root.dataset.arrival;},1400);}
      notify(notice);
    }catch(reason){error.textContent=reason.message||projectText('発見を取り込めませんでした。');error.hidden=false;}
    finally{busy=false;render();}
  };
  render();
  return {render,destroy(){clearTimeout(pulseTimer);root.remove();}};
}
