import {createWorld3D} from './world-3d.js';
import {drawWorldPerson} from './village-art.js';

// Display the same encounter snapshot as the town; never creates a model session.
export function createResidentConversation({host, onReturn, onParty, onExpand}) {
  const root = document.createElement('section');
  root.id = 'resident-conversation'; root.hidden = true;
  root.setAttribute('aria-label', '街の人と対話');
  root.innerHTML = '<button type="button" class="outline">← 街へ戻る</button><details class="resident-view-details"><summary>相手の目線を見る</summary><div class="resident-view-content"><div class="resident-conversation-copy"><h2></h2><p class="resident-facing-status"></p><small></small></div><figure class="resident-plan"><figcaption>2D · 向き合う二人</figcaption><canvas role="img" aria-label="会話相手とリーダーの位置と目線"></canvas></figure><figure class="resident-eye"><figcaption>3D · リーダーの目線</figcaption><canvas role="img" aria-label="リーダーに向き合う会話相手"></canvas><p hidden></p></figure></div></details>';
  host.prepend(root);
  root.querySelector('button').onclick = onReturn;
  const expand = document.createElement('button');
  expand.type = 'button'; expand.textContent = '会話を広げる'; expand.hidden = true;
  expand.onclick = onExpand; root.append(expand);
  const originalPosition = document.createComment('chat workspace');
  host.before(originalPosition);
  let dock = null, map = null;
  function undock() {
    if (!dock) return;
    originalPosition.after(host);
    dock.classList.remove('with-resident-chat');
    map.inert = false;
    dock = null; map = null; expand.hidden = true;
  }
  const companions=document.createElement('details');companions.className='resident-companions';
  const companionsLabel=document.createElement('summary');companionsLabel.textContent='ひとりで話す';
  const companionsPanel=document.createElement('div');companionsPanel.className='resident-companions-panel';
  const companionsList=document.createElement('ul'),companionsHint=document.createElement('p'),changeParty=document.createElement('button');
  companionsHint.textContent='同行者の役割と直近の会話を、この相談の参考にします。';
  changeParty.type='button';changeParty.textContent='仲間を変える';changeParty.onclick=()=>{companions.open=false;if(encounter?.squadId)onReturn?.();else onParty?.();};
  companionsPanel.append(companionsList,companionsHint,changeParty);companions.append(companionsLabel,companionsPanel);
  root.querySelector('button').after(companions);
  const details = root.querySelector('.resident-view-details'), summary = details.querySelector('summary');
  const plan = root.querySelector('.resident-plan canvas'), eye = root.querySelector('.resident-eye canvas');
  let encounter = null, renderer = null;
  function drawPlan() {
    if (!encounter) return;
    const width = plan.clientWidth || 200, height = plan.clientHeight || 130, dpr = Math.min(devicePixelRatio || 1, 2);
    plan.width = Math.round(width*dpr); plan.height = Math.round(height*dpr);
    const ctx = plan.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#293f31';ctx.fillRect(0,0,width,height);
    const {person,leader} = encounter;
    const scale = Math.min(width/(Math.abs(person.x-leader.x)+60),height/(Math.abs(person.y-leader.y)+64),2.3);
    ctx.translate(width/2,height/2+12);ctx.scale(scale,scale);
    ctx.translate(-(person.x+leader.x)/2,-(person.y+leader.y)/2);
    ctx.strokeStyle='#eed99b';ctx.lineWidth=1.5/scale;ctx.setLineDash([3/scale,4/scale]);
    ctx.beginPath();ctx.moveTo(person.x,person.y);ctx.lineTo(leader.x,leader.y);ctx.stroke();ctx.setLineDash([]);
    for (const [item,hero,label] of [[person,false,encounter.name],
      [leader,leader.kind!=='agent',leader.kind==='agent' ? leader.name || '操作中のエージェント' : 'あなた']]) {
      drawWorldPerson(ctx,{...item,walking:false},{hero,motion:false});
      ctx.font=`${11/scale}px sans-serif`;ctx.textAlign='center';ctx.fillStyle='#fff6d9';
      ctx.fillText(label,item.x,item.y+20/scale);
    }
  }
  function resize() {
    if (!encounter || root.hidden || !details.open) return;
    drawPlan();renderer?.resize(eye.clientWidth || 240,eye.clientHeight || 130,Math.min(devicePixelRatio || 1,2));
  }
  function refreshView() {
    if (!encounter || root.hidden || !details.open) { renderer?.setVisible(false);return; }
    // The encounter view is optional; do not allocate a 3D view until opened.
    if (!renderer) renderer=createWorld3D({canvas:eye,onFailure:message=>{eye.hidden=true;const note=root.querySelector('.resident-eye p');note.hidden=false;note.textContent=message+' 目線は2Dで確認できます。';}});
    renderer.update(encounter.scene);renderer.setMode('leader');renderer.reset();renderer.setVisible(true);
    resize();
  }
  function closeView() { details.open=false;renderer?.setVisible(false); }
  function closeOutside(event) { if (!root.contains(event.target)) {closeView();companions.open=false;} }
  function closeOnEscape(event) {
    if (event.key !== 'Escape' || (!details.open&&!companions.open)) return;
    if(companions.open){event.preventDefault();event.stopPropagation();companions.open=false;companionsLabel.focus({preventScroll:true});return;}
    event.preventDefault();event.stopPropagation();closeView();summary.focus({preventScroll:true});
  }
  details.addEventListener('toggle',refreshView);
  document.addEventListener('pointerdown',closeOutside);
  document.addEventListener('keydown',closeOnEscape,true);
  const observer = new ResizeObserver(resize);observer.observe(root);
  observer.observe(root.querySelector('.resident-view-content'));
  return {
    dockIn(town, sourceMap) {
      undock();
      dock = town; map = sourceMap;
      dock.classList.add('with-resident-chat');
      dock.append(host); host.hidden = false; expand.hidden = false;
      // Hold the face-to-face encounter while typing. The original map and
      // leader canvas keep rendering, with their camera and actor state intact.
      map.inert = true;
    },
    undock,
    show(value, {recordOnly = false} = {}) {
      if (!value || encounter?.conversationId !== value.conversationId) {closeView();companions.open=false;}
      companions.hidden=recordOnly;changeParty.textContent=value?.squadId?'街で隊を選ぶ':'仲間を変える';
      encounter = value;root.hidden = !value;host.classList.toggle('resident-chat-active',Boolean(value));
      if (!value) { delete root.dataset.conversationId;return; }
      root.dataset.conversationId=value.conversationId;
      root.querySelector('h2').textContent=value.name+'と'+(recordOnly?'作業の記録を確認':'話す');
      root.querySelector('.resident-facing-status').textContent='立ち止まって、リーダーと向き合っています。';
      root.querySelector('small').textContent=recordOnly?'相談が届いているときに回答できます。':'この人にひもづく会話を続けます。';
      refreshView();
    },
    updateCompanions(roster=[],error='') {
      const rolesOnly=Boolean(encounter?.squadId),key=JSON.stringify([roster,error,rolesOnly]);if(companions.dataset.roster===key)return;
      companions.dataset.roster=key;
      companionsLabel.textContent=error?'同行者の編成を確認':roster.length?'同行：'+roster.map(member=>member.name).join('・'):'ひとりで話す';
      companionsLabel.title=companionsLabel.textContent;
      companionsList.replaceChildren(...roster.map(member=>{const item=document.createElement('li');item.textContent=member.name+' · '+member.role+' — '+member.title;return item;}));
      companionsHint.textContent=error||(!roster.length?'同行者はいません。この村人の会話を続けます。':rolesOnly?'同行者の名前と役割を、この相談の参考にします。':'同行者の役割と直近の会話を、この相談の参考にします。');
    },
    destroy(){undock();originalPosition.remove();observer.disconnect();details.removeEventListener('toggle',refreshView);document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeOnEscape,true);renderer?.destroy();host.classList.remove('resident-chat-active');root.remove();}
  };
}
