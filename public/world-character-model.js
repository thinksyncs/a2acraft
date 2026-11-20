import {hash,color,triangle,quad,positioned,box} from './world-model-primitives.js';
import {finite,clamp} from './world-3d-math.js';
import {characterAppearance} from './character-appearance.js';

const clothes=['#b87c51','#587b8c','#856681','#60816b','#af965c','#587c7c'];
const skins=['#e2b88c','#c99366','#a9704e','#efd0ad'];
const hairs=['#44382f','#76503a','#ad8650','#4b4a43','#c1ad88'];
const tint=(shade,factor)=>shade.map(channel=>clamp(channel*factor,0,1));
const octagon=[[-.7,-1],[.7,-1],[1,-.65],[1,.65],[.7,1],[-.7,1],[-1,.65],[-1,-.65]];
const hexagon=[[-.6,-1],[.6,-1],[1,0],[.6,1],[-.6,1],[-1,0]];

// One small sculpted model is used by the overhead map and the 3D camera.
// All poses are cosmetic: the caller owns position, heading and walking state.
export function personMesh(out,person={},hero=false){
  const x=finite(person.x),z=finite(person.y),heading=finite(person.heading);
  const size=clamp(finite(person.scale,1),.35,1.25),gait=clamp(finite(person.gait),-1,1);
  const seed=hash(person.seed??person.conversationId??person.id);
  const cloth=color(person.color,hero?'#b69750':clothes[seed%clothes.length]);
  const skin=color(skins[(seed>>>3)%skins.length]),hair=color(hairs[(seed>>>5)%hairs.length]);
  const leather=color('#55483a'),sole=color('#343c37'),metal=color('#a6b5af'),linen=color('#e6ddbe'),gold=color('#c8a56a');
  const helper=person.kind==='subagent',main=person.kind==='agent';
  const appearance=typeof person.appearance==='string'?person.appearance:person.appearance?.id;
  const role=appearance||characterAppearance(person.role).id;
  const helmet=(hero||main)&&!['mage','priest','martial-artist'].includes(role);
  const point=p=>positioned(p.map(value=>value*size),x,0,z,heading);
  const tri=(a,b,c,shade)=>triangle(out,point(a),point(b),point(c),shade);
  const face=(a,b,c,d,shade)=>quad(out,point(a),point(b),point(c),point(d),shade);
  const block=(px,y,pz,w,h,d,shade)=>{
    const p=point([px,y,pz]);box(out,...p,w*size,h*size,d*size,shade,heading);
  };
  const detail=(px,y,pz,w,h,shade)=>face([px-w/2,y,pz],[px-w/2,y+h,pz],
    [px+w/2,y+h,pz],[px+w/2,y,pz],shade);
  // Internal caps are omitted where body parts overlap. Six-sided limbs and
  // surface details keep a crowded map light without flattening its silhouette.
  function loft(rings,shade,shape=hexagon,caps=0){
    const levels=rings.map(([px,y,pz,rx,rz])=>shape.map(([a,b])=>[px+a*rx,y,pz+b*rz]));
    for(let level=0;level<levels.length-1;level++)for(let index=0;index<shape.length;index++){
      const next=(index+1)%shape.length;
      face(levels[level][index],levels[level+1][index],levels[level+1][next],levels[level][next],shade);
    }
    for(const [level,top]of [[0,false],[levels.length-1,true]]){
      if(!(caps&(top?2:1)))continue;
      for(let index=1;index<shape.length-1;index++){
        if(top)tri(levels[level][0],levels[level][index+1],levels[level][index],shade);
        else tri(levels[level][0],levels[level][index],levels[level][index+1],shade);
      }
    }
  }
  // Boots have a toe, heel and cuff; separate strides keep the silhouette alive.
  for(const side of [-1,1]){
    const stride=side*gait*1.7,lift=Math.max(0,-side*gait)*.9,px=side*2.15;
    loft([[px,lift,1.1+stride,1.65,1.9],[px,lift+.65,-.25+stride,1.8,2.5],
      [px,3.7+lift,stride,1.35,1.35]],leather,hexagon,1);
    block(px,lift,-.4+stride,3.3,.45,4.5,sole);
    loft([[px,3.5+lift,stride,1.25,1.3],[px,6.1,stride*.5,1.25,1.2],[px,9.4,0,1.5,1.35]],tint(cloth,.57));
    loft([[px,3.3+lift,stride,1.5,1.5],[px,4.1+lift,stride,1.5,1.5]],tint(leather,1.3));
  }
  // Hem and fitted waist contrast with broad shoulders; no rectangular torso.
  const robed=helper||role==='mage'||role==='priest';
  loft([[0,robed?5.8:8.3,.25,robed?4.5:4.2,2.65],[0,10.2,0,3.2,2.15],
    [0,14.7,0,4.1,2.45],[0,16.4,.15,3.1,2.1]],cloth,octagon,1);
  loft([[0,9.8,0,3.35,2.25],[0,10.75,0,3.35,2.25]],leather,octagon);
  detail(.4,9.95,-2.62,1.7,.75,gold);
  // Collar, undershirt and a narrow front seam make clothing readable close up.
  face([0,16.7,-1.45],[1.7,16.2,-1.9],[0,13.6,-2.5],[-1.7,16.2,-1.9],linen);
  detail(0,11,-2.6,.45,2.6,tint(cloth,1.25));
  for(const side of [-1,1]){
    const swing=-side*gait*1.8;
    loft([[side*3.8,15.3,.1,1.6,1.8],[side*5.0,12.4,swing*.5,1.35,1.4],
      [side*5.15,9.4,swing,1.05,1.1]],cloth);
    loft([[side*5.15,9.0,swing,1.18,1.2],[side*5.15,10.1,swing,1.18,1.2]],role==='martial-artist'?linen:leather);
    loft([[side*5.15,7.9,swing-.1,.95,1.05],[side*5.15,9.2,swing,1.0,1.1]],skin,hexagon,1);
  }
  // The cloak is a folded volume, not a camera-facing rectangle.
  if(hero||main||helper||role==='mage'||role==='priest'){
    const cape=tint(cloth,.67),hem=helper?6.6:5.7,sway=gait*.7;
    const shoulder=[[-3.5,15.9,1.65],[0,16.3,2.7],[3.5,15.9,1.65]];
    const lower=[[-4.8+sway,hem,3.2],[sway,hem+.7,4.3],[4.8+sway,hem,3.2]];
    for(let index=0;index<2;index++){
      face(shoulder[index],lower[index],lower[index+1],shoulder[index+1],tint(cape,index?.91:1.08));
      face(shoulder[index+1].map((v,i)=>i===2?v-.25:v),lower[index+1].map((v,i)=>i===2?v-.25:v),
        lower[index].map((v,i)=>i===2?v-.25:v),shoulder[index].map((v,i)=>i===2?v-.25:v),cape);
    }
    detail(-2.4,15.3,-2.2,1.15,1.1,gold);
  }
  // An octagonal jaw and brow avoid the old cube face. Forward is local -Z.
  loft([[0,16.4,0,1.25,1.2],[0,18,0,1.45,1.4]],skin);
  loft([[0,17.4,-.1,2.15,2.2],[0,19.0,-.2,3,2.8],[0,22.5,0,3.05,2.75],
    [0,23.7,.25,2.25,2.0]],skin,octagon,3);
  const eye=color('#293b37');
  detail(-1.2,20.35,-3.19,.67,.88,eye);detail(1.2,20.35,-3.19,.67,.88,eye);
  detail(-1.35,21.4,-3.08,1.05,.32,hair);detail(1.35,21.4,-3.08,1.05,.32,hair);
  tri([.45,19.4,-2.95],[-.45,19.4,-2.95],[0,20.55,-3.5],tint(skin,1.05));
  detail(0,18.9,-3.02,1.1,.25,tint(skin,.68));
  if(!helper&&role!=='mage'&&role!=='priest'&&!helmet)
    loft([[0,22.4,.3,3.2,2.95],[0,23.6,.35,2.8,2.7],[.35,24.4,.5,1.5,1.6]],hair,octagon,2);
  // Hair behind the ears keeps north/south and side headings distinct.
  for(const side of [-1,1]){
    const sideHair=[[side*3.13,20.4,-1.2],[side*3.13,23.2,-1.2],[side*3.13,23.2,1.9],[side*3.13,20.4,1.9]];
    face(...(side>0?sideHair:sideHair.reverse()),hair);
  }
  face([-2.45,20.1,2.8],[2.45,20.1,2.8],[2.45,22.6,2.8],[-2.45,22.6,2.8],hair);

  if(helper){
    loft([[0,21.9,.2,3.5,3.3],[0,24.8,.7,2.8,2.7],[.5,27.3,1.1,.25,.3]],cloth,hexagon,2);
    const shade=color(person.statusColor,'#d1cfcb');
    const badge=[[0,32.1,0],[2.8,29.5,0],[0,26.9,0],[-2.8,29.5,0],[0,29.5,1.5],[0,29.5,-1.5]];
    for(const [a,b,c]of [[0,1,4],[1,2,4],[2,3,4],[3,0,4],[1,0,5],[2,1,5],[3,2,5],[0,3,5]])tri(badge[a],badge[b],badge[c],shade);
  }else if(role==='mage'){
    loft([[0,22.6,0,4.7,4.0],[0,23.2,0,4.7,4.0]],tint(cloth,.65),hexagon,3);
    loft([[0,23.15,0,3.6,3.2],[.6,27.4,.6,1.7,1.5],[1.8,30.2,1.0,.3,.3]],cloth,hexagon,2);
    loft([[0,23.3,0,3.6,3.2],[.1,24.0,.1,3.3,2.95]],gold);
    const staffZ=-.5-gait*1.8;
    block(6.4,0,staffZ,1.0,24,1.0,leather);
    loft([[6.4,23.6,staffZ,1.4,1.4],[6.4,25.2,staffZ,1.7,1.7],[6.4,27,staffZ,.5,.5]],color('#99c8be'),hexagon,3);
  }else if(role==='priest'){
    loft([[0,22.1,.35,3.55,3.1],[0,24.5,.55,2.7,2.4],[0,26.2,.7,.8,.8]],linen,hexagon,2);
    for(const side of [-1,1]){
      block(side*2.1,18.1,.0,1,4.5,3.2,linen);
      const stole=[[side*2.5,15.7,-2.0],[side*1.2,15.7,-2.2],[side*1.3,7,-2.7],[side*2.7,7,-2.7]];
      face(...(side<0?stole:stole.reverse()),linen);
    }
    detail(0,12.6,-2.9,.8,1.6,gold);
  }else if(role==='martial-artist'){
    loft([[0,22.1,.1,3.2,3.0],[0,22.9,.1,3.2,3.0]],tint(cloth,.8));
    tri([2.7,22.3,2.5],[4.6,21.0,3.1],[3.9,18.4,2.8],cloth);
    for(const side of [-1,1])block(side*5.1,9.6,-side*gait*1.8,2.35,2.6,2.35,linen);
    detail(-1.0,10.1,-2.9,.8,3,linen);
  }else if(helmet){
    loft([[0,22.2,.1,3.35,3.1],[0,24.2,.1,2.7,2.5],[0,25.1,.1,.9,.9]],metal,hexagon,2);
    block(0,23.7,.3,.85,2.3,3.7,gold);
    for(const side of [-1,1])loft([[side*3.5,14.3,.1,1.6,1.8],[side*3.5,15.7,.1,1.35,1.6]],metal,hexagon,2);
  }
  if(main||hero){
    // A solid heraldic shield and upright pennant distinguish main sessions.
    const rim=[[-7.0,13.0,-1.65],[-3.8,13.0,-1.65],[-3.8,8,-1.9],[-5.4,6.2,-2.1],[-7,8,-1.9]]
      .map(([a,b,c])=>[a,b,c+gait*1.8]);
    for(let i=1;i<rim.length-1;i++)tri(rim[0],rim[i],rim[i+1],gold);
    const back=rim.map(([a,b,c])=>[a,b,c+.65]);
    for(let i=1;i<back.length-1;i++)tri(back[0],back[i+1],back[i],leather);
    for(let i=0;i<rim.length;i++){const next=(i+1)%rim.length;face(rim[i],back[i],back[next],rim[next],gold);}
    const inset=rim.map(([a,b,c])=>[-5.4+(a+5.4)*.75,9.9+(b-9.9)*.82,c-.28]);
    for(let i=1;i<inset.length-1;i++)tri(inset[0],inset[i],inset[i+1],cloth);
    detail(-5.4,8.3,-2.7+gait*1.8,.6,3,linen);
    if(main){
      block(5.8,2,3.2,.75,29,.75,leather);
      face([6.2,30.2,3.2],[10,30.2,3.2],[8.9,27.9,3.2],[6.2,26.9,3.2],cloth);
      face([6.2,26.9,3.4],[8.9,27.9,3.4],[10,30.2,3.4],[6.2,30.2,3.4],cloth);
      block(7.9,29.7,3.15,3.7,.5,.4,gold);
    }
  }
}
