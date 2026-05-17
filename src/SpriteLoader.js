/**
 * SpriteLoader - Loads BillSpriteSheet.png (actually JPEG) for Corporate Crawler Bill
 *
 * Single 880×1168 sheet, 7 rows × 8 columns, frame size 110×166.
 *
 * Row layout (per user spec):
 *   0: walk left   - 8 frames
 *   1: walk right  - 8 frames
 *   2: punch       - 8 frames
 *   3: kick        - 8 frames
 *   4: special     - 8 frames
 *   5: defeated/KO - 8 frames (transitions standing → lying down)
 *   6: jump        - 8 frames
 *
 * Since walk_left and walk_right are separate rows, we DON'T horizontally
 * flip for movement (the rows already encode direction). For other animations
 * (punch/kick/special/etc.) we have one row only, so we flip when facing left.
 *
 * The file content is JPEG (gray checker baked in), so we chroma-key the
 * background to transparency via adaptive edge sampling + flood fill.
 */

const SHEET_SRC = '/sprites/BillSpriteSheet.png';
// Sheet is 880x1168, 7 cols × 7 rows of ~125×166 cells.
// Each row has 7 animation frames (per CCBSpritesheet2.png layout).
const COLS = 7;
const ROWS = 7;

// Row indices match the labels on the sheet (top-to-bottom):
//   WALK RIGHT, WALK LEFT, PUNCH, KICK, SPECIAL, JUMP, KNOCKED OUT
const ROW_WALK_RIGHT = 0;
const ROW_WALK_LEFT  = 1;
const ROW_PUNCH      = 2;
const ROW_KICK       = 3;
const ROW_SPECIAL    = 4;
const ROW_JUMP       = 5;
const ROW_DEFEATED   = 6;

// ===== Chroma-key processing (adaptive edge-sampled distance) =====

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

  // FAST PATH: source PNG already has real alpha transparency (e.g. our
  // procedurally-generated BillSpriteSheet.png). No chroma key needed -
  // it would eat dark outline pixels by matching the transparent
  // black (0,0,0,0) edges to character outlines like (26,14,4).
  let alphaPixelCount = 0;
  let totalSampled = 0;
  for (let i = 3; i < data.length; i += 4 * 100) { // sample every 100th pixel for speed
    totalSampled++;
    if (data[i] < 200) alphaPixelCount++;
  }
  const alreadyTransparent = alphaPixelCount / totalSampled > 0.15;
  if (alreadyTransparent) {
    console.log('[SpriteLoader] Source has real alpha - skipping chroma key');
    return canvas;
  }

  // Sample edge colors to build adaptive background palette
  const edgeColors = [];
  const sampleStride = 2;
  for (let x = 0; x < w; x += sampleStride) {
    const tIdx = x * 4;
    edgeColors.push([data[tIdx], data[tIdx + 1], data[tIdx + 2]]);
    const bIdx = ((h - 1) * w + x) * 4;
    edgeColors.push([data[bIdx], data[bIdx + 1], data[bIdx + 2]]);
  }
  for (let y = 0; y < h; y += sampleStride) {
    const lIdx = (y * w) * 4;
    edgeColors.push([data[lIdx], data[lIdx + 1], data[lIdx + 2]]);
    const rIdx = (y * w + w - 1) * 4;
    edgeColors.push([data[rIdx], data[rIdx + 1], data[rIdx + 2]]);
  }

  // Filter to low-saturation samples (likely background, not character at edge)
  const lowSatSamples = edgeColors.filter(([r, g, b]) => {
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    return maxC - minC < 30;
  });

  // Dedupe by quantization
  const seen = new Set();
  const palette = [];
  const source = lowSatSamples.length >= 8 ? lowSatSamples : edgeColors;
  for (const c of source) {
    const key = (c[0] >> 3) * 1024 + (c[1] >> 3) * 32 + (c[2] >> 3);
    if (seen.has(key)) continue;
    seen.add(key);
    palette.push(c);
  }

  console.log(`[SpriteLoader] BillSpriteSheet: ${w}x${h}, ${edgeColors.length} edge samples → ${palette.length} unique background colors`);

  // Distance matcher
  const DIST_SQ = 40 * 40;
  function isBackground(r, g, b) {
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];
      if (dr * dr + dg * dg + db * db < DIST_SQ) return true;
    }
    return false;
  }

  // Flood fill from edges
  const visited = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, 0);
    stack.push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    stack.push(0, y);
    stack.push(w - 1, y);
  }

  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    const ptr = y * w + x;
    if (visited[ptr]) continue;
    visited[ptr] = 1;
    const idx = ptr * 4;
    if (!isBackground(data[idx], data[idx + 1], data[idx + 2])) continue;
    data[idx + 3] = 0;
    stack.push(x + 1, y);
    stack.push(x - 1, y);
    stack.push(x, y + 1);
    stack.push(x, y - 1);
  }

  // Snapshot-based noise filter
  const snapshotAlpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    snapshotAlpha[i] = data[i * 4 + 3];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ptr = y * w + x;
      if (snapshotAlpha[ptr] === 0) continue;
      let opaqueNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          if (snapshotAlpha[ny * w + nx] > 0) opaqueNeighbors++;
        }
      }
      if (opaqueNeighbors < 3) {
        data[ptr * 4 + 3] = 0;
      }
    }
  }

  // Validate
  let transparentCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] === 0) transparentCount++;
  }
  const transparentRatio = transparentCount / (w * h);
  console.log(`[SpriteLoader] BillSpriteSheet: ${(transparentRatio * 100).toFixed(1)}% transparent after processing`);

  if (transparentRatio < 0.20) {
    throw new Error(`Chroma key failed: only ${(transparentRatio * 100).toFixed(1)}% transparent`);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ===== Frame slicing with tight bbox cropping =====

function findMainContentBounds(frameCtx, w, h) {
  const imageData = frameCtx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const componentId = new Int32Array(w * h);
  let nextId = 1;
  let bestSize = 0;
  let bestBounds = null;

  for (let startY = 0; startY < h; startY++) {
    for (let startX = 0; startX < w; startX++) {
      const startPtr = startY * w + startX;
      if (componentId[startPtr] !== 0) continue;
      if (data[startPtr * 4 + 3] === 0) continue;

      const id = nextId++;
      const stack = [startX, startY];
      let size = 0;
      const bounds = { minX: startX, maxX: startX, minY: startY, maxY: startY };

      while (stack.length > 0) {
        const cy = stack.pop();
        const cx = stack.pop();
        if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
        const ptr = cy * w + cx;
        if (componentId[ptr] !== 0) continue;
        if (data[ptr * 4 + 3] === 0) continue;

        componentId[ptr] = id;
        size++;
        if (cx < bounds.minX) bounds.minX = cx;
        if (cx > bounds.maxX) bounds.maxX = cx;
        if (cy < bounds.minY) bounds.minY = cy;
        if (cy > bounds.maxY) bounds.maxY = cy;

        stack.push(cx + 1, cy);
        stack.push(cx - 1, cy);
        stack.push(cx, cy + 1);
        stack.push(cx, cy - 1);
      }

      if (size > bestSize) {
        bestSize = size;
        bestBounds = bounds;
      }
    }
  }

  return bestSize > 50 ? bestBounds : null;
}

function cropFrame(sheet, col, row, frameW, frameH) {
  // Extract frame from the sheet at (col, row)
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = frameW;
  frameCanvas.height = frameH;
  const frameCtx = frameCanvas.getContext('2d');
  frameCtx.imageSmoothingEnabled = false;
  frameCtx.drawImage(sheet,
    col * frameW, row * frameH, frameW, frameH,
    0, 0, frameW, frameH);

  // Find bounds of largest connected component (the character)
  const bounds = findMainContentBounds(frameCtx, frameW, frameH);

  if (!bounds) {
    // Empty frame - return null-shaped canvas
    return null;
  }

  const cropW = bounds.maxX - bounds.minX + 1;
  const cropH = bounds.maxY - bounds.minY + 1;

  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = cropW;
  croppedCanvas.height = cropH;
  const croppedCtx = croppedCanvas.getContext('2d');
  croppedCtx.imageSmoothingEnabled = false;
  croppedCtx.drawImage(frameCanvas, bounds.minX, bounds.minY, cropW, cropH, 0, 0, cropW, cropH);

  return {
    canvas: croppedCanvas,
    width: cropW,
    height: cropH,
    anchorX: cropW / 2,
    anchorY: cropH // feet at bottom for ground alignment
  };
}

// ===== Loader =====

function loadSheet() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const processed = processSheet(img);
        const frameW = Math.floor(processed.width / COLS);
        const frameH = Math.floor(processed.height / ROWS);

        // Slice into rows of frames
        const rows = [];
        for (let r = 0; r < ROWS; r++) {
          const rowFrames = [];
          for (let c = 0; c < COLS; c++) {
            rowFrames.push(cropFrame(processed, c, r, frameW, frameH));
          }
          rows.push(rowFrames);
        }
        console.log(`[SpriteLoader] BillSpriteSheet: sliced ${ROWS} rows x ${COLS} cols (${frameW}x${frameH} per cell)`);
        resolve(rows);
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
let _rows = null;
let _loadPromise = null;

export function loadBillSprites() {
  if (_rows) return Promise.resolve(_rows);
  if (_loadPromise) return _loadPromise;

  _loadPromise = loadSheet().then(rows => {
    _rows = rows;
    console.log('[SpriteLoader] Bill sprites loaded successfully');
    return _rows;
  }).catch(err => {
    console.error('[SpriteLoader] Bill sprites failed to load:', err);
    _loadPromise = null;
    _rows = null;
    throw err;
  });

  return _loadPromise;
}

export function getBillSprites() {
  return _rows;
}

/**
 * Pick which sprite frame to draw based on unit state and current time.
 *
 * Returns: { sprite: {canvas, width, height, anchorX, anchorY}, mirror: bool, type: string }
 *  - mirror: if true, drawBillSprite should flip horizontally. We only mirror for
 *    non-walk animations (which have a single row); walk left/right have separate rows.
 */
export function pickBillFrame(unit, now) {
  if (!_rows) return null;
  const facing = unit.direction || 1;

  // Helper: safely get a frame, falling back through animation if specific frame is missing
  const get = (row, col) => {
    if (!_rows[row]) return null;
    let frame = _rows[row][col];
    if (!frame) {
      // Walk backwards in the row for a valid frame
      for (let c = col; c >= 0; c--) {
        if (_rows[row][c]) { frame = _rows[row][c]; break; }
      }
    }
    return frame;
  };

  // KNOCKED OUT - row 6, progresses through stagger -> fall -> lying
  // Frame layout in this sheet:
  //   0: stagger/recoil   1: stars burst (impact)   2: dizzy/standing
  //   3-6: lying on ground (final rest pose held)
  if (unit.isKnockedOut) {
    if (!unit._koStartTime) unit._koStartTime = now;
    const koElapsed = now - unit._koStartTime;
    // Play through all 7 frames over ~700ms, then hold on last (lying)
    const frameIdx = Math.min(COLS - 1, Math.floor(koElapsed / 100));
    return { sprite: get(ROW_DEFEATED, frameIdx), mirror: facing < 0, type: 'defeated' };
  } else if (unit._koStartTime) {
    unit._koStartTime = undefined;
  }

  // JUMPING - row 5 (jump)
  // Frame layout: 0=stance/crouch, 1=launch, 2-3=apex/rising, 4=falling, 5-6=landing
  if (unit.isJumping) {
    const vy = unit.velocityY || 0;
    let frameIdx;
    if (vy < -10) frameIdx = 1;       // launch
    else if (vy < -3) frameIdx = 2;   // rising
    else if (vy < 3) frameIdx = 3;    // apex
    else if (vy < 10) frameIdx = 4;   // falling
    else frameIdx = 5;                // descending fast / pre-land
    return { sprite: get(ROW_JUMP, frameIdx), mirror: facing < 0, type: 'jump' };
  }

  // ATTACKING - 7 frames per attack animation
  if (unit.isAttacking) {
    const elapsed = now - (unit.attackStartTime || now);
    const duration = unit.attackDuration || 300;
    const progress = Math.min(0.999, elapsed / duration);
    const frameIdx = Math.min(COLS - 1, Math.floor(progress * COLS));

    let row;
    if (unit.attackType === 'kick') row = ROW_KICK;
    else if (unit.attackType === 'special') row = ROW_SPECIAL;
    else row = ROW_PUNCH;

    return { sprite: get(row, frameIdx), mirror: facing < 0, type: unit.attackType || 'punch' };
  }

  // WALKING - direction-specific row, no horizontal mirror needed
  // (sheet has separate WALK_RIGHT and WALK_LEFT rows)
  const isMoving = Math.abs(unit.velocityX || 0) > 0.3;
  if (isMoving) {
    const frameIdx = Math.floor(now / 130) % COLS;
    const row = facing > 0 ? ROW_WALK_RIGHT : ROW_WALK_LEFT;
    return { sprite: get(row, frameIdx), mirror: false, type: 'walk' };
  }

  // IDLE - first frame of facing-appropriate walk row
  const idleRow = facing > 0 ? ROW_WALK_RIGHT : ROW_WALK_LEFT;
  return { sprite: get(idleRow, 0), mirror: false, type: 'idle' };
}

const SpriteLoaderModule = { loadBillSprites, getBillSprites, pickBillFrame };
export default SpriteLoaderModule;
