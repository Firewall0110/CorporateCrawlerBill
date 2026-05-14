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
 * Check if a pixel is part of the transparency checker pattern
 * Common checker colors are around (200, 200, 200) light and (150, 150, 150) dark
 */
function isCheckerPixel(r, g, b) {
  // Must be near-grayscale (low color saturation)
  const isGrayish = Math.abs(r - g) < 15 && Math.abs(g - b) < 15 && Math.abs(r - b) < 15;
  if (!isGrayish) return false;

  // Light checker (~200,200,200)
  if (r >= 190 && r <= 215 && g >= 190 && g <= 215 && b >= 190 && b <= 215) return true;
  // Dark checker (~150,150,150)
  if (r >= 140 && r <= 165 && g >= 140 && g <= 165 && b >= 140 && b <= 165) return true;

  return false;
}

/**
 * Process an image to remove checker background → transparency
 */
function processSheet(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  // Get pixel data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // First pass: chroma-key checker pattern → transparent
  for (let i = 0; i < data.length; i += 4) {
    if (isCheckerPixel(data[i], data[i + 1], data[i + 2])) {
      data[i + 3] = 0; // alpha = 0
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Crop tight bounding box from a frame (find content boundaries)
 * Returns { canvas, frameWidth, frameHeight }
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

  // Find content bounding box (non-transparent pixels)
  const imageData = frameCtx.getImageData(0, 0, fullFrameWidth, fullFrameHeight);
  const data = imageData.data;
  let minX = fullFrameWidth, maxX = 0, minY = fullFrameHeight, maxY = 0;

  for (let y = 0; y < fullFrameHeight; y++) {
    for (let x = 0; x < fullFrameWidth; x++) {
      const idx = (y * fullFrameWidth + x) * 4;
      if (data[idx + 3] > 30) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // If we found content, crop to bounding box
  if (maxX > minX && maxY > minY) {
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const croppedCtx = croppedCanvas.getContext('2d');
    croppedCtx.imageSmoothingEnabled = false;
    croppedCtx.drawImage(frameCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
    return {
      canvas: croppedCanvas,
      offsetX: minX,
      offsetY: minY,
      width: cropW,
      height: cropH,
      // Store anchor (bottom-center) for proper positioning
      anchorX: cropW / 2,
      anchorY: cropH // Feet at bottom
    };
  }

  // Fallback: return full frame
  return {
    canvas: frameCanvas,
    offsetX: 0,
    offsetY: 0,
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
