// The museum's residents: two floor-cleaning robots with their charging docks.
//
// The robots clean the lobby, the Grand Hall and the contact room. Each
// leaves its dock, follows planned paths over the walkable grid to places
// that need cleaning, spirals over a spot, gives way to anyone in front of
// it, and drives home to charge when its battery runs low. Behind it the
// mopped stone stays damp for a while and then dries.
//
// They simulate cheaply every frame, but are only posed and drawn when they
// are near the visitor and can be seen.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { roomAt } from './world.js';
import { clamp } from './util.js';

const TAU = Math.PI * 2;
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const DRAW_RADIUS = 32;
const RUG = { x1: -16, x2: 44, z1: -1.7, z2: 1.7, top: 0.012 };   // the hall's runner (world.js)
const onRug = (x, z) => x > RUG.x1 && x < RUG.x2 && z > RUG.z1 && z < RUG.z2;

// ---------------------------------------------------------------------------
// Following a path on the floor
// ---------------------------------------------------------------------------

class Walker {
    constructor(x, z, yaw) {
        this.x = x;
        this.z = z;
        this.yaw = yaw;
        this.v = 0;
        this.w = 0;          // turning rate, rad/s
        this.path = null;
        this.i = 0;
    }

    setPath(points) {
        this.path = points && points.length > 1 ? points.slice(1) : null;
        this.i = 0;
    }

    get remaining() {
        if (!this.path) return 0;
        let d = 0;
        let px = this.x;
        let pz = this.z;
        for (let k = this.i; k < this.path.length; k++) {
            d += Math.hypot(this.path[k].x - px, this.path[k].z - pz);
            px = this.path[k].x;
            pz = this.path[k].z;
        }
        return d;
    }

    /**
     * Move along the path. Turns at `turnRate`; on a sharp corner it slows
     * (or, with spinInPlace, stops and turns on the spot first).
     * Returns true when the end is reached.
     */
    step(dt, { speed, accel = 1.2, turnRate = 3, turnAccel = 5, spinInPlace = false, blocked = false }) {
        if (!this.path) { this.v = damp(this.v, 0, 6, dt); this.w = damp(this.w, 0, 8, dt); return true; }
        let target = this.path[this.i];
        while (target && Math.hypot(target.x - this.x, target.z - this.z) < 0.12 && this.i < this.path.length - 1) target = this.path[++this.i];
        const dx = target.x - this.x;
        const dz = target.z - this.z;
        const dist = Math.hypot(dx, dz);
        const want = Math.atan2(dx, dz);
        const err = wrap(want - this.yaw);
        // The turn builds up and eases off: motors do not change speed at once.
        const wWant = clamp(err * 4.5, -turnRate, turnRate);
        this.w += clamp(wWant - this.w, -turnAccel * dt, turnAccel * dt);
        this.yaw = wrap(this.yaw + this.w * dt);
        const left = this.remaining;
        let v = Math.min(speed, Math.sqrt(2 * accel * 0.8 * left) + 0.02);
        if (spinInPlace && Math.abs(err) > 0.35) v = 0;
        else v *= clamp(1.2 - Math.abs(err) / 1.4, 0.15, 1);
        if (blocked) v = 0;
        this.v += clamp(v - this.v, -accel * 2.2 * dt, accel * dt);
        const step = Math.min(dist, Math.max(0, this.v) * dt);
        if (dist > 1e-5) {
            // Move along the heading, nudged towards the target so the path is kept.
            const hx = Math.sin(this.yaw);
            const hz = Math.cos(this.yaw);
            this.x += (hx * 0.6 + (dx / dist) * 0.4) * step;
            this.z += (hz * 0.6 + (dz / dist) * 0.4) * step;
        }
        if (this.i === this.path.length - 1 && dist < 0.05) {
            this.path = null;
            return true;
        }
        return false;
    }
}

// ---------------------------------------------------------------------------
// Cleaning robot and its dock
// ---------------------------------------------------------------------------

const LED = { clean: new THREE.Color(0.35, 1.3, 1.6), home: new THREE.Color(1.6, 1.05, 0.3), charge: new THREE.Color(1.6, 1.05, 0.3), full: new THREE.Color(0.45, 1.5, 0.6), wait: new THREE.Color(1.5, 1.5, 1.5) };

function robotMaterials() {
    return {
        // Satin moulded plastic, not lacquer: a soft highlight, no mirror.
        shell: new THREE.MeshPhysicalMaterial({ color: '#cfcdc8', roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.8 }),
        graphite: new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.5, metalness: 0.3 }),
        rubber: new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.88 }),
        glass: new THREE.MeshPhysicalMaterial({ color: '#10151a', roughness: 0.1, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 }),
        metal: new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.28, metalness: 0.95 }),
        bristle: new THREE.MeshStandardMaterial({ color: '#e8e4da', roughness: 0.8 }),
        fabric: new THREE.MeshStandardMaterial({ color: '#8f99a3', roughness: 1 }),
        copper: new THREE.MeshStandardMaterial({ color: '#c58b4f', roughness: 0.3, metalness: 1 }),
        wallPlate: new THREE.MeshStandardMaterial({ color: '#f0eee9', roughness: 0.5 })
    };
}

let blobTex = null;

/** A soft round contact shadow: it grounds something too small for the room's shadow map. */
function contactShadow(size, strength) {
    if (!blobTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.45, 'rgba(255,255,255,0.8)');
        g.addColorStop(0.68, 'rgba(255,255,255,0.34)');
        g.addColorStop(0.86, 'rgba(255,255,255,0.08)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        blobTex = new THREE.CanvasTexture(c);
    }
    const mat = new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: blobTex, transparent: true, opacity: strength, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.003;
    mesh.userData.noPick = true;
    mesh.renderOrder = 1;
    return mesh;
}

const lathe = (points, segments = 72, start = 0, length = TAU) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments, start, length);

/**
 * A 35 cm robot vacuum and mop, 9 cm tall under its lidar turret. It faces +z.
 * `sprung` holds everything that rides on the suspension (it dips and leans a
 * little); the wheels, brushes and mop stay on the floor.
 */
function buildRobotBody(m) {
    const root = new THREE.Group();
    const sprung = new THREE.Group();
    root.add(sprung);
    const add = (geo, mat, parent = sprung, x = 0, y = 0, z = 0) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
    };
    // Chassis tray and the upper shell: a flat lid with a filleted shoulder.
    add(lathe([[0, 0.014], [0.15, 0.014], [0.166, 0.02], [0.1715, 0.03], [0.1715, 0.034]]), m.graphite);
    add(lathe([[0.1715, 0.0335], [0.1745, 0.04], [0.1745, 0.07], [0.1725, 0.08], [0.166, 0.0868], [0.152, 0.0902], [0, 0.0905]]), m.shell);
    // Front bumper: a separate skin round the front half that gives when it touches something.
    const bumper = new THREE.Group();
    sprung.add(bumper);
    add(lathe([[0.1747, 0.031], [0.1778, 0.036], [0.1778, 0.072], [0.1747, 0.078]], 48, -Math.PI * 0.49, Math.PI * 0.98), m.shell, bumper);
    add(lathe([[0.1784, 0.045], [0.1784, 0.064]], 24, -0.62, 1.24), m.glass, bumper);                 // sensor window
    add(lathe([[0.1781, 0.0335], [0.1781, 0.0375]], 48, -Math.PI * 0.49, Math.PI * 0.98), m.rubber, bumper);   // scuff strip
    // Exhaust slots across the back.
    for (let k = -3; k <= 3; k++) add(lathe([[0.1756, 0.046], [0.1756, 0.066]], 2, Math.PI + k * 0.085 - 0.022, 0.044), m.graphite);
    // The lid: a light pipe in its seam shows what the robot is doing.
    const ringMat = new THREE.MeshBasicMaterial({ color: LED.clean.clone(), toneMapped: false });
    add(new THREE.RingGeometry(0.1165, 0.1255, 72), m.graphite, sprung, 0, 0.0907, 0).rotation.x = -Math.PI / 2;
    const ring = add(new THREE.TorusGeometry(0.121, 0.0024, 6, 72), ringMat, sprung, 0, 0.0909, 0);
    ring.rotation.x = Math.PI / 2;
    // Control island at the front of the lid: a glass strip with two buttons.
    const island = add(new THREE.CylinderGeometry(0.02, 0.02, 0.002, 28), m.glass, sprung, 0, 0.0912, 0.088);
    island.scale.x = 2.1;
    const buttonMat = new THREE.MeshBasicMaterial({ color: LED.clean.clone(), toneMapped: false });
    for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.0075, 0.0075, 0.0016, 20), m.metal, sprung, sx * 0.019, 0.0926, 0.088);
        add(new THREE.TorusGeometry(0.0088, 0.0007, 4, 24), buttonMat, sprung, sx * 0.019, 0.0926, 0.088).rotation.x = Math.PI / 2;
    }
    // Lidar turret: a fixed collar, a spinning head with a slot, and a cap.
    add(new THREE.CylinderGeometry(0.041, 0.043, 0.006, 36), m.graphite, sprung, 0, 0.0935, -0.035);
    const turret = new THREE.Group();
    turret.position.set(0, 0.0965, -0.035);
    sprung.add(turret);
    add(new THREE.CylinderGeometry(0.036, 0.036, 0.017, 36), m.glass, turret, 0, 0.0085, 0);
    const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.28, 0.22), toneMapped: false });
    add(new THREE.BoxGeometry(0.016, 0.006, 0.004), windowMat, turret, 0, 0.0085, 0.0348);
    add(new THREE.BoxGeometry(0.01, 0.006, 0.004), m.metal, turret, 0, 0.0085, -0.0348);
    add(lathe([[0, 0.017], [0.037, 0.017], [0.0375, 0.0185], [0.036, 0.0205], [0, 0.021]], 36), m.shell, turret);
    // On the floor: two drive wheels, a caster, two side brushes and the mop pad.
    const tyre = new THREE.CylinderGeometry(0.036, 0.036, 0.026, 28);
    tyre.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.027, 20);
    hubGeo.rotateZ(Math.PI / 2);
    const wheels = [-1, 1].map((sx) => {
        const w = new THREE.Group();
        w.position.set(sx * 0.118, 0.036, 0);
        root.add(w);
        add(tyre, m.rubber, w);
        add(hubGeo, m.graphite, w);
        add(new THREE.BoxGeometry(0.028, 0.006, 0.034), m.metal, w);
        return w;
    });
    add(new THREE.SphereGeometry(0.012, 14, 10), m.metal, root, 0, 0.012, 0.118);
    const brushes = [-1, 1].map((sx) => {
        const b = new THREE.Group();
        b.position.set(sx * 0.116, 0.009, 0.102);
        root.add(b);
        add(new THREE.CylinderGeometry(0.011, 0.011, 0.01, 14), m.graphite, b);
        for (let k = 0; k < 3; k++) {
            const pivot = new THREE.Group();
            pivot.rotation.y = (k * TAU) / 3;
            b.add(pivot);
            // A rubber arm, then a tuft of bristles splayed down to the floor.
            const arm = add(new THREE.BoxGeometry(0.03, 0.003, 0.005), m.rubber, pivot, 0.022, 0, 0);
            arm.rotation.z = -0.08;
            for (const dz of [-0.004, 0, 0.004]) {
                const tuft = add(new THREE.BoxGeometry(0.034, 0.0012, 0.0016), m.bristle, pivot, 0.052, -0.004, dz * 1.6);
                tuft.rotation.set(0, -dz * 28, -0.14);
            }
        }
        return b;
    });
    const pad = add(new RoundedBoxGeometry(0.21, 0.009, 0.062, 2, 0.004), m.fabric, root, 0, 0.0055, -0.104);
    add(new RoundedBoxGeometry(0.19, 0.006, 0.05, 2, 0.002), m.graphite, root, 0, 0.012, -0.104);
    const shadow = contactShadow(0.5, 0.3);
    root.add(shadow);
    const glowing = new Set([ringMat, buttonMat, windowMat]);
    root.traverse((o) => {
        if (!o.isMesh || o === shadow) return;
        o.castShadow = !glowing.has(o.material);
        o.receiveShadow = true;
    });
    return { root, sprung, bumper, ring, ringMat, buttonMat, turret, wheels, brushes, pad, shadow };
}

/**
 * The charging base: a ramp with sprung contacts, a tower against the wall,
 * and a flex running to a socket on the wall beside it. It faces +z.
 */
function buildDock(m) {
    const dock = new THREE.Group();
    const add = (geo, mat, x = 0, y = 0, z = 0) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        dock.add(mesh);
        return mesh;
    };
    // Ramp: a wedge the robot's front climbs onto.
    const wedge = new THREE.Shape();
    wedge.moveTo(0, 0);
    wedge.lineTo(0.2, 0);
    wedge.lineTo(0.2, 0.003);
    wedge.lineTo(0.05, 0.013);
    wedge.lineTo(0, 0.013);
    wedge.closePath();
    const rampGeo = new THREE.ExtrudeGeometry(wedge, { depth: 0.33, bevelEnabled: false });
    rampGeo.translate(0, 0, -0.165);
    rampGeo.rotateY(-Math.PI / 2);          // the profile's x becomes +z
    add(rampGeo, m.graphite, 0, 0, -0.02);
    for (const s of [-1, 1]) {
        add(new RoundedBoxGeometry(0.03, 0.005, 0.045, 2, 0.002), m.copper, s * 0.07, 0.0125, 0.052);
        add(new THREE.BoxGeometry(0.004, 0.0015, 0.15), m.rubber, s * 0.135, 0.0085, 0.1).rotation.x = 0.067;   // grip strips
    }
    add(new RoundedBoxGeometry(0.31, 0.15, 0.072, 4, 0.022), m.shell, 0, 0.076, -0.021);
    add(new RoundedBoxGeometry(0.25, 0.085, 0.008, 2, 0.004), m.glass, 0, 0.082, 0.014);
    add(new THREE.BoxGeometry(0.05, 0.014, 0.004), m.glass, 0, 0.028, 0.0155);          // docking beacon
    const ledMat = new THREE.MeshBasicMaterial({ color: LED.full.clone(), toneMapped: false });
    add(new THREE.BoxGeometry(0.05, 0.003, 0.002), ledMat, 0, 0.136, 0.0152);
    // Battery bars behind the dock's glass face.
    const barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.3, 0.7), toneMapped: false });
    const bars = [0, 1, 2, 3].map((k) => add(new THREE.BoxGeometry(0.03, 0.014, 0.002), barMat, -0.054 + k * 0.036, 0.082, 0.0185));
    // Mains: a wall plate on the dado, a plug, and the flex lying on the floor.
    add(new RoundedBoxGeometry(0.085, 0.085, 0.008, 2, 0.004), m.wallPlate, 0.27, 0.3, -0.075);
    add(new RoundedBoxGeometry(0.04, 0.04, 0.03, 2, 0.006), m.rubber, 0.27, 0.3, -0.056);
    const flex = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.14, 0.03, -0.04), new THREE.Vector3(0.19, 0.008, -0.022), new THREE.Vector3(0.25, 0.006, -0.03),
        new THREE.Vector3(0.292, 0.012, -0.05), new THREE.Vector3(0.285, 0.12, -0.064), new THREE.Vector3(0.272, 0.24, -0.062), new THREE.Vector3(0.27, 0.285, -0.056)
    ]);
    add(new THREE.TubeGeometry(flex, 40, 0.0035, 8), m.rubber);
    const glowing = new Set([ledMat, barMat]);
    dock.traverse((o) => { if (o.isMesh) { o.castShadow = !glowing.has(o.material); o.receiveShadow = true; } });
    const shadow = contactShadow(0.6, 0.3);
    shadow.position.z = 0.03;
    dock.add(shadow);
    return { dock, ledMat, bars };
}

/**
 * The damp band a mopping robot leaves on stone: a ribbon laid along its
 * path, soft at the edges, that dries (fades) over half a minute.
 */
class Trail {
    constructor(parent, max = 220) {
        this.max = max;
        this.samples = [];
        this.clock = 0;
        this.life = 30;
        const geo = new THREE.BufferGeometry();
        this.pos = new Float32Array(max * 4 * 3);
        this.col = new Float32Array(max * 4 * 4);
        geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
        const index = [];
        for (let i = 0; i < max - 1; i++) {
            for (let k = 0; k < 3; k++) {
                const a = i * 4 + k;
                index.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
            }
        }
        geo.setIndex(index);
        geo.setDrawRange(0, 0);
        const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.frustumCulled = false;
        this.mesh.userData.noPick = true;
        this.mesh.renderOrder = 1;
        parent.add(this.mesh);
    }

    get live() { return this.samples.length > 1; }

    /** Record where the mop is; `wet` is false where nothing is being mopped (a gap in the band). */
    add(dt, x, z, yaw, wet) {
        this.clock += dt;
        const s = this.samples;
        while (s.length && this.clock - s[0].t > this.life) s.shift();
        const last = s[s.length - 1];
        if (last && Math.hypot(x - last.x, z - last.z) < 0.07) return;
        if (!wet && (!last || !last.wet)) return;
        if (s.length >= this.max) s.shift();
        // Across the path: the band is as wide as the mop pad.
        s.push({ x, z, cx: Math.cos(yaw), cz: -Math.sin(yaw), t: this.clock, wet });
    }

    /** Rebuild the ribbon (only called while it can be seen). */
    draw() {
        const s = this.samples;
        const n = s.length;
        for (let i = 0; i < n; i++) {
            const p = s[i];
            const age = (this.clock - p.t) / this.life;
            // Wettest just behind the robot, drying slowly, then quickly at the end.
            const a = p.wet ? 0.13 * (1 - age) * Math.min(1, (1 - age) * 3) * Math.min(1, (n - 1 - i) / 2) * Math.min(1, i / 2) : 0;
            [-0.118, -0.088, 0.088, 0.118].forEach((off, k) => {
                const j = i * 4 + k;
                this.pos[j * 3] = p.x + p.cx * off;
                this.pos[j * 3 + 1] = 0.0035;
                this.pos[j * 3 + 2] = p.z + p.cz * off;
                this.col[j * 4] = 0.11;
                this.col[j * 4 + 1] = 0.09;
                this.col[j * 4 + 2] = 0.06;
                this.col[j * 4 + 3] = k === 0 || k === 3 ? 0 : a;
            });
        }
        const geo = this.mesh.geometry;
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.setDrawRange(0, Math.max(0, n - 1) * 18);
    }
}

class CleaningRobot {
    constructor(owner, { name, dock, region, battery = 1, docked = false }) {
        this.owner = owner;
        this.name = name;
        this.region = region;
        const m = owner.robotMats;
        this.body = buildRobotBody(m);
        this.dockObj = buildDock(m);
        // The dock sits against a wall; the robot parks facing it.
        this.dockPose = dock;
        this.dockObj.dock.position.set(dock.x, 0, dock.z);
        this.dockObj.dock.rotation.y = dock.yaw;
        owner.group.add(this.dockObj.dock, this.body.root);
        const fx = Math.sin(dock.yaw);
        const fz = Math.cos(dock.yaw);
        this.park = { x: dock.x + fx * 0.265, z: dock.z + fz * 0.265, yaw: wrap(dock.yaw + Math.PI) };
        this.approach = { x: dock.x + fx * 1.1, z: dock.z + fz * 1.1 };
        this.collider = { x: 0, z: 0, r: 0.2, person: true };
        owner.world.colliders.push(this.collider);
        owner.world.colliders.push({ x: dock.x, z: dock.z, r: 0.22, person: true });
        this.battery = battery;
        this.state = docked ? 'charge' : 'pick';
        this.timer = 0;
        this.walker = new Walker(docked ? this.park.x : this.approach.x, docked ? this.park.z : this.approach.z, docked ? this.park.yaw : dock.yaw);
        this.spin = 0;
        this.wheelTurn = [0, 0];
        this.spiral = null;
        this.blockedFor = 0;
        // What the body feels (turning rate, acceleration) and how it answers.
        this.omega = 0;
        this.acc = 0;
        this.lastYaw = this.walker.yaw;
        this.lastV = 0;
        this.pitch = 0;
        this.roll = 0;
        this.press = 0;
        this.lift = 0;
        this.body.root.rotation.order = 'YXZ';
        this.trail = new Trail(owner.group);
    }

    get x() { return this.walker.x; }
    get z() { return this.walker.z; }
    get yaw() { return this.walker.yaw; }
    get moving() { return Math.abs(this.walker.v) > 0.02 || this.state === 'spot'; }

    pickTarget() {
        const nav = this.owner.nav;
        for (let tries = 0; tries < 20; tries++) {
            const [x1, z1, x2, z2] = this.region;
            const x = rand(x1, x2);
            const z = rand(z1, z2);
            if (!nav.walkable(x, z)) continue;
            if (Math.hypot(x - this.x, z - this.z) < 3) continue;
            const path = nav.findPath({ x: this.x, z: this.z }, { x, z });
            if (path) return path;
        }
        return null;
    }

    /** Something in front: the visitor or a person. */
    obstacleAhead(px, pz) {
        const hx = Math.sin(this.yaw);
        const hz = Math.cos(this.yaw);
        const test = (ox, oz, r) => {
            const dx = ox - this.x;
            const dz = oz - this.z;
            const d = Math.hypot(dx, dz);
            return d < r && (dx * hx + dz * hz) / (d || 1) > 0.35;
        };
        if (test(px, pz, 0.75)) return true;
        for (const c of this.owner.world.colliders) if (c.person && c !== this.collider && c.r > 0.25 && test(c.x, c.z, 0.6 + c.r)) return true;
        return false;
    }

    update(dt, px, pz) {
        const w = this.walker;
        const working = this.state !== 'charge' && this.state !== 'full';
        if (working) this.battery = Math.max(0, this.battery - dt / 150);
        switch (this.state) {
            case 'charge':
                this.battery = Math.min(1, this.battery + dt / 32);
                if (this.battery >= 1) { this.state = 'full'; this.timer = rand(4, 12); }
                break;
            case 'full':
                this.timer -= dt;
                if (this.timer <= 0) {
                    // Back out of the dock, then turn round.
                    w.setPath([{ x: w.x, z: w.z }, { x: this.approach.x, z: this.approach.z }]);
                    this.state = 'undock';
                }
                break;
            case 'undock': {
                // Reverse straight out: heading stays, position slides back.
                const ax = this.approach.x - w.x;
                const az = this.approach.z - w.z;
                const d = Math.hypot(ax, az);
                const v = Math.min(0.18, d * 1.5);
                if (d > 0.02) { w.x += (ax / d) * v * dt; w.z += (az / d) * v * dt; }
                w.v = -v;
                if (d < 0.03) { w.v = 0; this.state = 'pick'; }
                break;
            }
            case 'pick': {
                if (this.battery < 0.2) { this.goHome(); break; }
                const path = this.pickTarget();
                if (path) { w.setPath(this.owner.nav.smooth(path, 0.5)); this.state = 'travel'; } else this.timer = 1;
                break;
            }
            case 'travel':
            case 'home': {
                const blocked = this.obstacleAhead(px, pz);
                this.blockedFor = blocked ? this.blockedFor + dt : 0;
                const done = w.step(dt, { speed: this.state === 'home' ? 0.32 : 0.28, accel: 0.4, turnRate: 1.6, spinInPlace: true, blocked });
                if (this.blockedFor > 3) {
                    // Someone is staying put: go somewhere else (or try home again).
                    this.blockedFor = 0;
                    if (this.state === 'home') this.goHome(); else this.state = 'pick';
                    break;
                }
                if (done) {
                    if (this.state === 'home') {
                        w.setPath([{ x: w.x, z: w.z }, { x: this.park.x, z: this.park.z }]);
                        this.state = 'dock';
                    } else {
                        // Start the spiral exactly where the robot is, heading the way it faces.
                        const a0 = w.yaw - Math.PI / 2;
                        this.spiral = { cx: w.x - Math.sin(a0) * 0.05, cz: w.z - Math.cos(a0) * 0.05, a: a0, a0, r: 0.05 };
                        this.state = 'spot';
                    }
                }
                if (this.state === 'travel' && this.battery < 0.2) this.goHome();
                break;
            }
            case 'spot': {
                // A slow outward spiral over the spot.
                const s = this.spiral;
                s.a += dt * 1.2;
                s.r = 0.05 + (s.a - s.a0) * 0.045;
                const nx = s.cx + Math.sin(s.a) * s.r;
                const nz = s.cz + Math.cos(s.a) * s.r;
                if (this.owner.nav.walkable(nx, nz) && !this.obstacleAhead(px, pz)) {
                    w.yaw = wrap(s.a + Math.PI / 2);
                    w.x = nx;
                    w.z = nz;
                    w.v = 0.12;
                }
                if (s.a - s.a0 > TAU * 2.2 || !this.owner.nav.walkable(nx, nz)) { w.v = 0; this.state = 'pick'; }
                break;
            }
            case 'dock': {
                // Line up with the dock and roll in slowly.
                const done = w.step(dt, { speed: 0.12, accel: 0.3, turnRate: 1.4, spinInPlace: true });
                if (done) {
                    w.yaw = damp(w.yaw, w.yaw + wrap(this.dockPose.yaw + Math.PI - w.yaw), 8, dt);
                    if (Math.abs(wrap(this.dockPose.yaw + Math.PI - w.yaw)) < 0.02) { this.state = 'charge'; w.v = 0; }
                }
                break;
            }
            default:
                break;
        }
        this.collider.x = w.x;
        this.collider.z = w.z;
        this.omega = wrap(w.yaw - this.lastYaw) / dt;
        this.acc = (w.v - this.lastV) / dt;
        this.lastYaw = w.yaw;
        this.lastV = w.v;
        // It rides up onto the hall's runner, and mops only bare stone.
        const rug = onRug(w.x, w.z);
        this.lift = damp(this.lift, rug ? RUG.top : 0, 14, dt);
        const mopping = (this.state === 'travel' || this.state === 'spot') && Math.abs(w.v) > 0.03 && !rug;
        this.trail.add(dt, w.x - Math.sin(w.yaw) * 0.104, w.z - Math.cos(w.yaw) * 0.104, w.yaw, mopping);
    }

    goHome() {
        const nav = this.owner.nav;
        const path = nav.findPath({ x: this.x, z: this.z }, this.approach);
        if (path) { this.walker.setPath(nav.smooth(path, 0.5)); this.state = 'home'; } else this.state = 'pick';
    }

    /** Put the body where the simulation is. */
    place() {
        const root = this.body.root;
        root.position.set(this.walker.x, this.lift, this.walker.z);
        root.rotation.y = this.walker.yaw;
    }

    pose(dt) {
        const b = this.body;
        const w = this.walker;
        this.place();
        const docked = this.state === 'charge' || this.state === 'full';
        const cleaning = this.state === 'travel' || this.state === 'spot';
        this.spin += dt * (cleaning ? 14 : 0);
        b.brushes.forEach((br, k) => { br.rotation.y = (k ? -1 : 1) * this.spin; });
        // The lidar spins whenever the robot is awake.
        b.turret.rotation.y += dt * (docked ? 0 : 11);
        // Two drive wheels: on a turn the inner one slows and the outer one speeds up.
        b.wheels.forEach((wheel, k) => {
            this.wheelTurn[k] += ((w.v + (k ? -1 : 1) * this.omega * 0.118) * dt) / 0.036;
            wheel.rotation.x = this.wheelTurn[k];
        });
        // The shell rides on soft suspension: it dips when braking, squats when
        // setting off and leans a little out of a turn.
        this.pitch = damp(this.pitch, clamp(-this.acc * 0.045, -0.03, 0.03), 9, dt);
        this.roll = damp(this.roll, clamp(-this.omega * w.v * 0.25, -0.02, 0.02), 9, dt);
        b.sprung.rotation.set(this.pitch, 0, this.roll);
        // The bumper gives while something is in the way.
        this.press = damp(this.press, this.blockedFor > 0 ? 1 : 0, 14, dt);
        b.bumper.position.z = -0.004 * this.press;
        // Its nose rides up the dock's ramp.
        const atDock = docked || this.state === 'dock' || this.state === 'undock';
        const ramp = atDock ? clamp(1 - Math.hypot(w.x - this.park.x, w.z - this.park.z) / 0.14, 0, 1) : 0;
        b.root.rotation.x = -0.04 * ramp;
        const led = this.state === 'charge' ? LED.charge : this.state === 'full' ? LED.full : this.state === 'home' || this.state === 'dock' ? LED.home : this.blockedFor > 0.2 ? LED.wait : LED.clean;
        b.ringMat.color.lerp(led, 1 - Math.exp(-dt * 4));
        if (this.state === 'charge') b.ringMat.color.multiplyScalar(0.75 + 0.25 * Math.sin(performance.now() / 400));
        b.buttonMat.color.copy(b.ringMat.color);
        const d = this.dockObj;
        d.ledMat.color.copy(this.state === 'charge' ? LED.charge : LED.full);
        const level = Math.ceil(this.battery * 4);
        d.bars.forEach((bar, k) => { bar.visible = k < level; });
    }
}

// ---------------------------------------------------------------------------

export class Companions {
    constructor({ scene, world, nav, museum, calm = false }) {
        this.world = world;
        this.nav = nav;
        this.museum = museum;
        this.calm = calm;
        this.group = new THREE.Group();
        this.group.name = 'residents';
        scene.add(this.group);
        this.robotMats = robotMaterials();
        this.robots = [
            new CleaningRobot(this, { name: 'Cleaning robot A', dock: { x: -51.74, z: -4.2, yaw: Math.PI / 2 }, region: [-50, -14, 14, 14], battery: 0.85 }),
            new CleaningRobot(this, { name: 'Cleaning robot B', dock: { x: 55.5, z: -9.74, yaw: 0 }, region: [14, -7, 66, 9], battery: 0.6, docked: true })
        ];
        // Clicking one opens a small card about it.
        this.robots.forEach((r, i) => museum.register({ id: `resident-robot-${i}`, room: roomAt(r.dockPose.x, r.dockPose.z)?.id || 'hall', kind: 'resident', title: r.name, subtitle: 'Autonomous floor care', payload: { robot: r, describe: () => this.describe({ robot: r }) }, icon: 'fas fa-robot', catalogue: false, noHighlight: true }, [r.body.root, r.dockObj.dock]));
        this.sphere = new THREE.Sphere();
        this.robots.forEach((r) => r.pose(0));
    }

    /** Advance everyone; returns true when someone the visitor can see moved. */
    update(t, dt, px, pz, frustum) {
        if (dt <= 0) return false;
        let seen = false;
        const near = (x, z, r) => {
            if (Math.hypot(x - px, z - pz) > DRAW_RADIUS) return false;
            // Behind a wall: the room culling knows.
            if (this.sees && !this.sees(x, z, r)) return false;
            this.sphere.center.set(x, 0.2, z);
            this.sphere.radius = r;
            return !frustum || frustum.intersectsSphere(this.sphere);
        };
        // Bodies always move with the simulation (so nothing is left frozen in
        // view and then jumps); only the posing of limbs, brushes and lights
        // is skipped when they cannot be seen.
        for (const r of this.robots) {
            r.update(dt, px, pz);
            r.place();
            const show = near(r.x, r.z, 0.5);
            r.body.root.visible = Math.hypot(r.x - px, r.z - pz) < 60 && (!this.sees || this.sees(r.x, r.z, 0.5));
            r.trail.mesh.visible = r.body.root.visible;
            if (show) { r.pose(dt); seen = seen || r.moving || r.state === 'charge'; }
            // The damp band behind it goes on drying after the robot has left the view.
            if (r.trail.live && near(r.x, r.z, 9)) { r.trail.draw(); seen = true; }
        }
        return seen;
    }

    /** Status text for the residents' panel. */
    describe(payload) {
        const r = payload.robot;
        const words = { charge: 'Charging at its dock', full: 'Fully charged, about to set off', undock: 'Leaving its dock', pick: 'Choosing where to clean next', travel: 'Driving to the next spot', spot: 'Spot-cleaning', home: 'Battery low: returning to its dock', dock: 'Docking' };
        return { state: words[r.state] || 'Working', battery: Math.round(r.battery * 100) };
    }
}
