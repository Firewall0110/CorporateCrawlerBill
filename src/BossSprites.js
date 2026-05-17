/**
 * BossSprites - Loads the boss sprite sheet (Broadcast Storm) and picks
 * animation frames based on current attack state + telegraph progress.
 *
 * Sheet: public/sprites/boss.png
 * Layout: 4 rows × 8 frames, 140×170 per cell
 *   Row 0: idle
 *   Row 1: SystemDown (shockwave slam)
 *   Row 2: DataCorruption (laser beam)
 *   Row 3: ServiceRestarts (packet orbs)
 *
 * PNG has real alpha so no chroma key needed - just slice and crop.
 */

const SHEET_SRC = '/sprites/boss.png';
const CELL_W = 140;
const CELL_H = 170;
const COLS = 8;
const ROWS = 4;

// Death animation sheet
const DEATH_SRC = '/sprites/boss-death.png';
const DEATH_CELL_W = 160;
const DEATH_CELL_H = 200;
const DEATH_COLS = 8;
const DEATH_ROWS = 8;
const DEATH_TOTAL_FRAMES = DEATH_COLS * DEATH_ROWS; // 64

const ROW_IDLE = 0;
const ROW_SYSTEM_DOWN = 1;
const ROW_DATA_CORRUPTION = 2;
const ROW_SERVICE_RESTARTS = 3;

function tightCropFrame(srcCanvas, col, row) {
  const fw = CELL_W;
  const fh = CELL_H;
  const frame = document.createElement('canvas');
  frame.width = fw;
  frame.height = fh;
  const fctx = frame.getContext('2d');
  fctx.imageSmoothingEnabled = false;
  fctx.drawImage(srcCanvas, col * fw, row * fh, fw, fh, 0, 0, fw, fh);

  const data = fctx.getImageData(0, 0, fw, fh).data;
  let minX = fw, maxX = 0, minY = fh, maxY = 0;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const i = (y * fw + x) * 4 + 3;
      if (data[i] > 30) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return null;

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const cropped = document.createElement('canvas');
  cropped.width = cw;
  cropped.height = ch;
  const cctx = cropped.getContext('2d');
  cctx.imageSmoothingEnabled = false;
  cctx.drawImage(frame, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas: cropped, width: cw, height: ch };
}

let _rows = null;
let _loadPromise = null;

export function loadBossSprites() {
  if (_rows) return Promise.resolve(_rows);
  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const work = document.createElement('canvas');
        work.width = COLS * CELL_W;
        work.height = ROWS * CELL_H;
        const wctx = work.getContext('2d');
        wctx.imageSmoothingEnabled = false;
        wctx.drawImage(img, 0, 0);

        const rows = [];
        for (let r = 0; r < ROWS; r++) {
          const cells = [];
          for (let c = 0; c < COLS; c++) {
            cells.push(tightCropFrame(work, c, r));
          }
          rows.push(cells);
        }
        _rows = rows;
        console.log('[BossSprites] Loaded boss sprite sheet');
        resolve(_rows);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('boss.png failed to load'));
    img.src = SHEET_SRC;
  }).catch(err => {
    _loadPromise = null;
    _rows = null;
    throw err;
  });

  return _loadPromise;
}

export function getBossSprites() {
  return _rows;
}

/**
 * Pick the appropriate boss animation frame.
 *
 * boss state from server includes:
 *   - currentAttack: { type, isInTelegram, telegramProgress, damageProgress }
 *   - isKnockedOut, health, maxHealth
 *
 * Returns: { sprite: {canvas, width, height} } or null if not loaded.
 */
export function pickBossFrame(boss, now) {
  if (!_rows) return null;

  // No attack in progress: use idle cycle
  if (!boss.currentAttack || (!boss.currentAttack.isInTelegram && !boss.currentAttack.isExecuting)) {
    const frameIdx = Math.floor(now / 130) % COLS;
    return { sprite: _rows[ROW_IDLE][frameIdx] || _rows[ROW_IDLE][0] };
  }

  const atk = boss.currentAttack;
  let row;
  if (atk.type === 'shockwave') row = ROW_SYSTEM_DOWN;
  else if (atk.type === 'laserBeam') row = ROW_DATA_CORRUPTION;
  else if (atk.type === 'targetZones') row = ROW_SERVICE_RESTARTS;
  else return { sprite: _rows[ROW_IDLE][0] };

  // Map telegraph + damage progress to 8 frames:
  //   Frames 0-3: telegraph (windup)
  //   Frames 4-5: active damage
  //   Frames 6-7: recovery
  let frameIdx;
  if (atk.isInTelegram) {
    // Telegraph phase: frames 0-3
    const t = Math.min(1, atk.telegramProgress || 0);
    frameIdx = Math.min(3, Math.floor(t * 4));
  } else {
    // Damage phase: frames 4-7
    const t = Math.min(1, atk.damageProgress || 0);
    frameIdx = 4 + Math.min(3, Math.floor(t * 4));
  }

  const frame = _rows[row][frameIdx];
  if (!frame) return { sprite: _rows[ROW_IDLE][0] };
  return { sprite: frame };
}

// ============================================================
// DEATH ANIMATION (separate sheet)
// ============================================================
let _deathFrames = null;
let _deathLoadPromise = null;

function tightCropDeath(srcCanvas, col, row) {
  const fw = DEATH_CELL_W;
  const fh = DEATH_CELL_H;
  const frame = document.createElement('canvas');
  frame.width = fw;
  frame.height = fh;
  const fctx = frame.getContext('2d');
  fctx.imageSmoothingEnabled = false;
  fctx.drawImage(srcCanvas, col * fw, row * fh, fw, fh, 0, 0, fw, fh);

  const data = fctx.getImageData(0, 0, fw, fh).data;
  let minX = fw, maxX = 0, minY = fh, maxY = 0;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const i = (y * fw + x) * 4 + 3;
      if (data[i] > 30) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) {
    // Empty frame (late vaporize phase) - just return an empty placeholder
    return { canvas: frame, width: fw, height: fh, isEmpty: true };
  }

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const cropped = document.createElement('canvas');
  cropped.width = cw;
  cropped.height = ch;
  const cctx = cropped.getContext('2d');
  cctx.imageSmoothingEnabled = false;
  cctx.drawImage(frame, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas: cropped, width: cw, height: ch, offsetX: minX, offsetY: minY, originalW: fw, originalH: fh };
}

export function loadBossDeathSprites() {
  if (_deathFrames) return Promise.resolve(_deathFrames);
  if (_deathLoadPromise) return _deathLoadPromise;

  _deathLoadPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const work = document.createElement('canvas');
        work.width = DEATH_COLS * DEATH_CELL_W;
        work.height = DEATH_ROWS * DEATH_CELL_H;
        const wctx = work.getContext('2d');
        wctx.imageSmoothingEnabled = false;
        wctx.drawImage(img, 0, 0);

        const frames = [];
        for (let r = 0; r < DEATH_ROWS; r++) {
          for (let c = 0; c < DEATH_COLS; c++) {
            frames.push(tightCropDeath(work, c, r));
          }
        }
        _deathFrames = frames;
        console.log('[BossSprites] Death animation loaded (64 frames)');
        resolve(_deathFrames);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('boss-death.png failed to load'));
    img.src = DEATH_SRC;
  }).catch(err => {
    _deathLoadPromise = null;
    _deathFrames = null;
    throw err;
  });

  return _deathLoadPromise;
}

export function getBossDeathSprites() {
  return _deathFrames;
}

/**
 * Pick the death frame based on elapsed time.
 * deathDuration = 5200ms / 64 frames = 81.25ms per frame
 */
export function pickBossDeathFrame(elapsed, duration) {
  if (!_deathFrames) return null;
  const t = Math.min(1, elapsed / duration);
  const frameIdx = Math.min(DEATH_TOTAL_FRAMES - 1, Math.floor(t * DEATH_TOTAL_FRAMES));
  return _deathFrames[frameIdx];
}

const BossSpritesModule = {
  loadBossSprites, getBossSprites, pickBossFrame,
  loadBossDeathSprites, getBossDeathSprites, pickBossDeathFrame
};
export default BossSpritesModule;
