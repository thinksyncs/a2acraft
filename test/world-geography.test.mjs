import test from 'node:test';
import assert from 'node:assert/strict';
import {affinity,topicEvidence,placeDistricts,worldRoads,visibleWorldRoads,districtRoute,hub} from '../public/world-geography.js';
import {routeLength,avoidBuildings} from '../public/world-travel.js';
import {buildingObstacles,facilities} from '../public/project-buildings.js';

const permutations=items=>items.length?items.flatMap((item,i)=>permutations(items.filter((_,j)=>i!==j)).map(rest=>[item,...rest])):[[]];
const projects=goals=>goals.map((goal,i)=>({id:'p'+i,goal,repositories:[{id:'repo'}],jobs:[]}));
const byId=places=>Object.fromEntries(Object.entries(places).sort(([a],[b])=>a.localeCompare(b)));
const routeObstacles=(layout,items)=>[...buildingObstacles(layout,items),...facilities.map(f=>({left:f.x-70,right:f.x+70,top:f.y-75,bottom:f.y+15}))];
function walkedRoute(route,obstacles){
  assert.ok(route.length>0);
  const walked=[route[0]];
  for(const end of route.slice(1)){
    const start=walked.at(-1),relevant=obstacles.filter(r=>r.right>=Math.min(start.x,end.x)-100&&r.left<=Math.max(start.x,end.x)+100&&r.bottom>=Math.min(start.y,end.y)-100&&r.top<=Math.max(start.y,end.y)+100);
    const segment=avoidBuildings(start,end,relevant);assert.ok(segment.length>0);
    walked.push(...segment.slice(1));
  }
  assert.ok(walked.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  return walked;
}
function assertTopicOrder(layout,items){
  const lengths={};
  const obstacles=routeObstacles(layout,items);
  for(const from of Object.keys(layout)){
    const distances=Object.keys(layout).filter(id=>id!==from).map(to=>{
      const route=districtRoute(from,to,layout),walked=walkedRoute(route,obstacles);
      assert.deepEqual(route[0],hub(layout[from]));assert.deepEqual(route.at(-1),hub(layout[to]));
      assert.deepEqual(walked[0],hub(layout[from]));assert.deepEqual(walked.at(-1),hub(layout[to]));
      const length=routeLength(walked);lengths[from+':'+to]=length;
      return {to,length,score:affinity(layout[from].evidence,layout[to].evidence)};
    });
    for(const a of distances)for(const b of distances)if(a.score>b.score)
      assert.ok(a.length<b.length,`${from}→${a.to} (${a.score}, ${a.length}) must be shorter than ${from}→${b.to} (${b.score}, ${b.length})`);
  }
  return lengths;
}

test('Work and research are closer than folklore in all six registration orders, including obstacle detours',()=>{
  const items=projects(['仕事の業務','研究と論文の比較','お化けの怪談']);
  let baseline;
  for(const order of permutations(items)){
    const layout=placeDistricts(order,[]),lengths=assertTopicOrder(layout,items);
    const result={layout:byId(layout),roads:worldRoads(layout),lengths};
    if(baseline)assert.deepEqual(result,baseline);else baseline=result;
  }
});

test('Five related and unrelated districts retain walking-distance order in all 120 registrations, including a full set of buildings',()=>{
  for(const dense of [false,true]){
    const items=projects(['開発','研究','開発と研究','仕事','暮らし']);
    if(dense)for(const item of items){
      item.repositories=Array.from({length:4},(_,i)=>({id:'r'+i}));
      item.jobs=Array.from({length:8},(_,i)=>({id:'j'+i,title:'Feature '+i,repoId:'r'+i%4,kind:'implement',status:'done'}));
    }
    let baseline;
    for(const order of permutations(items)){
      const layout=placeDistricts(order,[]),lengths=assertTopicOrder(layout,items);
      const result={layout:byId(layout),roads:worldRoads(layout),lengths};
      if(baseline)assert.deepEqual(result,baseline);else baseline=result;
    }
  }
});

test('暮らし has evidence for the life topic while unknown text remains unclassified',()=>{
  const evidence=topicEvidence({id:'daily',goal:'暮らし'},[]);
  assert.deepEqual(evidence,[{topic:'life',source:'goal'}]);
  assert.equal(affinity(evidence,topicEvidence({id:'trip',goal:'家族と旅行'},[])),1);
  assert.deepEqual(topicEvidence({id:'unknown',goal:'未整理'},[]),[]);
});

test('A twelve-district mixed-topic journey keeps stronger connections closer from every source',()=>{
  const themes=['開発','研究','開発と研究','仕事','暮らし'];
  const items=projects(Array.from({length:12},(_,i)=>themes[i%themes.length]));
  let baseline;
  for(const order of [items,[...items].reverse()]){
    const layout=placeDistricts(order,[]),lengths=assertTopicOrder(layout,items);
    if(baseline)assert.deepEqual({layout:byId(layout),lengths},baseline);else baseline={layout:byId(layout),lengths};
  }
});

test('A mixed topic connects its two themes with shorter walks in all registration orders',()=>{
  for(const goals of [['開発','研究','開発と研究'],['仕事の業務','研究と論文の比較','民俗の研究'],['研究','お化けの怪談','怪談を地域史として研究する']]){
    const items=projects(goals);let baseline;
    for(const order of permutations(items)){
      const layout=placeDistricts(order,[]);assertTopicOrder(layout,items);
      if(baseline)assert.deepEqual(byId(layout),baseline);else baseline=byId(layout);
    }
  }
});

test('Road connection and route selection do not depend on saved object insertion order',()=>{
  const items=projects(['開発','研究','開発と研究']),layout=placeDistricts(items,[]),expected=worldRoads(layout);
  for(const order of permutations(Object.entries(layout))){
    const reordered=Object.fromEntries(order);
    assert.deepEqual(worldRoads(reordered),expected);
    for(const a of items)for(const b of items)assert.deepEqual(districtRoute(a.id,b.id,reordered),districtRoute(a.id,b.id,layout));
  }
});

test('Saved coordinates and explicit topic corrections survive additions and pinned positions win over distance preference',()=>{
  const items=projects(['仕事','研究','お化けの怪談']);
  const saved=placeDistricts(items,[]);
  saved.p1={...saved.p1,x:8000,y:-4000,pinned:true,topics:['folklore']};
  const before=JSON.stringify(saved);
  for(const order of permutations([...items,{id:'new',goal:'仕事の業務'}])){
    const next=placeDistricts(order,[],saved);
    for(const item of items){assert.equal(next[item.id].x,saved[item.id].x);assert.equal(next[item.id].y,saved[item.id].y);}
    assert.equal(next.p1.pinned,true);assert.deepEqual(next.p1.evidence,[{topic:'folklore',source:'user'}]);
    assert.equal(JSON.stringify(saved),before);
    assert.ok(districtRoute('p0','p1',next).length>0);
  }
});

test('Unknown topics remain unknown and a full-sized world stays connected without overlapping districts',()=>{
  const items=Array.from({length:100},(_,i)=>({id:'p'+String(i).padStart(3,'0'),goal:i%2?'研究':'未整理'}));
  const layout=placeDistricts(items,[]),values=Object.values(layout),roads=worldRoads(layout);
  assert.equal(roads.length,99);
  assert.deepEqual(layout.p000.evidence,[]);
  for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)
    assert.ok(Math.abs(values[i].x-values[j].x)>1080||Math.abs(values[i].y-values[j].y)>760);
  for(const id of Object.keys(layout))assert.ok(districtRoute('p000',id,layout).length>0);
});

test('Representative 100-district worlds remain finite and traversable within a generous placement budget',()=>{
  const themes=['開発','研究','開発と研究','仕事','暮らし'];
  for(const unknown of [false,true]){
    // Independent measurements of the previous compact placement, with the
    // current vocabulary and the same actual building/facility detours.
    const compact=unknown
      ? {violations:7323,diagonal:48822.716024408146,maximumWalk:67923.97198902801}
      : {violations:22993,diagonal:25063.09982823354,maximumWalk:62355.38610792281};
    const items=projects(Array.from({length:100},(_,i)=>unknown?(i%2?'研究':'未整理'):themes[i%themes.length]));
    const started=performance.now(),layout=placeDistricts(items,[]),elapsed=performance.now()-started;
    assert.ok(elapsed<10000,`100-district placement exceeded 10 seconds: ${elapsed} ms`);
    const values=Object.values(layout),roads=worldRoads(layout),obstacles=routeObstacles(layout,items);
    assert.equal(values.length,100);assert.equal(roads.length,99);
    assert.ok(values.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)
      assert.ok(Math.abs(values[i].x-values[j].x)>1080||Math.abs(values[i].y-values[j].y)>760);
    const width=Math.max(...values.map(p=>p.x))-Math.min(...values.map(p=>p.x))+1000;
    const height=Math.max(...values.map(p=>p.y))-Math.min(...values.map(p=>p.y))+760;
    assert.ok(Math.hypot(width,height)<=compact.diagonal*2,'World expanded beyond twice the compact travel extent');
    const adjacent=Object.fromEntries(Object.keys(layout).map(id=>[id,[]]));
    for(const road of roads){
      for(const [from,to,points] of [[road.from,road.to,road.points],[road.to,road.from,[...road.points].reverse()]]){
        const walked=walkedRoute(points,obstacles),length=routeLength(walked);
        assert.deepEqual(walked[0],hub(layout[from]));assert.deepEqual(walked.at(-1),hub(layout[to]));
        assert.ok(Number.isFinite(length)&&length>0);
        adjacent[from].push({to,length});
      }
    }
    let violations=0,maximumWalk=0;
    for(const from of Object.keys(layout)){
      const distances={[from]:0},queue=[from];
      for(const at of queue)for(const edge of adjacent[at])if(distances[edge.to]===undefined){distances[edge.to]=distances[at]+edge.length;queue.push(edge.to);}
      assert.equal(Object.keys(distances).length,100);
      maximumWalk=Math.max(maximumWalk,...Object.values(distances));
      const ranked=Object.keys(layout).filter(to=>to!==from).map(to=>({length:distances[to],score:affinity(layout[from].evidence,layout[to].evidence)}));
      for(const near of ranked)for(const far of ranked)if(near.score>far.score&&near.length>=far.length)violations++;
    }
    assert.ok(violations<=compact.violations,`Actual walking order regressed beyond compact placement: ${violations}`);
    assert.ok(maximumWalk<=compact.maximumWalk*2,'Longest walk expanded beyond twice the compact travel budget');
    // This checks finite travel and scale, not universal affinity ordering in
    // arbitrary large worlds or a forced relocation of saved districts.
  }
});

test('Both views can retain recorded streets while new routes use the updated topic connections',()=>{
  const layout=placeDistricts(projects(['仕事','研究','怪談']),[]),generated=worldRoads(layout);
  const old={from:'p0',to:'p1',points:[hub(layout.p0),{x:2000,y:3000},hub(layout.p1)]};
  const journeys={old,same:{...old,points:[...old.points].reverse()},current:generated[0],
    removed:{...old,to:'removed'},broken:{...old,points:[null,{x:1,y:2}]} };
  const before=JSON.stringify(journeys),route=districtRoute('p0','p1',layout);
  const visible=visibleWorldRoads(layout,journeys);
  assert.deepEqual(visible.slice(0,generated.length),generated);
  assert.equal(visible.length,generated.length+1);
  assert.deepEqual(visible.at(-1).points,old.points);
  assert.equal(JSON.stringify(journeys),before);
  assert.deepEqual(districtRoute('p0','p1',layout),route);
  assert.deepEqual(visibleWorldRoads(layout,{}),generated);
});
