import type { Config } from "../config";
import { NotConfigured } from "./errors";

export interface ImageResult { ext: "svg" | "png" | "jpg"; data: string | Uint8Array; source: "muse-image" | "placeholder" }
export interface ImageAdapter { name: string; render(prompt: string, key: string): Promise<ImageResult> }

/**
 * Muse Image: POST {base}/images/generations, model `muse-image-1.0`, `n:1`, `size` (aspect ratio only),
 * `response_format:"b64_json"`, `output_format`, `reasoning_strength:"low"` (skips self-refinement; faster). Bytes at data[0].b64_json.
 */
export class MuseImage implements ImageAdapter {
  name = "muse-image";
  constructor(private cfg: Config, private fetchImpl: typeof fetch = fetch) {}
  async render(prompt: string): Promise<ImageResult> {
    if (!this.cfg.modelApiKey) throw new NotConfigured("MODEL_API_KEY not set");
    const res = await this.fetchImpl(`${this.cfg.base}/images/generations`, {
      method: "POST", headers: { Authorization: `Bearer ${this.cfg.modelApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "muse-image-1.0", prompt, n: 1, size: "1792x1024", response_format: "b64_json",
        output_format: "jpeg", reasoning_strength: process.env.IMAGE_REASONING ?? "low",
      }),
    });
    if (!res.ok) throw new Error(`Muse Image HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const b64 = ((await res.json()) as any)?.data?.[0]?.b64_json;
    if (typeof b64 !== "string") throw new Error("Muse Image reply had no data[0].b64_json");
    return { ext: "jpg", data: Uint8Array.from(Buffer.from(b64, "base64")), source: "muse-image" };
  }
}

/** TODO(docs): SAM 3.1 + Spark vision check that panel shows key props; enabled by VERIFY_ART=1. */
export async function verifyPanel(_image: ImageResult, _mustShow: string[]): Promise<{ ok: boolean; skipped: boolean; note: string }> {
  return { ok: true, skipped: true, note: "VERIFY_ART: SAM 3.1 + Spark verification not wired (TODO(docs))" };
}
