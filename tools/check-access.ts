export {};
/**
 * Prints pass/fail for each API once (real calls; needs .env). Usage: node --env-file=.env --import tsx tools/check-access.ts [--image] [--wonder]
 * Image and Wonder cost credits, so they are opt-in.
 */
const env = process.env;
const base = env.META_API_BASE ?? "https://api.meta.ai/v1";
const out: { name: string; status: "PASS" | "FAIL" | "SKIP"; note: string }[] = [];
const rec = (name: string, status: "PASS" | "FAIL" | "SKIP", note: string) => out.push({ name, status, note });
const timed = async <T>(f: () => Promise<T>) => { const t = performance.now(); const r = await f(); return [r, Math.round(performance.now() - t)] as const; };

async function chat(url: string, key: string, body: object) {
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

const key = env.MODEL_API_KEY;
if (!key) for (const n of ["Muse Spark", "Muse Voice Transcribe", "Muse Image", "Muse Wonder"]) rec(n, "SKIP", "MODEL_API_KEY not set");
else {
  try {
    const [r, ms] = await timed(() => chat(`${base}/chat/completions`, key, { model: "muse-spark-1.3", reasoning_effort: "minimal", max_completion_tokens: 400, messages: [{ role: "user", content: "Reply with the single word: ok" }] }));
    rec("Muse Spark (muse-spark-1.3)", r.status === 200 && r.json?.choices?.[0]?.message?.content ? "PASS" : "FAIL", `HTTP ${r.status}, ${ms} ms`);
  } catch (e) { rec("Muse Spark", "FAIL", String(e)); }
  // Voice Transcribe: a 0.1 s silent 16 kHz WAV proves auth + request shape (empty transcript is a valid answer).
  try {
    const pcm = new Int16Array(1600), hdr = Buffer.alloc(44);
    hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.byteLength, 4); hdr.write("WAVEfmt ", 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
    hdr.writeUInt32LE(16000, 24); hdr.writeUInt32LE(32000, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm.byteLength, 40);
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], { type: "application/json" }));
    form.append("audio", new Blob([Buffer.concat([hdr, Buffer.from(pcm.buffer)])], { type: "audio/wav" }), "silence.wav");
    const [res, ms] = await timed(() => fetch(`${base}/asr/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, body: form }));
    const j: any = await res.json().catch(() => null);
    rec("Muse Voice Transcribe", res.status === 200 && j && "transcript" in j ? "PASS" : "FAIL", `HTTP ${res.status}, ${ms} ms`);
  } catch (e) { rec("Muse Voice Transcribe", "FAIL", String(e)); }
  if (process.argv.includes("--image")) {
    try {
      const [r, ms] = await timed(() => chat(`${base}/images/generations`, key, { model: "muse-image-1.0", prompt: "a black and white ink drawing of a rainy window", n: 1, size: "1024x1024", response_format: "b64_json", output_format: "jpeg", reasoning_strength: "low" }));
      rec("Muse Image (muse-image-1.0)", r.status === 200 && r.json?.data?.[0]?.b64_json ? "PASS" : "FAIL", `HTTP ${r.status}, ${ms} ms`);
    } catch (e) { rec("Muse Image", "FAIL", String(e)); }
  } else rec("Muse Image", "SKIP", "pass --image to spend credits on one image");
  if (process.argv.includes("--wonder")) {
    try {
      const [r, ms] = await timed(() => chat(`${base}/chat/completions`, key, { model: "muse-wonder-1.0", reasoning_effort: "low", max_completion_tokens: 600, messages: [{ role: "user", content: "Reply with the single word: ok" }] }));
      rec("Muse Wonder (muse-wonder-1.0)", r.status === 200 && r.json?.choices?.[0] ? "PASS" : "FAIL", `HTTP ${r.status}, ${ms} ms${r.status !== 200 ? " " + JSON.stringify(r.json).slice(0, 120) : ""}`);
    } catch (e) { rec("Muse Wonder", "FAIL", String(e)); }
  } else rec("Muse Wonder", "SKIP", "optional; pass --wonder");
}
if (!env.BASETEN_API_KEY) rec("Baseten Spark Open", "SKIP", "BASETEN_API_KEY not set");
else {
  try {
    const [r, ms] = await timed(() => chat("https://inference.baseten.co/v1/chat/completions", env.BASETEN_API_KEY!, { model: "meta-models/muse-spark-open", max_tokens: 400, messages: [{ role: "user", content: "Reply with the single word: ok" }] }));
    rec("Baseten Muse Spark Open (meta-models/muse-spark-open)", r.status === 200 && r.json?.choices?.[0] ? "PASS" : "FAIL", `HTTP ${r.status}, ${ms} ms`);
  } catch (e) { rec("Baseten Spark Open", "FAIL", String(e)); }
}
for (const r of out) console.log(`${r.status.padEnd(5)} ${r.name} — ${r.note}`);
console.log("\nRecord the go/no-go decision in PROGRESS.md.");
