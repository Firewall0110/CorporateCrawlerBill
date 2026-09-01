"""Closed-loop stadium track geometry.

The generator is radial by construction: the centreline is r(theta) around a centre, where
r is a positive sum of low-frequency sinusoids. That makes every track a star-shaped
polygon, and a star-shaped polygon CANNOT self-intersect. So the nastiest failure mode a
procedural track generator has is unreachable rather than merely tested for.

Everything downstream (walls, checkpoints, surfaces, ramps, grid) is derived from the
resampled centreline, so there is exactly one thing to get right.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import List, Tuple

Point = Tuple[float, float]


@dataclass
class TrackParams:
    """Everything the shape of a track depends on. Seeded, so a track id reproduces."""

    seed: int
    base_radius: float = 240.0
    # Amplitude of the radial wobble, as a fraction of base_radius. Bounded well below 1.0
    # so r stays positive and the star-shaped guarantee holds.
    wobble: float = 0.30
    harmonics: Tuple[int, ...] = (2, 3, 5)
    # Trackbed half-width, in studs, before per-node variation.
    half_width: float = 34.0
    half_width_variation: float = 0.22
    node_spacing: float = 8.0
    checkpoint_count: int = 16
    # Elevation: a gentle rise and fall, plus a jump hill or two.
    elevation_amplitude: float = 6.0
    mud_patches: int = 2
    puddles: int = 2
    rumble_strips: int = 1
    ramps: int = 2
    grid_slots: int = 8
    aspect_squash: float = 1.0  # >1 stretches along X, making a stadium oval


@dataclass
class Track:
    id: str
    name: str
    params: TrackParams
    centerline: List[Point] = field(default_factory=list)
    half_widths: List[float] = field(default_factory=list)
    elevation: List[float] = field(default_factory=list)
    inner: List[Point] = field(default_factory=list)
    outer: List[Point] = field(default_factory=list)
    checkpoints: List[dict] = field(default_factory=list)
    surfaces: List[dict] = field(default_factory=list)
    ramps: List[dict] = field(default_factory=list)
    pickup_nodes: List[Point] = field(default_factory=list)
    grid: List[Tuple[float, float, float]] = field(default_factory=list)
    node_spacing: float = 8.0

    @property
    def length(self) -> float:
        return len(self.centerline) * self.node_spacing


# ---------------------------------------------------------------------------
# Core curve
# ---------------------------------------------------------------------------


def _radial_shape(p: TrackParams, rng: random.Random, samples: int = 720) -> List[Point]:
    """Dense sample of r(theta), before arc-length resampling."""
    phases = [rng.uniform(0, math.tau) for _ in p.harmonics]
    # Split the wobble budget across the harmonics so the total never approaches 1.0.
    weights = [rng.uniform(0.4, 1.0) for _ in p.harmonics]
    total = sum(weights) or 1.0
    weights = [w / total for w in weights]

    pts: List[Point] = []
    for i in range(samples):
        theta = (i / samples) * math.tau
        r = 1.0
        for k, phase, w in zip(p.harmonics, phases, weights):
            r += p.wobble * w * math.sin(k * theta + phase)
        r *= p.base_radius
        pts.append((math.cos(theta) * r * p.aspect_squash, math.sin(theta) * r))
    return pts


def _resample_closed(pts: List[Point], spacing: float) -> List[Point]:
    """Uniform arc-length resampling of a closed polyline.

    Uniform spacing is not cosmetic. It is what lets TrackModel treat "N studs ahead" as
    integer index arithmetic instead of a walk, which is the difference between the AI's
    corner-scan being free and being the most expensive thing on the server.
    """
    n = len(pts)
    seg_lengths = []
    for i in range(n):
        ax, az = pts[i]
        bx, bz = pts[(i + 1) % n]
        seg_lengths.append(math.hypot(bx - ax, bz - az))
    total = sum(seg_lengths)
    count = max(16, int(round(total / spacing)))
    step = total / count

    out: List[Point] = []
    seg = 0
    seg_pos = 0.0
    for i in range(count):
        target = i * step
        # Advance to the segment containing `target`.
        while seg_pos + seg_lengths[seg] < target and seg < n - 1:
            seg_pos += seg_lengths[seg]
            seg += 1
        remain = target - seg_pos
        L = seg_lengths[seg] or 1e-9
        t = max(0.0, min(1.0, remain / L))
        ax, az = pts[seg]
        bx, bz = pts[(seg + 1) % n]
        out.append((ax + (bx - ax) * t, az + (bz - az) * t))
    return out


def _tangents(pts: List[Point]) -> List[Point]:
    n = len(pts)
    out = []
    for i in range(n):
        ax, az = pts[(i - 1) % n]
        bx, bz = pts[(i + 1) % n]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz) or 1e-9
        out.append((dx / L, dz / L))
    return out


def curvatures(pts: List[Point], spacing: float) -> List[float]:
    """Signed curvature per node, radians per stud. Matches TrackModel:curvatureAt."""
    n = len(pts)
    out = []
    for i in range(n):
        ax, az = pts[(i - 1) % n]
        bx, bz = pts[i]
        cx, cz = pts[(i + 1) % n]
        v1x, v1z = bx - ax, bz - az
        v2x, v2z = cx - bx, cz - bz
        l1 = math.hypot(v1x, v1z) or 1e-9
        l2 = math.hypot(v2x, v2z) or 1e-9
        v1x, v1z = v1x / l1, v1z / l1
        v2x, v2z = v2x / l2, v2z / l2
        cross = v1x * v2z - v1z * v2x
        dot = max(-1.0, min(1.0, v1x * v2x + v1z * v2z))
        out.append(math.atan2(cross, dot) / spacing)
    return out


def _offset_polyline(pts: List[Point], tans: List[Point], widths: List[float], side: float) -> List[Point]:
    out = []
    for (px, pz), (tx, tz), w in zip(pts, tans, widths):
        # Right-hand normal in XZ, matching TrackModel's (-tz, tx).
        nx, nz = -tz, tx
        out.append((px + nx * w * side, pz + nz * w * side))
    return out


# ---------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------


def _build_widths(p: TrackParams, curv: List[float], rng: random.Random) -> List[float]:
    """Wider on the straights, tighter through corners — the shape that makes overtaking
    happen in one specific place rather than nowhere or everywhere."""
    n = len(curv)
    peak = max((abs(k) for k in curv), default=1e-6) or 1e-6
    phase = rng.uniform(0, math.tau)
    out = []
    for i, k in enumerate(curv):
        straightness = 1.0 - min(1.0, abs(k) / peak)
        noise = math.sin((i / n) * math.tau * 2 + phase) * p.half_width_variation * 0.5
        w = p.half_width * (0.86 + 0.28 * straightness + noise)
        # Floor is deliberately BELOW validate.LIMITS["min_half_width"]. Clamping to the
        # gate's own threshold would make that gate unfireable, and a gate that cannot fail
        # is not a check — it is a comment that costs CPU. (LESSONS.md J-01)
        out.append(max(6.0, w))
    return out


def _build_checkpoints(pts: List[Point], tans: List[Point], widths: List[float], count: int) -> List[dict]:
    """Gates perpendicular to the centreline, evenly spaced by node index.

    Made 40% wider than the trackbed on purpose: a truck that clips the very edge of a
    barrier, or gets punted a little wide, must still register the gate. A gate that can be
    missed while driving the track legitimately turns into a phantom "he didn't complete the
    lap" bug that is miserable to diagnose from a player report.
    """
    n = len(pts)
    out = []
    for i in range(count):
        idx = round(i * n / count) % n
        px, pz = pts[idx]
        tx, tz = tans[idx]
        nx, nz = -tz, tx
        w = widths[idx] * 1.4
        out.append(
            {
                "node": idx,
                "a": [round(px + nx * w, 3), round(pz + nz * w, 3)],
                "b": [round(px - nx * w, 3), round(pz - nz * w, 3)],
            }
        )
    return out


def _quad_around(pts, tans, widths, idx, length_nodes, inner_frac, outer_frac):
    """A polygon hugging one side of the track over a run of nodes."""
    n = len(pts)
    left, right = [], []
    for s in range(length_nodes + 1):
        i = (idx + s) % n
        px, pz = pts[i]
        tx, tz = tans[i]
        nx, nz = -tz, tx
        w = widths[i]
        left.append([round(px + nx * w * inner_frac, 3), round(pz + nz * w * inner_frac, 3)])
        right.append([round(px + nx * w * outer_frac, 3), round(pz + nz * w * outer_frac, 3)])
    return left + list(reversed(right))


def _build_surfaces(p: TrackParams, pts, tans, widths, curv, rng) -> List[dict]:
    n = len(pts)
    out = []

    # Mud goes on the OUTSIDE of the tightest corners: the punishing line, so running wide
    # costs you something specific rather than nothing.
    corner_nodes = sorted(range(n), key=lambda i: -abs(curv[i]))
    used = set()

    def pick_corner():
        for i in corner_nodes:
            if all(abs(i - u) > n * 0.08 for u in used):
                used.add(i)
                return i
        return rng.randrange(n)

    for _ in range(p.mud_patches):
        i = pick_corner()
        sign = 1.0 if curv[i] < 0 else -1.0
        out.append(
            {
                "type": "mud",
                "poly": _quad_around(pts, tans, widths, i - 4, 9, sign * 0.42, sign * 1.0),
            }
        )

    for _ in range(p.puddles):
        i = rng.randrange(n)
        side = rng.choice([-1.0, 1.0])
        out.append(
            {
                "type": "puddle",
                "poly": _quad_around(pts, tans, widths, i, 3, side * 0.15, side * 0.72),
            }
        )

    # Rumble strips span the full width — you cannot dodge them, only absorb them, which is
    # what makes the Shocks upgrade legible to the player.
    for _ in range(p.rumble_strips):
        i = rng.randrange(n)
        out.append({"type": "rumble", "poly": _quad_around(pts, tans, widths, i, 5, -0.98, 0.98)})

    return out


def _build_ramps(p: TrackParams, pts, tans, widths, curv, rng) -> List[dict]:
    """Ramps go on the STRAIGHTEST parts. A jump in a corner is not a jump, it is a crash."""
    n = len(pts)
    straight_nodes = sorted(range(n), key=lambda i: abs(curv[i]))
    out = []
    used = []
    for _ in range(p.ramps):
        chosen = None
        for i in straight_nodes:
            if all(abs(i - u) > n * 0.15 for u in used):
                chosen = i
                break
        if chosen is None:
            break
        used.append(chosen)

        px, pz = pts[chosen]
        tx, tz = tans[chosen]
        nx, nz = -tz, tx
        w = widths[chosen] * 0.9
        out.append(
            {
                "a": [round(px + nx * w, 3), round(pz + nz * w, 3)],
                "b": [round(px - nx * w, 3), round(pz - nz * w, 3)],
                "launch": round(rng.uniform(28, 44), 2),
                "width": round(rng.uniform(14, 22), 2),
            }
        )
    return out


def _build_elevation(p: TrackParams, n: int, rng: random.Random) -> List[float]:
    phase = rng.uniform(0, math.tau)
    phase2 = rng.uniform(0, math.tau)
    out = []
    for i in range(n):
        t = (i / n) * math.tau
        y = math.sin(t + phase) * p.elevation_amplitude
        y += math.sin(t * 3 + phase2) * p.elevation_amplitude * 0.35
        out.append(round(y, 3))
    return out


def _build_pickups(pts, tans, widths, rng, count=14) -> List[Point]:
    n = len(pts)
    out = []
    for i in range(count):
        idx = round(i * n / count) % n
        px, pz = pts[idx]
        tx, tz = tans[idx]
        nx, nz = -tz, tx
        offset = rng.uniform(-0.55, 0.55) * widths[idx]
        out.append((round(px + nx * offset, 3), round(pz + nz * offset, 3)))
    return out


def _build_grid(pts, tans, widths, slots: int) -> List[Tuple[float, float, float]]:
    """Staggered two-by-two behind the start/finish line, walking BACKWARDS from node 0."""
    n = len(pts)
    out = []
    for i in range(slots):
        row = i // 2
        lane = -1 if (i % 2 == 0) else 1
        idx = (-(row * 3) - 4) % n
        px, pz = pts[idx]
        tx, tz = tans[idx]
        nx, nz = -tz, tx
        offset = widths[idx] * 0.38 * lane
        # Heading convention: forward = (-sin h, -cos h), so h = atan2(-tx, -tz).
        heading = math.atan2(-tx, -tz)
        out.append((round(px + nx * offset, 3), round(pz + nz * offset, 3), round(heading, 5)))
    return out


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

_ADJECTIVES = ["Dust", "Thunder", "Boulder", "Copper", "Sunset", "Iron", "Prairie", "Rust",
               "Cactus", "Gravel", "Mesa", "Badger", "Clover", "Ember", "Ridge", "Willow"]
_NOUNS = ["Bowl", "Basin", "Flats", "Speedway", "Gulch", "Arena", "Hollow", "Circuit",
          "Wash", "Yard", "Pit", "Run", "Loop", "Crossing", "Field", "Stadium"]


# Names already handed out this run, so a thirty-track select screen has thirty distinct
# entries. Reset by `reset_names()` at the start of a generation pass.
_USED_NAMES: set = set()


def reset_names() -> None:
    _USED_NAMES.clear()


def release_name(name: str) -> None:
    _USED_NAMES.discard(name)


def _unique_name(rng: random.Random) -> str:
    for _ in range(200):
        candidate = f"{rng.choice(_ADJECTIVES)} {rng.choice(_NOUNS)}"
        if candidate not in _USED_NAMES:
            _USED_NAMES.add(candidate)
            return candidate
    # 256 combinations against a 30-track pool makes this unreachable in practice, but a
    # generator that can silently loop forever is worse than one that repeats a name.
    fallback = f"{rng.choice(_ADJECTIVES)} {rng.choice(_NOUNS)} II"
    _USED_NAMES.add(fallback)
    return fallback


def make_track(track_id: str, params: TrackParams) -> Track:
    rng = random.Random(params.seed)

    dense = _radial_shape(params, rng)
    center = _resample_closed(dense, params.node_spacing)
    tans = _tangents(center)
    curv = curvatures(center, params.node_spacing)
    widths = _build_widths(params, curv, rng)

    name = _unique_name(rng)

    track = Track(
        id=track_id,
        name=name,
        params=params,
        node_spacing=params.node_spacing,
        centerline=[(round(x, 3), round(z, 3)) for x, z in center],
        half_widths=[round(w, 3) for w in widths],
        elevation=_build_elevation(params, len(center), rng),
        inner=[(round(x, 3), round(z, 3)) for x, z in _offset_polyline(center, tans, widths, -1.0)],
        outer=[(round(x, 3), round(z, 3)) for x, z in _offset_polyline(center, tans, widths, 1.0)],
        checkpoints=_build_checkpoints(center, tans, widths, params.checkpoint_count),
        surfaces=_build_surfaces(params, center, tans, widths, curv, rng),
        ramps=_build_ramps(params, center, tans, widths, curv, rng),
        pickup_nodes=_build_pickups(center, tans, widths, rng),
        grid=_build_grid(center, tans, widths, params.grid_slots),
    )
    return track
