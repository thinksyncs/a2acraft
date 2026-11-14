import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const {copyPackagedFrontend}=createRequire(import.meta.url)('../scripts/package-frontend.cjs');

async function fixture(t, alias=false) {
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'a2acraft-package-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const source=path.join(root,alias?'frontend':'public');
  await mkdir(source); await mkdir(path.join(source,'assets'));
  await writeFile(path.join(source,'index.html'),'<title>A2ACraft</title>');
  await writeFile(path.join(source,'app.js'),'export const ready=true;');
  await writeFile(path.join(source,'assets','map.png'),Buffer.from([0,1,255]));
  if(alias)await symlink('frontend',path.join(root,'public'));
  return {root,source,destination:path.join(root,'out','A2ACraft.app','Contents','Resources','backend','public')};
}

for(const alias of [false,true])test(`packaged frontend includes HTML, module and binary assets (${alias?'restored alias':'canonical directory'})`,async t=>{
  const data=await fixture(t,alias);
  assert.equal((await copyPackagedFrontend(data)).files,3);
  assert.equal(await readFile(path.join(data.destination,'index.html'),'utf8'),'<title>A2ACraft</title>');
  assert.deepEqual(await readFile(path.join(data.destination,'assets','map.png')),Buffer.from([0,1,255]));
});

test('unknown alias and nested links are rejected before copying resources',async t=>{
  const data=await fixture(t);
  await symlink('missing-target',path.join(data.source,'assets','link'));
  await assert.rejects(copyPackagedFrontend(data),/symbolic links/);
  await assert.rejects(readFile(path.join(data.destination,'index.html')),/ENOENT/);
  await rm(path.join(data.root,'public'),{recursive:true});
  await symlink('unknown',path.join(data.root,'public'));
  await assert.rejects(copyPackagedFrontend(data),/Unsupported public directory alias/);
});

test('output directory links cannot redirect the package write',async t=>{
  const data=await fixture(t);
  await mkdir(path.join(data.root,'outside'));
  await symlink('outside',path.join(data.root,'out'));
  await assert.rejects(copyPackagedFrontend(data),/not an owned directory/);
});
