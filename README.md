# MARLOW

**A screenless, binaural heist radio-drama you play by voice.** You are Owl, a blind former safecracker running a job from a van by ear. Marlow is the operative inside the building, and she is the only one who can see. You hear the building in 3D through her collar mic, give orders by push-to-talk, and hear what happens. Afterwards the game draws a **Case File**: a short comic of your run for sighted friends.

> Muse understands what you say. A deterministic engine decides what actually happens. Your only map is what your partner can tell you.

Built for the Meta Global AI Developer Hackathon (Indie track). **All code, data and tooling in this repo were written during the hackathon.** See [PROGRESS.md](PROGRESS.md) for status and open items, [CREDITS.md](CREDITS.md) for assets and licenses.

## Run it

```bash
npm install
npm test                # engine rules, pipeline, session, case file (64 tests)
npm run server          # optional: API proxy, run logs, Case File (port 8787)
npm run dev             # game on http://localhost:5173  (add ?debug=1&seed=7)
npm run eval            # V3 regression harness -> metrics.json + metrics.md
npm run replay          # replay every runs/*.jsonl and assert identical event logs
```

Copy `.env.example` to `.env` for keys. **The game is fully playable with no keys**: typed input or browser speech recognition, an in-browser deterministic intent mock, placeholder tones where pre-rendered voice lines are missing. Headphones recommended.

Controls: hold **Space** or the big button to talk; or type. Try "listen", "go to the hall", "peek the left door quietly", "take the ledger", "go back", "exit". Ambiguous orders get a spoken clarifying question; impossible ones get a refusal and the world does not change.

## How it works

```
 voice ──► STT adapter ─► final transcript ─► local parser ──hit──┐
 (PTT)     (Muse Voice      (partials are        (wait/stop/listen/ │
           Transcribe →      display-only)        hide/back/yes/no/  │ miss
           browser → typed)                       repeat/room names) ▼
                                                      Intent adapter (Muse Spark | Spark Open | mock)
                                                              │  {action…} or {clarify:{candidates}}
                                                              ▼
                                       V1 schema ─► V2 legality + Marlow's KNOWLEDGE ─► refuse / clarify (template)
                                                              │ one legal action
                                                              ▼
              ┌─────────────────────────────────────────────────────────────┐
              │  ENGINE (pure TS, seeded RNG): step(state, action)          │  ◄── the only thing that changes the world
              │  → new state + events (perceived: true/false)               │
              └───────────────┬─────────────────────────────┬───────────────┘
                              ▼                             ▼
      narrate(): template line ids → pre-rendered      Director (beats.json, ≤2/turn)
      Kokoro audio + text log                          cues(): world sounds from PERCEIVED events only
                              ▼
        Web Audio: earpiece bus (300 Hz–3.4 kHz + static) │ world bus (HRTF panner, room reverb, occlusion,
                   moving guard arc, ducking −9 dB under Marlow's voice) │ music (calm bed, tension at alert ≥ 1)
```

Rules the code enforces (each has a test): the engine owns truth; truth flows engine → narration / audio / images, never back; all factual speech is template-based; every sound is a perception event; the world is frozen during a turn; every async reply carries a turn ID and stale replies are discarded; same seed + same action log = identical event log.

### Layers

| Layer | Where |
|---|---|
| L0 state + L2 rules/perception | `packages/engine` (no I/O) |
| L1 input: local parser, intent adapters, V1/V2 | `packages/game/src/{parser,intent,verify}.ts` |
| L3 Story Director, beats, V0 | `packages/game/src/director.ts`, `data/beats.json` |
| L4 narration (templates) | `packages/game/src/{narrate,lines}.ts`, `data/lines.json` |
| L5 audio renderer | `web/src/audio.ts` |
| L6 mission author (offline) | `tools/author-mission.ts` |
| L7 log + memory | `Session` (runs/*.jsonl), `web/src/storage.ts` |
| Case File | `server/src/casefile.ts`, `tools/casefile.ts` |

### Verification

| Check | Verifies | On failure |
|---|---|---|
| V0 | beat/line/cue ids exist, rooms reachable, ledger takeable, exit reachable (`validateLevel`, `validateBeats`) | reject file, use hand-written beats |
| V1 | intent reply is exactly one valid shape | retry once, then "Say again, boss?" |
| V2 | target is in Marlow's knowledge and the action is legal now | template refusal/clarify, state unchanged |
| V3 | `tools/eval.ts`: intent accuracy, invalid accepted (0), determinism (100%) | fix before demo |

## Model usage

| Model | Job | Status in this repo |
|---|---|---|
| Muse Voice Transcribe | push-to-talk speech to text | adapter stub (`server/src/adapters/stt.ts`); endpoint known, request shape pending; browser speech / typed fallback works today |
| Muse Spark (Meta Model API) | one action JSON or clarify candidates, low reasoning effort | adapter stub; request shape pending (see `TODO(docs)`); deterministic mock used meanwhile |
| Muse Spark Open (Baseten `meta-models/muse-spark-open-1026`) | same, alternate backend | adapter stub; docs pending |
| Muse Wonder | offline beat/cue selection, V0-gated | `tools/author-mission.ts --validate` works; `--generate` pending |
| Muse Image (+ SAM 3.1 / Spark verify) | Case File panels | adapter stub; engine-drawn placeholder frames used meanwhile; `VERIFY_ART=1` stub |
| Kokoro-82M | offline TTS of every template line | `tools/render-lines.ts` (manifest + render); no runtime TTS |

Nothing here guesses a provider API shape: unread request parameters are marked `TODO(docs)` and the game stays playable behind adapters.

## Metrics

See [metrics.md](metrics.md) (regenerate with `npm run eval`). Numbers for the Meta / Baseten backends and transcription error rate fill in once keys and recorded audio exist; the mock backend's accuracy only shows the pipeline is wired, not how good Muse is.

## Setting

Real places, if ever mentioned, are settings only. All characters, targets and institutions are fictional.
