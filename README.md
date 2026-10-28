# MARLOW

**A screenless, binaural heist radio-drama you play by voice.** You are Owl, a blind former safecracker running a job from a van by ear. Marlow is the operative inside the building, and she is the only one who can see. You hear the building in 3D through her collar mic, give orders by push-to-talk, and hear what happens. Afterwards the game draws a **Case File**: a short comic of your run for sighted friends.

> Muse understands what you say. A deterministic engine decides what actually happens. Your only map is what your partner can tell you.

Built for the Meta Global AI Developer Hackathon (Indie track). **All code, data and tooling in this repo were written during the hackathon.** See [PROGRESS.md](PROGRESS.md) for status and open items, [CREDITS.md](CREDITS.md) for assets and licenses.

## Run it

```bash
npm install
npm test                # engine, pipeline, session, adapters (request shapes), case file
npm run server          # optional: API proxy, run logs, Case File (port 8787)
npm run dev             # game on http://localhost:5173  (add ?debug=1&seed=7)
npm run eval            # V3 regression harness -> metrics.json + metrics.md
npm run replay          # replay every runs/*.jsonl and assert identical event logs
npm run check-access    # real calls to Spark, Voice Transcribe, Baseten (--image, --wonder opt-in)
npx tsx tools/path-share.ts # local-parser vs model-call share of a scripted run
# real-speech eval: npm run server, open http://localhost:5173/record.html, record the 50 commands, then npm run eval
npx tsx tools/simulate.ts   # balance: cautious / reckless / expert over 1000 seeds
```

Copy `.env.example` to `.env` for keys. **The game is playable with no keys**: typed input or browser speech recognition, an in-browser deterministic intent mock, placeholder tones where pre-rendered voice lines are missing. With keys and `npm run server` it uses Muse Voice Transcribe and the Spark backend you pick. Headphones recommended.

Controls: hold **Space** or the big button to talk; or type. Try "listen", "go to the hall", "peek the left door quietly", "take the ledger", "go back", "exit". Ambiguous orders get a spoken clarifying question; impossible ones get a refusal and the world does not change. If the guard spots Marlow he runs at her: you get exactly one turn to hide or leave the room.

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

| Model | Job | Status (measured 2026-10-28) |
|---|---|---|
| Muse Voice Transcribe (`muse-voice-transcribe-1.0`) | push-to-talk speech to text; browser sends 16 kHz mono WAV | **live**: `POST /v1/asr/transcribe`, ~0.7 to 1.1 s |
| Muse Spark (`muse-spark-1.3`) | one action JSON or clarify candidates; `reasoning_effort: minimal`, strict json_schema with a per-request enum of known ids | **live**: ~2.6 s p50, 6.6 s p95 in `npm run eval` |
| Muse Spark Open (Baseten `meta-models/muse-spark-open`) | same task, alternate backend (JSON mode) | **live**: 0.8 s p50, 7.7 s p95 |
| Muse Image (`muse-image-1.0`) | Case File panels from engine facts, after play only | **live**: ~12 s per panel, 5 panels per run |
| Muse Wonder | offline beat/cue selection, V0-gated | not used; `tools/author-mission.ts --validate` works, hand-written beats ship |
| SAM 3.1 + Spark vision (`VERIFY_ART=1`) | verify art shows the engine's props | stub |
| Kokoro-82M | offline TTS of every template line | `tools/render-lines.ts` (339-file manifest); not yet rendered; no runtime TTS |

Pick the intent backend with `INTENT_BACKEND=mock|meta|baseten`. Spark counts reasoning tokens against `max_completion_tokens`, so the adapter asks for 1200. Baseten serves the model as `meta-models/muse-spark-open` (the `-1026` suffix from the original brief is rejected).

## Metrics and balance

- [metrics.md](metrics.md) (`npm run eval`): intent accuracy on 50 commands for the mock, Spark and Spark Open side by side, invalid actions accepted (0), adversarial V2 check (2000 bad replies, 0 illegal reached the engine), replay determinism.
- [simulation.md](simulation.md) (`npx tsx tools/simulate.ts`): 1000 seeded runs per policy. Reckless players are caught often and rarely win cleanly; an expert that tracks the guard's loop from what Marlow hears wins cleanly every time.

## Setting

Real places, if ever mentioned, are settings only. All characters, targets and institutions are fictional.
