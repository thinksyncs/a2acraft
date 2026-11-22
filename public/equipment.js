import {equipmentSlots,slotLabels,demoEquipmentSkills,equipmentIconNames,equipmentPresentation,skillTokenEstimate} from './equipment-catalog.js';
export {equipmentPresentation} from './equipment-catalog.js';

const ns='http://www.w3.org/2000/svg';
const icons=new Set(equipmentIconNames);
export function equipmentIcon(nameOrSkill,className='equipment-icon'){
  const skill=typeof nameOrSkill==='object'?equipmentPresentation(nameOrSkill):null,name=skill?.icon||nameOrSkill;
  const svg=document.createElementNS(ns,'svg'),use=document.createElementNS(ns,'use');
  svg.setAttribute('class',className);svg.setAttribute('viewBox',name==='hero'?'0 0 64 80':'0 0 64 64');svg.setAttribute('aria-hidden','true');
  use.setAttribute('href','/assets/equipment.svg#'+(icons.has(name)?name:'sword'));svg.append(use);
  if(skill?.rune){
    const rune=document.createElementNS(ns,'path'),bits=parseInt(skill.rune,16)>>>0;
    const segments=Array.from({length:16},(_,index)=>bits&(1<<index)?'M'+(45+(index%4)*4)+' '+(45+Math.floor(index/4)*4)+'h2v2h-2Z':'').join('');
    rune.setAttribute('d',segments);rune.setAttribute('fill','#e8c77e');rune.setAttribute('stroke','#35475e');rune.setAttribute('stroke-width','.5');svg.append(rune);
  }
  return svg;
}
const running=chat=>['starting','running','stopping'].includes(chat?.status);
const equipmentDragType='application/x-chat-ui-equipment';
function text(tag,value,className){const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;}

export function initEquipment({api,demo,storeKey,getChats,getSelected,onSelect,onChat,onUse,isVisible,isLocked=()=>false,onShopChange=()=>{}}){
  const $=selector=>document.querySelector(selector);
  let catalog=demo?demoEquipmentSkills:[],shop='weapon',selected=null,loading=false,mutating=false,loaded=demo,error='',warnings=[],status='',signature='';
  let fitting=null,dragging=null;
  let saved={};
  if(demo)try{saved=JSON.parse(localStorage.getItem(storeKey+'-equipment')||'{}');}catch{}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
  const current=()=>getChats().find(chat=>chat.id===getSelected());
  const canFit=()=>Boolean(current())&&!running(current())&&!mutating&&!loading&&!isLocked()&&isVisible();
  const equipmentKey=chat=>JSON.stringify(chat?.equipment||{});
  const character=$('.equipment-character'),fittingStatus=text('p','','equipment-fitting-status'),cancelFitting=text('button','試着をやめる','text-btn');
  fittingStatus.id='equipment-fitting-status';fittingStatus.setAttribute('role','status');fittingStatus.setAttribute('aria-live','polite');
  cancelFitting.id='equipment-cancel-preview';cancelFitting.type='button';cancelFitting.hidden=true;
  $('.equipment-profile').append(fittingStatus,cancelFitting);
  const fittingHint=text('p','商品をクリック、またはキャラ・対応する装備欄へドラッグして試着できます。','equipment-fitting-hint');
  $('.equipment-party').after(fittingHint);
  function endDrag(){
    dragging=null;
    $('#equipment-view').classList.remove('equipment-dragging');
    document.querySelectorAll('.equipment-drag-source,.equipment-drop-ready,.equipment-drop-available').forEach(node=>node.classList.remove('equipment-drag-source','equipment-drop-ready','equipment-drop-available'));
  }
  function cancelPreview(message='試着をやめました。装備は変更していません。'){
    const changed=Boolean(fitting);fitting=null;endDrag();if(changed)status=message;signature='';render();
  }
  function tryOn(skill){
    if(!canFit()||!skill||skill.slot!==shop)return;
    selected=skill.id;error='';status='';
    fitting=current().equipment?.[skill.slot]?.id===skill.id?null:{chatId:current().id,skillId:skill.id,slot:skill.slot,before:equipmentKey(current())};
    signature='';render();
  }
  function dragSkill(event,slot,verifyPayload=false){
    if(!dragging||!canFit()||dragging.chatId!==getSelected()||dragging.slot!==shop||!Array.from(event.dataTransfer?.types||[]).includes(equipmentDragType))return null;
    if(slot&&slot!==dragging.slot)return null;
    if(verifyPayload&&event.dataTransfer.getData(equipmentDragType)!==dragging.token)return null;
    return catalog.find(skill=>skill.id===dragging.skillId&&skill.slot===dragging.slot)||null;
  }
  function makeDropTarget(node,slot){
    node.dataset.equipmentDrop=slot||'character';
    node.ondragover=event=>{if(!dragSkill(event,slot))return;event.preventDefault();event.dataTransfer.dropEffect='copy';node.classList.add('equipment-drop-ready');};
    node.ondragleave=event=>{if(!node.contains(event.relatedTarget))node.classList.remove('equipment-drop-ready');};
    node.ondrop=event=>{event.preventDefault();event.stopPropagation();const skill=dragSkill(event,slot,true);endDrag();if(skill)tryOn(skill);};
  }
  makeDropTarget(character);
  cancelFitting.onclick=()=>cancelPreview();
  $('#equipment-view').addEventListener('dragover',event=>{if(event.defaultPrevented)return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='none';});
  $('#equipment-view').addEventListener('drop',event=>{event.preventDefault();endDrag();});
  $('#equipment-view').addEventListener('keydown',event=>{if(event.key==='Escape'&&(fitting||dragging)){event.preventDefault();cancelPreview();}});
  // A preview belongs only to this visit and chat; leaving never persists it.
  const visibilityObserver=new MutationObserver(()=>{if(!isVisible()&&(fitting||dragging))cancelPreview('');});
  for(const node of [$('#equipment-view'),$('#workspace')])if(node)visibilityObserver.observe(node,{attributes:true,attributeFilter:['hidden']});
  function hydrate(){
    if(!demo)return;
    for(const chat of getChats())if(!chat.equipment){
      chat.equipment={};
      for(const slot of equipmentSlots){const skill=catalog.find(item=>item.id===saved[chat.id]?.equipment?.[slot]&&item.slot===slot);chat.equipment[slot]=skill||null;}
      chat.armedSkillId=chat.equipment.weapon?.singleUse&&saved[chat.id]?.armedSkillId===chat.equipment.weapon.id?chat.equipment.weapon.id:null;
    }
  }
  function persist(){
    if(!demo)return;
    try{localStorage.setItem(storeKey+'-equipment',JSON.stringify(Object.fromEntries(getChats().map(chat=>[chat.id,{equipment:Object.fromEntries(equipmentSlots.map(slot=>[slot,chat.equipment?.[slot]?.id||null])),armedSkillId:chat.armedSkillId||null}]))));}catch{}
  }
  function selectedSkill(){return catalog.find(skill=>skill.id===selected&&skill.slot===shop)||null;}
  async function load(){
    if(demo||loading)return;
    fitting=null;endDrag();loading=true;error='';status='';render();
    try{const result=await api('skills');if(!Array.isArray(result.skills))throw Error('品ぞろえを取得できませんでした。');catalog=result.skills;warnings=result.warnings||[];loaded=true;}
    catch(e){error=e.message;loaded=false;}
    finally{loading=false;signature='';render();}
  }
  async function change(slot,skillId,arm){
    const chat=current();if(!chat||mutating||running(chat)||isLocked())return;
    fitting=null;endDrag();
    mutating=true;error='';render();
    try{
      if(demo){
        const skill=skillId?catalog.find(item=>item.id===skillId&&item.slot===slot):null;
        if(chat.equipment?.[slot]?.id===chat.armedSkillId)chat.armedSkillId=null;
        chat.equipment={...chat.equipment,[slot]:skill||null};if(arm)chat.armedSkillId=skill.id;
        persist();onChat(chat);
      }else onChat(await api('equipment',{id:chat.id,slot,skillId,...(arm!==undefined?{arm}:{})}));
      status=arm?'矢をつがえた。次の送信で一度だけ使います。':arm===false?'矢を外しました。弓は装備に残ります。':skillId?'装備しました。チャットに指示を入力できます。':'装備を外しました。';
    }catch(e){error=e.message;}
    finally{mutating=false;signature='';render();}
  }
  function render(){
    hydrate();const chat=current(),canChange=Boolean(chat)&&!running(chat)&&!mutating&&!loading&&!isLocked();
    if(fitting&&(fitting.chatId!==chat?.id||fitting.slot!==shop||fitting.before!==equipmentKey(chat)||!canChange||!isVisible()||!catalog.some(skill=>skill.id===fitting.skillId&&skill.slot===fitting.slot)))fitting=null;
    if(dragging&&(!canFit()||dragging.chatId!==chat?.id||dragging.slot!==shop))endDrag();
    const trial=fitting?catalog.find(skill=>skill.id===fitting.skillId):null,displayEquipment=trial?{...chat.equipment,[trial.slot]:trial}:chat?.equipment;
    const nextSignature=JSON.stringify([getSelected(),getChats().map(chat=>[chat.id,chat.title,chat.characterName]),chat?.equipment,chat?.armedSkillId,chat?.status,isLocked(),shop,selected,fitting,catalog,loading,mutating,error,warnings,status]);
    if(signature===nextSignature)return;signature=nextSignature;
    const picker=$('#equipment-chat'),oldOptions=JSON.stringify(getChats().map(chat=>[chat.id,chat.title,chat.characterName]));
    if(picker.dataset.options!==oldOptions){picker.replaceChildren(...getChats().map(chat=>{const option=text('option',chat.title);option.value=chat.id;return option;}));picker.dataset.options=oldOptions;}
    picker.value=getSelected()||'';
    const slots=$('#equipment-slots');slots.replaceChildren();
    for(const slot of equipmentSlots){
      const skill=equipmentPresentation(displayEquipment?.[slot]),row=text('div','','equipment-slot'),detail=document.createElement('div'),isTrial=trial?.slot===slot;
      makeDropTarget(row,slot);row.classList.toggle('equipment-slot-preview',isTrial);row.setAttribute('aria-label',slotLabels[slot]+'の装備欄'+(isTrial?' · 試着中':''));
      if(skill)row.append(equipmentIcon(skill));
      detail.append(text('small',slotLabels[slot]),text('strong',skill?skill.itemName:'なし'));
      if(isTrial)detail.append(text('small','試着中 · 未確定','equipment-trial-badge'));
      if(skill){detail.title=skill.displayName;const remove=text('button','×','text-btn');remove.type='button';remove.disabled=!canChange;remove.setAttribute('aria-label',isTrial?'試着をやめる':slotLabels[slot]+'の装備を外す');if(!isTrial)remove.dataset.removeSlot=slot;remove.onclick=()=>isTrial?cancelPreview():change(slot,null);row.append(detail,remove);}else row.append(detail);
      slots.append(row);
    }
    const weapon=equipmentPresentation(displayEquipment?.weapon),magic=equipmentPresentation(displayEquipment?.spell);
    $('#equipment-hand').replaceChildren(...(weapon?[equipmentIcon(weapon)]:[]));$('#equipment-magic').replaceChildren(...(magic?[equipmentIcon(magic)]:[]));
    character.classList.toggle('has-equipment',Boolean(weapon));character.classList.toggle('equipment-fitting',Boolean(trial));character.dataset.previewSkill=trial?.id||'';character.setAttribute('aria-disabled',String(!canChange));
    character.setAttribute('aria-label',(chat?.title||'未選択')+'のキャラ'+(trial?' · 試着中':'')+(weapon?' · 手持ち: '+weapon.itemName:'')+(magic?' · 呪文: '+magic.itemName:''));
    fittingStatus.textContent=trial?equipmentPresentation(trial).itemName+'を試着中。まだ装備していません。「装備する」で確定します。':'';fittingStatus.hidden=!trial;cancelFitting.hidden=!trial;
    document.querySelectorAll('[data-shop]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.shop===shop)));
    $('#equipment-title').textContent={weapon:'Armory',tool:'Supplies',spell:'Spell Shop'}[shop];
    const stock=$('#equipment-stock');
    const inShop=catalog.filter(skill=>skill.slot===shop).map(equipmentPresentation);
    if(!inShop.some(skill=>skill.id===selected))selected=inShop[0]?.id||null;
    const focused=document.activeElement?.dataset?.skillId;stock.replaceChildren();
    for(const skill of inShop){
      const button=text('button','','equipment-item');button.type='button';button.dataset.skillId=skill.id;button.setAttribute('aria-pressed',String(skill.id===selected));
      const label=text('span','','equipment-item-copy');label.append(text('strong',skill.itemName),text('small',skill.displayName));
      const estimate=skillTokenEstimate(skill),price=text('span','','equipment-token-estimate');price.dataset.tokenEstimate=estimate.label;price.dataset.estimateBasis=estimate.basis;price.append(text('small',estimate.basis==='unknown'?'未見積もり':'消費目安 / 1回'),text('b',estimate.label));
      button.dataset.tokenEstimate=estimate.label;button.append(equipmentIcon(skill),label,price);
      if(chat?.equipment?.[shop]?.id===skill.id)button.append(text('span','装備中','equipment-owned'));
      button.draggable=canChange;button.setAttribute('aria-label',skill.itemName+' · '+skill.displayName+' · '+(estimate.basis==='unknown'?'消費量は未見積もり':'1回の消費目安 '+estimate.label)+'を試着');
      button.onclick=()=>{
        selected=skill.id;status='';if(canFit())tryOn(skill);else{signature='';render();}
        if(matchMedia('(max-width:650px)').matches&&isVisible()){
          $('#equipment-detail').scrollIntoView({block:'start',inline:'nearest'});
          const heading=$('#equipment-name');heading.tabIndex=-1;heading.focus({preventScroll:true});
        }
      };
      button.ondragstart=event=>{if(!canFit()||!event.dataTransfer){event.preventDefault();return;}dragging={chatId:chat.id,skillId:skill.id,slot:skill.slot,token:crypto.randomUUID()};event.dataTransfer.setData(equipmentDragType,dragging.token);event.dataTransfer.effectAllowed='copy';button.classList.add('equipment-drag-source');$('#equipment-view').classList.add('equipment-dragging');document.querySelectorAll('[data-equipment-drop]').forEach(node=>node.classList.toggle('equipment-drop-available',['character',skill.slot].includes(node.dataset.equipmentDrop)));};
      button.ondragend=endDrag;stock.append(button);
    }
    if(focused)stock.querySelector('[data-skill-id="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
    if(!inShop.length)stock.append(text('p',loading?'品ぞろえを確認しています…':error?'取得できませんでした。「品ぞろえを更新」で再試行できます。':loaded?'この店にはまだスキルがありません。':'「品ぞろえを更新」でスキルを読み込めます。','equipment-empty'));
    const skill=equipmentPresentation(selectedSkill()),equipped=Boolean(skill&&chat?.equipment?.[shop]?.id===skill.id),armed=equipped&&chat.armedSkillId===skill.id;
    $('#equipment-preview').replaceChildren(...(skill?[equipmentIcon(skill)]:[]));
    $('#equipment-kind').textContent=skill?(skill.singleUse?'飛び道具 · 一回の指示':slotLabels[skill.slot]+' · SKILL'):'SKILL';
    $('#equipment-name').textContent=skill?.itemName||'装備を選ぶ';$('#equipment-source').textContent=skill?(skill.displayName===skill.name?skill.name:skill.displayName+' · '+skill.name):'';
    $('#equipment-description').textContent=skill?.description||'';
    const estimate=skill?skillTokenEstimate(skill):null;
    $('#equipment-estimate-box').hidden=!skill;
    $('#equipment-token-estimate').textContent=estimate?.label||'';$('#equipment-token-estimate').dataset.estimateBasis=estimate?.basis||'unknown';
    $('#equipment-token-caption').textContent=estimate?.basis==='unknown'?'消費目安 · 未見積もり':'消費目安 / 1回';
    $('#equipment-token-scope').textContent=estimate?.scope||'';$('#equipment-token-scope').hidden=!estimate?.scope;
    $('#equipment-token-note').textContent=estimate?[estimate.detail,'1 k token = 1,000 tokens。入力・出力・ツール利用で変動します。'].filter(Boolean).join(' '):'';$('#equipment-token-note').hidden=!skill;
    $('#equipment-use-hint').textContent=skill?(skill.singleUse?'矢をつがえると、次の送信で一度だけこの技を使います。弓は装備したままです。':'装備している間は、この会話でメッセージや追加の指示を送るたびに、この技を使います。'):'';
    $('#equipment-equip').disabled=!canChange||!skill||equipped||Boolean(error);$('#equipment-equip').textContent=equipped?'装備中':'装備する';
    $('#equipment-arm').hidden=!equipped||!skill.singleUse;$('#equipment-arm').disabled=!canChange||Boolean(error);$('#equipment-arm').textContent=armed?'矢を外す':'矢をつがえる';
    $('#equipment-use').hidden=!equipped||Boolean(skill.singleUse&&!armed);$('#equipment-use').disabled=mutating;
    $('#equipment-status').textContent=isLocked()?'パーティのクエスト中です。酒場で停止してから装備を変更できます。':running(chat)?'この会話の処理中です。装備は完了後に変更できます。':status;
    $('#equipment-loading').hidden=!loading;$('#equipment-error').hidden=!error;$('#equipment-error').textContent=error;
    $('#equipment-warnings').hidden=!warnings.length;$('#equipment-warnings').textContent=warnings.join('\n');
    $('#equipment-refresh').disabled=demo||loading||mutating;
    $('#equipment-refresh').title=demo?'品ぞろえの更新にはCodexへの接続が必要です。':'';
  }
  $('#equipment-chat').onchange=()=>{fitting=null;endDrag();status='';onSelect($('#equipment-chat').value);signature='';render();};
  function chooseShop(value){if(!equipmentSlots.includes(value))return;fitting=null;endDrag();shop=value;selected=null;status='';signature='';render();onShopChange(shop);}
  document.querySelectorAll('[data-shop]').forEach(button=>button.onclick=()=>chooseShop(button.dataset.shop));
  $('#equipment-equip').onclick=()=>{const skill=selectedSkill();if(skill)change(skill.slot,skill.id);};
  $('#equipment-arm').onclick=()=>{const skill=selectedSkill();if(skill)change(skill.slot,skill.id,current()?.armedSkillId!==skill.id);};
  $('#equipment-use').onclick=onUse;$('#equipment-back').onclick=onUse;$('#equipment-refresh').onclick=load;
  function renderPane(element,chat){
    let button=element.querySelector('.panel-equipment');
    if(!button){button=text('button','','panel-equipment');button.type='button';button.onclick=event=>{event.stopPropagation();onSelect(chat.id);};element.querySelector('.panel-foot').prepend(button);}
    const keys=JSON.stringify(chat.equipment||{});if(button.dataset.equipment!==keys){button.replaceChildren(equipmentIcon('hero','equipment-icon equipment-mini-hero'),...equipmentSlots.filter(slot=>chat.equipment?.[slot]).map(slot=>equipmentIcon(chat.equipment[slot])));button.dataset.equipment=keys;}
    button.setAttribute('aria-label',chat.title+'の装備とお店を開く');
  }
  function renderMessage(node,skills=[]){
    let list=node.querySelector('.equipment-message');if(!list){list=text('div','','equipment-message');node.querySelector('.msg-label').after(list);}
    const key=JSON.stringify(skills);if(list.dataset.skills===key)return;list.dataset.skills=key;list.replaceChildren(...skills.map(saved=>{const skill=equipmentPresentation(saved),row=text('span',skill.itemName||skill.displayName);row.prepend(equipmentIcon(skill));row.title=skill.displayName||skill.name;return row;}));
  }
  function demoTurn(chat){const skills=equipmentSlots.map(slot=>chat.equipment?.[slot]).filter(skill=>skill&&(!skill.singleUse||chat.armedSkillId===skill.id));if(skills.some(skill=>skill.singleUse)){chat.armedSkillId=null;persist();}return skills;}
  return {render,renderPane,renderMessage,demoTurn,open:value=>{if(value)chooseShop(value);else render();if(!loaded)load();},invalidate:()=>{loaded=demo;if(isVisible())load();}};
}
