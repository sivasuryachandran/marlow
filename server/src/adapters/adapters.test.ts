import { describe, it, expect } from "vitest";
import { MetaSparkIntent, BasetenSparkOpenIntent, cleanReply, strictSchema } from "./intent";
import { MetaStt } from "./stt";
import { MuseImage } from "./image";
import { loadConfig } from "../config";
import { NotConfigured } from "./errors";
import { v1 } from "@marlow/game";

const cfg = loadConfig({ MODEL_API_KEY: "k-meta", BASETEN_API_KEY: "k-bt" } as any);
const req = { turnId: 3, transcript: "peek the left door quietly", currentRoom: "hall",
  knowledge: [{ id: "arch_hall_gallery", spokenName: "the gallery arch", type: "door" as const, side: "left" as const }, { id: "hall", spokenName: "the hall", type: "room" as const }] };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function spy(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return json(body, status); }) as unknown as typeof fetch;
  return { f, calls };
}

describe("Meta Muse Spark adapter (shape from dev.meta.ai docs)", () => {
  it("POSTs /chat/completions with bearer auth, reasoning_effort and strict json_schema", async () => {
    const { f, calls } = spy({ choices: [{ message: { content: '{"action":"peek","target":"arch_hall_gallery","stance":"quiet","clarify":null}' } }] });
    const r = await new MetaSparkIntent(cfg, f).infer(req);
    const c = calls[0], body = JSON.parse(c.init.body as string);
    expect(c.url).toBe("https://api.meta.ai/v1/chat/completions");
    expect((c.init.headers as any).Authorization).toBe("Bearer k-meta");
    expect(body).toMatchObject({ model: "muse-spark-1.3", reasoning_effort: "minimal", response_format: { type: "json_schema", json_schema: { strict: true } } });
    expect(body.max_completion_tokens).toBeGreaterThan(500); // reasoning tokens count against the cap
    expect(r).toEqual({ turnId: 3, reply: { action: "peek", target: "arch_hall_gallery", stance: "quiet" } }); // nulls dropped
    expect(v1(r.reply).ok).toBe(true);
  });
  it("sends only Marlow's knowledge to the model", async () => {
    const { f, calls } = spy({ choices: [{ message: { content: '{"action":"wait"}' } }] });
    await new MetaSparkIntent(cfg, f).infer(req);
    const user = JSON.parse(JSON.parse(calls[0].init.body as string).messages[1].content);
    expect(user).toMatchObject({ transcript: req.transcript, currentRoom: "hall" });
    expect(user.knowledge.map((k: any) => k.id)).toEqual(["arch_hall_gallery", "hall"]);
  });
  it("strict schema: every key required, additionalProperties false, target enum limited to known ids", () => {
    const s: any = strictSchema(req);
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(Object.keys(s.properties));
    expect(s.properties.target.enum).toEqual(expect.arrayContaining(["arch_hall_gallery", "door:arch_hall_gallery", "hall", "unknown", null]));
    expect(s.properties.target.enum).not.toContain("door_vault");
  });
  it("empty / non-JSON replies become an unparseable marker (V1 retry), not a crash", async () => {
    for (const content of [null, "not json"]) {
      const { f } = spy({ choices: [{ message: { content } }] });
      const r = await new MetaSparkIntent(cfg, f).infer(req);
      expect(v1(r.reply).ok).toBe(false);
    }
  });
  it("HTTP errors throw; missing key is NotConfigured", async () => {
    await expect(new MetaSparkIntent(cfg, spy({}, 500).f).infer(req)).rejects.toThrow(/HTTP 500/);
    await expect(new MetaSparkIntent(loadConfig({} as any)).infer(req)).rejects.toBeInstanceOf(NotConfigured);
  });
  it("cleanReply drops nulls only", () => expect(cleanReply({ a: 1, b: null, c: undefined })).toEqual({ a: 1 }));
});

describe("Baseten Muse Spark Open adapter", () => {
  it("POSTs OpenAI-style chat completions with the served model id and json_object mode", async () => {
    const { f, calls } = spy({ choices: [{ message: { content: '{"action":"listen"}' } }] });
    const r = await new BasetenSparkOpenIntent(cfg, f).infer(req);
    const body = JSON.parse(calls[0].init.body as string);
    expect(calls[0].url).toBe("https://inference.baseten.co/v1/chat/completions");
    expect((calls[0].init.headers as any).Authorization).toBe("Bearer k-bt");
    expect(body).toMatchObject({ model: "meta-models/muse-spark-open", response_format: { type: "json_object" } });
    expect(r.reply).toEqual({ action: "listen" });
  });
  it("a nested {action:{name}} reply is rejected by V1, never executed", async () => {
    const { f } = spy({ choices: [{ message: { content: '{"action":{"name":"peek","target":"x"}}' } }] });
    expect(v1((await new BasetenSparkOpenIntent(cfg, f).infer(req)).reply).ok).toBe(false);
  });
});

describe("Muse Voice Transcribe adapter", () => {
  it("sends multipart `request` + `audio` parts and reads top-level `transcript`", async () => {
    const { f, calls } = spy({ sessionId: "s", transcript: " Peek the left door. ", audioDurationMs: 900, turns: [] });
    const r = await new MetaStt(cfg, f).transcribe(new Uint8Array([1, 2, 3]).buffer, "audio/wav");
    const form = calls[0].init.body as FormData;
    expect(calls[0].url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(JSON.parse(await (form.get("request") as Blob).text())).toMatchObject({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK" });
    expect((form.get("audio") as Blob).type).toBe("audio/wav");
    expect(r.text).toBe("Peek the left door.");
  });
});

describe("Muse Image adapter", () => {
  it("POSTs /images/generations and decodes data[0].b64_json", async () => {
    const { f, calls } = spy({ data: [{ b64_json: Buffer.from("JPEGBYTES").toString("base64") }] });
    const r = await new MuseImage(cfg, f).render("a rainy hall");
    const body = JSON.parse(calls[0].init.body as string);
    expect(calls[0].url).toBe("https://api.meta.ai/v1/images/generations");
    expect(body).toMatchObject({ model: "muse-image-1.0", n: 1, response_format: "b64_json", output_format: "jpeg", reasoning_strength: "low" });
    expect(Buffer.from(r.data as Uint8Array).toString()).toBe("JPEGBYTES");
    expect(r.source).toBe("muse-image");
  });
});

describe("speech robustness", () => {
  it("Voice Transcribe request carries the game keywords", async () => {
    const { f, calls } = spy({ transcript: "peek" });
    await new MetaStt(cfg, f).transcribe(new Uint8Array([1]).buffer, "audio/wav");
    const req = JSON.parse(await ((calls[0].init.body as FormData).get("request") as Blob).text());
    expect(req.keywords).toEqual(expect.arrayContaining(["peek", "ledger", "gallery"]));
  });
});

describe("default backend", () => {
  it("is Muse Spark when a Meta key exists, the offline mock otherwise, and an explicit choice wins", () => {
    expect(loadConfig({ MODEL_API_KEY: "k" } as any).intentBackend).toBe("meta");
    expect(loadConfig({} as any).intentBackend).toBe("mock");
    expect(loadConfig({ MODEL_API_KEY: "k", INTENT_BACKEND: "baseten" } as any).intentBackend).toBe("baseten");
    expect(loadConfig({ MODEL_API_KEY: "k", INTENT_BACKEND: "mock" } as any).intentBackend).toBe("mock");
  });
  it("warm-up is a tiny throwaway call for both backends", async () => {
    const { f, calls } = spy({ choices: [] });
    await new BasetenSparkOpenIntent(cfg, f).warmup();
    await new MetaSparkIntent(cfg, f).warmup();
    expect(calls.map(c => c.url)).toEqual(["https://inference.baseten.co/v1/chat/completions", "https://api.meta.ai/v1/chat/completions"]);
    expect(JSON.parse(calls[0].init.body as string).max_tokens).toBeLessThanOrEqual(16);
  });
});
