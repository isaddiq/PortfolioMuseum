// Builders for the research demonstrations (part one): BIM assembly,
// construction informatics, XR, the robotic arm and DfMA.
//
// Every builder receives { root, mats, accent, inst } and returns
// { render(t, dt), pick?(hit), hum?(), reset?() }. Model coordinates are in
// metres on the plinth top: x to the right, y up, +z towards the visitor.
// The front strip (z > 0.3) is kept clear for the reading label.

import * as THREE from 'three';
import * as art from './art.js';
import { clamp } from './util.js';
import {
    lin, sstep, easeOut, minJerk, mix, setInst, boxes, flush, part, WHITE,
    liveCanvas, cardSign, roundRect, accentGlow, boxEdges, bezier, figures, trees, softBox, groundShadow
} from './demo-kit.js';
import { surfaceMaterial as surf, surfaceVariant } from './surfaces.js';

/** Yellow-and-black hazard striping, laid on a ring around a robot's base. */
function hazardTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e2b52a';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#1c1c1e';
    for (let k = -128; k < 256; k += 32) {
        ctx.beginPath();
        ctx.moveTo(k, 0); ctx.lineTo(k + 16, 0); ctx.lineTo(k + 16 + 128, 128); ctx.lineTo(k + 128, 128);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    return tex;
}

const _c = new THREE.Color();
const _v = new THREE.Vector3();

// ---------------------------------------------------------------------------
// BIM: a three-storey frame assembled in construction order
// ---------------------------------------------------------------------------

const BIM_CLASS = {
    IfcFooting: { color: '#9a8c7d', pset: 'Pset_FootingCommon', material: 'Reinforced concrete', bearing: true },
    IfcSlab: { color: '#8db0c9', pset: 'Pset_SlabCommon', material: 'Reinforced concrete', bearing: true },
    IfcColumn: { color: '#d9a252', pset: 'Pset_ColumnCommon', material: 'Reinforced concrete', bearing: true },
    IfcWall: { color: '#c6b49c', pset: 'Pset_WallCommon', material: 'Insulated wall panel', bearing: false },
    IfcCurtainWall: { color: '#79c0d8', pset: 'Pset_CurtainWallCommon', material: 'Glazing in aluminium frame', bearing: false },
    IfcDoor: { color: '#c4855a', pset: 'Pset_DoorCommon', material: 'Glazed leaves in a steel frame', bearing: false },
    IfcUnitaryEquipment: { color: '#7fae7a', pset: 'Pset_UnitaryEquipmentTypeCommon', material: 'Steel casing', bearing: false }
};

export function buildBIM({ root, mats, accent, inst }) {
    const SCALE = 16;   // the model is 1:16
    const FH = 0.2;
    const xs = [-0.33, -0.11, 0.11, 0.33];
    const zs = [-0.33, -0.13, 0.07];
    const cz = -0.13;
    const els = [];
    const add = (e) => els.push(e);
    let k = 0;
    zs.forEach((z, zi) => xs.forEach((x, xi) => add({
        cls: 'IfcFooting', type: 'PAD_FOOTING', set: 'conc', name: `Pad footing F-${'ABC'[zi]}${xi + 1}`, level: -1,
        pos: [x, 0.0175, z], size: [0.075, 0.035, 0.075], mode: 'rise', t0: 0.4 + (k++) * 0.09, dur: 0.55
    })));
    add({ cls: 'IfcSlab', type: 'BASESLAB', set: 'slab', name: 'Ground-bearing slab', level: 0, pos: [0, 0.045, cz], size: [0.8, 0.02, 0.52], mode: 'drop', t0: 1.9, dur: 0.8 });
    for (let L = 0; L < 3; L++) {
        const y0 = 0.055 + L * FH;
        const t0 = 3.2 + L * 3.0;
        k = 0;
        zs.forEach((z, zi) => xs.forEach((x, xi) => add({
            cls: 'IfcColumn', type: 'COLUMN', set: 'conc', name: `Column C-${'ABC'[zi]}${xi + 1}`, level: L,
            pos: [x, y0 + (FH - 0.02) / 2, z], size: [0.032, FH - 0.02, 0.032], base: y0, mode: 'grow', t0: t0 + (k++) * 0.06, dur: 0.5
        })));
        // The stair and lift core rises with the columns of its storey.
        add({ cls: 'IfcWall', type: 'SHEAR', set: 'conc', name: `Core wall, ${L === 0 ? 'ground floor' : `level ${L}`}`, level: L, pos: [-0.22, y0 + (FH - 0.02) / 2, -0.23], size: [0.15, FH - 0.02, 0.13], base: y0, mode: 'grow', t0: t0 + 0.5, dur: 0.6, bearing: true });
        add({ cls: 'IfcSlab', type: L === 2 ? 'ROOF' : 'FLOOR', set: 'slab', name: L === 2 ? 'Roof slab' : `Floor slab, level ${L + 1}`, level: L + 1, pos: [0, y0 + FH - 0.01, cz], size: [0.8, 0.02, 0.52], mode: 'drop', t0: t0 + 1.25, dur: 0.8 });
    }
    for (let L = 0; L < 3; L++) {
        const y = 0.055 + L * FH + (FH - 0.02) / 2;
        const h = FH - 0.02;
        const t0 = 12.4 + L * 0.9;
        add({ cls: 'IfcCurtainWall', type: 'CURTAINWALL', set: 'glass', name: `Curtain wall CW-${L + 1}`, level: L, pos: [0, y, 0.093], size: [0.74, h, 0.008], mode: 'wipe', axis: 'x', t0, dur: 0.6, external: true });
        add({ cls: 'IfcWall', type: 'SOLIDWALL', set: 'wall', name: `External wall W-N${L + 1}`, level: L, pos: [0, y, -0.356], size: [0.74, h, 0.02], mode: 'wipe', axis: 'x', t0: t0 + 0.15, dur: 0.6, external: true });
        add({ cls: 'IfcWall', type: 'SOLIDWALL', set: 'wall', name: `External wall W-W${L + 1}`, level: L, pos: [-0.356, y, cz], size: [0.02, h, 0.44], mode: 'wipe', axis: 'z', t0: t0 + 0.3, dur: 0.6, external: true });
        add({ cls: 'IfcWall', type: 'SOLIDWALL', set: 'wall', name: `External wall W-E${L + 1}`, level: L, pos: [0.356, y, cz], size: [0.02, h, 0.44], mode: 'wipe', axis: 'z', t0: t0 + 0.45, dur: 0.6, external: true });
    }
    add({ cls: 'IfcDoor', type: 'DOOR', set: 'door', name: 'Entrance doors D-01', level: 0, pos: [0.11, 0.055 + 0.055, 0.099], size: [0.1, 0.11, 0.006], mode: 'wipe', axis: 'x', t0: 13.2, dur: 0.5, external: true });
    const RY = 0.055 + 3 * FH;
    [[0, RY + 0.012, 0.126, 0.8, 0.024, 0.012, 'x', 'S'], [0, RY + 0.012, -0.386, 0.8, 0.024, 0.012, 'x', 'N'], [-0.394, RY + 0.012, cz, 0.012, 0.024, 0.5, 'z', 'W'], [0.394, RY + 0.012, cz, 0.012, 0.024, 0.5, 'z', 'E']]
        .forEach(([x, y, z, w, h, d, axis, side], n) => add({ cls: 'IfcWall', type: 'PARAPET', set: 'slab', name: `Roof parapet P-${side}`, level: 3, pos: [x, y, z], size: [w, h, d], mode: 'wipe', axis, t0: 15.0 + n * 0.12, dur: 0.5, external: true }));
    add({ cls: 'IfcUnitaryEquipment', type: 'AIRHANDLER', set: 'equip', name: 'Rooftop air-handling unit', level: 3, pos: [0.14, 0.055 + 3 * FH + 0.025, -0.2], size: [0.16, 0.05, 0.12], mode: 'drop', t0: 15.6, dur: 0.8 });

    const sets = { conc: mats.concrete, slab: mats.precast, wall: mats.brickwall, glass: mats.curtain, equip: mats.grille, door: mats.timber };
    // Context, as a model maker would build it: a paved forecourt, lawn, trees and people.
    part(new THREE.BoxGeometry(1.0, 0.004, 0.7), mats.tiles, root, 0, 0.002, cz);
    part(new THREE.BoxGeometry(1.2, 0.003, 0.84), mats.grass, root, 0, 0.0015, -0.13);
    trees(root, [[-0.55, 0.2, 1], [-0.56, -0.44, 1.15], [0.55, -0.46, 0.9], [0.56, 0.16, 1.05], [-0.48, -0.02, 0.8]], mats);
    figures(root, [[0.2, 0.2, 2.8], [0.25, 0.17, -2.4], [-0.3, 0.22, 0.4], [0.45, 0.02, 1.6, 0.95], [-0.42, 0.12, -0.8]], mats.figure);
    const bimShadow = groundShadow(root, 0, cz, 0.8, 0.52, 0.4, 0.0045);
    const meshes = {};
    for (const [name, mat] of Object.entries(sets)) {
        const list = els.filter((e) => e.set === name);
        const mesh = boxes(list.length, mat, root);
        mesh.userData.bimEls = [];
        list.forEach((e, i) => { e.mesh = mesh; e.idx = i; mesh.userData.bimEls[i] = els.indexOf(e); });
        meshes[name] = mesh;
    }
    // Mullions and a transom stand proud of each curtain wall; they follow it as it closes.
    const curtains = els.filter((e) => e.cls === 'IfcCurtainWall');
    const MULL = 10;
    const mullions = boxes(curtains.length * (MULL + 1), mats.dark, root);
    const classColors = Object.fromEntries(Object.entries(BIM_CLASS).map(([k2, v]) => [k2, new THREE.Color(v.color)]));
    const hot = accent.clone().multiplyScalar(1.15);
    const OUT = 24;

    return {
        render(t) {
            const cls = sstep(16.6, 17.6, t) * (1 - sstep(22.6, 23.6, t));
            bimShadow.material.opacity = 0.42 * easeOut(lin(2, 7, t)) * (1 - sstep(24.5, 26.2, t));
            els.forEach((e, i) => {
                const p = easeOut(lin(e.t0, e.t0 + e.dur, t));
                const order = 1 - i / els.length;   // the last placed leaves first
                const out = sstep(OUT + order * 1.8, OUT + order * 1.8 + 0.5, t);
                const q = p * (1 - out);
                let [x, y, z] = e.pos;
                let [sx, sy, sz] = e.size;
                e.q = q;
                if (q <= 0.001) {
                    setInst(e.mesh, e.idx, x, y, z, 0, 0, 0);
                    return;
                }
                if (e.mode === 'rise') y = e.pos[1] - (1 - q) * sy;
                else if (e.mode === 'grow') { sy *= q; y = e.base + sy / 2; }
                else if (e.mode === 'drop') y += (1 - q) * 0.16;
                else if (e.axis === 'x') sx *= q;
                else sz *= q;
                setInst(e.mesh, e.idx, x, y, z, sx, sy, sz);
                if (i === inst.selected) _c.copy(hot);
                else _c.copy(WHITE).lerp(classColors[e.cls], cls);
                e.mesh.setColorAt(e.idx, _c);
            });
            curtains.forEach((e, c) => {
                const [w, h] = e.size;
                const y = e.pos[1];
                const z = e.pos[2] + 0.006;
                for (let m = 0; m < MULL; m++) {
                    const f = m / (MULL - 1);
                    const on = e.q > 0.001 && f <= e.q + 1e-3;
                    setInst(mullions, c * (MULL + 1) + m, -w / 2 + f * w, y, z, on ? 0.007 : 0, on ? h : 0, on ? 0.01 : 0);
                }
                const tw = w * (e.q || 0);
                setInst(mullions, c * (MULL + 1) + MULL, -w / 2 + tw / 2, y - h * 0.18, z, tw, tw > 0.002 ? 0.006 : 0, tw > 0.002 ? 0.008 : 0);
            });
            flush(...Object.values(meshes), mullions);
        },
        pick(hit) {
            const list = hit.object.userData.bimEls;
            if (!list || hit.instanceId == null) return null;
            const index = list[hit.instanceId];
            const e = els[index];
            if (!e) return null;
            inst.select(index);
            const c = BIM_CLASS[e.cls];
            const dims = e.size.map((v) => (v * SCALE).toFixed(2));
            return {
                name: e.name,
                ifcClass: e.cls,
                rows: [
                    ['IFC class', e.cls],
                    ['Predefined type', e.type],
                    ['Building storey', e.level < 0 ? 'Foundation' : e.level === 0 ? 'Ground floor' : e.level === 3 ? 'Roof' : `Level ${e.level}`],
                    ['Material', c.material],
                    ['Size (W × H × D)', `${dims[0]} × ${dims[1]} × ${dims[2]} m`],
                    [`${c.pset}.LoadBearing`, (e.bearing ?? c.bearing) ? 'TRUE' : 'FALSE'],
                    [`${c.pset}.IsExternal`, e.external ? 'TRUE' : (e.cls === 'IfcColumn' || e.cls === 'IfcSlab' ? 'FALSE' : '-')]
                ],
                note: 'Illustrative properties of a conceptual 1:16 model, generated for this demonstration.'
            };
        }
    };
}

// ---------------------------------------------------------------------------
// Construction informatics: a site that reports, and a dashboard that decides
// ---------------------------------------------------------------------------

/** A rounded rectangle in the plan (x, z) as a THREE.Shape (shape y = -z). */
function roundedPlan(x1, z1, x2, z2, r, hole = false) {
    const s = hole ? new THREE.Path() : new THREE.Shape();
    const Y = (z) => -z;
    s.moveTo(x1 + r, Y(z2));
    s.lineTo(x2 - r, Y(z2));
    s.absarc(x2 - r, Y(z2) + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x2, Y(z1) - r);
    s.absarc(x2 - r, Y(z1) - r, r, 0, Math.PI / 2, false);
    s.lineTo(x1 + r, Y(z1));
    s.absarc(x1 + r, Y(z1) - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x1, Y(z2) + r);
    s.absarc(x1 + r, Y(z2) + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
}

export function buildInformatics({ root, mats, accent }) {
    const accentHex = `#${accent.getHexString()}`;
    part(new THREE.BoxGeometry(1.24, 0.02, 0.8), mats.site, root, 0, 0.01, -0.13);
    // Haul road: a loop around the site.
    const RX1 = -0.5, RZ1 = -0.48, RX2 = 0.5, RZ2 = 0.2, RR = 0.09, RW = 0.05;
    const road = roundedPlan(RX1 - RW / 2, RZ1 - RW / 2, RX2 + RW / 2, RZ2 + RW / 2, RR + RW / 2);
    road.holes.push(roundedPlan(RX1 + RW / 2, RZ1 + RW / 2, RX2 - RW / 2, RZ2 - RW / 2, RR - RW / 2, true));
    const roadGeo = new THREE.ShapeGeometry(road, 12);
    roadGeo.rotateX(-Math.PI / 2);
    part(roadGeo, mats.road, root, 0, 0.021, 0);
    const lane = roundedPlan(RX1, RZ1, RX2, RZ2, RR).getSpacedPoints(240).map((p) => new THREE.Vector3(p.x, 0, -p.y));
    const laneLen = lane.reduce((s, p, i) => (i ? s + p.distanceTo(lane[i - 1]) : 0), 0);
    const laneAt = (u) => {
        const f = ((u % 1) + 1) % 1 * (lane.length - 1);
        const i = Math.floor(f);
        const a = lane[i];
        const b = lane[Math.min(i + 1, lane.length - 1)];
        return { p: a.clone().lerp(b, f - i), dir: Math.atan2(b.x - a.x, b.z - a.z) };
    };
    // Where the gate is: the point of the loop nearest the front right.
    let gateU = 0;
    let best = Infinity;
    lane.forEach((p, i) => { const d = Math.hypot(p.x - 0.28, p.z - RZ2); if (d < best) { best = d; gateU = i / (lane.length - 1); } });

    // Building under construction.
    const B = { x: -0.2, z: -0.24, w: 0.34, d: 0.24, lh: 0.055 };
    const levels = boxes(6, mats.concrete, root);          // the core of each storey
    const slabEdges = boxes(6, mats.precast, root);
    const FRAME = [];
    for (const fx of [-0.42, -0.14, 0.14, 0.42]) for (const fz of [-0.4, 0.4]) FRAME.push([fx * B.w, fz * B.d]);
    FRAME.push([-0.42 * B.w, 0], [0.42 * B.w, 0]);
    const frame = boxes(6 * FRAME.length, mats.concrete, root);
    // Edge protection on the working deck: it climbs with the top floor.
    const rails = boxes(4, mats.yellow, root);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(B.w + 0.01, 0.006, B.d + 0.01), mats.stone);
    shell.position.set(B.x, 0.023, B.z);
    root.add(shell);

    // Tower crane.
    const M = { x: 0.24, z: -0.38, h: 0.8 };
    const yellow = mats.yellow;
    // Lattice mast and jib (see-through bracing), on a concrete base.
    part(new THREE.BoxGeometry(0.03, M.h, 0.03), mats.lattice, root, M.x, 0.02 + M.h / 2, M.z);
    part(new THREE.BoxGeometry(0.07, 0.02, 0.07), mats.concrete, root, M.x, 0.03, M.z);
    const slew = new THREE.Group();
    slew.position.set(M.x, 0.02 + M.h, M.z);
    root.add(slew);
    part(new THREE.BoxGeometry(0.62, 0.018, 0.022), mats.lattice, slew, 0.16, 0.012, 0);
    part(new THREE.BoxGeometry(0.012, 0.06, 0.012), yellow, slew, 0.0, 0.05, 0);      // A-frame
    part(new THREE.CylinderGeometry(0.0012, 0.0012, 0.3, 4), mats.dark, slew, 0.15, 0.06, 0).rotation.z = Math.PI / 2 - 0.35;
    part(new THREE.BoxGeometry(0.06, 0.04, 0.04), mats.concrete, slew, -0.12, 0.0, 0);
    part(new THREE.BoxGeometry(0.03, 0.03, 0.03), mats.dark, slew, 0.03, -0.02, 0.0);
    part(softBox(0.034, 0.034, 0.03, 0.004), mats.paint, slew, 0.035, -0.022, 0.022);   // the operator's cab
    part(new THREE.BoxGeometry(0.03, 0.018, 0.002), mats.glass, slew, 0.035, -0.02, 0.0375);
    const trolley = part(new THREE.BoxGeometry(0.03, 0.012, 0.03), mats.dark, slew, 0.3, 0, 0);
    // Everything below the trolley hangs from it and swings as the jib slews.
    const pend = new THREE.Group();
    slew.add(pend);
    const HOOK = 0.05;      // the hook block rides this far above the load's lifting points
    const cable = part(new THREE.BoxGeometry(0.0026, 1, 0.0026), mats.dark, pend, 0, -0.3, 0);
    const hook = part(softBox(0.018, 0.022, 0.014, 0.004), mats.yellow, pend, 0, -0.5, 0);
    const load = part(new THREE.BoxGeometry(0.08, 0.026, 0.05), mats.timber, pend, 0, -0.52, 0);
    for (const bx of [-0.026, 0.026]) part(new THREE.BoxGeometry(0.006, 0.028, 0.052), mats.dark, load, bx, 0, 0);     // strapping
    const slingPts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) slingPts.push(0, HOOK - 0.01, 0, sx * 0.036, 0.013, sz * 0.022);
    const slingGeo = new THREE.BufferGeometry();
    slingGeo.setAttribute('position', new THREE.Float32BufferAttribute(slingPts, 3));
    load.add(new THREE.LineSegments(slingGeo, new THREE.LineBasicMaterial({ color: '#2a2c30' })));
    const sway = { a: 0, v: 0, lastYaw: null, lastRate: 0 };
    // Laydown area: the stock the crane lifts from.
    const pick = { x: 0.38, z: -0.12 };
    part(new THREE.BoxGeometry(0.11, 0.022, 0.08), mats.timber, root, pick.x, 0.031, pick.z);
    const yawTo = (p) => Math.atan2(-(p.z - M.z), p.x - M.x);
    const radTo = (p) => Math.hypot(p.x - M.x, p.z - M.z);
    const yawPick = yawTo(pick);
    const yawPlace = yawTo(B);
    // Lifts: three on time, one wait for a late delivery, then three quick ones.
    const lifts = [[0, 4, 1], [4, 4, 1], [8, 4, 1], [12, 4, 0], [16, 2.6, 1], [18.6, 2.6, 1], [21.2, 2.4, 1]];
    const placed = lifts.filter((l) => l[2]).map((l) => l[0] + l[1] * 0.66);
    const levelCount = (t) => placed.filter((p) => t >= p).length;

    // Truck: waits at the gate twice, laps the site in between.
    const truck = new THREE.Group();
    root.add(truck);
    part(softBox(0.05, 0.034, 0.096, 0.003), mats.warm, truck, 0, 0.05, -0.014);          // tipper body
    part(softBox(0.048, 0.04, 0.03, 0.004), mats.paint, truck, 0, 0.049, 0.054);          // cab
    part(new THREE.BoxGeometry(0.042, 0.016, 0.002), mats.glass, truck, 0, 0.056, 0.0695); // windscreen
    for (const s2 of [-1, 1]) part(new THREE.BoxGeometry(0.002, 0.014, 0.018), mats.glass, truck, s2 * 0.0245, 0.057, 0.055);
    part(new THREE.BoxGeometry(0.044, 0.008, 0.13), mats.dark, truck, 0, 0.026, 0.0);    // chassis
    const wheelGeo = new THREE.CylinderGeometry(0.0115, 0.0115, 0.008, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const wz of [-0.045, -0.025, 0.05]) for (const s2 of [-1, 1]) part(wheelGeo, mats.rubber, truck, s2 * 0.025, 0.0115, wz);
    // Lane markings, site cabins, trees beyond the road, and people at work.
    const dashes = boxes(40, mats.paint, root);
    for (let k = 0; k < 40; k++) {
        const a = laneAt(k / 40);
        setInst(dashes, k, a.p.x, 0.0218, a.p.z, 0.003, 0.0006, 0.022, a.dir);
    }
    flush(dashes);
    const cabin = surf('module', { scale: 20, roughness: 0.6 });
    for (const [cx2, cy2] of [[-0.38, 0.045], [-0.38, 0.095]]) part(softBox(0.11, 0.048, 0.05, 0.003), cabin, root, cx2, cy2, 0.1);
    groundShadow(root, -0.38, 0.1, 0.11, 0.05, 0.5, 0.0205);
    groundShadow(root, B.x, B.z, B.w, B.d, 0.35, 0.0205);
    trees(root, [[-0.585, 0.24, 0.8], [0.585, 0.24, 0.9], [-0.59, -0.5, 1], [0.59, -0.5, 0.85], [0.0, 0.25, 0.7]], mats);
    figures(root, [[-0.04, -0.06, 1.2, 0.95], [0.13, -0.03, -2.1], [0.36, -0.03, 2.6], [-0.3, 0.06, 0.2]], mats.figure);
    const truckU = (t) => {
        if (t < 1.6) return gateU;
        if (t < 14.5) return gateU + minJerk(lin(1.6, 14.5, t));
        if (t < 16.2) return gateU;
        return gateU + minJerk(lin(16.2, 26, t));
    };

    // Site office screen: the project dashboard.
    const screen = liveCanvas(512, 320);
    const scr = part(new THREE.PlaneGeometry(0.34, 0.2125), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }), root, 0.3, 0.175, 0.09);
    scr.rotation.x = -0.12;
    part(new THREE.BoxGeometry(0.36, 0.23, 0.012), mats.dark, root, 0.3, 0.175, 0.082).rotation.x = -0.12;
    part(new THREE.BoxGeometry(0.02, 0.07, 0.02), mats.dark, root, 0.3, 0.055, 0.075);
    const office = new THREE.Vector3(0.3, 0.29, 0.09);

    // Data packets from equipment to the office.
    const sends = [];
    const hookPos = (t) => craneState(t).hookWorld;
    for (const l of lifts) if (l[2]) sends.push({ t: l[0] + 0.2, from: hookPos }, { t: l[0] + l[1] * 0.66 + 0.05, from: () => new THREE.Vector3(B.x, 0.03 + levelCount(l[0] + l[1]) * B.lh, B.z) });
    sends.push({ t: 0.5, from: (t) => laneAt(truckU(t)).p.clone().setY(0.07) }, { t: 15.0, from: (t) => laneAt(truckU(t)).p.clone().setY(0.07) });
    for (let s = 1; s < 24; s += 1.7) sends.push({ t: s, from: () => new THREE.Vector3(B.x + 0.17, 0.08, B.z + 0.12) });
    const packets = boxes(10, accentGlow(accentHex, 1.5), root);
    packets.userData.noShadow = true;

    function craneState(t) {
        let lift = lifts[lifts.length - 1];
        for (const l of lifts) if (t >= l[0]) lift = l;
        const f = clamp((t - lift[0]) / lift[1], 0, 1);
        const loaded = lift[2];
        let yaw = yawPick;
        let r = radTo(pick);
        let hookY = 0.6;
        let carry = false;
        const pickY = 0.075;
        const placeY = 0.03 + levelCount(t) * B.lh + 0.04;
        if (!loaded) {
            // Waiting for the delivery: hook lowered at the empty laydown.
            hookY = mix(0.6, 0.2, sstep(0, 0.15, f)) + mix(0, 0.4, sstep(0.85, 1, f));
        } else {
            const slewTo = minJerk(lin(0.2, 0.55, f));
            const slewBack = minJerk(lin(0.78, 1, f));
            const s = slewTo * (1 - slewBack);
            yaw = mix(yawPick, yawPlace, s);
            r = mix(radTo(pick), radTo(B), s);
            if (f < 0.12) hookY = mix(0.6, pickY, minJerk(f / 0.12));
            else if (f < 0.2) hookY = mix(pickY, 0.6, minJerk((f - 0.12) / 0.08));
            else if (f < 0.55) hookY = 0.6;
            else if (f < 0.66) hookY = mix(0.6, placeY, minJerk((f - 0.55) / 0.11));
            else if (f < 0.78) hookY = mix(placeY, 0.6, minJerk((f - 0.66) / 0.12));
            carry = f >= 0.12 && f < 0.66;
        }
        const hookWorld = new THREE.Vector3(M.x + Math.cos(yaw) * r, hookY, M.z - Math.sin(yaw) * r);
        return { yaw, r, hookY, carry, hookWorld };
    }

    let lastYaw = yawPick;
    let hum = 0;
    const deviation = (t) => (t * 6) / 23.6 - levelCount(t);

    function paintScreen(t) {
        const tq = Math.round(t * 4) / 4;
        const n = levelCount(t);
        const late = deviation(t) > 0.5 && t > 12;
        const key = `${tq}|${n}|${late}`;
        if (screen.key === key) return;
        screen.key = key;
        const { ctx } = screen;
        const W = 512, H = 320;
        ctx.fillStyle = '#0f1216';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#e8edf2';
        ctx.font = `700 22px ${art.SANS}`;
        ctx.fillText('SITE DASHBOARD', 22, 36);
        ctx.fillStyle = '#8b96a3';
        ctx.font = `500 17px ${art.SANS}`;
        ctx.fillText(`Week ${Math.min(12, Math.floor(t / 26 * 12) + 1)} · levels complete ${n} of 6`, 22, 60);
        // Chart: planned (dashed) against actual (accent).
        const cx = 22, cy = 80, cw = W - 44, ch = 150;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 6; i++) {
            const y = cy + ch - (i / 6) * ch;
            ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx + cw, y); ctx.stroke();
        }
        const X = (tt) => cx + (tt / 26) * cw;
        const Y = (lv) => cy + ch - (lv / 6) * ch;
        ctx.setLineDash([7, 6]);
        ctx.strokeStyle = '#9aa5b1';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(23.6), Y(6)); ctx.lineTo(X(26), Y(6)); ctx.stroke();
        ctx.setLineDash([]);
        // The gap, while it lasts.
        if (late) {
            ctx.fillStyle = 'rgba(239,68,68,0.22)';
            ctx.beginPath();
            ctx.moveTo(X(12), Y(levelCount(12)));
            for (let s = 12; s <= t; s += 0.25) ctx.lineTo(X(s), Y(Math.min(6, (s * 6) / 23.6)));
            for (let s = t; s >= 12; s -= 0.25) ctx.lineTo(X(s), Y(levelCount(s)));
            ctx.closePath();
            ctx.fill();
        }
        ctx.strokeStyle = accentHex;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(X(0), Y(0));
        let lv = 0;
        for (const p of placed) {
            if (p > t) break;
            ctx.lineTo(X(p), Y(lv));
            lv += 1;
            ctx.lineTo(X(p), Y(lv));
        }
        ctx.lineTo(X(Math.min(t, 26)), Y(lv));
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(X(t), cy - 4); ctx.lineTo(X(t), cy + ch + 4); ctx.stroke();
        ctx.font = `500 14px ${art.SANS}`;
        ctx.fillStyle = '#9aa5b1';
        ctx.fillText('- - planned', cx + cw - 190, cy + ch + 22);
        ctx.fillStyle = accentHex;
        ctx.fillText('— actual', cx + cw - 90, cy + ch + 22);
        // Status.
        let status = 'Capturing site activity';
        let tone = '#7dd3a8';
        if (t >= 6) status = 'Records synchronised to the project data environment';
        if (t >= 12 && t < 16.5) { status = 'Delivery late: crane waiting, progress behind plan'; tone = '#f87171'; }
        if (t >= 16.5) { status = late ? 'Lifts re-sequenced to recover the late level' : 'Back on plan'; tone = late ? '#fbbf24' : '#7dd3a8'; }
        ctx.fillStyle = tone;
        ctx.beginPath(); ctx.arc(30, 282, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8edf2';
        ctx.font = `600 17px ${art.SANS}`;
        ctx.fillText(status, 46, 288, W - 70);
        screen.tex.needsUpdate = true;
    }

    return {
        render(t, dt) {
            // Building levels rise as each lift lands; the site clears at the end.
            const clear = sstep(24.6, 25.8, t);
            placed.forEach((p, i) => {
                const g = easeOut(lin(p, p + 0.7, t)) * (1 - sstep(24.6 + (5 - i) * 0.12, 25.2 + (5 - i) * 0.12, t));
                // A frame, not a block: columns and a core under each slab, open between them.
                const y0 = 0.026 + i * B.lh;
                const on = g > 0.01 ? 1 : 0;
                setInst(levels, i, B.x - 0.07, y0 + (B.lh * g) / 2, B.z - 0.03, 0.09 * on, B.lh * g, 0.07 * on);
                FRAME.forEach(([fx, fz], k) => setInst(frame, i * FRAME.length + k, B.x + fx, y0 + (B.lh * g * 0.86) / 2, B.z + fz, 0.014 * on, B.lh * g * 0.86, 0.014 * on));
                setInst(slabEdges, i, B.x, y0 + B.lh * g - 0.004 * g, B.z, B.w * on, 0.008 * g, B.d * on);
            });
            const deck = 0.026 + placed.reduce((sum, p, i) => sum + B.lh * easeOut(lin(p, p + 0.7, t)) * (1 - sstep(24.6 + (5 - i) * 0.12, 25.2 + (5 - i) * 0.12, t)), 0);
            const up = deck > 0.03 ? 1 : 0;
            setInst(rails, 0, B.x, deck + 0.012, B.z - B.d / 2, B.w * up, 0.0025, 0.0025);
            setInst(rails, 1, B.x, deck + 0.012, B.z + B.d / 2, B.w * up, 0.0025, 0.0025);
            setInst(rails, 2, B.x - B.w / 2, deck + 0.012, B.z, 0.0025, 0.0025, B.d * up);
            setInst(rails, 3, B.x + B.w / 2, deck + 0.012, B.z, 0.0025, 0.0025, B.d * up);
            flush(levels, slabEdges, frame, rails);
            const c = craneState(t);
            slew.rotation.y = c.yaw;
            trolley.position.x = c.r;
            const top = M.h + 0.02;
            const drop = top - c.hookY;
            pend.position.x = c.r;
            const rope = Math.max(0.001, drop - HOOK);
            cable.position.set(0, -rope / 2, 0);
            cable.scale.y = rope;
            hook.position.set(0, -rope - 0.008, 0);
            load.visible = c.carry && clear < 0.01;
            load.position.set(0, -drop - 0.013, 0);
            // The load is a pendulum: it lags as the jib speeds up, runs on as it
            // slows, and the swing dies away. A longer rope swings more slowly.
            if (dt > 0 && sway.lastYaw !== null) {
                const rate = (c.yaw - sway.lastYaw) / dt;
                const push = clamp((rate - sway.lastRate) / dt, -4, 4) * c.r;
                const w0 = 3.2 / Math.sqrt(Math.max(0.12, drop) / 0.3);
                sway.v += (-w0 * w0 * sway.a - 2 * 0.16 * w0 * sway.v + (push * 0.08) / Math.max(0.15, drop)) * dt;
                sway.a = clamp(sway.a + sway.v * dt, -0.16, 0.16);
                sway.lastRate = rate;
            }
            sway.lastYaw = c.yaw;
            pend.rotation.x = sway.a;
            if (dt > 0) {
                hum = clamp(Math.abs(c.yaw - lastYaw) / dt / 0.6, 0, 1) * 0.6;
                lastYaw = c.yaw;
            }
            const tr = laneAt(truckU(t));
            truck.position.copy(tr.p).setY(0.0);
            truck.rotation.y = tr.dir;
            // Packets: arcs from the source to the office.
            let slot = 0;
            for (const s of sends) {
                const u = (t - s.t) / 1.3;
                if (u < 0 || u > 1 || slot >= 10) continue;
                const from = s.from(s.t);
                const mid = from.clone().lerp(office, 0.5);
                mid.y = Math.max(from.y, office.y) + 0.16;
                bezier(from, mid, office, easeOut(u), _v);
                const sc = 0.016 * Math.sin(Math.PI * Math.min(1, u * 1.2));
                setInst(packets, slot++, _v.x, _v.y, _v.z, sc, sc, sc, u * 6);
            }
            for (; slot < 10; slot++) setInst(packets, slot, 0, 0, 0, 0, 0, 0);
            flush(packets);
            paintScreen(t);
        },
        reset() { sway.a = sway.v = sway.lastRate = 0; sway.lastYaw = null; },
        hum: () => hum
    };
}

// ---------------------------------------------------------------------------
// XR: a physical model registered with its hologram
// ---------------------------------------------------------------------------

export function buildXR({ root, mats, accent, inst }) {
    const accentHex = `#${accent.getHexString()}`;
    const TOP = 0.45;
    const solidPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const holoPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const solid = surfaceVariant(mats.model, { clippingPlanes: [solidPlane], clipShadows: true });
    const dark = surfaceVariant(mats.dark, { clippingPlanes: [solidPlane] });
    const blocks = [
        [0.42, 0.42, 0.26, -0.1, 0.21, -0.22],
        [0.24, 0.24, 0.2, 0.22, 0.12, -0.11],
        [0.78, 0.05, 0.44, 0.02, 0.025, -0.14]
    ];
    const solidGroup = new THREE.Group();
    root.add(solidGroup);
    for (const [w, h, d, x, y, z] of blocks) part(new THREE.BoxGeometry(w, h, d), solid, solidGroup, x, y, z);
    // Window bands on the tower and the wing.
    for (let y = 0.1; y < 0.42; y += 0.08) part(new THREE.BoxGeometry(0.38, 0.022, 0.006), dark, solidGroup, -0.1, y, -0.088);
    for (let y = 0.08; y < 0.24; y += 0.07) part(new THREE.BoxGeometry(0.2, 0.02, 0.006), dark, solidGroup, 0.22, y, -0.008);

    // White model trees and figures around the podium, as on a presentation model.
    trees(root, [[-0.44, 0.12, 0.9], [0.47, -0.36, 1], [-0.48, -0.42, 0.8]], { bark: mats.model, leaf: mats.figure });
    groundShadow(root, 0.02, -0.14, 0.78, 0.44, 0.38);
    figures(root, [[0.38, 0.14, 2.6], [0.43, 0.12, -2.8], [-0.3, 0.16, 0.6]], mats.figure);
    const holo = new THREE.Group();
    root.add(holo);
    const lineMat = mats.holoLine.clone();
    lineMat.clippingPlanes = [holoPlane];
    const floors = [];
    for (let y = 0.1; y < 0.42; y += 0.08) floors.push([0.42, 0.0001, 0.26, -0.1, y, -0.22]);
    for (let y = 0.08; y < 0.24; y += 0.08) floors.push([0.24, 0.0001, 0.2, 0.22, y, -0.11]);
    const lines = new THREE.LineSegments(boxEdges([...blocks, ...floors]), lineMat);
    holo.add(lines);
    const fillMat = mats.holoFill.clone();
    fillMat.clippingPlanes = [holoPlane];
    for (const [w, h, d, x, y, z] of blocks) part(new THREE.BoxGeometry(w, h, d), fillMat, holo, x, y, z).userData.noShadow = true;

    // The registration plane that sweeps the model.
    const scanMat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(1.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const scan = part(new THREE.PlaneGeometry(0.92, 0.58), scanMat, root, 0.02, 0, -0.14);
    scan.rotation.x = -Math.PI / 2;
    scan.userData.noShadow = true;
    const scanEdgeMat = new THREE.LineBasicMaterial({ color: accent.clone().multiplyScalar(1.6), transparent: true, opacity: 0, toneMapped: false });
    const scanEdge = new THREE.LineSegments(boxEdges([[0.92, 0.0001, 0.58, 0.02, 0, -0.14]]), scanEdgeMat);
    root.add(scanEdge);

    // A headset that orbits the hologram, with its field of view.
    const headset = new THREE.Group();
    root.add(headset);
    // A see-through headset: visor, brow housing with cameras, halo band and rear battery.
    const visorMat = new THREE.MeshPhysicalMaterial({ color: '#1a1420', roughness: 0.08, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 32, 1, true, -1.05, 2.1), visorMat, headset, 0, -0.004, -0.018);
    part(new THREE.CylinderGeometry(0.052, 0.052, 0.016, 32, 1, false, -1.15, 2.3), mats.dark, headset, 0, 0.024, -0.018);
    for (const sx of [-1, 1]) part(new THREE.SphereGeometry(0.0045, 10, 8), accentGlow(accentHex, 1.4), headset, sx * 0.024, 0.024, 0.0285);
    part(new THREE.BoxGeometry(0.03, 0.004, 0.003), accentGlow(accentHex, 1.2), headset, 0, 0.0245, 0.0335);
    const strap = part(new THREE.TorusGeometry(0.052, 0.0055, 8, 40), mats.dark, headset, 0, 0.022, -0.02);
    strap.rotation.x = Math.PI / 2;
    strap.scale.y = 1.22;
    const over = part(new THREE.TorusGeometry(0.056, 0.004, 6, 24, Math.PI), mats.dark, headset, 0, 0.022, -0.03);
    over.rotation.y = Math.PI / 2;
    part(softBox(0.05, 0.03, 0.016, 0.006), mats.dark, headset, 0, 0.02, -0.088);
    part(softBox(0.07, 0.014, 0.012, 0.005), mats.rubber, headset, 0, 0.012, 0.022);
    const fov = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: accent.clone().multiplyScalar(1.4), transparent: true, opacity: 0.5, toneMapped: false }));
    fov.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(16 * 3), 3));
    root.add(fov);
    const centre = new THREE.Vector3(0.02, 0.22, -0.15);
    const orbit = (t) => {
        const a = 0.55 * (t - 10.5) + 0.4;
        return new THREE.Vector3(centre.x + Math.sin(a) * 0.52, 0.48 + 0.03 * Math.sin(t * 0.9), centre.z + Math.cos(a) * 0.36);
    };
    const away = new THREE.Vector3(0.95, 0.75, 0.25);

    // Spatial overlays anchored to the model.
    const notes = [
        { at: new THREE.Vector3(-0.1, 0.42, -0.1), label: new THREE.Vector3(-0.42, 0.62, -0.05), title: 'Level 4 · Studio 401', sub: 'IfcSpace · 48 m²' },
        { at: new THREE.Vector3(0.22, 0.2, -0.02), label: new THREE.Vector3(0.48, 0.42, 0.0), title: 'Duct clearance', sub: 'Issue · open' },
        { at: new THREE.Vector3(0.3, 0.05, 0.08), label: new THREE.Vector3(0.5, 0.17, 0.14), title: 'Entrance door D-01', sub: 'IfcDoor · 1.0 × 2.1 m' }
    ];
    const noteObjs = notes.map((n) => {
        const mat = new THREE.SpriteMaterial({ map: cardSign(n.title, n.sub, accentHex), transparent: true, depthWrite: false, toneMapped: false });
        const sprite = new THREE.Sprite(mat);
        sprite.position.copy(n.label);
        sprite.center.set(0.5, 0);
        root.add(sprite);
        const pin = part(new THREE.SphereGeometry(0.012, 12, 8), accentGlow(accentHex, 1.5), root, n.at.x, n.at.y, n.at.z);
        const leader = new THREE.Line(new THREE.BufferGeometry().setFromPoints([n.at, n.label]), new THREE.LineBasicMaterial({ color: accent.clone().multiplyScalar(1.3), transparent: true, toneMapped: false }));
        root.add(leader);
        return { ...n, sprite, mat, pin, leader };
    });
    const fwd = new THREE.Vector3();

    return {
        render(t) {
            const y0 = inst.worldY0;
            let s = 0;
            if (t >= 2.5 && t < 17.5) s = mix(0, TOP, minJerk(lin(2.5, 7.5, t)));
            else if (t >= 17.5) s = mix(TOP, 0, minJerk(lin(17.5, 21, t)));
            solidPlane.constant = -(y0 + s * inst.scale);
            holoPlane.constant = y0 + s * inst.scale;
            solidGroup.visible = s < TOP - 0.003;
            holo.visible = s > 0.003;
            lineMat.opacity = 0.7 + 0.12 * Math.sin(t * 3.1);
            const scanOn = sstep(1.8, 2.5, t) * (1 - sstep(7.5, 8.3, t)) + sstep(17.2, 17.6, t) * (1 - sstep(21, 21.5, t));
            scan.position.y = s + 0.001;
            scanEdge.position.y = s + 0.001;
            scanMat.opacity = 0.14 * scanOn;
            scanEdgeMat.opacity = 0.8 * scanOn;
            scan.visible = scanEdge.visible = scanOn > 0.01;
            // Headset: in, round, out.
            let hp;
            if (t < 8.5 || t > 19.5) hp = away;
            else if (t < 10.5) hp = away.clone().lerp(orbit(10.5), minJerk(lin(8.5, 10.5, t)));
            else if (t < 17.2) hp = orbit(t);
            else hp = orbit(17.2).lerp(away, minJerk(lin(17.2, 19.5, t)));
            const shown = t > 8.5 && t < 19.5;
            headset.visible = fov.visible = shown;
            headset.position.copy(hp);
            headset.lookAt(_v.copy(centre).applyMatrix4(root.matrixWorld));
            if (shown) {
                fwd.copy(centre).sub(hp).normalize();
                const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
                const up = new THREE.Vector3().crossVectors(right, fwd);
                const at = hp.clone().addScaledVector(fwd, hp.distanceTo(centre) * 0.92);
                const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => at.clone().addScaledVector(right, a * 0.17).addScaledVector(up, b * 0.11));
                const arr = fov.geometry.attributes.position.array;
                let i = 0;
                const put = (p) => { arr[i++] = p.x; arr[i++] = p.y; arr[i++] = p.z; };
                for (let k = 0; k < 4; k++) { put(hp); put(corners[k]); }
                for (let k = 0; k < 4; k++) { put(corners[k]); put(corners[(k + 1) % 4]); }
                fov.geometry.attributes.position.needsUpdate = true;
                fov.geometry.computeBoundingSphere();
                fov.material.opacity = 0.45 * sstep(9.5, 10.5, t) * (1 - sstep(17.2, 17.8, t));
            }
            noteObjs.forEach((n, k) => {
                const o = easeOut(lin(11 + k, 11.6 + k, t)) * (1 - sstep(17.0, 17.8, t));
                const look = shown ? fwd.dot(_v.copy(n.at).sub(hp).normalize()) : 0;
                const focus = look > 0.95 ? 1 : 0;
                const sc = o * (1 + 0.12 * focus);
                n.sprite.visible = n.pin.visible = n.leader.visible = o > 0.01;
                n.sprite.scale.set(0.27 * sc, 0.0675 * sc, 1);
                n.mat.opacity = o * (0.78 + 0.22 * focus);
                n.leader.material.opacity = o * 0.7;
            });
        }
    };
}

// ---------------------------------------------------------------------------
// Construction robotics: a planned pick-and-place
// ---------------------------------------------------------------------------

export function buildRobot({ root, mats, accent, inst }) {
    const accentHex = `#${accent.getHexString()}`;
    const BASE = new THREE.Vector3(0, 0, -0.14);
    const H0 = 0.13;
    const L1 = 0.3;
    const L2 = 0.28;
    const GRIP = 0.085;
    const BRICK = [0.045, 0.045, 0.09];
    const arm = mats.paint;
    const joint = surf('paintWhite', { color: accentHex, scale: 8, roughness: 0.4, metalness: 0.2 });
    // Hazard ring on the floor around the robot's reach.
    const ring = part(new THREE.RingGeometry(0.29, 0.305, 96), new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6 }), root, BASE.x, 0.0015, BASE.z);
    ring.rotation.x = -Math.PI / 2;
    // Control cabinet with a screen and an emergency stop, cabled to the base.
    const cab = new THREE.Group();
    cab.position.set(-0.5, 0, -0.42);
    cab.rotation.y = 0.5;
    root.add(cab);
    part(softBox(0.12, 0.2, 0.08, 0.005), mats.dark, cab, 0, 0.1, 0);
    part(new THREE.PlaneGeometry(0.07, 0.045), accentGlow(accentHex, 0.9), cab, 0, 0.15, 0.0405);
    part(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 16), new THREE.MeshStandardMaterial({ color: '#c62828', roughness: 0.4 }), cab, 0.03, 0.09, 0.044).rotation.x = Math.PI / 2;
    const cablePath = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.47, 0.004, -0.39), new THREE.Vector3(-0.3, 0.004, -0.3), new THREE.Vector3(-0.12, 0.004, -0.2), new THREE.Vector3(-0.05, 0.004, -0.17)]);
    part(new THREE.TubeGeometry(cablePath, 32, 0.004, 6), mats.rubber, root);
    figures(root, [[-0.3, -0.44, 0.9]], mats.figure);
    groundShadow(root, BASE.x, BASE.z, 0.2, 0.2, 0.5);
    groundShadow(root, -0.5, -0.42, 0.12, 0.08, 0.5);
    part(new THREE.CylinderGeometry(0.09, 0.1, 0.05, 32), mats.dark, root, BASE.x, 0.025, BASE.z);
    for (let b = 0; b < 6; b++) part(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 8), mats.steel, root, BASE.x + Math.cos(b) * 0.082, 0.052, BASE.z + Math.sin(b) * 0.082);
    const yawG = new THREE.Group();
    yawG.position.set(BASE.x, 0.05, BASE.z);
    root.add(yawG);
    part(new THREE.CylinderGeometry(0.065, 0.075, 0.08, 28), arm, yawG, 0, 0.04, 0);
    const shoulder = new THREE.Group();
    shoulder.position.y = H0 - 0.05;
    yawG.add(shoulder);
    const zAxis = (r, len, mat, parent) => { const c = part(new THREE.CylinderGeometry(r, r, len, 24), mat, parent); c.rotation.x = Math.PI / 2; return c; };
    zAxis(0.045, 0.1, joint, shoulder);
    part(softBox(L1 + 0.02, 0.052, 0.062, 0.022), arm, shoulder, L1 / 2, 0, 0);
    const elbow = new THREE.Group();
    elbow.position.x = L1;
    shoulder.add(elbow);
    zAxis(0.034, 0.085, joint, elbow);
    part(softBox(L2 + 0.016, 0.042, 0.046, 0.017), arm, elbow, L2 / 2, 0, 0);
    const wrist = new THREE.Group();
    wrist.position.x = L2;
    elbow.add(wrist);
    zAxis(0.026, 0.065, joint, wrist);
    const roll = new THREE.Group();
    wrist.add(roll);
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 20), mats.steel, roll, 0.012, 0, 0).rotation.z = Math.PI / 2;   // tool flange
    part(softBox(0.036, 0.05, 0.062, 0.008), mats.dark, roll, 0.036, 0, 0);
    part(new THREE.BoxGeometry(0.006, 0.02, 0.07), mats.steel, roll, 0.056, 0, 0);          // the slide the jaws run on
    const fingers = [-1, 1].map((s) => {
        const f = part(new THREE.BoxGeometry(0.05, 0.016, 0.01), mats.steel, roll, 0.079, 0, s * 0.03);
        part(new THREE.BoxGeometry(0.03, 0.02, 0.004), mats.rubber, f, 0.008, 0, -s * 0.006);   // grip pad
        return f;
    });
    // Dress pack: the hose that carries power and air along the arm.
    const hose = (pts, parent) => part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q))), 24, 0.006, 8), mats.rubber, parent);
    hose([[0.02, 0.03, 0.034], [0.1, 0.045, 0.04], [0.2, 0.045, 0.04], [L1 - 0.02, 0.03, 0.034]], shoulder);
    hose([[0.03, 0.024, 0.027], [0.1, 0.036, 0.03], [0.19, 0.036, 0.03], [L2 - 0.03, 0.022, 0.026]], elbow);
    for (const hx of [0.07, 0.23]) part(new THREE.BoxGeometry(0.012, 0.012, 0.016), mats.dark, shoulder, hx, 0.032, 0.036);
    // Signal tower on the cabinet: amber while a move is planned, green while it runs.
    part(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 8), mats.steel, cab, -0.035, 0.215, 0);
    const lampAmber = part(new THREE.CylinderGeometry(0.009, 0.009, 0.014, 14), new THREE.MeshBasicMaterial({ color: '#3a2c10', toneMapped: false }), cab, -0.035, 0.237, 0);
    const lampGreen = part(new THREE.CylinderGeometry(0.009, 0.009, 0.014, 14), new THREE.MeshBasicMaterial({ color: '#12301c', toneMapped: false }), cab, -0.035, 0.252, 0);
    lampAmber.userData.noShadow = lampGreen.userData.noShadow = true;

    // Pallet and wall course.
    part(new THREE.BoxGeometry(0.2, 0.02, 0.15), mats.timber, root, 0.36, 0.01, 0.12);
    part(new THREE.BoxGeometry(0.08, 0.01, 0.36), mats.stone, root, -0.34, 0.005, 0.03);
    const bricks = boxes(6, mats.brick, root, softBox(BRICK[0], BRICK[1], BRICK[2], 0.003));
    const palletSlot = (i) => {
        const layer = i < 3 ? 1 : 0;
        const k = i % 3;
        return new THREE.Vector3(0.36 + (k - 1) * 0.052, 0.02 + BRICK[1] / 2 + layer * BRICK[1], 0.12);
    };
    const wallSlot = (i) => {
        const course = i < 3 ? 0 : 1;
        const k = i % 3;
        return new THREE.Vector3(-0.34, 0.01 + BRICK[1] / 2 + course * BRICK[1], -0.08 + k * 0.095 + course * 0.047);
    };
    const HOME = new THREE.Vector3(0.0, 0.42, 0.06);
    const P = 7.2;
    // Tool-tip path for brick i (tip = brick top centre).
    const above = (p, h = 0.14) => p.clone().setY(p.y + BRICK[1] / 2 + h);
    const at = (p) => p.clone().setY(p.y + BRICK[1] / 2);
    const startOf = (i) => (i === 0 ? HOME : above(wallSlot(i - 1)));
    function tipAt(i, u) {
        // u: seconds into the cycle.
        const s = startOf(i);
        const pk = palletSlot(i);
        const pl = wallSlot(i);
        if (u < 0.9) return s.clone();
        if (u < 2.1) return s.clone().lerp(above(pk), minJerk(lin(0.9, 2.1, u)));
        if (u < 2.7) return above(pk).lerp(at(pk), minJerk(lin(2.1, 2.7, u)));
        if (u < 3.0) return at(pk);
        if (u < 3.5) return at(pk).lerp(above(pk, 0.12), minJerk(lin(3.0, 3.5, u)));
        if (u < 4.9) {
            const a = above(pk, 0.12);
            const b = above(pl, 0.12);
            const c = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + 0.12, 0.27);
            return bezier(a, c, b, minJerk(lin(3.5, 4.9, u)), new THREE.Vector3());
        }
        if (u < 5.4) return above(pl, 0.12).lerp(at(pl), minJerk(lin(4.9, 5.4, u)));
        if (u < 5.7) return at(pl);
        return at(pl).lerp(above(pl), minJerk(lin(5.7, 6.3, u)));
    }
    const grip = (u) => (u < 2.7 ? 0 : u < 3.0 ? lin(2.7, 3.0, u) : u < 5.4 ? 1 : 1 - lin(5.4, 5.7, u));
    // The planned path, as dots, for the current brick.
    const DOTS = 40;
    const dotMat = accentGlow(accentHex, 1.2);
    const dots = boxes(DOTS, dotMat, root, new THREE.SphereGeometry(1, 8, 6));
    dots.userData.noShadow = true;
    const plans = [];
    for (let i = 0; i < 6; i++) plans.push(Array.from({ length: DOTS }, (_, k) => tipAt(i, 0.9 + (k / (DOTS - 1)) * 5.4)));
    const dim = accent.clone().multiplyScalar(0.35);

    let last = null;
    let hum = 0;
    let lastPlaced = -1;
    function solve(tip, dt) {
        const w = tip.clone();
        w.y += GRIP;
        const dx = w.x - BASE.x;
        const dz = w.z - BASE.z;
        const r = Math.hypot(dx, dz);
        const yaw = Math.atan2(-dz, dx);
        const px = r;
        const py = w.y - H0;
        const d = clamp(Math.hypot(px, py), 0.05, L1 + L2 - 0.001);
        const c2 = clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
        const t2 = -Math.acos(c2);
        const t1 = Math.atan2(py, px) - Math.atan2(L2 * Math.sin(t2), L1 + L2 * Math.cos(t2));
        const t3 = -Math.PI / 2 - t1 - t2;
        yawG.rotation.y = yaw;
        shoulder.rotation.z = t1;
        elbow.rotation.z = t2;
        wrist.rotation.z = t3;
        roll.rotation.x = yaw - Math.PI / 2;
        if (last && dt > 0) {
            const speed = (Math.abs(yaw - last[0]) + Math.abs(t1 - last[1]) + Math.abs(t2 - last[2])) / dt;
            hum = clamp(speed / 2.2, 0, 1);
        }
        last = [yaw, t1, t2];
    }

    return {
        render(t, dt) {
            const n = Math.min(Math.floor(t / P), 5);
            const tail = t >= 6 * P;
            const u = tail ? P : t - n * P;
            let tip;
            if (!tail) tip = tipAt(n, u);
            else tip = above(wallSlot(5)).lerp(HOME, minJerk(lin(6 * P, 6 * P + 1.8, t)));
            solve(tip, dt);
            const planning = !tail && u < 0.9;
            lampAmber.material.color.setRGB(1.6, 1.0, 0.2).multiplyScalar(planning ? 0.6 + 0.4 * Math.sin(t * 14) : 0.1);
            lampGreen.material.color.setRGB(0.3, 1.5, 0.55).multiplyScalar(!planning && hum > 0.03 ? 1 : 0.1);
            const g = tail ? 0 : grip(u);
            fingers.forEach((f, k) => { f.position.z = (k ? 1 : -1) * mix(0.032, BRICK[0] / 2 + 0.006, g); });
            // Bricks: on the pallet, in the gripper, or in the wall.
            const reset = sstep(45, 46.6, t);
            for (let i = 0; i < 6; i++) {
                let p;
                if (tail || i < n || (i === n && u >= 5.4)) p = wallSlot(i).clone().setY(wallSlot(i).y - reset * 0.12);
                else if (i === n && u >= 2.85) p = tip.clone().setY(tip.y - BRICK[1] / 2);
                else p = palletSlot(i).clone().setY(palletSlot(i).y - (t < 0.6 && n === 0 ? (1 - lin(0, 0.6, t)) * 0.12 : 0));
                const hidden = tail && reset >= 0.999;
                setInst(bricks, i, p.x, p.y, p.z, hidden ? 0 : 1, hidden ? 0 : 1, hidden ? 0 : 1);
            }
            flush(bricks);
            // Planned path: drawn during "plan", passed dots dim as the tool moves on.
            const reveal = tail ? 0 : lin(0, 0.85, u);
            const done = tail ? 1 : lin(0.9, 6.3, u);
            const plan = plans[n];
            for (let k = 0; k < DOTS; k++) {
                const f = k / (DOTS - 1);
                const show = !tail && f <= reveal + 1e-6;
                const p = plan[k];
                const sc = show ? 0.0055 : 0;
                setInst(dots, k, p.x, p.y, p.z, sc, sc, sc);
                dots.setColorAt(k, f < done ? dim : WHITE);
            }
            flush(dots);
            if (!tail && u >= 5.4 && lastPlaced !== n) {
                lastPlaced = n;
                inst.events.push('place');
            }
        },
        reset() { last = null; lastPlaced = -1; },
        hum: () => hum
    };
}

// ---------------------------------------------------------------------------
// DfMA: modules made, lifted and stacked
// ---------------------------------------------------------------------------

export function buildDfMA({ root, mats, accent, inst }) {
    const MW = 0.2, MH = 0.11, MD = 0.13;
    const SL = 0.04;        // the spreader beam rides this far above the module, on four slings
    const BED = { x: -0.36, z: -0.12, y: 0.02 };
    const slots = [];
    for (let level = 0; level < 3; level++) for (const x of [0.17, 0.39]) slots.push({ x, z: -0.12, y: 0.016 + level * (MH + 0.002) });
    part(new THREE.BoxGeometry(0.3, 0.02, 0.22), mats.stone, root, BED.x, 0.01, BED.z);
    part(new THREE.BoxGeometry(0.48, 0.016, 0.2), mats.concrete, root, 0.28, 0.008, -0.12);
    // Gantry.
    const yellow = mats.yellow;
    for (const z of [-0.2, -0.04]) part(new THREE.BoxGeometry(0.34, 0.006, 0.01), mats.steel, root, BED.x, 0.023, z);   // bed rails
    figures(root, [[-0.2, 0.08, -1.2], [-0.52, 0.06, 1.1], [0.05, 0.12, 2.9, 0.96]], mats.figure);
    trees(root, [[0.5, 0.2, 0.9], [-0.58, -0.45, 1], [0.15, 0.22, 0.75]], mats);
    const GY = 0.64;
    for (const x of [-0.56, 0.58]) for (const z of [-0.3, 0.06]) part(new THREE.BoxGeometry(0.02, GY, 0.02), yellow, root, x, GY / 2, z);
    for (const z of [-0.3, 0.06]) part(new THREE.BoxGeometry(1.16, 0.024, 0.024), yellow, root, 0.01, GY, z);
    const trolley = part(new THREE.BoxGeometry(0.06, 0.03, 0.4), mats.dark, root, BED.x, GY + 0.02, -0.12);
    const cable = part(new THREE.BoxGeometry(0.003, 1, 0.003), mats.dark, root, BED.x, 0.4, -0.12);
    const pivot = new THREE.Group();
    root.add(pivot);
    const spreader = part(new THREE.BoxGeometry(0.22, 0.012, 0.03), yellow, pivot, 0, 0, 0);
    for (const sx of [-1, 1]) part(new THREE.BoxGeometry(0.012, 0.01, MD), yellow, pivot, sx * 0.095, -0.002, 0);     // cross-heads
    part(softBox(0.03, 0.03, 0.022, 0.005), mats.dark, pivot, 0, 0.018, 0);                                            // hook block
    const slingPts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) slingPts.push(sx * 0.095, -0.006, sz * (MD / 2 - 0.004), sx * (MW / 2 - 0.008), -SL, sz * (MD / 2 - 0.008));
    const slingGeo = new THREE.BufferGeometry();
    slingGeo.setAttribute('position', new THREE.Float32BufferAttribute(slingPts, 3));
    const slings = new THREE.LineSegments(slingGeo, new THREE.LineBasicMaterial({ color: '#1f2023' }));
    pivot.add(slings);
    // The gantry, dressed: base plates, knee braces, tie beams, and a hoist on the crab.
    for (const x of [-0.56, 0.58]) {
        for (const z of [-0.3, 0.06]) {
            part(new THREE.BoxGeometry(0.05, 0.006, 0.05), mats.steel, root, x, 0.003, z);
            const brace = part(new THREE.BoxGeometry(0.1, 0.01, 0.01), yellow, root, x + (x < 0 ? 0.034 : -0.034), GY - 0.046, z);
            brace.rotation.z = x < 0 ? Math.PI / 4 : -Math.PI / 4;
        }
        part(new THREE.BoxGeometry(0.016, 0.016, 0.38), yellow, root, x, GY - 0.2, -0.12);
    }
    const crab = new THREE.Group();
    root.add(crab);
    part(softBox(0.07, 0.04, 0.07, 0.006), mats.dark, crab, 0, GY + 0.05, -0.12);                  // hoist motor
    const drum = part(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 16), mats.steel, crab, 0, GY + 0.012, -0.12);
    drum.rotation.x = Math.PI / 2;
    for (const z of [-0.3, 0.06]) for (const dx of [-0.02, 0.02]) part(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 12), mats.steel, crab, dx, GY + 0.02, z).rotation.x = Math.PI / 2;

    // Facade texture for the finished modules.
    const facade = art.makeCanvas(256, 140, 1);
    {
        const ctx = facade.getContext('2d');
        ctx.fillStyle = '#ece8e1';
        ctx.fillRect(0, 0, 256, 140);
        ctx.fillStyle = '#5f7685';
        for (const x of [24, 104, 184]) ctx.fillRect(x, 34, 48, 62);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, 252, 136);
    }
    const ftex = new THREE.CanvasTexture(facade);
    ftex.colorSpace = THREE.SRGBColorSpace;
    // Cladding and a window per bay, laid out to the module's own size.
    const moduleMat = surf('module', { scale: [1 / 0.1, 1 / MH, 1 / MD], offset: [MW / 2, MH / 2, MD / 2], roughness: 0.6, bump: 0.5 });
    ftex.dispose();
    const capMat = mats.precast;
    const moduleGeo = new THREE.BoxGeometry(MW, MH, MD);
    const modules = slots.map(() => {
        const m = new THREE.Mesh(moduleGeo, [moduleMat, moduleMat, capMat, capMat, moduleMat, moduleMat]);
        root.add(m);
        return m;
    });
    // The panels of the module being made.
    const T = 0.008;
    const panelMat = mats.white;
    const floor = part(new THREE.BoxGeometry(MW, 0.012, MD), mats.timber, root);
    const roof = part(new THREE.BoxGeometry(MW, 0.012, MD), mats.concrete, root);
    const hinge = (geo, x, z, axis, sign) => {
        const g = new THREE.Group();
        g.position.set(BED.x + x, BED.y + 0.012, BED.z + z);
        root.add(g);
        const panel = part(geo, panelMat, g, 0, (MH - 0.012) / 2, 0);
        // The long walls arrive with their windows already fitted.
        if (axis === 'x') for (const wx of [-0.05, 0.05]) part(new THREE.BoxGeometry(0.038, 0.054, T + 0.002), mats.glass, g, wx, 0.051, 0);
        return { g, panel, axis, sign };
    };
    const walls = [
        hinge(new THREE.BoxGeometry(MW, MH - 0.012, T), 0, MD / 2 - T / 2, 'x', 1),
        hinge(new THREE.BoxGeometry(MW, MH - 0.012, T), 0, -MD / 2 + T / 2, 'x', -1),
        hinge(new THREE.BoxGeometry(T, MH - 0.012, MD - 2 * T), MW / 2 - T / 2, 0, 'z', -1),
        hinge(new THREE.BoxGeometry(T, MH - 0.012, MD - 2 * T), -MW / 2 + T / 2, 0, 'z', 1)
    ];
    const P = 6.4;
    const TRAVEL = 0.42;   // module bottom height while carried
    let hum = 0;
    let lastX = BED.x;
    let lastSet = -1;

    function trolleyX(i, u) {
        const prev = i === 0 ? BED.x : slots[i - 1].x;
        if (u < 2.1) return mix(prev, BED.x, minJerk(lin(0, 2.0, u)));
        if (u < 3.2) return BED.x;
        if (u < 4.6) return mix(BED.x, slots[i].x, minJerk(lin(3.2, 4.6, u)));
        return slots[i].x;
    }
    function hookY(i, u) {
        const top = 0.56;
        const bedTop = BED.y + MH + SL;
        const slotTop = slots[i].y + MH + SL;
        if (u < 2.1) return top;
        if (u < 2.5) return mix(top, bedTop, minJerk(lin(2.1, 2.5, u)));
        if (u < 3.2) return mix(bedTop, TRAVEL + MH + SL, minJerk(lin(2.5, 3.2, u)));
        if (u < 4.6) return TRAVEL + MH + SL;
        if (u < 5.4) return mix(TRAVEL + MH + SL, slotTop, minJerk(lin(4.6, 5.4, u)));
        return mix(slotTop, top, minJerk(lin(5.4, 6.2, u)));
    }
    function swing(u) {
        if (u < 3.2) return 0;
        if (u < 4.6) {
            const x = lin(3.2, 4.6, u);
            return -0.06 * (60 * x - 180 * x * x + 120 * x * x * x) / 5.77;
        }
        const s = u - 4.6;
        return 0.035 * Math.sin(8 * s) * Math.exp(-3.2 * s);
    }

    return {
        render(t, dt) {
            const tail = t >= 6 * P;
            const n = Math.min(Math.floor(t / P), 5);
            const u = tail ? P : t - n * P;
            // Finished modules in their slots; the one being carried; the rest hidden.
            const clear = sstep(42, 43.6, t);
            modules.forEach((m, i) => {
                const settled = i < n || (i === n && u >= 5.4) || tail;
                m.visible = settled || (i === n && u >= 2.5 && u < 5.4);
                if (settled) {
                    const out = sstep(42 + (5 - i) * 0.2, 42.6 + (5 - i) * 0.2, t);
                    m.position.set(slots[i].x, slots[i].y + MH / 2 - out * 0.4, slots[i].z);
                    m.rotation.set(0, 0, 0);
                    m.visible = out < 0.999 && m.visible;
                }
            });
            const x = tail ? mix(slots[5].x, BED.x, minJerk(lin(6 * P, 6 * P + 2.2, t))) : trolleyX(n, u);
            const hy = tail ? 0.56 : hookY(n, u);
            trolley.position.x = x;
            crab.position.x = x;
            drum.rotation.y = hy * 40;
            slings.visible = !tail && u >= 2.5 && u < 5.4;
            const top = GY;
            cable.position.set(x, (top + hy) / 2, -0.12);
            cable.scale.y = Math.max(0.001, top - hy);
            pivot.position.set(x, hy, -0.12);
            pivot.rotation.z = tail ? 0 : swing(u);
            spreader.position.y = 0;
            if (!tail && u >= 2.5 && u < 5.4) {
                const m = modules[n];
                // Hang it from the spreader, so it swings with it.
                _v.set(0, -SL - MH / 2, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), pivot.rotation.z);
                m.position.set(x + _v.x, hy + _v.y, -0.12);
                m.rotation.set(0, 0, pivot.rotation.z);
            }
            // Panels on the bed during manufacture.
            const making = !tail && u < 2.5 && clear < 0.01;
            floor.visible = roof.visible = making;
            walls.forEach((w) => { w.g.visible = making; });
            if (making) {
                floor.position.set(BED.x, BED.y + 0.006 - (1 - easeOut(lin(0, 0.4, u))) * 0.05, BED.z);
                walls.forEach((w, k) => {
                    const up = minJerk(lin(0.4 + k * 0.15, 1.0 + k * 0.15, u));
                    const flat = (1 - up) * (Math.PI / 2) * w.sign;
                    w.g.rotation.set(w.axis === 'x' ? flat : 0, 0, w.axis === 'z' ? flat : 0);
                });
                roof.position.set(BED.x, BED.y + MH - 0.006 + (1 - easeOut(lin(1.6, 2.1, u))) * 0.15, BED.z);
                roof.visible = u >= 1.6;
            }
            if (dt > 0) {
                hum = clamp(Math.abs(x - lastX) / dt / 0.25, 0, 1) * 0.7;
                lastX = x;
            }
            if (!tail && u >= 5.4 && lastSet !== n) {
                lastSet = n;
                inst.events.push('place');
            }
        },
        reset() { lastSet = -1; },
        hum: () => hum
    };
}
