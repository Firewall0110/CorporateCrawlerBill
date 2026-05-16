/**
 * Generate a 5000x700 PNG of the entire CorporateCrawlerBill stage
 * with 4 detailed biomes laid out left-to-right.
 *
 * Zones (must match GameRoom.js zoneConfig):
 *   Parking Lot (0-1500) - Industrial urban, dawn lighting
 *   Quad        (1500-3000) - Tech campus park, bright day
 *   Lobby       (3000-4500) - Modern corporate interior
 *   Elevators   (4500-5000) - Server room boss arena
 *
 * Run: npm run stage:gen
 *   (installs @napi-rs/canvas ad-hoc, then runs this script)
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const WIDTH = 5000;
const HEIGHT = 700;
const GROUND_LEVEL = 600;
const PLAY_AREA_TOP = 380;

const ZONES = [
  { name: 'Parking Lot', start: 0, end: 1500, theme: 'parkingLot' },
  { name: 'Quad', start: 1500, end: 3000, theme: 'quad' },
  { name: 'Lobby', start: 3000, end: 4500, theme: 'lobby' },
  { name: 'Elevators', start: 4500, end: 5000, theme: 'elevators' }
];

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ============================================================
// HELPERS
// ============================================================
let seed = 24601;
function srand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function rseed(s) { seed = s; }

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

// Bayer 4x4 dither matrix (0-15)
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

// Render a dithered gradient band from color1 to color2 across the rectangle.
// Creates a classic SNES-style stippled gradient look.
function ditheredVerticalGradient(x, y, w, h, color1, color2) {
  const c1 = parseColor(color1);
  const c2 = parseColor(color2);
  const img = ctx.getImageData(x, y, w, h);
  const data = img.data;
  for (let py = 0; py < h; py++) {
    const t = py / Math.max(1, h - 1); // 0..1
    for (let px = 0; px < w; px++) {
      const bayer = BAYER[py % 4][px % 4] / 16; // 0..1
      // Threshold mix - either pick color1 or color2 based on bayer offset
      const useC1 = t < bayer;
      const c = useC1 ? c1 : c2;
      const i = (py * w + px) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, x, y);
}

// Multi-stop dithered gradient (3+ colors)
function ditheredGradientStops(x, y, w, h, stops) {
  const img = ctx.getImageData(x, y, w, h);
  const data = img.data;
  const parsedStops = stops.map(s => ({ t: s.t, c: parseColor(s.c) }));
  for (let py = 0; py < h; py++) {
    const tn = py / Math.max(1, h - 1);
    // Find current band
    let lower = parsedStops[0], upper = parsedStops[parsedStops.length - 1];
    for (let i = 0; i < parsedStops.length - 1; i++) {
      if (tn >= parsedStops[i].t && tn <= parsedStops[i + 1].t) {
        lower = parsedStops[i];
        upper = parsedStops[i + 1];
        break;
      }
    }
    const bandT = (tn - lower.t) / Math.max(0.0001, upper.t - lower.t);
    for (let px = 0; px < w; px++) {
      const bayer = BAYER[py % 4][px % 4] / 16;
      const useLower = bandT < bayer;
      const c = useLower ? lower.c : upper.c;
      const i = (py * w + px) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, x, y);
}

function parseColor(hex) {
  const c = hex.replace('#', '');
  return [
    parseInt(c.substring(0, 2), 16),
    parseInt(c.substring(2, 4), 16),
    parseInt(c.substring(4, 6), 16)
  ];
}

// Pixel-perfect 1-pixel dot
function px(x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

// Quick outlined box
function outlinedBox(x, y, w, h, fill, outline) {
  ctx.fillStyle = outline;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}

// ============================================================
// PARKING LOT (0-1500): Industrial dawn, asphalt, garage, cars
// ============================================================
function renderParkingLot(zone) {
  const W = zone.end - zone.start;
  const X0 = zone.start;

  // --- Sky: dawn gradient (dark blue -> orange-pink near horizon) ---
  ditheredGradientStops(X0, 0, W, 200, [
    { t: 0.0, c: '#0e1838' },
    { t: 0.5, c: '#3a3e6e' },
    { t: 0.85, c: '#a86c5a' },
    { t: 1.0, c: '#e8b478' }
  ]);
  // Hard band of sky to PLAY_AREA_TOP
  ditheredGradientStops(X0, 200, W, PLAY_AREA_TOP - 200, [
    { t: 0.0, c: '#e8b478' },
    { t: 1.0, c: '#5a5a78' }
  ]);

  // Stars in the upper sky (rare twinkle dots)
  rseed(101);
  for (let i = 0; i < 60; i++) {
    const sx = X0 + Math.floor(srand() * W);
    const sy = Math.floor(srand() * 120);
    px(sx, sy, srand() > 0.7 ? '#ffffff' : '#bcc8e8');
  }

  // Distant skyline silhouette (very dark)
  rseed(202);
  const skylineY = 200;
  let cursor = X0;
  while (cursor < zone.end) {
    const bw = 30 + Math.floor(srand() * 70);
    const bh = 50 + Math.floor(srand() * 120);
    ctx.fillStyle = '#1a1828';
    ctx.fillRect(cursor, skylineY, bw, bh);
    // Tiny window dots
    ctx.fillStyle = '#bcae6c';
    for (let wy = skylineY + 4; wy < skylineY + bh - 4; wy += 6) {
      for (let wx = cursor + 3; wx < cursor + bw - 3; wx += 5) {
        if (srand() > 0.55) px(wx, wy, '#d4b66c');
      }
    }
    cursor += bw + 2;
  }

  // Mid-distance buildings (clearly office buildings, lit windows)
  rseed(303);
  const midBuildings = [
    { x: X0 + 80, h: 240, w: 110, color: '#3a3a52', accent: '#5a5a78' },
    { x: X0 + 220, h: 200, w: 85, color: '#4a3a48', accent: '#6a5a68' },
    { x: X0 + 330, h: 280, w: 130, color: '#2a2a44', accent: '#4a4a64' },
    { x: X0 + 490, h: 180, w: 95, color: '#3a3a4a', accent: '#5a5a6a' },
    { x: X0 + 610, h: 250, w: 115, color: '#4a3a52', accent: '#6a5a72' },
    { x: X0 + 760, h: 220, w: 100, color: '#2a3242', accent: '#4a5262' },
    { x: X0 + 880, h: 290, w: 140, color: '#3a3242', accent: '#5a5262' },
    { x: X0 + 1050, h: 200, w: 90, color: '#3a3a4a', accent: '#5a5a6a' },
    { x: X0 + 1170, h: 250, w: 110, color: '#2a2a3a', accent: '#4a4a5a' },
    { x: X0 + 1300, h: 220, w: 105, color: '#3a2a42', accent: '#5a4a62' },
  ];
  midBuildings.forEach(b => drawDetailedBuilding(b.x, PLAY_AREA_TOP - b.h, b.w, b.h, b.color, b.accent, srand));

  // Multi-story parking garage on left (signature landmark)
  drawParkingGarage(X0 + 60, 220, 280, 160);

  // Power line poles + wires (foreground depth)
  rseed(404);
  for (let i = 0; i < 4; i++) {
    const px2 = X0 + 200 + i * 350;
    drawPowerPole(px2, 260);
  }
  // Wires between poles
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X0 + 200, 280);
  for (let i = 1; i < 4; i++) ctx.lineTo(X0 + 200 + i * 350, 280);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(X0 + 200, 284);
  for (let i = 1; i < 4; i++) ctx.lineTo(X0 + 200 + i * 350, 284);
  ctx.stroke();

  // Back wall band (the "back of the play area")
  ditheredGradientStops(X0, 320, W, 60, [
    { t: 0, c: '#2a262e' },
    { t: 1, c: '#3a363e' }
  ]);

  // --- Floor: asphalt with extensive detailing ---
  drawAsphaltFloor(X0, PLAY_AREA_TOP, W, HEIGHT - PLAY_AREA_TOP);

  // Parking stripes (long, diagonal)
  for (let i = 0; i < 7; i++) {
    const sx = X0 + 80 + i * 200;
    ctx.fillStyle = '#e8c200';
    ctx.fillRect(sx, PLAY_AREA_TOP + 80, 6, 80);
    ctx.fillStyle = '#fff088';
    ctx.fillRect(sx, PLAY_AREA_TOP + 80, 2, 80);
  }

  // White crosswalk-style stripes near right edge of zone
  for (let i = 0; i < 8; i++) {
    const csx = X0 + W - 200 + i * 20;
    ctx.fillStyle = '#d8d8e0';
    ctx.fillRect(csx, PLAY_AREA_TOP + 220, 12, 18);
  }

  // Manhole covers
  drawManhole(X0 + 280, PLAY_AREA_TOP + 180);
  drawManhole(X0 + 920, PLAY_AREA_TOP + 250);

  // Oil stains
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  drawOilStain(X0 + 160, PLAY_AREA_TOP + 140, 1);
  drawOilStain(X0 + 540, PLAY_AREA_TOP + 200, -1);
  drawOilStain(X0 + 1080, PLAY_AREA_TOP + 270, 1);

  // --- Foreground props: variety of cars, lamps, hydrants ---
  rseed(505);
  // Cars at varied depths
  drawCar(X0 + 130, PLAY_AREA_TOP + 75, '#cc3340', 'sedan');
  drawCar(X0 + 290, PLAY_AREA_TOP + 175, '#3744cc', 'truck');
  drawCar(X0 + 460, PLAY_AREA_TOP + 60, '#dddddd', 'sedan');
  drawCar(X0 + 620, PLAY_AREA_TOP + 200, '#ccaa33', 'taxi');
  drawCar(X0 + 800, PLAY_AREA_TOP + 90, '#2a8a3a', 'sedan');
  drawCar(X0 + 960, PLAY_AREA_TOP + 170, '#883344', 'truck');
  drawCar(X0 + 1120, PLAY_AREA_TOP + 70, '#3a3a44', 'sedan');
  drawCar(X0 + 1290, PLAY_AREA_TOP + 190, '#aa6633', 'taxi');

  // Streetlights (with halo glow)
  drawStreetlight(X0 + 200, PLAY_AREA_TOP - 60, true);
  drawStreetlight(X0 + 700, PLAY_AREA_TOP - 60, true);
  drawStreetlight(X0 + 1200, PLAY_AREA_TOP - 60, true);

  // Fire hydrant
  drawHydrant(X0 + 380, PLAY_AREA_TOP + 100);
  drawHydrant(X0 + 1050, PLAY_AREA_TOP + 110);

  // Dumpster
  drawDumpster(X0 + 880, PLAY_AREA_TOP + 80);

  // Trash cans
  drawTrashCan(X0 + 520, PLAY_AREA_TOP + 130);
  drawTrashCan(X0 + 1250, PLAY_AREA_TOP + 130);

  // No parking sign
  drawNoParkingSign(X0 + 1100, PLAY_AREA_TOP - 30);

  // Birds on the wires
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(X0 + 380, 278, 2, 3);
  ctx.fillRect(X0 + 540, 278, 2, 3);
  ctx.fillRect(X0 + 720, 278, 2, 3);
  ctx.fillRect(X0 + 1080, 278, 2, 3);

  // Floor edge highlight
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(X0, PLAY_AREA_TOP, W, 1);
  ctx.restore();
}

function drawDetailedBuilding(x, y, w, h, color, accent, rand) {
  // Body
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  // Outline (1px darker on left + bottom)
  ctx.fillStyle = darken(color, 0.5);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = darken(color, 0.4);
  ctx.fillRect(x + w - 1, y, 1, h);
  // Roof crown
  ctx.fillStyle = darken(color, 0.6);
  ctx.fillRect(x, y, w, 4);
  // Windows
  const winColors = ['#fff388', '#ffd960', '#88ccff', '#aaeeff', '#332a44'];
  const winW = 6, winH = 8, gapX = 4, gapY = 5;
  const rows = Math.floor((h - 10) / (winH + gapY));
  const cols = Math.floor((w - 8) / (winW + gapX));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = x + 4 + c * (winW + gapX);
      const wy = y + 6 + r * (winH + gapY);
      // Window frame
      ctx.fillStyle = darken(color, 0.4);
      ctx.fillRect(wx - 1, wy - 1, winW + 2, winH + 2);
      // Glass
      const idx = (r * cols + c * 3) % winColors.length;
      const isDark = (rand() > 0.6);
      ctx.fillStyle = isDark ? '#1a1828' : winColors[idx];
      ctx.fillRect(wx, wy, winW, winH);
      // Highlight
      if (!isDark) {
        ctx.fillStyle = lighten(winColors[idx], 0.3);
        ctx.fillRect(wx, wy, 1, 1);
        ctx.fillRect(wx + winW - 1, wy + winH - 1, 1, 1);
      }
    }
  }
  // Antenna on some tall buildings
  if (h > 220 && rand() > 0.5) {
    const ax = x + Math.floor(w / 2) - 1;
    ctx.fillStyle = '#666';
    ctx.fillRect(ax, y - 18, 2, 18);
    ctx.fillStyle = '#ff2a2a';
    ctx.fillRect(ax - 1, y - 20, 4, 2);
  }
  // Edge accent (right side highlight)
  ctx.fillStyle = lighten(color, 0.1);
  ctx.fillRect(x + w - 2, y + 4, 1, h - 4);
}

function drawParkingGarage(x, y, w, h) {
  // Body
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x, y, w, h);
  // Top trim
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x, y, w, 6);
  // Sign on top
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + w / 2 - 30, y - 12, 60, 14);
  ctx.fillStyle = '#5cf2ff';
  ctx.fillRect(x + w / 2 - 26, y - 9, 8, 8);
  ctx.fillRect(x + w / 2 - 16, y - 9, 8, 8);
  ctx.fillRect(x + w / 2 - 6, y - 9, 8, 8);
  ctx.fillRect(x + w / 2 + 4, y - 9, 4, 8);
  // 4 floors with cars visible inside
  const floors = 4;
  const floorH = (h - 6) / floors;
  for (let f = 0; f < floors; f++) {
    const fy = y + 6 + f * floorH;
    // Floor slab
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(x, fy, w, 4);
    // Inside dark
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(x + 4, fy + 4, w - 8, floorH - 6);
    // Vertical columns
    ctx.fillStyle = '#4a4a54';
    for (let cx = x + 4; cx < x + w - 4; cx += 60) {
      ctx.fillRect(cx, fy + 4, 4, floorH - 6);
    }
    // Cars peeking out (small)
    for (let c = 0; c < 4; c++) {
      const cx = x + 14 + c * 60 + (srand() * 10);
      const cy = fy + floorH - 14;
      if (cx + 30 > x + w - 4) break;
      const carColors = ['#cc3340', '#3744cc', '#ccaa33', '#dddddd', '#2a8a3a'];
      ctx.fillStyle = carColors[Math.floor(srand() * carColors.length)];
      ctx.fillRect(cx, cy, 22, 9);
      ctx.fillStyle = '#88ccee';
      ctx.fillRect(cx + 3, cy + 1, 16, 3);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx + 2, cy + 7, 4, 3);
      ctx.fillRect(cx + 16, cy + 7, 4, 3);
    }
  }
  // Entry/exit hole at ground floor
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(x + w / 2 - 18, y + h - 30, 36, 30);
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(x + w / 2 - 18, y + h - 33, 36, 3); // Arrow strip
  // Side outline
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);
}

function drawPowerPole(x, baseY) {
  // Wooden pole
  ctx.fillStyle = '#5a3a1e';
  ctx.fillRect(x, baseY, 4, 110);
  ctx.fillStyle = '#7a5a3e';
  ctx.fillRect(x, baseY, 1, 110);
  // Cross-beam
  ctx.fillStyle = '#5a3a1e';
  ctx.fillRect(x - 14, baseY + 14, 32, 4);
  // Insulators
  ctx.fillStyle = '#e0e0d0';
  ctx.fillRect(x - 14, baseY + 11, 3, 3);
  ctx.fillRect(x + 2, baseY + 11, 3, 3);
  ctx.fillRect(x + 16, baseY + 11, 3, 3);
}

function drawAsphaltFloor(x, y, w, h) {
  // Base
  ctx.fillStyle = '#2a2a2e';
  ctx.fillRect(x, y, w, h);
  // Tiled detail (specks every 32px)
  for (let tx = x; tx < x + w; tx += 32) {
    for (let ty = y; ty < y + h; ty += 32) {
      // Light specks
      ctx.fillStyle = '#3a3a40';
      const lightSpots = [[3, 5], [12, 8], [22, 14], [6, 20], [18, 25], [27, 6], [10, 28]];
      lightSpots.forEach(([dx, dy]) => ctx.fillRect(tx + dx, ty + dy, 1, 1));
      // Dark specks
      ctx.fillStyle = '#1a1a1e';
      const darkSpots = [[8, 3], [25, 18], [4, 14], [16, 22], [29, 26], [20, 8]];
      darkSpots.forEach(([dx, dy]) => ctx.fillRect(tx + dx, ty + dy, 1, 1));
    }
  }
  // Long crack
  ctx.fillStyle = '#1a1a1e';
  let cx = x + 100, cy = y + 60;
  for (let i = 0; i < 30; i++) {
    ctx.fillRect(cx, cy, 1, 1);
    cx += 1 + Math.floor(srand() * 2);
    cy += Math.floor(srand() * 3) - 1;
  }
}

function drawManhole(x, y) {
  ctx.fillStyle = '#1a1a1e';
  ctx.beginPath();
  ctx.ellipse(x + 20, y, 22, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Rim
  ctx.fillStyle = '#3a3a3e';
  ctx.beginPath();
  ctx.ellipse(x + 20, y, 18, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pattern dots
  ctx.fillStyle = '#1a1a1e';
  for (let i = -6; i <= 6; i += 3) {
    ctx.fillRect(x + 20 + i, y - 1, 1, 2);
  }
}

function drawOilStain(x, y, dir) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + dir * 8, y + 2, 10, 3, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawCar(x, y, color, type) {
  type = type || 'sedan';
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x + 30, y + 36, 32, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Wheels
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
    // Truck = taller cabin + bed
    ctx.fillStyle = color;
    ctx.fillRect(x + 2, y + 14, 56, 14);
    ctx.fillRect(x + 12, y + 2, 24, 14);
    // Cab window
    ctx.fillStyle = '#88ccee';
    ctx.fillRect(x + 14, y + 4, 20, 10);
    // Bed
    ctx.fillStyle = darken(color, 0.7);
    ctx.fillRect(x + 36, y + 14, 22, 14);
    // Highlight
    ctx.fillStyle = lighten(color, 0.25);
    ctx.fillRect(x + 2, y + 14, 56, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x + 16, y + 5, 4, 1);
  } else if (type === 'taxi') {
    // Taxi = yellow body, checker stripe
    ctx.fillStyle = color;
    ctx.fillRect(x + 2, y + 16, 56, 12);
    ctx.fillRect(x + 14, y + 6, 32, 12);
    // Window
    ctx.fillStyle = '#88ccee';
    ctx.fillRect(x + 16, y + 8, 28, 8);
    // Checker stripe
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x + 2, y + 21, 56, 3);
    ctx.fillStyle = color;
    for (let i = 0; i < 28; i++) {
      if (i % 2 === 0) ctx.fillRect(x + 2 + i * 2, y + 21, 2, 3);
    }
    // Body shading
    ctx.fillStyle = lighten(color, 0.2);
    ctx.fillRect(x + 2, y + 16, 56, 1);
    // Taxi sign on top
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(x + 24, y, 12, 6);
    ctx.fillStyle = '#ffd00';
    ctx.fillRect(x + 26, y + 2, 8, 2);
  } else {
    // Sedan (default)
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
  // Headlight
  ctx.fillStyle = '#ffffaa';
  ctx.fillRect(x + 56, y + 18, 3, 4);
  // Door handle
  ctx.fillStyle = darken(color, 0.5);
  ctx.fillRect(x + 30, y + 22, 4, 1);
}

function drawStreetlight(x, baseY, withHalo) {
  // Pole
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 8, baseY, 4, 130);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x + 8, baseY, 1, 130);
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(x + 4, baseY + 124, 12, 8);
  // Lamp head
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(x + 2, baseY - 6, 16, 10);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x + 2, baseY - 6, 16, 1);
  // Light source
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(x + 4, baseY - 4, 12, 6);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 7, baseY - 3, 6, 2);
  // Halo
  if (withHalo) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.arc(x + 10, baseY - 1, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(x + 10, baseY - 1, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawHydrant(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x - 2, y + 28, 18, 3);
  ctx.fillStyle = '#cc2a2a';
  ctx.fillRect(x, y + 8, 14, 22);
  // Top dome
  ctx.fillStyle = '#cc2a2a';
  ctx.fillRect(x + 2, y + 2, 10, 8);
  ctx.fillStyle = '#882020';
  ctx.fillRect(x + 4, y + 2, 6, 2);
  // Highlight
  ctx.fillStyle = '#ff5a5a';
  ctx.fillRect(x + 1, y + 8, 1, 22);
  // Side nozzles
  ctx.fillStyle = '#882020';
  ctx.fillRect(x - 2, y + 14, 4, 5);
  ctx.fillRect(x + 12, y + 14, 4, 5);
  // Cap
  ctx.fillStyle = '#882020';
  ctx.fillRect(x + 4, y, 6, 4);
  ctx.fillStyle = '#552020';
  ctx.fillRect(x + 5, y + 1, 4, 2);
}

function drawDumpster(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 2, y + 42, 80, 4);
  // Body
  ctx.fillStyle = '#2a5a3a';
  ctx.fillRect(x, y + 8, 84, 34);
  // Top lid
  ctx.fillStyle = '#1a4a2a';
  ctx.fillRect(x - 2, y + 4, 88, 6);
  // Highlight
  ctx.fillStyle = '#4a7a4a';
  ctx.fillRect(x, y + 8, 84, 1);
  // Ribs
  ctx.fillStyle = '#1a4a2a';
  ctx.fillRect(x + 15, y + 10, 1, 30);
  ctx.fillRect(x + 35, y + 10, 1, 30);
  ctx.fillRect(x + 55, y + 10, 1, 30);
  ctx.fillRect(x + 75, y + 10, 1, 30);
  // Wheels
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 6, y + 38, 6, 8);
  ctx.fillRect(x + 70, y + 38, 6, 8);
  // Graffiti tag
  ctx.fillStyle = '#ee44aa';
  ctx.fillRect(x + 22, y + 20, 12, 2);
  ctx.fillRect(x + 22, y + 24, 4, 4);
  ctx.fillRect(x + 30, y + 24, 4, 4);
  ctx.fillStyle = '#ff77cc';
  ctx.fillRect(x + 25, y + 21, 1, 1);
}

function drawTrashCan(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x - 2, y + 32, 22, 3);
  ctx.fillStyle = '#4a4a52';
  ctx.fillRect(x, y + 4, 18, 30);
  // Lid
  ctx.fillStyle = '#3a3a42';
  ctx.fillRect(x - 1, y, 20, 6);
  // Highlight
  ctx.fillStyle = '#6a6a72';
  ctx.fillRect(x, y + 4, 1, 30);
  // Ribs
  ctx.fillStyle = '#3a3a42';
  ctx.fillRect(x + 1, y + 10, 16, 1);
  ctx.fillRect(x + 1, y + 18, 16, 1);
  ctx.fillRect(x + 1, y + 26, 16, 1);
}

function drawNoParkingSign(x, y) {
  // Pole
  ctx.fillStyle = '#888';
  ctx.fillRect(x + 6, y, 2, 70);
  // Sign
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 6, y, 24, 18);
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x - 6, y, 24, 2);
  ctx.fillRect(x - 6, y + 16, 24, 2);
  // "NO" text
  ctx.fillStyle = '#cc1a1a';
  ctx.fillRect(x - 2, y + 4, 3, 10);
  ctx.fillRect(x + 2, y + 4, 1, 10);
  ctx.fillRect(x + 4, y + 4, 3, 10);
  ctx.fillRect(x + 8, y + 4, 1, 10);
  ctx.fillRect(x + 10, y + 4, 3, 10);
  // Red slash
  ctx.save();
  ctx.translate(x + 6, y + 9);
  ctx.rotate(-Math.PI / 6);
  ctx.fillStyle = '#cc1a1a';
  ctx.fillRect(-13, -1, 26, 2);
  ctx.restore();
}

// ============================================================
// QUAD (1500-3000): Tech campus park, bright day, fountain
// ============================================================
function renderQuad(zone) {
  const W = zone.end - zone.start;
  const X0 = zone.start;

  // Sky: bright blue daytime
  ditheredGradientStops(X0, 0, W, PLAY_AREA_TOP, [
    { t: 0, c: '#3a7ac8' },
    { t: 0.4, c: '#6aaee0' },
    { t: 0.85, c: '#a8cce8' },
    { t: 1.0, c: '#d4e4ec' }
  ]);

  // Sun
  ctx.fillStyle = 'rgba(255,250,200,0.9)';
  ctx.beginPath();
  ctx.arc(X0 + 200, 80, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,220,0.6)';
  ctx.beginPath();
  ctx.arc(X0 + 200, 80, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(X0 + 200, 80, 14, 0, Math.PI * 2);
  ctx.fill();

  // Distant mountains (silhouette)
  ctx.fillStyle = 'rgba(80,100,140,0.4)';
  let mx = X0;
  while (mx < zone.end) {
    const mh = 20 + Math.floor(srand() * 30);
    const mw = 80 + Math.floor(srand() * 60);
    ctx.beginPath();
    ctx.moveTo(mx, 180);
    ctx.lineTo(mx + mw / 2, 180 - mh);
    ctx.lineTo(mx + mw, 180);
    ctx.closePath();
    ctx.fill();
    mx += mw - 20;
  }

  // Fluffy clouds
  rseed(606);
  for (let i = 0; i < 7; i++) {
    drawFluffyCloud(X0 + 50 + i * 200 + srand() * 80, 50 + srand() * 80);
  }

  // Background tech buildings (lighter, more modern)
  rseed(707);
  const quadBuildings = [
    { x: X0 + 40, h: 200, w: 100, color: '#7a8ab0', accent: '#aabacc' },
    { x: X0 + 160, h: 240, w: 120, color: '#88a0b8', accent: '#aabacc' },
    { x: X0 + 300, h: 180, w: 90, color: '#6a8aa0', accent: '#88aabc' },
    { x: X0 + 410, h: 220, w: 100, color: '#7898ac', accent: '#aabacc' },
    { x: X0 + 530, h: 260, w: 130, color: '#9aafcc', accent: '#bccddd' },
    { x: X0 + 680, h: 190, w: 95, color: '#7a98bc', accent: '#aabacc' },
    { x: X0 + 800, h: 230, w: 110, color: '#88a8bc', accent: '#aacaca' },
    { x: X0 + 930, h: 200, w: 100, color: '#7a98ac', accent: '#aabacc' },
    { x: X0 + 1050, h: 240, w: 120, color: '#88a0bc', accent: '#aabacc' },
    { x: X0 + 1190, h: 180, w: 90, color: '#6a8aa0', accent: '#88aabc' },
    { x: X0 + 1300, h: 220, w: 100, color: '#7898ac', accent: '#aabacc' },
    { x: X0 + 1420, h: 200, w: 80, color: '#88a0b8', accent: '#aabacc' }
  ];
  quadBuildings.forEach(b => drawDetailedBuilding(b.x, PLAY_AREA_TOP - b.h, b.w, b.h, b.color, b.accent, srand));

  // Tech company sign on tallest building
  drawCompanySign(X0 + 590, 130, 'TECHCORP');

  // Back wall - green hedge line
  ditheredGradientStops(X0, 320, W, 60, [
    { t: 0, c: '#3a6a3a' },
    { t: 1, c: '#5a8a5a' }
  ]);
  // Hedge texture
  rseed(808);
  for (let i = 0; i < 200; i++) {
    const hx = X0 + Math.floor(srand() * W);
    const hy = 322 + Math.floor(srand() * 56);
    ctx.fillStyle = srand() > 0.5 ? '#4a7a4a' : '#2a5a2a';
    ctx.fillRect(hx, hy, 2, 2);
  }

  // Grass floor
  drawGrassFloor(X0, PLAY_AREA_TOP, W, HEIGHT - PLAY_AREA_TOP);

  // Concrete walking path (winds through)
  drawWindingPath(X0, PLAY_AREA_TOP, W);

  // Floor edge highlight
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(X0, PLAY_AREA_TOP, W, 1);
  ctx.restore();

  // Centerpiece fountain
  drawFountain(X0 + W / 2 - 60, PLAY_AREA_TOP + 60);

  // Statue
  drawStatue(X0 + W * 0.18, PLAY_AREA_TOP + 50);

  // Props: trees, benches, hedges, flowers
  rseed(909);
  // Big oak trees at varied depths
  drawOakTree(X0 + 80, PLAY_AREA_TOP - 60);
  drawOakTree(X0 + 380, PLAY_AREA_TOP - 30);
  drawOakTree(X0 + 1100, PLAY_AREA_TOP - 50);
  drawOakTree(X0 + 1400, PLAY_AREA_TOP - 70);

  // Palm trees for variety
  drawPalmTree(X0 + 240, PLAY_AREA_TOP - 40);
  drawPalmTree(X0 + 1280, PLAY_AREA_TOP - 35);

  // Benches around the fountain
  drawFancyBench(X0 + W / 2 - 180, PLAY_AREA_TOP + 130);
  drawFancyBench(X0 + W / 2 + 100, PLAY_AREA_TOP + 130);
  drawFancyBench(X0 + W * 0.18 - 80, PLAY_AREA_TOP + 110);
  drawFancyBench(X0 + W * 0.18 + 60, PLAY_AREA_TOP + 110);

  // Hedges (lower-back area)
  drawHedge(X0 + 480, PLAY_AREA_TOP + 70);
  drawHedge(X0 + 560, PLAY_AREA_TOP + 70);
  drawHedge(X0 + 980, PLAY_AREA_TOP + 80);
  drawHedge(X0 + 1060, PLAY_AREA_TOP + 80);

  // Flower beds (foreground)
  drawFlowerBed(X0 + 160, PLAY_AREA_TOP + 170, '#ff66cc');
  drawFlowerBed(X0 + 760, PLAY_AREA_TOP + 200, '#ffdd33');
  drawFlowerBed(X0 + 1180, PLAY_AREA_TOP + 180, '#ee5544');

  // Decorative lamp posts
  drawDecorativeLamp(X0 + 220, PLAY_AREA_TOP - 80);
  drawDecorativeLamp(X0 + 900, PLAY_AREA_TOP - 80);

  // Coffee cart
  drawCoffeeCart(X0 + 1200, PLAY_AREA_TOP + 60);

  // Birds in sky
  drawBird(X0 + 350, 120);
  drawBird(X0 + 370, 130);
  drawBird(X0 + 380, 125);
}

function drawFluffyCloud(x, y) {
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#ffffff';
  // Multi-puff cloud
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.arc(x + 20, y - 6, 18, 0, Math.PI * 2);
  ctx.arc(x + 42, y, 14, 0, Math.PI * 2);
  ctx.arc(x + 30, y + 8, 14, 0, Math.PI * 2);
  ctx.fill();
  // Shadow underside
  ctx.fillStyle = '#dadce6';
  ctx.beginPath();
  ctx.arc(x + 8, y + 10, 14, 0, Math.PI * 2);
  ctx.arc(x + 30, y + 12, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCompanySign(x, y, text) {
  // Backing rectangle
  ctx.fillStyle = '#0a4a8a';
  ctx.fillRect(x - 8, y, text.length * 12 + 16, 28);
  ctx.fillStyle = '#1a6abc';
  ctx.fillRect(x - 8, y, text.length * 12 + 16, 4);
  // Faux text (just colored squares; canvas font is too narrow for pixel-perfect)
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < text.length; i++) {
    const cx = x + i * 12 + 2;
    ctx.fillRect(cx, y + 8, 8, 12);
    ctx.fillStyle = '#1a6abc';
    ctx.fillRect(cx + 2, y + 10, 4, 8);
    ctx.fillStyle = '#ffffff';
  }
}

function drawGrassFloor(x, y, w, h) {
  // Base grass with subtle dithered band
  ditheredGradientStops(x, y, w, h, [
    { t: 0, c: '#4a8a4a' },
    { t: 0.3, c: '#5aa05a' },
    { t: 0.7, c: '#3a7a3a' },
    { t: 1, c: '#2a6a2a' }
  ]);
  // Per-tile grass blades
  rseed(1010);
  for (let tx = x; tx < x + w; tx += 32) {
    for (let ty = y; ty < y + h; ty += 32) {
      // Light blades
      ctx.fillStyle = '#6abc6a';
      const blades = [[2, 4], [7, 8], [14, 3], [22, 9], [28, 6], [4, 16], [11, 22], [19, 18]];
      blades.forEach(([dx, dy]) => ctx.fillRect(tx + dx, ty + dy, 1, 2));
      // Dark spots
      ctx.fillStyle = '#3a6a3a';
      const dark = [[6, 5], [13, 11], [20, 7], [26, 13]];
      dark.forEach(([dx, dy]) => ctx.fillRect(tx + dx, ty + dy, 1, 1));
    }
  }
}

function drawWindingPath(x, y, w) {
  // Path runs across the bottom 60 px of play area, slightly curving
  for (let px2 = x; px2 < x + w; px2 += 1) {
    const t = (px2 - x) / w;
    const pathY = y + 130 + Math.sin(t * Math.PI * 3) * 8;
    // Path is 40px wide
    ctx.fillStyle = '#c8b898';
    ctx.fillRect(px2, pathY, 1, 40);
    // Edges
    ctx.fillStyle = '#9a8a7a';
    ctx.fillRect(px2, pathY, 1, 2);
    ctx.fillRect(px2, pathY + 38, 1, 2);
  }
  // Cobblestone speckles
  rseed(1111);
  for (let i = 0; i < 200; i++) {
    const ix = x + Math.floor(srand() * w);
    const t = (ix - x) / w;
    const iy = y + 130 + Math.sin(t * Math.PI * 3) * 8 + Math.floor(srand() * 40);
    ctx.fillStyle = srand() > 0.5 ? '#a8987a' : '#d8c8a8';
    ctx.fillRect(ix, iy, 2, 1);
  }
}

function drawFountain(x, y) {
  // Outer pool (oval)
  ctx.fillStyle = '#5a7898';
  ctx.beginPath();
  ctx.ellipse(x + 60, y + 50, 64, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7a98b8';
  ctx.beginPath();
  ctx.ellipse(x + 60, y + 50, 60, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  // Water (lighter cyan)
  ctx.fillStyle = '#8accee';
  ctx.beginPath();
  ctx.ellipse(x + 60, y + 50, 54, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pool reflections
  ctx.fillStyle = '#ddeeff';
  ctx.fillRect(x + 30, y + 47, 14, 1);
  ctx.fillRect(x + 70, y + 50, 10, 1);
  // Central column
  ctx.fillStyle = '#8898a8';
  ctx.fillRect(x + 55, y + 8, 10, 42);
  ctx.fillStyle = '#a8b8c8';
  ctx.fillRect(x + 55, y + 8, 1, 42);
  // Top basin
  ctx.fillStyle = '#5a7898';
  ctx.beginPath();
  ctx.ellipse(x + 60, y + 8, 22, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8accee';
  ctx.beginPath();
  ctx.ellipse(x + 60, y + 8, 18, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Water jets (vertical streams from top)
  ctx.fillStyle = '#ccecff';
  ctx.fillRect(x + 59, y - 6, 2, 16);
  ctx.fillStyle = '#aaccee';
  ctx.fillRect(x + 60, y - 4, 1, 14);
  // Droplet sparkles
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 56, y - 2, 1, 1);
  ctx.fillRect(x + 64, y + 2, 1, 1);
  ctx.fillRect(x + 52, y + 4, 1, 1);
  ctx.fillRect(x + 68, y - 1, 1, 1);
}

function drawStatue(x, y) {
  // Pedestal
  ctx.fillStyle = '#888888';
  ctx.fillRect(x, y + 40, 36, 16);
  ctx.fillStyle = '#aaaaaa';
  ctx.fillRect(x, y + 40, 36, 2);
  ctx.fillStyle = '#666666';
  ctx.fillRect(x, y + 54, 36, 2);
  // Plaque
  ctx.fillStyle = '#bba668';
  ctx.fillRect(x + 8, y + 46, 20, 6);
  // Statue figure (abstract pose)
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(x + 14, y, 8, 14); // head
  ctx.fillRect(x + 12, y + 14, 12, 22); // body
  ctx.fillRect(x + 6, y + 18, 8, 14); // raised arm
  ctx.fillRect(x + 22, y + 18, 8, 14); // other arm
  // Highlights
  ctx.fillStyle = '#bbbbbb';
  ctx.fillRect(x + 14, y, 2, 14);
  ctx.fillRect(x + 12, y + 14, 2, 22);
  // Shadow
  ctx.fillStyle = '#666';
  ctx.fillRect(x + 20, y + 14, 2, 22);
}

function drawOakTree(x, baseY) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 12, baseY + 95, 56, 5);
  // Trunk
  ctx.fillStyle = '#5a3a1e';
  ctx.fillRect(x + 32, baseY + 60, 14, 40);
  // Trunk shading
  ctx.fillStyle = '#7a5a3e';
  ctx.fillRect(x + 32, baseY + 60, 2, 40);
  ctx.fillStyle = '#3a2a0e';
  ctx.fillRect(x + 44, baseY + 60, 2, 40);
  // Foliage - layered for depth
  ctx.fillStyle = '#1a4a1a';
  ctx.fillRect(x + 4, baseY + 36, 70, 32);
  ctx.fillStyle = '#2a6a2a';
  ctx.fillRect(x + 8, baseY + 16, 60, 36);
  ctx.fillStyle = '#3a8a3a';
  ctx.fillRect(x + 18, baseY, 40, 30);
  ctx.fillStyle = '#4aaa4a';
  ctx.fillRect(x + 24, baseY, 22, 18);
  // Highlight cluster
  ctx.fillStyle = '#5acc5a';
  ctx.fillRect(x + 28, baseY + 2, 12, 8);
  ctx.fillStyle = '#5acc5a';
  ctx.fillRect(x + 12, baseY + 26, 8, 8);
  ctx.fillRect(x + 56, baseY + 22, 6, 8);
  // Apple/fruit accents
  ctx.fillStyle = '#cc2a2a';
  ctx.fillRect(x + 20, baseY + 24, 2, 2);
  ctx.fillRect(x + 54, baseY + 32, 2, 2);
  ctx.fillRect(x + 38, baseY + 8, 2, 2);
}

function drawPalmTree(x, baseY) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 12, baseY + 105, 24, 4);
  // Trunk (segmented, curved illusion)
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#7a5a3a' : '#6a4a2a';
    ctx.fillRect(x + 20 - Math.floor(i / 3), baseY + 30 + i * 10, 8, 10);
  }
  // Coconuts
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(x + 14, baseY + 26, 4, 4);
  ctx.fillRect(x + 22, baseY + 28, 4, 4);
  // Fronds (drooping in 6 directions)
  ctx.fillStyle = '#3a7a3a';
  // Up-left frond
  for (let i = 0; i < 20; i++) {
    ctx.fillRect(x + 22 - i, baseY + 20 - i / 2, 2, 2);
    ctx.fillRect(x + 20 - i, baseY + 16 - i / 2, 1, 1);
  }
  // Up-right
  for (let i = 0; i < 20; i++) {
    ctx.fillRect(x + 22 + i, baseY + 20 - i / 2, 2, 2);
    ctx.fillRect(x + 24 + i, baseY + 16 - i / 2, 1, 1);
  }
  // Down-left
  ctx.fillStyle = '#2a6a2a';
  for (let i = 0; i < 18; i++) {
    ctx.fillRect(x + 22 - i, baseY + 28 + i / 3, 2, 2);
  }
  // Down-right
  for (let i = 0; i < 18; i++) {
    ctx.fillRect(x + 22 + i, baseY + 28 + i / 3, 2, 2);
  }
}

function drawHedge(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 2, y + 36, 56, 3);
  ctx.fillStyle = '#2a5a2a';
  ctx.fillRect(x, y + 8, 60, 28);
  ctx.fillStyle = '#4a8a4a';
  ctx.fillRect(x, y + 4, 60, 8);
  ctx.fillStyle = '#5aa05a';
  for (let i = 0; i < 10; i++) {
    ctx.fillRect(x + 3 + i * 6, y + 4 + Math.floor(srand() * 4), 3, 3);
  }
  ctx.fillStyle = '#1a3a1a';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(x + 4 + i * 10, y + 20 + Math.floor(srand() * 12), 2, 2);
  }
}

function drawFlowerBed(x, y, flowerColor) {
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(x, y, 48, 12);
  ctx.fillStyle = '#5a3a2a';
  ctx.fillRect(x, y, 48, 2);
  // Flowers
  for (let i = 0; i < 6; i++) {
    const fx = x + 4 + i * 7;
    // Stem
    ctx.fillStyle = '#2a6a2a';
    ctx.fillRect(fx + 2, y - 6, 1, 6);
    // Petal
    ctx.fillStyle = flowerColor;
    ctx.fillRect(fx + 1, y - 8, 3, 3);
    ctx.fillStyle = lighten(flowerColor, 0.3);
    ctx.fillRect(fx + 1, y - 8, 1, 1);
    // Leaf
    ctx.fillStyle = '#4a8a4a';
    ctx.fillRect(fx, y - 3, 2, 2);
  }
}

function drawFancyBench(x, y) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 4, y + 36, 70, 3);
  // Legs (cast iron decorative)
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 6, y + 20, 4, 16);
  ctx.fillRect(x + 68, y + 20, 4, 16);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 6, y + 20, 1, 16);
  ctx.fillRect(x + 68, y + 20, 1, 16);
  // Decorative curl
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 4, y + 18, 8, 2);
  ctx.fillRect(x + 66, y + 18, 8, 2);
  // Seat slats
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(x + 4, y + 14 + i * 3, 70, 2);
    ctx.fillStyle = '#a87038';
    ctx.fillRect(x + 4, y + 14 + i * 3, 70, 1);
  }
  // Backrest
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(x + 4, y + i * 3, 70, 2);
    ctx.fillStyle = '#a87038';
    ctx.fillRect(x + 4, y + i * 3, 70, 1);
  }
}

function drawDecorativeLamp(x, baseY) {
  // Pole
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 6, baseY, 4, 140);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 6, baseY, 1, 140);
  // Base
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 2, baseY + 134, 12, 10);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 2, baseY + 134, 12, 2);
  // Decorative scrolls
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x - 2, baseY + 6, 4, 2);
  ctx.fillRect(x + 14, baseY + 6, 4, 2);
  // Lamp globe
  ctx.fillStyle = '#1a1a24';
  ctx.beginPath();
  ctx.arc(x + 8, baseY - 4, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff388';
  ctx.beginPath();
  ctx.arc(x + 8, baseY - 4, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x + 6, baseY - 6, 2, 0, Math.PI * 2);
  ctx.fill();
  // Soft glow
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#fff388';
  ctx.beginPath();
  ctx.arc(x + 8, baseY - 4, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCoffeeCart(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 2, y + 70, 86, 4);
  // Cart body
  ctx.fillStyle = '#c8584a';
  ctx.fillRect(x, y + 28, 90, 44);
  // Stripes
  ctx.fillStyle = '#fff8e8';
  ctx.fillRect(x, y + 28, 90, 4);
  ctx.fillRect(x, y + 40, 90, 3);
  ctx.fillRect(x, y + 56, 90, 3);
  // Wheels
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 6, y + 66, 10, 10);
  ctx.fillRect(x + 74, y + 66, 10, 10);
  ctx.fillStyle = '#666';
  ctx.fillRect(x + 8, y + 68, 6, 6);
  ctx.fillRect(x + 76, y + 68, 6, 6);
  // Counter top (extended)
  ctx.fillStyle = '#a83a32';
  ctx.fillRect(x - 4, y + 24, 98, 6);
  // Umbrella
  ctx.fillStyle = '#5a8a5a';
  ctx.fillRect(x - 16, y, 122, 8);
  ctx.fillStyle = '#3a6a3a';
  ctx.fillRect(x - 16, y + 6, 122, 2);
  // Umbrella pole
  ctx.fillStyle = '#5a3a1a';
  ctx.fillRect(x + 44, y + 8, 2, 20);
  // Coffee cups display
  ctx.fillStyle = '#fff8e8';
  ctx.fillRect(x + 10, y + 32, 6, 6);
  ctx.fillRect(x + 24, y + 32, 6, 6);
  ctx.fillRect(x + 38, y + 32, 6, 6);
  ctx.fillRect(x + 52, y + 32, 6, 6);
  // Sign
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 60, y + 46, 24, 8);
  ctx.fillStyle = '#fff388';
  ctx.fillRect(x + 62, y + 48, 4, 4);
  ctx.fillRect(x + 68, y + 48, 4, 4);
  ctx.fillRect(x + 74, y + 48, 4, 4);
}

function drawBird(x, y) {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x, y, 4, 1);
  ctx.fillRect(x - 1, y + 1, 1, 1);
  ctx.fillRect(x + 4, y + 1, 1, 1);
  ctx.fillRect(x + 1, y - 1, 2, 1);
}

// ============================================================
// LOBBY (3000-4500): Modern corporate interior
// ============================================================
function renderLobby(zone) {
  const W = zone.end - zone.start;
  const X0 = zone.start;

  // Ceiling (gray with grid)
  ditheredGradientStops(X0, 0, W, 130, [
    { t: 0, c: '#9a9aa8' },
    { t: 1, c: '#bcbcc8' }
  ]);
  // Ceiling grid lines (suspended tiles)
  ctx.fillStyle = '#7a7a88';
  for (let cy = 30; cy < 130; cy += 30) {
    ctx.fillRect(X0, cy, W, 1);
  }
  for (let cx = X0; cx < zone.end; cx += 50) {
    ctx.fillRect(cx, 0, 1, 130);
  }
  // Recessed light fixtures with halos
  for (let lx = X0 + 60; lx < zone.end - 60; lx += 200) {
    ctx.fillStyle = '#fffce0';
    ctx.fillRect(lx, 20, 30, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(lx + 2, 22, 26, 4);
    // Glow
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#fff388';
    ctx.fillRect(lx - 10, 28, 50, 60);
    ctx.restore();
  }

  // Wall: cream/tan gradient
  ditheredGradientStops(X0, 130, W, 250, [
    { t: 0, c: '#d8c8a8' },
    { t: 0.5, c: '#c8b898' },
    { t: 1, c: '#b8a888' }
  ]);

  // Glass windows showing city view
  for (let i = 0; i < 5; i++) {
    const wx = X0 + 80 + i * 280;
    drawLobbyWindow(wx, 150, 220, 180);
  }

  // Company logo - large, prominent
  drawCompanyLogo(X0 + W / 2 - 100, 160);

  // Back wall (lower portion, darker accent)
  ditheredGradientStops(X0, 320, W, 60, [
    { t: 0, c: '#5a5a64' },
    { t: 1, c: '#7a7a88' }
  ]);

  // Decorative wall trim
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(X0, 376, W, 2);
  ctx.fillStyle = '#8a7a5a';
  ctx.fillRect(X0, 374, W, 2);

  // Marble floor with reflections
  drawMarbleFloor(X0, PLAY_AREA_TOP, W, HEIGHT - PLAY_AREA_TOP);

  // Highlight
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(X0, PLAY_AREA_TOP, W, 1);
  ctx.restore();

  // Tall plants in corners and at landmarks
  drawTallPlant(X0 + 80, PLAY_AREA_TOP - 90);
  drawTallPlant(X0 + 360, PLAY_AREA_TOP - 100);
  drawTallPlant(X0 + 720, PLAY_AREA_TOP - 95);
  drawTallPlant(X0 + 1080, PLAY_AREA_TOP - 100);
  drawTallPlant(X0 + 1380, PLAY_AREA_TOP - 90);

  // Modern reception desks
  drawModernReceptionDesk(X0 + 240, PLAY_AREA_TOP + 60);
  drawModernReceptionDesk(X0 + 1180, PLAY_AREA_TOP + 60);

  // Modern couches & coffee tables
  drawLeatherCouch(X0 + 500, PLAY_AREA_TOP + 110);
  drawCoffeeTable(X0 + 560, PLAY_AREA_TOP + 170);
  drawLeatherCouch(X0 + 900, PLAY_AREA_TOP + 110);
  drawCoffeeTable(X0 + 960, PLAY_AREA_TOP + 170);

  // LED ticker tape display
  drawTickerTape(X0 + 120, 280);
  drawTickerTape(X0 + 1300, 280);

  // Security camera
  drawSecurityCam(X0 + 360, 145);
  drawSecurityCam(X0 + 1080, 145);

  // Modern art on walls
  drawModernArt(X0 + 600, 180, '#ff6644');
  drawModernArt(X0 + 1080, 180, '#44aaff');

  // Floor signs
  drawFloorSign(X0 + 400, PLAY_AREA_TOP + 50);
  drawFloorSign(X0 + 1300, PLAY_AREA_TOP + 50);
}

function drawLobbyWindow(x, y, w, h) {
  // Frame
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x, y, w, h);
  // Window panes (4-panel)
  ctx.fillStyle = '#88a8c8';
  ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  // Cross mullion
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x + w / 2 - 1, y + 4, 2, h - 8);
  ctx.fillRect(x + 4, y + h / 2 - 1, w - 8, 2);
  // City silhouette behind
  ctx.fillStyle = '#3a4a6a';
  rseed(1212 + x);
  let cx2 = x + 4;
  while (cx2 < x + w - 4) {
    const bw = 12 + Math.floor(srand() * 24);
    const bh = 30 + Math.floor(srand() * 60);
    ctx.fillRect(cx2, y + h - bh - 4, bw, bh);
    // Window dots in distant buildings
    ctx.fillStyle = '#ffd060';
    for (let dy = y + h - bh; dy < y + h - 4; dy += 4) {
      for (let dx = cx2 + 2; dx < cx2 + bw - 2; dx += 3) {
        if (srand() > 0.7) px(dx, dy, '#ffd060');
      }
    }
    ctx.fillStyle = '#3a4a6a';
    cx2 += bw + 1;
  }
  // Reflections
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(x + 8, y + 8, 6, h - 16);
  ctx.fillRect(x + w / 2 + 4, y + 8, 4, h - 16);
}

function drawCompanyLogo(x, y) {
  // Brushed metal plate
  ctx.fillStyle = '#888a92';
  ctx.fillRect(x, y, 200, 40);
  ctx.fillStyle = '#aaacb4';
  ctx.fillRect(x, y, 200, 4);
  ctx.fillStyle = '#666870';
  ctx.fillRect(x, y + 36, 200, 4);
  // Brushed lines
  ctx.fillStyle = '#9a9ca4';
  for (let lx = x + 2; lx < x + 198; lx += 4) {
    ctx.fillRect(lx, y + 8, 1, 24);
  }
  // Faux logo geometry (4 colored squares forming a diamond)
  const cxLog = x + 100, cyLog = y + 20;
  ctx.fillStyle = '#ee4444';
  ctx.fillRect(cxLog - 8, cyLog - 8, 8, 8);
  ctx.fillStyle = '#44aa44';
  ctx.fillRect(cxLog, cyLog - 8, 8, 8);
  ctx.fillStyle = '#4488ee';
  ctx.fillRect(cxLog - 8, cyLog, 8, 8);
  ctx.fillStyle = '#eebb44';
  ctx.fillRect(cxLog, cyLog, 8, 8);
}

function drawMarbleFloor(x, y, w, h) {
  ditheredGradientStops(x, y, w, h, [
    { t: 0, c: '#e8e8f0' },
    { t: 0.5, c: '#d8d8e0' },
    { t: 1, c: '#c8c8d0' }
  ]);
  // Veins
  rseed(1313);
  ctx.fillStyle = '#a8a8b8';
  for (let i = 0; i < 60; i++) {
    const vx = x + Math.floor(srand() * w);
    const vy = y + Math.floor(srand() * h);
    const vlen = 20 + Math.floor(srand() * 40);
    ctx.fillRect(vx, vy, vlen, 1);
  }
  // Highlights
  ctx.fillStyle = '#f8f8ff';
  for (let i = 0; i < 30; i++) {
    const hx = x + Math.floor(srand() * w);
    const hy = y + Math.floor(srand() * h);
    ctx.fillRect(hx, hy, 6, 1);
  }
  // Tile lines (every 64px)
  ctx.fillStyle = '#a0a0a8';
  for (let lx = x; lx < x + w; lx += 64) {
    ctx.fillRect(lx, y, 1, h);
  }
  for (let ly = y; ly < y + h; ly += 64) {
    ctx.fillRect(x, ly, w, 1);
  }
  // Light reflection band (vertical lines of glow on parts of floor)
  for (let i = 0; i < 3; i++) {
    const refX = x + 200 + i * 500;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(refX, y, 30, h);
    ctx.restore();
  }
}

function drawTallPlant(x, baseY) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 8, baseY + 95, 30, 4);
  // Pot
  ctx.fillStyle = '#5a3a2a';
  ctx.fillRect(x + 10, baseY + 70, 28, 26);
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(x + 10, baseY + 70, 28, 2);
  ctx.fillRect(x + 10, baseY + 70, 1, 26);
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(x + 36, baseY + 70, 2, 26);
  // Soil
  ctx.fillStyle = '#1a1208';
  ctx.fillRect(x + 12, baseY + 72, 24, 3);
  // Leaves
  ctx.fillStyle = '#1a4a1a';
  ctx.fillRect(x + 14, baseY + 40, 20, 32);
  ctx.fillStyle = '#3a7a3a';
  ctx.fillRect(x + 6, baseY + 20, 38, 22);
  ctx.fillStyle = '#4a9a4a';
  ctx.fillRect(x + 12, baseY + 10, 26, 16);
  ctx.fillStyle = '#5acc5a';
  ctx.fillRect(x + 16, baseY, 18, 12);
  // Leaf accents
  ctx.fillStyle = '#6adc6a';
  ctx.fillRect(x + 22, baseY, 4, 6);
  ctx.fillRect(x + 8, baseY + 24, 6, 4);
  ctx.fillRect(x + 36, baseY + 26, 4, 4);
}

function drawModernReceptionDesk(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 4, y + 96, 152, 4);
  // Desk lower (dark wood)
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(x, y + 30, 160, 70);
  // Front panel detail
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(x + 4, y + 40, 152, 56);
  ctx.fillStyle = '#5a4a3a';
  ctx.fillRect(x + 4, y + 40, 152, 1);
  // Top counter (lighter wood)
  ctx.fillStyle = '#c8a878';
  ctx.fillRect(x, y, 160, 32);
  ctx.fillStyle = '#e8c898';
  ctx.fillRect(x, y, 160, 2);
  ctx.fillStyle = '#9a8858';
  ctx.fillRect(x, y + 30, 160, 2);
  // Wood grain
  ctx.fillStyle = '#a88858';
  for (let i = 0; i < 12; i++) {
    ctx.fillRect(x + 10 + i * 13, y + 6, 1, 20);
  }
  // Computer monitors
  for (let i = 0; i < 3; i++) {
    drawMonitor(x + 16 + i * 50, y - 28);
  }
  // Company logo plate centered
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 60, y + 60, 40, 16);
  ctx.fillStyle = '#33ccff';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + 64 + i * 8, y + 64, 4, 8);
  }
}

function drawMonitor(x, y) {
  // Stand
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 14, y + 24, 6, 4);
  ctx.fillRect(x + 10, y + 28, 14, 2);
  // Bezel
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x, y, 34, 26);
  // Screen
  ctx.fillStyle = '#1a3a5a';
  ctx.fillRect(x + 2, y + 2, 30, 22);
  // Screen content
  ctx.fillStyle = '#3a7a9a';
  ctx.fillRect(x + 4, y + 4, 26, 4);
  ctx.fillStyle = '#88ccee';
  ctx.fillRect(x + 4, y + 10, 18, 2);
  ctx.fillRect(x + 4, y + 14, 22, 2);
  ctx.fillRect(x + 4, y + 18, 14, 2);
}

function drawLeatherCouch(x, y) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 4, y + 58, 116, 4);
  // Back
  ctx.fillStyle = '#3a2a3a';
  ctx.fillRect(x, y, 120, 32);
  // Cushions (3 across)
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#5a3a5a';
    ctx.fillRect(x + 4 + i * 38, y + 22, 36, 20);
    ctx.fillStyle = '#7a5a7a';
    ctx.fillRect(x + 4 + i * 38, y + 22, 36, 2);
  }
  // Armrests
  ctx.fillStyle = '#2a1a2a';
  ctx.fillRect(x, y + 16, 8, 28);
  ctx.fillRect(x + 112, y + 16, 8, 28);
  ctx.fillStyle = '#5a3a5a';
  ctx.fillRect(x, y + 16, 2, 28);
  // Legs
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 4, y + 44, 6, 14);
  ctx.fillRect(x + 110, y + 44, 6, 14);
  // Stitching
  ctx.fillStyle = '#aa88aa';
  for (let i = 0; i < 12; i++) {
    ctx.fillRect(x + 8 + i * 10, y + 30, 1, 1);
  }
}

function drawCoffeeTable(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 4, y + 28, 66, 4);
  // Table top
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x, y, 70, 8);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x, y, 70, 1);
  // Glass reflection
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(x + 6, y + 1, 8, 1);
  ctx.fillRect(x + 36, y + 2, 12, 1);
  // Legs
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 4, y + 8, 4, 22);
  ctx.fillRect(x + 62, y + 8, 4, 22);
  // Magazine on table
  ctx.fillStyle = '#ee4444';
  ctx.fillRect(x + 14, y - 4, 16, 6);
  ctx.fillStyle = '#ffaa44';
  ctx.fillRect(x + 14, y - 4, 4, 6);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 20, y - 2, 8, 1);
  ctx.fillRect(x + 20, y, 6, 1);
  // Coffee cup
  ctx.fillStyle = '#f8f0e0';
  ctx.fillRect(x + 44, y - 6, 8, 8);
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(x + 45, y - 5, 6, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(x + 44, y - 6, 8, 1);
}

function drawTickerTape(x, y) {
  // Frame
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x - 4, y - 4, 200, 28);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x - 4, y - 4, 200, 2);
  // Screen
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(x, y, 192, 20);
  // Scrolling text (faux green LED segments)
  ctx.fillStyle = '#33ff66';
  const tickerText = ['CCB', '+0.5%', 'AAPL', '142', '+1.2%', 'TSLA', '255', '-0.3%'];
  let tx = x + 4;
  for (let i = 0; i < tickerText.length; i++) {
    for (let c = 0; c < tickerText[i].length; c++) {
      // Each "character" is a 6x12 block of LED segments
      ctx.fillRect(tx, y + 4, 4, 12);
      tx += 6;
    }
    tx += 4;
  }
  // Scanline
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  for (let s = 0; s < 20; s += 2) {
    ctx.fillRect(x, y + s, 192, 1);
  }
}

function drawSecurityCam(x, y) {
  // Mount
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 6, y, 4, 8);
  // Body
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x, y + 6, 16, 10);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x, y + 6, 16, 1);
  // Lens
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x - 4, y + 8, 8, 6);
  ctx.fillStyle = '#88ccee';
  ctx.fillRect(x - 2, y + 9, 4, 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 1, y + 10, 2, 2);
  // Red status LED
  ctx.fillStyle = '#ff2a2a';
  ctx.fillRect(x + 12, y + 8, 2, 2);
}

function drawModernArt(x, y, accentColor) {
  // Frame
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x, y, 70, 50);
  // Canvas (white)
  ctx.fillStyle = '#f8f8f0';
  ctx.fillRect(x + 4, y + 4, 62, 42);
  // Abstract shapes
  ctx.fillStyle = accentColor;
  ctx.fillRect(x + 12, y + 12, 20, 20);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 30, y + 8, 8, 38);
  ctx.fillStyle = darken(accentColor, 0.7);
  ctx.beginPath();
  ctx.arc(x + 50, y + 30, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lighten(accentColor, 0.4);
  ctx.fillRect(x + 14, y + 32, 16, 4);
}

function drawFloorSign(x, y) {
  // Base
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x, y + 30, 28, 6);
  // Pole
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 12, y + 8, 4, 22);
  // Sign
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(x - 4, y, 36, 14);
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x - 4, y, 36, 2);
  ctx.fillRect(x - 4, y + 12, 36, 2);
  // Text "WET"
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x, y + 4, 2, 6);
  ctx.fillRect(x + 4, y + 4, 2, 6);
  ctx.fillRect(x + 8, y + 4, 2, 6);
  ctx.fillRect(x + 14, y + 4, 6, 2);
  ctx.fillRect(x + 16, y + 6, 2, 4);
  ctx.fillRect(x + 22, y + 4, 6, 6);
}

// ============================================================
// ELEVATORS (4500-5000): Server room boss arena, dramatic
// ============================================================
function renderElevators(zone) {
  const W = zone.end - zone.start;
  const X0 = zone.start;

  // Dark ceiling with red emergency lighting
  ditheredGradientStops(X0, 0, W, 130, [
    { t: 0, c: '#0a0a14' },
    { t: 1, c: '#2a1a24' }
  ]);
  // Pipes overhead
  for (let py = 16; py < 80; py += 24) {
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(X0, py, W, 8);
    ctx.fillStyle = '#5a5a64';
    ctx.fillRect(X0, py, W, 2);
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(X0, py + 6, W, 2);
    // Joints
    for (let jx = X0; jx < zone.end; jx += 60) {
      ctx.fillStyle = '#2a2a34';
      ctx.fillRect(jx, py - 2, 6, 12);
    }
  }
  // Cable runs
  ctx.fillStyle = '#cc4422';
  ctx.fillRect(X0, 92, W, 2);
  ctx.fillStyle = '#33ccff';
  ctx.fillRect(X0, 96, W, 2);
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(X0, 100, W, 2);

  // Wall: dark server room
  ditheredGradientStops(X0, 130, W, 250, [
    { t: 0, c: '#1a1a2a' },
    { t: 0.5, c: '#2a2a3a' },
    { t: 1, c: '#1a1a24' }
  ]);

  // Red emergency strobe glow
  for (let i = 0; i < 3; i++) {
    const sx = X0 + 100 + i * 150;
    ctx.fillStyle = '#cc2a2a';
    ctx.fillRect(sx, 110, 30, 10);
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ff2a2a';
    ctx.beginPath();
    ctx.arc(sx + 15, 115, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Back wall server racks (background)
  for (let bx = X0 + 20; bx < zone.end - 20; bx += 50) {
    drawBackgroundServerRack(bx, 140);
  }

  // Floor: metal grating with warning stripes
  ditheredGradientStops(X0, 320, W, 60, [
    { t: 0, c: '#1a1a24' },
    { t: 1, c: '#2a2a34' }
  ]);

  drawMetalGrateFloor(X0, PLAY_AREA_TOP, W, HEIGHT - PLAY_AREA_TOP);

  // Warning stripes (diagonal yellow/black) at front edge
  ctx.save();
  for (let sx = X0; sx < zone.end + 40; sx += 30) {
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.moveTo(sx, PLAY_AREA_TOP);
    ctx.lineTo(sx + 16, PLAY_AREA_TOP);
    ctx.lineTo(sx + 16 - 8, PLAY_AREA_TOP + 8);
    ctx.lineTo(sx - 8, PLAY_AREA_TOP + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a1a24';
    ctx.beginPath();
    ctx.moveTo(sx + 16, PLAY_AREA_TOP);
    ctx.lineTo(sx + 30, PLAY_AREA_TOP);
    ctx.lineTo(sx + 30 - 8, PLAY_AREA_TOP + 8);
    ctx.lineTo(sx + 16 - 8, PLAY_AREA_TOP + 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Highlight edge
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(X0, PLAY_AREA_TOP + 8, W, 1);
  ctx.restore();

  // Boss arena center - dramatic red glow on floor
  const arenaCx = X0 + W / 2;
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#cc2a2a';
  ctx.beginPath();
  ctx.ellipse(arenaCx, PLAY_AREA_TOP + 120, 180, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Foreground: tall server racks
  drawDetailedServerRack(X0 + 30, PLAY_AREA_TOP - 30);
  drawDetailedServerRack(X0 + 100, PLAY_AREA_TOP - 30);
  drawDetailedServerRack(X0 + W - 130, PLAY_AREA_TOP - 30);
  drawDetailedServerRack(X0 + W - 60, PLAY_AREA_TOP - 30);

  // Elevator doors at right (the destination!)
  drawElevatorBank(X0 + W - 200, 200);

  // Status display monitors
  drawStatusMonitor(X0 + 200, 280);
  drawStatusMonitor(X0 + W - 280, 280);

  // Warning signs on walls
  drawWarningSign(X0 + 80, 220);
  drawWarningSign(X0 + W - 110, 220);
}

function drawBackgroundServerRack(x, y) {
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(x, y, 40, 180);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x, y, 40, 2);
  ctx.fillRect(x, y, 2, 180);
  // Units
  for (let i = 0; i < 12; i++) {
    const py = y + 4 + i * 14;
    ctx.fillStyle = i % 2 === 0 ? '#1a1a24' : '#2a2a34';
    ctx.fillRect(x + 2, py, 36, 12);
    // Random LEDs
    const colors = ['#ff3333', '#33ff66', '#ffcc00'];
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = colors[(i + j) % colors.length];
      if (srand() > 0.3) ctx.fillRect(x + 6 + j * 8, py + 4, 2, 2);
    }
  }
}

function drawDetailedServerRack(x, y) {
  const w = 60, h = 130;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x + 2, y + h - 4, w, 6);
  // Body
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(x, y, w, h);
  // Outer frame highlight
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x, y, w, 4);
  ctx.fillRect(x, y, 4, h);
  ctx.fillRect(x + w - 4, y, 4, h);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  // Server units
  for (let i = 0; i < 8; i++) {
    const py = y + 6 + i * 14;
    ctx.fillStyle = i % 2 === 0 ? '#1a1a24' : '#2a2a34';
    ctx.fillRect(x + 6, py, w - 12, 12);
    ctx.fillStyle = '#4a4a54';
    ctx.fillRect(x + 6, py, w - 12, 1);
    // LEDs (variable)
    const ledColors = ['#ff3333', '#33ff66', '#33ff66', '#ffcc00'];
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = ledColors[(i + j) % ledColors.length];
      ctx.fillRect(x + 10 + j * 5, py + 4, 3, 3);
    }
    // Display panel
    ctx.fillStyle = '#1a3344';
    ctx.fillRect(x + 36, py + 3, 18, 6);
    ctx.fillStyle = '#33ccff';
    for (let cc = 0; cc < 6; cc++) {
      if ((i + cc) % 3 !== 0) ctx.fillRect(x + 38 + cc * 2, py + 5, 1, 2);
    }
  }
  // Cooling vent on top
  ctx.fillStyle = '#1a1a24';
  for (let v = 0; v < 5; v++) ctx.fillRect(x + 8 + v * 10, y - 4, 6, 4);
}

function drawMetalGrateFloor(x, y, w, h) {
  // Base
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(x, y, w, h);
  // Grate pattern (32x32 tiles)
  for (let tx = x; tx < x + w; tx += 32) {
    for (let ty = y; ty < y + h; ty += 32) {
      ctx.fillStyle = '#5a5a65';
      for (let i = 0; i < 32; i += 8) {
        ctx.fillRect(tx + i, ty, 1, 32);
        ctx.fillRect(tx, ty + i, 32, 1);
      }
      ctx.fillStyle = '#7a7a85';
      for (let i = 0; i < 32; i += 8) ctx.fillRect(tx + i, ty, 1, 1);
      ctx.fillStyle = '#9090a0';
      ctx.fillRect(tx + 1, ty + 1, 2, 2);
      ctx.fillRect(tx + 28, ty + 1, 2, 2);
      ctx.fillRect(tx + 1, ty + 28, 2, 2);
      ctx.fillRect(tx + 28, ty + 28, 2, 2);
    }
  }
}

function drawElevatorBank(x, y) {
  // Wall plate
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x - 8, y - 8, 196, 180);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x - 8, y - 8, 196, 4);
  // 2 elevator doors
  for (let i = 0; i < 2; i++) {
    const dx = x + i * 96;
    // Door frame
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(dx, y, 88, 160);
    // Doors (slightly open silver)
    ctx.fillStyle = '#9090a0';
    ctx.fillRect(dx + 6, y + 6, 76, 148);
    // Split
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(dx + 43, y + 6, 2, 148);
    // Highlights
    ctx.fillStyle = '#b0b0c0';
    ctx.fillRect(dx + 6, y + 6, 76, 2);
    ctx.fillRect(dx + 6, y + 6, 2, 148);
    ctx.fillRect(dx + 43, y + 6, 2, 2);
    ctx.fillRect(dx + 45, y + 6, 2, 2);
    // Floor indicator above
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(dx + 24, y - 12, 40, 12);
    ctx.fillStyle = '#cc2a2a';
    ctx.fillRect(dx + 30, y - 9, 4, 6);
    ctx.fillRect(dx + 38, y - 9, 4, 6);
    ctx.fillRect(dx + 46, y - 9, 4, 6);
    ctx.fillRect(dx + 54, y - 9, 4, 6);
    // Call button
    ctx.fillStyle = '#5a5a64';
    ctx.fillRect(dx + 90, y + 70, 6, 20);
    ctx.fillStyle = '#33ff66';
    ctx.fillRect(dx + 91, y + 72, 4, 4);
    ctx.fillStyle = '#ff2a2a';
    ctx.fillRect(dx + 91, y + 80, 4, 4);
  }
}

function drawStatusMonitor(x, y) {
  // Monitor body
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x - 4, y - 4, 80, 50);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x - 4, y - 4, 80, 2);
  // Screen
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(x, y, 72, 42);
  // Red "ERROR" text
  ctx.fillStyle = '#cc2a2a';
  ctx.fillRect(x + 4, y + 6, 64, 6);
  // Mini graph
  ctx.fillStyle = '#33ff66';
  const points = [12, 18, 14, 20, 16, 22, 18, 24, 22, 28, 30, 28, 32];
  for (let i = 0; i < points.length - 1; i++) {
    ctx.fillRect(x + 4 + i * 5, y + 36 - points[i], 4, points[i] - points[i + 1] || 1);
  }
  // Numbers
  ctx.fillStyle = '#33ccff';
  ctx.fillRect(x + 60, y + 18, 8, 3);
  ctx.fillRect(x + 60, y + 24, 8, 3);
  ctx.fillRect(x + 60, y + 30, 8, 3);
}

function drawWarningSign(x, y) {
  // Yellow triangle
  ctx.fillStyle = '#ffeb3b';
  ctx.beginPath();
  ctx.moveTo(x + 14, y);
  ctx.lineTo(x + 28, y + 24);
  ctx.lineTo(x, y + 24);
  ctx.closePath();
  ctx.fill();
  // Outline
  ctx.fillStyle = '#1a1a24';
  ctx.beginPath();
  ctx.moveTo(x + 14, y);
  ctx.lineTo(x + 28, y + 24);
  ctx.lineTo(x, y + 24);
  ctx.closePath();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#1a1a24';
  ctx.stroke();
  // Exclamation point
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 13, y + 8, 2, 8);
  ctx.fillRect(x + 13, y + 18, 2, 2);
}

// ============================================================
// MAIN RENDER
// ============================================================
console.log(`Generating ${WIDTH}x${HEIGHT} stage PNG (enhanced 16-bit art)...`);

ZONES.forEach(zone => {
  console.log(`  ${zone.name} (${zone.start}-${zone.end})...`);
  switch (zone.theme) {
    case 'parkingLot': renderParkingLot(zone); break;
    case 'quad': renderQuad(zone); break;
    case 'lobby': renderLobby(zone); break;
    case 'elevators': renderElevators(zone); break;
    default: break;
  }
});

// ============================================================
// SAVE
// ============================================================
const outDir = path.join(__dirname, '..', 'public', 'sprites');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
const outPath = path.join(outDir, 'stage.png');
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);
const sizeKB = (buffer.length / 1024).toFixed(1);
console.log(`\n✓ Saved ${outPath}`);
console.log(`  Dimensions: ${WIDTH}x${HEIGHT}`);
console.log(`  Size: ${sizeKB} KB`);
