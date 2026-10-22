// Entry point: loads the data, builds the museum and runs the visit.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadAllData } from './data.js';
import { ROOMS, ROOM_BY_ID, roomAt, buildWorld, applyWorldTheme, loadSurfaces, bakeFloorOcclusion } from './world.js';
import { Museum } from './exhibits.js';
import { Controls } from './controls.js';
import { Panels, controlsHelp, closeLightbox } from './panels.js';
import { createPipeline } from './post.js';
import { drawFloorPlan, PAINT } from './art.js';
import { escapeHtml } from './util.js';

const HOME_TITLE = 'Saddiq Ur Rehman, PhD in Architecture, Kyung Hee University';
const HASH_ALIASES = { software: 'tools', awards: 'certifications' };
// Number keys jump between rooms, in the order of the top bar.
const ROOM_KEYS = ['home', 'education', 'experience', 'publications', 'projects', 'skills', 'tools', 'certifications', 'activities', 'contact'];

/** High: bloom, shadows, sharper textures. Low: for phones and small GPUs. */
const QUALITY = {
    high: { pixelRatio: 1.5, bloom: true, shadows: true, paintScale: 1.75, imagePxPerM: 760 },
    low: { pixelRatio: 1.25, bloom: false, shadows: false, paintScale: 1.15, imagePxPerM: 440 }
};

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
            tip.hidden = true;
            if (floorRing.visible) { floorRing.visible = false; requestRender(); }
            canvas.style.cursor = '';
            return;
        }
        const hit = pick(h.x, h.y);
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

    // Panels and navigation.
    const panels = new Panels({
        data, museum,
        onNavigate: (roomId) => goToRoom(roomId),
        onShowExhibit: (exhibit) => {
            if (window.matchMedia('(max-width: 760px)').matches) panels.close();
            goToExhibit(exhibit, { open: false });
        },
        onVisitors: () => toggleVisitors(true),
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
        if (exhibit.kind === 'link' || exhibit.kind === 'visitors') {
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
    $('btn-quality').addEventListener('click', () => setQuality(state.quality === 'high' ? 'low' : 'high', true));
    $('theme-toggle-btn').addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        setTheme(next, true);
        applyWorldTheme(world, scene, next);
        minimap.draw(true);
        requestRender();
    });
    $('lightbox').addEventListener('click', (ev) => {
        if (ev.target.closest('button') || ev.target === $('lightbox')) closeLightbox();
    });
    $('help-close').addEventListener('click', () => toggleHelp(false));
    $('help-body').innerHTML = controlsHelp();
    initVisitors();

    window.addEventListener('keydown', (ev) => {
        if (isTyping(ev.target) && ev.key !== 'Escape') return;
        if (ev.key === 'Escape') {
            if (!$('lightbox').hidden) closeLightbox();
            else if (panels.isOpen) panels.close();
            else if (document.body.classList.contains('catalogue-open')) closeCatalogue();
            else { toggleVisitors(false); toggleHelp(false); }
        } else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && state.entered) {
            if (ev.code === 'KeyM') minimap.toggle();
            if (ev.code === 'KeyC') openCatalogue();
            if (ev.code === 'KeyH' || ev.key === '?') toggleHelp();
            if (ev.code === 'KeyV' && state.room === 'activities') museum.toggleCollabView();
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
        const btn = $('btn-quality');
        btn.setAttribute('aria-pressed', String(mode === 'high'));
        btn.title = mode === 'high' ? 'Graphics: high (click for faster)' : 'Graphics: fast (click for high quality)';
        btn.classList.toggle('is-low', mode === 'low');
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
        if (state.needsRender) {
            state.needsRender = false;
            if (pipeline) pipeline.render();
            else renderer.render(scene, camera);
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
    enter();

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
    window.__museum = { controls, museum, world, goToRoom, goToExhibit, panels, scene, camera, renderer, requestRender, setQuality };
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
            if (c.r !== undefined ? Math.hypot(x - c.x, z - c.z) < c.r + 0.1
                : x > c.x1 - 0.1 && x < c.x2 + 0.1 && z > c.z1 - 0.1 && z < c.z2 + 0.1) return false;
        }
    }
    return true;
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
    const wrap = canvas.closest('.minimap');

    function drawBase() {
        const off = document.createElement('canvas');
        off.width = W * dpr;
        off.height = H * dpr;
        const octx = off.getContext('2d');
        octx.scale(dpr, dpr);
        geometry = drawFloorPlan(octx, ROOMS, W, H, { dark: true, highlight: null, labels: 'mini', pad: 0.04 });
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
            ctx.fillStyle = 'rgba(232,194,122,0.28)';
            ctx.fillRect(ax, ay, bx - ax, by - ay);
        }
        const [px, py] = geometry.map(controls.x, controls.z);
        const fx = -Math.sin(controls.yaw);
        const fz = -Math.cos(controls.yaw);
        const ang = Math.atan2(fz, fx);
        ctx.fillStyle = 'rgba(232,194,122,0.35)';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.arc(px, py, 16, ang - 0.6, ang + 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#e8c27a';
        ctx.strokeStyle = '#1a1a1a';
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
        <section class="cat-room" data-cat-room="${g.room.id}" style="--room-accent:${escapeHtml(g.room.accent || '#b08d57')}">
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
    toast.style.setProperty('--room-accent', room.accent || '#e8c27a');
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

function initVisitors() {
    const icon = document.querySelector('.flag-counter-icon');
    icon?.addEventListener('click', (ev) => {
        ev.preventDefault();
        toggleVisitors();
    });
    document.addEventListener('click', (ev) => {
        const popup = $('flag-counter-popup');
        if (popup.classList.contains('is-open') && !ev.target.closest('#flag-counter-popup, .flag-counter-icon, [data-action="visitors"]')) {
            toggleVisitors(false);
        }
    });
}

function toggleVisitors(force) {
    const popup = $('flag-counter-popup');
    const icon = document.querySelector('.flag-counter-icon');
    const open = force ?? !popup.classList.contains('is-open');
    popup.classList.toggle('is-open', open);
    icon?.setAttribute('aria-expanded', String(open));
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
    const btn = $('theme-toggle-btn');
    btn?.setAttribute('aria-pressed', String(theme === 'dark'));
    btn?.setAttribute('title', theme === 'dark' ? 'Turn the lights on (day)' : 'Turn the lights down (night)');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0c10' : '#2563eb');
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
