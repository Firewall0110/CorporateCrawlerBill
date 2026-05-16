/**
 * Generate 4 separate stage PNGs - one per level.
 *
 *   stage1.png - Garage (2500x700) - heavily detailed urban industrial
 *   stage2.png - Quad (2500x700) - tech campus park
 *   stage3.png - Lobby (2500x700) - corporate interior
 *   stage4.png - Server Room boss arena (1500x700)
 *
 * Run: npm run stages:gen
 * (installs @napi-rs/canvas --no-save then executes)
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const HEIGHT = 700;
const GROUND_LEVEL = 600;
const PLAY_AREA_TOP = 380;

// ============================================================
// SHARED HELPERS
// ============================================================
function darken(hex, amount) {
  const c = hex.replace('#', '');
  const r = Math.floor(parseInt(c.substring(0, 2), 16) * amount);
  const g = Math.floor(parseInt(c.substring(2, 4), 16) * amount);
  const b = Math.floor(parseInt(c.substring(4, 6), 16) * amount);
  return `rgb(${r},${g},${b})`;
}
function lighten(hex, amount) {
  const c = hex.replace('#', '');
  const r = Math.min(255, parseInt(c.substring(0, 2), 16) + Math.floor(255 * amount));
  const g = Math.min(255, parseInt(c.substring(2, 4), 16) + Math.floor(255 * amount));
  const b = Math.min(255, parseInt(c.substring(4, 6), 16) + Math.floor(255 * amount));
  return `rgb(${r},${g},${b})`;
}
function parseHex(hex) {
  const c = hex.replace('#', '');
  return [parseInt(c.substring(0, 2), 16), parseInt(c.substring(2, 4), 16), parseInt(c.substring(4, 6), 16)];
}
let seed = 42;
function srand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function rseed(s) { seed = s; }

const BAYER = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];

function ditheredGradientStops(ctx, x, y, w, h, stops) {
  const img = ctx.getImageData(x, y, w, h);
  const data = img.data;
  const parsed = stops.map(s => ({ t: s.t, c: parseHex(s.c) }));
  for (let py = 0; py < h; py++) {
    const tn = py / Math.max(1, h - 1);
    let lo = parsed[0], hi = parsed[parsed.length - 1];
    for (let i = 0; i < parsed.length - 1; i++) {
      if (tn >= parsed[i].t && tn <= parsed[i + 1].t) { lo = parsed[i]; hi = parsed[i + 1]; break; }
    }
    const bandT = (tn - lo.t) / Math.max(0.0001, hi.t - lo.t);
    for (let px = 0; px < w; px++) {
      const b = BAYER[py % 4][px % 4] / 16;
      const c = bandT < b ? lo.c : hi.c;
      const i = (py * w + px) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, x, y);
}

// ============================================================
// STAGE 1: GARAGE - high-detail Streets-of-Rage-style urban
// ============================================================
function renderGarageStage(W) {
  const canvas = createCanvas(W, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // === SKY (dusk gradient) ===
  ditheredGradientStops(ctx, 0, 0, W, 240, [
    { t: 0.0, c: '#1a2848' },
    { t: 0.4, c: '#3a3868' },
    { t: 0.75, c: '#a06868' },
    { t: 1.0, c: '#e8a878' }
  ]);

  // Stars
  rseed(101);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 40; i++) {
    const sx = Math.floor(srand() * W);
    const sy = Math.floor(srand() * 80);
    ctx.fillRect(sx, sy, 1, 1);
  }

  // Distant skyline silhouette
  rseed(202);
  ctx.fillStyle = '#1a1828';
  let cx = 0;
  while (cx < W) {
    const bw = 28 + Math.floor(srand() * 80);
    const bh = 40 + Math.floor(srand() * 110);
    ctx.fillRect(cx, 220 - bh, bw, bh);
    ctx.fillStyle = '#d4b66c';
    for (let wy = 220 - bh + 4; wy < 220 - 4; wy += 5) {
      for (let wx = cx + 3; wx < cx + bw - 3; wx += 4) {
        if (srand() > 0.55) ctx.fillRect(wx, wy, 1, 1);
      }
    }
    ctx.fillStyle = '#1a1828';
    cx += bw + 2;
  }

  // === BUILDING ROW - detailed brick buildings with shop fronts ===
  rseed(303);
  let bx = 0;
  while (bx < W) {
    const choice = Math.floor(srand() * 4);
    let bw;
    if (choice === 0) { bw = 200 + Math.floor(srand() * 60); drawBrickShop(ctx, bx, 220, bw, getShopSign()); }
    else if (choice === 1) { bw = 220 + Math.floor(srand() * 60); drawBrickWarehouse(ctx, bx, 200, bw); }
    else if (choice === 2) { bw = 180 + Math.floor(srand() * 40); drawElectronicsShop(ctx, bx, 230, bw); }
    else { bw = 240 + Math.floor(srand() * 60); drawParkingGarageFull(ctx, bx, 180, bw); }
    bx += bw + 4;
  }

  // === RAISED SIDEWALK (back) ===
  // A 24px tall band along the back of play area
  ctx.fillStyle = '#7a7a82';
  ctx.fillRect(0, PLAY_AREA_TOP - 26, W, 26);
  // Curb (darker top edge)
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, PLAY_AREA_TOP - 26, W, 4);
  ctx.fillStyle = '#8a8a92';
  ctx.fillRect(0, PLAY_AREA_TOP - 22, W, 1);
  // Concrete texture - cracks and joints
  ctx.fillStyle = '#5a5a64';
  for (let lx = 0; lx < W; lx += 96) {
    ctx.fillRect(lx, PLAY_AREA_TOP - 22, 1, 22);
  }
  rseed(404);
  ctx.fillStyle = '#5a5a64';
  for (let i = 0; i < 50; i++) {
    ctx.fillRect(Math.floor(srand() * W), PLAY_AREA_TOP - 20 + Math.floor(srand() * 18), 2, 1);
  }

  // === ROAD/STREET SURFACE (front - lower than sidewalk) ===
  // Asphalt
  ctx.fillStyle = '#2a2a2e';
  ctx.fillRect(0, PLAY_AREA_TOP, W, HEIGHT - PLAY_AREA_TOP);
  // Asphalt texture
  rseed(505);
  for (let i = 0; i < 800; i++) {
    const ax = Math.floor(srand() * W);
    const ay = PLAY_AREA_TOP + Math.floor(srand() * (HEIGHT - PLAY_AREA_TOP));
    ctx.fillStyle = srand() > 0.5 ? '#3a3a40' : '#1a1a1e';
    ctx.fillRect(ax, ay, 1, 1);
  }
  // Yellow parking stripes
  for (let i = 0; i < W / 200; i++) {
    const sx = 60 + i * 200;
    ctx.fillStyle = '#e8c200';
    ctx.fillRect(sx, PLAY_AREA_TOP + 80, 6, 80);
    ctx.fillStyle = '#ffd83a';
    ctx.fillRect(sx, PLAY_AREA_TOP + 80, 2, 80);
  }
  // White crosswalk near the end (transition zone)
  for (let i = 0; i < 10; i++) {
    const csx = W - 240 + i * 22;
    ctx.fillStyle = '#d8d8e0';
    ctx.fillRect(csx, PLAY_AREA_TOP + 200, 14, 22);
  }
  // Lane divider down the middle
  for (let i = 0; i < W; i += 60) {
    ctx.fillStyle = '#e8c200';
    ctx.fillRect(i, PLAY_AREA_TOP + 250, 30, 4);
  }
  // Manhole covers
  drawManhole(ctx, 240, PLAY_AREA_TOP + 140);
  drawManhole(ctx, 950, PLAY_AREA_TOP + 220);
  drawManhole(ctx, 1680, PLAY_AREA_TOP + 180);
  drawManhole(ctx, 2280, PLAY_AREA_TOP + 200);

  // Oil stains
  rseed(606);
  for (let i = 0; i < 8; i++) {
    drawOilStain(ctx, Math.floor(srand() * W), PLAY_AREA_TOP + 100 + Math.floor(srand() * 150), srand() > 0.5 ? 1 : -1);
  }

  // === FOREGROUND PROPS - cars, hydrants, lampposts, etc. ===
  // Cars (parked along curb)
  drawCar(ctx, 120, PLAY_AREA_TOP + 30, '#cc3340', 'sedan');
  drawCar(ctx, 320, PLAY_AREA_TOP + 30, '#ccaa33', 'taxi');
  drawCar(ctx, 540, PLAY_AREA_TOP + 30, '#dddddd', 'truck');
  drawCar(ctx, 760, PLAY_AREA_TOP + 30, '#3344cc', 'sedan');
  drawCar(ctx, 1020, PLAY_AREA_TOP + 30, '#2a8a3a', 'sedan');
  drawCar(ctx, 1240, PLAY_AREA_TOP + 30, '#883344', 'truck');
  drawCar(ctx, 1480, PLAY_AREA_TOP + 30, '#aa6633', 'taxi');
  drawCar(ctx, 1740, PLAY_AREA_TOP + 30, '#cc3340', 'sedan');
  drawCar(ctx, 1980, PLAY_AREA_TOP + 30, '#dddddd', 'sedan');
  drawCar(ctx, 2200, PLAY_AREA_TOP + 30, '#3a3a44', 'sedan');

  // Streetlights (foreground depth)
  drawStreetlight(ctx, 80, PLAY_AREA_TOP - 110);
  drawStreetlight(ctx, 480, PLAY_AREA_TOP - 110);
  drawStreetlight(ctx, 880, PLAY_AREA_TOP - 110);
  drawStreetlight(ctx, 1280, PLAY_AREA_TOP - 110);
  drawStreetlight(ctx, 1680, PLAY_AREA_TOP - 110);
  drawStreetlight(ctx, 2080, PLAY_AREA_TOP - 110);

  // Fire hydrants on sidewalk
  drawHydrant(ctx, 200, PLAY_AREA_TOP - 28);
  drawHydrant(ctx, 760, PLAY_AREA_TOP - 28);
  drawHydrant(ctx, 1340, PLAY_AREA_TOP - 28);
  drawHydrant(ctx, 1940, PLAY_AREA_TOP - 28);

  // Trash cans, dumpsters
  drawTrashCan(ctx, 410, PLAY_AREA_TOP - 32);
  drawDumpster(ctx, 1140, PLAY_AREA_TOP - 38);
  drawTrashCan(ctx, 1620, PLAY_AREA_TOP - 32);
  drawTrashCan(ctx, 2120, PLAY_AREA_TOP - 32);

  // No-parking signs
  drawSignPost(ctx, 660, PLAY_AREA_TOP - 80, 'NO\nPARK', '#ffffff', '#cc1a1a');
  drawSignPost(ctx, 1450, PLAY_AREA_TOP - 80, 'STOP', '#ffffff', '#cc1a1a');
  drawSignPost(ctx, 1820, PLAY_AREA_TOP - 80, 'ONE\nWAY', '#1a1a24', '#ffeb3b');

  // Floor edge highlight (top of sidewalk)
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(0, PLAY_AREA_TOP, W, 1);

  return canvas;
}

function getShopSign() {
  const signs = [
    { text: 'CHECKS CASHED', color: '#ffd14a' },
    { text: 'MONEY ORDERS', color: '#ffd14a' },
    { text: 'PAWN SHOP', color: '#cc5511' },
    { text: 'LIQUOR', color: '#cc1144' },
    { text: 'OPEN 24HR', color: '#1abc4a' },
    { text: 'TATTOO', color: '#aa44cc' },
    { text: 'BAIL BONDS', color: '#ffd14a' },
    { text: 'COFFEE', color: '#aa6622' },
    { text: 'PIZZA', color: '#cc1144' }
  ];
  return signs[Math.floor(srand() * signs.length)];
}

/**
 * Brick building with a shop awning + sign + door + window
 */
function drawBrickShop(ctx, x, h, w, sign) {
  const y = PLAY_AREA_TOP - 26 - h; // align bottom to top of sidewalk
  // Brick wall background
  drawBrickWall(ctx, x, y, w, h, '#8a4828', '#6a3818');
  // Window panel
  const winW = Math.floor(w * 0.6);
  const winX = x + Math.floor((w - winW) / 2);
  // Window frame
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(winX - 4, y + h - 60, winW + 8, 60);
  // Glass with reflections
  ctx.fillStyle = '#6a98c8';
  ctx.fillRect(winX, y + h - 56, winW, 50);
  // Glass cross mullion
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(winX + Math.floor(winW / 2) - 1, y + h - 56, 2, 50);
  ctx.fillRect(winX, y + h - 32, winW, 2);
  // Reflections (slanted highlights)
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(winX + 4, y + h - 52, 4, 16);
  ctx.fillRect(winX + 12, y + h - 50, 2, 14);
  ctx.fillRect(winX + Math.floor(winW / 2) + 6, y + h - 30, 5, 14);
  // Door (next to window)
  const doorX = x + w - 38;
  const doorY = y + h - 80;
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(doorX, doorY, 28, 80);
  ctx.fillStyle = '#5a3828';
  ctx.fillRect(doorX + 2, doorY + 2, 24, 76);
  // Door window
  ctx.fillStyle = '#6a98c8';
  ctx.fillRect(doorX + 6, doorY + 8, 16, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(doorX + 8, doorY + 10, 2, 14);
  // Door handle
  ctx.fillStyle = '#bba868';
  ctx.fillRect(doorX + 22, doorY + 44, 3, 4);
  // Awning (above window)
  const awY = y + h - 80;
  ctx.fillStyle = darken(sign.color, 0.5);
  ctx.fillRect(winX - 6, awY, winW + 12, 16);
  ctx.fillStyle = sign.color;
  ctx.fillRect(winX - 6, awY, winW + 12, 12);
  // Awning stripes
  ctx.fillStyle = lighten(sign.color, 0.3);
  for (let i = 0; i < (winW + 12) / 14; i++) {
    ctx.fillRect(winX - 6 + i * 14, awY, 6, 12);
  }
  ctx.fillStyle = darken(sign.color, 0.6);
  ctx.fillRect(winX - 6, awY + 14, winW + 12, 2);
  // Sign above awning
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(winX - 8, awY - 22, winW + 16, 22);
  drawPixelText(ctx, sign.text, winX - 8 + (winW + 16) / 2, awY - 14, sign.color, 'center');
  // Roof line
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(x, y, w, 4);
  ctx.fillStyle = '#aa6838';
  ctx.fillRect(x, y + 4, w, 2);
  // Upper window (second floor)
  for (let i = 0; i < 3; i++) {
    const uwx = x + 10 + i * Math.floor((w - 20) / 3);
    drawUpperWindow(ctx, uwx, y + 20, Math.floor((w - 20) / 3) - 10, 40);
  }
}

function drawBrickWarehouse(ctx, x, h, w) {
  const y = PLAY_AREA_TOP - 26 - h;
  drawBrickWall(ctx, x, y, w, h, '#7a4828', '#5a3818');
  // Big rolling shutter door
  const doorW = Math.floor(w * 0.55);
  const doorX = x + Math.floor((w - doorW) / 2);
  const doorY = y + h - 100;
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(doorX - 4, doorY - 6, doorW + 8, 6);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(doorX, doorY, doorW, 100);
  // Horizontal slats
  for (let sy = doorY + 4; sy < doorY + 100; sy += 6) {
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(doorX, sy, doorW, 2);
  }
  // Sign above door
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(doorX - 10, doorY - 32, doorW + 20, 22);
  drawPixelText(ctx, 'WAREHOUSE', doorX + doorW / 2, doorY - 24, '#ffd14a', 'center');
  // Roof
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(x, y, w, 6);
  // Upper small windows
  for (let i = 0; i < 5; i++) {
    const uwx = x + 12 + i * 38;
    if (uwx + 28 > x + w - 10) break;
    drawUpperWindow(ctx, uwx, y + 16, 28, 30);
  }
  // Graffiti tag
  ctx.fillStyle = '#ee44aa';
  ctx.fillRect(x + w - 60, doorY + 70, 24, 4);
  ctx.fillRect(x + w - 60, doorY + 78, 4, 8);
  ctx.fillRect(x + w - 50, doorY + 78, 4, 8);
  ctx.fillRect(x + w - 40, doorY + 78, 4, 8);
}

function drawElectronicsShop(ctx, x, h, w) {
  const y = PLAY_AREA_TOP - 26 - h;
  drawBrickWall(ctx, x, y, w, h, '#5a5a78', '#3a3a48');
  // Big neon sign
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 8, y + 6, w - 16, 24);
  ctx.fillStyle = '#1a4a6a';
  ctx.fillRect(x + 10, y + 8, w - 20, 20);
  // Neon-style text
  drawPixelText(ctx, 'ELECTRONICS', x + w / 2, y + 16, '#5cf2ff', 'center');
  // Glow
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#5cf2ff';
  ctx.fillRect(x + 8, y + 26, w - 16, 6);
  ctx.restore();
  // Display window with TVs
  const winW = w - 30;
  const winX = x + 15;
  const winY = y + h - 70;
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(winX - 3, winY - 3, winW + 6, 60);
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(winX, winY, winW, 54);
  // 3 TVs in window
  for (let i = 0; i < 3; i++) {
    const tvx = winX + 8 + i * Math.floor((winW - 20) / 3);
    const tvy = winY + 8;
    const tvw = Math.floor((winW - 20) / 3) - 4;
    const tvh = 38;
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(tvx, tvy, tvw, tvh);
    ctx.fillStyle = '#1a4a6a';
    ctx.fillRect(tvx + 2, tvy + 2, tvw - 4, tvh - 6);
    // Static "screens"
    const colors = ['#ff4422', '#4488ee', '#ffd14a'];
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(tvx + 4, tvy + 4, tvw - 8, tvh - 10);
    // CRT scanline
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let s = tvy + 4; s < tvy + tvh - 6; s += 2) {
      ctx.fillRect(tvx + 4, s, tvw - 8, 1);
    }
  }
  // Door
  const doorX = x + w - 32;
  const doorY = y + h - 80;
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(doorX, doorY, 24, 80);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(doorX + 2, doorY + 2, 20, 76);
  ctx.fillStyle = '#5cf2ff';
  ctx.fillRect(doorX + 6, doorY + 12, 12, 14);
}

function drawParkingGarageFull(ctx, x, h, w) {
  const y = PLAY_AREA_TOP - 26 - h;
  // Concrete body
  ctx.fillStyle = '#7a7a82';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x, y, w, 8);
  ctx.fillStyle = '#9a9aa2';
  ctx.fillRect(x, y + 8, w, 2);
  // Sign
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + w / 2 - 50, y - 18, 100, 22);
  drawPixelText(ctx, 'PARKING', x + w / 2, y - 10, '#5cf2ff', 'center');
  // Floors (4 levels)
  const floors = 4;
  const floorH = (h - 10) / floors;
  for (let f = 0; f < floors; f++) {
    const fy = y + 10 + f * floorH;
    // Floor slab
    ctx.fillStyle = '#5a5a64';
    ctx.fillRect(x, fy, w, 5);
    // Interior darkness
    ctx.fillStyle = '#2a2a34';
    ctx.fillRect(x + 4, fy + 5, w - 8, floorH - 7);
    // Vertical support columns
    ctx.fillStyle = '#7a7a82';
    for (let cx = x + 4; cx < x + w - 4; cx += 60) {
      ctx.fillRect(cx, fy + 5, 6, floorH - 7);
    }
    // Cars peeking out (small)
    for (let c = 0; c < 4; c++) {
      const cx = x + 12 + c * 56;
      if (cx + 36 > x + w - 4) break;
      const cy = fy + floorH - 18;
      const carColors = ['#cc3340', '#3744cc', '#ccaa33', '#dddddd', '#2a8a3a'];
      ctx.fillStyle = carColors[(f + c) % carColors.length];
      ctx.fillRect(cx, cy, 32, 12);
      ctx.fillStyle = '#88ccee';
      ctx.fillRect(cx + 4, cy + 2, 24, 4);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx + 2, cy + 9, 6, 4);
      ctx.fillRect(cx + 24, cy + 9, 6, 4);
    }
  }
  // Entry at ground level
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(x + w / 2 - 24, y + h - 38, 48, 38);
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(x + w / 2 - 24, y + h - 42, 48, 4);
  drawPixelText(ctx, 'ENTER', x + w / 2, y + h - 28, '#5cf2ff', 'center');
}

/**
 * Reusable: brick wall texture
 */
function drawBrickWall(ctx, x, y, w, h, brickColor, mortarColor) {
  ctx.fillStyle = mortarColor;
  ctx.fillRect(x, y, w, h);
  const brickW = 14, brickH = 6;
  let offset = 0;
  for (let by = y; by < y + h; by += brickH + 1) {
    offset = (offset === 0) ? brickW / 2 : 0;
    for (let bx = x - offset; bx < x + w; bx += brickW + 1) {
      ctx.fillStyle = brickColor;
      ctx.fillRect(Math.max(bx, x), by, Math.min(brickW, x + w - bx), brickH);
      // Highlight
      ctx.fillStyle = lighten(brickColor, 0.1);
      ctx.fillRect(Math.max(bx, x), by, Math.min(brickW, x + w - bx), 1);
    }
  }
}

function drawUpperWindow(ctx, x, y, w, h) {
  ctx.fillStyle = '#1a1828';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  // Glass (lit, varying color)
  const lit = srand() > 0.4;
  ctx.fillStyle = lit ? '#ffd960' : '#3a3a4a';
  ctx.fillRect(x, y, w, h);
  if (lit) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 1, y + 1, 2, 2);
  }
  // Mullions
  ctx.fillStyle = '#1a1828';
  ctx.fillRect(x + Math.floor(w / 2) - 1, y, 2, h);
}

/**
 * Tiny pixel text using a built-in 3x5 font (similar to ticket font)
 */
function drawPixelText(ctx, text, cx, cy, color, align) {
  const FONT = {
    'A':['010','101','111','101','101'],'B':['110','101','110','101','110'],
    'C':['011','100','100','100','011'],'D':['110','101','101','101','110'],
    'E':['111','100','110','100','111'],'F':['111','100','110','100','100'],
    'G':['011','100','101','101','011'],'H':['101','101','111','101','101'],
    'I':['111','010','010','010','111'],'J':['001','001','001','101','010'],
    'K':['101','110','100','110','101'],'L':['100','100','100','100','111'],
    'M':['101','111','101','101','101'],'N':['101','111','111','111','101'],
    'O':['010','101','101','101','010'],'P':['110','101','110','100','100'],
    'Q':['010','101','101','110','011'],'R':['110','101','110','110','101'],
    'S':['011','100','010','001','110'],'T':['111','010','010','010','010'],
    'U':['101','101','101','101','011'],'V':['101','101','101','010','010'],
    'W':['101','101','101','111','101'],'X':['101','101','010','101','101'],
    'Y':['101','101','010','010','010'],'Z':['111','001','010','100','111'],
    '0':['010','101','101','101','010'],'1':['010','110','010','010','111'],
    '2':['110','001','010','100','111'],'3':['110','001','010','001','110'],
    '4':['101','101','111','001','001'],'5':['111','100','110','001','110'],
    '6':['011','100','110','101','010'],'7':['111','001','010','010','010'],
    '8':['010','101','010','101','010'],'9':['010','101','011','001','110'],
    '!':['010','010','010','000','010'],'?':['110','001','010','000','010'],
    ' ':['000','000','000','000','000'],'.':['000','000','000','000','010'],
    ',':['000','000','000','010','100'],"'":['010','010','000','000','000'],
    '-':['000','000','111','000','000'],'/':['001','001','010','100','100'],
    '$':['011','100','010','001','110'],'#':['101','111','101','111','101']
  };
  // Support multi-line text via newline
  const lines = text.split('\n');
  const charW = 4;
  const lineH = 6;
  const startY = cy - (lines.length - 1) * lineH / 2;
  lines.forEach((line, li) => {
    const totalW = line.length * charW;
    let xPos;
    if (align === 'center') xPos = cx - Math.floor(totalW / 2);
    else if (align === 'right') xPos = cx - totalW;
    else xPos = cx;
    const yPos = startY + li * lineH;
    for (const ch of line.toUpperCase()) {
      const g = FONT[ch] || FONT[' '];
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (g[row][col] === '1') {
            ctx.fillStyle = color;
            ctx.fillRect(xPos + col, yPos + row, 1, 1);
          }
        }
      }
      xPos += charW;
    }
  });
}

// ============================================================
// Reusable props (cars, lights, hydrants, etc.)
// ============================================================
function drawCar(ctx, x, y, color, type) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x + 30, y + 36, 32, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 6, y + 28, 10, 8);
  ctx.fillRect(x + 44, y + 28, 10, 8);
  ctx.fillStyle = '#666';
  ctx.fillRect(x + 8, y + 30, 6, 4);
  ctx.fillRect(x + 46, y + 30, 6, 4);
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x + 10, y + 31, 2, 2);
  ctx.fillRect(x + 48, y + 31, 2, 2);
  if (type === 'truck') {
    ctx.fillStyle = color;
    ctx.fillRect(x + 2, y + 14, 56, 14);
    ctx.fillRect(x + 12, y + 2, 24, 14);
    ctx.fillStyle = '#88ccee';
    ctx.fillRect(x + 14, y + 4, 20, 10);
    ctx.fillStyle = darken(color, 0.7);
    ctx.fillRect(x + 36, y + 14, 22, 14);
    ctx.fillStyle = lighten(color, 0.25);
    ctx.fillRect(x + 2, y + 14, 56, 1);
  } else if (type === 'taxi') {
    ctx.fillStyle = color;
    ctx.fillRect(x + 2, y + 16, 56, 12);
    ctx.fillRect(x + 14, y + 6, 32, 12);
    ctx.fillStyle = '#88ccee';
    ctx.fillRect(x + 16, y + 8, 28, 8);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x + 2, y + 21, 56, 3);
    ctx.fillStyle = color;
    for (let i = 0; i < 28; i++) if (i % 2 === 0) ctx.fillRect(x + 2 + i * 2, y + 21, 2, 3);
    ctx.fillStyle = lighten(color, 0.2);
    ctx.fillRect(x + 2, y + 16, 56, 1);
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(x + 24, y, 12, 6);
    ctx.fillStyle = '#ffd00';
    ctx.fillRect(x + 26, y + 2, 8, 2);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(x + 2, y + 16, 56, 12);
    ctx.fillRect(x + 14, y + 6, 32, 12);
    ctx.fillStyle = darken(color, 0.7);
    ctx.fillRect(x + 2, y + 26, 56, 2);
    ctx.fillStyle = lighten(color, 0.3);
    ctx.fillRect(x + 2, y + 16, 56, 1);
    ctx.fillStyle = '#88ccee';
    ctx.fillRect(x + 16, y + 8, 28, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(x + 18, y + 9, 4, 1);
    ctx.fillRect(x + 36, y + 9, 6, 1);
  }
  ctx.fillStyle = '#ffffaa';
  ctx.fillRect(x + 56, y + 18, 3, 4);
  ctx.fillStyle = darken(color, 0.5);
  ctx.fillRect(x + 30, y + 22, 4, 1);
}

function drawStreetlight(ctx, x, baseY) {
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 8, baseY, 4, 130);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x + 8, baseY, 1, 130);
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(x + 4, baseY + 124, 12, 8);
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(x + 2, baseY - 6, 16, 10);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x + 2, baseY - 6, 16, 1);
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(x + 4, baseY - 4, 12, 6);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 7, baseY - 3, 6, 2);
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#ffeb3b';
  ctx.beginPath();
  ctx.arc(x + 10, baseY - 1, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHydrant(ctx, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x - 2, y + 28, 18, 3);
  ctx.fillStyle = '#cc2a2a';
  ctx.fillRect(x, y + 8, 14, 22);
  ctx.fillStyle = '#cc2a2a';
  ctx.fillRect(x + 2, y + 2, 10, 8);
  ctx.fillStyle = '#ff5a5a';
  ctx.fillRect(x + 1, y + 8, 1, 22);
  ctx.fillStyle = '#882020';
  ctx.fillRect(x - 2, y + 14, 4, 5);
  ctx.fillRect(x + 12, y + 14, 4, 5);
  ctx.fillStyle = '#882020';
  ctx.fillRect(x + 4, y, 6, 4);
}

function drawTrashCan(ctx, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x - 2, y + 32, 22, 3);
  ctx.fillStyle = '#4a4a52';
  ctx.fillRect(x, y + 4, 18, 30);
  ctx.fillStyle = '#3a3a42';
  ctx.fillRect(x - 1, y, 20, 6);
  ctx.fillStyle = '#6a6a72';
  ctx.fillRect(x, y + 4, 1, 30);
}

function drawDumpster(ctx, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 2, y + 42, 80, 4);
  ctx.fillStyle = '#2a5a3a';
  ctx.fillRect(x, y + 8, 84, 34);
  ctx.fillStyle = '#1a4a2a';
  ctx.fillRect(x - 2, y + 4, 88, 6);
  ctx.fillStyle = '#4a7a4a';
  ctx.fillRect(x, y + 8, 84, 1);
  ctx.fillStyle = '#1a4a2a';
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 15 + i * 20, y + 10, 1, 30);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 6, y + 38, 6, 8);
  ctx.fillRect(x + 70, y + 38, 6, 8);
  ctx.fillStyle = '#ee44aa';
  ctx.fillRect(x + 22, y + 20, 12, 2);
}

function drawSignPost(ctx, x, baseY, text, fg, bg) {
  ctx.fillStyle = '#888';
  ctx.fillRect(x + 6, baseY, 2, 80);
  ctx.fillStyle = bg;
  ctx.fillRect(x - 8, baseY, 28, 20);
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x - 8, baseY, 28, 1);
  ctx.fillRect(x - 8, baseY + 19, 28, 1);
  drawPixelText(ctx, text, x + 6, baseY + 4, fg, 'center');
}

function drawManhole(ctx, x, y) {
  ctx.fillStyle = '#1a1a1e';
  ctx.beginPath();
  ctx.ellipse(x + 20, y, 22, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a3a3e';
  ctx.beginPath();
  ctx.ellipse(x + 20, y, 18, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1a1e';
  for (let i = -6; i <= 6; i += 3) ctx.fillRect(x + 20 + i, y - 1, 1, 2);
}

function drawOilStain(ctx, x, y, dir) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + dir * 8, y + 2, 10, 3, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ============================================================
// STAGE 2: QUAD - tech campus park, bright day (reuse existing approach)
// ============================================================
function renderQuadStage(W) {
  const canvas = createCanvas(W, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  ditheredGradientStops(ctx, 0, 0, W, PLAY_AREA_TOP, [
    { t: 0, c: '#3a7ac8' }, { t: 0.4, c: '#6aaee0' },
    { t: 0.85, c: '#a8cce8' }, { t: 1.0, c: '#d4e4ec' }
  ]);

  // Sun
  ctx.fillStyle = 'rgba(255,250,200,0.9)';
  ctx.beginPath(); ctx.arc(200, 80, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(200, 80, 14, 0, Math.PI * 2); ctx.fill();

  // Mountains
  rseed(202);
  ctx.fillStyle = 'rgba(80,100,140,0.4)';
  let mx = 0;
  while (mx < W) {
    const mh = 20 + Math.floor(srand() * 30);
    const mw = 80 + Math.floor(srand() * 60);
    ctx.beginPath();
    ctx.moveTo(mx, 180); ctx.lineTo(mx + mw / 2, 180 - mh); ctx.lineTo(mx + mw, 180); ctx.closePath();
    ctx.fill();
    mx += mw - 20;
  }

  // Clouds
  rseed(303);
  for (let i = 0; i < 8; i++) {
    drawFluffyCloud(ctx, 50 + i * 280 + srand() * 80, 50 + srand() * 80);
  }

  // Tech buildings backdrop
  rseed(404);
  let bx = 0;
  while (bx < W) {
    const bw = 100 + Math.floor(srand() * 50);
    const bh = 200 + Math.floor(srand() * 90);
    drawTechBuilding(ctx, bx, PLAY_AREA_TOP - bh - 26, bw, bh);
    bx += bw + 4;
  }

  // TECHCORP sign on a prominent building
  ctx.fillStyle = '#0a4a8a';
  ctx.fillRect(W / 2 - 70, 140, 140, 28);
  ctx.fillStyle = '#1a6abc';
  ctx.fillRect(W / 2 - 70, 140, 140, 4);
  drawPixelText(ctx, 'TECHCORP', W / 2, 152, '#ffffff', 'center');

  // Hedge band along back
  ditheredGradientStops(ctx, 0, PLAY_AREA_TOP - 26, W, 26, [
    { t: 0, c: '#3a6a3a' }, { t: 1, c: '#5a8a5a' }
  ]);
  rseed(505);
  for (let i = 0; i < W; i += 4) {
    ctx.fillStyle = srand() > 0.5 ? '#4a7a4a' : '#2a5a2a';
    ctx.fillRect(i, PLAY_AREA_TOP - 24, 2, 2);
  }

  // Grass floor
  ditheredGradientStops(ctx, 0, PLAY_AREA_TOP, W, HEIGHT - PLAY_AREA_TOP, [
    { t: 0, c: '#4a8a4a' }, { t: 0.3, c: '#5aa05a' },
    { t: 0.7, c: '#3a7a3a' }, { t: 1, c: '#2a6a2a' }
  ]);
  // Grass blades
  rseed(606);
  for (let i = 0; i < 800; i++) {
    const gx = Math.floor(srand() * W);
    const gy = PLAY_AREA_TOP + Math.floor(srand() * (HEIGHT - PLAY_AREA_TOP));
    ctx.fillStyle = srand() > 0.5 ? '#6abc6a' : '#3a6a3a';
    ctx.fillRect(gx, gy, 1, 2);
  }

  // Cobblestone path winding through
  for (let px2 = 0; px2 < W; px2 += 1) {
    const t = px2 / W;
    const pathY = PLAY_AREA_TOP + 130 + Math.sin(t * Math.PI * 3) * 12;
    ctx.fillStyle = '#c8b898';
    ctx.fillRect(px2, pathY, 1, 40);
    ctx.fillStyle = '#9a8a7a';
    ctx.fillRect(px2, pathY, 1, 2);
    ctx.fillRect(px2, pathY + 38, 1, 2);
  }

  // Fountain in center
  drawFountain(ctx, W / 2 - 60, PLAY_AREA_TOP + 60);

  // Statue
  drawStatue(ctx, W * 0.2, PLAY_AREA_TOP + 50);

  // Trees
  drawOakTree(ctx, 80, PLAY_AREA_TOP - 60);
  drawOakTree(ctx, 480, PLAY_AREA_TOP - 30);
  drawOakTree(ctx, 1300, PLAY_AREA_TOP - 50);
  drawOakTree(ctx, 1900, PLAY_AREA_TOP - 70);
  drawOakTree(ctx, 2240, PLAY_AREA_TOP - 40);

  drawPalmTree(ctx, 240, PLAY_AREA_TOP - 40);
  drawPalmTree(ctx, 1600, PLAY_AREA_TOP - 35);
  drawPalmTree(ctx, 2100, PLAY_AREA_TOP - 50);

  // Benches
  drawFancyBench(ctx, W / 2 - 200, PLAY_AREA_TOP + 130);
  drawFancyBench(ctx, W / 2 + 130, PLAY_AREA_TOP + 130);
  drawFancyBench(ctx, W * 0.2 - 80, PLAY_AREA_TOP + 110);
  drawFancyBench(ctx, 1860, PLAY_AREA_TOP + 110);

  // Flower beds
  drawFlowerBed(ctx, 320, PLAY_AREA_TOP + 180, '#ff66cc');
  drawFlowerBed(ctx, 880, PLAY_AREA_TOP + 200, '#ffdd33');
  drawFlowerBed(ctx, 1450, PLAY_AREA_TOP + 180, '#ee5544');
  drawFlowerBed(ctx, 2080, PLAY_AREA_TOP + 190, '#ff66cc');

  // Coffee cart
  drawCoffeeCart(ctx, 1700, PLAY_AREA_TOP + 60);

  // Floor edge highlight
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(0, PLAY_AREA_TOP, W, 1);

  return canvas;
}

function drawFluffyCloud(ctx, x, y) {
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.arc(x + 20, y - 6, 18, 0, Math.PI * 2);
  ctx.arc(x + 42, y, 14, 0, Math.PI * 2);
  ctx.arc(x + 30, y + 8, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#dadce6';
  ctx.beginPath();
  ctx.arc(x + 8, y + 10, 14, 0, Math.PI * 2);
  ctx.arc(x + 30, y + 12, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTechBuilding(ctx, x, y, w, h) {
  ctx.fillStyle = '#7a8ab0';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3a4a6a';
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillStyle = '#252535';
  ctx.fillRect(x, y, w, 4);
  // Window grid
  const winColors = ['#fff388', '#88ccff', '#aaeeff'];
  for (let row = 0; row < Math.floor((h - 10) / 14); row++) {
    for (let col = 0; col < Math.floor((w - 8) / 12); col++) {
      const wx = x + 4 + col * 12;
      const wy = y + 8 + row * 14;
      ctx.fillStyle = '#1a2a3a';
      ctx.fillRect(wx - 1, wy - 1, 8, 10);
      const dark = (row * 7 + col * 13) % 11 < 3;
      ctx.fillStyle = dark ? '#1a2a3a' : winColors[(row + col) % winColors.length];
      ctx.fillRect(wx, wy, 6, 8);
    }
  }
}

function drawFountain(ctx, x, y) {
  ctx.fillStyle = '#5a7898';
  ctx.beginPath(); ctx.ellipse(x + 60, y + 50, 64, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7a98b8';
  ctx.beginPath(); ctx.ellipse(x + 60, y + 50, 60, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8accee';
  ctx.beginPath(); ctx.ellipse(x + 60, y + 50, 54, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8898a8';
  ctx.fillRect(x + 55, y + 8, 10, 42);
  ctx.fillStyle = '#a8b8c8';
  ctx.fillRect(x + 55, y + 8, 1, 42);
  ctx.fillStyle = '#5a7898';
  ctx.beginPath(); ctx.ellipse(x + 60, y + 8, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8accee';
  ctx.beginPath(); ctx.ellipse(x + 60, y + 8, 18, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ccecff';
  ctx.fillRect(x + 59, y - 6, 2, 16);
}

function drawStatue(ctx, x, y) {
  ctx.fillStyle = '#888888'; ctx.fillRect(x, y + 40, 36, 16);
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(x + 14, y, 8, 14);
  ctx.fillRect(x + 12, y + 14, 12, 22);
  ctx.fillRect(x + 6, y + 18, 8, 14);
  ctx.fillRect(x + 22, y + 18, 8, 14);
}

function drawOakTree(ctx, x, baseY) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 12, baseY + 95, 56, 5);
  ctx.fillStyle = '#5a3a1e';
  ctx.fillRect(x + 32, baseY + 60, 14, 40);
  ctx.fillStyle = '#1a4a1a';
  ctx.fillRect(x + 4, baseY + 36, 70, 32);
  ctx.fillStyle = '#2a6a2a';
  ctx.fillRect(x + 8, baseY + 16, 60, 36);
  ctx.fillStyle = '#3a8a3a';
  ctx.fillRect(x + 18, baseY, 40, 30);
  ctx.fillStyle = '#5acc5a';
  ctx.fillRect(x + 28, baseY + 2, 12, 8);
  ctx.fillStyle = '#cc2a2a';
  ctx.fillRect(x + 20, baseY + 24, 2, 2);
}

function drawPalmTree(ctx, x, baseY) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 12, baseY + 105, 24, 4);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#7a5a3a' : '#6a4a2a';
    ctx.fillRect(x + 20 - Math.floor(i / 3), baseY + 30 + i * 10, 8, 10);
  }
  ctx.fillStyle = '#3a7a3a';
  for (let i = 0; i < 20; i++) {
    ctx.fillRect(x + 22 - i, baseY + 20 - i / 2, 2, 2);
    ctx.fillRect(x + 22 + i, baseY + 20 - i / 2, 2, 2);
  }
}

function drawFancyBench(ctx, x, y) {
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 6, y + 20, 4, 16);
  ctx.fillRect(x + 68, y + 20, 4, 16);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(x + 4, y + 14 + i * 3, 70, 2);
  }
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(x + 4, y + i * 3, 70, 2);
  }
}

function drawFlowerBed(ctx, x, y, color) {
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(x, y, 48, 12);
  for (let i = 0; i < 6; i++) {
    const fx = x + 4 + i * 7;
    ctx.fillStyle = '#2a6a2a';
    ctx.fillRect(fx + 2, y - 6, 1, 6);
    ctx.fillStyle = color;
    ctx.fillRect(fx + 1, y - 8, 3, 3);
  }
}

function drawCoffeeCart(ctx, x, y) {
  ctx.fillStyle = '#c8584a';
  ctx.fillRect(x, y + 28, 90, 44);
  ctx.fillStyle = '#fff8e8';
  ctx.fillRect(x, y + 28, 90, 4);
  ctx.fillRect(x, y + 40, 90, 3);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 6, y + 66, 10, 10);
  ctx.fillRect(x + 74, y + 66, 10, 10);
  ctx.fillStyle = '#5a8a5a';
  ctx.fillRect(x - 16, y, 122, 8);
  ctx.fillStyle = '#5a3a1a';
  ctx.fillRect(x + 44, y + 8, 2, 20);
}

// ============================================================
// STAGE 3: LOBBY - corporate interior
// ============================================================
function renderLobbyStage(W) {
  const canvas = createCanvas(W, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  ditheredGradientStops(ctx, 0, 0, W, 130, [
    { t: 0, c: '#9a9aa8' }, { t: 1, c: '#bcbcc8' }
  ]);
  // Ceiling grid
  ctx.fillStyle = '#7a7a88';
  for (let cy = 30; cy < 130; cy += 30) ctx.fillRect(0, cy, W, 1);
  for (let cx = 0; cx < W; cx += 50) ctx.fillRect(cx, 0, 1, 130);
  // Recessed lights
  for (let lx = 60; lx < W - 60; lx += 200) {
    ctx.fillStyle = '#fffce0';
    ctx.fillRect(lx, 20, 30, 8);
    ctx.save(); ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#fff388';
    ctx.fillRect(lx - 10, 28, 50, 60);
    ctx.restore();
  }

  // Wall
  ditheredGradientStops(ctx, 0, 130, W, 250, [
    { t: 0, c: '#d8c8a8' }, { t: 0.5, c: '#c8b898' }, { t: 1, c: '#b8a888' }
  ]);

  // Glass windows showing city
  for (let i = 0; i < Math.floor(W / 280) + 1; i++) {
    drawLobbyWindow(ctx, 60 + i * 280, 150, 220, 180);
  }

  // Company logo center
  ctx.fillStyle = '#888a92';
  ctx.fillRect(W / 2 - 100, 160, 200, 40);
  ctx.fillStyle = '#aaacb4';
  ctx.fillRect(W / 2 - 100, 160, 200, 4);
  const cxLog = W / 2, cyLog = 180;
  ctx.fillStyle = '#ee4444'; ctx.fillRect(cxLog - 8, cyLog - 8, 8, 8);
  ctx.fillStyle = '#44aa44'; ctx.fillRect(cxLog, cyLog - 8, 8, 8);
  ctx.fillStyle = '#4488ee'; ctx.fillRect(cxLog - 8, cyLog, 8, 8);
  ctx.fillStyle = '#eebb44'; ctx.fillRect(cxLog, cyLog, 8, 8);

  // Wall trim
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, PLAY_AREA_TOP - 6, W, 2);
  ctx.fillStyle = '#8a7a5a';
  ctx.fillRect(0, PLAY_AREA_TOP - 4, W, 2);

  // Marble floor
  ditheredGradientStops(ctx, 0, PLAY_AREA_TOP, W, HEIGHT - PLAY_AREA_TOP, [
    { t: 0, c: '#e8e8f0' }, { t: 0.5, c: '#d8d8e0' }, { t: 1, c: '#c8c8d0' }
  ]);
  // Veins
  rseed(909);
  for (let i = 0; i < 100; i++) {
    ctx.fillStyle = '#a8a8b8';
    ctx.fillRect(Math.floor(srand() * W), PLAY_AREA_TOP + Math.floor(srand() * (HEIGHT - PLAY_AREA_TOP)), 20 + Math.floor(srand() * 40), 1);
  }
  // Tile lines
  ctx.fillStyle = '#a0a0a8';
  for (let lx = 0; lx < W; lx += 64) ctx.fillRect(lx, PLAY_AREA_TOP, 1, HEIGHT - PLAY_AREA_TOP);
  for (let ly = PLAY_AREA_TOP; ly < HEIGHT; ly += 64) ctx.fillRect(0, ly, W, 1);
  // Reflection bands
  for (let i = 0; i < W / 500; i++) {
    ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = '#ffffff';
    ctx.fillRect(200 + i * 500, PLAY_AREA_TOP, 30, HEIGHT - PLAY_AREA_TOP);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(0, PLAY_AREA_TOP, W, 1);

  // Tall plants spread out
  for (let i = 0; i < 6; i++) drawTallPlant(ctx, 80 + i * 380, PLAY_AREA_TOP - 90);

  // Reception desks (2-3)
  drawModernReceptionDesk(ctx, 320, PLAY_AREA_TOP + 50);
  drawModernReceptionDesk(ctx, 1180, PLAY_AREA_TOP + 50);
  drawModernReceptionDesk(ctx, 2040, PLAY_AREA_TOP + 50);

  // Couches with tables
  drawLeatherCouch(ctx, 640, PLAY_AREA_TOP + 110);
  drawCoffeeTable(ctx, 700, PLAY_AREA_TOP + 170);
  drawLeatherCouch(ctx, 1500, PLAY_AREA_TOP + 110);
  drawCoffeeTable(ctx, 1560, PLAY_AREA_TOP + 170);

  return canvas;
}

function drawLobbyWindow(ctx, x, y, w, h) {
  ctx.fillStyle = '#5a5a64'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#88a8c8'; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x + w / 2 - 1, y + 4, 2, h - 8);
  ctx.fillRect(x + 4, y + h / 2 - 1, w - 8, 2);
  // City silhouette behind
  ctx.fillStyle = '#3a4a6a';
  rseed(1010 + x);
  let cx = x + 4;
  while (cx < x + w - 4) {
    const bw = 12 + Math.floor(srand() * 24);
    const bh = 30 + Math.floor(srand() * 60);
    ctx.fillRect(cx, y + h - bh - 4, bw, bh);
    cx += bw + 1;
  }
}

function drawTallPlant(ctx, x, baseY) {
  ctx.fillStyle = '#5a3a2a'; ctx.fillRect(x + 10, baseY + 70, 28, 26);
  ctx.fillStyle = '#1a4a1a'; ctx.fillRect(x + 14, baseY + 40, 20, 32);
  ctx.fillStyle = '#3a7a3a'; ctx.fillRect(x + 6, baseY + 20, 38, 22);
  ctx.fillStyle = '#5acc5a'; ctx.fillRect(x + 16, baseY, 18, 12);
}

function drawModernReceptionDesk(ctx, x, y) {
  ctx.fillStyle = '#4a3a2a'; ctx.fillRect(x, y + 30, 160, 70);
  ctx.fillStyle = '#c8a878'; ctx.fillRect(x, y, 160, 32);
  ctx.fillStyle = '#e8c898'; ctx.fillRect(x, y, 160, 2);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#1a1a24'; ctx.fillRect(x + 16 + i * 50, y - 28, 34, 26);
    ctx.fillStyle = '#1a3a5a'; ctx.fillRect(x + 18 + i * 50, y - 26, 30, 22);
    ctx.fillStyle = '#88ccee'; ctx.fillRect(x + 22 + i * 50, y - 22, 22, 4);
  }
}

function drawLeatherCouch(ctx, x, y) {
  ctx.fillStyle = '#3a2a3a'; ctx.fillRect(x, y, 120, 32);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#5a3a5a'; ctx.fillRect(x + 4 + i * 38, y + 22, 36, 20);
  }
  ctx.fillStyle = '#2a1a2a';
  ctx.fillRect(x, y + 16, 8, 28);
  ctx.fillRect(x + 112, y + 16, 8, 28);
}

function drawCoffeeTable(ctx, x, y) {
  ctx.fillStyle = '#1a1a24'; ctx.fillRect(x, y, 70, 8);
  ctx.fillStyle = '#3a3a44'; ctx.fillRect(x + 4, y + 8, 4, 22);
  ctx.fillRect(x + 62, y + 8, 4, 22);
}

// ============================================================
// STAGE 4: SERVER ROOM - boss arena
// ============================================================
function renderServerRoomStage(W) {
  const canvas = createCanvas(W, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Dark ceiling with pipes
  ditheredGradientStops(ctx, 0, 0, W, 130, [
    { t: 0, c: '#0a0a14' }, { t: 1, c: '#2a1a24' }
  ]);
  for (let py = 16; py < 80; py += 24) {
    ctx.fillStyle = '#3a3a44'; ctx.fillRect(0, py, W, 8);
    ctx.fillStyle = '#5a5a64'; ctx.fillRect(0, py, W, 2);
    ctx.fillStyle = '#1a1a24'; ctx.fillRect(0, py + 6, W, 2);
    for (let jx = 0; jx < W; jx += 60) {
      ctx.fillStyle = '#2a2a34'; ctx.fillRect(jx, py - 2, 6, 12);
    }
  }
  // Cable runs
  ctx.fillStyle = '#cc4422'; ctx.fillRect(0, 92, W, 2);
  ctx.fillStyle = '#33ccff'; ctx.fillRect(0, 96, W, 2);
  ctx.fillStyle = '#ffeb3b'; ctx.fillRect(0, 100, W, 2);

  // Wall
  ditheredGradientStops(ctx, 0, 130, W, 250, [
    { t: 0, c: '#1a1a2a' }, { t: 0.5, c: '#2a2a3a' }, { t: 1, c: '#1a1a24' }
  ]);

  // Red strobes
  for (let i = 0; i < Math.floor(W / 200); i++) {
    const sx = 100 + i * 200;
    ctx.fillStyle = '#cc2a2a'; ctx.fillRect(sx, 110, 30, 10);
    ctx.save(); ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ff2a2a';
    ctx.beginPath(); ctx.arc(sx + 15, 115, 50, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Background server racks
  for (let bx = 20; bx < W - 20; bx += 50) drawBackgroundServerRack(ctx, bx, 140);

  // Floor
  ditheredGradientStops(ctx, 0, PLAY_AREA_TOP - 26, W, 26, [
    { t: 0, c: '#1a1a24' }, { t: 1, c: '#2a2a34' }
  ]);
  // Grate
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(0, PLAY_AREA_TOP, W, HEIGHT - PLAY_AREA_TOP);
  for (let tx = 0; tx < W; tx += 32) {
    for (let ty = PLAY_AREA_TOP; ty < HEIGHT; ty += 32) {
      ctx.fillStyle = '#5a5a65';
      for (let i = 0; i < 32; i += 8) {
        ctx.fillRect(tx + i, ty, 1, 32);
        ctx.fillRect(tx, ty + i, 32, 1);
      }
      ctx.fillStyle = '#9090a0';
      ctx.fillRect(tx + 1, ty + 1, 2, 2);
      ctx.fillRect(tx + 28, ty + 1, 2, 2);
    }
  }
  // Warning stripes
  for (let sx = 0; sx < W + 40; sx += 30) {
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.moveTo(sx, PLAY_AREA_TOP); ctx.lineTo(sx + 16, PLAY_AREA_TOP);
    ctx.lineTo(sx + 8, PLAY_AREA_TOP + 8); ctx.lineTo(sx - 8, PLAY_AREA_TOP + 8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1a1a24';
    ctx.beginPath();
    ctx.moveTo(sx + 16, PLAY_AREA_TOP); ctx.lineTo(sx + 30, PLAY_AREA_TOP);
    ctx.lineTo(sx + 22, PLAY_AREA_TOP + 8); ctx.lineTo(sx + 8, PLAY_AREA_TOP + 8);
    ctx.closePath(); ctx.fill();
  }

  // Red boss glow
  ctx.save(); ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#cc2a2a';
  ctx.beginPath(); ctx.ellipse(W / 2, PLAY_AREA_TOP + 120, 180, 24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Foreground servers
  drawDetailedServerRack(ctx, 30, PLAY_AREA_TOP - 30);
  drawDetailedServerRack(ctx, 100, PLAY_AREA_TOP - 30);
  drawDetailedServerRack(ctx, W - 130, PLAY_AREA_TOP - 30);
  drawDetailedServerRack(ctx, W - 60, PLAY_AREA_TOP - 30);

  // Elevator bank
  drawElevatorBank(ctx, W - 200, 200);

  return canvas;
}

function drawBackgroundServerRack(ctx, x, y) {
  ctx.fillStyle = '#0a0a14'; ctx.fillRect(x, y, 40, 180);
  ctx.fillStyle = '#3a3a44'; ctx.fillRect(x, y, 40, 2);
  ctx.fillRect(x, y, 2, 180);
  for (let i = 0; i < 12; i++) {
    const py = y + 4 + i * 14;
    ctx.fillStyle = i % 2 === 0 ? '#1a1a24' : '#2a2a34';
    ctx.fillRect(x + 2, py, 36, 12);
    const colors = ['#ff3333', '#33ff66', '#ffcc00'];
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = colors[(i + j) % colors.length];
      if (srand() > 0.3) ctx.fillRect(x + 6 + j * 8, py + 4, 2, 2);
    }
  }
}

function drawDetailedServerRack(ctx, x, y) {
  const w = 60, h = 130;
  ctx.fillStyle = '#0a0a14'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x, y, w, 4);
  ctx.fillRect(x, y, 4, h);
  ctx.fillRect(x + w - 4, y, 4, h);
  for (let i = 0; i < 8; i++) {
    const py = y + 6 + i * 14;
    ctx.fillStyle = i % 2 === 0 ? '#1a1a24' : '#2a2a34';
    ctx.fillRect(x + 6, py, w - 12, 12);
    const ledColors = ['#ff3333', '#33ff66', '#33ff66', '#ffcc00'];
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = ledColors[(i + j) % ledColors.length];
      ctx.fillRect(x + 10 + j * 5, py + 4, 3, 3);
    }
  }
}

function drawElevatorBank(ctx, x, y) {
  ctx.fillStyle = '#3a3a44'; ctx.fillRect(x - 8, y - 8, 196, 180);
  for (let i = 0; i < 2; i++) {
    const dx = x + i * 96;
    ctx.fillStyle = '#1a1a24'; ctx.fillRect(dx, y, 88, 160);
    ctx.fillStyle = '#9090a0'; ctx.fillRect(dx + 6, y + 6, 76, 148);
    ctx.fillStyle = '#1a1a24'; ctx.fillRect(dx + 43, y + 6, 2, 148);
    ctx.fillStyle = '#cc2a2a';
    ctx.fillRect(dx + 30, y - 9, 4, 6);
    ctx.fillRect(dx + 38, y - 9, 4, 6);
    ctx.fillRect(dx + 46, y - 9, 4, 6);
  }
}

// ============================================================
// MAIN
// ============================================================
const STAGES = [
  { name: 'stage1.png', label: 'Garage', width: 2500, render: renderGarageStage },
  { name: 'stage2.png', label: 'Quad', width: 2500, render: renderQuadStage },
  { name: 'stage3.png', label: 'Lobby', width: 2500, render: renderLobbyStage },
  { name: 'stage4.png', label: 'Server Room', width: 1500, render: renderServerRoomStage }
];

console.log('Generating 4 stage PNGs...');

const outDir = path.join(__dirname, '..', 'public', 'sprites');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

let totalSize = 0;
STAGES.forEach(stage => {
  console.log(`  ${stage.label} (${stage.width}x${HEIGHT})...`);
  rseed(stage.name.charCodeAt(5) * 1000);
  const canvas = stage.render(stage.width);
  const buffer = canvas.toBuffer('image/png');
  const outPath = path.join(outDir, stage.name);
  fs.writeFileSync(outPath, buffer);
  totalSize += buffer.length;
  console.log(`    saved ${stage.name} (${(buffer.length / 1024).toFixed(1)} KB)`);
});

console.log(`\n✓ All ${STAGES.length} stages generated`);
console.log(`  Total size: ${(totalSize / 1024).toFixed(1)} KB`);
