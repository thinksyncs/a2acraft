import {toolText} from './i18n-tools.js';
import {getLocale} from './i18n.js';
import {createMediaPlayer} from './media-player.js';
export function initMedia({api,getState,isVisible,motionAllowed,onState,onAttach,notify}){
 const $=selector=>document.querySelector(selector);let selected=null,player,loadNumber=0,busy=false,lastList='',currentItem=null,previewStatus=null;
 const accepted=file=>file.type.startsWith('image/')||/\.(png|jpe?g|gif|webp|apng|svg)$/i.test(file.name);
 function resetPreview(){
  loadNumber++;player?.destroy();player=null;selected=null;currentItem=null;previewStatus=null;
  $('#media-stage').textContent=toolText('画像を選択してください。');$('#media-stage').dataset.playing='false';delete $('#media-stage').dataset.frame;
  $('#media-title').textContent=toolText('画像を選択');$('#media-metadata').textContent='';$('#media-playback').textContent='';
  $('#media-play').disabled=true;$('#media-pause').disabled=true;$('#media-attach').disabled=true;
  for(const id of ['media-original','media-attach','media-remove'])$('#'+id).hidden=true;
  $('#media-original').removeAttribute('href');$('#media-original').removeAttribute('download');
 }
 function metadata(item){return item.format+' · '+item.width+' × '+item.height+' · '+(item.size/1024).toFixed(1)+' KiB'+(item.animated?toolText(' · アニメーション'):'');}
 function playback(item,value){return value.error||(!item.animated?toolText('静止画像'):value.playing?toolText('再生中'):toolText('停止中'))+(value.frames>1?toolText(' · フレーム ')+(value.frame+1)+' / '+value.frames:'');}
 async function choose(id){
  const item=getState()?.items.find(item=>item.id===id);if(!item)return;selected=id;currentItem=item;previewStatus=null;const generation=++loadNumber;player?.destroy();$('#media-error').hidden=true;$('#media-title').textContent=item.name;$('#media-metadata').textContent=metadata(item);$('#media-original').href=item.url;$('#media-original').download=item.name;$('#media-original').hidden=false;$('#media-attach').hidden=false;$('#media-attach').disabled=true;$('#media-remove').hidden=false;$('#media-play').disabled=true;$('#media-pause').disabled=true;$('#media-playback').textContent=toolText('読み込み中…');$('#media-stage').dataset.playing='false';delete $('#media-stage').dataset.frame;
  player=createMediaPlayer($('#media-stage'),item,{autoplay:isVisible()&&motionAllowed(),onChange:value=>{if(generation!==loadNumber)return;$('#media-play').disabled=!item.animated||value.playing;$('#media-pause').disabled=!value.playing;previewStatus=value;$('#media-playback').textContent=playback(item,value);$('#media-stage').dataset.frame=String(value.frame);$('#media-stage').dataset.playing=String(value.playing);}});
  try{await player.ready;if(generation===loadNumber){$('#media-attach').disabled=false;renderList();}}catch(error){if(generation===loadNumber&&error.name!=='AbortError'){loadNumber++;player?.destroy();player=null;$('#media-play').disabled=true;$('#media-pause').disabled=true;$('#media-attach').disabled=true;$('#media-stage').dataset.playing='false';$('#media-playback').textContent=toolText('読み込めませんでした。画像を選び直してください。');showError(error.message);}}
 }
 function showError(message){$('#media-error').textContent=message;$('#media-error').hidden=false;}
 function refreshPreviewLanguage(){
  if(!currentItem){
   $('#media-title').textContent=toolText('画像を選択');
   $('#media-stage').textContent=toolText('画像を選択してください。');
   return;
  }
  $('#media-metadata').textContent=metadata(currentItem);
  if(previewStatus)$('#media-playback').textContent=playback(currentItem,previewStatus);
 }
 let previewLocale=getLocale();
 function renderList(){if(previewLocale!==getLocale()){previewLocale=getLocale();refreshPreviewLanguage();}const items=getState()?.items||[];if(selected&&!items.some(item=>item.id===selected))resetPreview();const key=JSON.stringify([getLocale(),items,selected]);if(key===lastList)return;lastList=key;const list=$('#media-list');list.replaceChildren();for(const item of [...items].reverse()){const button=document.createElement('button');button.type='button';button.className='media-list-item';button.dataset.mediaId=item.id;button.setAttribute('aria-pressed',String(item.id===selected));const name=document.createElement('strong'),meta=document.createElement('span');name.textContent=item.name;meta.textContent=item.format+(item.animated?toolText(' · アニメーション'):'');button.append(name,meta);button.onclick=()=>choose(item.id);list.append(button);}$('#media-empty').hidden=items.length>0;}
 async function ingest(files){if(busy)return;busy=true;$('#media-input').disabled=true;$('#media-upload-status').textContent=toolText('画像を保存しています…');try{for(const file of [...files]){if(!accepted(file))throw Error(toolText('画像ファイルを選んでください。'));if(file.size>10*1024*1024)throw Error(toolText('画像は10 MiB以内にしてください。'));const response=await fetch('/api/media?name='+encodeURIComponent(file.name),{method:'POST',headers:{'X-Chat-UI':'1','Content-Type':file.type||'application/octet-stream'},body:file});const result=await response.json();if(!response.ok)throw Error(result.error);const snapshot=await fetch('/api/state').then(response=>{if(!response.ok)throw Error(toolText('画像一覧を取得できません。'));return response.json();});onState(snapshot.media);await choose(result.id);}$('#media-upload-status').textContent=toolText('原本を保存しました。');}catch(error){showError(error.message);$('#media-upload-status').textContent=toolText('保存できませんでした。入力をやり直せます。');}finally{busy=false;$('#media-input').disabled=false;$('#media-input').value='';}}
 $('#media-input').onchange=event=>ingest(event.target.files);$('#media-play').onclick=()=>player?.play();$('#media-pause').onclick=()=>player?.pause();$('#media-zoom').onchange=()=>$('#media-stage').style.setProperty('--media-scale',$('#media-zoom').value);
 $('#media-attach').onclick=async()=>{try{if(!player||!currentItem)return;const blob=await player.firstFrame();onAttach(new File([blob],currentItem.name.replace(/\.[^.]+$/,'')+'.png',{type:'image/png'}));}catch(error){showError(error.message);}};
 $('#media-remove').onclick=async()=>{try{const id=selected,state=await api('media/remove',{id});if(selected===id)resetPreview();onState(state);}catch(error){showError(error.message);}};
 const zone=$('#media-drop');zone.ondragover=event=>{event.preventDefault();};zone.ondrop=event=>{event.preventDefault();ingest(event.dataTransfer.files);};
 window.addEventListener('paste',event=>{if(!isVisible())return;const files=[...(event.clipboardData?.files||[])].filter(accepted);if(files.length){event.preventDefault();ingest(files);}});
 window.addEventListener('chat-ui-motion',()=>{if(!motionAllowed())player?.pause();});
 return {render:renderList,open:async id=>{renderList();const item=id||selected||getState()?.items.at(-1)?.id;if(item)await choose(item);},visible:value=>{if(!value)player?.pause();},select:choose};
}
