import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ownedSourceFiles, checkModuleSizes } from "../scripts/check-module-size.mjs";

test("Module checks inspect owned source only and never follow restoration or external symlinks",async t=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),"chat-ui-module-size-")),root=path.join(temporary,"repo");
  t.after(()=>rm(temporary,{recursive:true,force:true}));
  const files=["server.mjs","frontend/app.js","frontend/plugins/owned.js","electron/main.mjs","test/check.test.mjs",
    "frontend/vendor/library.js","frontend/generated/large.js","frontend/node_modules/package/index.js",
    "frontend/artifacts/large.js","frontend/dist/large.js","frontend/.cache/large.js","docs/example.js","preview/record.js"];
  for(const file of files){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),"// fixture\n");}
  await mkdir(path.join(temporary,"outside"));await writeFile(path.join(temporary,"outside","large.js"),"x".repeat(180001));
  await symlink("frontend",path.join(root,"public"));
  await symlink(path.join(temporary,"outside"),path.join(root,"frontend","linked"));
  await symlink(path.join(temporary,"outside","large.js"),path.join(root,"frontend","linked.js"));
  assert.deepEqual(await ownedSourceFiles(root),[
    "electron/main.mjs","frontend/app.js","frontend/plugins/owned.js","server.mjs","test/check.test.mjs"]);
  assert.deepEqual(await checkModuleSizes(root),{count:5,oversized:[]});
});

test("Module size checks include new untracked public files and enforce byte and line limits",async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"chat-ui-module-limits-"));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,"public"));
  await writeFile(path.join(root,"public","new.js"),"x".repeat(180001));
  await writeFile(path.join(root,"line-limit.mjs"),"\n".repeat(10000));
  const result=await checkModuleSizes(root);
  assert.equal(result.count,2);assert.deepEqual(result.oversized,[
    "line-limit.mjs: 10001 lines, 10000 bytes","public/new.js: 1 lines, 180001 bytes"]);
});
