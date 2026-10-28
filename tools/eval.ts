/**
 * V3 regression harness. Usage: npx tsx tools/eval.ts [--backends mock,meta,baseten]
 * Writes metrics.json + metrics.md. Backends that are not configured are reported as SKIP, never faked.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createInitialState, revealRoom, step, validate, candidateActions, Rng } from "../packages/engine/src/index";
import { InMemoryStore, Session, MockIntent, verify, type IntentAdapter } from "../packages/game/src/index";
import type { Action, WorldState } from "../packages/shared/src/index";
import { makeIntent } from "../server/src/adapters/intent";
import { NotConfigured } from "../server/src/adapters/errors";
import { loadConfig } from "../server/src/config";
import { replayRows } from "../server/src/replay";
import { bank, beats, level, pct, quantile, readRuns } from "./lib";

type Expected = Action | { clarify: true } | { refuse: string } | { sayagain: true };
interface Cmd { id: string; saidText: string; audioPath?: string; state: { room: string; carrying?: string }; expected: Record<string, any> }

const FACING: Record<string, WorldState["marlow"]["facing"]> = { lobby: "north", hall: "north", office: "east", gallery: "west", stairwell: "north" };
const PREV: Record<string, string> = { hall: "lobby", office: "hall", gallery: "hall", stairwell: "hall" };

function presetState(p: Cmd["state"]): WorldState {
  const s = createInitialState(level, 1);
  s.guard.step = 0; // stairwell: far from every preset room
  s.marlow.room = p.room; s.marlow.facing = FACING[p.room]; s.marlow.prevRoom = PREV[p.room] ?? null;
  revealRoom(s, p.room, true);
  if (p.carrying) { s.marlow.carrying = p.carrying; s.items.find(i => i.id === p.carrying)!.room = null; }
  return s;
}

function matches(exp: Cmd["expected"], got: { kind: string; action?: Action; lineId?: string; reason?: string }): boolean {
  if (exp.clarify) return got.kind === "clarify";
  if (exp.sayagain) return got.kind === "sayagain";
  if (exp.refuse) return got.kind === "refused" && got.reason === exp.refuse;
  return got.kind === "ok" && got.action?.action === exp.action && ((got.action as any).target ?? undefined) === (exp.target ?? undefined)
    && ((got.action as any).stance ?? undefined) === (exp.stance ?? undefined);
}

async function evalBackend(name: string, adapter: IntentAdapter, cmds: Cmd[]) {
  const results: { id: string; ok: boolean; kind: string; ms: number; said: string; got?: unknown }[] = [];
  let invalidAccepted = 0, clarifies = 0;
  for (const c of cmds) {
    const sess = new Session({ level, bank, beats, intent: adapter, seed: 1, memory: new InMemoryStore(), timeoutMs: 8000 });
    sess.state = presetState(c.state);
    const t0 = performance.now();
    let o;
    try { o = await sess.submit(c.saidText); }
    catch (e) { if (e instanceof NotConfigured) return { name, skipped: String(e.message) }; throw e; }
    const ms = performance.now() - t0;
    if (!o) { results.push({ id: c.id, ok: false, kind: "discarded", ms, said: c.saidText }); continue; }
    const reasonLine = o.lines[0]?.id.replace("marlow.refuse.", "");
    const ok = matches(c.expected, { kind: o.kind, action: o.action, reason: reasonLine });
    if (o.kind === "clarify") clarifies++;
    // an illegal command must never have executed
    if ((c.expected.refuse || c.expected.sayagain) && o.kind === "ok") invalidAccepted++;
    results.push({ id: c.id, ok, kind: o.kind, ms, said: c.saidText, got: o.action ?? reasonLine });
  }
  const ms = results.map(r => r.ms);
  return {
    name, n: results.length, intentAccuracy: pct(results.filter(r => r.ok).length, results.length),
    clarificationRate: pct(clarifies, results.length), invalidAccepted,
    latencyMs: { p50: Math.round((quantile(ms, 0.5) ?? 0) * 100) / 100, p95: Math.round((quantile(ms, 0.95) ?? 0) * 100) / 100 },
    failures: results.filter(r => !r.ok),
  };
}

/** Adversarial replies a misbehaving model could emit; V2 must stop every one before the engine. */
function adversarial() {
  const rng = new Rng(2026);
  const ids = ["lobby", "hall", "office", "gallery", "stairwell", "vault", "door_lobby_hall", "door_hall_office", "arch_hall_gallery", "door_hall_stairwell", "door_secret", "ledger", "case_1", "desk_1", "gold", ""];
  const verbs = ["move", "peek", "take", "listen", "wait", "hide", "exit", "teleport"];
  let sent = 0, executed = 0, executedIllegal = 0;
  for (const room of ["lobby", "hall", "office", "gallery", "stairwell"]) {
    for (let i = 0; i < 400; i++) {
      const s = presetState({ room });
      const reply = rng.int(8) === 0 ? { clarify: { candidates: [ids[rng.int(ids.length)], ids[rng.int(ids.length)]] } }
        : { action: verbs[rng.int(verbs.length)], target: ids[rng.int(ids.length)], ...(rng.int(3) === 0 ? { stance: "quiet" } : {}) };
      sent++;
      const v = verify(s, reply);
      if (v.kind !== "action") continue;
      executed++;
      const known = new Set([...s.knowledge.rooms, ...s.knowledge.doors, ...s.knowledge.props, ...s.knowledge.items]);
      const t = (v.action as any).target as string | undefined;
      if (!validate(s, v.action).ok || step(s, v.action).events[0].type === "refused" || (t && v.action.action !== "move" && !known.has(t))) executedIllegal++;
    }
  }
  return { sent, executed, executedIllegal };
}

function determinism() {
  let runs = 0, ok = 0;
  const say = (a: Action, s: WorldState) => {
    const n = (id: string) => [...s.doors, ...s.items].find(x => x.id === id)?.spokenName ?? id;
    return a.action === "move" ? `${a.stance === "quiet" ? "quietly " : ""}go to ${a.target}` : a.action === "peek" ? `peek ${n(a.target)}` : a.action === "take" ? `take ${n(a.target)}` : a.action;
  };
  return (async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const sess = new Session({ level, bank, beats, intent: new MockIntent(), seed, memory: new InMemoryStore(), runId: `eval-${seed}` });
      sess.start();
      const pick = new Rng(seed * 7);
      for (let i = 0; i < 40 && sess.state.status === "playing"; i++) {
        const cands = candidateActions(sess.state);
        await sess.submit(say(cands[pick.int(cands.length)], sess.state));
      }
      runs++;
      if (replayRows(sess.log, level).ok) ok++;
    }
    const saved = readRuns();
    const results = saved.map(r => replayRows(r.rows, level)).filter(r => !r.stale);
    const savedOk = results.filter(r => r.ok).length;
    return { generatedRuns: runs, generatedIdentical: ok, savedRuns: results.length, savedStale: saved.length - results.length, savedIdentical: savedOk, pct: pct(ok + savedOk, runs + results.length) };
  })();
}

const bi = process.argv.indexOf("--backends");
const want = (process.argv.find(a => a.startsWith("--backends="))?.split("=")[1] ?? (bi >= 0 ? process.argv[bi + 1] : "mock,meta,baseten")).split(",");
const cmds = readFileSync("data/eval/commands.jsonl", "utf8").trim().split("\n").map(l => JSON.parse(l) as Cmd);
const cfg = loadConfig();
const backends: any[] = [];
for (const b of want) backends.push(await evalBackend(b === "meta" ? "meta-spark" : b === "baseten" ? "baseten-spark-open" : "mock", makeIntent(cfg, b as any), cmds));
const adv = adversarial();
const det = await determinism();
const hasAudio = cmds.filter(c => c.audioPath).length;
const metrics = { commands: cmds.length, transcription: hasAudio ? "TODO" : "n/a (no recorded audio / no STT access yet)", backends, adversarialV2: adv, determinism: det };
writeFileSync("metrics.json", JSON.stringify(metrics, null, 2));

const row = (f: (b: any) => string) => backends.map(f).join(" | ");
const md = `# MARLOW metrics

Generated by \`npx tsx tools/eval.ts\` on ${new Date().toISOString().slice(0, 10)}. ${cmds.length} commands in data/eval/commands.jsonl.

| Metric | ${backends.map(b => b.name).join(" | ")} |
|---|${backends.map(() => "---").join("|")}|
| Intent accuracy (correct transcript, target ≥ 90%) | ${row(b => ("skipped" in b ? `SKIP: ${b.skipped}` : `${b.intentAccuracy}%`))} |
| Clarification rate | ${row(b => ("skipped" in b ? "—" : `${b.clarificationRate}%`))} |
| Invalid actions accepted (must be 0) | ${row(b => ("skipped" in b ? "—" : String(b.invalidAccepted)))} |
| Latency p50 / p95, release → result (ms, adapter + pipeline) | ${row(b => ("skipped" in b ? "—" : `${b.latencyMs.p50} / ${b.latencyMs.p95}`))} |

Transcription error rate: ${metrics.transcription}.

**Adversarial V2 check:** ${adv.sent} hallucinated/illegal model replies across 5 rooms; ${adv.executed} passed V2 as legal actions; **${adv.executedIllegal} illegal actions reached the engine** (must be 0).

**Replay determinism:** ${det.generatedIdentical}/${det.generatedRuns} generated seeded runs and ${det.savedIdentical}/${det.savedRuns} saved runs (${det.savedStale} stale, recorded on an older level, skipped) replay to identical event logs (${det.pct}%).

Notes: the mock backend is a deterministic keyword NLU written alongside the cases, so its 100% only shows the pipeline is wired. The meta-spark (muse-spark-1.3, reasoning_effort minimal, strict JSON schema) and baseten-spark-open (meta-models/muse-spark-open, JSON mode) rows are real calls. Their latency is end-to-end including network and reasoning tokens; the local parser answers wait/listen/hide/exit/go-to-room orders without any call. A "miss" is any difference from the expected outcome, including a different refusal reason; no miss executed an invalid action.
${backends.filter((b: any) => b.failures?.length).map((b: any) => `\n### ${b.name} misses\n${b.failures.map((f: any) => `- ${f.id} "${f.said}" → ${JSON.stringify(f.got)} (${f.kind})`).join("\n")}`).join("\n")}
`;
writeFileSync("metrics.md", md);
console.log(md);
process.exit(adv.executedIllegal || det.pct !== 100 || backends.some((b: any) => b.invalidAccepted) ? 1 : 0);
