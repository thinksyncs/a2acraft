const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;

// Wheel deltas from a trackpad are fractional CSS pixels. Keep them continuous
// instead of rounding, delaying, or expanding a gesture into queued zoom steps.
export function mapWheelCamera(camera,event,{width,height,baseScale=1,minZoom=.000001,maxZoom=2.5,anchor}={}){
  const unit=event.deltaMode===1?16:event.deltaMode===2?Math.max(1,height):1;
  const dx=finite(event.deltaX)*unit,dy=finite(event.deltaY)*unit;
  const scale=Math.max(.000001,baseScale*camera.zoom);
  if(event.ctrlKey||event.metaKey){
    const zoom=Math.max(minZoom,Math.min(maxZoom,camera.zoom*Math.exp(Math.max(-1.5,Math.min(1.5,-dy*.01)))));
    const nextScale=Math.max(.000001,baseScale*zoom);
    const ax=finite(anchor?.x,width/2)-width/2,ay=finite(anchor?.y,height/2)-height/2;
    return {x:camera.x+ax/scale-ax/nextScale,y:camera.y+ay/scale-ay/nextScale,zoom};
  }
  return {x:camera.x+(dx+(event.shiftKey?dy:0))/scale,
    y:camera.y+(event.shiftKey?0:dy)/scale,zoom:camera.zoom};
}

// Input changes the camera immediately. Only painting is coalesced, so the next
// frame shows the newest camera and no animation backlog survives the gesture.
export function createMapInputFrame(draw,requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id)){
  let pending=null;
  return {
    request(){if(pending===null)pending=requestFrame(()=>{pending=null;draw();});},
    cancel(){if(pending!==null){cancelFrame(pending);pending=null;}},
  };
}
