/**
 * Generate sprite sheet for anthropomorphized help-ticket enemies.
 *
 * Sheet layout: 4 columns × 3 rows = 12 unique ticket monsters
 *   Row 0: printer-ticket  variants (orange theme)
 *   Row 1: email-ticket    variants (blue theme)
 *   Row 2: network-ticket  variants (red theme)
 *
 * Cell size: 100×120 px. Output sheet: 400×360 px.
 *
 * Run: npm run tickets:gen
 *   (installs @napi-rs/canvas --no-save then executes this script)
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const CELL_W = 100;
const CELL_H = 120;
const COLS = 4;
const ROWS = 3;
const W = COLS * CELL_W;
const H = ROWS * CELL_H;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ============================================================
// HELPERS
// ============================================================
function px(x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
}

function rect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), w, h);
}

function outlinedRect(x, y, w, h, fill, outline) {
  rect(x, y, w, h, outline);
  rect(x + 1, y + 1, w - 2, h - 2, fill);
}

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

// ============================================================
// SHARED ANATOMY
// Each ticket has:
//   - paper body (white-ish rect with colored header)
//   - eyes (varying expression)
//   - mouth (varying expression)
//   - stick arms with fists
//   - stick legs with boots
// Coordinates are local to the cell (origin at cell top-left)
// ============================================================

const BODY_PAPER = '#f4ecd8';
const BODY_OUTLINE = '#3a2a1a';
const STAMP_RED = '#cc2222';
const STAMP_BLUE = '#2a4abc';

/**
 * Draw the basic ticket body (paper rectangle) inside the cell.
 * Returns the body bounds for use by content / face drawing.
 */
function drawTicketBody(cx, cy, headerColor, headerStripe) {
  // Body: 56×72 centered horizontally, anchored above the legs
  const bw = 56;
  const bh = 72;
  const bx = cx + (CELL_W - bw) / 2;
  const by = cy + 16;

  // Drop shadow
  rect(bx + 4, by + bh - 2, bw, 4, 'rgba(0,0,0,0.3)');

  // Outline
  rect(bx - 1, by - 1, bw + 2, bh + 2, BODY_OUTLINE);
  // Paper fill
  rect(bx, by, bw, bh, BODY_PAPER);

  // Paper texture (subtle dots)
  ctx.fillStyle = '#dcd2bc';
  for (let i = 0; i < 12; i++) {
    const tx = bx + 3 + (i * 7) % (bw - 6);
    const ty = by + 14 + Math.floor((i * 11) / (bw - 6)) * 6;
    if (ty > by + bh - 4) continue;
    rect(tx, ty, 1, 1, '#dcd2bc');
  }

  // Header bar (colored, with darker stripe at top)
  rect(bx, by, bw, 12, headerColor);
  rect(bx, by, bw, 2, headerStripe || darken(headerColor, 0.6));
  rect(bx, by + 12, bw, 1, darken(headerColor, 0.5));

  // Tear / fold on corner (top right)
  rect(bx + bw - 6, by, 6, 6, BODY_PAPER);
  rect(bx + bw - 6, by, 6, 1, darken(headerColor, 0.6));
  rect(bx + bw - 6, by, 1, 6, darken(headerColor, 0.6));
  // Triangle fold line
  rect(bx + bw - 5, by + 1, 1, 1, BODY_OUTLINE);
  rect(bx + bw - 4, by + 2, 1, 1, BODY_OUTLINE);
  rect(bx + bw - 3, by + 3, 1, 1, BODY_OUTLINE);
  rect(bx + bw - 2, by + 4, 1, 1, BODY_OUTLINE);

  return { bx, by, bw, bh };
}

/**
 * Draw eyes inside the paper. Variants:
 *   'angry', 'sad', 'sleepy', 'crosseyed', 'stressed', 'shifty',
 *   'predatory', 'strain', 'confused', 'dead', 'glaring'
 */
function drawEyes(bx, by, bw, expression) {
  const ey = by + 22; // eye y
  const eyeLeftX = bx + bw / 2 - 10;
  const eyeRightX = bx + bw / 2 + 4;
  const black = '#1a1a24';

  switch (expression) {
    case 'angry':
      // Diagonal slant down toward center (angry)
      rect(eyeLeftX, ey, 6, 4, '#ffffff');
      rect(eyeLeftX, ey, 6, 1, black); // angry brow
      rect(eyeLeftX + 1, ey + 1, 4, 1, black);
      rect(eyeLeftX + 2, ey + 1, 2, 2, black); // pupil
      rect(eyeRightX, ey, 6, 4, '#ffffff');
      rect(eyeRightX, ey, 6, 1, black);
      rect(eyeRightX + 1, ey + 1, 4, 1, black);
      rect(eyeRightX + 2, ey + 1, 2, 2, black);
      break;
    case 'sad':
      rect(eyeLeftX, ey, 6, 5, '#ffffff');
      rect(eyeLeftX + 1, ey + 1, 4, 1, black); // sad brow up at outside
      rect(eyeLeftX + 1, ey + 2, 2, 2, black);
      // Tear drop
      rect(eyeLeftX + 1, ey + 6, 1, 2, '#88ccff');
      rect(eyeRightX, ey, 6, 5, '#ffffff');
      rect(eyeRightX + 1, ey + 1, 4, 1, black);
      rect(eyeRightX + 3, ey + 2, 2, 2, black);
      break;
    case 'sleepy':
      // Half-closed
      rect(eyeLeftX, ey, 6, 2, '#ffffff');
      rect(eyeLeftX, ey, 6, 1, black);
      rect(eyeLeftX + 1, ey + 1, 4, 1, black);
      rect(eyeRightX, ey, 6, 2, '#ffffff');
      rect(eyeRightX, ey, 6, 1, black);
      rect(eyeRightX + 1, ey + 1, 4, 1, black);
      // "Zzz" near eye
      ctx.fillStyle = black;
      ctx.fillRect(bx + bw / 2 + 14, ey - 6, 1, 1);
      ctx.fillRect(bx + bw / 2 + 15, ey - 5, 1, 1);
      ctx.fillRect(bx + bw / 2 + 16, ey - 4, 1, 1);
      ctx.fillRect(bx + bw / 2 + 14, ey - 4, 3, 1);
      break;
    case 'crosseyed':
      rect(eyeLeftX, ey, 6, 4, '#ffffff');
      rect(eyeLeftX + 3, ey + 1, 2, 2, black); // looking inward
      rect(eyeRightX, ey, 6, 4, '#ffffff');
      rect(eyeRightX + 1, ey + 1, 2, 2, black); // looking inward
      break;
    case 'stressed':
      rect(eyeLeftX, ey, 6, 5, '#ffffff');
      rect(eyeLeftX + 1, ey + 1, 4, 1, '#cc4444');
      rect(eyeLeftX + 2, ey + 2, 2, 2, black);
      rect(eyeRightX, ey, 6, 5, '#ffffff');
      rect(eyeRightX + 1, ey + 1, 4, 1, '#cc4444');
      rect(eyeRightX + 2, ey + 2, 2, 2, black);
      // Sweat drop
      rect(bx + bw / 2 + 12, ey + 1, 1, 2, '#88ccff');
      break;
    case 'shifty':
      rect(eyeLeftX, ey, 6, 4, '#ffffff');
      rect(eyeLeftX + 4, ey + 1, 2, 2, black); // looking right
      rect(eyeRightX, ey, 6, 4, '#ffffff');
      rect(eyeRightX + 4, ey + 1, 2, 2, black); // looking right
      break;
    case 'predatory':
      rect(eyeLeftX, ey, 6, 3, '#ffffff');
      rect(eyeLeftX, ey, 6, 1, black);
      rect(eyeLeftX + 2, ey + 1, 2, 2, '#cc2222'); // red eyes
      rect(eyeRightX, ey, 6, 3, '#ffffff');
      rect(eyeRightX, ey, 6, 1, black);
      rect(eyeRightX + 2, ey + 1, 2, 2, '#cc2222');
      break;
    case 'strain':
      // Bulging eyes
      rect(eyeLeftX - 1, ey - 1, 7, 6, '#ffffff');
      rect(eyeLeftX - 1, ey - 1, 7, 1, black);
      rect(eyeLeftX + 1, ey + 1, 3, 3, black);
      rect(eyeRightX - 1, ey - 1, 7, 6, '#ffffff');
      rect(eyeRightX - 1, ey - 1, 7, 1, black);
      rect(eyeRightX + 1, ey + 1, 3, 3, black);
      break;
    case 'confused':
      rect(eyeLeftX, ey, 6, 4, '#ffffff');
      rect(eyeLeftX + 2, ey + 1, 2, 2, black);
      rect(eyeRightX, ey, 6, 4, '#ffffff');
      rect(eyeRightX + 2, ey + 1, 2, 2, black);
      // Question mark above
      rect(bx + bw / 2 - 2, by + 14, 4, 1, black);
      rect(bx + bw / 2 + 1, by + 15, 1, 1, black);
      rect(bx + bw / 2, by + 16, 1, 1, black);
      rect(bx + bw / 2 - 1, by + 18, 2, 1, black);
      rect(bx + bw / 2 - 1, by + 20, 1, 1, black);
      break;
    case 'dead':
      // X eyes
      ctx.fillStyle = black;
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(eyeLeftX + i, ey + i, 1, 1);
        ctx.fillRect(eyeLeftX + 4 - i, ey + i, 1, 1);
        ctx.fillRect(eyeRightX + i, ey + i, 1, 1);
        ctx.fillRect(eyeRightX + 4 - i, ey + i, 1, 1);
      }
      break;
    case 'glaring':
      rect(eyeLeftX, ey, 6, 4, '#ffffff');
      rect(eyeLeftX, ey, 6, 2, black); // heavy brow
      rect(eyeLeftX + 2, ey + 2, 2, 1, black);
      rect(eyeRightX, ey, 6, 4, '#ffffff');
      rect(eyeRightX, ey, 6, 2, black);
      rect(eyeRightX + 2, ey + 2, 2, 1, black);
      break;
    default:
      rect(eyeLeftX, ey, 6, 4, '#ffffff');
      rect(eyeLeftX + 2, ey + 1, 2, 2, black);
      rect(eyeRightX, ey, 6, 4, '#ffffff');
      rect(eyeRightX + 2, ey + 1, 2, 2, black);
  }
}

/**
 * Draw mouth. Variants: 'frown', 'zigzag', 'open', 'grin', 'flatline', 'small'
 */
function drawMouth(bx, by, bw, kind) {
  const my = by + 36;
  const cx = bx + bw / 2;
  const black = '#1a1a24';
  switch (kind) {
    case 'frown':
      rect(cx - 5, my + 2, 10, 1, black);
      rect(cx - 6, my + 1, 1, 1, black);
      rect(cx + 5, my + 1, 1, 1, black);
      break;
    case 'zigzag':
      // Teeth
      rect(cx - 5, my, 10, 4, '#ffffff');
      rect(cx - 5, my, 10, 1, black);
      rect(cx - 5, my + 4, 10, 1, black);
      // Zigzag teeth lines
      for (let i = 0; i < 5; i++) {
        rect(cx - 4 + i * 2, my + 1, 1, 3, black);
      }
      break;
    case 'open':
      rect(cx - 4, my, 8, 6, black);
      rect(cx - 3, my + 1, 6, 4, '#5a1a1a');
      break;
    case 'grin':
      rect(cx - 6, my, 12, 1, black);
      rect(cx - 6, my, 1, 2, black);
      rect(cx + 5, my, 1, 2, black);
      // Sharp teeth
      rect(cx - 4, my + 1, 1, 2, '#ffffff');
      rect(cx - 1, my + 1, 1, 2, '#ffffff');
      rect(cx + 2, my + 1, 1, 2, '#ffffff');
      break;
    case 'flatline':
      rect(cx - 5, my + 1, 10, 1, black);
      break;
    case 'small':
      rect(cx - 2, my + 1, 4, 2, black);
      rect(cx - 1, my + 2, 2, 1, '#5a1a1a');
      break;
    default:
      rect(cx - 4, my, 8, 2, black);
  }
}

/**
 * Draw stick arms with fists. Arms vary based on pose.
 * Pose: 'raised' (fists up), 'sides' (arms hang), 'hips' (akimbo)
 */
function drawArms(bx, by, bw, bh, color, pose) {
  const armColor = color || BODY_OUTLINE;
  const fistColor = '#e8c098';
  const fistOutline = '#a88058';
  pose = pose || 'raised';

  if (pose === 'raised') {
    // Left arm raised
    ctx.fillStyle = armColor;
    ctx.fillRect(bx - 4, by + 28, 2, 12);
    ctx.fillRect(bx - 6, by + 24, 4, 4);
    // Left fist
    outlinedRect(bx - 8, by + 18, 8, 8, fistColor, fistOutline);
    // Right arm raised
    ctx.fillStyle = armColor;
    ctx.fillRect(bx + bw + 2, by + 28, 2, 12);
    ctx.fillRect(bx + bw + 2, by + 24, 4, 4);
    // Right fist
    outlinedRect(bx + bw, by + 18, 8, 8, fistColor, fistOutline);
  } else if (pose === 'sides') {
    ctx.fillStyle = armColor;
    ctx.fillRect(bx - 4, by + 28, 2, 20);
    ctx.fillRect(bx + bw + 2, by + 28, 2, 20);
    outlinedRect(bx - 6, by + 48, 6, 6, fistColor, fistOutline);
    outlinedRect(bx + bw, by + 48, 6, 6, fistColor, fistOutline);
  } else if (pose === 'hips') {
    ctx.fillStyle = armColor;
    ctx.fillRect(bx - 6, by + 36, 6, 2);
    ctx.fillRect(bx - 6, by + 30, 2, 8);
    ctx.fillRect(bx + bw, by + 36, 6, 2);
    ctx.fillRect(bx + bw + 4, by + 30, 2, 8);
    outlinedRect(bx - 8, by + 28, 4, 4, fistColor, fistOutline);
    outlinedRect(bx + bw + 4, by + 28, 4, 4, fistColor, fistOutline);
  }
}

/**
 * Draw stick legs with boots beneath the body.
 */
function drawLegs(bx, by, bw, bh, color) {
  const legColor = color || BODY_OUTLINE;
  // Left leg
  rect(bx + bw / 2 - 10, by + bh, 3, 14, legColor);
  // Right leg
  rect(bx + bw / 2 + 7, by + bh, 3, 14, legColor);
  // Boots
  rect(bx + bw / 2 - 13, by + bh + 11, 9, 4, '#2a2a2a');
  rect(bx + bw / 2 - 13, by + bh + 11, 9, 1, '#5a5a5a');
  rect(bx + bw / 2 + 4, by + bh + 11, 9, 4, '#2a2a2a');
  rect(bx + bw / 2 + 4, by + bh + 11, 9, 1, '#5a5a5a');
}

/**
 * Draw faux body text lines inside the ticket
 */
function drawTextLines(bx, by, bw, bh, lineColor) {
  const lc = lineColor || '#5a4a3a';
  // Mid body, below face
  const ly = by + 44;
  rect(bx + 4, ly, 14, 1, lc);
  rect(bx + 4, ly + 3, 22, 1, lc);
  rect(bx + 4, ly + 6, 18, 1, lc);
  // Right side: signature line
  rect(bx + 30, ly + 2, 22, 1, lc);
  rect(bx + 30, ly + 5, 14, 1, lc);
  rect(bx + 30, ly + 8, 18, 1, lc);
}

/**
 * Draw a rubber-stamp circle with text-like marks
 */
function drawStamp(bx, by, bw, bh, color) {
  const stampX = bx + bw - 18;
  const stampY = by + 56;
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = color;
  // Outer ring
  ctx.beginPath();
  ctx.arc(stampX, stampY, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Inner cutout
  ctx.fillStyle = BODY_PAPER;
  ctx.beginPath();
  ctx.arc(stampX, stampY, 6, 0, Math.PI * 2);
  ctx.fill();
  // Color again for inner text
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(stampX - 4, stampY - 1, 8, 2);
  ctx.fillRect(stampX - 3, stampY + 2, 6, 1);
  ctx.restore();
}

/**
 * Render a header label using rectangular faux-pixel-font characters.
 * Limited to a few common letters/symbols. Each glyph 4 wide x 6 tall.
 */
function drawLabel(bx, by, text, color) {
  // Tiny font: each char rendered with a 3x5 grid in 4x6 cell
  const FONT = {
    'A': ['010', '101', '111', '101', '101'],
    'B': ['110', '101', '110', '101', '110'],
    'C': ['011', '100', '100', '100', '011'],
    'D': ['110', '101', '101', '101', '110'],
    'E': ['111', '100', '110', '100', '111'],
    'F': ['111', '100', '110', '100', '100'],
    'G': ['011', '100', '101', '101', '011'],
    'H': ['101', '101', '111', '101', '101'],
    'I': ['111', '010', '010', '010', '111'],
    'J': ['001', '001', '001', '101', '010'],
    'K': ['101', '110', '100', '110', '101'],
    'L': ['100', '100', '100', '100', '111'],
    'M': ['101', '111', '101', '101', '101'],
    'N': ['101', '111', '111', '111', '101'],
    'O': ['010', '101', '101', '101', '010'],
    'P': ['110', '101', '110', '100', '100'],
    'Q': ['010', '101', '101', '110', '011'],
    'R': ['110', '101', '110', '110', '101'],
    'S': ['011', '100', '010', '001', '110'],
    'T': ['111', '010', '010', '010', '010'],
    'U': ['101', '101', '101', '101', '011'],
    'V': ['101', '101', '101', '010', '010'],
    'W': ['101', '101', '101', '111', '101'],
    'X': ['101', '101', '010', '101', '101'],
    'Y': ['101', '101', '010', '010', '010'],
    'Z': ['111', '001', '010', '100', '111'],
    '0': ['010', '101', '101', '101', '010'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['110', '001', '010', '100', '111'],
    '3': ['110', '001', '010', '001', '110'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '110', '001', '110'],
    '6': ['011', '100', '110', '101', '010'],
    '7': ['111', '001', '010', '010', '010'],
    '8': ['010', '101', '010', '101', '010'],
    '9': ['010', '101', '011', '001', '110'],
    '!': ['010', '010', '010', '000', '010'],
    '?': ['110', '001', '010', '000', '010'],
    '@': ['010', '101', '111', '100', '011'],
    '$': ['011', '100', '010', '001', '110'],
    '#': ['101', '111', '101', '111', '101'],
    '.': ['000', '000', '000', '000', '010'],
    ',': ['000', '000', '000', '010', '100'],
    ' ': ['000', '000', '000', '000', '000']
  };

  const chars = text.toUpperCase().split('');
  const charW = 4;
  const total = chars.length * charW;
  let x = bx + Math.floor(56 / 2 - total / 2);
  const yStart = by + 4;
  for (const ch of chars) {
    const g = FONT[ch] || FONT[' '];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (g[row][col] === '1') {
          rect(x + col, yStart + row, 1, 1, color);
        }
      }
    }
    x += charW;
  }
}

// ============================================================
// PRINTER-TICKET VARIANTS (Row 0)
// ============================================================
function drawPrinterTicket_Jam(col) {
  const cx = col * CELL_W;
  const cy = 0;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#ff9933', '#cc5511');
  drawLabel(bx, by, 'JAM!', '#ffffff');
  drawEyes(bx, by, bw, 'angry');
  drawMouth(bx, by, bw, 'zigzag');
  drawTextLines(bx, by, bw, bh);
  // Crumpled torn bottom
  rect(bx, by + bh - 4, bw, 4, BODY_PAPER);
  for (let i = 0; i < bw; i++) {
    if (i % 4 === 0) rect(bx + i, by + bh - 2, 2, 2, BODY_PAPER);
    else if (i % 4 === 2) rect(bx + i, by + bh, 2, 2, BODY_PAPER);
  }
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'raised');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
  // Stamp
  drawStamp(bx, by, bw, bh, STAMP_RED);
}

function drawPrinterTicket_TonerLow(col) {
  const cx = col * CELL_W;
  const cy = 0;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#ff9933', '#cc5511');
  drawLabel(bx, by, 'TONER', '#ffffff');
  drawEyes(bx, by, bw, 'sad');
  drawMouth(bx, by, bw, 'frown');
  drawTextLines(bx, by, bw, bh);
  // Ink drips on body
  rect(bx + 8, by + 50, 2, 6, '#1a1a44');
  rect(bx + 9, by + 56, 1, 3, '#1a1a44');
  rect(bx + 38, by + 56, 2, 4, '#1a1a44');
  rect(bx + 24, by + 60, 2, 5, '#1a1a44');
  rect(bx + 25, by + 65, 1, 2, '#1a1a44');
  // Faded paper feel (lighter tint overall)
  ctx.save();
  ctx.globalAlpha = 0.2;
  rect(bx, by + 12, bw, bh - 12, '#aaaaaa');
  ctx.restore();
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'sides');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

function drawPrinterTicket_Offline(col) {
  const cx = col * CELL_W;
  const cy = 0;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#aa6622', '#664422');
  drawLabel(bx, by, 'OFF', '#ffffff');
  drawEyes(bx, by, bw, 'sleepy');
  drawMouth(bx, by, bw, 'flatline');
  drawTextLines(bx, by, bw, bh, '#988a78');
  // Printer icon
  rect(bx + bw - 22, by + 46, 16, 10, '#5a5a64');
  rect(bx + bw - 22, by + 46, 16, 2, '#3a3a44');
  rect(bx + bw - 20, by + 48, 12, 2, '#ffffff');
  // X mark over it
  ctx.fillStyle = '#cc2222';
  for (let i = 0; i < 5; i++) {
    rect(bx + bw - 22 + i * 3, by + 46 + i * 2, 1, 1, '#cc2222');
    rect(bx + bw - 22 + i * 3, by + 54 - i * 2, 1, 1, '#cc2222');
  }
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'sides');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

function drawPrinterTicket_WrongColor(col) {
  const cx = col * CELL_W;
  const cy = 0;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#ff9933', '#cc5511');
  drawLabel(bx, by, 'CMYK!', '#ffffff');
  drawEyes(bx, by, bw, 'crosseyed');
  drawMouth(bx, by, bw, 'open');
  // Color splatters
  rect(bx + 6, by + 48, 4, 4, '#00aaaa');
  rect(bx + 5, by + 49, 1, 2, '#00aaaa');
  rect(bx + 24, by + 50, 5, 5, '#cc22cc');
  rect(bx + 28, by + 53, 2, 2, '#cc22cc');
  rect(bx + 40, by + 56, 4, 4, '#ffcc00');
  rect(bx + 14, by + 60, 3, 3, '#1a1a1a');
  rect(bx + 33, by + 62, 4, 3, '#00aa44');
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'raised');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

// ============================================================
// EMAIL-TICKET VARIANTS (Row 1)
// ============================================================
function drawEmailTicket_Inbox(col) {
  const cx = col * CELL_W;
  const cy = CELL_H;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#3366cc', '#1a3a99');
  drawLabel(bx, by, 'INBOX', '#ffffff');
  drawEyes(bx, by, bw, 'stressed');
  drawMouth(bx, by, bw, 'open');
  // Stack of mini envelopes
  for (let i = 0; i < 4; i++) {
    rect(bx + 6 + i * 3, by + 48 + i * 2, 14, 8, '#ffffff');
    rect(bx + 6 + i * 3, by + 48 + i * 2, 14, 1, '#3a3a44');
    rect(bx + 6 + i * 3, by + 48 + i * 2 + 7, 14, 1, '#3a3a44');
    rect(bx + 6 + i * 3, by + 48 + i * 2, 1, 8, '#3a3a44');
    rect(bx + 19 + i * 3, by + 48 + i * 2, 1, 8, '#3a3a44');
    // Flap line
    rect(bx + 7 + i * 3, by + 49 + i * 2, 12, 1, '#88aaee');
  }
  // 999+ badge
  rect(bx + bw - 16, by + 14, 14, 8, '#cc2222');
  rect(bx + bw - 16, by + 14, 14, 1, '#992222');
  rect(bx + bw - 15, by + 16, 2, 4, '#ffffff');
  rect(bx + bw - 12, by + 16, 2, 4, '#ffffff');
  rect(bx + bw - 9, by + 16, 2, 4, '#ffffff');
  rect(bx + bw - 6, by + 16, 1, 1, '#ffffff');
  rect(bx + bw - 5, by + 17, 1, 2, '#ffffff');
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'raised');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

function drawEmailTicket_Spam(col) {
  const cx = col * CELL_W;
  const cy = CELL_H;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#3366cc', '#1a3a99');
  drawLabel(bx, by, 'SPAM', '#ffffff');
  drawEyes(bx, by, bw, 'shifty');
  drawMouth(bx, by, bw, 'grin');
  drawTextLines(bx, by, bw, bh);
  // Big red SPAM stamp (diagonal)
  ctx.save();
  ctx.translate(bx + bw / 2 + 4, by + 58);
  ctx.rotate(-Math.PI / 8);
  ctx.fillStyle = '#cc2222';
  ctx.fillRect(-20, -6, 40, 12);
  ctx.fillStyle = BODY_PAPER;
  ctx.fillRect(-18, -4, 36, 8);
  ctx.fillStyle = '#cc2222';
  // Letters S P A M
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(-16 + i * 9, -3, 2, 6);
  }
  ctx.fillRect(-15, -3, 2, 2);
  ctx.fillRect(-15, 0, 2, 2);
  ctx.fillRect(-6, -3, 2, 2);
  ctx.restore();
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'hips');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

function drawEmailTicket_Phishing(col) {
  const cx = col * CELL_W;
  const cy = CELL_H;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#3366cc', '#1a3a99');
  drawLabel(bx, by, 'PHISH', '#ffffff');
  drawEyes(bx, by, bw, 'predatory');
  drawMouth(bx, by, bw, 'grin');
  // Fishing hook icon
  ctx.fillStyle = '#888a92';
  rect(bx + bw / 2 - 1, by + 46, 2, 14, '#888a92'); // line
  rect(bx + bw / 2 - 6, by + 60, 2, 4, '#888a92');
  rect(bx + bw / 2 - 6, by + 62, 6, 2, '#888a92');
  rect(bx + bw / 2 - 1, by + 60, 2, 2, '#888a92');
  // Bait worm
  rect(bx + bw / 2 - 4, by + 64, 4, 2, '#cc4422');
  drawTextLines(bx, by, bw, bh);
  // Stamp - warning
  drawStamp(bx, by, bw, bh, '#cc8822');
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'raised');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

function drawEmailTicket_AttachmentBig(col) {
  const cx = col * CELL_W;
  const cy = CELL_H;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#3366cc', '#1a3a99');
  drawLabel(bx, by, '20MB!', '#ffffff');
  drawEyes(bx, by, bw, 'strain');
  drawMouth(bx, by, bw, 'open');
  // Big file icon
  rect(bx + 14, by + 46, 28, 22, '#ffffff');
  rect(bx + 14, by + 46, 28, 1, '#3a3a44');
  rect(bx + 14, by + 46, 1, 22, '#3a3a44');
  rect(bx + 41, by + 46, 1, 22, '#3a3a44');
  rect(bx + 14, by + 67, 28, 1, '#3a3a44');
  // Page fold
  rect(bx + 36, by + 46, 6, 6, '#dcdce0');
  rect(bx + 36, by + 46, 6, 1, '#3a3a44');
  rect(bx + 36, by + 46, 1, 6, '#3a3a44');
  // File text lines
  rect(bx + 17, by + 52, 22, 1, '#5a4a3a');
  rect(bx + 17, by + 55, 18, 1, '#5a4a3a');
  rect(bx + 17, by + 58, 20, 1, '#5a4a3a');
  rect(bx + 17, by + 61, 12, 1, '#5a4a3a');
  // Big red warning
  rect(bx + 30, by + 64, 8, 4, '#cc2222');
  rect(bx + 32, by + 65, 4, 2, '#ffffff');
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'raised');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

// ============================================================
// NETWORK-TICKET VARIANTS (Row 2)
// ============================================================
function drawNetworkTicket_404(col) {
  const cx = col * CELL_W;
  const cy = CELL_H * 2;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#cc3344', '#88112a');
  drawLabel(bx, by, '404!', '#ffffff');
  drawEyes(bx, by, bw, 'confused');
  drawMouth(bx, by, bw, 'frown');
  // Big 404 text
  ctx.fillStyle = '#cc2222';
  // 4 0 4 - simple pixel digits, scaled up
  // First 4
  rect(bx + 8, by + 44, 2, 10, '#cc2222');
  rect(bx + 13, by + 44, 2, 14, '#cc2222');
  rect(bx + 8, by + 52, 7, 2, '#cc2222');
  // 0
  rect(bx + 20, by + 44, 8, 2, '#cc2222');
  rect(bx + 20, by + 44, 2, 14, '#cc2222');
  rect(bx + 26, by + 44, 2, 14, '#cc2222');
  rect(bx + 20, by + 56, 8, 2, '#cc2222');
  // Second 4
  rect(bx + 32, by + 44, 2, 10, '#cc2222');
  rect(bx + 37, by + 44, 2, 14, '#cc2222');
  rect(bx + 32, by + 52, 7, 2, '#cc2222');
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'raised');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

function drawNetworkTicket_WifiDown(col) {
  const cx = col * CELL_W;
  const cy = CELL_H * 2;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#cc3344', '#88112a');
  drawLabel(bx, by, 'NO WIFI', '#ffffff');
  drawEyes(bx, by, bw, 'angry');
  drawMouth(bx, by, bw, 'zigzag');
  // WiFi icon (3 arcs)
  const wifiCx = bx + bw / 2;
  const wifiCy = by + 60;
  ctx.fillStyle = '#5a5a64';
  rect(wifiCx - 1, wifiCy, 2, 2, '#5a5a64');
  // Arc 1 (small)
  rect(wifiCx - 3, wifiCy - 4, 6, 1, '#5a5a64');
  rect(wifiCx - 3, wifiCy - 4, 1, 2, '#5a5a64');
  rect(wifiCx + 2, wifiCy - 4, 1, 2, '#5a5a64');
  // Arc 2 (medium)
  rect(wifiCx - 6, wifiCy - 8, 12, 1, '#5a5a64');
  rect(wifiCx - 6, wifiCy - 8, 1, 2, '#5a5a64');
  rect(wifiCx + 5, wifiCy - 8, 1, 2, '#5a5a64');
  // Arc 3 (large)
  rect(wifiCx - 9, wifiCy - 12, 18, 1, '#5a5a64');
  rect(wifiCx - 9, wifiCy - 12, 1, 2, '#5a5a64');
  rect(wifiCx + 8, wifiCy - 12, 1, 2, '#5a5a64');
  // Red X over it
  ctx.fillStyle = '#cc2222';
  for (let i = 0; i < 10; i++) {
    rect(wifiCx - 8 + i * 2, wifiCy - 12 + i, 2, 1, '#cc2222');
    rect(wifiCx + 10 - i * 2, wifiCy - 12 + i, 2, 1, '#cc2222');
  }
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'raised');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

function drawNetworkTicket_VPN(col) {
  const cx = col * CELL_W;
  const cy = CELL_H * 2;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#cc3344', '#88112a');
  drawLabel(bx, by, 'VPN!', '#ffffff');
  drawEyes(bx, by, bw, 'stressed');
  drawMouth(bx, by, bw, 'open');
  // Broken padlock
  const lcx = bx + bw / 2;
  const lcy = by + 56;
  // Shackle (broken into two parts)
  ctx.fillStyle = '#888a92';
  rect(lcx - 7, lcy - 4, 2, 6, '#888a92');
  rect(lcx - 7, lcy - 8, 4, 2, '#888a92');
  rect(lcx + 5, lcy - 4, 2, 6, '#888a92');
  rect(lcx + 3, lcy - 8, 4, 2, '#888a92');
  // Body of lock
  rect(lcx - 8, lcy + 2, 16, 10, '#cc8822');
  rect(lcx - 8, lcy + 2, 16, 1, '#aa6611');
  rect(lcx - 1, lcy + 5, 2, 4, '#3a2a1a');
  drawTextLines(bx, by, bw, bh);
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'raised');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

function drawNetworkTicket_ServerDown(col) {
  const cx = col * CELL_W;
  const cy = CELL_H * 2;
  const { bx, by, bw, bh } = drawTicketBody(cx, cy, '#882233', '#440011');
  drawLabel(bx, by, 'DOWN', '#ffffff');
  drawEyes(bx, by, bw, 'dead');
  drawMouth(bx, by, bw, 'small');
  // Skull icon
  const scx = bx + bw / 2;
  const scy = by + 60;
  rect(scx - 7, scy - 6, 14, 12, '#ffffff');
  rect(scx - 7, scy - 6, 14, 1, '#5a5a5a');
  rect(scx - 7, scy + 5, 14, 1, '#5a5a5a');
  // Skull eyes
  rect(scx - 5, scy - 2, 4, 4, '#1a1a1a');
  rect(scx + 1, scy - 2, 4, 4, '#1a1a1a');
  // Skull mouth (teeth)
  rect(scx - 3, scy + 3, 6, 2, '#1a1a1a');
  rect(scx - 2, scy + 3, 1, 2, '#ffffff');
  rect(scx, scy + 3, 1, 2, '#ffffff');
  rect(scx + 2, scy + 3, 1, 2, '#ffffff');
  // Glowing dim eye sockets
  rect(scx - 4, scy - 1, 2, 2, '#cc2222');
  rect(scx + 2, scy - 1, 2, 2, '#cc2222');
  drawArms(bx, by, bw, bh, BODY_OUTLINE, 'sides');
  drawLegs(bx, by, bw, bh, BODY_OUTLINE);
}

// ============================================================
// RENDER ALL VARIANTS
// ============================================================
console.log(`Generating ${W}x${H} ticket-monster sprite sheet...`);

// Row 0: printer-ticket
drawPrinterTicket_Jam(0);
drawPrinterTicket_TonerLow(1);
drawPrinterTicket_Offline(2);
drawPrinterTicket_WrongColor(3);

// Row 1: email-ticket
drawEmailTicket_Inbox(0);
drawEmailTicket_Spam(1);
drawEmailTicket_Phishing(2);
drawEmailTicket_AttachmentBig(3);

// Row 2: network-ticket
drawNetworkTicket_404(0);
drawNetworkTicket_WifiDown(1);
drawNetworkTicket_VPN(2);
drawNetworkTicket_ServerDown(3);

// ============================================================
// SAVE
// ============================================================
const outDir = path.join(__dirname, '..', 'public', 'sprites');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
const outPath = path.join(outDir, 'tickets.png');
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);
const sizeKB = (buffer.length / 1024).toFixed(1);
console.log(`\n✓ Saved ${outPath}`);
console.log(`  Dimensions: ${W}x${H} (${COLS} cols × ${ROWS} rows, ${CELL_W}x${CELL_H} per cell)`);
console.log(`  Size: ${sizeKB} KB`);
console.log(`\nVariants per type:`);
console.log(`  Row 0 (printer-ticket): JAM, TONER, OFFLINE, CMYK`);
console.log(`  Row 1 (email-ticket):   INBOX, SPAM, PHISH, ATTACHMENT`);
console.log(`  Row 2 (network-ticket): 404, WIFI, VPN, DOWN`);
