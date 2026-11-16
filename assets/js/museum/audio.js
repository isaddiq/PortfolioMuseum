// Optional, restrained sound: footsteps that follow the visitor's walk (stone
// in the public rooms, wood in the galleries), a quiet room tone, and a soft
// motor hum or the thud of a placed brick near a working demonstration,
// placed left or right of the listener. Everything is synthesised; there are
// no audio files to download. Sound stays off until the visitor turns it on.

const STONE = new Set(['home', 'hall', 'contact']);

export class MuseumAudio {
    constructor() {
        this.enabled = false;
        this.ctx = null;
        this.alt = false;
    }

    /** Called on any click; kept so a browser that suspended the context can resume it. */
    unlock() {
        if (this.enabled && this.ctx?.state === 'suspended') this.ctx.resume();
    }

    toggle() {
        if (this.enabled) this.disable(); else this.enable();
    }

    enable() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!this.ctx) this.build(new AC());
        this.ctx.resume();
        this.enabled = true;
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.3);
    }

    disable() {
        this.enabled = false;
        if (!this.ctx) return;
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
        setTimeout(() => { if (!this.enabled) this.ctx.suspend(); }, 600);
    }

    suspend() { if (this.ctx && this.enabled) this.ctx.suspend(); }
    resume() { if (this.ctx && this.enabled) this.ctx.resume(); }

    build(ctx) {
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(ctx.destination);
        // A few seconds of noise, reused by everything.
        const len = ctx.sampleRate * 3;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let brown = 0;
        for (let i = 0; i < len; i++) {
            const white = Math.random() * 2 - 1;
            brown = (brown + 0.02 * white) / 1.02;
            data[i] = brown * 3.2;
        }
        this.noise = buf;
        const white = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
        const w = white.getChannelData(0);
        for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
        this.white = white;
        // Room tone: low, filtered and barely there.
        const room = ctx.createBufferSource();
        room.buffer = buf;
        room.loop = true;
        this.roomFilter = ctx.createBiquadFilter();
        this.roomFilter.type = 'lowpass';
        this.roomFilter.frequency.value = 320;
        this.roomGain = ctx.createGain();
        this.roomGain.gain.value = 0.05;
        room.connect(this.roomFilter).connect(this.roomGain).connect(this.master);
        room.start();
        // Motor hum for the nearest busy installation.
        this.hum = ctx.createOscillator();
        this.hum.type = 'sawtooth';
        this.hum.frequency.value = 96;
        const humFilter = ctx.createBiquadFilter();
        humFilter.type = 'lowpass';
        humFilter.frequency.value = 420;
        this.humGain = ctx.createGain();
        this.humGain.gain.value = 0;
        this.humPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        this.hum.connect(humFilter).connect(this.humGain);
        if (this.humPan) this.humGain.connect(this.humPan).connect(this.master); else this.humGain.connect(this.master);
        this.hum.start();
    }

    /** One footfall. */
    footstep(pace, room) {
        if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const stone = STONE.has(room);
        const src = ctx.createBufferSource();
        src.buffer = this.white;
        src.playbackRate.value = 0.85 + Math.random() * 0.3;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = (stone ? 1900 : 950) * (this.alt ? 1.06 : 0.95);
        band.Q.value = stone ? 1.4 : 0.9;
        const g = ctx.createGain();
        const level = Math.min(1, pace / 3.4) * (stone ? 0.16 : 0.12);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(level, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0008, t + (stone ? 0.11 : 0.16));
        src.connect(band).connect(g).connect(this.master);
        src.start(t);
        src.stop(t + 0.2);
        this.alt = !this.alt;
    }

    thud(gain, pan) {
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(70, t + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12 * gain, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
        const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (p) { p.pan.value = pan; osc.connect(g).connect(p).connect(this.master); } else osc.connect(g).connect(this.master);
        osc.start(t);
        osc.stop(t + 0.22);
    }

    update(dt, { x, z, yaw, room, research }) {
        if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
        const t = this.ctx.currentTime;
        // Bigger rooms sound a little deeper.
        this.roomFilter.frequency.setTargetAtTime(STONE.has(room) ? 260 : 380, t, 0.5);
        const near = research?.loudest(x, z);
        const panOf = (px, pz) => {
            const dx = px - x;
            const dz = pz - z;
            // Right of the view direction is positive pan.
            const rx = Math.cos(yaw);
            const rz = -Math.sin(yaw);
            return Math.max(-1, Math.min(1, (dx * rx + dz * rz) / (Math.hypot(dx, dz) || 1)));
        };
        if (near) {
            const fall = Math.max(0, 1 - near.distance / 7);
            this.humGain.gain.setTargetAtTime(0.022 * near.inst.hum * fall * fall, t, 0.08);
            this.hum.frequency.setTargetAtTime(80 + 60 * near.inst.hum, t, 0.1);
            if (this.humPan) this.humPan.pan.setTargetAtTime(panOf(near.inst.centre.x, near.inst.centre.z) * 0.8, t, 0.1);
        } else {
            this.humGain.gain.setTargetAtTime(0, t, 0.2);
        }
        for (const inst of research?.list || []) {
            if (!inst.events.length) continue;
            const d = Math.hypot(inst.centre.x - x, inst.centre.z - z);
            if (d < 8 && inst.events.includes('place')) this.thud(Math.max(0, 1 - d / 8), panOf(inst.centre.x, inst.centre.z) * 0.8);
        }
    }
}
