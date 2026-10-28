import type { Cue, SpokenLine, TurnOutput } from "@marlow/game";
import type { Dir, Dist } from "@marlow/shared";

export interface AudioSettings { voice: number; music: number; sfx: number; mono: boolean }
const AZ: Record<string, number> = { ahead: 0, right: 90, behind: 180, left: 270 };
const RADIUS: Record<Dist, number> = { near: 2, mid: 6, far: 12 };
const CUTOFF: Record<Dist, number> = { near: 9000, mid: 4500, far: 2200 };
const WET: Record<Dist, number> = { near: 0.15, mid: 0.3, far: 0.45 };

/** Deterministic noise so synthesized placeholders sound the same every session. */
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

export class AudioEngine {
  ctx!: AudioContext;
  settings: AudioSettings = { voice: 1, music: 0.5, sfx: 0.9, mono: false };
  /** Assets that fell back to synthesized placeholders (listed as TODO in PROGRESS.md). */
  missing = new Set<string>();
  private master!: GainNode; private monoNode!: GainNode; private duck!: GainNode;
  private voiceGain!: GainNode; private musicGain!: GainNode; private sfxGain!: GainNode;
  private earpiece!: GainNode; private noiseBuf!: AudioBuffer;
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
    this.noiseBuf = this.makeNoise(2);
    // Earpiece bus: band-pass radio voice + faint static, mono and centred.
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 300;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3400;
    const mid = c.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1500; mid.gain.value = 4;
    this.earpiece.connect(hp); hp.connect(mid); mid.connect(lp); lp.connect(this.voiceGain);
    this.loopNoise(this.earpiece, 0.012, 2500, 1.2); // faint open-channel static
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
  private loopNoise(dest: AudioNode, gain: number, freq: number, q: number, type: BiquadFilterType = "bandpass") {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(dest); src.start();
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

  /** Placeholder synth for every cue id; a real file at /audio/sfx/<id>.wav replaces it. Returns duration in seconds. */
  private synth(id: string, dest: AudioNode, t: number): number {
    const mat = id.startsWith("sfx.footsteps.") ? id.split(".")[2] : "";
    if (mat) {
      const p = { marble: { freq: 2600, q: 3, dur: 0.07 }, carpet: { freq: 500, q: 0.8, dur: 0.12 }, metal: { freq: 1900, q: 6, dur: 0.14 } }[mat] ?? { freq: 1000, q: 1, dur: 0.1 };
      for (let i = 0; i < 4; i++) {
        this.burst(dest, t + i * 0.42, { ...p, gain: 0.9 });
        if (mat === "metal") this.tone(dest, t + i * 0.42, 880, 0.12, 0.04, "triangle");
      }
      return 4 * 0.42;
    }
    switch (id) {
      case "sfx.door.creak": {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
        o.type = "sawtooth"; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(95, t + 0.8);
        f.type = "bandpass"; f.frequency.value = 700; f.Q.value = 4;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.1); g.gain.linearRampToValueAtTime(0, t + 0.85);
        o.connect(f); f.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.9);
        return 0.9;
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
        for (let i = 0; i < 9; i++) this.burst(dest, t + i * 0.2, { freq: 2200, q: 3, dur: 0.07, gain: 1 });
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
    [110, 164.8, 277.2].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = "sine"; o.frequency.value = f; g.gain.value = 0.05; lfo.frequency.value = 0.07 + i * 0.03; lg.gain.value = 0.02;
      lfo.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(this.calm!); o.start(); lfo.start();
    });
    this.tension = c.createGain(); this.tension.gain.value = 0; this.tension.connect(this.musicGain);
    const o = c.createOscillator(), og = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = "square"; o.frequency.value = 55; og.gain.value = 0.05; lfo.frequency.value = 2; lg.gain.value = 0.04;
    lfo.connect(lg); lg.connect(og.gain); o.connect(og); og.connect(this.tension); o.start(); lfo.start();
    this.loopNoise(this.tension, 0.03, 200, 0.8, "lowpass");
    this.calm.gain.setTargetAtTime(1, c.currentTime, 1.5);
    // rain, HVAC, Marlow breathing: ambience bed that never reveals state
    const rain = this.loopNoise(this.sfxGain, 0.05, 3500, 0.4);
    const hvac = this.ctx.createOscillator(), hg = c.createGain(); hvac.frequency.value = 60; hg.gain.value = 0.02; hvac.connect(hg); hg.connect(this.sfxGain); hvac.start();
    const breath = this.loopNoise(this.sfxGain, 0.0, 600, 0.5, "lowpass");
    const lfo2 = c.createOscillator(), lg2 = c.createGain(); lfo2.frequency.value = 0.22; lg2.gain.value = 0.02; lfo2.connect(lg2); lg2.connect(breath.g.gain); lfo2.start();
    this.ambience = { stop: () => { rain.stop(); hvac.stop(); breath.stop(); } };
  }
  setTension(on: boolean) {
    if (!this.ctx) return;
    this.tension?.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 1.2);
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
