/**
 * Generate the cinematic death sprite sheet for the BROADCAST STORM boss.
 *
 * 64 frames across 8 rows × 8 columns. Each phase = 8 frames = ~0.65s at 12fps,
 * total ~5.2 seconds of slow cinematic death.
 *
 *   Phase 0 (frames 0-7):   Stagger - body shakes, eyes flicker
 *   Phase 1 (frames 8-15):  Head tilts up, mouth opens, screaming begins
 *   Phase 2 (frames 16-23): Full scream - white light beams from eyes/mouth
 *   Phase 3 (frames 24-31): Energy swirls in vortex around body
 *   Phase 4 (frames 32-39): Body cracks open with bright light
 *   Phase 5 (frames 40-47): Body collapses, breaks into chunks
 *   Phase 6 (frames 48-55): Vaporizing - body dissolves to particles
 *   Phase 7 (frames 56-63): Final dispersal - just sparkles fading
 *
 * Run: npm run boss-death:gen
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const CELL_W = 160;
const CELL_H = 200;
const COLS = 8;
const ROWS = 8;
const W = COLS * CELL_W;
const H = ROWS * CELL_H;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ============================================================
// PALETTE - same Broadcast Storm theme
// ============================================================
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
  bone: '#f0e0c0',
  green: '#22ff66'
};

// ============================================================
// HELPERS
// ============================================================
let seed = 911;
function srand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function rseed(s) { seed = s; }
function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.floor(x), Math.floor(y), w, h); }
function px(x, y, c) { rect(x, y, 1, 1, c); }

function drawBolt(x1, y1, x2, y2, color, width) {
  width = width || 1;
  const segments = 6;
  let cx = x1, cy = y1;
  ctx.fillStyle = color;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const tx = x1 + (x2 - x1) * t + (srand() - 0.5) * 10;
    const ty = y1 + (y2 - y1) * t + (srand() - 0.5) * 8;
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
 * Plug fist (cable end) for arms
 */
function drawPlug(x, y, dir) {
  rect(x - 5, y - 4, 10, 8, COL.bodyHi);
  rect(x - 4, y - 3, 8, 6, COL.bodyMid);
  rect(x + (dir > 0 ? 5 : -7), y - 2, 2, 4, COL.cyanBright);
}

/**
 * Crack/fracture line through the boss body
 */
function drawCrack(x, y, len, angle, color) {
  for (let i = 0; i < len; i++) {
    const cx = x + Math.cos(angle) * i + (srand() - 0.5) * 1.5;
    const cy = y + Math.sin(angle) * i + (srand() - 0.5) * 1.5;
    px(cx, cy, color);
    if (i % 3 === 0) px(cx + 1, cy, color);
  }
}

/**
 * Draw the boss body in various damage states.
 * progress 0..1 = how broken the body is
 * tiltUp = head tilt for screaming (radians)
 * mouthOpen = how wide the mouth is (0..1)
 * eyeBeam = whether eyes emit beam (true/false)
 * armPose = 'idle', 'flailing', 'collapsed', 'reaching-up'
 */
function drawDyingBody(cellX, cellY, opts) {
  const o = Object.assign({
    bob: 0,
    cracks: 0,           // 0..1 crack intensity (visible damage)
    tiltUp: 0,           // head tilt
    mouthOpen: 0,        // 0..1 mouth open amount
    eyeBeam: false,
    armPose: 'idle',
    sagBody: 0,          // 0..1 amount body has slumped
    integrity: 1,        // 1=intact, 0=fully dissolved
    swirlIntensity: 0,   // 0..1 energy swirl
    auraSize: 0,         // 0..1 size of aura halo
    auraColor: COL.cyan
  }, opts);

  const cx = cellX + CELL_W / 2;
  const cy = cellY + CELL_H / 2 + o.bob + (o.sagBody * 30);

  // === Aura halo (charge/scream energy) ===
  if (o.auraSize > 0 && o.integrity > 0) {
    ctx.save();
    ctx.globalAlpha = 0.35 * o.auraSize;
    ctx.fillStyle = o.auraColor;
    ctx.beginPath();
    ctx.arc(cx, cy - 10, 50 + o.auraSize * 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5 * o.auraSize;
    ctx.beginPath();
    ctx.arc(cx, cy - 10, 30 + o.auraSize * 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // === Swirling energy vortex ===
  if (o.swirlIntensity > 0 && o.integrity > 0.1) {
    rseed(Math.floor(o.swirlIntensity * 9999) + 31);
    for (let i = 0; i < 24 * o.swirlIntensity; i++) {
      const angle = srand() * Math.PI * 2;
      const r = 30 + srand() * 50 * o.swirlIntensity;
      const sx = cx + Math.cos(angle) * r;
      const sy = cy + Math.sin(angle) * r * 0.7;
      const colors = [COL.cyan, COL.pink, COL.yellow, COL.white];
      ctx.fillStyle = colors[i % colors.length];
      const size = srand() > 0.5 ? 2 : 3;
      ctx.fillRect(Math.floor(sx), Math.floor(sy), size, size);
    }
  }

  // === Lower wisp (fades with integrity) ===
  if (o.integrity > 0.3) {
    ctx.save();
    ctx.globalAlpha = o.integrity;
    const wispY = cy + 32;
    rect(cx - 30, wispY, 60, 12, COL.bodyDark);
    rect(cx - 36, wispY - 2, 12, 10, COL.bodyDark);
    rect(cx + 24, wispY - 2, 12, 10, COL.bodyDark);
    rect(cx - 24, wispY + 10, 48, 8, COL.bodyDark);
    rect(cx - 20, wispY + 16, 40, 6, COL.bodyDark);
    ctx.restore();
  }

  // === Torso (collapses, cracks, fades) ===
  if (o.integrity > 0.05) {
    ctx.save();
    ctx.globalAlpha = o.integrity;
    const tx = cx - 30;
    const ty = cy - 24;
    // Outer black
    rect(tx - 2, ty - 2, 64, 54, COL.void);
    // Body
    rect(tx, ty, 60, 50, COL.bodyDark);
    rect(tx + 4, ty + 4, 18, 8, COL.bodyMid);
    rect(tx + 38, ty + 4, 18, 6, COL.bodyMid);
    rect(tx + 16, ty + 30, 20, 8, COL.bodyMid);
    // Top highlight
    rect(tx + 2, ty + 2, 12, 2, COL.bodyLight);
    rect(tx + 44, ty + 2, 12, 2, COL.bodyLight);

    // Power core - glowing brightly during death
    const chestX = cx - 6;
    const chestY = cy - 4;
    const coreIntensity = Math.min(1, 0.5 + o.auraSize);
    if (coreIntensity > 0.2) {
      rect(chestX - 4, chestY - 4, 20, 20, COL.cyan);
      rect(chestX - 2, chestY - 2, 16, 16, COL.cyanBright);
      rect(chestX + 2, chestY + 2, 8, 8, COL.white);
    }

    // CRACKS through body (more as integrity falls)
    if (o.cracks > 0) {
      rseed(Math.floor(o.cracks * 999) + 47);
      const numCracks = Math.floor(o.cracks * 6);
      for (let i = 0; i < numCracks; i++) {
        const startX = tx + 6 + srand() * 50;
        const startY = ty + 4 + srand() * 40;
        const angle = srand() * Math.PI * 2;
        const len = 12 + srand() * 20;
        const crackColor = i % 3 === 0 ? COL.pinkBright : i % 3 === 1 ? COL.cyanBright : COL.white;
        drawCrack(startX, startY, len, angle, crackColor);
      }
    }
    ctx.restore();
  }

  // === Antenna head (tilts up for scream) ===
  if (o.integrity > 0.1) {
    ctx.save();
    ctx.globalAlpha = o.integrity;
    // Pivot at neck
    const headPivotX = cx;
    const headPivotY = cy - 24;
    ctx.translate(headPivotX, headPivotY);
    ctx.rotate(-o.tiltUp * Math.PI / 4); // Up to 45 degrees back
    ctx.translate(-headPivotX, -headPivotY);

    const hx = cx - 18;
    const hy = cy - 24 - 28;
    rect(hx - 2, hy - 2, 40, 32, COL.void);
    rect(hx, hy, 36, 28, COL.bodyDark);
    rect(hx + 4, hy + 2, 28, 4, COL.bodyMid);

    // Eye-row screen
    const eyeY = hy + 8;
    rect(hx + 4, eyeY, 28, 12, COL.void);

    // Eyes: change with state
    if (o.eyeBeam) {
      // Eyes are pure white beams of light
      rect(hx + 8, eyeY, 6, 8, COL.white);
      rect(hx + 22, eyeY, 6, 8, COL.white);
      // Beam shooting up from eyes
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = COL.white;
      ctx.fillRect(hx + 9, eyeY - 200, 4, 200);
      ctx.fillRect(hx + 23, eyeY - 200, 4, 200);
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = COL.cyanBright;
      ctx.fillRect(hx + 7, eyeY - 200, 8, 200);
      ctx.fillRect(hx + 21, eyeY - 200, 8, 200);
      ctx.restore();
    } else {
      // Flickering eyes (red/cyan)
      const eyeColor = srand() > 0.5 ? COL.red : COL.cyan;
      rect(hx + 8, eyeY + 2, 6, 4, COL.bodyMid);
      rect(hx + 9, eyeY + 3, 4, 2, eyeColor);
      rect(hx + 22, eyeY + 2, 6, 4, COL.bodyMid);
      rect(hx + 23, eyeY + 3, 4, 2, eyeColor);
    }

    // Mouth opens for scream
    if (o.mouthOpen > 0) {
      const mw = 8 + o.mouthOpen * 14;
      const mh = 4 + o.mouthOpen * 14;
      const mx = hx + 18 - mw / 2;
      const my = eyeY + 8;
      // Dark interior
      ctx.fillStyle = COL.void;
      ctx.fillRect(mx, my, mw, mh);
      // Inner light
      const innerLight = mw - 4;
      const innerHeight = mh - 2;
      if (innerLight > 0) {
        ctx.fillStyle = COL.white;
        ctx.globalAlpha = 0.6 + 0.4 * o.mouthOpen;
        ctx.fillRect(mx + 2, my + 1, innerLight, innerHeight);
        // Brightest core
        ctx.globalAlpha = 1;
        ctx.fillStyle = COL.cyanBright;
        ctx.fillRect(mx + Math.floor(innerLight / 4) + 2, my + 1, innerLight / 2, innerHeight);
      }
    }

    // Antenna mast
    const aX = cx;
    const aY = hy - 4;
    rect(aX - 2, aY - 36, 4, 36, COL.bodyDark);
    rect(aX - 1, aY - 36, 1, 36, COL.bodyLight);
    rect(aX - 10, aY - 20, 20, 2, COL.bodyDark);
    rect(aX - 8, aY - 28, 16, 2, COL.bodyDark);
    rect(aX - 6, aY - 36, 12, 2, COL.bodyDark);
    rect(aX - 2, aY - 40, 4, 4, COL.redDim);
    rect(aX - 1, aY - 39, 2, 2, COL.red);

    // Energy beams from antenna during scream
    if (o.eyeBeam) {
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = COL.white;
      ctx.fillRect(aX - 1, aY - 200, 2, 165);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = COL.cyan;
      ctx.fillRect(aX - 3, aY - 200, 6, 165);
      ctx.restore();
    }

    ctx.restore(); // pop head rotation
  }

  // === Arms ===
  if (o.integrity > 0.2) {
    ctx.save();
    ctx.globalAlpha = o.integrity;
    drawDyingArm(cx, cy, 'left', o.armPose);
    drawDyingArm(cx, cy, 'right', o.armPose);
    ctx.restore();
  }
}

function drawDyingArm(cx, cy, side, pose) {
  const dir = side === 'left' ? -1 : 1;
  const shoulderX = cx + dir * 30;
  const shoulderY = cy - 10;

  ctx.fillStyle = COL.bodyDark;

  if (pose === 'flailing') {
    // Arms outstretched, slightly chaotic
    for (let i = 0; i < 24; i++) {
      const armX = shoulderX + dir * (i * 0.8) + (srand() - 0.5) * 2;
      const armY = shoulderY - i * 0.5;
      ctx.fillRect(Math.floor(armX), Math.floor(armY), 4, 4);
    }
    drawPlug(shoulderX + dir * 22, shoulderY - 12, dir);
  } else if (pose === 'reaching-up') {
    // Arms reaching to the sky
    for (let i = 0; i < 28; i++) {
      const armX = shoulderX + dir * (i * 0.2);
      const armY = shoulderY - i * 1.2;
      ctx.fillRect(Math.floor(armX), Math.floor(armY), 4, 4);
    }
    drawPlug(shoulderX + dir * 6, shoulderY - 34, dir);
  } else if (pose === 'collapsed') {
    // Arms dangling down
    for (let i = 0; i < 24; i++) {
      const armX = shoulderX + dir * Math.sin(i / 6) * 4;
      const armY = shoulderY + i;
      ctx.fillRect(Math.floor(armX), Math.floor(armY), 4, 4);
    }
    drawPlug(shoulderX, shoulderY + 26, dir);
  } else {
    // Idle (default)
    for (let i = 0; i < 22; i++) {
      const armX = shoulderX + dir * Math.sin(i / 10) * 2;
      const armY = shoulderY + i;
      ctx.fillRect(Math.floor(armX), Math.floor(armY), 4, 4);
    }
    drawPlug(shoulderX, shoulderY + 24, dir);
  }
}

// ============================================================
// PHASE RENDERERS
// ============================================================

// Phase 0: Stagger - frames 0-7
function renderPhase0_Stagger(col, row) {
  const t = col / 7;
  rseed(col * 100 + 1);
  drawDyingBody(col * CELL_W, row * CELL_H, {
    bob: Math.sin(col * 1.5) * 4,
    cracks: t * 0.3,
    tiltUp: 0,
    mouthOpen: t * 0.2,
    eyeBeam: false,
    armPose: 'flailing',
    sagBody: 0,
    integrity: 1,
    swirlIntensity: t * 0.2,
    auraSize: t * 0.3,
    auraColor: COL.red
  });
}

// Phase 1: Head tilts up, scream begins - frames 8-15
function renderPhase1_LookUp(col, row) {
  const t = col / 7;
  rseed(col * 100 + 2);
  drawDyingBody(col * CELL_W, row * CELL_H, {
    bob: -t * 3,
    cracks: 0.3 + t * 0.2,
    tiltUp: t * 0.7,
    mouthOpen: 0.2 + t * 0.6,
    eyeBeam: t > 0.6,
    armPose: 'reaching-up',
    sagBody: 0,
    integrity: 1,
    swirlIntensity: 0.3 + t * 0.4,
    auraSize: 0.4 + t * 0.4,
    auraColor: COL.cyan
  });
}

// Phase 2: Full scream - frames 16-23
function renderPhase2_Scream(col, row) {
  const t = col / 7;
  rseed(col * 100 + 3);
  drawDyingBody(col * CELL_W, row * CELL_H, {
    bob: -3,
    cracks: 0.5 + t * 0.2,
    tiltUp: 0.7,
    mouthOpen: 1,
    eyeBeam: true,
    armPose: 'reaching-up',
    sagBody: 0,
    integrity: 1,
    swirlIntensity: 0.7 + t * 0.3,
    auraSize: 0.8 + t * 0.2,
    auraColor: COL.white
  });
  // Extra exploding particles
  const cx = col * CELL_W + CELL_W / 2;
  const cy = row * CELL_H + CELL_H / 2;
  ctx.save();
  for (let i = 0; i < 30; i++) {
    const angle = srand() * Math.PI * 2;
    const r = 20 + srand() * 60;
    const sx = cx + Math.cos(angle) * r;
    const sy = cy + Math.sin(angle) * r * 0.7;
    const colors = [COL.white, COL.cyan, COL.pink, COL.yellow];
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(Math.floor(sx), Math.floor(sy), 2, 2);
  }
  ctx.restore();
}

// Phase 3: Energy vortex swirl - frames 24-31
function renderPhase3_Swirl(col, row) {
  const t = col / 7;
  rseed(col * 100 + 4);
  drawDyingBody(col * CELL_W, row * CELL_H, {
    bob: -2 + t * 4,
    cracks: 0.7 + t * 0.2,
    tiltUp: 0.7 - t * 0.3,
    mouthOpen: 1 - t * 0.3,
    eyeBeam: t < 0.5,
    armPose: 'reaching-up',
    sagBody: t * 0.1,
    integrity: 1,
    swirlIntensity: 1,
    auraSize: 1,
    auraColor: COL.pink
  });
  // Spiral particles around boss
  const cx = col * CELL_W + CELL_W / 2;
  const cy = row * CELL_H + CELL_H / 2;
  for (let i = 0; i < 50; i++) {
    const angle = (i / 50) * Math.PI * 6 + col;
    const r = 30 + (i / 50) * 40;
    const sx = cx + Math.cos(angle) * r;
    const sy = cy + Math.sin(angle) * r * 0.8;
    const colors = [COL.white, COL.cyan, COL.pink, COL.yellow];
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(Math.floor(sx), Math.floor(sy), 2, 2);
  }
}

// Phase 4: Body cracks open with bright light - frames 32-39
function renderPhase4_Cracking(col, row) {
  const t = col / 7;
  rseed(col * 100 + 5);
  drawDyingBody(col * CELL_W, row * CELL_H, {
    bob: 2 + t * 4,
    cracks: 1,
    tiltUp: 0.4 - t * 0.3,
    mouthOpen: 0.7 - t * 0.3,
    eyeBeam: false,
    armPose: 'flailing',
    sagBody: 0.1 + t * 0.3,
    integrity: 1 - t * 0.1,
    swirlIntensity: 0.8,
    auraSize: 1,
    auraColor: COL.white
  });
  // Big light beams shooting out through cracks
  const cx = col * CELL_W + CELL_W / 2;
  const cy = row * CELL_H + CELL_H / 2;
  ctx.save();
  ctx.globalAlpha = 0.5 + t * 0.5;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + col * 0.2;
    const len = 40 + t * 30;
    const ex = cx + Math.cos(angle) * len;
    const ey = cy + Math.sin(angle) * len * 0.8;
    ctx.fillStyle = COL.white;
    ctx.fillRect(Math.floor(cx + Math.cos(angle) * 10), Math.floor(cy + Math.sin(angle) * 8), 2, 2);
    drawBolt(cx, cy, ex, ey, COL.cyanBright, 2);
  }
  ctx.restore();
}

// Phase 5: Body collapses, breaks into chunks - frames 40-47
function renderPhase5_Collapse(col, row) {
  const t = col / 7;
  rseed(col * 100 + 6);
  drawDyingBody(col * CELL_W, row * CELL_H, {
    bob: 8 + t * 12,
    cracks: 1,
    tiltUp: 0.1 - t * 0.1,
    mouthOpen: 0.3 - t * 0.3,
    eyeBeam: false,
    armPose: 'collapsed',
    sagBody: 0.4 + t * 0.3,
    integrity: 0.9 - t * 0.4,
    swirlIntensity: 0.6,
    auraSize: 0.8 - t * 0.2,
    auraColor: COL.cyan
  });
  // Chunks falling/floating away
  const cx = col * CELL_W + CELL_W / 2;
  const cy = row * CELL_H + CELL_H / 2;
  ctx.save();
  for (let i = 0; i < 16 + Math.floor(t * 12); i++) {
    const chunkX = cx - 30 + srand() * 60;
    const chunkY = cy - 10 + srand() * 60;
    const chunkSize = 2 + Math.floor(srand() * 4);
    ctx.fillStyle = srand() > 0.5 ? COL.bodyDark : COL.bodyMid;
    ctx.fillRect(Math.floor(chunkX), Math.floor(chunkY), chunkSize, chunkSize);
    // Spark on chunk
    ctx.fillStyle = COL.cyan;
    ctx.fillRect(Math.floor(chunkX), Math.floor(chunkY), 1, 1);
  }
  ctx.restore();
}

// Phase 6: Vaporizing - body dissolves to particles - frames 48-55
function renderPhase6_Vaporize(col, row) {
  const t = col / 7;
  rseed(col * 100 + 7);
  drawDyingBody(col * CELL_W, row * CELL_H, {
    bob: 18 + t * 8,
    cracks: 1,
    tiltUp: 0,
    mouthOpen: 0,
    eyeBeam: false,
    armPose: 'collapsed',
    sagBody: 0.7 + t * 0.2,
    integrity: Math.max(0, 0.5 - t * 0.5),
    swirlIntensity: 0.4 - t * 0.3,
    auraSize: 0.5 - t * 0.4,
    auraColor: COL.cyan
  });
  // Mostly particles now - rising column of light particles
  const cx = col * CELL_W + CELL_W / 2;
  const cy = row * CELL_H + CELL_H / 2;
  ctx.save();
  for (let i = 0; i < 80; i++) {
    const particleAge = srand();
    const px2 = cx - 25 + srand() * 50;
    const py2 = cy + 20 - particleAge * 80 - t * 30;
    const colors = [COL.cyan, COL.pink, COL.white, COL.yellow];
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 1 - particleAge * 0.7;
    ctx.fillRect(Math.floor(px2), Math.floor(py2), 2, 2);
  }
  ctx.restore();
}

// Phase 7: Final dispersal - just sparkles fading - frames 56-63
function renderPhase7_Dissipate(col, row) {
  const t = col / 7;
  rseed(col * 100 + 8);
  // Just particles, no body
  const cx = col * CELL_W + CELL_W / 2;
  const cy = row * CELL_H + CELL_H / 2;
  ctx.save();
  // Fading aura
  if (t < 0.5) {
    ctx.globalAlpha = 0.3 * (1 - t * 2);
    ctx.fillStyle = COL.white;
    ctx.beginPath();
    ctx.arc(cx, cy, 30 - t * 15, 0, Math.PI * 2);
    ctx.fill();
  }
  // Dissipating particles
  const particleCount = Math.floor((1 - t) * 80);
  for (let i = 0; i < particleCount; i++) {
    const angle = srand() * Math.PI * 2;
    const r = 20 + srand() * 50 + t * 30;
    const py2 = cy + Math.sin(angle) * r * 0.7 - t * 40;
    const px2 = cx + Math.cos(angle) * r;
    const colors = [COL.cyan, COL.pink, COL.white, COL.yellow];
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = (1 - t) * (0.5 + srand() * 0.5);
    ctx.fillRect(Math.floor(px2), Math.floor(py2), 1, 1);
  }
  ctx.restore();
}

// ============================================================
// RENDER ALL 64 FRAMES
// ============================================================
console.log(`Generating ${W}x${H} BROADCAST STORM death cinematic (${ROWS * COLS} frames)...`);

const phaseRenderers = [
  renderPhase0_Stagger,
  renderPhase1_LookUp,
  renderPhase2_Scream,
  renderPhase3_Swirl,
  renderPhase4_Cracking,
  renderPhase5_Collapse,
  renderPhase6_Vaporize,
  renderPhase7_Dissipate
];

for (let row = 0; row < ROWS; row++) {
  const renderer = phaseRenderers[row];
  for (let col = 0; col < COLS; col++) {
    renderer(col, row);
  }
  console.log(`  Phase ${row} rendered`);
}

// SAVE
const outDir = path.join(__dirname, '..', 'public', 'sprites');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'boss-death.png');
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);
console.log(`\n✓ Saved ${outPath}`);
console.log(`  Dimensions: ${W}x${H} (${COLS} cols × ${ROWS} rows, ${CELL_W}x${CELL_H} per cell)`);
console.log(`  Size: ${(buffer.length / 1024).toFixed(1)} KB`);
console.log(`\n  Phase 0 (rows 0): Stagger`);
console.log(`  Phase 1 (row 1):  Head tilts up + scream begins`);
console.log(`  Phase 2 (row 2):  Full scream + eye beams`);
console.log(`  Phase 3 (row 3):  Energy vortex swirl`);
console.log(`  Phase 4 (row 4):  Body cracks open with light`);
console.log(`  Phase 5 (row 5):  Collapse - chunks fall away`);
console.log(`  Phase 6 (row 6):  Vaporize - body dissolves to particles`);
console.log(`  Phase 7 (row 7):  Final dispersal`);
