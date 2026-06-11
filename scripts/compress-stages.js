/*
 * Re-encode the photoreal stage backgrounds from PNG to WebP.
 *
 * The source PNGs were 7-9MB each (stored RGBA, but fully opaque - the alpha
 * channel was unused). WebP at q80 cuts them by ~20-40x with no visible loss,
 * which is a huge first-paint win since ~26MB of backdrops were shipped for
 * images drawn at 700px tall.
 *
 * Run: npm run stages:compress  (installs sharp on the fly, like the other
 * asset scripts). The client loads /sprites/stage*.webp at runtime.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SPRITES_DIR = path.join(__dirname, '..', 'public', 'sprites');
const QUALITY = 80;
// The game canvas backing store is a fixed 1200x700, and stages are drawn at
// 700px tall, so any source taller than this is downsampled away at draw time.
// Cap height here (with a small safety margin) for a free size win on top of the
// format change. withoutEnlargement leaves already-shorter stages untouched.
const MAX_HEIGHT = 800;

(async () => {
  const pngs = fs.readdirSync(SPRITES_DIR).filter(f => /^stage\d+\.png$/.test(f));
  if (pngs.length === 0) {
    console.log('No stage*.png files found - nothing to do.');
    return;
  }
  for (const file of pngs) {
    const src = path.join(SPRITES_DIR, file);
    const out = src.replace(/\.png$/, '.webp');
    const before = fs.statSync(src).size;
    // flatten() drops the (unused, fully-opaque) alpha channel over black.
    await sharp(src)
      .flatten({ background: '#000000' })
      .resize({ height: MAX_HEIGHT, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(out);
    const after = fs.statSync(out).size;
    const meta = await sharp(out).metadata();
    console.log(
      `${file} -> ${path.basename(out)}: ` +
      `${(before / 1048576).toFixed(2)}MB -> ${(after / 1024).toFixed(0)}KB ` +
      `(${meta.width}x${meta.height}, ${(100 - (after / before) * 100).toFixed(1)}% smaller)`
    );
  }
})().catch(err => { console.error(err); process.exit(1); });
