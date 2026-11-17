// Builders for the research demonstrations (part two): AI queries over a
// building model, the digital twin, IFC-to-engine interoperability, robot
// navigation with live replanning. The lobby's centrepiece is in demos-c.js.
//
// Same contract as demos-a.js: build({ root, mats, accent, inst }) returns
// { render(t, dt), hum?(), reset?() } in plinth-top coordinates.

import * as THREE from 'three';
import * as art from './art.js';
import { clamp } from './util.js';
import {
    lin, sstep, easeOut, minJerk, mix, turn, setInst, boxes, flush, part, WHITE,
    liveCanvas, cardSign, roundRect, accentGlow, boxEdges, bezier, figures, trees, softBox, groundShadow
} from './demo-kit.js';

const _c = new THREE.Color();
const _v = new THREE.Vector3();

/** Fade an instance's colour between a base and a target. */
function tint(mesh, i, base, target, k) {
    _c.copy(base).lerp(target, clamp(k, 0, 1));
    mesh.setColorAt(i, _c);
}

// ---------------------------------------------------------------------------
// AI for construction: plain-language questions answered from the model
// ---------------------------------------------------------------------------

export function buildAI({ root, mats, accent }) {
    const accentHex = `#${accent.getHexString()}`;
    const FH = 0.15;
    const BX = -0.22, BZ = -0.29, BW = 0.72, BD = 0.42;
    const x1 = BX - BW / 2, x2 = BX + BW / 2, zb = BZ - BD / 2, zf = BZ + BD / 2;
    const parts = { slab: [], wall: [], door: [], window: [], space: [] };
    for (let L = 0; L < 2; L++) {
        const y0 = L * FH;
        parts.slab.push({ p: [BX, y0 + 0.006, BZ], s: [BW, 0.012, BD] });
        const wy = y0 + 0.012 + 0.069;
        parts.wall.push({ p: [BX, wy, zb + 0.006], s: [BW, 0.138, 0.012] });
        parts.wall.push({ p: [x1 + 0.006, wy, BZ], s: [0.012, 0.138, BD] });
        parts.wall.push({ p: [x2 - 0.006, wy, BZ], s: [0.012, 0.138, BD] });
        parts.wall.push({ p: [BX, y0 + 0.022, zf - 0.006], s: [BW, 0.02, 0.012] });
        for (const px of [-0.34, -0.1]) {
            parts.wall.push({ p: [px, wy, BZ - 0.04], s: [0.01, 0.138, BD - 0.08] });
            parts.door.push({ p: [px, y0 + 0.012 + 0.05, zf - 0.12], s: [0.014, 0.1, 0.05], level: L });
        }
        if (L === 0) parts.door.push({ p: [x1 + 0.006, 0.062, BZ + 0.08], s: [0.016, 0.1, 0.05], level: 0 });
        [-0.46, -0.22, 0.02].forEach((wx) => parts.window.push({ p: [wx, y0 + 0.09, zb + 0.004], s: [0.1, 0.06, 0.016], face: 'N', level: L }));
        parts.window.push({ p: [x2 - 0.004, y0 + 0.09, BZ - 0.05], s: [0.016, 0.06, 0.1], face: 'E', level: L });
        [-0.46, -0.22, 0.02].forEach((sx) => parts.space.push({ p: [sx, y0 + 0.012 + 0.065, BZ], s: [0.23, 0.13, BD - 0.02], level: L }));
    }
    const spaceMat = new THREE.MeshBasicMaterial({ color: accent.clone(), transparent: true, opacity: 0.32, depthWrite: false });
    const sets = {
        slab: boxes(parts.slab.length, mats.tiles, root),
        wall: boxes(parts.wall.length, mats.white, root),
        door: boxes(parts.door.length, mats.timber, root),
        window: boxes(parts.window.length, mats.glass, root),
        space: boxes(parts.space.length, spaceMat, root)
    };
    sets.space.userData.noShadow = true;
    // Furniture: a desk and two chairs in every room, a person or two.
    const desks = boxes(6, mats.timber, root);
    const deskLegs = boxes(12, mats.dark, root);
    const chairs = boxes(12, mats.dark, root, softBox(1, 1, 1, 0.15));
    let dk = 0;
    for (let L = 0; L < 2; L++) {
        const y0 = L * FH + 0.012;
        [-0.46, -0.22, 0.02].forEach((sx, r) => {
            const i = L * 3 + r;
            const dz = BZ - 0.08;
            setInst(desks, i, sx, y0 + 0.031, dz, 0.085, 0.005, 0.042);
            for (const s2 of [-1, 1]) setInst(deskLegs, i * 2 + (s2 > 0 ? 1 : 0), sx + s2 * 0.038, y0 + 0.015, dz, 0.004, 0.029, 0.038);
            for (const s2 of [-1, 1]) setInst(chairs, dk++, sx + s2 * 0.022, y0 + 0.012, dz + 0.04, 0.02, 0.024, 0.02, s2 * 0.2);
        });
    }
    flush(desks, deskLegs, chairs);
    const people = new THREE.Group();
    people.position.y = 0.012;
    root.add(people);
    figures(people, [[-0.4, -0.13, 2.4, 0.9], [0.07, -0.2, -1.2, 0.9]], mats.figure);
    figures(root, [[0.2, 0.08, 2.6], [0.26, 0.1, -2.9]], mats.figure);
    groundShadow(root, BX, BZ, BW, BD, 0.4);
    for (const [name, list] of Object.entries(parts)) {
        if (name === 'space') continue;
        list.forEach((e, i) => setInst(sets[name], i, ...e.p, ...e.s));
    }
    const area = parts.space.filter((s) => s.level === 0).reduce((a, s) => a + s.s[0] * 20 * s.s[2] * 20, 0);
    const queries = [
        { text: 'Which doors on Level 2 are fire-rated?', tokens: ['IfcDoor', 'Level 2', 'FireRating'], cls: 'door', match: (e) => e.level === 1, answer: '2 doors on Level 2 carry a fire rating: D-201 and D-202.' },
        { text: 'Show the windows on the north façade.', tokens: ['IfcWindow', 'Orientation = North'], cls: 'window', match: (e) => e.face === 'N', answer: '6 windows found on the north façade.' },
        { text: 'What is the floor area of the Level 1 rooms?', tokens: ['IfcSpace', 'Level 1', 'NetFloorArea'], cls: 'space', match: (e) => e.level === 0, answer: `3 spaces on Level 1: ${area.toFixed(1)} m² net floor area.` }
    ];

    // The terminal.
    const screen = liveCanvas(512, 356);
    const scrMesh = part(new THREE.PlaneGeometry(0.38, 0.264), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }), root, 0.36, 0.24, -0.12);
    scrMesh.rotation.y = -0.22;
    const frame = part(new THREE.BoxGeometry(0.4, 0.284, 0.012), mats.dark, root, 0, 0, 0);
    frame.position.copy(scrMesh.position).add(new THREE.Vector3(Math.sin(-0.22) * -0.008, 0, -Math.cos(-0.22) * 0.008));
    frame.rotation.y = -0.22;
    part(new THREE.BoxGeometry(0.02, 0.1, 0.02), mats.dark, root, 0.36, 0.05, -0.13);
    const anchor = new THREE.Vector3(0.18, 0.3, -0.08);
    const leaders = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: accent.clone().multiplyScalar(1.4), transparent: true, opacity: 0, toneMapped: false }));
    leaders.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 2 * 3), 3));
    leaders.frustumCulled = false;
    root.add(leaders);
    const dimC = new THREE.Color(0.42, 0.42, 0.44);
    const hot = accent.clone().multiplyScalar(1.25);

    function paint(q, u, t) {
        const chars = Math.floor(q.text.length * lin(0.2, 2.4, u));
        const toks = u < 2.6 ? 0 : Math.min(q.tokens.length, 1 + Math.floor((u - 2.6) / 0.4));
        const phase = u < 4 ? 0 : u < 5.2 ? 1 : 2;
        const caret = u < 2.6 && Math.floor(t * 2.5) % 2 === 0;
        const key = `${queries.indexOf(q)}|${chars}|${toks}|${phase}|${caret}`;
        if (screen.key === key) return;
        screen.key = key;
        const { ctx } = screen;
        const W = 512, H = 356;
        ctx.fillStyle = '#0e1114';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = accentHex;
        ctx.fillRect(22, 24, 26, 3);
        ctx.fillStyle = '#9fb0bd';
        ctx.font = `600 16px ${art.SANS}`;
        ctx.fillText('ASK THE BUILDING MODEL', 58, 31);
        roundRect(ctx, 20, 50, W - 40, 82, 12);
        ctx.fillStyle = '#1a2026';
        ctx.fill();
        ctx.fillStyle = '#f2f5f7';
        ctx.font = `500 23px ${art.SANS}`;
        const typed = q.text.slice(0, chars) + (caret ? '▍' : '');
        const cut = typed.length > 34 ? typed.lastIndexOf(' ', 34) + 1 : 0;
        const lines = cut ? [typed.slice(0, cut), typed.slice(cut)] : [typed];
        lines.forEach((l, i) => ctx.fillText(l, 36, 84 + i * 30));
        if (toks) {
            ctx.font = `600 17px ${art.MONO}`;
            let x = 20;
            q.tokens.slice(0, toks).forEach((tk) => {
                const w = ctx.measureText(tk).width + 22;
                roundRect(ctx, x, 150, w, 32, 8);
                ctx.fillStyle = 'rgba(15,155,142,0.22)';
                ctx.fill();
                ctx.strokeStyle = accentHex;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.fillStyle = '#d7f5f1';
                ctx.fillText(tk, x + 11, 172);
                x += w + 8;
            });
        }
        ctx.font = `500 18px ${art.SANS}`;
        if (phase >= 1) {
            ctx.fillStyle = '#9fb0bd';
            ctx.fillText(`Searching ${q.tokens[0]} … ${parts[q.cls].length} candidates`, 22, 218);
        }
        if (phase >= 2) {
            ctx.fillStyle = '#ffffff';
            ctx.font = `600 20px ${art.SANS}`;
            let line = '';
            let y = 258;
            for (const w of q.answer.split(' ')) {
                if (ctx.measureText(line + w).width > W - 50) { ctx.fillText(line, 22, y); y += 28; line = ''; }
                line += `${w} `;
            }
            ctx.fillText(line, 22, y);
        }
        ctx.fillStyle = '#5f6b75';
        ctx.font = `500 13px ${art.SANS}`;
        ctx.fillText('Illustrative query · conceptual simulation', 22, H - 16);
        screen.tex.needsUpdate = true;
    }

    return {
        render(t) {
            const qi = Math.min(Math.floor(t / 9), 2);
            const q = queries[qi];
            const u = t - qi * 9;
            const fade = 1 - sstep(8.3, 9, u);
            const retrieve = lin(4.0, 5.2, u);
            const answer = sstep(5.2, 5.8, u) * fade;
            for (const [name, list] of Object.entries(parts)) {
                const mesh = sets[name];
                list.forEach((e, i) => {
                    const isClass = name === q.cls;
                    const hit = isClass && q.match(e);
                    if (name === 'space') {
                        const show = isClass && ((retrieve > 0 && retrieve < 1) || (hit && answer > 0.02)) && fade > 0.02;
                        const k = show ? 1 : 0;
                        setInst(mesh, i, ...e.p, e.s[0] * k, e.s[1] * k, e.s[2] * k);
                        mesh.setColorAt(i, hit && answer > 0.1 ? hot : WHITE);
                        return;
                    }
                    // Retrieval: candidates of the class flicker in turn; answer: matches glow, the rest step back.
                    const scan = isClass && retrieve > 0 && retrieve < 1 ? 0.5 + 0.5 * Math.sin(u * 14 + i * 1.7) : 0;
                    if (hit && answer > 0) tint(mesh, i, WHITE, hot, answer);
                    else if (scan) tint(mesh, i, WHITE, hot, scan * 0.55);
                    else tint(mesh, i, WHITE, dimC, answer * 0.85);
                });
                flush(mesh);
            }
            const hits = parts[q.cls].filter((e) => q.match(e)).slice(0, 8);
            const arr = leaders.geometry.attributes.position.array;
            arr.fill(0);
            hits.forEach((e, k) => arr.set([anchor.x, anchor.y, anchor.z, e.p[0], e.p[1], e.p[2]], k * 6));
            leaders.geometry.attributes.position.needsUpdate = true;
            leaders.material.opacity = 0.55 * answer;
            leaders.visible = answer > 0.01;
            paint(q, u, t);
        }
    };
}

// ---------------------------------------------------------------------------
// Digital twin: one simulated working day, mirrored and acted on
// ---------------------------------------------------------------------------

export function buildTwin({ root, mats, accent }) {
    const accentHex = `#${accent.getHexString()}`;
    const W = 0.34, H = 0.4, D = 0.24, FH = H / 3;
    const PX = -0.31, TX = 0.31, Z = -0.2;
    part(new THREE.BoxGeometry(0.44, 0.012, 0.34), mats.grass, root, PX, 0.006, Z);
    part(new THREE.BoxGeometry(0.44, 0.012, 0.34), mats.stone, root, TX, 0.006, Z);
    part(new THREE.BoxGeometry(W, H, D), mats.precast, root, PX, 0.012 + H / 2, Z);
    for (const [w, d, x, z] of [[W, 0.008, 0, D / 2 - 0.004], [W, 0.008, 0, -D / 2 + 0.004], [0.008, D, W / 2 - 0.004, 0], [0.008, D, -W / 2 + 0.004, 0]]) {
        part(new THREE.BoxGeometry(w, 0.016, d), mats.precast, root, PX + x, 0.012 + H + 0.008, Z + z);   // parapet
    }
    part(new THREE.BoxGeometry(W * 0.5, 0.006, 0.026), mats.precast, root, PX, 0.012 + 0.036, Z + D / 2 + 0.013);   // entrance canopy
    trees(root, [[-0.5, -0.06, 0.65], [-0.1, -0.06, 0.6]], mats);
    groundShadow(root, PX, Z, W, D, 0.45, 0.0125);
    figures(root, [[-0.25, -0.04, 0.3, 0.9], [-0.37, -0.045, 2.8, 0.9]], mats.figure);
    for (let L = 1; L < 3; L++) part(new THREE.BoxGeometry(W + 0.006, 0.008, D + 0.006), mats.concrete, root, PX, 0.012 + L * FH, Z);
    const winMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const wins = boxes(6, winMat, root, new THREE.PlaneGeometry(1, 1));
    wins.userData.noShadow = true;
    const room = (r) => ({ level: Math.floor(r / 2), side: r % 2 });
    const frames = boxes(6, mats.dark, root);
    const mullions = boxes(12, mats.dark, root);
    for (let r = 0; r < 6; r++) {
        const { level, side } = room(r);
        const wx = PX + (side ? 0.085 : -0.085);
        const wy = 0.012 + level * FH + FH * 0.55;
        setInst(frames, r, wx, wy, Z + D / 2 + 0.001, 0.138, 0.078, 0.002);
        setInst(wins, r, wx, wy, Z + D / 2 + 0.0025, 0.128, 0.068, 1);
        setInst(mullions, r * 2, wx, wy, Z + D / 2 + 0.003, 0.004, 0.068, 0.002);
        setInst(mullions, r * 2 + 1, wx, wy - 0.012, Z + D / 2 + 0.003, 0.128, 0.003, 0.002);
    }
    flush(frames, mullions);
    part(new THREE.BoxGeometry(0.1, 0.04, 0.08), mats.grille, root, PX + 0.06, 0.012 + H + 0.02, Z - 0.03);
    const fan = new THREE.Group();
    fan.position.set(PX + 0.06, 0.012 + H + 0.045, Z - 0.03);
    root.add(fan);
    for (let k = 0; k < 3; k++) part(new THREE.BoxGeometry(0.07, 0.004, 0.014), mats.dark, fan).rotation.y = (k * Math.PI * 2) / 3;
    const edges = [[W, H, D, TX, 0.012 + H / 2, Z]];
    for (let L = 1; L < 3; L++) edges.push([W, 0.0001, D, TX, 0.012 + L * FH, Z]);
    edges.push([0.0001, H, D, TX, 0.012 + H / 2, Z]);
    root.add(new THREE.LineSegments(boxEdges(edges), mats.holoLine));
    const volMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.42, depthWrite: false });
    const vols = boxes(6, volMat, root);
    vols.userData.noShadow = true;
    for (let r = 0; r < 6; r++) {
        const { level, side } = room(r);
        setInst(vols, r, TX + (side ? 0.085 : -0.085), 0.012 + level * FH + FH / 2, Z, 0.15, FH - 0.016, D - 0.02);
    }
    const pkt = boxes(6, accentGlow(accentHex, 1.5), root, new THREE.SphereGeometry(1, 8, 6));
    pkt.userData.noShadow = true;
    const cmd = new THREE.Color('#ffb15c');
    const screen = liveCanvas(640, 290);
    part(new THREE.PlaneGeometry(0.66, 0.299), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }), root, 0, 0.62, -0.47);
    part(new THREE.BoxGeometry(0.68, 0.315, 0.012), mats.dark, root, 0, 0.62, -0.478);
    for (const x of [-0.26, 0.26]) part(new THREE.BoxGeometry(0.016, 0.47, 0.016), mats.dark, root, x, 0.235, -0.48);

    const caps = [6, 4, 5, 10, 4, 3];
    const names = ['1-A', '1-B', '2-A', '2-B', '3-A', '3-B'];
    const work = (t, r) => sstep(2.5 + r * 0.25, 5 + r * 0.25, t) * (1 - sstep(25 - r * 0.2, 28.5 - r * 0.2, t));
    const occ = (t, r) => {
        if (r === 3) return work(t, r) * (0.25 + 0.75 * sstep(13.4, 14.4, t) * (1 - sstep(22, 23.5, t)));
        const lunch = 1 - 0.65 * sstep(12.3, 13, t) * (1 - sstep(14, 14.8, t));
        return work(t, r) * lunch * (0.65 + 0.35 * Math.sin(r * 2.1 + 1) ** 2);
    };
    const boost = (t, r) => (r === 3 ? sstep(19, 20.5, t) * (1 - sstep(26, 27.5, t)) : 0);
    const co2 = (t, r) => 420 + (r === 3 ? 820 : 360) * occ(t - 1.8, r) * (1 - 0.6 * boost(t, r));
    const temp = (t, r) => 20.6 + 1.6 * occ(t - 1.8, r) + 0.3 * Math.sin(t * 0.4 + r);
    const blue = new THREE.Color('#3b82f6');
    const amber = new THREE.Color('#f5b041');
    const redC = new THREE.Color('#ef4444');
    const heat = (v) => {
        const k = clamp((v - 450) / 650, 0, 1);
        return k < 0.5 ? _c.copy(blue).lerp(amber, k * 2) : _c.copy(amber).lerp(redC, (k - 0.5) * 2);
    };
    const dark = new THREE.Color('#2b3742');
    const lit = new THREE.Color(0.98, 0.8, 0.52);
    let fanAngle = 0;

    function paint(t) {
        const tq = Math.round(t * 4);
        if (screen.key === tq) return;
        screen.key = tq;
        const { ctx } = screen;
        const Wc = 640, Hc = 290;
        ctx.fillStyle = '#0f1216';
        ctx.fillRect(0, 0, Wc, Hc);
        const hours = 7 + t * 0.4;
        const hh = String(Math.floor(hours)).padStart(2, '0');
        const mm = String(Math.floor((hours % 1) * 60)).padStart(2, '0');
        ctx.fillStyle = '#e8edf2';
        ctx.font = `700 22px ${art.SANS}`;
        ctx.fillText('DIGITAL TWIN · LIVE', 24, 38);
        ctx.font = `600 30px ${art.MONO}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${hh}:${mm}`, Wc - 24, 42);
        ctx.textAlign = 'left';
        const people = caps.reduce((s, c, r) => s + Math.round(occ(t, r) * c), 0);
        const temps = names.map((_, r) => temp(t, r));
        const co2s = names.map((_, r) => co2(t, r));
        const worst = co2s.indexOf(Math.max(...co2s));
        const lights = names.filter((_, r) => occ(t, r) > 0.06).length;
        const boosting = boost(t, 3) > 0.3;
        const tiles = [
            ['Occupancy', `${people}`, 'people'],
            ['Temperature', (temps.reduce((a, b) => a + b, 0) / 6).toFixed(1), '°C average'],
            ['CO₂ peak', `${Math.round(co2s[worst])}`, `ppm · room ${names[worst]}`],
            ['Lights', `${lights}/6`, 'rooms on']
        ];
        tiles.forEach(([label, value, unit], i) => {
            const x = 24 + i * 150;
            roundRect(ctx, x, 66, 138, 112, 10);
            ctx.fillStyle = '#1a2027';
            ctx.fill();
            ctx.fillStyle = '#93a1ad';
            ctx.font = `600 15px ${art.SANS}`;
            ctx.fillText(label.toUpperCase(), x + 14, 92);
            const alarm = label === 'CO₂ peak' && co2s[worst] > 950;
            ctx.fillStyle = alarm ? '#f87171' : '#f4f6f8';
            ctx.font = `700 36px ${art.SANS}`;
            ctx.fillText(value, x + 14, 138);
            ctx.fillStyle = '#93a1ad';
            ctx.font = `500 14px ${art.SANS}`;
            ctx.fillText(unit, x + 14, 162);
        });
        let status = 'Sensors streaming from 6 rooms';
        let tone = '#7dd3a8';
        if (t >= 6) status = 'Model synchronised · every room mirrored';
        if (co2s[3] > 950 && !boosting) { status = `CO₂ high in meeting room 2-B (${Math.round(co2s[3])} ppm)`; tone = '#f87171'; }
        if (boosting) { status = 'Command sent: ventilation boost in room 2-B'; tone = '#fbbf24'; }
        if (t > 26) { status = 'Evening: rooms empty, systems set back'; tone = '#7dd3a8'; }
        ctx.fillStyle = tone;
        ctx.beginPath(); ctx.arc(34, 214, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8edf2';
        ctx.font = `600 20px ${art.SANS}`;
        ctx.fillText(status, 52, 221, Wc - 80);
        ctx.fillStyle = '#5f6b75';
        ctx.font = `500 14px ${art.SANS}`;
        ctx.fillText(`HVAC ${boosting ? 'boost' : 'normal'} · simulated values · conceptual model`, 24, 266);
        screen.tex.needsUpdate = true;
    }

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const mid = new THREE.Vector3();
    return {
        render(t, dt) {
            for (let r = 0; r < 6; r++) {
                tint(wins, r, dark, lit, sstep(0.03, 0.12, occ(t, r)));
                vols.setColorAt(r, heat(co2(t, r)));
            }
            fanAngle += dt * (4 + 14 * boost(t, 3));
            fan.rotation.y = fanAngle;
            for (let r = 0; r < 6; r++) {
                const { level, side } = room(r);
                a.set(PX + (side ? 0.085 : -0.085), 0.012 + level * FH + FH * 0.55, Z + D / 2 + 0.01);
                b.set(TX + (side ? 0.085 : -0.085), 0.012 + level * FH + FH / 2, Z + D / 2);
                const command = r === 3 && boost(t, 3) > 0.05 && boost(t, 3) < 0.98;
                const u = (t * (command ? 0.9 : 0.55) + r * 0.17) % 1;
                const from = command ? b : a;
                const to = command ? a : b;
                mid.copy(from).lerp(to, 0.5).setY(Math.max(from.y, to.y) + 0.08).setZ(Z + D / 2 + 0.07);
                bezier(from, mid, to, u, _v);
                const sc = 0.009 * Math.sin(Math.PI * u) * (occ(t, r) > 0.03 || command ? 1 : 0.35);
                setInst(pkt, r, _v.x, _v.y, _v.z, sc, sc, sc);
                pkt.setColorAt(r, command ? cmd : WHITE);
            }
            flush(wins, vols, pkt);
            paint(t);
        }
    };
}

// ---------------------------------------------------------------------------
// Interoperability: IFC elements mapped into an engine-ready scene
// ---------------------------------------------------------------------------

const INTEROP_COLORS = { IfcSlab: '#8db0c9', IfcColumn: '#d9a252', IfcWall: '#c6b49c', IfcDoor: '#b07a4a', IfcWindow: '#79c0d8' };
const ENGINE_NAME = {
    IfcSlab: 'Floor · mesh collider · static',
    IfcColumn: 'Column · box collider · static',
    IfcWall: 'Wall · collider · navigation obstacle',
    IfcDoor: 'Door · trigger · openable',
    IfcWindow: 'Window · transparent · static'
};

export function buildInterop({ root, mats, accent }) {
    const accentHex = `#${accent.getHexString()}`;
    const LC = new THREE.Vector3(-0.38, 0, -0.14);
    const RC = new THREE.Vector3(0.38, 0, -0.14);
    const els = [];
    const e = (cls, s, p) => els.push({ cls, s, p: new THREE.Vector3(...p) });
    e('IfcSlab', [0.3, 0.012, 0.22], [0, 0.006, 0]);
    for (const [x, z] of [[-0.12, -0.08], [0.12, -0.08], [-0.12, 0.08], [0.12, 0.08]]) e('IfcColumn', [0.02, 0.12, 0.02], [x, 0.072, z]);
    e('IfcWall', [0.26, 0.11, 0.01], [0, 0.067, -0.1]);
    e('IfcDoor', [0.05, 0.08, 0.012], [0.05, 0.052, 0.098]);
    e('IfcSlab', [0.3, 0.012, 0.22], [0, 0.138, 0]);
    for (const [x, z] of [[-0.12, -0.08], [0.12, -0.08], [-0.12, 0.08], [0.12, 0.08]]) e('IfcColumn', [0.02, 0.12, 0.02], [x, 0.204, z]);
    e('IfcWall', [0.26, 0.11, 0.01], [0, 0.199, -0.1]);
    e('IfcWindow', [0.08, 0.05, 0.016], [0, 0.21, -0.093]);
    e('IfcSlab', [0.3, 0.012, 0.22], [0, 0.27, 0]);
    const N = els.length;
    const base = els.map((x) => new THREE.Color(INTEROP_COLORS[x.cls]));
    const src = boxes(N, mats.plain, root);
    const dst = boxes(N, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.05 }), root);
    const wireMat = new THREE.MeshBasicMaterial({ color: accent.clone().lerp(WHITE, 0.55), wireframe: true, transparent: true, opacity: 0.5, toneMapped: false });
    const wire = boxes(N, wireMat, root, new THREE.BoxGeometry(1, 1, 1, 2, 2, 2));
    wire.userData.noShadow = true;
    for (let i = 0; i < N; i++) { src.setColorAt(i, base[i]); dst.setColorAt(i, base[i]); }

    // The mapping gate.
    const G = new THREE.Vector3(0, 0.3, -0.14);
    const gateMat = new THREE.MeshStandardMaterial({ color: '#30343a', roughness: 0.4, metalness: 0.6 });
    for (const [w, h, d, y, z] of [[0.02, 0.34, 0.02, 0, -0.17], [0.02, 0.34, 0.02, 0, 0.17], [0.02, 0.02, 0.36, 0.17, 0], [0.02, 0.02, 0.36, -0.17, 0]]) {
        part(new THREE.BoxGeometry(w, h, d), gateMat, root, G.x, G.y + y, G.z + z);
    }
    part(new THREE.BoxGeometry(0.03, G.y - 0.17, 0.03), gateMat, root, 0, (G.y - 0.17) / 2, G.z - 0.17);
    const veilMat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(1.1), transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const veil = part(new THREE.PlaneGeometry(0.32, 0.32), veilMat, root, G.x, G.y, G.z);
    veil.rotation.y = Math.PI / 2;
    veil.userData.noShadow = true;
    const caption = liveCanvas(640, 120);
    const capSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: caption.tex, transparent: true, depthWrite: false, toneMapped: false }));
    capSprite.scale.set(0.5, 0.094, 1);
    capSprite.position.set(0, 0.58, -0.14);
    root.add(capSprite);
    // Engine-side extras: a navigation mesh and collider outlines.
    const navGeo = new THREE.PlaneGeometry(0.28, 0.2, 6, 4);
    const navMat = new THREE.MeshBasicMaterial({ color: '#34d399', transparent: true, opacity: 0, depthWrite: false });
    const nav = part(navGeo, navMat, root, RC.x, 0.0135, RC.z);
    nav.rotation.x = -Math.PI / 2;
    const navWireMat = new THREE.MeshBasicMaterial({ color: '#a7f3d0', wireframe: true, transparent: true, opacity: 0, toneMapped: false });
    const navWire = part(navGeo, navWireMat, root, RC.x, 0.0145, RC.z);
    navWire.rotation.x = -Math.PI / 2;
    nav.userData.noShadow = navWire.userData.noShadow = true;
    const colliderMat = new THREE.LineBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0, toneMapped: false });
    const colliders = new THREE.LineSegments(boxEdges(els.filter((x) => x.cls === 'IfcWall' || x.cls === 'IfcColumn').map((x) => [x.s[0] + 0.012, x.s[1] + 0.01, x.s[2] + 0.012, RC.x + x.p.x, x.p.y, RC.z + x.p.z])), colliderMat);
    root.add(colliders);
    const bot = part(new THREE.SphereGeometry(0.012, 12, 8), accentGlow('#34d399', 1.3), root);
    const tag = (title, sub, x, y, z, w = 0.2) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cardSign(title, sub, accentHex), transparent: true, depthWrite: false, toneMapped: false }));
        s.scale.set(w, w / 4.06, 1);
        s.position.set(x, y, z);
        root.add(s);
        return s;
    };
    const classTags = [
        tag('IfcSlab', 'Pset_SlabCommon', LC.x - 0.2, 0.33, LC.z + 0.1),
        tag('IfcColumn', 'Pset_ColumnCommon', LC.x + 0.19, 0.2, LC.z + 0.13),
        tag('IfcWall', 'Pset_WallCommon', LC.x - 0.19, 0.12, LC.z - 0.05)
    ];
    const check = tag(`Semantics preserved · ${N} of ${N}`, 'Class · GlobalId · Psets · storey', RC.x, 0.43, RC.z + 0.05, 0.36);

    const T0 = 3, GAP = 0.55, DUR = 1.5;
    const C = new THREE.Vector3(0, 0.5, -0.14);
    const hot = accent.clone().multiplyScalar(1.3);
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();

    function paintCaption(t) {
        let current = -1;
        for (let i = 0; i < N; i++) {
            const u = (t - (T0 + i * GAP)) / DUR;
            if (u > 0.3 && u < 0.75) current = i;
        }
        let title;
        let sub;
        if (current >= 0) {
            const x = els[current];
            title = `${x.cls}  →  ${ENGINE_NAME[x.cls]}`;
            sub = 'Tessellated; GlobalId and properties carried across';
        } else if (t < T0) { title = `IFC model · ${N} typed entities`; sub = 'Classes, properties, storeys and relations'; }
        else if (t < 12) { title = 'Mapping…'; sub = 'Geometry to triangles, semantics alongside'; }
        else if (t < 17) { title = 'Engine-ready scene'; sub = 'Colliders and a walkable navigation mesh generated'; }
        else { title = 'Round-trip check'; sub = 'Each element verified on both sides'; }
        if (caption.key === title) return;
        caption.key = title;
        const { ctx } = caption;
        ctx.clearRect(0, 0, 640, 120);
        roundRect(ctx, 2, 2, 636, 116, 14);
        ctx.fillStyle = 'rgba(16,18,22,0.88)';
        ctx.fill();
        ctx.fillStyle = accentHex;
        ctx.fillRect(18, 22, 6, 76);
        ctx.fillStyle = '#f4f1ea';
        ctx.font = `600 30px ${art.SANS}`;
        ctx.fillText(title, 40, 52, 580);
        ctx.fillStyle = '#b9c2cc';
        ctx.font = `400 22px ${art.SANS}`;
        ctx.fillText(sub, 40, 90, 580);
        caption.tex.needsUpdate = true;
    }

    return {
        render(t) {
            const rise = 1 - easeOut(lin(23.6, 25.6, t));
            let pass = 0;
            els.forEach((x, i) => {
                const t0 = T0 + i * GAP;
                const u = minJerk(lin(t0, t0 + DUR, t));
                if (t >= t0 && t < t0 + DUR) pass = Math.max(pass, Math.exp(-((((t - t0) / DUR - 0.5) / 0.12) ** 2)));
                A.copy(LC).add(x.p);
                B.copy(RC).add(x.p);
                if (t >= 23.6) setInst(src, i, A.x, A.y - rise * 0.32, A.z, ...x.s);
                else if (u < 0.5) {
                    bezier(A, C, B, u, _v);
                    setInst(src, i, _v.x, _v.y, _v.z, ...x.s);
                } else setInst(src, i, 0, 0, 0, 0, 0, 0);
                const gone = sstep(22 + (N - 1 - i) * 0.1, 22.5 + (N - 1 - i) * 0.1, t);
                if (u >= 0.5 && gone < 0.999 && t < 23.6) {
                    bezier(A, C, B, u, _v);
                    const k = 1 - gone;
                    setInst(dst, i, _v.x, _v.y, _v.z, x.s[0] * k, x.s[1] * k, x.s[2] * k);
                    setInst(wire, i, _v.x, _v.y, _v.z, x.s[0] * k * 1.004, x.s[1] * k * 1.004, x.s[2] * k * 1.004);
                } else {
                    setInst(dst, i, 0, 0, 0, 0, 0, 0);
                    setInst(wire, i, 0, 0, 0, 0, 0, 0);
                }
                const wave = Math.exp(-(((t - (17.4 + i * 0.25)) / 0.2) ** 2));
                tint(src, i, base[i], hot, wave);
                tint(dst, i, base[i], hot, wave);
            });
            flush(src, dst, wire);
            veilMat.opacity = 0.05 + 0.3 * pass;
            const extras = sstep(12, 13.5, t) * (1 - sstep(21.5, 22.5, t));
            navMat.opacity = 0.28 * extras;
            navWireMat.opacity = 0.55 * extras;
            colliderMat.opacity = 0.75 * extras;
            nav.visible = navWire.visible = colliders.visible = extras > 0.01;
            bot.visible = extras > 0.3;
            const ang = t * 1.3;
            bot.position.set(RC.x + Math.cos(ang) * 0.08, 0.026, RC.z + 0.02 + Math.sin(ang) * 0.05);
            const tagsOn = clamp(1 - sstep(3, 3.8, t) + sstep(24.5, 25.5, t), 0, 1);
            classTags.forEach((s) => { s.material.opacity = tagsOn; s.visible = tagsOn > 0.01; });
            const ok = sstep(18, 18.8, t) * (1 - sstep(21.6, 22.2, t));
            check.material.opacity = ok;
            check.visible = ok > 0.01;
            paintCaption(t);
        }
    };
}

// ---------------------------------------------------------------------------
// Robot navigation: occupancy grid, A*, a blocked doorway and a replan
// ---------------------------------------------------------------------------

const NAV_MAP = [
    '########################',
    '#......................#',
    '#......................#',
    '#.........##...........#',
    '#.........##...........#',
    '#.........##...........#',
    '#..##########..#########',
    '#......................#',
    '#......................#',
    '#####..########..#######',
    '#.........##...........#',
    '#.........##...........#',
    '#.........##...........#',
    '#.........##...........#',
    '#.........##...........#',
    '########################'
];

export function buildNav({ root, mats, accent, inst }) {
    const accentHex = `#${accent.getHexString()}`;
    const CELL = 0.045;
    const COLS = NAV_MAP[0].length;
    const ROWS = NAV_MAP.length;
    const X0 = -(COLS * CELL) / 2;
    const Z0 = -0.5;
    const cx = (c) => X0 + (c + 0.5) * CELL;
    const cz = (r) => Z0 + (r + 0.5) * CELL;
    const wall = (c, r) => r < 0 || c < 0 || r >= ROWS || c >= COLS || NAV_MAP[r][c] === '#';
    const START = { c: 4, r: 12 };
    const GOAL = { c: 18, r: 4 };

    const planCanvas = art.makeCanvas(COLS * 40, ROWS * 40, 1);
    {
        const ctx = planCanvas.getContext('2d');
        ctx.fillStyle = '#c9c4ba';
        ctx.fillRect(0, 0, planCanvas.width, planCanvas.height);
        ctx.strokeStyle = 'rgba(40,60,80,0.12)';
        ctx.lineWidth = 1;
        for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * 40, 0); ctx.lineTo(c * 40, ROWS * 40); ctx.stroke(); }
        for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * 40); ctx.lineTo(COLS * 40, r * 40); ctx.stroke(); }
        ctx.fillStyle = 'rgba(40,50,60,0.55)';
        ctx.font = `600 26px ${art.SANS}`;
        ctx.textAlign = 'center';
        for (const [label, c, r] of [['OFFICE', 5.5, 2.4], ['LAB', 17, 2.4], ['CORRIDOR', 9, 8.2], ['STORE', 5.5, 14.4], ['WORKSHOP', 17, 14.4]]) ctx.fillText(label, c * 40, r * 40);
    }
    const ptex = new THREE.CanvasTexture(planCanvas);
    ptex.colorSpace = THREE.SRGBColorSpace;
    ptex.anisotropy = 4;
    const planMat = new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.92, envMapIntensity: 0.4 });
    part(new THREE.BoxGeometry(COLS * CELL, 0.012, ROWS * CELL), [mats.stone, mats.stone, planMat, mats.stone, mats.stone, mats.stone], root, 0, 0.006, Z0 + (ROWS * CELL) / 2);
    const wallCells = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (wall(c, r)) wallCells.push({ c, r });
    const walls = boxes(wallCells.length, mats.white, root);
    const WALL_H = 0.06;

    const goalMat = accentGlow(accentHex, 1.3, 0.9);
    const goal = part(new THREE.RingGeometry(0.026, 0.036, 32), goalMat, root, cx(GOAL.c), 0.0135, cz(GOAL.r));
    goal.rotation.x = -Math.PI / 2;
    const startMark = part(new THREE.PlaneGeometry(0.03, 0.03), new THREE.MeshBasicMaterial({ color: '#9aa3ab' }), root, cx(START.c), 0.013, cz(START.r));
    startMark.rotation.x = -Math.PI / 2;

    const MAXE = 420;
    const expMat = new THREE.MeshBasicMaterial({ color: accent.clone(), transparent: true, opacity: 0.22, depthWrite: false });
    const explored = new THREE.InstancedMesh(new THREE.PlaneGeometry(CELL * 0.82, CELL * 0.82).rotateX(-Math.PI / 2), expMat, MAXE);
    explored.count = 0;
    explored.frustumCulled = false;
    explored.userData.noShadow = true;
    root.add(explored);
    const routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: accent.clone().multiplyScalar(1.5), toneMapped: false }));
    routeLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(600 * 3), 3));
    routeLine.frustumCulled = false;
    root.add(routeLine);
    const oldLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0, toneMapped: false }));
    oldLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(600 * 3), 3));
    oldLine.frustumCulled = false;
    root.add(oldLine);

    const robot = new THREE.Group();
    root.add(robot);
    part(new THREE.CylinderGeometry(0.021, 0.023, 0.022, 28), mats.paint, robot, 0, 0.016, 0);                 // shell
    part(new THREE.TorusGeometry(0.0232, 0.0022, 6, 28), mats.rubber, robot, 0, 0.009, 0).rotation.x = Math.PI / 2; // bumper
    part(new THREE.CylinderGeometry(0.0085, 0.0095, 0.006, 16), mats.dark, robot, 0, 0.03, -0.004);                // lidar base
    part(new THREE.CylinderGeometry(0.0075, 0.0075, 0.007, 16), mats.glass, robot, 0, 0.0365, -0.004);            // lidar window
    part(new THREE.BoxGeometry(0.012, 0.004, 0.003), accentGlow(accentHex, 1.3), robot, 0, 0.02, 0.022);            // status light
    const navWheel = new THREE.CylinderGeometry(0.0065, 0.0065, 0.004, 14);
    navWheel.rotateZ(Math.PI / 2);
    for (const s2 of [-1, 1]) part(navWheel, mats.rubber, robot, s2 * 0.021, 0.0065, 0);
    const fanMat = new THREE.MeshBasicMaterial({ color: accent.clone(), transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    // A sector ahead of the robot (its +z), flat on the floor.
    const fanGeo = new THREE.CircleGeometry(0.17, 24, Math.PI / 2 - 1.1, 2.2);
    fanGeo.rotateX(Math.PI / 2);
    const fan = part(fanGeo, fanMat, robot, 0, 0.003, 0);
    fan.userData.noShadow = true;
    const red = new THREE.Color('#ef4444');
    const person = new THREE.Group();
    root.add(person);
    figures(person, [[0, 0, 0, 0.82]], mats.warm);

    const nearWall = (c, r) => {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (wall(c + dc, r + dr)) return true;
        return false;
    };
    function astar(from, to, blocked) {
        const key = (c, r) => r * COLS + c;
        const g = new Map([[key(from.c, from.r), 0]]);
        const came = new Map();
        const open = [{ c: from.c, r: from.r, f: 0 }];
        const closed = new Set();
        const order = [];
        const h = (c, r) => { const dx = Math.abs(c - to.c); const dz = Math.abs(r - to.r); return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz); };
        while (open.length) {
            let bi = 0;
            for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
            const cur = open.splice(bi, 1)[0];
            const k = key(cur.c, cur.r);
            if (closed.has(k)) continue;
            closed.add(k);
            order.push(cur);
            if (cur.c === to.c && cur.r === to.r) break;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (!dc && !dr) continue;
                    const c = cur.c + dc;
                    const r = cur.r + dr;
                    if (wall(c, r) || blocked.has(key(c, r))) continue;
                    if (dc && dr && (wall(cur.c + dc, cur.r) || wall(cur.c, cur.r + dr))) continue;
                    const cost = g.get(k) + (dc && dr ? Math.SQRT2 : 1) + (nearWall(c, r) ? 0.8 : 0);
                    const nk = key(c, r);
                    if (cost < (g.get(nk) ?? Infinity)) {
                        g.set(nk, cost);
                        came.set(nk, k);
                        open.push({ c, r, f: cost + h(c, r) });
                    }
                }
            }
        }
        const cells = [];
        const startKey = key(from.c, from.r);
        for (let k = key(to.c, to.r); k !== undefined; k = came.get(k)) {
            cells.push({ c: k % COLS, r: Math.floor(k / COLS) });
            if (k === startKey) break;
        }
        cells.reverse();
        return { cells, order };
    }
    const free = (x, z, blocked) => {
        const c = Math.floor((x - X0) / CELL);
        const r = Math.floor((z - Z0) / CELL);
        return !wall(c, r) && !blocked.has(r * COLS + c);
    };
    function smoothRoute(cells, start, blocked) {
        const pts = cells.map((p) => new THREE.Vector3(cx(p.c), 0, cz(p.r)));
        if (start) pts[0] = start.clone();
        const clear = (a, b) => {
            const n = Math.ceil(a.distanceTo(b) / (CELL * 0.25));
            for (let i = 0; i <= n; i++) {
                const x = mix(a.x, b.x, i / n);
                const z = mix(a.z, b.z, i / n);
                for (const [ox, oz] of [[0, 0], [0.018, 0], [-0.018, 0], [0, 0.018], [0, -0.018]]) if (!free(x + ox, z + oz, blocked)) return false;
            }
            return true;
        };
        const out = [pts[0]];
        let i = 0;
        while (i < pts.length - 1) {
            let j = pts.length - 1;
            while (j > i + 1 && !clear(pts[i], pts[j])) j--;
            out.push(pts[j]);
            i = j;
        }
        const dense = [out[0]];
        for (let k = 1; k < out.length; k++) {
            const n = Math.max(1, Math.ceil(out[k].distanceTo(out[k - 1]) / 0.01));
            for (let s = 1; s <= n; s++) dense.push(out[k - 1].clone().lerp(out[k], s / n));
        }
        return dense;
    }

    const DOOR = new THREE.Vector3(cx(13.5), 0, cz(6));
    const PERSON_HOME = new THREE.Vector3(cx(15), 0, cz(3.5));
    let S;
    function reset() {
        S = {
            time: 0, x: cx(START.c), z: cz(START.r), heading: Math.PI, v: 0, s: 0,
            route: null, len: 0, mode: 'wait', modeAt: 0, order: [], orderAt: 0, drawAt: 0,
            blocked: new Set(), old: null, oldAt: -10, person: PERSON_HOME.clone(), personMode: 'home', personAt: 0,
            detectAt: null, arriveAt: null
        };
    }
    function setRoute(cells, at) {
        S.route = smoothRoute(cells, new THREE.Vector3(S.x, 0, S.z), S.blocked);
        S.len = 0;
        for (let k = 1; k < S.route.length; k++) S.len += S.route[k].distanceTo(S.route[k - 1]);
        S.s = 0;
        S.drawAt = at;
    }
    const routePoint = (s) => {
        const R = S.route;
        let acc = 0;
        for (let k = 1; k < R.length; k++) {
            const d = R[k].distanceTo(R[k - 1]);
            if (acc + d >= s) return R[k - 1].clone().lerp(R[k], (s - acc) / (d || 1));
            acc += d;
        }
        return R[R.length - 1].clone();
    };
    function plan(at) {
        const from = { c: Math.floor((S.x - X0) / CELL), r: Math.floor((S.z - Z0) / CELL) };
        const res = astar(from, GOAL, S.blocked);
        S.order = res.order.slice(0, MAXE);
        S.orderAt = at;
        setRoute(res.cells, at + Math.min(1.4, 0.3 + S.order.length * 0.006));
    }
    const here = new THREE.Vector3();
    function step(h) {
        const T = S.time;
        if (S.mode === 'wait' && T >= 2.5) { plan(2.5); S.mode = 'drive'; S.modeAt = T; }
        here.set(S.x, 0, S.z);
        if (S.personMode === 'home' && S.mode === 'drive' && !S.old && here.distanceTo(DOOR) < 0.36) { S.personMode = 'walking'; S.personAt = T; }
        if (S.personMode === 'walking') {
            const u = minJerk((T - S.personAt) / 1.1);
            S.person.copy(PERSON_HOME).lerp(DOOR, u);
            if (u >= 1) S.personMode = 'standing';
        }
        if (S.mode === 'drive' && T >= S.drawAt) {
            const left = S.len - S.s;
            const want = Math.min(0.13, Math.sqrt(2 * 0.2 * Math.max(0, left)));
            S.v += clamp(want - S.v, -0.6 * h, 0.22 * h);
            const ahead = new THREE.Vector3(Math.sin(S.heading), 0, Math.cos(S.heading));
            const to = S.person.clone().sub(here);
            if (S.personMode !== 'home' && to.length() < 0.16 && to.normalize().dot(ahead) > 0.4) {
                S.mode = 'stop'; S.modeAt = T; S.detectAt = S.detectAt ?? T;
            }
            S.s = Math.min(S.len, S.s + S.v * h);
            const p = routePoint(S.s);
            S.x = p.x; S.z = p.z;
            const look = routePoint(S.s + 0.05);
            if (look.distanceTo(p) > 1e-4) S.heading += clamp(turn(S.heading, Math.atan2(look.x - p.x, look.z - p.z)), -3 * h, 3 * h);
            if (S.len - S.s < 0.002 && S.v < 0.02) { S.mode = 'arrived'; S.arriveAt = T; }
        } else if (S.mode === 'drive') {
            // Turn on the spot to face the start of the route while it is drawn.
            if (S.route && S.route.length > 2) {
                const p = S.route[Math.min(5, S.route.length - 1)];
                S.heading += clamp(turn(S.heading, Math.atan2(p.x - S.x, p.z - S.z)), -2.5 * h, 2.5 * h);
            }
        } else if (S.mode === 'stop') {
            S.v = Math.max(0, S.v - 0.9 * h);
            if (T - S.modeAt > 0.9) {
                const pc = Math.floor((S.person.x - X0) / CELL);
                const pr = Math.floor((S.person.z - Z0) / CELL);
                for (let dr = -1; dr <= 1; dr++) for (let dc = -2; dc <= 2; dc++) S.blocked.add((pr + dr) * COLS + pc + dc);
                S.old = { route: S.route, s: S.s };
                S.oldAt = T;
                S.v = 0;
                plan(T);
                S.mode = 'drive';
            }
        }
        S.time += h;
    }
    // Run the scenario once to learn when things happen; the stages follow it.
    reset();
    while (S.time < 60 && S.mode !== 'arrived') step(1 / 60);
    const detectAt = S.detectAt ?? 9;
    const arriveAt = S.arriveAt ?? 20;
    inst.def.stages[2].at = Math.min(4.6, detectAt - 1);
    inst.def.stages[3].at = Math.max(5, detectAt - 0.3);
    inst.def.stages[4].at = arriveAt;
    inst.def.duration = arriveAt + 3.6;
    const DURATION = inst.def.duration;
    reset();

    function writeLine(line, pts, from = 0) {
        const arr = line.geometry.attributes.position.array;
        const n = Math.max(0, Math.min(600, pts.length - from));
        for (let k = 0; k < n; k++) { const p = pts[from + k]; arr[k * 3] = p.x; arr[k * 3 + 1] = 0.016; arr[k * 3 + 2] = p.z; }
        line.geometry.attributes.position.needsUpdate = true;
        return n;
    }
    let shownRoute = null;
    let shownOld = null;
    let hum = 0;

    return {
        render(t) {
            if (t < S.time - 1e-6) { reset(); shownRoute = shownOld = null; }
            while (S.time + 1 / 60 <= t) step(1 / 60);
            const sink = sstep(DURATION - 1.3, DURATION - 0.3, t);
            wallCells.forEach((w, i) => {
                const k = easeOut(lin(0.2 + w.c * 0.06, 0.9 + w.c * 0.06, t)) * (1 - sink);
                const hgt = WALL_H * k;
                setInst(walls, i, cx(w.c), 0.012 + hgt / 2, cz(w.r), CELL, hgt, CELL);
            });
            flush(walls);
            const reveal = S.order.length ? clamp((t - S.orderAt) / Math.max(0.3, S.drawAt - S.orderAt - 0.2), 0, 1) : 0;
            const count = Math.floor(S.order.length * reveal);
            if (explored.count !== count || explored.userData.stamp !== S.orderAt) {
                S.order.slice(0, count).forEach((o, i) => setInst(explored, i, cx(o.c), 0.0128, cz(o.r)));
                explored.count = count;
                explored.userData.stamp = S.orderAt;
                explored.instanceMatrix.needsUpdate = true;
            }
            expMat.opacity = 0.22 * (1 - sstep(S.drawAt + 0.2, S.drawAt + 1.4, t)) * (1 - sink);
            explored.visible = expMat.opacity > 0.01 && count > 0;
            if (S.route) {
                if (shownRoute !== S.route) { routeLine.userData.n = writeLine(routeLine, S.route); shownRoute = S.route; }
                const draw = lin(S.drawAt - 0.5, S.drawAt, t);
                routeLine.geometry.setDrawRange(0, Math.max(0, Math.floor(routeLine.userData.n * draw)));
                routeLine.visible = draw > 0 && sink < 0.9;
            } else routeLine.visible = false;
            if (S.old) {
                if (shownOld !== S.old) { oldLine.geometry.setDrawRange(0, writeLine(oldLine, S.old.route, Math.floor(S.old.s / 0.01))); shownOld = S.old; }
                oldLine.material.opacity = 0.85 * (1 - sstep(S.oldAt + 1.5, S.oldAt + 3.5, t));
                oldLine.visible = oldLine.material.opacity > 0.01;
            } else oldLine.visible = false;
            robot.position.set(S.x, 0.012, S.z);
            robot.rotation.y = S.heading;
            const sc = Math.min(easeOut(lin(0, 0.6, t)), 1 - sink);
            robot.scale.setScalar(Math.max(0.001, sc));
            const alarm = S.mode === 'stop' || (S.detectAt !== null && t - S.detectAt < 1.2);
            fanMat.color.copy(alarm ? red : accent);
            fanMat.opacity = (alarm ? 0.32 + 0.1 * Math.sin(t * 18) : 0.12) * (S.mode === 'arrived' ? 0.3 : 1) * sc;
            person.position.copy(S.person).setY(0.012);
            person.visible = sink < 0.8;
            const arrived = S.mode === 'arrived' ? t - S.arriveAt : -1;
            goal.scale.setScalar(arrived >= 0 ? 1 + 0.6 * Math.sin(Math.min(arrived, 1.2) * Math.PI / 1.2) : 1);
            goalMat.opacity = 0.9 * (1 - sink);
            hum = clamp(S.v / 0.13, 0, 1) * 0.5;
        },
        reset() { reset(); shownRoute = shownOld = null; },
        hum: () => hum
    };
}
