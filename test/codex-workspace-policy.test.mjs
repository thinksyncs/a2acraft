import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, realpath, symlink, lstat, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {standingAgentInstructions, ensureAgentWorkspace, isolatedCodexConfig,
  initializeIsolatedCodexHome, buildIsolatedCodexEnvironment} from '../codex-workspace-policy.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'chat-ui-policy-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  return root;
}

test('workspace keeps existing instructions byte-for-byte and adds verified standing rules once', async t => {
  const root = await fixture(t), workspace = path.join(root, 'workspace'); await mkdir(workspace);
  const file = path.join(workspace, 'AGENTS.md'), original = Buffer.from('# Existing rules\r\nKeep the original format.');
  await writeFile(file, original);
  assert.equal((await ensureAgentWorkspace(workspace)).instructionsVerified, true);
  const first = await readFile(file);
  assert(first.subarray(0, original.length).equals(original));
  assert(first.includes(Buffer.from(standingAgentInstructions)));
  assert.equal((await ensureAgentWorkspace(workspace)).changed, false);
  assert((await readFile(file)).equals(first));
});

test('a conflicting owned instruction block is preserved for review', async t => {
  const root = await fixture(t), file = path.join(root, 'AGENTS.md');
  const content = '<!-- chat-ui-standing-protections:start -->\nDifferent policy\n<!-- chat-ui-standing-protections:end -->\n';
  await writeFile(file, content);
  await assert.rejects(ensureAgentWorkspace(root), /differ/);
  assert.equal(await readFile(file, 'utf8'), content);
});

test('instruction and ancestor symlinks are rejected without changing their targets', async t => {
  const root = await fixture(t), target = path.join(root, 'target'); await mkdir(target);
  const file = path.join(target, 'instructions.txt'); await writeFile(file, 'untouched');
  const direct = path.join(root, 'direct'); await mkdir(direct); await symlink(file, path.join(direct, 'AGENTS.md'));
  await assert.rejects(ensureAgentWorkspace(direct));
  assert.equal(await readFile(file, 'utf8'), 'untouched');
  const alias = path.join(root, 'alias'); await symlink(target, alias);
  await assert.rejects(ensureAgentWorkspace(path.join(alias, 'new')), /real directories/);
  await assert.rejects(lstat(path.join(target, 'new')), {code:'ENOENT'});
});

test('isolated Codex home creates only its own verified config and instructions', async t => {
  const root = await fixture(t), home = path.join(root, 'codex');
  const result = await initializeIsolatedCodexHome(home);
  assert.equal(result.configCreated, true); assert.equal(result.configurationVerified, true);
  assert.equal(await readFile(result.configPath, 'utf8'), isolatedCodexConfig);
  assert.deepEqual((await readdir(home)).sort(), ['AGENTS.md', 'config.toml']);
  assert.equal((await lstat(result.configPath)).mode & 0o777, 0o600);
  assert.equal((await initializeIsolatedCodexHome(home)).configCreated, false);
});

test('an existing different Codex configuration is never overwritten', async t => {
  const root = await fixture(t), config = path.join(root, 'config.toml');
  await writeFile(config, '# existing user configuration\n');
  await assert.rejects(initializeIsolatedCodexHome(root), /differs/);
  assert.equal(await readFile(config, 'utf8'), '# existing user configuration\n');
  await assert.rejects(lstat(path.join(root, 'AGENTS.md')), {code:'ENOENT'});
});

test('isolated environment retains HOME but excludes inherited identities, credentials and executable hooks', () => {
  const input = {HOME:'/Users/example', PATH:'/usr/bin:/bin', LANG:'ja_JP.UTF-8', HTTPS_PROXY:'http://localhost:8080',
    CODEX_HOME:'/unrelated', CODEX_THREAD_ID:'parent', OPENAI_API_KEY:'secret', GH_TOKEN:'secret',
    SSH_AUTH_SOCK:'/unrelated/socket', GIT_CONFIG_COUNT:'1', GIT_CONFIG_KEY_0:'core.sshCommand', GIT_CONFIG_VALUE_0:'ssh',
    ELECTRON_RUN_AS_NODE:'1', CHAT_UI_SESSION_TOKEN:'secret', BASH_ENV:'/unrelated/startup', NODE_OPTIONS:'--require example'};
  const env = buildIsolatedCodexEnvironment(input, {codexHome:'/task/codex',workspace:'/task/workspace'});
  assert.equal(env.HOME, input.HOME); assert.equal(env.PATH, input.PATH); assert.equal(env.HTTPS_PROXY, input.HTTPS_PROXY);
  assert.equal(env.CODEX_HOME, '/task/codex'); assert.equal(env.PWD, '/task/workspace'); assert.equal(env.SHELL, '/bin/sh');
  for (const key of ['CODEX_THREAD_ID','OPENAI_API_KEY','GH_TOKEN','SSH_AUTH_SOCK','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0','ELECTRON_RUN_AS_NODE','CHAT_UI_SESSION_TOKEN','BASH_ENV','NODE_OPTIONS']) assert.equal(env[key], undefined, key);
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1'); assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(env.GIT_SSH, '/usr/bin/false'); assert.equal(env.GIT_SSH_COMMAND, '/usr/bin/false');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0'); assert.equal(input.CODEX_HOME, '/unrelated');
  assert.throws(() => buildIsolatedCodexEnvironment({}, {codexHome:'relative',workspace:'/task'}), /absolute/);
});
