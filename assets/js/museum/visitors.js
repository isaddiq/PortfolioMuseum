// Visitors: people who wander the museum, stop a few steps back from works,
// look around, and now and then raise a camera to take a picture.
//
// A cast of realistic Rocketbox people (assets/museum/people, built by
// scripts/build-visitors.py) shares one skeleton and a set of motion-captured
// clips: a walk, a standing idle, a look-around and a take-picture. Each person
// walks at the pace of their own stride, so feet never slide. Paths run over
// a coarse walkable grid in each room, through the doors and along the Grand
// Hall; a route that cannot be planned is never walked through a wall.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ROOM_BY_ID, roomAt } from './world.js';
import { clamp } from './util.js';
import { paintGlow } from './art.js';

const DIR = 'assets/museum/people/';
const ACTIVE_RADIUS = 34;          // animate people this close to the visitor
const RADIUS = 0.32;               // personal space, for paths and collisions
const BLEND = 4;                   // how fast one motion gives way to another (1/s)

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class Visitors {
    constructor({ scene, museum, world, count = 10 }) {
        this.scene = scene;
        this.museum = museum;
        this.world = world;
        this.count = count;
        this.people = [];
        this.graphs = new Map();
        this.group = new THREE.Group();
        this.group.name = 'visitors';
        scene.add(this.group);
        this.calm = museum.calm;
        this.flashTexture = new THREE.CanvasTexture(paintGlow());
    }

    /** Load the motions, then each person in turn; they join as they arrive. */
    async load() {
        const motions = await fetch(`${DIR}motions.json`).then((r) => r.json());
        this.clips = {};
        for (const [sex, set] of Object.entries(motions.clips)) {
            this.clips[sex] = Object.fromEntries(Object.entries(set).map(([name, json]) => [name, { json, clip: THREE.AnimationClip.parse(json) }]));
        }
        this.targets = this.museum.exhibits.filter((x) => x.view && x.focus && x.focus.y < 3.4 &&
            !['link', 'visitors', 'collabToggle', 'tv', 'room'].includes(x.kind) && roomAt(x.focus.x, x.focus.z));
        const loader = new GLTFLoader();
        for (const [index, member] of motions.cast.slice(0, this.count).entries()) {
            try {
                const gltf = await loader.loadAsync(DIR + member.file);
                this.people.push(this.spawn(gltf.scene, member.sex, index));
            } catch (error) {
                console.warn('Visitor could not load', member.file, error);
            }
        }
    }

    spawn(model, sex, index) {
        model.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.receiveShadow = true;
            o.frustumCulled = false;   // skinned: the bind-pose bounds lag the animation
        });
        const bone = (name) => model.getObjectByName(`Bip01_${name}`);
        const bones = { hips: model.getObjectByName('Bip01'), head: bone('Head'), lHand: bone('L_Hand'), rHand: bone('R_Hand'), lFoot: bone('L_Foot'), lToe: bone('L_Toe0') };
        // Stand on the floor and face +z (the direction the toes point).
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const toe = bones.lToe.getWorldPosition(new THREE.Vector3()).sub(bones.lFoot.getWorldPosition(new THREE.Vector3()));
        const wrapper = new THREE.Group();
        wrapper.rotation.y = -Math.atan2(toe.x, toe.z);
        wrapper.position.y = -box.min.y;
        wrapper.add(model);
        const root = new THREE.Group();
        root.add(wrapper);
        this.group.add(root);

        // The clips' hips height is the actor's; shift it to this person's.
        const set = this.clips[sex];
        const hipsY = bones.hips.position.y;
        const mixer = new THREE.AnimationMixer(model);
        const actions = {};
        for (const [name, { json, clip }] of Object.entries(set)) {
            const own = clip.clone();
            const track = own.tracks.find((t) => t.name === 'Bip01.position');
            if (track) {
                const shift = hipsY - json.hipsY;
                for (let i = 1; i < track.values.length; i += 3) track.values[i] += shift;
            }
            const action = mixer.clipAction(own);
            action.play();
            action.setEffectiveWeight(name === 'idle' ? 1 : 0);
            actions[name] = action;
        }
        actions.idle.time = Math.random() * set.idle.clip.duration;
        actions.walk.time = Math.random() * set.walk.clip.duration;
        actions.photo.setLoop(THREE.LoopOnce, 1);
        actions.photo.clampWhenFinished = true;
        actions.look.setLoop(THREE.LoopOnce, 1);
        actions.look.clampWhenFinished = true;

        const camera = this.makeCamera();
        this.group.add(camera.group);
        const collider = { x: 0, z: 0, r: RADIUS, person: true };
        this.world.colliders.push(collider);

        const stride = set.walk.json.speed || 1.3;
        const person = {
            index, root, model, mixer, actions, bones, camera, collider, sex,
            speed: stride * (0.92 + Math.random() * 0.12), stride,
            weights: { walk: 0, idle: 1, look: 0, photo: 0 },
            x: 0, z: 0, yaw: 0, mode: 'look', activity: 'idle', timer: 2 + Math.random() * 6,
            path: [], target: null, wait: 0, raised: 0, flashed: false, flash: 0
        };
        // Start somewhere in the museum, already looking at a work.
        for (let tries = 0; tries < 30 && !person.target; tries++) {
            const target = this.pickFrom(this.targets);
            const stand = target && this.standPoint(target);
            if (stand && !this.people.some((p) => Math.hypot(p.x - stand.x, p.z - stand.z) < 1.4)) {
                Object.assign(person, { x: stand.x, z: stand.z, target });
            }
        }
        if (!person.target) {
            person.target = this.targets[index % this.targets.length];
            Object.assign(person, { x: person.target.view.x, z: person.target.view.z });
        }
        person.yaw = Math.atan2(person.target.focus.x - person.x, person.target.focus.z - person.z);
        this.arrive(person, person.timer);
        this.place(person);
        return person;
    }

    /** A camera: body, grip, lens and a flash that fires once per shot. */
    makeCamera() {
        const group = new THREE.Group();
        const dark = new THREE.MeshStandardMaterial({ color: '#1a1b1e', roughness: 0.5, metalness: 0.25 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.095, 0.065), dark);
        group.add(body);
        const prism = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05), dark);
        prism.position.set(0, 0.058, -0.005);
        group.add(prism);
        const glass = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.15, metalness: 0.7 });
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.038, 0.075, 28), glass);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(0, -0.005, 0.07);
        group.add(lens);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.004, 8, 28), new THREE.MeshStandardMaterial({ color: '#b02a2a', roughness: 0.4 }));
        ring.position.set(0, -0.005, 0.105);
        group.add(ring);
        const flash = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this.flashTexture, color: new THREE.Color(4, 3.9, 3.6), transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
        }));
        flash.position.set(0, 0.06, 0.03);
        flash.scale.setScalar(0.55);
        group.add(flash);
        group.visible = false;
        return { group, flash };
    }

    /**
     * Somewhere to stand a few steps back from a work (further for big
     * ones), slightly to one side, clear of everything.
     */
    standPoint(target) {
        const room = roomAt(target.focus.x, target.focus.z);
        const dx = target.view.x - target.focus.x;
        const dz = target.view.z - target.focus.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = dx / len;
        const nz = dz / len;
        for (let i = 0; i < 8; i++) {
            const d = clamp(len * (0.6 + Math.random() * 0.3), 2.0, 4.5);
            const lat = (Math.random() - 0.5) * 1.4;
            const x = target.focus.x + nx * d - nz * lat;
            const z = target.focus.z + nz * d + nx * lat;
            if (roomAt(x, z) === room && this.clear(x, z, RADIUS + 0.2)) return { x, z };
        }
        return null;
    }

    clear(x, z, r) {
        for (const c of this.world.colliders) {
            if (c.person) continue;
            if (c.r !== undefined ? Math.hypot(x - c.x, z - c.z) < c.r + r
                : x > c.x1 - r && x < c.x2 + r && z > c.z1 - r && z < c.z2 + r) return false;
        }
        return true;
    }

    lineClear(a, b, r = RADIUS + 0.05) {
        const dist = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(dist / 0.2));
        for (let i = 1; i < steps; i++) {
            const x = a.x + ((b.x - a.x) * i) / steps;
            const z = a.z + ((b.z - a.z) * i) / steps;
            if (!roomAt(x, z) || !this.clear(x, z, r)) return false;
        }
        return true;
    }

    // -----------------------------------------------------------------------
    // Paths
    // -----------------------------------------------------------------------

    /** Inside and outside points of a room's way into the Grand Hall. */
    portal(room) {
        if (room.id === 'home') return { inside: { x: -22.2, z: 0 }, outside: { x: -17.8, z: 0 } };
        if (room.id === 'contact') return { inside: { x: 54.2, z: 0 }, outside: { x: 49.8, z: 0 } };
        const s = room.side === 'N' ? -1 : 1;
        return { inside: { x: room.cx, z: s * 9.7 }, outside: { x: room.cx, z: s * 6.0 } };
    }

    /** A coarse grid of walkable points per room, joined to their clear neighbours. */
    graph(room) {
        if (this.graphs.has(room.id)) return this.graphs.get(room.id);
        const [x1, z1, x2, z2] = room.rect;
        const step = room.id === 'hall' ? 2.4 : 2.2;
        const nodes = [];
        for (let x = x1 + 1.1; x <= x2 - 1.1 + 1e-6; x += step) {
            for (let z = z1 + 1.1; z <= z2 - 1.1 + 1e-6; z += step) {
                if (roomAt(x, z) === room && this.clear(x, z, RADIUS + 0.2)) nodes.push({ x, z, links: [] });
            }
        }
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
                if (d < step * 1.5 && this.lineClear(nodes[i], nodes[j])) {
                    nodes[i].links.push([j, d]);
                    nodes[j].links.push([i, d]);
                }
            }
        }
        const g = { room, nodes };
        this.graphs.set(room.id, g);
        return g;
    }

    /** Shortest walk between two points in one room, or null if there is none. */
    route(room, from, to) {
        if (this.lineClear(from, to)) return [to];
        const { nodes } = this.graph(room);
        const near = (p) => nodes.map((n, i) => [i, Math.hypot(n.x - p.x, n.z - p.z)])
            .filter(([, d]) => d < 6).sort((a, b) => a[1] - b[1]).slice(0, 8)
            .filter(([i]) => this.lineClear(p, nodes[i]));
        const starts = near(from);
        const ends = new Map(near(to).map(([i, d]) => [i, d]));
        if (!starts.length || !ends.size) return null;
        const dist = new Array(nodes.length).fill(Infinity);
        const prev = new Array(nodes.length).fill(-1);
        const open = new Set();
        for (const [i, d] of starts) {
            dist[i] = d;
            open.add(i);
        }
        let best = -1;
        let bestCost = Infinity;
        while (open.size) {
            let u = -1;
            for (const i of open) if (u < 0 || dist[i] < dist[u]) u = i;
            open.delete(u);
            if (dist[u] >= bestCost) break;
            if (ends.has(u) && dist[u] + ends.get(u) < bestCost) {
                bestCost = dist[u] + ends.get(u);
                best = u;
            }
            for (const [v, w] of nodes[u].links) {
                if (dist[u] + w < dist[v]) {
                    dist[v] = dist[u] + w;
                    prev[v] = u;
                    open.add(v);
                }
            }
        }
        if (best < 0) return null;
        const path = [];
        for (let i = best; i >= 0; i = prev[i]) path.unshift({ x: nodes[i].x, z: nodes[i].z });
        return [...path, to];
    }

    /** From here to there, through doors and the Grand Hall; null if impossible. */
    plan(from, to) {
        const a = roomAt(from.x, from.z) || ROOM_BY_ID.hall;
        const b = roomAt(to.x, to.z) || ROOM_BY_ID.hall;
        if (a === b) return this.route(a, from, to);
        const hall = ROOM_BY_ID.hall;
        const legs = [];
        let at = from;
        if (a !== hall) {
            const pa = this.portal(a);
            legs.push(this.route(a, at, pa.inside), [pa.outside]);
            at = pa.outside;
        }
        if (b !== hall) {
            const pb = this.portal(b);
            legs.push(this.route(hall, at, pb.outside), [pb.inside], this.route(b, pb.inside, to));
        } else {
            legs.push(this.route(hall, at, to));
        }
        return legs.some((leg) => !leg) ? null : legs.flat();
    }

    /** A random work, choosing the room first so busy walls don't draw everyone. */
    pickFrom(list) {
        const rooms = [...new Set(list.map((t) => roomAt(t.focus.x, t.focus.z)))];
        const room = rooms[Math.floor(Math.random() * rooms.length)];
        const inRoom = list.filter((t) => roomAt(t.focus.x, t.focus.z) === room);
        return inRoom[Math.floor(Math.random() * inRoom.length)];
    }

    /** The next work to visit and a walkable way there. */
    chooseTarget(person) {
        const here = roomAt(person.x, person.z);
        const taken = new Set(this.people.map((p) => p.target));
        const pool = this.targets.filter((t) => !taken.has(t) && t !== person.target);
        // Mostly keep browsing the same room; sometimes move on.
        const local = pool.filter((t) => roomAt(t.focus.x, t.focus.z) === here);
        const list = local.length && Math.random() < 0.65 ? local : pool;
        for (let tries = 0; tries < 12; tries++) {
            const target = this.pickFrom(list);
            const stand = target && this.standPoint(target);
            const path = stand && this.plan(person, stand);
            if (path) return { target, path };
        }
        return null;
    }

    // -----------------------------------------------------------------------
    // Frame update
    // -----------------------------------------------------------------------

    /** Advance everyone; returns true when someone near the visitor moved. */
    update(t, dt, px, pz) {
        let visible = false;
        for (const p of this.people) {
            this.think(p, dt, px, pz);
            if (Math.hypot(p.x - px, p.z - pz) < ACTIVE_RADIUS) {
                this.animate(p, dt);
                visible = true;
            } else {
                p.root.visible = false;
                p.camera.group.visible = false;
            }
            p.collider.x = p.x;
            p.collider.z = p.z;
        }
        return visible;
    }

    /** Stop at a work: stand, perhaps look around, perhaps take a picture. */
    arrive(p, seconds) {
        p.mode = 'look';
        p.timer = seconds;
        p.moving = false;
        const roll = Math.random();
        p.plans = roll < 0.5 ? ['photo'] : roll < 0.75 ? ['look'] : [];
        p.nextActivity = 1 + Math.random() * 2;
        this.setActivity(p, 'idle');
    }

    setActivity(p, name) {
        p.activity = name;
        if (name === 'photo' || name === 'look') {
            p.actions[name].reset().play();
            p.flashed = false;
            p.raised = 0;
        }
    }

    think(p, dt, px, pz) {
        if (p.mode === 'look') {
            p.timer -= dt;
            if (p.activity === 'idle') {
                p.nextActivity -= dt;
                if (p.nextActivity <= 0 && p.plans.length) this.setActivity(p, p.plans.shift());
            } else {
                // A one-shot clip (photo, look around) runs to its end, then rest.
                const a = p.actions[p.activity];
                if (a.time >= a.getClip().duration - 0.05) {
                    this.setActivity(p, 'idle');
                    p.nextActivity = 1.5 + Math.random() * 2;
                }
            }
            if (p.timer <= 0 && p.activity === 'idle' && !p.plans.length) {
                const next = this.chooseTarget(p);
                if (next) {
                    p.target = next.target;
                    p.path = next.path;
                    p.mode = 'walk';
                    p.wait = 0;
                } else {
                    p.timer = 2;
                }
            }
            return;
        }
        // Walking: give way to the visitor and to other people, then follow the path.
        const next = p.path[0];
        if (!next) {
            this.arrive(p, 6 + Math.random() * 6);
            return;
        }
        const dx = next.x - p.x;
        const dz = next.z - p.z;
        const dist = Math.hypot(dx, dz);
        const ahead = (ox, oz, range) => {
            const tx = ox - p.x;
            const tz = oz - p.z;
            const d = Math.hypot(tx, tz);
            return d < range && (tx * dx + tz * dz) / (d * (dist || 1) + 1e-6) > 0.4;
        };
        const blocked = ahead(px, pz, 1.2) || this.people.some((o) => o !== p && ahead(o.x, o.z, 0.95));
        if (blocked) {
            p.wait += dt;
            p.moving = false;
            if (p.wait > 3 + p.index * 0.3) {
                // Give up on this one and choose again from here.
                this.arrive(p, 0.5);
                p.plans = [];
            }
            return;
        }
        p.wait = 0;
        p.moving = true;
        if (dist < 0.2) {
            p.path.shift();
            return;
        }
        const step = Math.min(dist, p.speed * dt);
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
        p.wantYaw = Math.atan2(dx, dz);
    }

    animate(p, dt) {
        const walking = p.mode === 'walk' && p.moving;
        const want = p.mode === 'look' || !walking
            ? Math.atan2(p.target.focus.x - p.x, p.target.focus.z - p.z)
            : p.wantYaw ?? p.yaw;
        const d = ((want - p.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        p.yaw += d * (1 - Math.exp(-dt * (walking ? 7 : 2.5)));

        // Exactly one motion leads at a time; the others fade out.
        const lead = walking ? 'walk' : p.activity;
        const k = 1 - Math.exp(-dt * BLEND);
        for (const [name, action] of Object.entries(p.actions)) {
            p.weights[name] += ((name === lead ? 1 : 0) - p.weights[name]) * k;
            action.setEffectiveWeight(p.weights[name]);
        }
        p.actions.walk.setEffectiveTimeScale(p.speed / p.stride);
        p.mixer.update(dt);
        this.place(p);
        this.holdCamera(p, dt);
    }

    /**
     * While the take-picture motion is playing, put a camera between the
     * hands; show it once both hands are up near the face, flash once.
     */
    holdCamera(p, dt) {
        const cam = p.camera;
        const photo = p.weights.photo > 0.5 && p.activity === 'photo';
        if (!photo) {
            cam.group.visible = false;
            return;
        }
        p.root.updateMatrixWorld(true);
        const l = p.bones.lHand.getWorldPosition(_a);
        const r = p.bones.rHand.getWorldPosition(_b);
        const head = p.bones.head.getWorldPosition(_c);
        const mid = l.clone().add(r).multiplyScalar(0.5);
        const up = l.distanceTo(r) < 0.38 && mid.y > head.y - 0.32 && mid.distanceTo(head) < 0.55;
        p.raised = up ? p.raised + dt : 0;
        cam.group.visible = up || cam.group.visible && p.raised > 0;
        if (!cam.group.visible) return;
        // Lens points away from the eyes, through the hands; the body sits in
        // the palms, just ahead of the wrists.
        const aim = mid.clone().sub(head).setY(0).normalize();
        if (aim.lengthSq() < 0.5) aim.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        cam.group.position.copy(mid).addScaledVector(aim, 0.06);
        cam.group.position.y += 0.02;
        cam.group.lookAt(cam.group.position.clone().add(aim));
        if (p.raised > 0.9 && !p.flashed && !this.calm) {
            p.flashed = true;
            p.flash = 1;
        }
        p.flash = Math.max(0, p.flash - dt * 7);
        cam.flash.material.opacity = p.flash;
    }

    place(p) {
        p.root.visible = true;
        p.root.position.set(p.x, 0, p.z);
        p.root.rotation.y = p.yaw;
    }
}
