# Lessons carried over from Stellar Dominion

Distilled from the Stellar Dominion dev wiki (`Firewall0110/StellarDominion-wiki`,
`dev/docs/memory/` — ~75 topic files, 1.8 MB) plus its `principles.md`.

Every rule below cost real time, real money, or real player-facing breakage on that
project. This file is not a retrospective — it is the **spec for how Dirt Circuit is
built**, and each entry names the file or mechanism in this repo that enforces it.

Rules are ID'd so code comments and PRs can cite them (`-- Lesson C-02`).

---

## A. Source of truth & process

### A-01 · The repo is the game. Not Studio. ★ the expensive one
Stellar Dominion's `principles.md` opens with a danger admonition: *"The GAME lives in
the LIVE Roblox Studio Edit session… the game repo's `src/` folder is STALE scaffold —
ignore it, never edit it, never trust it."* Everything downstream got worse because of
this: no diffs, no blame, no review, no rollback, no CI, and an edit history that only
existed as prose in memory files.

**Dirt Circuit:** all game code is Luau in `src/`, synced to Studio by Rojo. Studio is a
*renderer and a level editor*, never a source of truth. If a change is not in git, it
does not exist.

### A-02 · Anything a tool generates, the tool goes in git too
A `Write` to an existing path destroyed `gen_genesmith_rangerschool.py` — **195 KB,
2,851 lines**, the generator behind a shipped facility. `tools/` was untracked by choice.
Python 3.14 has no working decompiler, so the source is permanently gone.

**Dirt Circuit:** `tools/` is tracked. The track generator is a first-class,
version-controlled part of the build, not a scratch script.

### A-03 · A `Write` to an existing path is a delete
`Write` reports success either way and there is no undo. Checking whether the file
exists is not enough — you must *keep* what was there.

**Rule:** before writing any path you did not create this session, copy it first. Use
edits for partial changes.

### A-04 · Never pattern-match a generic word in a destructive sweep
`n:find("Preview")` destroyed `TurretRangePreview`, a live shipped LocalScript.
`c.Name:match("^ZZ")` ate an owner's backup folder that had already been inspected and
spared twice. `Destroy()` from a script creates no undo waypoint.

**Rule:** list first, delete second — two passes, never destroy inside the loop that
discovers. Delete by direct reference to the instance you created, or by `==` against a
literal name. Cleaning up your own scratch is exactly when you know the exact names.

### A-05 · "It hasn't broken yet" is not evidence a destructive pattern is safe
The loose sweep worked ~15 times before it took something real. That is not a safety
record; it is an unhit blast radius.

### A-06 · Write the player-facing changelog as part of the change, not after
Stellar Dominion shipped builds v3582+ unannounced with an unfolded `NEXT_unreleased.md`
because notes were a separate step that fell behind.

**Dirt Circuit:** `docs/CHANGELOG.md` gets its entry in the same commit as the change.

---

## B. Persistence

### B-01 · A persisted field must never need N wiring points ★ the schema rule
Stellar Dominion's `DataService` required **four** edits to add one field (`makeDefault`,
`normalizeMeta`, `saveData` SetAsync payload, `onPlayerAdded` load). Miss one and the
field silently does not persist. `bestNight` shipped with two of four — it updated
in-session and reset on rejoin. Then attribute-backed prefs turned out to need **three**
different lists (`Prefs.ATTR_KEYS`, `PrefsService.CLIENT_KEYS`, `DataService.PREF_SPEC`),
and `LobbyMusicOff`/`LobbyMusicVol` shipped missing the third. A second agent
independently hit the identical bug on `SimpleRollReport`.

**Dirt Circuit:** `src/shared/Util/Schema.luau` + `src/server/Services/ProfileSchema.luau`.
Adding a persisted field is **one line in one table**. Defaults, migration of old blobs,
validation, clamping, the save payload and the load path are all *derived* from that
declaration. There is no second list to forget.

**Diagnostic signature to remember:** *"works in-session, resets on rejoin"* = the field
is missing from save and/or load.

### B-02 · Any client-supplied table that reaches `SetAsync` must be rebuilt from validated primitives
A crafted loadout payload could smuggle a `Vector3` or a string key into a numeric slot.
That made **every** future `SetAsync` for the account throw — silently — killing all
saves for that player forever.

**Dirt Circuit:** `Schema.coerce()` rebuilds every persisted value from primitives.
Unknown keys are dropped on both load *and* save.

### B-03 · `NaN` passes every guard you would think to write
`0/0` satisfies `type(x) == "number"`, survives `math.clamp`, and makes every comparison
false — so it slipped through distance gates and difficulty scaling, poisoning reward
maths and building structures at NaN positions.

**Dirt Circuit:** `Guards.finite(x)` uses `x == x and x ~= math.huge and x ~= -math.huge`.
Every remote numeric goes through it. This matters doubly here: a NaN in the vehicle
integrator would corrupt a truck's position irrecoverably and replicate to everyone.

### B-04 · A save that can fail silently will
`saveData` was a bare `pcall` that discarded its result, so `SetAsync` failures were
invisible. A Robux grant that could not persist was falsely acked.

**Dirt Circuit:** `DataService.save()` returns `ok: boolean` and every save-critical
caller checks it. Purchase receipts return `NotProcessedYet` on a genuine persist failure
so the platform retries instead of the player losing the item.

### B-05 · Never infer "the player chose this" from a persisted value a startup path also writes
Stellar Dominion's skybox chooser **never appeared for any player, ever, since it
shipped** — `applySkybox()` wrote the pref unconditionally at join with the default, so
the first-run gate `pref == nil` was already false before onboarding ran. Unreachable by
construction, for everyone.

**Rule:** an explicit player choice and a default written at load must be
distinguishable. Persist only on an explicit pick, or store a separate `chosen` flag.

### B-06 · Grant idempotency is a decision, not a default
`grantItem` was idempotent (no-op if you already owned one), so buying a duplicate with
premium currency **charged and granted nothing**.

**Dirt Circuit:** `EconomyService` separates `grantUnique()` from `addCount()` at the API
level, so the call site has to state which it means.

---

## C. Architecture & authority

### C-01 · One writer per property. Always. ★
This is the single most repeated root cause in the entire Stellar Dominion corpus:

- Ship rotation was integrated **server-side** while translation was **client-side** →
  the ship's travel direction stepped and wobbled at speed, error ∝ `speed·sin(Δheading)`.
- A leftover `BodyGyro` fought the CFrame drive → orientation oscillated and settled at an
  offset. The one-shot neutraliser had silently missed because `PrimaryPart` wasn't ready.
- `UIScaler` derived scale from a size that was itself computed from that scale →
  runaway feedback, element rendered razor-thin.
- `renderCaption` wrote `capBox.Size` on every cue, stomping the layout function →
  "caption overlaps everything on mobile".
- Two `continuousVelocityReapplication` loops fought each other.

**Dirt Circuit:** the vehicle integrator in `src/shared/Sim/VehicleSim.luau` is the **only**
writer of vehicle position, heading and velocity. No `BodyVelocity`, no `BodyGyro`, no
`AlignOrientation`, no Roblox rigid-body solver anywhere near a truck. Trucks are
`Anchored` models moved by `PivotTo` from one integrator. See `docs/ARCHITECTURE.md` §3.

### C-02 · Server-authoritative, client-predicted — with *one* simulation module
Stellar Dominion ended up client-authoritative on CFrame because split authority
stuttered, and then had to bolt on a `MovementGuard` to catch speed-hackers.

**Dirt Circuit:** the server simulates all eight trucks. The client predicts *its own*
truck by calling the **exact same module** with the same fixed timestep, and reconciles
against server snapshots. One code path, one set of tuning constants, no divergence class
of bug, and validation is free because the server already ran the truth.

### C-03 · A shared stepper, never a connection per entity
Per-missile `Heartbeat` connections were replaced by one shared `stepMissiles` loop.
Per-hit floating-damage GUIs (one `BillboardGui` + one connection each) were replaced by a
pooled set with one stepper.

**Dirt Circuit:** one physics step for all vehicles, one for all pickups, one for all AI.

### C-04 · Wrap every long-lived loop so one bad tick cannot kill the service
A single `attempt to index nil` inside a top-level `while true` loop **silently ended the
loop**, stopping a whole service for the rest of the match. It happened to `TurretService`
and `WaveService` independently.

**Dirt Circuit:** `src/shared/Util/ServiceLoop.luau`. Every tick is `pcall`-wrapped and a
failure warns with the loop's name instead of ending it.

### C-05 · Capture state *before* the call that can destroy it
Fixed three separate times in Stellar Dominion: damage a target, then read
`target.PrimaryPart.Position` — but a lethal hit destroyed the target on that same frame.

**Dirt Circuit:** collision resolution reads all positions into locals at the top of the
step, then writes. Applies to any "damage then read" or "despawn then read" path.

### C-06 · `pcall` does not protect the expression that builds its arguments
`pcall(PDM().getPlayerShip, player)` — `PDM()` runs **outside** the pcall. It threw while
evaluating the argument list, escaped the guard that looked like it covered it, and
vanished with no log. Every training beat that read the player's ship died silently on
entry, for months.

**Rule:** `pcall(function() return PDM().getPlayerShip(player) end)`. And a bare `pcall`
around a lifecycle handler **must warn on failure** — the warn added here caught the bug
on the first run.

### C-07 · Per-player loops need per-player `pcall`
One player's spawn crash aborted the whole deploy loop, so the first players got ships and
everyone after was stranded in the lobby — the classic "works solo, breaks in a party"
multiplayer symptom.

**Dirt Circuit:** `RaceService` guards each grid placement individually, builds its racer
list from successful placements only, and returns failures to the lobby.

### C-08 · Kill the god-object before it crosses 200,000 characters
Roblox refuses any `.Source` **assignment** >= 200,000 chars — but a script can already be
over it, run perfectly, and be **permanently uneditable** by tooling. `DataService` hit
235,178 chars. The only write it would accept was one that shrank it.

**Dirt Circuit:** Rojo files on disk have no such ceiling, which removes the trap
entirely — but the underlying discipline (one service, one concern) still applies.

### C-09 · No `_G`
Stellar Dominion replaced `_G.AerialCameraActive`, `_G.requestShipCameraSwitch`,
`_G.forceStoreOpen` and friends — plus a `while true do task.wait(0.1)` poller watching
them — with a typed state module and signals.

**Dirt Circuit:** `ClientState` + `Signal` from day one. `selene.toml` sets
`global_usage = "deny"` so this cannot regress quietly.

---

## D. Runtime safety & remotes

### D-01 · Every remote is a trust boundary
Validate shape, type, finiteness and range on arrival; clamp; rebuild from primitives.
Stellar Dominion needed retrofits for NaN difficulty scaling, NaN build placement, a
crafted teleport-target name that reached any lobby descendant, and an uncapped prestige
exploit.

**Dirt Circuit:** `src/shared/Net/Remotes.luau` declares every remote in one table with
its payload validator. Handlers receive already-validated data.

### D-02 · Prefer an allowlist — and audit the legitimate off-convention names first
A teleport target blocklist was replaced with an allowlist matching `DeckTarget$`, which
promptly broke the basement lift because its legitimate target was named
`BasementTarget`.

### D-03 · Rate-limit and cap every player-authored string
`FeedbackService`: 600-char cap, trim, 15s per-player rate limit, persisted before it is
forwarded anywhere.

---

## E. Performance — the "weakest devices" budget

### E-01 · Snapshot shared work once per tick, don't rescan per entity
`TargetingTemplate.gatherTargets` ran `workspace:GetDescendants()` **per weapon per
frame**. 23 turrets each re-scanned all players and 84 mobs, every tick. Both were fixed
by building one candidate snapshot per tick and filtering it.

**Dirt Circuit:** one spatial snapshot per physics step, shared by collision, AI targeting
and pickup proximity.

### E-02 · Cache immutable per-entity data at first sight
`MobAI`'s 60 Hz loop re-read ~5 attributes plus a stats lookup plus an `IsA` per drone
*every frame*. Attribute reads are not free.

### E-03 · Pool anything you create per-event
Floating damage numbers, tracers, and the steering arc all went from
create-and-destroy-per-frame to fixed pools with a shared reclaim stepper.

**Dirt Circuit:** dust/roost particles, tyre marks, nitro flames and the position HUD rows
are all pooled.

### E-04 · Gate cosmetics behind a device tier, and default it low
`GraphicsConfig.highDetail()` gated transient `PointLight`s (the dominant mobile-GPU win),
beam impact sparks, and shadow casting. The default tier was POTATO.

**Dirt Circuit:** `GameConfig.DetailTier` with a `POTATO` default. Tilt-shift is a real
`DepthOfFieldEffect` on HIGH and a **static vignette overlay** — which costs nothing — on
POTATO. Same look, no GPU bill.

### E-05 · A looped `Sound` holds a mixer voice even when it is inaudible
Roughly 84 drone engine hums were audible to nobody and still cost. Fixed by humming
every 3rd drone and distance-culling one-shots against the camera.

**Dirt Circuit:** engine loops only for trucks within earshot of the fixed camera; there
are at most 8, but the rule shapes the audio design.

### E-06 · Throttle what does not need 60 Hz — but never the thing that needs it
A 30 Hz aim throttle on missiles doubled the straight coast between corrections, so fast
missiles overshot and whipped 180 degrees to re-acquire. Reverted to per-frame aiming; the
real win (one shared connection) was untouched.

**Dirt Circuit:** physics is 60 Hz fixed and never throttled. Replication is 20 Hz. HUD
text is 10 Hz. Know which is which.

---

## F. Mobile & UI — *mobile was >60% of Stellar Dominion's players*

### F-01 · The binding constraint is landscape **height**, ~360-430 px
Not width. A fixed-px 260 px virtual joystick was **68-82% of the screen height**. Every
"nothing fits at the bottom" symptom downstream traced back to it.

### F-02 · Every layout reserve constant lives in exactly one table
`ClientState.LAYOUT`. Restating a constant in a second file is a bug by construction.

**Dirt Circuit:** `src/shared/Config/LayoutConfig.luau`.

### F-03 · `AbsolutePosition` is GuiInset-relative; `ViewportSize` is physical
Mixing them is wrong by exactly one topbar inset (~58 px live, **0 in Studio**), so the
bug is structurally invisible until it reaches a device. Three fixes failed before the
cause was found. Fix: same-space maths — subtract the target ScreenGui's own
`AbsolutePosition` and use its `AbsoluteSize`.

### F-04 · …and the same-space subtraction cancels the inset but **not** the `UIScale`
`AbsolutePosition` is post-scale, so feeding that difference into a child offset scales it
a *second* time. Exact only at the 1280x720 authoring baseline — **-156 px on a landscape
phone**. It shipped and survived because the tooltip was hover-only and phones cannot
hover. *Adding a tap path to a hover tooltip re-exposes every latent scale bug in it.*

**Best fix:** parent the floater inside the anchor's own scaled space and position it in
pure `UDim2`, so there is no cross-space maths to get wrong.

### F-05 · Never scale a bottom-anchored position offset
`UDim2.new(0.5, 0, 1, -120)` measures upward from the bottom. Doubling it to `-240` does
not enlarge the element — it lifts it toward mid-screen. Scale sizes and fonts; leave
edge-anchored offsets alone.

### F-06 · `UIStroke` draws *outside* the element's bounds
So a full-width row's stroke lands past its list's edge. Invisible until someone adds
`ClipsDescendants`, which turns the spill into a visibly shaved border. Reserve the space:
inset the child or pad the parent by >= the stroke thickness.

### F-07 · A `UIGradient` child of a `UIStroke` **multiplies** the stroke colour
Gold x gold = `(179,68,2)`, a dark red. The owner's report — *"reads as red with gold
accent"* — was an exact description of the squaring artifact. Set the stroke to white and
let the gradient stops carry the literal colours.

### F-08 · `TextScaled` forces `TextWrapped` and ignores your override
Single-line pills need a fixed `TextSize`, not `TextScaled` plus a size constraint.
Separately: U+2726 is not in the Gotham font and its fallback **breaks the line**.
Stick to U+2605 and pre-Unicode-13 monochrome glyphs.

### F-09 · A `BillboardGui` hard-clips to its own `Size`
`ClipsDescendants = false` does **not** extend the billboard quad. A child positioned
outside it never renders, while every property read says `Visible = true`. This muted a
speech bubble for days.

### F-10 · Bound every `AutomaticSize` text surface
A 444-char caption grew an auto-sized box past 500 px and ate the whole screen. Use a
bounded box + `TextScaled` inside + a `UITextSizeConstraint`, so long text shrinks rather
than overflowing.

### F-11 · Gamepad `B` hides top-level frames, not the ScreenGui
A panel that toggles `gui.Enabled` (rather than a frame's `Visible`) stayed hidden forever
after one B-press — "can't reopen feedback until relog". Invisible to mouse, touch, and to
any automated check.

### F-12 · Ship a build number on the settings screen
`game.PlaceVersion` rendered as "BUILD 3109" let bug reports be pinned to an exact build
and ended an entire class of build-confusion. (It reads stale in Studio Edit — that is the
point.) **Cheap; do it in week one.**

---

## G. Monetization & platform policy

### G-01 · Dedupe receipts, persist the log, and grant each entitlement in its own `pcall`
`ProcessReceipt` granted everything inside one `pcall`, so a throw in a late step after an
earlier grant succeeded returned `NotProcessedYet` -> the platform retried -> **duplicate
grant**. Each entitlement now grants in its own step so the sequence always reaches
`recordReceipt`.

### G-02 · A `productId = 0` charges Robux and grants nothing
Three credit packs shipped that way.

**Dirt Circuit:** the product table is validated at boot; a zero or duplicate id fails
startup loudly rather than in production.

### G-03 · Paid-random needs a policy gate, and the gate must **fail closed**
Crates cost soft currency, and soft currency was Robux-buyable — an *indirect* paid-random
chain that Roblox policy requires gating via `ArePaidRandomItemsRestricted`. Unresolved or
API failure must mean **restricted**, never "let them through".

**Dirt Circuit:** monetization is cosmetic-only and deliberately **not** random, which
sidesteps this entirely. `PolicyService` is present anyway so that if a crate is ever
added, the gate exists before the feature does.

### G-04 · Remote kill-switches, refreshed on a loop, save a publish cycle
`LiveConfig` (own DataStore, 60 s refresh) let purchases, crates and event multipliers be
toggled across every running server in ~1 minute **without** Save & Publish.

**Dirt Circuit:** `src/server/Services/LiveConfig.luau`, wired before the features it
guards.

### G-05 · Wire the analytics funnel on day one, not at launch
Renumbering the funnel later left permanent dedup noise for existing players, because
steps are keyed by number.

### G-06 · An in-game error webhook is the only production visibility you get
`ErrorReporter` on `ScriptContext.Error`, deduped and rate-limited. Include the
**`PlaceVersion`** in every report — servers on an old build keep reporting fixed bugs, and
without it you will "fix" the same thing twice.

---

## H. Content pipeline

### H-01 · Make review cheap or content will ship unreviewed
Stellar Dominion accumulated a 21-facility art estate where **17 awaited owner approval**
and the last six were never imported or wired. The bottleneck was always eyeballing.

**Dirt Circuit:** `tools/trackgen` emits an **SVG preview** next to every track. Reviewing
30 tracks is opening 30 images, not launching Studio 30 times.

### H-02 · Generated content needs a numeric gate harness, not vibes
The facility pipeline eventually grew a 12-gate validator. Build it first, not twelfth.

**Dirt Circuit:** `tools/trackgen/validate.py` gates every track on closure, minimum
corner radius, width, self-intersection, checkpoint monotonicity and lap-length band. A
track that fails a gate is not written.

### H-03 · One canonical data file; build geometry from it
Keeping geometry and its metadata in separate artifacts guarantees drift.

**Dirt Circuit:** `track.json` is canonical. Studio geometry is *built from it* by
`TrackBuilder`, and the SVG preview is rendered from it. Three consumers, one source.

### H-04 · Procedural is a legitimate art direction, not a fallback
Stellar Dominion's HD mesh pipeline (Tripo -> Open Cloud -> wrap) was a large, ongoing
per-asset cost, and several assets were procedural "by choice" and fine.

**Dirt Circuit:** the cozy voxel look is **entirely** built from untextured parts with flat
colours. No mesh pipeline, no upload step, no per-asset spend, and it is the cheapest
possible thing to render.

---

## I. Roblox platform traps

### I-01 · Reserved servers cannot be friend-joined
A friend clicking **Join** on a player in a reserved server gets *"You do not have
permission to join this experience"* — the platform refuses **before any game code runs**.
There is no game-side permission to grant. "Allow Third-Party Teleports" is unrelated;
toggling it changes nothing. Stellar Dominion had to build a whole cross-server player
registry, invite `LaunchData` round-trip and a JOIN FRIEND panel to work around it.

**Dirt Circuit:** races run in **public servers**, one lobby + N race bays per server.
Friend-join works natively and the entire workaround stack is never written. *This is the
single biggest structural decision on this list.*

### I-02 · `ContentProvider:PreloadAsync` rejects content-id **strings**
Every `rbxassetid://` string returns `Failure`. A string-based preloader fails both jobs at
once: it reports healthy assets as broken **and** silently preloads nothing, so the
mitigation is completely inert while looking like it works. Hand it Instances.
`PreloadAsync{SurfaceAppearance}` reports **zero** assets — a silent no-op.

### I-03 · `require()` in a Studio Edit session can serve a **stale compile**
Keyed to the module *Instance*, not its source. A module's own `selfTest()` returned
**green while describing a day-old site plan**. Confirmed on three modules at once, and it
fails in both directions — hides regressions *and* manufactures phantom ones. Any
verification that reads a table through `require` in Edit is **unverifiable**, not a pass.
(Rojo sync makes this far less likely, but the failure mode is worth knowing.)

### I-04 · A clean grep is not evidence of absence
Studio's MCP `script_grep` **missed matches entirely** — a grep for `PlayerDataManager`
skipped the one file that contained it, on the very line breaking the tutorial for every
player, and the agent hunting the bug looked elsewhere. Its line numbers were wrong five
times in one session. Grep the files on disk.

### I-05 · Likes are not queryable in-experience
The only source is the web votes API, and in-game `HttpService` is hard-blocked from
`roblox.com` domains. A like cannot be detected or attributed, so it can never gate a
reward. Group membership can.

### I-06 · `GroupService:PromptJoinAsync(groupId)` takes a single int
Passing the player first throws `"Unable to cast Instance to int64"` every time.

### I-07 · Studio hides production-only bugs by construction
`GetGuiInset()` returns `(0,0)` in Edit. `PlaceVersion` reads stale. Studio has every
asset cached, so a preloader that preloads nothing looks fine. Policy APIs error in
Studio. **Test in the published game**, and never dismiss a live report as "that just
doesn't work in Studio".

---

## J. Verification

### J-01 · Prefer a check that cannot be fooled by the thing it is checking
Ranking Studio logs by file mtime gave **false negatives** on publishes — a race that
passes a spot-check and fails in production, in the expensive direction ("nothing to do"
while running stale code). The fix was ranking by the timestamp *inside the matching line*.
Similarly, the Open Cloud place `updateTime` field was believed to be a publish signal for
weeks; it tracks configuration, not content.

**Rule:** when a signal is indirect, falsify it once, deliberately, before trusting it.

### J-02 · Persist timestamps as epoch integers, never ISO strings
Re-parsing an already-parsed datetime re-stringified it in local format and a following
`ToUniversalTime()` shifted it **again** — storing a watermark five hours in the future,
which would have silently swallowed every subsequent event while logging success. A number
has no timezone to misread.

### J-03 · Run the thing. Review does not find these
Four bugs in one publish-watcher were all found by running it and none were visible on
review. `-Once` loops that hang in the common case, output that goes to a stream you are
not capturing, a process filter that matches its own process.

### J-04 · Build the layout harness, and **save it**
Stellar Dominion's mobile overlap audit — a numeric rect model of every HUD element across
viewport x input mode x surface — found real regressions repeatedly. It was run ad hoc and
**never saved**, so it had to be rebuilt from scratch, by which time several constants had
changed. When it was re-run it immediately caught a regression introduced minutes earlier.

**Dirt Circuit:** `tools/layout_audit.py` reads `LayoutConfig.luau` and is committed.
