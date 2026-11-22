import {finite, clamp, perspective, lookAt, multiply, transform, cameraPose, initialCamera,
  sanitizeCamera, screenRay, rayGround, rayBox, movementTarget, worldBounds} from './world-3d-math.js';
import {staticMesh, naturalTiles, naturalTileMesh, peopleMesh, visiblePeople, buildingShape} from './world-3d-mesh.js';
import {worldDelegateLabels} from './village-delegates.js';
import {ROAD_SURFACE,ROAD_EARTH,ROAD_WEAR} from './road-material.js';
const materialColor=hex=>[1,3,5].map(index=>(parseInt(hex.slice(index,index+2),16)/255).toFixed(5)).join(',');

const VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uViewProjection;
uniform vec3 uEye;
varying vec3 vColor;
varying float vDistance;
varying vec3 vWorldPosition;
varying float vRoadMaterial;
void main() {
  vec3 sunlight = normalize(vec3(-0.35, 0.85, 0.45));
  float light = 0.43 + 0.57 * max(dot(normalize(aNormal), sunlight), 0.0);
  vDistance = distance(aPosition, uEye);
  vWorldPosition = aPosition;
  vRoadMaterial = (1.0 - step(0.025, min(distance(aColor, vec3(0.7961, 0.7176, 0.4824)), distance(aColor, vec3(0.7686, 0.7020, 0.5216)))))
    * step(0.9, aNormal.y) * (1.0 - step(0.7, aPosition.y));
  vColor = mix(aColor,vec3(${materialColor(ROAD_SURFACE)}),vRoadMaterial) * light;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;
const FRAGMENT = `
precision highp float;
varying vec3 vColor;
varying float vDistance;
varying vec3 vWorldPosition;
varying float vRoadMaterial;
uniform float uFogDistance;
float soilHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float soilNoise(vec2 p){
  vec2 cell=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
  return mix(mix(soilHash(cell),soilHash(cell+vec2(1.0,0.0)),u.x),
    mix(soilHash(cell+vec2(0.0,1.0)),soilHash(cell+vec2(1.0,1.0)),u.x),u.y);
}
void main() {
  float fog = smoothstep(uFogDistance * 0.42, uFogDistance, vDistance);
  // Fixed world-space earth grain: no animated noise, added geometry or
  // different terrain in the leader view. Fade detail before it can shimmer.
  float nearby = 1.0 - smoothstep(140.0, 850.0, vDistance);
  vec3 material=vColor;
  if(vRoadMaterial>.5 && nearby>0.0){
    vec2 cell = floor(vWorldPosition.xz * 0.65);
    float grain = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    float worn=soilNoise(vWorldPosition.xz*.085);
    vec3 earth=mix(vec3(${materialColor(ROAD_EARTH)}),vec3(${materialColor(ROAD_WEAR)}),smoothstep(.15,.85,worn));
    vec3 soil=vColor*(earth/vec3(${materialColor(ROAD_SURFACE)}));
    material=mix(vColor,soil,vRoadMaterial*nearby);
    material *= 1.0 + (grain - 0.5) * 0.16 * vRoadMaterial * nearby;
  }
  gl_FragColor = vec4(mix(material, vec3(0.72, 0.83, 0.85), fog * 0.72), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader); throw new Error('3D描画用プログラムを準備できませんでした。');
  }
  return shader;
}
function resources(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX), fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program); throw new Error('この環境では3D描画を開始できません。');
  }
  return {program, groundBuffer: gl.createBuffer(), peopleBuffer: gl.createBuffer(),
    attributes: ['aPosition', 'aNormal', 'aColor'].map(name => gl.getAttribLocation(program, name)),
    viewProjection: gl.getUniformLocation(program, 'uViewProjection'), eye: gl.getUniformLocation(program, 'uEye'),
    fogDistance: gl.getUniformLocation(program, 'uFogDistance')};
}
function staticKey(scene) {
  return JSON.stringify([scene.bounds, scene.island, scene.biomes, scene.hydrology?.outlets, scene.roads, scene.water, scene.scenery, scene.bridges,
    (scene.buildings || []).map(b => [b.id, b.x, b.y, b.width, b.depth, b.height, b.stage, b.color, b.kind])]);
}

// Test the positive support vertex against each homogeneous clip plane. If
// even that corner is outside, the whole tile is outside the eye's frustum.
export function tileInView(tile,m){
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
    const a=m[3]+sign*m[axis],b=m[7]+sign*m[axis+4],c=m[11]+sign*m[axis+8];
    if(a*(a<0?tile.left:tile.right)+b*(b<0?(tile.floor??0):tile.height)+
      c*(c<0?tile.top:tile.bottom)+m[15]+sign*m[axis+12]<0)return false;
  }
  return true;
}
export function groundRanges(mesh){
  const result=[],batch=576; // 192 consecutive triangles, usually one part of the island.
  for(let first=0;first<mesh.length/9;first+=batch){
    const count=Math.min(batch,mesh.length/9-first);
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity,floor=Infinity,height=-Infinity;
    for(let i=first*9;i<(first+count)*9;i+=9){
      left=Math.min(left,mesh[i]);right=Math.max(right,mesh[i]);
      floor=Math.min(floor,mesh[i+1]);height=Math.max(height,mesh[i+1]);
      top=Math.min(top,mesh[i+2]);bottom=Math.max(bottom,mesh[i+2]);
    }
    result.push({first,count,left,right,top,bottom,floor,height});
  }
  return result;
}
export function distantTile(tile,eye,pixels,fov){
  const dx=Math.max(tile.left-eye[0],eye[0]-tile.right,0),dy=Math.max(eye[1]-tile.height,-eye[1],0),
    dz=Math.max(tile.top-eye[2],eye[2]-tile.bottom,0);
  return Math.hypot(dx,dy,dz)>Math.max(700,tile.height*pixels/(48*Math.tan(fov/2)));
}

// Reject only complete character volumes outside the view, before building the
// animated crowd mesh. Actors crossing an edge retain their full geometry.
export function peopleInView(people,matrix){
  return people.filter(person=>{
    const size=clamp(finite(person.scale,1),.35,1.25),points=[];
    for(const x of [-18,18])for(const y of [0,40])for(const z of [-18,18])
      points.push(transform(matrix,[person.x+x*size,y*size,person.y+z*size,1]));
    return ![0,1,2].some(axis=>[-1,1].some(sign=>points.every(point=>sign*point[axis]>point[3])));
  });
}

/**
 * WebGL world renderer. x/y world coordinates map to X/Z; heading 0 faces north.
 * The supplied scene is display data only. Navigation callbacks delegate movement
 * and selection to the existing world; this module never calls an application API.
 */
export function createWorld3D({canvas, onGround = () => {}, onSelect = () => {},
  onFailure = () => {}, onContextChange = () => {}, onCameraChange = () => {}}) {
  let gl = null, gpu = null, supported = false, visible = false, destroyed = false;
  let scene = {buildings: [], people: [], leader: {}, bounds: worldBounds()}, camera = initialCamera();
  let initialized = false, signature = '', ground=[], shownPeople = [];
  let frame = 0, drag = null, viewProjection = null, pose = null, keyboardWorldYaw = null;
  let labelCanvas = null, labelContext = null;
  let tiles=[],tileBytes=0;
  const tileBuffers=new Map(),tileBudget=12*1024*1024;
  let width = Math.max(1, canvas.clientWidth || 640), height = Math.max(1, canvas.clientHeight || 420), pixelRatio = 1;
  const listeners = [];
  const fail = message => queueMicrotask(() => { if (!destroyed) onFailure(message); });
  function listen(type, handler, options) {
    canvas.addEventListener(type, handler, options); listeners.push([type, handler, options]);
  }
  function notifyCamera() { onCameraChange({...camera}); }
  function schedule() {
    if (supported && visible && !destroyed && !frame) frame = requestAnimationFrame(paint);
  }
  function upload(buffer, data, usage) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  }
  function bindBuffer(buffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (let i = 0; i < gpu.attributes.length; i++) {
      gl.enableVertexAttribArray(gpu.attributes[i]);
      gl.vertexAttribPointer(gpu.attributes[i], 3, gl.FLOAT, false, 36, i * 12);
    }
  }
  function renderBuffer(buffer,count){
    if(count){bindBuffer(buffer);gl.drawArrays(gl.TRIANGLES,0,count);}
  }
  function paintGround(){
    bindBuffer(gpu.groundBuffer);
    let first=0,count=0;
    for(const part of ground){
      if(tileInView(part,viewProjection)){
        if(!count)first=part.first;
        count+=part.count;
      }else if(count){
        gl.drawArrays(gl.TRIANGLES,first,count);count=0;
      }
    }
    if(count)gl.drawArrays(gl.TRIANGLES,first,count);
  }
  function releaseTiles(){
    for(const item of tileBuffers.values())gl.deleteBuffer(item.buffer);
    tileBuffers.clear();tileBytes=0;tiles=[];
  }
  function paintNature(){
    for(const tile of tiles){
      if(!tileInView(tile,viewProjection))continue;
      const distant=distantTile(tile,pose.eye,canvas.height,camera.fov);
      const key=tile.index*2+Number(distant);
      let item=tileBuffers.get(key);
      if(item)tileBuffers.delete(key);
      else{
        const data=naturalTileMesh(tile,distant),buffer=gl.createBuffer();
        upload(buffer,data,gl.STATIC_DRAW);
        item={buffer,count:data.length/9,bytes:data.byteLength};tileBytes+=item.bytes;
      }
      tileBuffers.set(key,item);
      renderBuffer(item.buffer,item.count);
    }
    while(tileBytes>tileBudget&&tileBuffers.size>1){
      const oldest=tileBuffers.keys().next().value,entry=tileBuffers.get(oldest);
      gl.deleteBuffer(entry.buffer);tileBytes-=entry.bytes;tileBuffers.delete(oldest);
    }
  }
  function paintLabels() {
    const labels = camera.mode === 'leader' ? [] : worldDelegateLabels(shownPeople, viewProjection, width, height);
    if (!labels.length) { if (labelCanvas) labelCanvas.style.display = 'none'; return; }
    if (!labelCanvas) {
      const parent = canvas.parentElement, owner = canvas.ownerDocument;
      if (!parent || !owner?.createElement) return;
      labelCanvas = owner.createElement('canvas');labelCanvas.className = 'world-3d-labels';
      labelCanvas.setAttribute('aria-hidden','true');
      Object.assign(labelCanvas.style,{position:'absolute',pointerEvents:'none',zIndex:'2',imageRendering:'auto'});
      if (globalThis.getComputedStyle?.(parent).position === 'static') parent.style.position = 'relative';
      parent.append(labelCanvas);labelContext = labelCanvas.getContext('2d');
    }
    if (!labelContext) return;
    Object.assign(labelCanvas.style,{display:'block',left:canvas.offsetLeft+'px',top:canvas.offsetTop+'px',width:width+'px',height:height+'px'});
    if (labelCanvas.width !== canvas.width) labelCanvas.width = canvas.width;
    if (labelCanvas.height !== canvas.height) labelCanvas.height = canvas.height;
    const ctx = labelContext;ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);ctx.clearRect(0,0,width,height);
    ctx.textAlign='left';ctx.textBaseline='middle';
    // In the overview and follow views, shapes and tethers identify each helper's party.
    ctx.save();ctx.setLineDash([3,3]);ctx.lineWidth=1;ctx.globalAlpha=.7;
    for(const label of labels)if(label.owner){ctx.strokeStyle=label.color||'#c5cfb1';ctx.beginPath();ctx.moveTo(label.owner.x,label.owner.y);ctx.lineTo(label.x,label.y+8);ctx.stroke();}
    ctx.restore();
    const occupied=[];
    for (const label of labels.sort((a,b)=>Number(b.delegated)-Number(a.delegated)||a.depth-b.depth)) {
      ctx.font=label.parent?'bold 11px sans-serif':'italic 11px sans-serif';
      let text=label.text;
      const maxText=Math.min(170,width-36);
      while(ctx.measureText(text).width>maxText&&text.length>3)text=text.slice(0,-2)+'…';
      const textWidth=ctx.measureText(text).width+(text?24:18),labelHeight=20;
      let box=null;
      for(const [dx,dy] of [[0,-12],[0,-34],[0,10],[-textWidth/2,-12],[textWidth/2,-12],[0,-56]]){
        const left=clamp(label.x+dx-textWidth/2,2,Math.max(2,width-textWidth-2));
        const top=clamp(label.y+dy-labelHeight/2,2,Math.max(2,height-labelHeight-2));
        const candidate={left,top,right:left+textWidth,bottom:top+labelHeight};
        if(!occupied.some(b=>candidate.left<b.right+3&&candidate.right>b.left-3&&candidate.top<b.bottom+2&&candidate.bottom>b.top-2)){box=candidate;break;}
      }
      if(!box)continue;
      occupied.push(box);
      const cy=box.top+labelHeight/2,iconX=box.left+9;
      const anchor={x:label.x,y:label.y+4},end={x:clamp(label.x,box.left,box.right),y:box.bottom};
      ctx.strokeStyle=label.color||'#c5cfb1';
      ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(anchor.x,anchor.y);ctx.lineTo(end.x,end.y);ctx.stroke();
      ctx.fillStyle=label.parent?'#192b2af2':'#142d2bf2';ctx.fillRect(box.left,box.top,textWidth,labelHeight);
      ctx.lineWidth=label.parent?1.5:1;ctx.setLineDash(label.parent?[]:[3,2]);ctx.strokeRect(box.left,box.top,textWidth,labelHeight);ctx.setLineDash([]);
      ctx.beginPath();
      if(label.parent){ctx.moveTo(iconX-5,cy-5);ctx.lineTo(iconX+5,cy-5);ctx.lineTo(iconX+4,cy+2);ctx.lineTo(iconX,cy+6);ctx.lineTo(iconX-4,cy+2);ctx.closePath();ctx.fillStyle=label.color||'#c5cfb1';ctx.fill();ctx.strokeStyle='#fff0bd';ctx.stroke();}
      else{ctx.moveTo(iconX,cy-5);ctx.lineTo(iconX+5,cy);ctx.lineTo(iconX,cy+5);ctx.lineTo(iconX-5,cy);ctx.closePath();ctx.strokeStyle=label.statusColor||'#e5e5d1';ctx.lineWidth=1.4;ctx.stroke();}
      if(text){ctx.fillStyle=label.parent?'#fff1cc':'#d6e2dc';ctx.fillText(text,box.left+19,cy);}
    }
  }
  function paint() {
    frame = 0;
    if (!supported || !visible || destroyed) return;
    try {
      pose = cameraPose(camera, scene.leader);
      const bounds = worldBounds(scene.bounds), span = Math.hypot(bounds.right - bounds.left, bounds.bottom - bounds.top);
      const far = Math.max(2400, span * 3, camera.distance * 4);
      viewProjection = multiply(perspective(camera.fov, width / height, 0.7, far), lookAt(pose.eye, pose.target));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
      gl.clearColor(0.72, 0.83, 0.85, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(gpu.program); gl.uniformMatrix4fv(gpu.viewProjection, false, viewProjection);
      gl.uniform3fv(gpu.eye, pose.eye); gl.uniform1f(gpu.fogDistance, Math.max(1400, span * 1.3, camera.distance * 2));
      paintGround();
      paintNature();
      shownPeople = peopleInView(visiblePeople(scene, pose.eye, camera.mode),viewProjection);
      const people = peopleMesh(shownPeople);
      upload(gpu.peopleBuffer, people, gl.DYNAMIC_DRAW); renderBuffer(gpu.peopleBuffer, people.length / 9);
      paintLabels();
      canvas.dataset.world3d = camera.mode;
      canvas.dataset.visiblePeople = String(shownPeople.length);
      canvas.dataset.renderer = 'webgl';
    } catch {
      supported = false;
      fail('3D描画を続けられませんでした。2D表示を利用できます。');
    }
  }
  function update(value) {
    scene = {...value, buildings: value?.buildings || [], people: value?.people || [],
      leader: value?.leader || {}, bounds: worldBounds(value?.bounds)};
    if (!initialized) { camera = {...initialCamera(scene.bounds), mode: camera.mode}; initialized = true; }
    // The parent turns the avatar toward each destination. Walking backwards or
    // sideways must retain the keyboard user's world-space viewing direction.
    if (keyboardWorldYaw !== null && camera.mode !== 'overview')
      camera.lookYaw = keyboardWorldYaw - finite(scene.leader.heading);
    if (!supported || destroyed) return;
    const next = scene.staticGeometry ?? staticKey(scene);
    if (next !== signature) {
      releaseTiles();
      tiles=naturalTiles(scene);
      tiles.forEach((tile,index)=>{tile.index=index;});
      const vertices = staticMesh(scene,{separateNature:true});signature=next;ground=groundRanges(vertices);
      upload(gpu.groundBuffer, vertices, gl.STATIC_DRAW);
    }
    schedule();
  }
  function setMode(mode) {
    if (!['overview', 'leader', 'follow'].includes(mode)) return false;
    keyboardWorldYaw = null;
    camera.mode = mode;
    canvas.dataset.world3d = mode;
    schedule(); notifyCamera(); return true;
  }
  function resize(nextWidth, nextHeight, ratio = globalThis.devicePixelRatio || 1) {
    width = Math.max(1, finite(nextWidth, width)); height = Math.max(1, finite(nextHeight, height));
    pixelRatio = clamp(finite(ratio, 1), 1, 2);
    const w = Math.round(width * pixelRatio), h = Math.round(height * pixelRatio);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    schedule();
  }
  function setVisible(value) {
    visible = Boolean(value);
    if (!visible) {
      if (labelCanvas) labelCanvas.style.display = 'none';
      drag = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    } else {
      if (canvas.clientWidth && canvas.clientHeight) resize(canvas.clientWidth, canvas.clientHeight, pixelRatio);
      schedule();
    }
  }
  function zoom(factor) {
    const amount = clamp(finite(factor, 1), 0.25, 4);
    if (camera.mode === 'leader') camera.fov = clamp(camera.fov / amount, Math.PI / 5, Math.PI * 0.48);
    else if (camera.mode === 'follow') camera.followDistance = clamp(camera.followDistance / amount, 35, 260);
    else camera.distance = clamp(camera.distance / amount, 45, 100000);
    schedule(); notifyCamera();
  }
  function reset() {
    keyboardWorldYaw = null;
    camera = {...initialCamera(scene.bounds), mode: camera.mode}; initialized = true;
    schedule(); notifyCamera();
  }
  function focus(point) {
    camera.targetX = finite(point?.x, camera.targetX); camera.targetY = finite(point?.y, camera.targetY);
    schedule(); notifyCamera();
  }
  function setCameraState(value) {
    keyboardWorldYaw = null;
    camera = sanitizeCamera(value, camera); initialized = true;
    schedule(); notifyCamera();
  }
  function pick(clientX, clientY) {
    keyboardWorldYaw = null;
    if (!viewProjection) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ray = screenRay((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2, viewProjection);
    let nearest = Infinity, selection = null;
    for (const building of scene.buildings) {
      const b = buildingShape(building), distance = rayBox(ray, {min: [b.x - b.width / 2, 0, b.y - b.depth / 2], max: [b.x + b.width / 2, b.height * 1.5 + 4, b.y + b.depth / 2]});
      if (building.id != null && distance != null && distance < nearest) {nearest = distance; selection = {type: 'building', id: building.id};}
    }
    for (const person of shownPeople) {
      if (person.hero || person.id == null || person.kind === 'subagent' || person.selectable === false) continue;
      const distance = rayBox(ray, {min: [person.x - 7, 0, person.y - 7], max: [person.x + 7, 27, person.y + 7]});
      if (distance != null && distance < nearest) {nearest = distance; selection = {type: 'person', id: person.id};}
    }
    if (selection) {onSelect(selection); return;}
    const point = rayGround(ray), bounds = worldBounds(scene.bounds);
    if (point && point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom)
      onGround({x: point.x, y: point.y});
  }
  function pointerDown(event) {
    if (!supported || !visible || event.button !== 0 || drag) return;
    canvas.focus({preventScroll: true});
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, pan: event.shiftKey};
    try {canvas.setPointerCapture(event.pointerId);} catch {}
    event.preventDefault();
  }
  function pointerMove(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.lastX, dy = event.clientY - drag.lastY;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
    if (!drag.moved) return;
    drag.lastX = event.clientX; drag.lastY = event.clientY;
    if (camera.mode === 'overview') {
      if (drag.pan) {
        const amount = camera.distance / Math.max(width, height), yaw = camera.yaw;
        camera.targetX -= (dx * Math.cos(yaw) - dy * Math.sin(yaw)) * amount;
        camera.targetY += (dx * Math.sin(yaw) + dy * Math.cos(yaw)) * amount;
      } else {camera.yaw -= dx * 0.006; camera.pitch = clamp(camera.pitch + dy * 0.005, 0.15, 1.48);}
    } else {
      camera.lookYaw -= dx * 0.006;
      if (keyboardWorldYaw !== null) keyboardWorldYaw -= dx * 0.006;
      camera.lookPitch = clamp(camera.lookPitch + dy * 0.005, -1.1, 0.85);
    }
    schedule(); event.preventDefault();
  }
  function pointerUp(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const ended = drag; drag = null;
    try {canvas.releasePointerCapture(event.pointerId);} catch {}
    if (event.type === 'pointerup' && !ended.moved) pick(event.clientX, event.clientY);
    if (ended.moved) notifyCamera();
  }
  function keyDown(event) {
    if (!visible || !supported || event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(key)) {
      const p = cameraPose(camera, scene.leader);
      if (camera.mode !== 'overview') keyboardWorldYaw = p.yaw;
      const point = movementTarget(scene.leader, p.yaw, key === 'w' ? 1 : key === 's' ? -1 : 0,
        key === 'd' ? 1 : key === 'a' ? -1 : 0, event.shiftKey ? 80 : 40);
      const b = worldBounds(scene.bounds);
      onGround({x: clamp(point.x, b.left, b.right), y: clamp(point.y, b.top, b.bottom)});
    } else if (key === '+' || key === '=') zoom(1.2);
    else if (key === '-') zoom(1 / 1.2);
    else if (key === 'home' || key === '0') reset();
    else if (key.startsWith('arrow')) {
      const yaw = key === 'arrowleft' ? -0.13 : key === 'arrowright' ? 0.13 : 0;
      const pitch = key === 'arrowup' ? 0.09 : key === 'arrowdown' ? -0.09 : 0;
      if (camera.mode === 'overview') {camera.yaw -= yaw; camera.pitch = clamp(camera.pitch + pitch, 0.15, 1.48);}
      else {
        camera.lookYaw += yaw;
        if (keyboardWorldYaw !== null) keyboardWorldYaw += yaw;
        camera.lookPitch = clamp(camera.lookPitch + pitch, -1.1, 0.85);
      }
      schedule(); notifyCamera();
    } else return;
    event.preventDefault(); event.stopPropagation();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; visible = false; supported = false;
    if (frame) cancelAnimationFrame(frame);
    for (const entry of listeners) canvas.removeEventListener(...entry);
    if (gl && gpu) {releaseTiles();gl.deleteBuffer(gpu.groundBuffer); gl.deleteBuffer(gpu.peopleBuffer); gl.deleteProgram(gpu.program);}
    labelCanvas?.remove();labelCanvas=null;labelContext=null;
    gpu = null; frame = 0;
  }
  const api = {update, setMode, resize, setVisible, zoom, reset, focus, setCameraState,
    getCameraState: () => ({...camera}), isSupported: () => supported, destroy,
    get supported() {return supported;}};
  try {
    gl = canvas.getContext('webgl', {alpha: false, antialias: true, depth: true, powerPreference: 'low-power'});
    if (!gl) throw new Error('この環境ではWebGLを利用できません。2D表示を利用できます。');
    gpu = resources(gl); supported = true;
    if (canvas.tabIndex < 0) canvas.tabIndex = 0;
    resize(width, height, globalThis.devicePixelRatio || 1);
    listen('pointerdown', pointerDown); listen('pointermove', pointerMove);
    listen('pointerup', pointerUp); listen('pointercancel', pointerUp);
    listen('lostpointercapture', () => {drag = null;});
    listen('wheel', event => {if (visible) {event.preventDefault(); zoom(Math.exp(-clamp(event.deltaY, -160, 160) * 0.002));}}, {passive: false});
    listen('keydown', keyDown);
    listen('contextmenu', event => event.preventDefault());
    listen('webglcontextlost', event => {
      event.preventDefault();supported=false;
      if(frame)cancelAnimationFrame(frame);
      frame=0;drag=null;tileBuffers.clear();tileBytes=0;tiles=[];
      if(labelCanvas)labelCanvas.style.display='none';
      canvas.dataset.renderer='restoring';onContextChange(false);
    });
    listen('webglcontextrestored', () => {
      try {gpu = resources(gl);supported=true;signature='';update(scene);onContextChange(true);}
      catch {supported=false;fail('3D描画を復旧できませんでした。2D表示を利用できます。');}
    });
  } catch (error) {supported = false; fail(error.message);}
  return api;
}
