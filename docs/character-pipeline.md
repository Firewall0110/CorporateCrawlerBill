# Character Pipeline

How playable characters get into the game, and how to add new ones.

## The 4-layer architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 1 - CharacterSpec (data only)                              │
│   { palette: {...}, features: { build, glasses, hat, ... } }     │
│   Defined in scripts/generate-bill.js as BILL_SPEC               │
│   In the future: derived from a user-uploaded photo              │
├──────────────────────────────────────────────────────────────────┤
│ LAYER 2 - Pose Library (shared across all characters)            │
│   POSES.walk(frameIdx)     → returns { armL, armR, legL, legR }  │
│   POSES.punch(frameIdx)    → same                                │
│   POSES.kick(frameIdx)     → same                                │
│   POSES.special(frameIdx)  → same                                │
│   POSES.ko(frameIdx)       → same                                │
│   POSES.jump(frameIdx)     → same                                │
│   Each pose value is a number (joint angle, bend, extend, bob).  │
│   Adding a new animation = just adding a new function here.      │
├──────────────────────────────────────────────────────────────────┤
│ LAYER 3 - Procedural Renderer                                    │
│   drawCharacter(cellX, cellY, pose, spec, opts)                  │
│   Body parts: drawHead, drawTorso, drawArm, drawLeg, drawFist,   │
│               drawBoot, drawBelt, drawDogTags                    │
│   Each part takes the spec's palette so colors flow through.     │
│   FX layer: punch sparks, kick wind, energy ball/burst, dust,    │
│             KO stars                                             │
├──────────────────────────────────────────────────────────────────┤
│ LAYER 4 - Generator                                              │
│   scripts/generate-bill.js                                       │
│   Iterates 7 rows × 8 frames, calls renderer for each cell,      │
│   writes the PNG sprite sheet.                                   │
└──────────────────────────────────────────────────────────────────┘
```

## How the runtime consumes it

```
public/sprites/BillSpriteSheet.png  ──► src/SpriteLoader.js
                                          │
                                          ├─ detects alpha → fast path
                                          ├─ slices 8×7 grid
                                          ├─ tight-bbox crops each frame
                                          └─ pickBillFrame(unit, now)
                                                │
                                                └─► drawBillSprite(ctx, ...) in App.jsx
```

## Adding a new character today (manual)

1. Open `scripts/generate-bill.js`
2. Copy the `BILL_SPEC` object and edit:
   - `palette.{skin, hair, shirt, pants, ...}` for colors
   - `features.{facialHair, glasses, hat, build}` for variants
3. Change the output filename at the bottom (`outPath`)
4. Run `npm run bill:gen` (or directly `node scripts/generate-bill.js`)
5. Reference the new PNG in your code

Example variant - "Brenda" with different colors:
```js
const BRENDA_SPEC = {
  ...BILL_SPEC,
  name: 'Brenda',
  palette: {
    ...BILL_SPEC.palette,
    skin: '#e8c2a0',
    hair: '#6a3a18',
    shirt: '#a83040',
    shirtShadow: '#7a1830',
    shirtLight: '#cc5060'
  }
};
```

That's the whole change. All 56 animations work automatically.

## Future: character creator (photo → playable character)

The architecture is designed so this is mostly a data-transformation step:

```
User photo ─► extractDominantColors() ─► CharacterSpec
                                              │
                                              └─► generator → PNG
                                                              │
                                                              └─► game
```

### Implementation plan

1. **UI** - photo upload + preview canvas + adjustable color swatches
2. **Color extraction** (browser-side):
   - Use face-detection lib (e.g. face-api.js) to find face region → sample skin tone
   - Sample hair pixels above forehead → hair color
   - Sample chest region below face → shirt main color
   - Sample lower body → pants color
3. **Spec assembly** - fill in `palette` from samples; let user fine-tune via swatches
4. **Feature inference** (optional/manual at first):
   - Detect glasses (face landmarks)
   - Manual toggles for hat, mustache, build
5. **Run generator in browser** - need to port `generate-bill.js` to a browser-runnable
   module (replace `@napi-rs/canvas` with `document.createElement('canvas')`)
6. **Upload PNG** - either save server-side per-account, or just hold in IndexedDB
7. **Per-player sprite override** - server tags each player with their character id,
   client loads matching sprite sheet

### Easier first version: pre-made character roster

Before the full upload tool, ship a roster of 6-12 hand-authored specs:
- Bill (current, green flannel)
- "Brenda" (red shirt, brown hair)
- "Bob" (blue uniform, bald)
- "Beth" (purple jacket, blonde)
- etc.

Player picks from a roster on the menu screen, server stores their pick.
This validates the pipeline before tackling photo upload.

## Tuning animations

Each frame is just numbers in `POSES.{anim}(frameIdx)`. To make a punch
feel snappier, tweak the angle/bend/extend values. The renderer just
draws what you tell it.

Common tuning knobs:
- `bob` - vertical offset (negative = up); use for crouch / weight shift
- `armPose.angle` - rotation from straight-down (positive = forward)
- `armPose.bend` - elbow bend (0 = straight)
- `armPose.extend` - length multiplier (1.2 = stretched)
- `armPose.fist` - `'rest'`, `'closed'`, `'open'`, `'punch'`
- `lean` - torso tilt
- `fx` - on-screen effect overlay (`punchSpark`, `kickWind`, `energyBall`,
   `energyBurst`, `jumpDust`, `koStars`)

## Regeneration commands

```bash
npm run bill:gen           # regenerate Bill's sprite sheet
npm run boss:gen           # regenerate boss (Broadcast Storm)
npm run boss-death:gen     # regenerate boss death cinematic
npm run tickets:gen        # regenerate ticket-monster enemies
npm run stages:gen         # regenerate 4 stage backgrounds
npm run stage:gen          # regenerate legacy single stage.png
```

All scripts use `npm install --no-save @napi-rs/canvas` so the dev
dependency doesn't leak into the production `package-lock.json` and
break Railway's `npm ci`.
