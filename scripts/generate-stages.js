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

// Smooth (non-dithered) gradient. Higher color fidelity for "32-bit" feel.
// Use this where the retro pixel-banding hurts realism (skies, atmospheric
// haze, reflections). Keep ditheredGradientStops for textured surfaces.
function smoothGradientStops(ctx, x, y, w, h, stops) {
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
    const r = Math.round(lo.c[0] + (hi.c[0] - lo.c[0]) * bandT);
    const g = Math.round(lo.c[1] + (hi.c[1] - lo.c[1]) * bandT);
    const b = Math.round(lo.c[2] + (hi.c[2] - lo.c[2]) * bandT);
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
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
// STAGE 2: QUAD - ExxonMobil Spring TX-style corporate campus
// Limestone-and-glass low-rise buildings under a Texas sky, with the
// Energy Center's cantilevered upper block as the central focal point.
// ============================================================
function renderQuadStage(W) {
  const canvas = createCanvas(W, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Sky - bright Texas day
  ditheredGradientStops(ctx, 0, 0, W, PLAY_AREA_TOP, [
    { t: 0, c: '#5a96d4' }, { t: 0.5, c: '#a0c8e8' },
    { t: 0.9, c: '#dde9f0' }, { t: 1.0, c: '#e8eef0' }
  ]);

  // Sun (high, soft - bright midday)
  ctx.fillStyle = 'rgba(255,250,210,0.7)';
  ctx.beginPath(); ctx.arc(W * 0.18, 60, 38, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,240,0.95)';
  ctx.beginPath(); ctx.arc(W * 0.18, 60, 20, 0, Math.PI * 2); ctx.fill();

  // Distant flat horizon line of trees (Houston is flat - no mountains)
  rseed(202);
  for (let tx = 0; tx < W; tx += 3) {
    const th = 8 + Math.floor(srand() * 14);
    ctx.fillStyle = 'rgba(70,100,80,0.5)';
    ctx.fillRect(tx, 230 - th, 3, th + 6);
  }
  ctx.fillStyle = 'rgba(70,100,80,0.3)';
  ctx.fillRect(0, 232, W, 4);

  // Soft Texas cumulus clouds (sparse)
  rseed(303);
  drawFluffyCloud(ctx, 380, 60);
  drawFluffyCloud(ctx, 1180, 45);
  drawFluffyCloud(ctx, 1740, 75);
  drawFluffyCloud(ctx, 2300, 55);

  // === THREE CAMPUS BUILDINGS ===
  // Hand-placed for compositional balance - left office, center Energy
  // Center cantilever (focal point), right wellness pavilion.

  // Left: long horizontal office block with deep louvers
  drawCampusOffice(ctx, 60, PLAY_AREA_TOP - 200, 540, 180, 5);

  // Center: ENERGY CENTER with cantilevered upper floors (focal point)
  // Sits forward visually, slightly taller, dominates the skyline.
  drawEnergyCenter(ctx, W * 0.5 - 470, PLAY_AREA_TOP - 246, 940, 226);

  // Right: lower glass wellness/dining pavilion
  drawCampusPavilion(ctx, W - 600, PLAY_AREA_TOP - 154, 540, 134);

  // Hedge band along back (softer, slightly darker for depth)
  ditheredGradientStops(ctx, 0, PLAY_AREA_TOP - 22, W, 22, [
    { t: 0, c: '#2e5a30' }, { t: 1, c: '#4a7a4a' }
  ]);
  rseed(505);
  for (let i = 0; i < W; i += 4) {
    ctx.fillStyle = srand() > 0.5 ? '#3e6a3e' : '#244a24';
    ctx.fillRect(i, PLAY_AREA_TOP - 20, 2, 2);
  }

  // Lawn floor (signature campus green)
  ditheredGradientStops(ctx, 0, PLAY_AREA_TOP, W, HEIGHT - PLAY_AREA_TOP, [
    { t: 0, c: '#5a9a5a' }, { t: 0.3, c: '#6ab06a' },
    { t: 0.7, c: '#4a8a4a' }, { t: 1, c: '#356a35' }
  ]);
  rseed(606);
  for (let i = 0; i < 800; i++) {
    const gx = Math.floor(srand() * W);
    const gy = PLAY_AREA_TOP + Math.floor(srand() * (HEIGHT - PLAY_AREA_TOP));
    ctx.fillStyle = srand() > 0.5 ? '#7acc7a' : '#3a6a3a';
    ctx.fillRect(gx, gy, 1, 2);
  }

  // Cream brick walkway (subtle curve through campus)
  for (let px2 = 0; px2 < W; px2 += 1) {
    const t = px2 / W;
    const pathY = PLAY_AREA_TOP + 130 + Math.sin(t * Math.PI * 3) * 12;
    ctx.fillStyle = '#d4c8a8';
    ctx.fillRect(px2, pathY, 1, 40);
    ctx.fillStyle = '#a89878';
    ctx.fillRect(px2, pathY, 1, 2);
    ctx.fillRect(px2, pathY + 38, 1, 2);
  }
  // Brick joint pattern on the path
  rseed(707);
  for (let px2 = 0; px2 < W; px2 += 12) {
    const t = px2 / W;
    const pathY = PLAY_AREA_TOP + 130 + Math.sin(t * Math.PI * 3) * 12;
    ctx.fillStyle = 'rgba(140,120,90,0.4)';
    ctx.fillRect(px2, pathY + 8 + (px2 % 24 === 0 ? 12 : 0), 1, 4);
  }

  // Reflecting pool front-center (replaces fountain - more campus-realistic)
  drawReflectingPool(ctx, W / 2 - 100, PLAY_AREA_TOP + 60, 200, 40);

  // Modern sculpture (kept - campuses have public art)
  drawStatue(ctx, W * 0.22, PLAY_AREA_TOP + 50);

  // Live oaks (signature ExxonMobil campus tree)
  drawOakTree(ctx, 80, PLAY_AREA_TOP - 60);
  drawOakTree(ctx, 660, PLAY_AREA_TOP - 30);
  drawOakTree(ctx, 1860, PLAY_AREA_TOP - 50);
  drawOakTree(ctx, 2280, PLAY_AREA_TOP - 40);

  // A couple of palms for Texas flavor
  drawPalmTree(ctx, 1620, PLAY_AREA_TOP - 35);

  // Benches around the pool
  drawFancyBench(ctx, W / 2 - 200, PLAY_AREA_TOP + 130);
  drawFancyBench(ctx, W / 2 + 130, PLAY_AREA_TOP + 130);

  // Sparse flower beds (campus is minimalist)
  drawFlowerBed(ctx, 380, PLAY_AREA_TOP + 190, '#ff66cc');
  drawFlowerBed(ctx, 2100, PLAY_AREA_TOP + 190, '#ffdd33');

  // Floor edge highlight
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(0, PLAY_AREA_TOP, W, 1);

  return canvas;
}

// Limestone-and-glass office block - ExxonMobil campus style.
// Deep horizontal louver bands cast strong shadows beneath each floor.
function drawCampusOffice(ctx, x, y, w, h, floors) {
  floors = floors || 5;
  const podiumH = Math.floor(h * 0.16);
  const bodyH = h - podiumH;

  // Stone podium / ground floor base
  ctx.fillStyle = '#9a8d76';
  ctx.fillRect(x, y + bodyH, w, podiumH);
  ctx.fillStyle = '#b0a387';
  ctx.fillRect(x, y + bodyH, w, 2);
  // Ground-floor recessed glass
  ctx.fillStyle = '#5a7a96';
  ctx.fillRect(x + 8, y + bodyH + 4, w - 16, podiumH - 8);
  ctx.fillStyle = '#3a4250';
  for (let mx = x + 14; mx < x + w - 8; mx += 10) {
    ctx.fillRect(mx, y + bodyH + 4, 1, podiumH - 8);
  }

  // Body limestone wash behind the glass
  ctx.fillStyle = '#d4c8ad';
  ctx.fillRect(x, y, w, bodyH);

  // End stone piers (bookend columns)
  const pier = Math.max(10, Math.floor(w * 0.05));
  ctx.fillStyle = '#c0b39a';
  ctx.fillRect(x, y, pier, bodyH);
  ctx.fillRect(x + w - pier, y, pier, bodyH);
  ctx.fillStyle = '#aa9d80';
  ctx.fillRect(x + pier - 2, y, 2, bodyH);
  ctx.fillRect(x + w - pier, y, 2, bodyH);

  // Glass curtain wall between piers
  const gX = x + pier;
  const gW = w - pier * 2;
  const floorH = Math.floor(bodyH / floors);
  for (let f = 0; f < floors; f++) {
    const fy = y + f * floorH;
    // Glass band (alternates slightly to suggest reflections)
    ctx.fillStyle = f % 2 === 0 ? '#6f93b0' : '#7ba0bd';
    ctx.fillRect(gX, fy + 2, gW, floorH - 6);
    // Vertical mullions
    ctx.fillStyle = '#2e3744';
    for (let mx = gX + 8; mx < gX + gW; mx += 12) {
      ctx.fillRect(mx, fy + 2, 1, floorH - 6);
    }
    // Subtle horizontal reflective line in each floor
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(gX, fy + Math.floor(floorH / 2), gW, 1);
    // Horizontal sun-shade band + shadow
    ctx.fillStyle = '#c0b39a';
    ctx.fillRect(gX - 2, fy + floorH - 4, gW + 4, 3);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(gX, fy + floorH - 1, gW, 1);
  }

  // Top parapet
  ctx.fillStyle = '#aa9d80';
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = '#e0d4ba';
  ctx.fillRect(x, y, w, 1);
}

// ExxonMobil Energy Center - cantilevered upper block projecting beyond
// the recessed ground-floor lobby, supported by paired columns at each end.
// This is the campus's signature architectural moment.
function drawEnergyCenter(ctx, x, y, w, h) {
  const upperH = Math.floor(h * 0.78); // upper mass is most of the height
  const groundH = h - upperH;
  const overhang = Math.floor(w * 0.17); // how far the upper block projects past the lobby
  const lobbyX = x + overhang;
  const lobbyW = w - overhang * 2;

  // === GROUND-FLOOR LOBBY (recessed under the cantilever) ===
  ctx.fillStyle = '#9a8d76';
  ctx.fillRect(lobbyX, y + upperH, lobbyW, groundH);
  // Lobby glass (taller, expansive entry)
  ctx.fillStyle = '#7aa0c0';
  ctx.fillRect(lobbyX + 4, y + upperH + 3, lobbyW - 8, groundH - 10);
  // Lobby mullions
  ctx.fillStyle = '#2e3744';
  for (let mx = lobbyX + 10; mx < lobbyX + lobbyW - 4; mx += 14) {
    ctx.fillRect(mx, y + upperH + 3, 1, groundH - 10);
  }
  // Entry door (slightly taller dark slot)
  ctx.fillStyle = '#1a2230';
  ctx.fillRect(lobbyX + lobbyW / 2 - 10, y + upperH + 8, 20, groundH - 14);
  // Lobby base trim
  ctx.fillStyle = '#5a4a3a';
  ctx.fillRect(lobbyX, y + h - 5, lobbyW, 3);

  // === SUPPORT COLUMNS (under each side of the cantilever) ===
  // Two paired columns left, two paired right.
  const colY = y + upperH;
  const colH = groundH - 3;
  function pillar(cx) {
    ctx.fillStyle = '#aa9d80';
    ctx.fillRect(cx, colY, 9, colH);
    ctx.fillStyle = '#c5b89c';
    ctx.fillRect(cx, colY, 9, 2); // capital highlight
    ctx.fillStyle = '#8a7d66';
    ctx.fillRect(cx + 7, colY + 2, 2, colH - 2); // right side shadow
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(cx, colY + colH - 2, 9, 2); // base
  }
  pillar(x + 18);
  pillar(x + 18 + Math.floor((overhang - 36) / 2) + 14);
  pillar(x + w - 27 - Math.floor((overhang - 36) / 2) - 14);
  pillar(x + w - 27);

  // === DEEP SHADOW UNDER THE CANTILEVER ===
  // Sells the projection - a strong horizontal shadow beneath the upper mass.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y + upperH, w, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x, y + upperH + 3, w, 2);

  // === UPPER BLOCK (the cantilever itself) ===
  // Limestone background, central glass curtain wall, deep horizontal louvers.
  ctx.fillStyle = '#d8ccb0';
  ctx.fillRect(x, y, w, upperH);

  // Side limestone piers (frame the glass)
  const pier = 18;
  ctx.fillStyle = '#c0b39a';
  ctx.fillRect(x, y, pier, upperH);
  ctx.fillRect(x + w - pier, y, pier, upperH);
  ctx.fillStyle = '#aa9d80';
  ctx.fillRect(x + pier - 2, y, 2, upperH);
  ctx.fillRect(x + w - pier, y, 2, upperH);

  // Center glass curtain wall (the cantilever's signature stripe)
  const gX = x + pier;
  const gW = w - pier * 2;
  const floors = 4;
  const floorH = Math.floor((upperH - 6) / floors);
  for (let f = 0; f < floors; f++) {
    const fy = y + 4 + f * floorH;
    // Glass
    ctx.fillStyle = f % 2 === 0 ? '#7aa0c0' : '#88adcc';
    ctx.fillRect(gX, fy + 1, gW, floorH - 4);
    // Vertical mullions
    ctx.fillStyle = '#2e3744';
    for (let mx = gX + 10; mx < gX + gW; mx += 14) {
      ctx.fillRect(mx, fy + 1, 1, floorH - 4);
    }
    // Horizontal reflective highlight
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(gX, fy + Math.floor(floorH / 2), gW, 1);
    // Sun-shade band + shadow below each floor (the signature horizontal expression)
    ctx.fillStyle = '#c5b89c';
    ctx.fillRect(gX - 2, fy + floorH - 4, gW + 4, 3);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(gX, fy + floorH - 1, gW, 1);
  }

  // Underside of the cantilever (stone soffit)
  ctx.fillStyle = '#aa9d80';
  ctx.fillRect(x, y + upperH - 3, w, 3);
  ctx.fillStyle = '#9a8d76';
  ctx.fillRect(x, y + upperH, w, 1);

  // Top parapet
  ctx.fillStyle = '#aa9d80';
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = '#e0d4ba';
  ctx.fillRect(x, y, w, 1);

  // Subtle vertical edge shadows where the cantilever ends (sells the overhang)
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x + overhang - 1, y + upperH, 1, 8);
  ctx.fillRect(x + w - overhang, y + upperH, 1, 8);
}

// Wellness / dining pavilion - low single-volume glass building
// with a deep stone eave projecting out over the entrance.
function drawCampusPavilion(ctx, x, y, w, h) {
  // Stone base
  ctx.fillStyle = '#9a8d76';
  ctx.fillRect(x, y + h - 12, w, 12);
  ctx.fillStyle = '#aa9d80';
  ctx.fillRect(x, y + h - 12, w, 2);

  // Glass curtain wall
  ctx.fillStyle = '#7aa0c0';
  ctx.fillRect(x + 4, y + 8, w - 8, h - 22);

  // Vertical mullions
  ctx.fillStyle = '#2e3744';
  for (let mx = x + 12; mx < x + w - 4; mx += 16) {
    ctx.fillRect(mx, y + 8, 1, h - 22);
  }
  // Two horizontal reflection bands
  for (let r = 1; r <= 2; r++) {
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + 4, y + 8 + r * Math.floor((h - 22) / 3), w - 8, 1);
  }
  // Center entry door
  ctx.fillStyle = '#1a2230';
  ctx.fillRect(x + w / 2 - 8, y + h - 28, 16, 16);

  // Deep stone eave (projects beyond facade)
  ctx.fillStyle = '#c5b89c';
  ctx.fillRect(x - 6, y, w + 12, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x - 6, y + 6, w + 12, 2);
  ctx.fillStyle = '#e0d4ba';
  ctx.fillRect(x - 6, y, w + 12, 1);
}

// Rectangular reflecting pool - replaces the fountain for a more
// campus-quad-realistic look.
function drawReflectingPool(ctx, x, y, w, h) {
  // Stone curb
  ctx.fillStyle = '#9a8d76';
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = '#c0b39a';
  ctx.fillRect(x - 3, y - 3, w + 6, 2);
  // Water (gradient deeper toward center)
  ctx.fillStyle = '#3a6a8a';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#4a7898';
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = '#5a8aac';
  ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
  // Reflection highlights
  for (let i = 0; i < 6; i++) {
    const rx = x + 8 + Math.floor(((i * 31) % (w - 16)));
    const ry = y + 6 + Math.floor(((i * 17) % (h - 12)));
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(rx, ry, 8, 1);
  }
  // Stone curb shadow on lawn
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x - 1, y + h + 3, w + 2, 2);
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

  // === LAYOUT (vertical bands) ===
  const CEILING_H = 122;
  const HEADER_H = 8;             // dark window header (top of glass wall)
  const WINDOW_TOP = CEILING_H + HEADER_H;          // 130
  const WINDOW_BOTTOM = PLAY_AREA_TOP - 10;         // 370
  const WINDOW_H = WINDOW_BOTTOM - WINDOW_TOP;      // 240

  // =====================================================================
  // BACKGROUND: SUNSET SKY visible through the floor-to-ceiling glass wall
  // =====================================================================
  // 32-bit smooth gradient — multi-stop, no dither banding, to capture the
  // soft purple-to-peach sunset palette from the reference photo.
  smoothGradientStops(ctx, 0, WINDOW_TOP, W, WINDOW_H, [
    { t: 0.00, c: '#2a2050' }, // deep zenith purple
    { t: 0.15, c: '#3e2c6a' },
    { t: 0.32, c: '#6a3a7a' }, // violet
    { t: 0.50, c: '#a8506a' }, // mauve
    { t: 0.68, c: '#d8704a' }, // coral
    { t: 0.84, c: '#f0a060' }, // sunset orange
    { t: 0.95, c: '#f8c890' }, // pale peach
    { t: 1.00, c: '#fce0b0' }  // horizon gold
  ]);

  // Wispy sunset clouds — lit warmly on the underside, cooler above
  rseed(1212);
  for (let i = 0; i < 9; i++) {
    drawSunsetCloud(ctx, 60 + i * (W / 8) + (srand() - 0.5) * 200,
                         WINDOW_TOP + 30 + srand() * 70);
  }

  // The cantilever bridge scene (silhouetted buildings + bridge + plaza)
  drawCantileverScene(ctx, 0, WINDOW_TOP, W, WINDOW_H);

  // =====================================================================
  // LOBBY INTERIOR: CEILING
  // =====================================================================
  smoothGradientStops(ctx, 0, 0, W, CEILING_H, [
    { t: 0, c: '#5a5a6c' }, { t: 1, c: '#86869a' }
  ]);
  // Ceiling tile grid
  ctx.fillStyle = 'rgba(40,40,55,0.45)';
  for (let cy = 28; cy < CEILING_H; cy += 30) ctx.fillRect(0, cy, W, 1);
  for (let cx = 0; cx < W; cx += 48) ctx.fillRect(cx, 0, 1, CEILING_H);
  // HVAC slot at top (subtle)
  ctx.fillStyle = '#3a3a48';
  ctx.fillRect(0, 0, W, 4);
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(0, 4, W, 2);
  // Recessed downlights with soft bloom
  for (let lx = 70; lx < W - 60; lx += 220) {
    // Fixture body
    ctx.fillStyle = '#2a2a34'; ctx.fillRect(lx - 2, 30, 36, 14);
    ctx.fillStyle = '#fffce0'; ctx.fillRect(lx, 32, 32, 10);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(lx + 6, 34, 20, 4);
    // Down-bloom
    for (let g = 1; g <= 4; g++) {
      ctx.save();
      ctx.globalAlpha = 0.06 * (5 - g);
      ctx.fillStyle = '#fff388';
      const gw = 46 + g * 16;
      ctx.fillRect(lx + 16 - gw / 2, 44 + (g - 1) * 16, gw, 16);
      ctx.restore();
    }
  }
  // Warm cove light along ceiling/window header (sunset bouncing back in)
  ctx.save();
  ctx.globalAlpha = 0.45;
  smoothGradientStops(ctx, 0, CEILING_H - 6, W, 6, [
    { t: 0, c: '#3a3a48' }, { t: 1, c: '#ffc888' }
  ]);
  ctx.restore();

  // =====================================================================
  // WINDOW WALL FRAMING (header, sill, vertical mullions)
  // =====================================================================
  // Header (above glass)
  ctx.fillStyle = '#1a1a22';
  ctx.fillRect(0, CEILING_H, W, HEADER_H);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, CEILING_H, W, 2);
  ctx.fillStyle = '#0a0a10';
  ctx.fillRect(0, WINDOW_TOP - 1, W, 1);

  // Slim aluminum mullions every 320px — narrow & low-contrast so the
  // outdoor view reads continuously instead of getting sliced into panels.
  const mullionSpacing = 320;
  for (let mx = mullionSpacing; mx < W; mx += mullionSpacing) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(mx, WINDOW_TOP, 2, WINDOW_H);
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = '#5a5a64';
    ctx.fillRect(mx, WINDOW_TOP, 1, WINDOW_H);
    ctx.restore();
  }

  // Glass reflection sheen (subtle diagonal-ish highlights per pane)
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < W; i += mullionSpacing) {
    ctx.fillRect(i + 20, WINDOW_TOP + 6, 60, WINDOW_H - 12);
  }
  ctx.restore();

  // Window sill (below glass)
  ctx.fillStyle = '#1a1a22';
  ctx.fillRect(0, WINDOW_BOTTOM, W, 6);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, WINDOW_BOTTOM, W, 1);

  // Wall band between sill and floor (polished stone with warm reflection)
  smoothGradientStops(ctx, 0, WINDOW_BOTTOM + 6, W, PLAY_AREA_TOP - WINDOW_BOTTOM - 6, [
    { t: 0, c: '#5a4a3a' }, { t: 1, c: '#3a2e22' }
  ]);
  // Sunset warmth bouncing off the wall band
  ctx.save();
  ctx.globalAlpha = 0.20;
  ctx.fillStyle = '#ff9870';
  ctx.fillRect(0, WINDOW_BOTTOM + 6, W, 2);
  ctx.restore();
  // Floor trim line
  ctx.fillStyle = '#1a1010';
  ctx.fillRect(0, PLAY_AREA_TOP - 3, W, 1);
  ctx.fillStyle = '#8a6c4a';
  ctx.fillRect(0, PLAY_AREA_TOP - 2, W, 2);

  // =====================================================================
  // POLISHED MARBLE FLOOR (with warm sunset reflection)
  // =====================================================================
  smoothGradientStops(ctx, 0, PLAY_AREA_TOP, W, HEIGHT - PLAY_AREA_TOP, [
    { t: 0.00, c: '#c0a888' }, // warm reflection band closest to window
    { t: 0.20, c: '#dcc8a8' },
    { t: 0.50, c: '#eaddc0' },
    { t: 0.85, c: '#d4c2a4' },
    { t: 1.00, c: '#a89880' }
  ]);
  // Marble veining (multi-tone for depth)
  rseed(909);
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = 'rgba(140,118,88,0.45)';
    ctx.fillRect(Math.floor(srand() * W),
                 PLAY_AREA_TOP + Math.floor(srand() * (HEIGHT - PLAY_AREA_TOP)),
                 24 + Math.floor(srand() * 60), 1);
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(80,60,40,0.35)';
    ctx.fillRect(Math.floor(srand() * W),
                 PLAY_AREA_TOP + Math.floor(srand() * (HEIGHT - PLAY_AREA_TOP)),
                 12 + Math.floor(srand() * 30), 1);
  }
  // Tile grid (wider, polished look)
  ctx.fillStyle = 'rgba(130,110,80,0.50)';
  for (let lx = 0; lx < W; lx += 96) ctx.fillRect(lx, PLAY_AREA_TOP, 1, HEIGHT - PLAY_AREA_TOP);
  for (let ly = PLAY_AREA_TOP + 64; ly < HEIGHT; ly += 96) ctx.fillRect(0, ly, W, 1);
  // Window-light reflections cascading onto the floor
  ctx.save();
  for (let mx = 0; mx <= W; mx += mullionSpacing) {
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#ffd8a0';
    // Triangular streak fading down
    for (let dy = 0; dy < 90; dy += 3) {
      const taper = dy / 90;
      const w2 = 90 - taper * 60;
      ctx.fillRect(mx + 80 - w2 / 2 + 30, PLAY_AREA_TOP + dy, w2, 3);
    }
  }
  ctx.restore();
  // Floor/wall seam highlight (gold trim)
  ctx.fillStyle = 'rgba(255,220,170,0.45)';
  ctx.fillRect(0, PLAY_AREA_TOP, W, 1);
  ctx.fillStyle = 'rgba(255,230,180,0.25)';
  ctx.fillRect(0, PLAY_AREA_TOP + 1, W, 1);

  // =====================================================================
  // FOREGROUND: plants, reception desks, couches (with shadows on floor)
  // =====================================================================
  // Soft contact shadows under tall objects
  function shadowEllipse(cx, cy, rw, rh) {
    ctx.save();
    for (let s = 4; s >= 1; s--) {
      ctx.globalAlpha = 0.10 * s;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(cx, cy, rw + s * 2, rh + s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const plantX = [80, 540, 1000, 1480, 1960, 2400];
  plantX.forEach(px => shadowEllipse(px + 22, PLAY_AREA_TOP + 6, 22, 5));
  plantX.forEach(px => drawTallPlant(ctx, px, PLAY_AREA_TOP - 90));

  const deskX = [320, 1180, 2040];
  deskX.forEach(dx => shadowEllipse(dx + 80, PLAY_AREA_TOP + 100, 86, 6));
  deskX.forEach(dx => drawModernReceptionDesk(ctx, dx, PLAY_AREA_TOP + 50));

  const couchX = [640, 1500];
  couchX.forEach(cx => shadowEllipse(cx + 60, PLAY_AREA_TOP + 142, 66, 5));
  couchX.forEach(cx => drawLeatherCouch(ctx, cx, PLAY_AREA_TOP + 110));
  drawCoffeeTable(ctx, 700, PLAY_AREA_TOP + 170);
  drawCoffeeTable(ctx, 1560, PLAY_AREA_TOP + 170);

  return canvas;
}

// Soft sunset cloud — warm-lit underside, cooler crown.
function drawSunsetCloud(ctx, x, y) {
  ctx.save();
  // Cool top (lit by sky)
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = '#6a4878';
  ctx.beginPath();
  ctx.ellipse(x, y, 32, 8, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 24, y - 4, 22, 7, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 22, y - 2, 20, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Warm-lit underside (sunset hitting the bottom)
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = '#e88860';
  ctx.beginPath();
  ctx.ellipse(x, y + 5, 30, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 22, y + 2, 18, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Bright pink rim at very bottom
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#fbb088';
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 26, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The signature ExxonMobil Energy Center scene: two flanking limestone-and-
// glass volumes connected by a dramatic cantilever bridge above an open
// plaza. Underneath the bridge: open sky.
function drawCantileverScene(ctx, x, y, w, h) {
  // Foreground REFLECTING POOL fills the lower portion of the window — the
  // signature ExxonMobil Energy Center water feature.
  const poolH = Math.max(34, Math.floor(h * 0.22));
  const poolY = y + h - poolH;
  const groundY = poolY - 2;       // far bank of pool
  const horizonY = groundY - 3;    // tree-silhouette line (kept LOW so the
                                   // support core stays fully visible)

  // Distant tree silhouettes at horizon - kept short and atmospheric so
  // they don't visually compete with the architecture.
  rseed(1313);
  for (let tx = x; tx < x + w; tx += 2) {
    const th = 2 + Math.floor(srand() * 8);
    ctx.fillStyle = '#1a1024';
    ctx.fillRect(tx, horizonY - th, 2, th + 3);
  }
  // Warm haze layer just above horizon
  for (let hy = 0; hy < 12; hy++) {
    ctx.save();
    ctx.globalAlpha = 0.24 * (hy / 11);
    ctx.fillStyle = '#fa8858';
    ctx.fillRect(x, horizonY - 12 + hy, w, 1);
    ctx.restore();
  }

  // === ARCHITECTURE LAYOUT ===
  // ONE continuous wide multi-story building base extends across most of
  // the scene. A tall central ARCHWAY is cut through the middle, creating
  // two "supports" (the parts of the wings that flank the archway).
  // The CUBE sits on TOP of the building, straddling the archway -
  // wider than the archway gap so the wings hold it up on each side.
  // (Like a donut on two coffee cups, per the reference.)

  // The CUBE rises above the building, dominating the composition - its
  // top edge is near the top of the window, and it extends well past the
  // building's parapet height.
  const cubeH = Math.floor(h * 0.55);
  const cubeW = Math.floor(w * 0.22);
  const cubeX = x + Math.floor((w - cubeW) / 2);
  const cubeY = y + 4; // very near the top of the scene

  // The building base is SHORTER than the cube. It sits below, with the
  // cube's bottom overlapping the building top by ~10px so the cube reads
  // as "resting on" the wings.
  const baseW = Math.floor(w * 0.78);
  const baseY = cubeY + cubeH - 10;
  const baseH = groundY - baseY;
  const baseX = x + Math.floor((w - baseW) / 2);

  // Central archway through the building base. The archway is NARROWER
  // than the cube so the wings on each side support the cube's underside.
  const portalW = Math.floor(cubeW * 0.55);
  const portalH = Math.floor(baseH * 0.82);
  const portalX = x + Math.floor((w - portalW) / 2);
  const portalY = groundY - portalH;

  // Building wings on either side of the archway (same building, just
  // split by the central portal cut).
  const leftWingX = baseX;
  const leftWingW = portalX - baseX;
  const rightWingX = portalX + portalW;
  const rightWingW = baseX + baseW - rightWingX;

  // Distant atmospheric campus visible far behind everything
  drawDistantSilhouette(ctx, x + 40, horizonY - 36, w - 80, 36);

  // The two building wings (each wing is a multi-story glass volume).
  // Drawn FIRST so the cube can overlap them cleanly on top.
  drawCampusBaseWing(ctx, leftWingX, baseY, leftWingW, baseH);
  drawCampusBaseWing(ctx, rightWingX, baseY, rightWingW, baseH);

  // The inner edge of each wing facing the archway: limestone reveal
  // showing the depth/thickness of the wall through the portal cut.
  ctx.fillStyle = '#9a8d76';
  ctx.fillRect(portalX - 3, portalY, 3, portalH);
  ctx.fillRect(portalX + portalW, portalY, 3, portalH);
  ctx.fillStyle = '#5a4a38';
  ctx.fillRect(portalX - 3, portalY, 1, portalH);
  ctx.fillRect(portalX + portalW + 2, portalY, 1, portalH);
  // Top edge of the archway (lintel) - a horizontal beam
  ctx.fillStyle = '#5a4a38';
  ctx.fillRect(portalX - 3, portalY, portalW + 6, 2);
  ctx.fillStyle = '#9a8d76';
  ctx.fillRect(portalX - 3, portalY + 2, portalW + 6, 1);

  // A faint warm glow inside the archway (entry plaza visible through it)
  ctx.save();
  ctx.globalAlpha = 0.30;
  smoothGradientStops(ctx, portalX, portalY + Math.floor(portalH * 0.4),
                      portalW, Math.floor(portalH * 0.6), [
    { t: 0, c: '#f8a868' },
    { t: 1, c: '#5a4030' }
  ]);
  ctx.restore();
  // Tiny lit doorway at the bottom of the archway (entrance)
  const doorW = Math.max(8, Math.floor(portalW * 0.18));
  const doorH = Math.max(10, Math.floor(portalH * 0.20));
  ctx.fillStyle = '#fcd890';
  ctx.fillRect(portalX + (portalW - doorW) / 2, portalY + portalH - doorH, doorW, doorH);
  ctx.fillStyle = '#fff0c0';
  ctx.fillRect(portalX + (portalW - doorW) / 2, portalY + portalH - doorH, doorW, 1);

  // The floating cube - the CENTERPIECE on top of the building
  drawFloatingCube(ctx, cubeX, cubeY, cubeW, cubeH);

  // === REFLECTING POOL (foreground water with reflections) ===
  drawCantileverPool(ctx, x, poolY, w, poolH, {
    cubeX, cubeY, cubeW, cubeH,
    leftWingX, leftWingW,
    rightWingX, rightWingW,
    baseY, baseH,
    portalX, portalY, portalW, portalH,
    groundY
  });

  // Narrow strip of plaza/curb along the back edge of the pool
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(x, groundY - 2, w, 2);
  ctx.fillStyle = '#5a4830';
  ctx.fillRect(x, groundY, w, 2);
}

// THE FLOATING CUBE - the architectural centerpiece. A nearly-square
// glass-clad volume suspended above the plaza, with heavy diagonal X-truss
// bracing filling the entire envelope. The truss is dramatically visible
// through the translucent glass - it's both the building's structure AND
// its primary aesthetic moment.
function drawFloatingCube(ctx, x, y, w, h) {
  // === DEEP SHADOW BENEATH THE CUBE (essential to sell the floating mass) ===
  ctx.save();
  ctx.globalAlpha = 0.70;
  ctx.fillStyle = '#080410';
  ctx.fillRect(x - 8, y + h, w + 16, 6);
  ctx.globalAlpha = 0.40;
  ctx.fillRect(x - 8, y + h + 6, w + 16, 5);
  ctx.globalAlpha = 0.18;
  ctx.fillRect(x - 8, y + h + 11, w + 16, 5);
  ctx.restore();

  // === TOP CAP (thin parapet, lit by sky) ===
  const capH = 5;
  ctx.fillStyle = '#aa9d80';
  ctx.fillRect(x - 3, y, w + 6, capH);
  ctx.fillStyle = '#e0d4b8';
  ctx.fillRect(x - 3, y, w + 6, 1);
  ctx.fillStyle = '#5a4a38';
  ctx.fillRect(x - 3, y + capH - 1, w + 6, 1);

  // === BOTTOM SOFFIT (thicker, in shadow underneath) ===
  const soffH = 6;
  ctx.fillStyle = '#2a1e14';
  ctx.fillRect(x - 5, y + h - soffH, w + 10, soffH);
  ctx.fillStyle = '#5a4838';
  ctx.fillRect(x - 5, y + h - soffH, w + 10, 1);
  ctx.fillStyle = '#0a0608';
  ctx.fillRect(x - 5, y + h - 1, w + 10, 1);

  // === GLASS BODY (sunset-tinted, reflecting the sky) ===
  const bodyY = y + capH;
  const bodyH = h - capH - soffH;
  smoothGradientStops(ctx, x, bodyY, w, bodyH, [
    { t: 0, c: '#4a2c5c' },      // upper - cool sky reflection
    { t: 0.35, c: '#82486a' },   // mauve mid
    { t: 0.7, c: '#c66448' },    // coral reflection
    { t: 1, c: '#e89060' }       // warm lower
  ]);

  // === HORIZONTAL FLOOR LINES (3 stories) ===
  const floors = 3;
  const floorH = bodyH / floors;
  ctx.fillStyle = '#1a0e08';
  for (let f = 1; f < floors; f++) {
    ctx.fillRect(x, bodyY + Math.floor(f * floorH) - 1, w, 2);
  }
  // Floor slab front edges with a subtle warm highlight
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#ffb060';
  for (let f = 1; f < floors; f++) {
    ctx.fillRect(x + 2, bodyY + Math.floor(f * floorH), w - 4, 1);
  }
  ctx.restore();

  // === LIT OFFICE WINDOWS (warm interior glow showing through glass) ===
  // Each floor has a row of lit window strips - mostly lit at dusk.
  rseed((x * 5 + y * 11) & 0xffff);
  const winCount = Math.max(10, Math.floor(w / 32));
  const winSpacing = w / winCount;
  for (let f = 0; f < floors; f++) {
    const fY = bodyY + f * floorH + Math.floor(floorH * 0.15);
    const winH = Math.floor(floorH * 0.55);
    for (let i = 0; i < winCount; i++) {
      const wX = x + i * winSpacing + 2;
      const wW = winSpacing - 4;
      const lit = srand() > 0.18;
      if (lit) {
        ctx.fillStyle = '#fcc878';
        ctx.fillRect(wX, fY, wW, winH);
        ctx.fillStyle = '#fff0c8';
        ctx.fillRect(wX, fY, wW, 1);
      } else {
        ctx.fillStyle = '#5a3060';
        ctx.fillRect(wX, fY, wW, winH);
      }
    }
  }

  // === HEAVY DIAGONAL X-TRUSS BRACING (the signature visual element) ===
  // Drawn AFTER the windows so it overlays them, with stronger contrast.
  // Each truss bay is roughly square and spans full body height.
  ctx.save();
  ctx.strokeStyle = '#1a0e08';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.78;
  const trussBays = Math.max(4, Math.floor(w / 90));
  const trussBayW = w / trussBays;
  // Vertical bay dividers (heavy posts)
  for (let i = 0; i <= trussBays; i++) {
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(x + Math.floor(i * trussBayW) - 1, bodyY, 2, bodyH);
  }
  // X-bracing crossing each bay
  for (let i = 0; i < trussBays; i++) {
    const bx = x + i * trussBayW;
    ctx.beginPath();
    ctx.moveTo(bx + 3, bodyY + 3);
    ctx.lineTo(bx + trussBayW - 3, bodyY + bodyH - 3);
    ctx.moveTo(bx + trussBayW - 3, bodyY + 3);
    ctx.lineTo(bx + 3, bodyY + bodyH - 3);
    ctx.stroke();
  }
  ctx.restore();

  // === GLASS REFLECTIONS (subtle horizontal sheen bands) ===
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#ffe8c8';
  ctx.fillRect(x + 2, bodyY + 2, w - 4, 1);
  ctx.fillRect(x + 2, bodyY + Math.floor(bodyH * 0.5), w - 4, 1);
  ctx.restore();

  // === SUBTLE EDGE GLOW (warm sunset wrapping the cantilever ends) ===
  ctx.save();
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = '#ffb060';
  ctx.fillRect(x - 3, bodyY, 2, bodyH);
  ctx.fillRect(x + w + 1, bodyY, 2, bodyH);
  ctx.restore();
}

// Campus base wing - one half of the long continuous building that the
// cube sits on top of. Limestone piers + multi-story floor-to-ceiling
// glass curtain wall, warm office interiors visible at sunset.
function drawCampusBaseWing(ctx, x, y, w, h) {
  if (w <= 0) return;

  // Body shadow wash
  smoothGradientStops(ctx, x, y, w, h, [
    { t: 0, c: '#5a4838' },
    { t: 0.5, c: '#7a6850' },
    { t: 1, c: '#5e4c3a' }
  ]);

  // Limestone piers divide the facade into glass bays.
  const pierW = Math.max(4, Math.floor(w * 0.025));
  const targetBayW = 56;
  const bayCount = Math.max(3, Math.floor((w - pierW) / (targetBayW + pierW)));
  const bayW = (w - (bayCount + 1) * pierW) / bayCount;

  for (let p = 0; p <= bayCount; p++) {
    const px = x + p * (bayW + pierW);
    ctx.fillStyle = '#9a8d76';
    ctx.fillRect(px, y, pierW, h);
    ctx.fillStyle = '#c0b39a';
    ctx.fillRect(px, y, 1, h);
    ctx.fillStyle = '#5a4a38';
    ctx.fillRect(px + pierW - 1, y, 1, h);
  }

  // Glass bays - 3 stories of warm-lit office windows
  const floors = 3;
  const floorH = (h - 6) / floors;
  rseed((x * 3 + y * 7) & 0xffff);
  for (let b = 0; b < bayCount; b++) {
    const bX = x + pierW + b * (bayW + pierW);
    const bW = bayW;
    // Base glass tint
    ctx.fillStyle = '#3a2848';
    ctx.fillRect(bX, y + 3, bW, h - 6);

    for (let f = 0; f < floors; f++) {
      const fY = y + 3 + f * floorH;
      const lit = srand() > 0.20;
      const winH = Math.floor(floorH * 0.55);
      if (lit) {
        ctx.fillStyle = '#e8a868';
        ctx.fillRect(bX, fY + 2, bW, winH);
        ctx.fillStyle = '#fce0a0';
        ctx.fillRect(bX, fY + 2, bW, 1);
      } else {
        ctx.fillStyle = '#4a3858';
        ctx.fillRect(bX, fY + 2, bW, winH);
      }
      ctx.fillStyle = '#1a1208';
      ctx.fillRect(bX, fY + floorH - 2, bW, 2);
    }
    // Vertical mullions within each bay
    ctx.fillStyle = 'rgba(20,12,8,0.55)';
    ctx.fillRect(bX + Math.floor(bW / 2), y + 3, 1, h - 6);
  }

  // Top parapet (continuous cornice)
  ctx.fillStyle = '#aa9d80';
  ctx.fillRect(x, y, w, 4);
  ctx.fillStyle = '#d8cdb0';
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = '#5a4a38';
  ctx.fillRect(x, y + 4, w, 1);

  // Base shadow
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y + h, w, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x, y + h + 2, w, 2);
}

// Distant atmospheric building silhouettes - faded into haze for depth.
function drawDistantSilhouette(ctx, x, y, w, h) {
  rseed(x * 13 + 7);
  let cx = x;
  ctx.save();
  ctx.globalAlpha = 0.45;
  while (cx < x + w) {
    const bw = 30 + Math.floor(srand() * 60);
    const bh = 20 + Math.floor(srand() * (h - 6));
    ctx.fillStyle = '#2a1e30';
    ctx.fillRect(cx, y + h - bh, bw, bh);
    // A few lit windows
    ctx.fillStyle = '#caa860';
    for (let wy = y + h - bh + 4; wy < y + h - 4; wy += 6) {
      for (let wx = cx + 3; wx < cx + bw - 3; wx += 5) {
        if (srand() > 0.70) ctx.fillRect(wx, wy, 1, 1);
      }
    }
    cx += bw + 2;
  }
  ctx.restore();
}

// Cantilever-scene reflecting pool - foreground water that mirrors the
// architecture. Buildings appear upside-down in the water, faded with
// water-tint, surface ripples, and specular highlights. Separate from
// the simpler drawReflectingPool used in the Quad stage.
function drawCantileverPool(ctx, x, y, w, h, scene) {
  // Pool water base gradient - reflects the sunset sky (warm at far edge
  // where the sky is brightest, cooler/darker near).
  smoothGradientStops(ctx, x, y, w, h, [
    { t: 0, c: '#5a4060' },   // far edge - mirrors warm horizon
    { t: 0.3, c: '#3a3a60' }, // mid-far - mirrors mauve sky
    { t: 0.7, c: '#2a3858' }, // mid-near - cooler
    { t: 1, c: '#1a2848' }    // near edge - deepest
  ]);

  // === REFLECTIONS - drawn as flipped, water-tinted strips ===
  // Each building reflection: a downward strip starting at the waterline,
  // tinted with the water color, with surface ripple breaks built in.
  function reflectBuilding(bx, by, bw, bh, baseColor, accentColor, hasTruss) {
    // Reflected vertical extent: a building of height bh produces a reflection
    // up to bh long, starting at the waterline going DOWN.
    const reflLen = Math.min(bh, h);
    // Each pixel row in the reflection corresponds to a building row from bottom-up.
    // We draw it with alternating darker/lighter bands to suggest water tinting.
    for (let dy = 0; dy < reflLen; dy++) {
      // Vertical alpha falloff so reflection fades as it goes deeper
      const fade = 0.55 - 0.30 * (dy / reflLen);
      // Slight horizontal jitter for "water surface" wobble
      const jitter = Math.floor(Math.sin((bx + dy) * 0.18) * 1.5);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = dy % 6 < 3 ? baseColor : accentColor;
      ctx.fillRect(bx + jitter, y + dy, bw, 1);
      ctx.restore();
    }
    // Truss hint (X-bracing) showing through the reflection
    if (hasTruss && reflLen > 8) {
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = '#1a0e08';
      ctx.lineWidth = 1;
      const bays = Math.max(3, Math.floor(bw / 90));
      const bayW = bw / bays;
      for (let i = 0; i < bays; i++) {
        const bX2 = bx + i * bayW;
        const jit1 = Math.floor(Math.sin(bX2 * 0.18) * 1.5);
        const jit2 = Math.floor(Math.sin((bX2 + bayW) * 0.18) * 1.5);
        ctx.beginPath();
        ctx.moveTo(bX2 + 2 + jit1, y + 2);
        ctx.lineTo(bX2 + bayW - 2 + jit2, y + reflLen - 2);
        ctx.moveTo(bX2 + bayW - 2 + jit2, y + 2);
        ctx.lineTo(bX2 + 2 + jit1, y + reflLen - 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Cube reflection (with truss bracing showing through the water)
  reflectBuilding(scene.cubeX, scene.cubeY, scene.cubeW, scene.cubeH,
                  '#5a3850', '#3a2848', true);

  // Left and right wing reflections (the building base)
  reflectBuilding(scene.leftWingX, scene.baseY, scene.leftWingW, scene.baseH,
                  '#5a3848', '#3a2838', false);
  reflectBuilding(scene.rightWingX, scene.baseY, scene.rightWingW, scene.baseH,
                  '#5a3848', '#3a2838', false);

  // Warm-window streaks in the wing reflections (catching lit offices)
  function wingWindowStreaks(wx, ww, wh) {
    if (ww <= 0) return;
    ctx.save();
    ctx.globalAlpha = 0.40;
    ctx.fillStyle = '#e89858';
    for (let ry2 = 0; ry2 < Math.min(wh, h); ry2 += 9) {
      const jit = Math.floor(Math.sin((wx + ry2) * 0.18) * 1.5);
      ctx.fillRect(wx + 1 + jit, y + ry2, ww - 2, 2);
    }
    ctx.restore();
  }
  wingWindowStreaks(scene.leftWingX, scene.leftWingW, scene.baseH);
  wingWindowStreaks(scene.rightWingX, scene.rightWingW, scene.baseH);

  // Warm glow reflection from the archway entrance lit doorway
  ctx.save();
  ctx.globalAlpha = 0.50;
  ctx.fillStyle = '#fcc878';
  ctx.fillRect(scene.portalX + scene.portalW / 2 - 12, y, 24, 4);
  ctx.globalAlpha = 0.22;
  ctx.fillRect(scene.portalX, y, scene.portalW, 8);
  ctx.restore();

  // === SUNSET SKY REFLECTION wash on far portion of pool ===
  // Where the architecture doesn't cover the water, the sky reflects too.
  ctx.save();
  ctx.globalAlpha = 0.30;
  smoothGradientStops(ctx, x, y, w, Math.floor(h * 0.4), [
    { t: 0, c: '#f8a868' },
    { t: 1, c: '#5a4068' }
  ]);
  ctx.restore();

  // === SURFACE HIGHLIGHTS (specular sheen + ripple lines) ===
  // The waterline highlight - a bright horizontal sheen at the top
  ctx.fillStyle = 'rgba(220,200,180,0.45)';
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = 'rgba(255,230,200,0.18)';
  ctx.fillRect(x, y + 1, w, 1);

  // Scattered ripple highlights (broken thin lines)
  rseed(1515);
  ctx.save();
  for (let i = 0; i < Math.floor(w / 14); i++) {
    const rx = x + Math.floor(srand() * w);
    const ry2 = y + 2 + Math.floor(srand() * (h - 4));
    const rw = 6 + Math.floor(srand() * 18);
    ctx.globalAlpha = 0.30 + srand() * 0.35;
    ctx.fillStyle = '#e8f4f8';
    ctx.fillRect(rx, ry2, rw, 1);
  }
  ctx.restore();

  // === FAR-EDGE POOL CURB SHADOW ===
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, 1);
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
  // stage3.png is now a hand-curated photoreal render placed manually into
  // public/sprites/. Keep the renderer here for reference but skip writing
  // so this script doesn't clobber it.
  { name: 'stage3.png', label: 'Lobby', width: 2500, render: renderLobbyStage, skip: true },
  { name: 'stage4.png', label: 'Server Room', width: 1500, render: renderServerRoomStage }
];

console.log('Generating stage PNGs...');

const outDir = path.join(__dirname, '..', 'public', 'sprites');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

let totalSize = 0;
let written = 0;
STAGES.forEach(stage => {
  if (stage.skip) {
    console.log(`  ${stage.label} (${stage.name}) - SKIPPED (manually curated)`);
    return;
  }
  console.log(`  ${stage.label} (${stage.width}x${HEIGHT})...`);
  rseed(stage.name.charCodeAt(5) * 1000);
  const canvas = stage.render(stage.width);
  const buffer = canvas.toBuffer('image/png');
  const outPath = path.join(outDir, stage.name);
  fs.writeFileSync(outPath, buffer);
  totalSize += buffer.length;
  written++;
  console.log(`    saved ${stage.name} (${(buffer.length / 1024).toFixed(1)} KB)`);
});

console.log(`\n✓ ${written} stage(s) generated`);
console.log(`  Total size: ${(totalSize / 1024).toFixed(1)} KB`);
