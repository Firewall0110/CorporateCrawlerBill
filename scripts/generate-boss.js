/**
 * Generate sprite sheet for the boss: "BROADCAST STORM"
 *
 * Theme: A networking concept where excessive broadcast packets crash a network.
 * Visually: a hovering storm-cloud entity with an antenna-tower head,
 * crackling with electric arcs, cable-tendril arms, and broadcast waves.
 *
 * Sheet: 4 rows × 8 frames per row, 140×170 per cell = 1120×680 total.
 *   Row 0: idle (slight hover + sparks + antenna sway)
 *   Row 1: SystemDown shockwave (arms raise, slam ground)
 *   Row 2: DataCorruption laser (charge + fire beam from eye)
 *   Row 3: ServiceRestarts target zones (arms forward, hurl packet orbs)
 *
 * Run: npm run boss:gen
 *   (installs @napi-rs/canvas --no-save then runs)
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const CELL_W = 140;
const CELL_H = 170;
const COLS = 8;
const ROWS = 4;
const W = COLS * CELL_W;
const H = ROWS * CELL_H;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// === Palette (limited 16-bit Broadcast Storm theme) ===
const COL = {
  void: '#0a0014',
  bodyDark: '#1a1828',
  bodyMid: '#2a2842',
  bodyLight: '#3a3856',
  bodyHi: '#4a4866',
  cyan: '#00ddff',
  cyanBright: '#aaf2ff',
  pink: '#ff00cc',
  pinkBright: '#ffaaff',
  red: '#ff2244',
  redDim: '#aa1133',
  yellow: '#ffaa00',
  white: '#ffffff',
  green: '#22ff66',
  static: '#5a5878'
};

// ============================================================
// HELPERS
// ============================================================
function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.floor(x), Math.floor(y), w, h); }
function px(x, y, color) { rect(x, y, 1, 1, color); }
let seed = 7;
function srand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function rseed(s) { seed = s; }

/**
 * Random crackling lightning bolt between two points
 */
function drawBolt(ctx, x1, y1, x2, y2, color, width = 1) {
  const segments = 6;
  let cx = x1, cy = y1;
  ctx.fillStyle = color;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const tx = x1 + (x2 - x1) * t + (srand() - 0.5) * 8;
    const ty = y1 + (y2 - y1) * t + (srand() - 0.5) * 6;
    // Draw segment as a line of pixels
    const steps = Math.max(Math.abs(tx - cx), Math.abs(ty - cy));
    for (let s = 0; s < steps; s++) {
      const sx = cx + (tx - cx) * (s / steps);
      const sy = cy + (ty - cy) * (s / steps);
      ctx.fillRect(Math.floor(sx), Math.floor(sy), width, width);
    }
    cx = tx; cy = ty;
  }
}

/**
 * Draw the central body of the boss inside a cell.
 * Variables let us animate per-frame: bob (vertical offset), arms (raised/down),
 * eyeColor, glowIntensity, etc.
 */
function drawBossBody(cellX, cellY, opts) {
  const o = Object.assign({
    bob: 0,
    armPose: 'idle',      // 'idle', 'raised', 'down', 'forward'
    eyeColor: COL.cyan,
    eyeIntensity: 1,
    chargeGlow: 0,        // 0-1 charge intensity at chest
    antennaCrackle: 0.5,  // 0-1 how chaotic antenna sparks are
    voidWispOffset: 0,    // for animated wisp at bottom
    extraSparks: false
  }, opts);

  const cx = cellX + CELL_W / 2;
  const cy = cellY + CELL_H / 2 + o.bob;

  // === Outer aura (subtle radial glow during charge) ===
  if (o.chargeGlow > 0) {
    ctx.save();
    ctx.globalAlpha = 0.3 * o.chargeGlow;
    ctx.fillStyle = COL.cyan;
    ctx.beginPath();
    ctx.arc(cx, cy, 48 + o.chargeGlow * 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // === Lower wisp/void body (no legs - floating) ===
  // Cloud-like silhouette beneath the torso
  ctx.fillStyle = COL.bodyDark;
  // Wisp shape - irregular cloud
  const wispY = cy + 32 + o.voidWispOffset;
  rect(cx - 30, wispY, 60, 12);
  rect(cx - 36, wispY - 2, 12, 10);
  rect(cx + 24, wispY - 2, 12, 10);
  rect(cx - 24, wispY + 10, 48, 8);
  rect(cx - 20, wispY + 16, 40, 6);
  rect(cx - 16, wispY + 20, 32, 6);
  // Wisp tendrils trailing
  ctx.fillStyle = COL.bodyMid;
  rect(cx - 8, wispY + 24, 4, 8);
  rect(cx + 4, wispY + 24, 4, 8);
  rect(cx - 16, wispY + 24, 2, 4);
  rect(cx + 14, wispY + 24, 2, 4);
  // Static crackle in wisp
  ctx.fillStyle = COL.cyan;
  rseed(101 + Math.floor(o.voidWispOffset));
  for (let i = 0; i < 6; i++) {
    px(cx - 24 + srand() * 48, wispY + 4 + srand() * 16, COL.cyan);
  }

  // === Torso (stormcloud body) ===
  // Main torso: 60 wide × 50 tall
  const tx = cx - 30;
  const ty = cy - 24;
  // Outline / silhouette (slightly larger dark)
  rect(tx - 2, ty - 2, 64, 54, COL.void);
  // Body fill (dark cloud)
  rect(tx, ty, 60, 50, COL.bodyDark);
  // Mid-tone highlights (storm cloud texture)
  rect(tx + 4, ty + 4, 18, 8, COL.bodyMid);
  rect(tx + 38, ty + 4, 18, 6, COL.bodyMid);
  rect(tx + 8, ty + 16, 14, 6, COL.bodyMid);
  rect(tx + 40, ty + 18, 16, 8, COL.bodyMid);
  rect(tx + 16, ty + 30, 20, 8, COL.bodyMid);
  rect(tx + 42, ty + 34, 12, 6, COL.bodyMid);
  // Lighter highlights (top edge)
  rect(tx + 2, ty + 2, 12, 2, COL.bodyLight);
  rect(tx + 24, ty + 2, 8, 2, COL.bodyLight);
  rect(tx + 44, ty + 2, 12, 2, COL.bodyLight);
  // Brightest hi-line on top
  rect(tx + 4, ty, 8, 1, COL.bodyHi);
  rect(tx + 50, ty, 8, 1, COL.bodyHi);

  // Chest charge glow (data center / power core)
  const chestX = cx - 6;
  const chestY = cy - 4;
  if (o.chargeGlow > 0.05) {
    // Hot center
    rect(chestX - 2, chestY - 2, 16, 16, COL.cyan);
    rect(chestX, chestY, 12, 12, COL.cyanBright);
    rect(chestX + 4, chestY + 4, 4, 4, COL.white);
    // Charge spokes
    ctx.fillStyle = COL.cyan;
    if (o.chargeGlow > 0.3) {
      rect(chestX + 5, chestY - 8, 2, 6, COL.cyan);
      rect(chestX + 5, chestY + 14, 2, 6, COL.cyan);
      rect(chestX - 8, chestY + 5, 6, 2, COL.cyan);
      rect(chestX + 14, chestY + 5, 6, 2, COL.cyan);
    }
  } else {
    // Dim core when not charging
    rect(chestX, chestY, 12, 12, COL.bodyMid);
    rect(chestX + 4, chestY + 4, 4, 4, COL.cyan);
  }

  // Status LEDs across the chest (data center indicators)
  const ledColors = [COL.red, COL.green, COL.yellow, COL.red, COL.green];
  for (let i = 0; i < ledColors.length; i++) {
    rect(tx + 6 + i * 10, ty + 44, 3, 3, ledColors[i]);
  }

  // === Antenna / "broadcast tower" head ===
  // Head base (wider trapezoid)
  const hx = cx - 18;
  const hy = ty - 28;
  rect(hx - 2, hy - 2, 40, 32, COL.void);
  rect(hx, hy, 36, 28, COL.bodyDark);
  rect(hx + 4, hy + 2, 28, 4, COL.bodyMid);
  rect(hx + 2, hy + 24, 32, 2, COL.bodyMid);
  // Eye-row "screen"
  const eyeY = hy + 8;
  rect(hx + 4, eyeY, 28, 12, COL.void);
  // Glowing eyes (two scanner dots)
  const eyeColor = o.eyeColor;
  const intensity = Math.max(0.3, o.eyeIntensity);
  // Left eye
  rect(hx + 8, eyeY + 2, 6, 4, COL.bodyMid);
  rect(hx + 9, eyeY + 3, 4, 2, eyeColor);
  if (intensity > 0.6) {
    rect(hx + 9, eyeY + 3, 4, 1, COL.white);
  }
  // Right eye
  rect(hx + 22, eyeY + 2, 6, 4, COL.bodyMid);
  rect(hx + 23, eyeY + 3, 4, 2, eyeColor);
  if (intensity > 0.6) {
    rect(hx + 23, eyeY + 3, 4, 1, COL.white);
  }
  // Mouth/speaker grille
  rect(hx + 12, eyeY + 8, 12, 2, COL.bodyLight);
  for (let i = 0; i < 6; i++) {
    rect(hx + 12 + i * 2, eyeY + 8, 1, 2, i % 2 === 0 ? COL.cyan : COL.void);
  }

  // === Antenna mast on top of head ===
  const aX = cx;
  const aY = hy - 4;
  rect(aX - 2, aY - 36, 4, 36, COL.bodyDark);
  rect(aX - 1, aY - 36, 1, 36, COL.bodyLight);
  // Cross beams
  rect(aX - 10, aY - 20, 20, 2, COL.bodyDark);
  rect(aX - 8, aY - 28, 16, 2, COL.bodyDark);
  rect(aX - 6, aY - 36, 12, 2, COL.bodyDark);
  // Antenna tip with red warning light
  rect(aX - 2, aY - 40, 4, 4, COL.redDim);
  rect(aX - 1, aY - 39, 2, 2, COL.red);
  // Glow around tip
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = COL.red;
  ctx.beginPath();
  ctx.arc(aX, aY - 38, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // === Broadcast waves emanating from antenna ===
  if (o.antennaCrackle > 0.2) {
    ctx.save();
    ctx.globalAlpha = 0.6 * o.antennaCrackle;
    // Concentric arcs
    ctx.strokeStyle = COL.cyan;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const r = 8 + i * 6;
      ctx.beginPath();
      ctx.arc(aX, aY - 38, r, -Math.PI * 0.7, -Math.PI * 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  // === Lightning crackle around antenna ===
  if (o.antennaCrackle > 0.4) {
    rseed(Math.floor(o.antennaCrackle * 1000) + 222);
    for (let i = 0; i < 3; i++) {
      const angle = srand() * Math.PI * 2;
      const len = 8 + srand() * 10;
      drawBolt(ctx,
        aX, aY - 38,
        aX + Math.cos(angle) * len, aY - 38 + Math.sin(angle) * len,
        i % 2 === 0 ? COL.cyan : COL.pink,
        1
      );
    }
  }

  // === Arms (cable tendrils with plug-end fists) ===
  // Pose varies per frame
  drawArm(ctx, cx, cy, 'left', o.armPose);
  drawArm(ctx, cx, cy, 'right', o.armPose);

  // === Extra sparks/embers ===
  if (o.extraSparks) {
    rseed(Math.floor(o.bob * 100) + 99);
    ctx.fillStyle = COL.cyan;
    for (let i = 0; i < 8; i++) {
      px(cx - 40 + srand() * 80, cy - 20 + srand() * 60, srand() > 0.5 ? COL.cyan : COL.pink);
    }
  }
}

/**
 * Draw a single arm. Pose:
 *   'idle'    - arms hanging at sides
 *   'raised'  - arms up (slam wind-up)
 *   'down'    - arms slammed downward (after slam)
 *   'forward' - arms outstretched forward (laser/zone cast)
 */
function drawArm(ctx, cx, cy, side, pose) {
  const dir = side === 'left' ? -1 : 1;
  const shoulderX = cx + dir * 30;
  const shoulderY = cy - 10;

  ctx.fillStyle = COL.bodyDark;

  if (pose === 'raised') {
    // Arm raised diagonally up
    for (let i = 0; i < 24; i++) {
      const armX = shoulderX + dir * (i * 0.3);
      const armY = shoulderY - i * 1.2;
      ctx.fillRect(Math.floor(armX), Math.floor(armY), 4, 4);
    }
    // Plug-fist at end
    drawPlugFist(ctx, shoulderX + dir * 8, shoulderY - 30, dir);
    // Crackle around fist
    ctx.fillStyle = COL.cyan;
    drawBolt(ctx, shoulderX + dir * 8, shoulderY - 30, shoulderX + dir * 14, shoulderY - 38, COL.cyan, 1);
  } else if (pose === 'down') {
    // Arm slammed down past body
    for (let i = 0; i < 24; i++) {
      const armX = shoulderX + dir * (i * 0.4);
      const armY = shoulderY + i * 1.2;
      ctx.fillRect(Math.floor(armX), Math.floor(armY), 4, 4);
    }
    drawPlugFist(ctx, shoulderX + dir * 10, shoulderY + 28, dir);
  } else if (pose === 'forward') {
    // Arm extended forward (toward camera, downward angle)
    for (let i = 0; i < 24; i++) {
      const armX = shoulderX + dir * (i * 0.8);
      const armY = shoulderY + i * 0.3;
      ctx.fillRect(Math.floor(armX), Math.floor(armY), 4, 4);
    }
    drawPlugFist(ctx, shoulderX + dir * 22, shoulderY + 7, dir);
    // Crackle
    ctx.fillStyle = COL.pink;
    drawBolt(ctx, shoulderX + dir * 22, shoulderY + 7, shoulderX + dir * 30, shoulderY + 13, COL.pink, 1);
  } else {
    // Idle: arms hanging at sides
    for (let i = 0; i < 22; i++) {
      const armX = shoulderX + dir * Math.sin(i / 10) * 2;
      const armY = shoulderY + i;
      ctx.fillRect(Math.floor(armX), Math.floor(armY), 4, 4);
    }
    drawPlugFist(ctx, shoulderX, shoulderY + 24, dir);
  }
}

/**
 * Draw an RJ45-style plug fist
 */
function drawPlugFist(ctx, x, y, dir) {
  // Body of plug
  ctx.fillStyle = COL.bodyHi;
  ctx.fillRect(x - 5, y - 4, 10, 8);
  ctx.fillStyle = COL.bodyMid;
  ctx.fillRect(x - 4, y - 3, 8, 6);
  // Plug tip (lighter, with pins)
  ctx.fillStyle = COL.cyanBright;
  ctx.fillRect(x + (dir > 0 ? 5 : -7), y - 2, 2, 4);
  ctx.fillStyle = COL.cyan;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x + (dir > 0 ? 6 : -7) + (dir > 0 ? 0 : 1), y - 2 + i, 1, 1);
  }
  // Highlight on top
  ctx.fillStyle = COL.bodyLight;
  ctx.fillRect(x - 4, y - 4, 8, 1);
}

// ============================================================
// ANIMATION FRAMES
// ============================================================

// === Row 0: IDLE (8 frames) ===
function frameIdle(col) {
  const frame = col / 7;
  const bob = Math.sin(frame * Math.PI * 2) * 2;
  drawBossBody(col * CELL_W, 0, {
    bob,
    armPose: 'idle',
    eyeColor: COL.cyan,
    eyeIntensity: 0.6 + Math.sin(frame * Math.PI * 2) * 0.3,
    chargeGlow: 0.1,
    antennaCrackle: 0.3 + (col % 2 === 0 ? 0.2 : 0),
    voidWispOffset: Math.sin(frame * Math.PI * 4) * 1,
    extraSparks: (col === 3 || col === 6)
  });
}

// === Row 1: SystemDown shockwave - arms raise then slam ===
function frameSystemDown(col) {
  const t = col / 7; // 0..1 progress
  // Frames 0-3: wind up (arms raise)
  // Frames 4-5: slam (arms down with impact)
  // Frames 6-7: recovery (wave emanating)
  const y = CELL_H;
  let opts;
  if (col < 4) {
    // Wind up: arms raising
    const armProgress = col / 3;
    opts = {
      bob: -armProgress * 4,
      armPose: 'raised',
      eyeColor: COL.cyan,
      eyeIntensity: 0.6 + armProgress * 0.4,
      chargeGlow: armProgress,
      antennaCrackle: 0.4 + armProgress * 0.5,
      extraSparks: armProgress > 0.3
    };
  } else if (col < 6) {
    // Slam (arms down)
    opts = {
      bob: 6,
      armPose: 'down',
      eyeColor: COL.red,
      eyeIntensity: 1,
      chargeGlow: 0.3,
      antennaCrackle: 0.9,
      extraSparks: true
    };
    // Draw shockwave ring at boss base
    const cx = col * CELL_W + CELL_W / 2;
    const cy = y + CELL_H / 2 + 60;
    const radius = (col - 4) * 20 + 30;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = COL.yellow;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = COL.red;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.7, radius * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else {
    // Recovery
    opts = {
      bob: 2,
      armPose: 'idle',
      eyeColor: COL.cyan,
      eyeIntensity: 0.4,
      chargeGlow: 0.1,
      antennaCrackle: 0.5,
      extraSparks: false
    };
  }
  drawBossBody(col * CELL_W, y, opts);
}

// === Row 2: DataCorruption laser - charge from eye, fire beam ===
function frameDataCorruption(col) {
  const y = CELL_H * 2;
  let opts;
  if (col < 3) {
    // Charge up - chest glows, eye brightens, lean forward
    const ch = col / 2;
    opts = {
      bob: 0,
      armPose: 'idle',
      eyeColor: COL.pink,
      eyeIntensity: 0.7 + ch * 0.3,
      chargeGlow: 0.4 + ch * 0.6,
      antennaCrackle: 0.5 + ch * 0.4,
      extraSparks: ch > 0.4
    };
  } else if (col < 6) {
    // Fire beam (frames 3-5 active)
    opts = {
      bob: -2,
      armPose: 'idle',
      eyeColor: COL.pinkBright,
      eyeIntensity: 1,
      chargeGlow: 1,
      antennaCrackle: 1,
      extraSparks: true
    };
    // Draw beam
    const cx = col * CELL_W + CELL_W / 2;
    const cy = y + CELL_H / 2 - 4;
    // From eye
    const beamY = y + 24;
    // Outer beam (pink)
    ctx.save();
    ctx.fillStyle = COL.pink;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(cx + 12, beamY - 4, CELL_W - cx + col * CELL_W, 12);
    // Inner beam (white-hot)
    ctx.fillStyle = COL.white;
    ctx.globalAlpha = 1;
    ctx.fillRect(cx + 12, beamY - 1, CELL_W - cx + col * CELL_W, 4);
    // Beam crackle
    ctx.fillStyle = COL.cyan;
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(cx + 14 + i * 8 + Math.floor(srand() * 4), beamY - 6 + Math.floor(srand() * 12), 2, 2);
    }
    ctx.restore();
  } else {
    // Wind down
    opts = {
      bob: 1,
      armPose: 'idle',
      eyeColor: COL.cyan,
      eyeIntensity: 0.5,
      chargeGlow: 0.3,
      antennaCrackle: 0.4,
      extraSparks: false
    };
  }
  drawBossBody(col * CELL_W, y, opts);
}

// === Row 3: ServiceRestarts - arms forward, hurl packet orbs ===
function frameServiceRestarts(col) {
  const y = CELL_H * 3;
  let opts;
  if (col < 3) {
    // Wind up - arms come forward, summon orbs
    const ch = col / 2;
    opts = {
      bob: 0,
      armPose: 'forward',
      eyeColor: COL.yellow,
      eyeIntensity: 0.7 + ch * 0.3,
      chargeGlow: 0.3 + ch * 0.4,
      antennaCrackle: 0.4 + ch * 0.4,
      extraSparks: ch > 0.3
    };
    drawBossBody(col * CELL_W, y, opts);
    // Orbs forming in palms
    const cx = col * CELL_W + CELL_W / 2;
    const cy = y + CELL_H / 2 - 3;
    const orbR = 4 + ch * 4;
    [-1, 1].forEach(dir => {
      const orbX = cx + dir * 38;
      const orbY = cy + 7;
      // Orb body
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = COL.yellow;
      ctx.beginPath();
      ctx.arc(orbX, orbY, orbR + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COL.white;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(orbX, orbY, orbR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  } else if (col < 6) {
    // Hurl orbs (frames 3-5) - arms forward, orbs trailing
    opts = {
      bob: -1,
      armPose: 'forward',
      eyeColor: COL.yellow,
      eyeIntensity: 1,
      chargeGlow: 0.7,
      antennaCrackle: 0.8,
      extraSparks: true
    };
    drawBossBody(col * CELL_W, y, opts);
    // Trailing orbs flying outward
    const cx = col * CELL_W + CELL_W / 2;
    const cy = y + CELL_H / 2 - 3;
    const trailProgress = (col - 3) / 2;
    [-1, 1].forEach(dir => {
      const orbX = cx + dir * (40 + trailProgress * 28);
      const orbY = cy + 8;
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = COL.yellow;
      ctx.beginPath();
      ctx.arc(orbX, orbY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COL.white;
      ctx.beginPath();
      ctx.arc(orbX, orbY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Trail
      ctx.save();
      ctx.fillStyle = COL.yellow;
      ctx.globalAlpha = 0.4;
      for (let i = 1; i < 4; i++) {
        const tx = cx + dir * (40 + trailProgress * 28 - dir * i * 6);
        ctx.beginPath();
        ctx.arc(tx, orbY, 3 - i * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  } else {
    // Recovery
    opts = {
      bob: 1,
      armPose: 'idle',
      eyeColor: COL.cyan,
      eyeIntensity: 0.5,
      chargeGlow: 0.2,
      antennaCrackle: 0.4,
      extraSparks: false
    };
    drawBossBody(col * CELL_W, y, opts);
  }
}

// ============================================================
// MAIN
// ============================================================
console.log(`Generating ${W}x${H} BROADCAST STORM boss sprite sheet...`);

for (let col = 0; col < COLS; col++) {
  rseed(col * 1000 + 1);
  frameIdle(col);
}
for (let col = 0; col < COLS; col++) {
  rseed(col * 1000 + 2);
  frameSystemDown(col);
}
for (let col = 0; col < COLS; col++) {
  rseed(col * 1000 + 3);
  frameDataCorruption(col);
}
for (let col = 0; col < COLS; col++) {
  rseed(col * 1000 + 4);
  frameServiceRestarts(col);
}

// SAVE
const outDir = path.join(__dirname, '..', 'public', 'sprites');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'boss.png');
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);
console.log(`\n✓ Saved ${outPath}`);
console.log(`  Dimensions: ${W}x${H} (${COLS} cols × ${ROWS} rows)`);
console.log(`  Cell size: ${CELL_W}x${CELL_H}`);
console.log(`  Size: ${(buffer.length / 1024).toFixed(1)} KB`);
console.log(`\n  Row 0: idle (8 frames)`);
console.log(`  Row 1: SystemDown shockwave (8 frames)`);
console.log(`  Row 2: DataCorruption laser (8 frames)`);
console.log(`  Row 3: ServiceRestarts packet orbs (8 frames)`);
