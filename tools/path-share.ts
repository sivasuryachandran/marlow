/** Counts how many turns of a scripted run were answered by the local parser vs a model call. Usage: tsx tools/path-share.ts */
import { InMemoryStore, MockIntent, Session, type IntentAdapter } from "../packages/game/src/index";
import { bank, beats, level } from "./lib";

const DEMO_SEED_9 = ["peek the vault door", "listen", "go to the hall", "peek the door", "quietly go to the office", "hide", "listen", "take the ledger", "go to the hall", "go to the lobby", "exit"];
let calls = 0;
const counting: IntentAdapter = { name: "counted-mock", infer: req => { calls++; return new MockIntent().infer(req); } };
const s = new Session({ level, bank, beats, intent: counting, seed: 9, memory: new InMemoryStore() });
s.start();
const rows: string[] = [];
for (const c of DEMO_SEED_9) {
  const before = calls;
  await s.submit(c);
  rows.push(`${calls > before ? "MODEL" : "local"}  ${c}`);
}
const model = rows.filter(r => r.startsWith("MODEL")).length;
console.log(rows.join("\n"));
console.log(`\n${DEMO_SEED_9.length} turns: ${DEMO_SEED_9.length - model} local parser (${Math.round(((DEMO_SEED_9.length - model) / DEMO_SEED_9.length) * 100)}%), ${model} model calls (${Math.round((model / DEMO_SEED_9.length) * 100)}%)`);
