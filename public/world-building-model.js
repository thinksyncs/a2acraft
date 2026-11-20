import {finite,clamp} from './world-3d-math.js';
import {hash,color,quad,box,roof,cone} from './world-model-primitives.js';

const PLASTER=['#d7c9a8','#c5c5aa','#d9cbb4','#b9c4b6'];
const ROOFS=['#935b48','#5c747a','#7e7563','#626d83'];
const c=hex=>color(hex),wood=c('#66513e'),woodLight=c('#9b805c');
const stone=c('#8c9387'),stoneLight=c('#bab9a4'),dark=c('#293a3b');

export function buildingShape(building={}){
  const kind=building.kind||'house';
  return {x:finite(building.x),y:finite(building.y),
    width:clamp(finite(building.width,kind==='castle'?130:70),12,600),
    depth:clamp(finite(building.depth,kind==='castle'?100:58),12,600),
    height:clamp(finite(building.height,kind==='castle'?80:48),10,250),
    stage:building.stage||'finished',kind};
}

// Square-section timber along any direction, including the diagonal roof frame.
function beam(out,a,b,width,shade){
  const delta=b.map((n,i)=>n-a[i]),length=Math.hypot(...delta);if(length<.001)return;
  const u=delta.map(n=>n/length),side=Math.abs(u[1])<.9?[-u[2],0,u[0]]:[1,0,0];
  const sLength=Math.hypot(...side),v=side.map(n=>n/sLength*width/2);
  const w=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const corners=p=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sv,sw])=>p.map((n,i)=>n+v[i]*sv+w[i]*sw));
  const points=[...corners(a),...corners(b)];
  for(const f of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])quad(out,...f.map(i=>points[i]),shade);
}

function foundation(out,x,z,w,d){
  box(out,x,.6,z,w+6,3,d+6,stone);
  box(out,x,3.1,z,w+2,1.1,d+2,stoneLight);
  // Masonry joints are separated stone blocks, not floating painted decals.
  const n=Math.max(2,Math.min(8,Math.floor(w/15))),span=w/n;
  for(let i=0;i<n;i++)box(out,x-w/2+(i+.5)*span,.8,z+d/2+2,span-1,2.5,2,c(i%3?'#a0a394':'#b2af99'));
}

function windowFront(out,x,y,z,w,h,{lit=false,shutters=false}={}){
  const frame=Math.max(.8,Math.min(1.9,w*.11)),glass=lit?c('#d7b974'):c('#668c8f');
  box(out,x,y,z,w+frame*2,h+frame*2,1.5,wood);
  box(out,x,y+frame,z+1.05,w,h,.75,dark);
  box(out,x,y+frame*1.6,z+1.5,Math.max(.6,w-frame),Math.max(.6,h-frame),.3,glass);
  box(out,x,y+frame,z+1.9,frame*.7,h,.55,woodLight);
  box(out,x,y+h*.57,z+1.9,w,frame*.7,.55,woodLight);
  box(out,x,y-.5,z+1.4,w+frame*3,frame,3,stoneLight);
  if(shutters)for(const side of [-1,1])box(out,x+side*(w*.75+frame),y+frame,z+.5,w*.3,h,1.6,c('#6a8174'));
}

function windowSide(out,x,y,z,w,h,lit=false){
  const frame=Math.max(.8,Math.min(1.8,w*.1));
  box(out,x,y,z,1.5,h+frame*2,w+frame*2,wood);
  box(out,x+1.0,y+frame,z,.8,h,w,dark);
  box(out,x+1.5,y+frame*1.6,z,.3,Math.max(.6,h-frame),Math.max(.6,w-frame),c(lit?'#c9ae71':'#6b9090'));
  box(out,x+1.9,y+frame,z,.5,h,frame*.7,woodLight);
  box(out,x+1.9,y+h*.57,z,.5,frame*.7,w,woodLight);
  box(out,x+1.3,y-.5,z,3,frame,w+frame*3,stoneLight);
}

function door(out,x,z,h,w){
  box(out,x,4,z,w+4,h+2,2,stoneLight);
  box(out,x,4,z+1.3,w,h,1.2,dark);
  box(out,x,4,z+2,w-2,h-1,.65,c('#7a6045'));
  for(const dx of [-.27,0,.27])box(out,x+dx*w,4.4,z+2.45,.6,h-1.8,.25,c('#544a39'));
  box(out,x,4+h*.33,z+2.7,w-2,1,.3,c('#485657'));
  box(out,x,4+h*.73,z+2.7,w-2,1,.3,c('#485657'));
  box(out,x+w*.25,4+h*.48,z+3,1.2,1.4,.8,c('#c7aa68'));
  box(out,x,1,z+3,w+8,2.4,6,stone);
}

function timberFacades(out,x,z,w,d,h,wall){
  box(out,x,4,z,w,h,d,wall);
  const b=Math.max(1.4,Math.min(3,w*.035)),front=z+d/2+.3,right=x+w/2+.3;
  for(const dx of [-w/2+b/2,0,w/2-b/2])box(out,x+dx,4,front,b,h,1.5,wood);
  for(const dz of [-d/2+b/2,0,d/2-b/2])box(out,right,4,z+dz,1.5,h,b,wood);
  for(const y of [4,h*.53+4,h+2]){
    box(out,x,y,front,w,2,1.6,wood);box(out,right,y,z,1.6,2,d,wood);
  }
  if(w>=50&&h>=30){
    const y0=4+h*.55,y1=4+h*.87;
    for(const side of [-1,1])beam(out,[x+side*w*.44,y0,front+.25],[x+side*w*.16,y1,front+.25],b*.7,woodLight);
    for(const side of [-1,1])beam(out,[right+.25,y0,z+side*d*.43],[right+.25,y1,z+side*d*.13],b*.7,woodLight);
  }
}

function tiledRoof(out,x,y,z,w,d,rise,shade){
  box(out,x,y-2,z,w+7,2.8,d+7,wood);
  roof(out,x,y,z,w+8,rise,d+8,shade);
  // The ridge is a solid cap and the two eaves cast their own shade.
  box(out,x,y+rise-.9,z,3,2.5,d+10,shade.map(n=>Math.min(1,n*1.19)));
  for(const side of [-1,1])box(out,x+side*(w/2+3.5),y-.5,z,1.7,2.2,d+8,shade.map(n=>n*.68));
  for(const side of [-1,1])beam(out,[x-w/2-3,y+.1,z+side*(d/2+4.2)],[x,y+rise,z+side*(d/2+4.2)],1.6,woodLight);
  for(const side of [-1,1])beam(out,[x,y+rise,z+side*(d/2+4.2)],[x+w/2+3,y+.1,z+side*(d/2+4.2)],1.6,wood);
}

function chimney(out,x,z,bottom,height,width=8){
  box(out,x,bottom,z,width,height,width,c('#8e8272'));
  for(let y=bottom+6;y<bottom+height-3;y+=7)box(out,x,y,z,width+.25,.65,width+.25,c('#b2a38a'));
  box(out,x,bottom+height-2,z,width+3,2.5,width+3,stoneLight);
  box(out,x,bottom+height+.5,z,width-2,.35,width-2,c('#38433f'));
}

function lantern(out,x,y,z){
  box(out,x,y,z,3,5,3,wood);box(out,x,y+.8,z+.4,1.8,3.2,2.2,c('#e6bf6d'));
  roof(out,x,y+5,z,4,1.8,4,c('#55605a'));box(out,x,y+6.5,z,.7,2,.7,wood);
}

function scaffold(out,x,z,w,d,h){
  const b=Math.max(1.5,Math.min(3,w*.035));
  for(const dx of [-w/2-4,w/2+4])for(const dz of [-d/2-4,d/2+4])box(out,x+dx,1,z+dz,b,h+8,b,woodLight);
  for(const y of [h*.4+4,h*.8+4]){
    for(const side of [-1,1]){
      box(out,x,y,z+side*(d/2+4),w+11,1.8,5,c('#b49b73'));
      box(out,x+side*(w/2+4),y,z,5,1.8,d+11,woodLight);
    }
  }
  beam(out,[x-w/2-4,4,z+d/2+4],[x+w/2+4,h*.8+4,z+d/2+4],b*.65,wood);
}

function stagePennant(out,x,z,w,d,h,stage){
  const y=Math.min(30,h*.56+7),px=x+w*.43,pz=z+d/2+4;
  box(out,px,1,pz,1.1,y,1.1,wood);
  const shade=c(stage==='testing'?'#629bab':stage==='building'?'#c99855':'#7f9b70');
  box(out,px-3.1,y-6,pz,6,5,.5,shade);box(out,px-3.1,y-1.5,pz,6,.7,.6,c('#dcc893'));
}

function castle(out,x,z,w,d,h){
  // A lower curtain wall, recessed keep and four faceted towers create
  // actual courtyards and a readable castle silhouette from both viewpoints.
  const wallH=h*.54,keepW=w*.55,keepD=d*.54;
  box(out,x,4,z-d*.13,keepW,h*.92,keepD,c('#b2b6a6'));
  tiledRoof(out,x,h*.92+4,z-d*.13,keepW,keepD,h*.29,c('#596d7d'));
  box(out,x,4,z+d*.31,w*.78,wallH,d*.21,stone);
  for(const side of [-1,1])box(out,x+side*w*.4,4,z,w*.17,wallH,d*.78,stone);
  for(const dx of [-w*.39,w*.39])for(const dz of [-d*.37,d*.37]){
    const radius=Math.min(w,d)*.14,towerH=h*(dz>0?.92:1.1);
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,b=(i+1)*Math.PI/4;
      const a0=[x+dx+Math.cos(a)*radius,4,z+dz+Math.sin(a)*radius],b0=[x+dx+Math.cos(b)*radius,4,z+dz+Math.sin(b)*radius];
      quad(out,a0,[a0[0],towerH,a0[2]],[b0[0],towerH,b0[2]],b0,c(i%2?'#a4ab9c':'#b6b7a2'));
    }
    cone(out,x+dx,towerH,z+dz,radius+2,h*.23,c('#586e7a'));
    windowFront(out,x+dx,towerH*.52,z+dz+radius,Math.max(3,radius*.43),h*.18);
  }
  const count=Math.max(4,Math.min(10,Math.round(w/18))),span=w*.78/count;
  for(let i=0;i<count;i++)box(out,x-w*.39+(i+.5)*span,wallH+4,z+d*.31,span*.56,5,d*.21+1.5,stoneLight);
  door(out,x,z+d*.415,wallH*.8,Math.min(24,w*.2));
  for(const side of [-1,1]){
    box(out,x+side*w*.22,wallH*.35,z+d*.42,7,wallH*.5,.9,c('#6b8a9b'));
    box(out,x+side*w*.22,wallH*.52,z+d*.43,2,7,1,c('#d4bd80'));
  }
}

export function buildingMesh(out,building={}){
  const {x,y:z,width:w,depth:d,height:h,stage,kind}=buildingShape(building),seed=hash(building.seed??building.id??kind);
  foundation(out,x,z,w,d);
  if(stage==='planned'||stage==='plan'){
    box(out,x,3.8,z,w-4,.7,d-4,c('#b8ad8a'));
    for(const dx of [-w/2,w/2])for(const dz of [-d/2,d/2])box(out,x+dx,3,z+dz,2.5,11,2.5,woodLight);
    for(const side of [-1,1])beam(out,[x-w/2,10,z+side*d/2],[x+w/2,10,z+side*d/2],.65,c('#d6ccaa'));
    box(out,x-w*.15,4.7,z+d*.15,w*.36,.9,d*.3,c('#657d78'));
    for(let i=0;i<3;i++)box(out,x+w*.26,4+i*1.9,z-d*.25,w*.25,1.6,4,woodLight);
    return;
  }
  if(['building','construction','implement'].includes(stage)){
    box(out,x,4,z,w,h*.45,d,c('#b5b39b'));
    for(const dx of [-w*.46,0,w*.46])box(out,x+dx,4,z+d*.46,2.5,h,2.5,wood);
    for(const side of [-1,1]){
      const pz=z+side*d*.46;
      beam(out,[x-w*.46,h+4,pz],[x,h*1.3+4,pz],2.7,woodLight);
      beam(out,[x,h*1.3+4,pz],[x+w*.46,h+4,pz],2.7,woodLight);
      beam(out,[x-w*.46,h+4,pz],[x+w*.46,h+4,pz],2.7,wood);
    }
    beam(out,[x,h*1.3+4,z-d*.46],[x,h*1.3+4,z+d*.46],2.8,wood);
    scaffold(out,x,z,w,d,h);stagePennant(out,x,z,w,d,h,'building');return;
  }
  if(kind==='castle'){castle(out,x,z,w,d,h);return;}
  const forge=kind==='weapon'||kind==='shop',inn=kind==='tavern';
  // Supplied world colors remain the source of identity; neutral plaster keeps
  // the architecture legible instead of painting the entire house one color.
  const accent=color(building.color,PLASTER[seed%PLASTER.length]);
  const plaster=kind==='cottage'?accent:accent.map((n,i)=>n*.25+c(PLASTER[seed%PLASTER.length])[i]*.75);
  timberFacades(out,x,z,w,d,h,forge?c('#a6a99a'):plaster);
  const doorW=Math.max(5,Math.min(17,w*.2)),doorH=Math.max(6,h*(inn?.48:.52));
  door(out,x+(forge?w*.17:0),z+d/2+.4,doorH,doorW);
  if(w>=28){
    if(!forge)for(const dx of [-w*.3,w*.3])windowFront(out,x+dx,4+h*.33,z+d/2+.4,Math.max(3,w*.14),Math.max(4,h*.24),{lit:inn||stage==='complete'||stage==='finished',shutters:w>50});
    else windowFront(out,x+w*.34,4+h*.61,z+d/2+.4,w*.14,h*.21);
  }
  if(d>=28)for(const dz of [-d*.25,d*.25])windowSide(out,x+w/2+.4,4+h*.34,z+dz,Math.max(3,d*.17),Math.max(4,h*.25),inn);
  const roofShade=c(forge?'#526d72':inn?'#955b45':stage==='testing'?'#617b85':ROOFS[seed%ROOFS.length]),rise=h*(inn?.36:.42);
  tiledRoof(out,x,h+4,z,w,d,rise,roofShade);
  if(inn){
    // A front-facing dormer and a deep door canopy separate the inn from homes.
    box(out,x,h+rise*.24,z+d*.23,w*.23,h*.24,d*.25,plaster);
    tiledRoof(out,x,h+rise*.24+h*.24,z+d*.23,w*.23,d*.25,h*.16,roofShade);
    windowFront(out,x,h+rise*.25+2,z+d*.355,w*.1,h*.14,{lit:true});
    tiledRoof(out,x,doorH+7,z+d*.49,w*.31,9,h*.12,roofShade);
    lantern(out,x+w*.2,doorH*.75,z+d/2+3);
  }
  if(forge){
    const fx=x-w*.29;
    door(out,fx,z+d/2+.5,h*.43,Math.max(7,w*.24));
    box(out,fx,5,z+d/2+3,Math.max(4,w*.18),h*.27,.5,c('#cf8c4c'));
    box(out,fx,5,z+d/2+3.4,Math.max(2,w*.09),h*.17,.3,c('#ecc17b'));
    chimney(out,x-w*.3,z-d*.16,h*.6,h*.9,Math.max(6,w*.13));
    box(out,x+w*.34,4,z+d*.38,w*.17,6,d*.12,c('#6a513c'));
    box(out,x+w*.34,10,z+d*.38,w*.23,3,d*.14,c('#657574'));
  }else chimney(out,x+w*.28,z-d*.18,h*.85,h*.57,Math.max(4,Math.min(9,w*.1)));
  if(stage==='testing'){
    const px=x-w*.44,pz=z+d/2+4,top=Math.min(h+6,58);
    for(const dx of [-2.5,2.5])box(out,px+dx,1,pz,1.1,top,1.1,woodLight);
    for(let y=5;y<top;y+=5)box(out,px,y,pz,6,1.1,1.1,wood);
  }
  if(kind!=='cottage')stagePennant(out,x,z,w,d,h,stage);
}
