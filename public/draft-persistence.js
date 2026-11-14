// Serialize desktop snapshots so an older save cannot finish after a newer one.
// A rejected write stays dirty and can be retried without editing the draft.
export function mergeRecoveredDrafts(saved,current) {
  const drafts={...saved.drafts};
  for(const [id,text] of Object.entries(current.drafts)){
    if(!text)continue;
    const previous=drafts[id];
    drafts[id]=!previous||text===previous||text.startsWith(previous+'\n\n')?text:previous+'\n\n'+text;
  }
  return {...current,drafts,sendRequests:{...current.sendRequests,...saved.sendRequests},selected:current.selected||saved.selected||null};
}

export function createDraftPersistence({write,onChange=()=>{},onError=()=>{},now=Date.now,retryDelayMs=1000}) {
  let desired=null,committed=null,inFlight=null,retryAt=0,lastError=null;
  const state=()=>({pending:Boolean(desired&&desired.serialized!==committed),saving:Boolean(inFlight),error:lastError});
  const changed=()=>onChange(state());
  function pump(force=false) {
    if(inFlight)return inFlight;
    if(!desired||desired.serialized===committed||(!force&&now()<retryAt))return Promise.resolve();
    const current=desired;
    inFlight=Promise.resolve().then(()=>write(JSON.parse(current.serialized))).then(()=>{
      committed=current.serialized;retryAt=0;lastError=null;
    },error=>{
      lastError=error instanceof Error?error:Error(String(error));retryAt=now()+retryDelayMs;
      onError(lastError);
    }).finally(()=>{
      inFlight=null;changed();
      // Coalesce changes made during the write, but never spin on a failed
      // identical snapshot. Retry is explicit or follows a later persist call.
      if(desired!==current&&desired.serialized!==committed)void pump();
    });
    changed();return inFlight;
  }
  return {
    persist(snapshot) {
      const serialized=JSON.stringify(snapshot);
      if(desired?.serialized!==serialized){desired={serialized};retryAt=0;}
      return pump();
    },
    retry:()=>pump(true),
    async flush() {
      // The last edit may still be coalesced behind an earlier IPC write.
      // Closing must wait until that edit is acknowledged as well.
      // Drain an older write first: its failure must not prevent this explicit
      // flush from trying the current snapshot after storage has recovered.
      if(inFlight)await inFlight;
      while(inFlight||(desired&&desired.serialized!==committed)){
        await (inFlight||pump(true));
        if(lastError)throw lastError;
      }
    },
    state
  };
}
