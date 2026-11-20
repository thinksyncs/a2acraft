import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';

// Used exclusively by the isolated sample server. Normal diagnostics do not
// capture user content. Record only this BrowserWindow's composed village map.
function readSampleMap(action) {
  const params=new URLSearchParams(location.search);
  if(location.hostname!=='127.0.0.1'||params.get('demo')!=='1'||params.get('village')!=='sample'||params.get('walk')!=='resident')
    throw Error('Expected the isolated village sample');
  const map=document.querySelector('#village-canvas');
  const eye=document.querySelector('#village-map-3d');
  const start=document.querySelector('#village-walk-sample');
  const scene=document.querySelector('#history-village');
  const rect=map?.getBoundingClientRect();
  const ready=!document.hidden&&start&&rect?.width>0&&rect.height>0&&
    eye?.getBoundingClientRect().width>0&&eye.dataset.renderer==='webgl'&&eye.dataset.world3d==='leader';
  if(!ready)return null;
  if(action==='overview')document.querySelector('#village-fit').click();
  if(action==='start')start.click();
  const x=Math.ceil(Math.max(0,rect.left)),y=Math.ceil(Math.max(0,rect.top));
  const width=Math.floor(Math.min(innerWidth,rect.right))-x,height=Math.floor(Math.min(innerHeight,rect.bottom))-y;
  if(width<160||height<160)throw Error('Sample map is clipped');
  const speech=document.querySelector('#village-speech');
  const arrived=scene.dataset.encounterStatus==='talking'&&speech&&!speech.hidden&&speech.getClientRects().length>0;
  return {bounds:{x,y,width,height},x:Number(scene.dataset.heroX),y:Number(scene.dataset.heroY),
    leaderView:eye.dataset.renderer==='webgl'&&eye.dataset.world3d==='leader',
    following:scene.dataset.cameraFollowing==='true',arrived:Boolean(arrived),
    resident:arrived?document.querySelector('#village-speech-name').textContent:''};
}

async function bounded(operation,limit,message){
  let timer;
  try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),limit);})]);}
  finally{clearTimeout(timer);}
}

export async function captureSampleWalk(window,{profile,origin,version}){
  const directory=path.join(profile,'recording');
  await mkdir(directory,{mode:0o700});
  const contents=window.webContents,frames=[],start=performance.now();
  const report={version,source:'visible Electron BrowserWindow capturePage',status:'recording',frames};
  const state=async(action='read')=>{
    if(window.isDestroyed()||!window.isVisible()||contents.isDestroyed()||new URL(contents.getURL()).origin!==origin)
      throw Error('Sample window closed, hidden, or navigated');
    return bounded(contents.executeJavaScript('('+readSampleMap.toString()+')('+JSON.stringify(action)+')'),12000,'Sample renderer timed out');
  };
  const frame=async(phase,map)=>{
    const shot=await bounded(contents.capturePage(map.bounds),9000,'Sample compositor timed out');
    if(shot.isEmpty())throw Error('Sample compositor returned an empty frame');
    const bitmap=shot.resize({width:24,height:16}).toBitmap();
    let low=255,high=0;
    for(let index=0;index<bitmap.length;index+=4){low=Math.min(low,bitmap[index+1]);high=Math.max(high,bitmap[index+1]);}
    if(high-low<12)throw Error('Sample compositor returned a blank frame');
    const file=phase==='overview'?'overview.jpg':`frame-${String(frames.length).padStart(3,'0')}.jpg`;
    const jpg=shot.resize({width:Math.min(1080,shot.getSize().width)}).toJPEG(84);
    await writeFile(path.join(directory,file),jpg,{flag:'wx',mode:0o600});
    frames.push({file,phase,atMs:Math.round(performance.now()-start),...map});
  };
  try{
    let map=null;
    while(!map&&performance.now()-start<35000){map=await state();if(!map)await delay(200);}
    if(!map)throw Error('Sample map and WebGL leader view did not become visible');
    await state('overview');await delay(350);await frame('overview',await state());
    await state('start');
    const walkStart=performance.now();
    while(performance.now()-walkStart<75000&&frames.length<241){
      const map=await state();
      if(!map)throw Error('Lost the visible sample or leader view during the walk');
      await frame(map.arrived?'arrival':'walk',map);
      if(map.arrived)break;
      await delay(160);
    }
    const walked=frames.filter(f=>f.phase==='walk'&&f.following);
    const moved=walked.some(f=>Math.hypot(f.x-walked[0].x,f.y-walked[0].y)>12);
    if(!moved||!frames.at(-1)?.arrived)throw Error('Could not verify movement and arrival at a resident');
    report.status='verified';
  }catch(error){report.status='failed';report.reason=String(error.message).slice(0,200);}
  await writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  return report.status==='verified';
}
