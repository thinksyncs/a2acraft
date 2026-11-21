// Original room scenery, separate from navigation and interaction state.
export function roomScenery(kind) {
  if (kind === "castle" || kind === "weapon") {
    const image = document.createElement("img");
    image.className = "world-room-scenery world-room-painting";
    image.alt = "";
    image.width = 1600;
    image.height = 640;
    image.src = kind === "castle" ? "/assets/castle-hall.jpg" : "/assets/weapon-workshop.jpg";
    image.draggable = false;
    return image;
  }

  const canvas = document.createElement("canvas");
  canvas.className = "world-room-scenery";
  canvas.width = 384;
  canvas.height = 192;
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  const rect = (color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const wood = kind === "tavern";
  rect(wood ? "#65513c" : "#59635c", 0, 0, 384, 192);
  for (let y = 36; y < 192; y += 18) {
    rect(wood ? "#88704b" : "#7a8374", 0, y, 384, 1);
    for (let x = y % 36 ? 0 : 24; x < 384; x += 48)
      rect("#26352f55", x, y, 1, 18);
  }
  rect("#293c37", 0, 0, 384, 36);
  rect("#b69b60", 0, 31, 384, 3);
  for (const x of [12, 361]) {
    rect("#8c805d", x, 0, 11, 174);
    rect("#b4a979", x, 4, 3, 164);
    rect("#413d30", x - 4, 174, 19, 7);
  }
  function candle(x, y) {
    rect("#2b3026", x - 4, y + 3, 8, 5);
    rect("#f0dfaa", x - 1, y - 6, 3, 10);
    rect("#e5a458", x - 2, y - 12, 5, 6);
    rect("#fff0b5", x, y - 14, 2, 6);
  }
  function table(x, y) {
    rect("#362d24", x - 3, y + 5, 64, 33);
    rect("#513c2b", x, y, 58, 32);
    rect("#a1854c", x + 2, y + 2, 54, 24);
    rect("#c1a564", x + 2, y + 2, 54, 2);
    rect("#4c3728", x + 3, y + 28, 6, 16);
    rect("#4c3728", x + 49, y + 28, 6, 16);
  }
  table(38, 63);
  table(288, 63);
  table(38, 130);
  table(288, 130);
  for (const [x, y] of [
    [65, 72],
    [316, 72],
    [65, 139],
    [316, 139],
  ]) {
    candle(x, y);
    rect("#e6d0a1", x + 10, y + 9, 8, 5);
  }
  rect("#8f7249", 125, 14, 134, 13);
  rect("#c6ac6c", 125, 14, 134, 3);
  for (let x = 135; x < 255; x += 18) {
    rect("#628372", x, 5, 6, 10);
    rect("#d0b977", x + 1, 2, 4, 4);
  }
  return canvas;
}
