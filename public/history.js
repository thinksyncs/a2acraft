import {getLocale} from './i18n.js';
import {chatText, messageCount} from './i18n-chat.js';

import {historyEntries} from './conversation-history.js';

export function initHistory({getChats,getSelected,isLoaded,getError,onSelect,api,onImported=()=>{},getDemo=()=>false,getPersistenceError=()=>null,onRetrySave}) {
  const dialog=document.querySelector('#history-dialog'),search=document.querySelector('#history-search');
  const list=document.querySelector('#history-list'),status=document.querySelector('#history-status'),error=document.querySelector('#history-error');
  const saveError=document.querySelector('#history-save-error'),retrySave=document.querySelector('#history-retry-save');
  const labels={idle:'待機中',starting:'開始中',running:'実行中',stopping:'停止中',completed:'完了',cancelled:'停止済み',failed:'エラー'};
  const dates={format(value){return new Intl.DateTimeFormat(getLocale(),{dateStyle:'medium',timeStyle:'short'}).format(value);}};
  let rendered='',saving=false,retryError='';
  const migration=initCodexMigration({api,onImported:async result=>{await onImported(result);render();},getDemo,dates});
  function render() {
    migration.refresh();
    if(!dialog.open)return;
    const persistenceError=getPersistenceError();
    saveError.hidden=!persistenceError&&!retryError;saveError.textContent=retryError||persistenceError||'';
    retrySave.hidden=!persistenceError;retrySave.disabled=saving||getDemo()||typeof onRetrySave!=='function';
    retrySave.textContent=saving?chatText('履歴を保存しています…'):chatText('履歴の保存を再試行');
    const failure=getError(),loaded=isLoaded(),all=historyEntries(getChats()),entries=historyEntries(getChats(),{query:search.value});
    error.hidden=!failure;error.textContent=failure||'';
    status.textContent=failure?chatText('履歴を読み込めませんでした。'):!loaded?chatText('履歴を読み込んでいます…'):chatText('{shown}件 / {total}件の会話', {shown:entries.length,total:all.length});
    dialog.setAttribute('aria-busy',String(!loaded&&!failure));
    const signature=JSON.stringify([getLocale(),loaded,failure,search.value,getSelected(),entries]);
    if(signature===rendered)return;
    rendered=signature;
    const focused=document.activeElement?.dataset.historyId;
    list.replaceChildren();
    if(!entries.length){
      const empty=document.createElement('p');empty.className='history-empty';
      empty.textContent=failure?chatText('履歴を取得できませんでした。アプリを再読み込みしてください。'):!loaded?chatText('保存した会話を読み込んでいます。'):all.length?chatText('検索に一致する会話はありません。'):chatText('保存された会話はまだありません。会話すると、ここから開けます。');
      list.append(empty);return;
    }
    for(const entry of entries){
      const button=document.createElement('button');button.type='button';button.className='history-entry';button.dataset.historyId=entry.id;
      button.setAttribute('aria-current',String(entry.id===getSelected()));
      const heading=document.createElement('strong');heading.textContent=entry.title;
      const metadata=document.createElement('span');metadata.className='history-metadata';
      metadata.textContent=[entry.characterName,entry.updatedAt===null?chatText('更新日時不明'):dates.format(entry.updatedAt),messageCount(entry.messageCount),chatText(labels[entry.status])||chatText('保存済み')].filter(Boolean).join(' · ');
      const preview=document.createElement('span');preview.className='history-preview';preview.textContent=entry.preview||chatText('本文のないメッセージ');
      button.append(heading,metadata,preview);list.append(button);
    }
    if(focused)list.querySelector(`[data-history-id="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  }
  function open(){if(!dialog.open)dialog.showModal();rendered='';render();search.focus();}
  for(const button of document.querySelectorAll('[data-history-open]'))button.addEventListener('click',open);
  document.querySelector('#history-close').addEventListener('click',()=>dialog.close());
  retrySave.addEventListener('click',async()=>{
    if(saving||getDemo()||typeof onRetrySave!=='function')return;
    saving=true;retryError='';render();
    try{await onRetrySave();}catch(reason){retryError=reason?.message||chatText('履歴を保存できませんでした。');}
    finally{saving=false;render();}
  });
  search.addEventListener('input',render);
  list.addEventListener('click',event=>{
    const button=event.target.closest('[data-history-id]');
    if(!button||!getChats().some(chat=>chat.id===button.dataset.historyId))return;
    const id=button.dataset.historyId;dialog.close();onSelect(id);
  });
  return {render,open};
}

function importSummary(imported, skipped, failed) {
  return chatText('{count}件を取り込みました。',{count:imported||0}) + (skipped?chatText(' {count}件は取り込み済みです。',{count:skipped}):'') + (failed?chatText(' {count}ファイルを取り込めませんでした。',{count:failed}):chatText(' 下の履歴一覧から開けます。'));
}

function initCodexMigration({api,onImported,getDemo,dates}) {
  const element=id=>document.getElementById(id);
  const fields=element('history-migration-fields'),archived=element('history-codex-archived');
  const load=element('history-codex-load'),more=element('history-codex-more'),list=element('history-codex-list');
  const selection=element('history-codex-selection'),select=element('history-codex-select'),submit=element('history-codex-import');
  const files=element('history-codex-files'),status=element('history-migration-status'),error=element('history-migration-error'),warnings=element('history-migration-warnings');
  const maximum=20,maxFileBytes=16*1024*1024;
  let busy=false,rows=[],cursor=null,selected=new Set(),message='';
  function refresh() {
    const unavailable=getDemo()||typeof api!=='function';
    fields.disabled=busy||unavailable;
    fields.setAttribute('aria-busy',String(busy));
    more.hidden=!cursor;
    selection.hidden=!rows.length;
    submit.disabled=busy||unavailable||!selected.size;
    submit.textContent=selected.size?chatText('選択した{count}件を取り込む', {count:selected.size}):chatText('選択した会話を取り込む');
    select.textContent=selected.size?chatText('選択を解除'):chatText('先頭{count}件を選択', {count:Math.min(maximum,rows.length)});
    status.textContent=getDemo()?chatText('デモではCodexの履歴を取り込みません。'):message;
  }
  function fail(value){error.textContent=value||'';error.hidden=!value;}
  function showWarnings(values=[]) {
    warnings.replaceChildren();
    for(const value of [...new Set(values.map(value=>typeof value==='string'?value:value?.message).filter(Boolean))]){
      const item=document.createElement('li');item.textContent=value;warnings.append(item);
    }
    warnings.hidden=!warnings.childElementCount;
  }
  function renderRows() {
    list.replaceChildren();
    for(const row of rows){
      const label=document.createElement('label');label.className='history-codex-row';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.codexHistoryId=row.id;checkbox.checked=selected.has(row.id);
      const text=document.createElement('span'),title=document.createElement('strong'),metadata=document.createElement('small');
      title.textContent=row.title||chatText('タイトルのない会話');
      const timestamp=typeof row.updatedAt==='number'?row.updatedAt:Date.parse(row.updatedAt);
      metadata.textContent=[Number.isFinite(timestamp)&&timestamp>0&&timestamp<=8640000000000000?dates.format(timestamp):chatText('更新日時不明'),row.cwd,row.imported?chatText('保存済み・更新可'):''].filter(Boolean).join(' · ');
      text.append(title,metadata);label.append(checkbox,text);list.append(label);
    }
    refresh();
  }
  async function run(action) {
    if(busy||getDemo()||typeof api!=='function')return;
    busy=true;fail('');showWarnings();refresh();
    try{await action();}catch(reason){message=chatText('操作を完了できませんでした。内容を確認して再試行してください。');fail(reason?.message||chatText('履歴の取り込みに失敗しました。'));}
    finally{busy=false;refresh();}
  }
  async function loadRows(append) {
    const requestedCursor=append?cursor:null;
    if(append&&!requestedCursor)return;
    await run(async()=>{
      message=chatText('Codexの会話を読み込んでいます…');refresh();
      const result=await api('history/codex/list',{cursor:requestedCursor,archived:archived.checked});
      if(!Array.isArray(result.data))throw Error(chatText('Codexの会話一覧を読み込めませんでした。'));
      if(!append){rows=[];selected.clear();}
      const known=new Set(rows.map(row=>row.id));
      for(const row of result.data)if(typeof row.id==='string'&&!known.has(row.id)){rows.push(row);known.add(row.id);}
      cursor=result.nextCursor||null;
      message=rows.length?chatText('{count}件の会話を表示しています。一度に{max}件まで選択できます。', {count:rows.length,max:maximum}):chatText('この保存先に該当する会話はありません。別のPCの履歴はファイルから取り込めます。');
      renderRows();
    });
  }
  load.addEventListener('click',()=>loadRows(false));
  more.addEventListener('click',()=>loadRows(true));
  archived.addEventListener('change',()=>{
    rows=[];cursor=null;selected.clear();message=chatText('「Codexの会話を読み込む」で一覧を更新してください。');fail('');showWarnings();renderRows();
  });
  list.addEventListener('change',event=>{
    const checkbox=event.target.closest('[data-codex-history-id]');if(!checkbox)return;
    const id=checkbox.dataset.codexHistoryId;fail('');
    if(checkbox.checked){
      if(selected.size>=maximum){checkbox.checked=false;fail(chatText('一度に取り込める会話は{max}件までです。', {max:maximum}));}
      else selected.add(id);
    }else selected.delete(id);
    refresh();
  });
  select.addEventListener('click',()=>{
    if(selected.size)selected.clear();else selected=new Set(rows.slice(0,maximum).map(row=>row.id));
    fail('');renderRows();
  });
  submit.addEventListener('click',()=>run(async()=>{
    const threadIds=[...selected];if(!threadIds.length)return;
    message=chatText('{count}件の会話を取り込んでいます…', {count:threadIds.length});refresh();
    const result=await api('history/codex/import',{threadIds,archived:archived.checked,locale:getLocale()});
    await onImported(result);
    for(const row of rows)if(selected.has(row.id))row.imported=true;
    selected.clear();message=importSummary(result.imported,result.skipped,0);
    showWarnings(result.warnings);renderRows();
  }));
  files.addEventListener('change',()=>{
    const chosen=[...files.files];files.value='';
    if(!chosen.length)return;
    run(async()=>{
      let imported=0,skipped=0;const notices=[],failures=[];
      for(const [index,file] of chosen.entries()){
        message=chatText('ファイルを取り込んでいます（{index}/{total}）: {name}', {index:index+1,total:chosen.length,name:file.name});refresh();
        try{
          if(!/\.jsonl$/i.test(file.name))throw Error(chatText('rollout-*.jsonl の履歴ファイルを選択してください。'));
          if(file.size>maxFileBytes)throw Error(chatText('1ファイル16 MiBまで取り込めます。'));
          const result=await api('history/codex/file',{name:file.name,text:await file.text(),locale:getLocale()});
          await onImported(result);imported+=result.imported||0;skipped+=result.skipped||0;notices.push(...(result.warnings||[]));
        }catch(reason){failures.push(`${file.name}: ${reason?.message||chatText('取り込みに失敗しました。')}`);}
      }
      message=importSummary(imported,skipped,failures.length);
      fail(failures.join('\n'));showWarnings(notices);
    });
  });
  refresh();
  return {refresh};
}
