// Shared landmarks and terrain for the pixel map and the leader's 3D view.
// Coordinates are world units; this module has no drawing or browser state.
import {VILLAGE_PLACES, VILLAGE_WORLD} from './village-world.js';
export const homesAt = [[91,206],[84,382],[91,555],[208,80],[357,83],[500,84],
  [650,82],[775,82],[955,194],[959,344],[957,508],[197,613]];
export const villageBridge = {x:812,y:379,w:144,h:38,railX:810,railWidth:148,railY:[376,416]};

export function villageRoadRects() {
  const roads = [
    {x:138,y:215,w:676,h:31}, {x:0,y:385,w:816,h:31},
    {x:956,y:385,w:44,h:31}, {x:138,y:555,w:678,h:31},
    {x:295,y:0,w:31,h:588,vertical:true}, {x:615,y:98,w:31,h:490,vertical:true},
    {x:135,y:215,w:24,h:364,vertical:true}, {x:805,y:215,w:24,h:364,vertical:true},
    {x:488,y:570,w:25,h:70,vertical:true},
  ];
  for (const y of [180,350,520]) for (const x of [230,390,550,710])
    roads.push({x:x-8,y:y+5,w:16,h:36,vertical:true});
  return roads;
}

export function villageRiverBanks(top=0,bottom=640) {
  const left=[],right=[];
  for(let y=Math.floor((top-20)/20)*20;y<=Math.ceil((bottom+20)/20)*20;y+=20){
    const x=840+Math.sin(y/105)*21+Math.cos(y/57)*8;
    left.push([x,y]); right.unshift([x+96+Math.sin(y/80)*8,y]);
  }
  return {left,right};
}

export function villageRiverWater(top=0,bottom=640,place={x:0,y:0},step=4) {
  const river=villageRiverBanks(top,bottom),right=[...river.right].reverse();
  const at=(bank,y)=>{
    const index=Math.min(bank.length-2,Math.max(0,Math.floor((y-bank[0][1])/20)));
    const [a,b]=[bank[index],bank[index+1]],t=(y-a[1])/(b[1]-a[1]);
    return a[0]+(b[0]-a[0])*t;
  };
  const result=[];
  const stride=Number.isFinite(step)&&step>0?step:4;
  for(let y=top;y<bottom;y+=stride){
    const end=Math.min(y+stride,bottom),middle=(y+end)/2;
    result.push({left:(place.x||0)+at(river.left,middle),right:(place.x||0)+at(right,middle),
      top:(place.y||0)+y,bottom:(place.y||0)+end,color:'#599ba0'});
  }
  return result;
}

const random = seed => {
  let value=seed>>>0;
  return () => {value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};
};

export function districtScenery(homes=0) {
  const scenery=[{kind:'well',x:489,y:414},
    {kind:'field',x:47,y:93,w:94,h:51,width:94,depth:51,tone:1},
    {kind:'field',x:34,y:266,w:92,h:48,width:92,depth:48,tone:0},
    {kind:'field',x:42,y:442,w:88,h:49,width:88,depth:49,tone:1}];
  for(const [index,[x,y]] of homesAt.slice(0,Math.max(0,Math.min(12,Math.floor(homes)))).entries())
    scenery.push({kind:'cottage',x,y,tone:index});
  // One dedicated scenery sequence is shared by both renderers. Changing grass
  // texture density must never move the landmarks seen from the other view.
  const rng=random(58377);
  for(let i=0;i<45;i++){
    const y=45+i*14,x=i%2?12+rng()*24:965+rng()*30;
    if(y>365&&y<450)continue;
    scenery.push(i%3?{kind:'tree',x,y,size:.65+rng()*.45,tone:i%2}:
      {kind:'pine',x,y,size:.85+rng()*.25});
  }
  for(let i=0;i<30;i++){
    const x=42+i*32,y=23+(i%4)*9;
    if(x>270&&x<348)continue;
    scenery.push(i%3===0?{kind:'pine',x,y:y+26,size:.7+rng()*.4}:
      {kind:'tree',x,y:y+24,size:.65+rng()*.35});
  }
  for(const [x,y,size] of [[164,153,.7],[783,148,.8],[177,331,.68],[780,324,.8],
    [183,496,.75],[778,492,.75],[366,610,.8],[569,618,.9],[761,612,.75]])
    scenery.push({kind:'tree',x,y,size,tone:1});
  for(const [x,y,size] of [[823,75,.8],[816,474,.8],[826,600,.6],[155,601,.7],[938,89,.7]])
    scenery.push({kind:'rock',x,y,size});
  return scenery.map((item,index)=>({...item,id:'terrain:'+index}));
}

export function districtTerrainGeometry(place={x:0,y:0}, {population=0}={}) {
  const ox=place.x||0,oy=place.y||0;
  const point=(x,y)=>({x:x+ox,y:y+oy});
  const roadRects=villageRoadRects();
  const roads=roadRects.map(({x,y,w,h,vertical})=>({width:vertical?w:h,
    points:vertical?[point(x+w/2,y),point(x+w/2,y+h)]:[point(x,y+h/2),point(x+w,y+h/2)]}));
  // The square and timber deck are also walking surfaces, not separate routes.
  roads.push({width:63,points:[point(420,417.5),point(568,417.5)]});
  roads.push({width:villageBridge.h,height:1.5,kind:'bridge',
    points:[point(villageBridge.x,villageBridge.y+villageBridge.h/2),
      point(villageBridge.x+villageBridge.w,villageBridge.y+villageBridge.h/2)]});
  // Existing mesh ground cutting uses rectangles. Fine strips follow the same
  // polygon to within one world unit without flattening it to a wide channel.
  const water=villageRiverWater(0,640,place);
  const scenery=districtScenery(Math.ceil(Math.max(0,population)/8))
    .map(item=>({...item,x:item.x+ox,y:item.y+oy}));
  return {roads,water,scenery,bridge:{...villageBridge,x:villageBridge.x+ox,y:villageBridge.y+oy,
    railX:villageBridge.railX+ox,railY:villageBridge.railY.map(y=>y+oy)}};
}

const scenerySeed = value => {
  let result=2166136261;
  for(const char of String(value))result=Math.imul(result^char.charCodeAt(0),16777619);
  return result>>>0;
};
const overlaps = (a,b) => a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
const sceneryFootprint = item => ({left:item.x-20*item.size,right:item.x+20*item.size,
  top:item.y-(item.kind==='rock'?16:52)*item.size,bottom:item.y+8*item.size});

// One stable world grid supplies both views. Viewport and zoom may cull objects,
// but must never regenerate another forest at the same world coordinates.
export function developmentScenery(bounds, {districts=[],roads=[],facilities=[]}={}) {
  if(!bounds||!['left','right','top','bottom'].every(key=>Number.isFinite(bounds[key]))||
    bounds.left>=bounds.right||bounds.top>=bounds.bottom)return [];
  const clearings=(Array.isArray(districts)?districts:Object.values(districts)).map(place=>({
    left:place.x,right:place.x+1000,top:place.y,bottom:place.y+640}));
  const entrances=facilities.map(place=>({
    left:place.left??place.x-(place.width??180)/2,
    right:place.right??place.x+(place.width??180)/2,
    top:place.top??place.y-(place.depth??150)/2,
    bottom:place.bottom??place.y+(place.depth??150)/2,
  }));
  const segments=roads.flatMap(road=>(road.points||[]).slice(1).map((b,index)=>({
    a:road.points[index],b,radius:Math.max(0,road.width??25)/2,
  }))).filter(({a,b})=>[a?.x,a?.y,b?.x,b?.y].every(Number.isFinite));
  const onRoad = item => segments.some(({a,b,radius})=>{
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((item.x-a.x)*dx+(item.y-a.y)*dy)/length)):0;
    return Math.hypot(item.x-a.x-t*dx,item.y-a.y-t*dy)<radius+20*item.size;
  });
  const result=[],step=180;
  for(let y=Math.floor((bounds.top-80)/step)*step;y<bounds.bottom+80;y+=step)
    for(let x=Math.floor((bounds.left-80)/step)*step;x<bounds.right+80;x+=step){
      const seed=scenerySeed(x+':'+y),items=[];
      if(seed%4===0)for(let n=0;n<3;n++)items.push({kind:'tree',x:x+25+n*18,y:y+45+n*6,size:.9,tone:seed%2,
        id:`landscape:${x}:${y}:${n}`});
      else if(seed%7===0)items.push({kind:'rock',x:x+60,y:y+50,size:.8,id:`landscape:${x}:${y}:rock`});
      for(const item of items){
        const footprint=sceneryFootprint(item);
        if(!overlaps(footprint,bounds)||clearings.some(rect=>overlaps(footprint,rect))||
          entrances.some(rect=>overlaps(footprint,rect))||onRoad(item))continue;
        result.push(item);
      }
    }
  return result.sort((a,b)=>a.y-b.y||a.x-b.x||a.id.localeCompare(b.id));
}

export function villageOutskirtsRoadRects() {
  const tavern=VILLAGE_PLACES.find(place=>place.id==='tavern');
  const castle=VILLAGE_PLACES.find(place=>place.id==='castle');
  const weapon=VILLAGE_PLACES.find(place=>place.id==='weapon');
  return [
    {x:tavern.x-15,y:385,w:-tavern.x+15,h:31},
    {x:956,y:385,w:castle.x-956+15,h:31},
    {x:295,y:weapon.entrance.y-15,w:31,h:-weapon.entrance.y+15,vertical:true},
    {x:295,y:weapon.entrance.y-15,w:weapon.x-295+16,h:31},
    ...VILLAGE_PLACES.map(place=>({x:place.x-16,y:place.y,w:32,h:place.entrance.y-place.y,vertical:true})),
  ];
}

function outskirtsClearings() {
  return VILLAGE_PLACES.map(place=>{
    const rx=place.id==='castle'?189:185,ry=place.id==='castle'?157:125;
    const rng=random(scenerySeed(place.id)),points=[];
    for(let i=0;i<18;i++){
      const angle=i*Math.PI/9,radius=.94+rng()*.14;
      points.push([place.x+Math.cos(angle)*(rx+17)*radius,place.y-38+Math.sin(angle)*(ry+17)*radius]);
    }
    return {kind:'clearing',id:'clearing:'+place.id,seed:scenerySeed(place.id),x:place.x,y:place.y-38,rx,ry,points,color:'#849a54',
      inset:points.map(([x,y])=>[place.x+(x-place.x)*.91,place.y-38+(y-place.y+38)*.9])};
  });
}

export function villageOutskirtsLandmarks() {
  const objects=[
    {kind:'field',x:-230,y:305,w:92,h:46,width:92,depth:46,tone:1},
    {kind:'field',x:-205,y:466,w:104,h:42,width:104,depth:42,tone:0},
    {kind:'cottage',x:-90,y:345,tone:0}, {kind:'well',x:-267,y:480},
    {kind:'signpost',x:-49,y:472,width:39,height:31,depth:4,direction:-1},
    {kind:'signpost',x:1042,y:472,width:39,height:31,depth:4,direction:1},
    {kind:'signpost',x:346,y:1,width:29,height:30,depth:4,direction:0},
  ];
  for(const [x,y,size]of[[-614,269,1.15],[-590,432,.95],[-243,211,1.1],[-178,529,.8],
    [1092,309,.9],[1137,478,1.2],[1699,354,1.15],[1617,509,1.1]])objects.push({kind:'tree',x,y,size,tone:1});
  for(const [x,y,size]of[[1150,205,1.1],[1670,204,1.2],[1263,117,1],[1083,503,.9],
    [211,-203,1.1],[261,-319,1.2],[720,-279,1.1],[706,-82,.95]])objects.push({kind:'pine',x,y,size});
  return objects.map((item,index)=>({...item,id:'outskirts:'+index}));
}

const villageCellSeed=(x,y,salt=0)=>(Math.imul(x,73856093)^Math.imul(y,19349663)^salt)>>>0;
export function villageSurroundingsScenery(bounds=VILLAGE_WORLD) {
  const objects=[],core={left:0,right:1000,top:0,bottom:640};
  for(let gy=Math.floor((bounds.top-64)/54);gy<=Math.ceil((bounds.bottom+64)/54);gy++)
    for(let gx=Math.floor((bounds.left-64)/46);gx<=Math.ceil((bounds.right+64)/46);gx++){
      const seed=villageCellSeed(gx,gy,59137),rng=random(seed);
      const x=gx*46+Math.floor(rng()*28),y=gy*54+Math.floor(rng()*32),chance=rng();
      const bank=840+Math.sin(y/105)*21+Math.cos(y/57)*8;
      if(x>bank-20&&x<bank+119)continue;
      if(x>-470&&x<1490&&y>365&&y<470)continue;
      if(x>265&&x<350&&y>-130&&y<100)continue;
      if(x>280&&x<535&&y>-125&&y<-40)continue;
      if(VILLAGE_PLACES.some(place=>Math.abs(x-place.x)<217&&y>place.y-275&&y<place.y+165))continue;
      if(x>-255&&x<-65&&y>280&&y<540)continue;
      const clearing=Math.sin(x/137)+Math.cos(y/161)>1.15;
      if(chance>(clearing ? .16 : .72))continue;
      const item={x,y,seed,size:.66+rng()*.6,kind:seed%8===0?'rock':seed%8<3?'pine':'tree',
        tone:seed%2,id:`surroundings:${gx}:${gy}`};
      const footprint=sceneryFootprint(item);
      // 2D clears the village rectangle after painting its surroundings. Do not
      // leave a second, half-hidden forest at that edge in either projection.
      if(overlaps(footprint,core)||!overlaps(footprint,bounds))continue;
      objects.push(item);
    }
  return objects.sort((a,b)=>a.y-b.y||a.x-b.x);
}

let cachedVillageOutskirts;
export function villageOutskirtsGeometry() {
  if(cachedVillageOutskirts)return cachedVillageOutskirts;
  const roadRects=villageOutskirtsRoadRects(),clearings=outskirtsClearings(),landmarks=villageOutskirtsLandmarks();
  const roads=roadRects.map(({x,y,w,h,vertical})=>({width:vertical?w:h,
    points:vertical?[{x:x+w/2,y},{x:x+w/2,y:y+h}]:[{x,y:y+h/2},{x:x+w,y:y+h/2}]}));
  return cachedVillageOutskirts={roadRects,roads,clearings,landmarks,
    water:[...villageRiverWater(VILLAGE_WORLD.top,0),...villageRiverWater(640,VILLAGE_WORLD.bottom)],
    scenery:[...clearings,...landmarks,...villageSurroundingsScenery(VILLAGE_WORLD)]};
}
