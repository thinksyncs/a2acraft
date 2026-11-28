// Browser regression check. Run with Playwright and Chromium available.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");

const root = path.resolve(__dirname, "../../public/toyama-tram");
const replay = JSON.parse(fs.readFileSync(path.join(root, "data/replay.json")));
const first = replay.observations[0];
const epochMs = first.timestamp * 1000;
const types = {".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".json":"application/json"};

async function scenario(browser, haveRecording) {
  const page = await browser.newPage();
  let polls = 0;
  let healthy = haveRecording;
  const errors = [];
  page.on("pageerror", err => errors.push(String(err)));
  await page.clock.install({time:new Date(epochMs - 1000)});
  await page.clock.pauseAt(new Date(epochMs));
  await page.route("https://tram.test/**", async route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === "api/live") {
      polls++;
      if (!healthy) return route.fulfill({status:503});
      const timestamp = await page.evaluate(() => Math.floor(Date.now()/1000));
      return route.fulfill({json:{...replay, observations:[{...first,timestamp}], feedTimestamp:timestamp}});
    }
    if (file === "data/replay.json" && !haveRecording) return route.fulfill({status:404});
    await route.fulfill({body:fs.readFileSync(path.join(root,file)), contentType:types[path.extname(file)]});
  });
  // Read the DOM across Playwright's transport, independent of the frozen page clock.
  async function untilText(id, part) {
    for (let n=0;n<100;n++) {
      if ((await page.locator("#"+id).textContent()).includes(part)) return;
      await new Promise(resolve=>setTimeout(resolve,15));
    }
    throw new Error("Expected "+id+" to contain "+part+"; got "+await page.locator("#"+id).textContent());
  }
  await page.goto("https://tram.test/index.html");
  // A programmatic click changes the radio while browser animation time is frozen.
  await page.locator("#live").evaluate(el=>el.click());
  if (!haveRecording) {
    await untilText("notice","再接続");
    healthy = true;
    await page.clock.fastForward(30100);
    await untilText("notice","ライブ接続中");
    assert.equal(polls,2);
    assert(await page.locator("#live").isChecked());
  } else {
    await untilText("notice","ライブ接続中");
    const localChoice = await page.locator("#trip").inputValue();
    assert.equal(localChoice, first.tripId);
    await page.locator("#delay").evaluate(el=>{el.value="90";el.dispatchEvent(new Event("input"));});
    const initialClock = await page.locator("#clock").textContent();
    const initialSample = await page.locator("#obs-time").textContent();
    healthy=false;
    await page.clock.fastForward(31000);
    await untilText("notice","更新が中断");
    assert(await page.locator("#live").isChecked());
    assert.equal(await page.locator("#trip").inputValue(),localChoice);
    assert.equal(await page.locator("#delay").inputValue(),"90");
    assert.notEqual(await page.locator("#clock").textContent(),initialClock);
    assert.equal(await page.locator("#obs-time").textContent(),initialSample);
    await page.clock.fastForward(61000);
    await untilText("meas-badge","更新待ち");
    assert.equal(await page.locator("#obs-marker").getAttribute("display"),"none");
    healthy=true;
    await page.clock.fastForward(31000);
    await untilText("notice","ライブ接続中");
    assert.notEqual(await page.locator("#obs-time").textContent(),initialSample);
    assert.equal(await page.locator("#meas-badge").textContent(),"観測あり");
    assert.equal(await page.locator("#trip").inputValue(),localChoice);
    assert.equal(await page.locator("#delay").inputValue(),"90");
    assert(polls >= 3);
  }
  assert.deepEqual(errors,[]);
  await page.close();
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined});
  try {
    await scenario(browser,true);
    await scenario(browser,false);
    console.log("Live interruption, stale observation, retry, and recovery passed.");
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
