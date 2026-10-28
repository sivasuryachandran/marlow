import { MockIntent, type IntentAdapter, type IntentRequest, type IntentResponse } from "@marlow/game";
import type { Config } from "../config";
import { NotConfigured } from "./errors";

/**
 * Muse Spark via the Meta Model API.
 * Known from https://dev.meta.ai/docs/: base https://api.meta.ai/v1, `Authorization: Bearer $MODEL_API_KEY`,
 * Chat Completions is OpenAI-compatible, structured output exists as a capability.
 * NOT yet read from the docs, so deliberately not implemented:
 *   TODO(docs): exact Chat Completions path + model id for Muse Spark
 *   TODO(docs): the documented low reasoning-effort setting for Chat Completions
 *   TODO(docs): schema-constrained output parameter (use INTENT_JSON_SCHEMA from @marlow/game)
 * Fill in `buildRequest`, nothing else needs to change.
 */
export class MetaSparkIntent implements IntentAdapter {
  name = "meta-spark";
  constructor(private cfg: Config) {}
  buildRequest(_req: IntentRequest): { path: string; body: unknown } {
    throw new NotConfigured("Meta Muse Spark request shape (see TODO(docs) in server/src/adapters/intent.ts)");
  }
  async infer(req: IntentRequest): Promise<IntentResponse> {
    if (!this.cfg.modelApiKey) throw new NotConfigured("MODEL_API_KEY not set");
    const { path, body } = this.buildRequest(req);
    const res = await fetch(this.cfg.base + path, {
      method: "POST", headers: { Authorization: `Bearer ${this.cfg.modelApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Spark HTTP ${res.status}`);
    return { turnId: req.turnId, reply: this.parseReply(await res.json()) };
  }
  parseReply(_json: unknown): unknown { throw new NotConfigured("Spark response parsing (TODO(docs))"); }
}

/** Muse Spark Open on Baseten (`meta-models/muse-spark-open-1026`). TODO(docs): read the Baseten model page for URL, auth and params. */
export class BasetenSparkOpenIntent implements IntentAdapter {
  name = "baseten-spark-open";
  constructor(private cfg: Config) {}
  async infer(_req: IntentRequest): Promise<IntentResponse> {
    if (!this.cfg.basetenKey) throw new NotConfigured("BASETEN_API_KEY not set");
    throw new NotConfigured("Baseten request shape for meta-models/muse-spark-open-1026 (TODO(docs))");
  }
}

export function makeIntent(cfg: Config, which = cfg.intentBackend): IntentAdapter {
  if (which === "meta") return new MetaSparkIntent(cfg);
  if (which === "baseten") return new BasetenSparkOpenIntent(cfg);
  return new MockIntent();
}
