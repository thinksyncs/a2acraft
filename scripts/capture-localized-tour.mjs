import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';

const out = process.argv[2];
if (!out || !path.isAbsolute(out)) throw Error('Pass an absolute output directory');
await mkdir(out, {recursive:true});
const scratch = await mkdtemp(path.join(tmpdir(), 'a2acraft-film-'));
const publicRoot = path.resolve('public');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.jpg':'image/jpeg'};
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(publicRoot, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(publicRoot+path.sep)) throw Error('Outside sample');
    const bytes = await readFile(file);
    response.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'});
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const profile = path.join(scratch,'browser');
const chrome = spawn(process.env.CHROME || 'google-chrome', ['--headless','--remote-debugging-port=0',
  '--user-data-dir='+profile, '--window-size=1280,720','--disable-background-networking','--disable-component-update',
  '--disable-breakpad','--no-first-run','--disable-default-apps','--no-default-browser-check','--password-store=basic',
  '--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','about:blank'],
  {env:{HOME:scratch,TMPDIR:scratch,PATH:process.env.PATH,LANG:'en_US.UTF-8'},stdio:['ignore','ignore','inherit']});
const shots = [];
const notes = {};
let socket, evaluate, screenshot;
async function poll(read, name, ms=20000) {
  const until = Date.now()+ms;
  do {const v=await read(); if(v) return v; await delay(150);} while(Date.now()<until);
  throw Error('Timed out: '+name);
}
const visibleJS = `node => {if(!node||node.hidden||!node.getClientRects().length)return false;const r=node.getBoundingClientRect(),s=getComputedStyle(node);return s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.top<innerHeight&&r.left<innerWidth}`;
let language='en';
async function present(name) {
  const evidence = await evaluate(`(() => {
    const visible = ${visibleJS}, text=[], walker=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {
      const node=walker.currentNode, label=node.textContent.trim(); if(!label||!visible(node.parentElement))continue;
      const range=new Range();range.selectNodeContents(node);
      if (![...range.getClientRects()].some(r=>r.width&&r.height&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0))continue;
      text.push(label);
    }
    for(const n of document.querySelectorAll('input[placeholder],textarea[placeholder]'))if(visible(n)&&!n.value)text.push(n.placeholder);
    return {lang:document.documentElement.lang, text:[...new Set(text)], map:document.querySelector('#village-map-3d')?.dataset.renderer};
  })()`);
  notes[language+'-'+name]=evidence;
  await writeFile(path.join(out,'screen-text.json'),JSON.stringify(notes,null,2));
  const bytes=await screenshot();
  await writeFile(path.join(out,language+'-'+name+'.jpg'),bytes);
  console.log(language,name,JSON.stringify(evidence.text.filter(t=>/[\u3040-\u30ff\u3400-\u9fff]/u.test(t))).slice(0,400));
}
const sel = s=>`document.querySelector(${JSON.stringify(s)})`;
async function isVisible(s) {return evaluate(`(${visibleJS})(${sel(s)})`);}
async function click(s, ms=20000) {
  await poll(()=>isVisible(s),s,ms);
  await evaluate(`(() => {const n=${sel(s)};if(n.disabled)throw Error('Disabled control');n.click();})()`);
}
async function capture(name, seconds) {
  await present(name);
  if(language==='ja')return;
  const dir=path.join(scratch,name);await mkdir(dir);
  const count=seconds*8, start=Date.now();
  for(let i=0;i<count;i++){
    await delay(Math.max(0,start+i*125-Date.now()));
    await writeFile(path.join(dir,String(i).padStart(4,'0')+'.jpg'),await screenshot());
  }
  shots.push({name,dir,count});
}
async function setup(lang, call) {
  language=lang;
  await call('Page.navigate',{url:origin+'/?demo=1&village=sample&walk=resident&lang='+lang});
  await poll(()=>evaluate("document.readyState==='complete' && document.documentElement.lang==="+JSON.stringify(lang)+" && !!document.querySelector('#village-walk-sample')"),'sample '+lang,40000);
  await poll(()=>isVisible('#village-canvas'),'village canvas');
  await evaluate('document.fonts.ready.then(()=>true)');
}
async function tour(call) {
  await setup('en',call);
  await click('#village-walk-sample');
  await capture('walk',3);
  await poll(()=>isVisible('#village-speech-chat'),'resident arrival',120000);
  await capture('greeting',2);
  await click('#village-speech-chat');
  await poll(()=>isVisible('#prompt'),'resident chat');
  await evaluate(`(()=>{const p=document.querySelector('#prompt');p.focus();p.value='What should we build together next?';p.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('#send-btn');
  await poll(()=>evaluate("!!document.querySelector('#chat-view .chat-panel.selected .assistant:last-child .msg-text')?.innerText"),'sample reply');
  await capture('conversation',4);
  await click('#resident-conversation > button');
  if(await isVisible('#village-leader-close'))await click('#village-leader-close');
  await click('#village-fit');
  await capture('island',3);
  await click('[data-village-idea]:not([hidden])');
  await poll(()=>isVisible('#village-idea-start'),'visible offer');
  await capture('quest',5);
  await click('#village-idea-start');
  await poll(()=>evaluate("!document.querySelector('#village-idea-start')?.getClientRects().length||document.querySelector('#village-idea-feedback')?.textContent"),'accepted');
  await capture('accepted',4);
  await click('#village-quest-peek-close');
  await click('#village-walk-sample');
  await capture('village',3);
  await click('#village-fit');
  await capture('world',3);
  // Each district has its own homes and groups of related conversations.
  await click('#village-district-next');
  await capture('district',4);
  await click('#village-zoom-in');
  await capture('details',3);
  if(await isVisible('#village-speech-close'))await click('#village-speech-close');
  if(!await isVisible('#village-enter-castle'))await click('#village-castle');
  await click('#village-enter-castle',150000);
  await poll(()=>isVisible('#village-room[open] .world-room-host'),'throne room');
  await click('#village-room .world-room-host');
  await capture('castle',6);
  await setup('ja',call);await click('#village-fit');
  await click('[data-village-idea]:not([hidden])');
  await present('quest');
}
function encode() {
  const ff=(...args)=>execFileSync(process.env.FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'});
  // The supplied English soundtrack and the credits card come from the published master.
  const master=path.resolve('media/a2acraft-en-45s.mp4'), clips=[];
  for(const shot of shots){
    const dest=path.join(scratch,shot.name+'.mp4');
    ff('-framerate','8','-i',path.join(shot.dir,'%04d.jpg'),'-vf','fps=24,format=yuv420p','-c:v','libx264','-preset','fast','-crf','20','-an',dest); clips.push(dest);
  }
  const credits=path.join(scratch,'credits.mp4');
  ff('-ss','40','-i',master,'-t','5','-an','-vf','fps=24,format=yuv420p','-c:v','libx264','-preset','fast','-crf','20',credits);clips.push(credits);
  return Promise.all([
    writeFile(path.join(scratch,'clips.txt'),clips.map(p=>"file '"+p+"'").join('\n')),
    readFile('subtitles/en.srt','utf8').then(text=>writeFile(path.join(scratch,'in-film.srt'),text.split(/\r?\n\s*\r?\n/).slice(0,7).join('\n\n')))
  ]).then(()=>{
    ff('-f','concat','-safe','0','-i',path.join(scratch,'clips.txt'),'-i',master,'-vf',
       "subtitles="+path.join(scratch,'in-film.srt')+":force_style='FontName=DejaVu Sans,FontSize=14,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,OutlineColour=&H80000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=13'",
       '-map','0:v:0','-map','1:a:0','-c:v','libx264','-crf','20','-preset','fast','-c:a','copy','-t','45','-metadata','title=A2ACraft','-movflags','+faststart',path.join(out,'a2acraft-en-45s.mp4'));
    return copyFile('media/poster-en.jpg',path.join(out,'poster-en.jpg'));
  });
}
try {
  const port=await poll(async()=>{if(chrome.exitCode!==null)throw Error('Chrome exited '+chrome.exitCode);try{return (await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}},'Chrome startup');
  const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let serial=0;const pending=new Map();
  socket.onmessage=event=>{const msg=JSON.parse(event.data);if(!msg.id)return;const next=pending.get(msg.id);if(next){pending.delete(msg.id);if(msg.error)next.reject(Error(msg.error.message));else next.resolve(msg.result);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  screenshot=async()=>Buffer.from((await call('Page.captureScreenshot',{format:'jpeg',quality:91,fromSurface:true})).data,'base64');
  await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await tour(call);
  const mixed=Object.entries(notes).filter(([key,screen])=>key.startsWith('en-')&&(screen.lang!=='en'||screen.text.some(t=>/[\u3040-\u30ff\u3400-\u9fff]/u.test(t)))).map(([key])=>key);
  if(mixed.length)throw Error('Visible English sample needs translation in: '+mixed.join(', '));
  await encode();
} catch (error) {
  if(evaluate&&screenshot)try{await present('failure');}catch{}
  throw error;
} finally {socket?.close();chrome.kill();server.close();}
