/**
 * CHARACTER GENERATOR — Bill (Corporate Crawler Bill)
 *
 * This is the prototype of a reusable character pipeline. The pipeline has
 * 4 layers (see also: docs/character-pipeline.md):
 *
 *   1. CharacterSpec  - JSON describing palette + features (just data)
 *   2. Pose library   - numeric joint angles per animation frame (shared)
 *   3. Renderer       - procedural pixel-art draw of one pose, takes spec
 *   4. Generator      - writes 56-frame sprite sheet PNG (this file)
 *
 * Why layered? Because once we want a CHARACTER CREATOR, we only need to
 * derive a CharacterSpec from a user photo (sample dominant colors for
 * skin/hair/shirt/pants, detect glasses/mustache). The pose library and
 * renderer never change — they just see different colors in. Animations
 * stay consistent across all characters.
 *
 * To make a new character today: copy BILL_SPEC, change the colors,
 * run this script with a different output filename. That's it.
 *
 * To regenerate Bill: npm run bill:gen
 *
 * Output: public/sprites/BillSpriteSheet.png (8 cols × 7 rows)
 *   Row 0: walk left
 *   Row 1: walk right
 *   Row 2: punch
 *   Row 3: kick
 *   Row 4: special (energy push)
 *   Row 5: KO / defeated
 *   Row 6: jump
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// ============================================================
// LAYER 1: CHARACTER SPEC
// Pure data. Could come from a JSON file, a UI, or photo analysis.
// ============================================================
const BILL_SPEC = {
  name: 'Bill',
  palette: {
    // Skin tones (3 shades for depth)
    skin:        '#d49872',
    skinShadow:  '#a86a4a',
    skinLight:   '#e8b894',
    // Hair
    hair:        '#3a2a18',
    hairLight:   '#5a4228',
    // Eyes / mouth
    eyes:        '#1a0e04',
    teeth:       '#f4ecd8',
    lips:        '#a8624a',
    // Shirt (green flannel, sleeveless)
    shirt:       '#3a5a3a',
    shirtShadow: '#2a4628',
    shirtLight:  '#4a7048',
    // Pants
    pants:       '#3a4a72',
    pantsShadow: '#26365a',
    pantsLight:  '#5266a0',
    // Belt + buckle
    belt:        '#5a3a1a',
    beltBuckle:  '#c8a548',
    // Boots
    boots:       '#1f1208',
    bootsLight:  '#3a2418',
    // Outline (used on body silhouette)
    outline:     '#1a0e04',
    // Dog tag (silver)
    tag:         '#c8c8c8',
    tagDark:     '#8a8a8a'
  },
  features: {
    facialHair: 'none',     // 'none' | 'stubble' | 'mustache'
    glasses: false,
    hat: 'none',
    accessory: 'dogTags',   // 'none' | 'dogTags'
    build: 'muscular'       // affects torso/arm widths
  }
};

const CELL_W = 110;
const CELL_H = 150;
const COLS = 8;
const ROWS = 7;
const SHEET_W = CELL_W * COLS;
const SHEET_H = CELL_H * ROWS;

// Row indices match SpriteLoader.js expectations
const ROW_WALK_L = 0;
const ROW_WALK_R = 1;
const ROW_PUNCH  = 2;
const ROW_KICK   = 3;
const ROW_SPECIAL= 4;
const ROW_KO     = 5;
const ROW_JUMP   = 6;

const canvas = createCanvas(SHEET_W, SHEET_H);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ============================================================
// LAYER 3: RENDERER (drawing primitives)
//   - Pure pixel art, no anti-aliasing
//   - Takes a CharacterSpec for colors
//   - Each part has a draw function that accepts position + angles
// ============================================================

function rect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}
function px(x, y, color) { rect(x, y, 1, 1, color); }

/**
 * Draw a thick "limb" line from (x1,y1) to (x2,y2) with two color stripes
 * (the inner color on one side gives a shaded look). This is the cornerstone
 * of arm/leg rendering. Pixel-stepping algorithm so it stays crisp.
 */
function drawLimb(x1, y1, x2, y2, color, thickness, shadowColor) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const steps = Math.ceil(len);
  const halfT = Math.floor(thickness / 2);
  // Step along the limb, drawing a thickness-wide square at each step
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x1 + dx * t);
    const y = Math.round(y1 + dy * t);
    // Body color
    rect(x - halfT, y - halfT, thickness, thickness, color);
    // Inner shadow stripe (one pixel offset) for definition
    if (shadowColor && thickness >= 3) {
      rect(x - halfT, y + halfT - 1, thickness, 1, shadowColor);
    }
  }
}

/**
 * Draw an oval/elliptical body shape (used for torso, head, fist, etc.)
 */
function drawOval(cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(Math.round(cx), Math.round(cy), Math.round(rx), Math.round(ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

// === HEAD ===
// Includes hair, face, eyes, mouth, optional facial hair
function drawHead(cx, cy, tilt, spec) {
  const p = spec.palette;
  // tilt is in radians: positive = tilted left (head leaning right toward viewer)
  // For now we ignore tilt and just draw upright (could add rotation later)
  const w = 16, h = 18;

  // Outline silhouette
  rect(cx - w/2 - 1, cy - h/2 - 1, w + 2, h + 2, p.outline);

  // Skin base
  rect(cx - w/2, cy - h/2, w, h, p.skin);
  // Cheek shadow
  rect(cx + w/2 - 3, cy - 2, 3, h - 6, p.skinShadow);
  // Forehead highlight
  rect(cx - w/2 + 2, cy - h/2 + 2, w - 4, 1, p.skinLight);

  // Hair (top + sides)
  rect(cx - w/2, cy - h/2, w, 5, p.hair);  // top cap
  rect(cx - w/2, cy - h/2 + 5, 2, 4, p.hair);  // left sideburn
  rect(cx + w/2 - 2, cy - h/2 + 5, 2, 4, p.hair);  // right sideburn
  // Hair highlight
  rect(cx - w/2 + 3, cy - h/2 + 1, 4, 1, p.hairLight);
  rect(cx + w/2 - 5, cy - h/2 + 2, 3, 1, p.hairLight);

  // Eye brows (tough-guy: thick, slightly furrowed)
  rect(cx - 5, cy - 3, 3, 1, p.hair);
  rect(cx + 2, cy - 3, 3, 1, p.hair);

  // Eyes (squinty tough-guy eyes)
  rect(cx - 5, cy - 1, 3, 2, p.teeth);
  rect(cx + 2, cy - 1, 3, 2, p.teeth);
  rect(cx - 4, cy - 1, 1, 1, p.eyes);
  rect(cx + 3, cy - 1, 1, 1, p.eyes);

  // Optional glasses
  if (spec.features.glasses) {
    rect(cx - 6, cy - 2, 5, 4, p.outline);
    rect(cx - 5, cy - 1, 3, 2, p.skinLight);
    rect(cx + 1, cy - 2, 5, 4, p.outline);
    rect(cx + 2, cy - 1, 3, 2, p.skinLight);
    rect(cx - 1, cy - 1, 2, 1, p.outline);  // bridge
  }

  // Nose
  rect(cx, cy + 1, 1, 3, p.skinShadow);
  rect(cx - 1, cy + 3, 3, 1, p.skinShadow);

  // Mouth — slight smirk (tough guy)
  rect(cx - 3, cy + 6, 6, 1, p.lips);
  rect(cx - 2, cy + 5, 4, 1, p.lips);  // smirk corner

  // Optional facial hair
  if (spec.features.facialHair === 'mustache') {
    rect(cx - 4, cy + 4, 8, 2, p.hair);
  } else if (spec.features.facialHair === 'stubble') {
    // Scattered dark pixels around chin/jaw
    [[cx - 4, cy + 7], [cx - 2, cy + 8], [cx, cy + 7], [cx + 2, cy + 8],
     [cx + 4, cy + 7], [cx - 5, cy + 4], [cx + 4, cy + 4]].forEach(([px2, py]) =>
      rect(px2, py, 1, 1, p.hair));
  }
}

// === TORSO ===
// Sleeveless flannel shirt with two front pockets, buttons, and shoulder shadow
function drawTorso(cx, cy, lean, spec) {
  const p = spec.palette;
  const isMuscular = spec.features.build === 'muscular';
  const w = isMuscular ? 22 : 20;
  const h = 24;
  const leanOffset = Math.round(lean * 2);

  // Silhouette outline
  rect(cx - w/2 - 1, cy - h/2 - 1, w + 2, h + 2, p.outline);

  // Main shirt
  rect(cx - w/2, cy - h/2, w, h, p.shirt);
  // Shoulder shadow
  rect(cx + w/2 - 4, cy - h/2 + 2, 4, h - 4, p.shirtShadow);
  // Highlight on opposite shoulder
  rect(cx - w/2 + 1, cy - h/2 + 2, 2, h - 6, p.shirtLight);

  // Center seam (buttons)
  rect(cx, cy - h/2 + 4, 1, h - 8, p.shirtShadow);
  // Buttons
  for (let i = 0; i < 3; i++) {
    rect(cx - 1, cy - h/2 + 6 + i * 6, 2, 2, p.shirtLight);
    px(cx, cy - h/2 + 7 + i * 6, p.outline);
  }

  // Two chest pockets (front)
  rect(cx - w/2 + 3, cy - h/2 + 6, 6, 6, p.shirtShadow);
  rect(cx - w/2 + 3, cy - h/2 + 6, 6, 1, p.shirtLight);
  rect(cx + 3, cy - h/2 + 6, 6, 6, p.shirtShadow);
  rect(cx + 3, cy - h/2 + 6, 6, 1, p.shirtLight);

  // Collar (V-neck partly open)
  rect(cx - 4, cy - h/2, 8, 3, p.shirt);
  rect(cx - 3, cy - h/2, 6, 2, p.skinShadow);
  rect(cx - 2, cy - h/2, 4, 1, p.skin);

  // Torn-off sleeve ragged edges (left + right shoulder)
  if (isMuscular) {
    rect(cx - w/2 - 1, cy - h/2 + 4, 2, 6, p.shirtShadow);
    rect(cx - w/2 - 2, cy - h/2 + 6, 1, 1, p.shirt);
    rect(cx - w/2 - 2, cy - h/2 + 9, 1, 1, p.shirtShadow);
    rect(cx + w/2 - 1, cy - h/2 + 4, 2, 6, p.shirtShadow);
    rect(cx + w/2, cy - h/2 + 6, 1, 1, p.shirt);
    rect(cx + w/2, cy - h/2 + 9, 1, 1, p.shirtShadow);
  }
}

// === BELT + PANTS WAIST ===
function drawBelt(cx, cy, spec) {
  const p = spec.palette;
  const w = spec.features.build === 'muscular' ? 22 : 20;
  // Belt strap
  rect(cx - w/2, cy, w, 3, p.belt);
  rect(cx - w/2, cy, w, 1, '#7a4a2a');  // top highlight
  // Buckle
  rect(cx - 4, cy, 8, 4, p.beltBuckle);
  rect(cx - 3, cy + 1, 6, 2, '#8a7530');  // inset shadow
  px(cx, cy + 2, p.beltBuckle);
}

// === DOG TAGS ===
function drawDogTags(cx, cy, spec) {
  const p = spec.palette;
  if (spec.features.accessory !== 'dogTags') return;
  // Chain
  for (let i = 0; i < 5; i++) {
    px(cx - 6 + i * 3, cy - 2, p.tagDark);
  }
  // Tag
  rect(cx + 6, cy + 1, 4, 6, p.tag);
  rect(cx + 6, cy + 1, 4, 1, '#e8e8e8');
  px(cx + 7, cy + 3, p.tagDark);
  px(cx + 8, cy + 4, p.tagDark);
}

// === ARM ===
// Draws upper arm + lower arm + fist as connected segments
//   shoulderX/Y: where it attaches to torso
//   armPose: { angle: upper arm angle (rad, 0=down, positive=forward),
//              bend:  elbow bend (0=straight, positive=bent),
//              extend: how far the arm reaches (1=normal, >1=stretched),
//              fist: 'rest' | 'closed' | 'open' | 'punch' }
function drawArm(shoulderX, shoulderY, armPose, spec, isFlexed) {
  const p = spec.palette;
  const upperLen = (isFlexed ? 13 : 12) * (armPose.extend || 1);
  const lowerLen = (isFlexed ? 12 : 11) * (armPose.extend || 1);
  const a = armPose.angle;
  // Elbow position
  const elbowX = shoulderX + Math.sin(a) * upperLen;
  const elbowY = shoulderY + Math.cos(a) * upperLen;
  // Fist position (elbow + lower arm rotated by bend)
  const a2 = a - armPose.bend;
  const fistX = elbowX + Math.sin(a2) * lowerLen;
  const fistY = elbowY + Math.cos(a2) * lowerLen;

  // Sleeveless: upper arm is skin tone (with muscle definition for muscular build)
  // Outline pass
  drawLimb(shoulderX, shoulderY, elbowX, elbowY, p.outline, 6);
  drawLimb(elbowX, elbowY, fistX, fistY, p.outline, 5);
  // Body pass
  drawLimb(shoulderX, shoulderY, elbowX, elbowY, p.skin, 4, p.skinShadow);
  drawLimb(elbowX, elbowY, fistX, fistY, p.skin, 3, p.skinShadow);
  // Muscle highlight on biceps
  if (isFlexed) {
    const midX = (shoulderX + elbowX) / 2;
    const midY = (shoulderY + elbowY) / 2;
    rect(midX - 1, midY - 1, 2, 2, p.skinLight);
  }

  // Fist
  drawFist(fistX, fistY, armPose.fist || 'rest', spec);
}

function drawFist(x, y, variant, spec) {
  const p = spec.palette;
  if (variant === 'punch') {
    // Closed fist with impact
    rect(x - 4, y - 4, 8, 8, p.outline);
    rect(x - 3, y - 3, 6, 6, p.skin);
    rect(x - 3, y - 3, 6, 1, p.skinLight);
    rect(x + 1, y - 2, 1, 4, p.skinShadow);
  } else if (variant === 'open') {
    // Open palm
    rect(x - 4, y - 3, 8, 7, p.outline);
    rect(x - 3, y - 2, 6, 5, p.skin);
    rect(x - 3, y - 2, 6, 1, p.skinLight);
    // Finger separations
    px(x - 1, y + 1, p.skinShadow);
    px(x + 1, y + 1, p.skinShadow);
  } else {
    // Rest/closed
    rect(x - 3, y - 3, 6, 6, p.outline);
    rect(x - 2, y - 2, 4, 4, p.skin);
    rect(x - 2, y - 2, 4, 1, p.skinLight);
  }
}

// === LEG ===
// Draws upper leg + lower leg + boot
//   hipX/Y: hip attachment
//   legPose: { angle, bend, extend }
function drawLeg(hipX, hipY, legPose, spec) {
  const p = spec.palette;
  const upperLen = 14 * (legPose.extend || 1);
  const lowerLen = 13 * (legPose.extend || 1);
  const a = legPose.angle;
  const kneeX = hipX + Math.sin(a) * upperLen;
  const kneeY = hipY + Math.cos(a) * upperLen;
  const a2 = a - legPose.bend;
  const ankleX = kneeX + Math.sin(a2) * lowerLen;
  const ankleY = kneeY + Math.cos(a2) * lowerLen;

  // Upper leg (pants, thick)
  drawLimb(hipX, hipY, kneeX, kneeY, p.outline, 8);
  drawLimb(hipX, hipY, kneeX, kneeY, p.pants, 6, p.pantsShadow);
  // Leg seam highlight
  const midX = (hipX + kneeX) / 2;
  const midY = (hipY + kneeY) / 2;
  px(midX, midY, p.pantsLight);

  // Lower leg (pants, slightly thinner)
  drawLimb(kneeX, kneeY, ankleX, ankleY, p.outline, 7);
  drawLimb(kneeX, kneeY, ankleX, ankleY, p.pants, 5, p.pantsShadow);

  // Boot at ankle (faces same direction as lower leg)
  drawBoot(ankleX, ankleY, a2, spec);
}

function drawBoot(x, y, angle, spec) {
  const p = spec.palette;
  // Boot extends forward in the direction the lower leg is pointing
  const dx = Math.sin(angle - Math.PI / 2);  // perpendicular to leg = forward direction
  const dy = Math.cos(angle - Math.PI / 2);
  // Boot is an oval roughly 12 wide × 8 tall
  const bootCx = x + dx * 4;
  const bootCy = y + dy * 0 + 2; // slightly down from ankle
  // Outline
  drawOval(bootCx, bootCy, 7, 4, p.outline);
  // Boot body
  drawOval(bootCx, bootCy, 6, 3, p.boots);
  // Toe highlight
  drawOval(bootCx + dx * 2, bootCy + dy * 1, 2, 1, p.bootsLight);
  // Heel
  rect(bootCx - dx * 6 - 1, bootCy + 1, 2, 2, p.boots);
}

// ============================================================
// LAYER 3 continued: drawCharacter (composes all parts)
// ============================================================
function drawCharacter(cellX, cellY, pose, spec, opts) {
  opts = opts || {};
  const flip = opts.flip ? -1 : 1;
  // Center the character horizontally in the cell, anchored to feet
  const cx = cellX + CELL_W / 2;
  // cy is approximately the body center; feet at cy + 32 (~bottom of cell)
  const cy = cellY + CELL_H * 0.55 + (pose.bob || 0);
  const isMuscular = spec.features.build === 'muscular';

  ctx.save();
  if (flip < 0) {
    // Flip horizontally around the character's center
    ctx.translate(cx * 2, 0);
    ctx.scale(-1, 1);
  }

  // Hip positions (origin for legs)
  const hipY = cy + 12;
  const hipL = cx - 4;
  const hipR = cx + 4;

  // Shoulder positions (origin for arms)
  const shoulderY = cy - 9;
  const shoulderL = cx - (isMuscular ? 11 : 10);
  const shoulderR = cx + (isMuscular ? 11 : 10);

  // === Rendering order: back-to-front ===

  // 1. Far leg (left in viewer's POV for right-facing character)
  drawLeg(hipL, hipY, pose.legL, spec);

  // 2. Far arm
  drawArm(shoulderL, shoulderY, pose.armL, spec, isMuscular);

  // 3. Torso
  drawTorso(cx, cy, pose.lean || 0, spec);
  drawBelt(cx, hipY - 1, spec);

  // 4. Head + accessories
  drawHead(cx + (pose.headOffsetX || 0), cy - 19 + (pose.headOffsetY || 0), pose.headTilt || 0, spec);
  drawDogTags(cx, cy - 4, spec);

  // 5. Near leg (right in viewer's POV)
  drawLeg(hipR, hipY, pose.legR, spec);

  // 6. Near arm
  drawArm(shoulderR, shoulderY, pose.armR, spec, isMuscular);

  // Optional FX: punch spark, energy ball, motion lines
  if (pose.fx) {
    drawFx(cellX, cellY, pose.fx, spec, flip);
  }

  ctx.restore();
}

function drawFx(cellX, cellY, fx, spec, flip) {
  const cx = cellX + CELL_W / 2;
  const cy = cellY + CELL_H * 0.55;
  if (fx.type === 'punchSpark') {
    const dx = flip * 24;
    const x = cx + dx;
    const y = cy - 6;
    // 4-pointed star
    rect(x - 8, y, 16, 2, '#ffd14a');
    rect(x, y - 8, 2, 16, '#ffd14a');
    rect(x - 4, y - 4, 2, 2, '#ffffff');
    rect(x + 2, y + 2, 2, 2, '#ffffff');
    rect(x - 2, y, 4, 2, '#ffffff');
    rect(x, y - 2, 2, 4, '#ffffff');
  } else if (fx.type === 'kickWind') {
    // Curved motion lines following the kick
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx + flip * 6, cy, 24, -Math.PI / 3, Math.PI / 4);
    ctx.stroke();
    ctx.restore();
  } else if (fx.type === 'energyBall') {
    // Glowing orb between hands
    const x = cx + flip * 22;
    const y = cy + 2;
    const r = fx.size || 8;
    drawOval(x, y, r, r, '#5cf2ff');
    drawOval(x, y, r * 0.6, r * 0.6, '#ffffff');
    // Crackling around it
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      rect(x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3), 2, 2, '#5cf2ff');
    }
  } else if (fx.type === 'energyBurst') {
    // Big radiating energy after release
    const x = cx + flip * 26;
    const y = cy + 2;
    drawOval(x, y, 14, 14, 'rgba(92, 242, 255, 0.4)');
    drawOval(x, y, 9, 9, '#5cf2ff');
    drawOval(x, y, 5, 5, '#ffffff');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      rect(x + Math.cos(a) * 16, y + Math.sin(a) * 16, 3, 3, '#5cf2ff');
    }
  } else if (fx.type === 'jumpDust') {
    // Dust kick from feet
    const y = cellY + CELL_H - 12;
    rect(cx - 18, y, 4, 2, '#d4d4d4');
    rect(cx - 12, y + 2, 3, 2, '#d4d4d4');
    rect(cx + 9, y, 4, 2, '#d4d4d4');
    rect(cx + 14, y + 2, 3, 2, '#d4d4d4');
  } else if (fx.type === 'koStars') {
    // Stars circling above
    for (let i = 0; i < 3; i++) {
      const x = cx - 16 + i * 16;
      const y = cellY + CELL_H * 0.3;
      rect(x - 2, y, 5, 1, '#ffd14a');
      rect(x, y - 2, 1, 5, '#ffd14a');
      px(x, y, '#ffffff');
    }
  }
}

// ============================================================
// LAYER 2: POSE LIBRARY
// Each pose = object literal with angles/offsets. Easy to tune.
// Angles are in radians, 0 = arm/leg pointing straight down.
//   Positive arm angle = forward (toward right side for right-facing)
//   Positive leg angle = forward
//   Positive bend = elbow/knee bends inward
// ============================================================

const POSES = {
  // === IDLE (anchor pose) ===
  idle: {
    bob: 0,
    armL: { angle: 0.15, bend: 0.4, fist: 'rest' },
    armR: { angle: 0.15, bend: 0.4, fist: 'rest' },
    legL: { angle: 0.08, bend: 0.1, extend: 1 },
    legR: { angle: -0.08, bend: 0.1, extend: 1 }
  },

  // === WALK CYCLE (8 frames, full step cycle) ===
  // Right-facing walk: legs alternate, arms swing opposite to leg on same side
  walk: function(frameIdx) {
    const t = (frameIdx / 8) * Math.PI * 2;
    const swing = Math.sin(t);  // -1..1
    const bob = Math.abs(Math.cos(t)) * -2;  // up on extremes, down on middle
    return {
      bob,
      armL: { angle: 0.3 - swing * 0.5, bend: 0.4, fist: 'closed' },
      armR: { angle: 0.3 + swing * 0.5, bend: 0.4, fist: 'closed' },
      legL: { angle: swing * 0.4, bend: Math.max(0, -swing) * 0.5, extend: 1 },
      legR: { angle: -swing * 0.4, bend: Math.max(0, swing) * 0.5, extend: 1 },
      headOffsetY: bob * 0.5
    };
  },

  // === PUNCH (8 frames: wind up, strike, recover) ===
  punch: function(frameIdx) {
    // 0-1: stance, wind up arm back
    // 2: pivot forward
    // 3: extension peak
    // 4: hold contact (with spark)
    // 5-6: pull back
    // 7: return to stance
    if (frameIdx === 0) return {
      bob: 0,
      armL: { angle: 0.5, bend: 0.5, fist: 'closed' },
      armR: { angle: -0.8, bend: 1.5, fist: 'closed' },  // pulled back
      legL: { angle: 0.2, bend: 0.2, extend: 1 },
      legR: { angle: -0.1, bend: 0.05, extend: 1 },
      lean: -0.1
    };
    if (frameIdx === 1) return {
      bob: -1,
      armL: { angle: 0.4, bend: 0.6, fist: 'closed' },
      armR: { angle: -1.0, bend: 1.8, fist: 'closed' },  // chambered
      legL: { angle: 0.3, bend: 0.2, extend: 1 },
      legR: { angle: -0.2, bend: 0.1, extend: 1 },
      lean: -0.15
    };
    if (frameIdx === 2) return {
      bob: 0,
      armL: { angle: 0.2, bend: 0.7, fist: 'closed' },
      armR: { angle: 0.8, bend: 0.3, fist: 'punch' },  // mid-throw
      legL: { angle: 0.1, bend: 0.1, extend: 1 },
      legR: { angle: 0, bend: 0, extend: 1 },
      lean: 0.05
    };
    if (frameIdx === 3) return {
      bob: 0,
      armL: { angle: -0.2, bend: 1.0, fist: 'closed' },  // counter pulled back
      armR: { angle: 1.2, bend: 0, fist: 'punch', extend: 1.15 },  // FULL extension
      legL: { angle: 0.05, bend: 0.1, extend: 1 },
      legR: { angle: -0.05, bend: 0, extend: 1 },
      lean: 0.15
    };
    if (frameIdx === 4) return {  // CONTACT FRAME with spark
      bob: 1,
      armL: { angle: -0.2, bend: 1.0, fist: 'closed' },
      armR: { angle: 1.3, bend: 0, fist: 'punch', extend: 1.2 },
      legL: { angle: 0.05, bend: 0.1, extend: 1 },
      legR: { angle: -0.05, bend: 0, extend: 1 },
      lean: 0.15,
      fx: { type: 'punchSpark' }
    };
    if (frameIdx === 5) return {
      bob: 0,
      armL: { angle: 0, bend: 0.7, fist: 'closed' },
      armR: { angle: 0.9, bend: 0.4, fist: 'closed' },
      legL: { angle: 0.1, bend: 0.1, extend: 1 },
      legR: { angle: 0, bend: 0, extend: 1 },
      lean: 0.05
    };
    if (frameIdx === 6) return {
      bob: 0,
      armL: { angle: 0.2, bend: 0.5, fist: 'closed' },
      armR: { angle: 0.5, bend: 0.6, fist: 'closed' },
      legL: { angle: 0.15, bend: 0.1, extend: 1 },
      legR: { angle: -0.05, bend: 0, extend: 1 },
      lean: 0
    };
    // 7: back to stance
    return {
      bob: 0,
      armL: { angle: 0.3, bend: 0.5, fist: 'closed' },
      armR: { angle: 0.3, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.15, bend: 0.1, extend: 1 },
      legR: { angle: -0.1, bend: 0.05, extend: 1 },
      lean: 0
    };
  },

  // === KICK (8 frames: knee lift, snap kick, recover) ===
  kick: function(frameIdx) {
    if (frameIdx === 0) return {
      bob: 0,
      armL: { angle: 0.4, bend: 0.6, fist: 'closed' },
      armR: { angle: 0.2, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.15, bend: 0.1, extend: 1 },
      legR: { angle: -0.05, bend: 0.05, extend: 1 },
      lean: 0
    };
    if (frameIdx === 1) return {  // knee starts to lift
      bob: -1,
      armL: { angle: 0.5, bend: 0.6, fist: 'closed' },
      armR: { angle: 0.1, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.3, bend: 0.2, extend: 1 },  // planted, slightly bent
      legR: { angle: 0.4, bend: 1.6, extend: 1 },  // knee high, leg folded
      lean: -0.05
    };
    if (frameIdx === 2) return {  // knee at peak height
      bob: -2,
      armL: { angle: 0.7, bend: 0.5, fist: 'closed' },
      armR: { angle: -0.2, bend: 0.6, fist: 'closed' },
      legL: { angle: 0.35, bend: 0.25, extend: 1 },
      legR: { angle: 0.7, bend: 1.8, extend: 1 },  // knee very high
      lean: -0.1
    };
    if (frameIdx === 3) return {  // BEGIN snap kick - leg extending
      bob: -2,
      armL: { angle: 0.9, bend: 0.4, fist: 'open' },
      armR: { angle: -0.4, bend: 0.7, fist: 'closed' },
      legL: { angle: 0.4, bend: 0.3, extend: 1 },
      legR: { angle: 1.1, bend: 0.6, extend: 1 },  // extending forward
      lean: -0.15
    };
    if (frameIdx === 4) return {  // FULL EXTENSION (peak of kick)
      bob: -2,
      armL: { angle: 1.0, bend: 0.3, fist: 'open' },
      armR: { angle: -0.5, bend: 0.8, fist: 'closed' },
      legL: { angle: 0.4, bend: 0.3, extend: 1 },
      legR: { angle: 1.55, bend: 0, extend: 1.2 },  // STRAIGHT and forward (full kick)
      lean: -0.2,
      fx: { type: 'kickWind' }
    };
    if (frameIdx === 5) return {  // hold + impact follow-through
      bob: -1,
      armL: { angle: 0.8, bend: 0.4, fist: 'open' },
      armR: { angle: -0.3, bend: 0.7, fist: 'closed' },
      legL: { angle: 0.35, bend: 0.3, extend: 1 },
      legR: { angle: 1.4, bend: 0.2, extend: 1.15 },
      lean: -0.15
    };
    if (frameIdx === 6) return {  // pulling leg back
      bob: 0,
      armL: { angle: 0.5, bend: 0.5, fist: 'closed' },
      armR: { angle: 0, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.25, bend: 0.2, extend: 1 },
      legR: { angle: 0.7, bend: 1.2, extend: 1 },
      lean: -0.05
    };
    // 7: settle to stance
    return {
      bob: 0,
      armL: { angle: 0.3, bend: 0.5, fist: 'closed' },
      armR: { angle: 0.2, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.1, bend: 0.1, extend: 1 },
      legR: { angle: 0.1, bend: 0.2, extend: 1 },
      lean: 0
    };
  },

  // === SPECIAL (8 frames: charge, gather, release energy burst) ===
  special: function(frameIdx) {
    if (frameIdx === 0) return {  // Stance
      bob: 0,
      armL: { angle: 0.3, bend: 0.5, fist: 'closed' },
      armR: { angle: 0.3, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.15, bend: 0.15, extend: 1 },
      legR: { angle: -0.1, bend: 0.1, extend: 1 }
    };
    if (frameIdx === 1) return {  // Hands begin coming together
      bob: -1,
      armL: { angle: 0.6, bend: 1.0, fist: 'open' },
      armR: { angle: 0.6, bend: 1.0, fist: 'open' },
      legL: { angle: 0.25, bend: 0.3, extend: 1 },
      legR: { angle: -0.2, bend: 0.25, extend: 1 },
      lean: -0.1
    };
    if (frameIdx === 2) return {  // Charging - hands close, small ball
      bob: -1,
      armL: { angle: 0.7, bend: 1.3, fist: 'open' },
      armR: { angle: 0.7, bend: 1.3, fist: 'open' },
      legL: { angle: 0.3, bend: 0.4, extend: 1 },
      legR: { angle: -0.3, bend: 0.3, extend: 1 },
      lean: -0.15,
      fx: { type: 'energyBall', size: 5 }
    };
    if (frameIdx === 3) return {  // Bigger charge
      bob: -2,
      armL: { angle: 0.65, bend: 1.2, fist: 'open' },
      armR: { angle: 0.65, bend: 1.2, fist: 'open' },
      legL: { angle: 0.3, bend: 0.4, extend: 1 },
      legR: { angle: -0.3, bend: 0.3, extend: 1 },
      lean: -0.15,
      fx: { type: 'energyBall', size: 9 }
    };
    if (frameIdx === 4) return {  // PUSH - hands thrust forward
      bob: 0,
      armL: { angle: 1.1, bend: 0.3, fist: 'open' },
      armR: { angle: 1.1, bend: 0.3, fist: 'open' },
      legL: { angle: 0.1, bend: 0.1, extend: 1 },
      legR: { angle: 0.05, bend: 0.05, extend: 1 },
      lean: 0.2,
      fx: { type: 'energyBurst' }
    };
    if (frameIdx === 5) return {  // Holds forward
      bob: 0,
      armL: { angle: 1.2, bend: 0.25, fist: 'open' },
      armR: { angle: 1.2, bend: 0.25, fist: 'open' },
      legL: { angle: 0.05, bend: 0.1, extend: 1 },
      legR: { angle: 0, bend: 0, extend: 1 },
      lean: 0.2,
      fx: { type: 'energyBurst' }
    };
    if (frameIdx === 6) return {  // Recovery start
      bob: 0,
      armL: { angle: 0.8, bend: 0.5, fist: 'closed' },
      armR: { angle: 0.8, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.1, bend: 0.1, extend: 1 },
      legR: { angle: -0.05, bend: 0.05, extend: 1 },
      lean: 0.1
    };
    return {  // Back to stance
      bob: 0,
      armL: { angle: 0.4, bend: 0.5, fist: 'closed' },
      armR: { angle: 0.4, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.15, bend: 0.15, extend: 1 },
      legR: { angle: -0.1, bend: 0.1, extend: 1 }
    };
  },

  // === KO (8 frames: hit, stagger, fall, lying) ===
  ko: function(frameIdx) {
    if (frameIdx === 0) return {  // hit reaction
      bob: -1,
      armL: { angle: -0.6, bend: 0.4, fist: 'open' },
      armR: { angle: 0.4, bend: 0.5, fist: 'open' },
      legL: { angle: -0.2, bend: 0.3, extend: 1 },
      legR: { angle: 0.3, bend: 0.4, extend: 1 },
      lean: -0.3,
      fx: { type: 'koStars' }
    };
    if (frameIdx === 1) return {  // staggering
      bob: 0,
      armL: { angle: -0.8, bend: 0.5, fist: 'open' },
      armR: { angle: 0.6, bend: 0.5, fist: 'open' },
      legL: { angle: -0.3, bend: 0.5, extend: 1 },
      legR: { angle: 0.4, bend: 0.5, extend: 1 },
      lean: -0.4,
      fx: { type: 'koStars' }
    };
    if (frameIdx === 2) return {  // tipping over
      bob: 3,
      armL: { angle: -1.0, bend: 0.5, fist: 'open' },
      armR: { angle: 0.8, bend: 0.5, fist: 'open' },
      legL: { angle: -0.4, bend: 0.7, extend: 1 },
      legR: { angle: 0.6, bend: 0.6, extend: 1 },
      lean: -0.6
    };
    if (frameIdx === 3) return {  // falling backward
      bob: 8,
      armL: { angle: -1.3, bend: 0.3, fist: 'open' },
      armR: { angle: 1.0, bend: 0.3, fist: 'open' },
      legL: { angle: -0.6, bend: 0.5, extend: 1 },
      legR: { angle: 0.7, bend: 0.5, extend: 1 },
      lean: -0.9
    };
    if (frameIdx === 4) return {  // on the ground
      bob: 16,
      armL: { angle: -1.5, bend: 0.2, fist: 'open' },
      armR: { angle: 1.4, bend: 0.2, fist: 'open' },
      legL: { angle: -0.8, bend: 0.4, extend: 1 },
      legR: { angle: 0.8, bend: 0.4, extend: 1 },
      lean: -1.4
    };
    // 5-7: stay on ground (could add tiny twitch animation but holding is fine)
    return {
      bob: 18,
      armL: { angle: -1.55, bend: 0.1, fist: 'open' },
      armR: { angle: 1.55, bend: 0.1, fist: 'open' },
      legL: { angle: -1.0, bend: 0.3, extend: 1 },
      legR: { angle: 1.0, bend: 0.3, extend: 1 },
      lean: -1.55
    };
  },

  // === JUMP (8 frames: crouch, launch, rise, peak, fall, land) ===
  jump: function(frameIdx) {
    if (frameIdx === 0) return {  // crouch (anticipation)
      bob: 8,
      armL: { angle: -0.2, bend: 1.2, fist: 'closed' },
      armR: { angle: -0.2, bend: 1.2, fist: 'closed' },
      legL: { angle: 0.3, bend: 1.4, extend: 1 },
      legR: { angle: -0.3, bend: 1.4, extend: 1 },
      lean: 0.1
    };
    if (frameIdx === 1) return {  // launching - arms swing up
      bob: 4,
      armL: { angle: 0.8, bend: 0.4, fist: 'closed' },
      armR: { angle: 0.8, bend: 0.4, fist: 'closed' },
      legL: { angle: 0.2, bend: 0.6, extend: 1 },
      legR: { angle: -0.2, bend: 0.6, extend: 1 },
      lean: 0,
      fx: { type: 'jumpDust' }
    };
    if (frameIdx === 2) return {  // rising
      bob: -2,
      armL: { angle: 1.0, bend: 0.3, fist: 'closed' },
      armR: { angle: 1.0, bend: 0.3, fist: 'closed' },
      legL: { angle: 0.1, bend: 0.5, extend: 1 },
      legR: { angle: -0.1, bend: 0.5, extend: 1 },
      lean: 0
    };
    if (frameIdx === 3) return {  // peak/apex - tucked
      bob: -8,
      armL: { angle: 0.9, bend: 0.7, fist: 'closed' },
      armR: { angle: 0.9, bend: 0.7, fist: 'closed' },
      legL: { angle: 0.3, bend: 1.5, extend: 1 },
      legR: { angle: -0.3, bend: 1.5, extend: 1 },
      lean: 0
    };
    if (frameIdx === 4) return {  // peak - apex with arms up
      bob: -10,
      armL: { angle: 0.6, bend: 0.5, fist: 'closed' },
      armR: { angle: 0.6, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.25, bend: 1.3, extend: 1 },
      legR: { angle: -0.25, bend: 1.3, extend: 1 },
      lean: 0
    };
    if (frameIdx === 5) return {  // falling - legs starting to extend
      bob: -6,
      armL: { angle: 0.4, bend: 0.5, fist: 'closed' },
      armR: { angle: 0.4, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.15, bend: 0.8, extend: 1 },
      legR: { angle: -0.15, bend: 0.8, extend: 1 },
      lean: 0
    };
    if (frameIdx === 6) return {  // about to land - legs extended
      bob: -2,
      armL: { angle: 0.2, bend: 0.5, fist: 'closed' },
      armR: { angle: 0.2, bend: 0.5, fist: 'closed' },
      legL: { angle: 0.1, bend: 0.3, extend: 1 },
      legR: { angle: -0.1, bend: 0.3, extend: 1 },
      lean: 0
    };
    return {  // landing - knees bend to absorb
      bob: 4,
      armL: { angle: 0, bend: 0.6, fist: 'closed' },
      armR: { angle: 0, bend: 0.6, fist: 'closed' },
      legL: { angle: 0.15, bend: 0.8, extend: 1 },
      legR: { angle: -0.15, bend: 0.8, extend: 1 },
      lean: 0.05,
      fx: { type: 'jumpDust' }
    };
  }
};

// ============================================================
// LAYER 4: GENERATOR - render all 56 frames into the sheet
// ============================================================
console.log(`Generating ${SHEET_W}x${SHEET_H} character sheet for ${BILL_SPEC.name}...`);

// Walk left: same poses as walk right, but flipped
for (let col = 0; col < COLS; col++) {
  const pose = POSES.walk(col);
  drawCharacter(col * CELL_W, ROW_WALK_L * CELL_H, pose, BILL_SPEC, { flip: true });
}
console.log('  Row 0: walk left rendered');

// Walk right
for (let col = 0; col < COLS; col++) {
  const pose = POSES.walk(col);
  drawCharacter(col * CELL_W, ROW_WALK_R * CELL_H, pose, BILL_SPEC);
}
console.log('  Row 1: walk right rendered');

// Punch
for (let col = 0; col < COLS; col++) {
  drawCharacter(col * CELL_W, ROW_PUNCH * CELL_H, POSES.punch(col), BILL_SPEC);
}
console.log('  Row 2: punch rendered');

// Kick
for (let col = 0; col < COLS; col++) {
  drawCharacter(col * CELL_W, ROW_KICK * CELL_H, POSES.kick(col), BILL_SPEC);
}
console.log('  Row 3: kick rendered');

// Special
for (let col = 0; col < COLS; col++) {
  drawCharacter(col * CELL_W, ROW_SPECIAL * CELL_H, POSES.special(col), BILL_SPEC);
}
console.log('  Row 4: special rendered');

// KO
for (let col = 0; col < COLS; col++) {
  drawCharacter(col * CELL_W, ROW_KO * CELL_H, POSES.ko(col), BILL_SPEC);
}
console.log('  Row 5: KO rendered');

// Jump
for (let col = 0; col < COLS; col++) {
  drawCharacter(col * CELL_W, ROW_JUMP * CELL_H, POSES.jump(col), BILL_SPEC);
}
console.log('  Row 6: jump rendered');

// ============================================================
// SAVE
// ============================================================
const outDir = path.join(__dirname, '..', 'public', 'sprites');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'BillSpriteSheet.png');
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);

console.log(`\n✓ Saved ${outPath}`);
console.log(`  Dimensions: ${SHEET_W}x${SHEET_H} (${COLS} cols × ${ROWS} rows)`);
console.log(`  Cell size: ${CELL_W}x${CELL_H}`);
console.log(`  Size: ${(buffer.length / 1024).toFixed(1)} KB`);
console.log(`\nTo make a new character:`);
console.log(`  1. Copy BILL_SPEC and edit palette/features`);
console.log(`  2. Change outPath at bottom`);
console.log(`  3. Run: node scripts/generate-bill.js`);
