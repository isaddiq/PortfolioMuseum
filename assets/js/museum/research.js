// Research demonstrations: animated, interactive miniatures of the methods
// behind the portfolio. Each installation stands on a plinth with a reading
// label that names its stages; the model runs through a beginning, a process
// and an outcome, then loops. Clicking it opens a panel to replay it, pause
// it, or step through the stages; in the BIM model, every element can be
// selected for its properties.
//
// These are conceptual simulations: they illustrate how the methods work and
// never show measured or experimental results. Every label and panel says so.
//
// Geometry is procedural and light (boxes, a few cylinders, instancing for
// anything repeated). An installation only animates while the visitor is near
// and it is on screen; off screen its clock still runs, so it never jumps.

import * as THREE from 'three';
import * as art from './art.js';
import { ROOM_BY_ID, galleryPoint } from './world.js';
import { clamp, seededRandom, wrapText, clampLines } from './util.js';
import { roundRect } from './demo-kit.js';
import { surfaceMaterial as surf } from './surfaces.js';
import { DEMOS } from './research-defs.js';

const PLINTH_H = 0.9;
const PLINTH_W = 1.5;
const PLINTH_D = 1.35;
const LABEL_TILT = 0.42;           // radians up from horizontal, towards the visitor
const MODEL_SCALE = 1.18;
const BOARD = 0.014;               // base board under each model          // models on the plinths are a little larger than built
const ACTIVE_RADIUS = 14;

/** Shared materials for every model, made once. */
function makeMaterials(museum) {
    const holo = new THREE.Color(0.35, 1.25, 1.65);
    // Models are about 1:16, so textures are scaled to read at that size:
    // a formwork panel, a brick course, a façade bay each come out right.
    return {
        concrete: surf('concrete', { scale: 13, roughness: 0.9 }),
        precast: surf('precast', { scale: 16, roughness: 0.82 }),
        white: surf('plaster', { scale: 18, roughness: 0.78 }),
        model: surf('foam', { scale: 6, roughness: 0.7, bump: 0.6 }),
        steel: surf('steel', { scale: 10, roughness: 0.36, metalness: 0.75 }),
        dark: surf('steel', { color: '#4a4e55', scale: 10, roughness: 0.48, metalness: 0.5 }),
        paint: surf('paintWhite', { scale: 8, roughness: 0.38, metalness: 0.1, bump: 0.5 }),
        yellow: surf('paintYellow', { scale: 12, roughness: 0.5, metalness: 0.08 }),
        lattice: surf('lattice', { scale: 32, roughness: 0.55, metalness: 0.25, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, bump: 0.3 }),
        timber: surf('timber', { scale: 12, roughness: 0.68 }),
        site: surf('soil', { scale: 6, roughness: 0.97, bump: 1.4 }),
        grass: surf('grass', { scale: 9, roughness: 0.95, bump: 1.2 }),
        road: surf('asphalt', { scale: 10, roughness: 0.92, bump: 1.2 }),
        tiles: surf('tiles', { scale: 22, roughness: 0.55 }),
        brick: surf('clay', { scale: 28, roughness: 0.88, bump: 1.4 }),
        brickwall: surf('brick', { scale: 9.3, roughness: 0.88, bump: 1.6 }),
        mdf: surf('mdf', { scale: 4, roughness: 0.85, bump: 0.6 }),
        rubber: surf('rubber', { scale: 20, roughness: 0.9 }),
        warm: surf('paintWhite', { color: '#e48b3c', scale: 8, roughness: 0.42, metalness: 0.15 }),
        grille: surf('grille', { scale: 40, roughness: 0.5, metalness: 0.6 }),
        curtain: surf('curtain', { physical: true, scale: [2.7, 2.6, 2.7], offset: [0, -0.055, 0], roughness: 0.08, metalness: 0.1, transparent: true, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.8, bump: 0 }),
        glass: new THREE.MeshPhysicalMaterial({ color: '#90aebb', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2 }),
        plain: surf('precast', { scale: 16, roughness: 0.7 }),
        figure: new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.7 }),
        leaf: surf('grass', { scale: 70, roughness: 0.92, bump: 2.2 }),
        bark: surf('timber', { color: '#7a6450', scale: 60, roughness: 0.9 }),
        holo,
        holoLine: new THREE.LineBasicMaterial({ color: holo.clone().multiplyScalar(0.9), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        holoFill: new THREE.MeshBasicMaterial({ color: holo.clone().multiplyScalar(0.35), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
        plinth: museum.plinthMat,
        stone: museum.darkStone
    };
}

// ---------------------------------------------------------------------------
// One installation: plinth, label, model and its clock
// ---------------------------------------------------------------------------

class Installation {
    constructor(research, def, place) {
        this.research = research;
        this.museum = research.museum;
        this.def = def;
        this.key = def.key;
        this.room = place.room;
        this.calm = this.museum.calm;
        this.t = this.calm ? def.rest : 0;
        this.playing = !this.calm;
        this.stage = -1;
        this.dirty = true;
        this.events = [];
        this.selected = -1;
        this.accent = new THREE.Color(def.accent);

        const group = new THREE.Group();
        group.position.set(place.x, 0, place.z);
        group.rotation.y = place.rotY;
        this.museum.group.add(group);
        this.group = group;

        const meshes = place.round ? this.roundBase(group, place) : this.rectBase(group);
        this.root = new THREE.Group();
        this.root.position.y = place.round ? place.topY : PLINTH_H + BOARD;
        if (!place.round) {
            // The model's base board: MDF, with a bevelled dark edge, as model makers mount them.
            const board = new THREE.Mesh(new THREE.BoxGeometry(PLINTH_W - 0.08, BOARD, PLINTH_D - 0.42), research.mats.mdf);
            board.position.set(0, PLINTH_H + BOARD / 2, -0.17);
            board.receiveShadow = true;
            group.add(board);
        }
        // Rectangular plinths: scale the model up and set it back from the label.
        this.scale = place.round ? 1 : MODEL_SCALE;
        this.root.scale.setScalar(this.scale);
        if (!place.round) this.root.position.z = -0.035;
        group.add(this.root);
        group.updateMatrixWorld(true);
        this.worldY0 = this.root.getWorldPosition(new THREE.Vector3()).y;

        const ctx = { root: this.root, mats: research.mats, accent: this.accent, inst: this, museum: this.museum, rand: seededRandom(def.key.length * 977 + 13) };
        this.model = def.build(ctx);

        // An invisible box around the model: an easy click target that never
        // hides the elements inside it from a closer look.
        const size = def.bounds || [1.3, 0.95, 0.85];
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), new THREE.MeshBasicMaterial({ visible: false }));
        proxy.position.set(0, size[1] / 2, def.boundsZ ?? -0.13);
        proxy.userData.proxy = true;
        proxy.userData.noShadow = true;
        this.root.add(proxy);
        group.updateMatrixWorld(true);
        this.centre = proxy.getWorldPosition(new THREE.Vector3());
        this.sphere = new THREE.Sphere(this.centre.clone(), Math.hypot(...size) / 2 + 0.2);

        const normal = new THREE.Vector3(Math.sin(place.rotY), 0, Math.cos(place.rotY));
        this.exhibit = this.museum.register({
            id: `demo-${def.key}`, room: place.room, kind: 'demo', title: def.title,
            subtitle: `Research demonstration · ${def.short}`, payload: this, icon: def.icon
        }, [...meshes, proxy, this.root], { x: this.centre.x, y: this.centre.y, z: this.centre.z }, normal, 1.6, place.viewDistance ?? 2.3);
        // Look down into the model from just over the label, as one leans over a plinth.
        this.exhibit.view.pitch = clamp(Math.atan2(this.centre.y - 1.65, place.viewDistance ?? 2.3) - 0.07, -0.5, 0.05);

        this.museum.animators.push({
            x: this.centre.x, z: this.centre.z, radius: ACTIVE_RADIUS,
            update: (t, dt) => this.tick(dt)
        });
        // Render the finished state once so instanced bounds cover the whole model.
        this.model.render(def.rest, 0);
        this.root.traverse((o) => {
            if (o.isInstancedMesh) o.computeBoundingSphere();
            // Animated parts move well beyond their bind-time bounds.
            if (o.isInstancedMesh || o.isLine || o.isSprite) o.frustumCulled = false;
        });
        this.model.reset?.();
        this.model.render(this.t, 0);
    }

    rectBase(group) {
        const m = this.research.mats;
        const body = new THREE.Mesh(new THREE.BoxGeometry(PLINTH_W, PLINTH_H - 0.04, PLINTH_D), m.plinth);
        body.position.y = (PLINTH_H - 0.04) / 2;
        const top = new THREE.Mesh(new THREE.BoxGeometry(PLINTH_W + 0.04, 0.04, PLINTH_D + 0.04), m.stone);
        top.position.y = PLINTH_H - 0.02;
        const kick = new THREE.Mesh(new THREE.BoxGeometry(PLINTH_W - 0.06, 0.06, PLINTH_D - 0.06), m.stone);
        kick.position.y = 0.03;
        group.add(body, top, kick);
        const label = this.addLabel(group, PLINTH_W - 0.12, 0.36, PLINTH_H + 0.004, PLINTH_D / 2 - 0.02);
        const p = group.position;
        const c = Math.cos(group.rotation.y);
        const s = Math.sin(group.rotation.y);
        const hw = Math.abs(c) * PLINTH_W / 2 + Math.abs(s) * PLINTH_D / 2 + 0.06;
        const hd = Math.abs(s) * PLINTH_W / 2 + Math.abs(c) * PLINTH_D / 2 + 0.06;
        this.museum.world.colliders.push({ x1: p.x - hw, z1: p.z - hd, x2: p.x + hw, z2: p.z + hd });
        return [body, top, label];
    }

    roundBase(group, place) {
        const m = this.research.mats;
        const dais = new THREE.Mesh(new THREE.CylinderGeometry(place.radius, place.radius + 0.04, 0.14, 96), m.stone);
        dais.position.y = 0.07;
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(place.drum, place.drum, place.topY - 0.18, 64), m.plinth);
        drum.position.y = 0.14 + (place.topY - 0.18) / 2;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(place.drum + 0.03, place.drum + 0.03, 0.04, 64), m.stone);
        cap.position.y = place.topY - 0.02;
        group.add(dais, drum, cap);
        // A reading stand at the front edge of the dais.
        const stand = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.86, 0.12), m.stone);
        stand.position.set(0, 0.43, place.radius + 0.12);
        group.add(stand);
        const label = this.addLabel(group, 1.36, 0.36, 0.86, place.radius + 0.24);
        this.museum.world.colliders.push({ x: group.position.x, z: group.position.z, r: place.radius + 0.35 });
        return [dais, drum, cap, stand, label];
    }

    /** The reading label: a dark plate tilted up towards the visitor. */
    addLabel(group, w, h, y, front) {
        const mat = new THREE.MeshBasicMaterial({ color: '#17181b', toneMapped: false });
        const label = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        label.rotation.x = -Math.PI / 2 + LABEL_TILT;
        label.position.set(0, y + (h / 2) * Math.sin(LABEL_TILT) + 0.012, front - (h / 2) * Math.cos(LABEL_TILT));
        // The plate under the label: thin along the label's own normal, set just behind it.
        const backing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.02), this.research.mats.stone);
        backing.rotation.copy(label.rotation);
        const normal = new THREE.Vector3(0, 0, 1).applyEuler(label.rotation);
        backing.position.copy(label.position).addScaledVector(normal, -0.0115);
        group.add(label, backing);
        group.updateMatrixWorld(true);
        const wp = label.getWorldPosition(new THREE.Vector3());
        this.labelSlot = this.museum.addSlot(mat, () => paintDemoLabel(this.def, Math.max(0, this.stage), this.def.accent, this.progressText()), wp, { placeholder: '#17181b' });
        return label;
    }

    progressText() {
        const d = this.def;
        if (!d.period) return '';
        const cycle = Math.min(Math.floor(this.t / d.period), d.count - 1);
        return `${d.unit || 'Cycle'} ${cycle + 1} of ${d.count}`;
    }

    // --- clock -------------------------------------------------------------

    local(t = this.t) {
        const d = this.def;
        if (!d.period) return t;
        return t < d.period * d.count ? t % d.period : d.period - 1e-3;
    }

    stageAt(t = this.t) {
        const local = this.local(t);
        let idx = 0;
        this.def.stages.forEach((s, k) => { if (local >= s.at) idx = k; });
        return idx;
    }

    stageStart(i, cycle = null) {
        const d = this.def;
        if (!d.period) return d.stages[i].at;
        const c = cycle ?? Math.min(Math.floor(this.t / d.period), d.count - 1);
        return c * d.period + d.stages[i].at;
    }

    seek(t, play = true) {
        this.t = clamp(t, 0, this.def.duration - 1e-3);
        this.playing = play;
        this.dirty = true;
        this.model.reset?.();
        this.museum.requestRender();
        this.research.changed(this);
    }

    replay() { this.selected = -1; this.seek(0, true); }

    toggle() {
        this.playing = !this.playing;
        this.dirty = true;
        this.research.changed(this);
    }

    goStage(i) { this.seek(this.stageStart(i), true); }

    next() {
        const d = this.def;
        const i = this.stageAt();
        if (i + 1 < d.stages.length) return this.goStage(i + 1);
        if (d.period) {
            const cycle = Math.floor(this.t / d.period);
            if (cycle + 1 < d.count) return this.seek((cycle + 1) * d.period, true);
        }
        this.replay();
    }

    prev() {
        const i = this.stageAt();
        const into = this.t - this.stageStart(i);
        if (into > 1.2) return this.goStage(i);
        if (i > 0) return this.goStage(i - 1);
        const d = this.def;
        if (d.period) {
            const cycle = Math.floor(this.t / d.period);
            if (cycle > 0) return this.seek((cycle - 1) * d.period + d.stages[d.stages.length - 1].at, true);
        }
        this.seek(0, true);
    }

    /** Advance the clock; draw if on screen. True when the picture changed. */
    tick(dt) {
        const d = this.def;
        this.events.length = 0;
        if (this.playing) {
            this.t += dt;
            if (this.t >= d.duration) {
                this.t -= d.duration;
                this.model.reset?.();
            }
        }
        const stage = this.stageAt();
        const progress = this.progressText();
        if (stage !== this.stage || progress !== this.lastProgress) {
            this.stage = stage;
            this.lastProgress = progress;
            if (this.labelSlot.state === 'ready') this.museum.repaint(this.labelSlot);
            this.research.changed(this);
        }
        const visible = !this.museum.frustum || this.museum.frustum.intersectsSphere(this.sphere);
        if (!visible || (!this.playing && !this.dirty)) return false;
        this.dirty = false;
        this.model.render(this.t, this.playing ? dt : 0);
        return true;
    }

    /** How busy the motors are, 0..1, for the optional sound. */
    get hum() {
        return this.playing ? (this.model.hum?.() || 0) : 0;
    }

    select(index) {
        this.selected = index;
        this.dirty = true;
        this.museum.requestRender();
    }
}

// ---------------------------------------------------------------------------

export class Research {
    constructor(museum) {
        this.museum = museum;
        this.mats = makeMaterials(museum);
        this.list = [];
        this.byKey = new Map();
        this.onChange = null;
    }

    build() {
        const projects = ROOM_BY_ID.projects;
        const tools = ROOM_BY_ID.tools;
        const north = (room) => (room.side === 'N' ? 0 : Math.PI);
        const at = (room, key, u, v) => {
            const p = galleryPoint(room, u, v);
            this.add(key, { room: room.id, x: p.x, z: p.z, rotY: north(room) });
        };
        // Gallery IV: the methods (BIM, informatics, robotics, DfMA, AI).
        at(projects, 'bim', -4.4, 5.6);
        at(projects, 'robot', 4.4, 5.6);
        at(projects, 'informatics', 0, 9.6);
        at(projects, 'dfma', -4.4, 13.4);
        at(projects, 'ai', 4.4, 13.4);
        // Gallery VI: the systems built from them (exchange, navigation, XR, twins).
        at(tools, 'interop', -4.4, 5.6);
        at(tools, 'nav', 4.4, 5.6);
        at(tools, 'xr', -4.4, 13.0);
        at(tools, 'twin', 4.4, 13.0);
        // The lobby's centrepiece, facing the front doors.
        this.add('ecosystem', { room: 'home', x: -27.6, z: 0, rotY: -Math.PI / 2, round: true, radius: 1.45, drum: 0.62, topY: 0.84, viewDistance: 3.6 });
    }

    add(key, place) {
        const def = DEMOS[key];
        if (!def) return;
        const inst = new Installation(this, def, place);
        this.list.push(inst);
        this.byKey.set(key, inst);
    }

    changed(inst) {
        this.onChange?.(inst);
    }

    /** The installation nearest the visitor that is making a sound, for audio. */
    loudest(x, z) {
        let best = null;
        let bestD = 7;
        for (const inst of this.list) {
            const d = Math.hypot(inst.centre.x - x, inst.centre.z - z);
            if (d < bestD && inst.hum > 0.02) { best = inst; bestD = d; }
        }
        return best ? { inst: best, distance: bestD } : null;
    }
}

// ---------------------------------------------------------------------------
// The reading label
// ---------------------------------------------------------------------------

function paintDemoLabel(def, current, accent, progress) {
    const W = 1100;
    const H = 288;
    const canvas = art.makeCanvas(W, H, Math.min(art.PAINT.scale, 1.6));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#17181b';
    ctx.fillRect(0, 0, W, H);
    const pad = 40;
    ctx.fillStyle = accent;
    ctx.fillRect(pad, 34, 34, 3);
    ctx.font = `600 19px ${art.SANS}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = art.mixHex(accent, '#ffffff', 0.35);
    ctx.fillText('RESEARCH DEMONSTRATION  ·  CONCEPTUAL SIMULATION', pad + 46, 42);
    if (progress) {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#b8b0a3';
        ctx.fillText(progress.toUpperCase(), W - pad, 42);
        ctx.textAlign = 'left';
    }
    ctx.fillStyle = '#f4efe6';
    let size = 46;
    ctx.font = `600 ${size}px ${art.SERIF}`;
    while (ctx.measureText(def.title).width > W - pad * 2 && size > 30) {
        size -= 2;
        ctx.font = `600 ${size}px ${art.SERIF}`;
    }
    ctx.fillText(def.title, pad, 100);
    // Stage line: numbered steps, the current one filled.
    const stages = def.stages;
    const gap = 10;
    let font = 21;
    const widthOf = () => {
        ctx.font = `600 ${font}px ${art.SANS}`;
        return stages.reduce((w, s, i) => w + ctx.measureText(`${i + 1}  ${s.label}`).width + 34, 0) + gap * (stages.length - 1);
    };
    while (widthOf() > W - pad * 2 && font > 14) font -= 1;
    let x = pad;
    const y = 140;
    const h = 44;
    stages.forEach((s, i) => {
        const text = `${i + 1}  ${s.label}`;
        const w = ctx.measureText(text).width + 34;
        roundRect(ctx, x, y, w, h, h / 2);
        if (i === current) {
            ctx.fillStyle = accent;
            ctx.fill();
            ctx.fillStyle = '#ffffff';
        } else {
            ctx.strokeStyle = i < current ? 'rgba(244,239,230,0.55)' : 'rgba(244,239,230,0.25)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = i < current ? 'rgba(244,239,230,0.85)' : 'rgba(244,239,230,0.55)';
        }
        ctx.font = `600 ${font}px ${art.SANS}`;
        ctx.fillText(text, x + 17, y + h / 2 + font * 0.36);
        x += w + gap;
    });
    // What is happening now, then the hint on a line of its own.
    ctx.font = `400 22px ${art.SANS}`;
    ctx.fillStyle = '#cfc8bc';
    const caption = stages[current]?.caption || '';
    const lines = clampLines(ctx, wrapText(ctx, caption, W - pad * 2), 2, W - pad * 2);
    lines.forEach((line, i) => ctx.fillText(line, pad, 214 + i * 28));
    ctx.font = `600 15px ${art.SANS}`;
    ctx.fillStyle = art.mixHex(accent, '#ffffff', 0.35);
    ctx.textAlign = 'right';
    ctx.fillText('CLICK TO REPLAY OR STEP THROUGH', W - pad, 272);
    ctx.textAlign = 'left';
    return canvas;
}
