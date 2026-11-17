// Builder for the lobby's centrepiece: one building model on a round dais,
// worked with in four ways (BIM, robotics, XR, digital twin).
//
// Same contract as demos-a.js: build({ root, mats, accent, inst, museum })
// returns { render(t, dt), hum?(), reset?() } in drum-top coordinates.
//
// The tower is a 1:50 presentation model built element by element (slabs,
// columns, core, glazing, mullions, roof plant), so each stage can work on
// the real parts: BIM pulls the storeys apart, the rover's lidar builds a
// point cloud of the façades, XR turns the same elements into a hologram,
// and the twin lights the rooms behind the glass.

import * as THREE from 'three';
import { clamp } from './util.js';
import {
    lin, sstep, minJerk, setInst, boxes, flush, part, WHITE,
    cardSign, accentGlow, boxEdges, bezier, figures, trees, softBox, groundShadow
} from './demo-kit.js';
import { surfaceVariant } from './surfaces.js';

const TAU = Math.PI * 2;
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

// Tower, in metres at model size (about 1:50).
const S = 8;                 // storeys, the ground floor included
const G = 0.11;              // ground storey, double height
const FH = 0.072;            // typical storey
const BX = 0.42;             // plan, along x
const BZ = 0.3;              // plan, along z
const CZ = -0.035;           // the tower stands a little back on the plaza
const SLAB = 0.016;          // slab and spandrel zone
const GAP = 0.026;           // how far the storeys part in the exploded view
const DAIS = -0.7;           // the dais top, relative to the drum top
const TRACK = 1.05;          // radius of the rover's lap
const POSTS = 1.28;          // radius of the four sign posts
const ROVER = 1.3;           // the rover is built at 1:1.3 and scaled up

const base = (s) => (s === 0 ? 0 : G + (s - 1) * FH);
const TOP = base(S);
const angleOf = (k) => Math.PI / 4 + (k * Math.PI) / 2;

/** A sprite card (always faces the visitor), hidden until its moment. */
function tag(parent, title, sub, color, w = 0.21) {
    const mat = new THREE.SpriteMaterial({ map: cardSign(title, sub, color, 520, 128), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w, w * (128 / 520), 1);
    sprite.visible = false;
    sprite.userData.noShadow = true;
    parent.add(sprite);
    return sprite;
}

function showTag(sprite, k) {
    sprite.visible = k > 0.01;
    sprite.material.opacity = clamp(k, 0, 1);
}

// ---------------------------------------------------------------------------
// The rover that laps the dais
// ---------------------------------------------------------------------------

function buildRover(mats, accentHex) {
    const g = new THREE.Group();
    const lens = new THREE.MeshPhysicalMaterial({ color: '#0d1116', roughness: 0.08, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
    part(softBox(0.086, 0.014, 0.166, 0.005), mats.dark, g, 0, 0.031, 0);          // chassis and bumpers
    part(softBox(0.1, 0.03, 0.146, 0.009), mats.paint, g, 0, 0.045, 0);            // body shell
    part(softBox(0.072, 0.008, 0.09, 0.003), mats.dark, g, 0, 0.062, -0.018);      // equipment deck
    part(softBox(0.03, 0.012, 0.03, 0.003), mats.steel, g, 0.018, 0.071, -0.04);   // battery hatch
    // Four wheels: tyre, hub and a bar across the hub so the rolling shows.
    const tyre = new THREE.CylinderGeometry(0.024, 0.024, 0.02, 28);
    tyre.rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.013, 0.013, 0.0215, 18);
    hub.rotateZ(Math.PI / 2);
    const bar = new THREE.BoxGeometry(0.0225, 0.0045, 0.021);
    const wheels = [];
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const w = new THREE.Group();
            w.position.set(sx * 0.061, 0.024, sz * 0.05);
            g.add(w);
            part(tyre, mats.rubber, w);
            part(hub, mats.steel, w);
            part(bar, mats.dark, w);
            wheels.push({ w, inner: sx > 0 });
        }
    }
    // Lidar: a fixed base and a head that spins.
    part(new THREE.CylinderGeometry(0.02, 0.023, 0.012, 28), mats.dark, g, 0, 0.072, 0.032);
    const head = new THREE.Group();
    head.position.set(0, 0.087, 0.032);
    g.add(head);
    part(new THREE.CylinderGeometry(0.018, 0.018, 0.017, 28), lens, head);
    part(new THREE.CylinderGeometry(0.0195, 0.0195, 0.003, 28), mats.dark, head, 0, 0.01, 0);
    part(new THREE.BoxGeometry(0.012, 0.006, 0.003), accentGlow('#ff5040', 1.6), head, 0, 0, 0.0178).userData.noShadow = true;
    // Stereo camera and a light bar across the nose; an aerial and a status lamp aft.
    part(softBox(0.062, 0.015, 0.01, 0.003), lens, g, 0, 0.05, 0.073);
    for (const sx of [-1, 1]) part(new THREE.CylinderGeometry(0.0045, 0.0045, 0.003, 14), mats.steel, g, sx * 0.018, 0.05, 0.0785).rotation.x = Math.PI / 2;
    const lightMat = accentGlow(accentHex, 1.6);
    part(new THREE.BoxGeometry(0.056, 0.0035, 0.002), lightMat, g, 0, 0.037, 0.0835).userData.noShadow = true;
    part(new THREE.CylinderGeometry(0.0011, 0.0011, 0.055, 6), mats.dark, g, -0.034, 0.093, -0.058);
    const status = part(new THREE.SphereGeometry(0.004, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), g, 0.034, 0.07, -0.058);
    status.userData.noShadow = true;
    return { g, wheels, head, status, lightMat };
}

// ---------------------------------------------------------------------------

export function buildEcosystem({ root, mats, accent, inst, museum }) {
    const accentHex = `#${accent.getHexString()}`;
    const holoHex = `#${mats.holo.clone().multiplyScalar(0.6).getHexString()}`;
    const solidPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const holoPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const clipped = { clippingPlanes: [solidPlane], clipShadows: true };
    const clip = (m) => surfaceVariant(m, clipped);

    // --- The plaza on the drum ---------------------------------------------
    const plaza = part(new THREE.CircleGeometry(0.6, 72), mats.tiles, root, 0, 0.002, 0);
    plaza.rotation.x = -Math.PI / 2;
    groundShadow(root, 0, CZ, BX + 0.1, BZ + 0.1, 0.5, 0.003);
    // Planting beds with a kerb, a tree in each.
    const beds = [[-0.33, 0.27, 0.62, 0.2], [0.34, 0.25, -0.62, 0.2], [0, -0.44, 0, 0.34], [-0.45, -0.12, 1.45, 0.16], [0.45, -0.12, -1.45, 0.16]];
    for (const [x, z, ry, len] of beds) {
        const kerb = part(softBox(len, 0.01, 0.07, 0.003), mats.precast, root, x, 0.007, z);
        kerb.rotation.y = ry;
        const lawn = part(new THREE.BoxGeometry(len - 0.014, 0.004, 0.056), mats.grass, root, x, 0.0125, z);
        lawn.rotation.y = ry;
    }
    trees(root, [[-0.33, 0.27, 1.05], [0.34, 0.25, 0.95], [-0.08, -0.44, 1.1], [0.09, -0.44, 0.9], [-0.45, -0.12, 0.85], [0.45, -0.12, 1]], mats);
    // Benches, lamp standards and people (3.5 cm tall at this scale).
    for (const [x, z, ry] of [[-0.13, 0.4, 0.15], [0.15, 0.41, -0.2]]) {
        const seat = part(softBox(0.07, 0.004, 0.02, 0.0015), mats.timber, root, x, 0.013, z);
        seat.rotation.y = ry;
        const legs = part(new THREE.BoxGeometry(0.056, 0.009, 0.012), mats.dark, root, x, 0.0065, z);
        legs.rotation.y = ry;
    }
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 1.08, 0.95), toneMapped: false });
    const lampPosts = [[-0.22, 0.47], [0.22, 0.47], [-0.5, 0.12], [0.5, 0.12]];
    for (const [x, z] of lampPosts) {
        part(new THREE.CylinderGeometry(0.0022, 0.003, 0.085, 8), mats.dark, root, x, 0.0445, z);
        part(new THREE.SphereGeometry(0.0065, 12, 8), lampMat, root, x, 0.091, z).userData.noShadow = true;
    }
    figures(root, [
        [-0.04, 0.2, 0.2, 0.32], [0.03, 0.22, -0.4, 0.32], [0.16, 0.33, 2.6, 0.32], [-0.12, 0.36, 3.3, 0.32], [-0.2, 0.18, 1.2, 0.32],
        [0.25, 0.12, -1.3, 0.32], [0.05, 0.5, 3.0, 0.32], [0.09, 0.5, -2.8, 0.32], [-0.36, 0.05, 1.6, 0.32], [0.3, -0.3, 0.6, 0.32]
    ], mats.figure);

    // --- The tower -----------------------------------------------------------
    const tower = new THREE.Group();
    tower.position.z = CZ;
    root.add(tower);
    const slabMat = clip(mats.precast);
    const concrete = clip(mats.concrete);
    const metal = clip(mats.dark);
    const slabs = boxes(S + 1, slabMat, tower);
    const cols = boxes(S * 12, concrete, tower);
    const cores = boxes(S, concrete, tower);
    const glassMat = new THREE.MeshPhysicalMaterial({
        color: '#5f7c8c', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.7,
        clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.4, ...clipped
    });
    const glass = boxes(S, glassMat, tower);
    // Mullions on every upper storey: 9 lines on the long façades, 5 between the corners on the short ones.
    const finLines = [];
    for (let i = 0; i <= 8; i++) for (const sz of [-1, 1]) finLines.push([-BX / 2 + (i * BX) / 8, sz * (BZ / 2 + 0.003), 0]);
    for (let j = 1; j <= 5; j++) for (const sx of [-1, 1]) finLines.push([sx * (BX / 2 + 0.003), -BZ / 2 + (j * BZ) / 6, 1]);
    const fins = boxes((S - 1) * finLines.length, metal, tower);
    const colXs = [-0.1925, -0.064, 0.064, 0.1925];
    const colZs = [-0.1325, 0, 0.1325];
    // Rooms behind the glass: a lit plane just inside each bay (the digital twin's occupancy).
    const rooms = [];
    for (let s = 0; s < S; s++) {
        const ex = (s === 0 ? BX - 0.07 : BX) / 2 - 0.012;
        const ez = (s === 0 ? BZ - 0.07 : BZ) / 2 - 0.012;
        for (let i = 0; i < 4; i++) for (const sz of [1, -1]) rooms.push({ s, x: (-1 + (2 * (i + 0.5)) / 4) * ex, z: sz * ez, ry: sz > 0 ? 0 : Math.PI, w: ex / 2 - 0.008 });
        for (let j = 0; j < 3; j++) for (const sx of [1, -1]) rooms.push({ s, x: sx * ex, z: (-1 + (2 * (j + 0.5)) / 3) * ez, ry: (sx * Math.PI) / 2, w: (2 * ez) / 3 - 0.008 });
    }
    const lights = boxes(rooms.length, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, ...clipped }), tower, new THREE.PlaneGeometry(1, 1));
    lights.userData.noShadow = true;
    rooms.forEach((r, i) => { r.order = hash(i, 3); r.tone = hash(i, 9); });
    const warm = new THREE.Color(1.45, 1.0, 0.5);
    const cool = new THREE.Color(1.05, 1.1, 1.05);

    // Entrance: a canopy on two posts and a pair of doors in the set-back glazing.
    const frontZ = (BZ - 0.07) / 2;
    part(softBox(0.17, 0.006, 0.085, 0.002), metal, tower, 0, 0.074, BZ / 2 + 0.012);
    for (const sx of [-1, 1]) part(new THREE.BoxGeometry(0.004, 0.071, 0.004), metal, tower, sx * 0.078, 0.0355, BZ / 2 + 0.047);
    part(new THREE.BoxGeometry(0.076, 0.062, 0.004), metal, tower, 0, 0.043, frontZ + 0.001);
    const doorMat = new THREE.MeshPhysicalMaterial({ color: '#31404a', roughness: 0.06, clearcoat: 1, envMapIntensity: 2, ...clipped });
    for (const sx of [-1, 1]) part(new THREE.BoxGeometry(0.032, 0.054, 0.002), doorMat, tower, sx * 0.0175, 0.04, frontZ + 0.0035);
    part(softBox(0.2, 0.007, 0.05, 0.0015), slabMat, tower, 0, 0.0035, BZ / 2 + 0.054);     // the step up to the podium

    // Roof: parapet, lift overrun, two air-handling units with fans, a solar array and a mast.
    const roof = new THREE.Group();
    tower.add(roof);
    for (const sz of [-1, 1]) part(new THREE.BoxGeometry(BX + 0.012, 0.014, 0.006), slabMat, roof, 0, 0.007, sz * (BZ / 2 + 0.003));
    for (const sx of [-1, 1]) part(new THREE.BoxGeometry(0.006, 0.014, BZ + 0.006), slabMat, roof, sx * (BX / 2 + 0.003), 0.007, 0);
    part(softBox(0.104, 0.04, 0.084, 0.003), clip(mats.white), roof, 0, 0.02, -0.07);
    part(new THREE.BoxGeometry(0.11, 0.004, 0.09), metal, roof, 0, 0.042, -0.07);
    const steel = clip(mats.steel);
    const grille = clip(mats.grille);
    const fans = [];
    for (const sx of [-1, 1]) {
        part(softBox(0.09, 0.032, 0.06, 0.004), steel, roof, sx * 0.135, 0.02, -0.07);
        part(new THREE.BoxGeometry(0.07, 0.02, 0.002), grille, roof, sx * 0.135, 0.02, -0.0395);
        part(new THREE.CylinderGeometry(0.021, 0.021, 0.006, 24, 1, true), metal, roof, sx * 0.135, 0.039, -0.07);
        const fan = new THREE.Group();
        fan.position.set(sx * 0.135, 0.04, -0.07);
        roof.add(fan);
        for (let k = 0; k < 3; k++) {
            const blade = part(new THREE.BoxGeometry(0.038, 0.0015, 0.008), metal, fan);
            blade.rotation.set(0.25, (k * Math.PI) / 3, 0);
        }
        fans.push(fan);
    }
    const pvMat = new THREE.MeshStandardMaterial({ color: '#1b2a4a', roughness: 0.22, metalness: 0.65, envMapIntensity: 1.6, ...clipped });
    for (let i = 0; i < 4; i++) {
        const x = -0.135 + i * 0.09;
        const panel = part(new THREE.BoxGeometry(0.078, 0.003, 0.052), pvMat, roof, x, 0.016, 0.07);
        panel.rotation.x = 0.36;
        part(new THREE.BoxGeometry(0.07, 0.016, 0.003), metal, roof, x, 0.012, 0.052);
    }
    const MAST = new THREE.Vector3(0.03, 0.132, -0.07);
    part(new THREE.CylinderGeometry(0.0016, 0.0024, 0.09, 8), metal, roof, MAST.x, 0.087, MAST.z);
    const beaconMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, ...clipped });
    part(new THREE.SphereGeometry(0.0055, 12, 8), beaconMat, roof, MAST.x, MAST.y, MAST.z).userData.noShadow = true;

    /** Place every element for an exploded view of amount e (0 = assembled). */
    let lastE = -1;
    const storeyY = new Float32Array(S + 1);
    function layout(e) {
        if (e === lastE) return;
        lastE = e;
        for (let s = 0; s <= S; s++) {
            const yb = base(s) + e * GAP * s;
            storeyY[s] = yb;
            const t0 = s === 0 ? 0.012 : SLAB;
            setInst(slabs, s, 0, yb + t0 / 2, 0, s === 0 ? BX + 0.06 : BX + 0.012, t0, s === 0 ? BZ + 0.06 : BZ + 0.012);
            if (s === S) break;
            const ch = (s === 0 ? G : FH) - t0;
            const cy = yb + t0 + ch / 2;
            colXs.forEach((x, i) => colZs.forEach((z, j) => setInst(cols, s * 12 + i * 3 + j, x, cy, z, 0.014, ch, 0.014)));
            setInst(cores, s, 0, cy, -0.07, 0.1, ch, 0.08);
            setInst(glass, s, 0, cy, 0, s === 0 ? BX - 0.07 : BX, ch, s === 0 ? BZ - 0.07 : BZ);
            if (s > 0) finLines.forEach(([x, z, side], k) => setInst(fins, (s - 1) * finLines.length + k, x, cy, z, side ? 0.009 : 0.006, ch, side ? 0.006 : 0.009));
        }
        roof.position.y = storeyY[S] + SLAB;
        flush(slabs, cols, cores, glass, fins);
    }

    // --- BIM: storey tags for the exploded view ------------------------------
    const names = ['Ground floor', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7'];
    const levelTags = names.map((n) => tag(tower, n, 'IfcBuildingStorey', accentHex, 0.3));
    const leaderGeo = new THREE.BufferGeometry();
    leaderGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const leaderMat = new THREE.LineBasicMaterial({ color: accent.clone().multiplyScalar(1.5), transparent: true, opacity: 0, toneMapped: false });
    const leader = new THREE.Line(leaderGeo, leaderMat);
    leader.frustumCulled = false;
    tower.add(leader);
    const hot = accent.clone().multiplyScalar(1.9 / Math.max(accent.r, accent.g, accent.b));

    // --- Robotics: the rover, its scan plane and the point cloud it builds ---
    // A steel guide strip let into the dais marks its route.
    const inlay = part(new THREE.RingGeometry(TRACK - 0.005, TRACK + 0.005, 160), surfaceVariant(mats.steel, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), root, 0, DAIS + 0.0012, 0);
    inlay.rotation.x = -Math.PI / 2;
    inlay.userData.noShadow = true;
    const rover = buildRover(mats, accentHex);
    rover.g.scale.setScalar(ROVER);
    root.add(rover.g);
    // The lidar's vertical scan plane, from the head to the façade it faces,
    // and the bright line where it lands. Both are re-aimed every frame.
    const curtainGeo = new THREE.BufferGeometry();
    curtainGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    const curtainMat = new THREE.MeshBasicMaterial({ color: mats.holo.clone().multiplyScalar(0.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const curtain = new THREE.Mesh(curtainGeo, curtainMat);
    curtain.userData.noShadow = true;
    curtain.frustumCulled = false;
    rover.g.add(curtain);
    const hitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.3, 1.6), transparent: true, opacity: 0, toneMapped: false });
    const hitLine = part(new THREE.BoxGeometry(0.004, 1, 0.004), hitMat, rover.g);
    hitLine.userData.noShadow = true;
    /** Distance from the drum's axis to the tower's face, looking in from angle a. */
    const faceAt = (a) => {
        const sx = Math.abs(Math.sin(a));
        const cz = Math.cos(a);
        const dz = cz > 0 ? CZ + BZ / 2 : BZ / 2 - CZ;
        return Math.min(sx > 1e-4 ? BX / 2 / sx : 9, Math.abs(cz) > 1e-4 ? dz / Math.abs(cz) : 9);
    };
    const aim = (a) => {
        const x = (TRACK - faceAt(a) - 0.006) / ROVER;
        const y0 = (-DAIS + 0.012) / ROVER;
        const y1 = (-DAIS + TOP + SLAB + 0.014) / ROVER;
        const p = curtainGeo.attributes.position;
        p.setXYZ(0, 0, 0.087, 0.032);
        p.setXYZ(1, x, y0, 0);
        p.setXYZ(2, x, y1, 0);
        p.needsUpdate = true;
        hitLine.position.set(x, (y0 + y1) / 2, 0);
        hitLine.scale.y = y1 - y0;
    };
    // Point cloud: lidar returns in rows up the façades and in rings on the plaza.
    const pts = [];
    const reveal = [];
    const a0 = angleOf(1);
    const addPoint = (x, y, z) => {
        pts.push(x, y, z);
        const u = (((Math.atan2(x, z) - a0) % TAU) + TAU) % TAU / TAU;
        reveal.push(clamp(u * 0.94 + 0.03 + (hash(pts.length, 5) - 0.5) * 0.03, 0.01, 0.99));
    };
    const ROWS = 26;
    for (let r = 0; r < ROWS; r++) {
        const y = 0.012 + (r / (ROWS - 1)) * (TOP + 0.02 - 0.012);
        const step = 0.017;
        for (let x = -BX / 2; x <= BX / 2 + 1e-4; x += step) for (const sz of [-1, 1]) addPoint(x + (hash(r, x) - 0.5) * 0.004, y, CZ + sz * (BZ / 2 + 0.009));
        for (let z = -BZ / 2 + step; z < BZ / 2 - 1e-4; z += step) for (const sx of [-1, 1]) addPoint(sx * (BX / 2 + 0.009), y, CZ + z + (hash(r, z) - 0.5) * 0.004);
    }
    for (const ring of [0.34, 0.4, 0.47, 0.55]) {
        const n = Math.round((TAU * ring) / 0.02);
        for (let k = 0; k < n; k++) {
            const a = (k / n) * TAU;
            const x = Math.sin(a) * ring;
            const z = Math.cos(a) * ring;
            if (Math.abs(x) < BX / 2 + 0.03 && Math.abs(z - CZ) < BZ / 2 + 0.03) continue;
            addPoint(x, 0.016, z);
        }
    }
    const cloudGeo = new THREE.BufferGeometry();
    cloudGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    cloudGeo.setAttribute('aU', new THREE.Float32BufferAttribute(reveal, 1));
    const cloudMat = new THREE.ShaderMaterial({
        uniforms: { uLap: { value: 0 }, uFade: { value: 0 }, uScale: { value: 800 }, uColor: { value: new THREE.Color(0.1, 0.95, 1.25) } },
        vertexShader: `
            uniform float uLap; uniform float uFade; uniform float uScale;
            attribute float aU;
            varying float vA;
            varying float vHot;
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                float fresh = exp(-max(0.0, uLap - aU) * 26.0);
                vA = step(aU, uLap) * uFade;
                vHot = fresh;
                gl_PointSize = max(2.0, uScale * 0.0062 * (1.0 + 0.9 * fresh) / max(0.1, -mv.z));
            }`,
        fragmentShader: `
            uniform vec3 uColor;
            varying float vA;
            varying float vHot;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                float a = smoothstep(0.5, 0.3, d) * vA;
                if (a < 0.01) discard;
                gl_FragColor = vec4(uColor * (1.0 + 1.2 * vHot), a);
                #include <colorspace_fragment>
            }`,
        transparent: true, depthWrite: false
    });
    const cloud = new THREE.Points(cloudGeo, cloudMat);
    cloud.visible = false;
    root.add(cloud);

    // --- XR: the same elements as a hologram ---------------------------------
    const holoList = [];
    for (let s = 0; s < S; s++) {
        const h = s === 0 ? G : FH;
        holoList.push([BX + 0.012, 0.0001, BZ + 0.012, 0, base(s) + (s === 0 ? 0.012 : SLAB), 0]);
        holoList.push([s === 0 ? BX - 0.07 : BX, h, s === 0 ? BZ - 0.07 : BZ, 0, base(s) + h / 2, 0]);
    }
    holoList.push([BX + 0.012, SLAB, BZ + 0.012, 0, TOP + SLAB / 2, 0]);
    holoList.push([0.1, TOP + 0.056, 0.08, 0, (TOP + 0.056) / 2, -0.07]);
    for (const x of colXs) for (const z of colZs) holoList.push([0.014, TOP, 0.014, x, TOP / 2, z]);
    const holoGeo = boxEdges(holoList);
    const holoMat = mats.holoLine.clone();
    holoMat.clippingPlanes = [holoPlane];
    const holo = new THREE.LineSegments(holoGeo, holoMat);
    tower.add(holo);
    const plateMat = mats.holoFill.clone();
    plateMat.clippingPlanes = [holoPlane];
    plateMat.opacity = 0.07;
    const plates = boxes(S + 1, plateMat, tower, new THREE.PlaneGeometry(1, 1));
    plates.userData.noShadow = true;
    for (let s = 0; s <= S; s++) setInst(plates, s, 0, base(s) + (s === 0 ? 0.012 : SLAB), 0, BX + 0.012, BZ + 0.012, 1, 0, -Math.PI / 2);
    flush(plates);
    const scan = part(new THREE.TorusGeometry(0.31, 0.005, 8, 96), accentGlow(accentHex, 1.6, 0.95), tower);
    scan.rotation.x = Math.PI / 2;
    scan.userData.noShadow = true;
    const sheet = part(new THREE.RingGeometry(0.02, 0.31, 64), new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(1.3), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), tower);
    sheet.rotation.x = -Math.PI / 2;
    sheet.userData.noShadow = true;
    // Spatial annotations anchored to elements of the hologram.
    const notes = [
        { title: 'IfcCurtainWall', sub: 'South façade · Level 6', from: [BX / 2, base(6) + 0.04, BZ / 2], to: [BX / 2 + 0.2, base(6) + 0.1, BZ / 2 + 0.05] },
        { title: 'IfcSlab', sub: 'Level 4 · floor', from: [-BX / 2, base(4) + 0.008, BZ / 2], to: [-BX / 2 - 0.2, base(4) + 0.05, BZ / 2 + 0.05] },
        { title: 'IfcColumn', sub: 'Ground floor · grid A-1', from: [colXs[3], 0.06, colZs[2]], to: [BX / 2 + 0.19, 0.13, BZ / 2 + 0.1] }
    ];
    const noteLines = [];
    for (const n of notes) {
        n.sprite = tag(tower, n.title, n.sub, holoHex, 0.3);
        n.sprite.position.set(n.to[0], n.to[1] + 0.03, n.to[2]);
        noteLines.push(...n.from, ...n.to);
    }
    const noteGeo = new THREE.BufferGeometry();
    noteGeo.setAttribute('position', new THREE.Float32BufferAttribute(noteLines, 3));
    const noteMat = mats.holoLine.clone();
    const noteLeaders = new THREE.LineSegments(noteGeo, noteMat);
    noteLeaders.frustumCulled = false;
    tower.add(noteLeaders);

    // --- The four sign posts round the dais ----------------------------------
    const nodes = [
        { name: 'BIM', sub: 'The shared model' },
        { name: 'ROBOTICS', sub: 'Navigating the model' },
        { name: 'XR', sub: 'Immersive review' },
        { name: 'DIGITAL TWIN', sub: 'Live operational data' }
    ];
    const offLamp = new THREE.Color(0.22, 0.22, 0.24);
    const onLamp = accent.clone().multiplyScalar(1.7 / Math.max(accent.r, accent.g, accent.b));
    const plateGeo = softBox(0.43, 0.125, 0.012, 0.004);
    const nodeObjs = nodes.map((n, k) => {
        const a = angleOf(k);
        const post = new THREE.Group();
        post.position.set(Math.sin(a) * POSTS, DAIS, Math.cos(a) * POSTS);
        post.rotation.y = a;
        root.add(post);
        part(new THREE.CylinderGeometry(0.05, 0.056, 0.014, 36), mats.dark, post, 0, 0.007, 0);
        part(new THREE.CylinderGeometry(0.014, 0.02, 0.02, 20), mats.steel, post, 0, 0.024, 0);
        part(new THREE.CylinderGeometry(0.0055, 0.0055, 0.58, 12), mats.steel, post, 0, 0.3, 0);
        part(plateGeo, mats.dark, post, 0, 0.5, 0);
        const signMat = new THREE.MeshBasicMaterial({ map: cardSign(n.name, n.sub, accentHex, 520, 130), transparent: true, toneMapped: false });
        for (const side of [1, -1]) {
            const sign = part(new THREE.PlaneGeometry(0.4, 0.1), signMat, post, 0, 0.5, side * 0.0066);
            if (side < 0) sign.rotation.y = Math.PI;
            sign.userData.noShadow = true;
        }
        part(new THREE.CylinderGeometry(0.012, 0.0085, 0.012, 20), mats.steel, post, 0, 0.594, 0);
        const lamp = part(new THREE.CylinderGeometry(0.012, 0.012, 0.016, 20), new THREE.MeshBasicMaterial({ color: offLamp.clone(), toneMapped: false }), post, 0, 0.608, 0);
        lamp.userData.noShadow = true;
        return { lamp, x: post.position.x, z: post.position.z };
    });
    // A pulse runs round the track from one post to the next as the stage changes.
    const pulse = boxes(4, accentGlow(accentHex, 1.7), root, new THREE.SphereGeometry(1, 12, 8));
    pulse.userData.noShadow = true;

    // --- Digital twin: data up the riser and across to a small live copy -------
    const twinNode = nodeObjs[3];
    const TWIN = new THREE.Vector3(twinNode.x, DAIS + 0.7, twinNode.z);
    const mini = new THREE.Group();
    mini.position.copy(TWIN);
    mini.scale.setScalar(0.24);
    root.add(mini);
    const miniMat = mats.holoLine.clone();
    const miniList = [[0.1, TOP + 0.056, 0.08, 0, (TOP + 0.056) / 2, -0.07]];
    for (let s = 0; s < S; s++) miniList.push([BX, s === 0 ? G : FH, BZ, 0, base(s) + (s === 0 ? G : FH) / 2, 0]);
    const miniLines = new THREE.LineSegments(boxEdges(miniList), miniMat);
    miniLines.frustumCulled = false;
    mini.add(miniLines);
    const miniFill = mats.holoFill.clone();
    const miniRooms = boxes(S, miniFill, mini);
    miniRooms.userData.noShadow = true;
    for (let s = 0; s < S; s++) setInst(miniRooms, s, 0, base(s) + (s === 0 ? G : FH) / 2, 0, BX * 0.96, (s === 0 ? G : FH) * 0.7, BZ * 0.96);
    flush(miniRooms);
    const P0 = new THREE.Vector3(-BX / 2 - 0.008, 0.012, CZ + BZ / 2 + 0.008);
    const P1 = new THREE.Vector3(P0.x, TOP + SLAB + 0.016, P0.z);
    const P2 = new THREE.Vector3(MAST.x, TOP + SLAB + MAST.y, CZ + MAST.z);
    const P3 = TWIN.clone().setY(TWIN.y + 0.08);
    const PC = P2.clone().lerp(P3, 0.5).setY(P2.y + 0.22);
    /** A point on the data path: up the corner riser, over to the mast, then an arc to the twin. */
    const along = (p, out) => {
        if (p < 0.38) return out.lerpVectors(P0, P1, p / 0.38);
        if (p < 0.5) return out.lerpVectors(P1, P2, (p - 0.38) / 0.12);
        return bezier(P2, PC, P3, (p - 0.5) / 0.5, out);
    };
    part(new THREE.BoxGeometry(0.005, TOP, 0.005), metal, tower, -BX / 2 - 0.008, TOP / 2 + 0.012, BZ / 2 + 0.008);   // the riser
    const UP = 7;
    const DOWN = 3;
    const packets = boxes(UP + DOWN, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), root, new THREE.SphereGeometry(1, 10, 8));
    packets.userData.noShadow = true;
    const upColour = accent.clone().multiplyScalar(1.8 / Math.max(accent.r, accent.g, accent.b));
    const downColour = mats.holo.clone().multiplyScalar(0.95);

    let fanTurn = 0;
    let headTurn = 0;
    let lastLap = null;
    let hum = 0;
    let lightsOn = false;
    layout(0);

    return {
        render(t, dt) {
            const stage = Math.min(3, Math.floor(t / 6));

            // BIM: the storeys part, each is named in turn, and the model closes again.
            const explode = minJerk(lin(0.5, 1.8, t)) * (1 - minJerk(lin(4.5, 5.7, t)));
            layout(explode);
            let lit = -1;
            let litK = 0;
            for (let s = 0; s < S; s++) {
                const k = t < 6 ? Math.exp(-(((t - 1.95 - s * 0.31) / 0.24) ** 2)) : 0;
                _c.copy(WHITE).lerp(hot, k * 0.85);
                slabs.setColorAt(s, _c);
                for (let i = 0; i < 12; i++) cols.setColorAt(s * 12 + i, _c);
                cores.setColorAt(s, _c);
                showTag(levelTags[s], k * 1.5);
                levelTags[s].position.set(BX / 2 + 0.26, storeyY[s] + (s === 0 ? G : FH) / 2 + 0.01, BZ / 2 + 0.02);
                if (k > litK) { litK = k; lit = s; }
            }
            slabs.setColorAt(S, WHITE);
            slabs.instanceColor.needsUpdate = cols.instanceColor.needsUpdate = cores.instanceColor.needsUpdate = true;
            leader.visible = lit >= 0 && litK > 0.02;
            if (leader.visible) {
                const y = storeyY[lit] + (lit === 0 ? G : FH) / 2;
                const p = leaderGeo.attributes.position;
                p.setXYZ(0, BX / 2 + 0.008, y, BZ / 2 + 0.008);
                p.setXYZ(1, BX / 2 + 0.1, y + 0.01, BZ / 2 + 0.02);
                p.needsUpdate = true;
                leaderMat.opacity = clamp(litK * 1.5, 0, 1);
            }

            // Robotics: one lap of the dais; the lidar builds a point cloud of the tower.
            const lap = minJerk(lin(6.3, 11.6, t));
            const a = a0 + lap * TAU;
            rover.g.position.set(Math.sin(a) * TRACK, DAIS, Math.cos(a) * TRACK);
            rover.g.rotation.y = a + Math.PI / 2;
            const travelled = lap * TAU;
            for (const wheel of rover.wheels) wheel.w.rotation.x = (travelled * (TRACK + (wheel.inner ? -0.061 : 0.061) * ROVER)) / (0.024 * ROVER);
            const speed = lastLap !== null && dt > 0 ? Math.abs(lap - lastLap) / dt : 0;
            lastLap = lap;
            hum = clamp(speed / 0.34, 0, 1) * 0.5;
            const working = sstep(6, 6.5, t) * (1 - sstep(11.6, 12, t));
            headTurn += dt * (4 + 22 * working);
            rover.head.rotation.y = headTurn;
            rover.status.material.color.setRGB(0.25, 1.3, 0.5).multiplyScalar(working > 0.05 ? 1 : 0.35 + 0.25 * Math.sin(t * 2.2));
            rover.lightMat.color.copy(onLamp).multiplyScalar(0.35 + 0.65 * working);
            curtain.visible = hitLine.visible = working > 0.01;
            if (curtain.visible) aim(a);
            curtainMat.opacity = working * (0.055 + 0.02 * Math.sin(t * 31));
            hitMat.opacity = working * 0.9;
            cloud.visible = working > 0.01;
            cloudMat.uniforms.uLap.value = lap;
            cloudMat.uniforms.uFade.value = working;
            cloudMat.uniforms.uScale.value = museum?.pointScale || 800;

            // XR: a registration ring rises; below it the tower is a hologram.
            let lift = 0;
            const full = TOP + 0.16;
            if (t >= 12.3 && t < 16.8) lift = full * minJerk(lin(12.3, 15, t));
            else if (t >= 16.8 && t < 18) lift = full * (1 - minJerk(lin(16.8, 17.9, t)));
            solidPlane.constant = -(inst.worldY0 + lift);
            holoPlane.constant = inst.worldY0 + lift;
            const xr = lift > 0.003;
            holo.visible = plates.visible = xr;
            scan.visible = sheet.visible = xr && lift < full - 0.003;
            scan.position.y = sheet.position.y = lift;
            holoMat.opacity = 0.42 + 0.06 * Math.sin(t * 9);
            let anyNote = false;
            notes.forEach((n, i) => {
                const k = sstep(15.0 + i * 0.35, 15.35 + i * 0.35, t) * (1 - sstep(16.55, 16.85, t));
                showTag(n.sprite, k);
                anyNote = anyNote || k > 0.01;
            });
            noteLeaders.visible = anyNote;
            noteMat.opacity = 0.85 * sstep(15.0, 15.5, t) * (1 - sstep(16.55, 16.85, t));

            // Digital twin: a working day in the rooms, reported to a live copy and answered.
            const twin = sstep(18, 18.6, t) * (1 - sstep(23.5, 24, t));
            if (twin > 0.001 || lightsOn) {
                lightsOn = twin > 0.001;
                // Occupancy rises through the morning, holds, and falls away in the evening.
                const day = lin(18.2, 23.6, t);
                const occ = 0.74 * sstep(0, 0.3, day) * (1 - sstep(0.72, 1, day));
                rooms.forEach((r, i) => {
                    const on = twin * clamp((occ - r.order) / 0.07, 0, 1);
                    if (on > 0.004) {
                        const h = (r.s === 0 ? G - 0.012 : FH - SLAB) - 0.012;
                        const y = base(r.s) + (r.s === 0 ? 0.012 : SLAB) + h / 2 + 0.004;
                        setInst(lights, i, r.x, y, r.z, r.w, h, 1, r.ry);
                    } else setInst(lights, i, 0, 0, 0, 0, 0, 0);
                    lights.setColorAt(i, _c.copy(warm).lerp(cool, r.tone * 0.5).multiplyScalar(on * (0.8 + 0.2 * r.tone)));
                });
                flush(lights);
            }
            fanTurn += dt * (1.5 + 16 * twin);
            fans.forEach((f, i) => { f.rotation.y = (i ? -1 : 1) * fanTurn; });
            const blink = Math.pow(Math.max(0, Math.sin(t * 2.6)), 6);
            beaconMat.color.setRGB(1.7, 0.25, 0.2).multiplyScalar(0.25 + 1.1 * blink);
            mini.visible = twin > 0.01;
            if (mini.visible) {
                mini.rotation.y = t * 0.5;
                miniMat.opacity = 0.55 * twin;
                miniFill.opacity = twin * (0.015 + 0.03 * Math.pow(Math.max(0, Math.sin(t * 2.4 * Math.PI)), 3));
            }
            for (let k = 0; k < UP + DOWN; k++) {
                const up = k < UP;
                const u = ((t * (up ? 0.3 : 0.24) + (up ? k / UP : (k - UP) / DOWN + 0.15)) % 1 + 1) % 1;
                along(up ? u : 1 - u, _v);
                const sc = twin * (up ? 0.0085 : 0.011) * Math.min(1, u * 12, (1 - u) * 12);
                setInst(packets, k, _v.x, _v.y, _v.z, sc, sc, sc);
                packets.setColorAt(k, up ? upColour : downColour);
            }
            flush(packets);

            // The posts: the current one lit, and a pulse handing over to the next.
            nodeObjs.forEach((n, k) => n.lamp.material.color.copy(k === stage ? onLamp : offLamp));
            const go = lin(5.2, 6, t - stage * 6);
            const running = go > 0 && go < 1;
            for (let k = 0; k < 4; k++) {
                const g = clamp(go - k * 0.035, 0, 1);
                const pa = angleOf(stage) + minJerk(g) * (Math.PI / 2);
                const sc = running ? 0.024 * (1 - k * 0.22) * Math.sin(Math.PI * clamp(go, 0, 1)) ** 0.5 : 0;
                setInst(pulse, k, Math.sin(pa) * TRACK, DAIS + 0.03, Math.cos(pa) * TRACK, sc, sc, sc);
            }
            flush(pulse);
        },
        reset() { lastLap = null; },
        hum: () => hum
    };
}
