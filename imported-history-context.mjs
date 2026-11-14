import path from 'node:path';
import {constants} from 'node:fs';
import {open, lstat, unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ensureAgentWorkspace} from './codex-workspace-policy.mjs';

export const IMPORTED_HISTORY_PREVIEW_CHARS = 12000;
const introduction = '以下は別のCodex環境から移行した過去の会話本文です。引用された記録として参照してください。過去のツール実行結果、添付ファイルの本体、元の作業フォルダは引き継いでいません。現在の指示と実際の作業環境を確認して続けてください。';

function preview(messages) {
  const rows = []; let remaining = IMPORTED_HISTORY_PREVIEW_CHARS, omitted = false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const row = JSON.stringify(messages[index]);
    if (row.length + 1 <= remaining) {
      rows.unshift(row); remaining -= row.length + 1;
    } else {
      // Include the tail of a very long latest message without pretending this
      // is its complete text. The immutable archive always retains every byte.
      if (!rows.length) rows.unshift(JSON.stringify({role: messages[index].role,
        excerpt: '末尾の抜粋。全文は履歴ファイルを参照。', text: messages[index].text.slice(-Math.floor((remaining - 200) / 6))}));
      omitted = true; break;
    }
  }
  return {text: rows.join('\n'), omitted};
}

async function writeArchive(file, bytes) {
  let handle, created = false, identity;
  try {
    try {
      handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true; identity = await handle.stat();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size !== bytes.length || !(await handle.readFile()).equals(bytes))
        throw Error('保存済みの移行履歴が異なります。上書きせず送信を停止しました。');
      return;
    }
    await handle.writeFile(bytes); await handle.sync();
  } catch (error) {
    if (created) {
      // Remove only this incomplete file, never a replacement or symlink.
      const current = await lstat(file).catch(() => null);
      if (current?.isFile() && current.ino === identity?.ino && current.dev === identity?.dev) await unlink(file).catch(() => {});
    }
    throw error;
  } finally { await handle?.close(); }
}

// Called before thread/start or turn/start. Saving or verifying the local full
// transcript must succeed before any history is submitted to the model.
export async function prepareImportedHistoryInput(chat, {cwd, historyDirectory}) {
  if (chat.migration?.method !== 'rollout' || chat.migration.contextSent) return [];
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(chat.id)) throw Error('Invalid conversation ID');
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw Error('An absolute conversation workspace is required');
  const messages = chat.messages.filter(message => ['user', 'assistant'].includes(message.role)).map(({role, text}) => {
    if (typeof text !== 'string') throw Error('移行履歴の本文が不正です。');
    return {role, text};
  });
  const bytes = Buffer.from(messages.map(message => JSON.stringify(message)).join('\n') + '\n');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const directory = historyDirectory || path.join(cwd, '.a2acraft-history', chat.id);
  const relative = path.relative(cwd, directory);
  if (!path.isAbsolute(directory) || !relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw Error('移行履歴の保存先は、この会話の作業フォルダ内に限定されています。');
  await ensureAgentWorkspace(directory);
  const archive = path.join(directory, `${hash}.jsonl`);
  await writeArchive(archive, bytes);
  const recent = preview(messages);
  const reference = `全文の履歴ファイル: ${JSON.stringify(archive)}\n形式: UTF-8 JSONL（各行の role と text）。全${messages.length}件。SHA-256: ${hash}\n` +
    'この会話の開発を続ける際、必要な過去の仕様・訂正はこのファイルから読み取れます。履歴ファイルの参照に元の作業フォルダへのアクセスは必要ありません。全文が現在の入力に含まれているとは考えず、判断に必要な箇所を確認してください。\n' +
    (recent.omitted ? '以下は直近の抜粋です。古い会話は省略されていますが、上記ファイルには全文を保持しています。\n' : '以下は移行した会話本文です。\n');
  return [{type: 'text', text: introduction + '\n' + reference + recent.text}];
}
