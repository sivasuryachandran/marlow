/**
 * Plays the demo script through the real Session and prints, per turn, which path answered it
 * (LOCAL parser vs MODEL) and the outcome.
 *   offline mock:    npx tsx tools/rehearse-demo.ts
 *   live Muse Spark: node --env-file=.env --import tsx tools/rehearse-demo.ts --live [--runs 3]
 * Natural-language lines need a real model; the mock can't parse them (it will say so).
 */
import { InMemoryStore, MockIntent, Session, type IntentAdapter } from "../packages/game/src/index";
import { MetaSparkIntent } from "../server/src/adapters/intent";
import { loadConfig } from "../server/src/config";
import { bank, beats, level } from "./lib";

export const SEED = 7;
/** The order is the demo: [what the player says, what it should do]. */
export const RUN1: [string, string][] = [
  ["Listen.", "listen"],
  ["Check the vault door.", "refuse"],
  ["Let's head into the hallway.", "move hall"],
  ["Take a look through that door.", "clarify"],
  ["The one on the left.", "peek arch_hall_gallery"],
  ["Quietly slip into the study.", "move office quiet"],
  ["Hide.", "hide"],
  ["Grab the book off the desk.", "take ledger"],
  ["Go to the hall.", "move hall"],
  ["Go to the lobby.", "move lobby"],
  ["Exit.", "exit"],
];
export const RUN2: [string, string][] = [["Listen.", "listen"], ["Wait.", "wait"]];

const live = process.argv.includes("--live");
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 1;

async function play(label: string, seed: number, script: [string, string][], memory: InMemoryStore, base: IntentAdapter) {
  let model = 0;
  const counting: IntentAdapter = { name: base.name, infer: req => { model++; return base.infer(req); } };
  const s = new Session({ level, bank, beats, intent: counting, seed, memory, timeoutMs: 15000 });
  console.log(`--- ${label} (seed ${seed}, run ${s.runNumber}, backend ${base.name})`);
  for (const l of s.start().lines) console.log(`     ${l.speaker}: ${l.text}`);
  let okAll = true;
  for (const [say, want] of script) {
    const before = model, t0 = performance.now();
    const o = await s.submit(say);
    const ms = Math.round(performance.now() - t0), path = model > before ? "MODEL" : "LOCAL";
    const got = !o ? "discarded" : o.kind === "clarify" ? "clarify" : o.kind === "refused" ? "refuse" : o.kind === "ok" ? `${o.action!.action}${(o.action as { target?: string }).target ? " " + (o.action as { target?: string }).target : ""}${(o.action as { stance?: string }).stance === "quiet" ? " quiet" : ""}` : o.kind;
    const ok = got === want; okAll &&= ok;
    console.log(`${ok ? " ok " : "FAIL"} ${path.padEnd(5)} ${String(ms).padStart(5)} ms  "${say}" -> ${got}${ok ? "" : `   (wanted ${want})`}`);
    for (const c of o?.cues ?? []) console.log(`            cue: ${c.caption}`);
    for (const l of o?.lines ?? []) console.log(`            ${l.speaker}: ${l.text}`);
  }
  console.log(`status ${s.state.status}, alert ${s.state.alert}, trust ${s.state.trust}, turns ${s.state.turn}, model calls ${model}/${script.length}${okAll ? "" : "   <-- script did not play as intended"}`);
  return okAll && s.state.status === (script === RUN1 ? "won" : "playing");
}

const cfg = loadConfig();
let good = 0;
for (let i = 0; i < runs; i++) {
  const mem = new InMemoryStore();
  const intent = live ? new MetaSparkIntent(cfg) : new MockIntent();
  const a = await play(`run 1 #${i + 1}`, SEED, RUN1, mem, intent);
  const b = await play(`run 2 #${i + 1}`, SEED + 1, RUN2, mem, intent);
  if (a && b) good++;
}
console.log(`\n${good}/${runs} full rehearsals played exactly as scripted`);
