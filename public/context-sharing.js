const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
const svgNS = 'http://www.w3.org/2000/svg';

export function initContextSharing({getChats,getBoard,onBoard,api,demo,available,notify}) {
  const arrows = new Map(), overlay = $('#context-arrows'), dialog = $('#context-share-dialog');
  let drag, shareSource, suppressClick = false, renderedBoard = '';
  const panel = id => document.querySelector('.chat-panel[data-select="' + CSS.escape(id) + '"]');
  function point(rect, towards) {
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2, dx = towards.x - x, dy = towards.y - y;
    const scale = Math.min(rect.width * .32 / Math.max(Math.abs(dx), .01), rect.height * .32 / Math.max(Math.abs(dy), .01));
    return {x:x + dx * scale, y:y + dy * scale};
  }
  function draw(arrow) {
    const source = panel(arrow.sourceId), target = panel(arrow.targetId);
    if (!available() || !source?.getBoundingClientRect().width || (!target && !arrow.pointer)) { arrow.node.hidden = true; arrow.node.style.display = 'none'; return; }
    arrow.node.style.display = '';
    const a = source.getBoundingClientRect(), b = target?.getBoundingClientRect();
    const end = arrow.pointer || {x:b.x + b.width / 2, y:b.y + b.height / 2};
    const start = point(a,end), finish = arrow.pointer || point(b,{x:a.x + a.width / 2,y:a.y + a.height / 2});
    const dx = finish.x - start.x, dy = finish.y - start.y, length = Math.hypot(dx,dy);
    if (length < 8) { arrow.node.style.display = 'none'; return; }
    const ux = dx / length, uy = dy / length, head = Math.min(38,length * .5), shaft = 9, wing = 23;
    const neck = {x:finish.x - ux * head,y:finish.y - uy * head};
    const offset = (p,n) => [p.x - uy * n,p.y + ux * n].join(',');
    arrow.polygon.setAttribute('points',[offset(start,shaft),offset(neck,shaft),offset(neck,wing),offset(finish,0),offset(neck,-wing),offset(neck,-shaft),offset(start,-shaft)].join(' '));
    arrow.label.setAttribute('x',(start.x + finish.x) / 2); arrow.label.setAttribute('y',(start.y + finish.y) / 2 - 17);
  }
  function addArrow(id,sourceId,targetId,pointer) {
    const node = document.createElementNS(svgNS,'g'), polygon = document.createElementNS(svgNS,'polygon'), label = document.createElementNS(svgNS,'text');
    node.classList.add('context-arrow'); node.append(polygon,label); overlay.append(node);
    const arrow = {node,polygon,label,sourceId,targetId,pointer}; arrows.set(id,arrow); draw(arrow); overlay.removeAttribute('hidden'); return arrow;
  }
  function removeArrow(id) { arrows.get(id)?.node.remove(); arrows.delete(id); overlay.toggleAttribute('hidden',arrows.size === 0 || !available()); }
  function cancelDrag() {
    if (drag?.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId);
    drag = null; removeArrow('drag'); document.body.classList.remove('sharing-context');
    document.querySelectorAll('.context-drop-target').forEach(node => node.classList.remove('context-drop-target'));
  }
  async function transfer(sourceId,targetId) {
    if (!available() || sourceId === targetId) return;
    const source = getChats().find(chat => chat.id === sourceId), target = getChats().find(chat => chat.id === targetId);
    if (!source || !target) return;
    const id = crypto.randomUUID(), arrow = addArrow(id,sourceId,targetId);
    arrow.node.classList.add('is-sending'); arrow.label.textContent = '送信中';
    $('#context-transfer-status').hidden = false; $('#context-transfer-status').textContent = source.title + ' → ' + target.title + ' · 共有中';
    try {
      let entry;
      if (demo) {
        const messages = source.messages.filter(message => ['user','assistant'].includes(message.role) && message.text?.trim());
        if (!messages.length) throw Error('共有できる会話内容がありません。');
        const text = messages.map(message => message.role.toUpperCase() + ':\n' + message.text).join('\n\n');
        entry = {id,sourceId,targetId,sourceTitle:source.title,targetTitle:target.title,status:'pending',createdAt:Date.now(),characters:Math.min(text.length,16000),preview:text.slice(-300),truncated:text.length > 16000};
      } else entry = await api('context/transfer',{sourceId,targetId});
      if (!getBoard().some(record => record.id === entry.id)) onBoard([...getBoard(),entry]);
      arrow.label.textContent = '共有済み';
      $('#context-transfer-status').textContent = source.title + ' → ' + target.title + ' · 次の指示に添付します';
      // Give the transfer a visible arrival beat even for a fast local save.
      setTimeout(() => arrow.node.classList.remove('is-sending'),650);
    } catch (error) {
      arrow.node.classList.remove('is-sending'); arrow.label.textContent = '共有失敗'; notify(error.message);
      $('#context-transfer-status').textContent = '共有失敗: ' + error.message;
    } finally {
      setTimeout(() => { removeArrow(id); if (!arrows.size) $('#context-transfer-status').hidden = true; },1600);
      render();
    }
  }
  function render() {
    const entries = getBoard(), pending = entries.filter(entry => entry.status === 'pending');
    $('#context-pending').textContent = pending.length;
    for (const element of document.querySelectorAll('.chat-panel')) {
      const count = pending.filter(entry => entry.targetId === element.dataset.select).length, badge = element.querySelector('.context-count');
      badge.hidden = count === 0; badge.textContent = '共有 ' + count + '件 · 次の指示に添付';
    }
    const signature = JSON.stringify(entries);
    if (signature !== renderedBoard) {
      $('#context-board-list').innerHTML = entries.length ? [...entries].reverse().map(entry => `<article class="context-record"><div><strong>${esc(entry.sourceTitle)} → ${esc(entry.targetTitle)}</strong><span>${entry.status === 'pending' ? '次の指示待ち' : '指示に添付済み'} · ${entry.characters}文字${entry.truncated ? ' · 長い履歴の末尾を共有' : ''}</span><details><summary>内容の末尾を確認</summary><pre>${esc(entry.preview)}</pre></details></div>${entry.status === 'pending' ? `<button class="text-btn" data-context-cancel="${esc(entry.id)}">取消</button>` : ''}</article>`).join('') : '<p class="muted">共有されたコンテキストはありません。</p>';
      renderedBoard = signature;
    }
    overlay.toggleAttribute('hidden',!arrows.size || !available());
    for (const arrow of arrows.values()) draw(arrow);
    if (!available()) { cancelDrag(); $('#context-transfer-status').hidden = true; if (dialog.open) dialog.close(); }
  }
  $('#grid').addEventListener('pointerdown', event => {
    const header = event.target.closest('.panel-head');
    if (!available() || !header || event.target.closest('button') || event.button !== 0 || event.isPrimary === false) return;
    drag = {sourceId:header.closest('.chat-panel').dataset.select,x:event.clientX,y:event.clientY,pointerId:event.pointerId,capture:header,started:false};
    header.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.started && Math.hypot(event.clientX - drag.x,event.clientY - drag.y) < 8) return;
    if (!drag.started) { drag.started = true; addArrow('drag',drag.sourceId,null,{x:event.clientX,y:event.clientY}); document.body.classList.add('sharing-context'); }
    const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('.chat-panel');
    drag.targetId = target?.dataset.select !== drag.sourceId ? target?.dataset.select : null;
    document.querySelectorAll('.context-drop-target').forEach(node => node.classList.remove('context-drop-target'));
    if (drag.targetId) target.classList.add('context-drop-target');
    const arrow = arrows.get('drag'); arrow.targetId = drag.targetId; arrow.pointer = drag.targetId ? null : {x:event.clientX,y:event.clientY}; arrow.label.textContent = 'コンテキスト共有'; draw(arrow);
  });
  document.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const {sourceId,targetId,started} = drag; cancelDrag();
    if (started) { suppressClick = true; setTimeout(() => suppressClick = false,0); if (targetId) transfer(sourceId,targetId); }
  });
  document.addEventListener('pointercancel',cancelDrag);
  document.addEventListener('keydown',event => { if (event.key === 'Escape') cancelDrag(); });
  $('#grid').addEventListener('click',event => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); } },true);
  $('#grid').addEventListener('click',event => {
    const button = event.target.closest('.context-share'); if (!button) return;
    shareSource = button.closest('.chat-panel').dataset.select;
    const source = getChats().find(chat => chat.id === shareSource);
    $('#context-share-source').textContent = '共有元: ' + source.title;
    $('#context-share-target').innerHTML = getChats().filter(chat => chat.id !== shareSource).map(chat => `<option value="${esc(chat.id)}">${esc(chat.title)}</option>`).join('');
    $('#context-share-confirm').disabled = getChats().length < 2; dialog.showModal();
  });
  $('#context-share-confirm').onclick = () => { const target = $('#context-share-target').value; dialog.close(); transfer(shareSource,target); };
  $('#context-board-toggle').onclick = () => { const board = $('#context-board-panel'); board.hidden = !board.hidden; $('#context-board-toggle').setAttribute('aria-expanded',String(!board.hidden)); };
  $('#context-board-list').onclick = async event => {
    const id = event.target.closest('[data-context-cancel]')?.dataset.contextCancel; if (!id) return;
    try { if (!demo) await api('context/cancel',{id}); onBoard(getBoard().filter(entry => entry.id !== id)); }
    catch (error) { notify(error.message); }
  };
  new ResizeObserver(() => { for (const arrow of arrows.values()) draw(arrow); }).observe($('#grid'));
  addEventListener('resize',() => { for (const arrow of arrows.values()) draw(arrow); });
  return {render,transfer};
}
