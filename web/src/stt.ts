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

/** Posts the recording to /api/transcribe. The server returns 501 until the Muse Voice Transcribe shape is wired. */
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
    const blob = new Blob(this.chunks, { type: mr.mimeType });
    const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    if (!res.ok) throw new Error(`transcribe ${res.status}`);
    return ((await res.json()) as { text: string }).text?.trim() || null;
  }
}
