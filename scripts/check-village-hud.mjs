import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute output directory');
await mkdir(output, {recursive:true});
const home = await mkdtemp(path.join(tmpdir(), 'verify-village-hud-'));
const profile = path.join(home, 'chrome');
const root = path.resolve('public');
const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(root, '.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
    if (!file.startsWith(root+path.sep)) throw Error();
    const bytes = await readFile(file);
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(bytes);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:'+server.address().port;
const chrome = spawn(process.env.CHROME || 'google-chrome', ['--headless','--lang=en-US','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-default-apps','--disable-component-update','--disable-background-networking','--disable-webgl','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost','about:blank'],{env:{HOME:home,TMPDIR:home,PATH:process.env.PATH,LANG:'en_US.UTF-8'},stdio:['ignore','ignore','inherit']});
async function wait(check, description) {
  const deadline=Date.now()+90000;
  do {const value=await check();if(value)return value;await delay(200);}while(Date.now()<deadline);
  throw Error('Timeout waiting for '+description);
}
let socket;
try {
  const port=await wait(async()=>{if(chrome.exitCode!==null)throw Error('Chrome exited '+chrome.exitCode);try{return (await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}},'Chrome');
  const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let serial=0;
  const pending=new Map();
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout at '+method));},45000);
    pending.set(id,m=>{clearTimeout(timer);if(m.error)reject(Error(m.error.message));else resolve(m.result);});
    socket.send(JSON.stringify({id,method,params}));
  });
  async function evaluate(expression) {
    const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  await call('Page.enable');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const result={};
  for(const [width,height] of [[1280,720],[390,844]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const {errorText}=await call('Page.navigate',{url:origin+'/?demo=1&village=sample&walk=resident'});
    if(errorText)throw Error(errorText);
    await wait(()=>evaluate("document.readyState==='complete'&&document.documentElement.lang==='en'&&Number(document.querySelector('#village-population')?.textContent)>0&&!!document.querySelector('#village-canvas')?.getClientRects().length"),'visible English sample');
    await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))');
    result[width]=await evaluate(`(()=>{
      const bounds=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
      const card=bounds('.village-heading > div:first-child'), stats=bounds('.village-statistics'), legend=bounds('.village-legend'), sample=bounds('.village-preview-note'), actions=bounds('.village-header-actions');
      return {card,stats,legend,sample,actions,statsFit:stats.left>=card.left-1&&stats.right<=card.right+1,legendClear:sample.bottom<=legend.top+1,actionsClear:card.right<=actions.left+1||card.bottom<=actions.top+1};
    })()`);
    const image=await call('Page.captureScreenshot',{format:'jpeg',quality:92});
    await writeFile(path.join(output,'en-village-'+width+'.jpg'),Buffer.from(image.data,'base64'));
  }
  await writeFile(path.join(output,'hud.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  if(Object.values(result).some(v=>!v.statsFit||!v.legendClear||!v.actionsClear))throw Error('Village HUD overlaps');
} finally {socket?.close();chrome.kill();server.close();}
