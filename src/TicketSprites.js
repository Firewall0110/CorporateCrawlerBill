/**
 * TicketSprites - Loads the ticket-monster sprite sheet and exposes per-variant
 * frames for the procedural enemies.
 *
 * Sheet: public/sprites/tickets.png
 * Layout: 4 columns × 3 rows of 100×120 cells
 *   Row 0: printer-ticket variants (JAM, TONER, OFFLINE, CMYK)
 *   Row 1: email-ticket  variants (INBOX, SPAM, PHISH, ATTACHMENT)
 *   Row 2: network-ticket variants (404, WIFI, VPN, DOWN)
 *
 * The PNG already has alpha transparency (procedurally generated with
 * proper alpha) so no chroma-keying is needed. We slice into row arrays
 * and pre-crop tight bboxes for clean rendering.
 */

const SHEET_SRC = '/sprites/tickets.png';
const CELL_W = 100;
const CELL_H = 120;
const COLS = 4;
const ROWS = 3;

const ROW_BY_TYPE = {
  'printer-ticket': 0,
  'email-ticket': 1,
  'network-ticket': 2
};

// Find a tight bbox around opaque pixels in a frame canvas
function tightCropFrame(srcCanvas, col, row) {
  const fw = CELL_W;
  const fh = CELL_H;
  const frame = document.createElement('canvas');
  frame.width = fw;
  frame.height = fh;
  const fctx = frame.getContext('2d');
  fctx.imageSmoothingEnabled = false;
  fctx.drawImage(srcCanvas, col * fw, row * fh, fw, fh, 0, 0, fw, fh);

  const imageData = fctx.getImageData(0, 0, fw, fh);
  const data = imageData.data;
  let minX = fw, maxX = 0, minY = fh, maxY = 0;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const i = (y * fw + x) * 4 + 3;
      if (data[i] > 50) {
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
  return {
    canvas: cropped,
    width: cw,
    height: ch,
    anchorX: cw / 2,
    anchorY: ch
  };
}

let _rows = null;
let _loadPromise = null;

export function loadTicketSprites() {
  if (_rows) return Promise.resolve(_rows);
  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // Draw into an offscreen canvas (avoid touching the source repeatedly)
        const work = document.createElement('canvas');
        work.width = COLS * CELL_W;
        work.height = ROWS * CELL_H;
        const wctx = work.getContext('2d');
        wctx.imageSmoothingEnabled = false;
        wctx.drawImage(img, 0, 0);

        const rows = [];
        for (let r = 0; r < ROWS; r++) {
          const variants = [];
          for (let c = 0; c < COLS; c++) {
            variants.push(tightCropFrame(work, c, r));
          }
          rows.push(variants);
        }
        _rows = rows;
        console.log(`[TicketSprites] Loaded ${ROWS} types x ${COLS} variants`);
        resolve(_rows);
      } catch (err) {
        console.error('[TicketSprites] processing failed:', err);
        reject(err);
      }
    };
    img.onerror = () => {
      console.error('[TicketSprites] image failed to load from', SHEET_SRC);
      reject(new Error('image load failed'));
    };
    img.src = SHEET_SRC;
  }).catch(err => {
    _loadPromise = null;
    _rows = null;
    throw err;
  });

  return _loadPromise;
}

export function getTicketSprites() {
  return _rows;
}

/**
 * Deterministic hash → consistent variant for the same enemy id.
 * djb2-style hash.
 */
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * Pick a sprite frame for a given enemy. Returns null if sprites not loaded
 * or the enemy type isn't a ticket type (caller should fall back to procedural).
 *
 * The variant is deterministic per enemy id so an individual enemy doesn't
 * flicker between variants frame-to-frame.
 */
export function pickTicketFrame(enemy) {
  if (!_rows) return null;
  const row = ROW_BY_TYPE[enemy.enemyType];
  if (row === undefined) return null;
  const variants = _rows[row];
  if (!variants || variants.length === 0) return null;
  const variantIdx = hashStr(enemy.id || enemy.name || '') % variants.length;
  return variants[variantIdx] || variants[0];
}

const TicketSpritesModule = { loadTicketSprites, getTicketSprites, pickTicketFrame };
export default TicketSpritesModule;
