# Track format

`track.json` is the **canonical** description of a circuit. Everything else is derived:

| Consumer | Derives |
|---|---|
| `TrackModel` (shared) | collision polylines, surface grid, checkpoint gates, AI racing line |
| `TrackBuilder` (client/server) | the parts you actually see in the stadium |
| `tools/trackgen/export.py` | the SVG review preview |

Geometry is never exported as geometry. That is the point (LESSONS.md H-03): a visual
barrier and its collider cannot drift apart if only one of them is authored.

## Getting a track into the game

Generated tracks are written to `src/shared/Tracks/`. Rojo turns a plain `.json` file into
a `ModuleScript` that returns the decoded table, so the game reads a track with **zero
runtime parsing** and track data lives in git next to the code that consumes it.

```bash
python3 tools/trackgen/generate.py --count 30
rojo serve            # tracks appear under ReplicatedStorage.Shared.Tracks
```

For anyone not running Rojo, `--rbxmx` also writes `tools/trackgen/preview/pack.rbxmx`: a
Folder of `StringValue`s to drag into `ReplicatedStorage`, decoded with
`HttpService:JSONDecode`.

## Coordinate conventions

* The track lies on the **XZ** plane. **Y is up.**
* A heading `h` corresponds to `CFrame.Angles(0, h, 0)`, whose
  `LookVector = (-sin h, 0, -cos h)` and `RightVector = (cos h, 0, -sin h)`.
* "Right" of the racing direction is the normal `(-tz, tx)` of the unit tangent `(tx, tz)`.
* All distances are **studs**.

Stellar Dominion got the heading convention backwards once and had to write the correction
down as a memory note. It is restated in `VehicleSim`, `TrackModel` and here, because three
independent systems depend on agreeing about it.

## Schema

```jsonc
{
  "id": "stadium_07",           // stable; used as the DataStore key for best laps
  "name": "Boulder Run",        // player-facing, unique across the pool
  "schemaVersion": 1,
  "seed": 1837462911,           // reproduces this exact track from the generator
  "nodeSpacing": 8.0,           // studs between centreline nodes — MUST be uniform
  "lapLength": 1128.0,

  "bounds": { "minX": …, "maxX": …, "minZ": …, "maxZ": … },   // includes decor apron

  "centerline": [[x, z], …],    // CLOSED loop, uniformly resampled, counter-clockwise
  "halfWidth":  [w, …],         // one per centreline node
  "elevation":  [y, …],         // one per centreline node

  "walls": {
    "inner": [[x, z], …],       // closed polyline — the collision truth
    "outer": [[x, z], …]
  },

  "checkpoints": [              // ordered; index 0 is start/finish
    { "node": 0, "a": [x, z], "b": [x, z] }
  ],

  "surfaces": [                 // painted in order; later entries win in an overlap
    { "type": "mud" | "puddle" | "rumble" | "tarmac", "poly": [[x, z], …] }
  ],

  "ramps": [
    { "a": [x, z], "b": [x, z], "launch": 34.0, "width": 18.0 }
  ],

  "pickupNodes": [[x, z], …],   // valid spawn points for cash bags and nitro bottles
  "grid": [[x, z, heading], …]  // 8 starting slots, pole first
}
```

### Why `nodeSpacing` must be uniform

`TrackModel` treats "N studs further along the track" as integer index arithmetic
(`nodeAhead`), which is what makes the AI's corner scan — `maxCurvatureAhead`, run for
eight bots at 60 Hz — essentially free. A non-uniform centreline would turn every one of
those into a walk. The generator resamples by arc length for exactly this reason, and
`validate.py` is where a hand-edited track that breaks the invariant should be caught.

### Reverse racing

Reverse is not a second dataset. `TrackModel.fromData(data, true)` flips the node arrays
at load, which doubles the effective track pool for free and guarantees the two directions
can never disagree about the geometry.

## Gates

`tools/trackgen/validate.py` refuses to write a track that fails any of these. A generated
candidate that fails is discarded and a new seed is tried.

| Gate | Checks |
|---|---|
| G1 | at least 32 centreline nodes |
| G2 | every centreline / width / elevation value is finite |
| G3 | lap length in `[1000, 1900]` studs — this **is** the race-length control, since laps are fixed at 4 |
| G4 | tightest corner radius ≥ 20 studs |
| G5 | centreline does not self-intersect |
| G6 | **inner wall** does not self-intersect (the real risk: offsetting inward pinches on a tight corner) |
| G7 | minimum half-width ≥ 14 studs |
| G8 | ≥ 8 checkpoints, strictly ascending by node, none degenerate |
| G9 | every grid slot is on the trackbed with truck clearance |
| G10 | ramps sit on straights, not corners |
| G11 | no grid slot overlaps the start gate |
| G12 | no two grid slots overlap each other |

The generator's radial construction (`r(θ)` as a positive sum of low-frequency sinusoids)
makes the centreline **star-shaped**, and a star-shaped polygon cannot self-intersect — so
G5 can never fail from the generator. It is checked anyway. A guarantee you never test is a
belief (LESSONS.md J-01), and the gates were deliberately falsified against bad parameters
during development to prove they fire.

## Adding a hand-authored track

1. Write the JSON into `src/shared/Tracks/`.
2. Run the gates against it: `python3 tools/trackgen/validate_file.py <path>` *(not yet
   written — currently the gates run only inside the generator; this is the first
   follow-up).*
3. Check the SVG preview.
