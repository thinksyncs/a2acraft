import {hash,color,triangle} from './world-model-primitives.js';
import {finite,clamp,cross,normalize} from './world-3d-math.js';

const supported=new Set(['tree','pine','rock','biome-tree','mountain','biome-mountain']);
const tint=(shade,factor)=>shade.map(channel=>clamp(channel*factor,0,1));

// Shared ground-anchored solids: scenery keeps its existing place and footprint
// while the map and eye-level camera see the same branches, crowns and crags.
export function sceneryObjectMesh(out,item={}){
  if(!supported.has(item.kind))return false;
  const x=finite(item.x),z=finite(item.y),size=clamp(finite(item.size,finite(item.scale,1)),.1,4);
  const mountain=item.kind==='mountain'||item.kind==='biome-mountain',rock=item.kind==='rock';
  const pine=item.kind==='pine',biome=item.kind==='biome-tree';
  const width=Math.max(.1,finite(item.width,(mountain?90:rock?20:36)*size));
  const depth=Math.max(.1,finite(item.depth,(mountain?70:rock?17:36)*size));
  const height=Math.max(.1,finite(item.height,(mountain?100:rock?13:pine?51:45)*size));
  const seed=hash(item.seed??item.id??`${item.kind}:${x}:${z}:${item.tone||0}`);
  const noise=index=>hash(`${seed}:${index}`)/4294967295;
  const point=([px,y,pz])=>[x+px*width,y*height,z+pz*depth];
  const facet=(a,b,c,shade,factor=1)=>triangle(out,point(a),point(b),point(c),tint(shade,factor));
  const rings=(levels,shade,salt,{top,bottom}={})=>{
    for(let level=0;level<levels.length-1;level++)for(let i=0;i<levels[level].length;i++){
      const next=(i+1)%levels[level].length,a=levels[level][i],b=levels[level+1][i],
        c=levels[level+1][next],d=levels[level][next],tone=.88+noise(salt+i*11+level*17)*.22;
      facet(a,b,c,shade,tone);facet(a,c,d,shade,tone*(.96+noise(salt+i+level)*.07));
    }
    if(top)for(let i=0;i<levels.at(-1).length;i++)facet(levels.at(-1)[i],top,
      levels.at(-1)[(i+1)%levels.at(-1).length],shade,1.01+noise(salt+i)*.12);
    if(bottom)for(let i=0;i<levels[0].length;i++)facet(levels[0][i],levels[0][(i+1)%levels[0].length],bottom,shade,.78);
  };
  const ring=(cx,y,cz,rx,rz,count,salt,roughness=.1)=>Array.from({length:count},(_,i)=>{
    const angle=i*Math.PI*2/count,rough=1-roughness*noise(salt+i);
    return [cx+Math.cos(angle)*rx*rough,y,cz+Math.sin(angle)*rz*rough];
  });
  const branch=(a,b,radius,shade)=>{
    // Branch sections are built in physical units, so non-square biome
    // footprints do not tilt their bark normals or detach their endpoints.
    const start=point(a),end=point(b),axis=normalize(end.map((v,i)=>v-start[i]));
    const u=normalize(cross(axis,Math.abs(axis[1])>.9?[1,0,0]:[0,1,0])),v=cross(axis,u);
    const radiusWorld=Math.min(width,depth)*radius;
    const circle=(origin,r)=>Array.from({length:4},(_,i)=>origin.map((value,j)=>value+
      (u[j]*Math.cos(i*Math.PI/2)+v[j]*Math.sin(i*Math.PI/2))*r));
    const lower=circle(start,radiusWorld),upper=circle(end,radiusWorld*.4);
    for(let i=0;i<4;i++){
      const next=(i+1)%4,shadeFace=tint(shade,.84+i*.07);
      triangle(out,lower[i],upper[next],upper[i],shadeFace);triangle(out,lower[i],lower[next],upper[next],shadeFace);
    }
  };

  if(rock||mountain){
    const stone=color(item.color,rock?'#8e9480':'#928b78');
    function crag(cx,cz,w,d,h,salt){
      const count=8,lean=(noise(salt+71)-.5)*w*.27;
      const levels=[ring(cx,0,cz,w*.5,d*.5,count,salt,.15),
        ring(cx+lean*.2,h*.23,cz-d*.03,w*.43,d*.42,count,salt+11,.21),
        ring(cx+lean*.5,h*.57,cz+d*.03,w*.27,d*.29,count,salt+22,.30),
        ring(cx+lean,h*.79,cz,w*.13,d*.15,count,salt+33,.32)];
      // Slightly different bands reveal the broken strata; their shared ring
      // positions form one surface without overlaid stripes or depth flicker.
      for(let band=0;band<levels.length-1;band++)rings([levels[band],levels[band+1]],
        tint(stone,[.81,.97,1.07][band]),salt+band*23);
      rings([levels.at(-1)],tint(stone,mountain?1.20:1.12),salt+81,{top:[cx+lean,h,cz-d*.04]});
    }
    if(rock){
      crag(0,0,1,1,1,19);
    }else{
      crag(-.02,-.02,.88,.91,1,19);
      crag(-.30,.17,.37,.57,.43,107);
      crag(.28,.12,.42,.60,.54,211);
    }
    return true;
  }

  const bark=color('#6b5138'),tone=finite(item.tone)%3;
  const leaf=color(item.color,pine?'#426a46':biome?'#466c43':tone?'#607c45':'#527943');
  const lean=(noise(5)-.5)*.055;
  rings([ring(0,0,0,.075,.075,6,3,0),ring(lean,.25,.008,.045,.045,6,8,.04),
    ring(lean*.8,.62,-.012,.025,.027,6,12,.05)],bark,33);
  for(let i=0;i<3;i++){
    const angle=i*Math.PI*2/3,root=[Math.cos(angle)*.15,0,Math.sin(angle)*.15];
    facet(root,[Math.cos(angle-.35)*.048,.13,Math.sin(angle-.35)*.048],
      [Math.cos(angle+.35)*.048,.13,Math.sin(angle+.35)*.048],bark,.82+i*.08);
    facet(root,[Math.cos(angle+.35)*.048,.13,Math.sin(angle+.35)*.048],
      [Math.cos(angle+.35)*.068,0,Math.sin(angle+.35)*.068],bark,.77+i*.06);
  }
  branch([lean,.28,0],[-.24,.52,-.035],.028,bark);
  branch([lean,.34,0],[.21,.57,.025],.025,bark);
  if(pine){
    for(const [index,y,rx,rz,top]of [[0,.20,.47,.47,.69],[1,.40,.37,.37,.85],[2,.62,.24,.24,1]]){
      const cx=lean*(index+1),cz=(noise(index+55)-.5)*.025;
      const lower=ring(cx,y,cz,rx,rz,8,80+index*13,.16).map((p,i)=>[p[0],p[1]+noise(i+index*17)*.035,p[2]]);
      const shoulder=ring(cx,y+(top-y)*.23,cz,rx*.68,rz*.68,8,90+index*11,.16);
      rings([lower,shoulder],tint(leaf,.88+index*.085),120+index*11,{top:[lean*1.7,top,0]});
    }
  }else{
    for(const [index,cx,cy,cz,rx,ry,rz]of [[0,-.19,.60,.02,.29,.23,.34],
      [1,.18,.63,-.04,.30,.24,.35],[2,-.035,.79,.045,.32,.21,.41]]){
      const salt=180+index*41;
      const levels=[ring(cx,cy-ry*.72,cz,rx*.59,rz*.59,6,salt,.09),
        ring(cx,cy,cz,rx,rz,6,salt+11,.09),ring(cx-.02,cy+ry*.66,cz,rx*.65,rz*.65,6,salt+22,.09)];
      rings(levels,tint(leaf,.91+index*.07),salt,{top:[cx-.025,cy+ry,cz-.018],bottom:[cx,cy-ry*.91,cz]});
    }
  }
  return true;
}
