/**
 * Mission generator, the model half. Research the case (Wikipedia), ask Muse Spark for a MissionSpec under a strict
 * JSON schema, then hand it to the deterministic builder and every check: level validity, story beats, real-name
 * fictionalization, and the balance simulator. Failures go back to Spark as plain feedback (up to 3 attempts). A
 * mission is only written if everything passes.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildMission, checkText, MISSION_SPEC_SCHEMA, loadBank, type Beat, type Mission, type MissionCase, type MissionSpec } from "@marlow/game";
import { summarize } from "../../tools/sim-core";
import { path } from "@marlow/engine";
import type { WorldState } from "@marlow/shared";
import type { Config } from "./config";
import linesJson from "../../data/lines.json" with { type: "json" };
import beatsJson from "../../data/beats.json" with { type: "json" };
import casesJson from "../../data/cases.json" with { type: "json" };

export const CASES = casesJson as MissionCase[];
const UA = "MARLOW-hackathon-game/0.1 (https://github.com/sivasuryachandran/marlow)";
/** Balance targets, the same ones the built-in level is held to. */
export const TARGETS = { cautiousWin: 60, recklessClean: 10 };
const lastBalance = (level: any) => { const r = summarize(level, ["careful", "reckless"], 300); return { ok: r[0].win >= TARGETS.cautiousWin && r[1].cleanWin <= TARGETS.recklessClean, cautiousWin: r[0].win, recklessClean: r[1].cleanWin }; };

export interface Research { title: string; extract: string; url: string }
/** "Search for materials": the Wikipedia summary of the case, or of the best search hit for a free-text theme. */
export async function research(query: string, fetchImpl: typeof fetch = fetch): Promise<Research | null> {
  const get = (u: string) => fetchImpl(u, { headers: { "User-Agent": UA, Accept: "application/json" } }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  let title = query;
  const direct = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!direct?.extract) {
    const s = await get(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(query)}`);
    title = s?.query?.search?.[0]?.title; if (!title) return null;
  }
  const sum = direct?.extract ? direct : await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  return sum?.extract ? { title: sum.title, extract: String(sum.extract).slice(0, 2500), url: sum.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` } : null;
}

export const AUTHOR_PROMPT = `You write missions for MARLOW, a screenless audio heist game. The player is Owl, a blind former fixer who gives orders by voice; Marlow is the young operative inside the building, the only one who can see, and calls Owl "boss". A deterministic engine decides what happens. You only write a small MISSION SPEC; code builds the level and checks everything.

ADAPT, DO NOT RETELL. Use the real case only as inspiration: invent every person's name, the building's name, the city and every artwork or object. Never use any of the real names you are given. Make it a 1960s-flavored caper with a personal twist: the object Marlow takes hides evidence that implicates the client, who once betrayed Owl.

GRID RULES (strict):
- 4 to 6 rooms. Each room has integer x (-2..2) and y (0..3). North is y+1. No two rooms on the same cell.
- The FIRST room is the entrance and exit, at x=0, y=0.
- Links connect only rooms that are next to each other on the grid (differ by 1 in exactly one of x or y). Every room must be reachable from the entrance. Use kind "door" mostly, "arch" for open archways, "stairs" for stairs.
- NOT a single corridor: one room (a hall or hub) must have three or more links, with side rooms off it, so Marlow can step aside while the guard passes.
- The item is in a room at least two links away from the entrance, off the hub rather than at the end of a long corridor.
- At least two rooms have cover (a piece of furniture to hide behind, e.g. "a velvet sofa"); others use "".
- guardPost.attachTo is a room with a free grid cell beside it, away from the item room; the guard rests there off-stage.
- patrol: the rooms the guard walks through in order. It MUST pass through the rooms between the entrance and the item, so a careless player meets him. Repeat a room to make him linger.
- floor: "marble", "carpet" or "metal". It is also how footsteps sound.

LINES are spoken out loud BY their speaker, in the first person, as dialogue: Marlow talks to Owl ("I see…", "Boss, …"); the client talks to Owl on the phone. NEVER narrate or describe the speaker (wrong: "Marlow opens the box", "Victor whispers…", "A voice says…"). Plain sentences, no stage directions, no quotes inside, max about 30 words each:
- clientIntro: 3 lines from the client on the phone: who they are (first name), the job, and a warning not to look inside the item.
- marlowIntro: Marlow in the entrance room, telling Owl what is ahead.
- describe (per room, except the entrance): what Marlow sees and hears on first entering. One concrete sound detail per room; plant clues about the twist in two of them.
- guardSound: the guard's sound signature. guardFirstHeard: Marlow hearing it the first time and connecting it to the night Owl lost his sight.
- take: Marlow finds the hidden evidence inside the item. clientAfterTake: the client urging them out, nervous.
- clientCheckin: the client asking for an update. outro: Marlow out of the building.
- evidence: the client's own voice on the evidence, giving the order that hurt Owl. evidenceAsk: Marlow asking what to do; it MUST end with "Burn it, or send it?".
- burn / send: Marlow doing each. clientAfterBurn / clientAfterSend: the client's last words in each ending.
LORE: 6 to 10 short facts that MARLOW tells Owl when he asks about a topic, in her own voice, naming the subject (e.g. "Silas is the client, boss. He was your partner once."). Never written as the client or anyone else talking. They are each unlocked "when" the player has learned it: start, guard, item or end. Topics: client, guard, owner, item, history (history = what the real case was, in one honest sentence, saying the game is inspired by it).
Return only the JSON object.`;

/** One Spark call. Strict structured output; "low" reasoning (documented as valid for Spark) since this is authoring. */
export interface Usage { prompt: number; completion: number; reasoning: number }
export async function draftSpec(cfg: Config, kase: MissionCase, notes: Research | null, feedback: string[], fetchImpl: typeof fetch = fetch, usageOut?: Usage): Promise<MissionSpec> {
  const user = [
    `CASE: ${kase.title} (inspired by ${kase.inspiredBy}, ${kase.year}).`,
    `FACTS:\n- ${kase.facts.join("\n- ")}`,
    notes ? `BACKGROUND (${notes.url}):\n${notes.extract}` : "",
    `REAL NAMES YOU MUST NOT USE: ${kase.realNames.join(", ")}.`,
    feedback.length ? `YOUR PREVIOUS SPEC FAILED THESE CHECKS. FIX EVERY ONE:\n- ${feedback.join("\n- ")}` : "",
  ].filter(Boolean).join("\n\n");
  const res = await fetchImpl(`${cfg.base}/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${cfg.modelApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.SPARK_MODEL ?? "muse-spark-1.3", reasoning_effort: process.env.AUTHOR_REASONING ?? "low", max_completion_tokens: Number(process.env.AUTHOR_MAX_TOKENS ?? 9000),
      messages: [{ role: "system", content: AUTHOR_PROMPT }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "marlow_mission", strict: true, schema: MISSION_SPEC_SCHEMA } },
    }),
  });
  if (!res.ok) throw new Error(`Spark HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as any, content = body?.choices?.[0]?.message?.content;
  if (usageOut) { const u = body?.usage ?? {}; usageOut.prompt = u.prompt_tokens ?? 0; usageOut.completion = u.completion_tokens ?? 0; usageOut.reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0; }
  if (typeof content !== "string" || !content.trim()) throw new Error("Spark returned no content (raise AUTHOR_MAX_TOKENS: reasoning counts against it)");
  return JSON.parse(content) as MissionSpec;
}

export interface AuthorResult { mission?: Mission; attempts: AttemptRecord[]; research: Research | null; spec?: MissionSpec; tuning?: string; startedAt?: string; totalMs?: number }
export interface AttemptRecord { errors: string[]; balance?: unknown; spec?: MissionSpec; ms?: number; usage?: Usage; repairs?: string[] }

/**
 * Balance is tuned by code, not by the model: the model chooses the building, the story and the order the guard walks
 * the rooms; the code searches how long he rests at his post and which way round he walks, simulating each candidate,
 * and keeps the one closest to the targets. Returns the tuned level and its numbers, or the best miss as feedback.
 */
export function tuneGuard(level: any, runs = 40): { level: any; ok: boolean; cautiousWin: number; recklessClean: number; note: string } {
  const g = level.guard, post: string = g.route[0], walk: string[] = g.route.filter((r: string) => r !== post);
  const probe = (lv: any) => lv as WorldState;
  /** A patrol that walks the first `cut` rooms of the model's walk, then the shortest way back to his post. */
  const routeFor = (lv: any, w: string[], rest: number) => {
    const back = path(probe(lv), w[w.length - 1], post) ?? [];
    return [...Array(rest).fill(post), ...w, ...back.slice(1, -1)];
  };
  // last resort: a plainly named hiding place in rooms on the way to the item that have none (recorded in the report)
  const withCover = (lv: any) => {
    const start = lv.start.room, itemRoom = lv.items[0].room, way: string[] = path(probe(lv), start, itemRoom) ?? [];
    const props = [...lv.props], added: string[] = [];
    for (const r of way.slice(1)) {
      if (props.some((p: any) => p.room === r && p.tags.includes("hide"))) continue;
      const used = new Set(lv.doors.filter((d: any) => d.between.includes(r)).map((d: any) => d.side[r]));
      const side = ["left", "right", "ahead", "behind"].find(x => !used.has(x)) ?? "left";
      props.push({ id: `${r}_alcove`, room: r, side, tags: ["hide"], spokenName: "a dark alcove", aliases: ["alcove", "corner"] }); added.push(r);
    }
    return { lv: { ...lv, props }, added };
  };
  let best: { level: any; ok: boolean; cautiousWin: number; recklessClean: number; note: string; score: number } | null = null;
  for (const coverPass of [false, true]) {
    const { lv: baseLv, added } = coverPass ? withCover(level) : { lv: level, added: [] as string[] };
    if (coverPass && !added.length) break;
    for (const [dir, w0] of [["forward", walk], ["reversed", [...walk].reverse()]] as [string, string[]][]) {
      for (const cut of [...new Set([w0.length, Math.max(2, Math.ceil(w0.length / 2))])]) {
        const w = w0.slice(0, cut);
        for (const rest of [2, 3, 5, 8]) {
          const lv = { ...baseLv, guard: { ...g, route: routeFor(baseLv, w, rest), step: 0, startWindow: 1 } };
          const rows = summarize(lv, ["careful", "reckless"], runs);
          const c = rows[0].win, k = rows[1].cleanWin, ok = c >= TARGETS.cautiousWin && k <= TARGETS.recklessClean;
          // prefer: passing, then the model's own building (no added cover), the full patrol, a short rest
          const score = (ok ? 10000 : 0) + (added.length ? 0 : 500) + Math.min(c, 95) - 2 * k + cut * 3 - Math.abs(rest - 3);
          const note = `${rest} turns at his post, walking ${dir} through ${cut === w0.length ? "his whole patrol" : `the first ${cut} steps of his patrol`}${added.length ? `; the code added a dark alcove for cover in ${added.join(", ")}` : ""}`;
          if (!best || score > best.score) best = { level: lv, ok, cautiousWin: c, recklessClean: k, note, score };
        }
      }
    }
    if (best?.ok) break;
  }
  const { score: _s, ...out } = best!;
  if (out.ok) { const confirm = summarize(out.level, ["careful", "reckless"], 300); out.cautiousWin = confirm[0].win; out.recklessClean = confirm[1].cleanWin; out.ok = out.cautiousWin >= TARGETS.cautiousWin && out.recklessClean <= TARGETS.recklessClean; }
  return out;
}

export async function authorMission(cfg: Config, kase: MissionCase, opts: { attempts?: number; log?: (s: string) => void; fetchImpl?: typeof fetch; fromSpec?: MissionSpec } = {}): Promise<AuthorResult> {
  const log = opts.log ?? (() => {});
  const base = { lines: loadBank(linesJson), beats: beatsJson as Beat[] };
  const notes = await research(kase.wiki ?? kase.inspiredBy, opts.fetchImpl);
  log(notes ? `research: ${notes.title} (${notes.url})` : "research: nothing found, using the case facts only");
  const out: AuthorResult = { attempts: [], research: notes, startedAt: new Date().toISOString() };
  const t0 = Date.now();
  let feedback: string[] = [];
  for (let i = 0; i < (opts.attempts ?? 3); i++) {
    log(`attempt ${i + 1}: asking Muse Spark for a mission spec…`);
    out.tuning = undefined;
    const tA = Date.now(), usage: Usage = { prompt: 0, completion: 0, reasoning: 0 };
    let spec: MissionSpec;
    try { spec = opts.fromSpec && i === 0 ? opts.fromSpec : await draftSpec(cfg, kase, notes, feedback, opts.fetchImpl, usage); } catch (e) { feedback = [`(the previous reply could not be used: ${(e as Error).message.slice(0, 160)})`]; out.attempts.push({ errors: feedback, ms: Date.now() - tA, usage }); log(`  ${feedback[0]}`); continue; }
    out.spec = spec;
    let built: ReturnType<typeof buildMission>;
    try { built = buildMission(spec, kase, base); } catch (e) { built = { errors: [`internal error while building (the spec is probably malformed): ${(e as Error).message.slice(0, 120)}`] }; }
    let errors = built.errors;
    // where the guard rests is geometry, so the code chooses it: the model's choice first, then every other room
    let postNote = "";
    if (built.mission && !errors.length && !checkText(built.mission, kase.realNames).length) {
      const tries = [spec.guardPost.attachTo, ...spec.rooms.slice(1).map(r => r.id).filter(id => id !== spec.guardPost.attachTo)];
      for (const at of tries) {
        const b = at === spec.guardPost.attachTo ? built : buildMission({ ...spec, guardPost: { ...spec.guardPost, attachTo: at } }, kase, base);
        if (!b.mission) continue;
        const t = tuneGuard(b.mission.level);
        if (t.ok) { built = b; b.mission.level = t.level; postNote = at === spec.guardPost.attachTo ? "" : `; the code moved his post next to ${at}`; out.tuning = t.note + postNote; break; }
      }
    }
    if (built.mission) { try { errors = checkText(built.mission, kase.realNames); } catch (e) { errors = [`internal error while checking text: ${(e as Error).message.slice(0, 120)}`]; } }
    let balance: unknown;
    if (built.mission && !errors.length) {
      const t = out.tuning ? { level: built.mission.level, ...lastBalance(built.mission.level), note: out.tuning } : tuneGuard(built.mission.level);
      built.mission.level = t.level;
      balance = [{ policy: "careful", win: t.cautiousWin }, { policy: "reckless", cleanWin: t.recklessClean }];
      out.tuning ??= t.note;
      log(`  balance after tuning the guard (${t.note}): careful player wins ${t.cautiousWin}%, rushing player wins cleanly ${t.recklessClean}%`);
      if (t.cautiousWin < TARGETS.cautiousWin) errors.push(`too hard even after tuning the guard's schedule: a careful player (listens, moves quietly away from the footsteps, hides when warned) wins only ${t.cautiousWin}%; the target is at least ${TARGETS.cautiousWin}%. The building is probably a single corridor with the guard sweeping it: give it a loop or a side room next to the route so Marlow can step aside while he passes, put cover in the rooms on the way to the item, and attach the guard post away from the item room.`);
      if (t.recklessClean > TARGETS.recklessClean) errors.push(`too easy even after tuning: rushing straight for the item wins cleanly ${t.recklessClean}%; the target is at most ${TARGETS.recklessClean}%. The patrol must walk through the rooms between the entrance and the item, more than once.`);
    }
    out.attempts.push({ errors, balance, spec, ms: Date.now() - tA, usage, repairs: out.tuning ? [out.tuning] : [] });
    if (!errors.length && built.mission) { out.mission = built.mission; out.totalMs = Date.now() - t0; log(`  passed every check`); return out; }
    log(`  ${errors.length} problem(s): ${errors.slice(0, 3).join(" | ")}`);
    try { mkdirSync("assets/missions/_failed", { recursive: true }); writeFileSync(`assets/missions/_failed/${kase.id}-${Date.now()}.json`, JSON.stringify(spec, null, 1)); } catch { /* best effort */ }
    feedback = errors.slice(0, 12);
  }
  out.totalMs = Date.now() - t0;
  return out;
}

/** One line per generation run, failures included: the raw material for generation-stats.md. */
export function recordRun(kase: MissionCase, r: AuthorResult, extra: { images?: number; voiceLines?: number; extraMs?: number } = {}) {
  mkdirSync("assets/missions", { recursive: true });
  const line = { when: r.startedAt, case: kase.id, passed: !!r.mission, mission: r.mission?.id ?? null, totalMs: r.totalMs, attempts: r.attempts.map(a => ({ ms: a.ms, passed: !a.errors.length, errors: a.errors, repairs: a.repairs ?? [], usage: a.usage })), ...extra };
  appendFileSync("assets/missions/stats.jsonl", JSON.stringify(line) + "\n");
}

/** Write a passed mission where the web app can load it (assets is the web public directory). */
export function saveMission(m: Mission, result: AuthorResult, dir = "assets/missions") {
  const d = `${dir}/${m.id}`; mkdirSync(d, { recursive: true });
  writeFileSync(`${d}/mission.json`, JSON.stringify(m));
  writeFileSync(`${d}/spec.json`, JSON.stringify(result.spec, null, 1));
  const bal = result.attempts[result.attempts.length - 1]?.balance as { policy: string; win: number; cleanWin: number; caught: number }[] | undefined;
  writeFileSync(`${d}/report.md`, `# ${m.title}\n\n*${m.tagline}*\n\nInspired by ${m.inspiredBy}. Every name, place and object is invented.\n\nSources: ${[...new Set([...m.sources, result.research?.url].filter(Boolean))].join(", ")}\n\n## Checks\n- Built by code from the model's spec; door walls and the guard's route computed, not written by the model.\n- Level validity, story beats and real-name check: passed on attempt ${result.attempts.length}.\n- Balance (300 seeded runs each, guard schedule tuned by code: ${result.tuning ?? "n/a"}): ${bal?.map(r => r.policy === "careful" ? `careful player wins ${r.win}%` : `rushing player wins cleanly ${r.cleanWin}%`).join("; ")}.\n\n## Attempts\n${result.attempts.map((a, i) => `${i + 1}. ${a.errors.length ? a.errors.join("; ") : "passed"}`).join("\n")}\n`);
  const idx = `${dir}/index.json`;
  const list: { id: string; title: string; tagline: string; inspiredBy: string }[] = existsSync(idx) ? JSON.parse(readFileSync(idx, "utf8")) : [];
  writeFileSync(idx, JSON.stringify([...list.filter(x => x.id !== m.id), { id: m.id, title: m.title, tagline: m.tagline, inspiredBy: m.inspiredBy }], null, 1));
  return d;
}
