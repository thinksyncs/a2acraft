import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ensureAgentWorkspace} from './codex-workspace-policy.mjs';

const execute=promisify(execFile);
const idPattern=/^[a-zA-Z0-9-]{1,80}$/;
export function projectCommandEnvironment(base=process.env){
 const env={};
 for(const [key,value] of Object.entries(base))if(typeof value==='string'&&!/^(?:GIT_|SSH_|GCM_|DYLD_|LD_)/i.test(key)&&!/^(?:BASH_ENV|ENV|ZDOTDIR|NODE_OPTIONS|NODE_PATH)$/i.test(key))env[key]=value;
 return {...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_ATTR_NOSYSTEM:'1',GIT_SSH:'/usr/bin/false',GIT_SSH_COMMAND:'/usr/bin/false',GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'};
}
export function normalizedRepositoryRemote(value){
 if(typeof value!=='string'||!value.trim())throw Error('repoのoriginを確認できません。');
 value=value.trim();
 const githubSsh=/^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(value);
 if(githubSsh)return repositorySource('https://github.com/'+githubSsh[1]);
 if(path.isAbsolute(value))return value;
 return repositorySource(value);
}
export function repositorySource(value){
 if(typeof value!=='string'||!value.trim()||value.length>2048)throw Error('repoのURLまたは絶対パスを入力してください。');
 value=value.trim();
 if(path.isAbsolute(value))return value;
 let url;try{url=new URL(value);}catch{throw Error('repoはGitHubのHTTPS URL、またはローカルの絶対パスで指定してください。');}
 if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname))throw Error('認証情報を含まないGitHubのrepo URLを指定してください。');
 return 'https://github.com/'+url.pathname.slice(1).replace(/\/$/,'').replace(/\.git$/,'')+'.git';
}
function githubSlug(remote){
 const match=/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote||'');
 return match?.[1]||null;
}
const safeFile=name=>!/(^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[^/]+)?|id_rsa|id_ed25519|credentials(?:\.json)?|auth\.json)$|\.(?:pem|p12|pfx|key)$/i.test(name);

export class ProjectWorkspaces{
 constructor(directory,{gh=process.env.CHAT_UI_GH_BIN||'gh'}={}){this.root=path.join(directory,'project-workspaces');this.gh=gh;}
 directory(projectId){if(!idPattern.test(projectId))throw Error('Invalid project ID');return path.join(this.root,projectId);}
 async command(file,args,cwd,{timeout=120000,signal,raw=false}={}){
  try{const result=await execute(file,args,{cwd,timeout,signal,maxBuffer:2*1024*1024,env:projectCommandEnvironment()});return raw?result.stdout:result.stdout.trim();}
  catch(error){if(signal?.aborted)throw Object.assign(Error('作業を停止しました。'),{code:'stopped'});throw Error((error.stderr||error.message||'コマンドが失敗しました。').slice(0,3000));}
 }
 git(cwd,args,options){return this.command('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.sshCommand=/usr/bin/false','-c','protocol.ssh.allow=never','-c','protocol.ext.allow=never','-c','credential.helper=','-c','user.name=Village Agent','-c','user.email=village-agent@users.noreply.github.com',...args],cwd,options);}
 async prepare(project,signal){
  const directory=this.directory(project.id);await mkdir(directory,{recursive:true,mode:0o700});
  const result=[];
  for(const repo of project.repositories){
   const cwd=path.join(directory,'repos',repo.id);await mkdir(path.dirname(cwd),{recursive:true});
   const source=repositorySource(repo.source);
   let remote=source;
   if(path.isAbsolute(source)){const resolved=await realpath(source);await this.git(resolved,['rev-parse','--show-toplevel'],{signal});remote=await this.git(resolved,['config','--get','remote.origin.url'],{signal}).catch(()=>source);}
   remote=normalizedRepositoryRemote(remote);
   let existing=false;try{existing=(await this.git(cwd,['rev-parse','--is-inside-work-tree'],{signal}))==='true';}catch{}
   if(!existing)await this.git(directory,['clone','--no-hardlinks','--no-local','--',source,cwd],{signal});
   // A local source is copied from committed Git history, never edited in place.
   if(githubSlug(remote))await this.git(cwd,['remote','set-url','origin',remote],{signal});
   const base=repo.base||await this.git(cwd,['branch','--show-current'],{signal});
   if(!base)throw Error('基準ブランチを指定してください。');
   await this.git(cwd,['check-ref-format','--branch',base],{signal});
   const baseCommit=repo.baseCommit||await this.git(cwd,['rev-parse','--verify','refs/remotes/origin/'+base+'^{commit}'],{signal});
   result.push({...repo,cwd,base,baseCommit,remote,github:githubSlug(remote)});
  }
  return result;
 }
 async worktree(project,repo,job,dependencies=[],signal,repair){
  if(!idPattern.test(job.id))throw Error('Invalid job ID');
  const cwd=path.join(this.directory(project.id),'work',job.id),branch='village/'+project.id.slice(0,8)+'/'+job.id;
  // Git resolves directory aliases (for example /var -> /private/var on macOS).
  // Compare physical paths so a retry reuses the existing worktree and branch.
  let exists=false;try{exists=await realpath(await this.git(cwd,['rev-parse','--show-toplevel'],{signal}))===await realpath(cwd);}catch{}
  if(!exists){await mkdir(path.dirname(cwd),{recursive:true});await this.git(repo.cwd,['worktree','add','-b',branch,cwd,repo.baseCommit],{signal});}
  for(const commit of [...new Set(dependencies)].filter(Boolean)){
   // Cherry-picks receive a source marker; recovery does not apply an ancestor twice.
   const history=await this.git(cwd,['log','--format=%B',repo.baseCommit+'..HEAD'],{signal});
   if(history.includes('(cherry picked from commit '+commit+')'))continue;
   try{await this.git(cwd,['cherry-pick','-x',commit],{signal});}
   catch(error){
    const unresolved=await this.git(cwd,['diff','--name-only','--diff-filter=U'],{signal});
    if(!unresolved||!repair)throw error;
    // Leave Git's integration operation to the host. The agent only edits files.
    try{await ensureAgentWorkspace(await realpath(cwd));await repair(cwd,unresolved);await this.guardFiles(cwd,signal);await this.git(cwd,['add','--all'],{signal});await this.git(cwd,['-c','core.editor=true','cherry-pick','--continue'],{signal});}
    catch(failure){await this.git(cwd,['cherry-pick','--abort']).catch(()=>{});throw failure;}
   }
  }
  await ensureAgentWorkspace(await realpath(cwd));
  return {workspace:cwd,branch};
 }
 async guardFiles(cwd,signal){
  const files=(await this.git(cwd,['diff','--name-only','-z','HEAD'],{signal,raw:true})+await this.git(cwd,['ls-files','--others','--exclude-standard','-z'],{signal,raw:true})).split('\0').filter(Boolean);
  if(files.some(name=>!safeFile(name)))throw Error('認証情報に使われる名前のファイルが変更に含まれています。コミット対象を確認してください。');
  await this.git(cwd,['diff','--check'],{signal});
 }
 async commit(cwd,message,signal){
  await this.guardFiles(cwd,signal);
  await this.git(cwd,['add','--all'],{signal});
  await this.git(cwd,['-c','user.name=Village Agent','-c','user.email=village-agent@users.noreply.github.com','commit','--allow-empty','-m',message],{signal});
  return this.git(cwd,['rev-parse','HEAD'],{signal});
 }
 async publish(project,repo,job,signal){
  if(!repo.github)throw Error('PRを作るには、元repoのoriginをGitHubに設定してください。実装と検証は専用の作業場所に保存されています。');
  const remote=normalizedRepositoryRemote(repo.remote);
  if(!remote.startsWith('https://github.com/')||githubSlug(remote)!==repo.github)throw Error('公開先のGitHub HTTPS URLを確認できません。');
  const cwd=job.workspace,branch=job.branch;
  if(!cwd||!branch)throw Error('公開する作業ブランチがありません。');
  const existing=JSON.parse(await this.command(this.gh,['pr','list','--repo',repo.github,'--head',branch,'--state','all','--json','url,state'],cwd,{signal}));
  if(existing.length){if(existing[0].state==='CLOSED')throw Error('この作業のPRは閉じられています。公開状態を確認してください。');if(!existing[0].url?.startsWith('https://github.com/'+repo.github+'/pull/'))throw Error('PRのURLを確認できません。');return existing[0].url;}
  await this.git(cwd,['push',remote,branch+':refs/heads/'+branch],{signal});
  const body=path.join(this.directory(project.id),'pr-'+repo.id+'.md');
  await writeFile(body,'## 目的\n\n'+project.goal+'\n\n## 変更と確認\n\n'+job.output+'\n\n## 実行した確認\n\n'+(job.checks||[]).map(check=>'- `'+check.command.replaceAll('`',"'")+'` — exit '+check.exitCode).join('\n')+'\n',{mode:0o600});
  const url=await this.command(this.gh,['pr','create','--repo',repo.github,'--base',repo.base,'--head',branch,'--title',project.name.slice(0,100),'--body-file',body],cwd,{signal});
  const match=/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.exec(url);
  if(!match||!match[0].startsWith('https://github.com/'+repo.github+'/pull/'))throw Error('PRの作成結果を確認できません。再確認で既存PRを照合します。');
  return match[0];
 }
}
