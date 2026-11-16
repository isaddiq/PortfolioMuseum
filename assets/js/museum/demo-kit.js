// Small shared pieces for the research demonstrations: easing curves,
// instancing helpers, live canvases and signs.

import * as THREE from 'three';
import * as art from './art.js';
import { clamp } from './util.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const lin = (a, b, t) => clamp((t - a) / (b - a), 0, 1);
export const sstep = (a, b, t) => { const x = lin(a, b, t); return x * x * (3 - 2 * x); };
export const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
/** Minimum-jerk profile: zero velocity and acceleration at both ends. */
export const minJerk = (x) => { x = clamp(x, 0, 1); return x * x * x * (10 + x * (-15 + 6 * x)); };
export const mix = (a, b, t) => a + (b - a) * t;
/** Shortest signed turn from a to b. */
export const turn = (a, b) => ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
export const WHITE = new THREE.Color(1, 1, 1);

const _o = new THREE.Object3D();

/** Write one instance's transform; a zero scale hides it. */
export function setInst(mesh, i, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    _o.position.set(x, y, z);
    _o.rotation.set(rx, ry, rz);
    _o.scale.set(sx || 1e-5, sy || 1e-5, sz || 1e-5);
    _o.updateMatrix();
    mesh.setMatrixAt(i, _o.matrix);
}

/** An instanced box set with per-instance colour, ready to animate. */
export function boxes(count, mat, parent, geometry = UNIT_BOX) {
    const mesh = new THREE.InstancedMesh(geometry, mat, Math.max(1, count));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) {
        mesh.setColorAt(i, WHITE);
        setInst(mesh, i, 0, 0, 0, 0, 0, 0);
    }
    parent.add(mesh);
    return mesh;
}

export function flush(...meshes) {
    for (const m of meshes) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
}

/** A plain mesh added to a parent at a position. */
export function part(geometry, material, parent, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
}

/** A canvas that is repainted while the model runs (screens, dashboards). */
export function liveCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { canvas, ctx: canvas.getContext('2d'), tex, key: null };
}

/** A sign painted once (labels floating over a model). */
export function signTexture(draw, w = 512, h = 128) {
    const canvas = art.makeCanvas(w, h, 1.5);
    draw(canvas.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/** A dark card with an accent bar: the floating labels' style. */
export function cardSign(title, sub, accent, w = 520, h = 128) {
    return signTexture((ctx) => {
        roundRect(ctx, 2, 2, w - 4, h - 4, 14);
        ctx.fillStyle = 'rgba(16,18,22,0.88)';
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.fillRect(18, 22, 6, h - 44);
        ctx.fillStyle = '#f4f1ea';
        ctx.font = `600 ${sub ? 34 : 38}px ${art.SANS}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(title, 40, sub ? h * 0.36 : h / 2, w - 56);
        if (sub) {
            ctx.fillStyle = '#b9c2cc';
            ctx.font = `400 26px ${art.SANS}`;
            ctx.fillText(sub, 40, h * 0.7, w - 56);
        }
    }, w, h);
}

export function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** A material in the accent colour, a touch brighter than white so it reads as lit. */
export function accentGlow(color, k = 1.4, opacity = 1) {
    const c = new THREE.Color(color);
    c.multiplyScalar(k / Math.max(c.r, c.g, c.b, 0.2));
    return new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
}

/** Outline (edges) of a set of boxes [w, h, d, x, y, z] as one line geometry. */
export function boxEdges(list) {
    const pos = [];
    for (const [w, h, d, x, y, z] of list) {
        const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
        const a = edges.attributes.position;
        for (let i = 0; i < a.count; i++) pos.push(a.getX(i) + x, a.getY(i) + y, a.getZ(i) + z);
        edges.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
}

/** Point on a quadratic Bezier. */
export function bezier(a, c, b, t, out = new THREE.Vector3()) {
    const u = 1 - t;
    return out.set(
        u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        u * u * a.z + 2 * u * t * c.z + t * t * b.z
    );
}

// ---------------------------------------------------------------------------
// Model-maker's details: scale figures and trees
// ---------------------------------------------------------------------------

let figureGeo = null;

/** A 1:16 scale figure (about 11 cm): legs, torso, arms and head in one geometry. */
function makeFigureGeometry() {
    const parts = [];
    const add = (g, x, y, z, rx = 0, rz = 0) => {
        g.rotateX(rx);
        g.rotateZ(rz);
        g.translate(x, y, z);
        parts.push(g.index ? g.toNonIndexed() : g);
    };
    add(new THREE.CapsuleGeometry(0.0048, 0.042, 3, 8), -0.0055, 0.026, 0);           // legs
    add(new THREE.CapsuleGeometry(0.0048, 0.042, 3, 8), 0.0055, 0.026, 0);
    add(new THREE.CapsuleGeometry(0.0105, 0.03, 4, 10), 0, 0.068, 0);                 // torso
    add(new THREE.CapsuleGeometry(0.0034, 0.032, 3, 6), -0.0145, 0.064, 0, 0, 0.08);  // arms
    add(new THREE.CapsuleGeometry(0.0034, 0.032, 3, 6), 0.0145, 0.064, 0, 0, -0.08);
    add(new THREE.SphereGeometry(0.0078, 12, 10), 0, 0.1, 0.001);                     // head
    const pos = [];
    for (const g of parts) pos.push(...g.attributes.position.array);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
}

/** Scale figures at [x, z, yaw, heightScale] in a parent, one draw call. */
export function figures(parent, list, mat) {
    figureGeo ||= makeFigureGeometry();
    const mesh = new THREE.InstancedMesh(figureGeo, mat, list.length);
    list.forEach(([x, z, yaw = 0, k = 1], i) => setInst(mesh, i, x, 0, z, k, k * (0.94 + ((i * 37) % 10) / 80), k, yaw));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
}

/** Model trees at [x, z, size]: a turned trunk and a faceted canopy. */
export function trees(parent, list, mats) {
    const trunkGeo = new THREE.CylinderGeometry(0.004, 0.006, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 3);
    const trunks = new THREE.InstancedMesh(trunkGeo, mats.bark, list.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, mats.leaf, list.length * 3);
    // Three overlapping lumps of foliage, each a slightly different green.
    const lumps = [[0, 0.092, 0, 0.04, 0.042], [0.016, 0.115, -0.008, 0.03, 0.032], [-0.014, 0.108, 0.01, 0.028, 0.03]];
    list.forEach(([x, z, s = 1], i) => {
        setInst(trunks, i, x, 0, z, s, 0.075 * s, s);
        lumps.forEach(([lx, ly, lz, r, ry], k) => {
            const j = i * 3 + k;
            const c = Math.cos(i * 1.7);
            const sn = Math.sin(i * 1.7);
            setInst(canopies, j, x + (lx * c - lz * sn) * s, ly * s, z + (lx * sn + lz * c) * s, r * s, ry * s, r * s, i + k);
            // The foliage texture is already green: tint lightly, a little different per lump.
            canopies.setColorAt(j, new THREE.Color().setHSL(0.2 + ((i + k) % 3) * 0.03, 0.3, 0.86 + k * 0.04));
        });
    });
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    trunks.castShadow = canopies.castShadow = true;
    parent.add(trunks, canopies);
    return { trunks, canopies };
}

/** A rounded-edge box: soft edges catch the light like real parts. */
export function softBox(w, h, d, r = 0.004) {
    return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
}

let shadowTex = null;

/** A soft contact shadow under a footprint w × d (blurred, darkest at the middle). */
export function groundShadow(parent, x, z, w, d, strength = 0.45, y = 0.0009) {
    if (!shadowTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const ctx = c.getContext('2d');
        ctx.shadowColor = 'rgba(0,0,0,1)';
        ctx.shadowBlur = 22;
        ctx.shadowOffsetX = 1000;
        ctx.fillStyle = '#000';
        ctx.fillRect(28 - 1000, 28, 72, 72);
        shadowTex = new THREE.CanvasTexture(c);
    }
    const mat = new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: shadowTex, transparent: true, opacity: strength, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.55, d * 1.55), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.userData.noShadow = true;
    mesh.renderOrder = 1;
    parent.add(mesh);
    return mesh;
}
