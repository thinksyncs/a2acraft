import test from 'node:test';
import assert from 'node:assert/strict';
import {perspective, lookAt, multiply, transform, invert, screenRay, rayGround,
  rayBox, initialCamera, sanitizeCamera, cameraPose, movementTarget} from '../public/world-3d-math.js';
import {staticMesh, peopleMesh, visiblePeople, groundRectangles, waterRectangle} from '../public/world-3d-mesh.js';
import {createWorld3D} from '../public/world-3d.js';

const close = (actual, expected, tolerance = 0.002) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be close to ${expected}`);
const projection = (point, matrix) => {
  const clip = transform(matrix, [...point, 1]);
  return clip.slice(0, 3).map(value => value / clip[3]);
};

test('Perspective has real depth: an equal-width nearer object occupies more screen space', () => {
  const matrix = perspective(Math.PI / 3, 16 / 9, 0.7, 2000);
  const near = projection([5, 0, -10], matrix), far = projection([5, 0, -100], matrix);
  assert.ok(near[0] > far[0] * 9.9);
  assert.ok(near[2] < far[2]);
  close(projection([0, 0, -0.7], matrix)[2], -1);
  close(projection([0, 0, -2000], matrix)[2], 1);
});

test('Ground picking reverses the displayed perspective, including non-square viewport', () => {
  const matrix = multiply(perspective(Math.PI / 3, 1.8, 0.7, 3000), lookAt([140, 180, 280], [40, 0, 70]));
  for (const point of [[40, 0, 70], [110, 0, 20], [-80, 0, -30]]) {
    const ndc = projection(point, matrix), ground = rayGround(screenRay(ndc[0], ndc[1], matrix));
    assert.ok(ground);
    close(ground.x, point[0], 0.02); close(ground.y, point[2], 0.02);
  }
});

test('Sky clicks, singular transforms and parallel rays do not become a movement destination', () => {
  assert.equal(invert(new Float32Array(16)), null);
  assert.equal(screenRay(0, 0, new Float32Array(16)), null);
  assert.equal(rayGround({origin: [0, 20, 0], direction: [0, 1, 0]}), null);
  assert.equal(rayGround({origin: [0, 20, 0], direction: [1, 0, 0]}), null);
});

test('Ray selection respects depth and rejects boxes behind the eye', () => {
  const ray = {origin: [0, 15, 0], direction: [0, 0, -1]};
  const near = rayBox(ray, {min: [-10, 0, -50], max: [10, 30, -30]});
  const far = rayBox(ray, {min: [-10, 0, -150], max: [10, 50, -130]});
  assert.equal(near, 30); assert.equal(far, 130); assert.ok(near < far);
  assert.equal(rayBox(ray, {min: [-10, 0, 30], max: [10, 30, 50]}), null);
  assert.equal(rayBox(ray, {min: [30, 0, -50], max: [50, 30, -30]}), null);
});

test('Leader eye and follow camera track the actual leader while overview remains fixed', () => {
  const state = initialCamera({left: 0, right: 1000, top: 0, bottom: 640});
  const a = {x: 100, y: 200, heading: Math.PI / 2}, b = {x: 180, y: 200, heading: Math.PI / 2};
  const first = cameraPose({...state, mode: 'leader'}, a);
  assert.deepEqual(first.eye, [100, 20, 200]);
  assert.ok(first.target[0] > first.eye[0]); close(first.target[2], 200);
  const followA = cameraPose({...state, mode: 'follow'}, a), followB = cameraPose({...state, mode: 'follow'}, b);
  close(followB.eye[0] - followA.eye[0], 80);
  assert.ok(followA.eye[0] < a.x);
  assert.deepEqual(cameraPose(state, a), cameraPose(state, b));
});

test('Keyboard movement is relative to the view direction, with normalized diagonal speed', () => {
  const leader = {x: 100, y: 100};
  assert.deepEqual(movementTarget(leader, 0, 1, 0), {x: 100, y: 60});
  const east = movementTarget(leader, Math.PI / 2, 1, 0);
  close(east.x, 140); close(east.y, 100);
  const strafe = movementTarget(leader, Math.PI / 2, 0, 1);
  close(strafe.x, 100); close(strafe.y, 140);
  const diagonal = movementTarget(leader, 0, 1, 1);
  close(Math.hypot(diagonal.x - 100, diagonal.y - 100), 40);
});

test('Restored camera values stay finite, bounded and preserve a valid view mode', () => {
  const state = sanitizeCamera({mode: 'leader', yaw: Infinity, distance: -5, pitch: 8, lookPitch: -20, fov: 99});
  assert.equal(state.mode, 'leader'); assert.ok(Object.values(state).filter(x => typeof x === 'number').every(Number.isFinite));
  assert.equal(state.distance, 45); assert.equal(state.pitch, 1.48); assert.equal(state.lookPitch, -1.1);
  assert.ok(state.fov < Math.PI / 2);
  assert.equal(sanitizeCamera({mode: 'unknown'}).mode, 'overview');
});

test('First person hides the leader mesh; crowded scenes are bounded to nearby people', () => {
  const people = Array.from({length: 1000}, (_, i) => ({id: 'person-' + i, x: i, y: 20}));
  people.push({id: 'leader', x: 5, y: 20});
  const scene = {people, leader: {id: 'leader', x: 5, y: 20}};
  const first = visiblePeople(scene, [5, 20, 20], 'leader');
  assert.equal(first.length, 320); assert.ok(!first.some(p => p.id === 'leader'));
  assert.ok(first.some(p => p.id === 'person-21')); assert.ok(!first.some(p => p.id === 'person-999'));
  const follow = visiblePeople(scene, [5, 60, 100], 'follow');
  assert.equal(follow.filter(p => p.id === 'leader').length, 1);
  assert.equal(follow.find(p => p.id === 'leader').hero, true);
  assert.equal(people.length, 1001, 'Renderer must not mutate the source list');
});

test('First-person near-camera people are hidden without culling other views', () => {
  const leader = {id: 'leader', x: 100, y: 100};
  const scene = {leader, people: [leader,
    {id: 'overlapping', x: 100, y: 100}, {id: 'near', x: 100, y: 115.99},
    {id: 'edge', x: 116, y: 100}, {id: 'far', x: 100, y: 140}]};
  const eye = [100, 20, 100];
  assert.deepEqual(visiblePeople(scene, eye, 'leader').map(p => p.id), ['edge', 'far']);
  for (const mode of ['overview', 'follow']) {
    const shown = visiblePeople(scene, eye, mode);
    assert.ok(shown.some(p => p.id === 'overlapping'));
    assert.ok(shown.some(p => p.id === 'near'));
    assert.equal(shown.filter(p => p.id === 'leader').length, 1);
  }
});

test('Town geometry contains finite XYZ surfaces and visible stage-dependent heights', () => {
  const common = {id: 'workshop', x: 0, y: 0, width: 60, depth: 50, height: 50};
  const base = {bounds: {left: -40, right: 40, top: -40, bottom: 40}, people: [], water: []};
  const planned = staticMesh({...base, buildings: [{...common, stage: 'planned'}]});
  const complete = staticMesh({...base, buildings: [{...common, stage: 'finished'}]});
  assert.equal(complete.length % 27, 0); assert.ok(complete.every(Number.isFinite));
  const peak = data => Math.max(...Array.from(data).filter((_, i) => i % 9 === 1));
  assert.ok(peak(complete) > peak(planned));
  const person = peopleMesh([{id: 'leader', x: 20, y: 30, heading: Math.PI / 2, hero: true}]);
  assert.equal(person.length % 27, 0); assert.ok(person.every(Number.isFinite));
});

test('Unavailable WebGL gracefully reports a fallback without touching application state', async () => {
  const errors = [], canvas = {clientWidth: 640, clientHeight: 420, dataset: {}, getContext: () => null};
  const renderer = createWorld3D({canvas, onFailure: error => errors.push(error)});
  assert.equal(renderer.supported, false); assert.equal(renderer.isSupported(), false);
  renderer.update({buildings: [], people: [], leader: {x: 40, y: 20}});
  renderer.setMode('leader'); renderer.setVisible(true); renderer.zoom(1.2);
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(errors.length, 1); assert.match(errors[0], /2D/);
  renderer.destroy(); renderer.destroy();
});

test('Water cuts a hole in terrain, preventing coplanar river stripes at overview distance', () => {
  const bounds = {left: 0, right: 1000, top: 0, bottom: 640};
  const water = [{left: 800, right: 960, top: -200, bottom: 840},
    {left: 730, right: 900, top: 200, bottom: 300}];
  const patches = groundRectangles(bounds, water);
  for (const patch of patches) {
    assert.ok(patch.left < patch.right && patch.top < patch.bottom);
    for (const rect of water)
      assert.ok(patch.right <= rect.left || patch.left >= rect.right || patch.bottom <= rect.top || patch.top >= rect.bottom);
  }
  const area = patches.reduce((sum, p) => sum + (p.right - p.left) * (p.bottom - p.top), 0);
  close(area, 1400 * 1040 - 160 * 1040 - 70 * 100);
});

test('Each water rectangle has only an upward surface with no competing underside', () => {
  const water = [{left: 800, right: 960, top: -200, bottom: 840}];
  const mesh = staticMesh({bounds: {left: 0, right: 1000, top: 0, bottom: 640}, water, buildings: []});
  const vertices = [];
  for (let i = 0; i < mesh.length; i += 9)
    if (Math.abs(mesh[i + 6] - 94 / 255) < 1e-6 && Math.abs(mesh[i + 7] - 158 / 255) < 1e-6 && Math.abs(mesh[i + 8] - 171 / 255) < 1e-6)
      vertices.push(mesh.slice(i, i + 9));
  assert.equal(vertices.length, 6, 'Water should contain exactly two triangles');
  for (const vertex of vertices) {
    close(vertex[1], 0.12);
    close(vertex[3], 0); close(vertex[4], 1); close(vertex[5], 0);
  }
});

test('Thin shared river strips retain exact edges instead of being expanded to camera bounds',()=>{
  const bounds={left:0,right:1000,top:0,bottom:640};
  const strip={left:831,right:927,top:124,bottom:128,color:'#599ba0'};
  assert.deepEqual(waterRectangle(strip),{left:831,right:927,top:124,bottom:128});
  const patches=groundRectangles(bounds,[strip]);
  const area=patches.reduce((sum,p)=>sum+(p.right-p.left)*(p.bottom-p.top),0);
  assert.equal(area,1400*1040-96*4);
  const mesh=staticMesh({bounds,water:[strip],scenery:[]});
  const river=[];
  for(let i=0;i<mesh.length;i+=9)if(Math.abs(mesh[i+6]-89/255)<1e-6&&Math.abs(mesh[i+7]-155/255)<1e-6&&Math.abs(mesh[i+8]-160/255)<1e-6)river.push(mesh.slice(i,i+9));
  assert.equal(river.length,6);
  assert.deepEqual([...new Set(river.map(v=>v[2]))].sort((a,b)=>a-b),[124,128]);
});

test('Explicit shared scenery replaces invented woodland and keeps each landmark at its supplied position',()=>{
  const base={bounds:{left:0,right:1000,top:0,bottom:640},buildings:[],water:[]};
  const empty=staticMesh({...base,scenery:[]});
  assert.ok(staticMesh(base).length>empty.length,'Legacy scenery remains only for scenes without a shared list');
  for(const kind of ['tree','pine','well','field','cottage','rock','signpost']){
    const item={id:'shared-landmark:'+kind,kind,x:150,y:240,size:1,w:92,h:48,tone:1};
    const first=staticMesh({...base,scenery:[item]}).slice(empty.length);
    const moved=staticMesh({...base,scenery:[{...item,x:350,y:440}]}).slice(empty.length);
    assert.ok(first.length>0&&first.every(Number.isFinite));assert.equal(moved.length,first.length);
    for(let i=0;i<first.length;i+=9){close(moved[i]-first[i],200);close(moved[i+2]-first[i+2],200);close(moved[i+1],first[i+1]);}
  }
});

test('Shared facility clearings retain their supplied ground outlines without covering road height',()=>{
  const clearing={kind:'clearing',x:100,y:200,color:'#849a54',points:[[80,180],[120,180],[120,220],[80,220]]};
  const mesh=staticMesh({bounds:{left:0,right:1000,top:0,bottom:640},scenery:[clearing]});
  const vertices=[];
  for(let i=0;i<mesh.length;i+=9)if(Math.abs(mesh[i+6]-132/255)<1e-6&&Math.abs(mesh[i+7]-154/255)<1e-6&&Math.abs(mesh[i+8]-84/255)<1e-6)vertices.push(mesh.slice(i,i+9));
  assert.equal(vertices.length,12);
  for(const vertex of vertices){assert.ok(vertex[1]>.0&&vertex[1]<.36);assert.ok(vertex[4]>.99);}
  for(const [x,y]of clearing.points)assert.ok(vertices.some(vertex=>vertex[0]===x&&vertex[2]===y));
});

test('The timber bridge deck uses the same footprint as the pixel map',()=>{
  const bridge={x:812,y:379,w:144,h:38,railX:810,railWidth:148,railY:[376,416]};
  const mesh=staticMesh({bounds:{left:0,right:1000,top:0,bottom:640},scenery:[],bridges:[bridge]});
  const deck=[];
  for(let i=0;i<mesh.length;i+=9)if(Math.abs(mesh[i+6]-165/255)<1e-6&&Math.abs(mesh[i+7]-138/255)<1e-6&&Math.abs(mesh[i+8]-97/255)<1e-6)deck.push(mesh.slice(i,i+9));
  assert.ok(deck.length>0);
  assert.equal(Math.min(...deck.map(v=>v[0])),812);assert.equal(Math.max(...deck.map(v=>v[0])),956);
  assert.equal(Math.min(...deck.map(v=>v[2])),379);assert.equal(Math.max(...deck.map(v=>v[2])),417);
});

test('changing only the shared river mouth updates the uploaded 3D surface',()=>{
  const uploaded=[];
  const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,
    bufferData(_target,data){uploaded.push(data);}},
    {get:(object,key)=>key in object?object[key]:()=>({})});
  const canvas={clientWidth:640,clientHeight:420,dataset:{},getContext:()=>gl,
    addEventListener(){},removeEventListener(){}};
  const renderer=createWorld3D({canvas});
  const base={bounds:{left:0,right:1000,top:0,bottom:640},roads:[],buildings:[],scenery:[],water:[]};
  const mouth={left:900,right:980,top:200,bottom:280,color:'#123456'};
  renderer.update({...base,hydrology:{outlets:[{water:[mouth]}]}});
  const first=uploaded.at(-1);
  renderer.update({...base,hydrology:{outlets:[{water:[{...mouth,right:1040}]}]}});
  const current=uploaded.at(-1);
  assert.notEqual(current,first,'a new mouth footprint must invalidate the static terrain');
  const mouthXs=[];
  for(let i=0;i<current.length;i+=9)if(Math.abs(current[i+6]-0x12/255)<1e-6&&
    Math.abs(current[i+7]-0x34/255)<1e-6&&Math.abs(current[i+8]-0x56/255)<1e-6)mouthXs.push(current[i]);
  assert.equal(Math.max(...mouthXs),1040,'3D reaches the same new river outlet as 2D');
  renderer.destroy();
});

test('first person shows the characters without floating badges, including after switching from the overview', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis,'requestAnimationFrame');
  const originalCancel = Object.getOwnPropertyDescriptor(globalThis,'cancelAnimationFrame');
  let nextFrame;
  globalThis.requestAnimationFrame = callback => {nextFrame = callback; return 1;};
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    if(original) Object.defineProperty(globalThis,'requestAnimationFrame',original); else delete globalThis.requestAnimationFrame;
    if(originalCancel) Object.defineProperty(globalThis,'cancelAnimationFrame',originalCancel); else delete globalThis.cancelAnimationFrame;
  });
  const people = [
    {id:'talking', kind:'agent', name:'アルト', x:0, y:0, heading:Math.PI, identityFocused:true},
    {id:'parent', kind:'agent', x:0, y:-80, delegationLabel:'主 ニーナ · 補助 1'},
    {id:'helper', kind:'subagent', x:6, y:-75, scale:.58, label:'補 テオ · 調査', parentX:0, parentY:-80},
  ];
  const peopleUploads = [], layers = [];
  let badges = 0;
  const context = new Proxy({measureText:text=>({width:text.length*7}),fillRect(){badges++;}},
    {get:(object,key)=>key in object?object[key]:()=>{}});
  const gl = new Proxy({STATIC_DRAW:1,DYNAMIC_DRAW:2,getShaderParameter:()=>true,getProgramParameter:()=>true,
    bufferData(_target,data,usage){if(usage===2)peopleUploads.push(data);}},
    {get:(object,key)=>key in object?object[key]:()=>({})});
  const canvas={clientWidth:240,clientHeight:130,offsetLeft:0,offsetTop:0,dataset:{},getContext:()=>gl,
    ownerDocument:{createElement:()=>({style:{},setAttribute(){},getContext:()=>context,remove(){}})},
    parentElement:{append(layer){layers.push(layer);}},addEventListener(){},removeEventListener(){}};
  const renderer=createWorld3D({canvas});
  t.after(()=>renderer.destroy());
  renderer.update({bounds:{left:-200,right:200,top:-200,bottom:200},leader:{id:'viewer',x:0,y:40,heading:0},people,
    buildings:[],scenery:[],roads:[],water:[]});
  renderer.setMode('leader');renderer.setVisible(true);nextFrame();
  assert.equal(Number(canvas.dataset.visiblePeople),people.length);
  assert.deepEqual(peopleUploads.at(-1),peopleMesh(people));
  assert.equal(layers.length,0,'both the village and the conversation inset start without a label layer');
  renderer.setMode('overview');nextFrame();
  assert.equal(layers.length,1);assert.equal(layers[0].style.display,'block');
  assert.ok(badges>0,'the overview keeps its party markers');
  const overviewBadges=badges;
  renderer.setCameraState({...renderer.getCameraState(),mode:'leader'});nextFrame();
  assert.equal(layers[0].style.display,'none','a previous overlay is hidden when restoring first person');
  assert.equal(badges,overviewBadges);
  assert.deepEqual(peopleUploads.at(-1),peopleMesh(people));
});
