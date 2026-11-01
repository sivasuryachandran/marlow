/**
 * V3 regression harness. Usage: npx tsx tools/eval.ts [--backends mock,meta,baseten]
 * Writes metrics.json + metrics.md. Backends that are not configured are reported as SKIP, never faked.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInitialState, revealRoom, step, validate, candidateActions, Rng } from "../packages/engine/src/index";
import { InMemoryStore, Session, MockIntent, verify, type IntentAdapter } from "../packages/game/src/index";
import type { Action, WorldState } from "../packages/shared/src/index";
import { makeIntent } from "../server/src/adapters/intent";
import { NotConfigured } from "../server/src/adapters/errors";
import { MetaStt } from "../server/src/adapters/stt";
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
  if (process.env.EVAL_FULL_KNOWLEDGE === "1") for (const r of s.rooms) if (!r.offstage) revealRoom(s, r.id, true); // late-game prompt size
  if (p.carrying) { s.marlow.carrying = p.carrying; s.items.find(i => i.id === p.carrying)!.room = null; }
  return s;
}

function matches(exp: Cmd["expected"], got: { kind: string; action?: Action; lineId?: string; reason?: string }): boolean {
  if (exp.clarify) return got.kind === "clarify";
  if (exp.sayagain) return got.kind === "sayagain";
  if (exp.refuse) return got.kind === "refused" && got.reason === exp.refuse;
  return got.kind === "ok" && got.action?.action === exp.action && ((got.action as any).target ?? undefined) === (exp.target ?? undefined)
    && (((got.action as any).stance ?? "normal") === (exp.stance ?? "normal")); // "normal" is the default stance
}

async function evalBackend(name: string, adapter: IntentAdapter, cmds: Cmd[]) {
  const results: { id: string; ok: boolean; kind: string; ms: number; said: string; got?: unknown; wrong?: boolean }[] = [];
  let invalidAccepted = 0, clarifies = 0, wrongTarget = 0, timeouts = 0;
  let warmupMs: number | null = null;
  if (process.env.EVAL_WARMUP === "1" && adapter.warmup) { const w0 = performance.now(); await adapter.warmup(); warmupMs = Math.round(performance.now() - w0); }
  for (const c of cmds) {
    const sess = new Session({ level, bank, beats, intent: adapter, seed: 1, memory: new InMemoryStore(), timeoutMs: 8000, knowledgeScope: (process.env.EVAL_SCOPE as "all" | "near" | undefined) ?? "all" });
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
    if (o.kind === "timeout") timeouts++;
    // an order that was meant to be refused (or was gibberish) must not have executed; with real speech this can be a legal action triggered by a mishearing
    if ((c.expected.refuse || c.expected.sayagain) && o.kind === "ok") invalidAccepted++;
    // Wrong-target: an executed action aimed at something other than what the order named (e.g. "vault door" -> a real door).
    const tgt = (o.action as { target?: string } | undefined)?.target;
    const wrong = o.kind === "ok" && tgt !== undefined && !(c.expected.action && c.expected.target === tgt);
    if (wrong) wrongTarget++;
    results.push({ id: c.id, ok, kind: o.kind, ms, said: c.saidText, got: o.action ?? reasonLine, wrong });
  }
  const ms = results.map(r => r.ms);
  return {
    name, n: results.length, intentAccuracy: pct(results.filter(r => r.ok).length, results.length),
    clarificationRate: pct(clarifies, results.length), invalidAccepted, timeouts, warmupMs, wrongTarget, wrongTargetCases: results.filter(r => r.wrong).map(r => `${r.id} "${r.said}" -> ${JSON.stringify(r.got)}`),
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
      const v = verify(s, reply, "x");
      if (v.kind !== "action") continue;
      executed++;
      const known = new Set([...s.knowledge.rooms, ...s.knowledge.doors, ...s.knowledge.props, ...s.knowledge.items]);
      const t = (v.action as any).target as string | undefined;
      if (!validate(s, v.action).ok || step(s, v.action).events[0].type === "refused" || (t && v.action.action !== "move" && !known.has(t))) executedIllegal++;
    }
  }
  return { sent, executed, executedIllegal };
}

/**
 * Wrong-target stress: for every verb, every phrase a player might say (names, aliases, side words, invented nouns) and EVERY
 * possible target id, a model that claims the phrase names that target must be stopped unless the phrase really names it.
 * The oracle reads names straight from level.json, independently of the game's matcher.
 */
function targetStress() {
  const sing = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  const toks = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(w => w && !["the", "a"].includes(w)).map(sing);
  const GEN = new Set(["door", "arch", "room"]);
  const lv: any = level;
  const entity = (id: string) => lv.rooms.find((x: any) => x.id === id) ?? lv.doors.find((x: any) => x.id === id) ?? lv.items.find((x: any) => x.id === id);
  const tk = (id: string) => { const e = entity(id); return new Set<string>(e ? [e.spokenName, ...e.aliases].flatMap(toks).filter((w: string) => !GEN.has(w)) : []); };
  const doorBetween = (a: string, b: string) => lv.doors.find((d: any) => d.between.includes(a) && d.between.includes(b));
  /** Does `phrase` really name `target` when Marlow is in `here` and says `verb`? Independent of the game's matcher: reads level.json only. */
  const named = (verb: string, here: string, target: string, phrase: string): boolean | null => {
    const words = toks(phrase);
    const content = words.filter(w => !GEN.has(w) && !["left", "right", "ahead", "behind", "front", "forward", "back", "straight"].includes(w));
    if (!content.length) return null; // generic reference: judged separately
    const hasDoorWord = words.some(w => w === "door" || w === "arch");
    let allowed = new Set<string>();
    if (verb === "take") { if (words.some(w => GEN.has(w))) return false; allowed = tk(target); }
    else if (verb === "peek") {
      const d = entity(target); if (!d || !lv.doors.includes(d) || !d.between.includes(here)) return false;
      allowed = new Set([...tk(target), ...tk(d.between.find((r: string) => r !== here))]);
    } else {
      const dest = target.startsWith("door:") ? lv.doors.find((d: any) => d.id === target.slice(5))?.between.find((r: string) => r !== here) : target;
      const d = dest ? doorBetween(here, dest) : null; if (!dest || !d || !lv.rooms.find((r: any) => r.id === dest)) return false;
      allowed = new Set([...tk(dest), ...[...tk(d.id)].filter(w => hasDoorWord || !tk(here).has(w))]);
    }
    return content.every(w => allowed.has(w));
  };
  const nouns = ["out", "outside", "up", "down", "away", "inside", "head out", "go out", "office", "study", "ledger", "book", "logbook", "lobby", "entrance", "hall", "hallway", "gallery", "archway", "stairwell", "stairs", "vault", "safe", "wall", "window", "kitchen", "basement", "roof", "elevator", "gold", "left door", "right door", "door", "left", "ahead door", "behind door"];
  const targets = ["lobby", "hall", "office", "gallery", "stairwell", "upstairs", "door_lobby_hall", "arch_hall_gallery", "door_hall_office", "door_hall_stairwell", "stairs_up", "ledger", "case_1", "desk_1", "unknown", "door:door_hall_office", "door:arch_hall_gallery", "door:door_lobby_hall", "door:door_hall_stairwell"];
  let sent = 0, executed = 0, wrong = 0, offTranscript = 0;
  const examples: string[] = [];
  for (const room of ["lobby", "hall", "office", "gallery", "stairwell"]) {
    for (const full of [false, true]) {
      const s = presetState({ room });
      if (full) for (const r of s.rooms) if (!r.offstage) revealRoom(s, r.id, true);
      for (const verb of ["move", "peek", "take"] as const) for (const noun of nouns) for (const tg of targets) {
        for (const claimed of [noun, "office door"]) { // the second claims a phrase that may not be in the order at all
          sent++;
          const v = verify(s, { action: verb, target: tg, matched: claimed }, `${verb} the ${noun}`);
          if (v.kind !== "action") continue;
          executed++;
          if (!`${verb} the ${noun}`.includes(claimed)) { offTranscript++; continue; }
          const t = (v.action as any).target as string;
          const ok = named(verb, room, tg, claimed);
          const doorsHere = s.doors.filter(d => d.between.includes(s.marlow.room) && s.knowledge.doors.includes(d.id));
          const generic = ok === null ? (verb === "take" ? false : doorsHere.length === 1 || /left|right|ahead|behind/.test(claimed)) : false;
          if (ok === false || (ok === null && !generic)) { wrong++; if (examples.length < 12) examples.push(`${room}${full ? "+" : ""} ${verb} "${claimed}" target ${tg} -> ${JSON.stringify(v.action)}`); }
          void t;
        }
      }
    }
  }
  return { sent, executed, wrongTargetExecuted: wrong, quoteNotInOrderExecuted: offTranscript, examples };
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

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
function editDistance(a: string[], b: string[]) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const bi = process.argv.indexOf("--backends");
const want = (process.argv.find(a => a.startsWith("--backends="))?.split("=")[1] ?? (bi >= 0 ? process.argv[bi + 1] : "mock,meta,baseten")).split(",");
const HELD = process.env.EVAL_SET === "heldout";
const cmds = readFileSync(HELD ? "data/eval/heldout.jsonl" : "data/eval/commands.jsonl", "utf8").trim().split("\n").map(l => JSON.parse(l) as Cmd);
const cfg = loadConfig();
if (process.env.EVAL_DRYRUN === "1") {
  // Upper bound on paid calls; the local parser answers some orders without a model call. Makes no requests.
  const real = want.filter(b => b !== "mock").length;
  const clips = cmds.filter(c => existsSync(`data/eval/${HELD ? "heldout-audio" : "audio"}/${c.id}.wav`)).length;
  const audio = process.env.MODEL_API_KEY && process.env.EVAL_SKIP_AUDIO !== "1" ? clips : 0;
  const maxTok = Number(process.env.SPARK_MAX_TOKENS ?? 1200);
  console.log(`DRY RUN (no requests sent): ${cmds.length} commands, backends ${want.join(",")}`);
  console.log(`  intent calls  <= ${real * cmds.length} typed + ${real * audio} from speech = ${real * (cmds.length + audio)}`);
  console.log(`  transcribe calls = ${audio}`);
  console.log(`  output tokens <= ${real * (cmds.length + audio) * maxTok} worst case at SPARK_MAX_TOKENS=${maxTok} (typical use is ~1/3 of that)`);
  process.exit(0);
}
const backends: any[] = [];
for (const b of want) backends.push(await evalBackend(b === "meta" ? "meta-spark" : b === "baseten" ? "baseten-spark-open" : "mock", makeIntent(cfg, b as any), cmds));
const adv = adversarial();
const stress = targetStress();
const det = await determinism();
// Real speech: every data/eval/audio/<id>.wav goes through Muse Voice Transcribe; intent is then scored on what was HEARD.
const clip = (id: string) => `data/eval/${HELD ? "heldout-audio" : "audio"}/${id}.wav`;
const spoken = cmds.filter(c => existsSync(clip(c.id)));
let transcription: any = "n/a (no recordings: run the recorder, see README)";
const e2e: any[] = [];
if (spoken.length && process.env.MODEL_API_KEY && process.env.EVAL_SKIP_AUDIO !== "1") {
  const stt = new MetaStt(cfg), heard: Cmd[] = [], ms: number[] = [], mis: string[] = [];
  let edits = 0, refWords = 0;
  for (const c of spoken) {
    const buf = readFileSync(clip(c.id)), t0 = performance.now();
    const { text } = await stt.transcribe(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "audio/wav");
    ms.push(performance.now() - t0);
    const e = editDistance(words(c.saidText), words(text));
    edits += e; refWords += words(c.saidText).length;
    if (e) mis.push(`${c.id} said "${c.saidText}" heard "${text}"`);
    heard.push({ ...c, saidText: text });
  }
  transcription = { clips: spoken.length, wordErrorRate: pct(edits, refWords), clipsWithAnError: mis.length, sttLatencyMs: { p50: Math.round(quantile(ms, 0.5) ?? 0), p95: Math.round(quantile(ms, 0.95) ?? 0) }, errors: mis };
  for (const b of want) e2e.push(await evalBackend(b === "meta" ? "meta-spark" : b === "baseten" ? "baseten-spark-open" : "mock", makeIntent(cfg, b as any), heard));
}
const metrics = { commands: cmds.length, transcription, endToEndFromSpeech: e2e, backends, adversarialV2: adv, wrongTargetStress: stress, determinism: det };
const suffix = `${process.env.EVAL_TAG ? "." + process.env.EVAL_TAG : ""}${HELD ? ".heldout" : ""}${process.env.EVAL_FULL_KNOWLEDGE === "1" ? ".full" : ""}${process.env.EVAL_SCOPE === "near" ? ".near" : ""}`;
writeFileSync(`metrics${suffix}.json`, JSON.stringify(metrics, null, 2));

const row = (f: (b: any) => string) => backends.map(f).join(" | ");
const md = `# MARLOW metrics${HELD ? " (HELD-OUT set)" : ""}

${HELD ? "> **Held-out:** these commands were written once and frozen before this run. No prompt, parser, keyword or rule was tuned on them. Report them as-is.\n\n" : ""}Generated by \`npx tsx tools/eval.ts\` on ${new Date().toISOString().slice(0, 10)}. ${cmds.length} commands in ${HELD ? "data/eval/heldout.jsonl" : "data/eval/commands.jsonl"}.

| Metric | ${backends.map(b => b.name).join(" | ")} |
|---|${backends.map(() => "---").join("|")}|
| Intent accuracy (correct transcript, target ≥ 90%) | ${row(b => ("skipped" in b ? `SKIP: ${b.skipped}` : `${b.intentAccuracy}%`))} |
| Clarification rate | ${row(b => ("skipped" in b ? "—" : `${b.clarificationRate}%`))} |
| Intended-invalid orders that executed (engine-illegal actions are always 0, see adversarial check) | ${row(b => ("skipped" in b ? "—" : String(b.invalidAccepted)))} |
| Wrong-target actions executed (must be 0) | ${row(b => ("skipped" in b ? "—" : String(b.wrongTarget)))} |
| Timeouts (> 8 s in this harness) | ${row(b => ("skipped" in b ? "—" : `${b.timeouts}${b.warmupMs != null ? ` (warm-up ${b.warmupMs} ms)` : ""}`))} |
| Latency p50 / p95, release → result (ms, adapter + pipeline) | ${row(b => ("skipped" in b ? "—" : `${b.latencyMs.p50} / ${b.latencyMs.p95}`))} |

${typeof transcription === "string" ? `Transcription error rate: ${transcription}.` : `**Transcription (Muse Voice Transcribe, ${transcription.clips} real recordings):** word error rate ${transcription.wordErrorRate}%, ${transcription.clipsWithAnError} clips with at least one error, STT latency p50 / p95 ${transcription.sttLatencyMs.p50} / ${transcription.sttLatencyMs.p95} ms.\n\nEnd-to-end (speech → STT → intent → V1/V2): ${e2e.map((b: any) => "skipped" in b ? `${b.name} SKIP` : `${b.name} ${b.intentAccuracy}% (${b.invalidAccepted} intended-invalid executed, ${b.wrongTarget} wrong-target)`).join(" · ")}.\n${transcription.errors.map((x: string) => `- ${x}`).join("\n")}`}

**Wrong-target stress (matched-phrase check):** ${stress.sent} model replies (3 verbs × every phrase × every possible target id × 5 rooms, partial and full knowledge); ${stress.executed} executed, **${stress.wrongTargetExecuted} executed against a target the phrase does not name** and **${stress.quoteNotInOrderExecuted} with a quote that is not in the order** (both must be 0).

**Adversarial V2 check:** ${adv.sent} hallucinated/illegal model replies across 5 rooms; ${adv.executed} passed V2 as legal actions; **${adv.executedIllegal} illegal actions reached the engine** (must be 0).

**Replay determinism:** ${det.generatedIdentical}/${det.generatedRuns} generated seeded runs and ${det.savedIdentical}/${det.savedRuns} saved runs (${det.savedStale} stale, recorded on an older level, skipped) replay to identical event logs (${det.pct}%).

Notes: the mock backend is a deterministic keyword NLU written alongside the cases, so its 100% only shows the pipeline is wired. The meta-spark (muse-spark-1.3, reasoning_effort minimal, strict JSON schema) and baseten-spark-open (meta-models/muse-spark-open, JSON mode) rows are real calls. Their latency is end-to-end including network and reasoning tokens; the local parser answers wait/listen/hide/exit/go-to-room orders without any call. A "miss" is any difference from the expected outcome, including a different refusal reason; no miss executed an invalid action.
${backends.filter((b: any) => b.failures?.length).map((b: any) => `\n### ${b.name} misses\n${b.failures.map((f: any) => `- ${f.id} "${f.said}" → ${JSON.stringify(f.got)} (${f.kind})`).join("\n")}`).join("\n")}
`;
writeFileSync(`metrics${suffix}.md`, md);
console.log(md);
process.exit(adv.executedIllegal || stress.wrongTargetExecuted || stress.quoteNotInOrderExecuted || det.pct !== 100 || backends.some((b: any) => b.invalidAccepted) ? 1 : 0);
