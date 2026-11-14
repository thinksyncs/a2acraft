import test from 'node:test';
import assert from 'node:assert/strict';
import {projectOverviewCamera} from '../public/project-world.js';
import {createWorldIsland} from '../public/world-island.js';

test('Island overview includes the entire coast and sea on wide and narrow screens', () => {
  const island = createWorldIsland({regions:[{left:-600,right:1000,top:-800,bottom:740},
    {left:3200,right:4200,top:2400,bottom:3040}]});
  for (const [width,height] of [[1000,640],[390,844],[320,480],[1600,500]]) {
    const camera = projectOverviewCamera(island.seaBounds,width,height);
    assert.ok(Number.isFinite(camera.zoom) && camera.zoom > 0);
    const toScreen = p => ({x:(p.x-camera.x)*camera.zoom+width/2,
      y:(p.y-camera.y)*camera.zoom+height/2});
    for (const p of island.coast) {
      const screen=toScreen(p);
      assert.ok(screen.x>30 && screen.x<width-30, 'sea remains visible at both horizontal shores');
      assert.ok(screen.y>40 && screen.y<height-40, 'sea remains visible at both vertical shores');
    }
  }
});

test('Large worlds can fit below the former zoom floor without changing world positions', () => {
  const regions=[{left:0,right:1000,top:0,bottom:640},
    {left:120000,right:121000,top:80000,bottom:80640}];
  const before=structuredClone(regions), island=createWorldIsland({regions});
  const camera=projectOverviewCamera(island.seaBounds,390,500);
  assert.ok(camera.zoom < .015);
  assert.deepEqual(regions,before);
  assert.ok((island.seaBounds.right-island.seaBounds.left)*camera.zoom<=330+1e-8);
});
