import {ui} from '../public/interface-language.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const renderSource=source.slice(source.indexOf('function renderChats() {'),source.indexOf('\nfunction updateHud()'));
const selectSource=source.slice(source.indexOf('function select(id,'),source.indexOf('\nasync function addChat()'));

function fixture({layout=4,encounter=true}={}){
  const nodes=new Map(),panels=new Map(),rendered=[];
  class Node {
    constructor(){this.children=[];this.dataset={};this.classes=new Set();this.value='First unsent draft';this.scrollTop=120;this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
    setAttribute(name,value){this[name]=String(value);}
    append(node){node.parent=this;this.children.push(node);}
    insertBefore(node,before){node.remove();node.parent=this;this.children.splice(before?this.children.indexOf(before):this.children.length,0,node);}
    contains(node){return this.children.includes(node);}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
  }
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);};
  const buttons=[1,2,4].map(value=>{const button=new Node();button.dataset.layout=value;return button;});
  const chats=Array.from({length:8},(_,index)=>({id:'chat-'+index,title:'Conversation '+index,status:'idle',messages:[]}));
  const groups=[{id:'first',conversationIds:chats.slice(0,4).map(chat=>chat.id)},{id:'second',conversationIds:chats.slice(4).map(chat=>chat.id)}];
  const quiet={render(){}};
  const context=vm.createContext({ui, chats,selected:'chat-0',layout,activeEncounter:encounter?{conversationId:'chat-0'}:null,
    view:'chat',pendingView:null,drafts:{'chat-1':'Second saved draft'},groupSelections:new Map(),panels,renderedNavigation:'',
    conversationRenderTimer:0,clearTimeout(){},document:{activeElement:null},CSS:{escape:value=>value},esc:value=>value,
    $:node,$$:()=>buttons,active:()=>false,setText(){},equipment:quiet,contextSharing:quiet,workspaceTabs:quiet,town:quiet,history:quiet,village:quiet,
    updateComposer(){},persist(){},api(){throw Error('Changing layout must not create conversations');},
    currentChatGroup(){return groups.find(group=>group.conversationIds.includes(context.selected));},
    endResidentConversation(){context.activeEncounter=null;},
    switchView(view,onSwitch){context.view=view;onSwitch?.();},
    updatePanel(chat){if(!panels.has(chat.id)){const element=new Node();element.dataset.select=chat.id;panels.set(chat.id,{element});}rendered.push(chat.id);return panels.get(chat.id).element;}
  });
  vm.runInContext(renderSource+'\n'+selectSource,context);
  return {context,node,panels,buttons,chats,rendered};
}

test('a resident-origin conversation respects the existing four-pane workspace',()=>{
  const f=fixture();f.context.renderChats();
  assert.deepEqual(f.node('#grid').children.map(node=>node.dataset.select),['chat-0','chat-1','chat-2','chat-3']);
  assert.equal(f.node('#grid').classes.has('layout-4'),true);
  assert.equal(f.node('#chat-view').classes.has('multi-chat'),true);
  assert.equal(f.buttons[2]['aria-pressed'],'true');
  assert.equal(f.context.activeEncounter.conversationId,'chat-0');
});

test('talking on the map shows the selected resident and keeps their draft and workspace layout when expanded',()=>{
  const f=fixture();
  f.context.view='town';
  f.context.selected='chat-2';
  f.context.activeEncounter={conversationId:'chat-2'};
  f.node('#prompt').value='この小道について\nもう少し教えて';
  f.context.renderChats();
  assert.deepEqual(f.node('#grid').children.map(node=>node.dataset.select),['chat-2']);
  assert.equal(f.context.layout,4);
  assert.equal(f.node('#grid').classes.has('layout-1'),true);
  const residentPanel=f.node('#grid').children[0];
  f.context.view='chat';
  f.context.renderChats();
  assert.deepEqual(f.node('#grid').children.map(node=>node.dataset.select),['chat-0','chat-1','chat-2','chat-3']);
  assert.ok(f.node('#grid').children.includes(residentPanel));
  assert.equal(f.context.activeEncounter.conversationId,'chat-2');
  assert.equal(f.node('#prompt').value,'この小道について\nもう少し教えて');
  assert.equal(f.node('#grid').classes.has('layout-4'),true);
});

test('selecting another visible pane changes the composer without replacing panes or losing drafts',()=>{
  const f=fixture();f.context.renderChats();
  const previous=[...f.node('#grid').children];
  f.context.select('chat-1');
  assert.equal(f.context.selected,'chat-1');
  assert.equal(f.context.drafts['chat-0'],'First unsent draft');
  assert.equal(f.node('#prompt').value,'Second saved draft');
  assert.deepEqual(f.node('#grid').children,previous);
  assert.equal(f.context.activeEncounter,null);
  assert.deepEqual(previous.map(node=>node.scrollTop),[120,120,120,120]);
});

test('layout changes reuse saved conversations and stay within the selected workspace',()=>{
  const f=fixture({layout:1,encounter:false});f.context.renderChats();
  assert.deepEqual(f.node('#grid').children.map(node=>node.dataset.select),['chat-0']);
  f.context.layout=2;f.context.renderChats();
  assert.deepEqual(f.node('#grid').children.map(node=>node.dataset.select),['chat-0','chat-1']);
  f.context.layout=4;f.context.renderChats();
  assert.equal(f.node('#grid').children.length,4);
  f.context.select('chat-5');
  assert.deepEqual(f.node('#grid').children.map(node=>node.dataset.select),['chat-4','chat-5','chat-6','chat-7']);
  assert.equal(f.chats.length,8);
  f.context.layout=1;f.context.renderChats();
  assert.deepEqual(f.node('#grid').children.map(node=>node.dataset.select),['chat-5']);
  assert.equal(f.node('#chat-view').classes.has('multi-chat'),false);
});

test('layout choices are visible controls outside the collapsed conversation menu',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const layoutStart=html.indexOf('id="chat-layout"'),menuStart=html.indexOf('<details id="chat-actions"');
  assert.ok(layoutStart>0&&layoutStart<menuStart);
  const controls=html.slice(layoutStart,menuStart);
  for(const value of [1,2,4])assert.match(controls,new RegExp('data-layout="'+value+'"'));
  assert.equal((html.match(/data-layout="4"/g)||[]).length,1);
});
