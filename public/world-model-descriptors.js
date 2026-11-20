// Ground anchors and model dimensions are shared by the atlas and eye view.
import {hash} from './world-model-primitives.js';
const walls=['#d2ac65','#71afb5','#b78ca8','#9bb968'];
export function projectModel(item,{district=false}={}){
  const stage=item.stage||'planned',seed=Number.isFinite(Number(item.seed))?Number(item.seed)>>>0:hash(item.seed??item.conversationId);
  return {...item,id:item.id||'project:'+item.conversationId,seed:item.seed??item.conversationId??item.id,x:item.x,y:item.y-(district?26:24),
    width:district?110:100,depth:district?77:72,
    height:(district?{planned:20,building:45,testing:65,finished:78}:{planned:5,building:32,testing:55,complete:64})[stage]||45,
    stage,kind:'house',color:district?{planned:'#bdaf85',building:'#c68a52',testing:'#709ea1',finished:'#d0b276'}[stage]:walls[seed%walls.length]};
}
export function facilityModel(place,{district=false}={}){
  return {id:'place:'+place.id,seed:'facility:'+place.id,x:place.x,y:place.y-(district?30:40),kind:place.id,
    width:district?140:place.id==='castle'?170:120,depth:district?90:100,
    height:district?(place.id==='castle'?130:85):(place.id==='castle'?100:64),stage:'finished',
    color:place.id==='castle'?'#99a9bb':place.id==='tavern'?'#c28d68':'#86a6a0'};
}
export function cottageModel(item){
  return {id:'cottage:'+Math.abs(Math.trunc(item.tone||0)),kind:'cottage',x:item.x,y:item.y-10,
    width:38,depth:28,height:27,stage:'finished',color:'#d5c18a',tone:item.tone||0};
}
export function characterPose(item,{time=0,motion=true}={}){
  return {...item,seed:item.seed??item.conversationId??item.id,
    heading:Number.isFinite(item.heading)?item.heading:({up:0,right:Math.PI/2,down:Math.PI,left:-Math.PI/2}[item.direction]??Math.PI),
    gait:motion&&item.walking?Math.sin(time/150+hash(item.seed??item.conversationId??item.id)%19):0};
}
