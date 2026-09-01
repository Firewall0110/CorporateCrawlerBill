"""Export a Track to the three artifacts the pipeline needs.

ONE canonical file, three derived consumers (LESSONS.md H-03):

  track.json   canonical. Rojo turns a plain .json into a ModuleScript that returns the
               decoded table, so the game reads it with zero runtime parsing and the track
               data lives in git alongside the code that consumes it.
  track.svg    review. Lesson H-01: Stellar Dominion accumulated a 21-item generated art
               estate with 17 pieces awaiting approval, because reviewing one meant opening
               Studio. Reviewing thirty tracks here means opening thirty images.
  pack.rbxmx   a drag-and-drop fallback for anyone not running Rojo.

Geometry is never exported. TrackBuilder constructs the parts in-game from this same JSON,
so the visual barriers and the collision polylines cannot drift apart.
"""

from __future__ import annotations

import json
import math
import xml.sax.saxutils as sax
from pathlib import Path
from typing import List

from geometry import Track

SURFACE_FILL = {
    "mud": "#6a5334",
    "puddle": "#8fb0be",
    "rumble": "#b28f5f",
    "tarmac": "#6f6f76",
}


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------


def to_dict(track: Track) -> dict:
    xs = [p[0] for p in track.outer]
    zs = [p[1] for p in track.outer]
    apron = 60.0
    return {
        "id": track.id,
        "name": track.name,
        "schemaVersion": 1,
        "seed": track.params.seed,
        "nodeSpacing": track.node_spacing,
        "lapLength": round(track.length, 2),
        "bounds": {
            "minX": round(min(xs) - apron, 2),
            "maxX": round(max(xs) + apron, 2),
            "minZ": round(min(zs) - apron, 2),
            "maxZ": round(max(zs) + apron, 2),
        },
        "centerline": [[x, z] for x, z in track.centerline],
        "halfWidth": track.half_widths,
        "elevation": track.elevation,
        "walls": {
            "inner": [[x, z] for x, z in track.inner],
            "outer": [[x, z] for x, z in track.outer],
        },
        "checkpoints": track.checkpoints,
        "surfaces": track.surfaces,
        "ramps": track.ramps,
        "pickupNodes": [[x, z] for x, z in track.pickup_nodes],
        "grid": [[x, z, h] for x, z, h in track.grid],
    }


def write_json(track: Track, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_dict(track), separators=(",", ":")), encoding="utf-8")


# ---------------------------------------------------------------------------
# SVG preview
# ---------------------------------------------------------------------------


def _poly_points(pts, ox, oz, scale) -> str:
    return " ".join(f"{(x - ox) * scale:.1f},{(z - oz) * scale:.1f}" for x, z in pts)


def write_svg(track: Track, path: Path, width: int = 900) -> None:
    xs = [p[0] for p in track.outer]
    zs = [p[1] for p in track.outer]
    pad = 40.0
    minx, maxx = min(xs) - pad, max(xs) + pad
    minz, maxz = min(zs) - pad, max(zs) + pad
    span_x = maxx - minx
    span_z = maxz - minz
    scale = width / span_x
    height = int(span_z * scale)

    out: List[str] = []
    out.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">'
    )
    out.append(f'<rect width="{width}" height="{height}" fill="#2b2a33"/>')

    # Trackbed: outer polygon with the infield punched out by fill-rule.
    out.append(
        f'<path fill="#c9a97a" fill-rule="evenodd" d="M{_poly_points(track.outer, minx, minz, scale).replace(" ", "L")}Z'
        f'M{_poly_points(track.inner, minx, minz, scale).replace(" ", "L")}Z"/>'
    )

    for patch in track.surfaces:
        fill = SURFACE_FILL.get(patch["type"], "#888888")
        pts = _poly_points([(p[0], p[1]) for p in patch["poly"]], minx, minz, scale)
        out.append(f'<polygon points="{pts}" fill="{fill}" fill-opacity="0.85"/>')

    for ramp in track.ramps:
        ax = (ramp["a"][0] - minx) * scale
        az = (ramp["a"][1] - minz) * scale
        bx = (ramp["b"][0] - minx) * scale
        bz = (ramp["b"][1] - minz) * scale
        out.append(
            f'<line x1="{ax:.1f}" y1="{az:.1f}" x2="{bx:.1f}" y2="{bz:.1f}" '
            f'stroke="#f2c14e" stroke-width="7" stroke-linecap="round"/>'
        )

    # Checkpoint gates; gate 1 (start/finish) is drawn distinctly.
    for i, cp in enumerate(track.checkpoints):
        ax = (cp["a"][0] - minx) * scale
        az = (cp["a"][1] - minz) * scale
        bx = (cp["b"][0] - minx) * scale
        bz = (cp["b"][1] - minz) * scale
        if i == 0:
            out.append(
                f'<line x1="{ax:.1f}" y1="{az:.1f}" x2="{bx:.1f}" y2="{bz:.1f}" '
                f'stroke="#ffffff" stroke-width="4" stroke-dasharray="8 6"/>'
            )
        else:
            out.append(
                f'<line x1="{ax:.1f}" y1="{az:.1f}" x2="{bx:.1f}" y2="{bz:.1f}" '
                f'stroke="#ffffff" stroke-width="1" stroke-opacity="0.30"/>'
            )

    # Walls on top so the racing surface reads clearly.
    for poly, colour in ((track.outer, "#8d7350"), (track.inner, "#8d7350")):
        out.append(
            f'<polygon points="{_poly_points(poly, minx, minz, scale)}" '
            f'fill="none" stroke="{colour}" stroke-width="3"/>'
        )

    for px, pz in track.pickup_nodes:
        out.append(
            f'<circle cx="{(px - minx) * scale:.1f}" cy="{(pz - minz) * scale:.1f}" r="3.5" fill="#5fd08a"/>'
        )

    for i, (gx, gz, heading) in enumerate(track.grid):
        cx = (gx - minx) * scale
        cz = (gz - minz) * scale
        # Same convention as the game: forward = (-sin h, -cos h).
        fx, fz = -math.sin(heading), -math.cos(heading)
        out.append(
            f'<circle cx="{cx:.1f}" cy="{cz:.1f}" r="4" fill="#e8604c"/>'
            f'<line x1="{cx:.1f}" y1="{cz:.1f}" x2="{cx + fx * 14:.1f}" y2="{cz + fz * 14:.1f}" '
            f'stroke="#e8604c" stroke-width="2"/>'
        )

    label = sax.escape(f"{track.name}  -  {track.id}  -  {track.length:.0f} studs/lap")
    out.append(
        f'<text x="14" y="26" font-family="monospace" font-size="16" fill="#f4f0e6">{label}</text>'
    )
    out.append("</svg>")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out), encoding="utf-8")


# ---------------------------------------------------------------------------
# rbxmx pack
# ---------------------------------------------------------------------------


def write_rbxmx(tracks: List[Track], path: Path) -> None:
    """A Folder of StringValues holding the JSON, importable without any toolchain.

    StringValue rather than ModuleScript on purpose: a ModuleScript's Source is subject to
    Roblox's 200,000-character assignment ceiling, and a script that has already crossed it
    runs fine while being permanently uneditable by tooling — a trap that cost Stellar
    Dominion a real diagnosis. (LESSONS.md C-08.) Track blobs are far smaller than that, but
    a format that cannot hit the ceiling at all is cheaper than a format that merely does
    not hit it today.
    """
    parts = ['<roblox version="4">', '<Item class="Folder" referent="RBX0">',
             "<Properties><string name=\"Name\">DirtCircuitTracks</string></Properties>"]
    for i, track in enumerate(tracks):
        blob = json.dumps(to_dict(track), separators=(",", ":"))
        parts.append(f'<Item class="StringValue" referent="RBX{i + 1}">')
        parts.append("<Properties>")
        parts.append(f'<string name="Name">{sax.escape(track.id)}</string>')
        parts.append(f'<string name="Value">{sax.escape(blob)}</string>')
        parts.append("</Properties>")
        parts.append("</Item>")
    parts.append("</Item>")
    parts.append("</roblox>")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts), encoding="utf-8")


def write_contact_sheet(tracks: List[Track], path: Path) -> None:
    """One HTML page embedding every preview, so reviewing the whole pool is one file open."""
    rows = []
    for track in tracks:
        rows.append(
            f'<figure><img src="{track.id}.svg" alt="{sax.escape(track.name)}" loading="lazy">'
            f"<figcaption>{sax.escape(track.id)} &middot; {sax.escape(track.name)} &middot; "
            f"{track.length:.0f} studs</figcaption></figure>"
        )
    html = f"""<!doctype html>
<meta charset="utf-8">
<title>Dirt Circuit - track pool</title>
<style>
  body {{ background:#1b1a20; color:#efe9dd; font:14px/1.5 system-ui,sans-serif; margin:24px; }}
  h1 {{ font-size:20px; font-weight:600; margin:0 0 4px; }}
  p.sub {{ color:#a49b8c; margin:0 0 24px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:20px; }}
  figure {{ margin:0; background:#242229; border-radius:10px; padding:10px; }}
  img {{ width:100%; height:auto; border-radius:6px; display:block; }}
  figcaption {{ margin-top:8px; font-family:ui-monospace,monospace; font-size:12px; color:#b8ae9d; }}
</style>
<h1>Dirt Circuit &mdash; track pool</h1>
<p class="sub">{len(tracks)} tracks. Every one passed the gate harness in tools/trackgen/validate.py.</p>
<div class="grid">
{chr(10).join(rows)}
</div>
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
