// The museum's residents: two floor-cleaning robots with their charging
// docks, and two cats.
//
// The robots clean the lobby, the Grand Hall and the contact room. Each
// leaves its dock, follows planned paths over the walkable grid to places
// that need cleaning, spirals over a spot, gives way to anyone in front of
// it, and drives home to charge when its battery runs low.
//
// The cats wander the whole building. Now and then one sits down, jumps up
// onto a bench for a nap, or hops onto a passing cleaning robot and rides it
// for a while. They are built from simple shapes (no skinned meshes) with
// jointed legs, a segmented tail, ears, blinking eyes and whiskers; each pose
// (walk, stand, sit, loaf, crouch, leap) is a set of joint angles, and the
// cat blends smoothly between them.
//
// Everything simulates cheaply every frame, but bodies are only posed and
// drawn when they are near the visitor and on screen.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { roomAt } from './world.js';
import { clamp } from './util.js';
import { buildCatModel, applyCatPose, CAT_POSES } from './cat-model.js';

const TAU = Math.PI * 2;
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const DRAW_RADIUS = 32;

// ---------------------------------------------------------------------------
// Following a path on the floor
// ---------------------------------------------------------------------------

class Walker {
    constructor(x, z, yaw) {
        this.x = x;
        this.z = z;
        this.yaw = yaw;
        this.v = 0;
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
    step(dt, { speed, accel = 1.2, turnRate = 3, spinInPlace = false, blocked = false }) {
        if (!this.path) { this.v = damp(this.v, 0, 6, dt); return true; }
        let target = this.path[this.i];
        while (target && Math.hypot(target.x - this.x, target.z - this.z) < 0.12 && this.i < this.path.length - 1) target = this.path[++this.i];
        const dx = target.x - this.x;
        const dz = target.z - this.z;
        const dist = Math.hypot(dx, dz);
        const want = Math.atan2(dx, dz);
        const err = wrap(want - this.yaw);
        this.yaw += clamp(err, -turnRate * dt, turnRate * dt);
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
        shell: new THREE.MeshPhysicalMaterial({ color: '#eceae6', roughness: 0.32, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
        graphite: new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.45, metalness: 0.35 }),
        rubber: new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.85 }),
        glass: new THREE.MeshPhysicalMaterial({ color: '#141a20', roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
        metal: new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.25, metalness: 0.95 }),
        bristle: new THREE.MeshStandardMaterial({ color: '#3d82c4', roughness: 0.7 }),
        copper: new THREE.MeshStandardMaterial({ color: '#c58b4f', roughness: 0.3, metalness: 1 })
    };
}

function buildRobotBody(m) {
    const root = new THREE.Group();
    // Shell: turned on a lathe, a soft rounded disc.
    const profile = [[0, 0.022], [0.15, 0.022], [0.166, 0.03], [0.172, 0.045], [0.171, 0.062], [0.164, 0.078], [0.148, 0.088], [0.12, 0.092], [0, 0.092]]
        .map(([r, y]) => new THREE.Vector2(r, y));
    const shell = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), m.shell);
    root.add(shell);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.163, 0.158, 0.02, 48), m.graphite);
    skirt.position.y = 0.014;
    root.add(skirt);
    // Glass top with a LiDAR turret and a ring light.
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.004, 48), m.glass);
    top.position.y = 0.093;
    root.add(top);
    const ringMat = new THREE.MeshBasicMaterial({ color: LED.clean.clone(), toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.0035, 6, 64), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.0955;
    root.add(ring);
    const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.038, 0.012, 28), m.graphite);
    turretBase.position.set(0, 0.101, -0.05);
    root.add(turretBase);
    const turret = new THREE.Group();
    turret.position.set(0, 0.107, -0.05);
    root.add(turret);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.018, 28), m.glass);
    cap.position.y = 0.009;
    turret.add(cap);
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.006), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.3, 0.25), toneMapped: false }));
    window.position.set(0, 0.009, 0.03);
    turret.add(window);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.004, 24), m.metal);
    button.position.set(0, 0.096, 0.055);
    root.add(button);
    // Bumper around the front half.
    const bumper = new THREE.Mesh(new THREE.TorusGeometry(0.173, 0.011, 8, 48, Math.PI * 0.95), m.rubber);
    bumper.rotation.x = Math.PI / 2;
    bumper.rotation.z = Math.PI * 0.025;
    bumper.position.y = 0.045;
    root.add(bumper);
    // Drive wheels, a caster and two side brushes.
    const wheels = [-1, 1].map((s) => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.022, 20), m.rubber);
        w.rotation.z = Math.PI / 2;
        w.position.set(s * 0.125, 0.034, 0);
        root.add(w);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.024, 12), m.metal);
        hub.rotation.z = Math.PI / 2;
        hub.position.copy(w.position);
        root.add(hub);
        return w;
    });
    const caster = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), m.metal);
    caster.position.set(0, 0.012, 0.12);
    root.add(caster);
    const brushes = [-1, 1].map((s) => {
        const b = new THREE.Group();
        b.position.set(s * 0.115, 0.008, 0.105);
        b.rotation.z = s * 0.08;
        root.add(b);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.008, 12), m.graphite);
        b.add(hub);
        for (let k = 0; k < 3; k++) {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.003, 0.005), m.bristle);
            arm.position.x = 0.029;
            const pivot = new THREE.Group();
            pivot.rotation.y = (k * TAU) / 3;
            pivot.add(arm);
            b.add(pivot);
        }
        return b;
    });
    root.traverse((o) => { if (o.isMesh) { o.castShadow = o.material !== ringMat && o.material !== window.material; o.receiveShadow = true; } });
    return { root, ring, ringMat, turret, wheels, brushes };
}

function buildDock(m) {
    const dock = new THREE.Group();
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.016, 0.16, 2, 0.006), m.graphite);
    base.position.set(0, 0.008, 0.06);
    dock.add(base);
    const tower = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.13, 0.07, 3, 0.02), m.graphite);
    tower.position.set(0, 0.065, -0.02);
    dock.add(tower);
    const face = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.09, 0.01, 2, 0.004), m.glass);
    face.position.set(0, 0.07, 0.016);
    dock.add(face);
    for (const s of [-1, 1]) {
        const contact = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.05), m.copper);
        contact.position.set(s * 0.07, 0.018, 0.08);
        dock.add(contact);
    }
    const ledMat = new THREE.MeshBasicMaterial({ color: LED.full.clone(), toneMapped: false });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), ledMat);
    led.position.set(0, 0.108, 0.023);
    dock.add(led);
    // Battery bars on the dock's glass face.
    const barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.3, 0.7), toneMapped: false });
    const bars = [0, 1, 2, 3].map((k) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.002), barMat);
        b.position.set(-0.054 + k * 0.036, 0.06, 0.022);
        dock.add(b);
        return b;
    });
    dock.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { dock, ledMat, bars };
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
        this.park = { x: dock.x + fx * 0.3, z: dock.z + fz * 0.3, yaw: wrap(dock.yaw + Math.PI) };
        this.approach = { x: dock.x + fx * 1.1, z: dock.z + fz * 1.1 };
        this.collider = { x: 0, z: 0, r: 0.2, person: true };
        owner.world.colliders.push(this.collider);
        owner.world.colliders.push({ x: dock.x, z: dock.z, r: 0.22, person: true });
        this.battery = battery;
        this.state = docked ? 'charge' : 'pick';
        this.timer = 0;
        this.walker = new Walker(docked ? this.park.x : this.approach.x, docked ? this.park.z : this.approach.z, docked ? this.park.yaw : dock.yaw);
        this.spin = 0;
        this.wheelTurn = 0;
        this.spiral = null;
        this.rider = null;
        this.blockedFor = 0;
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

    /** Something in front: the visitor, a person, or a cat on the floor. */
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
        for (const cat of this.owner.cats) if (cat.riding !== this && !cat.onBench && test(cat.x, cat.z, 0.45)) return true;
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
    }

    goHome() {
        const nav = this.owner.nav;
        const path = nav.findPath({ x: this.x, z: this.z }, this.approach);
        if (path) { this.walker.setPath(nav.smooth(path, 0.5)); this.state = 'home'; } else this.state = 'pick';
    }

    /** Put the body where the simulation is. */
    place() {
        this.body.root.position.set(this.walker.x, 0, this.walker.z);
        this.body.root.rotation.y = this.walker.yaw;
    }

    pose(dt) {
        const b = this.body;
        const w = this.walker;
        this.place();
        const cleaning = this.state === 'travel' || this.state === 'spot' || this.state === 'home';
        this.spin += dt * (cleaning ? 14 : 0);
        b.brushes.forEach((br, k) => { br.rotation.y = (k ? -1 : 1) * this.spin; });
        b.turret.rotation.y += dt * (this.state === 'charge' || this.state === 'full' ? 0.6 : 6);
        this.wheelTurn += (w.v * dt) / 0.034;
        b.wheels.forEach((wh) => { wh.rotation.x = this.wheelTurn; });
        const led = this.state === 'charge' ? LED.charge : this.state === 'full' ? LED.full : this.state === 'home' || this.state === 'dock' ? LED.home : this.blockedFor > 0.2 ? LED.wait : LED.clean;
        b.ringMat.color.lerp(led, 1 - Math.exp(-dt * 4));
        if (this.state === 'charge') b.ringMat.color.multiplyScalar(0.75 + 0.25 * Math.sin(performance.now() / 400));
        const d = this.dockObj;
        d.ledMat.color.copy(this.state === 'charge' ? LED.charge : LED.full);
        const level = Math.ceil(this.battery * 4);
        d.bars.forEach((bar, k) => { bar.visible = k < level; });
    }
}

// ---------------------------------------------------------------------------
// Cats
// ---------------------------------------------------------------------------

class Cat {
    constructor(owner, spec) {
        this.owner = owner;
        this.name = spec.name;
        this.spec = spec;
        this.walker = new Walker(spec.x, spec.z, rand(-Math.PI, Math.PI));
        this.state = 'idle';
        this.timer = rand(1, 4);
        this.weights = { stand: 1, walk: 0, sit: 0, groom: 0, loaf: 0, crouch: 0, leap: 0 };
        this.groomLeft = 0;
        this.earTwitch = [0, 0];
        this.earTimer = rand(2, 6);
        this.flick = 0;
        this.flickTimer = rand(4, 10);
        this.dist = Infinity;
        this.want = 'stand';
        this.phase = rand(0, TAU);
        this.blink = rand(2, 5);
        this.look = { yaw: 0, pitch: 0, toYaw: 0, toPitch: 0, timer: 0 };
        this.lift = 0;              // height of the surface it stands on
        this.jump = null;
        this.riding = null;
        this.onBench = null;
        this.collider = { x: spec.x, z: spec.z, r: 0.16, person: true };
        owner.world.colliders.push(this.collider);
        this.build(spec);
    }

    get x() { return this.walker.x; }
    get z() { return this.walker.z; }

    build(spec) {
        const model = buildCatModel(spec);
        this.model = model;
        this.root = model.root;
        this.eyes = model.eyes;
        this.owner.group.add(this.root);
    }

    // --- behaviour ----------------------------------------------------------

    setState(state, timer = 0) {
        this.state = state;
        this.timer = timer;
    }

    goTo(x, z) {
        const nav = this.owner.nav;
        const path = nav.findPath({ x: this.x, z: this.z }, { x, z });
        if (!path) return false;
        this.walker.setPath(nav.smooth(path, 0.6));
        return true;
    }

    /** Choose something to do next. */
    decide() {
        const r = Math.random();
        const robots = this.owner.robots.filter((b) => (b.state === 'travel' || b.state === 'spot') && !b.rider && Math.hypot(b.x - this.x, b.z - this.z) < 14);
        const riding = this.owner.cats.some((c) => c !== this && c.riding);
        if (robots.length && !riding && r < 0.3) {
            this.target = robots[0];
            this.setState('chase', 18);
            return;
        }
        const benches = this.owner.world.benches.filter((b) => Math.hypot(b.x - this.x, b.z - this.z) < 22 && !this.owner.cats.some((c) => c.onBench === b || c.benchTarget === b));
        if (benches.length && r < 0.6) {
            const b = benches[Math.floor(Math.random() * benches.length)];
            const side = Math.random() < 0.5 ? -1 : 1;
            const along = rand(-b.len / 2 + 0.4, b.len / 2 - 0.4);
            this.benchTarget = b;
            this.benchSpot = { x: b.x + along, z: b.z, side, approach: { x: b.x + along, z: b.z + side * 0.85 } };
            if (this.goTo(this.benchSpot.approach.x, this.benchSpot.approach.z)) { this.setState('toBench', 40); return; }
            this.benchTarget = null;
        }
        if (r < 0.8) {
            // Wander somewhere nearby.
            const nav = this.owner.nav;
            for (let k = 0; k < 12; k++) {
                const a = rand(0, TAU);
                const d = rand(3, 11);
                const x = this.x + Math.sin(a) * d;
                const z = this.z + Math.cos(a) * d;
                if (nav.walkable(x, z) && this.goTo(x, z)) { this.setState('walk', 30); this.pace = rand(0.38, 0.55); return; }
            }
        }
        this.want = Math.random() < 0.6 ? 'sit' : 'stand';
        this.setState('idle', rand(4, 10));
    }

    startJump(to, lift, then) {
        this.jump = { from: { x: this.x, z: this.z, y: this.lift }, to, lift, t: -0.28, dur: 0.48, then };
        this.walker.path = null;
        this.walker.v = 0;
        this.setState('jump');
    }

    update(dt, px, pz) {
        const w = this.walker;
        this.timer -= dt;
        this.dist = Math.hypot(px - w.x, pz - w.z);
        this.maybeGroom(dt);
        switch (this.state) {
            case 'idle':
                w.step(dt, { speed: 0 });
                if (this.timer <= 0) { this.want = 'stand'; this.decide(); }
                break;
            case 'walk':
                this.want = 'walk';
                if (w.step(dt, { speed: this.pace || 0.45, accel: 1.2, turnRate: 3.2 }) || this.timer <= 0) {
                    this.want = Math.random() < 0.5 ? 'sit' : 'stand';
                    this.setState('idle', rand(3, 9));
                }
                break;
            case 'toBench':
                this.want = 'walk';
                if (w.step(dt, { speed: 0.5, accel: 1.2, turnRate: 3.2 })) {
                    // Turn to the bench, crouch, and jump up.
                    const s = this.benchSpot;
                    w.yaw = Math.atan2(s.x - w.x, s.z - w.z);
                    this.startJump({ x: s.x, z: s.z }, this.benchTarget.seat, () => {
                        this.onBench = this.benchTarget;
                        this.want = Math.random() < 0.55 ? 'loaf' : 'sit';
                        this.walker.yaw += rand(-1.2, 1.2) + (Math.random() < 0.5 ? Math.PI : 0);
                        this.setState('bench', rand(12, 30));
                    });
                } else if (this.timer <= 0) { this.benchTarget = null; this.decide(); }
                break;
            case 'bench':
                if (this.timer <= 0) {
                    const s = this.benchSpot;
                    const down = { x: s.x, z: s.z + s.side * 0.7 };
                    w.yaw = Math.atan2(down.x - w.x, down.z - w.z);
                    this.startJump(down, 0, () => {
                        this.onBench = null;
                        this.benchTarget = null;
                        this.want = 'stand';
                        this.setState('idle', rand(1, 3));
                    });
                }
                break;
            case 'chase': {
                // Trot after the robot and hop on when close behind it.
                const bot = this.target;
                this.want = 'walk';
                if (!bot || bot.rider || !(bot.state === 'travel' || bot.state === 'spot') || this.timer <= 0) { this.target = null; this.decide(); break; }
                const d = Math.hypot(bot.x - this.x, bot.z - this.z);
                this.repath = (this.repath || 0) - dt;
                if (this.repath <= 0) { this.goTo(bot.x, bot.z); this.repath = 0.8; }
                w.step(dt, { speed: d > 2 ? 0.9 : 0.55, accel: 1.6, turnRate: 4 });
                if (d < 0.55) {
                    w.yaw = Math.atan2(bot.x - w.x, bot.z - w.z);
                    bot.rider = this;
                    this.startJump({ robot: bot }, 0.096, () => {
                        this.riding = bot;
                        this.rideYaw = wrap(w.yaw - bot.yaw);
                        this.want = Math.random() < 0.5 ? 'loaf' : 'sit';
                        this.setState('ride', rand(14, 30));
                    });
                }
                break;
            }
            case 'ride': {
                const bot = this.riding;
                w.x = bot.x;
                w.z = bot.z;
                this.rideYaw = damp(this.rideYaw, 0, 0.2, dt);
                w.yaw = bot.yaw + this.rideYaw;
                if (this.timer <= 0 || bot.state === 'home' || bot.state === 'dock' || bot.battery < 0.22) {
                    // Hop off to one side, somewhere walkable.
                    const nav = this.owner.nav;
                    let spot = null;
                    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI, 0]) {
                        const x = bot.x + Math.sin(bot.yaw + a) * 0.6;
                        const z = bot.z + Math.cos(bot.yaw + a) * 0.6;
                        if (nav.walkable(x, z)) { spot = { x, z }; break; }
                    }
                    if (!spot) { this.timer = 1; break; }
                    w.yaw = Math.atan2(spot.x - w.x, spot.z - w.z);
                    this.startJump(spot, 0, () => {
                        bot.rider = null;
                        this.riding = null;
                        this.want = 'stand';
                        this.setState('idle', rand(2, 5));
                    });
                }
                break;
            }
            case 'jump': {
                const j = this.jump;
                j.t += dt;
                if (j.t < 0) { this.want = 'crouch'; break; }
                const k = Math.min(1, j.t / j.dur);
                const to = j.to.robot ? { x: j.to.robot.x, z: j.to.robot.z } : j.to;
                const e = smooth(k);
                w.x = j.from.x + (to.x - j.from.x) * e;
                w.z = j.from.z + (to.z - j.from.z) * e;
                const peak = Math.max(j.from.y, j.lift) + 0.18;
                this.lift = (1 - k) * (1 - k) * j.from.y + 2 * (1 - k) * k * peak + k * k * j.lift;
                this.want = k < 0.85 ? 'leap' : 'crouch';
                if (k >= 1) {
                    this.lift = j.lift;
                    this.jump = null;
                    j.then();
                }
                break;
            }
            default:
                break;
        }
        // On a bench, stay on its seat.
        if (this.onBench && this.state === 'bench') this.lift = this.onBench.seat;
        if (this.state === 'ride' && this.riding) this.lift = 0.096;
        if (!this.onBench && !this.riding && this.state !== 'jump') this.lift = damp(this.lift, 0, 10, dt);
        this.collider.x = w.x;
        this.collider.z = w.z;
        this.collider.r = this.lift > 0.05 ? 0.01 : 0.16;
        // Glance at the visitor when near, otherwise look about now and then.
        const L = this.look;
        L.timer -= dt;
        const toPlayer = Math.hypot(px - w.x, pz - w.z);
        if (toPlayer < 3.5 && this.state !== 'jump') {
            L.toYaw = clamp(wrap(Math.atan2(px - w.x, pz - w.z) - w.yaw), -1.1, 1.1);
            L.toPitch = -0.25;
        } else if (L.timer <= 0) {
            L.timer = rand(1.5, 4);
            L.toYaw = this.state === 'walk' || this.state === 'chase' ? rand(-0.3, 0.3) : rand(-1, 1);
            L.toPitch = rand(-0.2, 0.15);
        }
    }

    /** Put the body where the simulation is. */
    place() {
        this.root.position.set(this.walker.x, this.lift, this.walker.z);
        this.root.rotation.y = this.walker.yaw;
    }

    /** A sitting cat now and then washes: a forepaw raised to the mouth for a few seconds. */
    maybeGroom(dt) {
        if (this.want === 'groom') {
            this.groomLeft -= dt;
            if (this.groomLeft <= 0) this.want = 'sit';
        } else if (this.want === 'sit' && this.state !== 'jump' && Math.random() < dt * 0.07) {
            this.want = 'groom';
            this.groomLeft = rand(3, 6.5);
        }
    }

    pose(dt, t) {
        const w = this.walker;
        // Blend towards the wanted pose (quickly for a jump, gently otherwise).
        for (const k of Object.keys(this.weights)) this.weights[k] = damp(this.weights[k], k === this.want ? 1 : 0, this.want === 'leap' || this.want === 'crouch' ? 14 : 5, dt);
        const total = Object.values(this.weights).reduce((a, b) => a + b, 0) || 1;
        const blend = (get) => Object.entries(this.weights).reduce((sum, [k, wt]) => sum + get(CAT_POSES[k]) * wt, 0) / total;
        const p = {
            drop: blend((q) => q.drop), pitch: blend((q) => q.pitch), spine: blend((q) => q.spine),
            neck: blend((q) => q.neck), head: blend((q) => q.head),
            front: [0, 1, 2].map((i) => blend((q) => q.front[i])),
            hind: [0, 1, 2].map((i) => blend((q) => q.hind[i])),
            tailLift: blend((q) => q.tailLift), tailCurl: blend((q) => q.tailCurl),
            raise: blend((q) => q.raise), lick: blend((q) => q.lick)
        };
        // Ear twitches and tail-tip flicks, each now and then, quick and brief.
        this.earTimer -= dt;
        if (this.earTimer <= 0) {
            this.earTimer = rand(2.5, 8);
            this.earTwitch[Math.random() < 0.5 ? 0 : 1] = 1;
        }
        this.earTwitch = this.earTwitch.map((e) => Math.max(0, e - dt * 5));
        this.flickTimer -= dt;
        if (this.flickTimer <= 0) {
            this.flickTimer = rand(3, 9);
            this.flick = 1;
        }
        this.flick = Math.max(0, this.flick - dt * 1.4);
        // Shell fur only where it can be seen.
        this.model.setFur(this.dist < 7);
        const speed = Math.abs(w.v);
        const gait = this.weights.walk;
        // The cycle keeps time with the ground covered, so paws do not slide.
        this.phase += dt * TAU * (speed / 0.34) * (speed > 0.02 ? 1 : 0);
        const stride = 0.42 * clamp(speed / 0.45, 0, 1.3) * gait;
        const L = this.look;
        L.yaw = damp(L.yaw, L.toYaw, 4, dt);
        L.pitch = damp(L.pitch, L.toPitch, 4, dt);
        this.place();
        applyCatPose(this.model, p, { gait, phase: this.phase, stride, look: L, t, seed: this.spec.seed, ears: this.earTwitch.map((e) => Math.sin(e * Math.PI)), flick: this.flick });
        // Blink every few seconds.
        this.blink -= dt;
        const closed = this.blink < 0.12;
        if (this.blink < 0) this.blink = rand(2.5, 6);
        this.eyes.forEach((e) => { e.scale.y = closed ? 0.12 : damp(e.scale.y, 1, 20, dt); });
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
        this.cats = [];
        this.robots = [
            new CleaningRobot(this, { name: 'Cleaning robot A', dock: { x: -51.74, z: -4.2, yaw: Math.PI / 2 }, region: [-50, -14, 14, 14], battery: 0.85 }),
            new CleaningRobot(this, { name: 'Cleaning robot B', dock: { x: 55.5, z: -9.74, yaw: 0 }, region: [14, -7, 66, 9], battery: 0.6, docked: true })
        ];
        this.cats.push(new Cat(this, { name: 'Ginger', seed: 1.3, x: -40, z: 9, tabby: true, base: '#c27a35', dark: '#7d3f14', light: '#ecd2a6', sheen: '#f3c891', muzzle: '#e2c29a', eyes: '#d49a2a', nose: '#c07d72', innerEar: '#d1a093' }));
        this.cats.push(new Cat(this, { name: 'Pepper', seed: 4.1, x: 4, z: 3, tabby: false, base: '#232226', dark: '#151418', light: '#eeece6', sheen: '#9a9aa3', muzzle: '#f0eee8', whitePaws: true, eyes: '#93b83c', nose: '#3a2d2e', innerEar: '#9c7f7e' }));
        // Clicking one opens a small card about it.
        this.robots.forEach((r, i) => museum.register({ id: `resident-robot-${i}`, room: roomAt(r.dockPose.x, r.dockPose.z)?.id || 'hall', kind: 'resident', title: r.name, subtitle: 'Autonomous floor care', payload: { robot: r, describe: () => this.describe({ robot: r }) }, icon: 'fas fa-robot', catalogue: false, noHighlight: true }, [r.body.root, r.dockObj.dock]));
        this.cats.forEach((c, i) => museum.register({ id: `resident-cat-${i}`, room: 'home', kind: 'resident', title: `${c.name}, a museum cat`, subtitle: 'Lives here', payload: { cat: c, describe: () => this.describe({ cat: c }) }, icon: 'fas fa-cat', catalogue: false, noHighlight: true }, [c.root]));
        this.sphere = new THREE.Sphere();
        this.robots.forEach((r) => r.pose(0));
        this.cats.forEach((c) => c.pose(0, 0));
    }

    /** Advance everyone; returns true when someone the visitor can see moved. */
    update(t, dt, px, pz, frustum) {
        if (dt <= 0) return false;
        let seen = false;
        const near = (x, z, r) => {
            if (Math.hypot(x - px, z - pz) > DRAW_RADIUS) return false;
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
            r.body.root.visible = Math.hypot(r.x - px, r.z - pz) < 60;
            if (show) { r.pose(dt); seen = seen || r.moving || r.state === 'charge'; }
        }
        for (const c of this.cats) {
            c.update(dt, px, pz);
            c.place();
            const show = near(c.x, c.z, 0.6);
            if (show) { c.pose(dt, t); seen = true; }
            else if (Math.hypot(c.x - px, c.z - pz) < 60 && Math.abs(c.walker.v) > 0.01) seen = true;
        }
        return seen;
    }

    /** Status text for the residents' panel. */
    describe(payload) {
        if (payload.robot) {
            const r = payload.robot;
            const words = { charge: 'Charging at its dock', full: 'Fully charged, about to set off', undock: 'Leaving its dock', pick: 'Choosing where to clean next', travel: 'Driving to the next spot', spot: 'Spot-cleaning', home: 'Battery low: returning to its dock', dock: 'Docking' };
            return { state: words[r.state] || 'Working', battery: Math.round(r.battery * 100), rider: r.rider?.name || null };
        }
        const c = payload.cat;
        const words = { idle: 'Taking in the exhibits', walk: 'Wandering the galleries', toBench: 'Heading for a bench', bench: 'Resting on a bench', chase: 'Following a cleaning robot', ride: `Riding ${c.riding?.name.toLowerCase() || 'a cleaning robot'}`, jump: 'Jumping' };
        return { state: words[c.state] || 'About', name: c.name };
    }
}
