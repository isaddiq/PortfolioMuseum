// The building: rooms, walls, floors, ceilings, lights and collision.
//
// Plan (x to the east, z to the south, metres):
//
//   z=-26  +---------+---------+---------+---------+
//          | I Educ. | II Exp. | III Pub | IV Proj |
//   z=-8   +--door---+--door---+--door---+--door---+-------+
//   LOBBY  |               GRAND HALL                |CONTACT|
//   z=8    +--door---+--door---+--door---+--door---+-------+
//          | V Skills| VI Tools| VII Awds|VIII Act.|
//   z=26   +---------+---------+---------+---------+
//        x=-20      -2        16        34        52      68
//
// The lobby spans x -52..-20, z -16..16.
//
// Surfaces are scanned CC0 materials from Poly Haven (assets/museum/textures):
// herringbone parquet in the galleries, limestone tiles in the public rooms,
// plaster on walls and ceilings, wool for the runner. UVs are in metres, so a
// texture's repeat is one over its real-world size.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeCanvas, paintWoodGrain, paintBeam, paintSky } from './art.js';

export const SKIN = 0.15;          // half a wall: each room paints its own side
export const EYE = 1.65;
const DOOR_W = 4;
const DOOR_H = 3.8;
const ROOM_H = 5;
const HALL_H = 7;
const AO_HEIGHT = 8;               // wall AO texture spans 0..8 m
export const OCULUS = { x: -36, z: 0, r: 4.2 };

const SIDE_ROOMS = [
    { id: 'education', mini: 'Educ.', numeral: 'I', title: 'Education', side: 'N', cx: -11, paint: '#2c4a3b', accent: '#3f8f63', icon: 'fas fa-graduation-cap', tagline: 'Academic background and credentials', cover: 'assets/images/covers/education-cover.webp', floor: 'wood' },
    { id: 'experience', mini: 'Exper.', numeral: 'II', title: 'Experience', side: 'N', cx: 7, paint: '#22314c', accent: '#4f7cc4', icon: 'fas fa-briefcase', tagline: 'Professional and research history', cover: 'assets/images/covers/experience-cover.webp', floor: 'wood' },
    { id: 'publications', mini: 'Pubs', numeral: 'III', title: 'Publications', side: 'N', cx: 25, paint: '#56222a', accent: '#c2524f', icon: 'fas fa-book', tagline: 'Journals, conferences and reports', cover: 'assets/images/covers/publication-cover.webp', floor: 'wood' },
    { id: 'projects', mini: 'Projects', numeral: 'IV', title: 'Projects', side: 'N', cx: 43, paint: '#34332f', accent: '#c9a25a', icon: 'fas fa-project-diagram', tagline: 'Funded research and design studies', cover: 'assets/images/covers/projects-cover.webp', floor: 'wood' },
    { id: 'skills', mini: 'Skills', numeral: 'V', title: 'Skills', side: 'S', cx: -11, paint: '#1d4a50', accent: '#2fa3a3', icon: 'fas fa-cogs', tagline: 'Proficiency, cast in columns', cover: 'assets/images/covers/skills-cover.webp', floor: 'wood' },
    { id: 'tools', mini: 'Tools', numeral: 'VI', title: 'Tools', side: 'S', cx: 7, paint: '#262a31', accent: '#5aa0e6', icon: 'fas fa-toolbox', tagline: 'Software, web apps and frameworks for AEC', cover: 'assets/images/covers/software-cover.webp', floor: 'wood' },
    { id: 'certifications', mini: 'Awards', numeral: 'VII', title: 'Awards', side: 'S', cx: 25, paint: '#1d3557', accent: '#d4a64a', icon: 'fas fa-award', tagline: 'Honours, scholarships and certifications', cover: 'assets/images/covers/certifications-awards-cover.webp', floor: 'wood' },
    { id: 'activities', mini: 'Activ.', numeral: 'VIII', title: 'Activities', side: 'S', cx: 43, paint: '#45294a', accent: '#b678c0', icon: 'fas fa-users', tagline: 'Peer review, seminars and collaborations', cover: 'assets/images/covers/activities-cover.webp', floor: 'wood' }
];

/** Every room, in navigation order. `rect` is [x1, z1, x2, z2]. */
export const ROOMS = [
    {
        id: 'home', title: 'Lobby', nav: 'Home', short: 'Lobby', icon: 'fas fa-home', rect: [-52, -16, -20, 16],
        height: HALL_H, paint: '#e4dccf', accent: '#b08d57', floor: 'stone', tagline: 'Portrait, research interests and the news screen',
        cover: 'assets/images/covers/home-cover.webp',
        spawn: { x: -47, z: 0, yaw: -Math.PI / 2 },
        openings: [{ side: 'E', from: -6, to: 6, height: 5 }]
    },
    ...SIDE_ROOMS.map((room) => {
        const north = room.side === 'N';
        return {
            ...room,
            nav: room.title,
            short: room.title,
            mini: room.mini,
            height: ROOM_H,
            rect: north ? [room.cx - 9, -26, room.cx + 9, -8] : [room.cx - 9, 8, room.cx + 9, 26],
            spawn: north ? { x: room.cx, z: -10.2, yaw: 0 } : { x: room.cx, z: 10.2, yaw: Math.PI },
            door: north ? { x: room.cx, z: -8 } : { x: room.cx, z: 8 },
            openings: [{ side: north ? 'S' : 'N', from: room.cx - DOOR_W / 2, to: room.cx + DOOR_W / 2, height: DOOR_H }]
        };
    }),
    {
        id: 'contact', title: 'Contact', nav: 'Contact', short: 'Contact', icon: 'fas fa-envelope', rect: [52, -10, 68, 10],
        height: HALL_H, paint: '#e7e1d6', accent: '#c2410c', floor: 'stone', tagline: 'Get in touch',
        cover: 'assets/images/covers/contact-cover.webp',
        spawn: { x: 54.5, z: 0, yaw: -Math.PI / 2 },
        openings: [{ side: 'W', from: -8, to: 8, height: HALL_H }]
    },
    {
        id: 'hall', title: 'Grand Hall', short: 'Grand Hall', rect: [-20, -8, 52, 8], height: HALL_H,
        paint: '#e2d9cb', accent: '#b08d57', floor: 'stone', tagline: 'News and milestones',
        spawn: { x: -16, z: 0, yaw: -Math.PI / 2 },
        openings: [
            { side: 'W', from: -6, to: 6, height: 5 },
            { side: 'E', from: -8, to: 8, height: HALL_H },
            ...SIDE_ROOMS.map((r) => ({ side: r.side, from: r.cx - DOOR_W / 2, to: r.cx + DOOR_W / 2, height: DOOR_H }))
        ]
    }
];

export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r) => [r.id, r]));

export function roomAt(x, z) {
    // Side rooms first: the hall's rect shares their door edges.
    for (const room of ROOMS) {
        const [x1, z1, x2, z2] = room.rect;
        if (x >= x1 && x <= x2 && z >= z1 && z <= z2 && room.id !== 'hall') return room;
    }
    const hall = ROOM_BY_ID.hall;
    const [x1, z1, x2, z2] = hall.rect;
    if (x >= x1 && x <= x2 && z >= z1 && z <= z2) return hall;
    return null;
}

/**
 * Hanging surfaces of a side gallery, in visiting order: left wall, back
 * wall, right wall, then the two short walls either side of the door.
 * Each has a centre point on the wall face, an inward normal and a length.
 */
export function gallerySurfaces(room) {
    const [x1, z1, x2, z2] = room.rect;
    const f = SKIN + 0.01;
    const margin = 0.7;
    const north = room.side === 'N';
    const cx = room.cx;
    const depth = z2 - z1;
    const midZ = (z1 + z2) / 2;
    const walls = north ? {
        left: { x: x1 + f, z: midZ, nx: 1, nz: 0, length: depth },
        back: { x: cx, z: z1 + f, nx: 0, nz: 1, length: x2 - x1 },
        right: { x: x2 - f, z: midZ, nx: -1, nz: 0, length: depth },
        frontRight: { x: cx + 5.5, z: z2 - f, nx: 0, nz: -1, length: 7 },
        frontLeft: { x: cx - 5.5, z: z2 - f, nx: 0, nz: -1, length: 7 }
    } : {
        left: { x: x2 - f, z: midZ, nx: -1, nz: 0, length: depth },
        back: { x: cx, z: z2 - f, nx: 0, nz: -1, length: x2 - x1 },
        right: { x: x1 + f, z: midZ, nx: 1, nz: 0, length: depth },
        frontRight: { x: cx - 5.5, z: z1 + f, nx: 0, nz: 1, length: 7 },
        frontLeft: { x: cx + 5.5, z: z1 + f, nx: 0, nz: 1, length: 7 }
    };
    for (const [name, s] of Object.entries(walls)) {
        s.name = name;
        s.length -= margin * 2;
        s.room = room.id;
    }
    return walls;
}

/** Map a gallery's local (u right, v into the room) coordinates to world x/z. */
export function galleryPoint(room, u, v) {
    return room.side === 'N'
        ? { x: room.cx + u, z: -8 - v }
        : { x: room.cx - u, z: 8 + v };
}

/** Yaw that faces the given world-space direction. */
export function yawFacing(dx, dz) {
    return Math.atan2(-dx, -dz);
}

// ---------------------------------------------------------------------------
// Surface textures
// ---------------------------------------------------------------------------

const TEXTURE_DIR = 'assets/museum/textures/';
const SURFACES = {
    parquet: { size: 3.4, maps: ['color', 'normal', 'rough'] },
    marble: { size: 3.0, maps: ['color', 'normal', 'rough'] },
    plaster: { size: 1.6, maps: ['color', 'normal', 'rough'] },
    wool: { size: 0.55, maps: ['color', 'normal', 'rough'] }
};

/** Load every surface texture; a missing one is simply left out. */
export async function loadSurfaces(renderer, onProgress) {
    const loader = new THREE.TextureLoader();
    const aniso = renderer.capabilities.getMaxAnisotropy();
    const jobs = Object.entries(SURFACES).flatMap(([name, s]) => s.maps.map((map) => ({ name, map, size: s.size })));
    const out = Object.fromEntries(Object.keys(SURFACES).map((k) => [k, {}]));
    let done = 0;
    await Promise.all(jobs.map(async ({ name, map, size }) => {
        try {
            const tex = await loader.loadAsync(`${TEXTURE_DIR}${name}-${map}.webp`);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1 / size, 1 / size);
            tex.anisotropy = aniso;
            tex.colorSpace = map === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            out[name][map] = tex;
        } catch (error) {
            console.warn('Surface texture missing', name, map, error);
        } finally {
            onProgress?.(++done / jobs.length);
        }
    }));
    const grain = canvasTexture(paintWoodGrain('#8a6038'), aniso);
    grain.repeat.set(1 / 0.7, 1 / 0.7);
    out.grain = grain;
    return out;
}

/**
 * Give a mesh UVs in metres from its world position, projected along the
 * dominant axis of each face, plus (optionally) a uv1 channel holding the
 * height for the wall occlusion gradient.
 */
function worldUVs(mesh, withHeight = false) {
    mesh.updateMatrix();
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrix);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const uv = new Float32Array(pos.count * 2);
    const uv1 = withHeight ? new Float32Array(pos.count * 2) : null;
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
        n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix);
        const ax = Math.abs(n.x);
        const ay = Math.abs(n.y);
        const az = Math.abs(n.z);
        if (ay >= ax && ay >= az) { uv[i * 2] = v.x; uv[i * 2 + 1] = -v.z; }
        else if (ax >= az) { uv[i * 2] = v.z; uv[i * 2 + 1] = v.y; }
        else { uv[i * 2] = v.x; uv[i * 2 + 1] = v.y; }
        if (uv1) {
            uv1[i * 2] = 0.5;
            uv1[i * 2 + 1] = v.y / AO_HEIGHT;
        }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (uv1) geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
}

/** Vertical occlusion for walls: darker where they meet the floor. */
function wallOcclusion() {
    const canvas = makeCanvas(4, 256, 1);
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 256, 0, 0);
    grad.addColorStop(0, 'rgb(120,120,120)');
    grad.addColorStop(0.03, 'rgb(175,175,175)');
    grad.addColorStop(0.12, 'rgb(238,238,238)');
    grad.addColorStop(0.3, 'rgb(255,255,255)');
    grad.addColorStop(0.5, 'rgb(250,250,250)');
    grad.addColorStop(0.62, 'rgb(214,214,214)');
    grad.addColorStop(1, 'rgb(150,150,150)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.channel = 1;
    return tex;
}

// ---------------------------------------------------------------------------

export function buildWorld(scene, renderer, surfaces = {}) {
    const colliders = [];   // axis-aligned rects { x1, z1, x2, z2 } and circles { x, z, r }
    const floors = [];
    const themed = { paints: [], floors: [], emissive: [], washes: [], glows: [] };
    const group = new THREE.Group();
    group.name = 'architecture';
    scene.add(group);

    const plaster = surfaces.plaster || {};
    const wallAO = wallOcclusion();

    const trimMat = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.45, metalness: 0.15 });
    const corniceMat = new THREE.MeshStandardMaterial({ color: '#f1ece3', roughness: 0.7, normalMap: plaster.normal || null, normalScale: new THREE.Vector2(0.3, 0.3) });
    const bronzeMat = new THREE.MeshStandardMaterial({ color: '#8a6a43', roughness: 0.32, metalness: 0.9 });
    bronzeMat.userData.cast = true;
    // Ceilings see little direct light; a faint emissive stands in for the
    // light bouncing up off the floors and walls.
    const ceilingMat = new THREE.MeshStandardMaterial({
        color: '#f4f1ec', map: plaster.color || null, normalMap: plaster.normal || null,
        normalScale: new THREE.Vector2(0.2, 0.2), roughness: 0.95, emissive: '#57524b'
    });
    ceilingMat.userData.day = new THREE.Color('#57524b');
    ceilingMat.userData.night = new THREE.Color('#0d0c0b');
    themed.bounce = [ceilingMat];
    const railMat = new THREE.MeshStandardMaterial({ color: '#17161a', roughness: 0.5, metalness: 0.6 });
    // Light panels and skylights are brighter than white so the bloom pass
    // catches them; without bloom they simply clip to white.
    const lightPanelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.12, 1.07, 0.99), toneMapped: false });
    lightPanelMat.userData.day = lightPanelMat.color.clone();
    lightPanelMat.userData.night = new THREE.Color(0.95, 0.86, 0.72);
    themed.emissive.push(lightPanelMat);
    // Gallery laylights: a soft luminous ceiling, dimmer than the panels.
    const laylightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.96, 0.94, 0.89), toneMapped: false });
    laylightMat.userData.day = laylightMat.color.clone();
    laylightMat.userData.night = new THREE.Color(0.2, 0.19, 0.2);
    themed.emissive.push(laylightMat);
    // Track spot lenses: small and hot, so they bloom.
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.3, 1.8), toneMapped: false });
    lensMat.userData.day = lensMat.color.clone();
    lensMat.userData.night = new THREE.Color(3.0, 2.55, 1.85);
    themed.emissive.push(lensMat);
    // The sky seen through the lobby's oculus: painted for day and for night.
    const skyDay = new THREE.CanvasTexture(paintSky(false));
    const skyNight = new THREE.CanvasTexture(paintSky(true));
    skyDay.colorSpace = skyNight.colorSpace = THREE.SRGBColorSpace;
    const skyMat = new THREE.MeshBasicMaterial({ map: skyDay, color: new THREE.Color(1.3, 1.3, 1.3), toneMapped: false });
    themed.sky = { mat: skyMat, day: skyDay, night: skyNight };
    const drumMat = new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.8, side: THREE.BackSide, emissive: '#6f6a60' });
    drumMat.userData.day = new THREE.Color('#6f6a60');
    drumMat.userData.night = new THREE.Color('#0b0d14');

    const paintMats = new Map();
    const paintFor = (hex) => {
        if (!paintMats.has(hex)) {
            const mat = new THREE.MeshStandardMaterial({
                color: hex, map: plaster.color || null, normalMap: plaster.normal || null,
                normalScale: new THREE.Vector2(0.45, 0.45), roughnessMap: plaster.rough || null,
                roughness: 1.0, metalness: 0, aoMap: wallAO, aoMapIntensity: 1
            });
            mat.userData.base = new THREE.Color(hex);
            paintMats.set(hex, mat);
            themed.paints.push(mat);
        }
        return paintMats.get(hex);
    };

    const box = (w, h, d, mat, x, y, z) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        group.add(mesh);
        return mesh;
    };
    const wallBox = (w, h, d, mat, x, y, z) => worldUVs(box(w, h, d, mat, x, y, z), true);

    for (const room of ROOMS) {
        const [x1, z1, x2, z2] = room.rect;
        const w = x2 - x1;
        const d = z2 - z1;
        const h = room.height;
        const paint = paintFor(room.paint);
        room.solid = [];
        room.lights = [];   // pools of light on the floor: { x, z, r }

        // Floor: scanned parquet in the galleries, limestone in the public rooms.
        const stone = room.floor === 'stone';
        const set = (stone ? surfaces.marble : surfaces.parquet) || {};
        const floorGeo = new THREE.PlaneGeometry(w, d);
        floorGeo.setAttribute('uv1', floorGeo.attributes.uv.clone());
        const floorMat = new THREE.MeshStandardMaterial({
            color: '#ffffff',
            map: set.color || null,
            normalMap: set.normal || null,
            normalScale: new THREE.Vector2(stone ? 0.6 : 0.55, stone ? 0.6 : 0.55),
            roughnessMap: set.rough || null,
            // Parquet's map is near-black (varnish); scale it to a satin finish.
            roughness: set.rough ? (stone ? 0.8 : 5.5) : (stone ? 0.35 : 0.55),
            metalness: 0,
            envMapIntensity: stone ? 0.8 : 0.45
        });
        if (!set.color) floorMat.color.set(stone ? '#c9bead' : '#9c7048');
        floorMat.userData.base = floorMat.color.clone();
        themed.floors.push(floorMat);
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
        worldUVs(floor);
        floor.userData.floor = room.id;
        floor.userData.room = room;
        floor.receiveShadow = true;
        group.add(floor);
        floors.push(floor);

        // Ceiling
        let ceilingGeo = new THREE.PlaneGeometry(w, d);
        if (room.id === 'home') {
            // Cut the oculus out of the lobby's ceiling.
            const shape = new THREE.Shape();
            shape.moveTo(-w / 2, -d / 2);
            shape.lineTo(w / 2, -d / 2);
            shape.lineTo(w / 2, d / 2);
            shape.lineTo(-w / 2, d / 2);
            shape.closePath();
            const hole = new THREE.Path();
            hole.absarc(OCULUS.x - (x1 + x2) / 2, OCULUS.z - (z1 + z2) / 2, OCULUS.r, 0, Math.PI * 2, true);
            shape.holes.push(hole);
            ceilingGeo = new THREE.ShapeGeometry(shape, 48);
        }
        const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set((x1 + x2) / 2, h, (z1 + z2) / 2);
        worldUVs(ceiling);
        group.add(ceiling);

        // Walls: one skin per side, cut by openings.
        const sides = {
            N: { axis: 'x', fixed: z1 + SKIN / 2, from: x1, to: x2 },
            S: { axis: 'x', fixed: z2 - SKIN / 2, from: x1, to: x2 },
            W: { axis: 'z', fixed: x1 + SKIN / 2, from: z1, to: z2 },
            E: { axis: 'z', fixed: x2 - SKIN / 2, from: z1, to: z2 }
        };
        for (const [side, s] of Object.entries(sides)) {
            const cuts = room.openings.filter((o) => o.side === side).sort((a, b) => a.from - b.from);
            let cursor = s.from;
            const pieces = [];
            for (const cut of cuts) {
                if (cut.from > cursor) pieces.push({ a: cursor, b: cut.from, y0: 0, y1: h });
                if (cut.height < h) pieces.push({ a: cut.from, b: cut.to, y0: cut.height, y1: h, lintel: true });
                cursor = Math.max(cursor, cut.to);
            }
            if (cursor < s.to) pieces.push({ a: cursor, b: s.to, y0: 0, y1: h });
            for (const piece of pieces) {
                const len = piece.b - piece.a;
                if (len <= 0.01) continue;
                const mid = (piece.a + piece.b) / 2;
                const ph = piece.y1 - piece.y0;
                const cy = (piece.y0 + piece.y1) / 2;
                if (!piece.lintel) room.solid.push({ side, a: piece.a, b: piece.b });
                if (s.axis === 'x') {
                    wallBox(len, ph, SKIN, paint, mid, cy, s.fixed);
                    box(len, 0.16, SKIN + 0.12, corniceMat, mid, h - 0.08, s.fixed);
                    if (!piece.lintel) {
                        colliders.push({ x1: piece.a, z1: s.fixed - SKIN / 2, x2: piece.b, z2: s.fixed + SKIN / 2, wall: true });
                        box(len, 0.18, SKIN + 0.05, trimMat, mid, 0.09, s.fixed);
                    }
                } else {
                    wallBox(SKIN, ph, len, paint, s.fixed, cy, mid);
                    box(SKIN + 0.12, 0.16, len, corniceMat, s.fixed, h - 0.08, mid);
                    if (!piece.lintel) {
                        colliders.push({ x1: s.fixed - SKIN / 2, z1: piece.a, x2: s.fixed + SKIN / 2, z2: piece.b, wall: true });
                        box(SKIN + 0.05, 0.18, len, trimMat, s.fixed, 0.09, mid);
                    }
                }
            }
            // Door frames (architraves) around openings shorter than the room.
            for (const cut of cuts) {
                if (cut.height >= h) continue;
                const t = 0.16;
                const proud = SKIN + 0.08;
                if (s.axis === 'x') {
                    box(t, cut.height, proud, bronzeMat, cut.from + t / 2, cut.height / 2, s.fixed);
                    box(t, cut.height, proud, bronzeMat, cut.to - t / 2, cut.height / 2, s.fixed);
                    box(cut.to - cut.from, t, proud, bronzeMat, (cut.from + cut.to) / 2, cut.height - t / 2, s.fixed);
                } else {
                    box(proud, cut.height, t, bronzeMat, s.fixed, cut.height / 2, cut.from + t / 2);
                    box(proud, cut.height, t, bronzeMat, s.fixed, cut.height / 2, cut.to - t / 2);
                    box(proud, t, cut.to - cut.from, bronzeMat, s.fixed, cut.height - t / 2, (cut.from + cut.to) / 2);
                }
            }
        }

        // Ceiling light panels, each in a shallow recessed trim.
        const panel = (pw, pd, x, z) => {
            room.lights.push({ x, z, r: Math.max(pw, pd) * 0.5 + h * 0.62 });
            const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), lightPanelMat);
            p.rotation.x = Math.PI / 2;
            p.position.set(x, h - 0.03, z);
            group.add(p);
            box(pw + 0.12, 0.04, 0.06, corniceMat, x, h - 0.03, z - pd / 2 - 0.03);
            box(pw + 0.12, 0.04, 0.06, corniceMat, x, h - 0.03, z + pd / 2 + 0.03);
            box(0.06, 0.04, pd, corniceMat, x - pw / 2 - 0.03, h - 0.03, z);
            box(0.06, 0.04, pd, corniceMat, x + pw / 2 + 0.03, h - 0.03, z);
        };
        if (room.id === 'hall') {
            // Coffered ceiling: cross beams with a light panel between each pair.
            for (let x = x1 + 4; x < x2 - 1; x += 8) {
                box(0.45, 0.42, d, corniceMat, x, h - 0.21, (z1 + z2) / 2);
                if (x + 4 < x2 - 2) panel(5, 2.2, x + 4, (z1 + z2) / 2);
            }
        } else if (room.id === 'home') {
            // The oculus: a drum rising through the roof to the open sky.
            const DRUM = 2.2;
            const drum = new THREE.Mesh(new THREE.CylinderGeometry(OCULUS.r, OCULUS.r, DRUM, 72, 1, true), drumMat);
            drum.position.set(OCULUS.x, h + DRUM / 2, OCULUS.z);
            drum.userData.keep = true;
            group.add(drum);
            themed.bounce.push(drumMat);
            const oculus = new THREE.Mesh(new THREE.CircleGeometry(OCULUS.r + 0.02, 72), skyMat);
            oculus.rotation.x = Math.PI / 2;
            oculus.position.set(OCULUS.x, h + DRUM, OCULUS.z);
            oculus.userData.keep = true;
            group.add(oculus);
            // Glazing bars across the opening and a bronze collar around it.
            const barMat = bronzeMat.clone();
            barMat.userData.cast = false;
            for (let i = 0; i < 4; i++) {
                const bar = box(OCULUS.r * 2, 0.07, 0.07, barMat, OCULUS.x, h + DRUM - 0.25, OCULUS.z);
                bar.rotation.y = (i * Math.PI) / 4;
            }
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 32), barMat);
            hub.position.set(OCULUS.x, h + DRUM - 0.25, OCULUS.z);
            group.add(hub);
            // Its own material: it must not cast a ring of shadow on the floor.
            for (const [r, y, tube] of [[OCULUS.r + 0.16, h - 0.05, 0.16], [OCULUS.r + 0.55, h - 0.02, 0.05]]) {
                const ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 14, 96), barMat);
                ring.rotation.x = Math.PI / 2;
                ring.position.set(OCULUS.x, y, OCULUS.z);
                group.add(ring);
            }
            room.lights.push({ x: OCULUS.x, z: OCULUS.z, r: 9.5, power: 1.25 });
            for (const [x, z] of [[-46, 0], [-26, -8], [-26, 8], [-46, -8], [-46, 8]]) panel(2.4, 2.4, x, z);
        } else if (room.id === 'contact') {
            for (const z of [-5, 5]) panel(3, 2, 60, z);
        } else {
            // A laylight in the middle: one luminous ceiling behind glazing bars.
            const cx = (x1 + x2) / 2;
            const cz = (z1 + z2) / 2;
            const L = 6.4;
            const lay = new THREE.Mesh(new THREE.PlaneGeometry(L, L), laylightMat);
            lay.rotation.x = Math.PI / 2;
            lay.position.set(cx, h - 0.02, cz);
            group.add(lay);
            for (let i = 0; i <= 4; i++) {
                const o = -L / 2 + (i * L) / 4;
                const edge = i === 0 || i === 4;
                box(L + 0.2, edge ? 0.14 : 0.07, edge ? 0.2 : 0.07, corniceMat, cx, h - (edge ? 0.07 : 0.05), cz + o);
                box(edge ? 0.2 : 0.07, edge ? 0.14 : 0.07, L + 0.2, corniceMat, cx + o, h - (edge ? 0.07 : 0.05), cz);
            }
            room.lights.push({ x: cx, z: cz, r: 8.5 });
            // Track lighting: a rail around the room with a spot on every bay.
            const inset = 2.5;
            const ry = h - 0.42;
            const rx = w / 2 - inset;
            const rz = d / 2 - inset;
            box(rx * 2 + 0.05, 0.05, 0.05, railMat, cx, ry, cz - rz);
            box(rx * 2 + 0.05, 0.05, 0.05, railMat, cx, ry, cz + rz);
            box(0.05, 0.05, rz * 2 + 0.05, railMat, cx - rx, ry, cz);
            box(0.05, 0.05, rz * 2 + 0.05, railMat, cx + rx, ry, cz);
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) box(0.02, h - ry, 0.02, railMat, cx + sx * rx, (h + ry) / 2, cz + sz * rz);
            }
            const yAxis = new THREE.Vector3(0, 1, 0);
            const spot = (x, z, dx, dz) => {
                const aim = new THREE.Vector3(dx * 0.62, -0.78, dz * 0.62).normalize();
                const q = new THREE.Quaternion().setFromUnitVectors(yAxis, aim);
                const can = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.24, 14), railMat);
                can.quaternion.copy(q);
                can.position.set(x, ry - 0.13, z).addScaledVector(aim, 0.06);
                group.add(can);
                const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.012, 14), lensMat);
                lens.quaternion.copy(q);
                lens.position.copy(can.position).addScaledVector(aim, 0.122);
                group.add(lens);
                box(0.03, 0.09, 0.03, railMat, x, ry - 0.05, z);
            };
            const bays = 6;
            for (let i = 0; i < bays; i++) {
                const t = -1 + (2 * (i + 0.5)) / bays;
                spot(cx + t * rx, cz - rz, 0, -1);
                spot(cx + t * rx, cz + rz, 0, 1);
                spot(cx - rx, cz + t * rz, -1, 0);
                spot(cx + rx, cz + t * rz, 1, 0);
            }
        }
    }

    // Thresholds at gallery doors.
    for (const room of ROOMS.filter((r) => r.door)) {
        box(DOOR_W, 0.02, 0.5, bronzeMat, room.door.x, 0.01, room.door.z);
    }

    // Lobby: columns, the runner and the (closed) entrance doors.
    const columnMat = new THREE.MeshStandardMaterial({ color: '#efe9df', roughness: 0.42, normalMap: plaster.normal || null, normalScale: new THREE.Vector2(0.25, 0.25) });
    columnMat.userData.cast = true;
    // Turned on a lathe: base mouldings, a shaft with entasis, and a capital.
    const profile = [
        [0.74, 0.3], [0.78, 0.36], [0.74, 0.43], [0.66, 0.46], [0.69, 0.52], [0.63, 0.58], [0.6, 0.62],
        [0.6, 1.4], [0.585, 3.2], [0.555, 5.0], [0.53, 6.14],
        [0.57, 6.18], [0.57, 6.24], [0.53, 6.28], [0.53, 6.4], [0.62, 6.52], [0.71, 6.62], [0.73, 6.7]
    ].map(([r, y]) => new THREE.Vector2(r, y));
    for (const [x, z] of [[-46, -11], [-46, 11], [-26, -11], [-26, 11]]) {
        const column = new THREE.Mesh(new THREE.LatheGeometry(profile, 56), columnMat);
        column.position.set(x, 0, z);
        group.add(column);
        box(1.6, 0.3, 1.6, columnMat, x, 0.15, z);
        box(1.6, 0.3, 1.6, columnMat, x, HALL_H - 0.15, z);
        colliders.push({ x, z, r: 0.9 });
    }
    const wool = surfaces.wool || {};
    const rugMat = new THREE.MeshStandardMaterial({
        color: wool.color ? '#d1424d' : '#6b1f24', map: wool.color || null, normalMap: wool.normal || null,
        roughnessMap: wool.rough || null, roughness: 1, envMapIntensity: 0.2
    });
    const rug = new THREE.Mesh(new THREE.BoxGeometry(60, 0.012, 3.4), rugMat);
    rug.position.set(14, 0.006, 0);
    worldUVs(rug);
    rug.userData.noPick = true;
    rug.receiveShadow = true;
    group.add(rug);
    const borderMat = new THREE.MeshStandardMaterial({ color: '#c9a25a', roughness: 0.8, map: wool.color || null });
    for (const z of [-1.55, 1.55]) {
        const b = box(60, 0.014, 0.1, borderMat, 14, 0.007, z);
        worldUVs(b);
    }

    const grain = surfaces.grain || null;
    const doorMat = new THREE.MeshStandardMaterial({ color: '#6a4a30', map: grain, roughness: 0.45, metalness: 0.05 });
    box(0.12, 4.6, 2.1, doorMat, -52 + SKIN + 0.06, 2.3, -1.06);
    box(0.12, 4.6, 2.1, doorMat, -52 + SKIN + 0.06, 2.3, 1.06);
    for (const z of [-1.06, 1.06]) {
        for (const y of [1.3, 3.3]) box(0.03, 1.5, 1.5, doorMat, -52 + SKIN + 0.13, y, z);
    }
    box(0.2, 4.9, 4.7, bronzeMat, -52 + SKIN + 0.02, 2.45, 0);
    for (const z of [-0.25, 0.25]) box(0.1, 0.9, 0.06, bronzeMat, -52 + SKIN + 0.16, 2.2, z);

    // Benches down the hall.
    const benchMat = new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: 0.38, metalness: 0.7 });
    benchMat.userData.cast = true;
    const benchTop = new THREE.MeshStandardMaterial({ color: '#b98452', map: grain, roughness: 0.42 });
    benchTop.userData.cast = true;
    const leather = new THREE.MeshStandardMaterial({ color: '#3a2f29', roughness: 0.62 });
    leather.userData.cast = true;
    /** A bench: a slab of oak on two steel frames, with a leather pad. */
    const bench = (x, z, len = 3.2) => {
        const slab = new THREE.Mesh(new RoundedBoxGeometry(len, 0.09, 0.82, 3, 0.03), benchTop);
        slab.position.set(x, 0.43, z);
        worldUVs(slab);
        group.add(slab);
        const pad = new THREE.Mesh(new RoundedBoxGeometry(len - 0.5, 0.07, 0.66, 3, 0.03), leather);
        pad.position.set(x, 0.5, z);
        group.add(pad);
        for (const sx of [-1, 1]) {
            const lx = x + sx * (len / 2 - 0.32);
            box(0.05, 0.38, 0.05, benchMat, lx, 0.19, z - 0.33);
            box(0.05, 0.38, 0.05, benchMat, lx, 0.19, z + 0.33);
            box(0.05, 0.04, 0.71, benchMat, lx, 0.02, z);
            box(0.05, 0.04, 0.71, benchMat, lx, 0.37, z);
        }
        colliders.push({ x1: x - len / 2, z1: z - 0.45, x2: x + len / 2, z2: z + 0.45 });
    };
    for (const x of [-2, 16, 34]) bench(x, 0);
    // One in the middle of the galleries that have nothing standing there.
    for (const id of ['education', 'experience', 'projects', 'tools', 'skills']) {
        const p = galleryPoint(ROOM_BY_ID[id], 0, 9);
        bench(p.x, p.z, 3);
    }

    // A shaft of daylight from the lobby's oculus.
    const beamTex = new THREE.CanvasTexture(paintBeam());
    const shaftMat = new THREE.MeshBasicMaterial({
        map: beamTex, color: '#fff3dc', transparent: true, opacity: 0.08, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    });
    shaftMat.userData.day = 0.075;
    shaftMat.userData.night = 0.02;
    themed.glows.push(shaftMat);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(OCULUS.r - 0.1, OCULUS.r + 1.1, HALL_H - 0.1, 48, 1, true), shaftMat);
    shaft.rotation.z = Math.PI;  // bright end up, at the oculus
    shaft.position.set(-36, (HALL_H - 0.1) / 2, 0);
    shaft.userData.noPick = true;
    shaft.renderOrder = 2;
    scene.add(shaft);

    // Lights. Artworks are unlit (they glow evenly); these light the building.
    // A skylight key from almost straight above casts the shadows; the
    // hemisphere and environment give the soft bounce.
    const hemi = new THREE.HemisphereLight('#fff7ec', '#6b5a48', 1.0);
    scene.add(hemi);
    const key = new THREE.DirectionalLight('#fff1dc', 1.3);
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 60 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    scene.add(key);
    scene.add(key.target);
    const fill = new THREE.DirectionalLight('#dce8ff', 0.25);
    fill.position.set(-20, 12, -14);
    scene.add(fill);

    mergeStatic(group);
    const world = {
        group, colliders, floors, themed, surfaces,
        lights: { hemi, key, fill },
        materials: { trimMat, bronzeMat, columnMat, corniceMat, railMat },
        followShadow(x, z) {
            const step = 36 / 2048;
            const sx = Math.round(x / step) * step;
            const sz = Math.round(z / step) * step;
            key.position.set(sx + 5, 26, sz + 4);
            key.target.position.set(sx, 0, sz);
            key.target.updateMatrixWorld();
        }
    };
    return world;
}

/**
 * Bake an occlusion map for each floor once the furniture is placed: soft
 * darkening along the walls and under every pedestal, bench and column.
 */
export function bakeFloorOcclusion(world) {
    for (const floor of world.floors) {
        const room = floor.userData.room;
        const [x1, z1, x2, z2] = room.rect;
        const w = x2 - x1;
        const d = z2 - z1;
        const s = Math.min(28, 1536 / Math.max(w, d));
        const canvas = makeCanvas(w * s, d * s, 1);
        const ctx = canvas.getContext('2d');
        // Dim between the lights, brighter in a pool under each of them.
        ctx.fillStyle = 'rgb(196,196,196)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'lighter';
        for (const light of room.lights || []) {
            const lx = (light.x - x1) * s;
            const lz = (light.z - z1) * s;
            const r = light.r * s;
            const v = Math.round(52 * (light.power || 1));
            const m = Math.round(v * 0.6);
            const grad = ctx.createRadialGradient(lx, lz, 0, lx, lz, r);
            grad.addColorStop(0, `rgb(${v},${v},${v})`);
            grad.addColorStop(0.45, `rgb(${m},${m},${m})`);
            grad.addColorStop(1, 'rgb(0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(lx - r, lz - r, r * 2, r * 2);
        }
        ctx.globalCompositeOperation = 'source-over';
        const reach = 1.1 * s;
        for (const piece of room.solid) {
            const a = (piece.a - (piece.side === 'N' || piece.side === 'S' ? x1 : z1)) * s;
            const len = (piece.b - piece.a) * s;
            let grad;
            if (piece.side === 'N') grad = ctx.createLinearGradient(0, 0, 0, reach);
            else if (piece.side === 'S') grad = ctx.createLinearGradient(0, d * s, 0, d * s - reach);
            else if (piece.side === 'W') grad = ctx.createLinearGradient(0, 0, reach, 0);
            else grad = ctx.createLinearGradient(w * s, 0, w * s - reach, 0);
            grad.addColorStop(0, 'rgba(0,0,0,0.5)');
            grad.addColorStop(0.25, 'rgba(0,0,0,0.2)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            if (piece.side === 'N') ctx.fillRect(a, 0, len, reach);
            else if (piece.side === 'S') ctx.fillRect(a, d * s - reach, len, reach);
            else if (piece.side === 'W') ctx.fillRect(0, a, reach, len);
            else ctx.fillRect(w * s - reach, a, reach, len);
        }
        for (const c of world.colliders) {
            if (c.wall) continue;
            if (c.r !== undefined) {
                if (c.x + c.r < x1 || c.x - c.r > x2 || c.z + c.r < z1 || c.z - c.r > z2) continue;
                const cx = (c.x - x1) * s;
                const cz = (c.z - z1) * s;
                const r = (c.r + 0.45) * s;
                const grad = ctx.createRadialGradient(cx, cz, 0, cx, cz, r);
                grad.addColorStop(0, 'rgba(0,0,0,0.5)');
                grad.addColorStop(0.6, 'rgba(0,0,0,0.3)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = grad;
                ctx.fillRect(cx - r, cz - r, r * 2, r * 2);
            } else {
                if (c.x2 < x1 || c.x1 > x2 || c.z2 < z1 || c.z1 > z2) continue;
                // A blurred rectangle: draw it far off-canvas and keep only its shadow.
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.42)';
                ctx.shadowBlur = 0.5 * s;
                ctx.shadowOffsetX = 10000;
                ctx.fillStyle = '#000';
                ctx.fillRect((c.x1 - x1) * s - 10000, (c.z1 - z1) * s, (c.x2 - c.x1) * s, (c.z2 - c.z1) * s);
                ctx.restore();
            }
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.channel = 1;
        floor.material.aoMap = tex;
        floor.material.aoMapIntensity = 1;
        floor.material.needsUpdate = true;
    }
}

/**
 * Bake every static piece (walls, trim, ceilings, fixtures) into one mesh per
 * material: a few dozen draw calls instead of hundreds. Floors stay separate
 * because clicks on them are walk targets.
 */
function mergeStatic(group) {
    const buckets = new Map();
    for (const mesh of [...group.children]) {
        if (!mesh.isMesh || mesh.userData.floor || mesh.userData.noPick || mesh.userData.keep) continue;
        mesh.updateMatrix();
        // Geometries come indexed and not (rounded boxes): merge them all unindexed.
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrix);
        if (!buckets.has(mesh.material)) buckets.set(mesh.material, []);
        buckets.get(mesh.material).push(geo);
        group.remove(mesh);
        mesh.geometry.dispose();
    }
    for (const [material, geos] of buckets) {
        // Only the attributes every piece has can be merged.
        const shared = Object.keys(geos[0].attributes).filter((name) => geos.every((g) => g.attributes[name]));
        for (const g of geos) {
            for (const name of Object.keys(g.attributes)) if (!shared.includes(name)) g.deleteAttribute(name);
        }
        const merged = mergeGeometries(geos, false);
        geos.forEach((g) => g.dispose());
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = material.userData.cast === true;
        mesh.receiveShadow = !material.isMeshBasicMaterial;
        group.add(mesh);
    }
}

export function canvasTexture(canvas, anisotropy = 8) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = anisotropy;
    return tex;
}

/** Day and night lighting moods. */
export function applyWorldTheme(world, scene, theme) {
    const night = theme === 'dark';
    const { hemi, key, fill } = world.lights;
    hemi.intensity = night ? 0.16 : 1.1;
    key.intensity = night ? 0.12 : 1.3;
    fill.intensity = night ? 0.04 : 0.22;
    scene.environmentIntensity = night ? 0.12 : 0.5;
    const bg = night ? '#050608' : '#ece6db';
    scene.background = new THREE.Color(bg);
    scene.fog = new THREE.Fog(bg, night ? 30 : 60, night ? 90 : 140);
    for (const mat of world.themed.paints) {
        mat.color.copy(mat.userData.base).multiplyScalar(night ? 0.6 : 1);
    }
    for (const mat of world.themed.floors) {
        mat.color.copy(mat.userData.base).multiplyScalar(night ? 0.55 : 1);
    }
    for (const mat of world.themed.emissive) {
        mat.color.copy(night ? mat.userData.night : mat.userData.day);
    }
    for (const mat of world.themed.washes) {
        mat.opacity = night ? 0.95 : 0.42;
    }
    for (const mat of world.themed.glows) {
        mat.opacity = night ? mat.userData.night : mat.userData.day;
    }
    for (const mat of world.themed.bounce || []) {
        mat.emissive.copy(night ? mat.userData.night : mat.userData.day);
    }
    const sky = world.themed.sky;
    if (sky) {
        sky.mat.map = night ? sky.night : sky.day;
        sky.mat.color.setScalar(night ? 1 : 1.3);
        sky.mat.needsUpdate = true;
    }
}
