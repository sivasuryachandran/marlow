/**
 * Lists the distinct lines a demo run actually speaks (run 1 clean win via the solver, then run 2's opening),
 * so you review ~40 lines instead of the whole bank. Usage: tsx tools/demo-lines.ts [seed=7]  -> DEMO_LINES.md
 */
import { writeFileSync } from "node:fs";
import { createInitialState, solve } from "../packages/engine/src/index";
import { InMemoryStore, MockIntent, Session } from "../packages/game/src/index";
import { bank, beats, level } from "./lib";

const seed = Number(process.argv[2] ?? 7);
const plan = solve(createInitialState(level, seed), 16);
if (!plan) { console.error("no clean win for that seed"); process.exit(1); }
const mem = new InMemoryStore();
const seen = new Map<string, { text: string; speaker: string; n: number }>();
const note = (ls: { id: string; text: string; speaker: string }[]) => { for (const l of ls) { const k = `${l.id}|${l.text}`; const e = seen.get(k); if (e) e.n++; else seen.set(k, { text: l.text, speaker: l.speaker, n: 1 }); } };
const say = (a: any, s: any) => {
  const nm = (id: string) => [...s.doors, ...s.items].find((x: any) => x.id === id)?.spokenName.replace(/^the /, "") ?? id;
  return a.action === "move" ? `${a.stance ? "quietly " : ""}go to ${a.target}` : a.action === "peek" ? `peek the ${nm(a.target)}` : a.action === "take" ? `take the ${nm(a.target)}` : a.action;
};
const s1 = new Session({ level, bank, beats, intent: new MockIntent(), seed, memory: mem });
note(s1.start().lines);
for (const a of plan) note((await s1.submit(say(a, s1.state)))!.lines);
const s2 = new Session({ level, bank, beats, intent: new MockIntent(), seed: seed + 1, memory: mem });
note(s2.start().lines);
for (const t of ["listen", "wait", "peek the vault door", "go through the door"]) { const o = await s2.submit(t); if (o) note(o.lines); }

const rows = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
writeFileSync("DEMO_LINES.md", `# Lines to review for the demo (seed ${seed})\n\n${rows.length} distinct lines are spoken in a clean run plus the start of run 2. Edit the text in \`data/lines.json\` (variants of the same id are separate entries there).\n\n| Line id | Speaker | Text |\n|---|---|---|\n${rows.map(([k, v]) => `| ${k.split("|")[0]} | ${v.speaker} | ${v.text} |`).join("\n")}\n`);
console.log(`${rows.length} distinct lines -> DEMO_LINES.md (plan: ${plan.length} turns)`);
