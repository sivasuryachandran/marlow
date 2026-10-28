# PROGRESS

Status date: 2026-10-28. No Meta/Baseten keys were available, so everything that needs a live model is built behind an adapter with a mock and marked `TODO(docs)`. Nothing below claims a live-model result.

## Milestones

| | State | Evidence |
|---|---|---|
| M1 Access + engine | **Code done; access go/no-go PENDING (yours)** | 7 actions, seeded replay, `npm test`. `tools/check-access.ts` SKIPs every call it can't make safely |
| M2 One voice turn | **Code done; real latency NOT measured** | PTT → STT chain → local parser → intent → V1/V2 → engine → text; per-turn latencies logged; turn-ID guard tested (timeout, superseded, wrong id) |
| M3 World audio | **Code done; blindfold test NOT run (needs you)** | HRTF panner, synthesized per-room IR reverb, occlusion low-pass, moving guard arc, text-log mirroring of every cue |
| M4 Earpiece | **Code done; Kokoro render NOT run** | band-pass + static bus, instant click + "Copy.", ambience, 4 s timeout static, −9 dB ducking, `tools/render-lines.ts` (810-file manifest) |
| M5 Clarify + eval | **Done for mock; Meta/Baseten rows SKIP** | `npm run eval`: see below |
| M6 Story + memory | **Done** | beats.json + Director (≤2/turn), 5 trust rules, curt set < 30, run-2 callback (tested across two runs), `author-mission --validate` (V0) |
| M7 Case File + polish | **Code done; Muse Image NOT called** | 3–6 panels from the run log, prompts from engine facts only, engine-drawn placeholder frames, cache, `?debug=1`, settings, music |
| M8 Ship | **Partly** | README, CREDITS written. NOT done: public repo, demo video, real-audio checks, final metrics |

## Measured (mock backend, `npm run eval`, see metrics.md)

- 64 unit/integration tests passing; `tsc` clean.
- Intent accuracy 100% on 50 commands. **Caveat:** the mock is a keyword NLU I wrote and the cases were written alongside it, so this shows wiring, not Muse quality.
- Invalid actions accepted: 0 (50 commands + 2000 adversarial replies; 574 passed V2 as legal and none was illegal at the engine).
- Replay determinism: 50/50 generated seeded runs identical.
- Latency (mock): p50 0.05 ms, p95 ~0.3 ms. Meaningless for Muse.

## Needs you

1. **Keys + go/no-go** in `.env`, then read these docs and fill the `TODO(docs)` spots (each is one function):
   - Spark chat path, model id, low reasoning-effort setting, schema-constrained output → `server/src/adapters/intent.ts` (`INTENT_JSON_SCHEMA` and `INTENT_SYSTEM_PROMPT` are ready in `@marlow/game`)
   - Voice Transcribe request fields/response → `server/src/adapters/stt.ts` (client `ServerStt` already uploads a MediaRecorder blob to `/api/transcribe`)
   - Muse Image shape → `server/src/adapters/image.ts`; Baseten shape for `meta-models/muse-spark-open-1026`; Wonder (`tools/author-mission.ts --generate`)
2. **Kokoro**: `npm i -D kokoro-js` locally (check its dependency licenses first; I did not install it), then `npm run render-lines`. Until then Marlow's lines are placeholder murmurs plus on-screen/aria-live text. Fallback is a recorded voice bank using the manifest file names (`assets/audio/lines/manifest.json`).
3. **Blindfold test (M3 acceptance, ≥ 8/10)** and listening tune-ups: ducking depth, reverb, occlusion cutoff, arc speed. I could only check that it runs (browser console clean, context running); I can't hear it.
4. **Review `data/lines.json`** (all spoken text; 3 variants each, curt set for low trust).
5. **Real assets**: CC0 sfx/music/IR are not downloaded; every sound is currently synthesized (see TODO list). Dropping files at `assets/audio/sfx/<cueId>.wav` replaces the synth automatically.
6. Case File with real art, VERIFY_ART (SAM 3.1 + Spark), playtest notes, blind/low-vision tester, repo public, 3-minute demo video.

## Placeholder / TODO asset list (synth in `web/src/audio.ts`)

- Voice: all lines (`assets/audio/lines/<audioKey>.wav`, see manifest) → murmur tones
- SFX: `sfx.footsteps.{marble,carpet,metal}`, `sfx.door.creak`, `sfx.phone.ring`, `sfx.stinger.spotted`, `sfx.radio.click`, `sfx.radio.static`
- Ambience: rain, HVAC hum, breathing (all synthesized loops)
- Music: calm pad + tension pulse (synthesized; "two CC0 stems" replaced by two synthesized layers)
- Reverb IRs: procedurally generated marble/dry/metal (no OpenAIR files used)

## Design observations to review (rules unchanged from the brief)

- The level is 2 hops across, so `listen` always hears the guard (never "quiet").
- The guard crosses the hall every other step: a 2-step quiet move into the hall is always spotted; quiet works for office/gallery.
- Warnings fire whenever the guard is ≤ 1 hop away, which is most turns here, so "move right after a warning" (−5 trust) happens often even in a clean run (solver wins keep alert ≤ 1 but trust can dip). Tune the warning rule or the guard route if trust should feel more meaningful.
- Intent request carries an extra `side` field (relative to Marlow's facing) per known entity so "the left door" can resolve; the brief's triple was `{id, spokenName, type}`.
- Moves may name a door (`door:<id>` encoding in the mock) which resolves to the room beyond; V2 for `move` relies on the connecting door being known, not the destination room (Marlow hasn't seen it yet).
- Case File needs the server for the button; without it the CLI `npm run casefile -- <runId>` works from `runs/*.jsonl`.

## Next

Keys → fill adapters → rerun `npm run eval` (both backends side by side) → render Kokoro lines → blindfold + tune audio → demo seed/video (`npx tsx tools/demo-plan.ts 7` prints a clean 7-turn script).
