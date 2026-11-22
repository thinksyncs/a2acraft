import test from 'node:test';
import assert from 'node:assert/strict';
import {biomeColorField} from '../public/world-biome-blend.js';
import {staticMesh} from '../public/world-3d-mesh.js';
import {drawWorldBiomes} from '../public/village-art.js';

const biomes = {
  step: 100, landColor: '#809050', scenery: [],
  ground: [
    {x:-100, y:-100, width:100, depth:200, color:'#183c20'},
    {x:0, y:-100, width:100, depth:100, color:'#97664a'}
  ]
};
const near = (left, right, tolerance) =>
  left.every((value, i) => Math.abs(value - right[i]) < tolerance);

test('shared boundaries blend continuously and the edge against open ground fades to grass', () => {
  const field = biomeColorField(biomes);
  assert.equal(field, biomeColorField(biomes));
  for (const y of [-98,-70,-51,-20,-2]) {
    assert.ok(near(field.sample(-.00001,y), field.sample(.00001,y), .001));
  }
  assert.ok(near(field.sample(-55,-.00001), field.sample(-55,.00001), .001));
  assert.ok(near(field.sample(100,-45), [128,144,80], .0001));
  assert.ok(!near(field.sample(-50,-53), field.sample(50,-53), 20));
  assert.equal(field.cell(0,0), undefined);
});

test('the atlas samples the shared soil colours and leaves an uncovered cell transparent', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,'OffscreenCanvas');
  let pixels;
  class Canvas {
    getContext() {
      return {
        createImageData: (width,height) => ({width, data:new Uint8ClampedArray(width*height*4)}),
        putImageData(image) { pixels = image; }
      };
    }
  }
  Object.defineProperty(globalThis,'OffscreenCanvas',{configurable:true,value:Canvas});
  t.after(() => previous ? Object.defineProperty(globalThis,'OffscreenCanvas',previous) : delete globalThis.OffscreenCanvas);
  let extent;
  drawWorldBiomes({save(){}, restore(){}, drawImage(canvas,...args){extent=args;}},biomes);
  assert.deepEqual(extent,[-100,-100,200,200]);
  const field = biomeColorField(biomes), cellPixels = pixels.width/2;
  const pixel = (x,y) => pixels.data.slice(4*(y*pixels.width+x),4*(y*pixels.width+x)+4);
  for (const x of [cellPixels-1,cellPixels,cellPixels+1]) {
    const y = Math.floor(cellPixels/2);
    const shade = field.sample(-100+(x+.5)*100/cellPixels,-100+(y+.5)*100/cellPixels);
    assert.ok(near([...pixel(x,y)], [...shade,255], .51));
  }
  assert.equal(pixel(cellPixels+2,cellPixels+2)[3],0);
});

test('eye-view ground vertices sample the atlas field, including both sides of a clipped stream', () => {
  const field = biomeColorField(biomes);
  const stream = {left:-37,right:-29,top:-100,bottom:100};
  const mesh = staticMesh({bounds:{left:-100,right:100,top:-100,bottom:100},
    roads:[],water:[stream],buildings:[],scenery:[],biomes});
  const edges = new Set();
  for (let i=0;i<mesh.length;i+=27) {
    if (Math.abs(mesh[i+1]-.035) > .0001) continue;
    const xs = [];
    for (const offset of [0,9,18]) {
      const k = i+offset, x = mesh[k], y = mesh[k+2];
      assert.ok(near(field.sample(x,y),[6,7,8].map(c => 255*mesh[k+c]),.001));
      xs.push(x);
      edges.add(x);
    }
    assert.ok(Math.max(...xs) <= stream.left || Math.min(...xs) >= stream.right);
  }
  for(const x of [-37,-29,0]) assert.ok(edges.has(x));
});
