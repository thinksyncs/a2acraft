import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldIsland,pointInIsland} from '../public/world-island.js';

const area=rect=>(rect.right-rect.left)*(rect.bottom-rect.top);
const village={left:-900,right:1900,top:-900,bottom:1150};

test('the wider world adds substantial usable land instead of expanding only its framing sea',()=>{
  for(const regions of [[village],[{left:0,right:1000,top:0,bottom:640}],
    [{left:0,right:1000,top:0,bottom:640},{left:2500,right:3500,top:0,bottom:640},
      {left:1300,right:2300,top:2400,bottom:3040}]]){
    const before=structuredClone(regions),island=createWorldIsland({regions});
    const landArea=island.landPatches.reduce((sum,rect)=>sum+area(rect),0);
    assert.ok(landArea>area(island.protectedBounds)*8,'the original work area must be a small part of usable land');
    assert.ok(island.bounds.right-island.bounds.left>=14000);
    assert.ok(island.bounds.bottom-island.bounds.top>=11000);
    assert.ok((island.bounds.right-island.bounds.left)/island.gridSize<=128);
    assert.ok((island.bounds.bottom-island.bounds.top)/island.gridSize<=128);
    assert.deepEqual(regions,before,'the world expansion must not relocate work');
  }
});

test('translated and elongated work areas keep one connected landmass with the same 2D and 3D coverage',()=>{
  for(const [dx,dy,width,height] of [[0,0,2800,2050],[1731,-2047,3600,2600],
    [-32000,48000,7000,1000],[45000,-29000,1300,6400],[120000,80000,6000,5000]]){
    const island=createWorldIsland({regions:[{left:dx,right:dx+width,top:dy,bottom:dy+height}]}),
      step=island.gridSize,cols=Math.round((island.bounds.right-island.bounds.left)/step),
      rows=Math.round((island.bounds.bottom-island.bounds.top)/step),land=new Set();
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      const point={x:island.bounds.left+(col+.5)*step,y:island.bounds.top+(row+.5)*step};
      const inside=pointInIsland(point,island);
      assert.equal(inside,pointInIsland(point,{coast:island.coast}),'2D coast and 3D rectangles must cover the same cells');
      if(inside)land.add(col+','+row);
    }
    const seen=new Set(),queue=[[...land][0]];
    for(let index=0;index<queue.length;index++){
      const id=queue[index];if(seen.has(id)||!land.has(id))continue;
      seen.add(id);const [x,y]=id.split(',').map(Number);
      queue.push((x-1)+','+y,(x+1)+','+y,x+','+(y-1),x+','+(y+1));
    }
    assert.equal(seen.size,land.size,'the expanded land must remain traversable without diagonal-only bridges');
  }
});
