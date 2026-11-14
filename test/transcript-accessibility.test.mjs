import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('function streamingMessage(chat) {');
const end=source.indexOf('\nfunction queueConversationRender()',start);
assert.ok(start>=0&&end>start);

function fixture(){
  const document={activeElement:null};
  class Element {
    constructor(){
      this.attributes=new Map();this.fields=new Map();this.children=[];this.dataset={};
      this.classList={toggle(){},remove(){}};this.textContent='';
      this.scrollTop=1200;this.scrollHeight=20000;this.clientHeight=400;
    }
    setAttribute(name,value){this.attributes.set(name,String(value));}
    querySelector(selector){
      if(['.empty','.run-progress','.party-message-label'].includes(selector))return null;
      if(!this.fields.has(selector))this.fields.set(selector,new Element());
      return this.fields.get(selector);
    }
    append(node){this.insertBefore(node,null);}
    insertBefore(node,next){
      node.remove();node.parent=this;
      const index=this.children.indexOf(next);
      this.children.splice(index<0?this.children.length:index,0,node);
    }
    remove(){
      if(this.parent){const list=this.parent.children,index=list.indexOf(this);if(index>=0)list.splice(index,1);}
      this.parent=null;
    }
    addEventListener(){}
    focus(){document.activeElement=this;}
  }
  document.createElement=()=>new Element();
  const element=new Element(),list=element.querySelector('.messages');
  const panel={element,messages:new Map()};
  const context=vm.createContext({document,panels:new Map([['imported',panel]]),
    selected:'imported',demo:false,subagentSample:false,activeEncounter:null,
    active:chat=>['starting','running','stopping'].includes(chat.status),
    statusLabels:{failed:'エラー',completed:'完了'},
    attachments:{renderMessage(){}},equipment:{renderMessage(){},renderPane(){}},party:{renderPane(){}},renderAgentDelegation(){},
    renderMessageMarkdown(element,source){element.textContent=source;},
    desktop:null,toast(){},
    createPanel(){throw Error('The existing transcript must be retained');}});
  vm.runInContext(source.slice(start,end),context);
  return {context,document,element,list,panel};
}

test('a long imported transcript stays keyboard-addressable through an error and a later response',()=>{
  const f=fixture(),chat={id:'imported',title:'Imported development',status:'failed',error:'Quota stopped',
    migration:{method:'rollout'},messages:Array.from({length:523},(_,index)=>({
      id:'message-'+index,role:index%2?'assistant':'user',text:'Saved message '+index}))};
  f.context.updatePanel(chat,0);
  assert.equal(f.list.tabIndex,0);
  assert.equal(f.list.attributes.get('role'),'region');
  assert.equal(f.list.attributes.get('aria-label'),'Imported developmentの会話履歴');
  assert.equal(f.list.attributes.has('aria-live'),false,'Importing a long history must not announce every message');
  assert.equal(f.list.children.length,523);
  assert.equal(f.list.children[522].querySelector('.msg-text').textContent,'Saved message 522');
  assert.equal(f.element.querySelector('.panel-error').hidden,false);

  f.list.focus();
  chat.title='Continued development';chat.status='completed';chat.error=null;
  chat.messages.push({id:'live-response',role:'assistant',text:'The new response'});
  f.context.updatePanel(chat,0);
  assert.equal(f.document.activeElement,f.list,'Rendering must preserve focus in the history region');
  assert.equal(f.element.querySelector('.messages'),f.list);
  assert.equal(f.list.scrollTop,1200,'Reading older messages must not jump to the latest response');
  assert.equal(f.list.attributes.get('aria-label'),'Continued developmentの会話履歴');
  assert.equal(f.list.attributes.has('aria-live'),false);
  assert.equal(f.list.children.length,524);
  assert.equal(f.list.children[523].querySelector('.msg-text').textContent,'The new response');
  assert.equal(f.element.querySelector('.panel-error').hidden,true);
});
