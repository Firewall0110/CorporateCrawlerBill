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

import { getAttackAnim, getKoElapsed, frameFromTable, ATTACK_FRAME_MS } from './AnimClock';

// Bill's sprite sheet. (There used to be an A/B variant toggle here, but the
// two candidate sheets were byte-identical, so it was a no-op - removed.)
const SHEET_SRC = '/sprites/BillSpriteSheet.png';

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

// ===== Chroma key (flood-fill from edges, loose tolerance) =====
//
// Previous distance-threshold match blanket-killed every magenta-ish pixel
// including pink highlights INSIDE the SPECIAL globe FX. New flood-fill
// only kills magenta pixels that are reachable from the sheet edges
// through other magenta, so interior FX pixels survive.
//
// IMPORTANT: this sheet has slightly-darker cell-divider lines between
// animation cells. The tolerance must be loose enough that the flood can
// cross those dividers and reach every cell's interior bg - otherwise
// flood stalls at the sheet perimeter and ~98% of pixels stay opaque.
// Empirically tol=85 was proven safe by the original distance-match
// implementation (loaded successfully on this exact sheet); we keep that.
//
// Character outlines (~280 RGB distance from bg) easily block the flood
// from penetrating into the character interior, so even at tol=85 skin
// inside the body is safe.
const CHROMA_DIST_SQ = 85 * 85; // 7225 - same as the proven-working original

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
  // NEVER THROW. Even a 0% chroma-key result is OK at this layer - the
  // per-cell simpleCellCrop fallback will still produce sprites (they'll
  // just have magenta backgrounds visible instead of being chroma-keyed).
  // Throwing here was the failure mode that kicked us to the procedural
  // purple-block character. A degraded sprite is strictly better than no
  // sprite. If transparent ratio is suspicious, log loudly:
  if (transparentRatio < 0.10) {
    console.warn(
      `[SpriteLoader] Chroma-key transparent ratio is low (${(transparentRatio * 100).toFixed(1)}%). ` +
      `Flood-fill may have stalled at cell borders. Sprites will still load but may show magenta bg.`
    );
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
//   2. Sample a GRID of seed points inside the cell interior and flood-fill
//      each, walking through any opaque pixel; keep the LARGEST connected
//      component. That component = this character + its extended limbs / FX.
//      The flood reaches into the margin, so limbs spilling past the cell are
//      captured, while neighbor characters (not pixel-connected) are excluded.
//      (A single fixed seed used to miss the body entirely on poses that lean
//      out from under it - e.g. the high-kick extension - producing a stray
//      leg-only crop. Grid + largest-component is robust to that.)
//   3. Bbox the chosen component, copy ONLY its pixels into the output canvas.
//      Anything else in the source region (a neighbor's body) is discarded.
//   4. Compute anchorX / anchorY from the bbox so the BODY (not the canvas
//      center) lines up with the unit's bounding box at render time.
//
// Result: each frame's canvas is sized to its actual content extent. Walk
// frames stay narrow, the SPECIAL frame with the bubble is wide, and the
// body's screen position is stable across frame transitions.

// Horizontal margin per side as a fraction of the cell width. 0.5 = grab
// half a cell on each side. The component search then keeps only the largest
// blob seeded from within the focal cell.
const FRAME_MARGIN_FRAC = 0.5;

function cropFrameWithSeed(sheet, cellX, cellY, cellW, cellH) {
  try {
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

    // Find this cell's character as the LARGEST connected opaque component,
    // seeded from a GRID of points INSIDE the cell interior. The old approach
    // dropped a single fixed seed at the cell center / mid-torso; for poses
    // where the body leans out from under that point - notably the high-kick
    // extension frame - the seed landed in empty space, grabbed a 1px speck,
    // failed the size check, and dumped us into the misaligned plain-cell crop
    // that rendered ONLY a stray leg (the torso lives in the neighbor cell's
    // pixel space). Sampling a grid and keeping the biggest blob robustly grabs
    // the leaning torso plus extended limbs - the flood still walks into the
    // margin, so limbs that spill past the cell are captured. Seeds stay INSIDE
    // the cell so we pick THIS frame's character, not a neighbor bleeding into
    // the margin.
    const seedX = (cellX - srcX) + Math.floor(cellW / 2); // cell-center column (anchorX reference)
    const label = new Int32Array(srcW * srcH); // 0 = unvisited; else component id
    const fstack = new Int32Array(srcW * srcH * 2);
    let nextLabel = 0;
    let best = { id: 0, count: -1, minX: 0, minY: 0, maxX: -1, maxY: -1 };
    const cellLeft = cellX - srcX;
    const cellRight = cellLeft + cellW;
    const stepX = Math.max(5, Math.floor(cellW / 12));
    const stepY = Math.max(5, Math.floor(srcH / 16));
    for (let gy = Math.floor(srcH * 0.12); gy <= Math.floor(srcH * 0.92); gy += stepY) {
      for (let gx = cellLeft + 3; gx < cellRight - 3; gx += stepX) {
        const p0 = gy * srcW + gx;
        if (label[p0] || data[p0 * 4 + 3] === 0) continue; // already labeled or transparent
        // Flood this component, labeling pixels and tracking bbox + pixel count.
        nextLabel++;
        let f = 0, count = 0, minX = srcW, minY = srcH, maxX = -1, maxY = -1;
        label[p0] = nextLabel; fstack[f++] = gx; fstack[f++] = gy;
        while (f > 0) {
          const y = fstack[--f];
          const x = fstack[--f];
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (x > 0)        { const q = y * srcW + (x - 1); if (!label[q] && data[q * 4 + 3] !== 0) { label[q] = nextLabel; fstack[f++] = x - 1; fstack[f++] = y; } }
          if (x < srcW - 1) { const q = y * srcW + (x + 1); if (!label[q] && data[q * 4 + 3] !== 0) { label[q] = nextLabel; fstack[f++] = x + 1; fstack[f++] = y; } }
          if (y > 0)        { const q = (y - 1) * srcW + x; if (!label[q] && data[q * 4 + 3] !== 0) { label[q] = nextLabel; fstack[f++] = x; fstack[f++] = y - 1; } }
          if (y < srcH - 1) { const q = (y + 1) * srcW + x; if (!label[q] && data[q * 4 + 3] !== 0) { label[q] = nextLabel; fstack[f++] = x; fstack[f++] = y + 1; } }
        }
        if (count > best.count) best = { id: nextLabel, count, minX, minY, maxX, maxY };
      }
    }
    if (best.maxX < 0) return null; // no opaque pixel in the cell - caller falls back

    const minX = best.minX, minY = best.minY;
    const bboxW = best.maxX - minX + 1;
    const bboxH = best.maxY - minY + 1;

    // Sanity checks:
    //  - too-tiny component = stray pixel cluster, not a real character
    //  - too-wide component = flood swallowed the whole source region
    //    (which usually means chroma-key didn't break neighbor cells apart);
    //    fall back to plain cell crop instead of producing a frame that
    //    visually merges multiple cells.
    if (bboxW * bboxH < 400) return null;
    if (bboxW >= srcW * 0.95 && bboxH >= srcH * 0.95) return null;

    // Build output canvas: only the chosen component's pixels survive.
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
        if (label[sPtr] !== best.id) continue;
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
    //   anchorX = cell-center column within the bbox - keeps the body's
    //     cell-relative position stable across frames while limbs extend.
    //   anchorY = body's feet within the bbox (cell bottom).
    const anchorX = seedX - minX;
    const anchorY = (cellH - 1) - minY + 1;
    return {
      canvas: outCanvas,
      width: bboxW,
      height: bboxH,
      anchorX,
      anchorY
    };
  } catch (err) {
    // Any unexpected error (allocation failure, getImageData CORS, etc.)
    // falls through to the simpleCellCrop fallback rather than nuking the
    // entire sprite load.
    console.warn(`[SpriteLoader] cropFrameWithSeed threw at cell(${cellX},${cellY}):`, err.message);
    return null;
  }
}

/**
 * Last-resort fallback when seed-flood extraction fails (returns null) but
 * the cell visibly contains something. Slices the raw cell with no margin /
 * bbox / connected-component isolation - we just get the unmodified cell.
 * Anchor defaults to canvas center / bottom which matches the legacy
 * rendering behavior.
 */
function simpleCellCrop(sheet, cellX, cellY, cellW, cellH) {
  try {
    const c = document.createElement('canvas');
    c.width = cellW;
    c.height = cellH;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(sheet, cellX, cellY, cellW, cellH, 0, 0, cellW, cellH);
    // Opaque check: bail only on truly-empty cells (e.g. trailing magenta
    // cells at the end of the KO row). Bar set very low (0.5%) so any cell
    // that has visible character art returns successfully - we'd rather
    // render a cell with magenta bg than punt to the procedural fallback.
    const data = cx.getImageData(0, 0, cellW, cellH).data;
    let opaque = 0;
    const minOpaque = Math.max(50, Math.floor(cellW * cellH * 0.005));
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) { opaque++; if (opaque >= minOpaque) break; }
    }
    if (opaque < minOpaque) return null;
    return { canvas: c, width: cellW, height: cellH, anchorX: cellW / 2, anchorY: cellH };
  } catch (err) {
    console.warn(`[SpriteLoader] simpleCellCrop threw at cell(${cellX},${cellY}):`, err.message);
    return null;
  }
}

function sliceAnimations(processed, raw) {
  const sprites = {};
  const cellW = Math.floor(processed.width / GRID_COLS);
  const cellH = Math.floor(processed.height / GRID_ROWS);
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
      // First try: seed-flood + bbox on the chroma-keyed sheet (clean
      // transparent bg, extended limbs captured). If anything goes wrong
      // (chroma-key was too aggressive, seed missed, bbox swallowed
      // everything, exception thrown), fall back to a raw cell from the
      // un-chroma-keyed sheet so we ALWAYS produce a visible sprite -
      // worst case the cell has magenta bg visible but the character is
      // legible. A degraded sprite beats no sprite (purple block fallback).
      let frame = cropFrameWithSeed(processed, cellX, cellY, cellW, cellH);
      if (!frame) {
        frame = simpleCellCrop(processed, cellX, cellY, cellW, cellH);
      }
      if (!frame && raw) {
        // Even the processed-sheet simple crop failed - try raw sheet
        // (will have magenta bg visible but at least Bill renders).
        frame = simpleCellCrop(raw, cellX, cellY, cellW, cellH);
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
    const fbNote = fallbackCount > 0 ? ` (${fallbackCount} raw-fallback)` : '';
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
        // Keep an unmodified copy of the sheet as a safety net for slicing.
        // If the chroma-key produces unusable results for some cell, we fall
        // back to a plain crop from this raw copy.
        const raw = document.createElement('canvas');
        raw.width = img.naturalWidth;
        raw.height = img.naturalHeight;
        const rawCtx = raw.getContext('2d');
        rawCtx.imageSmoothingEnabled = false;
        rawCtx.drawImage(img, 0, 0);

        const processed = processSheet(img);
        const sprites = sliceAnimations(processed, raw);
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
  // hold final lying-down frame for the duration of the K.O. Elapsed comes from
  // the client-local AnimClock registry (the unit object is replaced every
  // broadcast, so a `_koStartTime` stashed on it would reset ~30x/sec).
  if (unit.isKnockedOut) {
    const elapsed = getKoElapsed(unit, now);
    const koFrames = ANIM.KO.frameCount;
    const frameIdx = Math.min(koFrames - 1, Math.floor(elapsed / 120));
    return { sprite: get('KO', frameIdx), mirror, type: 'defeated' };
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

  // ATTACKING - Punch / Kick / Special by attackType. Timed on the client clock
  // via AnimClock (keyed off the broadcast attackSeq token), NOT off a server
  // timestamp - see AnimClock.js. We gate on the AnimClock swing (`atk`), not
  // unit.isAttacking, so the held punch/kick visual can play out its full
  // duration even after the server's shorter hit window closes.
  const atk = getAttackAnim(unit, now);
  if (atk) {
    let animName;
    if (unit.attackType === 'kick') animName = 'KICK';
    else if (unit.attackType === 'special') animName = 'SPECIAL';
    else animName = 'PUNCH';
    const frameCount = ANIM[animName].frameCount;
    const table = ATTACK_FRAME_MS[unit.attackType];
    let frameIdx;
    if (table) {
      // Per-frame HOLD table: front frames flick by, the extension frame hangs.
      frameIdx = frameFromTable(table, atk.elapsed);
    } else {
      // No table (special / fallback): even spacing across the swing. The 0.999
      // clamp holds the final pose instead of wrapping back to frame 0.
      frameIdx = Math.floor(Math.min(0.999, atk.progress) * frameCount);
    }
    frameIdx = Math.min(frameCount - 1, frameIdx);
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
