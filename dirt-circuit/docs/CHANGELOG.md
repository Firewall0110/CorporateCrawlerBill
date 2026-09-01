# Changelog

Player-facing entries go in the same commit as the change, not in a later pass.
Stellar Dominion shipped a run of builds unannounced because notes were a separate
step that fell behind (LESSONS.md A-06).

## Unreleased

### Added
- Project scaffold: Rojo, pinned toolchain, CI, structural Luau check.
- Fixed-timestep arcade vehicle simulation (`Shared.Sim.VehicleSim`), shared verbatim
  between server authority and client prediction.
- Analytic collision resolution for truck-vs-truck and truck-vs-barrier, with an
  explicit anti-wedge escape.
- Track model with baked surface/height/ramp grid, wall spatial hash and ordered
  checkpoint gates.
- AI drivers: pure-pursuit steering, curvature-derived corner speed, traffic avoidance,
  tactical nitro, mild rubber-banding. Bots use the same sim and the same upgrade
  ladders as players.
- Race session state machine with per-racer `pcall` isolation and three independent
  termination guarantees.
- Schema-driven player persistence: adding a saved field is one line in `ProfileSchema`.
- Declarative remotes with per-message validators and per-player rate limits.
- External track generator with a 12-gate validator, SVG previews and a contact sheet.
- 30 generated stadium tracks.
- `TrackBuilder`: stadium geometry built from `track.json` — trackbed, barriers, hay bales,
  ramps, start line, floodlights and crowd stands, in flat-colour voxel parts.
- `TruckBuilder`: the nine-part voxel truck, and the one function that moves it.
- `TrackService`: track loading, baking and a no-repeat rotation with random direction.
- `DevRace`: a one-liner that builds a track and races eight AI drivers on it.
- `tools/simharness`: runs the real geometry code headlessly under Lune, in CI.
