"""Numeric gates for a generated track.

Lesson H-02. Stellar Dominion's generated-content pipeline eventually grew a twelve-gate
validator, but only after a 21-item art estate had accumulated, 17 of it awaiting review.
Build the gates first, not twelfth: a track that fails one is never written to disk, so a
broken circuit cannot reach the game and cannot waste a review pass.

Lesson J-01 also applies. The generator's radial construction makes centreline
self-intersection impossible in theory, and gate 5 checks it anyway. When a property is
"guaranteed by construction", the cheap thing is to falsify it once, deliberately, rather
than to discover later that the guarantee had an exception nobody thought about.
"""

from __future__ import annotations

import math
from typing import List, Tuple

from geometry import Track, curvatures

Point = Tuple[float, float]

# Truck collision radius, mirrored from VehicleConfig.Radius. If that number moves, this
# one must move with it — which is why the gate names it explicitly rather than hiding a
# magic 4.2 in an inequality.
TRUCK_RADIUS = 4.2

LIMITS = {
    "min_nodes": 32,
    # Band chosen from the race-length target, not from taste. The spec fixes the race at
    # 4 laps, so lap length IS race length: at a stock truck's realistic average pace
    # (~0.62 of its 108 stud/s top speed) a 1900-stud lap is ~28 s, i.e. a ~110 s race.
    # Past that a first-time player on a phone is committing to over two minutes before
    # they have any upgrades, which is the wrong first impression.
    "min_lap_length": 1000.0,
    "max_lap_length": 1900.0,
    "min_corner_radius": 20.0,
    "min_half_width": 14.0,
    "min_checkpoints": 8,
    "max_ramp_curvature": 0.004,
    "grid_clearance": TRUCK_RADIUS + 2.0,
}


class GateFailure(Exception):
    pass


def _segments_cross(p1, p2, q1, q2) -> bool:
    def side(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    d1 = side(q1, q2, p1)
    d2 = side(q1, q2, p2)
    d3 = side(p1, p2, q1)
    d4 = side(p1, p2, q2)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def _self_intersects(poly: List[Point]) -> bool:
    n = len(poly)
    for i in range(n):
        a1, a2 = poly[i], poly[(i + 1) % n]
        # Skip immediate neighbours: adjacent segments share an endpoint by definition.
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            b1, b2 = poly[j], poly[(j + 1) % n]
            if _segments_cross(a1, a2, b1, b2):
                return True
    return False


def _point_to_polyline_distance(p: Point, poly: List[Point]) -> float:
    best = float("inf")
    n = len(poly)
    for i in range(n):
        ax, az = poly[i]
        bx, bz = poly[(i + 1) % n]
        abx, abz = bx - ax, bz - az
        L2 = abx * abx + abz * abz
        if L2 < 1e-9:
            continue
        t = max(0.0, min(1.0, ((p[0] - ax) * abx + (p[1] - az) * abz) / L2))
        qx, qz = ax + abx * t, az + abz * t
        d = math.hypot(p[0] - qx, p[1] - qz)
        if d < best:
            best = d
    return best


def _all_finite(track: Track) -> bool:
    def ok(v):
        return isinstance(v, (int, float)) and math.isfinite(v)

    for x, z in track.centerline:
        if not (ok(x) and ok(z)):
            return False
    for w in track.half_widths:
        if not ok(w):
            return False
    for y in track.elevation:
        if not ok(y):
            return False
    return True


def validate(track: Track) -> List[str]:
    """Returns a list of gate failures. Empty means the track ships."""
    failures: List[str] = []
    n = len(track.centerline)

    # 1. Enough geometry to be a track at all.
    if n < LIMITS["min_nodes"]:
        failures.append(f"G1 node count {n} < {LIMITS['min_nodes']}")

    # 2. Every number is finite. NaN in a track blob would become NaN in a truck's
    #    position on the first frame. (LESSONS.md B-03)
    if not _all_finite(track):
        failures.append("G2 non-finite value in centreline / widths / elevation")

    # 3. Lap length band. Too short and four laps are over before the pack sorts itself
    #    out; too long and a race outlasts a mobile session.
    length = track.length
    if not (LIMITS["min_lap_length"] <= length <= LIMITS["max_lap_length"]):
        failures.append(f"G3 lap length {length:.0f} outside [{LIMITS['min_lap_length']:.0f}, {LIMITS['max_lap_length']:.0f}]")

    # 4. Minimum corner radius. A corner tighter than this cannot be taken at any speed the
    #    handling model can produce, which reads to a player as a broken track.
    curv = curvatures(track.centerline, track.node_spacing)
    peak = max((abs(k) for k in curv), default=0.0)
    radius = (1.0 / peak) if peak > 1e-9 else float("inf")
    if radius < LIMITS["min_corner_radius"]:
        failures.append(f"G4 tightest corner radius {radius:.1f} < {LIMITS['min_corner_radius']}")

    # 5. Centreline does not cross itself. Guaranteed by the radial construction; checked
    #    anyway, because a guarantee you never test is a belief.
    if _self_intersects(track.centerline):
        failures.append("G5 centreline self-intersects")

    # 6. The INNER wall is the real risk: offsetting inward around a tight corner pinches
    #    and can fold the polyline through itself, which would put a collision barrier
    #    across the racing line.
    if _self_intersects(track.inner):
        failures.append("G6 inner wall self-intersects (corner too tight for the width)")

    # 7. Trackbed never narrows below something two trucks can share.
    min_w = min(track.half_widths) if track.half_widths else 0.0
    if min_w < LIMITS["min_half_width"]:
        failures.append(f"G7 minimum half-width {min_w:.1f} < {LIMITS['min_half_width']}")

    # 8. Checkpoints: enough of them, in ascending node order, non-degenerate.
    if len(track.checkpoints) < LIMITS["min_checkpoints"]:
        failures.append(f"G8 only {len(track.checkpoints)} checkpoints")
    else:
        last = -1
        for cp in track.checkpoints:
            node = cp["node"]
            if node <= last:
                failures.append("G8 checkpoint nodes are not strictly ascending")
                break
            last = node
            ax, az = cp["a"]
            bx, bz = cp["b"]
            if math.hypot(bx - ax, bz - az) < LIMITS["min_half_width"]:
                failures.append("G8 degenerate checkpoint gate")
                break

    # 9. Every grid slot is on the track with room for the truck body.
    for i, (gx, gz, _) in enumerate(track.grid):
        d = _point_to_polyline_distance((gx, gz), track.centerline)
        node_w = min(track.half_widths)
        if d > node_w - LIMITS["grid_clearance"]:
            failures.append(f"G9 grid slot {i + 1} is {d:.1f} from the centreline, off the trackbed")
            break

    # 10. Ramps are on straights. A jump taken mid-corner is a crash, not a jump.
    for i, ramp in enumerate(track.ramps):
        mid = ((ramp["a"][0] + ramp["b"][0]) * 0.5, (ramp["a"][1] + ramp["b"][1]) * 0.5)
        nearest = min(range(n), key=lambda j: math.hypot(track.centerline[j][0] - mid[0],
                                                         track.centerline[j][1] - mid[1]))
        if abs(curv[nearest]) > LIMITS["max_ramp_curvature"]:
            failures.append(f"G10 ramp {i + 1} sits on a corner (curvature {abs(curv[nearest]):.5f})")
            break

    # 11. The starting grid fits behind the first gate without overlapping it.
    if track.grid and track.checkpoints:
        gate = track.checkpoints[0]
        gmid = ((gate["a"][0] + gate["b"][0]) * 0.5, (gate["a"][1] + gate["b"][1]) * 0.5)
        for i, (gx, gz, _) in enumerate(track.grid):
            if math.hypot(gx - gmid[0], gz - gmid[1]) < 8.0:
                failures.append(f"G11 grid slot {i + 1} overlaps the start gate")
                break

    # 12. Trucks on the grid do not start inside each other.
    for i in range(len(track.grid)):
        for j in range(i + 1, len(track.grid)):
            ax, az, _ = track.grid[i]
            bx, bz, _ = track.grid[j]
            if math.hypot(bx - ax, bz - az) < TRUCK_RADIUS * 2:
                failures.append(f"G12 grid slots {i + 1} and {j + 1} overlap")
                break
        else:
            continue
        break

    return failures
