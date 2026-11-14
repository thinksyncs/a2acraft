// The project map paints the continuous world river, not a river per district.
// All wet footprints and bridge decks come from the shared terrain model.
const finiteRect=rect=>rect&&['left','right','top','bottom'].every(key=>Number.isFinite(rect[key]))&&rect.left<rect.right&&rect.top<rect.bottom;
const visible=(rect,view,pad=0)=>rect.right+pad>=view.left&&rect.left-pad<=view.right&&rect.bottom+pad>=view.top&&rect.top-pad<=view.bottom;
const viewport=({left=-Infinity,right=Infinity,top=-Infinity,bottom=Infinity,...rest}={})=>({left,right,top,bottom,...rest});
const fill=(ctx,color,x,y,width,height)=>{ctx.fillStyle=color;ctx.fillRect(x,y,width,height);};
const fillSurface=(ctx,color,rects,pad=0)=>{
 if(!rects.length)return;
 // A single nonzero path paints the union. Individually antialiased fillRect
 // edges can show the overlapping channel stamps at fractional camera scales.
 ctx.beginPath();
 for(const rect of rects)ctx.rect(rect.left-pad,rect.top,rect.right-rect.left+pad*2,rect.bottom-rect.top);
 ctx.fillStyle=color;ctx.fill('nonzero');
};

export function drawWorldHydrology(ctx,hydrology,options={}){
 const view=viewport(options),bank=Math.max(0,Math.min(20,Number(hydrology?.bankWidth)||0));
 const water=(hydrology?.water||[]).filter(rect=>finiteRect(rect)&&visible(rect,view,bank));
 // Paint the entire outside rim first, then all water. Adjacent strips never
 // leave a bank-colored bar inside the channel or at a district boundary.
 if(bank)fillSurface(ctx,'#92a27b',water,bank);
 // Keep the original surface order where river colors blend into the sea.
 for(let start=0;start<water.length;){
  const color=water[start].color||'#599ba0';let end=start+1;
  while(end<water.length&&(water[end].color||'#599ba0')===color)end++;
  fillSurface(ctx,color,water.slice(start,end));start=end;
 }
 if((view.zoom??1)<.15)return;
 for(let index=0;index<water.length;index++){
  const rect=water[index],width=rect.right-rect.left,height=rect.bottom-rect.top;
  if(index%5||width<24||height<3)continue;
  const length=Math.min(14,width*.2),phase=(view.motion?Number(view.time)||0:0)/260;
  const x=rect.left+width*(.3+((index*.13+phase)%1)*.35);
  fill(ctx,'#add7c655',x,(rect.top+rect.bottom)/2,Math.min(length,rect.right-x),1);
 }
}

// Paint after restoring the land clip. Only the shared mouth surface crosses
// that clip; no rim is added that could close the opening to the sea again.
export function drawWorldHydrologyOutlets(ctx,hydrology,options={}){
 const view=viewport(options);
 for(const outlet of hydrology?.outlets||[])for(const rect of outlet.water||[])
  if(finiteRect(rect)&&visible(rect,view))fill(ctx,rect.color||'#315e75',rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);
}

export function drawWorldBridges(ctx,bridges,options={}){
 const view=viewport(options);
 for(const bridge of bridges||[]){
  const {x,y,w,h}=bridge;
  if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0||!visible({left:x,right:x+w,top:y,bottom:y+h},view,12))continue;
  const vertical=bridge.orientation==='vertical';
  fill(ctx,'#4c6353',x,y+4,w,h+4);fill(ctx,'#907549',x,y,w,h);
  if(vertical){
   for(let offset=3;offset<h;offset+=9){
    fill(ctx,'#c4a974',x+2,y+offset,Math.max(1,w-4),Math.min(7,h-offset));
    if(offset+7<h)fill(ctx,'#685539',x+2,y+offset+7,Math.max(1,w-4),Math.min(2,h-offset-7));
   }
   const start=Number.isFinite(bridge.railY)?bridge.railY:y,length=Number.isFinite(bridge.railDepth)?bridge.railDepth:Number.isFinite(bridge.railHeight)?bridge.railHeight:h;
   for(const railX of Array.isArray(bridge.railX)?bridge.railX:[x,x+w])if(Number.isFinite(railX)){
    fill(ctx,'#755b39',railX-2,start,5,length);
    for(let offset=4;offset<=length-8;offset+=23)fill(ctx,'#d1b680',railX-9,start+offset,18,4);
   }
  }else{
   for(let offset=3;offset<w;offset+=9){
    fill(ctx,'#c4a974',x+offset,y+2,Math.min(7,w-offset),Math.max(1,h-4));
    if(offset+7<w)fill(ctx,'#685539',x+offset+7,y+2,Math.min(2,w-offset-7),Math.max(1,h-4));
   }
   const start=Number.isFinite(bridge.railX)?bridge.railX:x,length=Number.isFinite(bridge.railWidth)?bridge.railWidth:w;
   for(const railY of Array.isArray(bridge.railY)?bridge.railY:[y,y+h])if(Number.isFinite(railY)){
    fill(ctx,'#755b39',start,railY-2,length,5);
    for(let offset=4;offset<=length-8;offset+=23)fill(ctx,'#d1b680',start+offset,railY-9,4,18);
   }
  }
 }
}
