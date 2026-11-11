// Entry point: loads the data, builds the museum and runs the visit.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { loadAllData } from './data.js';
import { ROOMS, ROOM_BY_ID, roomAt, buildWorld, applyWorldTheme, loadSurfaces, bakeFloorOcclusion } from './world.js';
import { Museum } from './exhibits.js';
import { Visitors } from './visitors.js';
import { Controls } from './controls.js';
import { Panels, controlsHelp, closeLightbox } from './panels.js';
import { createPipeline } from './post.js';
import { createFloorReflection } from './reflect.js';
import { drawFloorPlan, PAINT } from './art.js';
import { escapeHtml } from './util.js';

const HOME_TITLE = 'Saddiq Ur Rehman, PhD in Architecture, Kyung Hee University';
const HASH_ALIASES = { software: 'tools', awards: 'certifications' };
// Number keys jump between rooms, in the order of the top bar.
const ROOM_KEYS = ['home', 'education', 'experience', 'publications', 'projects', 'skills', 'tools', 'certifications', 'activities', 'contact'];

/** High: bloom, shadows, mirrored floors, sharper textures. Low: for phones and small GPUs. */
const QUALITY = {
    high: { pixelRatio: 1.5, bloom: true, shadows: true, reflections: true, paintScale: 1.75, imagePxPerM: 760, visitors: 10 },
    low: { pixelRatio: 1.25, bloom: false, shadows: false, reflections: false, paintScale: 1.15, imagePxPerM: 440, visitors: 5 }
};
const CALM = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;

const $ = (id) => document.getElementById(id);

const state = {
    room: null,
    needsRender: true,
    entered: false,
    lastSlotUpdate: 0,
    quality: 'high'
};

queueMicrotask(() => main().catch((error) => {
    console.error(error);
    showFatal('Something went wrong while building the museum.');
}));

async function main() {
    initTheme();
    if (!webglAvailable()) {
        showFatal('Your browser cannot display the 3D museum (WebGL is unavailable).');
        return;
    }
    state.quality = initialQuality();
    const q = QUALITY[state.quality];
    PAINT.scale = q.paintScale;

    setProgress(0.04, 'Opening the doors…');
    const fontsReady = loadFonts();
    const data = await loadAllData((p) => setProgress(0.04 + p * 0.22, 'Collecting the works…'));
    await fontsReady;

    // Renderer, scene and camera.
    const canvas = $('scene');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 160);
    const requestRender = () => { state.needsRender = true; };

    setProgress(0.28, 'Laying the floors…');
    const surfaces = await loadSurfaces(renderer, (p) => setProgress(0.28 + p * 0.2, 'Laying the floors…'));
    setProgress(0.5, 'Building the galleries…');
    const world = buildWorld(scene, renderer, surfaces);
    world.lights.key.castShadow = q.shadows;
    const museum = new Museum({ scene, renderer, data, world, requestRender });
    museum.pxPerM = q.imagePxPerM;
    museum.build();
    bakeFloorOcclusion(world);
    setProgress(0.6, 'Hanging the artworks…');

    let pipeline = q.bloom ? createPipeline(renderer, scene, camera) : null;

    // Polished floors mirror the room (high quality only).
    const reflection = createFloorReflection(renderer, scene, camera, world.floors);
    for (const floor of world.floors) {
        const stone = floor.userData.room.floor === 'stone';
        floor.material.userData.env = floor.material.envMapIntensity;
        reflection.patch(floor.material, stone ? { strength: 0.7, blur: 1.4, specular: 0.25 } : { strength: 0.42, blur: 2.4, specular: 0.3 });
    }

    // Brackets that close around the work under the pointer.
    const highlight = createHighlight(scene);

    const floorRing = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.28, 40),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false })
    );
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.visible = false;
    floorRing.userData.noPick = true;
    scene.add(floorRing);

    // Picking. Hidden things (the hologram view not shown) are skipped.
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 0.02;
    raycaster.params.Points.threshold = 0;
    const pointer = new THREE.Vector2();
    const pickTargets = [world.group, museum.group];
    const shown = (obj) => {
        for (let o = obj; o; o = o.parent) if (!o.visible) return false;
        return true;
    };
    function pick(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(pickTargets, true);
        for (const hit of hits) {
            if (hit.object.userData.noPick || hit.object.isPoints || hit.object.isLine || !shown(hit.object)) continue;
            if (hit.distance > 40) return null;
            if (hit.object.userData.exhibitId) return { exhibit: museum.byId.get(hit.object.userData.exhibitId), point: hit.point };
            if (hit.object.userData.floor) return { floor: true, point: hit.point };
            return null;
        }
        return null;
    }

    const controls = new Controls(camera, canvas, world.colliders, {
        calm: CALM,
        onClick: (x, y) => {
            const hit = pick(x, y);
            if (!hit) return;
            if (hit.exhibit) {
                goToExhibit(hit.exhibit, { open: true });
            } else if (hit.floor) {
                const target = { x: hit.point.x, z: hit.point.z, yaw: controls.yaw, pitch: Math.max(-0.2, Math.min(0.2, controls.pitch)) };
                const dist = Math.hypot(target.x - controls.x, target.z - controls.z);
                const k = Math.max(0, dist - 0.2) / Math.max(dist, 1e-6);
                target.x = controls.x + (target.x - controls.x) * k;
                target.z = controls.z + (target.z - controls.z) * k;
                controls.glideTo(target);
            }
        },
        onHover: (x, y) => queueHover(x, y),
        onUserMove: () => hideHelpSoon(),
        onGrab: (x, y) => {
            if (museum.collab?.mode !== 'map') return null;
            return pick(x, y)?.exhibit?.id === 'collab-map' ? museum.grabGlobe() : null;
        }
    });
    controls.bindJoystick($('joystick'), $('joystick-knob'));

    // Hover: tooltip for exhibits, a ring on the floor.
    let hoverPending = null;
    const tip = $('hover-tip');
    function queueHover(x, y) {
        if (hoverPending === null) requestAnimationFrame(runHover);
        hoverPending = x === null ? false : { x, y };
    }
    function hoverText(exhibit) {
        if (exhibit.kind === 'tv') {
            const item = exhibit.payload.current();
            return { title: item?.title || exhibit.title, action: 'On screen now · click to read' };
        }
        if (exhibit.kind === 'collabToggle') {
            return { title: exhibit.title, action: museum.collab?.mode === 'map' ? 'Click to show the network' : 'Click to show the world map' };
        }
        if (exhibit.id === 'collab-map') return { title: exhibit.title, action: 'Drag to spin · click for details' };
        return { title: exhibit.title, action: exhibit.kind === 'link' ? 'Click to open' : 'Click to view' };
    }
    function runHover() {
        const h = hoverPending;
        hoverPending = null;
        if (!h || controls.glide || controls.pointer) {
            setHover(null);
            tip.hidden = true;
            if (floorRing.visible) { floorRing.visible = false; requestRender(); }
            canvas.style.cursor = '';
            return;
        }
        const hit = pick(h.x, h.y);
        setHover(hit?.exhibit || null);
        if (hit?.exhibit) {
            const text = hoverText(hit.exhibit);
            tip.hidden = false;
            tip.innerHTML = `<i class="${escapeHtml(hit.exhibit.icon || 'fas fa-circle-info')}" aria-hidden="true"></i><span><strong>${escapeHtml(text.title)}</strong><em>${escapeHtml(text.action)}</em></span>`;
            const x = Math.min(h.x + 16, window.innerWidth - tip.offsetWidth - 12);
            tip.style.transform = `translate(${x}px, ${h.y + 18}px)`;
            canvas.style.cursor = hit.exhibit.id === 'collab-map' ? 'grab' : 'pointer';
        } else {
            tip.hidden = true;
            canvas.style.cursor = '';
        }
        const showRing = !!hit?.floor;
        if (showRing) floorRing.position.set(hit.point.x, 0.012, hit.point.z);
        if (showRing || floorRing.visible) requestRender();
        floorRing.visible = showRing;
    }

    // The brackets follow the pointer; with a panel open they stay on its work.
    let hovered = null;
    function setHover(exhibit) {
        hovered = exhibit;
        refreshHighlight();
    }
    function refreshHighlight() {
        if (highlight.show(hovered || (panels?.isOpen ? panels.current : null), shown)) requestRender();
    }

    // Panels and navigation.
    const panels = new Panels({
        data, museum,
        onStep: (exhibit) => goToExhibit(exhibit, { open: true }),
        onChange: () => refreshHighlight(),
        onNavigate: (roomId) => goToRoom(roomId),
        onShowExhibit: (exhibit) => {
            if (window.matchMedia('(max-width: 760px)').matches) panels.close();
            goToExhibit(exhibit, { open: false });
        },
        onAction: (action) => {
            if (action === 'collab-network' || action === 'collab-map') {
                const mode = action === 'collab-map' ? 'map' : 'network';
                museum.setCollabView(mode);
                if (window.matchMedia('(max-width: 760px)').matches) panels.close();
                const target = museum.byId.get(mode === 'map' ? 'collab-map' : 'collab-network');
                if (target) goToExhibit(target, { open: false });
            }
        }
    });

    async function teleport(pose) {
        const fade = $('fade');
        fade.classList.add('is-on');
        await wait(220);
        controls.setPose(pose);
        onPlayerMoved(true);
        requestRender();
        await wait(60);
        fade.classList.remove('is-on');
    }

    async function goToExhibit(exhibit, { open }) {
        if (!exhibit) return;
        if (exhibit.kind === 'link') {
            panels.open(exhibit);
            return;
        }
        if (exhibit.kind === 'tv') {
            const item = exhibit.payload.current();
            panels.open(museum.byId.get(`news-${item?.id}`) || exhibit);
            return;
        }
        if (exhibit.kind === 'collabToggle') {
            museum.toggleCollabView();
            return;
        }
        if (open) panels.open(exhibit);
        const view = exhibit.view;
        if (!view) return;
        const near = Math.hypot(view.x - controls.x, view.z - controls.z) < 30;
        if (near && pathClear(world.colliders, controls, view)) {
            await controls.glideTo(view);
        } else {
            await teleport(view);
        }
        onPlayerMoved(true);
    }

    function goToRoom(id) {
        const room = ROOM_BY_ID[id] || ROOM_BY_ID.home;
        teleport(room.spawn);
    }

    // Room tracking: nav state, address bar, title, toast.
    function onPlayerMoved(force) {
        const now = performance.now();
        if (force || now - state.lastSlotUpdate > 250) {
            state.lastSlotUpdate = now;
            museum.updateSlots(controls.x, controls.z);
        }
        world.followShadow(controls.x, controls.z);
        const room = roomAt(controls.x, controls.z);
        if (room && room.id !== state.room) {
            state.room = room.id;
            onRoomChange(room);
        }
        minimap.draw();
    }

    function onRoomChange(room) {
        document.querySelectorAll('.nav-btn').forEach((btn) => {
            const active = btn.dataset.room === room.id;
            btn.classList.toggle('active', active);
            if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
        });
        $('current-room').textContent = room.numeral ? `${room.numeral} · ${room.title}` : room.title;
        document.body.classList.toggle('in-activities', room.id === 'activities');
        museum.onRoomEnter(room.id);
        if (room.id !== 'hall' && state.entered) {
            history.replaceState(null, '', `#${room.id}`);
            document.title = room.id === 'home' ? HOME_TITLE : `${room.title} | Saddiq Ur Rehman`;
        }
        if (state.entered) showToast(room);
    }

    // Hologram view switch (shown in Gallery VIII).
    const viewButtons = document.querySelectorAll('[data-collab-view]');
    museum.onCollabView = (mode) => {
        viewButtons.forEach((b) => {
            const on = b.dataset.collabView === mode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
        // The projector's footprint changes with the view; step clear of it.
        controls.resolveCollisions();
        controls.apply();
        requestRender();
    };
    museum.onCollabView('network');
    viewButtons.forEach((b) => b.addEventListener('click', () => museum.setCollabView(b.dataset.collabView)));
    $('collab-toggle').addEventListener('click', () => museum.toggleCollabView());

    // Minimap.
    const minimap = createMinimap($('minimap'), controls, (id) => goToRoom(id));

    // Catalogue (text view of every exhibit).
    buildCatalogue(museum, (exhibit) => {
        closeCatalogue();
        goToExhibit(exhibit, { open: true });
    });

    // HUD wiring.
    document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', () => {
        closeMenu();
        goToRoom(btn.dataset.room);
    }));
    $('menu-toggle').addEventListener('click', () => {
        const open = !document.body.classList.contains('menu-open');
        document.body.classList.toggle('menu-open', open);
        $('menu-toggle').setAttribute('aria-expanded', String(open));
    });
    $('btn-catalogue').addEventListener('click', openCatalogue);
    $('btn-map').addEventListener('click', () => minimap.toggle());
    $('btn-help').addEventListener('click', () => toggleHelp());
    document.querySelectorAll('[data-quality-set]').forEach((btn) => btn.addEventListener('click', () => {
        if (btn.dataset.qualitySet !== state.quality) setQuality(btn.dataset.qualitySet, true);
    }));
    document.querySelectorAll('[data-theme-set]').forEach((btn) => btn.addEventListener('click', () => {
        const next = btn.dataset.themeSet;
        if (next === document.documentElement.dataset.theme) return;
        setTheme(next, true);
        applyWorldTheme(world, scene, next);
        minimap.draw(true);
        requestRender();
    }));
    $('lightbox').addEventListener('click', (ev) => {
        if (ev.target.closest('button') || ev.target === $('lightbox')) closeLightbox();
    });
    $('help-close').addEventListener('click', () => toggleHelp(false));
    $('help-body').innerHTML = controlsHelp();

    window.addEventListener('keydown', (ev) => {
        if (isTyping(ev.target) && ev.key !== 'Escape') return;
        if (ev.key === 'Escape') {
            if (!$('lightbox').hidden) closeLightbox();
            else if (panels.isOpen) panels.close();
            else if (document.body.classList.contains('catalogue-open')) closeCatalogue();
            else toggleHelp(false);
        } else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && state.entered) {
            if (ev.code === 'KeyM') minimap.toggle();
            if (ev.code === 'KeyC') openCatalogue();
            if (ev.code === 'KeyH' || ev.key === '?') toggleHelp();
            if (ev.code === 'KeyV' && state.room === 'activities') museum.toggleCollabView();
            if (ev.code === 'KeyN' && panels.isOpen) panels.step(1);
            if (ev.code === 'KeyP' && panels.isOpen) panels.step(-1);
            const digit = /^Digit(\d)$/.exec(ev.code);
            if (digit) {
                const id = ROOM_KEYS[(Number(digit[1]) + 9) % 10];
                if (id) goToRoom(id);
            }
        }
    });
    window.addEventListener('hashchange', () => {
        const id = roomFromHash();
        if (state.entered && id && id !== state.room) goToRoom(id);
    });

    // Quality switch: bloom and shadows on or off, at runtime.
    function setQuality(mode, persist) {
        state.quality = mode;
        const cfg = QUALITY[mode];
        PAINT.scale = cfg.paintScale;
        museum.pxPerM = cfg.imagePxPerM;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatio));
        reflection.enabled = cfg.reflections;
        for (const floor of world.floors) {
            floor.material.envMapIntensity = floor.material.userData.env * (cfg.reflections ? 0.3 : 1);
        }
        if (cfg.bloom && !pipeline) pipeline = createPipeline(renderer, scene, camera);
        if (!cfg.bloom && pipeline) {
            pipeline.dispose();
            pipeline = null;
        }
        renderer.shadowMap.enabled = cfg.shadows;
        world.lights.key.castShadow = cfg.shadows;
        scene.traverse((o) => {
            if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; });
        });
        document.querySelectorAll('[data-quality-set]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.dataset.qualitySet === mode));
        });
        if (persist) safeSet('museum-quality', mode);
        resize();
    }

    // Sizing.
    function resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.fov = w / h < 0.8 ? 78 : 70;
        camera.updateProjectionMatrix();
        pipeline?.setSize(w, h);
        const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
        reflection.setSize(buffer.x, buffer.y);
        highlight.setSize(w, h);
        museum.setViewport(h * renderer.getPixelRatio(), camera.fov);
        requestRender();
    }
    window.addEventListener('resize', resize);
    setQuality(state.quality, false);

    // First pose: the room named in the address, else the lobby.
    const startRoom = ROOM_BY_ID[roomFromHash()] || ROOM_BY_ID.home;
    controls.setPose(startRoom.spawn);
    applyWorldTheme(world, scene, document.documentElement.dataset.theme);
    onPlayerMoved(true);

    // Visitors arrive once the doors are open (they load in the background).
    let visitors = null;

    // Render loop: draws only when something changed or something nearby moves.
    let last = performance.now();
    function frame(now) {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (controls.update(dt)) {
            onPlayerMoved(false);
            state.needsRender = true;
        }
        if (museum.animate(now / 1000, dt, controls.x, controls.z)) state.needsRender = true;
        if (visitors?.update(now / 1000, dt, controls.x, controls.z)) state.needsRender = true;
        if (highlight.update(now / 1000, dt)) state.needsRender = true;
        if (state.needsRender) {
            state.needsRender = false;
            if (reflection.enabled) {
                // The mirrored pass refreshes the shadow map; the main pass reuses it.
                reflection.render();
                renderer.shadowMap.autoUpdate = false;
            }
            if (pipeline) pipeline.render();
            else renderer.render(scene, camera);
            renderer.shadowMap.autoUpdate = true;
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Wait for the textures around the starting point, then walk straight in.
    await new Promise((resolve) => {
        const started = performance.now();
        const tick = () => {
            const p = museum.nearbyProgress(controls.x, controls.z);
            setProgress(0.6 + p * 0.4, 'Hanging the artworks…');
            if (p >= 0.98 || performance.now() - started > 9000) resolve();
            else setTimeout(tick, 120);
        };
        tick();
    });
    setProgress(1, 'Welcome');
    // Arriving through the front doors: a slow walk in as the loader lifts.
    const arrival = startRoom.id === 'home' && !CALM;
    if (arrival) controls.setPose({ ...startRoom.spawn, x: startRoom.spawn.x + 3.4 * Math.sin(startRoom.spawn.yaw), pitch: 0.16 });
    enter();
    if (arrival) controls.glideTo({ ...startRoom.spawn, pitch: 0 }, 3.6);
    const people = new Visitors({ scene, museum, world, count: QUALITY[state.quality].visitors });
    people.load().then(() => { visitors = people; }).catch((error) => console.warn('Visitors could not load', error));

    function enter() {
        if (state.entered) return;
        state.entered = true;
        document.body.classList.add('has-entered');
        $('loader').setAttribute('aria-hidden', 'true');
        onRoomChange(roomAt(controls.x, controls.z));
        if (!safeGet('museum-help-seen')) toggleHelp(true);
        canvas.focus({ preventScroll: true });
    }

    function hideHelpSoon() {
        if (!state.helpTimer && !$('help').hidden && state.entered) {
            state.helpTimer = setTimeout(() => toggleHelp(false), 7000);
        }
    }

    // Debug/automation handle.
    window.__museum = { controls, museum, world, goToRoom, goToExhibit, panels, scene, camera, renderer, requestRender, setQuality, get visitors() { return visitors; } };
}

// ---------------------------------------------------------------------------
// Pieces of the HUD
// ---------------------------------------------------------------------------

/** Whether a straight walk from a to b stays clear of walls and furniture. */
function pathClear(colliders, a, b) {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(dist / 0.25);
    for (let i = 1; i < steps; i++) {
        const x = a.x + ((b.x - a.x) * i) / steps;
        const z = a.z + ((b.z - a.z) * i) / steps;
        if (!roomAt(x, z)) return false;
        for (const c of colliders) {
            if (c.person) continue;   // people step aside
            if (c.r !== undefined ? Math.hypot(x - c.x, z - c.z) < c.r + 0.1
                : x > c.x1 - 0.1 && x < c.x2 + 0.1 && z > c.z1 - 0.1 && z < c.z2 + 0.1) return false;
        }
    }
    return true;
}

/**
 * Corner brackets drawn around an exhibit: eight corners of its bounding box,
 * a short stroke along each edge. Brighter than white, so they bloom a little.
 */
function createHighlight(scene) {
    const positions = new Float32Array(8 * 3 * 2 * 3);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    // Fat lines: a stroke a few pixels wide whatever the distance.
    const material = new LineMaterial({ color: 0xffffff, linewidth: 2.5, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    material.color.setRGB(2.3, 2.3, 2.4);
    const lines = new LineSegments2(geometry, material);
    lines.frustumCulled = false;
    lines.visible = false;
    lines.userData.noPick = true;
    lines.renderOrder = 5;
    scene.add(lines);
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    let id = null;
    let target = 0;
    let alpha = 0;
    let pulse = 0;

    function fit(exhibit, shown) {
        box.makeEmpty();
        for (const mesh of exhibit.meshes || []) {
            if (!mesh.isMesh || !shown(mesh)) continue;
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            mesh.updateWorldMatrix(true, false);
            box.union(part.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
        }
        if (box.isEmpty()) return false;
        box.expandByScalar(0.05);
        const { min, max } = box;
        const size = [max.x - min.x, max.y - min.y, max.z - min.z];
        const reach = size.map((s) => Math.min(0.22, s * 0.28));
        let i = 0;
        for (let c = 0; c < 8; c++) {
            const corner = [c & 1 ? max.x : min.x, c & 2 ? max.y : min.y, c & 4 ? max.z : min.z];
            for (let axis = 0; axis < 3; axis++) {
                const end = corner.slice();
                end[axis] += (c & (1 << axis) ? -1 : 1) * reach[axis];
                positions.set(corner, i);
                positions.set(end, i + 3);
                i += 6;
            }
        }
        geometry.setPositions(positions);
        return true;
    }

    return {
        setSize(w, h) {
            material.resolution.set(w, h);
        },
        /** Point the brackets at an exhibit (or nothing). True when that changed. */
        show(exhibit, shown) {
            const next = exhibit && !exhibit.noHighlight ? exhibit.id : null;
            if (next === id) return false;
            id = next;
            target = next && fit(exhibit, shown) ? 1 : 0;
            if (target) pulse = 0;
            return true;
        },
        update(t, dt) {
            if (alpha === target && !target) return false;
            alpha += (target - alpha) * (1 - Math.exp(-dt * 12));
            if (Math.abs(target - alpha) < 0.004) alpha = target;
            pulse += dt;
            lines.visible = alpha > 0.004;
            // Two soft pulses as it lands, then it holds still (and stops asking for frames).
            const settle = CALM ? 0 : Math.exp(-pulse * 1.1);
            material.opacity = alpha * (0.86 + 0.14 * Math.cos(pulse * 6) * settle);
            return alpha !== target || (lines.visible && settle > 0.02);
        }
    };
}

function createMinimap(canvas, controls, onRoom) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 260;
    const H = 124;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    let base = null;
    let geometry = null;
    let lastKey = '';
    let dark = true;
    const wrap = canvas.closest('.minimap');

    function drawBase() {
        const off = document.createElement('canvas');
        off.width = W * dpr;
        off.height = H * dpr;
        const octx = off.getContext('2d');
        octx.scale(dpr, dpr);
        dark = document.documentElement.dataset.theme === 'dark';
        geometry = drawFloorPlan(octx, ROOMS, W, H, { dark, mono: true, highlight: null, labels: 'mini', pad: 0.04 });
        base = off;
    }

    function draw(force) {
        if (!base || force) drawBase();
        const room = roomAt(controls.x, controls.z);
        const key = `${controls.x.toFixed(1)},${controls.z.toFixed(1)},${controls.yaw.toFixed(2)}`;
        if (key === lastKey && !force) return;
        lastKey = key;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(base, 0, 0);
        ctx.scale(dpr, dpr);
        if (room) {
            const [x1, z1, x2, z2] = room.rect;
            const [ax, ay] = geometry.map(x1, z1);
            const [bx, by] = geometry.map(x2, z2);
            ctx.fillStyle = dark ? 'rgba(255,255,255,0.2)' : 'rgba(20,22,26,0.16)';
            ctx.fillRect(ax, ay, bx - ax, by - ay);
        }
        const [px, py] = geometry.map(controls.x, controls.z);
        const fx = -Math.sin(controls.yaw);
        const fz = -Math.cos(controls.yaw);
        const ang = Math.atan2(fz, fx);
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.3)' : 'rgba(20,22,26,0.22)';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.arc(px, py, 16, ang - 0.6, ang + 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = dark ? '#ffffff' : '#17181b';
        ctx.strokeStyle = dark ? '#17181b' : '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    canvas.addEventListener('click', (ev) => {
        const rect = canvas.getBoundingClientRect();
        const x = ((ev.clientX - rect.left) / rect.width) * W;
        const y = ((ev.clientY - rect.top) / rect.height) * H;
        for (const room of ROOMS) {
            const [x1, z1, x2, z2] = room.rect;
            const [ax, ay] = geometry.map(x1, z1);
            const [bx, by] = geometry.map(x2, z2);
            if (x >= ax && x <= bx && y >= ay && y <= by && room.id !== 'hall') {
                onRoom(room.id);
                return;
            }
        }
        const hall = ROOM_BY_ID.hall;
        const [ax, ay] = geometry.map(hall.rect[0], hall.rect[1]);
        const [bx, by] = geometry.map(hall.rect[2], hall.rect[3]);
        if (x >= ax && x <= bx && y >= ay && y <= by) onRoom('hall');
    });

    return {
        draw,
        toggle() {
            const hidden = wrap.classList.toggle('is-collapsed');
            $('btn-map').setAttribute('aria-pressed', String(!hidden));
        }
    };
}

function buildCatalogue(museum, onPick) {
    const list = $('catalogue-list');
    const order = ['home', 'hall', 'education', 'experience', 'publications', 'projects', 'skills', 'tools', 'certifications', 'activities', 'contact'];
    const groups = order.map((id) => ({ room: ROOM_BY_ID[id], items: museum.exhibits.filter((x) => x.room === id && x.catalogue !== false) }))
        .filter((g) => g.items.length);
    list.innerHTML = groups.map((g) => `
        <section class="cat-room" data-cat-room="${g.room.id}" style="--room-accent:${escapeHtml(g.room.accent || '#8a8f98')}">
            <h2><span>${g.room.numeral ? `Gallery ${g.room.numeral}` : g.room.id === 'hall' ? 'Grand Hall' : g.room.title}</span>${escapeHtml(g.room.title)} <small>${escapeHtml(g.room.tagline || '')}</small></h2>
            <ul>${g.items.map((x) => `
                <li data-search="${escapeHtml(`${x.title} ${x.subtitle || ''}`.toLowerCase())}">
                    <button type="button" data-exhibit="${escapeHtml(x.id)}">
                        <i class="${escapeHtml(x.icon || 'fas fa-circle')}" aria-hidden="true"></i>
                        <span><strong>${escapeHtml(x.title)}</strong>${x.subtitle ? `<small>${escapeHtml(x.subtitle)}</small>` : ''}</span>
                    </button>
                </li>`).join('')}</ul>
        </section>`).join('');
    list.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-exhibit]');
        if (btn) onPick(museum.byId.get(btn.dataset.exhibit));
    });
    const search = $('catalogue-search');
    const empty = $('catalogue-empty');
    search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        list.querySelectorAll('li[data-search]').forEach((li) => { li.hidden = !!q && !q.split(/\s+/).every((w) => li.dataset.search.includes(w)); });
        list.querySelectorAll('.cat-room').forEach((sec) => { sec.hidden = !sec.querySelector('li:not([hidden])'); });
        empty.hidden = !!list.querySelector('.cat-room:not([hidden])');
    });
    $('catalogue-close').addEventListener('click', closeCatalogue);
    $('catalogue').addEventListener('click', (ev) => { if (ev.target === $('catalogue')) closeCatalogue(); });
    $('catalogue-count').textContent = `${groups.reduce((n, g) => n + g.items.length, 0)} works on display`;
}

function openCatalogue() {
    document.body.classList.add('catalogue-open');
    $('catalogue').setAttribute('aria-hidden', 'false');
    setTimeout(() => $('catalogue-search').focus({ preventScroll: true }), 50);
}

function closeCatalogue() {
    document.body.classList.remove('catalogue-open');
    $('catalogue').setAttribute('aria-hidden', 'true');
    $('scene').focus({ preventScroll: true });
}

function closeMenu() {
    document.body.classList.remove('menu-open');
    $('menu-toggle').setAttribute('aria-expanded', 'false');
}

let toastTimer = null;
function showToast(room) {
    const toast = $('room-toast');
    toast.querySelector('.toast-eyebrow').textContent = room.numeral ? `Gallery ${room.numeral}` : room.id === 'hall' ? 'Galleries I – VIII' : 'Welcome';
    toast.querySelector('.toast-title').textContent = room.title;
    toast.querySelector('.toast-sub').textContent = room.tagline || '';
    toast.style.setProperty('--room-accent', room.accent || '#9aa0a8');
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2600);
}

function toggleHelp(show) {
    const help = $('help');
    const next = show ?? help.hidden;
    help.hidden = !next;
    $('btn-help').setAttribute('aria-expanded', String(next));
    if (!next) safeSet('museum-help-seen', '1');
}

function roomFromHash() {
    const raw = decodeURIComponent(location.hash.replace(/^#/, '')).toLowerCase();
    const id = HASH_ALIASES[raw] || raw;
    return ROOM_BY_ID[id] && id !== 'hall' ? id : null;
}

// ---------------------------------------------------------------------------
// Theme, quality, loading and fallbacks
// ---------------------------------------------------------------------------

function initTheme() {
    const saved = safeGet('preferred-theme');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    setTheme(saved || (prefersDark ? 'dark' : 'light'), false);
}

function setTheme(theme, persist) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-set]').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.themeSet === theme));
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0c0e' : '#e9eaec');
    if (persist) safeSet('preferred-theme', theme);
}

/** Saved choice first; otherwise phones and small machines start fast. */
function initialQuality() {
    const saved = safeGet('museum-quality');
    if (saved === 'high' || saved === 'low') return saved;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
    return coarse || small || weak ? 'low' : 'high';
}

async function loadFonts() {
    if (!document.fonts?.load) return;
    const faces = [
        '600 40px "Source Serif 4"', 'italic 400 30px "Source Serif 4"', '400 30px "Source Serif 4"',
        '400 30px Inter', '500 30px Inter', '600 30px Inter', '700 30px Inter', '800 30px Inter',
        '500 30px "JetBrains Mono"',
        '900 30px "Font Awesome 6 Free"', '400 30px "Font Awesome 6 Brands"'
    ];
    await Promise.race([
        Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null))),
        wait(4000)
    ]);
}

function setProgress(p, label) {
    const bar = $('progress-bar');
    if (bar) bar.style.transform = `scaleX(${Math.max(0.02, Math.min(1, p))})`;
    const text = $('progress-label');
    if (text && label) text.textContent = label;
}

function showFatal(message) {
    document.body.classList.add('is-fatal');
    const box = $('fatal');
    box.hidden = false;
    box.querySelector('.fatal-message').textContent = message;
}

function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
        return false;
    }
}

function isTyping(target) {
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
}

function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
