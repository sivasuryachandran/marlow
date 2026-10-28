/** Prints a clean-win plan (alert <= 1) for a seed as spoken commands: the demo-video script. Usage: tsx tools/demo-plan.ts [seed] */
import { createInitialState, solve, step } from "../packages/engine/src/index";
import { level } from "./lib";

const seed = Number(process.argv[2] ?? 1);
const plan = solve(createInitialState(level, seed), 14);
if (!plan) { console.log(`seed ${seed}: no clean win within 14 turns`); process.exit(1); }
let s = createInitialState(level, seed);
console.log(`seed ${seed}: guard starts at ${s.guard.route[s.guard.step]}; clean win in ${plan.length} turns`);
for (const a of plan) {
  const n = (id: string) => [...s.doors, ...s.items].find(x => x.id === id)?.spokenName ?? id;
  const say = a.action === "move" ? `${a.stance ? "quietly " : ""}go to ${a.target}` : a.action === "peek" ? `peek ${n(a.target)}` : a.action === "take" ? `take ${n(a.target)}` : a.action;
  const r = step(s, a); s = r.state;
  console.log(`  "${say}"  -> ${r.events.filter(e => e.perceived).map(e => e.type).join(", ")}`);
}
