// A realistic cat, built in code: one continuous skinned body on a skeleton
// (no stacked spheres), lofted from anatomical cross-sections, with a cat's
// head (flat brow, wide cheeks, whisker pads), curved ear shells, layered
// eyes with slit pupils, jointed legs and a nine-bone tail. Fur is a painted
// coat pattern with a strand normal map and a velvet sheen.
//
// Mesh space: the cat faces +z, y is up, paws on y = 0. Bones are posed by
// joint angles (see applyCatPose); rotation.x > 0 swings a leg backwards and
// lifts the tail.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// ---------------------------------------------------------------------------
// Skeleton (rest pose: standing, legs straight down, tail straight back)
// ---------------------------------------------------------------------------

const REST = {
    hips: [0, 0.21, -0.12],
    spine: [0, 0.215, 0.0],
    chest: [0, 0.22, 0.1],
    neck: [0, 0.25, 0.165],
    head: [0, 0.3, 0.212]
};
const FRONT = { x: 0.028, z: 0.1, ys: [0.2, 0.112, 0.028] };            // shoulder, elbow, wrist
const HIND = { x: 0.032, z: -0.135, ys: [0.19, 0.112, 0.048, 0.016] };  // hip, knee, hock, toe
const TAIL = { y: 0.226, z: -0.198, n: 9, step: 0.034 };

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
        b.userData.index = bones.length;
        bones.push(b);
        return b;
    };
    const hips = add('hips', REST.hips);
    const spine = add('spine', REST.spine, hips);
    const chest = add('chest', REST.chest, spine);
    const neck = add('neck', REST.neck, chest);
    const head = add('head', REST.head, neck);
    const front = [-1, 1].map((s) => {
        const a = add(`shoulder${s}`, [s * FRONT.x, FRONT.ys[0], FRONT.z], chest);
        const b = add(`elbow${s}`, [s * FRONT.x, FRONT.ys[1], FRONT.z], a);
        const c = add(`wrist${s}`, [s * FRONT.x, FRONT.ys[2], FRONT.z], b);
        return [a, b, c];
    });
    const hind = [-1, 1].map((s) => {
        const a = add(`hip${s}`, [s * HIND.x, HIND.ys[0], HIND.z], hips);
        const b = add(`knee${s}`, [s * HIND.x, HIND.ys[1], HIND.z], a);
        const c = add(`hock${s}`, [s * HIND.x, HIND.ys[2], HIND.z], b);
        return [a, b, c];
    });
    const tail = [];
    let parent = hips;
    for (let k = 0; k < TAIL.n; k++) {
        const b = add(`tail${k}`, [0, TAIL.y, TAIL.z - k * TAIL.step], parent);
        tail.push(b);
        parent = b;
    }
    return { bones, hips, spine, chest, neck, head, front, hind, tail };
}

// ---------------------------------------------------------------------------
// Lofting: rings of an ellipse, swept along an axis, skinned to bones
// ---------------------------------------------------------------------------

/**
 * rings: [{ c: [x, y, z], rx, ry, w: [[bone, weight], ...] }]
 * axis 'z': rings lie in xy (trunk, head, tail); 'y': rings lie in xz (legs).
 * shape(a) may widen or flatten a ring at angle a (0 = top / front).
 */
function loft(rings, axis, segs, { shape, vScale = 1 } = {}) {
    const pos = [];
    const uv = [];
    const skinI = [];
    const skinW = [];
    let along = 0;
    rings.forEach((r, i) => {
        if (i) {
            const p = rings[i - 1].c;
            along += Math.hypot(r.c[0] - p[0], r.c[1] - p[1], r.c[2] - p[2]);
        }
        const w = [...r.w, [0, 0], [0, 0], [0, 0]].slice(0, 4);
        for (let k = 0; k <= segs; k++) {
            const a = (k / segs) * TAU;
            let s = Math.sin(a);
            let c = Math.cos(a);
            let rx = r.rx;
            let ry = r.ry;
            if (shape) [rx, ry] = shape(a, r, rx, ry);
            if (axis === 'z') pos.push(r.c[0] + rx * s, r.c[1] + ry * c, r.c[2]);
            else pos.push(r.c[0] + rx * s, r.c[1], r.c[2] + ry * c);
            uv.push(k / segs, along * vScale);
            skinI.push(w[0][0], w[1][0], w[2][0], w[3][0]);
            skinW.push(w[0][1], w[1][1], w[2][1], w[3][1]);
        }
    });
    // Wind every triangle to face outwards, whichever way the rings run.
    const idx = [];
    const n = segs + 1;
    const first = rings[0].c;
    const last = rings[rings.length - 1].c;
    // (z sweeps run head-wards or tail-wards; y sweeps run down the leg.)
    const outward = axis === 'z' ? last[2] > first[2] : last[1] < first[1];
    for (let i = 0; i < rings.length - 1; i++) {
        for (let k = 0; k < segs; k++) {
            const a = i * n + k;
            const b = a + n;
            if (outward) idx.push(a, b, a + 1, a + 1, b, b + 1);
            else idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

/** Weights that blend between consecutive bones along a chain, by a coordinate. */
function chainWeights(value, stops) {
    // stops: [[coord, boneIndex], ...] in increasing coord.
    if (value <= stops[0][0]) return [[stops[0][1], 1]];
    for (let i = 0; i < stops.length - 1; i++) {
        const [a, ba] = stops[i];
        const [b, bb] = stops[i + 1];
        if (value <= b) {
            const t = smooth((value - a) / (b - a));
            return [[ba, 1 - t], [bb, t]];
        }
    }
    return [[stops[stops.length - 1][1], 1]];
}

// ---------------------------------------------------------------------------
// Fur: coat pattern and strand normals
// ---------------------------------------------------------------------------

let strandNormal = null;

/** A tileable strand normal map shared by every cat. */
function furNormalMap() {
    if (strandNormal) return strandNormal;
    const N = 256;
    const h = new Float32Array(N * N);
    for (let s = 0; s < 5200; s++) {
        const x = Math.floor(Math.random() * N);
        const y0 = Math.floor(Math.random() * N);
        const len = 6 + Math.random() * 16;
        const v = (Math.random() - 0.35) * 0.9;
        for (let k = 0; k < len; k++) {
            const y = (y0 + k) % N;
            const fade = Math.sin((k / len) * Math.PI);
            h[y * N + x] += v * fade;
            h[y * N + ((x + 1) % N)] += v * fade * 0.4;
        }
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
            const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
            const nx = -dx * 1.4;
            const ny = -dy * 0.6;
            const l = Math.hypot(nx, ny, 1);
            const i = (y * N + x) * 4;
            img.data[i] = (nx / l * 0.5 + 0.5) * 255;
            img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
            img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    strandNormal = new THREE.CanvasTexture(canvas);
    strandNormal.wrapS = strandNormal.wrapT = THREE.RepeatWrapping;
    strandNormal.repeat.set(3, 6);
    return strandNormal;
}

/**
 * Paint one part's coat. u runs round the part (0 = top/front), v along it.
 * part: 'trunk' | 'head' | 'leg' | 'hindleg' | 'tail'
 */
function furMap(spec, part, vLen) {
    const W = 512;
    const H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const base = new THREE.Color(spec.base);
    const dark = new THREE.Color(spec.dark);
    const light = new THREE.Color(spec.light);
    const col = new THREE.Color();
    const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    for (let py = 0; py < H; py++) {
        const v = (py / H) * vLen;          // metres along the part
        const vn = py / H;                  // 0..1 along the part
        for (let px = 0; px < W; px++) {
            const u = px / W;
            const top = Math.cos(u * TAU);  // 1 on the back, -1 underneath
            const side = Math.sin(u * TAU);
            col.copy(base);
            if (spec.tabby) {
                let band = 0;
                if (part === 'trunk') band = Math.sin(v * 64 + Math.sin(u * TAU * 3) * 0.9 + top * 1.4 + Math.sin(v * 23 + u * 9) * 0.6);
                else if (part === 'tail') band = Math.sin(v * 52);
                else if (part === 'leg' || part === 'hindleg') band = Math.sin(v * 95 + side * 0.4) * (0.35 + 0.65 * smooth(vn * 1.6));
                else if (part === 'head') band = Math.sin(u * TAU * 7) * smooth((top - 0.35) / 0.4) * smooth((vn - 0.15) / 0.2) * (1 - smooth((vn - 0.62) / 0.1));
                let stripe = smooth((band - 0.25) / 0.45);
                if (part === 'trunk') stripe *= smooth((top + 0.35) / 0.6);
                if (part === 'tail' && vn > 0.85) stripe = 1;
                col.lerp(dark, stripe * 0.6);
                // Darker along the spine.
                if (part === 'trunk' || part === 'tail') col.lerp(dark, smooth((top - 0.75) / 0.25) * 0.35);
                // Pale belly, chin and inner legs.
                const pale = part === 'head'
                    ? smooth((vn - 0.66) / 0.12) * smooth((-top + 0.1) / 0.5)
                    : part === 'tail' ? 0 : smooth((-top - 0.25) / 0.5);
                col.lerp(light, pale * 0.85);
            } else {
                // Tuxedo: black coat, white bib, belly, paws and muzzle.
                let white = 0;
                if (part === 'trunk') white = smooth((-top - 0.1) / 0.3) * smooth((vn - 0.35) / 0.15);
                if (part === 'leg') white = smooth((vn - 0.72) / 0.06);
                if (part === 'hindleg') white = smooth((vn - 0.8) / 0.05);
                if (part === 'head') white = smooth((vn - 0.6) / 0.08) * smooth((-top + 0.35) / 0.35);
                col.lerp(light, Math.min(1, white));
                col.lerp(dark, smooth((top - 0.6) / 0.4) * 0.4 * (1 - white));
            }
            // Fine grain: each hair a little lighter or darker than the last.
            const g = 0.9 + 0.2 * hash(px, Math.floor(py / 3));
            const i = (py * W + px) * 4;
            img.data[i] = Math.min(255, col.r * 255 * g);
            img.data[i + 1] = Math.min(255, col.g * 255 * g);
            img.data[i + 2] = Math.min(255, col.b * 255 * g);
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;            // canvas row 0 is the start of the part (uv v = 0)
    tex.anisotropy = 4;
    return tex;
}

function furMaterial(spec, part, vLen) {
    return new THREE.MeshPhysicalMaterial({
        map: furMap(spec, part, vLen),
        normalMap: furNormalMap(),
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughness: 0.88,
        sheen: 1,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color(spec.sheen || spec.light).multiplyScalar(0.6),
        envMapIntensity: 0.6
    });
}

/** An iris with a vertical slit pupil and a catch-light. */
function irisTexture(color) {
    const S = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d');
    const c = new THREE.Color(color);
    const g = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
    g.addColorStop(0, `#${c.clone().multiplyScalar(0.55).getHexString()}`);
    g.addColorStop(0.45, `#${c.getHexString()}`);
    g.addColorStop(0.85, `#${c.clone().lerp(new THREE.Color('#7a8a2a'), 0.35).getHexString()}`);
    g.addColorStop(1, '#2a2416');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // Fibres radiating from the pupil.
    for (let k = 0; k < 140; k++) {
        const a = Math.random() * TAU;
        ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,240,200' : '60,40,10'},${0.08 + Math.random() * 0.12})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(S / 2 + Math.cos(a) * 10, S / 2 + Math.sin(a) * 10);
        ctx.lineTo(S / 2 + Math.cos(a) * (40 + Math.random() * 20), S / 2 + Math.sin(a) * (40 + Math.random() * 20));
        ctx.stroke();
    }
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.ellipse(S / 2, S / 2, 9, 46, 0, 0, TAU);
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// ---------------------------------------------------------------------------

export function buildCatModel(spec) {
    const sk = makeSkeleton();
    const I = (b) => b.userData.index;
    const geos = [];

    // Trunk: rump to neck, cross-sections of a slim domestic cat.
    const trunkRings = [
        [-0.226, 0.204, 0.006, 0.006], [-0.215, 0.205, 0.038, 0.042], [-0.195, 0.206, 0.054, 0.062],
        [-0.165, 0.205, 0.064, 0.074], [-0.125, 0.204, 0.066, 0.08], [-0.085, 0.205, 0.058, 0.071],
        [-0.045, 0.206, 0.055, 0.067], [0.0, 0.209, 0.058, 0.07], [0.045, 0.214, 0.062, 0.074],
        [0.09, 0.219, 0.06, 0.074], [0.125, 0.226, 0.053, 0.066], [0.152, 0.238, 0.044, 0.054],
        [0.178, 0.256, 0.037, 0.043], [0.2, 0.275, 0.033, 0.038], [0.222, 0.296, 0.031, 0.034]
    ].map(([z, y, rx, ry]) => ({
        c: [0, y, z], rx, ry,
        w: chainWeights(z, [[-0.12, I(sk.hips)], [0.0, I(sk.spine)], [0.1, I(sk.chest)], [0.165, I(sk.neck)], [0.212, I(sk.head)]])
    }));
    const trunk = loft(trunkRings, 'z', 28, {
        vScale: 1 / 0.448,
        // A deeper keel under the chest, a flatter back.
        shape: (a, r, rx, ry) => (Math.cos(a) < 0 ? [rx * 0.96, ry * (1.04 + 0.06 * Math.max(0, Math.min(1, (r.c[2] - 0.0) / 0.1)))] : [rx, ry * 0.97])
    });
    geos.push([trunk, 'trunk']);

    // Head: back of the skull to the nose, rigid on the head bone.
    const H = REST.head;
    const headRings = [
        [-0.042, 0.004, 0.006, 0.006], [-0.034, 0.006, 0.03, 0.03], [-0.02, 0.006, 0.042, 0.039],
        [-0.004, 0.002, 0.047, 0.041], [0.012, -0.004, 0.048, 0.038], [0.026, -0.009, 0.041, 0.032],
        [0.038, -0.013, 0.031, 0.025], [0.049, -0.016, 0.022, 0.019], [0.058, -0.017, 0.015, 0.014],
        [0.063, -0.017, 0.004, 0.004]
    ].map(([z, y, rx, ry]) => ({ c: [H[0], H[1] + y * 0.9, H[2] + z * 0.92], rx: rx * 0.88, ry: ry * 0.9, w: [[I(sk.head), 1]] }));
    const head = loft(headRings, 'z', 28, {
        vScale: 1 / 0.105,
        // Cheeks and jowls wider low down; a flat brow.
        shape: (a, r, rx, ry) => {
            const c = Math.cos(a);
            return [rx * (c < 0.2 ? 1 + 0.12 * (0.2 - c) : 1), ry * (c > 0.6 ? 0.92 : 1)];
        }
    });
    geos.push([head, 'head']);

    // Legs: thick at the top (inside the body), slender below.
    for (const [k, s] of [[0, -1], [1, 1]]) {
        const [sh, el, wr] = sk.front[k];
        const x = s * FRONT.x;
        const rings = [[0.262, 0.004], [0.25, 0.015], [0.22, 0.018], [0.19, 0.0185], [0.16, 0.0175], [0.135, 0.016], [0.112, 0.0148], [0.09, 0.0135], [0.06, 0.0125], [0.035, 0.0115], [0.026, 0.011], [0.02, 0.008], [0.016, 0.002]]
            .map(([y, r]) => ({
                // Shoulder: flat against the ribs, deep front to back.
                c: [x, y, FRONT.z + (y > 0.15 ? 0.006 : 0)], rx: r * 0.88, ry: r * (y > 0.15 ? 1.15 : 1),
                w: chainWeights(-y, [[-0.215, I(sk.chest)], [-0.19, I(sh)], [-0.118, I(sh)], [-0.106, I(el)], [-0.034, I(el)], [-0.026, I(wr)]])
            }));
        geos.push([loft(rings, 'y', 16, { vScale: 1 / 0.22 }), 'leg']);
        const [hp, kn, hk] = sk.hind[k];
        const hx = s * HIND.x;
        const hr = [[0.255, 0.004], [0.245, 0.016], [0.22, 0.02], [0.19, 0.022], [0.16, 0.021], [0.138, 0.0185], [0.118, 0.016], [0.1, 0.0145], [0.075, 0.0125], [0.052, 0.0115], [0.04, 0.0105], [0.02, 0.0105], [0.014, 0.007], [0.01, 0.002]]
            .map(([y, r]) => ({
                // Thigh: a broad, flat haunch, narrowing to a slender shin.
                c: [hx, y, HIND.z + (y > 0.12 ? -0.01 : 0)], rx: r * (y > 0.13 ? 0.8 : 0.9), ry: r * (y > 0.13 ? 1.3 : 1),
                w: chainWeights(-y, [[-0.205, I(sk.hips)], [-0.18, I(hp)], [-0.12, I(hp)], [-0.104, I(kn)], [-0.054, I(kn)], [-0.044, I(hk)]])
            }));
        geos.push([loft(hr, 'y', 16, { vScale: 1 / 0.22 }), 'hindleg']);
    }

    // Tail: tapering, rounded at the tip.
    const tailRings = [];
    const TL = TAIL.step * (TAIL.n - 1) + 0.03;
    for (let k = 0; k <= 22; k++) {
        const f = k / 22;
        const z = TAIL.z + 0.02 - f * TL;
        const r = (0.0165 - 0.0075 * f) * (f > 0.94 ? Math.sqrt(Math.max(0, 1 - (f - 0.94) / 0.06)) + 0.05 : 1);
        const stops = sk.tail.map((b, i) => [-(TAIL.z - i * TAIL.step), I(b)]);
        tailRings.push({ c: [0, TAIL.y + 0.002, z], rx: r, ry: r, w: z > TAIL.z ? [[I(sk.hips), 1]] : chainWeights(-z, stops) });
    }
    geos.push([loft(tailRings, 'z', 12, { vScale: 1 / TL }), 'tail']);

    // One skinned mesh, one material per part.
    const parts = ['trunk', 'head', 'leg', 'hindleg', 'tail'];
    const lens = { trunk: 0.45, head: 0.105, leg: 0.22, hindleg: 0.22, tail: 0.3 };
    const mats = parts.map((p) => furMaterial(spec, p, lens[p]));
    const ordered = parts.flatMap((p) => geos.filter((g) => g[1] === p).map((g) => g[0]));
    const counts = parts.map((p) => geos.filter((g) => g[1] === p).length);
    const merged = mergeGeometries(ordered, true);
    // Merge the per-geometry groups into one group per part.
    merged.clearGroups();
    let start = 0;
    let gi = 0;
    parts.forEach((p, pi) => {
        let count = 0;
        for (let k = 0; k < counts[pi]; k++) count += ordered[gi++].index.count;
        merged.addGroup(start, count, pi);
        start += count;
    });
    const mesh = new THREE.SkinnedMesh(merged, mats);
    mesh.add(sk.hips);
    mesh.bind(new THREE.Skeleton(sk.bones));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    // Details on the head bone: whisker pads, chin, nose, eyes, ears, whiskers.
    const headMat = mats[1];
    const muzzleMat = new THREE.MeshPhysicalMaterial({ color: spec.muzzle || spec.light, roughness: 0.9, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(spec.light).multiplyScalar(0.5), normalMap: furNormalMap(), normalScale: new THREE.Vector2(0.4, 0.4) });
    const ball = (mat, sx, sy, sz, x, y, z, seg = 18) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)), mat);
        m.scale.set(sx, sy, sz);
        m.position.set(x, y, z);
        m.castShadow = true;
        sk.head.add(m);
        return m;
    };
    for (const s of [-1, 1]) ball(muzzleMat, 0.0108, 0.009, 0.0105, s * 0.0083, -0.018, 0.045);
    ball(muzzleMat, 0.0095, 0.006, 0.01, 0, -0.027, 0.038);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.0075, 0.007, 3), new THREE.MeshStandardMaterial({ color: spec.nose || '#b06a6e', roughness: 0.55 }));
    nose.rotation.set(Math.PI / 2 + 0.35, Math.PI, 0);
    nose.scale.set(1, 1, 0.55);
    nose.position.set(0, -0.0095, 0.056);
    sk.head.add(nose);
    const eyes = [-1, 1].map((s) => {
        const g = new THREE.Group();
        g.position.set(s * 0.0195, 0.009, 0.0305);
        g.lookAt(new THREE.Vector3(s * 0.02 + s * 0.45, 0.009 + 0.08, 0.032 + 1));
        sk.head.add(g);
        const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0088, 16, 12), new THREE.MeshStandardMaterial({ color: '#2a201a', roughness: 0.7 }));
        lid.scale.set(1.06, 0.78, 0.55);
        g.add(lid);
        const iris = new THREE.Mesh(new THREE.CircleGeometry(0.0078, 24), new THREE.MeshStandardMaterial({ map: irisTexture(spec.eyes), roughness: 0.4 }));
        iris.position.z = 0.0058;
        iris.scale.y = 0.86;
        g.add(iris);
        const cornea = new THREE.Mesh(new THREE.SphereGeometry(0.0083, 20, 14, 0, TAU, 0, Math.PI / 2.4), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, roughness: 0, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.2 }));
        cornea.rotation.x = Math.PI / 2;
        cornea.position.z = 0.0012;
        cornea.scale.y = 0.86;
        g.add(cornea);
        return g;
    });
    for (const s of [-1, 1]) {
        const ear = new THREE.Group();
        ear.position.set(s * 0.024, 0.029, -0.008);
        ear.rotation.set(-0.12, s * -0.25, s * -0.36);
        sk.head.add(ear);
        const shell = new THREE.Mesh(new THREE.ConeGeometry(0.021, 0.042, 18, 1, true, Math.PI * 0.32, Math.PI * 1.36), headMat.clone());
        shell.material.side = THREE.DoubleSide;
        shell.position.y = 0.021;
        shell.scale.z = 0.62;
        shell.castShadow = true;
        ear.add(shell);
        const inner = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.038, 16, 1, true, Math.PI * 0.4, Math.PI * 1.2), new THREE.MeshStandardMaterial({ color: spec.innerEar || '#c99a93', roughness: 0.75, side: THREE.DoubleSide }));
        inner.position.set(0, 0.017, 0.002);
        inner.scale.z = 0.5;
        ear.add(inner);
    }
    // Whiskers: fine, slightly drooping, from the whisker pads.
    const wpos = [];
    for (const s of [-1, 1]) {
        for (let k = 0; k < 5; k++) {
            const y = -0.016 - k * 0.0028;
            const sx = s * 0.014;
            const mx = s * (0.032 + k * 0.003);
            const ex = s * (0.052 + k * 0.004);
            wpos.push(sx, y, 0.048, mx, y - 0.002 + (2 - k) * 0.0015, 0.044 - k * 0.002);
            wpos.push(mx, y - 0.002 + (2 - k) * 0.0015, 0.044 - k * 0.002, ex, y - 0.007 + (2 - k) * 0.003, 0.036 - k * 0.003);
        }
    }
    const whiskers = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: spec.whiskers || '#e9e5dc', transparent: true, opacity: 0.32, depthWrite: false }));
    whiskers.geometry.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    sk.head.add(whiskers);
    // Paws: soft ovals on the ends of the legs.
    const pawMat = (part) => (spec.tabby ? mats[part === 'leg' ? 2 : 3] : muzzleMat);
    for (const k of [0, 1]) {
        const fp = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), spec.whitePaws ? muzzleMat : pawMat('leg'));
        fp.scale.set(0.0145, 0.011, 0.02);
        fp.position.set(0, -0.016, 0.007);
        fp.castShadow = true;
        sk.front[k][2].add(fp);
        const hp = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), spec.whitePaws ? muzzleMat : pawMat('hindleg'));
        hp.scale.set(0.0135, 0.0105, 0.024);
        hp.position.set(0, -0.022, 0.012);
        hp.castShadow = true;
        sk.hind[k][2].add(hp);
    }
    const root = new THREE.Group();
    root.add(mesh);
    return { root, mesh, ...sk, eyes };
}

// ---------------------------------------------------------------------------
// Poses: joint angles. Legs are [upper, middle, lower] per side.
// ---------------------------------------------------------------------------

export const CAT_POSES = {
    stand: { drop: -0.012, pitch: 0, spine: 0, neck: 0.15, head: -0.12, front: [0.02, 0.06, -0.08], hind: [-0.42, 0.92, -0.5], tailLift: 0.35, tailCurl: 0.2 },
    walk: { drop: -0.012, pitch: 0, spine: 0, neck: 0.22, head: -0.12, front: [0.02, 0.06, -0.08], hind: [-0.42, 0.92, -0.5], tailLift: 0.75, tailCurl: 0.25 },
    sit: { drop: -0.122, pitch: -0.62, spine: 0.12, neck: 0.42, head: 0.02, front: [0.6, -0.02, -0.02], hind: [-1.7, 2.3, -1.0], tailLift: -0.75, tailCurl: 0.95 },
    loaf: { drop: -0.128, pitch: 0.02, spine: 0, neck: 0.32, head: -0.06, front: [-1.15, 2.2, -1.0], hind: [-1.35, 2.25, -0.85], tailLift: -0.25, tailCurl: 1.1 },
    crouch: { drop: -0.06, pitch: 0.1, spine: 0.05, neck: 0.2, head: -0.1, front: [0.3, 0.15, -0.35], hind: [-0.95, 1.75, -0.85], tailLift: 0.0, tailCurl: 0.1 },
    leap: { drop: 0.0, pitch: -0.18, spine: -0.1, neck: 0.25, head: -0.05, front: [-1.05, 0.25, 0.35], hind: [0.95, 0.35, 0.25], tailLift: 0.15, tailCurl: 0.0 }
};

/**
 * Apply blended joint values plus a walk cycle.
 * p: blended pose values; gait: 0..1 how much walking; phase: radians;
 * stride: swing amplitude; look: { yaw, pitch }; t: seconds; seed: per cat.
 */
export function applyCatPose(m, p, { gait = 0, phase = 0, stride = 0, look = { yaw: 0, pitch: 0 }, t = 0, seed = 0 } = {}) {
    const bob = 0.005 * Math.cos(phase * 2) * gait;
    m.hips.position.y = REST.hips[1] + p.drop + bob;
    m.hips.rotation.set(p.pitch, Math.sin(phase) * 0.05 * gait, Math.sin(phase) * 0.03 * gait);
    m.spine.rotation.set(p.spine * 0.5, -Math.sin(phase) * 0.04 * gait, 0);
    m.chest.rotation.set(p.spine * 0.5, -Math.sin(phase) * 0.03 * gait, 0);
    m.neck.rotation.set(p.neck + look.pitch * 0.4, look.yaw * 0.35, 0);
    m.head.rotation.set(p.head + look.pitch * 0.6 - p.pitch * 0.2, look.yaw * 0.65, -look.yaw * 0.08);
    // Lateral-sequence walk: hind left, fore left, hind right, fore right.
    const off = { front: [0.25, 0.75], hind: [0, 0.5] };
    for (const side of [0, 1]) {
        const fa = phase + off.front[side] * TAU;
        const ha = phase + off.hind[side] * TAU;
        const fSwing = Math.sin(fa) * stride;
        const fLift = Math.max(0, -Math.cos(fa)) * stride;
        const [s1, s2, s3] = m.front[side];
        s1.rotation.x = p.front[0] + fSwing;
        s2.rotation.x = p.front[1] + fLift * 1.4;
        s3.rotation.x = p.front[2] - fLift * 0.9;
        const hSwing = Math.sin(ha) * stride * 0.9;
        const hLift = Math.max(0, -Math.cos(ha)) * stride;
        const [h1, h2, h3] = m.hind[side];
        h1.rotation.x = p.hind[0] + hSwing;
        h2.rotation.x = p.hind[1] + hLift * 0.9;
        h3.rotation.x = p.hind[2] - hLift * 0.6;
    }
    // Tail: lifted from the root, bending along its length, alive at the tip.
    m.tail.forEach((b, k) => {
        const f = k / m.tail.length;
        const sway = Math.sin(t * (1.4 + gait) - k * 0.55 + seed) * (0.06 + 0.12 * gait) * (0.3 + f);
        b.rotation.x = k === 0 ? p.tailLift : (0.04 - 0.1 * p.tailCurl * (k > 3 ? 1 : 0)) + gait * (k > 5 ? -0.2 : 0.07);
        b.rotation.y = sway + p.tailCurl * 0.3 * (k > 1 ? 1 : 0.2);
    });
}
