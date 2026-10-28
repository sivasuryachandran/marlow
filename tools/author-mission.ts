/**
 * Muse Wonder mission author (offline, optional) + V0 gate.
 *
 *   tsx tools/author-mission.ts --validate [file]   # V0-check a beat sheet (default data/beats.wonder.json, else data/beats.json)
 *   tsx tools/author-mission.ts --generate          # TODO(docs): call Muse Wonder (Responses API, `reasoning.effort`) -> data/beats.wonder.json
 *
 * Wonder only selects/orders beat + cue ids over the hand-made building; V0 rejects anything that references things that
 * do not exist, and the game falls back to data/beats.json. Drafted lines must be hand-reviewed into data/lines.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { validateBeats, type Beat } from "../packages/game/src/index";
import { bank, beats, cues, level } from "./lib";

const arg = process.argv.slice(2);
if (arg.includes("--generate")) {
  console.error("Muse Wonder call not implemented: request shape unread (TODO(docs): https://dev.meta.ai/docs/protocols/responses). Hand-written data/beats.json stays in use.");
  process.exit(2);
}
const file = arg.find(a => !a.startsWith("--")) ?? (existsSync("data/beats.wonder.json") ? "data/beats.wonder.json" : "data/beats.json");
const candidate = file === "data/beats.json" ? beats : (JSON.parse(readFileSync(file, "utf8")) as Beat[]);
const errs = validateBeats(candidate, bank, cues, level as any);
console.log(errs.length ? `V0 FAIL (${file}):\n - ${errs.join("\n - ")}\nShip data/beats.json instead.` : `V0 OK (${file}, ${candidate.length} beats)`);
process.exit(errs.length ? 1 : 0);
