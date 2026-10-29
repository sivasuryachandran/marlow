/** Always-on listening: detects the end of each spoken order by silence and hands back a 16 kHz mono WAV. */
export interface HandsFreeOptions { onSegment: (wav: Blob) => void; onLevel?: (rms: number, speaking: boolean) => void }

const FRAME = 2048, PRE_ROLL_S = 0.35, END_SILENCE_S = 0.8, MIN_SPEECH_S = 0.3, MAX_SEGMENT_S = 12;

export class HandsFree {
  private ctx?: AudioContext; private stream?: MediaStream; private node?: ScriptProcessorNode;
  private pre: Float32Array[] = []; private seg: Float32Array[] = [];
  private speaking = false; private speechS = 0; private silenceS = 0; private floor = 0.004;
  /** While true (Marlow talking, a turn being processed, mic muted) incoming audio is dropped. */
  paused = true;
  constructor(private opts: HandsFreeOptions) {}

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(FRAME, 1, 1);
    this.node.onaudioprocess = e => this.frame(e.inputBuffer.getChannelData(0));
    const mute = this.ctx.createGain(); mute.gain.value = 0; // keep the node pulling without playing the mic back
    src.connect(this.node); this.node.connect(mute); mute.connect(this.ctx.destination);
    this.paused = false;
  }
  stop() { this.paused = true; this.node?.disconnect(); this.stream?.getTracks().forEach(t => t.stop()); void this.ctx?.close(); }
  /** Drop whatever is half-captured (call when pausing so Marlow's own voice never becomes an order). */
  reset() { this.pre = []; this.seg = []; this.speaking = false; this.speechS = 0; this.silenceS = 0; }

  private frame(input: Float32Array) {
    if (this.paused) { this.reset(); return; }
    const buf = new Float32Array(input); // the engine reuses its buffer
    const dur = buf.length / this.ctx!.sampleRate;
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const thresh = Math.max(0.015, this.floor * 3.5);
    const loud = rms > thresh;
    if (!this.speaking) {
      if (!loud) this.floor = this.floor * 0.95 + rms * 0.05; // learn the room's noise floor while quiet
      this.pre.push(buf); let keep = 0, n = this.pre.length;
      while (n > 0 && keep < PRE_ROLL_S) { keep += this.pre[--n].length / this.ctx!.sampleRate; }
      this.pre = this.pre.slice(n);
      this.speechS = loud ? this.speechS + dur : 0;
      if (this.speechS >= 0.12) { this.speaking = true; this.seg = [...this.pre]; this.pre = []; this.silenceS = 0; }
    } else {
      this.seg.push(buf);
      this.silenceS = loud ? 0 : this.silenceS + dur;
      const total = this.seg.reduce((a, b) => a + b.length, 0) / this.ctx!.sampleRate;
      if (this.silenceS >= END_SILENCE_S || total >= MAX_SEGMENT_S) {
        const voiced = total - this.silenceS;
        const seg = this.seg; this.reset();
        if (voiced >= MIN_SPEECH_S) void this.emit(seg);
      }
    }
    this.opts.onLevel?.(rms, this.speaking);
  }

  private async emit(chunks: Float32Array[]) {
    const len = chunks.reduce((a, b) => a + b.length, 0), pcm = new Float32Array(len);
    let o = 0; for (const c of chunks) { pcm.set(c, o); o += c.length; }
    const inRate = this.ctx!.sampleRate, outLen = Math.ceil(len * 16000 / inRate);
    const off = new OfflineAudioContext(1, outLen, 16000);
    const ab = off.createBuffer(1, len, inRate); ab.copyToChannel(pcm, 0);
    const src = off.createBufferSource(); src.buffer = ab; src.connect(off.destination); src.start();
    const out16 = (await off.startRendering()).getChannelData(0);
    const dv = new DataView(new ArrayBuffer(44 + out16.length * 2));
    const w = (p: number, s: string) => [...s].forEach((c, i) => dv.setUint8(p + i, c.charCodeAt(0)));
    w(0, "RIFF"); dv.setUint32(4, 36 + out16.length * 2, true); w(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    w(36, "data"); dv.setUint32(40, out16.length * 2, true);
    out16.forEach((v, i) => dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
    this.opts.onSegment(new Blob([dv], { type: "audio/wav" }));
  }
}
