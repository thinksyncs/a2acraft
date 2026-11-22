import { execFileSync } from 'node:child_process';
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import frontend from './package-frontend.cjs';
import { prepareDistributionNotices } from './prepare-distribution-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const native = path.join(root, 'src-tauri');
const resources = path.join(native, 'resources');
const source = JSON.parse(await readFile(path.join(root,'package.json'), 'utf8'));
const target = execFileSync('rustc', ['-vV'], {encoding:'utf8'}).match(/^host: ([\w.-]+)$/m)?.[1];
if (!target || Number(process.versions.node.split('.')[0]) < 22) {
  throw Error('Tauri preparation requires a native Rust toolchain and Node.js 22 or later');
}
// The bundled native Node and npm addons must run on the same platform as Rust.
const nodeArch = {arm64:'aarch64', x64:'x86_64', ia32:'i686', arm:'arm'}[process.arch];
const rustOS = {darwin:'apple-darwin', win32:'windows', linux:'linux'}[process.platform];
if (!nodeArch || !rustOS || !target.startsWith(nodeArch+'-') || !target.includes(rustOS) ||
    (process.env.TAURI_ENV_TARGET_TRIPLE && process.env.TAURI_ENV_TARGET_TRIPLE !== target)) {
  throw Error('Build Tauri with Node and Rust on the destination OS and architecture');
}

async function ownedDirectory(directory, create = false) {
  const relative = path.relative(root, directory);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..'+path.sep)) throw Error('Path is outside the project');
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current,part);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      await mkdir(current); continue;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Expected a project directory: '+current);
  }
}

async function regularCopy(input, output) {
  if (!(await lstat(input)).isFile()) throw Error('Expected a regular file: '+input);
  await copyFile(input, output);
}

await ownedDirectory(resources, true);
const stage = await mkdtemp(path.join(resources,'.pack-'));
const backend = path.join(stage,'backend');
const nodeName = process.platform === 'win32' ? 'chat-ui-node.exe' : 'chat-ui-node';
const copied = new Set();

// Resolve through the installed npm tree, retaining nested versions and aliases.
// A package may have optional native peers for other platforms that are absent.
async function copyDependency(name, from, optional = false) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) throw Error('Invalid package name: '+name);
  let directory;
  for (let ancestor = from; ; ancestor = path.dirname(ancestor)) {
    if (path.basename(ancestor) !== 'node_modules') {
      const candidate = path.join(ancestor,'node_modules',name);
      try { await ownedDirectory(candidate); directory = candidate; break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (ancestor === root) break;
  }
  if (!directory) {
    if (optional) return;
    throw Error('Install the runtime dependency '+name+' before building Tauri');
  }
  if (copied.has(directory)) return;
  copied.add(directory);
  const manifestPath = path.join(directory, 'package.json');
  if (!(await lstat(manifestPath)).isFile()) throw Error('Expected a package manifest: '+manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const destination = path.join(backend,path.relative(root,directory));
  await cp(directory,destination,{recursive:true,filter:async file=>{
    if (file !== directory && ['node_modules','.git'].includes(path.basename(file))) return false;
    if ((await lstat(file)).isSymbolicLink()) throw Error('Unexpected link in packaged dependency: '+file);
    return true;
  }});
  for (const dep of Object.keys(manifest.dependencies || {})) await copyDependency(dep,directory);
  for (const dep of Object.keys(manifest.optionalDependencies || {})) await copyDependency(dep,directory,true);
}

let backup, installed = false;
try {
  await mkdir(backend);
  // Both desktop shells ship the same allowlisted server modules and frontend.
  const backendSpec = source.build.extraResources.find(entry=>entry.from==='.' && entry.to==='backend');
  if (!backendSpec?.filter.includes('server.mjs')) throw Error('Missing desktop backend resource list');
  for (const module of backendSpec.filter.filter(file=>/^[\w-]+\.mjs$/.test(file))) {
    await regularCopy(path.join(root,module),path.join(backend,module));
  }
  await frontend.copyPackagedFrontend({root,destination:path.join(backend,'public')});
  await mkdir(path.join(backend,'electron'));
  for (const module of ['preview-server','security','map-state','ui-state-store','ui-state-writer']) {
    const name = module+'.mjs';
    await regularCopy(path.join(root,'electron',name),path.join(backend,'electron',name));
  }
  await regularCopy(path.join(native,'sidecar.mjs'),path.join(backend,'tauri-sidecar.mjs'));
  await writeFile(path.join(backend,'package.json'), JSON.stringify({name:source.name,version:source.version,private:true,type:'module',dependencies:source.dependencies},null,2)+'\n');
  for (const dep of Object.keys(source.dependencies)) await copyDependency(dep,root);
  await prepareDistributionNotices({root,output:path.relative(root,path.join(backend,'licenses')).split(path.sep).join('/')});
  const executableDir = path.dirname(process.execPath);
  let licensed = false;
  for (const location of ['../LICENSE','LICENSE','../share/doc/node/LICENSE']) {
    try { await regularCopy(path.resolve(executableDir,location),path.join(backend,'NODE-LICENSE')); licensed = true; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!licensed) throw Error('Use an official Node distribution including the Node LICENSE');
  await writeFile(path.join(backend,'runtime.json'),JSON.stringify({node:process.version,target})+'\n');
  // Ship the upstream-signed executable intact. Re-signing Node as a Tauri
  // external binary would discard its V8 JIT entitlements on Apple Silicon.
  const runtime = path.join(backend, 'runtime');
  await mkdir(runtime);
  await regularCopy(process.execPath, path.join(runtime,nodeName));
  await chmod(path.join(runtime,nodeName), 0o755);
  const destination = path.join(resources,'backend');
  try {
    await ownedDirectory(destination);
    await rename(destination,path.join(stage,'previous'));
    backup = destination;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(backend,destination);
  installed = true;
  console.log('Prepared Tauri for '+target+' with Node '+process.version+' and '+copied.size+' runtime packages');
} finally {
  if (backup && !installed) await rename(path.join(stage,'previous'),backup);
  await rm(stage,{recursive:true,force:true});
}
