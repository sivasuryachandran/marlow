/** Real Voice Transcribe call on a WAV file. Usage: node --env-file=.env --import tsx tools/live-stt.ts file.wav */
import { readFileSync } from "node:fs";
import { MetaStt } from "../server/src/adapters/stt";
import { loadConfig } from "../server/src/config";
const buf = readFileSync(process.argv[2]);
const t0 = performance.now();
const r = await new MetaStt(loadConfig()).transcribe(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "audio/wav");
console.log(`${Math.round(performance.now() - t0)}ms`, JSON.stringify(r));
