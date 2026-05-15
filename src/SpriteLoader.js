/**
 * SpriteLoader - Loads and processes 16-bit sprite sheets for Bill
 *
 * The source images are JPGs with a transparency-style checker background.
 * We chroma-key out the checker pattern to get usable sprites with alpha.
 */

const SPRITE_SHEETS = {
  punch: {
    src: '/sprites/crawlerbill6framewalk.jpg',
    frames: 6,
    // Frame layout: horizontal strip
  },
  kick: {
    src: '/sprites/8framekick.jpg',
    frames: 8,
  },
  portrait: {
    src: '/sprites/CorporateCrawlerBill.jpg',
    frames: 1,
  }
};

/**
 * Strict check: is a pixel CLEARLY part of the gray checker background?
 *
 * Tight thresholds to avoid removing character outline pixels that are
 * slightly desaturated due to JPG compression at the body/background boundary.
 */
function isCheckerGray(r, g, b) {
  // Must be very nearly grayscale (R ≈ G ≈ B within tight tolerance)
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  if (maxC - minC > 10) return false;
  // Brightness in the actual checker band (light ~200, dark ~150)
  const avg = (r + g + b) / 3;
  return avg >= 135 && avg <= 220;
}

/**
 * Process an image to remove checker background → transparency
 *
 * Strategy:
 * 1. Flood fill from all 4 edges, marking connected gray pixels transparent.
 *    Strict gray threshold to avoid eating character outline pixels.
 * 2. Isolated-pixel noise filter (snapshot-based, no cascading) to remove
 *    stray colored JPG speckles in transparent areas.
 *
 * No cleanup pass - the flood fill + noise filter combo is reliable
 * without risking cascading erosion into the character body.
 */
function processSheet(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const visited = new Uint8Array(w * h);

  // ---- PASS 1: Flood fill gray from edges ----
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
    if (!isCheckerGray(data[idx], data[idx + 1], data[idx + 2])) continue;

    data[idx + 3] = 0;

    stack.push(x + 1, y);
    stack.push(x - 1, y);
    stack.push(x, y + 1);
    stack.push(x, y - 1);
  }

  // ---- PASS 2: Isolated-pixel noise filter (snapshot-based) ----
  // Any opaque pixel with fewer than 3 opaque neighbors (3x3) is a stray
  // speck and gets removed. Snapshot prevents cascading erosion.
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

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Find the LARGEST connected component of opaque pixels using flood fill
 * Returns bounding box of just that component, excluding any leftover noise.
 */
function findMainContentBounds(frameCtx, w, h) {
  const imageData = frameCtx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const componentId = new Int32Array(w * h); // 0 = unvisited
  let nextId = 1;
  let bestSize = 0;
  let bestBounds = { minX: w, maxX: 0, minY: h, maxY: 0 };

  for (let startY = 0; startY < h; startY++) {
    for (let startX = 0; startX < w; startX++) {
      const startPtr = startY * w + startX;
      if (componentId[startPtr] !== 0) continue;
      if (data[startPtr * 4 + 3] === 0) continue;

      // BFS this component
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

  return bestSize > 0 ? bestBounds : null;
}

/**
 * Crop tight bounding box from a frame (find content boundaries)
 * Uses LARGEST connected component to ignore stray noise pixels.
 * Returns { canvas, width, height, anchorX, anchorY }
 */
function cropFrame(sheet, frameIndex, totalFrames) {
  const fullFrameWidth = sheet.width / totalFrames;
  const fullFrameHeight = sheet.height;

  // Extract this frame to a temporary canvas
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = fullFrameWidth;
  frameCanvas.height = fullFrameHeight;
  const frameCtx = frameCanvas.getContext('2d');
  frameCtx.imageSmoothingEnabled = false;
  frameCtx.drawImage(sheet,
    frameIndex * fullFrameWidth, 0, fullFrameWidth, fullFrameHeight,
    0, 0, fullFrameWidth, fullFrameHeight);

  // Find bounding box of the LARGEST connected component
  // This ensures tight cropping even if there's leftover noise in the frame
  const bounds = findMainContentBounds(frameCtx, fullFrameWidth, fullFrameHeight);

  if (bounds) {
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
      // Anchor at bottom-center (feet position)
      anchorX: cropW / 2,
      anchorY: cropH
    };
  }

  // Fallback: return full frame
  return {
    canvas: frameCanvas,
    width: fullFrameWidth,
    height: fullFrameHeight,
    anchorX: fullFrameWidth / 2,
    anchorY: fullFrameHeight
  };
}

/**
 * Load and process a sprite sheet, returning array of frame canvases
 */
function loadSheet(src, frames) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const processedSheet = processSheet(img);
        const frameList = [];
        for (let i = 0; i < frames; i++) {
          frameList.push(cropFrame(processedSheet, i, frames));
        }
        resolve(frameList);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

// Cache loaded sprites at module level
let _sprites = null;
let _loadPromise = null;

export function loadBillSprites() {
  if (_sprites) return Promise.resolve(_sprites);
  if (_loadPromise) return _loadPromise;

  _loadPromise = Promise.all([
    loadSheet(SPRITE_SHEETS.punch.src, SPRITE_SHEETS.punch.frames),
    loadSheet(SPRITE_SHEETS.kick.src, SPRITE_SHEETS.kick.frames),
    loadSheet(SPRITE_SHEETS.portrait.src, 1)
  ]).then(([punchFrames, kickFrames, portraitFrames]) => {
    _sprites = {
      punch: punchFrames,
      kick: kickFrames,
      portrait: portraitFrames[0],
      // Idle = use first punch frame (relaxed stance)
      idle: punchFrames[0],
      // Walk cycle = punch frames 0-2 (movement-like frames before extending)
      walk: [punchFrames[0], punchFrames[1], punchFrames[2]]
    };
    return _sprites;
  }).catch(err => {
    console.error('Failed to load Bill sprites:', err);
    _loadPromise = null;
    throw err;
  });

  return _loadPromise;
}

export function getBillSprites() {
  return _sprites;
}

/**
 * Pick which frame to draw based on unit state and timing
 */
export function pickBillFrame(unit, now) {
  if (!_sprites) return null;

  // Knocked out - use idle frame
  if (unit.isKnockedOut) {
    return { sprite: _sprites.idle, type: 'idle' };
  }

  // Attacking - use attack animation
  if (unit.isAttacking) {
    const elapsed = now - (unit.attackStartTime || now);
    const duration = unit.attackDuration || 300;
    const progress = Math.min(1, elapsed / duration);

    if (unit.attackType === 'kick') {
      // 8-frame kick
      const frameIdx = Math.min(7, Math.floor(progress * 8));
      return { sprite: _sprites.kick[frameIdx], type: 'kick' };
    } else if (unit.attackType === 'special') {
      // Use last frame of punch (biggest impact) and hold
      return { sprite: _sprites.punch[5], type: 'special' };
    } else {
      // Punch: cycle through frames 3-5 quickly (extending punch)
      const punchFrames = [3, 4, 5, 5];
      const frameIdx = punchFrames[Math.min(3, Math.floor(progress * 4))];
      return { sprite: _sprites.punch[frameIdx], type: 'punch' };
    }
  }

  // Walking - cycle walk frames
  const isMoving = Math.abs(unit.velocityX || 0) > 0.3;
  if (isMoving) {
    const frameIdx = Math.floor(now / 150) % _sprites.walk.length;
    return { sprite: _sprites.walk[frameIdx], type: 'walk' };
  }

  // Idle
  return { sprite: _sprites.idle, type: 'idle' };
}

const SpriteLoaderModule = { loadBillSprites, getBillSprites, pickBillFrame };
export default SpriteLoaderModule;
