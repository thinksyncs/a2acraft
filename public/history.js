import {historyEntries} from './conversation-history.js';

export function initHistory({getChats,getSelected,isLoaded,getError,onSelect,api,onImported=()=>{},getDemo=()=>false,getPersistenceError=()=>null,onRetrySave}) {
  const dialog=document.querySelector('#history-dialog'),search=document.querySelector('#history-search');
  const list=document.querySelector('#history-list'),status=document.querySelector('#history-status'),error=document.querySelector('#history-error');
  const saveError=document.querySelector('#history-save-error'),retrySave=document.querySelector('#history-retry-save');
  const labels={idle:'待機中',starting:'開始中',running:'実行中',stopping:'停止中',completed:'完了',cancelled:'停止済み',failed:'エラー'};
  const dates=new Intl.DateTimeFormat('ja-JP',{dateStyle:'medium',timeStyle:'short'});
  let rendered='',saving=false,retryError='';
  const migration=initCodexMigration({api,onImported:async result=>{await onImported(result);render();},getDemo,dates});
  function render() {
    migration.refresh();
    if(!dialog.open)return;
    const persistenceError=getPersistenceError();
    saveError.hidden=!persistenceError&&!retryError;saveError.textContent=retryError||persistenceError||'';
    retrySave.hidden=!persistenceError;retrySave.disabled=saving||getDemo()||typeof onRetrySave!=='function';
    retrySave.textContent=saving?'履歴を保存しています…':'履歴の保存を再試行';
    const failure=getError(),loaded=isLoaded(),all=historyEntries(getChats()),entries=historyEntries(getChats(),{query:search.value});
    error.hidden=!failure;error.textContent=failure||'';
    status.textContent=failure?'履歴を読み込めませんでした。':!loaded?'履歴を読み込んでいます…':`${entries.length}件 / ${all.length}件の会話`;
    dialog.setAttribute('aria-busy',String(!loaded&&!failure));
    const signature=JSON.stringify([loaded,failure,search.value,getSelected(),entries]);
    if(signature===rendered)return;
    rendered=signature;
    const focused=document.activeElement?.dataset.historyId;
    list.replaceChildren();
    if(!entries.length){
      const empty=document.createElement('p');empty.className='history-empty';
      empty.textContent=failure?'履歴を取得できませんでした。アプリを再読み込みしてください。':!loaded?'保存した会話を読み込んでいます。':all.length?'検索に一致する会話はありません。':'保存された会話はまだありません。会話すると、ここから開けます。';
      list.append(empty);return;
    }
    for(const entry of entries){
      const button=document.createElement('button');button.type='button';button.className='history-entry';button.dataset.historyId=entry.id;
      button.setAttribute('aria-current',String(entry.id===getSelected()));
      const heading=document.createElement('strong');heading.textContent=entry.title;
      const metadata=document.createElement('span');metadata.className='history-metadata';
      metadata.textContent=[entry.characterName,entry.updatedAt===null?'更新日時不明':dates.format(entry.updatedAt),`${entry.messageCount}メッセージ`,labels[entry.status]||'保存済み'].filter(Boolean).join(' · ');
      const preview=document.createElement('span');preview.className='history-preview';preview.textContent=entry.preview||'本文のないメッセージ';
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
    try{await onRetrySave();}catch(reason){retryError=reason?.message||'履歴を保存できませんでした。';}
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
    selection.hidden=!rows.some(row=>!row.imported);
    submit.disabled=busy||unavailable||!selected.size;
    submit.textContent=selected.size?`選択した${selected.size}件を取り込む`:'選択した会話を取り込む';
    select.textContent=selected.size?'選択を解除':`先頭${Math.min(maximum,rows.filter(row=>!row.imported).length)}件を選択`;
    status.textContent=getDemo()?'デモではCodexの履歴を取り込みません。':message;
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
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.codexHistoryId=row.id;checkbox.checked=selected.has(row.id);checkbox.disabled=Boolean(row.imported);
      const text=document.createElement('span'),title=document.createElement('strong'),metadata=document.createElement('small');
      title.textContent=row.title||'タイトルのない会話';
      const timestamp=typeof row.updatedAt==='number'?row.updatedAt:Date.parse(row.updatedAt);
      metadata.textContent=[Number.isFinite(timestamp)&&timestamp>0&&timestamp<=8640000000000000?dates.format(timestamp):'更新日時不明',row.cwd,row.imported?'取り込み済み':''].filter(Boolean).join(' · ');
      text.append(title,metadata);label.append(checkbox,text);list.append(label);
    }
    refresh();
  }
  async function run(action) {
    if(busy||getDemo()||typeof api!=='function')return;
    busy=true;fail('');showWarnings();refresh();
    try{await action();}catch(reason){message='操作を完了できませんでした。内容を確認して再試行してください。';fail(reason?.message||'履歴の取り込みに失敗しました。');}
    finally{busy=false;refresh();}
  }
  async function loadRows(append) {
    const requestedCursor=append?cursor:null;
    if(append&&!requestedCursor)return;
    await run(async()=>{
      message='Codexの会話を読み込んでいます…';refresh();
      const result=await api('history/codex/list',{cursor:requestedCursor,archived:archived.checked});
      if(!Array.isArray(result.data))throw Error('Codexの会話一覧を読み込めませんでした。');
      if(!append){rows=[];selected.clear();}
      const known=new Set(rows.map(row=>row.id));
      for(const row of result.data)if(typeof row.id==='string'&&!known.has(row.id)){rows.push(row);known.add(row.id);}
      cursor=result.nextCursor||null;
      message=rows.length?`${rows.length}件の会話を表示しています。一度に${maximum}件まで選択できます。`:'この保存先に該当する会話はありません。別のPCの履歴はファイルから取り込めます。';
      renderRows();
    });
  }
  load.addEventListener('click',()=>loadRows(false));
  more.addEventListener('click',()=>loadRows(true));
  archived.addEventListener('change',()=>{
    rows=[];cursor=null;selected.clear();message='「Codexの会話を読み込む」で一覧を更新してください。';fail('');showWarnings();renderRows();
  });
  list.addEventListener('change',event=>{
    const checkbox=event.target.closest('[data-codex-history-id]');if(!checkbox)return;
    const id=checkbox.dataset.codexHistoryId;fail('');
    if(checkbox.checked){
      if(selected.size>=maximum){checkbox.checked=false;fail(`一度に取り込める会話は${maximum}件までです。`);}
      else selected.add(id);
    }else selected.delete(id);
    refresh();
  });
  select.addEventListener('click',()=>{
    if(selected.size)selected.clear();else selected=new Set(rows.filter(row=>!row.imported).slice(0,maximum).map(row=>row.id));
    fail('');renderRows();
  });
  submit.addEventListener('click',()=>run(async()=>{
    const threadIds=[...selected];if(!threadIds.length)return;
    message=`${threadIds.length}件の会話を取り込んでいます…`;refresh();
    const result=await api('history/codex/import',{threadIds,archived:archived.checked});
    await onImported(result);
    for(const row of rows)if(selected.has(row.id))row.imported=true;
    selected.clear();message=`${result.imported||0}件を取り込みました。${result.skipped?` ${result.skipped}件は取り込み済みです。`:''} 下の履歴一覧から開けます。`;
    showWarnings(result.warnings);renderRows();
  }));
  files.addEventListener('change',()=>{
    const chosen=[...files.files];files.value='';
    if(!chosen.length)return;
    run(async()=>{
      let imported=0,skipped=0;const notices=[],failures=[];
      for(const [index,file] of chosen.entries()){
        message=`ファイルを取り込んでいます（${index+1}/${chosen.length}）: ${file.name}`;refresh();
        try{
          if(!/\.jsonl$/i.test(file.name))throw Error('rollout-*.jsonl の履歴ファイルを選択してください。');
          if(file.size>maxFileBytes)throw Error('1ファイル16 MiBまで取り込めます。');
          const result=await api('history/codex/file',{name:file.name,text:await file.text()});
          await onImported(result);imported+=result.imported||0;skipped+=result.skipped||0;notices.push(...(result.warnings||[]));
        }catch(reason){failures.push(`${file.name}: ${reason?.message||'取り込みに失敗しました。'}`);}
      }
      message=`${imported}件を取り込みました。${skipped?` ${skipped}件は取り込み済みです。`:''}${failures.length?` ${failures.length}ファイルを取り込めませんでした。`:' 下の履歴一覧から開けます。'}`;
      fail(failures.join('\n'));showWarnings(notices);
    });
  });
  refresh();
  return {refresh};
}
