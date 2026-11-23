import {toolText} from './i18n-tools.js';
const svgNamespace='http://www.w3.org/2000/svg';
function safeSVG(source){
 const document=new DOMParser().parseFromString(source,'image/svg+xml'),svg=document.documentElement;
 if(document.querySelector('parsererror')||svg.localName!=='svg'||svg.namespaceURI!==svgNamespace)throw Error(toolText('SVGを読み込めません。'));
 for(const element of [svg,...svg.querySelectorAll('*')]){
  if(element.namespaceURI!==svgNamespace||['script','foreignObject','iframe','object','embed','audio','video','a'].includes(element.localName))throw Error(toolText('このSVGには利用できない要素があります。'));
  if(element.localName==='style'&&/:host|::slotted/i.test(element.textContent))throw Error(toolText('このSVGには利用できないスタイルがあります。'));
  for(const attribute of element.attributes){const name=attribute.localName.toLowerCase(),value=attribute.value;if(name.startsWith('on')||((name==='href'||name==='src')&&!/^#[\w:.-]+$/.test(value))||(name==='attributename'&&/href|src|style|^on/i.test(value)))throw Error(toolText('このSVGには利用できない参照があります。'));}
 }
 return svg;
}
export function createMediaPlayer(container,item,{autoplay=false,onChange=()=>{}}={}){
 let decoder,frameIndex=0,frameCount=1,frameDuration=100,timer,playing=false,destroyed=false,svg,bitmap,objectURL,mode='static',initialized=false,wantsPlay=autoplay,playGeneration=0;const controller=new AbortController();
 const canvas=document.createElement('canvas');canvas.className='media-canvas';canvas.setAttribute('aria-label',item.name);canvas.width=item.width;canvas.height=item.height;container.replaceChildren(canvas);const context=canvas.getContext('2d');
 const update=()=>onChange({playing,frame:frameIndex,frames:frameCount,mode});
 const ready=(async()=>{
  const response=await fetch(item.url,{signal:controller.signal});if(!response.ok)throw Error(toolText('画像を取得できません。'));const bytes=await response.arrayBuffer();if(destroyed)return;
  if(item.mimeType==='image/svg+xml'){
   svg=safeSVG(new TextDecoder().decode(bytes));const host=document.createElement('div');host.className='media-svg-host';host.style.setProperty('--media-ratio',String(item.width/item.height));host.setAttribute('role','img');host.setAttribute('aria-label',item.name);const shadow=host.attachShadow({mode:'open'});svg=document.importNode(svg,true);svg.style.width='100%';svg.style.height='100%';shadow.append(svg);container.replaceChildren(host);mode='svg';svg.pauseAnimations?.();svg.setCurrentTime?.(0);for(const animation of svg.getAnimations?.({subtree:true})||[])animation.pause();
  }else{
   if(item.animated&&typeof ImageDecoder!=='undefined'&&await ImageDecoder.isTypeSupported(item.mimeType)){
    try{decoder=new ImageDecoder({data:bytes,type:item.mimeType,preferAnimation:true});await decoder.tracks.ready;await decoder.completed;frameCount=decoder.tracks.selectedTrack?.frameCount||1;if(frameCount<2){decoder.close();decoder=null;}else mode='frames';}catch{decoder?.close();decoder=null;}
   }
   if(decoder)await drawFrame(0);else{objectURL=URL.createObjectURL(new Blob([bytes],{type:item.mimeType}));bitmap=new Image();bitmap.src=objectURL;await bitmap.decode();if(destroyed)return;context.drawImage(bitmap,0,0,canvas.width,canvas.height);mode=item.animated?'native':'static';}
  }
  if(destroyed)return;initialized=true;update();if(wantsPlay&&item.animated)play();
 })();
 async function drawFrame(index,generation){const result=await decoder.decode({frameIndex:index,completeFramesOnly:true});try{if(!destroyed&&(generation===undefined||(playing&&generation===playGeneration))){context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(result.image,0,0,canvas.width,canvas.height);frameIndex=index;frameDuration=Math.max(20,(result.image.duration||100000)/1000);update();}return Math.max(20,(result.image.duration||100000)/1000);}finally{result.image.close();}}
 async function tick(generation){if(!playing||destroyed||generation!==playGeneration)return;try{const duration=await drawFrame((frameIndex+1)%frameCount,generation);if(playing&&!destroyed&&generation===playGeneration)timer=setTimeout(()=>tick(generation),duration);}catch(error){if(generation!==playGeneration)return;pause();if(!destroyed)onChange({error:error.message,playing:false,frame:frameIndex,frames:frameCount,mode});}}
 function play(){if(destroyed||playing||!item.animated)return;wantsPlay=true;if(!initialized)return;playing=true;const generation=++playGeneration;if(mode==='frames')timer=setTimeout(()=>tick(generation),frameDuration);else if(mode==='svg'){svg.unpauseAnimations?.();for(const animation of svg.getAnimations?.({subtree:true})||[])animation.play();}else if(mode==='native'){bitmap.className='media-native';bitmap.alt=item.name;container.replaceChildren(bitmap);}update();}
 function pause(){wantsPlay=false;playing=false;playGeneration++;clearTimeout(timer);if(svg){svg.pauseAnimations?.();for(const animation of svg.getAnimations?.({subtree:true})||[])animation.pause();}else if(mode==='native'&&bitmap){context.drawImage(bitmap,0,0,canvas.width,canvas.height);container.replaceChildren(canvas);}update();}
 async function firstFrame(){await ready;if(destroyed)throw Error(toolText('画像を選び直してください。'));const output=document.createElement('canvas');const scale=Math.min(1,2048/Math.max(item.width,item.height));output.width=Math.max(1,Math.round(item.width*scale));output.height=Math.max(1,Math.round(item.height*scale));const ctx=output.getContext('2d');if(decoder){const result=await decoder.decode({frameIndex:0,completeFramesOnly:true});try{ctx.drawImage(result.image,0,0,output.width,output.height);}finally{result.image.close();}}else{let image=bitmap,url;if(svg){const response=await fetch(item.url);url=URL.createObjectURL(await response.blob());image=new Image();image.src=url;await image.decode();}try{ctx.drawImage(image,0,0,output.width,output.height);}finally{if(url)URL.revokeObjectURL(url);}}return new Promise((resolve,reject)=>output.toBlob(blob=>blob?resolve(blob):reject(Error(toolText('静止画を作成できません。'))),'image/png'));}
 return {ready,play,pause,firstFrame,destroy(){destroyed=true;playing=false;clearTimeout(timer);controller.abort();decoder?.close();if(objectURL)URL.revokeObjectURL(objectURL);container.replaceChildren();}};
}
