# Dirt Circuit — System Architecture

A modern remake of the 1989 arcade racer *Super Off-Road*: single-screen, eight trucks,
four laps, stadium dirt tracks, nitros, cash pickups, and a garage upgrade loop.

Working title. Everything here is shaped by `../LESSONS.md`; rule IDs are cited inline.

---

## 0. The five decisions everything else follows from

| # | Decision | Why | Lesson |
|---|---|---|---|
| 1 | **Custom fixed-step arcade physics.** No `BodyVelocity`, no `AlignOrientation`, no Roblox rigid-body solver on a truck. Trucks are `Anchored` and moved by `PivotTo`. | Roblox's solver gives you emergent physics you must then fight into arcade feel; it is the most expensive thing on the frame budget; and it makes trucks wedge in walls. A hand-written 2.5D integrator is ~40 lines of maths, is deterministic, and is *authorable*. | C-01, E-04 |
| 2 | **Server-authoritative, client-predicted, one shared sim module.** `VehicleSim` runs on both sides with identical inputs and constants. | Stellar Dominion's worst bug class was split authority. One module means client and server cannot disagree about the rules, only about timing — which is what reconciliation is for. | C-01, C-02 |
| 3 | **Public servers. No reserved servers, ever.** One place; lobby and race bays coexist in the same server. | Roblox *refuses friend-joins into reserved servers* before any game code runs. Stellar Dominion built a cross-server registry, a `LaunchData` invite round-trip and a JOIN FRIEND panel to work around it. We simply do not create the problem. | I-01 |
| 4 | **Tracks are data.** One `track.json` per track, generated externally, validated by a gate harness, previewed as SVG, and built into geometry at runtime by `TrackBuilder`. | Content that is expensive to review does not get reviewed. Geometry that is authored separately from its metadata drifts. | H-01, H-02, H-03 |
| 5 | **Flat-colour voxel art, no meshes, no textures, no uploads.** | It is the cheapest thing a Roblox client can draw, it is the requested art direction, and it removes an entire asset pipeline (and its per-asset cost) from the project. | H-04, E-04 |

---

## 1. Place & scene structure

One place. One server holds a lobby plus up to four concurrent race bays.

```
Workspace
├─ Lobby/                        static, built once at server start
│  ├─ Concourse/                 rectangular hall, Aegis-style: flat walls, warm uplights
│  ├─ BayDoors/                  Bay1..Bay4 — ProximityPrompt + a marquee board each
│  └─ GarageStalls/              per-player upgrade terminal props
├─ Arenas/                       one folder per ACTIVE race, destroyed on race end
│  └─ Arena_<bayId>/
│     ├─ Track/                  built by TrackBuilder from track.json
│     │  ├─ Surface/             packed dirt / mud polys, flat parts
│     │  ├─ Walls/               barrier + hay-bale parts (visual only — see §3.4)
│     │  ├─ Ramps/
│     │  └─ Decor/               crowd blocks, banners, floodlight posts
│     ├─ Trucks/                 8 Anchored truck models
│     ├─ Pickups/                pooled cash bags + nitro bottles
│     └─ CameraRig/              a single anchored Part; the camera CFrame is derived from it
└─ Terrain                       unused. Deleted at boot.
```

`Workspace.StreamingEnabled = false` (set in `default.project.json`). A single static
camera sees the whole track at all times, so streaming can only ever cost us pop-in.
Stellar Dominion's far overhead camera showed *only floating health bars on mobile*
because low graphics quality culls parts at a few hundred studs — a fixed close camera and
no streaming is the direct fix.

Bays are **not** reserved servers (decision 3). A bay is a folder plus a `RaceSession`
table. Players in a race and players in the lobby are in the same server, so a friend's
Join button works, and a spectator can walk up to the bay door and watch.

---

## 2. Module map

```
ReplicatedStorage.Shared
├─ Config/
│  ├─ GameConfig       tick rates, detail tiers, race format (8 trucks, 4 laps)
│  ├─ VehicleConfig    base stats + the five upgrade ladders + derived-stat maths
│  ├─ SurfaceConfig    per-surface grip/accel/topspeed/slip/roughness modifiers
│  ├─ EconomyConfig    payout table, upgrade prices, trophy award table
│  ├─ LeagueConfig     trophy thresholds -> league tiers
│  └─ LayoutConfig     ★ every HUD reserve constant, one table only (F-02)
├─ Net/Remotes         ★ declarative remote table + payload validators (D-01)
├─ Util/
│  ├─ Signal           tiny typed signal
│  ├─ ServiceLoop      pcall-wrapped named loops (C-04)
│  ├─ Logger           level-gated, off by default (C-09)
│  ├─ Guards           finite/NaN/range/shape validation (B-03)
│  └─ Schema           ★ declarative persistence: default+coerce+migrate (B-01)
└─ Sim/                ★ runs identically on client and server
   ├─ VehicleSim       the integrator. Sole writer of vehicle motion state (C-01)
   ├─ TrackModel       centreline/spline queries, surface lookup, checkpoints
   ├─ Collision        truck-truck and truck-wall resolution
   └─ RaceState        pure race bookkeeping: lap, checkpoint, position order

ServerScriptService.Server
├─ init.server         boot order, one place
└─ Services/
   ├─ DataService      schema-driven profiles (B-01, B-04)
   ├─ ProfileSchema    ★ the one table you edit to add a persisted field
   ├─ LiveConfig       remote kill-switches, 60s refresh (G-04)
   ├─ Analytics        funnel + economy events (G-05)
   ├─ ErrorReporter    ScriptContext.Error -> webhook, with PlaceVersion (G-06)
   ├─ PolicyService    paid-random gate, fails closed (G-03)
   ├─ MonetizationService  receipt dedup, per-entitlement pcall (G-01, G-02)
   ├─ TrackService     loads/validates track data, picks the next track
   ├─ RaceService      ★ RaceManager: session lifecycle for one bay
   ├─ AIDriverService  ★ bot drivers, one shared step for all bots
   ├─ PickupService    spawn/despawn/collect
   ├─ EconomyService   ★ EconomyManager: cash, upgrades, payouts
   ├─ LeagueService    trophies -> league placement
   ├─ LeaderboardService  daily/weekly/monthly/lifetime OrderedDataStores
   └─ LobbyService     bay doors, queueing, launch

StarterPlayer.StarterPlayerScripts.Client
├─ init.client         boot order
├─ ClientState         typed shared client state + signals (no _G — C-09)
└─ Controllers/
   ├─ InputController      keyboard / touch / gamepad -> one InputFrame
   ├─ VehicleController    local prediction + reconciliation + remote interpolation
   ├─ CameraController     static viewport, letterbox/pillarbox fit (§5)
   ├─ RaceHudController    position, lap, timer, nitro count
   ├─ GarageController     upgrade UI
   └─ DetailController     device tier -> which cosmetics exist at all (E-04)
```

**Boot order matters and is explicit** in `init.server.luau`. `DataService` before
anything that reads a profile; `PolicyService` before any store surface; `LiveConfig`
before the features it gates. Stellar Dominion's `PolicyService` had to be required "early
in MainGame, right after Analytics, so PlayerAdded classifies everyone before they reach
the store" — that ordering constraint is a comment there and a hard sequence here.

---

## 3. The simulation

### 3.1 Fixed timestep, always

```
ACCUM += dt
while ACCUM >= STEP do            -- STEP = 1/60
    VehicleSim.step(vehicle, input, track, STEP)
    ACCUM -= STEP
end
alpha = ACCUM / STEP              -- render interpolation factor
```

The same loop runs on the server (`Heartbeat`) and the client (`RenderStepped`). A phone
rendering at 30 fps runs two physics steps per frame and gets **bit-identical motion** to a
240 Hz desktop. Variable-dt physics would make handling device-dependent, which for a
racing game is a fairness bug, not a polish bug.

Guard rails: `MAX_STEPS_PER_FRAME = 5` so a hitch cannot spiral into a death loop.

### 3.2 State

A vehicle is a plain table, not an instance. Instances are *views*.

```
px, pz        planar position (studs)
heading       radians. forward = (-sin h, 0, -cos h)   -- Roblox CFrame.Angles(0,h,0)
vx, vz        planar velocity (studs/s)
height        studs above the track surface at (px,pz)
vy            vertical velocity
airborne      boolean
susp          suspension compression 0..1 (visual only)
nitroTimer    seconds of boost remaining
nitroCount    charges left
lap, cp       race progress
```

`heading`'s forward vector is written out because Stellar Dominion got it wrong and
documented the correction: for `CFrame.Angles(0, r, 0)`, `LookVector = (-sin r, 0, -cos r)`
and `RightVector = (cos r, 0, -sin r)`. Everything in `VehicleSim` uses that convention and
`TrackModel`, the AI and the camera all agree with it.

### 3.3 Per-step order

1. **Surface lookup** at `(px, pz)` -> grip / accel / topSpeed / slip / roughness.
2. **Airborne branch.** Steering input is ignored (spec §2), no drive force, gravity on
   `vy`, light air drag. Landing detection resolves suspension and the hard-landing speed
   penalty, both scaled by the *Shocks* stat.
3. **Grounded branch.**
   - Steer: `heading += steer * turnRate(speed, tires) * dt`. Turn rate *falls* with speed
     (arcade convention) and rises slightly while the truck is already sliding.
   - Decompose velocity into forward/lateral against the new heading.
   - Longitudinal: drive force, rolling drag, brake; clamp to `topSpeed` unless nitro.
   - Lateral: `vLat *= exp(-grip * dt)`. Exponential scrub — framerate-independent and
     unconditionally stable, unlike a subtractive friction term which overshoots into
     oscillation at low framerates.
   - Recompose.
4. **Nitro**: impulse on trigger, top-speed cap lifted for `NITRO_DURATION`.
5. **Integrate** position and height.
6. **Collision** (§3.4).
7. **Race progress**: checkpoint gate crossing, lap increment.

### 3.4 Collision — analytic, not rigid-body

The spec asks for elastic bounce and minor torque, and explicitly asks that *"vehicles
should not easily get wedged into track boundaries"*. A rigid-body solver wedges; an
analytic resolver cannot.

- **Truck vs truck**: circle–circle, radius `VehicleConfig.Radius`. On overlap, separate
  each by half the penetration along the normal, exchange the *normal* component of
  velocity with restitution, preserve tangential, and add a small heading impulse
  proportional to the tangential closing speed. That heading kick is the "trading paint"
  feel.
- **Truck vs wall**: the track's walls are polylines. Find the nearest segment within
  `Radius`, push out along its normal to exactly `Radius`, **reflect the normal velocity
  component and keep the tangential one**. Keeping tangential velocity is precisely what
  makes a truck slide along a wall instead of sticking to it.
- **Anti-wedge**: after resolution, if a truck is still penetrating two or more walls
  (an inside corner), push it toward the nearest centreline point instead. This is the
  escape hatch that a physics solver does not have.

Wall parts in `Workspace` are `CanCollide = false` **visuals**. The collision truth is the
polyline in `track.json`. One source of truth (C-01); no chance of the visual and the
collider drifting apart.

### 3.5 Networking

| Channel | Rate | Direction | Contents |
|---|---|---|---|
| `InputFrame` | 30 Hz | client -> server | `seq, steer, throttle, brake, nitro` |
| `RaceSnapshot` | 20 Hz | server -> clients | per truck: `px, pz, heading, height, vx, vz, flags`, plus `ackSeq` for the recipient |
| `RaceEvent` | on event | server -> clients | countdown, lap, finish, pickup collected, nitro fired |

- The client **predicts its own truck** by stepping `VehicleSim` locally with its own
  input, keeping the last ~1 s of `(seq, input, resultingState)`.
- On a snapshot, if the server's state for `ackSeq` differs from the client's stored
  prediction by more than `RECONCILE_EPSILON`, the client snaps to the server state and
  **replays** its unacknowledged inputs through `VehicleSim`. Because it is the same
  module, a replay is exact.
- Other trucks are **interpolated**, rendered ~100 ms in the past from a snapshot buffer.
  Never predicted — a mispredicted opponent that snaps is far worse than one that is
  slightly late.
- The server is the only thing that awards positions, laps, pickups and payouts. A client
  that lies about its input still gets simulated by the server's rules.

Bandwidth: 8 trucks x 7 numbers x 20 Hz. Snapshots are packed into a flat array of
numbers, not an array of tables — table-per-entity replication costs several times more
over the wire.

---

## 4. Race lifecycle (`RaceService`)

One `RaceSession` per bay. A strict state machine; every transition is logged.

```
IDLE ──(2+ entrants or 12s timer)──▶ GARAGE ──▶ GRID ──▶ COUNTDOWN
                                                              │
                                     ┌────────────────────────┘
                                     ▼
                                  RACING ──(all finished or timeout)──▶ PODIUM ──▶ IDLE
```

- **GARAGE** (30 s): upgrade + nitro purchase. Locked at exit; stats are snapshotted into
  the session so a mid-race purchase cannot change physics.
- **GRID**: `TrackService` picks the track (30-track pool, forward or reverse), builds the
  arena, seats up to 8 racers. Empty slots are filled by `AIDriverService` bots, so a solo
  player always races 7 bots. **Each grid placement is individually `pcall`-guarded** and
  the racer list is built from successful placements only — one bad placement must not
  strand the rest of the party (C-07).
- **COUNTDOWN**: 3-2-1-GO. Inputs are ignored; the sim runs so trucks settle on the grid.
- **RACING**: laps = `GameConfig.Laps` (4). A DNF timeout of `leaderFinishTime + 45 s`
  guarantees the session always terminates.
- **PODIUM** (12 s): payout, trophies, league update, leaderboard writes, then the arena
  folder is destroyed **by direct reference** — never by name-matching a workspace sweep
  (A-04).

### Race position

Progress is a single sortable scalar so ordering is O(n log n) with no special cases:

```
progress = lap * checkpointCount + cpIndex + fractionToNextCheckpoint
```

Checkpoint gates must be crossed **in order**; a truck that skips one does not advance its
`cpIndex`, which is what makes corner-cutting worthless without any anti-cheat heuristics.

---

## 5. Camera & viewport

A **fixed** camera. No follow, no scroll — this is the defining property of the original.

`CameraController` computes, once per track and again on any `ViewportSize` change:

1. Take the track's world-space AABB plus a margin.
2. Place the camera on a fixed isometric heading (default 55° pitch) at the distance where
   that AABB exactly fits the **vertical** FOV.
3. Compare the AABB's aspect to the viewport's aspect and take whichever axis binds:
   - viewport wider than the track -> pillarbox (bars left/right)
   - viewport narrower -> letterbox (bars top/bottom)
4. Bars are two `Frame`s on a `ScreenGui`, sized in `Scale`, in the *camera's* own
   ScreenGui so there is no cross-ScreenGui coordinate maths at all (F-03, F-04).

Ultrawide gets more empty stadium apron, never a cropped track — every truck is on screen
at every moment, which the game's readability depends on.

Tilt-shift is `DepthOfFieldEffect` on HIGH tier, and a pre-baked vignette `ImageLabel` on
POTATO. Same silhouette, zero GPU cost on the devices that need it (E-04).

---

## 6. Economy & progression

Two currencies, both server-authoritative:

- **Cash** — earned from finishing position and cash-bag pickups. Spent on the five
  upgrade ladders and pre-race nitros. Not purchasable with Robux.
- **Trophies** — awarded for podium finishes. Determines league. Never spent.

Monetization is **cosmetic only**: truck skins, horns, dust-trail colours, podium
emotes. Nothing that touches `VehicleConfig`. This is a design decision with a technical
dividend: cosmetic-only, non-random monetization means the paid-random policy gate (G-03)
can never bite, and there is no pay-to-win balance surface to defend.

**Leagues** (`LeagueConfig`): lifetime trophies place a player in Rookie -> Clubman ->
Pro -> Ironman. Grid seeding prefers same-league opponents; bots scale to the league.

**Leaderboards**: four `OrderedDataStore`s — daily, weekly, monthly, lifetime. Period keys
are derived from **epoch seconds**, never from a formatted date string (J-02), with the
period boundary computed in UTC.

---

## 7. Track pipeline

```
tools/trackgen/generate_track.py     procedural: closed loop, banking, surfaces, ramps
        │
        ├──▶ validate.py             numeric gates; a failing track is never written
        │
        ├──▶ tracks/<id>.json        ★ canonical
        ├──▶ tracks/<id>.svg         cheap review — open 30 images, not 30 Studio sessions
        └──▶ tracks/pack.rbxmx       all tracks as one importable ModuleScript folder
                    │
                    ▼
        TrackService (server) ──▶ TrackModel (shared queries) ──▶ TrackBuilder (geometry)
```

`track.json` is the only source of truth. The SVG, the Studio geometry and the collision
polylines are all derived from it, so they cannot disagree (H-03). See
`docs/TRACK_FORMAT.md` for the schema.

---

## 8. What is deliberately not here

Named so nobody re-litigates them:

- **No reserved servers** (I-01).
- **No Roblox physics constraints on vehicles** (decision 1).
- **No mesh/texture asset pipeline** (H-04).
- **No random paid items** (G-03).
- **No client authority over race outcome.** Clients own their *input* and their *view*.
- **No `_G`** (C-09).
