const processCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(value) ? value : 'unknown';
// Match only backend-owned constants. Do not expose arbitrary IPC strings in a
// native dialog: they may contain account information or local content.
export const backendStartupStages=Object.freeze(['bootstrap','module-load','storage','workspace','context-store','attachments','history','history-migration','local-stores','party-recovery','projects','world-load','world-layout','activity-sync','listen']);
const knownStartupStages=new Set(backendStartupStages);

// Report process status only. Child stderr, URLs, request bodies and account
// data must never become startup diagnostics.
export function processDiagnostic({code,signal}={}) {
  return `code=${Number.isInteger(code)?code:processCode(code)}, signal=${processCode(signal)}`;
}

export async function stopOwnedChild(child,{graceMs=5000}={}) {
  if(!child || !child.pid || child.exitCode!==null || child.signalCode!==null)return;
  await new Promise((resolve,reject)=>{
    let timer;
    const cleanup=()=>{clearTimeout(timer);child.off('exit',done);child.off('error',failed);};
    const done=()=>{cleanup();resolve();};
    const failed=()=>{cleanup();reject(Error('GUIサーバーを停止できませんでした。'));};
    child.once('exit',done);
    child.once('error',failed);
    timer=setTimeout(()=>{
      try {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
      catch {failed();return;}
      done();
    },graceMs);
    try {child.kill('SIGTERM');}catch {failed();}
  });
}

export async function waitForBackendReady(child,{timeoutMs=30000,stopOptions}={}) {
  // Drain immediately: waiting for the ready event before consuming a pipe can
  // deadlock startup if a native dependency emits enough diagnostics.
  child.stdout?.resume();
  child.stderr?.resume();
  let latestStage='bootstrap';
  try {
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const done=(error,value)=>{
        if(settled)return;
        settled=true;clearTimeout(timer);
        child.off('message',onMessage);child.off('exit',onExit);child.off('error',onError);
        error?reject(error):resolve(value);
      };
      const onExit=(code,signal)=>done(Error('GUIサーバーが起動中に終了しました。 '+processDiagnostic({code,signal})));
      const onError=error=>done(Error('GUIサーバーを起動できませんでした。 '+processDiagnostic({code:error?.code})));
      const onMessage=value=>{
        if(value?.type==='startup-progress'&&knownStartupStages.has(value.stage))latestStage=value.stage;
        if(value?.type==='ready'&&Number.isInteger(value.port)&&value.port>0&&value.port<=65535&&value.origin===`http://127.0.0.1:${value.port}`)done(null,value);
        if(value?.type==='startup-error')done(Error('GUIサーバーを起動できませんでした。 '+processDiagnostic({code:value.code})));
      };
      const timer=setTimeout(()=>done(Error(`GUIサーバーの起動がタイムアウトしました。 timeout=${timeoutMs}ms, stage=${latestStage}`)),timeoutMs);
      child.on('message',onMessage);child.once('exit',onExit);child.once('error',onError);
      if(child.exitCode!==null||child.signalCode!==null)onExit(child.exitCode,child.signalCode);
    });
  } catch(error) {
    await stopOwnedChild(child,stopOptions);
    // Only errors created above are allowed in the native status dialog.
    error.publicDiagnostic=error.message;
    throw error;
  }
}

// A backend exit and a navigation failure can describe the same incident.
// Coalesce their dialogs and let an explicit choice decide whether to restart.
export function createRuntimeRecovery({present,close}) {
  let pending=null;
  return detail=>{
    if(pending)return pending;
    pending=(async()=>{
      const choice=await present(detail);
      return close(choice===0);
    })().finally(()=>{pending=null;});
    return pending;
  };
}
