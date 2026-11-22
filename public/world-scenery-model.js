import {hash,color,triangle} from './world-model-primitives.js';
import {finite,clamp,cross,normalize} from './world-3d-math.js';

const supported=new Set(['tree','pine','rock','biome-tree','mountain','biome-mountain']);
const tint=(shade,factor)=>shade.map(channel=>clamp(channel*factor,0,1));

// Shared ground-anchored solids: scenery keeps its existing place and footprint
// while the map and eye-level camera see the same branches, crowns and crags.
export function sceneryObjectMesh(out,item={},distant=false){
  if(!supported.has(item.kind))return false;
  const x=finite(item.x),z=finite(item.y),size=clamp(finite(item.size,finite(item.scale,1)),.1,4);
  const mountain=item.kind==='mountain'||item.kind==='biome-mountain',rock=item.kind==='rock';
  const biome=item.kind==='biome-tree',pine=item.kind==='pine'||(biome&&item.conifer);
  const width=Math.max(.1,finite(item.width,(mountain?90:rock?20:36)*size));
  const depth=Math.max(.1,finite(item.depth,(mountain?70:rock?17:36)*size));
  const height=Math.max(.1,finite(item.height,(mountain?100:rock?13:pine?51:45)*size));
  const seed=hash(item.seed??item.id??`${item.kind}:${x}:${z}:${item.tone||0}`);
  const noise=index=>{
    let n=Math.imul(seed^Math.imul(index+1,0x9e3779b1),0x85ebca6b);
    n=Math.imul(n^(n>>>13),0xc2b2ae35);
    return ((n^(n>>>16))>>>0)/4294967296;
  };
  const angle=item.kind==='biome-mountain'?finite(item.heading):noise(63)*Math.PI*2;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const point=([px,y,pz])=>[x+clamp(px*cos-pz*sin,-.5,.5)*width,y*height,
    z+clamp(px*sin+pz*cos,-.5,.5)*depth];
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

  if(rock){
    const stone=color(item.color,'#919080'),count=distant?5:7+Math.floor(noise(6)*3);
    const shoulder=(noise(7)-.5)*.18;
    const base=ring(0,0,0,.40,.42,count,11,.20);
    const belt=ring(0,.39,0,.49,.46,count,11,.20);
    const crown=ring(shoulder,.85,-.045,.32,.31,count,11,.32);
    for(let i=0;i<count;i++){
      belt[i][1]+=(noise(36+i)-.5)*.25;
      crown[i][1]+=(noise(46+i)-.5)*.18;
    }
    rings([base,belt],tint(stone,.84),60);
    rings([belt,crown],stone,80);
    rings([crown],tint(stone,1.07),100,{top:[shoulder,1,-.08]});
    return true;
  }
  if(mountain){
    // Cross-sections share a winding crest. Both flanks run down to scree
    // aprons, and the secondary summit joins the main peak across a saddle.
    const stone=color(item.color,'#a49c8d'),scree=color(item.color,'#979173'),turf=color(item.color,'#838758');
    const summit=2+Math.floor(noise(7)*4),spur=summit<4?6:2;
    const sections=[-1,-.79,-.56,-.25,0,.24,.55,.80,1],rows=[];
    for(let r=0;r<9;r++){
      const end=r===0||r===8;
      const taper=Math.sin(Math.PI*r/8);
      const peak=end?0:r===summit?1:r===spur?.70+noise(r)*.17:
        (.29+noise(r+8)*.37)*taper;
      const crest=(noise(r+16)-.5)*.28,span=.08+.39*taper;
      const z=(r-4)/8+(end?0:(noise(r+36)-.5)*.052);
      const leftReach=.72+noise(r+308)*.28,rightReach=.71+noise(r+329)*.29;
      rows.push(sections.map((offset,j)=>{
        const t=Math.abs(offset),rough=noise(50+r*9+j);
        const foot=offset<0?-span*leftReach:span*rightReach;
        return [crest*(1-t)+foot*t,j===4?peak:peak*(1-t)*(1-t)*(.70+rough*.56),
          z+(end?0:t*(rough-.5)*.095)];
      }));
    }
    const rowIds=distant?[...new Set([0,2,4,6,8,summit,spur])].sort((a,b)=>a-b):[0,1,2,3,4,5,6,7,8];
    const stride=distant?2:1;
    for(let i=1;i<rowIds.length;i++)for(let j=0;j<8;j+=stride){
      const r=rowIds[i-1],next=rowIds[i];
      const a=rows[r][j],b=rows[next][j],c=rows[next][j+stride],d=rows[r][j+stride];
      const edge=Math.min(j,7-j),shade=edge===0?turf:edge===1?scree:stone;
      const light=.90+noise(180+r*8+j)*.19;
      facet(a,b,c,shade,light);facet(a,c,d,shade,light*.99);
    }
    return true;
  }

  const bark=color('#6b5138'),tone=finite(item.tone)%3;
  const leaf=color(item.color,pine?'#426a46':biome?'#466c43':tone?'#607c45':'#527943');
  const lean=(noise(5)-.5)*.075;
  if(distant){
    rings([ring(0,0,0,.055,.055,4,3),ring(lean,.52,0,.032,.032,4,5)],bark,33);
    if(pine){
      rings([ring(0,.23,0,.46,.44,7,80,.16)],leaf,120,{top:[lean,.81,0]});
      rings([ring(lean,.59,0,.29,.28,7,99,.16)],tint(leaf,1.07),138,{top:[lean*1.7,1,0]});
    }else{
      rings([ring(lean,.41,0,.22,.23,6,180),ring(lean,.65,0,.46,.42,6,191),
        ring(lean,.86,0,.32,.29,6,202)],leaf,180,{top:[lean,1,0],bottom:[lean,.34,0]});
    }
    return true;
  }
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
    const lift=(noise(67)-.5)*.11;
    for(const [index,y,rx,rz,top]of [[0,.24+lift,.47,.45,.69],[1,.44+lift,.37,.35,.85],[2,.65+lift,.24,.23,1]]){
      const cx=lean*(index+1),cz=(noise(index+55)-.5)*.055;
      const lower=ring(cx,y,cz,rx,rz,12,80+index*13,.13).map(([px,py,pz],i)=>
        i%2?[cx+(px-cx)*.76,py+.035,cz+(pz-cz)*.76]:[px,py-.04-noise(i+index*17)*.085,pz]);
      const shoulder=ring(cx,y+(top-y)*.23,cz,rx*.68,rz*.68,12,90+index*11,.16);
      rings([lower,shoulder],tint(leaf,.88+index*.085),120+index*11,{top:[lean*1.7,top,0]});
    }
  }else{
    const lift=.54+noise(66)*.11,topRadius=.18+noise(67)*.08;
    for(const [index,cx,cy,cz,rx,ry,rz]of [[0,-.16-noise(68)*.06,lift,.05,.26+noise(69)*.04,.22,.30],
      [1,.15+noise(70)*.07,lift+.035,-.07,.25+noise(71)*.06,.22,.33],
      [2,lean*1.8,1-topRadius,.015,.27+noise(72)*.07,topRadius,.33+noise(73)*.06]]){
      const salt=180+index*41;
      const levels=[ring(cx,cy-ry*.72,cz,rx*.59,rz*.59,8,salt,.15),
        ring(cx,cy,cz,rx,rz,8,salt+11,.15),ring(cx-.02,cy+ry*.66,cz,rx*.65,rz*.65,8,salt+22,.15)];
      rings(levels,tint(leaf,.91+index*.07),salt,{top:[cx-.025,cy+ry,cz-.018],bottom:[cx,cy-ry*.91,cz]});
    }
  }
  return true;
}
