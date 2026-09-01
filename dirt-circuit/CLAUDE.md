# Working rules for Dirt Circuit

Read [`LESSONS.md`](LESSONS.md) before changing anything. It is not history; it is the
spec. Cite rule IDs in comments and PR descriptions (`-- Lesson C-02`).

## Source of truth

**The repo is the game.** `src/` is authoritative and syncs into Studio via Rojo. Studio is
a renderer and a level editor. If a change is not in git, it does not exist.

This is the one rule the previous project got wrong, and everything downstream — no diffs,
no review, no rollback, no CI — followed from it.

## Before you edit

- **A write to an existing file is a delete.** Copy before overwriting anything you did not
  create this session; prefer partial edits.
- **Never pattern-match a generic word to delete things.** List first, delete second.
  `Preview`, `Test`, `Temp`, `Old` and a `^ZZ` prefix have each destroyed real work.
- `tools/` is tracked and always will be. A generator that is not in git is one bad write
  from being gone forever.

## Invariants — breaking one of these is a design change, not a fix

1. **`VehicleSim` is the only writer of vehicle motion.** No physics constraint, mover, or
   second loop may touch a truck's position, heading or velocity.
2. **Client and server call the same sim module.** Never fork it "just for the client".
3. **Physics is a fixed 60 Hz timestep.** Never pass a frame delta to `VehicleSim.step`.
4. **No reserved servers.**
5. **No `_G`.** `selene.toml` denies it.
6. **Every long-lived loop goes through `ServiceLoop`.**
7. **Every remote is declared in `Remotes.DEFS` with a validator.**
8. **A persisted field is one line in `ProfileSchema`.** If you find yourself editing
   persistence in two places, stop — the abstraction has broken and that is the bug.
9. **Monetization is cosmetic and non-random.** Nothing sold may touch `VehicleConfig`.

## Writing code here

- Guard every remote numeric with `Guards.finite`. `NaN` passes `type()`, survives
  `math.clamp`, and makes every comparison false.
- Any per-player or per-entity loop needs a per-iteration `pcall`. One failure must not
  strand the rest of the field.
- `pcall` does not protect the expression that builds its arguments. Wrap the whole call in
  a closure, and always warn on failure — a silent `pcall` around a lifecycle handler hid a
  bug for months on the last project.
- Capture positions into locals before any call that could destroy the thing you are about
  to read.
- Cache immutable per-entity data once; do not re-read attributes in a 60 Hz loop.
- Tuning goes in `Config/`. If a magic number appears in `Sim/` or a service, it is
  probably in the wrong file.

## Checks

```bash
python3 tools/luau_check.py src            # structural; works with no toolchain
selene src                                 # authoritative (needs generate-roblox-std once)
./tools/selene_local.sh                    # when the API dump is unreachable — see below
stylua --check src
rojo build --output /tmp/dc.rbxl           # proves the tree assembles
lune run tools/simharness/audit_tracks.luau  # RUNS the geometry code over all 30 tracks
python3 tools/trackgen/generate.py --count 30 --dry-run
```

`luau_check.py` is a heuristic, not a parser. It is the gate that runs everywhere; `selene`
and `luau-analyze` are the gates that are actually right.

⚠️ **Do not "fix" a noisy local check by narrowing what it reports.** In a sandbox where
`selene generate-roblox-std` cannot reach the network, the `luau` std makes every Roblox
global look undefined. Filtering the output down to the rule names you care about silences
`undefined_variable` entirely — and that is precisely how a real `model is not defined`
reached CI once. Use `tools/selene_local.sh`, which subtracts the known Roblox globals and
reports everything else. A check narrowed until it cannot fail is not a check.

⚠️ **A loose string replace is a destructive sweep.** The bug above was introduced by a
scripted edit matching `\tlocal model, stats` — which also matched the three-tab occurrence
inside a nested block, renaming a variable that was still in use. Same rule as A-04: anchor
on something unique, and assert the match count before writing.

## Content

- Tracks are data. Generate them, do not hand-place geometry.
- A track that fails a gate is never written. If you need to relax a gate, change the gate
  deliberately and say why in the commit — do not bypass it for one track.
- Keep the SVG previews current. Review being cheap is the only reason it happens.

## Changelog

Add the player-facing line to `docs/CHANGELOG.md` in the same commit as the change.
