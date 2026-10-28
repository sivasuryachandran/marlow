import type { Config } from "../config";
import { NotConfigured } from "./errors";

export interface SttAdapter { name: string; transcribe(audio: ArrayBuffer, mime: string): Promise<{ text: string }> }

/**
 * Muse Voice Transcribe: documented endpoint `POST {base}/asr/transcribe`, model `muse-voice-transcribe-1.0`.
 * TODO(docs): request fields (multipart vs JSON, model field, language) from /docs/api-reference/voice/transcribe,
 * and response schema from /docs/api-reference/voice/schemas. The client falls back to browser speech, then typed input.
 */
export class MetaStt implements SttAdapter {
  name = "muse-voice-transcribe";
  constructor(private cfg: Config) {}
  async transcribe(_audio: ArrayBuffer, _mime: string): Promise<{ text: string }> {
    if (!this.cfg.modelApiKey) throw new NotConfigured("MODEL_API_KEY not set");
    throw new NotConfigured("Muse Voice Transcribe request/response shape (TODO(docs))");
  }
}
