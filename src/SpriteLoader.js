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

// ===== Chroma key (single dominant background color, generous threshold) =====
//
// The user explicitly asked for "no magenta halo from the characters". JPEG
// compression bleeds magenta-toward-skin pixels at the character outline.
// Using a wider distance threshold catches those near-magenta halo pixels
// (and the slightly-darker pink cell borders) without bleeding into skin /
// hair / clothing / boots, which are all far from magenta in RGB space.
const CHROMA_DIST_SQ = 85 * 85; // ~7225

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

  // Find the dominant background magenta. We sample multiple TOP edge points
  // (they're guaranteed to be pure background since the character cells start
  // below row 0). Averaging absorbs JPEG noise.
  const samplePoints = [];
  for (let x = 5; x < w - 5; x += Math.max(1, Math.floor(w / 20))) {
    samplePoints.push([x, 2]);            // near top edge
    samplePoints.push([x, h - 3]);        // near bottom edge
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
    `[SpriteLoader] BillSpriteSheet: ${w}x${h}, chromakey rgb(${Math.round(bgR)},${Math.round(bgG)},${Math.round(bgB)}), threshold ${Math.sqrt(CHROMA_DIST_SQ).toFixed(0)}`
  );

  let removed = 0;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bgR;
    const dg = data[i + 1] - bgG;
    const db = data[i + 2] - bgB;
    if (dr * dr + dg * dg + db * db < CHROMA_DIST_SQ) {
      data[i + 3] = 0;
      removed++;
    }
  }
  const transparentRatio = removed / (w * h);
  console.log(
    `[SpriteLoader] BillSpriteSheet: ${(transparentRatio * 100).toFixed(1)}% transparent after chroma key`
  );
  if (transparentRatio < 0.30) {
    throw new Error(`Chroma key failed: only ${(transparentRatio * 100).toFixed(1)}% transparent`);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ===== Frame slicing =====

function cropFrame(sheet, sx, sy, frameW, frameH) {
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = frameW;
  frameCanvas.height = frameH;
  const frameCtx = frameCanvas.getContext('2d');
  frameCtx.imageSmoothingEnabled = false;
  frameCtx.drawImage(sheet, sx, sy, frameW, frameH, 0, 0, frameW, frameH);

  // Sanity check: skip near-empty cells so picker falls back to neighbor.
  // Threshold ~3% of cell area opaque feels right for "this cell actually
  // contains a character" - empty cells average <0.5%.
  const data = frameCtx.getImageData(0, 0, frameW, frameH).data;
  let opaqueCount = 0;
  const minOpaque = Math.floor(frameW * frameH * 0.03);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) {
      opaqueCount++;
      if (opaqueCount >= minOpaque) break;
    }
  }
  if (opaqueCount < minOpaque) return null;

  return {
    canvas: frameCanvas,
    width: frameW,
    height: frameH,
    anchorX: frameW / 2,
    anchorY: frameH // feet at bottom for ground alignment
  };
}

function sliceAnimations(sheet) {
  const sprites = {};
  const cellW = Math.floor(sheet.width / GRID_COLS);
  const cellH = Math.floor(sheet.height / GRID_ROWS);
  // Defense: ensure we'll never slice into the label column
  if (FIRST_FRAME_COL <= LABEL_COL) {
    throw new Error('FIRST_FRAME_COL must be > LABEL_COL');
  }
  for (const [name, anim] of Object.entries(ANIM)) {
    const frames = [];
    let validCount = 0;
    for (let i = 0; i < anim.frameCount; i++) {
      const col = FIRST_FRAME_COL + i;
      if (col >= GRID_COLS) break; // safety
      const sx = col * cellW;
      const sy = anim.rowIndex * cellH;
      const frame = cropFrame(sheet, sx, sy, cellW, cellH);
      frames.push(frame); // may be null - picker handles
      if (frame) validCount++;
    }
    sprites[name] = frames;
    console.log(
      `[SpriteLoader] ${name}: row ${anim.rowIndex}, ${validCount}/${frames.length} valid frames @ ${cellW}x${cellH}`
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
