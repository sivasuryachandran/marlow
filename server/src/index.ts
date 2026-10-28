import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import { knowledgeList, type IntentRequest } from "@marlow/game";
import { MetaStt } from "./adapters/stt";
import { MuseImage } from "./adapters/image";
import { makeIntent } from "./adapters/intent";
import { NotConfigured } from "./adapters/errors";
import { buildCaseFile } from "./casefile";
import { loadConfig } from "./config";
import { replayRows } from "./replay";
import level from "../../data/level.json" with { type: "json" };

const cfg = loadConfig();
const intent = makeIntent(cfg);
const stt = new MetaStt(cfg);
const app = new Hono();
mkdirSync(cfg.runsDir, { recursive: true });
const safeId = (s: string) => /^[\w.-]{1,80}$/.test(s);

app.get("/api/health", c => c.json({ intent: cfg.intentBackend, stt: !!cfg.modelApiKey, image: false, timeoutMs: cfg.timeoutMs, keys: { meta: !!cfg.modelApiKey, baseten: !!cfg.basetenKey } }));

app.post("/api/intent", async c => {
  const req = (await c.req.json()) as IntentRequest;
  try { return c.json(await intent.infer(req)); }
  catch (e) { return c.json({ error: String(e), notConfigured: e instanceof NotConfigured }, e instanceof NotConfigured ? 501 : 502); }
});

app.post("/api/warmup", async c => {
  const t0 = performance.now();
  try { await intent.warmup?.(); } catch { /* best effort */ }
  return c.json({ ok: true, backend: intent.name, ms: Math.round(performance.now() - t0) });
});

app.post("/api/transcribe", async c => {
  try { return c.json(await stt.transcribe(await c.req.arrayBuffer(), c.req.header("content-type") ?? "audio/webm")); }
  catch (e) { return c.json({ error: String(e) }, e instanceof NotConfigured ? 501 : 502); }
});

app.post("/api/log", async c => {
  const { runId, row } = (await c.req.json()) as { runId: string; row: Record<string, unknown> };
  if (!safeId(runId)) return c.json({ error: "bad runId" }, 400);
  appendFileSync(`${cfg.runsDir}/${runId}.jsonl`, JSON.stringify(row) + "\n");
  return c.json({ ok: true });
});

app.post("/api/casefile/:runId", async c => {
  const runId = c.req.param("runId");
  const file = `${cfg.runsDir}/${runId}.jsonl`;
  if (!safeId(runId) || !existsSync(file)) return c.json({ error: "unknown run" }, 404);
  const rows = readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l));
  if (!replayRows(rows, level).ok) return c.json({ error: "run log failed replay check" }, 409);
  const out = await buildCaseFile({ runId, rows, level, outDir: cfg.casefilesDir, image: new MuseImage(cfg), verify: cfg.verifyArt });
  return c.json({ url: `/casefiles/${runId}/index.html`, panels: out.panels.length, sources: [...new Set(out.panels.map(p => p.source))] });
});

// Dev tool: tools/record-commands page uploads one 16 kHz WAV per eval command.
const evalDir = (set?: string) => (set === "heldout" ? "data/eval/heldout-audio" : "data/eval/audio");
app.get("/api/eval-audio", c => { const d = evalDir(c.req.query("set")); return c.json(existsSync(d) ? readdirSync(d).filter(f => /^[ch]\d{2}\.wav$/.test(f)).map(f => f.slice(0, 3)) : []); });
app.post("/api/eval-audio/:id", async c => {
  const id = c.req.param("id");
  if (!/^[ch]\d{2}$/.test(id)) return c.json({ error: "bad id" }, 400);
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length < 100 || buf.length > 4_000_000 || buf.toString("ascii", 0, 4) !== "RIFF") return c.json({ error: "expected a RIFF/WAV body under 4 MB" }, 400);
  const dir = evalDir(c.req.query("set"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${id}.wav`, buf);
  return c.json({ ok: true, bytes: buf.length });
});

app.use("/casefiles/*", serveStatic({ root: "./" }));
void knowledgeList;
serve({ fetch: app.fetch, port: cfg.port }, i => console.log(`MARLOW server on :${i.port} (intent=${cfg.intentBackend})`));
