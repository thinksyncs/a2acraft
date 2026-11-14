import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, realpath, symlink, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {checkCodexReadiness} from '../codex-readiness.mjs';
import {standingAgentInstructions} from '../codex-workspace-policy.mjs';

async function fixture(t) {
  const workspace = await mkdtemp(path.join(await realpath(tmpdir()), 'a2acraft-readiness-'));
  t.after(() => rm(workspace, {recursive: true, force: true}));
  return workspace;
}
function response(request) {
  return {thread: {id: 'ephemeral-test'}, cwd: request.cwd, approvalPolicy: 'never',
    sandbox: request.sandbox === 'read-only' ? {type: 'readOnly'} : {type: 'workspaceWrite', writableRoots: []}};
}
const ready = {status: 'ready', code: 'ready', stage: 'permissions'};

test('readiness verifies both scopes sequentially without model, account or configuration RPCs', async t => {
  const workspace = await fixture(t), calls = [];
  let inFlight = false;
  const result = await checkCodexReadiness({workspace, rpc: async (method, request) => {
    assert.equal(inFlight, false); inFlight = true;
    assert.equal(method, 'thread/start');
    assert.deepEqual(Object.keys(request).sort(), ['approvalPolicy', 'cwd', 'developerInstructions', 'ephemeral', 'sandbox']);
    assert.equal(request.ephemeral, true); assert.equal(request.approvalPolicy, 'never');
    assert(request.developerInstructions.includes(standingAgentInstructions));
    assert((await readFile(path.join(request.cwd, 'AGENTS.md'), 'utf8')).includes(standingAgentInstructions));
    calls.push(request); inFlight = false; return response(request);
  }});
  assert.deepEqual(calls.map(call => call.cwd), ['chat', 'work'].map(mode => path.join(workspace, '.a2acraft-check', mode)));
  assert.deepEqual(calls.map(call => call.sandbox), ['read-only', 'workspace-write']);
  assert.deepEqual(result, {modelTurnStarted: false, chat: ready, work: ready});
  for (const mode of ['chat', 'work'])
    assert.deepEqual(await readdir(path.join(workspace, '.a2acraft-check', mode)), ['AGENTS.md']);
});

test('known native failures are classified without exposing RPC text, paths or unrelated values', async t => {
  const workspace = await fixture(t);
  const cases = [
    ['fs sandbox helper failed with status exit status: 71: sandbox-exec: sandbox_apply: Operation not permitted', 'sandbox_initialization_denied'],
    ['failed to load AGENTS.md instructions for environment `local`: Operation not permitted (os error 1)', 'instructions_unavailable'],
    ['failed to load AGENTS.md instructions for environment `local`: fs sandbox helper: sandbox-exec: sandbox_apply: Operation not permitted', 'sandbox_initialization_denied'],
    ['Unrecognized error /private/example with opaque-private-value', 'thread_start_failed'],
    ['Operation not permitted', 'thread_start_failed']
  ];
  for (const [message, code] of cases) {
    let count = 0;
    const result = await checkCodexReadiness({workspace, rpc: async (_method, request) => {
      if (++count === 1) throw Error(message);
      return response(request);
    }});
    assert.deepEqual(result.chat, {status: 'blocked', code, stage: 'thread'});
    assert.deepEqual(result.work, ready); assert.equal(count, 2);
    assert.equal(JSON.stringify(result).includes(message), false);
    assert.equal(JSON.stringify(result).includes(workspace), false);
  }
});

test('returned effective permissions must match the requested scope before readiness succeeds', async t => {
  const workspace = await fixture(t);
  const invalid = [
    value => ({...value, cwd: workspace}),
    value => ({...value, approvalPolicy: 'on-request'}),
    value => ({...value, sandbox: {type: 'dangerFullAccess'}}),
    value => ({...value, sandbox: {type: 'externalSandbox'}}),
    value => ({...value, sandbox: {type: 'workspaceWrite', writableRoots: [workspace]}})
  ];
  for (const alter of invalid) {
    const result = await checkCodexReadiness({workspace, rpc: async (_method, request) => alter(response(request))});
    for (const mode of ['chat', 'work']) {
      const {diagnostics, ...status} = result[mode];
      assert.deepEqual(status, {status: 'blocked', code: 'permission_mismatch', stage: 'permissions'});
      assert.equal(typeof diagnostics.cwdMatches, 'boolean');
      assert.deepEqual(diagnostics.responsePolicyFields, ['sandbox', 'approvalPolicy', 'cwd']);
      assert.equal(JSON.stringify(diagnostics).includes(workspace), false);
    }
  }
  const result = await checkCodexReadiness({workspace, rpc: async (_method, request) => ({...response(request), sandbox: {type: 'readOnly'}})});
  assert.deepEqual(result.chat, ready);
  assert.equal(result.work.code, 'permission_mismatch');
});

test('permission mismatch diagnostics reveal contract shape but never raw paths or unknown policy values', async t => {
  const workspace = await fixture(t);
  const mismatch = await checkCodexReadiness({workspace, rpc: async (_method, request) => ({
    thread: {id: 'ephemeral-test'}, cwd: request.cwd, approvalPolicy: 'never',
    sandbox: {type: 'workspaceWrite', writableRoots: [request.cwd, path.join(workspace, 'outside')]},
    permissions: {profile: 'private-profile'}, activePermissionProfile: {name: 'private-profile'}, permissionProfile: 'private-profile',
    privateUnknownField: 'private-value'
  })});
  for (const mode of ['chat', 'work']) assert.deepEqual(mismatch[mode].diagnostics, {
    cwdMatches: true, approvalPolicy: 'never', sandboxType: 'workspaceWrite',
    writableRootsCount: 2, writableRootsWithinScope: false,
    profileMatches: null, networkAccess: null, excludeTmpdirEnvVar: null, excludeSlashTmp: null,
    responsePolicyFields: ['sandbox', 'permissions', 'activePermissionProfile', 'permissionProfile', 'approvalPolicy', 'cwd']
  });
  assert.equal(JSON.stringify(mismatch).includes('private-'), false);
  assert.equal(JSON.stringify(mismatch).includes(workspace), false);
  const unknown = await checkCodexReadiness({workspace, rpc: async () => ({
    thread: {id: 'ephemeral-test'}, cwd: 'private-path', approvalPolicy: {reject: 'private-value'},
    sandbox: {type: 'private-policy', writableRoots: 'private-roots'}, permissionsProfile: {name: 'private-profile'}
  })});
  for (const mode of ['chat', 'work']) assert.deepEqual(unknown[mode].diagnostics, {
    cwdMatches: false, approvalPolicy: 'unknown', sandboxType: 'unknown',
    writableRootsCount: null, writableRootsWithinScope: null,
    profileMatches: null, networkAccess: null, excludeTmpdirEnvVar: null, excludeSlashTmp: null,
    responsePolicyFields: ['sandbox', 'permissionsProfile', 'approvalPolicy', 'cwd']
  });
  assert.equal(JSON.stringify(unknown).includes('private-'), false);
});

test('RPC permission rejection exposes only whitelisted safe diagnostic values', async t => {
  const workspace = await fixture(t);
  const result = await checkCodexReadiness({workspace, rpc: async () => {
    throw Object.assign(Error('private-path-and-message'), {code: 'execution_scope', diagnostics: {
      cwdMatches: true, profileMatches: false, networkAccess: 'private-value', excludeTmpdirEnvVar: true,
      excludeSlashTmp: false, approvalPolicy: 'private-policy', sandboxType: 'workspaceWrite',
      writableRootsCount: -1, writableRootsWithinScope: 'private-path',
      responsePolicyFields: ['activePermissionProfile', 'private-field'], raw: 'private-secret'
    }});
  }});
  for (const mode of ['chat', 'work']) assert.deepEqual(result[mode], {
    status: 'blocked', code: 'permission_mismatch', stage: 'thread', diagnostics: {
      cwdMatches: true, profileMatches: false, networkAccess: null, excludeTmpdirEnvVar: true,
      excludeSlashTmp: false, approvalPolicy: 'unknown', sandboxType: 'workspaceWrite',
      writableRootsCount: null, writableRootsWithinScope: null, responsePolicyFields: ['activePermissionProfile']
    }
  });
  assert.equal(JSON.stringify(result).includes('private-'), false);
});

test('a malformed thread result never claims readiness', async t => {
  const workspace = await fixture(t);
  for (const returned of [null, {}, {thread: {}}]) {
    const result = await checkCodexReadiness({workspace, rpc: async () => returned});
    for (const mode of ['chat', 'work']) assert.equal(result[mode].code, 'thread_start_failed');
  }
});

test('conflicting instructions are preserved and that scope never starts a thread', async t => {
  const workspace = await fixture(t), chat = path.join(workspace, '.a2acraft-check', 'chat');
  await mkdir(chat, {recursive: true});
  const file = path.join(chat, 'AGENTS.md');
  const previous = '<!-- chat-ui-standing-protections:start -->\nConflicting rules\n<!-- chat-ui-standing-protections:end -->\n';
  await writeFile(file, previous);
  const calls = [];
  const result = await checkCodexReadiness({workspace, rpc: async (_method, request) => {
    calls.push(request.cwd); return response(request);
  }});
  assert.deepEqual(result.chat, {status: 'blocked', code: 'workspace_unavailable', stage: 'workspace'});
  assert.deepEqual(result.work, ready);
  assert.deepEqual(calls, [path.join(workspace, '.a2acraft-check', 'work')]);
  assert.equal(await readFile(file, 'utf8'), previous);
});

test('a symlinked readiness directory is rejected without inspecting or changing its target', async t => {
  const workspace = await fixture(t), target = path.join(workspace, 'unrelated');
  await mkdir(target); await writeFile(path.join(target, 'keep.txt'), 'unchanged');
  await symlink(target, path.join(workspace, '.a2acraft-check'));
  const result = await checkCodexReadiness({workspace, rpc: async () => assert.fail('No RPC is allowed')});
  for (const mode of ['chat', 'work']) assert.equal(result[mode].code, 'workspace_unavailable');
  assert.deepEqual(await readdir(target), ['keep.txt']);
  assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'unchanged');
});

test('relative workspaces and a missing RPC cannot silently use another working directory', async () => {
  await assert.rejects(checkCodexReadiness({workspace: '/task'}), TypeError);
  const result = await checkCodexReadiness({workspace: 'relative', rpc: async () => assert.fail('No RPC is allowed')});
  for (const mode of ['chat', 'work']) assert.equal(result[mode].code, 'workspace_unavailable');
});
