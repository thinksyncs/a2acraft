import path from 'node:path';
import {ensureAgentWorkspace, standingAgentInstructions} from './codex-workspace-policy.mjs';

const active = new Set(['starting', 'running', 'stopping']);
const chatInstructions = 'This is a personal chat interface. Answer in Japanese unless requested otherwise. Do not run commands or access files unless the user explicitly requests it.';

export function resolveWorkspaceDirectory(data, override) {
  if (override === undefined || override === '') return path.join(data, 'workspace');
  if (typeof override !== 'string' || !path.isAbsolute(override)) throw Error('CHAT_UI_WORKSPACE_DIRには作業フォルダの絶対パスを指定してください。');
  return path.normalize(override);
}

// Explicit ordinary-chat consent is separate from automatic/party work. The
// scope captured by a send is immutable while its asynchronous setup proceeds.
export class ConversationWorkspaces {
  constructor({directory, save, guard, changed}) {
    this.directory = directory; this.save = save; this.guard = guard; this.changed = changed;
    this.pending = new Set(); this.blocked = new Set();
  }
  assertAvailable(chat) {
    if (this.pending.size || this.blocked.has(chat.id)) throw Error('実行範囲の保存を確認してから送信してください。');
  }
  snapshot(chat, {readOnly = false} = {}) {
    this.assertAvailable(chat);
    const work = !readOnly && chat.workMode === 'work';
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(chat.id)) throw Error('Invalid conversation ID');
    const cwd = work ? path.join(this.directory, 'chats', chat.id) : this.directory;
    const developerInstructions = chatInstructions + '\n\n' + standingAgentInstructions +
      (work ? '\nLOCAL_WORKSPACE_TASK: Only create or edit files inside this conversation\'s assigned working directory. Do not initialize a repository, run Git, publish, or access other conversations. Do not use network tools. Explain the resulting filenames and checks.' : '\nThis turn is read-only. Do not modify files.');
    return {key: (work ? 'work:' : 'chat:') + cwd, cwd,
      thread: {cwd, approvalPolicy: 'never', sandbox: work ? 'workspace-write' : 'read-only', developerInstructions},
      // Inherit the verified thread policy, including managed deny rules.
      turn: {cwd, approvalPolicy: 'never'}};
  }
  async prepare(scope) { await ensureAgentWorkspace(scope.cwd); return scope; }
  async change(chat, mode) {
    if (!['chat', 'work'].includes(mode)) throw Error('実行範囲を選択してください。');
    if (chat.project) throw Error('projectの作業範囲は依頼時の設定に従います。');
    if (this.pending.size || active.has(chat.status) || this.guard()) throw Error('進行中の処理が終わってから実行範囲を変更してください。');
    this.pending.add(chat.id);
    const previous = chat.workMode;
    try {
      if (mode === 'work') {
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(chat.id)) throw Error('Invalid conversation ID');
        await ensureAgentWorkspace(path.join(this.directory, 'chats', chat.id));
      }
      if (active.has(chat.status) || this.guard()) throw Error('処理が始まりました。完了後に実行範囲を変更してください。');
      chat.workMode = mode;
      await this.save();
      this.blocked.delete(chat.id); this.changed(chat);
      return chat;
    } catch (error) {
      if (previous === undefined) delete chat.workMode; else chat.workMode = previous;
      this.blocked.add(chat.id);
      throw error;
    } finally { this.pending.delete(chat.id); }
  }
}
