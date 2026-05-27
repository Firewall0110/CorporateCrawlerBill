/**
 * SpriteLoader - Loads BillSpriteSheet.png for Corporate Crawler Bill
 *
 * Sheet: 771x1024 (JPEG content, served as .png).
 * Uniform 8 cols x 6 rows grid -> cell size ~96 x 170 px.
 * Background is a bright magenta chroma-key we strip to alpha.
 *
 * Column 0 of every row contains a vertical text label
 * ("WALKING", "PUNCHING", "KICKING", "JUMPING", "Getting Knocked Down",
 * "Special Explosion Ability"). We never slice column 0 - frames are taken
 * from columns 1..7 only, giving us up to 7 frames per animation.
 *
 * Row layout (top to bottom):
 *   0: Walking                    - up to 7 frames
 *   1: Punching                   - up to 7 frames
 *   2: Kicking                    - up to 7 frames
 *   3: Jumping                    - up to 7 frames
 *   4: Getting Knocked Down       - up to 7 frames (later cells may be empty)
 *   5: Special Explosion Ability  - up to 7 frames
 *
 * The character is always drawn facing right; the picker sets mirror=true
 * when the unit's direction is left.
 */

// ===== A/B sprite-sheet variant selection =====
//
// Two candidate sheets live in public/sprites:
//   A: BillSpriteSheet.png   (the original/current artwork)
//   B: BillSpriteSheetB.png  (alternate art - clearer punch / special FX)
//
// The variant is picked at module load time and cached for the session.
// Priority: ?sprite=A|B query param > localStorage('spriteVariant') > 'A'.
// When the query param is present we also write it back to localStorage so
// the choice persists across reloads / shared-link visits.
const SHEET_A_SRC = '/sprites/BillSpriteSheet.png';
const SHEET_B_SRC = '/sprites/BillSpriteSheetB.png';

function readSpriteVariant() {
  if (typeof window === 'undefined') return 'A';
  try {
    const params = new URLSearchParams(window.location.search);
    const urlVal = (params.get('sprite') || params.get('sprites') || '').toUpperCase();
    if (urlVal === 'A' || urlVal === 'B') {
      try { window.localStorage.setItem('spriteVariant', urlVal); } catch (_) {}
      return urlVal;
    }
    const stored = (window.localStorage.getItem('spriteVariant') || '').toUpperCase();
    if (stored === 'A' || stored === 'B') return stored;
  } catch (_) { /* localStorage may be blocked; fall through to default */ }
  return 'A';
}

const SPRITE_VARIANT = readSpriteVariant();
const SHEET_SRC = SPRITE_VARIANT === 'B' ? SHEET_B_SRC : SHEET_A_SRC;
console.log(`[SpriteLoader] Using sprite variant ${SPRITE_VARIANT} (${SHEET_SRC})`);

/**
 * Return the currently-active sprite variant ('A' or 'B'). Used by the HUD
 * toggle button to render the active state correctly.
 */
export function getSpriteVariant() {
  return SPRITE_VARIANT;
}

/**
 * Switch to the other variant. Writes to localStorage and reloads the page
 * (the sprite cache is module-scoped, so a reload is the simplest way to
 * re-run the chroma-key + slicing against the new sheet).
 */
export function setSpriteVariant(next) {
  const v = (next || '').toUpperCase();
  if (v !== 'A' && v !== 'B') return;
  try { window.localStorage.setItem('spriteVariant', v); } catch (_) {}
  // Clear ?sprite query so it doesn't pin the page to one variant on reload
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('sprite');
    url.searchParams.delete('sprites');
    window.history.replaceState({}, '', url.toString());
  } catch (_) {}
  window.location.reload();
}

// Uniform grid: 8 cols (col 0 = label, cols 1..7 = frame slots), 6 rows.
const GRID_COLS = 8;
const GRID_ROWS = 6;
const LABEL_COL = 0;
const FIRST_FRAME_COL = 1; // skip the label column entirely

// Per-animation row mapping. frameCount is the *intent* count starting from
// FIRST_FRAME_COL; if a cell turns out to be empty (failed sanity check in
// cropFrame), the picker falls back to an adjacent valid frame.
const ANIM = {
  WALK:    { rowIndex: 0, frameCount: 7 },
  PUNCH:   { rowIndex: 1, frameCount: 7 },
  KICK:    { rowIndex: 2, frameCount: 7 },
  JUMP:    { rowIndex: 3, frameCount: 7 },
  KO:      { rowIndex: 4, frameCount: 7 },
  SPECIAL: { rowIndex: 5, frameCount: 7 }
};

// ===== Chroma key (flood-fill from edges, moderate tolerance) =====
//
// Previous version: distance-threshold match against the bg magenta. That
// blanket-matched every magenta-ish pixel in the sheet, including the pink
// highlights inside the SPECIAL globe FX and the bubble's interior glow -
// they got punched out, leaving a hole through the middle of the effect.
//
// New version: flood-fill from the four edges. Only magenta pixels reach-
// able through other magenta from the outside become transparent. Interior
// pink-tinted FX pixels (bubble glow, lightning sparks) are not edge-
// reachable, so they survive even when their color matches the bg.
//
// Tolerance needs to be loose enough to pass through cell-divider lines
// (the slightly-darker magenta borders separating animation cells) so the
// flood reaches every cell's outer perimeter; without that the flood
// stalls at cell borders and most of the sheet stays opaque.
const CHROMA_DIST_SQ = 70 * 70; // ~4900 - permissive enough to cross cell borders

function processSheet(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) {
    throw new Error(`BillSpriteSheet: zero dimensions (${w}x${h})`);
  }

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // FAST PATH: source already has real alpha transparency. Skip chroma key.
  let alphaPixelCount = 0;
  let totalSampled = 0;
  for (let i = 3; i < data.length; i += 4 * 100) {
    totalSampled++;
    if (data[i] < 200) alphaPixelCount++;
  }
  if (alphaPixelCount / totalSampled > 0.15) {
    console.log('[SpriteLoader] Source has real alpha - skipping chroma key');
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // Find dominant background magenta from edge samples (averaged for JPEG noise).
  const samplePoints = [];
  for (let x = 5; x < w - 5; x += Math.max(1, Math.floor(w / 20))) {
    samplePoints.push([x, 2]);
    samplePoints.push([x, h - 3]);
  }
  let sumR = 0, sumG = 0, sumB = 0;
  for (const [x, y] of samplePoints) {
    const idx = (y * w + x) * 4;
    sumR += data[idx]; sumG += data[idx + 1]; sumB += data[idx + 2];
  }
  const bgR = sumR / samplePoints.length;
  const bgG = sumG / samplePoints.length;
  const bgB = sumB / samplePoints.length;
  console.log(
    `[SpriteLoader] BillSpriteSheet: ${w}x${h}, chromakey rgb(${Math.round(bgR)},${Math.round(bgG)},${Math.round(bgB)}), tol ${Math.sqrt(CHROMA_DIST_SQ).toFixed(0)} (flood-fill)`
  );

  // Predicate: is this pixel close enough to the bg magenta to be background?
  const isBg = (idx) => {
    const dr = data[idx] - bgR;
    const dg = data[idx + 1] - bgG;
    const db = data[idx + 2] - bgB;
    return dr * dr + dg * dg + db * db < CHROMA_DIST_SQ;
  };

  // Flood fill from all four edges through bg-tolerant pixels.
  // visited bit-array doubles as "marked for transparency" - any pixel we
  // walked through is bg-connected. Iterative stack (not recursion) so we
  // don't blow the call stack on large floods.
  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h * 2);
  let sp = 0;
  const push = (x, y) => {
    const ptr = y * w + x;
    if (visited[ptr]) return;
    if (!isBg(ptr * 4)) return;
    visited[ptr] = 1;
    stack[sp++] = x;
    stack[sp++] = y;
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  while (sp > 0) {
    const y = stack[--sp];
    const x = stack[--sp];
    if (x > 0)     push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0)     push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  // Apply: any visited (edge-connected bg) pixel -> alpha 0
  let removed = 0;
  for (let i = 0; i < w * h; i++) {
    if (visited[i]) {
      data[i * 4 + 3] = 0;
      removed++;
    }
  }
  const transparentRatio = removed / (w * h);
  console.log(
    `[SpriteLoader] BillSpriteSheet: ${(transparentRatio * 100).toFixed(1)}% transparent after flood-fill chroma key`
  );
  // Lower bar (was 0.20) - flood-fill is more conservative than blanket
  // distance-match, so a smaller absolute transparent ratio still indicates
  // a working chroma key. Only throw if obviously broken (no flood happened).
  if (transparentRatio < 0.08) {
    throw new Error(`Chroma key failed: only ${(transparentRatio * 100).toFixed(1)}% transparent (flood-fill stalled?)`);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ===== Frame slicing (wide source + seed-flood + bbox crop) =====
//
// The art frequently extends beyond its nominal cell - the punch fist
// reaches into the next cell, the kick leg sweeps past the cell border,
// the SPECIAL globe is wider than a single cell. We need a slicing scheme
// that captures those extensions without picking up the NEIGHBOR cell's
// character body (which would draw as ghost duplicates in every frame).
//
// Per-frame algorithm:
//   1. Crop a SOURCE REGION wider than the cell (cell + horizontal margin).
//   2. Flood-fill from a seed point at the cell's body center, walking
//      through any opaque pixel. The connected component starting at the
//      seed = this character + its extended limbs / FX, isolated from
//      neighbor characters that aren't pixel-connected to it.
//   3. Bbox the connected component, copy ONLY those pixels into the output
//      canvas. Anything in the source region that wasn't seed-connected
//      (the neighbor's body) is discarded.
//   4. Compute anchorX / anchorY from the bbox so the BODY (not the canvas
//      center) lines up with the unit's bounding box at render time.
//
// Result: each frame's canvas is sized to its actual content extent. Walk
// frames stay narrow, the SPECIAL frame with the bubble is wide, and the
// body's screen position is stable across frame transitions.

// Horizontal margin per side as a fraction of the cell width. 0.5 = grab
// half a cell on each side. The seed-flood then prunes anything that isn't
// connected to the focal cell's character.
const FRAME_MARGIN_FRAC = 0.5;

function cropFrameWithSeed(sheet, cellX, cellY, cellW, cellH) {
  const sheetW = sheet.width;
  const marginX = Math.floor(cellW * FRAME_MARGIN_FRAC);
  const srcX = Math.max(0, cellX - marginX);
  const srcRight = Math.min(sheetW, cellX + cellW + marginX);
  const srcW = srcRight - srcX;
  const srcH = cellH;

  // Pull just the wide source region into a working canvas.
  const work = document.createElement('canvas');
  work.width = srcW;
  work.height = srcH;
  const workCtx = work.getContext('2d');
  workCtx.imageSmoothingEnabled = false;
  workCtx.drawImage(sheet, srcX, cellY, srcW, srcH, 0, 0, srcW, srcH);

  const imgData = workCtx.getImageData(0, 0, srcW, srcH);
  const data = imgData.data;

  // Seed = cell's body-center column, roughly mid-torso vertically. The
  // exact seed pixel may be transparent (e.g. between legs); walk outward
  // in a small spiral until we hit an opaque pixel to start the flood from.
  const seedX = (cellX - srcX) + Math.floor(cellW / 2);
  const seedY = Math.floor(srcH * 0.55);

  let startX = -1, startY = -1;
  const SEARCH_R = Math.max(16, Math.floor(cellW * 0.3));
  outer: for (let r = 0; r <= SEARCH_R; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only ring
        const px = seedX + dx, py = seedY + dy;
        if (px < 0 || px >= srcW || py < 0 || py >= srcH) continue;
        if (data[(py * srcW + px) * 4 + 3] > 0) {
          startX = px; startY = py;
          break outer;
        }
      }
    }
  }
  if (startX < 0) return null; // empty cell

  // Flood fill from seed through any opaque pixel. 4-connectivity is
  // enough - artist's pixels are dense enough that we don't drop anything
  // intentional, but won't bridge across the magenta gap to a neighbor.
  const kept = new Uint8Array(srcW * srcH);
  const fstack = new Int32Array(srcW * srcH * 2);
  let fsp = 0;
  const fpush = (x, y) => {
    if (x < 0 || x >= srcW || y < 0 || y >= srcH) return;
    const ptr = y * srcW + x;
    if (kept[ptr]) return;
    if (data[ptr * 4 + 3] === 0) return;
    kept[ptr] = 1;
    fstack[fsp++] = x; fstack[fsp++] = y;
  };
  fpush(startX, startY);
  while (fsp > 0) {
    const y = fstack[--fsp];
    const x = fstack[--fsp];
    fpush(x - 1, y); fpush(x + 1, y);
    fpush(x, y - 1); fpush(x, y + 1);
  }

  // Bbox the kept component.
  let minX = srcW, minY = srcH, maxX = -1, maxY = -1;
  for (let py = 0; py < srcH; py++) {
    for (let px = 0; px < srcW; px++) {
      if (kept[py * srcW + px]) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
  }
  if (maxX < 0) return null;

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;

  // Sanity check: too-tiny component is probably just a stray pixel cluster.
  if (bboxW * bboxH < 200) return null;

  // Build output canvas: only seed-connected pixels survive.
  const outCanvas = document.createElement('canvas');
  outCanvas.width = bboxW;
  outCanvas.height = bboxH;
  const outCtx = outCanvas.getContext('2d');
  outCtx.imageSmoothingEnabled = false;
  const outData = outCtx.createImageData(bboxW, bboxH);
  const out = outData.data;
  for (let py = 0; py < bboxH; py++) {
    for (let px = 0; px < bboxW; px++) {
      const sPtr = (py + minY) * srcW + (px + minX);
      if (!kept[sPtr]) continue;
      const sIdx = sPtr * 4;
      const oIdx = (py * bboxW + px) * 4;
      out[oIdx]     = data[sIdx];
      out[oIdx + 1] = data[sIdx + 1];
      out[oIdx + 2] = data[sIdx + 2];
      out[oIdx + 3] = data[sIdx + 3];
    }
  }
  outCtx.putImageData(outData, 0, 0);

  // Anchors:
  //   anchorX = body's horizontal center within the bbox. The body is
  //     centered at cell center in sheet coords = seedX in source coords =
  //     (seedX - minX) in bbox coords. Even when the bbox extends asymmetric-
  //     ally (e.g. punch fist extends right), the body stays at this anchor.
  //   anchorY = body's feet within the bbox. Feet sit at the cell bottom
  //     (cellH - 1 in source coords) = (cellH - 1 - minY) in bbox coords.
  const anchorX = seedX - minX;
  const anchorY = (cellH - 1) - minY + 1; // +1: feet AT bottom edge
  return {
    canvas: outCanvas,
    width: bboxW,
    height: bboxH,
    anchorX,
    anchorY
  };
}

/**
 * Last-resort fallback when seed-flood extraction fails (returns null) but
 * the cell visibly contains something. Slices the raw cell with no margin /
 * bbox / connected-component isolation - we just get the unmodified cell.
 * Anchor defaults to canvas center / bottom which matches the legacy
 * rendering behavior.
 */
function simpleCellCrop(sheet, cellX, cellY, cellW, cellH) {
  const c = document.createElement('canvas');
  c.width = cellW;
  c.height = cellH;
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(sheet, cellX, cellY, cellW, cellH, 0, 0, cellW, cellH);
  const data = cx.getImageData(0, 0, cellW, cellH).data;
  let opaque = 0;
  const minOpaque = Math.floor(cellW * cellH * 0.03);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) { opaque++; if (opaque >= minOpaque) break; }
  }
  if (opaque < minOpaque) return null;
  return { canvas: c, width: cellW, height: cellH, anchorX: cellW / 2, anchorY: cellH };
}

function sliceAnimations(sheet) {
  const sprites = {};
  const cellW = Math.floor(sheet.width / GRID_COLS);
  const cellH = Math.floor(sheet.height / GRID_ROWS);
  if (FIRST_FRAME_COL <= LABEL_COL) {
    throw new Error('FIRST_FRAME_COL must be > LABEL_COL');
  }
  for (const [name, anim] of Object.entries(ANIM)) {
    const frames = [];
    let validCount = 0;
    let fallbackCount = 0;
    let dimsLog = '';
    for (let i = 0; i < anim.frameCount; i++) {
      const col = FIRST_FRAME_COL + i;
      if (col >= GRID_COLS) break;
      const cellX = col * cellW;
      const cellY = anim.rowIndex * cellH;
      let frame = cropFrameWithSeed(sheet, cellX, cellY, cellW, cellH);
      if (!frame) {
        // Seed-flood failed - try a plain cell crop so we still get *some*
        // sprite to render rather than punting to the procedural fallback.
        frame = simpleCellCrop(sheet, cellX, cellY, cellW, cellH);
        if (frame) fallbackCount++;
      }
      frames.push(frame);
      if (frame) {
        validCount++;
        if (i === 0 || i === Math.floor(anim.frameCount / 2)) {
          dimsLog += ` [${i}]${frame.width}x${frame.height}`;
        }
      }
    }
    sprites[name] = frames;
    const fbNote = fallbackCount > 0 ? ` (${fallbackCount} fallback)` : '';
    console.log(
      `[SpriteLoader] ${name}: row ${anim.rowIndex}, ${validCount}/${frames.length} valid frames${fbNote}${dimsLog}`
    );
  }
  return sprites;
}

// ===== Loader =====

function loadSheet() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const processed = processSheet(img);
        const sprites = sliceAnimations(processed);
        resolve(sprites);
      } catch (err) {
        console.error('[SpriteLoader] BillSpriteSheet failed:', err.message);
        reject(err);
      }
    };
    img.onerror = (err) => {
      console.error('[SpriteLoader] BillSpriteSheet: image failed to load from', SHEET_SRC);
      reject(err);
    };
    img.src = SHEET_SRC;
  });
}

let _sprites = null;
let _loadPromise = null;

export function loadBillSprites() {
  if (_sprites) return Promise.resolve(_sprites);
  if (_loadPromise) return _loadPromise;

  _loadPromise = loadSheet().then(sprites => {
    _sprites = sprites;
    console.log('[SpriteLoader] Bill sprites loaded successfully');
    return _sprites;
  }).catch(err => {
    console.error('[SpriteLoader] Bill sprites failed to load:', err);
    _loadPromise = null;
    _sprites = null;
    throw err;
  });

  return _loadPromise;
}

export function getBillSprites() {
  return _sprites;
}

// ===== Frame selection =====

/**
 * Pick which sprite frame to draw based on unit state and current time.
 *
 * Returns: { sprite, mirror, type } where:
 *   sprite: { canvas, width, height, anchorX, anchorY }
 *   mirror: true if drawBillSprite should flip horizontally (sheet draws
 *           the character facing right; mirror when facing left)
 *   type:   string tag identifying the animation, for debugging
 */
export function pickBillFrame(unit, now) {
  if (!_sprites) return null;
  const facing = unit.direction || 1;
  const mirror = facing < 0;

  // Safe lookup: return the requested frame, or the nearest valid one if
  // that specific cell was empty / dropped by the sanity check in cropFrame.
  const get = (animName, frameIdx) => {
    const anim = _sprites[animName];
    if (!anim || anim.length === 0) return null;
    const safeIdx = Math.max(0, Math.min(anim.length - 1, frameIdx));
    let frame = anim[safeIdx];
    if (!frame) {
      for (let c = safeIdx; c >= 0; c--) {
        if (anim[c]) { frame = anim[c]; break; }
      }
      if (!frame) {
        for (let c = safeIdx + 1; c < anim.length; c++) {
          if (anim[c]) { frame = anim[c]; break; }
        }
      }
    }
    return frame;
  };

  // KNOCKED OUT - Knock Down row, advance through frames over ~840 ms then
  // hold final lying-down frame for the duration of the K.O.
  if (unit.isKnockedOut) {
    if (!unit._koStartTime) unit._koStartTime = now;
    const elapsed = now - unit._koStartTime;
    const koFrames = ANIM.KO.frameCount;
    const frameIdx = Math.min(koFrames - 1, Math.floor(elapsed / 120));
    return { sprite: get('KO', frameIdx), mirror, type: 'defeated' };
  } else if (unit._koStartTime) {
    unit._koStartTime = undefined;
  }

  // JUMPING - dedicated row now. Pick frame by vertical velocity so the
  // animation actually reads as launch / rise / apex / fall / land.
  if (unit.isJumping) {
    const vy = unit.velocityY || 0;
    let frameIdx;
    if (vy < -10) frameIdx = 1;        // launch
    else if (vy < -3) frameIdx = 2;    // rising
    else if (vy < 3) frameIdx = 3;     // apex
    else if (vy < 10) frameIdx = 4;    // falling
    else frameIdx = 5;                 // pre-landing
    return { sprite: get('JUMP', frameIdx), mirror, type: 'jump' };
  }

  // ATTACKING - Punch / Kick / Special by attackType
  if (unit.isAttacking) {
    const elapsed = now - (unit.attackStartTime || now);
    const duration = unit.attackDuration || 300;
    const progress = Math.min(0.999, elapsed / duration);
    let animName;
    if (unit.attackType === 'kick') animName = 'KICK';
    else if (unit.attackType === 'special') animName = 'SPECIAL';
    else animName = 'PUNCH';
    const frames = ANIM[animName].frameCount;
    const frameIdx = Math.min(frames - 1, Math.floor(progress * frames));
    return { sprite: get(animName, frameIdx), mirror, type: unit.attackType || 'punch' };
  }

  // WALKING - single row, mirror for facing left. ~130 ms / frame.
  const isMoving = Math.abs(unit.velocityX || 0) > 0.3;
  if (isMoving) {
    const frameIdx = Math.floor(now / 130) % ANIM.WALK.frameCount;
    return { sprite: get('WALK', frameIdx), mirror, type: 'walk' };
  }

  // IDLE - hold first walk frame
  return { sprite: get('WALK', 0), mirror, type: 'idle' };
}

const SpriteLoaderModule = { loadBillSprites, getBillSprites, pickBillFrame };
export default SpriteLoaderModule;
