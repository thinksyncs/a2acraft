import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownedSourceFiles } from "../scripts/check-module-size.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),
  manifest=JSON.parse(await readFile(path.join(root,"package.json"),"utf8")),
  owned=new Set(await ownedSourceFiles(root));
const resources=manifest.build.extraResources.find(item=>item.from==="."&&item.to==="backend");
const backend=new Set(resources.filter.filter(file=>file.endsWith(".mjs")));
const publicFile=file=>owned.has(file)?file:file.startsWith("public/")?"frontend/"+file.slice(7):file;
const localImports=source=>[...source.matchAll(/\b(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g)].map(match=>match[1]);
const source=file=>readFile(path.join(root,publicFile(file)),"utf8");

test("The packaged backend includes every local module its services import",async()=>{
  assert.ok(resources.filter.includes("public/**/*"),"browser files and shared frontend models are bundled");
  for(const file of backend){
    assert.ok(owned.has(file),`missing packaged backend source: ${file}`);
    for(const specifier of localImports(await source(file))){
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier));
      assert.ok(!dependency.startsWith("../")&&!path.posix.isAbsolute(dependency),`${file} leaves the application resource directory`);
      assert.ok(dependency.startsWith("public/")||backend.has(dependency),`${file} imports unbundled ${dependency}`);
      assert.ok(owned.has(publicFile(dependency)),`${file} imports missing or linked ${dependency}`);
    }
  }
});

test("Desktop helpers are bundled while desktop test modules stay outside the app",async()=>{
  const files=manifest.build.files;
  assert.ok(files.includes("electron/*.mjs"));assert.ok(files.includes("!electron/*.test.mjs"));
  assert.ok(files.includes("electron/preload.cjs"));
  for(const file of [...owned].filter(file=>/^electron\/[^/]+\.mjs$/.test(file)&&!file.endsWith(".test.mjs"))){
    for(const specifier of localImports(await source(file))){
      const dependency=path.posix.normalize(path.posix.join("electron",specifier));
      assert.ok(/^electron\/[^/]+\.(?:mjs|cjs)$/.test(dependency)&&!dependency.endsWith(".test.mjs"),`${file} imports unpackaged ${dependency}`);
      assert.ok(owned.has(dependency),`${file} imports missing ${dependency}`);
    }
  }
});

test("Mac review packages target the available document runtime without signing discovery or publishing",()=>{
  assert.equal(manifest.repository.type,"git");
  assert.match(manifest.repository.url,/^https:\/\/github\.com\//,"builder metadata does not need local Git discovery");
  for(const target of ["dmg","zip"]){
    const entry=manifest.build.mac.target.find(item=>item.target===target);
    assert.deepEqual(entry.arch,["arm64"]);
  }
  assert.match(manifest.build.mac.artifactName,/\$\{arch\}/);
  assert.equal(manifest.build.mac.identity,null);assert.equal(manifest.build.mac.notarize,false);
  for(const command of ["dist:mac","dist:mac:arm64","pack:mac"]){
    assert.match(manifest.scripts[command],/^CSC_IDENTITY_AUTO_DISCOVERY=false /);
    assert.match(manifest.scripts[command],/--publish never(?:\s|$)/);
  }
});

test("An unsupported Intel package fails before packing instead of shipping a missing document engine",async()=>{
  const {default:guard}=await import('../scripts/check-mac-platform.cjs');
  const {Arch}=await import('builder-util');
  await guard({electronPlatformName:'darwin',arch:Arch.arm64});
  await assert.rejects(guard({electronPlatformName:'darwin',arch:Arch.x64}),/Apple Silicon only/);
  assert.equal(manifest.build.beforePack,'scripts/check-mac-platform.cjs');
});
