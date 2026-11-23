// Injected only by the native recorder into a freshly-created fictional village.
(async () => {
  const origin = location.origin;
  const scenario = createSampleWalkScenario();
  const frames = [];
  let stage = 'waiting-for-map';
  const invoke = (action, value) => window.__TAURI__.core.invoke('desktop_request', {action,value});
  const state = (action = 'read', id = '', question = '') => {
    if (action !== 'read') stage = action;
    const scene = scenario.readSampleMap(origin, action, id, question);
    return scene.pending ? null : scene;
  };
  const frame = async (phase, scene) => {
    stage = phase;
    if (!scene || document.hidden) throw Error('Sample is not visible');
    const {bounds,mapBounds,eyeBounds,chatBounds} = scene;
    const signatures = await invoke('sampleFrame', {phase,bounds,mapBounds,eyeBounds,chatBounds});
    frames.push({...scene, ...signatures, phase});
  };
  try {
    await scenario.run({state, frame, frames, stage: value => { stage = value; }});
    await invoke('sampleDone', {verified:true, stage:'complete'});
  } catch {
    await invoke('sampleDone', {verified:false, stage});
  }
})();
