// Close and reload can arrive together. They must share the renderer's single
// flush acknowledgement and finish every disk write before either proceeds.
export function createWindowStateFlusher({flushRenderer,flushUi,flushMap}) {
  let pending=null;
  return function flushWindowState() {
    if(pending)return pending;
    pending=(async()=>{
      await flushRenderer();
      await flushUi();
      await flushMap();
    })().finally(()=>{pending=null;});
    return pending;
  };
}

// Explicit user action only. Failed persistence leaves the current page and
// its unsaved drafts available, and never forwards private errors to a dialog.
export function createSavedReload({canReload,flush,reload,resume,onFailure}) {
  let pending=null;
  return function requestReload() {
    if(pending)return pending;
    if(!canReload())return Promise.resolve(false);
    pending=(async()=>{
      let saved=false;
      try {
        await flush();
        saved=true;
        if(!canReload()){await resume();return false;}
        await reload();
        return true;
      } catch {
        await resume();
        await onFailure(saved?'reload':'save');
        return false;
      }
    })().finally(()=>{pending=null;});
    return pending;
  };
}
