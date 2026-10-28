/** Replay run logs (runs/*.jsonl) and assert identical event logs. Exit 1 on any mismatch. */
import { replayRows } from "../server/src/replay";
import { level, readRuns } from "./lib";

const runs = readRuns();
let bad = 0, stale = 0;
for (const r of runs) {
  const res = replayRows(r.rows, level);
  if (res.stale) { stale++; console.warn(`STALE ${r.id}: recorded on a different level version, skipped`); }
  else if (!res.ok) { bad++; console.error(`MISMATCH ${r.id} at turn ${res.mismatchAt}`); }
}
const n = runs.length - stale;
console.log(`replayed ${n} run(s) (${stale} stale skipped); determinism ${n ? (((n - bad) / n) * 100).toFixed(0) + "%" : "n/a (no current runs yet)"}`);
process.exit(bad ? 1 : 0);
