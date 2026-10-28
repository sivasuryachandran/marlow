/** Replay run logs (runs/*.jsonl) and assert identical event logs. Exit 1 on any mismatch. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createInitialState, step } from "../packages/engine/src/index";
import level from "../data/level.json" with { type: "json" };

const dir = "runs";
const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".jsonl")) : [];
let bad = 0;
for (const f of files) {
  const rows = readFileSync(`${dir}/${f}`, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  const head = rows.find(r => r.type === "start") ?? { seed: 0 };
  let s = createInitialState(level, head.seed, { trust: head.trust, lastTrustLoss: head.lastTrustLoss });
  for (const row of rows.filter(r => r.action && r.events)) {
    const r = step(s, row.action);
    if (JSON.stringify(r.events) !== JSON.stringify(row.events)) { bad++; console.error(`MISMATCH ${f} turn ${row.turnId}`); break; }
    s = r.state;
  }
}
console.log(`replayed ${files.length} run(s); determinism ${files.length ? (((files.length - bad) / files.length) * 100).toFixed(0) : "n/a"}%`);
process.exit(bad ? 1 : 0);
