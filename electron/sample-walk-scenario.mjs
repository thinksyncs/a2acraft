export function createSampleWalkScenario() {
  const clock = {now: () => performance.now(), wait: ms => new Promise(resolve => setTimeout(resolve, ms))};
  // Serialized into the renderer of the isolated sample BrowserWindow. Drive its
  // visible controls, so the transcript, walk and ambient exchange come from the
  // same product code used by a player.
  function readSampleMap(origin, action, residentId, question) {
    const params = new URLSearchParams(location.search);
    if (location.origin !== origin || location.protocol !== 'http:' || location.hostname !== '127.0.0.1' || location.pathname !== '/' ||
        params.get('demo') !== '1' || params.get('village') !== 'sample' || params.get('walk') !== 'resident')
      throw Error('Expected the isolated village sample');
    const find = selector => document.querySelector(selector);
    const bounds = element => {
      const rect = element?.getBoundingClientRect();
      if (!rect) return null;
      const x = Math.ceil(Math.max(0, rect.left)), y = Math.ceil(Math.max(0, rect.top));
      const width = Math.floor(Math.min(innerWidth, rect.right)) - x;
      const height = Math.floor(Math.min(innerHeight, rect.bottom)) - y;
      return width > 0 && height > 0 ? {x, y, width, height} : null;
    };
    const visible = element => Boolean(bounds(element));
    const map = find('#village-canvas'), eye = find('#village-map-3d');
    const start = find('#village-walk-sample'), scene = find('#history-village');
    if (document.hidden) return {pending:'page-hidden'};
    if (!start || !visible(map)) return {pending:'map'};
    if (action === 'prepare-eyes' && !visible(eye)) {
      const toggle = find('#village-leader-toggle');
      if (visible(toggle) && !toggle.disabled) toggle.click();
    }
    if (!visible(eye) || eye.dataset.renderer !== 'webgl' || eye.dataset.world3d !== 'leader') return {pending:'leader-view'};

    const speech = find('#village-speech');
    const arrived = scene.dataset.encounterStatus === 'talking' && visible(speech);
    const chat = find('#town-view.with-resident-chat #resident-conversation');
    const chatId = visible(chat) ? chat.dataset.conversationId : '';
    const panel = find('#chat-view .chat-panel.selected');
    const prompt = find('#prompt'), send = find('#send-btn');
    const inChat = residentId && chatId === residentId && panel?.dataset.select === residentId && visible(prompt);
    switch (action) {
      case 'overview': find('#village-fit').click(); break;
      case 'start': start.click(); break;
      case 'talk':
        if (!arrived || speech.dataset.conversationId !== residentId) throw Error('Resident changed before chat');
        find('#village-speech-chat').click();
        break;
      case 'type':
        if (!inChat || prompt.readOnly || prompt.value) throw Error('Expected a fresh sample chat composer');
        prompt.focus();
        prompt.value = question;
        prompt.dispatchEvent(new Event('input', {bubbles:true}));
        break;
      case 'send':
        if (!inChat || prompt.value !== question || !visible(send) || send.disabled ||
            send.getAttribute('aria-disabled') === 'true') throw Error('Sample chat cannot send');
        send.click();
        break;
      case 'return':
        if (!inChat) throw Error('Resident chat changed before returning to the map');
        chat.querySelector('button').click();
        break;
      case 'nearby': {
        const nearby = find('#village-context');
        if (!visible(nearby) || chatId || arrived) throw Error('Nearby residents unavailable');
        nearby.open = true;
        const choices = Array.from(nearby.querySelectorAll('.village-context-row'));
        const choice = choices.find(button => / · \d+$/.test(button.querySelector('strong')?.textContent)) || choices[0];
        if (!choice) throw Error('No nearby sample resident');
        choice.click();
        break;
      }
      case 'close':
        if (!arrived) throw Error('Nearby resident not reached');
        find('#village-speech-close').click();
        break;
    }
    // Re-read after each action on the next poll. Only evidence from the requested
    // resident's own panel and the turn following our question counts as a reply.
    const messages = inChat ? Array.from(panel.querySelectorAll('.messages .msg')) : [];
    const questionIndex = messages.findLastIndex(node => node.classList.contains('user') &&
      node.querySelector('.msg-text')?.textContent === question);
    const answer = messages[questionIndex + 1];
    const reply = questionIndex >= 0 && answer?.classList.contains('assistant') &&
      panel.getAttribute('aria-busy') === 'false' ? answer.querySelector('.msg-text')?.innerText.trim() : '';
    const notice = find('#village-ambient');
    const ambient = !chatId && !arrived && visible(notice) ? Array.from(notice.querySelectorAll('p'), p => p.innerText.trim()) : [];
    return {
      bounds:{x:0, y:0, width:innerWidth, height:innerHeight},
      mapBounds:bounds(map), eyeBounds:bounds(eye), chatBounds:chatId ? bounds(find('#chat-view')) : null,
      x:Number(scene.dataset.heroX), y:Number(scene.dataset.heroY), leaderView:true,
      following:scene.dataset.cameraFollowing === 'true', arrived, chatId,
      encounterId:arrived ? speech.dataset.conversationId : '',
      resident:arrived ? find('#village-speech-name').textContent : '',
      draft:inChat && prompt.value === question, sent:questionIndex >= 0, reply:reply || '',
      ambient:ambient.length === 2 && ambient.every(Boolean) ? ambient : [],
    };
  }


  async function waitFor(read, ready, duration, timing = clock) {
    const deadline = timing.now() + duration;
    do {
      const state = await read();
      if (state && ready(state)) return state;
      await timing.wait(220);
    } while (timing.now() < deadline);
    return null;
  }

  // A fast compositor must still be able to capture the end of a long walk.
  async function recordWalkingFrames(readMap, captureFrame, {now, wait} = clock) {
    const duration = 75_000, frameLimit = 240;
    const interval = Math.ceil(duration / (frameLimit - 1));
    const deadline = now() + duration;
    for (let index = 0; index < frameLimit; index++) {
      const map = await readMap();
      if (!map) throw Error('Lost the visible sample or leader view during the walk');
      await captureFrame(map.arrived ? 'arrival' : 'walk', map);
      const remaining = deadline - now();
      if (map.arrived || remaining <= 0) return;
      await wait(Math.min(interval, remaining));
    }
  }

  async function recordResidentMeeting(read, capture, residentId, timing = clock) {
    if (!/^village-demo-\d+$/.test(residentId)) throw Error('Expected a fictional sample resident');
    const question = 'この話の次の一歩を、今の仲間と考えたい。';
    const state = (action = 'read') => read(action, residentId, question);

    await state('talk');
    const chat = await waitFor(state, s => s.chatId === residentId, 7_000, timing);
    if (!chat) throw Error('The arrived resident did not open a chat on the map');
    await state('type');
    const draft = await waitFor(state, s => s.chatId === residentId && s.draft, 3_000, timing);
    if (!draft) throw Error('The sample question did not appear in the map composer');
    await capture('chat-input', draft);
    await state('send');
    const reply = await waitFor(state, s => s.chatId === residentId && s.sent && s.reply, 25_000, timing);
    if (!reply) throw Error('No completed reply to the submitted sample question');
    await capture('chat-reply', reply);
    await state('return');
    if (!await waitFor(state, s => !s.chatId && !s.arrived, 7_000, timing)) throw Error('Did not return to the village');

    const speaking = s => !s.chatId && !s.arrived && s.ambient.length === 2;
    let ambient = await waitFor(state, speaking, 8_000, timing);
    if (!ambient) {
      // A quest worker may be stationed away from other residents. Walk to a
      // nearby villager, close the greeting, then leave the party alone.
      await state('nearby');
      if (!await waitFor(state, s => s.arrived, 90_000, timing)) throw Error('Did not reach a nearby villager');
      await state('close');
      ambient = await waitFor(state, speaking, 78_000, timing);
    }
    if (!ambient) throw Error('No spontaneous companion exchange appeared');
    await capture('ambient', ambient);
  }


  async function run({state, frame, frames, stage}) {
      stage('waiting-for-map');
      if (!await waitFor(() => state('prepare-eyes'), () => true, 35_000)) throw Error('Sample map and WebGL leader view did not become visible');
      await state('overview'); await clock.wait(350); await frame('overview', await state());
      await state('start');
      await recordWalkingFrames(state, frame);
      const walked = frames.filter(f => f.phase === 'walk' && f.following);
      const moved = walked.some(f => Math.hypot(f.x - walked[0].x, f.y - walked[0].y) > 12);
      const arrival = frames.at(-1);
      if (!moved || !arrival?.arrived) throw Error('Could not verify movement and arrival at a resident');
      if (new Set(walked.map(f => f.mapImage)).size < 2 || new Set(walked.map(f => f.eyeImage)).size < 2)
        throw Error('A map view remained frozen during the walk');
      await recordResidentMeeting(state, frame, arrival.encounterId);
      if (frames.find(f => f.phase === 'chat-input').chatImage === frames.find(f => f.phase === 'chat-reply').chatImage)
        throw Error('The map chat image remained frozen after sending');
  }

  return {clock, readSampleMap, waitFor, recordWalkingFrames, recordResidentMeeting, run};
}
