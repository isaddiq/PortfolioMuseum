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
import { NavGrid, pathLength } from './nav.js';
import { Companions } from './companions.js';
import { MuseumAudio } from './audio.js';

const HOME_TITLE = 'Saddiq Ur Rehman, PhD in Architecture, Kyung Hee University';
const HASH_ALIASES = { software: 'tools', awards: 'certifications' };
// Number keys jump between rooms, in the order of the top bar.
const ROOM_KEYS = ['home', 'education', 'experience', 'publications', 'projects', 'skills', 'tools', 'certifications', 'activities', 'contact'];

/**
 * High: bloom, soft shadows, mirrored floors, sharper textures, a full house.
 * Fast: for phones and small GPUs: no post-processing, shadows or mirror
 * pass, lighter textures, a lower resolution and fewer visitors.
 */
const QUALITY = {
    high: { pixelRatio: 1.5, bloom: true, shadows: true, reflections: true, paintScale: 1.75, imagePxPerM: 760, visitors: 10, shadowMap: 2048 },
    low: { pixelRatio: 1.0, bloom: false, shadows: false, reflections: false, paintScale: 1.15, imagePxPerM: 440, visitors: 4, shadowMap: 1024 }
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
        showFatal('Your browser cannot display the 3D museum (WebGL is unavailable). Everything in it is listed below.');
        loadAllData().then(renderTextPortfolio).catch(() => {});
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
    // The XR demonstrations reveal models with clipping planes.
    renderer.localClippingEnabled = true;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 160);
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
    // Where the visitor (and the museum's residents) can walk.
    const nav = new NavGrid(world.colliders);
    settleViews(museum, nav);
    setProgress(0.6, 'Hanging the artworks…');

    let pipeline = q.bloom ? createPipeline(renderer, scene, camera) : null;

    // Polished floors mirror the room (high quality only): honed stone and
    // satin varnish, so the reflection is soft and only strong at a glance.
    const reflection = createFloorReflection(renderer, scene, camera, world.floors);
    for (const floor of world.floors) {
        const stone = floor.userData.room.floor === 'stone';
        floor.material.userData.env = floor.material.envMapIntensity;
        reflection.patch(floor.material, stone ? { strength: 0.42, blur: 2.0, specular: 0.3 } : { strength: 0.24, blur: 2.8, specular: 0.35 });
    }

    const frustum = new THREE.Frustum();
    const viewProj = new THREE.Matrix4();
    museum.frustum = frustum;
    const residents = new Companions({ scene, world, nav, museum, calm: CALM });
    let audio = null;

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
        // An invisible box around a demonstration is an easy target, but it
        // must not hide the model's own elements from a direct click.
        let proxy = null;
        for (const hit of hits) {
            const o = hit.object;
            if (o.userData.noPick || o.isPoints || o.isLine || !shown(o)) continue;
            if (hit.distance > 40) break;
            const id = o.userData.exhibitId;
            if (o.userData.proxy) {
                proxy = proxy || { exhibit: museum.byId.get(id), point: hit.point };
                continue;
            }
            if (proxy && id !== proxy.exhibit?.id) return proxy;
            if (id) return { exhibit: museum.byId.get(id), point: hit.point, hit };
            if (o.userData.floor) return { floor: true, point: hit.point };
            return null;
        }
        return proxy;
    }

    /** Walk somewhere along a planned path; fall back to a fade when it is far or blocked. */
    async function walkTo(target, { yaw, pitch, lookAlong = false, maxWalk = 46 } = {}) {
        const path = nav.findPath({ x: controls.x, z: controls.z }, target);
        if (!path || pathLength(path) > maxWalk) {
            await teleport({ x: target.x, z: target.z, yaw: yaw ?? controls.yaw, pitch: pitch ?? controls.pitch });
            return true;
        }
        const smooth = nav.smooth(path);
        const turns = smooth.length > 2;
        return controls.followPath(smooth, { yaw, pitch, lookAlong: lookAlong || turns });
    }

    const controls = new Controls(camera, canvas, world.colliders, {
        calm: CALM,
        onClick: (x, y) => {
            const hit = pick(x, y);
            if (!hit) return;
            audio?.unlock();
            if (hit.exhibit) {
                // A BIM element inside a demonstration: its properties, over the demo's panel.
                const element = hit.hit?.object.userData.bimEls && hit.exhibit.payload?.model?.pick?.(hit.hit);
                if (element) {
                    panels.open(hit.exhibit);
                    panels.open({ id: `${hit.exhibit.id}-element`, room: hit.exhibit.room, kind: 'bimElement', title: element.name, payload: element, virtual: true, view: hit.exhibit.view, noHighlight: true }, { push: true });
                    return;
                }
                goToExhibit(hit.exhibit, { open: true });
            } else if (hit.floor) {
                // Walk to the spot (or the nearest place one can stand), round anything in the way.
                const spot = nav.nearestWalkable(hit.point.x, hit.point.z, 1.5);
                if (!spot) return;
                walkTo(spot, { pitch: Math.max(-0.2, Math.min(0.2, controls.pitch)) }).then(() => onPlayerMoved(true));
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
        // The ring marks where a click would really take you.
        const spot = hit?.floor ? nav.nearestWalkable(hit.point.x, hit.point.z, 1.5) : null;
        const showRing = !!spot;
        if (showRing) floorRing.position.set(spot.x, 0.012, spot.z);
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
            const demo = /^demo:(\w+):(\w+)(?::(\d+))?$/.exec(action);
            if (demo) {
                const inst = museum.research.byKey.get(demo[1]);
                if (!inst) return;
                audio?.unlock();
                if (demo[2] === 'stage') inst.goStage(Number(demo[3]));
                else inst[demo[2]]?.();
                requestRender();
                return;
            }
            if (action.startsWith('go:')) {
                const target = museum.byId.get(action.slice(3));
                if (target) {
                    if (window.matchMedia('(max-width: 760px)').matches) panels.close();
                    goToExhibit(target, { open: false });
                }
                return;
            }
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
        const view = framedView(exhibit);
        if (!view) return;
        const dist = Math.hypot(view.x - controls.x, view.z - controls.z);
        if (dist < 0.3) await controls.glideTo(view);
        else await walkTo(view, { yaw: view.yaw, pitch: view.pitch, maxWalk: 34 });
        onPlayerMoved(true);
    }

    /**
     * On a narrow portrait screen the view is much narrower than it is tall:
     * stand further back so a whole work fits across, where there is room.
     */
    function framedView(exhibit) {
        const v = exhibit.view;
        const f = exhibit.focus;
        if (!v || !f || camera.aspect >= 0.8) return v;
        const k = Math.min(1.7, 0.8 / Math.max(camera.aspect, 0.4));
        for (let s = k; s > 1.02; s -= 0.1) {
            const x = f.x + (v.x - f.x) * s;
            const z = f.z + (v.z - f.z) * s;
            if (nav.walkable(x, z)) return { ...v, x, z, pitch: Math.atan2(f.y - 1.65, Math.hypot(x - f.x, z - f.z)) };
        }
        return v;
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
    // Day and night: the light changes over a second and a half, not at once.
    const mood = { value: document.documentElement.dataset.theme === 'dark' ? 1 : 0, target: null };
    document.querySelectorAll('[data-theme-set]').forEach((btn) => btn.addEventListener('click', () => {
        const next = btn.dataset.themeSet;
        if (next === document.documentElement.dataset.theme) return;
        setTheme(next, true);
        mood.target = next === 'dark' ? 1 : 0;
        if (CALM) {
            mood.value = mood.target;
            applyWorldTheme(world, scene, mood.value);
        }
        minimap.draw(true);
        requestRender();
    }));
    $('btn-reset').addEventListener('click', () => resetView());
    $('btn-sound').addEventListener('click', () => {
        audio.toggle();
        updateSoundButton();
    });
    function updateSoundButton() {
        const on = audio.enabled;
        const btn = $('btn-sound');
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', on ? 'Mute sound' : 'Turn sound on');
        btn.dataset.tip = on ? 'Mute (U)' : 'Sound on (U)';
        btn.querySelector('i').className = on ? 'fas fa-volume-high' : 'fas fa-volume-xmark';
    }
    /** Level the view; if somehow outside the building, go back to the lobby. */
    function resetView() {
        if (!roomAt(controls.x, controls.z)) { goToRoom('home'); return; }
        controls.resetView();
        requestRender();
    }
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
            // Enter opens the work you are standing in front of.
            if (ev.key === 'Enter' && approach.current && (ev.target === canvas || ev.target === document.body)) {
                ev.preventDefault();
                goToExhibit(approach.current, { open: true });
            }
            if (ev.code === 'KeyR') resetView();
            if (ev.code === 'KeyU') { audio.toggle(); updateSoundButton(); }
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
        // Without the finishing pass, the renderer rolls off highlights itself.
        renderer.toneMapping = cfg.bloom ? THREE.NoToneMapping : THREE.NeutralToneMapping;
        renderer.shadowMap.enabled = cfg.shadows;
        world.lights.key.castShadow = cfg.shadows;
        const key = world.lights.key;
        if (key.shadow.mapSize.x !== cfg.shadowMap) {
            key.shadow.mapSize.set(cfg.shadowMap, cfg.shadowMap);
            key.shadow.map?.dispose();
            key.shadow.map = null;
        }
        visitors?.setCount(cfg.visitors);
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
        // A natural architectural view: about 60° vertically on a wide
        // screen (no wide-angle stretch at the edges), more on a phone held upright.
        camera.fov = w / h < 0.8 ? 74 : w / h < 1.3 ? 66 : 60;
        camera.updateProjectionMatrix();
        pipeline?.setSize(w, h);
        const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
        reflection.setSize(buffer.x, buffer.y);
        highlight.setSize(w, h);
        museum.setViewport(h * renderer.getPixelRatio(), camera.fov);
        requestRender();
    }
    window.addEventListener('resize', resize);
    let visitors = null;
    setQuality(state.quality, false);

    // First pose: the room named in the address, else the lobby.
    const startRoom = ROOM_BY_ID[roomFromHash()] || ROOM_BY_ID.home;
    controls.setPose(startRoom.spawn);
    applyWorldTheme(world, scene, mood.value);
    onPlayerMoved(true);

    // Sound (muted until the visitor turns it on).
    audio = new MuseumAudio();
    controls.onStep = (pace) => audio.footstep(pace, state.room);
    updateSoundButton();

    // The research demonstrations report stage changes to an open panel.
    museum.research.onChange = (inst) => panels.refreshDemo(inst);

    // Approaching a work: a quiet prompt, and its picture light brightens.
    const approach = { current: null, lastCheck: 0, wash: null };
    const approachEl = $('approach');
    function updateApproach(now) {
        if (now - approach.lastCheck < 160) return;
        approach.lastCheck = now;
        let best = null;
        let bestScore = 0;
        if (!controls.glide) {
            const fx = -Math.sin(controls.yaw);
            const fz = -Math.cos(controls.yaw);
            for (const x of museum.exhibits) {
                if (!x.view || !x.focus || x.kind === 'tv' || x.kind === 'link') continue;
                const dx = x.focus.x - controls.x;
                const dz = x.focus.z - controls.z;
                const d = Math.hypot(dx, dz);
                const reach = Math.hypot(x.view.x - x.focus.x, x.view.z - x.focus.z) + 1.2;
                if (d > reach || d < 0.3) continue;
                const facing = (dx * fx + dz * fz) / d;
                if (facing < 0.82) continue;
                const score = facing * (1 - d / (reach + 1));
                if (score > bestScore) { bestScore = score; best = x; }
            }
        }
        if (best === approach.current) return;
        approach.current = best;
        if (best) {
            approachEl.querySelector('strong').textContent = best.title;
            approachEl.querySelector('em').textContent = best.kind === 'demo' ? 'Research demonstration' : (best.subtitle || '');
        }
        approachEl.classList.toggle('is-on', !!best);
        approachEl.setAttribute('aria-hidden', String(!best));
        approachEl.tabIndex = best ? 0 : -1;
        if (approach.wash) approach.wash.userData.boost = 0;
        approach.wash = best?.wash || null;
        if (approach.wash) approach.wash.userData.boost = 1;
    }
    approachEl.addEventListener('click', () => { if (approach.current) goToExhibit(approach.current, { open: true }); });

    // Render loop: draws only when something changed or something nearby
    // moves, and does nothing at all while the tab is hidden.
    let last = performance.now();
    function frame(now) {
        requestAnimationFrame(frame);
        if (document.hidden) { last = now; return; }
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const t = now / 1000;
        if (controls.update(dt)) {
            onPlayerMoved(false);
            state.needsRender = true;
        }
        camera.updateMatrixWorld();
        viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(viewProj);
        if (museum.animate(t, dt, controls.x, controls.z)) state.needsRender = true;
        if (visitors?.update(t, dt, controls.x, controls.z, frustum)) state.needsRender = true;
        if (residents.update(t, dt, controls.x, controls.z, frustum)) state.needsRender = true;
        if (highlight.update(t, dt)) state.needsRender = true;
        if (mood.target !== null) {
            mood.value += Math.sign(mood.target - mood.value) * Math.min(Math.abs(mood.target - mood.value), dt / 1.5);
            applyWorldTheme(world, scene, mood.value);
            if (mood.value === mood.target) mood.target = null;
            state.needsRender = true;
        }
        if (stepWashes(dt)) state.needsRender = true;
        updateApproach(now);
        audio.update(dt, { x: controls.x, z: controls.z, yaw: controls.yaw, room: state.room, research: museum.research });
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
    }
    requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) audio.suspend(); else { audio.resume(); requestRender(); }
    });

    /** Ease each picture light's brightness towards its target (brighter for the work you face). */
    function stepWashes(dt) {
        let moving = false;
        for (const mat of world.themed.washes) {
            const want = mat.userData.boost || 0;
            const cur = mat.userData.lift || 0;
            if (Math.abs(want - cur) < 0.002) continue;
            mat.userData.lift = cur + (want - cur) * (1 - Math.exp(-dt * 5));
            mat.opacity = (mat.userData.level ?? mat.opacity) * (1 + 0.45 * mat.userData.lift);
            moving = true;
        }
        return moving;
    }

    // Wait for the textures around the starting point (not every texture in
    // the building), then walk straight in.
    await new Promise((resolve) => {
        const started = performance.now();
        const tick = () => {
            const p = museum.nearbyProgress(controls.x, controls.z);
            setProgress(0.6 + p * 0.4, 'Hanging the artworks…');
            if (p >= 0.9 || performance.now() - started > 5000) resolve();
            else setTimeout(tick, 100);
        };
        tick();
    });
    setProgress(1, 'Welcome');
    // Arriving through the front doors: a slow walk in as the loader lifts.
    const arrival = startRoom.id === 'home' && !CALM;
    if (arrival) controls.setPose({ ...startRoom.spawn, x: startRoom.spawn.x + 3.4 * Math.sin(startRoom.spawn.yaw), pitch: 0.16 });
    enter();
    if (arrival) controls.glideTo({ ...startRoom.spawn, pitch: 0 }, 3.6);
    // Visitors load after the first frames are on screen, and join one by one.
    const people = new Visitors({ scene, museum, world, nav, count: QUALITY[state.quality].visitors });
    visitors = people;
    setTimeout(() => people.load().catch((error) => console.warn('Visitors could not load', error)), 800);

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
    window.__museum = { controls, museum, world, nav, residents, get audio() { return audio; }, goToRoom, goToExhibit, walkTo, panels, scene, camera, renderer, requestRender, setQuality, get visitors() { return visitors; } };
}

// ---------------------------------------------------------------------------
// Pieces of the HUD
// ---------------------------------------------------------------------------

/**
 * Some viewpoints, computed straight out from a work, land inside a bench, a
 * plinth or a column; walking there would end in a jolt out of it. Move each
 * such view along its line of sight (or to the nearest standing spot) and
 * turn it back towards the work.
 */
function settleViews(museum, nav) {
    for (const x of museum.exhibits) {
        const v = x.view;
        if (!v || nav.walkable(v.x, v.z)) continue;
        const f = x.focus;
        let spot = null;
        if (f) {
            const dx = v.x - f.x;
            const dz = v.z - f.z;
            const d = Math.hypot(dx, dz) || 1;
            for (let k = 0.25; k <= 3 && !spot; k += 0.25) {
                for (const s of [1, -1]) {
                    const t = d + s * k;
                    if (t < 1) continue;
                    const px = f.x + (dx / d) * t;
                    const pz = f.z + (dz / d) * t;
                    if (nav.walkable(px, pz)) { spot = { x: px, z: pz }; break; }
                }
            }
        }
        spot = spot || nav.nearestWalkable(v.x, v.z, 3);
        if (!spot) continue;
        v.x = spot.x;
        v.z = spot.z;
        if (f) {
            v.yaw = Math.atan2(v.x - f.x, v.z - f.z);
            v.pitch = Math.max(-0.55, Math.min(0.55, Math.atan2(f.y - 1.65, Math.hypot(f.x - v.x, f.z - v.z))));
        }
    }
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
                <li data-search="${escapeHtml(searchText(x))}">
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
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const status = $('catalogue-count');
    search.addEventListener('input', () => {
        const q = normalise(search.value.trim());
        const words = q.split(/\s+/).filter(Boolean);
        let shown = 0;
        list.querySelectorAll('li[data-search]').forEach((li) => {
            const hit = !words.length || words.every((w) => li.dataset.search.includes(w));
            li.hidden = !hit;
            if (hit) shown += 1;
        });
        list.querySelectorAll('.cat-room').forEach((sec) => { sec.hidden = !sec.querySelector('li:not([hidden])'); });
        empty.hidden = !!list.querySelector('.cat-room:not([hidden])');
        status.textContent = words.length ? `${shown} of ${total} works match` : `${total} works on display`;
    });
    // Enter goes to the first match.
    search.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        const first = list.querySelector('li:not([hidden]) [data-exhibit]');
        if (first) { ev.preventDefault(); first.click(); }
    });
    // Keep keyboard focus inside the open catalogue.
    $('catalogue').addEventListener('keydown', (ev) => {
        if (ev.key !== 'Tab') return;
        const items = [...$('catalogue').querySelectorAll('input, button, a[href]')].filter((el) => !el.closest('[hidden]') && el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
    $('catalogue-close').addEventListener('click', closeCatalogue);
    $('catalogue').addEventListener('click', (ev) => { if (ev.target === $('catalogue')) closeCatalogue(); });
    status.textContent = `${total} works on display`;
}

/** Lower case, without accents, so "Ahn" finds "Ahn" and "facade" finds "façade". */
function normalise(text) {
    return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const KIND_WORDS = {
    publication: 'publication paper article', project: 'project research', tool: 'tool software app', skill: 'skill',
    education: 'education degree', experience: 'experience position role', award: 'award honour', certificate: 'certificate certification',
    news: 'news', seminar: 'seminar talk presentation', demo: 'demonstration simulation animation', coauthor: 'co-author collaborator', interest: 'research interest'
};

/** Everything a visitor might search for: title, venue, authors, year, topics, technologies. */
function searchText(x) {
    const p = x.payload && typeof x.payload === 'object' ? x.payload : {};
    const parts = [x.title, x.subtitle, KIND_WORDS[x.kind] || ''];
    if (x.kind === 'publication') parts.push((p.authors || []).join(' '), p.journal, p.conference, p.year, (p.topics || []).join(' '), p.doi);
    if (x.kind === 'project') parts.push((p.technologies || []).join(' '), p.funding_source, p.role, p.description);
    if (x.kind === 'tool') parts.push((p.badges || []).map((b) => b.label).join(' '), p.description);
    if (x.kind === 'skill') parts.push(p.category?.title, p.skill?.level);
    if (x.kind === 'demo') parts.push(p.def?.short, p.def?.description);
    if (x.kind === 'coauthor') parts.push(p.university, p.Industry, p.country);
    if (x.kind === 'experience') parts.push(p.organization, p.location, p.duration);
    if (x.kind === 'education') parts.push(p.institution, p.duration, p.thesis);
    return normalise(parts.filter(Boolean).join(' ').replace(/<[^>]+>/g, ' '));
}

let catalogueOpener = null;
function openCatalogue() {
    const active = document.activeElement;
    catalogueOpener = active && active !== document.body ? active : null;
    document.body.classList.add('catalogue-open');
    $('catalogue').setAttribute('aria-hidden', 'false');
    setTimeout(() => $('catalogue-search').focus({ preventScroll: true }), 50);
}

function closeCatalogue() {
    document.body.classList.remove('catalogue-open');
    $('catalogue').setAttribute('aria-hidden', 'true');
    // Back to whatever opened it (the Catalogue button), else the museum view.
    const back = catalogueOpener?.isConnected ? catalogueOpener : $('scene');
    catalogueOpener = null;
    back.focus({ preventScroll: true });
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

/** Without WebGL: the whole collection as plain, linked HTML. */
function renderTextPortfolio(data) {
    const e = escapeHtml;
    const link = (href, text) => (href ? `<a href="${e(href)}" target="_blank" rel="noopener">${e(text)}</a>` : e(text));
    const section = (title, items) => (items.length ? `<section class="text-section"><h3>${e(title)}</h3><ul>${items.join('')}</ul></section>` : '');
    const p = data.profile || {};
    const html = `
        <div class="text-portfolio">
            ${(p.about || []).map((t) => `<p>${e(t)}</p>`).join('')}
            ${section('Education', (p.education || []).map((x) => `<li><strong>${e(x.degree)}</strong>, ${e(x.institution)} (${e(x.duration)})</li>`))}
            ${section('Experience', data.experienceList.map((x) => `<li><strong>${e(x.position)}</strong>, ${e(x.organization)} (${e(x.duration)})</li>`))}
            ${section('Publications', data.pubList.map((x) => `<li>${link(x.doi || x.link, x.title)}. ${e((x.authors || []).join(', '))}. <em>${e(x.journal || x.conference || '')}</em>, ${e(x.year)}.</li>`))}
            ${section('Research projects', data.projectList.map((x) => `<li><strong>${e(x.title)}</strong> (${e(x.duration)}, ${e(x.status)})</li>`))}
            ${section('Tools and software', data.tools.map((x) => `<li>${link((x.actions || []).find((a) => /github|doi/.test(a.href || ''))?.href, x.title)}: ${e(String(x.description || '').replace(/<[^>]+>/g, ''))}</li>`))}
            ${section('Awards', data.awards.map((x) => `<li><strong>${e(x.title)}</strong>, ${e(x.issuer)} (${e(x.date)})</li>`))}
        </div>`;
    document.querySelector('#fatal .fatal-card')?.insertAdjacentHTML('beforeend', html);
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
