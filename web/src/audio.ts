import type { Cue, SpokenLine, TurnOutput } from "@marlow/game";
import type { Dir, Dist } from "@marlow/shared";

export interface AudioSettings { voice: number; music: number; sfx: number; mono: boolean; ambience: boolean }
const AZ: Record<string, number> = { ahead: 0, right: 90, behind: 180, left: 270 };
const RADIUS: Record<Dist, number> = { near: 2, mid: 6, far: 12 };
const CUTOFF: Record<Dist, number> = { near: 9000, mid: 4500, far: 2200 };
const WET: Record<Dist, number> = { near: 0.15, mid: 0.3, far: 0.45 };

/** Deterministic noise so synthesized placeholders sound the same every session. */
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

export class AudioEngine {
  ctx!: AudioContext;
  settings: AudioSettings = { voice: 1, music: 0.35, sfx: 1, mono: false, ambience: false };
  /** Assets that fell back to synthesized placeholders (listed as TODO in PROGRESS.md). */
  missing = new Set<string>();
  private master!: GainNode; private monoNode!: GainNode; private duck!: GainNode;
  private voiceGain!: GainNode; private musicGain!: GainNode; private sfxGain!: GainNode;
  private earpiece!: GainNode; private noiseBuf!: AudioBuffer; private pinkBuf!: AudioBuffer; private brownBuf!: AudioBuffer;
  private timers: ReturnType<typeof setTimeout>[] = []; private ambTimers: ReturnType<typeof setTimeout>[] = []; private tensionTimer?: ReturnType<typeof setInterval>;
  private reverbs: Record<string, ConvolverNode> = {};
  private calm?: GainNode; private tension?: GainNode;
  private voicePlaying = 0;
  private cache = new Map<string, AudioBuffer | null>();
  private ambience?: { stop(): void };
  private waitTimer?: ReturnType<typeof setInterval>;

  async unlock() {
    if (this.ctx) { await this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    const c = this.ctx;
    this.master = c.createGain(); this.monoNode = c.createGain();
    this.monoNode.channelCount = 1; this.monoNode.channelCountMode = "explicit"; this.monoNode.channelInterpretation = "speakers";
    this.duck = c.createGain(); this.voiceGain = c.createGain(); this.musicGain = c.createGain(); this.sfxGain = c.createGain();
    this.earpiece = c.createGain();
    this.sfxGain.connect(this.duck); this.musicGain.connect(this.duck); this.duck.connect(this.master);
    this.voiceGain.connect(this.master);
    this.noiseBuf = this.makeNoise(8); this.pinkBuf = this.makeColored(20, "pink", 11); this.brownBuf = this.makeColored(20, "brown", 13);
    // Earpiece bus: band-pass radio voice + faint static, mono and centred.
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 300;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3400;
    const mid = c.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1500; mid.gain.value = 4;
    this.earpiece.connect(hp); hp.connect(mid); mid.connect(lp); lp.connect(this.voiceGain);
    this.applySettings(); this.routeMaster();
    for (const kind of ["marble", "dry", "metal"]) {
      const cv = c.createConvolver(); cv.buffer = this.makeIR(kind); cv.connect(this.sfxGain); this.reverbs[kind] = cv;
    }
    this.startMusic();
    await c.resume();
  }

  applySettings(s: Partial<AudioSettings> = {}) {
    Object.assign(this.settings, s);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voiceGain.gain.setTargetAtTime(this.settings.voice, t, 0.02);
    this.musicGain.gain.setTargetAtTime(this.settings.music, t, 0.02);
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx, t, 0.02);
    this.routeMaster();
    this.applyAmbience();
  }
  private routeMaster() {
    this.master.disconnect(); this.monoNode.disconnect();
    if (this.settings.mono) { this.master.connect(this.monoNode); this.monoNode.connect(this.ctx.destination); }
    else this.master.connect(this.ctx.destination);
  }

  // ---------- synthesis helpers ----------
  private makeNoise(sec: number, seed = 7): AudioBuffer {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate), d = b.getChannelData(0), r = lcg(seed);
    for (let i = 0; i < d.length; i++) d[i] = r();
    return b;
  }
  /** Pink (1/f) or brown (1/f^2) noise: what rain and room rumble actually sound like, unlike harsh white noise. */
  private makeColored(sec: number, kind: "pink" | "brown", seed: number): AudioBuffer {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate), d = b.getChannelData(0), r = lcg(seed);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0, peak = 0;
    for (let i = 0; i < d.length; i++) {
      const w = r();
      if (kind === "pink") {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last; }
      peak = Math.max(peak, Math.abs(d[i]));
    }
    for (let i = 0; i < d.length; i++) d[i] /= peak || 1;
    return b;
  }
  private makeIR(kind: string): AudioBuffer {
    const rate = this.ctx.sampleRate, len = { marble: 2.3, dry: 0.28, metal: 1.4 }[kind] ?? 1;
    const b = this.ctx.createBuffer(2, rate * len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch), r = lcg(kind.length * 31 + ch * 7 + 3);
      for (let i = 0; i < d.length; i++) {
        const t = i / rate, decay = Math.exp(-t * ({ marble: 2.6, dry: 14, metal: 4 }[kind] ?? 4));
        let v = r() * decay;
        if (kind === "metal") v += Math.sin(2 * Math.PI * (900 + ch * 37) * t) * decay * 0.25 + Math.sin(2 * Math.PI * 1530 * t) * decay * 0.15;
        if (kind === "marble") v *= 1 - Math.min(0.5, t * 0.3); // bright early reflections
        d[i] = v * 0.6;
      }
    }
    return b;
  }
  private loopNoise(dest: AudioNode, gain: number, freq: number, q: number, type: BiquadFilterType = "bandpass", buf?: AudioBuffer) {
    const src = this.ctx.createBufferSource(); src.buffer = buf ?? this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(dest); src.start(0, Math.random() * src.buffer!.duration);
    return { src, g, stop: () => { try { src.stop(); } catch { /* already stopped */ } } };
  }
  private burst(dest: AudioNode, t: number, o: { freq: number; q: number; dur: number; gain: number; type?: BiquadFilterType }) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = o.type ?? "bandpass"; f.frequency.value = o.freq; f.Q.value = o.q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(dest); src.start(t, Math.random() * 1); src.stop(t + o.dur + 0.05);
  }
  private tone(dest: AudioNode, t: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine") {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.setValueAtTime(gain, t + dur - 0.04); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  /** One footstep: a low heel thump (survives distance and occlusion filtering) plus a surface-specific click and a lighter toe tap. */
  private footstep(dest: AudioNode, t: number, mat: string, k: number) {
    const c = this.ctx, v = 0.85 + 0.3 * (((k * 37 + 11) % 10) / 10);
    const p = ({ marble: { body: 105, click: 2300, q: 2.5, cg: 0.55, bg: 0.9 }, carpet: { body: 85, click: 650, q: 0.7, cg: 0.2, bg: 0.9 }, metal: { body: 120, click: 1700, q: 4, cg: 0.55, bg: 0.7 } } as const)[mat as "marble"] ?? { body: 100, click: 1500, q: 1, cg: 0.4, bg: 0.8 };
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(p.body * v * 1.6, t); o.frequency.exponentialRampToValueAtTime(p.body * v * 0.6, t + 0.1);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(p.bg * 0.55 * v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.16);
    this.burst(dest, t, { freq: p.click * v, q: p.q, dur: 0.05, gain: p.cg * v });
    this.burst(dest, t + 0.07, { freq: p.click * 0.8 * v, q: p.q, dur: 0.035, gain: p.cg * 0.45 * v }); // toe
    if (mat === "metal") this.tone(dest, t, 1250 * v, 0.22, 0.03, "triangle");
  }

  /** Placeholder synth for every cue id; a real file at /audio/sfx/<id>.wav replaces it. Returns duration in seconds. */
  private synth(id: string, dest: AudioNode, t: number): number {
    const mat = id.startsWith("sfx.footsteps.") ? id.split(".")[2] : "";
    if (mat) {
      const gaps = [0, 0.46, 0.9, 1.38]; // slightly uneven, like a person walking
      gaps.forEach((g, k) => this.footstep(dest, t + g, mat, k));
      return 1.8;
    }
    switch (id) {
      case "sfx.door.creak": {
        // Two-stage hinge groan: wobbling sawtooth under a sweeping resonance, a latch click first, a little air noise over it.
        this.burst(dest, t, { freq: 2600, q: 2, dur: 0.03, gain: 0.5 });
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
        o.type = "sawtooth"; o.frequency.setValueAtTime(150, t + 0.05); o.frequency.exponentialRampToValueAtTime(82, t + 0.55); o.frequency.exponentialRampToValueAtTime(118, t + 0.9); o.frequency.exponentialRampToValueAtTime(70, t + 1.2);
        lfo.frequency.value = 9; lg.gain.value = 9; lfo.connect(lg); lg.connect(o.frequency);
        f.type = "bandpass"; f.Q.value = 5; f.frequency.setValueAtTime(520, t); f.frequency.linearRampToValueAtTime(980, t + 0.6); f.frequency.linearRampToValueAtTime(640, t + 1.2);
        g.gain.setValueAtTime(0, t + 0.05); g.gain.linearRampToValueAtTime(0.42, t + 0.25); g.gain.setValueAtTime(0.26, t + 0.6); g.gain.linearRampToValueAtTime(0.38, t + 0.85); g.gain.linearRampToValueAtTime(0, t + 1.25);
        o.connect(f); f.connect(g); g.connect(dest); o.start(t + 0.05); lfo.start(t + 0.05); o.stop(t + 1.3); lfo.stop(t + 1.3);
        this.burst(dest, t + 0.1, { freq: 1400, q: 0.6, dur: 1.0, gain: 0.05 });
        return 1.3;
      }
      case "sfx.phone.ring":
        for (let i = 0; i < 3; i++) { this.tone(dest, t + i * 0.9, 440, 0.4, 0.1); this.tone(dest, t + i * 0.9, 480, 0.4, 0.1); }
        return 2.6;
      case "sfx.stinger.spotted":
        this.tone(dest, t, 110, 1.1, 0.25, "sawtooth"); this.tone(dest, t, 116.5, 1.1, 0.2, "sawtooth"); this.burst(dest, t, { freq: 400, q: 0.5, dur: 0.6, gain: 1 });
        return 1.1;
      case "sfx.guard.alert": {
        // a sharp rising "huh?" blip and a rustle: the guard's head turns
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = "triangle"; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.18);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.03); g.gain.linearRampToValueAtTime(0, t + 0.3);
        o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.35);
        this.burst(dest, t, { freq: 1800, q: 0.8, dur: 0.25, gain: 0.5 });
        return 0.35;
      }
      case "sfx.chase": {
        for (let i = 0; i < 9; i++) this.footstep(dest, t + i * 0.2, "marble", i);
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = "sawtooth"; o.frequency.setValueAtTime(420, t); o.frequency.linearRampToValueAtTime(900, t + 0.9); o.frequency.linearRampToValueAtTime(420, t + 1.8);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.14, t + 0.1); g.gain.linearRampToValueAtTime(0, t + 1.8);
        o.connect(g); g.connect(dest); o.start(t); o.stop(t + 1.9);
        return 1.9;
      }
      case "sfx.radio.click": this.burst(dest, t, { freq: 3000, q: 0.7, dur: 0.03, gain: 0.7, type: "highpass" }); return 0.05;
      case "sfx.radio.static": this.burst(dest, t, { freq: 2200, q: 0.5, dur: 0.6, gain: 0.5 }); return 0.6;
      default: this.tone(dest, t, 330, 0.2, 0.05); return 0.2; // unknown cue id: audible TODO placeholder
    }
  }

  private async asset(url: string): Promise<AudioBuffer | null> {
    if (this.cache.has(url)) return this.cache.get(url)!;
    let buf: AudioBuffer | null = null;
    try {
      const r = await fetch(url);
      if (r.ok && (r.headers.get("content-type") ?? "").startsWith("audio")) buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
    } catch { /* missing asset: placeholder */ }
    this.cache.set(url, buf);
    if (!buf) this.missing.add(url);
    return buf;
  }

  // ---------- music + ambience ----------
  private startMusic() {
    const c = this.ctx;
    this.calm = c.createGain(); this.calm.gain.value = 0; this.calm.connect(this.musicGain);
    this.tension = c.createGain(); this.tension.gain.value = 0; this.tension.connect(this.musicGain);
    this.loopNoise(this.tension, 0.5, 220, 0.7, "lowpass", this.brownBuf); // low swell under the heartbeat
    this.calm.gain.setTargetAtTime(1, c.currentTime, 1.5);

    // Calm: a slow minor pad (Am - F - G - E) with sparse bell notes. Chords overlap, so there is never silence or a click.
    const chords = [[110, 164.81, 220, 261.63], [87.31, 130.81, 174.61, 220], [98, 146.83, 196, 246.94], [82.41, 123.47, 164.81, 207.65]];
    let ci = 0;
    const pad = () => {
      const t = c.currentTime + 0.05;
      for (const f of chords[ci++ % chords.length]) for (const det of [-7, 7]) {
        const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
        o.type = "triangle"; o.frequency.value = f; o.detune.value = det; lp.type = "lowpass"; lp.frequency.value = 900;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 3); g.gain.setValueAtTime(0.03, t + 5); g.gain.linearRampToValueAtTime(0, t + 9.5);
        o.connect(lp); lp.connect(g); g.connect(this.calm!); o.start(t); o.stop(t + 9.6);
      }
    };
    pad(); const padT = setInterval(pad, 7000);
    const bell = () => {
      const t = c.currentTime + 0.05, f = [440, 523.25, 659.25, 783.99][Math.floor(Math.random() * 4)];
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.022, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      o.connect(g); g.connect(this.calm!); o.start(t); o.stop(t + 3.3);
      this.timers.push(setTimeout(bell, 5000 + Math.random() * 7000));
    };
    this.timers.push(setTimeout(bell, 3500));

    this.applyAmbience();
  }
  private applyAmbience() {
    if (!this.ctx) return;
    if (!this.settings.ambience) { this.ambience?.stop(); this.ambience = undefined; return; }
    if (this.ambience) return;
    const c = this.ctx;
    const rain = this.loopNoise(this.sfxGain, 0.07, 1000, 0.3, "highpass", this.pinkBuf);
    const rainLp = this.loopNoise(this.sfxGain, 0.05, 5500, 0.3, "lowpass", this.pinkBuf);
    const rumble = this.loopNoise(this.sfxGain, 0.16, 170, 0.5, "lowpass", this.brownBuf);
    const drip = () => {
      this.burst(this.sfxGain, c.currentTime + 0.02, { freq: 2500 + Math.random() * 3500, q: 9, dur: 0.035, gain: 0.05 + Math.random() * 0.07 });
      this.ambTimers.push(setTimeout(drip, 120 + Math.random() * 900));
    };
    drip();
    const breath = () => {
      const t = c.currentTime + 0.05, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = this.pinkBuf; f.type = "bandpass"; f.frequency.value = 650; f.Q.value = 0.6;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + 0.9); g.gain.linearRampToValueAtTime(0.0001, t + 2);
      src.connect(f); f.connect(g); g.connect(this.sfxGain); src.start(t, Math.random() * 10); src.stop(t + 2.1);
      this.ambTimers.push(setTimeout(breath, 3400));
    };
    this.ambTimers.push(setTimeout(breath, 1500));
    this.ambience = { stop: () => { rain.stop(); rainLp.stop(); rumble.stop(); this.ambTimers.forEach(clearTimeout); this.ambTimers = []; } };
  }
  private thump(dest: AudioNode, t: number, freq: number, gain: number) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(freq * 1.5, t); o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.25);
  }
  setTension(on: boolean) {
    if (!this.ctx) return;
    this.tension?.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 1.2);
    if (this.tensionTimer) { clearInterval(this.tensionTimer); this.tensionTimer = undefined; }
    if (on && this.tension) {
      const beat = () => { const t = this.ctx.currentTime + 0.02; this.thump(this.tension!, t, 58, 0.6); this.thump(this.tension!, t + 0.27, 50, 0.4); };
      beat(); this.tensionTimer = setInterval(beat, 900);
    }
    if (!on) this.calm?.gain.setTargetAtTime(0.4, this.ctx.currentTime, 2);
  }

  // ---------- ducking ----------
  private duckOn() { if (this.voicePlaying++ === 0) this.duck.gain.setTargetAtTime(0.35, this.ctx.currentTime, 0.04); } // about -9 dB
  private duckOff() { if (--this.voicePlaying <= 0) { this.voicePlaying = 0; this.duck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.25); } }

  // ---------- public playback ----------
  /** Instant on push-to-talk release: radio click, then the pre-rendered "Copy." */
  async playAck(line?: SpokenLine) {
    this.synth("sfx.radio.click", this.earpiece, this.ctx.currentTime);
    if (line) await this.playVoice(line);
  }

  /** Static burst for the timeout branch. */
  playStatic() { this.synth("sfx.radio.static", this.earpiece, this.ctx.currentTime); }

  playCueId(id: string) {
    if (!this.ctx) return;
    if (id === "music.tension.on") this.setTension(true);
    else if (id === "music.tension.off") this.setTension(false);
    else if (id.startsWith("sfx.radio")) this.synth(id, this.earpiece, this.ctx.currentTime);
    else if (id.startsWith("sfx.")) this.synth(id, this.sfxGain, this.ctx.currentTime);
  }

  /** World cue at a position derived from a perception event (never from raw state). */
  private async playWorldCue(cue: Cue, t: number): Promise<number> {
    const c = this.ctx;
    if (cue.kind === "music") { this.playCueId(cue.id); return 0; }
    const out = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = "lowpass";
    const dist = cue.dist ?? "near", spatial = !!cue.dir && cue.dir !== "here";
    lp.frequency.value = cue.occluded ? 600 : spatial ? CUTOFF[dist] : 12000;
    out.gain.value = (cue.occluded ? 0.5 : 1) * (spatial ? 1 : 0.9);
    const dry = c.createGain(), wet = c.createGain();
    wet.gain.value = spatial ? WET[dist] : 0.12; dry.gain.value = 1 - (spatial ? WET[dist] * 0.5 : 0);
    out.connect(lp);
    let entry: AudioNode = lp;
    if (spatial) {
      const p = c.createPanner(); p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 1; p.rolloffFactor = 1;
      const [x0, z0] = polar(cue.fromDir ?? cue.dir!, dist), [x1, z1] = polar(cue.dir!, dist);
      this.setPos(p, x0, z0, t);
      if (cue.fromDir) {
        // Moving source: sweep along the shortest arc to reduce front/back confusion.
        const a0 = AZ[cue.fromDir] ?? 0, a1 = AZ[cue.dir!] ?? 0;
        let d = ((a1 - a0 + 540) % 360) - 180; if (Math.abs(d) === 180) d = 180;
        const steps = 20;
        for (let i = 1; i <= steps; i++) {
          const az = ((a0 + (d * i) / steps) * Math.PI) / 180, r = RADIUS[dist];
          this.setPos(p, r * Math.sin(az), -r * Math.cos(az), t + (i * 2.4) / steps);
        }
      } else this.setPos(p, x1, z1, t);
      lp.connect(p); entry = p;
    }
    entry.connect(dry); entry.connect(wet);
    dry.connect(this.sfxGain); wet.connect(this.reverbs[cue.reverb] ?? this.reverbs.marble);
    const buf = await this.asset(`/audio/sfx/${cue.id}.wav`);
    if (buf) { const s = c.createBufferSource(); s.buffer = buf; s.connect(out); s.start(t); return buf.duration; }
    return this.synth(cue.id, out, t);
  }
  private setPos(p: PannerNode, x: number, z: number, t: number) {
    p.positionX.setValueAtTime(x, t); p.positionY.setValueAtTime(0, t); p.positionZ.setValueAtTime(z, t);
  }

  private async playVoice(line: SpokenLine): Promise<void> {
    const c = this.ctx, buf = await this.asset(`/audio/lines/${line.audioKey}.wav`);
    this.duckOn();
    const t = c.currentTime + 0.02;
    let dur: number;
    if (buf) {
      const s = c.createBufferSource(); s.buffer = buf; s.connect(this.earpiece); s.start(t); dur = buf.duration;
    } else {
      // No pre-rendered file: murmur placeholder (never runtime TTS). Length follows word count; pitch follows speaker.
      const words = line.text.split(/\s+/).length, base = line.speaker === "client" ? 105 : 190;
      dur = Math.min(7, 0.22 * words + 0.2);
      for (let i = 0; i < words; i++) this.tone(this.earpiece, t + i * 0.22, base * (1 + 0.08 * ((i * 7) % 5)), 0.17, 0.07, "triangle");
    }
    await new Promise(r => setTimeout(r, dur * 1000 + 120));
    this.duckOff();
  }

  /** Cues first (never two important ones at once), Marlow's voice over the top with the world ducked. */
  async playTurn(out: Pick<TurnOutput, "cues" | "lines" | "beatCueIds">): Promise<void> {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + 0.05;
    let importantEnd = now;
    const tasks: Promise<unknown>[] = [];
    for (const cue of out.cues) {
      const important = cue.priority >= 3;
      const t = important ? importantEnd : now;
      tasks.push(this.playWorldCue(cue, t).then(d => { if (important) importantEnd = Math.max(importantEnd, t + d + 0.2); return d; }));
      if (important) await tasks[tasks.length - 1]; // serialise important cues
    }
    for (const id of out.beatCueIds) this.playCueId(id);
    const voice = (async () => {
      await new Promise(r => setTimeout(r, out.cues.length ? 450 : 0));
      for (const l of out.lines) { await this.playVoice(l); await new Promise(r => setTimeout(r, 180)); }
    })();
    await Promise.all([...tasks, voice]);
  }

  /** While a model call is pending: ambience only, plus the guard pacing at the last PERCEIVED position. */
  startWaiting(lastHeard: { dir: string; dist: Dist } | null, reverb: string) {
    this.stopWaiting();
    if (!this.ctx || !lastHeard || lastHeard.dir === "here") return;
    const cue: Cue = { id: "sfx.footsteps.marble", kind: "world", priority: 1, dir: lastHeard.dir as Dir, dist: lastHeard.dist, reverb, caption: "" };
    this.waitTimer = setInterval(() => void this.playWorldCue(cue, this.ctx.currentTime), 2200);
  }
  stopWaiting() { if (this.waitTimer) clearInterval(this.waitTimer); this.waitTimer = undefined; }
}

function polar(dir: Dir, dist: Dist): [number, number] {
  const r = RADIUS[dist], az = ((AZ[dir] ?? 0) * Math.PI) / 180;
  return [r * Math.sin(az), -r * Math.cos(az)];
}
