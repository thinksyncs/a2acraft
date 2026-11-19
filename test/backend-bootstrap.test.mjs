import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {waitForBackendReady,stopOwnedChild} from '../electron/runtime-recovery.mjs';

const source=fileURLToPath(new URL('../backend-bootstrap.mjs',import.meta.url));
async function fixture(t,server,{dropProgressCallback=false}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'a2acraft-bootstrap-'));
  await copyFile(source,path.join(root,'backend-bootstrap.mjs'));
  if(server!==undefined)await writeFile(path.join(root,'server.mjs'),server);
  const args=[];
  if(dropProgressCallback){
    const preload=path.join(root,'delayed-progress.cjs');
    await writeFile(preload,"const send=process.send.bind(process);process.send=(message,...args)=>message?.type==='startup-progress'?send(message):send(message,...args);");
    args.push('--require',preload);
  }
  args.push(path.join(root,'backend-bootstrap.mjs'));
  const child=spawn(process.execPath,args,{
    cwd:root,env:{OPENSSL_CONF:'/dev/null'},stdio:['ignore','pipe','pipe','ipc']
  });
  t.after(async()=>{await stopOwnedChild(child,{graceMs:100});await rm(root,{recursive:true,force:true});});
  const messages=[];
  child.on('message',value=>messages.push(value));
  return {child,messages};
}

test('entry point reports module loading before the fixed sibling starts',async t=>{
  const {child,messages}=await fixture(t,
    "process.send({type:'ready',port:4317,origin:'http://127.0.0.1:4317'});setInterval(()=>{},1000);");
  assert.equal((await waitForBackendReady(child)).port,4317);
  assert.deepEqual(messages[0],{type:'startup-progress',stage:'module-load'});
  assert.equal(messages[1].type,'ready');
});

test('a progress delivery callback cannot block application startup',async t=>{
  const {child,messages}=await fixture(t,
    "process.send({type:'ready',port:4317,origin:'http://127.0.0.1:4317'});setInterval(()=>{},1000);",
    {dropProgressCallback:true});
  assert.equal((await waitForBackendReady(child,{timeoutMs:1000,stopOptions:{graceMs:100}})).port,4317);
  assert.deepEqual(messages[0],{type:'startup-progress',stage:'module-load'});
  assert.equal(messages[1].type,'ready');
});

test('missing packaged dependency reports a fixed code without its local path',async t=>{
  const {child,messages}=await fixture(t);
  await assert.rejects(waitForBackendReady(child),error=>{
    assert.match(error.publicDiagnostic,/code=ERR_MODULE_NOT_FOUND/);
    assert.doesNotMatch(error.publicDiagnostic,/a2acraft-bootstrap|server\.mjs|file:/);
    return true;
  });
  assert.deepEqual(messages,[{type:'startup-progress',stage:'module-load'},
    {type:'startup-error',code:'ERR_MODULE_NOT_FOUND'}]);
});

test('module failures never expose arbitrary error codes or messages',async t=>{
  const {child,messages}=await fixture(t,
    "throw Object.assign(Error('secret local contents'),{code:'PRIVATE_ACCOUNT'});");
  await assert.rejects(waitForBackendReady(child),/code=BACKEND_IMPORT_FAILED/);
  assert.deepEqual(messages[1],{type:'startup-error',code:'BACKEND_IMPORT_FAILED'});
  assert.doesNotMatch(JSON.stringify(messages),/secret|contents|PRIVATE_ACCOUNT/);
});

test('a stalled dependency is identified as module-load instead of runtime bootstrap',async t=>{
  const {child}=await fixture(t,
    "setInterval(()=>{},1000);await new Promise(()=>{});");
  await assert.rejects(waitForBackendReady(child,{timeoutMs:1000,stopOptions:{graceMs:100}}),
    /stage=module-load$/);
});
