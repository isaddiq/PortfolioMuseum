// Walkable grid for movement: click-to-move, walks to exhibits, and the
// museum's robots and cats all follow a planned path instead of a
// straight line, so the camera never slides through a bench, a plinth or a
// wall and then snaps out of it.
//
// The floor is rasterised into 25 cm cells. A cell is walkable when it lies
// inside a room and at least one body radius (plus a margin) away from every
// static collider. Paths come from A* over the 8-connected grid, are pulled
// taut by line-of-sight checks, and have their corners rounded off where the
// rounded line is still clear.

import { ROOMS, roomAt } from './world.js';

const CELL = 0.25;
const SQRT2 = Math.SQRT2;

export class NavGrid {
    /**
     * @param {Array} colliders world colliders (rects and circles); people are skipped
     * @param {number} radius clearance kept from every obstacle
     */
    constructor(colliders, { radius = 0.42 } = {}) {
        let x1 = Infinity, z1 = Infinity, x2 = -Infinity, z2 = -Infinity;
        for (const r of ROOMS) {
            x1 = Math.min(x1, r.rect[0]); z1 = Math.min(z1, r.rect[1]);
            x2 = Math.max(x2, r.rect[2]); z2 = Math.max(z2, r.rect[3]);
        }
        this.x0 = x1;
        this.z0 = z1;
        this.w = Math.ceil((x2 - x1) / CELL);
        this.h = Math.ceil((z2 - z1) / CELL);
        this.radius = radius;
        this.cells = new Uint8Array(this.w * this.h);
        for (let j = 0; j < this.h; j++) {
            const z = this.z0 + (j + 0.5) * CELL;
            for (let i = 0; i < this.w; i++) {
                const x = this.x0 + (i + 0.5) * CELL;
                this.cells[j * this.w + i] = roomAt(x, z) ? 1 : 0;
            }
        }
        for (const c of colliders) if (!c.person) this.block(c);
    }

    /** Mark the cells an obstacle (grown by the clearance radius) covers. */
    block(c) {
        const R = this.radius;
        if (c.r !== undefined) {
            const rr = c.r + R;
            const [i1, j1] = this.cellOf(c.x - rr, c.z - rr);
            const [i2, j2] = this.cellOf(c.x + rr, c.z + rr);
            for (let j = Math.max(0, j1); j <= Math.min(this.h - 1, j2); j++) {
                for (let i = Math.max(0, i1); i <= Math.min(this.w - 1, i2); i++) {
                    const x = this.x0 + (i + 0.5) * CELL;
                    const z = this.z0 + (j + 0.5) * CELL;
                    if (Math.hypot(x - c.x, z - c.z) < rr) this.cells[j * this.w + i] = 0;
                }
            }
        } else {
            const [i1, j1] = this.cellOf(c.x1 - R, c.z1 - R);
            const [i2, j2] = this.cellOf(c.x2 + R, c.z2 + R);
            for (let j = Math.max(0, j1); j <= Math.min(this.h - 1, j2); j++) {
                for (let i = Math.max(0, i1); i <= Math.min(this.w - 1, i2); i++) {
                    const x = this.x0 + (i + 0.5) * CELL;
                    const z = this.z0 + (j + 0.5) * CELL;
                    // Distance from the cell centre to the rectangle.
                    const dx = Math.max(c.x1 - x, 0, x - c.x2);
                    const dz = Math.max(c.z1 - z, 0, z - c.z2);
                    if (dx * dx + dz * dz < R * R) this.cells[j * this.w + i] = 0;
                }
            }
        }
    }

    cellOf(x, z) {
        return [Math.floor((x - this.x0) / CELL), Math.floor((z - this.z0) / CELL)];
    }

    centre(i, j) {
        return { x: this.x0 + (i + 0.5) * CELL, z: this.z0 + (j + 0.5) * CELL };
    }

    open(i, j) {
        return i >= 0 && j >= 0 && i < this.w && j < this.h && this.cells[j * this.w + i] === 1;
    }

    walkable(x, z) {
        const [i, j] = this.cellOf(x, z);
        return this.open(i, j);
    }

    /** The walkable point nearest to (x, z), searched ring by ring up to maxR metres. */
    nearestWalkable(x, z, maxR = 3) {
        const [ci, cj] = this.cellOf(x, z);
        if (this.open(ci, cj)) return { x, z };
        const rings = Math.ceil(maxR / CELL);
        let best = null;
        let bestD = Infinity;
        for (let r = 1; r <= rings; r++) {
            for (let dj = -r; dj <= r; dj++) {
                for (let di = -r; di <= r; di++) {
                    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
                    if (!this.open(ci + di, cj + dj)) continue;
                    const p = this.centre(ci + di, cj + dj);
                    const d = Math.hypot(p.x - x, p.z - z);
                    if (d < bestD) { bestD = d; best = p; }
                }
            }
            // Anything found on this ring beats every later ring's corners.
            if (best && bestD <= (r + 0.5) * CELL) return best;
        }
        return best;
    }

    /** Whether the straight line between two points stays on walkable cells. */
    lineWalkable(a, b) {
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(d / (CELL * 0.4)));
        for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            if (!this.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
        }
        return true;
    }

    /**
     * A walkable path from a to b as a list of points (a first), or null.
     * The ends are snapped onto the grid when they sit just off it.
     */
    findPath(a, b) {
        const start = this.nearestWalkable(a.x, a.z, 1.6);
        const goal = this.nearestWalkable(b.x, b.z, 2.5);
        if (!start || !goal) return null;
        if (this.lineWalkable(start, goal)) return this.finish(a, start, [goal]);
        const [si, sj] = this.cellOf(start.x, start.z);
        const [gi, gj] = this.cellOf(goal.x, goal.z);
        const W = this.w;
        const N = this.w * this.h;
        const g = new Float32Array(N).fill(Infinity);
        const came = new Int32Array(N).fill(-1);
        const closed = new Uint8Array(N);
        const heap = new MinHeap();
        const s = sj * W + si;
        const goalIdx = gj * W + gi;
        const h = (i, j) => {
            const dx = Math.abs(i - gi);
            const dz = Math.abs(j - gj);
            return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz));
        };
        g[s] = 0;
        heap.push(s, h(si, sj));
        let found = false;
        let expanded = 0;
        while (heap.size) {
            const u = heap.pop();
            if (closed[u]) continue;
            if (u === goalIdx) { found = true; break; }
            closed[u] = 1;
            if (++expanded > 60000) break;
            const ui = u % W;
            const uj = (u - ui) / W;
            for (let dj = -1; dj <= 1; dj++) {
                for (let di = -1; di <= 1; di++) {
                    if (!di && !dj) continue;
                    const vi = ui + di;
                    const vj = uj + dj;
                    if (!this.open(vi, vj)) continue;
                    // No cutting corners past a blocked cell.
                    if (di && dj && (!this.open(ui + di, uj) || !this.open(ui, uj + dj))) continue;
                    const v = vj * W + vi;
                    if (closed[v]) continue;
                    const cost = g[u] + (di && dj ? SQRT2 : 1);
                    if (cost < g[v]) {
                        g[v] = cost;
                        came[v] = u;
                        heap.push(v, cost + h(vi, vj));
                    }
                }
            }
        }
        if (!found) return null;
        const cells = [];
        for (let k = goalIdx; k !== -1; k = came[k]) cells.push(k);
        cells.reverse();
        const raw = cells.map((k) => this.centre(k % W, Math.floor(k / W)));
        raw[0] = start;
        raw[raw.length - 1] = goal;
        return this.finish(a, start, this.taut(start, raw).slice(1));
    }

    /** Prefix the true start when it differs from the snapped one. */
    finish(a, start, rest) {
        const out = [{ x: a.x, z: a.z }];
        if (Math.hypot(start.x - a.x, start.z - a.z) > 0.05) out.push(start);
        return out.concat(rest);
    }

    /** Pull a cell path taut: keep only the points where the line of sight breaks. */
    taut(start, pts) {
        const out = [start];
        let anchor = start;
        let i = 1;
        while (i < pts.length) {
            let j = i;
            while (j + 1 < pts.length && this.lineWalkable(anchor, pts[j + 1])) j += 1;
            out.push(pts[j]);
            anchor = pts[j];
            i = j + 1;
        }
        return out;
    }

    /**
     * Round each corner with a short fillet (a few points on a quadratic
     * curve), kept only where the curve stays on walkable cells.
     */
    smooth(points, reach = 0.9) {
        if (points.length < 3) return points;
        const out = [points[0]];
        for (let k = 1; k < points.length - 1; k++) {
            const p = points[k];
            const a = points[k - 1];
            const b = points[k + 1];
            const la = Math.hypot(p.x - a.x, p.z - a.z);
            const lb = Math.hypot(b.x - p.x, b.z - p.z);
            const r = Math.min(reach, la * 0.45, lb * 0.45);
            if (r < 0.08) { out.push(p); continue; }
            const p0 = { x: p.x + ((a.x - p.x) / la) * r, z: p.z + ((a.z - p.z) / la) * r };
            const p2 = { x: p.x + ((b.x - p.x) / lb) * r, z: p.z + ((b.z - p.z) / lb) * r };
            const curve = [];
            for (let s = 0; s <= 4; s++) {
                const t = s / 4;
                const u = 1 - t;
                curve.push({ x: u * u * p0.x + 2 * u * t * p.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * p.z + t * t * p2.z });
            }
            const ok = curve.every((c, i) => i === 0 || this.lineWalkable(curve[i - 1], c));
            if (ok) out.push(...curve); else out.push(p);
        }
        out.push(points[points.length - 1]);
        return out;
    }
}

/** Length of a polyline. */
export function pathLength(points) {
    let L = 0;
    for (let i = 1; i < points.length; i++) L += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    return L;
}

class MinHeap {
    constructor() {
        this.ids = [];
        this.keys = [];
    }
    get size() { return this.ids.length; }
    push(id, key) {
        const ids = this.ids;
        const keys = this.keys;
        let i = ids.length;
        ids.push(id);
        keys.push(key);
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (keys[p] <= key) break;
            ids[i] = ids[p]; keys[i] = keys[p];
            i = p;
        }
        ids[i] = id; keys[i] = key;
    }
    pop() {
        const ids = this.ids;
        const keys = this.keys;
        const top = ids[0];
        const lastId = ids.pop();
        const lastKey = keys.pop();
        const n = ids.length;
        if (n) {
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                if (l >= n) break;
                const r = l + 1;
                const c = r < n && keys[r] < keys[l] ? r : l;
                if (keys[c] >= lastKey) break;
                ids[i] = ids[c]; keys[i] = keys[c];
                i = c;
            }
            ids[i] = lastId; keys[i] = lastKey;
        }
        return top;
    }
}
