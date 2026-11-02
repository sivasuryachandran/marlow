# MARLOW

**A screenless, binaural heist radio-drama you play by voice.** You are Owl, a blind former fixer running a job from a van by ear. Marlow is the operative inside the building, and she is the only one who can see. You hear the building in 3D through her collar mic, give orders by push-to-talk, and hear what happens. Afterwards the game draws a **Case File**: a short comic of your run for sighted friends.

> Muse understands what you say. A deterministic engine decides what actually happens. Your map only shows what Marlow has seen.

Built for the Meta Global AI Developer Hackathon (Indie track). **All code, data and tooling in this repo were written during the hackathon.** See [PROGRESS.md](PROGRESS.md) for status and open items, [CREDITS.md](CREDITS.md) for assets and licenses.

## How to play (2 minutes)

You need **Chrome** (or another Chromium browser), **headphones** (the whole game is 3D sound, so stereo headphones matter), and Node 20+.

```bash
git clone https://github.com/sivasuryachandran/marlow.git
cd marlow
npm install
npm run dev          # then open http://localhost:5173/?seed=7
```

1. Put your headphones on, click **Start**, and allow the microphone when Chrome asks.
2. A client phones in, then Marlow, your operative inside the Hale Gallery, tells you where she is. You are **Owl**, who cannot see. You only know what Marlow tells you and what you hear in her earpiece.
3. **Hold the big button (or hold Space) and speak an order**, then release. Or type in the box. Try:
   `listen` · `what do you see` · `go to the hall` · `peek the left door` · `quietly go to the office` · `hide` · `take the ledger` · `go back` · `exit`
4. Ask Marlow questions any time (they are free and use no turn): `who is Ines`, `where can I hide`, `what's in the ledger`.
5. Get the **ledger** from the office and **exit through the lobby** without being caught. The guard hears noisy doors and walks toward them. If he spots Marlow he runs at her and you have exactly one turn to hide or leave the room. **Taking the ledger sets off a silent alarm**: you have 10 moves to get her out before the building seals. The top bar counts down and the alarm pulses faster; waiting for the guard to leave no longer works.
6. If you win, Marlow asks what to do with the tape she found: say **"burn it"** or **"send it"**.

The screen is the **Van Cockpit**: a sonar showing only sounds Owl has actually heard (never the guard's true position), the earpiece waveform, Marlow's last words, clickable choices when she asks "which door?", tactical chips (keys 1-7), and an "Audio only" mode (key O) that hides every visual panel. Story moments appear as illustrations made with Muse Image. The Spectator/Debug tab shows the ground truth, behind a spoiler button.

While Marlow is talking, **Skip** (or Escape) cuts her off, and a new order always does. Marlow's voice lines are bundled (`assets/audio/lines/*.mp3`), so a fresh clone talks. Sound effects and music are generated in the browser. Tips: short orders work best; Marlow answers "say again" to small talk; in Settings you can turn on rain and room ambience, mono audio, and captions.

**Solo, two ways.** *By ear* (press AUDIO ONLY or key O): every visual panel hides and you play on sound alone, as a blind player would. *With eyes*: the cockpit shows the scope (sounds you have heard) and **the map, which fills in as Marlow explores**: only rooms she has seen, her position, the doors and cover she knows. The guard is never on it. You work out where he is from the scope and from what you hear.

**Play with a friend: one sees, one listens.** For a one-window demo of both roles, open `http://localhost:5173/split.html` (listener on the left, seer on the right, already connected). `PLAYTEST.md` is the protocol for testing it with two real people; it has not been run yet. Run `npm run server` too, start the game, and press **CO-OP: SEER LINK** in the top bar. You get a four-letter room code and a link. Your friend opens the link and sees the whole building, including where the guard really is, plus everything you hear as text. You keep playing by ear; they can't give orders. Talk to each other on a phone or voice call. **Security note:** the game server has no login. It now rate-limits and size-caps the endpoints that cost credits, but do not expose it to the internet, and know that `npm run dev:lan` lets anyone on your Wi-Fi reach it. On the same Wi-Fi, start the game with `npm run dev:lan` and the panel shows the address your friend should open. (A friend elsewhere needs the game hosted somewhere you can both reach, for example a tunnel.)

**New cases from real heists.** In the Briefing tab, *Choose your case* lists the built-in story and any generated ones; *Write a new case* picks a real heist from the case library (or takes a description), researches it on Wikipedia, and asks Muse Spark to adapt it into a new building and story with invented names. The game's code then builds the level itself (door walls and the guard's route are computed, not written by the model), checks it (valid building, story triggers, no real names, lines in each speaker's own voice), and tunes the guard's schedule by simulating hundreds of runs until careful play wins and reckless play can't win cleanly. Failures go back to Spark with the exact problems, up to three tries. Then the voices (Kokoro, local) and stills (Muse Image) are rendered. From the command line: `npm run mission -- --list`, then `npm run mission -- --case=gallery1990 --voices --art`, and play at `/?mission=<id>`. Each mission folder has a `report.md` saying how it was checked.

**With no API keys** the game still runs: speech uses Chrome's built-in recognition and understanding uses a small offline parser (fewer phrasings). **With keys** (`cp .env.example .env`, fill `MODEL_API_KEY`, then `npm run server` in a second terminal and `npm run dev`) it uses Muse Voice Transcribe and Muse Spark for natural phrasing, and the mic listens hands-free (no button to hold).

## Run it (developer commands)

```bash
npm install
npm test                # engine, pipeline, session, adapters (request shapes), case file
npm run server          # optional: API proxy, run logs, Case File (port 8787)
npm run dev             # game on http://localhost:5173  (add ?debug=1&seed=7)
npm run eval            # V3 regression harness -> metrics.json + metrics.md
npm run replay          # replay every runs/*.jsonl and assert identical event logs
npm run check-access    # real calls to Spark, Voice Transcribe, Baseten (--image opt-in; --wonder only probes access, Wonder is not used)
npx tsx tools/path-share.ts # local-parser vs model-call share of a scripted run
# real-speech eval: npm run server, open http://localhost:5173/record.html, record the 50 commands (kept out of git; your own voice), then npm run eval
npx tsx tools/simulate.ts   # balance: cautious / reckless / expert over 1000 seeds
```

Copy `.env.example` to `.env` for keys. **The game is playable with no keys**: typed input or browser speech recognition, an in-browser deterministic intent mock, the voice lines are bundled (rendered offline with Kokoro, see below). With keys and `npm run server` it uses Muse Voice Transcribe and the Spark backend you pick. Headphones recommended.

Controls: hold **Space** or the big button to talk (with the server and a key the mic is always listening); or type. Try "listen", "go to the hall", "peek the left door quietly", "take the ledger", "go back", "exit". Ambiguous orders get a spoken clarifying question; impossible ones get a refusal and the world does not change. If the guard spots Marlow he runs at her: you get exactly one turn to hide or leave the room.

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

What actually runs today. Dates are when the number was measured; "Spark" below means `muse-spark-1.3` on the Meta Model API.

| Model | Runs in the game? | Its job | Evidence |
|---|---|---|---|
| Muse Voice Transcribe | **Yes**, when the server has a key (otherwise Chrome's own speech recognition) | Speech to text for your orders (16 kHz mono WAV) | Word error rate 7.8% on 50 of my own recordings and 7.9% on 30 held-out ones (2026-11-01; it varied 7.8 to 11.3% across runs); latency p50 761 ms, p95 940 ms |
| Muse Spark (`muse-spark-1.3`) | **Yes**, the default intent backend when a key is set | (1) turns an order into one action or a clarifying question (strict JSON schema, code verifies it); (2) writes new missions for the generator | Order understanding on correct transcripts: 94 to 100% across four dev runs on 2026-11-01 (latest 94%, all misses were timeouts or one-off wobbles), 93.3% on the 30 held-out commands after a bug fix; 0 wrong-target and 0 illegal actions in every run. Latest dev latency p50 1.84 s, p95 8.0 s. Mission generation: see [generation-stats.md](generation-stats.md) |
| Muse Image (`muse-image-1.0`) | **Not during play.** Pre-generated art, plus the optional Case File | Painted story stills (12), interface art (13: poster, cast portraits, paper, floors), each generated mission's stills, and the post-run Case File comic (needs the server) | About 6 to 15 s per image; list price $0.01 per image |
| Muse Spark Open (Baseten `meta-models/muse-spark-open`) | **Optional**, `INTENT_BACKEND=baseten`; not the default and not used in the demo | Same task as Spark, alternate backend | Last measured 2026-10-28: 90% on the dev set, 76.7% on the held-out set (below my 90% bar), p50 1.4 s, p95 9.8 s. **Not re-run since the later fixes** |
| Muse Wonder | **No** | Nothing. No code path calls it | `check-access` can probe it; that is all |
| SAM 3.1 | **No** | Nothing. An empty `verifyPanel` stub exists in `server/src/adapters/image.ts` and does nothing | n/a |
| Kokoro-82M (**not a Meta model**; local, Apache-2.0 weights via `kokoro-js`) | Offline, at build time only | Renders every spoken line (Marlow, the client): 542 lines for the built-in story, plus each mission's own. Compressed to MP3 and committed. **No text-to-speech runs while you play** | `tools/render-lines.ts`, `tools/compress-lines.sh` |

Pick the intent backend with `INTENT_BACKEND=mock|meta|baseten`. Spark counts reasoning tokens against `max_completion_tokens`, so the adapter asks for 1200 for orders and 9000 for mission authoring. Baseten serves the open model as `meta-models/muse-spark-open` (the `-1026` suffix from the original brief is rejected).

## Evaluation data and privacy

`data/eval/commands.jsonl` (50 dev commands) and `data/eval/heldout.jsonl` (30 frozen held-out commands) are published. **The voice recordings of those commands are not published, for privacy**: `data/eval/audio/` and `data/eval/heldout-audio/` are gitignored and were purged from git history; the repo keeps only the text and the recorder page (`/record.html`, `/record.html?set=heldout`) so anyone can record their own. The held-out set is never used for tuning prompts, parsers or keywords and is reported separately (`npm run eval:heldout` → `metrics.heldout.md`).

## Metrics and balance

Each file is generated by a command and carries its own date. Numbers here are copied from them on 2026-11-01; if a file is newer than this README, trust the file.

- [metrics.md](metrics.md) (`npm run eval`, 2026-11-01): 50 dev commands. Spark 94%, 0 wrong-target, 0 illegal; speech 7.8% word error; end to end from speech 92%. Latency p50 1.84 s, p95 8.0 s (the API was slow that run: 3 timeouts above 8 s). Spark Open is not in this run.
- [metrics.heldout.md](metrics.heldout.md) (`npm run eval:heldout`, 2026-11-01): 30 frozen commands. Spark 93.3% typed, 93.3% from speech, 0 wrong-target. One case ("head out") exposed a real bug and was fixed, so it is no longer a clean held-out case (disclosed in the file).
- Safety checks in `metrics.md`: 41,040 hallucinated or wrong-target model replies, 0 executed against a target the phrase does not name; 2,000 illegal replies, 0 reached the engine; replay determinism 100% of generated runs.
- [simulation.md](simulation.md) (`npx tsx tools/simulate.ts`, 2026-11-01): six simulated players, 1000 runs each, including the new silent alarm (10 moves). Waiting players are always caught; careful and expert players win; rushing players win but never cleanly. It is a measurement, not a target, and it says what it cannot tell you.
- [stress-results.md](stress-results.md) (`npx tsx tools/stress.ts`, 2026-11-01): fuzzing of the rules, the speech-to-action pipeline against a hostile model, the parser, the mission builder and the Seer relay, plus a live adversarial batch against Muse Spark (26 attacks, 0 violations) and HTTP/browser abuse. It found 4 real problems (all fixed, each with a regression test) and lists what it did not cover.
- [generation-stats.md](generation-stats.md): every mission-generation run, failures included: attempts, rejection reasons, repairs, time, tokens and estimated cost.
- Tests: `npm test` (165 passing on 2026-11-01, including a small stress suite), `npm run typecheck`, `npm run build`.

**Not measured:** how real players, and especially blind or low-vision players, find it; how the audio sounds to anyone; real screen readers. See [EVALUATION.md](EVALUATION.md).

## Setting

Real places, if ever mentioned, are settings only. All characters, targets and institutions are fictional.
