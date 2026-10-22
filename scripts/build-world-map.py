"""
Builds the dotted world map shown by the hologram projector in the
Activities gallery (Gallery VIII).

    python scripts/build-world-map.py

Reads   Natural Earth land outlines (world-atlas land-110m TopoJSON, public
        domain), downloaded from jsdelivr
Writes  data/world-dots.json   {step, cols, rows, runs}

`runs[r]` lists [start, length] pairs of land cells in row r (row 0 is the
north edge at 90 N, column 0 is 180 W); each cell is `step` degrees square.
The museum turns every land cell into a glowing dot. Only needs re-running to
change the resolution.
"""

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "world-dots.json"
SOURCE = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json"
STEP = 1.5


def decode_arcs(topo):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append((x * sx + tx, y * sy + ty))
        arcs.append(points)
    return arcs


def ring_points(arcs, ring):
    points = []
    for index in ring:
        arc = arcs[index] if index >= 0 else list(reversed(arcs[~index]))
        points.extend(arc if not points else arc[1:])
    return points


def polygons(topo):
    arcs = decode_arcs(topo)
    out = []
    for geometry in topo["objects"]["land"]["geometries"]:
        polys = geometry["arcs"] if geometry["type"] == "MultiPolygon" else [geometry["arcs"]]
        for poly in polys:
            rings = [ring_points(arcs, ring) for ring in poly]
            xs = [p[0] for p in rings[0]]
            ys = [p[1] for p in rings[0]]
            out.append({"rings": rings, "box": (min(xs), min(ys), max(xs), max(ys))})
    return out


def inside_ring(x, y, ring):
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def is_land(x, y, polys):
    for poly in polys:
        x1, y1, x2, y2 = poly["box"]
        if x < x1 or x > x2 or y < y1 or y > y2:
            continue
        rings = poly["rings"]
        if inside_ring(x, y, rings[0]) and not any(inside_ring(x, y, hole) for hole in rings[1:]):
            return True
    return False


def build():
    with urllib.request.urlopen(SOURCE) as response:
        topo = json.load(response)
    polys = polygons(topo)
    cols = round(360 / STEP)
    rows = round(180 / STEP)
    runs = []
    for r in range(rows):
        lat = 90 - (r + 0.5) * STEP
        row = []
        start = None
        for c in range(cols + 1):
            land = c < cols and is_land(-180 + (c + 0.5) * STEP, lat, polys)
            if land and start is None:
                start = c
            elif not land and start is not None:
                row.append([start, c - start])
                start = None
        runs.append(row)
    OUT.write_text(json.dumps({"step": STEP, "cols": cols, "rows": rows, "runs": runs}, separators=(",", ":")) + "\n", encoding="utf-8")
    cells = sum(n for row in runs for _, n in row)
    print(f"{cells} land cells -> {OUT.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    build()
