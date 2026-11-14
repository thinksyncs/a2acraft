// Cancelled or failed persistence must leave the window and backend available.
// Only a successful flush or an explicit discard reaches the close callback.
export function createCloseCoordinator({flush,onFailure,close}) {
  let pending=null;
  return function requestClose() {
    if(pending)return pending;
    pending=(async()=>{
      for(;;){
        try{await flush();break;}
        catch(error){
          const action=await onFailure(error);
          if(action==='retry')continue;
          if(action!=='discard')return false;
          break;
        }
      }
      await close();
      return true;
    })().finally(()=>{pending=null;});
    return pending;
  };
}
