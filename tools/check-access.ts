/**
 * Prints pass/fail for each API once. Only calls whose shape is documented are made;
 * the rest report SKIP (rule 8: never invent API parameters). See PROGRESS.md for open questions.
 */
import "node:process";
const env = process.env;
const base = env.META_API_BASE ?? "https://api.meta.ai/v1";
type R = { name: string; status: "PASS" | "FAIL" | "SKIP"; note: string };
const out: R[] = [];

async function probe(name: string, url: string, init: RequestInit, okStatuses = [200]) {
  try {
    const res = await fetch(url, init);
    const ok = okStatuses.includes(res.status);
    out.push({ name, status: ok ? "PASS" : "FAIL", note: `HTTP ${res.status}` });
  } catch (e) { out.push({ name, status: "FAIL", note: String(e) }); }
}

const key = env.MODEL_API_KEY;
if (!key) {
  for (const n of ["Muse Spark", "Muse Voice Transcribe", "Muse Wonder", "Muse Image"]) out.push({ name: n, status: "SKIP", note: "MODEL_API_KEY not set" });
} else {
  const auth = { Authorization: `Bearer ${key}` };
  // Documented: Bearer auth, POST /v1/asr/transcribe (request fields not yet confirmed -> an auth-only probe).
  // A 4xx validation error (400/415/422) still proves the key reaches the endpoint; 401/403 means no access.
  await probe("Muse Voice Transcribe (auth reachability)", `${base}/asr/transcribe`, { method: "POST", headers: auth }, [200, 400, 415, 422]);
  for (const n of ["Muse Spark", "Muse Wonder", "Muse Image"])
    out.push({ name: n, status: "SKIP", note: "TODO: request shape (chat path, reasoning, JSON schema / image params) not read from docs yet" });
}
out.push({ name: "Baseten Spark Open", status: env.BASETEN_API_KEY ? "SKIP" : "SKIP", note: "TODO: read Baseten docs for meta-models/muse-spark-open-1026" });

for (const r of out) console.log(`${r.status.padEnd(5)} ${r.name} — ${r.note}`);
console.log("\nRecord the go/no-go decision in PROGRESS.md.");
