import path from 'node:path';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';

export function bundledCodexPath({packaged,resourcesPath,appPath,platform=process.platform,arch=process.arch}) {
  if(platform!=='darwin'||arch!=='arm64')return null;
  return packaged?path.join(resourcesPath,'codex','bin','codex'):
    path.join(appPath,'node_modules','@openai','codex-darwin-arm64','vendor','aarch64-apple-darwin','bin','codex');
}

export async function resolveCodexExecutable({configured,environment,bundled}) {
  const selected=configured||environment||bundled;
  if(!selected)return 'codex';
  if(!path.isAbsolute(selected)||selected.split(path.sep).includes('.ssh'))
    throw Error('Codex実行ファイルの場所を確認してください。');
  await access(selected,constants.X_OK).catch(()=>{throw Error('Codex実行ファイルが見つかりません。アプリを入れ直すか、接続設定で選び直してください。');});
  return selected;
}
