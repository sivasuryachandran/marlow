import type { Config } from "../config";
import { NotConfigured } from "./errors";

export interface ImageResult { ext: "svg" | "png" | "jpg"; data: string | Uint8Array; source: "muse-image" | "placeholder" }
export interface ImageAdapter { name: string; render(prompt: string, key: string): Promise<ImageResult> }

/** TODO(docs): Muse Image request shape (path, params, size, response format) is unread; falls back to placeholder frames. */
export class MuseImage implements ImageAdapter {
  name = "muse-image";
  constructor(private cfg: Config) {}
  async render(): Promise<ImageResult> {
    if (!this.cfg.modelApiKey) throw new NotConfigured("MODEL_API_KEY not set");
    throw new NotConfigured("Muse Image request shape (TODO(docs))");
  }
}

/** TODO(docs): SAM 3.1 + Spark vision check that panel shows key props; enabled by VERIFY_ART=1. */
export async function verifyPanel(_image: ImageResult, _mustShow: string[]): Promise<{ ok: boolean; skipped: boolean; note: string }> {
  return { ok: true, skipped: true, note: "VERIFY_ART: SAM 3.1 + Spark verification not wired (TODO(docs))" };
}
