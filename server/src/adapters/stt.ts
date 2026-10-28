import type { Config } from "../config";
import { NotConfigured } from "./errors";

export interface SttAdapter { name: string; transcribe(audio: ArrayBuffer, mime: string): Promise<{ text: string }> }

/**
 * Muse Voice Transcribe: POST {base}/asr/transcribe, multipart/form-data with a JSON `request` part
 * ({model:"muse-voice-transcribe-1.0", audioEncoding:"WAV", mode:"PUSH_TO_TALK"}) and an `audio` part (mono PCM WAV, 16 or 24 kHz,
 * max 10 min / 32 MB). Buffered JSON reply: `transcript` (string) at the top level. The browser client sends 16 kHz mono WAV.
 */
export class MetaStt implements SttAdapter {
  name = "muse-voice-transcribe";
  constructor(private cfg: Config, private fetchImpl: typeof fetch = fetch) {}
  async transcribe(audio: ArrayBuffer, _mime: string): Promise<{ text: string }> {
    if (!this.cfg.modelApiKey) throw new NotConfigured("MODEL_API_KEY not set");
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], { type: "application/json" }));
    form.append("audio", new Blob([audio], { type: "audio/wav" }), "order.wav");
    const res = await this.fetchImpl(`${this.cfg.base}/asr/transcribe`, {
      method: "POST", headers: { Authorization: `Bearer ${this.cfg.modelApiKey}`, Accept: "application/json" }, body: form,
    });
    if (!res.ok) throw new Error(`transcribe HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { transcript?: string };
    return { text: (j.transcript ?? "").trim() };
  }
}
