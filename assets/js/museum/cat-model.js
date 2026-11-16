// A cat, built in code.
//
// Body: sculpted the way a modeller blocks out an animal, from soft masses.
// Ribcage, loin, rump, shoulder, thigh, gaskin, cheek, muzzle and the rest
// are each a rounded primitive on the skeleton; they melt into one another
// (a smooth union of distance fields) and the surface of the result is
// meshed once (surface nets), finer over the head than over the body. So the
// thigh runs into the flank, the neck into the chest and the cheeks into the
// skull without a seam, and every vertex is skinned to the bones of the
// masses it came from.
//
// Legs: real feline joints (shoulder, elbow, wrist; hip, stifle, hock), posed
// by inverse kinematics from where each paw should be. Paws stay planted
// through a stride and reach the floor in every pose.
//
// Coat: painted per vertex from the anatomy (mackerel tabby or tuxedo), with
// shell fur over it: thin copies of the body pushed out along its normals,
// each keeping fewer strands, combed the way a cat's coat lies and longer on
// the ruff, belly and tail than on the face and paws.
//
// Face: almond eye openings carved into the skull, a glossy eye with a slit
// pupil behind each, lids that close, leather nose, whiskers, thin cupped
// ears on hinges.
//
// Model space: the cat faces +z, y is up, paws on y = 0.
// The whole cat is five draw calls plus one per fur shell.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const mix = (a, b, t) => a + (b - a) * t;
const SHELLS = 8;
const FUR_LEN = 0.0095;

// ---------------------------------------------------------------------------
// Skeleton (rest pose: standing square)
// ---------------------------------------------------------------------------

const J = {
    hips: [0, 0.232, -0.135], spine: [0, 0.236, -0.035], chest: [0, 0.23, 0.06], ribs: [0, 0.212, 0.02],
    neck: [0, 0.25, 0.148], head: [0, 0.292, 0.2],
    shoulder: [0.04, 0.178, 0.128], elbow: [0.044, 0.117, 0.084], wrist: [0.041, 0.043, 0.098], fpaw: [0.041, 0.012, 0.114],
    hip: [0.04, 0.212, -0.15], knee: [0.051, 0.128, -0.094], hock: [0.044, 0.08, -0.184], hpaw: [0.044, 0.012, -0.166],
    tail: [0, 0.236, -0.212]
};
const TAIL = { n: 9, step: 0.033 };
/** Centre of the skull; the face is laid out around it. */
const C = [0, 0.306, 0.236];
const EYE = [0.0204, 0.0072, 0.0296];       // from C, mirrored in x
const EYE_R = 0.0094;
const EAR = [0.0255, 0.0305, -0.011];
const NOSE = [0, -0.0106, 0.0655];
const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const LIMB = {
    f: [len(J.shoulder, J.elbow), len(J.elbow, J.wrist), len(J.wrist, J.fpaw)],
    h: [len(J.hip, J.knee), len(J.knee, J.hock), len(J.hock, J.hpaw)]
};

function makeSkeleton() {
    const bones = [];
    const add = (name, world, parent) => {
        const b = new THREE.Bone();
        b.name = name;
        b.userData.world = new THREE.Vector3(...world);
        if (parent) {
            b.position.copy(b.userData.world).sub(parent.userData.world);
            parent.add(b);
        } else b.position.copy(b.userData.world);
        b.userData.rest = b.position.clone();
        b.userData.index = bones.length;
        bones.push(b);
        return b;
    };
    const side = (p, s) => [p[0] * s, p[1], p[2]];
    const hips = add('hips', J.hips);
    const spine = add('spine', J.spine, hips);
    const chest = add('chest', J.chest, spine);
    const ribs = add('ribs', J.ribs, chest);
    const neck = add('neck', J.neck, chest);
    const head = add('head', J.head, neck);
    const ears = [-1, 1].map((s) => add(`ear${s}`, [C[0] + EAR[0] * s, C[1] + EAR[1], C[2] + EAR[2]], head));
    const lids = [-1, 1].map((s) => add(`lid${s}`, [C[0] + EYE[0] * s, C[1] + EYE[1], C[2] + EYE[2]], head));
    const front = [-1, 1].map((s) => {
        const a = add(`shoulder${s}`, side(J.shoulder, s), chest);
        const b = add(`elbow${s}`, side(J.elbow, s), a);
        const c = add(`wrist${s}`, side(J.wrist, s), b);
        return [a, b, c];
    });
    const hind = [-1, 1].map((s) => {
        const a = add(`hip${s}`, side(J.hip, s), hips);
        const b = add(`knee${s}`, side(J.knee, s), a);
        const c = add(`hock${s}`, side(J.hock, s), b);
        return [a, b, c];
    });
    const tail = [];
    let parent = hips;
    for (let k = 0; k < TAIL.n; k++) {
        const b = add(`tail${k}`, [0, J.tail[1], J.tail[2] - k * TAIL.step], parent);
        tail.push(b);
        parent = b;
    }
    return { bones, hips, spine, chest, ribs, neck, head, ears, lids, front, hind, tail };
}

// ---------------------------------------------------------------------------
// The body as soft masses
// ---------------------------------------------------------------------------

/**
 * The masses of the body. Each is a tapered capsule (a..b, radii ra..rb) or
 * an ellipsoid, squashed sideways by sx, melting into its neighbours over k
 * metres, and carried by one bone (or two, shading from a to b).
 */
function bodyMasses(I) {
    const list = [];
    const cap = (a, b, ra, rb, bones, o = {}) => list.push({ a, b, ra, rb, bones, sx: 1, k: 0.02, tag: 'trunk', ...o });
    const ball = (c, r, bone, o = {}) => list.push({ c, r: Array.isArray(r) ? r : [r, r, r], bones: [bone, bone], k: 0.014, tag: 'trunk', ...o });
    const h = (x, y, z) => [C[0] + x, C[1] + y, C[2] + z];

    // Trunk: rump, loin, a deep ribcage, and the neck rising from the chest.
    cap([0, 0.224, -0.172], [0, 0.23, -0.05], 0.054, 0.058, [I.hips, I.spine], { sx: 0.9, k: 0.03 });
    cap([0, 0.23, -0.05], [0, 0.214, 0.066], 0.058, 0.071, [I.spine, I.chest], { sx: 0.8, k: 0.03 });
    cap([0, 0.214, 0.066], [0, 0.238, 0.13], 0.071, 0.05, [I.chest, I.chest], { sx: 0.8, k: 0.03 });
    ball([0, 0.208, 0.03], [0.057, 0.067, 0.08], I.ribs, { k: 0.02 });
    ball([0, 0.208, -0.188], [0.047, 0.05, 0.04], I.hips, { k: 0.025 });
    ball([0, 0.186, 0.118], [0.04, 0.046, 0.04], I.chest, { k: 0.025 });
    cap([0, 0.24, 0.128], [0, 0.284, 0.194], 0.045, 0.036, [I.neck, I.head], { sx: 0.88, k: 0.028, tag: 'neck' });
    cap([0, 0.203, 0.15], [0, 0.264, 0.21], 0.027, 0.024, [I.neck, I.head], { k: 0.025, tag: 'neck' });
    cap([0, 0.236, -0.19], [0, 0.236, -0.225], 0.022, 0.016, [I.hips, I.hips], { k: 0.02, tag: 'tail' });

    for (const s of [-1, 1]) {
        const k = s < 0 ? 0 : 1;
        const m = (p) => [p[0] * s, p[1], p[2]];
        const [sh, el, wr] = I.front[k];
        const [hp, kn, hk] = I.hind[k];
        // Foreleg: shoulder blade, upper arm, forearm, wrist and paw.
        ball(m([0.043, 0.214, 0.102]), [0.023, 0.052, 0.04], I.chest, { k: 0.03 });
        cap(m([0.041, 0.182, 0.124]), m(J.elbow), 0.029, 0.0215, [sh, sh], { k: 0.022, tag: 'fleg' });
        cap(m(J.elbow), m(J.wrist), 0.0205, 0.0138, [el, el], { k: 0.012, tag: 'fleg' });
        cap(m(J.wrist), m([0.041, 0.017, 0.109]), 0.0138, 0.0152, [wr, wr], { k: 0.01, tag: 'fpaw' });
        ball(m([0.041, 0.0118, 0.116]), [0.0178, 0.0118, 0.0225], wr, { k: 0.008, tag: 'fpaw' });
        for (let t = 0; t < 4; t++) {
            const u = t - 1.5;
            ball(m([0.041 + u * 0.0072, 0.0092, 0.1325 - Math.abs(u) * 0.0034]), 0.0066, wr, { k: 0.0035, tag: 'fpaw' });
        }
        // Hind leg: a broad flat thigh, the gaskin tapering to the hock, the long hind foot.
        cap(m([0.04, 0.208, -0.153]), m(J.knee), 0.047, 0.026, [hp, hp], { sx: 0.66, k: 0.026, tag: 'hleg' });
        ball(m([0.047, 0.165, -0.142]), [0.027, 0.05, 0.042], hp, { k: 0.02, tag: 'hleg' });
        cap(m(J.knee), m(J.hock), 0.0235, 0.0128, [kn, kn], { k: 0.012, tag: 'hleg' });
        ball(m([0.044, 0.082, -0.187]), 0.0138, kn, { k: 0.008, tag: 'hleg' });
        cap(m(J.hock), m([0.044, 0.02, -0.168]), 0.0126, 0.0138, [hk, hk], { k: 0.01, tag: 'hpaw' });
        ball(m([0.044, 0.0118, -0.158]), [0.0172, 0.0118, 0.0245], hk, { k: 0.008, tag: 'hpaw' });
        for (let t = 0; t < 4; t++) {
            const u = t - 1.5;
            ball(m([0.044 + u * 0.007, 0.0092, -0.1405 - Math.abs(u) * 0.0034]), 0.0064, hk, { k: 0.0035, tag: 'hpaw' });
        }
    }

    // Head: skull, brow, cheeks, the bridge of the nose, whisker pads, chin and jaw.
    const H = { tag: 'head' };
    ball(h(0, 0.004, -0.005), [0.0435, 0.04, 0.045], I.head, { ...H, k: 0.02 });
    ball(h(0, 0.013, 0.02), [0.035, 0.026, 0.026], I.head, { ...H, k: 0.016 });
    cap(h(0, 0.005, 0.028), h(0, -0.0078, 0.0575), 0.0126, 0.0084, [I.head, I.head], { ...H, k: 0.012 });
    cap(h(0, -0.027, 0.03), h(0, -0.022, -0.012), 0.014, 0.021, [I.head, I.head], { ...H, k: 0.016 });
    ball(h(0, -0.0165, 0.0435), [0.0165, 0.013, 0.0172], I.head, { ...H, k: 0.012 });
    ball(h(0, -0.0302, 0.0412), 0.0092, I.head, { ...H, k: 0.007 });
    for (const s of [-1, 1]) {
        ball(h(s * 0.027, -0.014, 0.005), [0.0205, 0.0195, 0.026], I.head, { ...H, k: 0.016 });
        ball(h(s * 0.0088, -0.0186, 0.0525), 0.0104, I.head, { ...H, k: 0.005 });
        ball(h(s * 0.0215, 0.0215, 0.025), 0.012, I.head, { ...H, k: 0.012 });
    }
    return list;
}

/** The eye openings: carved out of the head, almond shaped, the outer corner a little higher. */
function carvings() {
    return [-1, 1].map((s) => {
        const tilt = s * 0.2;
        return { c: [C[0] + EYE[0] * s, C[1] + EYE[1], C[2] + EYE[2] + 0.006], r: [0.0106, 0.0066, 0.0082], cos: Math.cos(tilt), sin: Math.sin(tilt), k: 0.003 };
    });
}

function massDistance(m, x, y, z) {
    if (m.c) {
        const qx = (x - m.c[0]) / m.r[0];
        const qy = (y - m.c[1]) / m.r[1];
        const qz = (z - m.c[2]) / m.r[2];
        const k0 = Math.hypot(qx, qy, qz);
        if (k0 < 1e-6) return -Math.min(m.r[0], m.r[1], m.r[2]);
        const k1 = Math.hypot(qx / m.r[0], qy / m.r[1], qz / m.r[2]);
        m.t = 0;
        return k0 * (k0 - 1) / k1;
    }
    const sx = m.sx;
    const px = (x - m.a[0]) / sx;
    const py = y - m.a[1];
    const pz = z - m.a[2];
    const bx = (m.b[0] - m.a[0]) / sx;
    const by = m.b[1] - m.a[1];
    const bz = m.b[2] - m.a[2];
    const t = clamp((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz), 0, 1);
    m.t = t;
    return (Math.hypot(px - bx * t, py - by * t, pz - bz * t) - mix(m.ra, m.rb, t)) * Math.min(1, sx + 0.12);
}

function massBounds(m, pad) {
    if (m.c) return [m.c[0] - m.r[0] - pad, m.c[1] - m.r[1] - pad, m.c[2] - m.r[2] - pad, m.c[0] + m.r[0] + pad, m.c[1] + m.r[1] + pad, m.c[2] + m.r[2] + pad];
    const r = Math.max(m.ra, m.rb) + pad;
    return [Math.min(m.a[0], m.b[0]) - r, Math.min(m.a[1], m.b[1]) - r, Math.min(m.a[2], m.b[2]) - r, Math.max(m.a[0], m.b[0]) + r, Math.max(m.a[1], m.b[1]) + r, Math.max(m.a[2], m.b[2]) + r];
}

/** Lattice lines from a to b, `fine` apart inside [f0, f1] and `coarse` apart outside. */
function lattice(a, b, coarse, fine = coarse, f0 = Infinity, f1 = -Infinity) {
    const out = [];
    let x = a;
    while (x < b) {
        out.push(x);
        x += x >= f0 - coarse && x <= f1 ? fine : coarse;
    }
    out.push(x);
    return Float32Array.from(out);
}

/**
 * Sample the union of the masses on a lattice and mesh its surface (naive
 * surface nets: one vertex per cell the surface crosses, placed at the mean
 * of the crossings on its edges). Returns positions and triangle indices.
 */
function meshMasses(masses, carves, xs, ys, zs) {
    const nx = xs.length;
    const ny = ys.length;
    const nz = zs.length;
    const F = new Float32Array(nx * ny * nz).fill(1);
    const at = (i, j, k) => i + nx * (j + ny * k);
    const span = (arr, lo, hi) => {
        let a = 0;
        while (a < arr.length - 1 && arr[a + 1] < lo) a++;
        let b = arr.length - 1;
        while (b > 0 && arr[b - 1] > hi) b--;
        return [a, b];
    };
    for (const m of masses) {
        const bb = massBounds(m, m.k + 0.008);
        const [i0, i1] = span(xs, bb[0], bb[3]);
        const [j0, j1] = span(ys, bb[1], bb[4]);
        const [k0, k1] = span(zs, bb[2], bb[5]);
        const kk = m.k;
        for (let k = k0; k <= k1; k++) {
            for (let j = j0; j <= j1; j++) {
                for (let i = i0; i <= i1; i++) {
                    const d = massDistance(m, xs[i], ys[j], zs[k]);
                    const o = at(i, j, k);
                    const f = F[o];
                    const hgt = Math.max(kk - Math.abs(f - d), 0) / kk;
                    F[o] = Math.min(f, d) - hgt * hgt * kk * 0.25;
                }
            }
        }
    }
    for (const c of carves) {
        const pad = 0.012;
        const [i0, i1] = span(xs, c.c[0] - c.r[0] - pad, c.c[0] + c.r[0] + pad);
        const [j0, j1] = span(ys, c.c[1] - c.r[1] - pad, c.c[1] + c.r[1] + pad);
        const [k0, k1] = span(zs, c.c[2] - c.r[2] - pad, c.c[2] + c.r[2] + pad);
        for (let k = k0; k <= k1; k++) {
            for (let j = j0; j <= j1; j++) {
                for (let i = i0; i <= i1; i++) {
                    const dx = xs[i] - c.c[0];
                    const dy = ys[j] - c.c[1];
                    const qx = (dx * c.cos + dy * c.sin) / c.r[0];
                    const qy = (-dx * c.sin + dy * c.cos) / c.r[1];
                    const qz = (zs[k] - c.c[2]) / c.r[2];
                    const k0d = Math.hypot(qx, qy, qz);
                    const k1d = Math.hypot(qx / c.r[0], qy / c.r[1], qz / c.r[2]) || 1;
                    const d = -(k0d * (k0d - 1) / k1d);
                    const o = at(i, j, k);
                    const f = F[o];
                    const hgt = Math.max(c.k - Math.abs(f - d), 0) / c.k;
                    F[o] = Math.max(f, d) + hgt * hgt * c.k * 0.25;
                }
            }
        }
    }

    const cell = new Int32Array(nx * ny * nz).fill(-1);
    const pos = [];
    const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const f = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) {
        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                let neg = 0;
                for (let c = 0; c < 8; c++) {
                    f[c] = F[at(i + corner[c][0], j + corner[c][1], k + corner[c][2])];
                    if (f[c] < 0) neg++;
                }
                if (neg === 0 || neg === 8) continue;
                let sx = 0;
                let sy = 0;
                let sz = 0;
                let n = 0;
                for (const [a, b] of edges) {
                    if ((f[a] < 0) === (f[b] < 0)) continue;
                    const t = f[a] / (f[a] - f[b]);
                    const ca = corner[a];
                    const cb = corner[b];
                    sx += mix(xs[i + ca[0]], xs[i + cb[0]], t);
                    sy += mix(ys[j + ca[1]], ys[j + cb[1]], t);
                    sz += mix(zs[k + ca[2]], zs[k + cb[2]], t);
                    n++;
                }
                cell[at(i, j, k)] = pos.length / 3;
                pos.push(sx / n, sy / n, sz / n);
            }
        }
    }
    const idx = [];
    const quad = (a, b, c, d, flip) => {
        if (a < 0 || b < 0 || c < 0 || d < 0) return;
        if (flip) idx.push(a, c, b, a, d, c);
        else idx.push(a, b, c, a, c, d);
    };
    for (let k = 1; k < nz - 1; k++) {
        for (let j = 1; j < ny - 1; j++) {
            for (let i = 1; i < nx - 1; i++) {
                const f0 = F[at(i, j, k)];
                const inside = f0 < 0;
                if (inside !== (F[at(i + 1, j, k)] < 0)) quad(cell[at(i, j - 1, k - 1)], cell[at(i, j, k - 1)], cell[at(i, j, k)], cell[at(i, j - 1, k)], !inside);
                if (inside !== (F[at(i, j + 1, k)] < 0)) quad(cell[at(i - 1, j, k - 1)], cell[at(i - 1, j, k)], cell[at(i, j, k)], cell[at(i, j, k - 1)], !inside);
                if (inside !== (F[at(i, j, k + 1)] < 0)) quad(cell[at(i - 1, j - 1, k)], cell[at(i, j - 1, k)], cell[at(i, j, k)], cell[at(i - 1, j, k)], !inside);
            }
        }
    }
    return { pos: Float32Array.from(pos), idx };
}

/** Skin every vertex to the bones of the masses it sits on; note which part of the body it is. */
function skinToMasses(masses, pos) {
    const n = pos.length / 3;
    const skinI = new Uint16Array(n * 4);
    const skinW = new Float32Array(n * 4);
    const tags = new Array(n);
    const bounds = masses.map((m) => massBounds(m, 0.02));
    const acc = new Map();
    for (let v = 0; v < n; v++) {
        const x = pos[v * 3];
        const y = pos[v * 3 + 1];
        const z = pos[v * 3 + 2];
        acc.clear();
        let best = Infinity;
        let tag = 'trunk';
        masses.forEach((m, i) => {
            const b = bounds[i];
            if (x < b[0] || y < b[1] || z < b[2] || x > b[3] || y > b[4] || z > b[5]) return;
            const d = massDistance(m, x, y, z);
            if (d < best) { best = d; tag = m.tag; }
            const w = Math.exp(-Math.max(d, 0) / 0.0045);
            if (w < 1e-3) return;
            const t = m.c ? 0 : smooth(m.t);
            acc.set(m.bones[0], (acc.get(m.bones[0]) || 0) + w * (1 - t));
            acc.set(m.bones[1], (acc.get(m.bones[1]) || 0) + w * t);
        });
        const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = top.reduce((s, e) => s + e[1], 0) || 1;
        top.forEach(([bone, w], k) => { skinI[v * 4 + k] = bone; skinW[v * 4 + k] = w / sum; });
        tags[v] = tag;
    }
    return { skinI, skinW, tags };
}

// ---------------------------------------------------------------------------
// Coat
// ---------------------------------------------------------------------------

function hash3(x, y, z) {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

function noise3(x, y, z) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const w = smooth(z - zi);
    const h = (a, b, c) => hash3(xi + a, yi + b, zi + c);
    return mix(mix(mix(h(0, 0, 0), h(1, 0, 0), u), mix(h(0, 1, 0), h(1, 1, 0), u), v), mix(mix(h(0, 0, 1), h(1, 0, 1), u), mix(h(0, 1, 1), h(1, 1, 1), u), v), w);
}

const stripe = (s, width = 0.5) => smooth((Math.sin(s * TAU) - (1 - width * 2) * 0.6) / 0.55);

/**
 * The colour of the coat at a point of the rest pose.
 * p: position; n: normal; tag: part of the body. Returns [dark, pale, white]
 * amounts that the cat's palette is then mixed by.
 */
function coatAt(spec, p, n, tag) {
    const [x, y, z] = p;
    const up = n[1];
    const out = n[0] * Math.sign(x || 1);      // 1 on the outer side of a leg, -1 inside
    const hx = x - C[0];
    const hy = y - C[1];
    const hz = z - C[2];
    const warp = (noise3(x * 26, y * 26, z * 26) - 0.5);
    let dark = 0;
    let pale = 0;
    let white = 0;
    const head = tag === 'head';
    const muzzle = head ? smooth((hz - 0.027) / 0.012) * smooth((-hy - 0.006) / 0.008) * smooth((0.023 - Math.abs(hx)) / 0.007) : 0;
    const chin = head ? smooth((-hy - 0.02) / 0.008) * smooth((hz - 0.0) / 0.02) : 0;
    if (spec.tabby) {
        if (tag === 'trunk' || tag === 'neck') {
            const s = (z + 0.42 * (y - 0.23) + warp * 0.024) / 0.031;
            const flank = smooth((up + 0.3) / 0.5);
            // Broken here and there, as the stripes of a real tabby are.
            const broken = 0.55 + 0.45 * smooth((noise3(x * 9 + 4, y * 34, z * 11) - 0.28) / 0.25);
            dark = stripe(s, 0.42) * flank * 0.8 * broken * (tag === 'neck' ? 0.55 : 1);
            dark = Math.max(dark, smooth((up - 0.82) / 0.14) * 0.62);
            pale = Math.max(smooth((-up - 0.3) / 0.45) * 0.85, smooth((z - 0.118) / 0.035) * smooth((0.215 - y) / 0.05) * 0.6);
        } else if (tag === 'fleg' || tag === 'hleg') {
            dark = stripe((y + warp * 0.012) / 0.024, 0.4) * smooth((out + 0.15) / 0.5) * 0.7;
            pale = smooth((-out - 0.15) / 0.5) * 0.5;
        } else if (tag === 'fpaw' || tag === 'hpaw') {
            pale = 0.1 + smooth((0.016 - y) / 0.012) * 0.2;
        } else if (tag === 'tail') {
            dark = stripe((z + warp * 0.008) / 0.034, 0.45) * 0.75;
            dark = Math.max(dark, smooth((J.tail[2] - TAIL.step * (TAIL.n - 1.6) - z) / 0.025) * 0.85);
        } else if (head) {
            // The tabby "M" on the forehead, lines running back over the skull, and cheek stripes.
            const top = smooth((up - 0.35) / 0.3) * smooth((hz + 0.035) / 0.02) * (1 - smooth((hz - 0.027) / 0.008));
            const cheek = smooth((Math.abs(n[0]) - 0.55) / 0.25) * (1 - smooth((hz - 0.02) / 0.012)) * smooth((0.012 - hy) / 0.01);
            dark = Math.max(stripe((hx + warp * 0.003) / 0.0085, 0.4) * top * 0.75, stripe((hy + 0.35 * hz + warp * 0.004) / 0.0095, 0.4) * cheek * 0.6);
            const eyeD = Math.hypot(Math.abs(hx) - EYE[0], hy - EYE[1], hz - EYE[2]);
            pale = Math.max(muzzle, chin, (1 - smooth((eyeD - 0.011) / 0.006)) * 0.3, smooth((-up - 0.35) / 0.4) * 0.8);
        }
        white = Math.max(muzzle * 0.75, chin * 0.9);
    } else {
        // Tuxedo: black with a white bib, belly, muzzle, blaze and socks.
        if (tag === 'trunk' || tag === 'neck') {
            const bib = smooth((z - 0.085) / 0.03) * smooth((0.238 - y) / 0.03) * smooth((0.75 - Math.abs(n[0])) / 0.3);
            const throat = tag === 'neck' ? smooth((-up + 0.1) / 0.4) * smooth((0.262 - y + warp * 0.01) / 0.02) : 0;
            const belly = smooth((-up - 0.55) / 0.25) * smooth((z + 0.2) / 0.06);
            white = Math.max(bib, throat, belly);
            dark = smooth((up - 0.5) / 0.4) * 0.5;
        } else if (tag === 'fleg' || tag === 'fpaw') {
            white = smooth((0.056 + warp * 0.012 - y) / 0.012);
        } else if (tag === 'hleg' || tag === 'hpaw') {
            white = smooth((0.05 + warp * 0.012 - y) / 0.012);
        } else if (head) {
            const blaze = smooth((0.0075 + Math.max(0, -hy) * 0.5 - Math.abs(hx)) / 0.004) * smooth((hz - 0.012) / 0.012) * smooth((0.02 - hy) / 0.01);
            white = Math.max(muzzle, chin, blaze, smooth((-up - 0.4) / 0.3) * smooth((hz + 0.01) / 0.02));
        }
    }
    // A dark rim round each eye, and darker leather round the nose and mouth.
    let liner = 0;
    if (head) {
        const eyeD = Math.hypot(Math.abs(hx) - EYE[0], hy - EYE[1], hz - EYE[2] - 0.003);
        liner = (1 - smooth((eyeD - 0.0088) / 0.002)) * 0.85;
    }
    return { dark: clamp(dark, 0, 1), pale: clamp(pale, 0, 1), white: clamp(white, 0, 1), liner };
}

/** How long the fur is here (0..1.25 of the full length) and which way it lies. */
function furAt(p, n, tag) {
    const [x, y, z] = p;
    let length = 1;
    let comb = [0, -0.32, -1];
    if (tag === 'trunk') {
        length = 0.95 + smooth((-n[1] - 0.2) / 0.6) * 0.3;
        if (z > 0.1 && y < 0.22) { length = 1.2; comb = [0, -1, 0.15]; }
    } else if (tag === 'neck') {
        length = 0.92;
        comb = [0, -0.55, -0.8];
    } else if (tag === 'fleg' || tag === 'hleg') {
        length = mix(0.34, 0.85, smooth((y - 0.05) / 0.11));
        comb = [0, -1, -0.25];
    } else if (tag === 'fpaw' || tag === 'hpaw') {
        length = 0.24;
        comb = [0, -0.6, 0.6];
    } else if (tag === 'tail') {
        length = 1.25;
        comb = [0, -0.12, -1];
    } else if (tag === 'head') {
        const hx = Math.abs(x - C[0]);
        const hy = y - C[1];
        const hz = z - C[2];
        const cheek = smooth((hx - 0.022) / 0.014) * smooth((0.012 - hy) / 0.02) * (1 - smooth((hz - 0.022) / 0.012));
        length = mix(0.3, 0.7, cheek);
        length = mix(length, 0.1, smooth((hz - 0.022) / 0.014));
        const eyeD = Math.hypot(hx - EYE[0], hy - EYE[1], hz - EYE[2]);
        length *= smooth((eyeD - 0.0105) / 0.007);
        // Nothing over the nose leather.
        length *= smooth((Math.hypot(hx, hy - NOSE[1], hz - NOSE[2]) - 0.006) / 0.005);
        comb = [Math.sign(x - C[0]) * 0.35 * cheek, 0.12 - cheek * 0.5, -1];
    }
    // Lie along the skin: drop the part of the flow that points out of it.
    const d = comb[0] * n[0] + comb[1] * n[1] + comb[2] * n[2];
    const c = [comb[0] - n[0] * d, comb[1] - n[1] * d, comb[2] - n[2] * d];
    const l = Math.hypot(c[0], c[1], c[2]) || 1;
    return { length, comb: [c[0] / l, c[1] / l, c[2] / l] };
}

/** Mix the cat's palette at a point; the result is linear RGB. */
function paletteFor(spec) {
    const col = (hex) => new THREE.Color(hex);
    return { base: col(spec.base), dark: col(spec.dark), light: col(spec.light), white: col(spec.white || '#f4efe7'), liner: col(spec.liner || '#1d1410') };
}

const tmpColor = new THREE.Color();
function coatColor(spec, pal, p, n, tag, out, o) {
    const c = coatAt(spec, p, n, tag);
    tmpColor.copy(pal.base).lerp(pal.dark, c.dark).lerp(pal.light, c.pale * (1 - c.white)).lerp(pal.white, c.white).lerp(pal.liner, c.liner);
    // Hair by hair, a little lighter or darker.
    const g = 0.92 + 0.16 * hash3(p[0] * 900, p[1] * 900, p[2] * 900);
    out[o] = tmpColor.r * g;
    out[o + 1] = tmpColor.g * g;
    out[o + 2] = tmpColor.b * g;
}

// ---------------------------------------------------------------------------
// Parts added to the sculpted body: tail, ears, eyelids
// ---------------------------------------------------------------------------

/** A flat list of vertices with everything the materials need. */
function emptyPart() {
    return { pos: [], idx: [], skinI: [], skinW: [], tags: [], fur: [] };
}

function tailPart(I, rings, segs) {
    const part = emptyPart();
    const total = TAIL.step * (TAIL.n - 1) + 0.034;
    for (let k = 0; k <= rings; k++) {
        const f = k / rings;
        const z = J.tail[2] + 0.026 - f * total;
        const tip = f > 0.93 ? Math.sqrt(Math.max(0, 1 - ((f - 0.93) / 0.07) ** 2)) : 1;
        const r = mix(0.0152, 0.0098, f) * Math.max(tip, 0.02);
        // Which tail bones carry this ring.
        const u = clamp((J.tail[2] - z) / TAIL.step, 0, TAIL.n - 1);
        const b0 = Math.floor(u);
        const t = smooth(u - b0);
        const bone = (i) => (z > J.tail[2] ? I.hips : I.tail[Math.min(TAIL.n - 1, i)]);
        for (let s = 0; s < segs; s++) {
            const a = (s / segs) * TAU;
            part.pos.push(Math.sin(a) * r, J.tail[1] + Math.cos(a) * r, z);
            part.skinI.push(bone(b0), bone(b0 + 1), 0, 0);
            part.skinW.push(1 - t, t, 0, 0);
            part.tags.push('tail');
            part.fur.push(1);
        }
    }
    for (let k = 0; k < rings; k++) {
        for (let s = 0; s < segs; s++) {
            const a = k * segs + s;
            const b = k * segs + ((s + 1) % segs);
            part.idx.push(a, a + segs, b, b, a + segs, b + segs);
        }
    }
    return part;
}

/**
 * An ear: a thin cupped triangle, wide at the base, the tip a little rounded.
 * Returns the outer (furred) and inner (pink) faces as one closed shell;
 * `inner` marks the vertices of the inside.
 */
function earPart(I, s) {
    const part = emptyPart();
    part.inner = [];
    const bone = I.ears[s < 0 ? 0 : 1];
    const O = new THREE.Vector3(C[0] + EAR[0] * s, C[1] + EAR[1], C[2] + EAR[2]);
    const up = new THREE.Vector3(s * 0.24, 0.96, -0.12).normalize();
    const face = new THREE.Vector3(s * 0.3, 0.1, 0.95).normalize();
    const across = new THREE.Vector3().crossVectors(up, face).normalize().multiplyScalar(s);
    face.crossVectors(across, up).normalize().multiplyScalar(s);
    const W = 0.047;
    const Hh = 0.057;
    const NU = 8;
    const NV = 9;
    const p = new THREE.Vector3();
    const put = (u, v, back) => {
        const vv = -0.22 + v * 1.2;                         // starts inside the skull
        const t = clamp(vv, 0, 1);
        const hw = (W / 2) * Math.pow(1 - t, 0.82) * (1 + 0.55 * t) * (vv < 0 ? 1 + vv * 0.6 : 1) + 0.0012 * (1 - t);
        const cup = (u * u) * hw * 0.5 + 0.004 * t * t;      // edges come forward; the tip leans forward
        const th = mix(0.0034, 0.0012, t) * (1 - u * u * 0.75);
        p.copy(O).addScaledVector(up, vv * Hh).addScaledVector(across, u * hw).addScaledVector(face, cup - (back ? th : 0));
        part.pos.push(p.x, p.y, p.z);
        part.skinI.push(vv < 0.05 ? I.head : bone, bone, 0, 0);
        part.skinW.push(vv < 0.05 ? 0.5 : 1, vv < 0.05 ? 0.5 : 0, 0, 0);
        part.tags.push('ear');
        part.fur.push(back ? 0.3 : 0);
        part.inner.push(back ? 0 : 1 - Math.abs(u) ** 3);
    };
    for (const back of [false, true]) {
        for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) put((i / NU) * 2 - 1, j / NV, back);
    }
    const n = NU + 1;
    const base = (back) => (back ? n * (NV + 1) : 0);
    const flipFront = s < 0;
    for (const back of [false, true]) {
        for (let j = 0; j < NV; j++) {
            for (let i = 0; i < NU; i++) {
                const a = base(back) + j * n + i;
                const b = a + 1;
                const c = a + n;
                const d = c + 1;
                if (back !== flipFront) part.idx.push(a, c, b, b, c, d);
                else part.idx.push(a, b, c, b, d, c);
            }
        }
    }
    // Close the rim.
    const rim = [];
    for (let j = 0; j <= NV; j++) rim.push(j * n);
    for (let i = 1; i <= NU; i++) rim.push(NV * n + i);
    for (let j = NV - 1; j >= 0; j--) rim.push(j * n + NU);
    for (let k = 0; k < rim.length - 1; k++) {
        const a = rim[k];
        const b = rim[k + 1];
        const c = a + base(true);
        const d = b + base(true);
        if (flipFront) part.idx.push(a, c, b, b, c, d);
        else part.idx.push(a, b, c, b, d, c);
    }
    return part;
}

/** The direction an eye looks: forward and a little out. */
const gaze = (s) => new THREE.Vector3(s * 0.2, 0.03, 1).normalize();

/** An upper eyelid: a patch of a sphere just over the eye, tucked under the brow until it blinks. */
function lidPart(I, s) {
    const part = emptyPart();
    const bone = I.lids[s < 0 ? 0 : 1];
    const centre = new THREE.Vector3(C[0] + EYE[0] * s, C[1] + EYE[1], C[2] + EYE[2]);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), gaze(s));
    const NA = 10;
    const NE = 6;
    const R = EYE_R * 1.03;
    const p = new THREE.Vector3();
    for (let j = 0; j <= NE; j++) {
        const el = mix(0.6, 1.36, j / NE);                 // elevation above the gaze
        for (let i = 0; i <= NA; i++) {
            const az = mix(-1.1, 1.1, i / NA);
            p.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(R).applyQuaternion(q).add(centre);
            part.pos.push(p.x, p.y, p.z);
            part.skinI.push(bone, 0, 0, 0);
            part.skinW.push(1, 0, 0, 0);
            part.tags.push('lid');
            part.fur.push(0);
        }
    }
    const n = NA + 1;
    for (let j = 0; j < NE; j++) {
        for (let i = 0; i < NA; i++) {
            const a = j * n + i;
            part.idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
        }
    }
    return part;
}

/** Turn a part into geometry, with its colours and fur painted for this cat. */
function partGeometry(part, spec, pal, { smoothNormals = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
    g.setIndex(part.idx);
    if (smoothNormals) g.computeVertexNormals();
    const n = part.pos.length / 3;
    const normal = g.attributes.normal.array;
    const color = new Float32Array(n * 3);
    const fur = new Float32Array(n);
    const comb = new Float32Array(n * 3);
    const inner = new THREE.Color(spec.innerEar || '#d6a39a');
    for (let v = 0; v < n; v++) {
        const p = [part.pos[v * 3], part.pos[v * 3 + 1], part.pos[v * 3 + 2]];
        const nn = [normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]];
        const tag = part.tags[v];
        if (tag === 'ear') {
            // Outside: the coat of the crown. Inside: pink skin, pale fur towards the edge.
            const k = part.inner[v];
            tmpColor.copy(pal.base).lerp(pal.dark, spec.tabby ? 0.25 : 0);
            if (k > 0) tmpColor.copy(pal.light).lerp(inner, smooth(k * 1.2));
            color[v * 3] = tmpColor.r;
            color[v * 3 + 1] = tmpColor.g;
            color[v * 3 + 2] = tmpColor.b;
            fur[v] = part.fur[v];
            comb[v * 3 + 1] = 1;
        } else if (tag === 'lid') {
            tmpColor.copy(pal.base).lerp(pal.liner, 0.18);
            color[v * 3] = tmpColor.r;
            color[v * 3 + 1] = tmpColor.g;
            color[v * 3 + 2] = tmpColor.b;
        } else {
            coatColor(spec, pal, p, nn, tag, color, v * 3);
            const f = furAt(p, nn, tag);
            fur[v] = f.length * (part.fur[v] ?? 1);
            comb.set(f.comb, v * 3);
        }
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aFur', new THREE.BufferAttribute(fur, 1));
    g.setAttribute('aComb', new THREE.BufferAttribute(comb, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(part.skinI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(part.skinW, 4));
    return g;
}

// The sculpting is the same for every cat: do it once.
let sculpt = null;

function sculptBody(I) {
    if (sculpt) return sculpt;
    const masses = bodyMasses(I);
    const carves = carvings();
    const build = (xs, ys, zs) => {
        const { pos, idx } = meshMasses(masses, carves, xs, ys, zs);
        return { pos, idx, ...skinToMasses(masses, pos) };
    };
    // Fine over the head, where the face is; coarser over the body.
    const body = build(lattice(-0.088, 0.088, 0.0029), lattice(-0.006, 0.36, 0.0036, 0.0022, 0.262, 0.4), lattice(-0.245, 0.31, 0.0038, 0.0022, 0.196, 0.4));
    // The fur shells follow the same body on a coarser net.
    const shell = build(lattice(-0.088, 0.088, 0.0046), lattice(-0.006, 0.36, 0.0052), lattice(-0.245, 0.31, 0.0052));
    sculpt = { body, shell };
    return sculpt;
}

const asPart = (m) => ({ pos: Array.from(m.pos), idx: m.idx, skinI: Array.from(m.skinI), skinW: Array.from(m.skinW), tags: m.tags, fur: [] });

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

let strandField = null;

/** Strand field for the shells: each texel is one hair, its value how long it is. */
function furStrands() {
    if (strandField) return strandField;
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
        const v = Math.pow(Math.random(), 0.75) * 255;
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
    }
    strandField = new THREE.DataTexture(data, N, N);
    strandField.wrapS = strandField.wrapT = THREE.RepeatWrapping;
    strandField.magFilter = THREE.LinearFilter;
    strandField.minFilter = THREE.LinearMipmapLinearFilter;
    strandField.generateMipmaps = true;
    strandField.needsUpdate = true;
    return strandField;
}

const STRAND_GLSL = /* glsl */ `
    // One of three flat projections of the strand field: whichever faces the skin best.
    float furStrand(vec3 p, vec3 n, float density) {
        vec3 a = abs(n);
        vec2 uv = a.x > a.y && a.x > a.z ? p.zy : (a.y > a.z ? p.xz : p.xy);
        // Sampled a little soft, so strands a pixel wide do not sparkle.
        return texture2D(uStrands, uv * density, 0.55).r;
    }`;

/** The skin under the fur: the painted coat, lit softly, brighter at the edges as fur is. */
function coatMaterial(spec) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.5 });
    const uniforms = { uStrands: { value: furStrands() }, uRim: { value: new THREE.Color(spec.sheen || spec.light).multiplyScalar(0.22) } };
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vRestP;\nvarying vec3 vRestN;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRestP = position;\nvRestN = normal;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nuniform sampler2D uStrands;\nuniform vec3 uRim;\nvarying vec3 vRestP;\nvarying vec3 vRestN;\n${STRAND_GLSL}`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                diffuseColor.rgb *= 0.88 + 0.24 * furStrand(vRestP, vRestN, 2.2);`)
            .replace('#include <opaque_fragment>', `
                float furRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
                outgoingLight += uRim * furRim * (0.35 + reflectedLight.directDiffuse + reflectedLight.indirectDiffuse);
                #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'cat-coat';
    return mat;
}

/** One layer of shell fur, `layer` of the way out to the tips. */
function shellMaterial(layer) {
    // Alpha-to-coverage softens strand edges with MSAA; the alpha test keeps them cut out without it.
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.45, alphaToCoverage: true, alphaTest: 0.5 });
    const uniforms = { uShell: { value: layer }, uFurLen: { value: FUR_LEN }, uStrands: { value: furStrands() } };
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uShell;\nuniform float uFurLen;\nattribute float aFur;\nattribute vec3 aComb;\nvarying vec3 vRestP;\nvarying vec3 vRestN;\nvarying float vFur;')
            .replace('#include <skinning_vertex>', `#include <skinning_vertex>
                vRestP = position;
                vRestN = normal;
                vFur = aFur;
                vec3 furComb = aComb;
                #ifdef USE_SKINNING
                    mat4 furSkin = bindMatrixInverse * (skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW) * bindMatrix;
                    furComb = (furSkin * vec4(aComb, 0.0)).xyz;
                #endif
                // Out along the normal; the hair lies back more and more towards its tip.
                float furH = uShell * uFurLen * aFur;
                transformed += normalize(objectNormal) * furH * (1.0 - 0.3 * uShell) + furComb * furH * uShell * 0.85;`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nuniform float uShell;\nuniform sampler2D uStrands;\nvarying vec3 vRestP;\nvarying vec3 vRestN;\nvarying float vFur;\n${STRAND_GLSL}`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                float strand = furStrand(vRestP, vRestN, 4.0);
                // Fewer strands reach each layer out; their tips are soft. No fur, no shell.
                float cut = mix(0.1, 0.94, uShell);
                diffuseColor.a = smoothstep(cut - 0.07, cut + 0.05, strand) * step(0.02, vFur);
                // Shadowed at the roots, catching the light at the tips.
                diffuseColor.rgb *= mix(0.72, 1.1, uShell) * (0.93 + 0.14 * strand);`);
    };
    mat.customProgramCacheKey = () => 'cat-shell';
    return mat;
}

/**
 * One small texture for the glossy parts of the face: the iris (left half),
 * and flat swatches for the nose leather and the mouth line (right half).
 */
function faceTexture(spec) {
    const S = 256;
    const canvas = document.createElement('canvas');
    canvas.width = S * 2;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    const c = new THREE.Color(spec.eyes);
    const hex = (k) => `#${k.getHexString()}`;
    ctx.fillStyle = '#120d0a';
    ctx.fillRect(0, 0, S, S);
    const R = S * 0.43;
    const g = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, R);
    g.addColorStop(0, hex(c.clone().lerp(new THREE.Color('#4a6a1c'), 0.3)));
    g.addColorStop(0.3, hex(c.clone().multiplyScalar(1.12)));
    g.addColorStop(0.72, hex(c));
    g.addColorStop(0.9, hex(c.clone().multiplyScalar(0.5)));
    g.addColorStop(1, '#17100a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, R, 0, TAU);
    ctx.fill();
    for (let k = 0; k < 360; k++) {
        const a = Math.random() * TAU;
        const r0 = R * (0.12 + Math.random() * 0.2);
        const r1 = R * (0.55 + Math.random() * 0.4);
        ctx.strokeStyle = `rgba(${Math.random() < 0.55 ? '255,238,190' : '46,30,8'},${0.05 + Math.random() * 0.12})`;
        ctx.lineWidth = 0.8 + Math.random();
        ctx.beginPath();
        ctx.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
        ctx.lineTo(S / 2 + Math.cos(a + 0.05) * r1, S / 2 + Math.sin(a + 0.05) * r1);
        ctx.stroke();
    }
    // The pupil: a tall oval, as a cat's is indoors.
    ctx.fillStyle = '#030303';
    ctx.beginPath();
    ctx.ellipse(S / 2, S / 2, R * 0.27, R * 0.8, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = spec.nose || '#b97a78';
    ctx.fillRect(S, 0, S, S / 2);
    ctx.fillStyle = '#1b1412';
    ctx.fillRect(S, S / 2, S, S / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

const flatUv = (g, u, v) => {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
    return g;
};

/** Eyes, nose leather and the lines of the mouth: one mesh, fixed to the head. */
function faceGeometry() {
    const parts = [];
    for (const s of [-1, 1]) {
        const eye = new THREE.SphereGeometry(EYE_R, 28, 20);
        // Looked at from the front, the iris fills the eye.
        const p = eye.attributes.position;
        const uv = eye.attributes.uv;
        for (let i = 0; i < p.count; i++) uv.setXY(i, 0.25 + (p.getX(i) / EYE_R) * 0.25 * 1.02, 0.5 + (p.getY(i) / EYE_R) * 0.5 * 1.02);
        eye.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), gaze(s)));
        eye.translate(C[0] + EYE[0] * s - J.head[0], C[1] + EYE[1] - J.head[1], C[2] + EYE[2] - J.head[2]);
        parts.push(eye);
    }
    // Nose leather: a small rounded triangle, point down.
    const shape = new THREE.Shape();
    const w = 0.0062;
    const hh = 0.0048;
    shape.moveTo(0, -hh);
    shape.quadraticCurveTo(w * 0.35, -hh * 0.95, w * 0.95, hh * 0.05);
    shape.quadraticCurveTo(w * 1.05, hh * 0.7, w * 0.5, hh * 0.66);
    shape.quadraticCurveTo(0, hh * 0.8, -w * 0.5, hh * 0.66);
    shape.quadraticCurveTo(-w * 1.05, hh * 0.7, -w * 0.95, hh * 0.05);
    shape.quadraticCurveTo(-w * 0.35, -hh * 0.95, 0, -hh);
    const nose = new THREE.ExtrudeGeometry(shape, { depth: 0.0016, bevelEnabled: true, bevelThickness: 0.0009, bevelSize: 0.0009, bevelSegments: 3, curveSegments: 8 });
    nose.rotateX(-0.38);
    nose.translate(C[0] - J.head[0], C[1] + NOSE[1] - J.head[1], C[2] + NOSE[2] - J.head[2]);
    parts.push(flatUv(nose, 0.75, 0.75));
    const line = (pts, r = 0.0005) => {
        const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0] + C[0] - J.head[0], q[1] + C[1] - J.head[1], q[2] + C[2] - J.head[2])));
        parts.push(flatUv(new THREE.TubeGeometry(curve, 10, r, 5), 0.75, 0.25));
    };
    line([[0, -0.0155, 0.0652], [0, -0.0198, 0.0636], [0, -0.0242, 0.0606]]);
    for (const s of [-1, 1]) {
        line([[0, -0.0242, 0.0606], [s * 0.0042, -0.0266, 0.0606], [s * 0.0092, -0.0272, 0.0582], [s * 0.014, -0.0256, 0.052]]);
        // Nostrils.
        const nostril = new THREE.SphereGeometry(1, 8, 6);
        nostril.scale(0.0012, 0.0008, 0.0008);
        nostril.rotateZ(s * 0.5);
        nostril.translate(C[0] + s * 0.0027 - J.head[0], C[1] + NOSE[1] - 0.0012 - J.head[1], C[2] + NOSE[2] + 0.0026 - J.head[2]);
        parts.push(flatUv(nostril, 0.75, 0.25));
    }
    return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** Whiskers: fine curved hairs from the pads, and a few over the eyes. */
function whiskerGeometry() {
    const pos = [];
    const hair = (root, dir, length, droop) => {
        const N = 6;
        let prev = root;
        for (let k = 1; k <= N; k++) {
            const t = k / N;
            const p = [root[0] + dir[0] * length * t, root[1] + dir[1] * length * t - droop * t * t, root[2] + dir[2] * length * t - 0.012 * t * t];
            pos.push(...prev, ...p);
            prev = p;
        }
    };
    const o = [C[0] - J.head[0], C[1] - J.head[1], C[2] - J.head[2]];
    for (const s of [-1, 1]) {
        for (let k = 0; k < 9; k++) {
            const row = k % 3;
            const col = Math.floor(k / 3);
            const root = [o[0] + s * (0.0125 + col * 0.0028), o[1] - 0.0155 - row * 0.0036, o[2] + 0.056 - col * 0.0035];
            const dir = [s * 1, 0.16 - row * 0.2 + (col - 1) * 0.04, 0.2 - col * 0.12];
            const l = Math.hypot(...dir);
            hair(root, dir.map((v) => v / l), 0.05 + (k * 7 % 5) * 0.0045, 0.006 + row * 0.004);
        }
        for (let k = 0; k < 2; k++) {
            hair([o[0] + s * (0.016 + k * 0.006), o[1] + 0.0215, o[2] + 0.034], [s * (0.25 + k * 0.25), 0.9, 0.3], 0.024, -0.002);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
}

// ---------------------------------------------------------------------------

export function buildCatModel(spec) {
    const sk = makeSkeleton();
    const idx = (b) => b.userData.index;
    const I = {
        hips: idx(sk.hips), spine: idx(sk.spine), chest: idx(sk.chest), ribs: idx(sk.ribs), neck: idx(sk.neck), head: idx(sk.head),
        ears: sk.ears.map(idx), lids: sk.lids.map(idx), front: sk.front.map((l) => l.map(idx)), hind: sk.hind.map((l) => l.map(idx)), tail: sk.tail.map(idx)
    };
    const s = sculptBody(I);
    const pal = paletteFor(spec);

    // Body: the sculpted masses, the tail, the ears and the eyelids, as one skinned mesh.
    const bodyGeo = mergeGeometries([
        partGeometry(asPart(s.body), spec, pal), partGeometry(tailPart(I, 30, 12), spec, pal),
        partGeometry(earPart(I, -1), spec, pal), partGeometry(earPart(I, 1), spec, pal),
        partGeometry(lidPart(I, -1), spec, pal), partGeometry(lidPart(I, 1), spec, pal)
    ]);
    const skeleton = new THREE.Skeleton(sk.bones);
    const mesh = new THREE.SkinnedMesh(bodyGeo, coatMaterial(spec));
    mesh.add(sk.hips);
    mesh.bind(skeleton);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // A fixed sphere round the cat, in every pose: enough to cull it by.
    const bounds = new THREE.Sphere(new THREE.Vector3(0, 0.2, -0.1), 0.6);
    mesh.boundingSphere = bounds;
    const root = new THREE.Group();
    root.add(mesh);

    // Shell fur, on a coarser copy of the body. Not mirrored in the floor (layer 1).
    const shellGeo = mergeGeometries([partGeometry(asPart(s.shell), spec, pal), partGeometry(tailPart(I, 18, 8), spec, pal)]);
    // From a few metres off, that coarser body stands in for the fine one.
    const farGeo = mergeGeometries([
        shellGeo, partGeometry(earPart(I, -1), spec, pal), partGeometry(earPart(I, 1), spec, pal),
        partGeometry(lidPart(I, -1), spec, pal), partGeometry(lidPart(I, 1), spec, pal)
    ]);
    const far = new THREE.SkinnedMesh(farGeo, mesh.material);
    far.bind(skeleton, mesh.bindMatrix);
    far.castShadow = true;
    far.receiveShadow = true;
    far.boundingSphere = bounds;
    far.visible = false;
    root.add(far);
    const shells = [];
    for (let l = 1; l <= SHELLS; l++) {
        const shell = new THREE.SkinnedMesh(shellGeo, shellMaterial(l / SHELLS));
        shell.bind(skeleton, mesh.bindMatrix);
        shell.boundingSphere = bounds;
        shell.castShadow = false;
        shell.receiveShadow = true;
        shell.renderOrder = l;
        shell.layers.set(1);
        root.add(shell);
        shells.push(shell);
    }

    // The glossy parts of the face, fixed to the head.
    const tex = faceTexture(spec);
    const face = new THREE.Mesh(faceGeometry(), new THREE.MeshPhysicalMaterial({
        map: tex, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.5,
        emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.1
    }));
    face.castShadow = false;
    sk.head.add(face);
    const whiskers = new THREE.LineSegments(whiskerGeometry(), new THREE.LineBasicMaterial({ color: spec.whiskers || '#f3f0e8', transparent: true, opacity: 0.6, depthWrite: false }));
    whiskers.layers.set(1);
    sk.head.add(whiskers);

    let furOn = true;
    return {
        root, mesh, ...sk, shells, face,
        /** The finely meshed body close up, the lighter one from further off. */
        setDetail(fine) {
            mesh.visible = fine;
            far.visible = !fine;
        },
        /** Shell fur is drawn only near the visitor; `layers` of it (fewer when far or on a small GPU). */
        setFur(on, layers = SHELLS) {
            const key = on ? layers : 0;
            if (key === furOn) return;
            furOn = key;
            // Dropping layers keeps every other one, so the coat thins out evenly.
            const stepN = on ? Math.max(1, Math.round(SHELLS / layers)) : 1;
            shells.forEach((sh, i) => { sh.visible = on && (i + 1) % stepN === 0; });
        }
    };
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------
//
// A pose says where the body is and where the paws are; the legs follow by
// inverse kinematics.
//   hipY, hipZ   the pelvis (height above the floor, shift along the body)
//   pitch        of the pelvis (negative: nose up); lumbar, thorax bend the spine on from there
//   neck, head   bend of the neck and head (positive: nose down)
//   fz, fy, fa   forepaws: ahead of the shoulder, height, angle of the paw (0 = straight down)
//   fx           forepaws spread sideways
//   hz, hy, ha, hx   the same for the hind paws, from the hip
//   tailLift, tailCurl, raise (a forepaw to the mouth), lick

const F_REST = { z: J.fpaw[2] - J.shoulder[2], a: Math.atan2(J.fpaw[2] - J.wrist[2], J.wrist[1] - J.fpaw[1]) };
const H_REST = { z: J.hpaw[2] - J.hip[2], a: Math.atan2(J.hpaw[2] - J.hock[2], J.hock[1] - J.hpaw[1]) };
const BASE = {
    hipY: J.hips[1], hipZ: 0, pitch: 0, lumbar: 0, thorax: 0, neck: 0, head: 0,
    fz: F_REST.z, fy: J.fpaw[1], fa: F_REST.a, fx: 0, hz: H_REST.z, hy: J.hpaw[1], ha: H_REST.a, hx: 0,
    tailLift: 0.35, tailCurl: 0.2, raise: 0, lick: 0
};

export const CAT_POSES = {
    stand: { ...BASE, neck: -0.06, head: 0.06 },
    walk: { ...BASE, neck: 0.16, head: -0.12, tailLift: 0.7, tailCurl: 0.3 },
    sit: { ...BASE, hipY: 0.082, hipZ: 0.035, pitch: -0.86, lumbar: 0.26, thorax: 0.24, neck: -0.08, head: 0.44, fz: -0.012, hz: 0.118, ha: 1.42, hx: 0.022, tailLift: 0.2, tailCurl: 1.0 },
    groom: { ...BASE, hipY: 0.082, hipZ: 0.035, pitch: -0.86, lumbar: 0.3, thorax: 0.28, neck: 0.2, head: 0.75, fz: -0.012, hz: 0.118, ha: 1.42, hx: 0.022, tailLift: 0.2, tailCurl: 1.05, raise: 1, lick: 1 },
    loaf: { ...BASE, hipY: 0.088, hipZ: 0.0, pitch: 0.0, lumbar: -0.05, thorax: -0.12, neck: -0.5, head: 0.5, fz: 0.07, fa: 1.25, fx: -0.006, hz: 0.105, ha: 1.42, hx: 0.03, tailLift: -0.2, tailCurl: 1.15 },
    crouch: { ...BASE, hipY: 0.165, pitch: 0.1, lumbar: 0.06, thorax: 0, neck: -0.2, head: 0.1, fz: 0.01, hz: 0.0, tailLift: 0.0, tailCurl: 0.1 },
    leap: { ...BASE, hipY: 0.232, pitch: -0.2, lumbar: -0.1, thorax: -0.06, neck: -0.1, head: 0.2, fz: 0.085, fy: 0.105, fa: 0.9, hz: -0.1, hy: 0.1, ha: -0.5, tailLift: 0.15, tailCurl: 0.0 }
};

/** A weighted mix of poses: { stand: 0.3, walk: 0.7 } and so on. */
export function blendCatPoses(weights, out = {}) {
    let total = 0;
    for (const k in weights) total += weights[k];
    total = total || 1;
    for (const key in BASE) {
        let v = 0;
        for (const k in weights) v += CAT_POSES[k][key] * weights[k];
        out[key] = v / total;
    }
    return out;
}

const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();
const t = {
    qH: Q(), qS: Q(), qC: Q(), qI: Q(), q1: Q(), q2: Q(), q3: Q(), qT: Q(),
    pS: V(), pC: V(), root: V(), target: V(), ankle: V(), knee: V(), d: V(), pole: V(), perp: V(), f: V(), d1: V(), d2: V(), v: V()
};
const restDir = (a, b, s) => new THREE.Vector3((b[0] - a[0]) * s, b[1] - a[1], b[2] - a[2]).normalize();
const REST_DIR = {
    f: [-1, 1].map((s) => [restDir(J.shoulder, J.elbow, s), restDir(J.elbow, J.wrist, s), restDir(J.wrist, J.fpaw, s)]),
    h: [-1, 1].map((s) => [restDir(J.hip, J.knee, s), restDir(J.knee, J.hock, s), restDir(J.hock, J.hpaw, s)])
};

/**
 * Pose one leg: from where its top joint is (root), put the paw at `target`
 * with the paw's own segment along `foot`, bending the middle joint towards
 * `pole`. Sets the three bones' rotations.
 */
function solveLeg(bones, rest, L, parentQ, root, target, foot, pole) {
    t.ankle.copy(target).addScaledVector(foot, -L[2]);
    t.d.copy(t.ankle).sub(root);
    const reach = L[0] + L[1] - 1e-4;
    const dist = clamp(t.d.length(), Math.abs(L[0] - L[1]) + 1e-4, reach);
    t.d.normalize();
    const a = (L[0] * L[0] - L[1] * L[1] + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(L[0] * L[0] - a * a, 0));
    t.perp.copy(pole).addScaledVector(t.d, -pole.dot(t.d)).normalize();
    t.knee.copy(root).addScaledVector(t.d, a).addScaledVector(t.perp, h);
    t.d1.copy(t.knee).sub(root).normalize();
    t.v.copy(root).addScaledVector(t.d, dist);
    t.d2.copy(t.v).sub(t.knee).normalize();
    t.q1.setFromUnitVectors(rest[0], t.d1);
    t.q2.setFromUnitVectors(rest[1], t.d2);
    t.q3.setFromUnitVectors(rest[2], foot);
    bones[0].quaternion.copy(t.qI.copy(parentQ).invert()).multiply(t.q1);
    bones[1].quaternion.copy(t.qI.copy(t.q1).invert()).multiply(t.q2);
    bones[2].quaternion.copy(t.qI.copy(t.q2).invert()).multiply(t.q3);
}

const FRONT_POLE = new THREE.Vector3(0, 0.25, -1).normalize();
const HIND_POLE = new THREE.Vector3(0, 0.3, 1).normalize();
const DUTY = 0.62;                 // share of a stride each paw spends on the floor
/** Where in the stride each leg is: hind left, fore left, hind right, fore right. */
const LEG_PHASE = { f: [0.25, 0.75], h: [0, 0.5] };

/**
 * Apply a pose, the walk and the small signs of life.
 * p: pose values (blendCatPoses); gait: 0..1 how much it is walking;
 * phase: strides walked (fractional part is where in the stride);
 * stride: metres per stride; look: { yaw, pitch }; t: seconds; seed: per cat;
 * ears: [left, right] twitch, 0..1; flick: tail-tip flick, 0..1; blink: 0..1 closed.
 */
export function applyCatPose(m, p, { gait = 0, phase = 0, stride = 0.3, look = { yaw: 0, pitch: 0 }, t: time = 0, seed = 0, ears = [0, 0], flick = 0, blink = 0 } = {}) {
    const ph = phase - Math.floor(phase);
    const w = ph * TAU;
    // The trunk: shoulders and hips rise and fall, and sway against each other.
    const bob = 0.0035 * Math.cos(w * 2) * gait;
    m.hips.position.set(Math.sin(w) * 0.004 * gait, p.hipY + bob, J.hips[2] + p.hipZ);
    m.hips.rotation.set(p.pitch + Math.sin(w * 2 + 0.6) * 0.012 * gait, Math.sin(w) * 0.06 * gait, Math.sin(w + 0.4) * 0.035 * gait);
    m.spine.rotation.set(p.lumbar, -Math.sin(w) * 0.05 * gait, 0);
    m.chest.rotation.set(p.thorax, -Math.sin(w) * 0.04 * gait, -Math.sin(w + 0.4) * 0.05 * gait);
    // Breathing: the ribs swell, faster on the move.
    const breath = 1 + Math.sin(time * (gait > 0.3 ? 4.2 : 2.4) + seed) * 0.022;
    m.ribs.scale.set(breath, breath, 1);
    // The head stays level while the body bobs; grooming nods it to the paw.
    const lick = p.lick > 0.01 ? Math.max(0, Math.sin(time * 7.5)) * 0.14 * p.lick : 0;
    m.neck.rotation.set(p.neck + look.pitch * 0.4 - bob * 3, look.yaw * 0.4 * (1 - p.lick), p.lick * -0.2);
    m.head.rotation.set(p.head + look.pitch * 0.6 + lick, look.yaw * 0.6 * (1 - p.lick) + p.lick * 0.3, -look.yaw * 0.1 - p.lick * 0.18);

    // Where the shoulders and hips are now, in the cat's own space.
    t.qH.copy(m.hips.quaternion);
    t.qS.copy(t.qH).multiply(m.spine.quaternion);
    t.qC.copy(t.qS).multiply(m.chest.quaternion);
    t.pS.copy(m.spine.userData.rest).applyQuaternion(t.qH).add(m.hips.position);
    t.pC.copy(m.chest.userData.rest).applyQuaternion(t.qS).add(t.pS);
    const travel = stride * DUTY * gait;
    for (const side of [0, 1]) {
        const s = side ? 1 : -1;
        for (const kind of ['f', 'h']) {
            const front = kind === 'f';
            const bones = front ? m.front[side] : m.hind[side];
            t.root.copy(bones[0].userData.rest).applyQuaternion(front ? t.qC : t.qH).add(front ? t.pC : m.hips.position);
            // A stride: planted and carried back under the body, then lifted and swung forward.
            const u = (ph + LEG_PHASE[kind][side]) % 1;
            let dz;
            let lift = 0;
            let flex = 0;
            if (u < DUTY) dz = 0.5 - u / DUTY;
            else {
                const k = (u - DUTY) / (1 - DUTY);
                dz = -0.5 + smooth(k);
                lift = Math.sin(k * Math.PI) * (front ? 0.03 : 0.026) * gait;
                flex = Math.sin(Math.min(1, k * 1.25) * Math.PI) * gait;
            }
            const x = front ? J.fpaw[0] + p.fx : J.hpaw[0] + p.hx;
            t.target.set(s * x, (front ? p.fy : p.hy) + lift, t.root.z + (front ? p.fz : p.hz) + dz * travel);
            // The paw trails as it lifts; a planted hind foot rolls a little with the leg.
            const ang = (front ? p.fa : p.ha) - flex * (front ? 1.0 : 0.75) + (u < DUTY ? (0.5 - u / DUTY) * (front ? 0.12 : -0.2) * gait : 0);
            t.f.set(0, -Math.cos(ang), Math.sin(ang));
            if (front && side === 1 && p.raise > 0.001) {
                // Washing: the right forepaw comes up to the mouth and strokes.
                t.v.set(0.012, -0.03, 0.062 + lick * 0.05).applyQuaternion(m.head.getWorldQuaternion(t.qT).premultiply(t.q3.copy(m.mesh.parent.quaternion).invert()));
                m.head.getWorldPosition(t.d1);
                m.mesh.parent.worldToLocal(t.d1);
                t.target.lerp(t.v.add(t.d1), smooth(p.raise));
                t.f.set(0, Math.sin(p.raise * 1.6) * 0.9 - (1 - p.raise), 1).normalize();
            }
            solveLeg(bones, REST_DIR[kind][side], LIMB[kind], front ? t.qC : t.qH, t.root, t.target, t.f, front ? FRONT_POLE : HIND_POLE);
        }
    }
    // Ears: a flick back and out now and then. Lids: a blink.
    m.ears.forEach((ear, i) => {
        const s = i ? 1 : -1;
        ear.rotation.set(-ears[i] * 0.45, s * -ears[i] * 0.55, s * ears[i] * 0.12);
    });
    // At rest the lid already rests on the top of the eye, which gives it its almond shape.
    for (const lid of m.lids) lid.rotation.x = 0.36 + blink * 0.9;
    // Tail: lifted from the root, curving along its length, alive at the tip.
    m.tail.forEach((b, k) => {
        const f = k / m.tail.length;
        const sway = Math.sin(time * (1.4 + gait) - k * 0.55 + seed) * (0.06 + 0.12 * gait) * (0.3 + f);
        const tip = k >= m.tail.length - 3 ? Math.sin(time * 14) * 0.35 * flick : 0;
        b.rotation.x = k === 0 ? p.tailLift - p.pitch * 0.8 : (0.04 - 0.1 * p.tailCurl * (k > 3 ? 1 : 0)) + gait * (k > 5 ? -0.2 : 0.07) + (k > 5 ? 0.05 * Math.sin(time * 0.7 + seed) : 0);
        b.rotation.y = sway + p.tailCurl * 0.3 * (k > 1 ? 1 : 0.2) + tip;
    });
}
