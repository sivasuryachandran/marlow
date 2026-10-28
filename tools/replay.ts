/** Replay run logs (runs/*.jsonl) and assert identical event logs. Exit 1 on any mismatch. */
import { replayRows } from "../server/src/replay";
import { level, readRuns } from "./lib";

const runs = readRuns();
let bad = 0;
for (const r of runs) {
  const res = replayRows(r.rows, level);
  if (!res.ok) { bad++; console.error(`MISMATCH ${r.id} at turn ${res.mismatchAt}`); }
}
console.log(`replayed ${runs.length} run(s); determinism ${runs.length ? (((runs.length - bad) / runs.length) * 100).toFixed(0) + "%" : "n/a (no runs yet)"}`);
process.exit(bad ? 1 : 0);
