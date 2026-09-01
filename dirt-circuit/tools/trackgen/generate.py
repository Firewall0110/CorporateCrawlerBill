#!/usr/bin/env python3
"""Dirt Circuit track generator.

    python3 tools/trackgen/generate.py --count 30

Writes the canonical JSON into src/shared/Tracks/ (where Rojo turns each file into a
ModuleScript returning the table, so the game does zero parsing at runtime), and the SVG
previews plus a contact sheet into tools/trackgen/preview/.

A track that fails any gate in validate.py is REGENERATED with a new seed, never written.
Broken content must not be able to reach the game. (LESSONS.md H-02)
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import export  # noqa: E402
import geometry  # noqa: E402
import validate  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
TRACK_DIR = REPO_ROOT / "src" / "shared" / "Tracks"
PREVIEW_DIR = REPO_ROOT / "tools" / "trackgen" / "preview"

# How many seeds to try before giving up on one slot. Generous, because a rejection costs
# milliseconds and a bad track costs a player a race.
MAX_ATTEMPTS = 60


def sample_params(rng: random.Random, seed: int) -> geometry.TrackParams:
    """Spread the pool across recognisably different circuit characters.

    Three families, so thirty tracks do not feel like one track thirty times:
      * tight stadium bowls  - short lap, high wobble, narrow
      * classic ovals        - long straights, wide, fast
      * technical infields   - mid length, many surface hazards
    """
    family = rng.choice(["bowl", "oval", "technical"])

    if family == "bowl":
        return geometry.TrackParams(
            seed=seed,
            base_radius=rng.uniform(160, 195),
            wobble=rng.uniform(0.16, 0.26),
            harmonics=rng.choice([(2, 3), (2, 3, 5), (3, 4)]),
            half_width=rng.uniform(30, 38),
            checkpoint_count=14,
            mud_patches=2,
            puddles=2,
            rumble_strips=1,
            ramps=1,
            aspect_squash=rng.uniform(1.0, 1.15),
        )
    if family == "oval":
        return geometry.TrackParams(
            seed=seed,
            base_radius=rng.uniform(195, 240),
            wobble=rng.uniform(0.08, 0.16),
            harmonics=(2,),
            half_width=rng.uniform(38, 48),
            checkpoint_count=16,
            mud_patches=1,
            puddles=1,
            rumble_strips=1,
            ramps=2,
            elevation_amplitude=rng.uniform(4, 9),
            aspect_squash=rng.uniform(1.25, 1.55),
        )
    return geometry.TrackParams(
        seed=seed,
        base_radius=rng.uniform(180, 220),
        wobble=rng.uniform(0.20, 0.30),
        harmonics=rng.choice([(2, 3, 5), (3, 5), (2, 5, 7)]),
        half_width=rng.uniform(28, 36),
        checkpoint_count=18,
        mud_patches=3,
        puddles=3,
        rumble_strips=2,
        ramps=2,
        elevation_amplitude=rng.uniform(5, 11),
        aspect_squash=rng.uniform(1.0, 1.25),
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate Dirt Circuit tracks.")
    ap.add_argument("--count", type=int, default=30, help="how many tracks to produce")
    ap.add_argument("--seed", type=int, default=20260901, help="master seed; reproduces the whole pool")
    ap.add_argument("--out", type=Path, default=TRACK_DIR)
    ap.add_argument("--preview", type=Path, default=PREVIEW_DIR)
    ap.add_argument("--rbxmx", action="store_true", help="also write a drag-and-drop pack.rbxmx")
    ap.add_argument("--dry-run", action="store_true", help="validate only; write nothing")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    geometry.reset_names()
    tracks = []
    rejected = 0

    for i in range(1, args.count + 1):
        track_id = f"stadium_{i:02d}"
        chosen = None
        for _ in range(MAX_ATTEMPTS):
            params = sample_params(rng, rng.randrange(1, 2**31))
            candidate = geometry.make_track(track_id, params)
            failures = validate.validate(candidate)
            if not failures:
                chosen = candidate
                break
            # A rejected candidate must release the name it claimed, or the pool slowly
            # exhausts the name space for tracks that were never written.
            geometry.release_name(candidate.name)
            rejected += 1
        if chosen is None:
            print(f"  !! {track_id}: no valid track in {MAX_ATTEMPTS} attempts", file=sys.stderr)
            return 1
        tracks.append(chosen)
        print(f"  {track_id}  {chosen.name:<20} {chosen.length:>6.0f} studs  "
              f"{len(chosen.centerline):>3} nodes  {len(chosen.surfaces)} hazards")

    print(f"\n{len(tracks)} tracks accepted, {rejected} candidates rejected by the gates.")

    if args.dry_run:
        return 0

    for track in tracks:
        export.write_json(track, args.out / f"{track.id}.json")
        export.write_svg(track, args.preview / f"{track.id}.svg")

    manifest = {
        "schemaVersion": 1,
        "masterSeed": args.seed,
        "tracks": [
            {"id": t.id, "name": t.name, "lapLength": round(t.length, 1), "seed": t.params.seed}
            for t in tracks
        ],
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    export.write_contact_sheet(tracks, args.preview / "index.html")

    if args.rbxmx:
        export.write_rbxmx(tracks, args.preview / "pack.rbxmx")

    print(f"wrote {args.out}/  and  {args.preview}/index.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
