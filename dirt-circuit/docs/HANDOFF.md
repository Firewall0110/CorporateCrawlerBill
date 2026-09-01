# Handoff — cloud session to local session

**Written 2026-09-01 by the remote session that created this project.**
Read §0 first; it discharges most of the rest.

---

## §0 Status

| | |
|---|---|
| Branch | `claude/roblox-game-dominion-lessons-dvefh2` |
| Head | `49c28d0` |
| PR | [#34](https://github.com/Firewall0110/CorporateCrawlerBill/pull/34) — **open, draft, green, mergeable, no review threads** |
| CI | both checks passing, including the Lune geometry audit |
| Luau files | 29, all lint- and format-clean |
| Tracks | 30, all passing 12 gates |

**Nothing is broken and nothing is half-finished.** Every commit on this branch is green.
There is no in-flight work to pick up, no failing test to chase, and no merge conflict.

**The one thing that matters most: nobody has ever played this.** Every claim in the repo is
backed by static analysis or by headless execution. Not one frame has been rendered, and no
human thumb has touched a truck. That is the single biggest gap, and it is the first thing a
local session can close that a cloud one could not.

---

## §1 What the local session can do that the cloud session could not

This is why the handoff is worth doing:

1. **Open Studio and press Play.** Everything below flows from this.
2. **Run `DevRace` and watch it.** See `docs/SETUP.md`. Does a truck look right? Does the AI
   drive a plausible line, or does it saw at the wheel? Does the camera frame the stadium?
3. **Drive.** Once `InputController` exists — nothing reads input yet.
4. **Generate a real Roblox std for selene.** `selene generate-roblox-std` could not reach
   the API dump from the sandbox, so local runs there used a filtered fallback
   (`tools/selene_local.sh`). On a real machine, just run the real thing and delete the
   workaround from your habits — CI has always used the authoritative std.
5. **Measure part-build time on real hardware.** The headless audit reports 13–42 ms per
   track on a fast server CPU. On a phone that is plausibly 3–5×. `DevRace.auditAllTracks()`
   gives real numbers in Studio.

---

## §2 Do these three things first

In this order. Each is cheap and each could invalidate work below it.

### 1. Watch a race and write down what looks wrong

```lua
require(game.ServerScriptService.Server.Dev.DevRace).start()
```

Specific things to judge, because they are the ones nobody has checked:

* **Trucks visibly on the ground?** `TruckBuilder.apply` places the chassis at
  `groundY + height + RestHeight + bodySize.Y/2`. That stack has never been eyeballed; if
  trucks hover or sink, `VehicleConfig.RestHeight` is the dial.
* **Does the AI weave?** `AIDriverService.TUNING.steerNoiseAmplitude` and `laneAmplitude` are
  guesses. If bots look drunk, halve both.
* **Do bots brake for hairpins?** `cornerGrip` converts the grip stat into a lateral-accel
  budget and is the single most influential AI number. If they understeer into walls, lower
  it; if they crawl, raise it.
* **Is the camera framing sane?** `GameConfig.Camera.PitchDegrees` (55) and `FitMargin`.
* **Ramps.** Do trucks launch, or bounce off a staircase? `StyleConfig.Track.rampSteps` /
  `rampStepHeight` control the shape; `track.json`'s `launch` controls the impulse.

### 2. Confirm the trucks do not fall through or wedge

The collision resolver has never met a real track at speed. Watch for a truck getting stuck
in an inside corner. If it happens, `VehicleConfig.Collision.wedgeEscapeSpeed` and
`wedgePenetrationTolerance` exist precisely for this, and `Collision.resolveWalls` has a
documented escape path.

### 3. Then build `InputController`

Nothing reads keyboard, touch or gamepad. Until it exists this is a tech demo, not a game.
`VehicleSim.Input` is the contract: `{ steer, throttle, brake, nitro }`, produced at
`GameConfig.InputSendHz` and written into `ClientState.input`. `VehicleController` already
consumes it and handles prediction and reconciliation.

Mobile is the binding constraint and the numbers are already in `LayoutConfig` — do not
restate them anywhere (LESSONS.md F-02).

---

## §3 Invariants — breaking one is a design change, not a fix

These are in `CLAUDE.md` too, but they are the things most likely to be casually broken by a
session that can now touch Studio directly:

1. **`VehicleSim` is the only writer of vehicle motion.** No `BodyVelocity`, no
   `AlignOrientation`, no constraint, no second loop.
2. **Client and server call the same sim module.** Never fork it "just for the client".
3. **Physics is a fixed 60 Hz step.** Never pass a frame delta to `VehicleSim.step`.
4. **No reserved servers.**
5. **A persisted field is one line in `ProfileSchema`.** If you are editing persistence in
   two places, the abstraction has broken and *that* is the bug.
6. **Monetization is cosmetic and non-random.** Nothing sold may touch `VehicleConfig`.

### ⚠️ And the one this handoff specifically endangers

You may now have a Roblox Studio MCP. **Do not let game code live in Studio.** That is
`LESSONS.md` A-01 — the single most expensive lesson from Stellar Dominion, where the live
Edit session became the source of truth and the repo rotted into "stale scaffold": no diffs,
no review, no rollback, no CI, and an edit history that existed only as prose in memory
files.

Studio MCP is genuinely useful here for things that are **not code**:

* eyeballing a build, taking screenshots (Edit mode only — it is unreliable in Play)
* nudging set dressing
* building the lobby concourse by hand

Code flows through Rojo. If a change is not in git, it does not exist.

---

## §4 What exists

```
LESSONS.md                  50 ID'd rules from the Stellar Dominion post-mortem
docs/ARCHITECTURE.md        the design, and the five decisions everything follows from
docs/SETUP.md               Rojo setup + how to run DevRace
docs/TRACK_FORMAT.md        the track schema and its 12 gates
docs/CHANGELOG.md

src/shared/Sim/             VehicleSim, Collision, TrackModel, TrackBuilder, TruckBuilder
src/shared/Config/          Vehicle, Surface, Style, Economy, League, Layout, Game
src/shared/Net/Remotes      declarative, validated, rate-limited
src/shared/Util/            Schema, Guards, ServiceLoop, Signal, Logger
src/shared/Tracks/          30 tracks as .json (Rojo serves them as ModuleScripts)

src/server/Services/        DataService, RaceService, AIDriverService, TrackService
src/server/Dev/DevRace      build a track, race eight bots, watch it
src/client/Controllers/     VehicleController (prediction), CameraController (fixed view)

tools/trackgen/             the external generator + gate harness + SVG previews
tools/simharness/           runs the REAL geometry code headlessly under Lune
tools/luau_check.py         structural check, no toolchain needed
tools/selene_local.sh       selene when the API dump is unreachable
```

## §5 What does not exist

In rough priority order:

1. **`InputController`** — no input is read at all.
2. **Race HUD** — no lap counter, position tower, or nitro readout.
3. **`LobbyService`** + the concourse and bay doors — `DevRace` is the stand-in.
4. **`PickupService`** — cash bags and nitro bottles never spawn.
5. **`EconomyService`, `LeagueService`, `LeaderboardService`** — the config exists
   (`EconomyConfig`, `LeagueConfig`), the services do not. `RaceService.payout` already
   writes cash and trophies through `DataService`.
6. **Launch hardening** — `LiveConfig`, `Analytics`, `ErrorReporter`, `PolicyService`,
   `MonetizationService`. All designed in ARCHITECTURE §2, all with their governing lessons
   already written down (G-01 … G-06).
7. **`tools/layout_audit.py`** — the saved mobile-overlap harness (J-04).

---

## §6 Open decisions for the author

**Lap count vs. lap length.** The spec fixes 4 laps, so lap length *is* race length, which is
why the generator's length gate (1000–1900 studs) is doing the pacing work. If you want
longer or more varied circuits, the cleaner lever is making lap count track-dependent:
`clamp(round(targetDistance / lapLength), 3, 6)`. Raised on the PR, unanswered.

**The lobby: hand-built or generated?** A rectangular concourse is a one-off and hand-building
it in Studio is the sensible call — Rojo will not touch `Workspace`. But then it lives only in
the `.rbxl`, which is not in git. Either commit the place file or decide deliberately that the
lobby is Studio-side state. That tension is A-01 again; decide it on purpose rather than by
drift.

---

## §7 Things I could not verify, stated plainly

So nobody re-derives them as facts:

* **Nothing has been played.** No frame rendered, no input tested, no feel assessed.
* **`rojo serve` has never run** against this — only `rojo build`. The tree assembles;
  live sync is untested.
* **DataStore paths are untested.** `DataService` needs *Enable Studio Access to API
  Services*, and its writes are gated off Studio by design, so the real save/load round trip
  has never happened. Expect to test it in a published place.
* **The client/server split has never been exercised.** `VehicleController`'s prediction and
  reconciliation have never run against a real `RaceService` snapshot — `DevRace` drives
  models directly on the server and bypasses that path entirely. **This is the largest
  untested surface in the project.**
* **Truck-vs-truck collision has never resolved with eight real trucks at speed** — only in
  the headless geometry audit, which does not run the sim.

---

## §8 How the previous session worked, if it helps

Every non-trivial claim in this repo was checked by running something, and the checks
themselves were falsified against known-bad inputs before being trusted — the structural
checker against broken files, the track gates against bad parameters, the CI toolchain guard
against a missing toolchain. That discipline is `LESSONS.md` J-01 and it caught three real
bugs that no linter found.

It also failed once, and the failure is instructive: a local selene run was narrowed to the
rule names I cared about, which silenced `undefined_variable` entirely, and a real bug
reached CI. **A check narrowed until it cannot fail is not a check.** That is why
`tools/selene_local.sh` filters the other way round.
