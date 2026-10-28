/** Speech input chain: server Muse Voice Transcribe (when configured) -> browser speech recognition -> typed input. */
export interface Stt { name: string; start(onPartial: (t: string) => void): void; stop(): Promise<string | null> }

export class BrowserStt implements Stt {
  name = "browser-speech";
  private rec: any; private text = ""; private done?: (t: string | null) => void;
  static available() { return typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition); }
  start(onPartial: (t: string) => void) {
    const R = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.rec = new R(); this.rec.lang = "en-US"; this.rec.interimResults = true; this.rec.continuous = false; this.text = "";
    this.rec.onresult = (e: any) => {
      let t = ""; for (const r of e.results) t += r[0].transcript;
      this.text = t; onPartial(t); // partials are display-only; only the final transcript acts
    };
    this.rec.onend = () => this.done?.(this.text.trim() || null);
    this.rec.onerror = () => this.done?.(null);
    this.rec.start();
  }
  stop() { return new Promise<string | null>(res => { this.done = res; try { this.rec.stop(); } catch { res(null); } }); }
}

/** Decode a recording and re-encode as 16 kHz mono 16-bit PCM WAV (the only format Muse Voice Transcribe accepts). */
export async function toWav16k(blob: Blob): Promise<Blob> {
  const ac = new AudioContext();
  const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
  await ac.close();
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVEfmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, 1, true); out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, "data"); out.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([out], { type: "audio/wav" });
}

/** Posts the recording (as WAV) to /api/transcribe, which forwards it to Muse Voice Transcribe. */
export class ServerStt implements Stt {
  name = "muse-voice-transcribe";
  private mr?: MediaRecorder; private chunks: Blob[] = []; private stream?: MediaStream;
  start() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      this.stream = stream; this.chunks = []; this.mr = new MediaRecorder(stream);
      this.mr.ondataavailable = e => this.chunks.push(e.data);
      this.mr.start();
    }).catch(() => {});
  }
  async stop() {
    const mr = this.mr; if (!mr) return null;
    await new Promise<void>(res => { mr.onstop = () => res(); mr.stop(); });
    this.stream?.getTracks().forEach(t => t.stop());
    const blob = await toWav16k(new Blob(this.chunks, { type: mr.mimeType }));
    const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: blob });
    if (!res.ok) throw new Error(`transcribe ${res.status}`);
    return ((await res.json()) as { text: string }).text?.trim() || null;
  }
}
