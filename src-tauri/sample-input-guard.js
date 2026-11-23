// Keep user input and imported documents out of the fictional recording.
for (const name of ['keydown','keyup','keypress','pointerdown','pointerup','mousedown','mouseup','click','dblclick','beforeinput','input','change','submit','paste','cut','drop','dragover','wheel','contextmenu']) {
  window.addEventListener(name, event => {
    if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, {capture:true, passive:false});
}
