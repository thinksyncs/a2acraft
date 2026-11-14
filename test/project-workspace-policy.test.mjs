import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedRepositoryRemote,projectCommandEnvironment} from '../project-workspaces.mjs';

test('Project commands discard inherited Git/SSH overrides and disable external SSH transport',()=>{
 const source={PATH:'/usr/bin:/bin',GH_TOKEN:'fixture-only',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.sshCommand',GIT_CONFIG_VALUE_0:'unexpected-command',GIT_CONFIG_PARAMETERS:'unexpected',GIT_CONFIG:'/tmp/untrusted-config',GIT_DIR:'/tmp/other-repo',GIT_WORK_TREE:'/tmp/other-worktree',GIT_SSH_COMMAND:'unexpected-command',SSH_AUTH_SOCK:'/tmp/agent',GCM_INTERACTIVE:'always',NODE_OPTIONS:'--require untrusted',BASH_ENV:'/tmp/startup'};
 const env=projectCommandEnvironment(source);
 assert.equal(env.PATH,source.PATH);assert.equal(env.GH_TOKEN,source.GH_TOKEN);
 for(const key of ['GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','GIT_CONFIG_PARAMETERS','GIT_CONFIG','GIT_DIR','GIT_WORK_TREE','SSH_AUTH_SOCK','NODE_OPTIONS','BASH_ENV'])assert.equal(env[key],undefined,key);
 for(const [key,value] of Object.entries({GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_SSH:'/usr/bin/false',GIT_SSH_COMMAND:'/usr/bin/false',GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}))assert.equal(env[key],value,key);
 assert.equal(source.GIT_SSH_COMMAND,'unexpected-command','the caller environment stays unchanged');
});

test('Known GitHub remotes become HTTPS; other SSH transports and credentials are rejected',()=>{
 for(const remote of ['git@github.com:sample/project.git','ssh://git@github.com/sample/project.git','https://github.com/sample/project','https://github.com/sample/project.git'])assert.equal(normalizedRepositoryRemote(remote),'https://github.com/sample/project.git');
 for(const remote of ['git@example.com:sample/project.git','ssh://git@example.com/sample/project.git','git+ssh://github.com/sample/project.git','https://token@github.com/sample/project.git','ext::unexpected-command','ssh://git@github.com:2222/sample/project.git'])assert.throws(()=>normalizedRepositoryRemote(remote),remote);
 assert.equal(normalizedRepositoryRemote('/tmp/local-repository'),'/tmp/local-repository');
});
