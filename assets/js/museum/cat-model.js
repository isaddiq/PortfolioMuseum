// A realistic cat, built in code.
//
// Body: one continuous skinned mesh on a skeleton (hips, spine, chest, neck,
// head, three-joint legs and a nine-bone tail), lofted through smoothly
// interpolated anatomical cross-sections: rump, waist, ribcage, shoulders,
// neck; a sculpted head with a domed skull, brow, cheek ruff, a short muzzle
// and chin.
//
// Fur: a painted coat (mackerel tabby or tuxedo) with a strand normal map and
// a velvet sheen, and over it shell fur: ten thin copies of the body pushed
// out along its normals, each keeping fewer strands, the strands combed back
// and drooping a little, darker at the roots and lighter at the tips. Up close
// the outline is soft and furry rather than smooth; further away the shells
// are switched off.
//
// Face: a leather nose with nostrils, mouth and philtrum lines, almond eyes
// with a dark rim, a slit-pupil iris and a glossy cornea, whisker pads and
// tapered whiskers, ears with pale inner fur and tufts. Paws have toe beans.
//
// Mesh space: the cat faces +z, y is up, paws on y = 0. Bones are posed by
// joint angles (applyCatPose): rotation.x > 0 swings a leg backwards and
// lifts the tail.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const SHELLS = 10;

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
// Lofting
// ---------------------------------------------------------------------------

/** Catmull-Rom through the rows of a table, `steps` new rows per interval. */
function densify(table, steps) {
    const out = [];
    const n = table.length;
    for (let i = 0; i < n - 1; i++) {
        const p0 = table[Math.max(0, i - 1)];
        const p1 = table[i];
        const p2 = table[i + 1];
        const p3 = table[Math.min(n - 1, i + 2)];
        for (let s = 0; s < steps; s++) {
            const t = s / steps;
            const t2 = t * t;
            const t3 = t2 * t;
            out.push(p1.map((_, k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
        }
    }
    out.push(table[n - 1].slice());
    return out;
}

/**
 * rings: [{ c: [x, y, z], rx, ry, w: [[bone, weight], ...] }]
 * axis 'z': rings lie in xy (trunk, head, tail); 'y': rings lie in xz (legs).
 * shape(a, ring, rx, ry) may reshape a ring at angle a (0 = top / front).
 * uv: u runs round the part, v from 0 to 1 along it.
 */
function loft(rings, axis, segs, { shape } = {}) {
    const pos = [];
    const uv = [];
    const skinI = [];
    const skinW = [];
    const along = [0];
    for (let i = 1; i < rings.length; i++) {
        const a = rings[i].c;
        const b = rings[i - 1].c;
        along.push(along[i - 1] + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    const total = along[along.length - 1] || 1;
    rings.forEach((r, i) => {
        const w = [...r.w, [0, 0], [0, 0], [0, 0]].slice(0, 4);
        for (let k = 0; k <= segs; k++) {
            const a = (k / segs) * TAU;
            let rx = r.rx;
            let ry = r.ry;
            if (shape) [rx, ry] = shape(a, r, rx, ry);
            if (axis === 'z') pos.push(r.c[0] + rx * Math.sin(a), r.c[1] + ry * Math.cos(a), r.c[2]);
            else pos.push(r.c[0] + rx * Math.sin(a), r.c[1], r.c[2] + ry * Math.cos(a));
            uv.push(k / segs, along[i] / total);
            skinI.push(w[0][0], w[1][0], w[2][0], w[3][0]);
            skinW.push(w[0][1], w[1][1], w[2][1], w[3][1]);
        }
    });
    // Wind every triangle to face outwards, whichever way the rings run.
    const idx = [];
    const n = segs + 1;
    const first = rings[0].c;
    const last = rings[rings.length - 1].c;
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
// Fur
// ---------------------------------------------------------------------------

let strandNormal = null;
let strandField = null;

/** A tileable strand normal map shared by every cat. */
function furNormalMap() {
    if (strandNormal) return strandNormal;
    const N = 256;
    const h = new Float32Array(N * N);
    for (let s = 0; s < 6500; s++) {
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

/** Strand field for the shells: each texel is one hair, its value how long it is. */
function furStrands() {
    if (strandField) return strandField;
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
        // Mostly long guard hairs and undercoat, a few short ones.
        const v = Math.pow(Math.random(), 0.7) * 255;
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
            const top = Math.cos(u * TAU);  // 1 on the back (or the front of a leg), -1 underneath
            const side = Math.sin(u * TAU);
            col.copy(base);
            if (spec.tabby) {
                let band = 0;
                if (part === 'trunk') band = Math.sin(v * 64 + Math.sin(u * TAU * 3) * 0.9 + top * 1.4 + Math.sin(v * 23 + u * 9) * 0.6);
                else if (part === 'tail') band = Math.sin(v * 52);
                else if (part === 'leg' || part === 'hindleg') band = Math.sin(v * 95 + side * 0.4) * (0.35 + 0.65 * smooth(vn * 1.6));
                // The forehead "M": dark lines over the brow, and stripes from the eyes back over the cheeks.
                else if (part === 'head') {
                    const brow = Math.sin(u * TAU * 7) * smooth((top - 0.35) / 0.4) * smooth((vn - 0.15) / 0.2) * (1 - smooth((vn - 0.62) / 0.1));
                    const cheek = Math.sin(vn * 40 + side * 2) * smooth((Math.abs(side) - 0.75) / 0.2) * smooth((vn - 0.3) / 0.15) * (1 - smooth((vn - 0.6) / 0.1));
                    band = Math.max(brow, cheek);
                }
                let stripe = smooth((band - 0.25) / 0.45);
                if (part === 'trunk') stripe *= smooth((top + 0.35) / 0.6);
                if (part === 'tail' && vn > 0.85) stripe = 1;
                col.lerp(dark, stripe * 0.6);
                if (part === 'trunk' || part === 'tail') col.lerp(dark, smooth((top - 0.75) / 0.25) * 0.35);
                const pale = part === 'head'
                    ? Math.max(smooth((vn - 0.66) / 0.12) * smooth((-top + 0.1) / 0.5), smooth((vn - 0.45) / 0.1) * smooth((0.2 - Math.abs(side)) / 0.15) * 0.5)
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

function furMaterial(spec, map) {
    return new THREE.MeshPhysicalMaterial({
        map,
        normalMap: furNormalMap(),
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughness: 0.9,
        sheen: 1,
        sheenRoughness: 0.5,
        sheenColor: new THREE.Color(spec.sheen || spec.light).multiplyScalar(0.6),
        envMapIntensity: 0.55
    });
}

/**
 * One layer of shell fur over a part: the body pushed out along its normals
 * by `layer` of the fur length, keeping only the strands that reach this far.
 * len: fur length (m); density: strands per uv unit (u round, v along);
 * comb: the direction the hair lies, in the cat's own space.
 */
function shellMaterial(map, layer, { len, density, comb }) {
    // Alpha-to-coverage softens strand edges with MSAA; the alpha test keeps them cut out without it.
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.95, alphaToCoverage: true, alphaTest: 0.5 });
    const uniforms = {
        uShell: { value: layer },
        uFurLen: { value: len },
        uDensity: { value: new THREE.Vector2(...density) },
        uComb: { value: new THREE.Vector3(...comb) },
        uStrands: { value: furStrands() }
    };
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uShell;\nuniform float uFurLen;\nuniform vec3 uComb;')
            .replace('#include <skinning_vertex>', `#include <skinning_vertex>
                // Out along the (skinned) normal; the hair lies back and droops towards its tip.
                transformed += normalize(objectNormal) * uFurLen * uShell + uComb * uFurLen * uShell * uShell;`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uShell;\nuniform vec2 uDensity;\nuniform sampler2D uStrands;')
            .replace('#include <map_fragment>', `#include <map_fragment>
                float strand = texture2D(uStrands, vMapUv * uDensity).r;
                // Fewer strands reach each layer out; their tips are soft.
                float cut = mix(0.12, 0.95, uShell);
                diffuseColor.a = smoothstep(cut - 0.06, cut + 0.04, strand);
                // Shadowed at the roots, catching the light at the tips.
                diffuseColor.rgb *= mix(0.6, 1.12, uShell);`);
    };
    mat.customProgramCacheKey = () => 'cat-shell';
    return mat;
}

/** An iris with radial fibres, a dark limbal ring and a vertical slit pupil. */
function irisTexture(color) {
    const S = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d');
    const c = new THREE.Color(color);
    const hex = (k) => `#${k.getHexString()}`;
    const g = ctx.createRadialGradient(S / 2, S / 2, 6, S / 2, S / 2, S / 2);
    g.addColorStop(0, hex(c.clone().lerp(new THREE.Color('#3d5a1a'), 0.35)));
    g.addColorStop(0.35, hex(c.clone().multiplyScalar(1.08)));
    g.addColorStop(0.78, hex(c));
    g.addColorStop(0.92, hex(c.clone().multiplyScalar(0.55)));
    g.addColorStop(1, '#1a140c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    for (let k = 0; k < 320; k++) {
        const a = Math.random() * TAU;
        const r0 = 14 + Math.random() * 20;
        const r1 = 70 + Math.random() * 46;
        ctx.strokeStyle = `rgba(${Math.random() < 0.55 ? '255,236,180' : '50,34,10'},${0.06 + Math.random() * 0.12})`;
        ctx.lineWidth = 1 + Math.random();
        ctx.beginPath();
        ctx.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
        ctx.quadraticCurveTo(S / 2 + Math.cos(a + 0.08) * (r0 + r1) / 2, S / 2 + Math.sin(a + 0.08) * (r0 + r1) / 2, S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
        ctx.stroke();
    }
    // The pupil: a vertical slit with soft edges.
    ctx.fillStyle = '#040404';
    ctx.beginPath();
    ctx.ellipse(S / 2, S / 2, 13, 92, 0, 0, TAU);
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/** A small rounded inverted triangle: the nose leather. */
function noseGeometry() {
    const s = new THREE.Shape();
    const w = 0.0047;
    const h = 0.0041;
    s.moveTo(0, -h);
    s.quadraticCurveTo(w * 0.35, -h * 0.95, w * 0.95, h * 0.05);
    s.quadraticCurveTo(w * 1.05, h * 0.65, w * 0.5, h * 0.62);
    s.quadraticCurveTo(0, h * 0.75, -w * 0.5, h * 0.62);
    s.quadraticCurveTo(-w * 1.05, h * 0.65, -w * 0.95, h * 0.05);
    s.quadraticCurveTo(-w * 0.35, -h * 0.95, 0, -h);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0012, bevelEnabled: true, bevelThickness: 0.0007, bevelSize: 0.0007, bevelSegments: 3, curveSegments: 8 });
    g.translate(0, 0, -0.0008);
    return g;
}

// ---------------------------------------------------------------------------

export function buildCatModel(spec) {
    const sk = makeSkeleton();
    const I = (b) => b.userData.index;
    const parts = {};

    // Trunk: rump, waist, ribcage, shoulders and neck (z, centre y, half-width, half-height).
    const trunkTable = [
        [-0.226, 0.204, 0.006, 0.006], [-0.217, 0.205, 0.034, 0.038], [-0.198, 0.206, 0.053, 0.061],
        [-0.168, 0.205, 0.064, 0.074], [-0.13, 0.204, 0.066, 0.08], [-0.09, 0.205, 0.058, 0.071],
        [-0.05, 0.206, 0.055, 0.067], [-0.005, 0.209, 0.058, 0.071], [0.04, 0.214, 0.062, 0.075],
        [0.085, 0.219, 0.061, 0.075], [0.12, 0.226, 0.054, 0.067], [0.148, 0.238, 0.045, 0.055],
        [0.174, 0.255, 0.038, 0.044], [0.198, 0.275, 0.034, 0.038], [0.222, 0.293, 0.031, 0.033],
        // The throat runs on under the jaw, so no light shows between chin and neck.
        [0.236, 0.287, 0.026, 0.024], [0.247, 0.283, 0.012, 0.01], [0.251, 0.282, 0.002, 0.002]
    ];
    const trunkRings = densify(trunkTable, 4).map(([z, y, rx, ry]) => ({
        c: [0, y, z], rx, ry,
        w: chainWeights(z, [[-0.12, I(sk.hips)], [0.0, I(sk.spine)], [0.1, I(sk.chest)], [0.165, I(sk.neck)], [0.212, I(sk.head)]])
    }));
    parts.trunk = loft(trunkRings, 'z', 40, {
        // A deeper keel under the chest, a slightly flatter back, the shoulder blades a touch proud.
        shape: (a, r, rx, ry) => {
            const c = Math.cos(a);
            const keel = Math.max(0, Math.min(1, r.c[2] / 0.1));
            const blades = Math.exp(-(((r.c[2] - 0.11) / 0.03) ** 2)) * Math.max(0, c - 0.5) * 0.06;
            return c < 0 ? [rx * 0.96, ry * (1.04 + 0.06 * keel)] : [rx * (1 + blades), ry * (0.97 + blades)];
        }
    });

    // Head: domed skull, brow, cheek ruff, short muzzle (z, y, half-width, half-height), rigid on the head bone.
    const H = REST.head;
    const headTable = [
        [-0.039, 0.004, 0.004, 0.004], [-0.033, 0.006, 0.024, 0.025], [-0.022, 0.006, 0.034, 0.033],
        [-0.008, 0.004, 0.039, 0.035], [0.006, 0.0, 0.041, 0.033], [0.017, -0.004, 0.038, 0.029],
        [0.027, -0.009, 0.03, 0.024], [0.035, -0.012, 0.022, 0.019], [0.043, -0.014, 0.017, 0.015],
        [0.05, -0.015, 0.013, 0.012], [0.054, -0.015, 0.006, 0.006], [0.056, -0.015, 0.001, 0.001]
    ];
    const headRings = densify(headTable, 3).map(([z, y, rx, ry]) => ({ c: [H[0], H[1] + y, H[2] + z], rx, ry, w: [[I(sk.head), 1]] }));
    parts.head = loft(headRings, 'z', 40, {
        shape: (a, r, rx, ry) => {
            const c = Math.cos(a);
            const z = r.c[2] - H[2];
            // Cheek ruff: fuller low and to the sides, where the skull meets the jaw.
            const ruff = Math.exp(-(((z - 0.008) / 0.02) ** 2)) * Math.max(0, -c + 0.15) * 0.22;
            // A flat brow on top, and a slight dip (the stop) between brow and nose.
            const stop = Math.exp(-(((z - 0.03) / 0.008) ** 2)) * Math.max(0, c - 0.3) * 0.12;
            return [rx * (1 + ruff), ry * (c > 0.6 ? 0.93 - stop : 1)];
        }
    });

    // Legs: slender, hidden in the body above the elbow and stifle.
    parts.leg = [];
    parts.hindleg = [];
    for (const [k, s] of [[0, -1], [1, 1]]) {
        const [sh, el, wr] = sk.front[k];
        const x = s * FRONT.x;
        const rings = densify([[0.262, 0.003], [0.25, 0.011], [0.22, 0.0135], [0.19, 0.015], [0.16, 0.016], [0.135, 0.0155], [0.112, 0.0148], [0.09, 0.0133], [0.06, 0.0122], [0.035, 0.0112], [0.026, 0.0108], [0.02, 0.008], [0.016, 0.002]], 2)
            .map(([y, r]) => ({
                c: [x, y, FRONT.z + (y > 0.15 ? 0.006 : 0)], rx: r * 0.88, ry: r * (y > 0.15 ? 1.15 : 1),
                w: chainWeights(-y, [[-0.215, I(sk.chest)], [-0.19, I(sh)], [-0.118, I(sh)], [-0.106, I(el)], [-0.034, I(el)], [-0.026, I(wr)]])
            }));
        parts.leg.push(loft(rings, 'y', 20));
        const [hp, kn, hk] = sk.hind[k];
        const hx = s * HIND.x;
        const hr = densify([[0.255, 0.004], [0.245, 0.016], [0.22, 0.02], [0.19, 0.022], [0.16, 0.021], [0.138, 0.0185], [0.118, 0.016], [0.1, 0.0142], [0.075, 0.0122], [0.052, 0.0112], [0.04, 0.0102], [0.02, 0.0102], [0.014, 0.007], [0.01, 0.002]], 2)
            .map(([y, r]) => ({
                c: [hx, y, HIND.z + (y > 0.12 ? -0.01 : 0)], rx: r * (y > 0.13 ? 0.8 : 0.9), ry: r * (y > 0.13 ? 1.3 : 1),
                w: chainWeights(-y, [[-0.205, I(sk.hips)], [-0.18, I(hp)], [-0.12, I(hp)], [-0.104, I(kn)], [-0.054, I(kn)], [-0.044, I(hk)]])
            }));
        parts.hindleg.push(loft(hr, 'y', 20));
    }

    // Tail: tapering, rounded at the tip.
    const tailRings = [];
    const TL = TAIL.step * (TAIL.n - 1) + 0.03;
    const stops = sk.tail.map((b, i) => [-(TAIL.z - i * TAIL.step), I(b)]);
    for (let k = 0; k <= 36; k++) {
        const f = k / 36;
        const z = TAIL.z + 0.02 - f * TL;
        const r = (0.0165 - 0.0075 * f) * (f > 0.94 ? Math.sqrt(Math.max(0, 1 - (f - 0.94) / 0.06)) + 0.05 : 1);
        tailRings.push({ c: [0, TAIL.y + 0.002, z], rx: r, ry: r, w: z > TAIL.z ? [[I(sk.hips), 1]] : chainWeights(-z, stops) });
    }
    parts.tail = loft(tailRings, 'z', 16);

    // Coat maps and the skin-level materials.
    const lens = { trunk: 0.45, head: 0.095, leg: 0.22, hindleg: 0.22, tail: 0.3 };
    const order = ['trunk', 'head', 'leg', 'hindleg', 'tail'];
    const maps = Object.fromEntries(order.map((p) => [p, furMap(spec, p, lens[p])]));
    const mats = order.map((p) => furMaterial(spec, maps[p]));
    const geos = order.flatMap((p) => [].concat(parts[p]));
    const counts = order.map((p) => [].concat(parts[p]).length);
    const merged = mergeGeometries(geos, true);
    merged.clearGroups();
    let start = 0;
    let gi = 0;
    order.forEach((p, pi) => {
        let count = 0;
        for (let k = 0; k < counts[pi]; k++) count += geos[gi++].index.count;
        merged.addGroup(start, count, pi);
        start += count;
    });
    const skeleton = new THREE.Skeleton(sk.bones);
    const mesh = new THREE.SkinnedMesh(merged, mats);
    mesh.add(sk.hips);
    mesh.bind(skeleton);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const root = new THREE.Group();
    root.add(mesh);

    // Shell fur over the body, head and tail (strand density ≈ 1.6 mm apart).
    const shellParts = [
        { geo: parts.trunk, map: maps.trunk, len: 0.0065, density: [1.0, 1.1], comb: [0, -0.25, -0.9] },
        { geo: parts.head, map: maps.head, len: 0.0035, density: [0.7, 0.24], comb: [0, 0.1, -0.9] },
        { geo: parts.tail, map: maps.tail, len: 0.0085, density: [0.18, 0.75], comb: [0, -0.3, -0.8] }
    ];
    const shellGeo = mergeGeometries(shellParts.map((s) => s.geo), true);
    const shells = [];
    for (let l = 1; l <= SHELLS; l++) {
        const layer = l / SHELLS;
        const shell = new THREE.SkinnedMesh(shellGeo, shellParts.map((s) => shellMaterial(s.map, layer, s)));
        shell.bind(skeleton, mesh.bindMatrix);
        shell.frustumCulled = false;
        shell.castShadow = false;
        shell.receiveShadow = true;
        shell.renderOrder = l;
        root.add(shell);
        shells.push(shell);
    }

    // --- the face ------------------------------------------------------------
    const muzzleMat = new THREE.MeshPhysicalMaterial({ color: spec.muzzle || spec.light, roughness: 0.92, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(spec.light).multiplyScalar(0.5), normalMap: furNormalMap(), normalScale: new THREE.Vector2(0.45, 0.45) });
    const ball = (mat, sx, sy, sz, x, y, z, parent = sk.head, seg = 20) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75)), mat);
        m.scale.set(sx, sy, sz);
        m.position.set(x, y, z);
        m.castShadow = true;
        parent.add(m);
        return m;
    };
    // Whisker pads and chin.
    for (const s of [-1, 1]) ball(muzzleMat, 0.0098, 0.0082, 0.0094, s * 0.0076, -0.0168, 0.0425);
    ball(muzzleMat, 0.0085, 0.0058, 0.0092, 0, -0.0262, 0.0365);
    // Nose leather with nostrils.
    const leather = new THREE.MeshPhysicalMaterial({ color: spec.nose || '#b06a6e', roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.35 });
    const nose = new THREE.Mesh(noseGeometry(), leather);
    nose.position.set(0, -0.0088, 0.0545);
    nose.rotation.x = -0.55;
    nose.castShadow = true;
    sk.head.add(nose);
    const dark = new THREE.MeshStandardMaterial({ color: '#1b1412', roughness: 0.6 });
    for (const s of [-1, 1]) {
        const nostril = ball(dark, 0.0011, 0.0008, 0.0009, s * 0.0021, -0.0099, 0.0566, sk.head, 10);
        nostril.rotation.z = s * 0.5;
    }
    // Philtrum and mouth: fine dark lines below the nose.
    const line = (pts, r = 0.00045) => {
        const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
        const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, r, 5), dark);
        sk.head.add(m);
    };
    line([[0, -0.0135, 0.0525], [0, -0.0175, 0.0505], [0, -0.0205, 0.0478]]);
    for (const s of [-1, 1]) line([[0, -0.0205, 0.0478], [s * 0.004, -0.0218, 0.0468], [s * 0.0085, -0.0212, 0.0445], [s * 0.0115, -0.0222, 0.0408]]);

    // Eyes: almond-shaped, a dark rim, the iris and a clear cornea.
    // A faint glow from the iris: a cat's eye catches the light (tapetum).
    const irisTex = irisTexture(spec.eyes);
    const irisMat = new THREE.MeshStandardMaterial({ map: irisTex, roughness: 0.35, emissive: '#ffffff', emissiveMap: irisTex, emissiveIntensity: 0.14 });
    const corneaMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, roughness: 0, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.6, depthWrite: false });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#16110e', roughness: 0.55 });
    const eyes = [-1, 1].map((s) => {
        const g = new THREE.Group();
        g.position.set(s * 0.0188, 0.0085, 0.0292);
        g.lookAt(new THREE.Vector3(s * 0.0188 + s * 0.42, 0.0085 + 0.07, 0.0292 + 1));
        sk.head.add(g);
        const almond = new THREE.Group();
        almond.scale.set(1.12, 0.8, 1);
        almond.rotation.z = s * 0.18;      // outer corners a little higher
        g.add(almond);
        const ball2 = new THREE.Mesh(new THREE.SphereGeometry(0.0077, 20, 14), rimMat);
        ball2.scale.z = 0.55;
        almond.add(ball2);
        const iris = new THREE.Mesh(new THREE.CircleGeometry(0.0074, 32), irisMat);
        iris.position.z = 0.0042;
        almond.add(iris);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0076, 0.0006, 8, 40), rimMat);
        rim.position.z = 0.0043;
        almond.add(rim);
        const cornea = new THREE.Mesh(new THREE.SphereGeometry(0.0079, 24, 16, 0, TAU, 0, Math.PI / 2.6), corneaMat);
        cornea.rotation.x = Math.PI / 2;
        cornea.position.z = 0.0008;
        almond.add(cornea);
        return g;
    });

    // Ears: a thin shell with pale inner fur and a few tufts, on a hinge for twitching.
    const earMat = mats[1].clone();
    earMat.side = THREE.DoubleSide;
    const innerMat = new THREE.MeshPhysicalMaterial({ color: spec.innerEar || '#c99a93', roughness: 0.8, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color('#ffffff').multiplyScalar(0.4), side: THREE.DoubleSide });
    const tuftMat = new THREE.MeshStandardMaterial({ color: spec.light, roughness: 0.9 });
    const ears = [-1, 1].map((s) => {
        const ear = new THREE.Group();
        ear.position.set(s * 0.022, 0.026, -0.009);
        ear.rotation.set(-0.12, s * -0.25, s * -0.38);
        sk.head.add(ear);
        const shell = new THREE.Mesh(new THREE.ConeGeometry(0.0195, 0.04, 24, 1, true, Math.PI * 0.32, Math.PI * 1.36), earMat);
        shell.position.y = 0.0195;
        shell.scale.z = 0.6;
        shell.castShadow = true;
        ear.add(shell);
        const inner = new THREE.Mesh(new THREE.ConeGeometry(0.0165, 0.035, 20, 1, true, Math.PI * 0.42, Math.PI * 1.16), innerMat);
        inner.position.set(0, 0.0165, 0.002);
        inner.scale.z = 0.45;
        ear.add(inner);
        for (let k = 0; k < 4; k++) {
            const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.0012, 0.014, 5), tuftMat);
            tuft.position.set((k - 1.5) * 0.0035, 0.009, 0.006);
            tuft.rotation.set(0.5, 0, (k - 1.5) * 0.25);
            ear.add(tuft);
        }
        return ear;
    });

    // Whiskers: tapered, drooping, a few over the eyes too.
    const whiskerMat = new THREE.LineBasicMaterial({ color: spec.whiskers || '#f1eee6', transparent: true, opacity: 0.55, depthWrite: false });
    const wpos = [];
    const seg = (a, b) => wpos.push(...a, ...b);
    for (const s of [-1, 1]) {
        for (let k = 0; k < 6; k++) {
            const y = -0.0148 - k * 0.0024;
            const p0 = [s * 0.0125, y, 0.0455];
            const p1 = [s * (0.03 + k * 0.002), y - 0.001 + (2.5 - k) * 0.0014, 0.0428 - k * 0.0018];
            const p2 = [s * (0.048 + k * 0.003), y - 0.005 + (2.5 - k) * 0.0026, 0.036 - k * 0.0028];
            const p3 = [s * (0.06 + k * 0.0035), y - 0.011 + (2.5 - k) * 0.0034, 0.028 - k * 0.0034];
            seg(p0, p1); seg(p1, p2); seg(p2, p3);
        }
        for (let k = 0; k < 2; k++) {
            const p0 = [s * (0.017 + k * 0.004), 0.019, 0.031];
            seg(p0, [s * (0.028 + k * 0.006), 0.033 + k * 0.002, 0.034]);
        }
    }
    const whiskers = new THREE.LineSegments(new THREE.BufferGeometry(), whiskerMat);
    whiskers.geometry.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    sk.head.add(whiskers);

    // Paws: a soft pad with four toes (beans) at the front.
    const pawMat = (part) => (spec.whitePaws ? muzzleMat : mats[part]);
    for (const k of [0, 1]) {
        const fp = ball(pawMat(2), 0.0138, 0.0098, 0.0172, 0, -0.0165, 0.006, sk.front[k][2], 16);
        const hp = ball(pawMat(3), 0.0128, 0.0094, 0.021, 0, -0.0225, 0.011, sk.hind[k][2], 16);
        for (let t = 0; t < 4; t++) {
            const a = (t - 1.5) * 0.42;
            ball(pawMat(2), 0.0046, 0.0052, 0.0052, Math.sin(a) * 0.0105, -0.0198, 0.017 + Math.cos(a) * 0.0035, sk.front[k][2], 10);
            ball(pawMat(3), 0.0043, 0.005, 0.005, Math.sin(a) * 0.0098, -0.026, 0.026 + Math.cos(a) * 0.0032, sk.hind[k][2], 10);
        }
        fp.castShadow = hp.castShadow = true;
    }

    let furOn = true;
    return {
        root, mesh, ...sk, eyes, ears, shells,
        /** Shell fur is drawn only near the visitor. */
        setFur(on) {
            if (on === furOn) return;
            furOn = on;
            for (const s of shells) s.visible = on;
        }
    };
}

// ---------------------------------------------------------------------------
// Poses: joint angles. Legs are [upper, middle, lower] per side.
// raise lifts the right forepaw (grooming); lick nods the head to it.
// ---------------------------------------------------------------------------

export const CAT_POSES = {
    stand: { drop: -0.012, pitch: 0, spine: 0, neck: 0.15, head: -0.12, front: [0.02, 0.06, -0.08], hind: [-0.42, 0.92, -0.5], tailLift: 0.35, tailCurl: 0.2, raise: 0, lick: 0 },
    walk: { drop: -0.012, pitch: 0, spine: 0, neck: 0.22, head: -0.12, front: [0.02, 0.06, -0.08], hind: [-0.42, 0.92, -0.5], tailLift: 0.75, tailCurl: 0.25, raise: 0, lick: 0 },
    sit: { drop: -0.122, pitch: -0.62, spine: 0.12, neck: 0.42, head: 0.02, front: [0.6, -0.02, -0.02], hind: [-1.7, 2.3, -1.0], tailLift: -0.75, tailCurl: 0.95, raise: 0, lick: 0 },
    groom: { drop: -0.122, pitch: -0.62, spine: 0.16, neck: 0.62, head: 0.38, front: [0.6, -0.02, -0.02], hind: [-1.7, 2.3, -1.0], tailLift: -0.75, tailCurl: 1.0, raise: 1, lick: 1 },
    loaf: { drop: -0.128, pitch: 0.02, spine: 0, neck: 0.32, head: -0.06, front: [-1.15, 2.2, -1.0], hind: [-1.35, 2.25, -0.85], tailLift: -0.25, tailCurl: 1.1, raise: 0, lick: 0 },
    crouch: { drop: -0.06, pitch: 0.1, spine: 0.05, neck: 0.2, head: -0.1, front: [0.3, 0.15, -0.35], hind: [-0.95, 1.75, -0.85], tailLift: 0.0, tailCurl: 0.1, raise: 0, lick: 0 },
    leap: { drop: 0.0, pitch: -0.18, spine: -0.1, neck: 0.25, head: -0.05, front: [-1.05, 0.25, 0.35], hind: [0.95, 0.35, 0.25], tailLift: 0.15, tailCurl: 0.0, raise: 0, lick: 0 }
};

/**
 * Apply blended joint values, the walk cycle and the small signs of life.
 * p: blended pose values; gait: 0..1 how much walking; phase: radians;
 * stride: swing amplitude; look: { yaw, pitch }; t: seconds; seed: per cat;
 * ears: [left, right] twitch angles; flick: tail-tip flick, 0..1.
 */
export function applyCatPose(m, p, { gait = 0, phase = 0, stride = 0, look = { yaw: 0, pitch: 0 }, t = 0, seed = 0, ears = [0, 0], flick = 0 } = {}) {
    const bob = 0.005 * Math.cos(phase * 2) * gait;
    m.hips.position.y = REST.hips[1] + p.drop + bob;
    m.hips.rotation.set(p.pitch, Math.sin(phase) * 0.05 * gait, Math.sin(phase) * 0.03 * gait);
    m.spine.rotation.set(p.spine * 0.5, -Math.sin(phase) * 0.04 * gait, 0);
    m.chest.rotation.set(p.spine * 0.5, -Math.sin(phase) * 0.03 * gait, Math.sin(phase + 1) * 0.02 * gait);
    // Breathing: the ribcage swells a little, faster on the move; the head and forelegs do not.
    const breath = 1 + Math.sin(t * (gait > 0.3 ? 4.2 : 2.6) + seed) * 0.014;
    m.chest.scale.set(breath, breath, 1);
    m.neck.scale.set(1 / breath, 1 / breath, 1);
    for (const leg of m.front) leg[0].scale.set(1 / breath, 1 / breath, 1);
    // The head stays steady while the body bobs; grooming nods it to the paw.
    const lick = p.lick > 0.01 ? Math.max(0, Math.sin(t * 7.5)) * 0.16 * p.lick : 0;
    m.neck.rotation.set(p.neck + look.pitch * 0.4 - bob * 4, look.yaw * 0.35 * (1 - p.lick), p.lick * -0.25);
    m.head.rotation.set(p.head + look.pitch * 0.6 - p.pitch * 0.2 + lick, look.yaw * 0.65 * (1 - p.lick) + p.lick * 0.35, -look.yaw * 0.08 - p.lick * 0.2);
    // Lateral-sequence walk: hind left, fore left, hind right, fore right.
    const off = { front: [0.25, 0.75], hind: [0, 0.5] };
    for (const side of [0, 1]) {
        const fa = phase + off.front[side] * TAU;
        const ha = phase + off.hind[side] * TAU;
        const fSwing = Math.sin(fa) * stride;
        const fLift = Math.max(0, -Math.cos(fa)) * stride;
        const [s1, s2, s3] = m.front[side];
        // Grooming raises the right forepaw to the mouth, with a small licking stroke.
        const raise = side === 1 ? p.raise : 0;
        s1.rotation.x = p.front[0] + fSwing - raise * 1.55;
        s1.rotation.z = raise * -0.25;
        s2.rotation.x = p.front[1] + fLift * 1.4 + raise * (1.75 + lick * 0.6);
        s3.rotation.x = p.front[2] - fLift * 0.9 + raise * 0.5;
        const hSwing = Math.sin(ha) * stride * 0.9;
        const hLift = Math.max(0, -Math.cos(ha)) * stride;
        const [h1, h2, h3] = m.hind[side];
        h1.rotation.x = p.hind[0] + hSwing;
        h2.rotation.x = p.hind[1] + hLift * 0.9;
        h3.rotation.x = p.hind[2] - hLift * 0.6;
    }
    // Ears: a flick back and out now and then.
    m.ears.forEach((ear, i) => {
        const s = i ? 1 : -1;
        ear.rotation.set(-0.12 - ears[i] * 0.5, s * (-0.25 - ears[i] * 0.6), s * -0.38);
    });
    // Tail: lifted from the root, curving along its length, alive at the tip.
    m.tail.forEach((b, k) => {
        const f = k / m.tail.length;
        const sway = Math.sin(t * (1.4 + gait) - k * 0.55 + seed) * (0.06 + 0.12 * gait) * (0.3 + f);
        const tip = k >= m.tail.length - 3 ? Math.sin(t * 14) * 0.35 * flick : 0;
        b.rotation.x = k === 0 ? p.tailLift : (0.04 - 0.1 * p.tailCurl * (k > 3 ? 1 : 0)) + gait * (k > 5 ? -0.2 : 0.07) + (k > 5 ? 0.05 * Math.sin(t * 0.7 + seed) : 0);
        b.rotation.y = sway + p.tailCurl * 0.3 * (k > 1 ? 1 : 0.2) + tip;
    });
}
