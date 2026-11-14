import {validateUiState} from './security.mjs';
import {createUiStateWriter} from './ui-state-writer.mjs';

const emptyState=()=>({drafts:{},sendRequests:{},selected:null,layout:1,motion:'system'});

// A corrupt or temporarily unreadable saved draft is not an empty draft. Keep
// that file untouched until an explicit read retry can validate it again.
export function createUiStateStore({read,write}) {
  let state=emptyState(),loaded=false,loadError=null,loading=null;
  const writer=createUiStateWriter(write);
  function load() {
    if(loading)return loading;
    loading=(async()=>{
      try{state=validateUiState(JSON.parse(await read()));loadError=null;}
      catch(error){
        if(error.code==='ENOENT'){state=emptyState();loadError=null;}
        else loadError=Error('前回の下書きを読み込めません。元のデータを保護するため保存を止めています。保存先やデータの復旧後に、下書きの読み込みを再試行してください。');
      }
      loaded=true;
    })().finally(()=>{loading=null;});
    return loading;
  }
  return {
    load,
    async read() {
      if(!loaded||loadError)await load();
      return {...state,...(loadError?{loadError:loadError.message}:{})};
    },
    async save(value) {
      if(!loaded)await load();
      if(loadError)throw loadError;
      state=validateUiState(value);
      await writer.save(JSON.stringify(state));
      return {ok:true};
    },
    async flush() {
      if(!loaded)await load();
      if(loadError)throw loadError;
      await writer.flush(()=>JSON.stringify(state));
    }
  };
}
