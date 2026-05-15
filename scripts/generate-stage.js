/**
 * Generate a single 3200x700 PNG of the entire CorporateCrawlerBill stage
 * with all 4 zones laid out left-to-right:
 *   Parking Lot | Quad | Lobby | Elevators
 *
 * Run: node scripts/generate-stage.js
 * Output: public/sprites/stage.png
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const WIDTH = 3200;
const HEIGHT = 700;
const GROUND_LEVEL = 600; // matches GameRoom.js groundLevel
const PLAY_AREA_TOP = 380; // matches GameRoom.js playAreaTop

// Zone boundaries (must match GameRoom.js zoneConfig)
const ZONES = [
  { name: 'Parking Lot', start: 0, end: 900, theme: 'parkingLot' },
  { name: 'Quad', start: 900, end: 1800, theme: 'quad' },
  { name: 'Lobby', start: 1800, end: 2700, theme: 'lobby' },
  { name: 'Elevators', start: 2700, end: 3200, theme: 'elevators' }
];

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ============================================================
// SKY (gradient varies by zone)
// ============================================================
function drawSkyForZone(zone) {
  const skyColors = {
    parkingLot: ['#3a5a8a', '#7aaccc', '#ccddee'],
    quad: ['#5a8acc', '#a0c4e0', '#d0e4f0'],
    lobby: ['#4a4a6a', '#8a8aaa', '#ccccd8'],
    elevators: ['#0a0a2a', '#1a1a3a', '#2a2a4a']
  };
  const sky = skyColors[zone.theme];
  const grad = ctx.createLinearGradient(0, 0, 0, PLAY_AREA_TOP);
  grad.addColorStop(0, sky[0]);
  grad.addColorStop(0.6, sky[1]);
  grad.addColorStop(1, sky[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(zone.start, 0, zone.end - zone.start, PLAY_AREA_TOP);
}

// ============================================================
// CLOUDS (no clouds in elevators/server room)
// ============================================================
function drawCloud(x, y) {
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 10, y + 10, 60, 14);
  ctx.fillRect(x + 20, y + 4, 30, 22);
  ctx.fillRect(x + 5, y + 14, 70, 8);
  ctx.fillRect(x + 15, y + 8, 50, 18);
  ctx.fillStyle = '#e0e0e8';
  ctx.fillRect(x + 10, y + 22, 60, 2);
  ctx.fillRect(x + 5, y + 20, 70, 2);
  ctx.restore();
}

// ============================================================
// BUILDINGS
// ============================================================
function drawOfficeBuilding(x, y, h = 200) {
  // Body
  ctx.fillStyle = '#3a4a5a';
  ctx.fillRect(x, y, 96, h);
  // Outline
  ctx.fillStyle = '#1a2a3a';
  ctx.fillRect(x, y, 96, 2);
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + 94, y, 2, h);
  // Windows
  const winColors = ['#fff388', '#88ddff', '#ffd97a', '#bbeeff', '#ccddff'];
  const winW = 8, winH = 10, gapX = 4, gapY = 6;
  const rows = Math.floor((h - 15) / (winH + gapY));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 7; col++) {
      const wx = x + 8 + col * (winW + gapX);
      const wy = y + 10 + row * (winH + gapY);
      if (wy + winH > y + h - 5) break;
      ctx.fillStyle = '#2a3545';
      ctx.fillRect(wx - 1, wy - 1, winW + 2, winH + 2);
      const dark = (row * 7 + col * 13) % 11 < 3;
      ctx.fillStyle = dark ? '#2a3a4a' : winColors[(row + col * 3) % winColors.length];
      ctx.fillRect(wx, wy, winW, winH);
      if (!dark) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(wx + 1, wy + 1, 2, 2);
      }
    }
  }
  // Roof
  ctx.fillStyle = '#252535';
  ctx.fillRect(x, y, 96, 8);
}

function drawGlassFacade(x, y, h = 150) {
  ctx.fillStyle = '#5a7a9a';
  ctx.fillRect(x, y, 120, h);
  // Mullions
  ctx.fillStyle = '#1a2a3a';
  for (let i = 0; i <= 6; i++) ctx.fillRect(x + i * 20, y, 2, h);
  const hRows = Math.floor(h / 30);
  for (let i = 0; i <= hRows; i++) ctx.fillRect(x, y + i * 30, 120, 2);
  // Panes
  for (let row = 0; row < hRows; row++) {
    for (let col = 0; col < 6; col++) {
      const px = x + col * 20 + 2;
      const py = y + row * 30 + 2;
      ctx.fillStyle = (row + col) % 2 === 0 ? '#8ac0e0' : '#a0d0e8';
      ctx.fillRect(px, py, 18, 28);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(px + 2, py + 2, 3, 24);
    }
  }
  ctx.fillStyle = '#3a4a5a';
  ctx.fillRect(x, y, 120, 4);
}

// ============================================================
// GROUND TILES (32x32, repeating)
// ============================================================
function drawAsphaltTile(x, y) {
  ctx.fillStyle = '#2a2a2e';
  ctx.fillRect(x, y, 32, 32);
  ctx.fillStyle = '#3a3a40';
  [[3, 5], [12, 8], [22, 14], [6, 20], [18, 25], [27, 6], [10, 28]].forEach(([dx, dy]) => {
    ctx.fillRect(x + dx, y + dy, 1, 1);
  });
  ctx.fillStyle = '#1a1a1e';
  [[8, 3], [25, 18], [4, 14], [16, 22], [29, 26], [20, 8]].forEach(([dx, dy]) => {
    ctx.fillRect(x + dx, y + dy, 1, 1);
  });
}

function drawAsphaltStripeTile(x, y) {
  drawAsphaltTile(x, y);
  ctx.fillStyle = '#e8c200';
  ctx.fillRect(x, y + 14, 32, 4);
  ctx.fillStyle = '#ffd83a';
  ctx.fillRect(x, y + 14, 32, 1);
  ctx.fillStyle = '#a88e00';
  ctx.fillRect(x, y + 17, 32, 1);
}

function drawGrassTile(x, y) {
  ctx.fillStyle = '#4a8a4a';
  ctx.fillRect(x, y, 32, 32);
  ctx.fillStyle = '#5aa05a';
  [[2, 4], [7, 8], [14, 3], [22, 9], [28, 6], [4, 16], [11, 22], [19, 18], [26, 24], [3, 28], [16, 27], [24, 14]]
    .forEach(([dx, dy]) => ctx.fillRect(x + dx, y + dy, 1, 2));
  ctx.fillStyle = '#3a6a3a';
  [[6, 5], [13, 11], [20, 7], [26, 13], [9, 19], [17, 21], [25, 27], [2, 11]]
    .forEach(([dx, dy]) => ctx.fillRect(x + dx, y + dy, 1, 1));
}

function drawGrassFlowerTile(x, y) {
  drawGrassTile(x, y);
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(x + 15, y + 15, 2, 2);
  ctx.fillStyle = '#fff9c4';
  ctx.fillRect(x + 14, y + 15, 1, 1);
  ctx.fillRect(x + 17, y + 15, 1, 1);
  ctx.fillRect(x + 15, y + 14, 1, 1);
  ctx.fillRect(x + 15, y + 17, 1, 1);
}

function drawMarbleTile(x, y) {
  ctx.fillStyle = '#e8e8f0';
  ctx.fillRect(x, y, 32, 32);
  ctx.fillStyle = '#c8c8d0';
  ctx.fillRect(x + 2, y + 6, 8, 1);
  ctx.fillRect(x + 10, y + 7, 4, 1);
  ctx.fillRect(x + 18, y + 14, 6, 1);
  ctx.fillRect(x + 24, y + 22, 5, 1);
  ctx.fillStyle = '#f8f8ff';
  ctx.fillRect(x + 5, y + 11, 6, 1);
  ctx.fillRect(x + 15, y + 20, 5, 1);
  ctx.fillStyle = '#a0a0a8';
  ctx.fillRect(x, y + 31, 32, 1);
  ctx.fillRect(x + 31, y, 1, 32);
}

function drawMarbleAccentTile(x, y) {
  drawMarbleTile(x, y);
  ctx.fillStyle = '#b8b8c8';
  ctx.fillRect(x + 8, y + 8, 16, 1);
  ctx.fillRect(x + 8, y + 23, 16, 1);
  ctx.fillRect(x + 8, y + 8, 1, 16);
  ctx.fillRect(x + 23, y + 8, 1, 16);
  ctx.fillStyle = '#9090a8';
  ctx.fillRect(x + 14, y + 14, 4, 4);
  ctx.fillStyle = '#c8c8e0';
  ctx.fillRect(x + 15, y + 15, 2, 2);
}

function drawMetalGrateTile(x, y) {
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(x, y, 32, 32);
  ctx.fillStyle = '#5a5a65';
  for (let i = 0; i < 32; i += 8) {
    ctx.fillRect(x + i, y, 1, 32);
    ctx.fillRect(x, y + i, 32, 1);
  }
  ctx.fillStyle = '#7a7a85';
  for (let i = 0; i < 32; i += 8) ctx.fillRect(x + i, y, 1, 1);
  ctx.fillStyle = '#9090a0';
  ctx.fillRect(x + 1, y + 1, 2, 2);
  ctx.fillRect(x + 28, y + 1, 2, 2);
  ctx.fillRect(x + 1, y + 28, 2, 2);
  ctx.fillRect(x + 28, y + 28, 2, 2);
  ctx.fillStyle = '#c0c0d0';
  ctx.fillRect(x + 1, y + 1, 1, 1);
  ctx.fillRect(x + 28, y + 1, 1, 1);
  ctx.fillRect(x + 1, y + 28, 1, 1);
  ctx.fillRect(x + 28, y + 28, 1, 1);
}

// ============================================================
// BACK WALL (between sky and floor)
// ============================================================
function drawBackWallForZone(zone) {
  const wallColors = {
    parkingLot: '#3a3a44',
    quad: '#2a6a3a',
    lobby: '#7a7a8a',
    elevators: '#1a1a2a'
  };
  const wall = wallColors[zone.theme];
  const grad = ctx.createLinearGradient(0, 320, 0, PLAY_AREA_TOP);
  grad.addColorStop(0, wall);
  grad.addColorStop(1, lighten(wall, 0.2));
  ctx.fillStyle = grad;
  ctx.fillRect(zone.start, 320, zone.end - zone.start, 60);
}

// ============================================================
// PROPS (cars, benches, trees, server racks)
// ============================================================
function drawCar(x, y, color) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 2, y + 32, 56, 3);
  // Wheels
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 6, y + 26, 10, 8);
  ctx.fillRect(x + 44, y + 26, 10, 8);
  ctx.fillStyle = '#666';
  ctx.fillRect(x + 8, y + 28, 6, 4);
  ctx.fillRect(x + 46, y + 28, 6, 4);
  // Body
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 16, 56, 12);
  ctx.fillRect(x + 14, y + 6, 32, 12);
  ctx.fillStyle = darken(color, 0.6);
  ctx.fillRect(x + 2, y + 26, 56, 2);
  ctx.fillRect(x + 2, y + 16, 1, 10);
  ctx.fillStyle = lighten(color, 0.3);
  ctx.fillRect(x + 2, y + 16, 56, 1);
  // Window
  ctx.fillStyle = '#88ccee';
  ctx.fillRect(x + 16, y + 8, 28, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(x + 18, y + 9, 4, 1);
  ctx.fillRect(x + 36, y + 9, 6, 1);
  // Headlight
  ctx.fillStyle = '#ffffaa';
  ctx.fillRect(x + 56, y + 18, 3, 4);
}

function drawTree(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 8, y + 95, 44, 4);
  ctx.fillStyle = '#5a3a1a';
  ctx.fillRect(x + 26, y + 60, 10, 36);
  ctx.fillStyle = '#7a5a2a';
  ctx.fillRect(x + 26, y + 60, 2, 36);
  ctx.fillStyle = '#2a5a2a';
  ctx.fillRect(x, y + 40, 60, 30);
  ctx.fillStyle = '#3a7a3a';
  ctx.fillRect(x + 6, y + 20, 48, 28);
  ctx.fillStyle = '#4a8a4a';
  ctx.fillRect(x + 14, y + 4, 32, 20);
  ctx.fillStyle = '#5aa05a';
  ctx.fillRect(x + 16, y + 4, 8, 4);
  ctx.fillRect(x + 20, y + 22, 6, 4);
  ctx.fillRect(x + 8, y + 42, 10, 4);
}

function drawBench(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 4, y + 36, 62, 3);
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(x + 6, y + 22, 4, 14);
  ctx.fillRect(x + 60, y + 22, 4, 14);
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(x + 4, y + 4, 62, 6);
  ctx.fillStyle = '#a0703a';
  ctx.fillRect(x + 4, y + 4, 62, 1);
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(x + 4, y + 16, 62, 8);
  ctx.fillStyle = '#a0703a';
  ctx.fillRect(x + 4, y + 16, 62, 1);
  ctx.fillStyle = '#603e1e';
  ctx.fillRect(x + 4, y + 9, 62, 1);
  ctx.fillRect(x + 4, y + 23, 62, 1);
}

function drawHedge(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 2, y + 36, 46, 3);
  ctx.fillStyle = '#2a5a2a';
  ctx.fillRect(x, y + 8, 50, 28);
  ctx.fillStyle = '#4a8a4a';
  ctx.fillRect(x, y + 4, 50, 8);
  ctx.fillStyle = '#5aa05a';
  [[3, 6], [10, 4], [17, 6], [25, 3], [33, 5], [40, 7], [46, 5]].forEach(([dx, dy]) => {
    ctx.fillRect(x + dx, y + dy, 3, 3);
  });
  ctx.fillStyle = '#1a3a1a';
  ctx.fillRect(x + 8, y + 18, 2, 2);
  ctx.fillRect(x + 20, y + 22, 2, 2);
  ctx.fillRect(x + 34, y + 20, 2, 2);
  ctx.fillRect(x + 42, y + 26, 2, 2);
}

function drawServerRack(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x + 2, y + 106, 46, 4);
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(x, y, 50, 108);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x, y, 50, 2);
  ctx.fillRect(x, y, 2, 108);
  ctx.fillRect(x + 48, y, 2, 108);
  const unitColors = ['#1a1a24', '#2a2a34', '#1a1a24'];
  for (let i = 0; i < 7; i++) {
    const py = y + 4 + i * 14;
    ctx.fillStyle = unitColors[i % unitColors.length];
    ctx.fillRect(x + 4, py, 42, 12);
    ctx.fillStyle = '#4a4a54';
    ctx.fillRect(x + 4, py, 42, 1);
    const ledColors = ['#ff3333', '#33ff66', '#33ff66', '#ffcc00'];
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = ledColors[(i + j) % ledColors.length];
      ctx.fillRect(x + 8 + j * 4, py + 4, 2, 2);
    }
    ctx.fillStyle = '#1a3344';
    ctx.fillRect(x + 28, py + 3, 14, 5);
    ctx.fillStyle = '#33ccff';
    ctx.fillRect(x + 30, py + 4, 1, 1);
    ctx.fillRect(x + 32, py + 4, 1, 1);
    ctx.fillRect(x + 34, py + 4, 1, 1);
    ctx.fillRect(x + 36, py + 6, 1, 1);
    ctx.fillRect(x + 38, py + 6, 1, 1);
  }
}

function drawElevatorDoor(x, y) {
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x, y, 80, 140);
  ctx.fillStyle = '#9090a0';
  ctx.fillRect(x + 6, y + 6, 68, 128);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 39, y + 6, 2, 128);
  ctx.fillStyle = '#b0b0c0';
  ctx.fillRect(x + 6, y + 6, 68, 2);
  ctx.fillRect(x + 6, y + 6, 2, 128);
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 75, y + 50, 10, 20);
  ctx.fillStyle = '#33ff66';
  ctx.fillRect(x + 78, y + 54, 3, 3);
  ctx.fillStyle = '#ff3333';
  ctx.fillRect(x + 78, y + 60, 3, 3);
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(x + 28, y, 24, 6);
  ctx.fillStyle = '#ff3333';
  ctx.fillRect(x + 34, y + 2, 12, 2);
}

function drawStreetlight(x, y) {
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 8, y + 12, 4, 88);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x + 8, y + 12, 1, 88);
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(x + 4, y + 92, 12, 8);
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(x + 2, y + 6, 16, 8);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(x + 2, y + 6, 16, 1);
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(x + 4, y + 8, 12, 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 7, y + 9, 6, 1);
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(x, y + 4, 20, 12);
  ctx.restore();
}

function drawReceptionDesk(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 4, y + 76, 132, 4);
  ctx.fillStyle = '#5a4a3a';
  ctx.fillRect(x, y + 20, 140, 60);
  ctx.fillStyle = '#e0d0c0';
  ctx.fillRect(x, y, 140, 22);
  ctx.fillStyle = '#c0a890';
  ctx.fillRect(x, y + 20, 140, 2);
  ctx.fillStyle = '#fff8e0';
  ctx.fillRect(x, y, 140, 2);
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(x + 10, y + 30, 30, 40);
  ctx.fillRect(x + 55, y + 30, 30, 40);
  ctx.fillRect(x + 100, y + 30, 30, 40);
  ctx.fillStyle = '#7a6a5a';
  ctx.fillRect(x + 10, y + 30, 30, 1);
  ctx.fillRect(x + 55, y + 30, 30, 1);
  ctx.fillRect(x + 100, y + 30, 30, 1);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 60, y + 8, 20, 8);
  ctx.fillStyle = '#33ccff';
  ctx.fillRect(x + 62, y + 10, 2, 4);
  ctx.fillRect(x + 66, y + 10, 2, 4);
  ctx.fillRect(x + 70, y + 10, 2, 4);
  ctx.fillRect(x + 74, y + 10, 2, 4);
}

// ============================================================
// HELPERS
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

// Seeded random for consistent layout
let seed = 1234;
function srand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// ============================================================
// MAIN RENDER
// ============================================================
console.log(`Generating ${WIDTH}x${HEIGHT} stage PNG...`);

// Each zone gets its own sky + wall + ground + buildings + props
ZONES.forEach((zone, idx) => {
  console.log(`  ${zone.name} (${zone.start}-${zone.end})...`);

  // Sky
  drawSkyForZone(zone);

  // Clouds (skip for elevators)
  if (zone.theme !== 'elevators') {
    const cloudCount = Math.floor((zone.end - zone.start) / 250);
    for (let i = 0; i < cloudCount; i++) {
      const cx = zone.start + 30 + i * 250 + srand() * 50;
      const cy = 30 + srand() * 60;
      drawCloud(cx, cy);
    }
  }

  // Background skyline buildings
  const skylineSpacing = 120;
  for (let x = zone.start; x < zone.end; x += skylineSpacing) {
    const isTall = (srand() > 0.6);
    if (isTall) {
      drawOfficeBuilding(x, 130, 240);
    } else {
      drawOfficeBuilding(x, 180, 200);
    }
  }

  // Midground buildings
  const midSpacing = 180;
  for (let x = zone.start + 60; x < zone.end; x += midSpacing) {
    const useGlass = (srand() > 0.5);
    if (useGlass) {
      drawGlassFacade(x, 230, 150);
    } else {
      drawOfficeBuilding(x, 200, 180);
    }
  }

  // Back wall
  drawBackWallForZone(zone);

  // Ground tiles
  let primaryDraw, accentDraw;
  switch (zone.theme) {
    case 'parkingLot':
      primaryDraw = drawAsphaltTile;
      accentDraw = drawAsphaltStripeTile;
      break;
    case 'quad':
      primaryDraw = drawGrassTile;
      accentDraw = drawGrassFlowerTile;
      break;
    case 'lobby':
      primaryDraw = drawMarbleTile;
      accentDraw = drawMarbleAccentTile;
      break;
    case 'elevators':
      primaryDraw = drawMetalGrateTile;
      accentDraw = drawMetalGrateTile;
      break;
    default:
      primaryDraw = drawAsphaltTile;
      accentDraw = drawAsphaltTile;
  }

  for (let x = Math.floor(zone.start / 32) * 32; x < zone.end; x += 32) {
    for (let y = PLAY_AREA_TOP; y < HEIGHT; y += 32) {
      let useAccent = false;
      const tx = x / 32, ty = y / 32;
      if (zone.theme === 'parkingLot') {
        useAccent = (tx % 4 === 0) && y === PLAY_AREA_TOP + 64;
      } else if (zone.theme === 'quad') {
        useAccent = (tx % 7 === 0) && (ty % 3 === 0);
      } else if (zone.theme === 'lobby') {
        useAccent = ((tx + ty) % 4 === 0);
      }
      (useAccent ? accentDraw : primaryDraw)(x, y);
    }
  }

  // Floor edge highlight
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.15;
  ctx.fillRect(zone.start, PLAY_AREA_TOP, zone.end - zone.start, 1);
  ctx.restore();

  // Foreground props per zone
  const propSpacing = 220;
  for (let x = zone.start + 40; x < zone.end - 60; x += propSpacing) {
    const r = srand();
    if (zone.theme === 'parkingLot') {
      if (r < 0.25) drawCar(x, 340, '#cc3333');
      else if (r < 0.45) drawCar(x, 340, '#3344cc');
      else if (r < 0.6) drawCar(x, 340, '#ccaa33');
      else if (r < 0.8) drawCar(x, 340, '#ddddee');
      else drawStreetlight(x, 260);
    } else if (zone.theme === 'quad') {
      if (r < 0.4) drawTree(x, 280);
      else if (r < 0.7) drawBench(x, 330);
      else drawHedge(x, 340);
    } else if (zone.theme === 'lobby') {
      if (r < 0.5) drawReceptionDesk(x, 300);
      else drawHedge(x, 340);
    } else if (zone.theme === 'elevators') {
      if (r < 0.5) drawServerRack(x, 270);
      else drawElevatorDoor(x, 240);
    }
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
