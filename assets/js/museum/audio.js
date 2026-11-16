// Optional, gentle sound: relaxing ambient music, plus a soft motor hum or
// the thud of a placed brick near a working demonstration (placed left or
// right of the listener). Everything is synthesised in the browser; there are
// no audio files to download. Sound stays off until the visitor turns it on.
//
// The music is generative, so it never loops audibly: four slow, open chords
// (D major 9, B minor 11, G major 7♯11, A sus) swell and fade into each other
// over about ten seconds each, a soft bass sits under them, and now and then a
// bell-like note from the D major pentatonic falls into a hall reverb and a
// warm echo. No percussion, nothing sudden.

const CHORD_LEN = 10;          // seconds per chord
const LOOKAHEAD = 1.2;         // schedule this far ahead (seconds)
const MUSIC_LEVEL = 1.7;

// MIDI note numbers for each chord's pad voicing, and its bass root.
const CHORDS = [
    { pad: [50, 57, 61, 64, 66], bass: 38 },   // Dmaj9
    { pad: [47, 54, 57, 62, 64], bass: 35 },   // Bm11
    { pad: [43, 50, 54, 59, 61], bass: 31 },   // Gmaj7(#11)
    { pad: [45, 52, 59, 61, 66], bass: 33 }    // A sus2 / 6
];
// D major pentatonic for the bells, A4 to D6.
const BELLS = [69, 71, 74, 76, 78, 81, 83, 86];

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);

export class MuseumAudio {
    constructor() {
        this.enabled = false;
        this.ctx = null;
    }

    /** Called on any click; resumes a context the browser suspended. */
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
        const t = this.ctx.currentTime;
        // Start the music from a fresh chord, fading in.
        this.nextChord = t + 0.1;
        this.nextBell = t + rand(3, 5);
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setValueAtTime(this.master.gain.value, t);
        this.master.gain.linearRampToValueAtTime(0.9, t + 4);
    }

    disable() {
        this.enabled = false;
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setValueAtTime(this.master.gain.value, t);
        this.master.gain.linearRampToValueAtTime(0, t + 1.2);
        setTimeout(() => { if (!this.enabled) this.ctx.suspend(); }, 1400);
    }

    suspend() { if (this.ctx && this.enabled) this.ctx.suspend(); }

    resume() {
        if (!this.ctx || !this.enabled) return;
        this.ctx.resume();
        // Pick up again from now rather than catching up on missed notes.
        const t = this.ctx.currentTime;
        if (this.nextChord < t) this.nextChord = t + 0.1;
        if (this.nextBell < t) this.nextBell = t + rand(1, 3);
    }

    build(ctx) {
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(ctx.destination);

        // Music bus: dry, plus a hall reverb.
        this.music = ctx.createGain();
        this.music.gain.value = MUSIC_LEVEL;
        const dry = ctx.createGain();
        dry.gain.value = 0.55;
        const reverb = ctx.createConvolver();
        reverb.buffer = this.hallImpulse(4.8);
        const wet = ctx.createGain();
        wet.gain.value = 0.6;
        this.music.connect(dry).connect(this.master);
        this.music.connect(reverb).connect(wet).connect(this.master);

        // A warm echo for the bells (low-passed in the feedback loop).
        this.echo = ctx.createDelay(2);
        this.echo.delayTime.value = 0.62;
        const fb = ctx.createGain();
        fb.gain.value = 0.34;
        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 2000;
        this.echo.connect(tone).connect(fb).connect(this.echo);
        const echoOut = ctx.createGain();
        echoOut.gain.value = 0.4;
        tone.connect(echoOut).connect(this.music);

        // A very slow drift on the pads' brightness.
        this.drift = ctx.createOscillator();
        this.drift.frequency.value = 0.045;
        this.driftDepth = ctx.createGain();
        this.driftDepth.gain.value = 260;
        this.drift.connect(this.driftDepth);
        this.drift.start();

        this.chordIndex = 0;
        this.lastBell = 3;
        this.nextChord = 0;
        this.nextBell = 0;

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

    /** A stereo impulse response for a large, soft room: decaying, darkening noise. */
    hallImpulse(seconds) {
        const ctx = this.ctx;
        const rate = ctx.sampleRate;
        const len = Math.floor(rate * seconds);
        const buf = ctx.createBuffer(2, len, rate);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            let lp = 0;
            for (let i = 0; i < len; i++) {
                const t = i / len;
                // Later reflections are darker: smooth the noise more as it decays.
                const k = 0.25 + 0.7 * t;
                lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
                d[i] = lp * Math.pow(1 - t, 2.6) * (i < rate * 0.02 ? i / (rate * 0.02) : 1);
            }
        }
        return buf;
    }

    // --- music ---------------------------------------------------------------

    /** One chord: a slow swell of detuned soft voices, and its bass note. */
    playChord(chord, t) {
        const ctx = this.ctx;
        const end = t + CHORD_LEN;
        chord.pad.forEach((note, k) => {
            const level = 0.022 * (1 - k * 0.09);
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 760 + k * 60;
            filter.Q.value = 0.4;
            this.driftDepth.connect(filter.frequency);
            const env = ctx.createGain();
            env.gain.setValueAtTime(0, t);
            env.gain.linearRampToValueAtTime(level, t + 3.4);
            env.gain.setValueAtTime(level, end - 0.5);
            env.gain.setTargetAtTime(0, end - 0.5, 1.6);
            filter.connect(env).connect(this.music);
            for (const [type, cents] of [['triangle', -6], ['sine', 7]]) {
                const osc = ctx.createOscillator();
                osc.type = type;
                osc.frequency.value = hz(note);
                osc.detune.value = cents + rand(-2, 2);
                osc.connect(filter);
                osc.start(t);
                osc.stop(end + 8);
            }
            setTimeout(() => { try { this.driftDepth.disconnect(filter.frequency); } catch { /* already gone */ } }, (end + 9 - ctx.currentTime) * 1000);
        });
        // Bass: a soft, rounded tone swelling under the pad (a filtered
        // triangle, so it is still heard on small speakers).
        const bass = ctx.createOscillator();
        bass.type = 'triangle';
        bass.frequency.value = hz(chord.bass);
        const round = ctx.createBiquadFilter();
        round.type = 'lowpass';
        round.frequency.value = 320;
        const benv = ctx.createGain();
        benv.gain.setValueAtTime(0, t);
        benv.gain.linearRampToValueAtTime(0.08, t + 4);
        benv.gain.setValueAtTime(0.08, end - 0.5);
        benv.gain.setTargetAtTime(0, end - 0.5, 1.4);
        bass.connect(round).connect(benv).connect(this.music);
        bass.start(t);
        bass.stop(end + 7);
    }

    /** One bell note: a soft attack and a long, warm decay, into the echo. */
    playBell(midi, t, level = 1) {
        const ctx = this.ctx;
        const out = ctx.createGain();
        out.gain.value = 0.05 * level;
        const warm = ctx.createBiquadFilter();
        warm.type = 'lowpass';
        warm.frequency.value = 3200;
        out.connect(warm);
        warm.connect(this.music);
        warm.connect(this.echo);
        // Partials of a soft mallet: the fundamental, an octave, a faint twelfth.
        for (const [mult, gain, decay] of [[1, 1, 3.2], [2.0, 0.24, 1.6], [3.01, 0.06, 0.9]]) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = hz(midi) * mult;
            const env = ctx.createGain();
            env.gain.setValueAtTime(0, t);
            env.gain.linearRampToValueAtTime(gain, t + 0.012);
            env.gain.setTargetAtTime(0, t + 0.012, decay / 3);
            osc.connect(env).connect(out);
            osc.start(t);
            osc.stop(t + decay * 2.5);
        }
    }

    /** Choose the next bell: a small step from the last one, preferring notes in the chord. */
    nextBellNote() {
        const chord = CHORDS[(this.chordIndex + CHORDS.length - 1) % CHORDS.length];
        const fits = (m) => chord.pad.some((p) => (m - p) % 12 === 0);
        let best = this.lastBell;
        let bestScore = -Infinity;
        for (let i = 0; i < BELLS.length; i++) {
            const step = Math.abs(i - this.lastBell);
            if (step === 0 || step > 3) continue;
            const score = (fits(BELLS[i]) ? 1.2 : 0) - step * 0.35 + Math.random();
            if (score > bestScore) { bestScore = score; best = i; }
        }
        this.lastBell = best;
        return BELLS[best];
    }

    scheduleMusic() {
        const t = this.ctx.currentTime;
        while (this.nextChord < t + LOOKAHEAD) {
            this.playChord(CHORDS[this.chordIndex], this.nextChord);
            this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
            this.nextChord += CHORD_LEN;
        }
        while (this.nextBell < t + LOOKAHEAD) {
            const at = this.nextBell;
            this.playBell(this.nextBellNote(), at, rand(0.7, 1));
            // Sometimes a second note answers the first.
            if (Math.random() < 0.3) this.playBell(this.nextBellNote(), at + rand(0.45, 0.8), rand(0.5, 0.75));
            this.nextBell = at + rand(2.2, 5.5);
        }
    }

    // --- installations ------------------------------------------------------

    thud(gain, pan) {
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(70, t + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.1 * gain, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
        const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (p) { p.pan.value = pan; osc.connect(g).connect(p).connect(this.master); } else osc.connect(g).connect(this.master);
        osc.start(t);
        osc.stop(t + 0.22);
    }

    update(dt, { x, z, yaw, research }) {
        if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
        this.scheduleMusic();
        const t = this.ctx.currentTime;
        const panOf = (px, pz) => {
            const dx = px - x;
            const dz = pz - z;
            // Right of the view direction is positive pan.
            const rx = Math.cos(yaw);
            const rz = -Math.sin(yaw);
            return Math.max(-1, Math.min(1, (dx * rx + dz * rz) / (Math.hypot(dx, dz) || 1)));
        };
        const near = research?.loudest(x, z);
        if (near) {
            const fall = Math.max(0, 1 - near.distance / 7);
            this.humGain.gain.setTargetAtTime(0.016 * near.inst.hum * fall * fall, t, 0.08);
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
