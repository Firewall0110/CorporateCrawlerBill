/**
 * SpriteLoader - Loads and processes 16-bit sprite sheets for Bill
 *
 * The source images are JPGs with a transparency-style checker background.
 * We chroma-key out the checker pattern to get usable sprites with alpha.
 *
 * Approach: Adaptive edge color sampling + Euclidean distance matching +
 * flood fill from edges. Validates result and throws on failure so the
 * caller can fall back to procedural rendering instead of drawing garbage.
 */

const SPRITE_SHEETS = {
  punch: { src: '/sprites/crawlerbill6framewalk.jpg', frames: 6 },
  kick: { src: '/sprites/8framekick.jpg', frames: 8 },
  portrait: { src: '/sprites/CorporateCrawlerBill.jpg', frames: 1 }
};

/**
 * Process a sprite sheet image: remove checker background via flood fill
 * using adaptively-sampled edge colors.
 *
 * Throws if chroma key clearly failed (caller uses procedural fallback).
 */
function processSheet(img, label) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) {
    throw new Error(`${label}: image has zero dimensions (${w}x${h})`);
  }

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // -------- Step 1: Sample edge colors --------
  // Walk the perimeter, sampling many pixels. We then filter to those that
  // look like background (low color saturation), giving us an adaptive
  // palette that matches whatever the JPG actually decoded to.
  const edgeColors = [];
  const sampleStride = 2; // Sample every 2 pixels along the edge

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

  // Filter to background-looking samples: low saturation (R≈G≈B).
  // Character pixels have noticeable saturation (skin, blue jeans, green shirt).
  const lowSatSamples = edgeColors.filter(([r, g, b]) => {
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    return maxC - minC < 30;
  });

  // Deduplicate the palette to a manageable size (cluster by 8-bit bins)
  const seen = new Set();
  const palette = [];
  const source = lowSatSamples.length >= 8 ? lowSatSamples : edgeColors;
  for (const c of source) {
    const key = (c[0] >> 3) * 1024 + (c[1] >> 3) * 32 + (c[2] >> 3);
    if (seen.has(key)) continue;
    seen.add(key);
    palette.push(c);
  }

  console.log(`[SpriteLoader] ${label}: ${w}x${h}, sampled ${edgeColors.length} edge colors → ${palette.length} unique background colors`);

  // -------- Step 2: Define adaptive isBackground matcher --------
  // A pixel is background if it's within Euclidean distance N of ANY palette
  // color. This adapts to whatever the JPG decoded into.
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

  // -------- Step 3: Flood fill from edges --------
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

  // -------- Step 4: Snapshot-based noise filter --------
  // Removes isolated opaque speckles (JPG color noise in transparent regions).
  // Snapshot ensures we count ORIGINAL neighbor state, not cascading.
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

  // -------- Step 5: Validate --------
  // Count transparent pixels. If too few, the chroma key clearly failed
  // (e.g., palette was wrong). Throw so caller uses procedural fallback.
  let transparentCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] === 0) transparentCount++;
  }
  const transparentRatio = transparentCount / (w * h);
  console.log(`[SpriteLoader] ${label}: ${(transparentRatio * 100).toFixed(1)}% transparent after processing`);

  if (transparentRatio < 0.20) {
    throw new Error(`${label}: chroma key removed only ${(transparentRatio * 100).toFixed(1)}% of pixels`);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Find the bounding box of the LARGEST connected opaque component.
 * Ignores stray noise pixels.
 */
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

  return bestSize > 50 ? bestBounds : null; // Need at least 50 pixels for a real character
}

/**
 * Crop a frame from a processed sheet using the largest connected component
 */
function cropFrame(sheet, frameIndex, totalFrames, label) {
  const fullFrameWidth = sheet.width / totalFrames;
  const fullFrameHeight = sheet.height;

  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = fullFrameWidth;
  frameCanvas.height = fullFrameHeight;
  const frameCtx = frameCanvas.getContext('2d');
  frameCtx.imageSmoothingEnabled = false;
  frameCtx.drawImage(sheet,
    frameIndex * fullFrameWidth, 0, fullFrameWidth, fullFrameHeight,
    0, 0, fullFrameWidth, fullFrameHeight);

  const bounds = findMainContentBounds(frameCtx, fullFrameWidth, fullFrameHeight);

  if (!bounds) {
    throw new Error(`${label} frame ${frameIndex}: no content found after processing`);
  }

  const cropW = bounds.maxX - bounds.minX + 1;
  const cropH = bounds.maxY - bounds.minY + 1;

  // Sanity check: cropped content should be smaller than full frame
  // (if crop is the entire frame, chroma key clearly didn't work for this frame)
  if (cropW >= fullFrameWidth * 0.95 && cropH >= fullFrameHeight * 0.95) {
    throw new Error(`${label} frame ${frameIndex}: bbox covers entire frame - chroma key failed`);
  }

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
    anchorY: cropH // feet at bottom
  };
}

/**
 * Load a sprite sheet and slice into frames
 */
function loadSheet(src, frames, label) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Same-origin assets, no CORS needed
    img.onload = () => {
      try {
        const processed = processSheet(img, label);
        const frameList = [];
        for (let i = 0; i < frames; i++) {
          frameList.push(cropFrame(processed, i, frames, label));
        }
        console.log(`[SpriteLoader] ${label}: loaded ${frames} frames`);
        resolve(frameList);
      } catch (err) {
        console.error(`[SpriteLoader] ${label} failed:`, err.message);
        reject(err);
      }
    };
    img.onerror = (err) => {
      console.error(`[SpriteLoader] ${label}: image failed to load from ${src}`);
      reject(err);
    };
    img.src = src;
  });
}

// Module-level sprite cache
let _sprites = null;
let _loadPromise = null;

export function loadBillSprites() {
  if (_sprites) return Promise.resolve(_sprites);
  if (_loadPromise) return _loadPromise;

  _loadPromise = Promise.all([
    loadSheet(SPRITE_SHEETS.punch.src, SPRITE_SHEETS.punch.frames, 'punch'),
    loadSheet(SPRITE_SHEETS.kick.src, SPRITE_SHEETS.kick.frames, 'kick'),
    loadSheet(SPRITE_SHEETS.portrait.src, 1, 'portrait')
  ]).then(([punchFrames, kickFrames, portraitFrames]) => {
    _sprites = {
      punch: punchFrames,
      kick: kickFrames,
      portrait: portraitFrames[0],
      idle: punchFrames[0],
      walk: [punchFrames[0], punchFrames[1], punchFrames[2]]
    };
    console.log('[SpriteLoader] All Bill sprites loaded successfully');
    return _sprites;
  }).catch(err => {
    console.error('[SpriteLoader] Bill sprites failed to load completely:', err);
    _loadPromise = null;
    _sprites = null;
    throw err;
  });

  return _loadPromise;
}

export function getBillSprites() {
  return _sprites;
}

/**
 * Pick which sprite frame to use based on unit state and current time
 */
export function pickBillFrame(unit, now) {
  if (!_sprites) return null;

  if (unit.isKnockedOut) {
    return { sprite: _sprites.idle, type: 'idle' };
  }

  if (unit.isAttacking) {
    const elapsed = now - (unit.attackStartTime || now);
    const duration = unit.attackDuration || 300;
    const progress = Math.min(1, elapsed / duration);

    if (unit.attackType === 'kick') {
      const frameIdx = Math.min(7, Math.floor(progress * 8));
      return { sprite: _sprites.kick[frameIdx], type: 'kick' };
    } else if (unit.attackType === 'special') {
      return { sprite: _sprites.punch[5], type: 'special' };
    } else {
      const punchFrames = [3, 4, 5, 5];
      const frameIdx = punchFrames[Math.min(3, Math.floor(progress * 4))];
      return { sprite: _sprites.punch[frameIdx], type: 'punch' };
    }
  }

  const isMoving = Math.abs(unit.velocityX || 0) > 0.3;
  if (isMoving) {
    const frameIdx = Math.floor(now / 150) % _sprites.walk.length;
    return { sprite: _sprites.walk[frameIdx], type: 'walk' };
  }

  return { sprite: _sprites.idle, type: 'idle' };
}

const SpriteLoaderModule = { loadBillSprites, getBillSprites, pickBillFrame };
export default SpriteLoaderModule;
