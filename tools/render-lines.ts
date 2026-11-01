/**
 * Offline Kokoro pre-render. Enumerates every spoken line variant (all slot combinations) from data/lines.json
 * into assets/audio/lines/manifest.json, then renders each missing file with Kokoro if available.
 *
 *   npx tsx tools/render-lines.ts            # write manifest, render if kokoro-js is installed
 *   npx tsx tools/render-lines.ts --manifest # manifest only
 *
 * Rendering uses `kokoro-js` (Apache-2.0; pulls @huggingface/transformers + onnxruntime, Apache-2.0/MIT — verify before
 * install, see CREDITS.md). Install it on your machine only: `npm i -D kokoro-js` (not a project dependency by default).
 * Fallback: a recorded voice bank with identical file names (see manifest.json, `audioKey` + `.wav`).
 * Voices: marlow = af_heart, client (Ines) = bf_emma, (override with KOKORO_VOICE_*).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { expandLine } from "../packages/game/src/index";
import { bank, level } from "./lib";

const dir = "assets/audio/lines";
mkdirSync(dir, { recursive: true });
const manifest: { audioKey: string; text: string; speaker: string }[] = [];
for (const [id, def] of Object.entries(bank)) manifest.push(...expandLine(id, def, level));
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1));
const todo = manifest.filter(m => !existsSync(`${dir}/${m.audioKey}.wav`) && !existsSync(`${dir}/${m.audioKey}.mp3`)); // a committed mp3 counts as rendered
console.log(`${manifest.length} lines in manifest; ${todo.length} not yet rendered.`);
if (process.argv.includes("--manifest") || !todo.length) process.exit(0);

let KokoroTTS: any;
try { ({ KokoroTTS } = await import(/* @vite-ignore */ "kokoro-js" as string)); }
catch { console.log("kokoro-js not installed. Run `npm i -D kokoro-js` locally (Apache-2.0), or record the voice bank using the manifest names. The game still plays: missing lines use a placeholder tone."); process.exit(0); }

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8" });
const voices: Record<string, string> = { marlow: process.env.KOKORO_VOICE_MARLOW ?? "af_heart", client: process.env.KOKORO_VOICE_CLIENT ?? "bf_emma", system: "af_heart" };
let n = 0;
for (const m of todo) {
  const audio = await tts.generate(m.text, { voice: voices[m.speaker] ?? "af_heart" });
  await audio.save(`${dir}/${m.audioKey}.wav`);
  if (++n % 25 === 0) console.log(`rendered ${n}/${todo.length}`);
}
console.log(`done: ${n} files in ${dir}. Now run: sh tools/compress-lines.sh (the game plays the small mp3s)`);
