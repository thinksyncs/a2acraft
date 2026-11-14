import path from 'node:path';
import {ensureAgentWorkspace, standingAgentInstructions} from './codex-workspace-policy.mjs';
import {verifyThreadPermissions} from './codex-launch.mjs';

// This check creates only empty, ephemeral Codex threads. It never sends a
// model turn, reads account data, or changes configuration/permission policy.
// Return fixed classifications only: RPC errors can contain private paths.
function threadFailure(error) {
  if (error?.code === 'execution_scope') return 'permission_mismatch';
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/sandbox-exec:\s*sandbox_apply:\s*Operation not permitted\b/.test(message))
    return 'sandbox_initialization_denied';
  if (/failed to load AGENTS\.md instructions for environment\b[^\n]*Operation not permitted\b/.test(message))
    return 'instructions_unavailable';
  return 'thread_start_failed';
}

function safeDiagnostics(value) {
  if (!value || typeof value !== 'object') return {};
  const diagnostics = {};
  for (const key of ['cwdMatches', 'writableRootsWithinScope', 'profileMatches', 'networkAccess', 'excludeTmpdirEnvVar', 'excludeSlashTmp'])
    diagnostics[key] = typeof value[key] === 'boolean' ? value[key] : null;
  diagnostics.approvalPolicy = ['never', 'on-request', 'on-failure', 'untrusted'].includes(value.approvalPolicy) ? value.approvalPolicy : 'unknown';
  diagnostics.sandboxType = ['readOnly', 'workspaceWrite', 'dangerFullAccess', 'externalSandbox'].includes(value.sandboxType) ? value.sandboxType : 'unknown';
  diagnostics.writableRootsCount = Number.isInteger(value.writableRootsCount) && value.writableRootsCount >= 0 && value.writableRootsCount <= 0xffffffff ? value.writableRootsCount : null;
  diagnostics.responsePolicyFields = ['sandbox', 'sandboxPolicy', 'permissions', 'activePermissionProfile', 'permissionProfile',
    'permissionsProfile', 'permissionProfileName', 'approvalPolicy', 'cwd'].filter(key => Array.isArray(value.responsePolicyFields) && value.responsePolicyFields.includes(key));
  return {diagnostics};
}

export async function checkCodexReadiness({rpc, workspace}) {
  if (typeof rpc !== 'function') throw TypeError('A Codex RPC function is required');
  const result = {modelTurnStarted: false};
  for (const mode of ['chat', 'work']) {
    let cwd;
    try {
      if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw Error('Invalid workspace');
      cwd = path.join(workspace, '.a2acraft-check', mode);
      await ensureAgentWorkspace(cwd);
    } catch {
      result[mode] = {status: 'blocked', code: 'workspace_unavailable', stage: 'workspace'};
      continue;
    }
    let thread;
    try {
      thread = await rpc('thread/start', {
        cwd, ephemeral: true, approvalPolicy: 'never',
        sandbox: mode === 'chat' ? 'read-only' : 'workspace-write',
        developerInstructions: standingAgentInstructions +
          '\nA2ACraft permission readiness check. No model turn or task is requested.'
      });
      if (typeof thread?.thread?.id !== 'string' || !thread.thread.id)
        throw Error('Missing ephemeral thread');
    } catch (error) {
      result[mode] = {status: 'blocked', code: threadFailure(error), stage: 'thread',
        ...(error?.code === 'execution_scope' ? safeDiagnostics(error.diagnostics) : {})};
      continue;
    }
    try {
      verifyThreadPermissions(thread, {cwd, readOnly: mode === 'chat'});
      result[mode] = {status: 'ready', code: 'ready', stage: 'permissions'};
    } catch (error) {
      result[mode] = {status: 'blocked', code: 'permission_mismatch', stage: 'permissions',
        ...safeDiagnostics(error.diagnostics)};
    }
  }
  return result;
}
