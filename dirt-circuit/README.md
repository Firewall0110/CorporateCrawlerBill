# Dirt Circuit

A modern remake of the 1989 arcade racer *Super Off-Road*, for Roblox.
Single fixed screen, eight trucks, four laps, stadium dirt, nitros, cash bags, and a
garage upgrade loop. Cosy minimalist voxel art. Working title.

This project is deliberately built on the post-mortem of a previous Roblox game.
**[`LESSONS.md`](LESSONS.md)** distils ~75 topic files (1.8 MB) from the Stellar Dominion
dev wiki into rules, and every rule names the file here that enforces it. Code comments
cite them by ID (`-- Lesson C-02`).

Start with **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

---

## The five decisions everything follows from

1. **Custom fixed-step arcade physics.** No `BodyVelocity`, no `AlignOrientation`, no
   Roblox rigid-body solver on a truck. One integrator is the sole writer of vehicle motion.
2. **Server-authoritative, client-predicted, one shared sim module.** The client predicts
   its own truck by calling the *same file* the server calls.
3. **Public servers. No reserved servers, ever.** Roblox refuses friend-joins into reserved
   servers before any game code runs; we never create the problem.
4. **Tracks are data.** Generated externally, gate-validated, previewed as SVG, built into
   geometry at runtime from one canonical JSON.
5. **Flat-colour voxel art. No meshes, no textures, no uploads.** The cheapest thing a
   Roblox client can draw, and it deletes an entire asset pipeline.

---

## Layout

```
LESSONS.md                  the codex — read this first
docs/SETUP.md               first-time Rojo setup — start here if you have not used it
docs/ARCHITECTURE.md        system design, module map, networking, race lifecycle
docs/TRACK_FORMAT.md        the track schema and its validation gates
docs/CHANGELOG.md

src/shared/Config/          all tuning: vehicle, surfaces, economy, leagues, HUD layout
src/shared/Sim/             VehicleSim, TrackModel, Collision — runs on BOTH sides
                            TrackBuilder, TruckBuilder — geometry, built from the same data
src/shared/Net/Remotes      every remote declared once, with its payload validator
src/shared/Util/            Schema, Guards, ServiceLoop, Signal, Logger
src/shared/Tracks/          30 generated tracks (Rojo serves .json as ModuleScripts)

src/server/Services/        DataService, RaceService, AIDriverService, TrackService, ProfileSchema
src/server/Dev/DevRace      one-liner: build a track, race eight bots, watch it
src/client/Controllers/     VehicleController (prediction), CameraController (fixed view)

tools/trackgen/             the external track generator + its gate harness
tools/simharness/           runs the REAL geometry code headlessly under Lune
tools/luau_check.py         fast structural check, runs without the Roblox toolchain
```

## Getting started

**New to Rojo? Read [`docs/SETUP.md`](docs/SETUP.md).** Short version: Rojo does not push
code into Studio — Studio *pulls* it from your disk. You run `rojo serve` locally and click
Connect in a Studio plugin.

```bash
# Toolchain (rojo, selene, stylua, lune) — pinned in rokit.toml
rokit install

# Generate the track pool. Writes src/shared/Tracks/ and SVG previews.
python3 tools/trackgen/generate.py --count 30

# Review every track as images, no Studio needed
open tools/trackgen/preview/index.html

# Sync into Studio
rojo serve
```

Checks:

```bash
python3 tools/luau_check.py src     # structural, no toolchain needed
selene src                          # real lint
stylua --check src                  # formatting
rojo build --output build.rbxl      # proves the project tree assembles
```

## Where to add things

| I want to… | Edit |
|---|---|
| Change how a truck handles | `src/shared/Config/VehicleConfig.luau` — data only, never `VehicleSim` |
| Retheme the game | `src/shared/Config/StyleConfig.luau` — every colour and size, one table |
| Add a surface type | `src/shared/Config/SurfaceConfig.luau` — one table entry, no code change |
| Add a persisted player field | `src/server/Services/ProfileSchema.luau` — **one line** |
| Add a remote | `src/shared/Net/Remotes.luau` — declaration + validator together |
| Change payouts or upgrade prices | `src/shared/Config/EconomyConfig.luau` |
| Move a HUD element | `src/shared/Config/LayoutConfig.luau` — never restate a constant elsewhere |
| Make bots harder | `AIDriverService.TUNING`, or the league's `botSkill` band |

## Status

Scaffold plus a complete core: simulation, collision, track model, AI, race lifecycle,
persistence, remotes, camera, and the track pipeline.

**Verified — the real toolchain has run, in CI and locally:**

- `selene` (roblox std): **0 errors, 0 warnings, 0 parse errors**.
- `stylua --check src`: clean.
- `rojo build`: the project tree assembles and every `$path` resolves.
- **The geometry code actually runs.** `tools/simharness` executes the real `TrackModel` and
  `TrackBuilder` under Lune against all 30 shipped tracks, forward *and* reversed: all build
  clean, mean 806 parts, worst 1125, inside a 1600-part budget.
- 24/24 files pass `tools/luau_check.py` (the checker was falsified against deliberately
  broken files, so a pass means something).
- 30/30 generated tracks pass all 12 gates; the gates were falsified against bad
  parameters to confirm they fire, and one candidate is rejected in a normal run.
- Race pacing checked numerically: 4-lap races land at 65–107 s on a stock truck and
  41–67 s maxed. The lap-length gate was tightened from the first pass because the
  original band produced two-minute races for new players.

The first green CI run also earned its keep: selene's "unused variable" warning on
`groundY` turned out to be the visible symptom of a real bug, where a truck jumping toward
rising ground flew through the hill and landed late by the elevation change. Fixed by
making `v.y` absolute and resolving height after the horizontal move.

**Still not verified:** the game has never been *run*. Nothing here has been played, no
Studio session has opened it, and no frame has been rendered. Static analysis says the code
is well-formed and the tree assembles; it says nothing about whether the trucks feel good,
whether the AI is beatable, or whether the camera frames a stadium sensibly. Expect the
first playtest to move a lot of numbers in `Config/` — which is where they all live,
precisely so that it can.

### Not yet written

- `LobbyService`, bay doors, the Aegis-style concourse.
- `InputController` — nothing reads keyboard, touch or gamepad yet, so you can watch the
  AI race but not drive.
- `PickupService`, `EconomyService`, `LeagueService`, `LeaderboardService`.
- `LiveConfig`, `Analytics`, `ErrorReporter`, `PolicyService`, `MonetizationService` —
  designed in `docs/ARCHITECTURE.md`, and the lessons that shape them are already written
  down; they are stubs-in-waiting, not open questions.
- The race HUD: lap counter, position tower, nitro readout.
- `tools/layout_audit.py` — the saved mobile-overlap harness (LESSONS.md J-04).
