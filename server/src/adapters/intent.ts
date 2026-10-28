import { INTENT_JSON_SCHEMA, INTENT_SYSTEM_PROMPT, MockIntent, type IntentAdapter, type IntentRequest, type IntentResponse } from "@marlow/game";
import type { Config } from "../config";
import { NotConfigured } from "./errors";

/** Drop null/undefined keys so a model's `"stance": null` can't fail the exact-one-shape check (V1 still runs after this). */
export function cleanReply(x: unknown): unknown {
  if (!x || typeof x !== "object") return x;
  return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * Strict per-request schema (Meta: strict needs additionalProperties:false and every key required, so optional = nullable).
 * `target` is an enum of ids Marlow knows (plus door:<id> for moves and "unknown"), so the model cannot emit stray text.
 * Ids still pass V2 afterwards; the enum is a decoding aid, not the safety check.
 */
export function strictSchema(req: IntentRequest) {
  const ids = req.knowledge.map(k => k.id);
  const targets = [...ids, ...req.knowledge.filter(k => k.type === "door").map(k => `door:${k.id}`), "unknown"];
  const nullable = (e: unknown[]) => ({ type: ["string", "null"], enum: [...e, null] });
  return {
    type: "object", additionalProperties: false, required: ["action", "target", "stance", "clarify"],
    properties: {
      action: nullable(["move", "peek", "listen", "wait", "hide", "take", "exit"]),
      target: nullable(targets),
      stance: nullable(["normal", "quiet"]),
      clarify: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["candidates"],
        properties: { candidates: { type: "array", minItems: 2, items: { type: "string", enum: ids } } } }] },
    },
  };
}

function userMessage(req: IntentRequest) {
  return JSON.stringify({ transcript: req.transcript, currentRoom: req.currentRoom, knowledge: req.knowledge });
}

/**
 * Muse Spark via the Meta Model API (https://dev.meta.ai/docs):
 * POST {base}/chat/completions, Bearer MODEL_API_KEY, model `muse-spark-1.3`, top-level `reasoning_effort`
 * ("minimal" is the lowest Spark accepts; "low" recommended for direct answers), `response_format` json_schema,
 * reply text at choices[0].message.content.
 */
export class MetaSparkIntent implements IntentAdapter {
  name = "meta-spark";
  constructor(private cfg: Config, private fetchImpl: typeof fetch = fetch) {}
  buildRequest(req: IntentRequest) {
    return {
      path: "/chat/completions",
      body: {
        model: process.env.SPARK_MODEL ?? "muse-spark-1.3",
        reasoning_effort: process.env.SPARK_REASONING ?? "minimal",
        max_completion_tokens: Number(process.env.SPARK_MAX_TOKENS ?? 1200),
        messages: [{ role: "system", content: INTENT_SYSTEM_PROMPT }, { role: "user", content: userMessage(req) }],
        response_format: { type: "json_schema", json_schema: { name: "marlow_intent", strict: true, schema: process.env.SPARK_STRICT === "0" ? INTENT_JSON_SCHEMA : strictSchema(req) } },
      },
    };
  }
  parseReply(json: any): unknown {
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { __unparseable: true }; // reasoning ate the token budget: V1 retry, then "Say again"
    try { return cleanReply(JSON.parse(content)); } catch { return { __unparseable: true }; } // V1 -> retry -> "Say again"
  }
  async infer(req: IntentRequest): Promise<IntentResponse> {
    if (!this.cfg.modelApiKey) throw new NotConfigured("MODEL_API_KEY not set");
    const { path, body } = this.buildRequest(req);
    const res = await this.fetchImpl(this.cfg.base + path, {
      method: "POST", headers: { Authorization: `Bearer ${this.cfg.modelApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Spark HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { turnId: req.turnId, reply: this.parseReply(await res.json()) };
  }
}

/**
 * Muse Spark Open on Baseten Model APIs: OpenAI-compatible POST https://inference.baseten.co/v1/chat/completions,
 * `Authorization: Bearer <BASETEN_API_KEY>`. Verified against /v1/models: the served id is `meta-models/muse-spark-open`
 * (the brief's `...-1026` is rejected). Features: json_mode (no json_schema), so we send response_format json_object and
 * rely on the prompt + V1/V2 for shape and legality.
 */
export class BasetenSparkOpenIntent implements IntentAdapter {
  name = "baseten-spark-open";
  constructor(private cfg: Config, private fetchImpl: typeof fetch = fetch) {}
  async infer(req: IntentRequest): Promise<IntentResponse> {
    if (!this.cfg.basetenKey) throw new NotConfigured("BASETEN_API_KEY not set");
    const res = await this.fetchImpl("https://inference.baseten.co/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${this.cfg.basetenKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.BASETEN_MODEL ?? "meta-models/muse-spark-open",
        max_tokens: Number(process.env.SPARK_MAX_TOKENS ?? 1200),
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: INTENT_SYSTEM_PROMPT }, { role: "user", content: userMessage(req) }],
      }),
    });
    if (!res.ok) throw new Error(`Baseten HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const content = ((await res.json()) as any)?.choices?.[0]?.message?.content;
    let reply: unknown = { __unparseable: true };
    if (typeof content === "string") { try { reply = cleanReply(JSON.parse(content)); } catch { /* V1 retry */ } }
    return { turnId: req.turnId, reply };
  }
}

export function makeIntent(cfg: Config, which = cfg.intentBackend): IntentAdapter {
  if (which === "meta") return new MetaSparkIntent(cfg);
  if (which === "baseten") return new BasetenSparkOpenIntent(cfg);
  return new MockIntent();
}
