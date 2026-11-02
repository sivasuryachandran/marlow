/**
 * Generate a new MARLOW mission from a real case (inspired by, fictionalized), check it, and make it playable.
 *
 *   npm run mission -- --list                     # the case library (data/cases.json)
 *   npm run mission -- --case=gallery1990 --dry   # research + the prompt Spark would get; no model call
 *   npm run mission -- --case=gallery1990         # Spark drafts, code builds and checks (up to 3 attempts)
 *   npm run mission -- --case=gallery1990 --voices --art   # also render its voice lines (Kokoro) and stills (Muse Image)
 *   npm run mission -- --theme="the 1963 train robbery"    # a free-text theme: researched on Wikipedia first
 *
 * Then play it at http://localhost:5173/?mission=<id> (or pick it in the Briefing tab).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expandLine, loadBank, type Mission, type MissionCase } from "../packages/game/src/index";
import { AUTHOR_PROMPT, authorMission, CASES, recordRun, research, saveMission } from "../server/src/mission-author";
import { loadConfig } from "../server/src/config";
import { MuseImage } from "../server/src/adapters/image";
import { linesJson } from "./lib";
// same look as the built-in story stills (tools/story-art.ts); kept here because importing that script would run it
const STYLE = "Graphic-novel noir illustration, heavy rain, teal and amber palette, cinematic lighting, painterly, wide shot, no text, no letters, no captions, no logos. ";

const args = process.argv.slice(2), flag = (n: string) => args.includes(`--${n}`), val = (n: string) => args.find(a => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const status = (s: string) => { console.log(s); const job = val("job"); if (job) { mkdirSync("assets/missions/_jobs", { recursive: true }); const f = `assets/missions/_jobs/${job}.json`; const j = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { log: [] }; j.log.push(s); j.updated = Date.now(); writeFileSync(f, JSON.stringify(j)); } };
const finish = (o: Record<string, unknown>) => { const job = val("job"); if (job) { const f = `assets/missions/_jobs/${job}.json`; const j = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { log: [] }; writeFileSync(f, JSON.stringify({ ...j, ...o, done: true })); } };

if (flag("list")) { for (const c of CASES) console.log(`${c.id.padEnd(14)} ${c.title} — inspired by ${c.inspiredBy}`); process.exit(0); }

let kase: MissionCase | undefined = CASES.find(c => c.id === val("case"));
const theme = val("theme");
if (!kase && theme) {
  const notes = await research(theme);
  kase = { id: theme.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 14) || "custom", title: theme, inspiredBy: notes ? notes.title : theme, year: 0, facts: notes ? [notes.extract.slice(0, 900)] : [theme], realNames: [], sources: notes ? [notes.url] : [], wiki: notes?.title };
  status(notes ? `theme researched: ${notes.title}` : "theme: nothing found on Wikipedia, using the theme text alone");
  if (notes) status("note: for a free theme the real-name check only knows the names you give it; review the result before sharing.");
}
if (!kase) { console.error("Give --case=<id> (see --list) or --theme=\"...\""); process.exit(2); }

if (flag("dry")) {
  const notes = await research(kase.wiki ?? kase.inspiredBy);
  console.log(`--- research\n${notes ? `${notes.title}: ${notes.extract.slice(0, 600)}…\n${notes.url}` : "none"}\n--- system prompt (${AUTHOR_PROMPT.length} chars)\n${AUTHOR_PROMPT.slice(0, 500)}…\n--- would call Muse Spark up to 3 times (strict JSON schema), then build and check.`);
  process.exit(0);
}

const cfg = loadConfig();
if (!cfg.modelApiKey) { console.error("MODEL_API_KEY is not set (.env)"); process.exit(2); }
status(`generating a mission inspired by ${kase.inspiredBy}`);
const fromSpec = val("from-spec") ? JSON.parse(readFileSync(val("from-spec")!, "utf8")) : undefined;
const result = await authorMission(cfg, kase, { log: status, fromSpec, attempts: fromSpec && flag("offline") ? 1 : 3 });
if (!result.mission) { recordRun(kase, result); status(`FAILED after ${result.attempts.length} attempts. Last problems: ${result.attempts.at(-1)?.errors.join("; ")}`); finish({ ok: false }); process.exit(1); }
const m = result.mission as Mission & { voices?: boolean; art?: string[] };
// rebuilding an existing mission from its saved spec (--from-spec): keep the voices and stills it already has
const prevFile = `assets/missions/${m.id}/mission.json`, prev = existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, "utf8")) : null;
if (prev) { if (prev.voices) m.voices = prev.voices; if (prev.art) m.art = prev.art; }
const dir = saveMission(m, result);
const tRest = Date.now(); let nVoices = 0, nImages = 0;
status(`saved ${dir}`);

if (flag("voices")) {
  // Every line the mission can say: its own story lines, plus the shared lines whose slots now hold its room and object names.
  const bank = { ...loadBank(linesJson), ...m.lines }, overlay = new Set(Object.keys(m.lines)), adir = `${dir}/audio`;
  mkdirSync(adir, { recursive: true });
  const todo = Object.entries(bank).flatMap(([id, def]) => expandLine(id, def, m.level as never).map(x => ({ ...x, id })))
    .filter(x => (overlay.has(x.id) ? !existsSync(`${adir}/${x.audioKey}.mp3`) : !existsSync(`assets/audio/lines/${x.audioKey}.mp3`)));
  status(`voices: ${todo.length} lines to render with Kokoro`);
  try {
    const { KokoroTTS } = await import(/* @vite-ignore */ "kokoro-js" as string);
    const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8" });
    const voices: Record<string, string> = { marlow: "af_heart", client: "bf_emma", system: "af_heart", guide: process.env.KOKORO_VOICE_GUIDE ?? "am_adam" };
    let n = 0;
    for (const x of todo) {
      const wav = `${adir}/${x.audioKey}.wav`;
      await (await tts.generate(x.text, { voice: voices[x.speaker] ?? "af_heart" })).save(wav);
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-ar", "24000", "-b:a", "40k", `${adir}/${x.audioKey}.mp3`]); rmSync(wav);
      if (++n % 25 === 0) status(`  voices ${n}/${todo.length}`);
    }
    m.voices = true; nVoices = n; status(`voices: done`);
  } catch (e) { status(`voices skipped (${(e as Error).message.slice(0, 120)}); install kokoro-js and ffmpeg locally to render them`); }
}

if (flag("art")) {
  const spec = result.spec!, img = new MuseImage(cfg), adir = `${dir}/art`; mkdirSync(adir, { recursive: true });
  const scenes: Record<string, string> = {
    intro_first: `The outside of an elegant old building at night, ${spec.title.toLowerCase()}, a parked van across the wet street with a thin radio antenna.`,
    ...Object.fromEntries(spec.rooms.slice(1).map(r => [`story_${r.id.toLowerCase().replace(/[^a-z]+/g, "_")}`, `Inside ${r.name}: ${r.describe}`])),
    ledger_twist: `Gloved hands opening ${spec.item.name} to reveal something hidden inside it. ${spec.lines.take}`,
  };
  m.art = [];
  for (const [beat, scene] of Object.entries(scenes)) {
    try {
      const r = await img.render(STYLE + scene);
      const tmp = `${adir}/${beat}.full.jpg`; writeFileSync(tmp, r.data as Uint8Array);
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", tmp, "-vf", "scale=1400:-2", "-q:v", "5", `${adir}/${beat}.jpg`]); rmSync(tmp);
      m.art.push(beat); nImages++; status(`  art: ${beat}`);
    } catch (e) { status(`  art ${beat} failed: ${(e as Error).message.slice(0, 100)}`); }
  }
}
if (!fromSpec) recordRun(kase, result, { images: nImages, voiceLines: nVoices, extraMs: Date.now() - tRest });
writeFileSync(`${dir}/mission.json`, JSON.stringify(m));
status(`ready: play it at /?mission=${m.id}`);
finish({ ok: true, id: m.id });
