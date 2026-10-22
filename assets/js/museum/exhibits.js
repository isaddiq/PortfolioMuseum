// Hangs the portfolio in the building: every news item, paper, project,
// skill, tool, award and certificate becomes an exhibit you can walk up to
// and click. Textures load lazily by distance so memory stays bounded, and a
// few exhibits move (the news screen, the hologram, medals, skill columns).

import * as THREE from 'three';
import * as art from './art.js';
import { ROOMS, ROOM_BY_ID, gallerySurfaces, galleryPoint, SKIN, EYE } from './world.js';
import { textureInfo, pubVenue } from './data.js';
import { clamp, stripTags, formatDate, easeInOut, seededRandom } from './util.js';

const LOAD_RADIUS = 28;
const UNLOAD_RADIUS = 40;
const CONCURRENCY = 3;
const PLACEHOLDER = '#e3ddd2';
const CAPTION_PX = 560;            // caption pixels per metre, before supersampling
const HOLO = new THREE.Color(0.32, 1.35, 1.8);
const HOLO_GOLD = new THREE.Color(2.4, 1.75, 0.7);
const GLOBE_Y = 2.45;              // centre height of the world-map globe
const GLOBE_R = 1.45;
const GLOBE_SPIN = 0.14;           // radians per second when left alone

const FRAMES = {
    black: { border: 0.05, depth: 0.045 },
    oak: { border: 0.08, depth: 0.06 },
    gold: { border: 0.1, depth: 0.07 },
    white: { border: 0.06, depth: 0.05 },
    bezel: { border: 0.05, depth: 0.06 },
    none: null
};

const SKILL_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#0d9488', '#db2777', '#059669', '#ea580c', '#475569'];
const COUNTRY_COLORS = { 'South Korea': '#3b82f6', Pakistan: '#10b981', Australia: '#f59e0b' };

/** A picture-frame moulding with a bevel, its back face at z = 0. */
function frameGeometry(w, h, border, depth) {
    const bs = Math.min(border * 0.3, 0.022);
    const bt = depth * 0.3;
    const ow = w + border * 2 - bs * 2;
    const oh = h + border * 2 - bs * 2;
    const iw = w + bs * 2;
    const ih = h + bs * 2;
    const shape = new THREE.Shape();
    shape.moveTo(-ow / 2, -oh / 2);
    shape.lineTo(ow / 2, -oh / 2);
    shape.lineTo(ow / 2, oh / 2);
    shape.lineTo(-ow / 2, oh / 2);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-iw / 2, -ih / 2);
    hole.lineTo(-iw / 2, ih / 2);
    hole.lineTo(iw / 2, ih / 2);
    hole.lineTo(iw / 2, -ih / 2);
    hole.closePath();
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.005, depth - bt * 2), bevelEnabled: true, bevelThickness: bt,
        bevelSize: bs, bevelSegments: 2, curveSegments: 1
    });
    geo.translate(0, 0, bt);
    return geo;
}

export class Museum {
    constructor({ scene, renderer, data, world, requestRender }) {
        this.scene = scene;
        this.renderer = renderer;
        this.data = data;
        this.world = world;
        this.requestRender = requestRender;
        this.maxAniso = renderer.capabilities.getMaxAnisotropy();
        this.pxPerM = 760;
        this.pointScale = 800;
        this.calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
        this.exhibits = [];
        this.byId = new Map();
        this.pickables = [];
        this.slots = [];
        this.queue = [];
        this.active = 0;
        this.lamps = [];
        this.animators = [];
        this.player = { x: 0, z: 0 };
        this.group = new THREE.Group();
        this.group.name = 'exhibits';
        scene.add(this.group);

        const s = world.surfaces || {};
        this.frameMats = {
            black: new THREE.MeshStandardMaterial({ color: '#121110', roughness: 0.3, metalness: 0.2 }),
            oak: new THREE.MeshStandardMaterial({ color: '#ffffff', map: s.grain || null, roughness: 0.48 }),
            gold: new THREE.MeshStandardMaterial({ color: '#d4a94f', roughness: 0.3, metalness: 1, normalMap: s.plaster?.normal || null, normalScale: new THREE.Vector2(0.35, 0.35) }),
            white: new THREE.MeshStandardMaterial({ color: '#f1ede6', roughness: 0.55 }),
            bezel: new THREE.MeshStandardMaterial({ color: '#0b0c0f', roughness: 0.2, metalness: 0.55 })
        };
        if (!s.grain) this.frameMats.oak.color.set('#7a5634');
        this.matMat = new THREE.MeshStandardMaterial({ color: '#f3efe7', roughness: 0.92 });
        this.plaqueEdge = new THREE.MeshStandardMaterial({ color: '#8a6a43', roughness: 0.35, metalness: 0.85 });
        this.washTexture = new THREE.CanvasTexture(art.paintWash());
        this.washTexture.colorSpace = THREE.SRGBColorSpace;
        this.glowTexture = new THREE.CanvasTexture(art.paintGlow());
        this.beamTexture = new THREE.CanvasTexture(art.paintBeam());
        this.plinthMat = new THREE.MeshStandardMaterial({ color: '#f1ede6', roughness: 0.6, normalMap: s.plaster?.normal || null, normalScale: new THREE.Vector2(0.2, 0.2) });
        this.darkStone = new THREE.MeshStandardMaterial({ color: '#25221f', roughness: 0.3, metalness: 0.15 });
    }

    build() {
        this.buildLobby();
        this.buildHall();
        this.buildEducation();
        this.buildExperience();
        this.buildPublications();
        this.buildProjects();
        this.buildSkills();
        this.buildTools();
        this.buildAwards();
        this.buildActivities();
        this.buildContact();
        this.buildLamps();
        // Lit meshes cast and receive shadows; unlit art and glows never do.
        const lit = (m) => [].concat(m.material).some((x) => x && !x.isMeshBasicMaterial && !x.isShaderMaterial);
        this.group.traverse((m) => {
            if (!m.isMesh || m.userData.noShadow) return;
            const on = lit(m);
            m.castShadow = on;
            m.receiveShadow = on;
        });
    }

    // -----------------------------------------------------------------------
    // Exhibit registry
    // -----------------------------------------------------------------------

    register(exhibit, meshes, focus, normal, size) {
        const id = exhibit.id || `exhibit-${this.exhibits.length}`;
        const record = { ...exhibit, id, focus };
        if (focus && normal) record.view = this.viewFor(focus, normal, size || 1.5);
        this.exhibits.push(record);
        this.byId.set(id, record);
        for (const mesh of meshes.filter(Boolean)) {
            mesh.traverse((m) => {
                if (m.isMesh || m.isSprite) {
                    m.userData.exhibitId = id;
                    this.pickables.push(m);
                }
            });
        }
        return record;
    }

    viewFor(focus, normal, size) {
        const dist = clamp(size * 1.15 + 0.9, 2.2, 7.5);
        const x = focus.x + normal.x * dist;
        const z = focus.z + normal.z * dist;
        return {
            x, z,
            yaw: Math.atan2(normal.x, normal.z),
            pitch: clamp(Math.atan2(focus.y - EYE, dist), -0.55, 0.55)
        };
    }

    // -----------------------------------------------------------------------
    // Animation
    // -----------------------------------------------------------------------

    /** Run the animators near the visitor. Returns true when anything moved. */
    animate(t, dt, x, z) {
        this.player.x = x;
        this.player.z = z;
        let changed = false;
        for (const a of this.animators) {
            if (a.always?.() || Math.hypot(a.x - x, a.z - z) < a.radius) {
                if (a.update(t, dt)) changed = true;
            }
        }
        return changed;
    }

    /** Called by main when the visitor walks into a room. */
    onRoomEnter(id) {
        if (id === 'skills' && this.skillRise && !this.calm) this.skillRise.pending = true;
    }

    setViewport(heightPx, fovDeg) {
        this.pointScale = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
        if (this.collab?.dotMat) this.collab.dotMat.uniforms.uScale.value = this.pointScale;
    }

    // -----------------------------------------------------------------------
    // Lazy textures
    // -----------------------------------------------------------------------

    addSlot(material, paint, at, { persistent = false, placeholder = PLACEHOLDER, target = null } = {}) {
        const slot = { material, paint, x: at.x, z: at.z, persistent, placeholder, target, state: 'empty', texture: null, gen: 0 };
        material.color.set(placeholder);
        this.slots.push(slot);
        return slot;
    }

    updateSlots(x, z) {
        this.player.x = x;
        this.player.z = z;
        for (const slot of this.slots) {
            const d = Math.hypot(slot.x - x, slot.z - z);
            if (slot.state === 'empty' && (slot.persistent || d < LOAD_RADIUS)) {
                slot.state = 'queued';
                this.queue.push(slot);
            } else if (slot.state === 'ready' && !slot.persistent && d > UNLOAD_RADIUS) {
                this.unloadSlot(slot);
            }
        }
        this.pump();
    }

    /** Paint a slot again (its content changed); the old texture stays until then. */
    repaint(slot) {
        if (slot.state === 'queued') return;
        slot.state = 'queued';
        this.queue.push(slot);
        this.pump();
    }

    pump() {
        if (!this.queue.length) return;
        const { x, z } = this.player;
        this.queue.sort((a, b) => (a.persistent === b.persistent ? 0 : a.persistent ? 1 : -1) ||
            Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
        while (this.active < CONCURRENCY && this.queue.length) {
            const slot = this.queue.shift();
            if (!slot.persistent && Math.hypot(slot.x - x, slot.z - z) > UNLOAD_RADIUS) {
                slot.state = slot.texture ? 'ready' : 'empty';
                continue;
            }
            this.active += 1;
            slot.state = 'loading';
            const gen = ++slot.gen;
            Promise.resolve()
                .then(() => slot.paint(slot.target))
                .then((source) => {
                    if (slot.gen !== gen) return;
                    if (source) this.applySource(slot, source);
                    slot.state = 'ready';
                })
                .catch((error) => {
                    console.warn('Exhibit texture failed', error);
                    slot.state = 'ready';
                })
                .finally(() => {
                    this.active -= 1;
                    this.requestRender();
                    this.pump();
                });
        }
    }

    applySource(slot, source) {
        const tex = source.isTexture ? source : (source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.maxAniso;
        tex.needsUpdate = true;
        const old = slot.texture;
        slot.texture = tex;
        slot.material.map = tex;
        slot.material.color.set('#ffffff');
        slot.material.needsUpdate = true;
        if (old && old !== tex) old.dispose();
    }

    unloadSlot(slot) {
        slot.gen += 1;
        slot.texture?.dispose();
        slot.texture = null;
        slot.material.map = null;
        slot.material.color.set(slot.placeholder);
        slot.material.needsUpdate = true;
        slot.state = 'empty';
    }

    /** Share of the textures within reach that are on screen (for the loader). */
    nearbyProgress(x, z) {
        const near = this.slots.filter((s) => s.persistent || Math.hypot(s.x - x, s.z - z) < LOAD_RADIUS);
        if (!near.length) return 1;
        return near.filter((s) => s.state === 'ready').length / near.length;
    }

    // -----------------------------------------------------------------------
    // Building blocks
    // -----------------------------------------------------------------------

    /**
     * Image painter: the gallery-sized copy first, then the original, then
     * fallbacks. The result is sized to the frame (pixels per metre), so a
     * small certificate never holds a 2000-pixel texture.
     */
    imagePainter(src, { aspect, mat = '#f4efe6', fallbacks = [], cover = false, pad = 0 } = {}) {
        const info = textureInfo(this.data, src);
        const sources = [info?.src, info && info.src !== src ? src : null];
        for (const fb of fallbacks) {
            const fi = textureInfo(this.data, fb);
            sources.push(fi?.src, fb);
        }
        return async (target) => {
            const img = await art.loadFirstImage(sources);
            if (!img) return null;
            const maxEdge = clamp(Math.round(Math.max(target?.w || 2, target?.h || 2) * this.pxPerM), 384, 2048);
            const imgAspect = img.width / img.height;
            if (!aspect || (Math.abs(imgAspect - aspect) / aspect < 0.02 && !pad)) return art.downscale(img, maxEdge);
            return cover ? art.composeCover(img, aspect, maxEdge) : art.composeContain(img, aspect, { mat, pad, maxEdge });
        };
    }

    aspectOf(src, fallback = 4 / 3) {
        const info = textureInfo(this.data, src);
        return info && info.w ? info.w / info.h : fallback;
    }

    /** Fit (w, h) of an aspect ratio inside a box. */
    fitBox(aspect, maxW, maxH) {
        let w = maxW;
        let h = w / aspect;
        if (h > maxH) {
            h = maxH;
            w = h * aspect;
        }
        return { w, h };
    }

    surfacePose(surface, offset, out = 0) {
        const tx = surface.nz;
        const tz = -surface.nx;
        return {
            x: surface.x + tx * offset + surface.nx * out,
            z: surface.z + tz * offset + surface.nz * out,
            rotY: Math.atan2(surface.nx, surface.nz)
        };
    }

    /**
     * Hang a framed picture on a wall surface, with its caption plaque above
     * it, a picture light above that and a pool of light on the wall.
     * `offset` is the picture's centre along the wall.
     */
    hang(surface, offset, spec) {
        const {
            w, h, y = 1.7, frame = 'black', paint, label, exhibit, persistent = false, wash = true,
            placeholder, mat = 0
        } = spec;
        const lamp = spec.lamp ?? wash;
        const pose = this.surfacePose(surface, offset);
        const group = new THREE.Group();
        group.position.set(pose.x, 0, pose.z);
        group.rotation.y = pose.rotY;
        this.group.add(group);
        const f = FRAMES[frame];
        const border = f ? f.border : 0;
        const meshes = [];
        const innerW = w + mat * 2;
        const innerH = h + mat * 2;

        let artZ = 0.004;
        if (f) {
            const frameMesh = new THREE.Mesh(frameGeometry(innerW, innerH, border, f.depth), this.frameMats[frame]);
            frameMesh.position.set(0, y, 0.004);
            group.add(frameMesh);
            meshes.push(frameMesh);
            artZ = 0.004 + f.depth * 0.55;
        }
        if (mat > 0) {
            const matMesh = new THREE.Mesh(new THREE.PlaneGeometry(innerW + 0.01, innerH + 0.01), this.matMat);
            matMesh.position.set(0, y, artZ - 0.004);
            group.add(matMesh);
            meshes.push(matMesh);
        }
        const artMat = new THREE.MeshBasicMaterial({ color: placeholder || PLACEHOLDER, toneMapped: false });
        const artMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), artMat);
        artMesh.position.set(0, y, artZ);
        group.add(artMesh);
        meshes.push(artMesh);
        const world = new THREE.Vector3();
        artMesh.getWorldPosition(world);
        this.addSlot(artMat, paint, world, { persistent, placeholder, target: { w, h } });

        const outerW = innerW + border * 2;
        const bottom = y - innerH / 2 - border;
        let top = y + innerH / 2 + border;
        let spanW = outerW;
        if (label) {
            const lw = label.w || clamp(outerW, 1.1, 4.2);
            const lh = label.h || (lw >= 2 ? 0.56 : 0.44);
            const ly = top + (label.gap ?? 0.14) + lh / 2;
            const face = new THREE.MeshBasicMaterial({ color: '#f6f3ee', toneMapped: false });
            const edge = this.plaqueEdge;
            const plaque = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, 0.016), [edge, edge, edge, edge, face, edge]);
            plaque.position.set(0, ly, 0.012);
            group.add(plaque);
            meshes.push(plaque);
            const lp = new THREE.Vector3();
            plaque.getWorldPosition(lp);
            const painter = label.paint || (() => art.paintCaption({
                eyebrow: label.eyebrow, title: label.title, line: label.line, accent: label.accent,
                width: Math.round(lw * CAPTION_PX), height: Math.round(lh * CAPTION_PX)
            }));
            this.addSlot(face, painter, lp, { persistent, placeholder: '#f6f3ee' });
            top = ly + lh / 2;
            spanW = Math.max(spanW, lw);
        }

        if (wash) this.addWash(group, spanW, top - bottom, top);
        if (lamp) {
            group.updateMatrixWorld(true);
            const hood = group.localToWorld(new THREE.Vector3(0, top + 0.2, 0.27));
            const arm = group.localToWorld(new THREE.Vector3(0, top + 0.2, 0.135));
            this.lamps.push({ hood, arm, rotY: pose.rotY, len: clamp(spanW * 0.55, 0.35, 1.6) });
        }

        if (exhibit) {
            const focus = { x: world.x, y, z: world.z };
            this.register(exhibit, meshes, focus, new THREE.Vector3(surface.nx, 0, surface.nz), Math.max(spanW, top - bottom));
        }
        return group;
    }

    /** A soft pool of light on the wall, brightest just under the lamp. */
    addWash(group, w, h, top) {
        const mat = new THREE.MeshBasicMaterial({
            map: this.washTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            opacity: 0.42, toneMapped: false
        });
        this.world.themed.washes.push(mat);
        const ww = w * 1.55 + 0.7;
        const wh = h * 1.35 + 0.9;
        const wash = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), mat);
        wash.position.set(0, top + 0.32 - wh / 2, 0.003);
        wash.renderOrder = -1;
        wash.userData.noPick = true;
        group.add(wash);
    }

    /** Brass picture lights for every lit work: three instanced draw calls. */
    buildLamps() {
        const n = this.lamps.length;
        if (!n) return;
        const bronze = this.world.materials.bronzeMat;
        const hoodGeo = new THREE.CylinderGeometry(0.04, 0.055, 1, 20);
        hoodGeo.rotateZ(Math.PI / 2);
        const armGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 8);
        armGeo.rotateX(Math.PI / 2);
        const glowGeo = new THREE.BoxGeometry(1, 0.01, 0.045);
        const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.25, 1.7), toneMapped: false });
        glowMat.userData.day = glowMat.color.clone();
        glowMat.userData.night = new THREE.Color(3.2, 2.7, 1.9);
        this.world.themed.emissive.push(glowMat);
        const hoods = new THREE.InstancedMesh(hoodGeo, bronze, n);
        const arms = new THREE.InstancedMesh(armGeo, bronze, n);
        const glows = new THREE.InstancedMesh(glowGeo, glowMat, n);
        const d = new THREE.Object3D();
        this.lamps.forEach((lamp, i) => {
            d.rotation.set(0, lamp.rotY, 0);
            d.position.copy(lamp.hood);
            d.scale.set(lamp.len, 1, 1);
            d.updateMatrix();
            hoods.setMatrixAt(i, d.matrix);
            d.position.y -= 0.05;
            d.scale.set(lamp.len * 0.9, 1, 1);
            d.updateMatrix();
            glows.setMatrixAt(i, d.matrix);
            d.position.copy(lamp.arm);
            d.scale.set(1, 1, 0.27);
            d.updateMatrix();
            arms.setMatrixAt(i, d.matrix);
        });
        for (const m of [hoods, arms, glows]) {
            m.userData.noPick = true;
            m.computeBoundingSphere();
            this.group.add(m);
        }
        glows.userData.noShadow = true;
    }

    /** A text plaque painted on a canvas, flush on the wall. */
    plaque(surface, offset, { w, h, y, paint, exhibit, persistent = false, wash = false, frame = 'none', placeholder = '#f4efe6', lamp }) {
        return this.hang(surface, offset, { w, h, y, paint, exhibit, persistent, wash, frame, placeholder, lamp });
    }

    /**
     * Spread items along a sequence of wall surfaces in order, using about the
     * same share of every wall, then space each wall's items evenly.
     */
    distribute(items, surfaces, gap = 0.6) {
        const need = items.reduce((s, it) => s + it.width + gap, 0);
        const cap = surfaces.reduce((s, sf) => s + sf.length, 0);
        const ratio = Math.min(1, need / cap);
        const buckets = surfaces.map(() => []);
        let si = 0;
        let used = 0;
        for (const item of items) {
            const w = item.width + gap;
            while (si < surfaces.length - 1 && used > 0 && used + w > surfaces[si].length * ratio + w * 0.5) {
                si += 1;
                used = 0;
            }
            buckets[si].push(item);
            used += w;
        }
        buckets.forEach((bucket, i) => {
            if (!bucket.length) return;
            const surface = surfaces[i];
            const total = bucket.reduce((s, it) => s + it.width, 0);
            const scale = total > surface.length * 0.97 ? (surface.length * 0.97) / (total + gap * (bucket.length - 1)) : 1;
            const free = surface.length - total * scale;
            const space = free / (bucket.length + 1);
            let cursor = -surface.length / 2 + space;
            for (const item of bucket) {
                const width = item.width * scale;
                item.place(surface, cursor + width / 2, scale, width);
                cursor += width + space;
            }
        });
    }

    roomIntro(room, text) {
        const surfaces = gallerySurfaces(room);
        this.plaque(surfaces.frontRight, 0, {
            w: 2.7, h: 3.0, y: 2.2, wash: true,
            paint: () => art.paintTextPanel({
                width: 900, height: 1000, eyebrow: `Gallery ${room.numeral}`, title: room.title, subtitle: room.tagline,
                paragraphs: [text], footer: 'Click for the gallery guide', accent: room.accent, titleSize: 92, bodySize: 34, icon: room.icon
            }),
            exhibit: { id: `room-${room.id}`, room: room.id, kind: 'room', title: `${room.title}: gallery guide`, subtitle: room.tagline, payload: room, icon: room.icon, catalogue: false }
        });
    }

    lectern(x, z, rotY, { w = 1.6, paint, exhibit, persistent = false }) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        group.rotation.y = rotY;
        this.group.add(group);
        const base = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, 0.55), this.darkStone);
        base.position.set(0, 0.5, 0);
        group.add(base);
        const mat = new THREE.MeshBasicMaterial({ color: '#1b1a18', toneMapped: false });
        const top = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, 0.62), mat);
        top.position.set(0, 1.12, 0.09);
        top.rotation.x = -0.96;
        group.add(top);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.7), this.darkStone);
        lid.position.set(0, 1.1, 0.05);
        lid.rotation.x = -0.96 + Math.PI / 2;
        group.add(lid);
        const wp = new THREE.Vector3();
        top.getWorldPosition(wp);
        group.userData.slot = this.addSlot(mat, paint, wp, { persistent, placeholder: '#1b1a18' });
        this.world.colliders.push({ x, z, r: Math.max(w, 0.7) * 0.55 + 0.1 });
        const normal = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
        this.register(exhibit, [base, top], { x: wp.x, y: 1.1, z: wp.z }, normal, 1.0);
        return group;
    }

    holoMaterial(color, opacity = 1, extra = {}) {
        return new THREE.MeshBasicMaterial({
            color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
            toneMapped: false, side: THREE.DoubleSide, ...extra
        });
    }

    // -----------------------------------------------------------------------
    // Lobby (home)
    // -----------------------------------------------------------------------

    buildLobby() {
        const { profile, highlights, scholar } = this.data;
        const room = ROOM_BY_ID.home;
        const f = SKIN + 0.01;

        // Portrait prism: three portraits on a dark triangular column.
        const cx = -36;
        const R = 1.75;
        const apothem = R * Math.cos(Math.PI / 3);
        const height = 4.4;
        const prism = new THREE.Mesh(new THREE.CylinderGeometry(R, R, height, 3), this.darkStone);
        prism.rotation.y = Math.PI / 2;
        prism.position.set(cx, height / 2, 0);
        this.group.add(prism);
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.5, R + 0.6, 0.3, 3), this.plinthMat);
        plinth.rotation.y = Math.PI / 2;
        plinth.position.set(cx, 0.15, 0);
        this.group.add(plinth);
        this.world.colliders.push({ x: cx, z: 0, r: R + 0.45 });
        const portraits = profile.portraits || [];
        const faceAngles = [Math.PI, Math.PI + (2 * Math.PI) / 3, Math.PI - (2 * Math.PI) / 3];
        const faceW = R * Math.sqrt(3);
        portraits.slice(0, 3).forEach((portrait, i) => {
            const a = faceAngles[i];
            const nx = Math.cos(a);
            const nz = Math.sin(a);
            const surface = { x: cx + nx * (apothem + 0.005), z: nz * (apothem + 0.005), nx, nz, length: faceW };
            this.hang(surface, 0, {
                w: faceW * 0.74, h: 2.8, y: 2.35, frame: 'gold', persistent: true, wash: false,
                paint: this.imagePainter(portrait.src, { aspect: (faceW * 0.74) / 2.8, cover: true }),
                exhibit: i === 0 ? {
                    id: 'profile', room: 'home', kind: 'profile', title: profile.name, subtitle: profile.title, payload: profile, icon: 'fas fa-user'
                } : { id: `portrait-${i}`, room: 'home', kind: 'profile', title: `Portrait ${i + 1}`, subtitle: profile.name, payload: profile, catalogue: false }
            });
        });

        // Name lectern in front of the main portrait.
        this.lectern(-40.6, 0, -Math.PI / 2, {
            w: 2.2, persistent: true,
            paint: () => art.paintNameLectern(profile),
            exhibit: { id: 'about-lectern', room: 'home', kind: 'about', title: 'About me', subtitle: profile.title, payload: profile, catalogue: false }
        });

        // West wall: name above the entrance and the About Me texts.
        const west = { x: -52 + f, z: 0, nx: 1, nz: 0, length: 32 };
        this.plaque(west, 0, {
            w: 12, h: 2.2, y: 5.85, persistent: true, placeholder: room.paint,
            paint: () => art.paintLettering({ text: profile.name.toUpperCase(), sub: profile.tagline, width: 2400, height: 440, background: room.paint, color: '#2a2622' })
        });
        const about = profile.about || [];
        const aboutPanels = [
            { offset: -9.5, paragraphs: about.slice(0, 1), title: 'About Me' },
            { offset: 9.5, paragraphs: about.slice(1), title: 'Research' }
        ];
        aboutPanels.forEach((panel, i) => {
            this.plaque(west, panel.offset, {
                w: 7.2, h: 4.0, y: 2.7, persistent: true, wash: true,
                paint: () => art.paintTextPanel({
                    width: 1600, height: 890, eyebrow: i === 0 ? 'Welcome' : 'About me, continued', title: panel.title,
                    paragraphs: panel.paragraphs, accent: GOLD_ACCENT, titleSize: 76, bodySize: 33, footer: 'Click to read'
                }),
                exhibit: { id: i === 0 ? 'about' : 'about-2', room: 'home', kind: 'about', title: 'About me', subtitle: 'Biography and research focus', payload: profile, icon: 'fas fa-id-card', catalogue: i === 0 }
            });
        });

        // North wall: research interests, each captioned above.
        const north = { x: -36, z: -16 + f, nx: 0, nz: 1, length: 32 };
        this.plaque(north, 0, {
            w: 9, h: 1.0, y: 5.75, persistent: true, placeholder: room.paint,
            paint: () => art.paintLettering({ text: 'RESEARCH INTERESTS', width: 1800, height: 200, background: room.paint, color: '#2a2622', size: 120 })
        });
        const interests = profile.researchInterests || [];
        const spacing = Math.min(3.7, 30 / Math.max(interests.length, 1));
        interests.forEach((interest, i) => {
            const offset = (i - (interests.length - 1) / 2) * spacing;
            const w = Math.min(2.4, spacing - 0.7);
            this.hang(north, offset, {
                w, h: w * 0.75, y: 2.7, frame: 'white', mat: 0.06, persistent: true,
                paint: this.imagePainter(interest.image),
                label: { eyebrow: 'Research interest', title: interest.title, line: interest.description, accent: interest.accent || GOLD_ACCENT, h: 0.62, w: Math.max(w + 0.24, spacing - 0.35) },
                exhibit: { id: `interest-${i}`, room: 'home', kind: 'interest', title: interest.title, subtitle: interest.description, payload: interest, icon: interest.icon }
            });
        });

        // South wall: the news screen, flanked by the four latest highlights.
        const south = { x: -36, z: 16 - f, nx: 0, nz: -1, length: 32 };
        this.plaque(south, 0, {
            w: 7, h: 1.0, y: 5.75, persistent: true, placeholder: room.paint,
            paint: () => art.paintLettering({ text: 'NEWS & HIGHLIGHTS', width: 1400, height: 200, background: room.paint, color: '#2a2622', size: 120 })
        });
        this.buildNewsTV(south, 0, 6.0, 2.85);
        const offsets = [-6.9, 6.9, -12.6, 12.6].slice(0, highlights.length).sort((a, b) => a - b);
        highlights.forEach((item, i) => {
            const image = item.thumbnail || item.images?.[0]?.src;
            const fallback = item.images?.[0]?.fallback;
            this.hang(south, offsets[i], {
                w: 3.4, h: 2.27, y: 2.35, frame: 'black', persistent: true,
                paint: this.imagePainter(image, { aspect: 1.5, mat: '#1d1b18', fallbacks: [item.images?.[0]?.src, fallback, 'assets/images/covers/home-cover.webp'], cover: !!item.thumbnail }),
                label: { eyebrow: `${item.type} · ${formatDate(item.date)}`, title: item.title, line: item.summary, h: 0.82 },
                exhibit: { id: `news-${item.id}`, room: 'home', kind: 'news', title: item.title, subtitle: `${item.type} · ${formatDate(item.date)}`, payload: item, icon: item.icon }
            });
        });

        // East wall: Scholar metrics and the museum directory.
        const east = { x: -20 - f, z: 0, nx: -1, nz: 0, length: 32 };
        this.plaque(east, -11, {
            w: 5.4, h: 3.42, y: 2.6, persistent: true, wash: true,
            paint: () => art.paintScholar(scholar, this.data.pubStats),
            exhibit: { id: 'scholar', room: 'home', kind: 'scholar', title: 'Google Scholar metrics', subtitle: scholar ? `${scholar.citations} citations · h-index ${scholar.hIndex} · i10-index ${scholar.i10Index}` : 'Citation metrics', payload: scholar, icon: 'fas fa-graduation-cap' }
        });
        this.plaque(east, 11, {
            w: 5.4, h: 2.93, y: 2.6, persistent: true, wash: true,
            paint: () => art.paintFloorPlan(ROOMS.filter((r) => r.id !== 'hall').concat(ROOM_BY_ID.hall), { highlight: 'home' }),
            exhibit: { id: 'directory', room: 'home', kind: 'directory', title: 'Museum directory', subtitle: 'Floor plan and gallery guide', payload: null, icon: 'fas fa-map' }
        });
        this.plaque(east, 0, {
            w: 5.6, h: 1.2, y: 6.0, persistent: true, placeholder: room.paint,
            paint: () => art.paintLettering({ text: 'GRAND HALL', sub: 'Galleries I – VIII · Contact', width: 1400, height: 300, background: room.paint, color: '#2a2622', size: 110 })
        });
    }

    /**
     * The lobby's wall-mounted TV: every news item in turn, with a slow
     * Ken Burns drift over its photo, a crossfade, a progress bar and a
     * scrolling headline ticker. Only the photo, caption and ticker are
     * textures; the motion is all texture offsets, so it costs almost nothing.
     */
    buildNewsTV(surface, offset, w, y) {
        const items = (this.data.news || []).filter(Boolean);
        if (!items.length) return;
        const h = w * 9 / 16;
        const pose = this.surfacePose(surface, offset);
        const group = new THREE.Group();
        group.position.set(pose.x, 0, pose.z);
        group.rotation.y = pose.rotY;
        this.group.add(group);

        const standoff = 0.05;
        const thick = 0.06;
        const body = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, thick), this.frameMats.bezel);
        body.position.set(0, y, standoff + thick / 2);
        group.add(body);
        const haloMat = this.holoMaterial(new THREE.Color(1.0, 0.82, 0.6), 0.45, { map: this.glowTexture, side: THREE.FrontSide });
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.5, h * 1.8), haloMat);
        halo.position.set(0, y, 0.01);
        halo.userData.noPick = true;
        group.add(halo);

        const z0 = standoff + thick + 0.002;
        const slideA = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: '#0d0e10', toneMapped: false }));
        slideA.position.set(0, y, z0);
        const slideB = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0, depthWrite: false }));
        slideB.position.set(0, y, z0 + 0.001);
        slideB.visible = false;
        const overlayTex = new THREE.CanvasTexture(art.paintTVOverlay(items[0], 0, items.length));
        overlayTex.colorSpace = THREE.SRGBColorSpace;
        const overlay = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: overlayTex, toneMapped: false, transparent: true, depthWrite: false }));
        overlay.position.set(0, y, z0 + 0.002);
        const tickerTex = new THREE.CanvasTexture(art.paintTicker(items));
        tickerTex.colorSpace = THREE.SRGBColorSpace;
        tickerTex.wrapS = THREE.RepeatWrapping;
        tickerTex.anisotropy = this.maxAniso;
        const tickerH = h * 0.075;
        const tickerLen = tickerH * (tickerTex.image.width / tickerTex.image.height);
        tickerTex.repeat.set(w / tickerLen, 1);
        const ticker = new THREE.Mesh(new THREE.PlaneGeometry(w, tickerH), new THREE.MeshBasicMaterial({ map: tickerTex, toneMapped: false }));
        ticker.position.set(0, y - h / 2 + tickerH / 2, z0 + 0.003);
        const barGeo = new THREE.PlaneGeometry(w, 0.016);
        barGeo.translate(w / 2, 0, 0);
        const bar = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.7), toneMapped: false }));
        bar.position.set(-w / 2, y - h / 2 + tickerH + 0.008, z0 + 0.003);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
            color: '#000000', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.14, envMapIntensity: 2.4, depthWrite: false
        }));
        glass.position.set(0, y, z0 + 0.005);
        glass.userData.noShadow = true;
        for (const m of [slideA, slideB, overlay, ticker, bar, glass]) group.add(m);

        // Slides: each news photo, cover-cropped to 16:9 once and cached.
        const cache = new Map();
        const slideTexture = (i) => {
            if (cache.has(i)) return cache.get(i);
            const item = items[i];
            const first = item.images?.[0];
            const sources = [item.thumbnail, first?.src, first?.fallback, 'assets/images/covers/home-cover.webp']
                .filter(Boolean).flatMap((s) => [textureInfo(this.data, s)?.src, s]);
            const promise = art.loadFirstImage(sources).then((img) => {
                const canvas = img ? art.composeCover(img, 16 / 9, 1280) : art.composeCover(art.paintNewsCard(item), 16 / 9, 1280);
                const tex = new THREE.CanvasTexture(canvas);
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = this.maxAniso;
                return tex;
            });
            cache.set(i, promise);
            return promise;
        };
        const forget = (keep) => {
            for (const [i, p] of cache) {
                if (!keep.includes(i)) {
                    p.then((t) => t.dispose());
                    cache.delete(i);
                }
            }
        };
        const kenBurns = (tex, i, p) => {
            if (!tex) return;
            const zoom = i % 2 ? 0.88 + 0.12 * p : 1 - 0.12 * p;
            tex.repeat.set(zoom, zoom);
            const slack = 1 - zoom;
            tex.offset.set(slack * (i % 3 === 0 ? p : 1 - p), slack * 0.5);
        };

        const DUR = 8;
        const FADE = 1.2;
        const n = items.length;
        const tv = { index: 0, start: null, cur: null, next: null, loading: false };
        slideTexture(0).then((tex) => {
            tv.cur = tex;
            slideA.material.map = tex;
            slideA.material.color.set('#ffffff');
            slideA.material.needsUpdate = true;
            this.requestRender();
        });
        if (n > 1) slideTexture(1).then((tex) => { tv.next = tex; });

        this.animators.push({
            x: pose.x, z: pose.z, radius: 34,
            update: (t, dt) => {
                if (!tv.cur) return false;
                if (tv.start === null) tv.start = t;
                let e = t - tv.start;
                let changed = !this.calm;
                if (e >= DUR && tv.next && n > 1) {
                    // Swap: the incoming slide becomes the base layer.
                    tv.index = (tv.index + 1) % n;
                    tv.cur = tv.next;
                    tv.next = null;
                    slideA.material.map = tv.cur;
                    slideA.material.needsUpdate = true;
                    slideB.visible = false;
                    tv.start = t;
                    e = 0;
                    overlayTex.image = art.paintTVOverlay(items[tv.index], tv.index, n);
                    overlayTex.needsUpdate = true;
                    const upcoming = (tv.index + 1) % n;
                    forget([tv.index, upcoming]);
                    slideTexture(upcoming).then((tex) => { if ((tv.index + 1) % n === upcoming) tv.next = tex; });
                    changed = true;
                }
                const fade = n > 1 && tv.next ? clamp((e - (DUR - FADE)) / FADE, 0, 1) : 0;
                if (fade > 0) {
                    if (slideB.material.map !== tv.next) {
                        slideB.material.map = tv.next;
                        slideB.material.needsUpdate = true;
                    }
                    slideB.visible = true;
                    slideB.material.opacity = fade;
                    changed = true;
                }
                overlay.material.opacity = e < 0.7 ? e / 0.7 : 1 - fade;
                if (e < 0.7) changed = true;
                bar.scale.x = Math.max(0.0001, Math.min(1, e / DUR));
                if (!this.calm) {
                    kenBurns(tv.cur, tv.index, (e + FADE) / (DUR + FADE));
                    if (fade > 0) kenBurns(tv.next, tv.index + 1, (fade * FADE) / (DUR + FADE));
                    tickerTex.offset.x = (t * 0.035 * (w / tickerLen) * 4) % 1;
                    haloMat.opacity = 0.38 + 0.08 * Math.sin(t * 0.8);
                }
                return changed;
            }
        });

        const world = new THREE.Vector3();
        slideA.getWorldPosition(world);
        this.register({
            id: 'news-tv', room: 'home', kind: 'tv', title: 'News screen', subtitle: 'Every milestone, newest first', icon: 'fas fa-tv',
            payload: { current: () => items[tv.index] }, catalogue: false
        }, [body, slideA, slideB, overlay, ticker], { x: world.x, y, z: world.z }, new THREE.Vector3(surface.nx, 0, surface.nz), w);
    }

    // -----------------------------------------------------------------------
    // Grand hall: gallery banners and the news timeline
    // -----------------------------------------------------------------------

    buildHall() {
        const { newsRest, scholar } = this.data;
        const f = SKIN + 0.01;
        const galleries = ROOMS.filter((r) => r.door);
        for (const room of galleries) {
            const north = room.side === 'N';
            const surface = { x: room.cx, z: north ? -8 + f : 8 - f, nx: 0, nz: north ? 1 : -1, length: 6 };
            this.hang(surface, 0, {
                w: 6.2, h: 2.33, y: 5.25, frame: 'black', persistent: true, wash: false,
                paint: async () => art.paintBanner(room, await art.loadFirstImage([textureInfo(this.data, room.cover)?.src, room.cover])),
                exhibit: { id: `banner-${room.id}`, room: 'hall', kind: 'room', title: `Gallery ${room.numeral}: ${room.title}`, subtitle: room.tagline, payload: room, icon: room.icon, catalogue: false }
            });
        }
        // West end: the way back to the lobby.
        const home = ROOM_BY_ID.home;
        this.hang({ x: -20 + f, z: 0, nx: 1, nz: 0, length: 12 }, 0, {
            w: 4.8, h: 1.8, y: 6.0, frame: 'black', persistent: true, wash: false,
            paint: async () => art.paintBanner({ ...home, numeral: '·', title: 'Lobby', tagline: 'Portrait, interests, news' }, await art.loadFirstImage([textureInfo(this.data, home.cover)?.src, home.cover])),
            exhibit: { id: 'banner-home', room: 'hall', kind: 'room', title: 'Lobby', subtitle: home.tagline, payload: home, catalogue: false }
        });
        // East end: a banner hung from the ceiling over the contact room.
        const contact = ROOM_BY_ID.contact;
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 6.6), this.frameMats.black);
        back.position.set(52.05, 5.4, 0);
        this.group.add(back);
        for (const z of [-3, 3]) {
            const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), this.frameMats.black);
            rod.position.set(52.05, 6.55, z);
            this.group.add(rod);
        }
        this.hang({ x: 52.0, z: 0, nx: -1, nz: 0, length: 6.6 }, 0, {
            w: 6.4, h: 2.4, y: 5.4, frame: 'none', persistent: true, wash: false,
            paint: async () => art.paintBanner({ ...contact, numeral: '·', title: 'Contact', tagline: 'Collaborations and research inquiries' }, await art.loadFirstImage([textureInfo(this.data, contact.cover)?.src, contact.cover])),
            exhibit: { id: 'banner-contact', room: 'hall', kind: 'contact', title: 'Contact', subtitle: 'Get in touch', payload: this.data.profile.contact, catalogue: false }
        });

        // North wall: the news timeline, newest first, between the doors.
        const doorXs = galleries.filter((r) => r.side === 'N').map((r) => r.cx).sort((a, b) => a - b);
        const segments = [];
        let start = -20;
        for (const dx of [...doorXs, 54]) {
            const end = Math.min(dx - 2, 52);
            if (end - start > 3) segments.push({ x: (start + end) / 2, z: -8 + f, nx: 0, nz: 1, length: end - start - 1.6 });
            start = dx + 2;
        }
        const items = newsRest.map((item) => ({
            width: 2.7,
            place: (surface, offset, scale) => {
                const image = item.thumbnail || item.images?.[0]?.src;
                const w = 2.7 * scale;
                this.hang(surface, offset, {
                    w, h: w * (560 / 760), y: 1.75, frame: 'oak', persistent: true, lamp: !image,
                    paint: () => art.paintNewsCard(item),
                    exhibit: { id: `news-${item.id}`, room: 'hall', kind: 'news', title: item.title, subtitle: `${item.type} · ${formatDate(item.date)}`, payload: item, icon: item.icon }
                });
                if (image) {
                    this.hang(surface, offset, {
                        w: w * 0.86, h: w * 0.86 / 1.5, y: 4.15, frame: 'black', persistent: true,
                        paint: this.imagePainter(image, { aspect: 1.5, mat: '#1d1b18', fallbacks: [item.images?.[0]?.fallback, 'assets/images/covers/home-cover.webp'], cover: !!item.thumbnail }),
                        exhibit: { id: `news-${item.id}-image`, room: 'hall', kind: 'news', title: item.title, subtitle: formatDate(item.date), payload: item, catalogue: false }
                    });
                }
            }
        }));
        this.distribute(items, segments, 1.0);
        this.plaque({ x: -16.6, z: -8 + f, nx: 0, nz: 1, length: 4 }, 0, {
            w: 3.4, h: 0.9, y: 6.0, persistent: true, placeholder: ROOM_BY_ID.hall.paint,
            paint: () => art.paintLettering({ text: 'NEWS', sub: 'Milestones, newest first', width: 1000, height: 260, background: ROOM_BY_ID.hall.paint, color: '#2a2622', size: 120 })
        });

        // South wall, centre: most-cited works from Google Scholar.
        if (scholar?.papers?.length) {
            this.plaque({ x: 16, z: 8 - f, nx: 0, nz: -1, length: 14 }, 0, {
                w: 6.2, h: 3.99, y: 2.5, persistent: true, wash: true,
                paint: () => art.paintCitations(scholar),
                exhibit: { id: 'citations', room: 'hall', kind: 'scholar', title: 'Most cited works', subtitle: 'Google Scholar citations per paper', payload: scholar, icon: 'fas fa-chart-bar' }
            });
        }
    }

    // -----------------------------------------------------------------------
    // Galleries
    // -----------------------------------------------------------------------

    buildEducation() {
        const room = ROOM_BY_ID.education;
        const { profile, news } = this.data;
        const education = profile.education || [];
        const s = gallerySurfaces(room);
        this.roomIntro(room, `${education.length} degrees, from civil engineering to a doctorate in architecture.`);

        const graduation = news.find((n) => n.type === 'PhD' && /graduat/i.test(n.title));
        const award = news.find((n) => n.type === 'Award');
        const items = [];
        education.forEach((edu, i) => {
            items.push({
                width: 3.5,
                place: (surface, offset, scale) => this.hang(surface, offset, {
                    w: 3.4 * scale, h: 3.4 * scale * (820 / 1100), y: 2.1, frame: 'gold',
                    paint: async () => art.paintDiploma(edu, await art.loadFirstImage([textureInfo(this.data, edu.logo)?.src, edu.logo])),
                    exhibit: { id: `edu-${i}`, room: room.id, kind: 'education', title: edu.degree, subtitle: edu.institution, payload: edu, icon: 'fas fa-graduation-cap' }
                })
            });
            const photo = i === 0 ? graduation : null;
            if (photo?.images?.[0]) {
                const img = photo.images[0];
                const size = this.fitBox(this.aspectOf(img.src, 0.75), 2.4, 2.5);
                items.push({
                    width: Math.max(size.w + 0.4, 1.8),
                    place: (surface, offset, scale) => this.hang(surface, offset, {
                        w: size.w * scale, h: size.h * scale, y: 2.0, frame: 'oak', mat: 0.08,
                        paint: this.imagePainter(img.src, { fallbacks: [img.fallback] }),
                        label: { eyebrow: formatDate(photo.date), title: 'Graduation', line: img.caption, accent: room.accent },
                        exhibit: { id: 'photo-graduation', room: room.id, kind: 'news', title: photo.title, subtitle: formatDate(photo.date), payload: photo, icon: 'fas fa-camera' }
                    })
                });
            }
        });
        if (award?.images?.[0]) {
            const img = award.images[0];
            const size = this.fitBox(this.aspectOf(img.src, 1), 2.1, 2.2);
            items.push({
                width: Math.max(size.w + 0.4, 1.8),
                place: (surface, offset, scale) => this.hang(surface, offset, {
                    w: size.w * scale, h: size.h * scale, y: 1.95, frame: 'white', mat: 0.07,
                    paint: this.imagePainter(img.src, { fallbacks: [img.fallback] }),
                    label: { eyebrow: formatDate(award.date), title: 'Best Academic Award', line: img.caption, accent: room.accent },
                    exhibit: { id: 'photo-award', room: room.id, kind: 'news', title: award.title, subtitle: formatDate(award.date), payload: award, icon: 'fas fa-award' }
                })
            });
        }
        this.distribute(items, [s.left, s.back, s.right, s.frontLeft], 1.2);
    }

    buildExperience() {
        const room = ROOM_BY_ID.experience;
        const list = this.data.experienceList;
        const s = gallerySurfaces(room);
        this.roomIntro(room, `${list.length} roles across research, teaching and industry.`);
        const items = list.map((exp) => ({
            width: 2.8,
            place: (surface, offset, scale) => this.hang(surface, offset, {
                w: 2.7 * scale, h: 2.7 * scale * (1180 / 900), y: 2.3, frame: 'white',
                paint: async () => art.paintExperience(exp, await art.loadFirstImage([textureInfo(this.data, exp.logo)?.src, exp.logo]), room.accent),
                exhibit: { id: `exp-${exp.id}`, room: room.id, kind: 'experience', title: exp.position, subtitle: `${exp.organization} · ${exp.duration}`, payload: exp, icon: exp.icon }
            })
        }));
        this.distribute(items, [s.left, s.back, s.right, s.frontLeft], 1.4);
    }

    buildPublications() {
        const room = ROOM_BY_ID.publications;
        const { pubList, pubStats } = this.data;
        const s = gallerySurfaces(room);
        const t = pubStats.byType;
        this.roomIntro(room, `${pubStats.total} works: ${t.journals} journal articles, ${t.conferences} international and ${t.korean} Korean conference papers, and ${t.reports} technical reports. Papers show their journal's cover; the rest get a poster generated from their topics.`);

        // A free-standing partition doubles the hanging space.
        const half = 4.6;
        const pv = 11;
        const a = galleryPoint(room, -half, pv);
        const b = galleryPoint(room, half, pv);
        const mid = galleryPoint(room, 0, pv);
        const plaster = this.world.surfaces?.plaster || {};
        const wall = new THREE.Mesh(
            new THREE.BoxGeometry(Math.abs(b.x - a.x) || 0.3, 3.6, Math.abs(b.z - a.z) || 0.3),
            new THREE.MeshStandardMaterial({ color: room.paint, roughness: 1, map: plaster.color || null, normalMap: plaster.normal || null, normalScale: new THREE.Vector2(0.45, 0.45) })
        );
        wall.position.set(mid.x, 1.8, mid.z);
        this.world.themed.paints.push(wall.material);
        wall.material.userData.base = new THREE.Color(room.paint);
        this.group.add(wall);
        this.world.colliders.push({ x1: Math.min(a.x, b.x) - 0.15, z1: Math.min(a.z, b.z) - 0.15, x2: Math.max(a.x, b.x) + 0.15, z2: Math.max(a.z, b.z) + 0.15 });
        const into = room.side === 'N' ? -1 : 1;   // world z direction pointing deeper into the room
        const partitionBack = { x: mid.x, z: mid.z + into * 0.16, nx: 0, nz: into, length: half * 2 - 0.4 };
        const partitionFront = { x: mid.x, z: mid.z - into * 0.16, nx: 0, nz: -into, length: half * 2 - 0.4 };

        const items = pubList.map((pub) => ({
            width: 1.3,
            place: (surface, offset, scale) => {
                const w = 1.3 * scale;
                this.hang(surface, offset, {
                    w, h: w * (720 / 540), y: 1.75, frame: 'black',
                    paint: async () => {
                        const cover = this.data.venueCover(pub);
                        const img = cover ? await art.loadFirstImage([textureInfo(this.data, cover)?.src, cover]) : null;
                        return art.paintPoster(pub, this.data.citationsFor(pub), img);
                    },
                    exhibit: { id: `pub-${pub._key}`, room: room.id, kind: 'publication', title: pub.title, subtitle: `${pubVenue(pub)} · ${pub.year}`, payload: pub, icon: 'fas fa-file-alt' }
                });
            }
        }));
        this.distribute(items, [s.left, s.back, partitionBack, s.right, partitionFront, s.frontLeft], 0.5);

        // Reading desk: overview, filters and the full list.
        const desk = galleryPoint(room, 0, 4.6);
        this.lectern(desk.x, desk.z, room.side === 'N' ? 0 : Math.PI, {
            w: 2.0,
            paint: () => art.paintTextPanel({
                width: 1000, height: 620, background: '#1b1a18', ink: '#f4efe6', muted: '#b8b0a3', accent: '#e8c27a', border: false,
                eyebrow: 'Reading desk', title: `${pubStats.total} publications`,
                paragraphs: [`${t.journals} journals · ${t.conferences} international · ${t.korean} Korean · ${t.reports} reports. Cumulative journal IF ${pubStats.cumulativeIF}.`],
                footer: 'Click to browse and filter', titleSize: 74, bodySize: 34
            }),
            exhibit: { id: 'pub-index', room: room.id, kind: 'pubIndex', title: 'Publication overview', subtitle: 'Browse, search and filter every publication', payload: null, icon: 'fas fa-book-open' }
        });
    }

    buildProjects() {
        const room = ROOM_BY_ID.projects;
        const list = this.data.projectList;
        const s = gallerySurfaces(room);
        this.roomIntro(room, `${list.length} research and design projects, from national R&D programmes to studio work.`);
        const items = list.map((project) => {
            const aspect = this.aspectOf(project.image, 4 / 3);
            const size = this.fitBox(aspect, 3.0, 2.05);
            return {
                width: Math.max(size.w + 0.36, 1.9),
                place: (surface, offset, scale) => this.hang(surface, offset, {
                    w: size.w * scale, h: size.h * scale, y: 2.0, frame: 'oak', mat: 0.06,
                    paint: this.imagePainter(project.image),
                    label: { eyebrow: `${project.status} · ${project.duration}`, title: project.title, line: project.funding_source || project.role, accent: room.accent },
                    exhibit: { id: `project-${project.id}`, room: room.id, kind: 'project', title: project.title, subtitle: `${project.status} · ${project.duration}`, payload: project, icon: project.icon }
                })
            };
        });
        this.distribute(items, [s.left, s.back, s.right, s.frontLeft], 1.0);
        // A bench in the middle of the room.
        const c = galleryPoint(room, 0, 9);
        const top = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 0.8), new THREE.MeshStandardMaterial({ color: '#b07a4a', map: this.world.surfaces?.grain || null, roughness: 0.4 }));
        top.position.set(c.x, 0.46, c.z);
        this.group.add(top);
        for (const dx of [-1.3, 1.3]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.7), this.darkStone);
            leg.position.set(c.x + dx, 0.21, c.z);
            this.group.add(leg);
        }
        this.world.colliders.push({ x1: c.x - 1.6, z1: c.z - 0.5, x2: c.x + 1.6, z2: c.z + 0.5 });
    }

    buildSkills() {
        const room = ROOM_BY_ID.skills;
        const cats = this.data.skillCategories;
        const s = gallerySurfaces(room);
        const total = cats.reduce((n, c) => n + (c.skills || []).length, 0);
        this.roomIntro(room, `${total} skills in ${cats.length} families. Each column rises to its proficiency level.`);
        this.skillRise = { pending: false, start: null, columns: [] };
        const items = cats.map((cat, ci) => {
            const color = SKILL_COLORS[ci % SKILL_COLORS.length];
            const skills = cat.skills || [];
            const width = skills.length * 0.62 + 0.5;
            return {
                width,
                place: (surface, offset, scale) => this.buildSkillPlinth(room, surface, offset, cat, skills, color, scale)
            };
        });
        this.distribute(items, [s.left, s.back, s.right, s.frontLeft], 0.9);

        // Walking in, the columns grow from the plinths to their levels.
        const centre = galleryPoint(room, 0, 9);
        const rise = this.skillRise;
        const setHeight = (c, k) => {
            c.col.scale.y = Math.max(0.001, k);
            c.tile.position.y = Math.max(0.24 + c.hgt * k + c.tileFromTop, c.tileMin);
        };
        this.animators.push({
            x: centre.x, z: centre.z, radius: 22,
            update: (t) => {
                if (rise.pending) {
                    rise.pending = false;
                    rise.start = t;
                    rise.columns.forEach((c) => setHeight(c, 0));
                }
                if (rise.start === null) return false;
                let running = false;
                rise.columns.forEach((c, i) => {
                    const p = clamp((t - rise.start - i * 0.035) / 1.2, 0, 1);
                    if (p < 1) running = true;
                    const e = 1 - Math.pow(1 - p, 3);
                    setHeight(c, e);
                });
                if (!running) rise.start = null;
                return true;
            }
        });
    }

    buildSkillPlinth(room, surface, offset, cat, skills, color, scale) {
        const pitch = 0.62 * scale;
        const width = skills.length * pitch + 0.5 * scale;
        const pose = this.surfacePose(surface, offset, 0.65);
        const group = new THREE.Group();
        group.position.set(pose.x, 0, pose.z);
        group.rotation.y = pose.rotY;
        this.group.add(group);
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(width, 0.24, 0.9), this.plinthMat);
        plinth.position.set(0, 0.12, 0);
        group.add(plinth);
        const colMat = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.25 });
        const catExhibitId = `skillcat-${cat.id}`;
        skills.forEach((skill, i) => {
            const x = -width / 2 + 0.25 * scale + pitch * (i + 0.5);
            const hgt = 0.35 + (clamp(Number(skill.percentage) || 0, 0, 100) / 100) * 2.0;
            const colGeo = new THREE.BoxGeometry(0.46 * scale, hgt, 0.46 * scale);
            colGeo.translate(0, hgt / 2, 0);
            const col = new THREE.Mesh(colGeo, colMat);
            col.position.set(x, 0.24, 0);
            group.add(col);
            const tileW = 0.5 * scale;
            const tileH = tileW * (460 / 360);
            const mat = new THREE.MeshBasicMaterial({ color: '#fbf9f5', toneMapped: false });
            const tile = new THREE.Mesh(new THREE.PlaneGeometry(tileW, tileH), mat);
            const top = 0.24 + hgt;
            tile.position.set(x, Math.max(top - tileH / 2 - 0.05, 0.24 + tileH / 2 + 0.04), 0.46 * scale / 2 + 0.006);
            if (top < tileH + 0.4) tile.position.y = top + tileH / 2 + 0.02;
            group.add(tile);
            this.skillRise.columns.push({ col, tile, hgt, tileFromTop: tile.position.y - top, tileMin: 0.24 + tileH / 2 + 0.02 });
            const wp = new THREE.Vector3();
            tile.getWorldPosition(wp);
            this.addSlot(mat, async () => art.paintSkillTile(skill, await this.skillLogo(skill), color), wp, { placeholder: '#fbf9f5' });
            this.register({ id: `skill-${cat.id}-${i}`, room: room.id, kind: 'skill', title: skill.name, subtitle: `${cat.title} · ${skill.level}`, payload: { skill, category: cat, color }, icon: cat.icon },
                [col, tile], { x: wp.x, y: wp.y, z: wp.z }, new THREE.Vector3(surface.nx, 0, surface.nz), 1.2);
        });
        // Category sign on the wall behind.
        const signPose = this.surfacePose(surface, offset);
        const sign = { x: signPose.x, z: signPose.z, nx: surface.nx, nz: surface.nz };
        this.plaque(sign, 0, {
            w: Math.max(width, 1.6), h: 0.8, y: 3.75,
            paint: () => art.paintTextPanel({ width: Math.round(Math.max(width, 1.6) * 400), height: 320, title: cat.title, icon: null, eyebrow: `${skills.length} skills`, accent: color, titleSize: 96, bodySize: 40, padding: 0.12, align: 'center', border: false }),
            exhibit: { id: catExhibitId, room: room.id, kind: 'skillCategory', title: cat.title, subtitle: `${skills.length} skills`, payload: { category: cat, color }, icon: cat.icon }
        });
        const c = new THREE.Vector3();
        plinth.getWorldPosition(c);
        const half = width / 2 + 0.15;
        const isX = Math.abs(surface.nz) > 0.5;
        this.world.colliders.push(isX
            ? { x1: c.x - half, z1: c.z - 0.6, x2: c.x + half, z2: c.z + 0.6 }
            : { x1: c.x - 0.6, z1: c.z - half, x2: c.x + 0.6, z2: c.z + half });
    }

    async skillLogo(skill) {
        const icon = skill.icon || '';
        if (!icon || (!icon.includes('/') && !icon.includes('.'))) return null;
        // Remote logos can only become textures when their host allows CORS.
        if (/^https?:/.test(icon) && !/^https:\/\/(cdn\.jsdelivr\.net|upload\.wikimedia\.org)\//.test(icon)) return null;
        return art.loadFirstImage([textureInfo(this.data, icon)?.src, icon]);
    }

    buildTools() {
        const room = ROOM_BY_ID.tools;
        const tools = this.data.tools;
        const s = gallerySurfaces(room);
        this.roomIntro(room, `${tools.length} tools, web apps and frameworks for AEC, from IFC viewers to robot navigation.`);
        const items = tools.map((tool) => ({
            width: 3.0,
            place: (surface, offset, scale) => {
                const w = 2.9 * scale;
                const h = w * 9 / 16;
                this.hang(surface, offset, {
                    w, h, y: 2.0, frame: 'bezel', placeholder: '#101216',
                    paint: this.imagePainter(tool.previewImage, { aspect: 16 / 9, mat: '#101216' }),
                    label: {
                        eyebrow: (tool.badges || []).slice(0, 2).map((b) => b.label).join(' · ') || 'Tool',
                        title: tool.title, line: stripTags(tool.description), accent: room.accent, h: 0.62
                    },
                    exhibit: { id: `tool-${tool.id}`, room: room.id, kind: 'tool', title: tool.title, subtitle: stripTags(tool.description), payload: tool, icon: tool.navIcon }
                });
            }
        }));
        this.distribute(items, [s.left, s.back, s.right, s.frontLeft], 0.9);
    }

    buildAwards() {
        const room = ROOM_BY_ID.certifications;
        const { awards, certs } = this.data;
        const s = gallerySurfaces(room);
        this.roomIntro(room, `${awards.length} awards and honours on the pedestals; ${certs.length} certificates on the walls.`);
        const items = certs.map((cert) => {
            const aspect = this.aspectOf(cert.image, 1.3);
            const size = this.fitBox(aspect, 1.4, 1.15);
            return {
                width: Math.max(size.w + 0.36, 1.2),
                place: (surface, offset, scale) => this.hang(surface, offset, {
                    w: size.w * scale, h: size.h * scale, y: 1.8, frame: 'gold', mat: 0.05,
                    paint: this.imagePainter(cert.image),
                    label: { eyebrow: formatDate(cert.date), title: cert.title, line: cert.issuer, accent: room.accent, h: 0.44 },
                    exhibit: { id: `cert-${cert.id}`, room: room.id, kind: 'certificate', title: cert.title, subtitle: `${cert.issuer} · ${formatDate(cert.date)}`, payload: cert, icon: 'fas fa-certificate' }
                })
            };
        });
        this.distribute(items, [s.left, s.back, s.right, s.frontLeft], 0.3);

        // Medals on pedestals in the middle of the room, swaying gently.
        const goldSide = new THREE.MeshStandardMaterial({ color: '#c99a3e', roughness: 0.25, metalness: 1 });
        const ribbonMat = new THREE.MeshStandardMaterial({ color: '#1e3a8a', roughness: 0.75 });
        const cols = 3;
        const swings = [];
        awards.forEach((award, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const inRow = Math.min(cols, awards.length - row * cols);
            const p = galleryPoint(room, (col - (inRow - 1) / 2) * 3.8, 6.2 + row * 4.2);
            const rotY = room.side === 'N' ? 0 : Math.PI;
            const group = new THREE.Group();
            group.position.set(p.x, 0, p.z);
            group.rotation.y = rotY;
            this.group.add(group);
            const ped = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.1, 0.75), this.plinthMat);
            ped.position.y = 0.55;
            group.add(ped);
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.85), this.darkStone);
            cap.position.y = 1.125;
            group.add(cap);
            const swing = new THREE.Group();
            swing.position.set(0, 1.55, 0);
            group.add(swing);
            const faceMat = new THREE.MeshStandardMaterial({ color: '#c99a3e', roughness: 0.3, metalness: 0.65 });
            const medal = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 64), goldSide);
            medal.rotation.x = Math.PI / 2;
            swing.add(medal);
            const face = new THREE.Mesh(new THREE.CircleGeometry(0.295, 64), faceMat);
            face.position.z = 0.0255;
            swing.add(face);
            // Ribbon: two straps rising from the medal in a V.
            for (const sgn of [-1, 1]) {
                const strap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.008), ribbonMat);
                strap.position.set(sgn * 0.07, 0.47, -0.012);
                strap.rotation.z = -sgn * 0.3;
                swing.add(strap);
            }
            const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), this.frameMats.black);
            stand.position.set(0, 1.25, -0.05);
            group.add(stand);
            swings.push(swing);
            const wp = new THREE.Vector3();
            medal.getWorldPosition(wp);
            this.addSlot(faceMat, () => art.paintMedalFace(award), wp, { placeholder: '#c99a3e' });
            const lmat = new THREE.MeshBasicMaterial({ color: '#f6f3ee', toneMapped: false });
            const label = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.44), lmat);
            label.position.set(0, 0.8, 0.376);
            group.add(label);
            const lp = new THREE.Vector3();
            label.getWorldPosition(lp);
            this.addSlot(lmat, () => art.paintLabel({ eyebrow: `${award.category} · ${award.date}`, title: award.title, lines: [award.issuer], accent: room.accent }), lp, { placeholder: '#f6f3ee' });
            this.world.colliders.push({ x: p.x, z: p.z, r: 0.65 });
            const normal = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
            this.register({ id: `award-${award.id}`, room: room.id, kind: 'award', title: award.title, subtitle: `${award.issuer} · ${award.date}`, payload: award, icon: award.icon },
                [ped, medal, face, label], { x: wp.x, y: 1.3, z: wp.z }, normal, 1.3);
        });
        if (swings.length && !this.calm) {
            const c = galleryPoint(room, 0, 8);
            this.animators.push({
                x: c.x, z: c.z, radius: 20,
                update: (t) => {
                    swings.forEach((s, i) => { s.rotation.y = Math.sin(t * 0.55 + i * 1.3) * 0.38; });
                    return true;
                }
            });
        }
    }

    buildActivities() {
        const room = ROOM_BY_ID.activities;
        const { profile, seminarList, collaborations } = this.data;
        const s = gallerySurfaces(room);
        const reviewing = profile.reviewing || [];
        const venues = reviewing.reduce((n, g) => n + (g.roles || []).length, 0);
        const coauthors = collaborations?.byAuthor?.length || 0;
        this.roomIntro(room, `Peer review for ${venues} journals and conferences, seminars, and a hologram of ${coauthors} co-authors: as a network, or on a globe you can spin.`);

        // Back wall: editorial and review roles.
        this.plaque(s.back, 0, {
            w: 8.4, h: 3.6, y: 2.4, wash: true,
            paint: () => art.paintTextPanel({
                width: 1800, height: 771, eyebrow: 'Editorial & review activities', title: 'Peer review',
                sections: reviewing.map((g) => ({ heading: g.publisher, lines: (g.roles || []).map((r) => `${r.venue} · ${r.role}`) })),
                accent: room.accent, titleSize: 70, bodySize: 30
            }),
            exhibit: { id: 'reviewing', room: room.id, kind: 'reviewing', title: 'Editorial & review activities', subtitle: `${venues} venues`, payload: reviewing, icon: 'fas fa-pen-nib' }
        });

        // Left wall: seminars and presentations.
        const seminarItems = seminarList.map((sem) => {
            const size = this.fitBox(this.aspectOf(sem.image, 1.4), 2.8, 1.9);
            return {
                width: Math.max(size.w + 0.36, 1.9),
                place: (surface, offset, scale) => this.hang(surface, offset, {
                    w: size.w * scale, h: size.h * scale, y: 2.0, frame: 'black', mat: 0.06,
                    paint: this.imagePainter(sem.image),
                    label: { eyebrow: `${sem.type} · ${sem.date}`, title: sem.title, line: `${sem.role} · ${sem.organizer}`, accent: room.accent },
                    exhibit: { id: `seminar-${sem.id}`, room: room.id, kind: 'seminar', title: sem.title, subtitle: `${sem.role} · ${sem.date}`, payload: sem, icon: 'fas fa-chalkboard-teacher' }
                })
            };
        });
        if (seminarItems.length) this.distribute(seminarItems, [s.left], 1);

        // Right wall: who the collaborators are.
        if (collaborations) {
            this.plaque(s.right, 0, {
                w: 6.4, h: 3.6, y: 2.4, wash: true,
                paint: () => art.paintTextPanel({
                    width: 1600, height: 900, eyebrow: 'Collaborations / network', title: 'Co-authors',
                    sections: [
                        { heading: 'By country', lines: (collaborations.byCountry || []).map((c) => `${c.name}: ${c.authors} co-authors, ${c.papers} papers`) },
                        { heading: 'By organization', lines: (collaborations.byUniversity || []).map((u) => `${u.name}: ${u.papers} papers, ${u.authors} co-authors`) }
                    ],
                    footer: 'Click to explore the network', accent: room.accent, titleSize: 68, bodySize: 30
                }),
                exhibit: { id: 'collab-panel', room: room.id, kind: 'collab', title: 'Collaborations / network', subtitle: `${coauthors} co-authors in ${(collaborations.byCountry || []).length} countries`, payload: null, icon: 'fas fa-project-diagram' }
            });
            this.buildProjector(room);
        }
    }

    /**
     * The hologram projector in the middle of Gallery VIII. It shows either
     * the co-author network (a turning sculpture) or a world map with the
     * co-authors placed by country; the console, the HUD and the panel switch.
     */
    buildProjector(room) {
        const c = galleryPoint(room, 0, 10);
        const toDoor = new THREE.Vector3(0, 0, room.side === 'N' ? 1 : -1);
        const faceY = Math.atan2(toDoor.x, toDoor.z);

        const dais = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, 0.16, 72), this.darkStone);
        dais.position.set(c.x, 0.08, c.z);
        this.group.add(dais);
        // One collider whose radius follows the view: wide around the network
        // sculpture, closer in for the globe.
        const collider = { x: c.x, z: c.z, r: 3.6 };
        this.world.colliders.push(collider);
        const ringMat = this.holoMaterial(HOLO.clone().multiplyScalar(1.2), 0.9);
        const ring = new THREE.Mesh(new THREE.RingGeometry(3.05, 3.15, 128), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(c.x, 0.165, c.z);
        const emitterMat = this.holoMaterial(HOLO.clone().multiplyScalar(1.6), 0.9);
        const emitter = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.8, 64), emitterMat);
        emitter.rotation.x = -Math.PI / 2;
        emitter.position.set(c.x, 0.166, c.z);
        const coneMat = this.holoMaterial(HOLO.clone().multiplyScalar(0.6), 0.09, { map: this.beamTexture });
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 0.8, 4.4, 64, 1, true), coneMat);
        cone.position.set(c.x, 0.17 + 2.2, c.z);
        for (const m of [ring, emitter, cone]) {
            m.userData.noPick = true;
            this.group.add(m);
        }

        const collab = { mode: 'network', p: 0, target: 0, consoleSlot: null, collider, globe: null };
        this.collab = collab;
        const net = this.buildNetwork(room, new THREE.Vector3(c.x, 2.6, c.z), toDoor);
        const map = this.buildHoloMap(room, new THREE.Vector3(c.x, GLOBE_Y, c.z), faceY, toDoor);

        // The console stands to one side of the dais, out of the line of sight.
        const k = galleryPoint(room, 4.4, 5.4);
        const consoleGroup = this.lectern(k.x, k.z, (room.side === 'N' ? 0 : Math.PI) + 0.45, {
            w: 1.8,
            paint: () => art.paintConsole(collab.mode),
            exhibit: { id: 'collab-console', room: room.id, kind: 'collabToggle', title: 'Hologram projector', subtitle: 'Switch between the co-author network and the world map', payload: null, icon: 'fas fa-toggle-on', catalogue: false }
        });
        collab.consoleSlot = consoleGroup.userData.slot;

        this.animators.push({
            x: c.x, z: c.z, radius: 26,
            always: () => collab.p !== collab.target,
            update: (t, dt) => {
                if (collab.p !== collab.target) {
                    const step = dt / 1.4;
                    collab.p = collab.target > collab.p ? Math.min(collab.target, collab.p + step) : Math.max(collab.target, collab.p - step);
                }
                const e = easeInOut(collab.p);
                net.update(t, dt, 1 - e);
                map.update(t, dt, e);
                // For the globe, the beam narrows to hold it from below.
                const narrow = 1 - 0.55 * e;
                cone.scale.set(narrow, 1 - 0.78 * e, narrow);
                cone.position.y = 0.17 + 2.2 * cone.scale.y;
                emitterMat.opacity = 0.9 * (1 - 0.4 * e);
                if (!this.calm) {
                    ring.rotation.z = t * 0.15;
                    coneMat.opacity = 0.08 + 0.02 * Math.sin(t * 2.3) * Math.sin(t * 0.7);
                }
                return true;
            }
        });
    }

    /** Switch the hologram: 'network' or 'map'. */
    setCollabView(mode) {
        const c = this.collab;
        if (!c || (mode !== 'network' && mode !== 'map') || c.mode === mode) return;
        c.mode = mode;
        c.target = mode === 'map' ? 1 : 0;
        // The globe is smaller than the network, so visitors may step closer.
        c.collider.r = mode === 'map' ? 2.4 : 3.6;
        if (c.consoleSlot) this.repaint(c.consoleSlot);
        this.onCollabView?.(mode);
        this.requestRender();
    }

    toggleCollabView() {
        if (this.collab) this.setCollabView(this.collab.mode === 'map' ? 'network' : 'map');
    }

    /** The co-author network: spheres sized by joint papers, turning slowly. */
    buildNetwork(room, centre, toDoor) {
        const { collaborations, pubList, profile } = this.data;
        const authors = [...(collaborations.byAuthor || [])].sort((a, b) =>
            (a.country || '').localeCompare(b.country || '') || b.papers - a.papers);
        const net = new THREE.Group();
        net.position.copy(centre);
        this.group.add(net);

        const meshes = [];
        const sphereGeo = new THREE.SphereGeometry(1, 32, 20);
        const selfMat = new THREE.MeshStandardMaterial({ color: '#e8c27a', roughness: 0.22, metalness: 0.85, emissive: '#5a400c', emissiveIntensity: 0.6 });
        const self = new THREE.Mesh(sphereGeo, selfMat);
        self.scale.setScalar(0.34);
        net.add(self);
        meshes.push(self);
        const selfHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture, color: new THREE.Color(1.6, 1.2, 0.5), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        selfHalo.scale.setScalar(1.6);
        selfHalo.userData.noPick = true;
        net.add(selfHalo);

        const positions = new Map();
        const golden = Math.PI * (3 - Math.sqrt(5));
        const n = authors.length;
        const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
        const rodMat = new THREE.MeshStandardMaterial({ color: '#d8cfbf', roughness: 0.35, metalness: 0.7 });
        const up = new THREE.Vector3(0, 1, 0);
        const dirs = [];
        authors.forEach((author, i) => {
            const y = 1 - ((i + 0.5) / n) * 2;
            const r = Math.sqrt(1 - y * y);
            const theta = golden * i;
            const pos = new THREE.Vector3(Math.cos(theta) * r * 2.6, y * 1.55, Math.sin(theta) * r * 2.6);
            positions.set(author.name, pos);
            for (const alias of author.aliases || []) positions.set(alias, pos);
            const color = COUNTRY_COLORS[author.country] || '#a3a3a3';
            const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.2, emissive: color, emissiveIntensity: 0.35 });
            const node = new THREE.Mesh(sphereGeo, mat);
            node.scale.setScalar(0.07 + 0.028 * Math.min(author.papers, 12));
            node.position.copy(pos);
            net.add(node);
            meshes.push(node);
            // Rod to the centre, thicker for more joint papers.
            const len = pos.length();
            const dir = pos.clone().normalize();
            dirs.push({ dir, len, speed: 0.25 + 0.06 * Math.min(author.papers, 8), phase: (i * 0.618) % 1 });
            const rod = new THREE.Mesh(rodGeo, rodMat);
            const thick = 0.006 + 0.0025 * Math.min(author.papers, 12);
            rod.scale.set(thick, len, thick);
            rod.position.copy(pos).multiplyScalar(0.5);
            rod.quaternion.setFromUnitVectors(up, dir);
            net.add(rod);
            meshes.push(rod);
            // Floating name tag.
            const smat = new THREE.SpriteMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false });
            const sprite = new THREE.Sprite(smat);
            const big = author.papers >= 3;
            sprite.scale.set(big ? 1.05 : 0.8, big ? 0.26 : 0.2, 1);
            sprite.position.copy(pos).add(new THREE.Vector3(0, node.scale.x + 0.16, 0));
            net.add(sprite);
            const affiliation = author.university || author.Industry || '';
            this.addSlot(smat, () => art.paintCollabLabel(author.name, `${author.papers} paper${author.papers === 1 ? '' : 's'}${affiliation ? ' · ' + affiliation : ''}`, color), centre.clone().add(pos), { placeholder: '#ffffff' });
            meshes.push(sprite);
        });

        // Faint links between co-authors who also published together.
        const pairs = new Map();
        for (const pub of pubList) {
            const names = (pub.authors || []).filter((a) => positions.has(a));
            for (let i = 0; i < names.length; i++) {
                for (let j = i + 1; j < names.length; j++) {
                    const a = positions.get(names[i]);
                    const b = positions.get(names[j]);
                    const key = [a.toArray().join(), b.toArray().join()].sort().join('|');
                    pairs.set(key, { a, b });
                }
            }
        }
        const pts = [];
        for (const { a, b } of pairs.values()) pts.push(a, b);
        if (pts.length) {
            const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
                new THREE.LineBasicMaterial({ color: new THREE.Color(1.1, 0.75, 1.3), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
            lines.userData.noPick = true;
            net.add(lines);
        }

        // Sparks travelling out along every rod: one instanced draw call.
        const sparks = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), this.holoMaterial(new THREE.Color(2.4, 2.0, 1.2), 1, { side: THREE.FrontSide }), n);
        sparks.userData.noPick = true;
        sparks.frustumCulled = false;
        net.add(sparks);

        const selfTag = new THREE.SpriteMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false });
        const selfSprite = new THREE.Sprite(selfTag);
        selfSprite.scale.set(1.4, 0.35, 1);
        selfSprite.position.set(0, 0.62, 0);
        net.add(selfSprite);
        this.addSlot(selfTag, () => art.paintCollabLabel(profile.name, `${collaborations.center?.university || ''}`, '#e8c27a'), centre, { placeholder: '#ffffff' });
        meshes.push(selfSprite);

        this.register({ id: 'collab-network', room: room.id, kind: 'collab', title: 'Co-authorship network', subtitle: `${n} co-authors · sized by joint papers · coloured by country`, payload: null, icon: 'fas fa-circle-nodes' },
            meshes, { x: centre.x, y: centre.y - 0.4, z: centre.z }, toDoor, 3.9);

        const d = new THREE.Object3D();
        return {
            update: (t, dt, visible) => {
                net.visible = visible > 0.002;
                if (!net.visible) return;
                net.scale.setScalar(Math.max(0.001, visible));
                if (this.calm) {
                    sparks.visible = false;
                    return;
                }
                net.rotation.y += dt * 0.12;
                selfHalo.material.opacity = 0.5 + 0.15 * Math.sin(t * 2);
                dirs.forEach((r, i) => {
                    const f = (t * r.speed + r.phase) % 1;
                    d.position.copy(r.dir).multiplyScalar(0.34 + (r.len - 0.34) * f);
                    d.scale.setScalar(0.028 * Math.sin(f * Math.PI) + 0.004);
                    d.updateMatrix();
                    sparks.setMatrixAt(i, d.matrix);
                });
                sparks.instanceMatrix.needsUpdate = true;
            }
        };
    }

    /**
     * The world map hologram as a globe: land as thousands of glowing dots
     * (Natural Earth outlines, data/world-dots.json) over a dark glass sphere
     * with a bright rim, a pin rising from each partner country, arcs from
     * Korea, and a card beside the globe listing the co-authors there. It
     * turns on its own; visitors drag it to spin and tilt it.
     */
    buildHoloMap(room, centre, faceY, toDoor) {
        const { collaborations, worldDots } = this.data;
        const R = GLOBE_R;
        // root: placement and tilt (faces the door); spin: turns about the axis.
        const root = new THREE.Group();
        root.position.copy(centre);
        root.rotation.order = 'YXZ';
        root.visible = false;
        this.group.add(root);
        const spin = new THREE.Group();
        root.add(spin);
        const globe = { yaw: -THREE.MathUtils.degToRad(105), tilt: 0.3, vel: GLOBE_SPIN, dragging: false };
        this.collab.globe = globe;
        const unit = (lat, lng) => {
            const a = THREE.MathUtils.degToRad(lat);
            const b = THREE.MathUtils.degToRad(lng);
            return new THREE.Vector3(Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b));
        };
        const fades = [];   // [material, base opacity]: fade in after the dots
        const fadeMat = (m, base) => { fades.push([m, base]); m.opacity = 0; return m; };

        // Dark glass sphere with a bright rim. It writes depth, so the far
        // side's dots, pins and arcs stay hidden behind it.
        const shell = new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 72, 48), new THREE.ShaderMaterial({
            uniforms: { uOpacity: { value: 0 }, uFill: { value: new THREE.Color('#03161e') }, uRim: { value: HOLO.clone().multiplyScalar(0.9) } },
            vertexShader: `
                varying vec3 vN; varying vec3 vV;
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vN = normalize(normalMatrix * normal);
                    vV = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                uniform float uOpacity; uniform vec3 uFill; uniform vec3 uRim;
                varying vec3 vN; varying vec3 vV;
                void main() {
                    float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
                    vec3 col = uFill + uRim * pow(f, 3.0);
                    gl_FragColor = vec4(col, (0.72 + 0.28 * f) * uOpacity);
                    #include <colorspace_fragment>
                }`,
            transparent: true, depthWrite: true
        }));
        shell.renderOrder = -2;
        spin.add(shell);

        // Land dots; high latitudes are thinned so the poles don't pile up.
        const pos = [];
        const seeds = [];
        const us = [];
        if (worldDots?.runs) {
            const rand = seededRandom(2024);
            const step = worldDots.step;
            worldDots.runs.forEach((runs, r) => {
                const lat = 90 - (r + 0.5) * step;
                const keep = Math.cos(THREE.MathUtils.degToRad(lat));
                for (const [start, len] of runs) {
                    for (let c = start; c < start + len; c++) {
                        const seed = rand();
                        if (seed > keep + 0.05) continue;
                        const lng = -180 + (c + 0.5) * step;
                        const p = unit(lat, lng).multiplyScalar(R);
                        pos.push(p.x, p.y, p.z);
                        seeds.push(seed);
                        us.push((lng + 180) / 360);
                    }
                }
            });
        }
        const dotGeo = new THREE.BufferGeometry();
        dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        dotGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
        dotGeo.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
        const dotMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uReveal: { value: 0 }, uScale: { value: this.pointScale },
                uColor: { value: HOLO.clone().multiplyScalar(1.3) }, uSize: { value: ((Math.PI * 2 * R) / 240) * 1.05 }, uRadius: { value: R }
            },
            vertexShader: `
                uniform float uTime; uniform float uReveal; uniform float uScale; uniform float uSize; uniform float uRadius;
                attribute float aSeed; attribute float aU;
                varying float vA;
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mv;
                    vec3 n = normalize(normalMatrix * normalize(position));
                    float facing = dot(n, normalize(-mv.xyz));
                    float limb = smoothstep(-0.05, 0.35, facing);
                    float reveal = clamp((uReveal * 1.3 - aU) / 0.3, 0.0, 1.0);
                    float v = position.y / uRadius * 0.5 + 0.5;
                    float band = exp(-pow((v - fract(uTime * 0.12)) * 10.0, 2.0));
                    float twinkle = 0.72 + 0.28 * sin(uTime * 1.8 + aSeed * 40.0);
                    vA = reveal * limb * (0.8 * twinkle + 0.9 * band);
                    gl_PointSize = uScale * uSize * (1.0 + 0.35 * band) / max(0.1, -mv.z);
                }`,
            fragmentShader: `
                uniform vec3 uColor;
                varying float vA;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float a = smoothstep(0.5, 0.12, d) * vA;
                    if (a < 0.004) discard;
                    gl_FragColor = vec4(uColor * a, 1.0);
                    #include <colorspace_fragment>
                }`,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        this.collab.dotMat = dotMat;
        const dots = new THREE.Points(dotGeo, dotMat);
        dots.userData.noPick = true;
        spin.add(dots);

        // Graticule: parallels and meridians every 30 degrees.
        const grid = [];
        const ring = (fn) => {
            for (let i = 0; i < 96; i++) grid.push(fn(i / 96), fn((i + 1) / 96));
        };
        for (let lat = -60; lat <= 60; lat += 30) ring((t) => unit(lat, t * 360 - 180).multiplyScalar(R * 1.002));
        for (let lng = -180; lng < 180; lng += 30) ring((t) => unit(t * 180 - 90, lng).multiplyScalar(R * 1.002));
        const gridLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(grid),
            fadeMat(new THREE.LineBasicMaterial({ color: HOLO.clone().multiplyScalar(0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 0.22));
        gridLines.userData.noPick = true;
        spin.add(gridLines);
        // A thin equatorial halo around the globe, fixed while it spins.
        const halo = new THREE.Mesh(new THREE.RingGeometry(R * 1.12, R * 1.135, 128), fadeMat(this.holoMaterial(HOLO.clone().multiplyScalar(1.2), 1), 0.55));
        halo.rotation.x = Math.PI / 2;
        halo.userData.noPick = true;
        root.add(halo);

        // Pins, arcs and cards.
        const center = collaborations.center || {};
        const countries = collaborations.byCountry || [];
        const homeCountry = countries.find((x) => x.name === center.country) || countries[0];
        // Short pins: a bright dot on the country itself, a stub rising from it.
        const pinH = 0.12;
        const pins = [];
        const pinMat = fadeMat(this.holoMaterial(HOLO.clone().multiplyScalar(1.5), 1), 1);
        const goldMat = fadeMat(this.holoMaterial(HOLO_GOLD, 1), 1);
        const beamGeo = new THREE.CylinderGeometry(0.01, 0.01, pinH, 8);
        beamGeo.translate(0, pinH / 2, 0);
        const tipGeo = new THREE.SphereGeometry(0.028, 16, 12);
        const dotGeo2 = new THREE.CircleGeometry(0.035, 32);
        const ringGeo = new THREE.RingGeometry(0.05, 0.065, 48);
        const up = new THREE.Vector3(0, 1, 0);
        const outZ = new THREE.Vector3(0, 0, 1);

        // Cards hang beside the globe (not on it): western partners on the
        // left, the rest on the right, stacked north to south.
        const cardsRoot = new THREE.Group();
        cardsRoot.position.copy(centre);
        cardsRoot.rotation.y = faceY;
        cardsRoot.visible = false;
        this.group.add(cardsRoot);
        const byLng = [...countries].sort((a, b) => a.lng - b.lng);
        const leftCount = Math.floor(byLng.length / 2);
        const sides = { left: byLng.slice(0, leftCount).sort((a, b) => b.lat - a.lat), right: byLng.slice(leftCount).sort((a, b) => b.lat - a.lat) };
        const CARD_W = 1.5;
        const cardMeshes = [];
        const leaders = [];
        const leaderMat = fadeMat(new THREE.LineBasicMaterial({ color: HOLO.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 0.65);

        const cardFor = (country) => {
            const people = (collaborations.byAuthor || []).filter((a) => a.country === country.name).sort((a, b) => b.papers - a.papers);
            const orgs = new Map();
            for (const a of people) {
                const org = a.university || a.Industry || 'Other';
                if (!orgs.has(org)) orgs.set(org, []);
                orgs.get(org).push(`${a.name} (${a.papers})`);
            }
            const canvas = art.paintHoloCard({
                title: country === homeCountry ? `${country.name} · home base` : country.name,
                stats: `${country.authors} co-author${country.authors === 1 ? '' : 's'} · ${country.papers} joint paper${country.papers === 1 ? '' : 's'}`,
                groups: [...orgs].map(([heading, names]) => ({ heading, names }))
            });
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = this.maxAniso;
            const card = new THREE.Sprite(fadeMat(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }), 1));
            card.scale.set(CARD_W, CARD_W * (canvas.height / canvas.width), 1);
            return card;
        };
        for (const [side, list] of Object.entries(sides)) {
            const sign = side === 'left' ? -1 : 1;
            const cards = list.map((country) => ({ country, card: cardFor(country) }));
            const total = cards.reduce((h, c) => h + c.card.scale.y, 0) + 0.15 * (cards.length - 1);
            let y = total / 2;
            for (const { country, card } of cards) {
                card.center.set(side === 'left' ? 1 : 0, 0.5);
                card.position.set(sign * (R + 0.75), y - card.scale.y / 2, 0);
                y -= card.scale.y + 0.15;
                cardsRoot.add(card);
                cardMeshes.push(card);
                const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
                const line = new THREE.Line(geo, leaderMat);
                line.frustumCulled = false;
                line.userData.noPick = true;
                this.group.add(line);
                leaders.push({ country, card, line, anchor: card.position.clone() });
            }
        }

        const tips = new Map();
        countries.forEach((country) => {
            const home = country === homeCountry;
            const n = unit(country.lat, country.lng);
            const mat = home ? goldMat : pinMat;
            const beam = new THREE.Mesh(beamGeo, mat);
            beam.position.copy(n).multiplyScalar(R);
            beam.quaternion.setFromUnitVectors(up, n);
            const tip = new THREE.Mesh(tipGeo, mat);
            tip.position.copy(n).multiplyScalar(R + pinH);
            const spot = new THREE.Mesh(dotGeo2, mat);
            spot.position.copy(n).multiplyScalar(R * 1.006);
            spot.quaternion.setFromUnitVectors(outZ, n);
            const ringMat = fadeMat(this.holoMaterial(home ? HOLO_GOLD : HOLO.clone().multiplyScalar(1.4), 1), 1);
            const pulse = new THREE.Mesh(ringGeo, ringMat);
            pulse.position.copy(n).multiplyScalar(R * 1.004);
            pulse.quaternion.setFromUnitVectors(outZ, n);
            for (const m of [beam, tip, spot, pulse]) {
                m.userData.noPick = true;
                spin.add(m);
            }
            pins.push({ ring: pulse, ringMat, phase: pins.length * 0.37 });
            tips.set(country, spot);
        });

        // Arcs from home to every partner, lifted off the surface, with sparks.
        const arcs = [];
        const arcMat = fadeMat(this.holoMaterial(HOLO.clone().multiplyScalar(1.1), 1), 0.8);
        const sparkMat = fadeMat(this.holoMaterial(new THREE.Color(2.6, 2.4, 1.6), 1), 1);
        const sparkGeo = new THREE.SphereGeometry(0.03, 12, 8);
        if (homeCountry) {
            const a = unit(homeCountry.lat, homeCountry.lng);
            for (const country of countries) {
                if (country === homeCountry) continue;
                const b = unit(country.lat, country.lng);
                const lift = 0.05 + a.angleTo(b) * 0.16;
                const pts = [];
                for (let i = 0; i <= 48; i++) {
                    const t = i / 48;
                    pts.push(a.clone().lerp(b, t).normalize().multiplyScalar(R * (1 + lift * Math.sin(Math.PI * t))));
                }
                const curve = new THREE.CatmullRomCurve3(pts);
                const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.008, 6), arcMat);
                tube.userData.noPick = true;
                spin.add(tube);
                const sparks = [0, 0.5].map(() => {
                    const s = new THREE.Mesh(sparkGeo, sparkMat);
                    s.userData.noPick = true;
                    spin.add(s);
                    return s;
                });
                arcs.push({ curve, sparks, speed: 0.22 + arcs.length * 0.05 });
            }
        }

        const record = this.register({ id: 'collab-map', room: room.id, kind: 'collab', title: 'Co-authors on the globe', subtitle: `${countries.length} countries · arcs from ${center.university || 'home'}`, payload: { tab: 'country' }, icon: 'fas fa-earth-asia' },
            [shell, ...cardMeshes], { x: centre.x, y: centre.y, z: centre.z }, toDoor, 2);
        record.view = { x: centre.x + toDoor.x * 4.6, z: centre.z + toDoor.z * 4.6, yaw: faceY, pitch: 0.12 };

        const tipWorld = new THREE.Vector3();
        const anchorWorld = new THREE.Vector3();
        const toViewer = new THREE.Vector3();
        return {
            update: (t, dt, visible) => {
                const shown = visible > 0.002;
                root.visible = shown;
                cardsRoot.visible = shown;
                for (const l of leaders) l.line.visible = shown;
                if (!shown) return;
                if (!globe.dragging) {
                    const auto = this.calm ? 0 : GLOBE_SPIN;
                    globe.yaw += globe.vel * dt;
                    globe.vel += (auto - globe.vel) * (1 - Math.exp(-dt * 1.2));
                }
                root.rotation.set(globe.tilt, faceY, 0);
                spin.rotation.y = globe.yaw;
                root.scale.setScalar(0.7 + 0.3 * visible);
                dotMat.uniforms.uReveal.value = visible;
                dotMat.uniforms.uTime.value = this.calm ? 2.0 : t;
                shell.material.uniforms.uOpacity.value = visible;
                const k = clamp((visible - 0.35) / 0.65, 0, 1);
                const flicker = this.calm ? 1 : 0.94 + 0.06 * Math.sin(t * 17.0) * Math.sin(t * 5.3);
                for (const [m, base] of fades) m.opacity = base * k * flicker;

                // Leader lines follow the pins round the globe and fade on the far side.
                root.updateMatrixWorld(true);
                cardsRoot.updateMatrixWorld(true);
                toViewer.set(this.player.x - centre.x, 0, this.player.z - centre.z).normalize();
                for (const l of leaders) {
                    tips.get(l.country).getWorldPosition(tipWorld);
                    anchorWorld.copy(l.anchor);
                    cardsRoot.localToWorld(anchorWorld);
                    const attr = l.line.geometry.attributes.position;
                    attr.setXYZ(0, tipWorld.x, tipWorld.y, tipWorld.z);
                    attr.setXYZ(1, anchorWorld.x, anchorWorld.y, anchorWorld.z);
                    attr.needsUpdate = true;
                    const facing = tipWorld.sub(centre).normalize().dot(toViewer);
                    l.line.visible = facing > -0.15;
                }
                if (this.calm) return;
                pins.forEach((p) => {
                    const f = (t * 0.6 + p.phase) % 1;
                    p.ring.scale.setScalar(1 + f * 2.6);
                    p.ringMat.opacity = (1 - f) * k;
                });
                for (const arc of arcs) {
                    arc.sparks.forEach((s, i) => {
                        s.position.copy(arc.curve.getPoint((t * arc.speed + i * 0.5) % 1));
                    });
                }
            }
        };
    }

    /** Start a drag on the globe: spin it left/right, tilt it up/down. */
    grabGlobe() {
        const g = this.collab?.globe;
        if (!g || this.collab.mode !== 'map') return null;
        g.dragging = true;
        g.vel = 0;
        let last = performance.now();
        return {
            move: (dx, dy) => {
                const now = performance.now();
                const step = Math.max(8, now - last) / 1000;
                last = now;
                g.yaw += dx * 0.006;
                g.tilt = clamp(g.tilt + dy * 0.004, -0.7, 1.0);
                g.vel = clamp((dx * 0.006) / step, -5, 5);
            },
            end: () => {
                g.dragging = false;
                if (performance.now() - last > 120) g.vel = 0;
            }
        };
    }

    // -----------------------------------------------------------------------
    // Contact
    // -----------------------------------------------------------------------

    buildContact() {
        const { profile } = this.data;
        const contact = profile.contact || {};
        const f = SKIN + 0.01;
        const room = ROOM_BY_ID.contact;

        // Reception desk.
        const desk = new THREE.Group();
        desk.position.set(60.5, 0, 0);
        this.group.add(desk);
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, 4.4), this.darkStone);
        body.position.y = 0.55;
        desk.add(body);
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 4.6), this.frameMats.oak);
        top.position.y = 1.13;
        desk.add(top);
        const mat = new THREE.MeshBasicMaterial({ color: '#1b1a18', toneMapped: false });
        const front = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.9), mat);
        front.position.set(-0.505, 0.58, 0);
        front.rotation.y = -Math.PI / 2;
        desk.add(front);
        this.addSlot(mat, () => art.paintTextPanel({
            width: 1600, height: 360, background: '#1b1a18', ink: '#f4efe6', muted: '#b8b0a3', accent: '#e8c27a', border: false,
            eyebrow: 'Information desk', title: contact.email || 'Contact', footer: profile.copyright, align: 'center', titleSize: 96, bodySize: 36, padding: 0.1
        }), { x: 60, z: 0 }, { persistent: true, placeholder: '#1b1a18' });
        this.world.colliders.push({ x1: 59.9, z1: -2.35, x2: 61.1, z2: 2.35 });
        this.register({ id: 'contact', room: 'contact', kind: 'contact', title: 'Contact information', subtitle: contact.email, payload: contact, icon: 'fas fa-envelope' },
            [body, top, front], { x: 60, y: 1.0, z: 0 }, new THREE.Vector3(-1, 0, 0), 2.2);

        // East wall: the invitation to get in touch.
        const east = { x: 68 - f, z: 0, nx: -1, nz: 0, length: 20 };
        this.plaque(east, 0, {
            w: 8, h: 4.2, y: 3.0, persistent: true, wash: true,
            paint: () => art.paintTextPanel({
                width: 1700, height: 892, eyebrow: 'Contact information', title: 'Let’s collaborate',
                paragraphs: [contact.lead, `${contact.emailLabel}: ${contact.email} (${contact.emailNote})`],
                footer: 'Click to write an email or copy the address', accent: room.accent, titleSize: 84, bodySize: 36
            }),
            exhibit: { id: 'contact-wall', room: 'contact', kind: 'contact', title: 'Let’s collaborate', subtitle: contact.email, payload: contact, catalogue: false }
        });

        // North wall: where to find me.
        const north = { x: 60, z: -10 + f, nx: 0, nz: 1, length: 16 };
        if (contact.location) {
            this.hang(north, 0, {
                w: 4.6, h: 3.45, y: 2.55, frame: 'black', persistent: true,
                paint: () => art.paintMapPlaque(contact.location),
                exhibit: { id: 'location', room: 'contact', kind: 'location', title: 'Location', subtitle: `${contact.location.name}, ${contact.location.sub}`, payload: contact, icon: 'fas fa-location-dot' }
            });
        }

        // South wall: profiles elsewhere, plus the visitor counter.
        const south = { x: 60, z: 10 - f, nx: 0, nz: -1, length: 16 };
        const tiles = [...(profile.social || []), { label: 'Visitors', icon: 'fas fa-flag', color: '#7c2d12', visitors: true }];
        const step = Math.min(1.75, 14 / tiles.length);
        this.plaque(south, 0, {
            w: 6, h: 0.9, y: 4.4, persistent: true, placeholder: room.paint,
            paint: () => art.paintLettering({ text: 'FIND ME ONLINE', width: 1600, height: 240, background: room.paint, color: '#2a2622', size: 110 })
        });
        tiles.forEach((social, i) => {
            const offset = (i - (tiles.length - 1) / 2) * step;
            this.hang(south, offset, {
                w: step * 0.78, h: step * 0.78, y: 2.6, frame: 'none', persistent: true, lamp: false,
                paint: () => art.paintSocialTile(social),
                exhibit: social.visitors
                    ? { id: 'visitors', room: 'contact', kind: 'visitors', title: 'Visitors', subtitle: 'Flag Counter: visitors by country', payload: null, icon: 'fas fa-flag' }
                    : { id: `link-${social.label}`, room: 'contact', kind: 'link', title: social.label, subtitle: social.href, payload: social, icon: social.icon || 'fas fa-link' }
            });
        });
    }
}

const GOLD_ACCENT = '#a07a3f';

export function exhibitHasPanel(exhibit) {
    return exhibit.kind !== 'link';
}
