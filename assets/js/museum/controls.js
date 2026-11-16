// First-person controls: walk with WASD/arrows or the touch joystick, drag
// (left or right button, or a finger) to look around, click or tap to
// select, scroll to step forward and back.

import { EYE, roomAt } from './world.js';
import { clamp, easeInOut } from './util.js';

const RADIUS = 0.35;
const WALK = 3.4;
const RUN = 7;
const TURN = 1.9;
const LOOK = 0.0042;
const PITCH_LIMIT = 1.2;
const CLICK_SLOP = 6;

export class Controls {
    constructor(camera, dom, colliders, { onClick, onHover, onUserMove, onGrab, calm = false } = {}) {
        this.camera = camera;
        this.dom = dom;
        this.colliders = colliders;
        this.onClick = onClick;
        this.onHover = onHover;
        this.onUserMove = onUserMove;
        // onGrab(x, y) may return { move(dx, dy), end() } to take over a drag
        // that starts on something draggable (the globe) instead of looking.
        this.onGrab = onGrab;
        this.x = 0;
        this.z = 0;
        this.yaw = 0;
        this.pitch = 0;
        this.vx = 0;
        this.vz = 0;
        this.keys = new Set();
        this.stick = { x: 0, y: 0 };
        this.glide = null;
        this.enabled = true;
        this.pointer = null;
        this.wheelImpulse = 0;
        // Look input waiting to be applied; update() eases it in, so a drag
        // turns the view smoothly whether or not the visitor is walking.
        this.lookYaw = 0;
        this.lookPitch = 0;
        // Footsteps: the eye rises and falls a little with every stride.
        this.calm = calm;
        this.stride = 0;
        this.bob = 0;
        camera.rotation.order = 'YXZ';
        this.bind();
    }

    bind() {
        const dom = this.dom;
        dom.addEventListener('pointerdown', (e) => {
            if (!this.enabled || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
            if (this.pointer) return; // one look-pointer at a time
            dom.setPointerCapture?.(e.pointerId);
            this.onHover?.(null, null);
            this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, t: performance.now(), drag: e.button === 2, type: e.pointerType, button: e.button };
            this.pointer.grab = this.onGrab?.(e.clientX, e.clientY) || null;
            if (e.button === 2) dom.classList.add('is-dragging');
        });
        dom.addEventListener('contextmenu', (e) => e.preventDefault());
        dom.addEventListener('pointermove', (e) => {
            const p = this.pointer;
            if (p && p.id === e.pointerId) {
                const dx = e.clientX - p.lastX;
                const dy = e.clientY - p.lastY;
                p.lastX = e.clientX;
                p.lastY = e.clientY;
                if (!p.drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP) {
                    p.drag = true;
                    dom.classList.add('is-dragging');
                }
                if (p.drag && p.grab) {
                    p.grab.move(dx, dy);
                    this.onUserMove?.();
                } else if (p.drag) {
                    // Hold the left button (or a finger) and move: the view
                    // follows the pointer, so moving right looks right.
                    const k = p.type === 'touch' ? LOOK * 1.25 : LOOK;
                    this.cancelGlide();
                    this.lookYaw -= dx * k;
                    this.lookPitch -= dy * k;
                    this.onUserMove?.();
                }
            } else if (!p && e.pointerType === 'mouse') {
                this.onHover?.(e.clientX, e.clientY);
            }
        });
        const end = (e) => {
            const p = this.pointer;
            if (!p || p.id !== e.pointerId) return;
            this.pointer = null;
            dom.classList.remove('is-dragging');
            p.grab?.end();
            if (!p.drag && p.button !== 2 && e.type === 'pointerup' && performance.now() - p.t < 650) {
                this.onClick?.(e.clientX, e.clientY);
            }
        };
        dom.addEventListener('pointerup', end);
        dom.addEventListener('pointercancel', end);
        dom.addEventListener('pointerleave', (e) => {
            if (e.pointerType === 'mouse') this.onHover?.(null, null);
        });
        dom.addEventListener('wheel', (e) => {
            if (!this.enabled) return;
            e.preventDefault();
            this.wheelImpulse += clamp(-e.deltaY * 0.012, -2.5, 2.5);
            this.cancelGlide();
            this.onUserMove?.();
        }, { passive: false });

        window.addEventListener('keydown', (e) => {
            if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
            const code = e.code;
            if (MOVE_KEYS.has(code)) {
                this.keys.add(code);
                this.cancelGlide();
                this.onUserMove?.();
                if (code.startsWith('Arrow') || code === 'Space') e.preventDefault();
            }
        });
        window.addEventListener('keyup', (e) => this.keys.delete(e.code));
        window.addEventListener('blur', () => this.keys.clear());
    }

    /** Wire up the on-screen joystick (shown on touch devices). */
    bindJoystick(base, knob) {
        let id = null;
        const radius = () => base.clientWidth / 2;
        const move = (e) => {
            const rect = base.getBoundingClientRect();
            let dx = e.clientX - (rect.left + rect.width / 2);
            let dy = e.clientY - (rect.top + rect.height / 2);
            const r = radius();
            const len = Math.hypot(dx, dy);
            if (len > r) {
                dx = (dx / len) * r;
                dy = (dy / len) * r;
            }
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
            this.stick.x = dx / r;
            this.stick.y = dy / r;
            if (Math.hypot(this.stick.x, this.stick.y) > 0.1) {
                this.cancelGlide();
                this.onUserMove?.();
            }
        };
        base.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            id = e.pointerId;
            base.setPointerCapture(id);
            move(e);
        });
        base.addEventListener('pointermove', (e) => {
            if (e.pointerId === id) move(e);
        });
        const release = (e) => {
            if (e.pointerId !== id) return;
            id = null;
            this.stick.x = 0;
            this.stick.y = 0;
            knob.style.transform = '';
        };
        base.addEventListener('pointerup', release);
        base.addEventListener('pointercancel', release);
    }

    setPose({ x, z, yaw, pitch = 0 }) {
        this.x = x;
        this.z = z;
        this.yaw = yaw ?? this.yaw;
        this.pitch = pitch;
        this.vx = 0;
        this.vz = 0;
        this.lookYaw = 0;
        this.lookPitch = 0;
        this.cancelGlide();
        this.apply();
    }

    /**
     * Walk along a planned path (a list of {x, z}, starting here). The pace
     * builds up, holds and eases off before the end; the view turns at a
     * comfortable, capped rate. With `lookAlong` the view follows the way
     * ahead and only turns to the final yaw over the last stretch.
     * Resolves true on arrival, false when cancelled.
     */
    followPath(points, { yaw, pitch, lookAlong = false, speed } = {}) {
        this.cancelGlide();
        const pts = points.map((p) => ({ x: p.x, z: p.z }));
        if (pts.length < 2) pts.unshift({ x: this.x, z: this.z });
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
        const L = cum[cum.length - 1];
        return new Promise((resolve) => {
            this.glide = {
                path: true, pts, cum, L, s: 0, v: 0,
                vmax: speed ?? clamp(L / 3.2, 2.4, 6.2),
                yaw: yaw ?? null, pitch: pitch ?? null, lookAlong, resolve
            };
        });
    }

    /** A point along the current path, `s` metres from its start. */
    pathPoint(g, s) {
        s = clamp(s, 0, g.L);
        let i = 1;
        while (i < g.cum.length - 1 && g.cum[i] < s) i += 1;
        const a = g.pts[i - 1];
        const b = g.pts[i];
        const seg = g.cum[i] - g.cum[i - 1] || 1;
        const t = (s - g.cum[i - 1]) / seg;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }

    stepPath(dt) {
        const g = this.glide;
        const left = g.L - g.s;
        // Accelerate to cruising pace, brake so as to stop exactly at the end.
        const want = Math.min(g.vmax, Math.sqrt(2 * 2.8 * Math.max(0, left)));
        g.v += clamp(want - g.v, -6 * dt, 3.2 * dt);
        g.s = Math.min(g.L, g.s + Math.max(g.v, left > 0.02 ? 0.15 : 0) * dt);
        const p = this.pathPoint(g, g.s);
        this.x = p.x;
        this.z = p.z;
        this.stepDist = (this.stepDist || 0) + g.v * dt;
        if (this.stepDist > 0.72 && g.v > 0.6) {
            this.stepDist = 0;
            this.onStep?.(g.v);
        }
        // Where to look: down the path while walking, then the requested yaw.
        let wantYaw = g.yaw ?? this.yaw;
        if (g.lookAlong && g.L - g.s > 0.3) {
            const ahead = this.pathPoint(g, g.s + 1.6);
            const dx = ahead.x - this.x;
            const dz = ahead.z - this.z;
            if (Math.hypot(dx, dz) > 0.2) {
                const along = Math.atan2(-dx, -dz);
                const k = g.yaw === null ? 0 : clamp(1 - (g.L - g.s) / 2.2, 0, 1);
                wantYaw = along + wrapAngle(wantYaw - along) * k;
            }
        }
        const dyaw = wrapAngle(wantYaw - this.yaw);
        const maxTurn = (this.calm ? 1.1 : 1.7) * dt;
        this.yaw += clamp(dyaw * (1 - Math.exp(-dt * 5)), -maxTurn, maxTurn);
        if (g.pitch !== null) this.pitch += (g.pitch - this.pitch) * (1 - Math.exp(-dt * 3.5));
        this.bob *= Math.exp(-dt * 8);
        const settled = Math.abs(wrapAngle(wantYaw - this.yaw)) < 0.01 && (g.pitch === null || Math.abs(g.pitch - this.pitch) < 0.005);
        if (g.s >= g.L - 1e-4 && settled) {
            this.glide = null;
            this.vx = 0;
            this.vz = 0;
            this.resolveCollisions();
            g.resolve(true);
        }
    }

    /** Level the view and stop: a way back from any odd angle. */
    resetView() {
        this.cancelGlide();
        this.keys.clear();
        this.vx = 0;
        this.vz = 0;
        this.wheelImpulse = 0;
        this.lookPitch = -this.pitch;
        this.lookYaw = 0;
    }

    /** Animate to a pose; resolves when there, or when cancelled. */
    glideTo(target, duration) {
        this.cancelGlide();
        const dist = Math.hypot(target.x - this.x, target.z - this.z);
        let dyaw = ((target.yaw ?? this.yaw) - this.yaw) % (Math.PI * 2);
        if (dyaw > Math.PI) dyaw -= Math.PI * 2;
        if (dyaw < -Math.PI) dyaw += Math.PI * 2;
        const dur = duration ?? clamp(0.45 + dist * 0.09 + Math.abs(dyaw) * 0.25, 0.5, 2.4);
        return new Promise((resolve) => {
            this.glide = {
                from: { x: this.x, z: this.z, yaw: this.yaw, pitch: this.pitch },
                to: { x: target.x, z: target.z, yaw: this.yaw + dyaw, pitch: target.pitch ?? this.pitch },
                t: 0,
                dur,
                resolve
            };
        });
    }

    cancelGlide() {
        if (!this.glide) return;
        // Clicking an exhibit glides; any pending drag would fight it.
        this.lookYaw = 0;
        this.lookPitch = 0;
        const { resolve } = this.glide;
        this.glide = null;
        this.resolveCollisions();
        resolve(false);
    }

    get moving() {
        return !!this.glide || this.keys.size > 0 || Math.abs(this.stick.x) + Math.abs(this.stick.y) > 0.05 ||
            Math.abs(this.lookYaw) + Math.abs(this.lookPitch) > 1e-5 ||
            Math.abs(this.vx) + Math.abs(this.vz) > 0.01 || Math.abs(this.wheelImpulse) > 0.01;
    }

    /** Advance by dt seconds. Returns true when the view changed. */
    update(dt) {
        if (this.glide?.path) {
            this.stepPath(dt);
            this.apply();
            return true;
        }
        if (this.glide) {
            const g = this.glide;
            this.bob *= Math.exp(-dt * 8);
            g.t = Math.min(1, g.t + dt / g.dur);
            const k = easeInOut(g.t);
            this.x = g.from.x + (g.to.x - g.from.x) * k;
            this.z = g.from.z + (g.to.z - g.from.z) * k;
            this.yaw = g.from.yaw + (g.to.yaw - g.from.yaw) * k;
            this.pitch = g.from.pitch + (g.to.pitch - g.from.pitch) * k;
            if (g.t >= 1) {
                this.glide = null;
                this.resolveCollisions();
                g.resolve(true);
            }
            this.apply();
            return true;
        }

        const k = this.keys;
        let forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
        let strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
        const turn = (k.has('ArrowLeft') || k.has('KeyQ') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyE') ? 1 : 0);
        forward += -this.stick.y;
        strafe += this.stick.x;
        const run = k.has('ShiftLeft') || k.has('ShiftRight');
        const speed = run ? RUN : WALK;
        let changed = false;

        if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) > 1e-5) {
            const ease = 1 - Math.exp(-dt * 22);
            const dy = this.lookYaw * ease;
            const dp = this.lookPitch * ease;
            this.yaw += dy;
            this.pitch = clamp(this.pitch + dp, -PITCH_LIMIT, PITCH_LIMIT);
            this.lookYaw -= dy;
            this.lookPitch -= dp;
            changed = true;
        } else {
            this.lookYaw = 0;
            this.lookPitch = 0;
        }

        if (turn) {
            this.yaw += turn * TURN * dt;
            changed = true;
        }

        const len = Math.hypot(forward, strafe);
        if (len > 1) {
            forward /= len;
            strafe /= len;
        }
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        // forward = (-sin, -cos), right = (cos, -sin)
        let tx = (-sin * forward + cos * strafe) * speed;
        let tz = (-cos * forward - sin * strafe) * speed;
        if (Math.abs(this.wheelImpulse) > 0.01) {
            tx += -sin * this.wheelImpulse * 2.2;
            tz += -cos * this.wheelImpulse * 2.2;
            this.wheelImpulse *= Math.exp(-dt * 7);
        } else {
            this.wheelImpulse = 0;
        }
        const blend = 1 - Math.exp(-dt * 11);
        this.vx += (tx - this.vx) * blend;
        this.vz += (tz - this.vz) * blend;
        if (Math.abs(this.vx) + Math.abs(this.vz) > 0.005) {
            const px = this.x;
            const pz = this.z;
            this.x += this.vx * dt;
            this.z += this.vz * dt;
            this.resolveCollisions();
            if (!roomAt(this.x, this.z)) {
                this.x = px;
                this.z = pz;
                this.vx = 0;
                this.vz = 0;
            }
            changed = true;
        } else {
            this.vx = 0;
            this.vz = 0;
        }
        const pace = Math.hypot(this.vx, this.vz);
        // One footfall every ~0.72 m walked, for the footsteps sound.
        this.stepDist = (this.stepDist || 0) + pace * dt;
        if (this.stepDist > 0.72 && pace > 0.6) {
            this.stepDist = 0;
            this.onStep?.(pace);
        }
        if (!this.calm) {
            this.stride += pace * dt;
            const want = Math.min(1, pace / WALK);
            this.bob += (want - this.bob) * (1 - Math.exp(-dt * 7));
            if (this.bob < 0.002) this.bob = 0;
            else changed = true;
        }
        if (changed) this.apply();
        return changed;
    }

    resolveCollisions() {
        for (let iter = 0; iter < 4; iter++) {
            let pushed = false;
            for (const c of this.colliders) {
                if (c.r !== undefined) {
                    const dx = this.x - c.x;
                    const dz = this.z - c.z;
                    const min = c.r + RADIUS;
                    const d = Math.hypot(dx, dz);
                    if (d < min) {
                        const nx = d > 1e-6 ? dx / d : 1;
                        const nz = d > 1e-6 ? dz / d : 0;
                        this.x = c.x + nx * min;
                        this.z = c.z + nz * min;
                        pushed = true;
                    }
                } else {
                    const cx = clamp(this.x, c.x1, c.x2);
                    const cz = clamp(this.z, c.z1, c.z2);
                    const dx = this.x - cx;
                    const dz = this.z - cz;
                    const d2 = dx * dx + dz * dz;
                    if (d2 < RADIUS * RADIUS) {
                        if (d2 > 1e-10) {
                            const d = Math.sqrt(d2);
                            this.x = cx + (dx / d) * RADIUS;
                            this.z = cz + (dz / d) * RADIUS;
                        } else {
                            // Inside the rectangle: leave by the nearest edge.
                            const exits = [
                                [this.x - c.x1, c.x1 - RADIUS, null],
                                [c.x2 - this.x, c.x2 + RADIUS, null],
                                [this.z - c.z1, null, c.z1 - RADIUS],
                                [c.z2 - this.z, null, c.z2 + RADIUS]
                            ].sort((a, b) => a[0] - b[0]);
                            if (exits[0][1] !== null) this.x = exits[0][1];
                            else this.z = exits[0][2];
                        }
                        pushed = true;
                    }
                }
            }
            if (!pushed) break;
        }
    }

    apply() {
        this.camera.position.set(this.x, EYE + Math.sin(this.stride * 2.7) * 0.02 * this.bob, this.z);
        this.camera.rotation.set(this.pitch, this.yaw, 0);
    }
}

function wrapAngle(a) {
    return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
