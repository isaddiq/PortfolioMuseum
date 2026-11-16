// Realistic surfaces for the research demonstrations: a library of tileable,
// procedurally painted textures (concrete with formwork joints, brushed
// steel, worn paint, timber, clay, asphalt, soil, grass, tiles, plaster,
// model board, façades, curtain walls, lattice), and a material that lays
// them on any part by triplanar projection in the part's own space.
//
// Triplanar mapping keeps the texture at its real size whatever the shape:
// an instanced box 3 cm wide and one 80 cm wide both show 1 cm pores, and no
// face is stretched. The same texture drives a fine bump (from its own
// brightness) and a little roughness variation, fading the bump out where
// its detail is smaller than a pixel so nothing shimmers.

import * as THREE from 'three';

const cache = new Map();

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

function hash(x, y, s) {
    const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return n - Math.floor(n);
}

/** Tileable value noise on a size × size grid with `cells` cells across. */
function noise(size, cells, seed) {
    const out = new Float32Array(size * size);
    const lat = new Float32Array(cells * cells);
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) lat[j * cells + i] = hash(i, j, seed);
    const sm = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
        const fy = (y / size) * cells;
        const y0 = Math.floor(fy);
        const ty = sm(fy - y0);
        const y1 = (y0 + 1) % cells;
        for (let x = 0; x < size; x++) {
            const fx = (x / size) * cells;
            const x0 = Math.floor(fx);
            const tx = sm(fx - x0);
            const x1 = (x0 + 1) % cells;
            const a = lat[y0 * cells + x0] + (lat[y0 * cells + x1] - lat[y0 * cells + x0]) * tx;
            const b = lat[y1 * cells + x0] + (lat[y1 * cells + x1] - lat[y1 * cells + x0]) * tx;
            out[y * size + x] = a + (b - a) * ty;
        }
    }
    return out;
}

/** Fractal noise: octaves of tileable value noise, normalised to 0..1. */
function fbm(size, cells, octaves, seed, gain = 0.5) {
    const out = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
        const n = noise(size, cells << o, seed + o * 13);
        for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
        total += amp;
        amp *= gain;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
}

function rgb(hex) {
    const c = new THREE.Color(hex);
    return [c.r * 255, c.g * 255, c.b * 255];
}

/** Paint a canvas pixel by pixel: fn(x, y, i) returns [r, g, b] (0..255) or [r, g, b, a]. */
function pixels(size, fn) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const c = fn(x, y, i);
            const k = i * 4;
            img.data[k] = c[0];
            img.data[k + 1] = c[1];
            img.data[k + 2] = c[2];
            img.data[k + 3] = c.length > 3 ? c[3] : 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------------------
// Painters: each returns a tileable canvas
// ---------------------------------------------------------------------------

const PAINTERS = {
    concrete() {
        const S = 256;
        const n = fbm(S, 4, 5, 3);
        const fine = noise(S, 64, 9);
        const base = rgb('#b9b5ad');
        const canvas = pixels(S, (x, y, i) => {
            let k = 0.84 + 0.22 * (n[i] - 0.5) + 0.06 * (fine[i] - 0.5);
            if (hash(x, y, 1) > 0.992) k *= 0.62;           // air pores
            return shade(base, k);
        });
        // Formwork joints and tie holes.
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = 'rgba(70,66,60,0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.lineTo(S, 0.5); ctx.moveTo(0.5, 0); ctx.lineTo(0.5, S); ctx.stroke();
        ctx.fillStyle = 'rgba(60,56,52,0.45)';
        for (const [x, y] of [[64, 64], [192, 64], [64, 192], [192, 192]]) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); }
        return canvas;
    },
    precast() {
        const S = 256;
        const n = fbm(S, 4, 4, 5);
        const base = rgb('#cfccc5');
        return pixels(S, (x, y, i) => shade(base, 0.9 + 0.14 * (n[i] - 0.5) - (hash(x, y, 2) > 0.995 ? 0.2 : 0)));
    },
    steel() {
        const S = 256;
        const n = fbm(S, 4, 3, 11);
        const rows = new Float32Array(S).map((_, y) => hash(0, y, 4));
        const base = rgb('#9aa0a6');
        // Brushed along x: each row a little lighter or darker than the next.
        return pixels(S, (x, y, i) => shade(base, 0.86 + 0.09 * (rows[y] - 0.5) + 0.08 * (n[i] - 0.5)));
    },
    paintYellow() {
        const S = 256;
        const n = fbm(S, 6, 5, 21);
        const wear = fbm(S, 8, 4, 22);
        const paint = rgb('#f6cf45');
        const bare = rgb('#6e6660');
        const rust = rgb('#7a3f1d');
        return pixels(S, (x, y, i) => {
            let c = shade(paint, 0.9 + 0.15 * (n[i] - 0.5));
            const w = clamp01((wear[i] - 0.76) / 0.06);
            c = mixc(c, bare, w * 0.6);
            if (hash(x, y, 3) > 0.996) c = mixc(c, rust, 0.7);
            return c;
        });
    },
    paintWhite() {
        const S = 256;
        const n = fbm(S, 4, 4, 31);
        const base = rgb('#ecebe7');
        return pixels(S, (x, y, i) => shade(base, 0.94 + 0.08 * (n[i] - 0.5)));
    },
    timber() {
        const S = 256;
        const n = fbm(S, 4, 4, 41);
        const fine = fbm(S, 32, 2, 42);
        const light = rgb('#c49a68');
        const dark = rgb('#8a5e36');
        const canvas = pixels(S, (x, y, i) => {
            // Grain runs along x; rings wander with the noise.
            const ring = Math.sin((y + n[i] * 60) * 0.32) * 0.5 + 0.5;
            const t = clamp01(ring * 0.55 + fine[i] * 0.45);
            return shade(mixc(light, dark, t * 0.75), 0.95 + 0.1 * (n[i] - 0.5));
        });
        // Plank joints (slats).
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(40,24,12,0.55)';
        for (const y of [0, 64, 128, 192]) ctx.fillRect(0, y, S, 2);
        return canvas;
    },
    clay() {
        const S = 256;
        const n = fbm(S, 4, 4, 51);
        const base = rgb('#a8573a');
        return pixels(S, (x, y, i) => {
            let c = shade(base, 0.88 + 0.24 * (n[i] - 0.5));
            if (hash(x, y, 5) > 0.97) c = shade(c, 0.78);      // sand grains
            if (hash(x, y, 6) > 0.985) c = mixc(c, [200, 170, 140], 0.4);
            return c;
        });
    },
    brick() {
        const S = 512;
        const n = fbm(S, 8, 4, 61);
        const mortar = rgb('#bdb4a6');
        const canvas = pixels(S, (x, y, i) => {
            const row = Math.floor(y / 32);
            const bx = (x + (row % 2) * 32) % 64;
            const by = y % 32;
            const id = Math.floor((x + (row % 2) * 32) / 64) + row * 9;
            if (bx < 3 || by < 3) return shade(mortar, 0.9 + 0.15 * (n[i] - 0.5));
            const tone = 0.78 + 0.3 * hash(id, row, 7);
            return shade(mixc(rgb('#a4513a'), rgb('#7a3a28'), hash(id, 1, 8)), tone * (0.92 + 0.16 * (n[i] - 0.5)));
        });
        return canvas;
    },
    asphalt() {
        const S = 256;
        const n = fbm(S, 4, 4, 71);
        const base = rgb('#4a4a4b');
        return pixels(S, (x, y, i) => {
            let k = 0.85 + 0.25 * (n[i] - 0.5);
            const h = hash(x, y, 7);
            if (h > 0.93) k *= 1.35;
            else if (h < 0.05) k *= 0.7;
            return shade(base, k);
        });
    },
    soil() {
        const S = 256;
        const n = fbm(S, 4, 5, 81);
        const m = fbm(S, 8, 3, 82);
        const a = rgb('#8b7457');
        const b = rgb('#6a5843');
        return pixels(S, (x, y, i) => {
            let c = mixc(a, b, clamp01(n[i] * 1.2 - 0.1));
            c = shade(c, 0.9 + 0.2 * (m[i] - 0.5));
            if (hash(x, y, 8) > 0.985) c = mixc(c, [190, 182, 168], 0.6);   // stones
            return c;
        });
    },
    grass() {
        const S = 256;
        const n = fbm(S, 4, 4, 91);
        const a = rgb('#6c8a43');
        const b = rgb('#4b6a2e');
        return pixels(S, (x, y, i) => {
            const blade = hash(x, Math.floor(y / 3), 9);
            return shade(mixc(a, b, clamp01(n[i] * 1.3 - 0.15)), 0.8 + 0.35 * blade);
        });
    },
    tiles() {
        const S = 256;
        const n = fbm(S, 4, 3, 101);
        const base = rgb('#d8d2c6');
        return pixels(S, (x, y, i) => {
            const tx = x % 64;
            const ty = y % 64;
            if (tx < 2 || ty < 2) return shade(base, 0.7);
            const id = Math.floor(x / 64) + Math.floor(y / 64) * 4;
            return shade(base, 0.94 + 0.08 * (hash(id, 3, 10) - 0.5) + 0.05 * (n[i] - 0.5));
        });
    },
    plaster() {
        const S = 256;
        const n = fbm(S, 4, 5, 111);
        const base = rgb('#ece8e0');
        return pixels(S, (x, y, i) => shade(base, 0.95 + 0.07 * (n[i] - 0.5)));
    },
    foam() {
        // Architectural model board: white, very faint grain.
        const S = 256;
        const n = fbm(S, 8, 3, 121);
        const base = rgb('#f2f0eb');
        return pixels(S, (x, y, i) => shade(base, 0.97 + 0.05 * (n[i] - 0.5)));
    },
    mdf() {
        const S = 256;
        const n = fbm(S, 16, 4, 131);
        const base = rgb('#b39874');
        return pixels(S, (x, y, i) => shade(base, 0.9 + 0.2 * (n[i] - 0.5) + (hash(x, y, 11) - 0.5) * 0.08));
    },
    rubber() {
        const S = 128;
        const n = fbm(S, 8, 3, 141);
        const base = rgb('#262729');
        return pixels(S, (x, y, i) => shade(base, 0.85 + 0.3 * (n[i] - 0.5)));
    },
    /** One bay and one storey of an office façade: spandrel, frame, glass. */
    facade() {
        const S = 256;
        const n = fbm(S, 4, 3, 151);
        return pixels(S, (x, y, i) => {
            const v = 1 - y / S;     // 0 at the floor line
            const u = x / S;
            if (v < 0.24) return shade(rgb('#c9c4ba'), 0.92 + 0.1 * (n[i] - 0.5));                 // spandrel panel
            const frame = u < 0.06 || u > 0.94 || v < 0.28 || v > 0.95 || Math.abs(u - 0.5) < 0.012;
            if (frame) return rgb('#55595e');
            // Glass: dark, a sky reflection towards the top.
            const sky = mixc(rgb('#5b707e'), rgb('#b9cbd6'), clamp01((v - 0.3) * 1.2) * 0.6 + n[i] * 0.2);
            return sky;
        });
    },
    /** Volumetric module cladding: vertical boards with one window. */
    module() {
        const S = 256;
        const n = fbm(S, 4, 3, 161);
        return pixels(S, (x, y, i) => {
            const u = x / S;
            const v = 1 - y / S;
            const win = u > 0.32 && u < 0.68 && v > 0.32 && v < 0.82;
            const frame = u > 0.3 && u < 0.7 && v > 0.3 && v < 0.84 && !win;
            if (frame) return rgb('#2f3134');
            if (win) return mixc(rgb('#33424e'), rgb('#8aa2b2'), clamp01(v - 0.3) * 0.7);
            const board = Math.floor(u * 16);
            const edge = (u * 16) % 1 < 0.06;
            return shade(rgb('#e3dfd6'), (edge ? 0.78 : 0.95 + 0.08 * (hash(board, 2, 12) - 0.5)) + 0.05 * (n[i] - 0.5));
        });
    },
    /** Curtain wall: mullions and transoms over glass (alpha = glass). */
    curtain() {
        const S = 256;
        return pixels(S, (x, y) => {
            const u = x / S;
            const v = y / S;
            const frame = (u % 0.25) < 0.025 || (v % 0.5) < 0.035;
            if (frame) return [58, 62, 66, 255];
            return [70 + v * 60, 92 + v * 60, 108 + v * 50, 120];
        });
    },
    /** Crane lattice: chords and diagonal bracing on a clear background. */
    lattice() {
        const S = 128;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = '#d9a536';
        ctx.lineWidth = 9;
        ctx.strokeRect(4, -10, S - 8, S + 20);
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(S - 4, S); ctx.moveTo(S - 4, 0); ctx.lineTo(4, S); ctx.stroke();
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();
        return canvas;
    },
    /** Louvred plant grille. */
    grille() {
        const S = 128;
        return pixels(S, (x, y) => {
            const slat = (y % 12) < 7;
            return slat ? shade(rgb('#8d9297'), 0.85 + 0.2 * (y % 12) / 7) : rgb('#2a2c2f');
        });
    }
};

/** A cached texture by name. */
export function surfaceTexture(name) {
    if (cache.has(name)) return cache.get(name);
    const canvas = PAINTERS[name]();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    cache.set(name, tex);
    return tex;
}

// ---------------------------------------------------------------------------
// Triplanar material
// ---------------------------------------------------------------------------

/**
 * A standard (or physical) material showing `name` by triplanar projection.
 * scale: texture tiles per metre (a number, or [x, y, z] per axis);
 * offset: shifts the pattern (e.g. to line façade floors up with slabs);
 * bump: strength of the fine relief; roughVar: roughness variation.
 */
export function surfaceMaterial(name, opts = {}) {
    const {
        color = '#ffffff', scale = 8, offset = [0, 0, 0], roughness = 0.8, metalness = 0,
        bump = 1, roughVar = 0.25, physical = false, ...rest
    } = opts;
    const Mat = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const mat = new Mat({ color, roughness, metalness, ...rest });
    const sc = Array.isArray(scale) ? scale : [scale, scale, scale];
    const uniforms = {
        uTriMap: { value: surfaceTexture(name) },
        uTriScale: { value: new THREE.Vector3(...sc) },
        uTriOffset: { value: new THREE.Vector3(...offset) },
        // Relief slope ≈ bump × 0.3 for the texture's fine noise, at any scale.
        uTriBump: { value: (bump * 0.023) / Math.max(...sc) },
        uTriRough: { value: roughVar }
    };
    mat.userData.surface = { name, opts };
    mat.userData.tri = uniforms;
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriN;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vec4 triP = vec4(transformed, 1.0);
                vec3 triN = objectNormal;
                #ifdef USE_INSTANCING
                    triP = instanceMatrix * triP;
                    triN = mat3(instanceMatrix) * triN;
                #endif
                vTriPos = triP.xyz;
                vTriN = triN;`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform sampler2D uTriMap;
                uniform vec3 uTriScale;
                uniform vec3 uTriOffset;
                uniform float uTriBump;
                uniform float uTriRough;
                varying vec3 vTriPos;
                varying vec3 vTriN;
                vec3 triBump(vec3 surfPos, vec3 surfNorm, float h) {
                    vec3 sx = dFdx(surfPos);
                    vec3 sy = dFdy(surfPos);
                    vec3 r1 = cross(sy, surfNorm);
                    vec3 r2 = cross(surfNorm, sx);
                    float det = dot(sx, r1);
                    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
                    return normalize(abs(det) * surfNorm - grad);
                }`)
            .replace('#include <map_fragment>', `
                vec3 triW = pow(abs(normalize(vTriN)), vec3(6.0));
                triW /= (triW.x + triW.y + triW.z + 1e-5);
                vec3 tp = (vTriPos + uTriOffset) * uTriScale;
                vec4 triTex = texture2D(uTriMap, vec2(tp.z, tp.y)) * triW.x
                            + texture2D(uTriMap, vec2(tp.x, tp.z)) * triW.y
                            + texture2D(uTriMap, vec2(tp.x, tp.y)) * triW.z;
                diffuseColor *= triTex;
                float triH = dot(triTex.rgb, vec3(0.3333));
                // Detail smaller than a pixel is not drawn as relief (no shimmer).
                float triFade = 1.0 - smoothstep(0.0015, 0.006, length(fwidth(tp)));`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                roughnessFactor = clamp(roughnessFactor * (1.0 + uTriRough * (0.5 - triH) * 2.0), 0.04, 1.0);`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                normal = triBump(-vViewPosition, normal, triH * uTriBump * triFade);`);
    };
    mat.customProgramCacheKey = () => `tri-${physical ? 'p' : 's'}`;
    return mat;
}

/** The same surface again with extra settings (e.g. clipping planes): onBeforeCompile does not survive clone(). */
export function surfaceVariant(mat, extra = {}) {
    const s = mat.userData.surface;
    if (!s) return Object.assign(mat.clone(), extra);
    const copy = surfaceMaterial(s.name, { ...s.opts });
    Object.assign(copy, extra);
    return copy;
}
