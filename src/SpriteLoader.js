/**
 * SpriteLoader - Loads BillSpriteSheet.png for Corporate Crawler Bill
 *
 * Sheet: 771x1024, 5 rows of animations with variable frame counts.
 * Background is a uniform bright-magenta chroma-key color we strip to alpha.
 *
 * Row layout (top to bottom):
 *   0: Walking              - 5 frames (single row; mirror horizontally when facing left)
 *   1: Punching             - 5 frames
 *   2: Kicking              - 5 frames
 *   3: Knock Down           - 6 frames (standing → stagger → fall → lying)
 *   4: Special Shield Bubble - 6 frames (stance → charge → bubble → release)
 *
 * Each row has a small text label in the top-left corner ("Walking",
 * "Punching", etc.). We mask that label rectangle to transparent after the
 * chroma key so it doesn't render above the character's head.
 *
 * There is no dedicated jump row, so jump frames fall back to the walking row.
 */

const SHEET_SRC = '/sprites/BillSpriteSheet.png';

// Sheet is nominally 771x1024 with 5 equal-height rows of animations (so each
// row is ~204 px tall and frame widths are derived from the row's frame count:
// 5-frame rows → 154 px wide, 6-frame rows → 128 px wide). All dimensions are
// read from the loaded image at runtime so the loader handles minor resize.
const ROWS = 5;

// Per-row animation config. frameCount controls how the row is sliced
// horizontally; the resulting cell width = sheet.width / frameCount.
const ANIM = {
  WALK:    { rowIndex: 0, frameCount: 5 },
  PUNCH:   { rowIndex: 1, frameCount: 5 },
  KICK:    { rowIndex: 2, frameCount: 5 },
  KO:      { rowIndex: 3, frameCount: 6 },
  SPECIAL: { rowIndex: 4, frameCount: 6 }
};

// Label region (top-left of each row) - masked to transparent after chroma key.
// Empirically the labels occupy roughly the top 22 px and leftmost ~150 px of
// each row. Character heads sit lower than 22 px from the row top, so masking
// this rectangle removes the labels without clipping any character art.
const LABEL_BOX_W = 150;
const LABEL_BOX_H = 22;

// ===== Chroma key (single dominant background color) =====

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

  // FAST PATH: source already has real alpha transparency (e.g. a PNG with
  // proper transparent background). Skip chroma key entirely to avoid eating
  // character outline pixels.
  let alphaPixelCount = 0;
  let totalSampled = 0;
  for (let i = 3; i < data.length; i += 4 * 100) {
    totalSampled++;
    if (data[i] < 200) alphaPixelCount++;
  }
  if (alphaPixelCount / totalSampled > 0.15) {
    console.log('[SpriteLoader] Source has real alpha - skipping chroma key');
    maskLabelRegions(data, w, h);
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // Sample the magenta chromakey color by averaging several corner / edge
  // points. JPEG compression jitters individual pixels ±10 RGB, so an average
  // is more reliable than any single sample.
  const samplePoints = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
    [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)]
  ];
  let sumR = 0, sumG = 0, sumB = 0;
  for (const [x, y] of samplePoints) {
    const idx = (y * w + x) * 4;
    sumR += data[idx]; sumG += data[idx + 1]; sumB += data[idx + 2];
  }
  const bgR = sumR / samplePoints.length;
  const bgG = sumG / samplePoints.length;
  const bgB = sumB / samplePoints.length;
  console.log(
    `[SpriteLoader] BillSpriteSheet: ${w}x${h}, chromakey rgb(${Math.round(bgR)},${Math.round(bgG)},${Math.round(bgB)})`
  );

  // Distance threshold: magenta is far in RGB space from skin, denim, olive
  // shirt, hair, etc. A generous threshold tolerates JPEG noise on the
  // background without bleeding into character pixels.
  const DIST_SQ_THRESHOLD = 60 * 60;

  let removed = 0;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bgR;
    const dg = data[i + 1] - bgG;
    const db = data[i + 2] - bgB;
    if (dr * dr + dg * dg + db * db < DIST_SQ_THRESHOLD) {
      data[i + 3] = 0;
      removed++;
    }
  }

  const transparentRatio = removed / (w * h);
  console.log(
    `[SpriteLoader] BillSpriteSheet: ${(transparentRatio * 100).toFixed(1)}% transparent after chroma key`
  );
  if (transparentRatio < 0.20) {
    throw new Error(`Chroma key failed: only ${(transparentRatio * 100).toFixed(1)}% transparent`);
  }

  // Wipe out per-row text labels ("Walking", "Punching", ...) that survive the
  // chroma key because they're dark pixels on magenta. They sit in the
  // top-left of each row and would otherwise float above the character's head
  // when a frame is drawn.
  maskLabelRegions(data, w, h);

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function maskLabelRegions(data, w, h) {
  const rowH = Math.floor(h / ROWS);
  for (let r = 0; r < ROWS; r++) {
    const y0 = r * rowH;
    const yEnd = Math.min(y0 + LABEL_BOX_H, h);
    const xEnd = Math.min(LABEL_BOX_W, w);
    for (let y = y0; y < yEnd; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < xEnd; x++) {
        data[(rowOffset + x) * 4 + 3] = 0;
      }
    }
  }
}

// ===== Frame slicing =====

function cropFrame(sheet, sx, sy, frameW, frameH) {
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = frameW;
  frameCanvas.height = frameH;
  const frameCtx = frameCanvas.getContext('2d');
  frameCtx.imageSmoothingEnabled = false;
  frameCtx.drawImage(sheet, sx, sy, frameW, frameH, 0, 0, frameW, frameH);

  // Sanity check: if the cell is essentially empty (no character art), return
  // null so the picker can fall back to an adjacent frame instead of drawing
  // an invisible sprite.
  const data = frameCtx.getImageData(0, 0, frameW, frameH).data;
  let opaqueCount = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) {
      opaqueCount++;
      if (opaqueCount > 50) break;
    }
  }
  if (opaqueCount < 50) return null;

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
  const sheetW = sheet.width;
  const rowH = Math.floor(sheet.height / ROWS);
  for (const [name, anim] of Object.entries(ANIM)) {
    const frameW = Math.floor(sheetW / anim.frameCount);
    const frames = [];
    for (let i = 0; i < anim.frameCount; i++) {
      frames.push(cropFrame(sheet, i * frameW, anim.rowIndex * rowH, frameW, rowH));
    }
    sprites[name] = frames;
    console.log(`[SpriteLoader] ${name}: ${anim.frameCount} frames @ ${frameW}x${rowH}`);
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

// Module-level cache
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
 *   mirror: true if drawBillSprite should flip horizontally (the sheet draws
 *           the character facing right; mirror when facing left)
 *   type:   string tag identifying the animation, used for debugging only
 */
export function pickBillFrame(unit, now) {
  if (!_sprites) return null;
  const facing = unit.direction || 1;
  const mirror = facing < 0;

  // Helper: safely look up a frame, falling back through the animation if a
  // specific frame failed sanity checks (returns null).
  const get = (animName, frameIdx) => {
    const anim = _sprites[animName];
    if (!anim || anim.length === 0) return null;
    const safeIdx = Math.max(0, Math.min(anim.length - 1, frameIdx));
    let frame = anim[safeIdx];
    if (!frame) {
      // Walk backwards to find a valid frame
      for (let c = safeIdx; c >= 0; c--) {
        if (anim[c]) { frame = anim[c]; break; }
      }
      // If still nothing, walk forwards
      if (!frame) {
        for (let c = safeIdx + 1; c < anim.length; c++) {
          if (anim[c]) { frame = anim[c]; break; }
        }
      }
    }
    return frame;
  };

  // KNOCKED OUT - Knock Down row, 6 frames over ~700ms then hold final frame
  if (unit.isKnockedOut) {
    if (!unit._koStartTime) unit._koStartTime = now;
    const elapsed = now - unit._koStartTime;
    const koFrames = ANIM.KO.frameCount;
    const frameIdx = Math.min(koFrames - 1, Math.floor(elapsed / 120));
    return { sprite: get('KO', frameIdx), mirror, type: 'defeated' };
  } else if (unit._koStartTime) {
    unit._koStartTime = undefined;
  }

  // JUMPING - no dedicated jump row in this sheet; pick a walk frame based on
  // vertical velocity so the legs aren't frozen mid-stride during airtime.
  if (unit.isJumping) {
    const vy = unit.velocityY || 0;
    let walkIdx;
    if (vy < -10) walkIdx = 1;        // launch
    else if (vy < -3) walkIdx = 2;    // rising
    else if (vy < 3) walkIdx = 3;     // apex
    else walkIdx = 4;                 // falling / landing
    return { sprite: get('WALK', walkIdx), mirror, type: 'jump' };
  }

  // ATTACKING - one of Punch / Kick / Special depending on attackType
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

  // WALKING - single row, mirror for facing left. Cycle ~130 ms per frame.
  const isMoving = Math.abs(unit.velocityX || 0) > 0.3;
  if (isMoving) {
    const frameIdx = Math.floor(now / 130) % ANIM.WALK.frameCount;
    return { sprite: get('WALK', frameIdx), mirror, type: 'walk' };
  }

  // IDLE - first walk frame
  return { sprite: get('WALK', 0), mirror, type: 'idle' };
}

const SpriteLoaderModule = { loadBillSprites, getBillSprites, pickBillFrame };
export default SpriteLoaderModule;
