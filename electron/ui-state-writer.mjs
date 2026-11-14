// Keep atomic writes in order, and retain failures until a subsequent write or
// a close-time flush succeeds. The caller owns validation and the in-memory UI.
export function createUiStateWriter(write) {
  let writing=Promise.resolve(),committed=null;
  function save(snapshot) {
    writing=writing.catch(()=>{}).then(async()=>{
      if(snapshot===committed)return;
      await write(snapshot);
      committed=snapshot;
    });
    return writing;
  }
  return {
    save,
    async flush(readSnapshot) {
      for(;;){
        const snapshot=readSnapshot();
        await save(snapshot);
        if(snapshot===readSnapshot())return;
      }
    }
  };
}
