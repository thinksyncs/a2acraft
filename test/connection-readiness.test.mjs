import test from 'node:test';
import assert from 'node:assert/strict';
import {initConnectionReadiness,readinessSummary} from '../public/connection-readiness.js';

function fixture(overrides = {}) {
  const elements = new Map();
  const element = () => ({hidden:false,disabled:false,textContent:'',children:[],listeners:{},
    setAttribute(name,value) { this[name]=value; },
    addEventListener(name,callback) { this.listeners[name]=callback; },
    replaceChildren() { this.children=[]; }, append(child) { this.children.push(child); }});
  const root = {getElementById(id) { if (!elements.has(id)) elements.set(id,element()); return elements.get(id); },createElement:element};
  const state = {connected:true,account:{type:'chatgpt'},policy:{ok:false,reason:'Quota stopped'}};
  let blocked=false;
  const controls=initConnectionReadiness({root,getState:()=>state,isBlocked:()=>blocked,onConnect:()=>{},api:async()=>{},...overrides});
  controls.render();
  return {controls,state,elements,block(value) { blocked=value;controls.render(); }};
}

test('readiness remains available at low quota and makes only one diagnostic request',async()=>{
  let finish;const calls=[],busy=[];
  const f=fixture({api:route=>{calls.push(route);return new Promise(resolve=>{finish=resolve;});},onBusyChange:value=>busy.push(value)});
  assert.equal(f.elements.get('codex-readiness-btn').disabled,false);
  const first=f.controls.run();
  assert.equal(f.controls.busy,true);
  assert.equal(f.elements.get('settings-connect-btn').disabled,true);
  await f.controls.run();assert.deepEqual(calls,['codex/readiness']);
  finish({chat:{status:'ready',code:'ready'},work:{status:'blocked',code:'permission_mismatch'},modelTurnStarted:false});
  await first;
  assert.deepEqual(busy,[true,false]);
  const rows=f.elements.get('codex-readiness-results').children.map(x=>x.textContent);
  assert.match(rows[0],/会話：接続準備OK/);
  assert.match(rows[1],/管理設定が一致しません/);
  assert.equal(f.controls.busy,false);
});

test('offline users can reconnect without forcing sign-in; diagnostics require authentication',async()=>{
  let reconnects=0,calls=0;
  const f=fixture({onConnect:()=>{reconnects++;},api:async()=>{calls++;}});
  assert.equal(f.elements.get('settings-connect-btn').textContent,'接続状態を更新');
  f.state.connected=false;f.state.account=null;f.controls.render();
  assert.equal(f.elements.get('settings-connect-btn').disabled,false);
  assert.equal(f.elements.get('settings-connect-btn').textContent,'Codexに接続');
  f.elements.get('settings-connect-btn').listeners.click();assert.equal(reconnects,1);
  assert.equal(f.elements.get('codex-readiness-btn').disabled,true);
  await f.controls.run();assert.equal(calls,0);
  f.block(true);f.elements.get('settings-connect-btn').listeners.click();assert.equal(reconnects,1);
});

test('diagnostic errors never expose raw paths or server details, and later retry is possible',async()=>{
  const f=fixture({api:async()=>{throw Error('private-path /private/account-detail');}});
  await f.controls.run();
  assert.doesNotMatch(f.elements.get('codex-readiness-status').textContent,/private-path|account-detail/);
  assert.equal(f.elements.get('codex-readiness-btn').disabled,false);
  assert.equal(f.elements.get('codex-readiness-results').hidden,true);
  assert.throws(()=>readinessSummary({chat:{status:'ready'},work:{status:'ready'},modelTurnStarted:true}),/結果/);
  const [row]=readinessSummary({chat:{status:'blocked',code:'unknown',message:'private detail'},work:{status:'ready'},modelTurnStarted:false});
  assert.doesNotMatch(row.text,/private detail/);
  const [mismatch]=readinessSummary({chat:{status:'blocked',code:'permission_mismatch'},work:{status:'ready'},modelTurnStarted:false});
  assert.match(mismatch.text,/A2ACraftを終了して開き直して/);
});

test('safe permission details survive routine renders without exposing paths or profile IDs',async()=>{
  const f=fixture({api:async()=>({modelTurnStarted:false,
    chat:{status:'blocked',code:'permission_mismatch',diagnostics:{
      cwdMatches:true,writableRootsWithinScope:false,profileMatches:false,networkAccess:false,
      excludeTmpdirEnvVar:true,excludeSlashTmp:true,approvalPolicy:'never',sandboxType:'workspaceWrite',
      writableRootsCount:2,responsePolicyFields:['sandbox','activePermissionProfile','/private/path','activePermissionProfile'],
      cwd:'/private/path',profileId:'private-profile',rawError:'private-error',activePermissionProfile:{id:'private-profile'}
    }},work:{status:'ready',code:'ready'}})});
  await f.controls.run();
  const results=f.elements.get('codex-readiness-results'),details=results.children[1];
  assert.match(details.children[0].textContent,/会話の確認詳細/);
  const visible=details.children[1].textContent;
  assert.deepEqual(JSON.parse(visible),{
    cwdMatches:true,writableRootsWithinScope:false,profileMatches:false,networkAccess:false,
    excludeTmpdirEnvVar:true,excludeSlashTmp:true,approvalPolicy:'never',sandboxType:'workspaceWrite',
    writableRootsCount:2,responsePolicyFields:['sandbox','activePermissionProfile']
  });
  assert.doesNotMatch(visible,/private-path|private-profile|private-error|\/private\//);
  details.open=true;
  f.state.updatedAt=Date.now();f.state.policy={ok:true,reason:''};f.controls.render();
  assert.equal(results.children[1],details);assert.equal(details.open,true);
  assert.equal(details.children[1].textContent,visible);
  f.block(true);assert.equal(results.children[1],details);assert.equal(details.open,true);
});

test('unrecognized diagnostic values cannot become visible booleans or policy names',()=>{
  const [row]=readinessSummary({modelTurnStarted:false,work:{status:'ready'},chat:{status:'blocked',code:'permission_mismatch',diagnostics:{
    profileMatches:'private-value',networkAccess:'private-value',excludeTmpdirEnvVar:{secret:'private-value'},
    excludeSlashTmp:null,approvalPolicy:'private-policy',sandboxType:'private-sandbox',
    writableRootsCount:-1,responsePolicyFields:['private-field'],extra:'private-path'
  }}});
  assert.deepEqual(row.diagnostics,{responsePolicyFields:[]});
});
