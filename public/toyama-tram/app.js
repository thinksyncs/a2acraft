import {clockSeconds, scenarioTimes, lineGeometry, movement, latestObservation} from "./model.js";

const $ = id => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
const STALE_SECONDS = 90;
const CORRIDOR_METRES = 70;
let dataset, archive, geometry, project, selected, midnight = 0;
let samples = [], scheduled = [], scenario = [], start = 0, end = 0, cursor = 0;
let playing = false, lastTick = performance.now(), mode = "recorded", requestNumber = 0;
let liveTimer, previousRender = "", rememberedTrip = null, livePending = false;
const rail = $("rail"), stations = $("stations"), markerLayer = $("markers");

function svg(tag, attrs, parent) {
  const el = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  parent.append(el);
  return el;
}
function clockText(seconds) {
  const t = ((Math.floor(seconds) % 86400) + 86400) % 86400;
  return [Math.floor(t / 3600), Math.floor(t % 3600 / 60), t % 60].map(v => String(v).padStart(2, "0")).join(":");
}
function notice(value) { $("notice").textContent = value; }
function sourceLine() {
  const src = dataset.sources || {};
  const link = document.createElement("a");
  link.href = "https://gtfs-data.jp/search?target_feed=chitetsu%2Achitetsushinaidensha";
  link.textContent = "出典・利用条件";
  const license = src.license ? " · " + src.license : "";
  $("source").replaceChildren(link, document.createTextNode(license));
}
function routeMap() {
  const {points, offsets, at} = geometry;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const scale = Math.min(422 / Math.max(1, x1 - x0), 236 / Math.max(1, y1 - y0));
  project = ([x, y]) => [285 + (x - (x0 + x1) / 2) * scale, 162 - (y - (y0 + y1) / 2) * scale];
  const coords = points.map(project).map(p => p.join(",")).join(" ");
  rail.replaceChildren(); stations.replaceChildren(); markerLayer.replaceChildren();
  for (const [stroke, width] of [["#122e29", 13], ["#659885", 8], ["#c4d9bd", 3]]) {
    svg("polyline", {points:coords,fill:"none",stroke,"stroke-width":width,"stroke-linecap":"round","stroke-linejoin":"round"}, rail);
  }
  dataset.stops.forEach((stop, i) => {
    const [x, y] = project(at(offsets[i]));
    const label = svg("g", {transform:"translate("+x+","+y+")"}, stations);
    svg("circle", {r:8, fill:"#183e35",stroke:"#e2ebd4","stroke-width":3}, label);
    const right = x < 470;
    const endX = right ? 24 : -24;
    svg("path", {d:"M"+(right?9:-9)+" -2 L"+endX+" -12",fill:"none",stroke:"#7fa796","stroke-width":1.5}, label);
    const text = svg("text", {x:endX+(right?5:-5),y:-9,fill:"#f6f9ef","text-anchor":right?"start":"end","font-size":20,"font-weight":650,stroke:"#183e35","stroke-width":5,"paint-order":"stroke"}, label);
    text.textContent = stop.name;
  });
  const obs = svg("g",{id:"obs-marker",display:"none"},markerLayer);
  svg("circle",{r:14,fill:"#75eac7","fill-opacity":".2",stroke:"#98f3d8","stroke-width":2},obs);
  svg("circle",{r:4,fill:"#a0ffe3"},obs);
  const sim = svg("g",{id:"sim-marker",display:"none"},markerLayer);
  svg("path",{d:"M0 0 L-5 -7 H-9 Q-13 -7 -13 -11 V-28 Q-13 -32 -9 -32 H9 Q13 -32 13 -28 V-11 Q13 -7 9 -7 H5Z",fill:"#ffb772",stroke:"#283e31","stroke-width":1.7},sim);
  svg("path",{d:"M-6 -25h12v7H-6z M-5 -14h2m6 0h2",fill:"none",stroke:"#263e31","stroke-width":2,"stroke-linecap":"round"},sim);
}
function classified(sample) {
  const point = geometry.meterPoint(sample.lat, sample.lon);
  return {point, inBounds: geometry.nearest(point).distance <= CORRIDOR_METRES};
}
function preferredTrip() {
  if (!dataset.trips.length) return null;
  if (mode === "live") {
    const now = Date.now()/1000-midnight;
    const active = dataset.trips.filter(t => clockSeconds(t.times[0]) <= now && now <= clockSeconds(t.times.at(-1)));
    return (active.find(t => samples.some(p => p.tripId === t.id)) || active[0] || dataset.trips.find(t=>clockSeconds(t.times[0])>now) || dataset.trips.at(-1)).id;
  }
  if (dataset.trips.some(t => t.id === dataset.replayTripId)) return dataset.replayTripId;
  const sample = samples.find(s => classified(s).inBounds) || samples[0];
  return sample ? sample.tripId : dataset.trips[0].id;
}
function adopt(data, retainTrip = null) {
  if (!Array.isArray(data.stops) || data.stops.length !== 3 || !data.shape?.length || !Array.isArray(data.trips) || !Array.isArray(data.observations) || !Number.isFinite(Date.parse(data.serviceDate+"T00:00:00+09:00"))) throw new Error("データ形式");
  dataset = data;
  midnight = Date.parse(data.serviceDate+"T00:00:00+09:00") / 1000;
  samples = data.observations.slice().sort((a,b)=>a.timestamp-b.timestamp);
  geometry = lineGeometry(data.stops,data.shape);
  routeMap(); sourceLine();
  $("date").textContent = data.serviceDate+" · JST";
  $("trip").replaceChildren();
  const observedTripIds = new Set(samples.map(s=>s.tripId));
  for (const t of data.trips) {
    const option=document.createElement("option");
    option.value=t.id;
    option.textContent = t.times[0].slice(0,-3)+" 発"+(observedTripIds.has(t.id)?"　観測あり":"");
    $("trip").append(option);
  }
  const choice = data.trips.find(t=>t.id===retainTrip)?.id || preferredTrip();
  if (choice) $("trip").value=choice;
  $("trip").disabled = !choice;
  selectTrip();
  if (mode === "recorded" && selected?.id === data.replayTripId) {
    const firstSample = samples.find(sample => sample.tripId === selected.id);
    if (firstSample) {
      cursor = firstSample.timestamp - midnight;
      render(true);
    }
  }
}
function selectTrip() {
  selected = dataset.trips.find(t=>t.id===$("trip").value);
  playing = false;
  previousRender = "";
  if (!selected) {
    scheduled=[]; scenario=[];
    $("table").replaceChildren(); $("clock").textContent="—"; $("scenario-state").textContent="この運行日の対象便はありません。";
    $("obs-time").textContent="—"; $("obs-coords").textContent="—"; $("obs-scope").textContent="—"; $("meas-badge").textContent="該当便なし";
    $("obs-note").textContent="対象便の位置情報はありません。";
    $("sim-marker").setAttribute("display","none"); $("obs-marker").setAttribute("display","none");
    setButtons(); return;
  }
  scheduled=selected.times.map(clockSeconds);
  setScenario();
  cursor=start;
  if(mode==="live") cursor=Date.now()/1000-midnight;
  render(true); setButtons();
}
function setScenario() {
  const delay=Number($("delay").value), duration=Number($("duration").value)/100;
  $("delay-val").textContent=delay+" 秒"; $("duration-val").textContent=duration.toFixed(1)+" 倍";
  if (!selected) return;
  scenario=scenarioTimes(scheduled,delay,duration);
  const observations=samples.filter(s=>s.tripId===selected.id).map(s=>s.timestamp-midnight);
  start=Math.min(scheduled[0], ...observations);
  end=Math.max(scheduled.at(-1),scenario.at(-1),...observations)+5;
  cursor=Math.max(start,Math.min(end,cursor));
  $("seek").min=String(start); $("seek").max=String(Math.ceil(end));
  $("table").replaceChildren();
  dataset.stops.forEach((stop,i)=>{
    const row=document.createElement("tr");
    const name=document.createElement("th"); name.scope="row"; name.textContent=stop.name;
    const sched=document.createElement("td"); sched.textContent=clockText(scheduled[i]);
    const sim=document.createElement("td"); sim.textContent=clockText(scenario[i]);
    row.append(name,sched,sim); $("table").append(row);
  });
}
function setButtons() {
  const interactive = !!selected && mode==="recorded" && !livePending;
  for(const id of ["play","reset","speed","seek"]) $(id).disabled=!interactive;
  $("play").textContent=playing?"Ⅱ  一時停止":"▶  再生";
  $("clock-label").textContent=(mode==="live"?"現在時刻":"再生時刻")+"  JST";
}
function position(id, point) {
  const marker=$(id);
  marker.setAttribute("display","");
  marker.setAttribute("transform","translate("+project(point).join(",")+")");
}
function render(force=false) {
  if (!selected) return;
  const t = Math.floor(cursor);
  if (String(t)===previousRender && !force) return;
  previousRender=String(t);
  $("clock").textContent=clockText(t);
  if (mode==="recorded") $("seek").value=String(t);
  const move=movement(t,scenario,geometry.offsets);
  position("sim-marker",geometry.at(move.offset));
  const dest=dataset.stops[move.stop].name;
  $("scenario-state").textContent= move.phase==="waiting"?dest+"で出発待ち":move.phase==="arrived"?dest+"に到着":dataset.stops[move.stop-1].name+" → "+dest+" を走行中";
  const sample=latestObservation(samples,selected.id,midnight+t);
  if(!sample) {
    const hasSamples=samples.some(s=>s.tripId===selected.id);
    $("obs-marker").setAttribute("display","none"); $("obs-time").textContent="—"; $("obs-coords").textContent="—"; $("obs-scope").textContent="—";
    $("meas-badge").textContent=hasSamples?"観測待ち":"観測なし";
    $("obs-note").textContent=hasSamples?"最初の観測時刻に達すると位置を表示します。":"この便に対応する位置情報は、読み込んだデータにありません。";
  } else {
    const age=midnight+t-sample.timestamp, old=age>STALE_SECONDS;
    const {inBounds,point}=classified(sample);
    $("obs-time").textContent=clockText(sample.timestamp-midnight);
    $("obs-coords").textContent=sample.lat.toFixed(5)+", "+sample.lon.toFixed(5);
    $("obs-scope").textContent=inBounds?"区間内・軌道付近":"表示区間外";
    $("meas-badge").textContent=old?"更新待ち":"観測あり";
    $("obs-note").textContent=(age===0?"この時刻の観測です。":"最終観測から "+age+" 秒経過。")+(old?"90秒を超えたため位置マーカーを非表示にしています。":!inBounds?"区間外の観測は座標のみ表示します。":"緑の丸は受信した座標を示します。");
    if(inBounds && !old) position("obs-marker",point); else $("obs-marker").setAttribute("display","none");
  }
}
function tick(now) {
  if(selected&&mode==="live") { cursor=Date.now()/1000-midnight; render(); }
  if(playing && selected && mode==="recorded") {
    cursor=Math.min(end,cursor+(now-lastTick)/1000*Number($("speed").value));
    render();
    if(cursor>=end) { playing=false; setButtons(); }
  }
  lastTick=now; requestAnimationFrame(tick);
}
async function fetchData(url) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch(url,{signal:controller.signal,cache:"no-store"});
    if(!response.ok) throw new Error(String(response.status));
    return await response.json();
  } finally {clearTimeout(timeout);}
}
function useRecording(message) {
  mode="recorded"; $("recorded").checked=true; clearTimeout(liveTimer);
  livePending=false;
  if (!archive) {
    setButtons();
    notice("保存した記録を読み込めません。ライブを選択すると接続を試せます。");
    return;
  }
  adopt(archive,rememberedTrip);
  notice(message || "保存した時刻表と観測位置を再生します。");
}
async function loadLive(first) {
  const version=++requestNumber;
  if (first) { rememberedTrip=selected?.id; playing=false; livePending=true; setButtons(); notice("ライブデータを取得しています。"); }
  try {
    const data=await fetchData("./api/live");
    if(version!==requestNumber) return;
    if(first || !dataset || data.serviceDate!==dataset.serviceDate || !selected) {
      mode="live"; livePending=false; adopt(data);
    } else {
      const byKey=new Map(samples.map(s=>[s.tripId+"@"+s.timestamp,s]));
      for(const item of data.observations) byKey.set(item.tripId+"@"+item.timestamp,item);
      const lastByTrip=new Map();
      for (const item of byKey.values()) {
        const last=lastByTrip.get(item.tripId);
        if (!last || item.timestamp>last.timestamp) lastByTrip.set(item.tripId,item);
      }
      // Keep the last observation during a prolonged outage, even after routine history expires.
      samples=[...byKey.values()].filter(s=>s.timestamp>=data.feedTimestamp-3600 || lastByTrip.get(s.tripId)===s);
      dataset.feedTimestamp=data.feedTimestamp; render(true);
    }
    const age=Math.floor(Date.now()/1000)-data.feedTimestamp;
    notice((age>STALE_SECONDS?"配信元の更新待ち。":"ライブ接続中。")+"フィードの最終時刻 "+clockText(data.feedTimestamp-midnight)+" JST。");
    liveTimer=setTimeout(()=>loadLive(false),30000);
  } catch {
    if (version!==requestNumber) return;
    if (first && archive) {
      useRecording("ライブデータを取得できないため、保存した記録を表示しています。");
      return;
    }
    const status = first ? "記録とライブデータを取得できません。" : "ライブの更新が中断しました。";
    notice(status + "30 秒後に再接続します。");
    liveTimer=setTimeout(()=>loadLive(first),30000);
  }
}
$("recorded").addEventListener("change",()=>{++requestNumber;useRecording();});
$("live").addEventListener("change",()=>loadLive(true));
$("trip").addEventListener("change",selectTrip);
$("play").addEventListener("click",()=>{
  if(!playing&&cursor>=end) cursor=start;
  playing=!playing; lastTick=performance.now(); render(true); setButtons();
});
$("reset").addEventListener("click",()=>{playing=false;cursor=start;render(true);setButtons();});
$("seek").addEventListener("input",()=>{cursor=Number($("seek").value);lastTick=performance.now(); render(true);});
for(const id of ["delay","duration"]) $(id).addEventListener("input",()=>{setScenario();render(true);});
$("defaults").addEventListener("click",()=>{$("delay").value="0";$("duration").value="100";setScenario();render(true);});
async function init() {
  $("live").disabled=true;
  try {
    archive=await fetchData("./data/replay.json");
    useRecording();
  } catch {
    archive=null;
    $("recorded").disabled=true;
    notice("保存した記録を読み込めませんでした。再読み込みするか、ライブを選択してください。");
  } finally {$("live").disabled=false;}
  requestAnimationFrame(tick);
}
init();
