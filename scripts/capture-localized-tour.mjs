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
  '--disable-webgl','--disable-webgl2',
  '--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost','about:blank'],
  {env:{HOME:scratch,TMPDIR:scratch,PATH:process.env.PATH,LANG:'en_US.UTF-8'},stdio:['ignore','ignore','inherit']});
const shots = [];
const recordedMotion = {};
const notes = {};
let socket, evaluate, screenshot;
async function poll(read, name, ms=20000) {
  const until = Date.now()+ms;
  do {const v=await read(); if(v) return v; await delay(150);} while(Date.now()<until);
  throw Error('Timed out: '+name);
}
// Some labels are painted on the map rather than placed in the DOM. Observe
// the product's own drawing calls without changing their arguments or output.
function observeMapLabels() {
  const seen = new Map();
  window.readFilmCanvasText = () => [...seen].filter(([,time])=>performance.now()-time<1500).map(([text])=>text);
  for(const fn of ['fillText','strokeText']) {
    const original=CanvasRenderingContext2D.prototype[fn];
    CanvasRenderingContext2D.prototype[fn]=function(text,x,y,...rest) {
      const result=original.call(this,text,x,y,...rest);
      if(document.documentElement.lang==='en' && /[\u3040-\u30ff\u3400-\u9fff]/u.test(text) && this.canvas.id==='village-canvas' && this.canvas.clientWidth && this.canvas.clientHeight) {
        const point=new DOMPoint(x,y).matrixTransform(this.getTransform());
        const rect=this.canvas.getBoundingClientRect();
        const left=rect.left+point.x*rect.width/this.canvas.width, top=rect.top+point.y*rect.height/this.canvas.height;
        if(left>=0&&left<innerWidth&&top>=0&&top<innerHeight && document.elementFromPoint(left,top)===this.canvas)
          seen.set(String(text),performance.now());
      }
      return result;
    };
  }
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
      // The localized language menu intentionally lists each language in its own script.
      if(label==='日本語'&&node.parentElement.closest('[data-interface-language]'))continue;
      text.push(label);
    }
    for(const n of document.querySelectorAll('input[placeholder],textarea[placeholder]'))if(visible(n)&&!n.value)text.push(n.placeholder);
    for(const n of document.querySelectorAll('select'))if(visible(n))text.push(n.selectedOptions[0]?.textContent.trim()||'');
    const canvasText=window.readFilmCanvasText?.()||[];
    return {lang:document.documentElement.lang, text:[...new Set([...text,...canvasText])], canvasText, map:document.querySelector('#village-map-3d')?.dataset.renderer};
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
  console.log('Opening',s);
  await poll(()=>isVisible(s),s,ms);
  await evaluate(`(() => {const n=${sel(s)};if(n.disabled)throw Error('Disabled control');n.click();})()`);
}
async function capture(name, seconds, moving=false) {
  await present(name);
  if(language==='ja')return;
  const shot={name,seconds};
  if(moving){
    const fps=4, count=fps*seconds;
    const first=await readFile(path.join(out,'en-'+name+'.jpg'));
    const frames=[first], started=Date.now();
    let unique=1;
    while(frames.length<count){
      const scheduled=started+frames.length*1000/fps;
      await delay(Math.max(0,scheduled-Date.now()));
      const remaining=started+seconds*1000-Date.now();
      if(remaining<120)break;
      let timer, next;
      try {
        next=await Promise.race([screenshot(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),Math.min(remaining,1800));})]);
      } finally {clearTimeout(timer);}
      if(!next)break;
      if(!next.equals(frames.at(-1)))unique++;
      const slot=Math.min(count-1,Math.round((Date.now()-started)*fps/1000));
      while(frames.length<slot)frames.push(frames.at(-1));
      frames.push(next);
    }
    while(frames.length<count)frames.push(frames.at(-1));
    recordedMotion[name]={seconds,fps,sampledFrames:unique};
    await writeFile(path.join(out,'motion.json'),JSON.stringify(recordedMotion,null,2));
    if(unique>1){
      shot.dir=path.join(scratch,name);shot.fps=fps;await mkdir(shot.dir);
      for(let i=0;i<frames.length;i++)await writeFile(path.join(shot.dir,String(i).padStart(3,'0')+'.jpg'),frames[i]);
    }
  }
  shots.push(shot);
}

async function setup(lang, call) {
  language=lang;
  const route=await call('Page.navigate',{url:origin+'/?demo=1&village=sample&walk=resident&lang='+lang});
  if(route.errorText)throw Error('Local sample navigation failed: '+route.errorText);
  await poll(()=>evaluate("document.readyState==='complete' && document.documentElement.lang==="+JSON.stringify(lang)+" && !!document.querySelector('#village-walk-sample')"),'sample '+lang,40000);
  await poll(()=>isVisible('#village-canvas'),'village canvas');
  await evaluate('document.fonts.ready.then(()=>true)');
}
async function tour(call) {
  const motion=value=>call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:value?'no-preference':'reduce'}]});
  async function switchLanguage(lang) {
  console.log('Switching the interface to',lang);
  await evaluate(`(()=>{const select=[...document.querySelectorAll('select[data-interface-language]')].find(${visibleJS});if(!select)throw Error('No visible language switch');select.value=${JSON.stringify(lang)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await poll(async()=>{
    try{return await evaluate("document.documentElement.lang==='"+lang+"'&&document.readyState==='complete'&&location.search.includes('lang="+lang+"')&&!!document.querySelector('#village-walk-sample')");}
    catch(error){if(/context|navigat/i.test(error.message))return false;throw error;}
  },lang+' sample after using the visible language selector',40000);
  language=lang;
  }
  await setup('en',call);
  if(await isVisible('#village-speech-close'))await click('#village-speech-close');
  if(await isVisible('#village-enter-castle'))await click('#village-enter-castle');
  else await click('#village-castle');
  await poll(()=>isVisible('#village-room[open] .world-room-host'),'throne room');
  await motion(true);
  await click('#village-room .world-room-host');
  await capture('castle',6,true);
  await motion(false);
  const roomClip=await evaluate("(()=>{const r=document.querySelector('#village-room .world-room-stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()");
  const roomImage=(await call('Page.captureScreenshot',{format:'jpeg',quality:96,clip:roomClip})).data;
  await click('#village-room .world-room-exit');
  await switchLanguage('ja');
  await click('#village-fit');
  await click('[data-village-idea]:not([hidden])');
  await present('quest');
  await click('#village-quest-peek-close');
  await switchLanguage('en');

  await click('#village-zoom-in');
  await motion(true);
  await capture('walk',3,true);
  await motion(false);
  if(!await evaluate("document.querySelector('#village-context').open"))await click('#village-context > summary');
  await click('.village-context-row');
  await poll(()=>isVisible('#village-speech-chat'),'nearby resident arrival',15000);
  await capture('greeting',2);
  await click('#village-speech-close');
  if(!await evaluate("document.querySelector('#village-context').open"))await click('#village-context > summary');
  await capture('conversation',4);
  await click('#village-context > summary');
  if(await isVisible('#village-leader-close'))await click('#village-leader-close');
  await click('#village-fit');
  await capture('island',3);
  await click('[data-village-idea]:not([hidden])');
  await poll(()=>isVisible('#village-idea-start'),'visible offer');
  await capture('quest',5);
  await click('#village-quest-peek-close');
  await click('#village-quests');
  await click('[data-village-quest-row="todo:village-sample-work"]');
  await capture('accepted',4);
  await click('#village-quest-peek-close');
  await click('#village-zoom-in');
  await motion(true);
  await capture('village',3,true);
  await motion(false);
  await click('#village-fit');
  await capture('world',3);
  // Each district has its own homes and groups of related conversations.
  await click('#village-district-next');
  await motion(true);
  await capture('district',4,true);
  await motion(false);
  await click('#village-zoom-in');
  await capture('details',3);
  const mapImage=(await readFile(path.join(out,'en-world.jpg'))).toString('base64');
  const card=`<!doctype html><html lang=en><meta charset=utf-8>
    <style>*{box-sizing:border-box}html,body{margin:0;width:1280px;height:720px;overflow:hidden}body{position:relative;background:#14261e;color:#fff2d8;font:22px/1.3 "Liberation Sans",sans-serif}
    .map,.room,.veil{position:absolute;inset:0;background-size:cover;background-position:center}.map{background-image:url(data:image/jpeg;base64,${mapImage});opacity:.2;filter:blur(2px)}
    .room{left:41%;background-image:url(data:image/jpeg;base64,${roomImage});background-position:center}
    .veil{background:linear-gradient(90deg,rgba(16,33,24,.35),#18271f 34%,rgba(22,39,31,.94) 42%,rgba(22,39,31,.12) 70%,transparent)}
    main,footer{position:absolute;left:6%}main{top:32%}main:before{content:"";display:block;width:52px;height:2px;background:#edce8c;margin-bottom:28px}
    h1{font:normal 98px/1.05 Georgia,"Liberation Serif",serif;margin:0 0 8px}p{font-size:30px;margin:0}footer{bottom:6%;font-size:15px;color:#ede2c7}footer div+div{margin-top:4px}</style>
    <div class=map></div><div class=room></div><div class=veil></div><main><h1>A2ACraft</h1><p>Conversations become worlds.</p></main>
    <footer><div>Voice　Kokoro-82M · af_heart</div><div>Music　Mystical RPG Maker Town Theme · symphony</div></footer></html>`;
  await call('Page.navigate',{url:'data:text/html;base64,'+Buffer.from(card).toString('base64')});
  await poll(()=>evaluate("document.readyState==='complete' && !!document.querySelector('footer')"),'localized credits');
  await evaluate('document.fonts.ready.then(()=>true)');
  await writeFile(path.join(out,'en-end-card.jpg'),await screenshot());

}
function encode() {
  const ff=(...args)=>execFileSync(process.env.FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'});
  // Reuse the published English AAC stream and the original cue timings.
  const master=path.resolve('media/a2acraft-en-45s.mp4'), clips=[];
  const timeline=['walk','greeting','conversation','island','quest','accepted','village','world','district','details','castle'];
  for(const name of timeline){
    const shot=shots.find(item=>item.name===name);if(!shot)throw Error('Missing scene: '+name);
    const dest=path.join(scratch,shot.name+'.mp4');
    const input=shot.dir?['-framerate',String(shot.fps),'-i',path.join(shot.dir,'%03d.jpg')]:['-loop','1','-framerate','24','-i',path.join(out,'en-'+shot.name+'.jpg')];
    ff(...input,'-t',String(shot.seconds),'-vf','fps=24,format=yuv420p','-c:v','libx264','-preset','fast','-crf','20','-an',dest); clips.push(dest);
  }
  const credits=path.join(scratch,'credits.mp4');
  ff('-loop','1','-framerate','24','-i',path.join(out,'en-end-card.jpg'),'-t','5','-an','-vf','format=yuv420p','-c:v','libx264','-preset','fast','-crf','20',credits);clips.push(credits);
  return Promise.all([
    writeFile(path.join(scratch,'clips.txt'),clips.map(p=>"file '"+p+"'").join('\n')),
    readFile('subtitles/en.srt','utf8').then(text=>writeFile(path.join(scratch,'in-film.srt'),text.split(/\r?\n\s*\r?\n/).slice(0,7).join('\n\n')))
  ]).then(()=>{
    ff('-f','concat','-safe','0','-i',path.join(scratch,'clips.txt'),'-i',master,'-vf',
       "subtitles="+path.join(scratch,'in-film.srt')+":force_style='FontName=DejaVu Sans,FontSize=14,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,OutlineColour=&H80000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=13'",
       '-map','0:v:0','-map','1:a:0','-c:v','libx264','-crf','20','-preset','fast','-c:a','copy','-t','45','-metadata','title=A2ACraft','-movflags','+faststart',path.join(out,'a2acraft-en-45s.mp4'));
    return copyFile(path.join(out,'en-quest.jpg'),path.join(out,'poster-en.jpg'));
  });
}
try {
  const port=await poll(async()=>{if(chrome.exitCode!==null)throw Error('Chrome exited '+chrome.exitCode);try{return (await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}},'Chrome startup',90000);
  const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let serial=0;const pending=new Map();
  socket.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(msg.method==='Runtime.exceptionThrown')console.error('Renderer exception:',msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
    if(msg.method==='Log.entryAdded' && msg.params.entry.level==='error')console.error('Renderer log:', msg.params.entry.text.slice(0,500));
    if(!msg.id)return;
    const next=pending.get(msg.id);if(next){pending.delete(msg.id);if(msg.error)next.reject(Error(msg.error.message));else next.resolve(msg.result);}
  };
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Renderer timeout: '+method));},60000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    socket.send(JSON.stringify({id,method,params}));
  });
  evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  screenshot=async()=>Buffer.from((await call('Page.captureScreenshot',{format:'jpeg',quality:91,fromSurface:true})).data,'base64');
  await call('Page.enable');await call('Runtime.enable');await call('Log.enable');await call('Page.addScriptToEvaluateOnNewDocument',{source:'('+observeMapLabels.toString()+')()'});await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  // The product completes trips immediately for its reduced-motion interface.
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await tour(call);
  const mixed=Object.entries(notes).filter(([key,screen])=>key.startsWith('en-')&&(screen.lang!=='en'||screen.text.some(t=>/[\u3040-\u30ff\u3400-\u9fff]/u.test(t)))).map(([key])=>key);
  if(mixed.length)throw Error('Visible English sample needs translation in: '+mixed.join(', '));
  await encode();
} catch (error) {
  if(evaluate&&screenshot)try{await present('failure');}catch{}
  throw error;
} finally {socket?.close();chrome.kill();server.close();}
