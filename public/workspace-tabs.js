import {chatText} from './i18n-chat.js';

// A conversation belongs to one four-pane workspace. Legacy conversations remain
// visible until a saved group is available, without changing the saved records.
export function chatGroupsFor(groups,chats){
  const available=new Set((chats||[]).map(chat=>chat?.id).filter(id=>typeof id==='string'&&id));
  const assigned=new Set(),ids=new Set(),result=[];
  const items=Array.isArray(groups)?groups:Array.isArray(groups?.items)?groups.items:[];
  for(const item of items){
    if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id))continue;
    const conversationIds=[];
    for(const id of Array.isArray(item.conversationIds)?item.conversationIds:[]){
      if(!available.has(id)||assigned.has(id)||conversationIds.length===4)continue;
      assigned.add(id);conversationIds.push(id);
    }
    if(!conversationIds.length)continue;
    ids.add(item.id);
    result.push({id:item.id,title:typeof item.title==='string'&&item.title.trim()?item.title.trim():chatText('チャット {index}', {index:result.length+1}),conversationIds});
  }
  const remaining=[...available].filter(id=>!assigned.has(id));
  for(let start=0;start<remaining.length;start+=4){
    const conversationIds=remaining.slice(start,start+4);
    let id=`legacy:${conversationIds[0]}`;
    while(ids.has(id))id+=':legacy';
    ids.add(id);
    result.push({id,title:chatText('チャット {index}', {index:result.length+1}),conversationIds});
  }
  return result;
}

export function groupForConversation(groups,chats,conversationId){
  return chatGroupsFor(groups,chats).find(group=>group.conversationIds.includes(conversationId))||null;
}

export function initWorkspaceTabs({getGroups,getChats,getSelected,getView,onMap,onGroup,onAdd}){
  const root=document.querySelector('#workspace-tabs');
  const home=root.parentElement,homeNext=root.nextElementSibling;
  const chatToolbar=document.querySelector('#chat-view .workspace-toolbar');
  const list=document.createElement('div');
  list.className='workspace-tab-list';list.setAttribute('role','tablist');
  const map=document.createElement('button');
  map.type='button';map.id='workspace-map-tab';map.className='workspace-tab workspace-map-tab';
  map.setAttribute('role','tab');map.setAttribute('aria-controls','town-view');map.onclick=()=>onMap();
  list.append(map);
  const add=document.createElement('button');
  add.type='button';add.id='workspace-add-chat';add.className='workspace-add-chat';add.textContent='＋';
  const status=document.createElement('p');
  status.className='workspace-tabs-status';status.setAttribute('role','status');status.hidden=true;
  root.replaceChildren(list,add,status);
  const buttons=new Map();
  let busy=false,lastActive=null;
  // A layout change can narrow the list without changing its active group.
  // Observe width only so manual scrolling and streaming updates stay put.
  if(typeof ResizeObserver==='function'){
    let observedWidth=null,resizeFrame=null;
    const observer=new ResizeObserver(([entry])=>{
      const width=entry.contentRect.width;
      if(observedWidth!==null&&Math.abs(width-observedWidth)<.5)return;
      observedWidth=width;
      if(width<=0||resizeFrame!==null)return;
      resizeFrame=requestAnimationFrame(()=>{
        resizeFrame=null;
        const button=buttons.get(lastActive),viewportWidth=list.clientWidth;
        if(getView()!=='chat'||!list.isConnected||!button||viewportWidth<=0)return;
        const bounds=list.getBoundingClientRect(),tab=button.getBoundingClientRect();
        const left=bounds.left+list.clientLeft,right=left+viewportWidth;
        const delta=tab.width>viewportWidth||tab.left<left?tab.left-left:tab.right>right?tab.right-right:0;
        if(Math.abs(delta)>.5)list.scrollLeft+=delta;
      });
    });
    observer.observe(list);
  }
  function announce(message,kind='status'){status.textContent=message;status.hidden=!message;status.dataset.kind=kind;}
  function render(){
    list.setAttribute('aria-label',chatText('マップとチャット'));map.textContent=chatText('⌖ 街マップ');
    add.title=chatText('新しい2×2チャットを追加');add.setAttribute('aria-label',add.title);
    const groups=chatGroupsFor(getGroups(),getChats()),selected=getSelected(),view=getView();
    // Reuse the same tabs and handlers in the chat's single toolbar. Other
    // screens retain their original navigation position and keyboard order.
    if(view==='chat'&&chatToolbar){
      if(root.parentElement!==chatToolbar)chatToolbar.insertBefore(root,document.querySelector('#chat-heading'));
    }else if(root.parentElement!==home)home.insertBefore(root,homeNext);
    const active=groups.find(group=>view==='chat'&&group.conversationIds.includes(selected));
    map.setAttribute('aria-selected',String(['town','equipment','tavern','castle'].includes(view)));
    map.tabIndex=active?-1:0;
    const present=new Set(groups.map(group=>group.id));
    for(const [id,button] of buttons){
      if(present.has(id))continue;
      const focused=document.activeElement===button;
      button.remove();buttons.delete(id);
      if(focused)map.focus({preventScroll:true});
    }
    groups.forEach((group,index)=>{
      let button=buttons.get(group.id);
      if(!button){
        button=document.createElement('button');button.type='button';button.className='workspace-tab workspace-chat-tab';
        button.setAttribute('role','tab');button.setAttribute('aria-controls','chat-view');button.dataset.chatGroup=group.id;
        buttons.set(group.id,button);
      }
      button.textContent=group.title;button.title=chatText('{title} · {count}チャット', {title:group.title,count:group.conversationIds.length});
      button.setAttribute('aria-selected',String(active?.id===group.id));button.tabIndex=active?.id===group.id?0:-1;
      button.onclick=()=>onGroup(group);
      // Leave nodes in place during ordinary state updates, including while a
      // response streams, so keyboard focus does not jump to another tab.
      if(list.children[index+1]!==button)list.insertBefore(button,list.children[index+1]||null);
    });
    add.disabled=busy;add.setAttribute('aria-busy',String(busy));
    const activeId=active?.id||null;
    if(activeId&&activeId!==lastActive)buttons.get(activeId)?.scrollIntoView({block:'nearest',inline:'nearest'});
    lastActive=activeId;
  }
  list.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=[...list.querySelectorAll('[role=tab]')],index=tabs.indexOf(event.target);
    if(index<0)return;
    event.preventDefault();
    const target=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[target].focus({preventScroll:true});tabs[target].click();
    tabs[target].scrollIntoView({block:'nearest',inline:'nearest'});
  });
  add.onclick=async()=>{
    if(busy)return;
    busy=true;announce(chatText('新しい2×2チャットを追加しています…'));render();
    try{await onAdd();announce(chatText('新しい2×2チャットを追加しました。'));}
    catch(error){announce(chatText('チャットを追加できませんでした。')+(error?.message||chatText('もう一度お試しください。')),'error');}
    finally{busy=false;render();}
  };
  render();
  return {render};
}
