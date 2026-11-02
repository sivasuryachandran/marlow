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
import { SeerRooms } from "./seer";
import { checkIntentRequest, limit } from "./limits";
import { CASES } from "./mission-author";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { networkInterfaces } from "node:os";
import level from "../../data/level.json" with { type: "json" };

const cfg = loadConfig();
const intent = makeIntent(cfg);
const stt = new MetaStt(cfg);
const app = new Hono();
mkdirSync(cfg.runsDir, { recursive: true });
const safeId = (s: string) => /^[\w.-]{1,80}$/.test(s);

// Damage control for anything that costs credits or writes files (see limits.ts). Generous for one person playing.
const MIN = 60_000, HOUR = 3_600_000;
app.use("/api/intent", limit({ max: 120, windowMs: MIN, maxBytes: 64 * 1024 }));
app.use("/api/warmup", limit({ max: 10, windowMs: MIN, maxBytes: 4 * 1024 }));
app.use("/api/transcribe", limit({ max: 60, windowMs: MIN, maxBytes: 3 * 1024 * 1024 })); // 30 s of 16 kHz mono WAV is about 1 MB
app.use("/api/log", limit({ max: 600, windowMs: MIN, maxBytes: 64 * 1024 }));
app.use("/api/casefile/*", limit({ max: 6, windowMs: HOUR, maxBytes: 1024 }));
app.use("/api/missions/generate", limit({ max: 4, windowMs: HOUR, maxBytes: 4 * 1024 }));

app.get("/api/health", c => c.json({ intent: cfg.intentBackend, stt: !!cfg.modelApiKey, image: false, timeoutMs: cfg.timeoutMs, keys: { meta: !!cfg.modelApiKey, baseten: !!cfg.basetenKey } }));

app.post("/api/intent", async c => {
  const req = (await c.req.json().catch(() => null)) as IntentRequest | null;
  const bad = checkIntentRequest(req); if (bad) return c.json({ error: bad }, 400); // never forward what our game could not have sent
  try { return c.json(await intent.infer(req!)); }
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
  const body = (await c.req.json().catch(() => null)) as { runId?: string; row?: Record<string, unknown> } | null;
  if (!body || typeof body !== "object" || !body.row || typeof body.row !== "object") return c.json({ error: "expected {runId, row}" }, 400);
  const { runId, row } = body as { runId: string; row: Record<string, unknown> };
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
// Mission generator: list the case library; start a generation job (one at a time) and report its progress.
app.get("/api/cases", c => c.json(CASES.map(k => ({ id: k.id, title: k.title, inspiredBy: k.inspiredBy }))));
let running: string | null = null;
app.post("/api/missions/generate", async c => {
  if (!cfg.modelApiKey) return c.text("MODEL_API_KEY is not set on the server", 400);
  const job = Date.now().toString(36);
  if (running && existsSync(`assets/missions/_jobs/${running}.json`) && !JSON.parse(readFileSync(`assets/missions/_jobs/${running}.json`, "utf8")).done) return c.text("A case is already being written; wait for it to finish", 409);
  const b = (await c.req.json().catch(() => ({}))) as { caseId?: string; theme?: string };
  const args = ["--env-file=.env", "--import", "tsx", "tools/generate-mission.ts", `--job=${job}`, "--voices", "--art"];
  if (b.caseId && CASES.some(k => k.id === b.caseId)) args.push(`--case=${b.caseId}`);
  else if (b.theme && b.theme.length <= 120) args.push(`--theme=${b.theme.replace(/[^\w .,'-]/g, "")}`);
  else return c.text("Choose a case or describe one (120 characters at most)", 400);
  mkdirSync("assets/missions/_jobs", { recursive: true });
  writeFileSync(`assets/missions/_jobs/${job}.json`, JSON.stringify({ log: ["Queued."] }));
  spawn(process.execPath, args, { stdio: "ignore", detached: true }).unref();
  running = job;
  return c.json({ job });
});
app.get("/api/missions/job/:id", c => {
  const f = `assets/missions/_jobs/${c.req.param("id").replace(/[^a-z0-9]/g, "")}.json`;
  return existsSync(f) ? c.json(JSON.parse(readFileSync(f, "utf8"))) : c.json({ log: ["Unknown job"], done: true, ok: false }, 404);
});

// Seer link: addresses a friend on the same network could use (only works if the web app is started with --host).
app.get("/api/lan", c => c.json(Object.values(networkInterfaces()).flat().filter(n => n && n.family === "IPv4" && !n.internal).map(n => n!.address)));

const server = serve({ fetch: app.fetch, port: cfg.port }, i => console.log(`MARLOW server on :${i.port} (intent=${cfg.intentBackend})`));

// Seer link relay: ws://host/ws/seer?room=ABCD&role=host|seer
const rooms = new SeerRooms();
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const u = new URL(req.url ?? "/", "http://localhost");
  if (u.pathname !== "/ws/seer") { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    const code = u.searchParams.get("room") ?? "", role = u.searchParams.get("role") ?? "";
    if (!rooms.join(code, role, ws)) { ws.close(4001, "bad room, role, or room full"); return; }
    ws.on("message", d => rooms.message(code, ws, d.toString()));
    ws.on("close", () => rooms.leave(code, ws));
  });
});
setInterval(() => rooms.sweep(), 10 * 60 * 1000).unref();
