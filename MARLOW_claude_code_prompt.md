# MARLOW — Build Brief for Claude Code

You are the lead engineer on **MARLOW**, a game being built for the Meta Global AI Developer Hackathon (Indie track). Submission is due **Wed Nov 4, 2026, 9:00 PM ET**. The repo must be **public**, all work must be **new during the hackathon**, and we need a **3-minute demo video**. Work milestone by milestone, keep the build always runnable, and commit after every working step.

---

## 1. What MARLOW is

A **screenless, binaural heist radio-drama you play by voice**.

- The player is **Owl**, a blind former safecracker who now runs jobs from a van by ear. Owl's edge is experience and attention (counting footsteps, knowing what a door sounds like), **not** superhuman hearing. Never write the "blind superpower" trope.
- **Marlow** is the operative inside the building. She is the only one who can see, and she only knows what she has perceived.
- The player hears the building in 3D through Marlow's collar mic, gives orders by push-to-talk, and hears the results.
- After each run, the game produces a **Case File**: a short illustrated comic of the run for sighted friends ("for once, they're the ones who need a description").

Pitch line: *Muse understands what you say. A deterministic engine decides what actually happens. Your only map is what your partner can tell you.*

## 2. Non-negotiable rules (the product depends on these)

1. **The engine owns truth.** Only the rules engine changes world state. Nothing a model produces changes the world except a validated action.
2. **Truth flows one way:** engine → narration, engine → audio, engine → images. Never image → engine, never model prose → engine.
3. **All factual speech is template-based.** No free-form model text is ever spoken as fact. Clarification questions are templates too (the model names candidate IDs; a template speaks them).
4. **Every sound the player hears is a perception event.** The audio layer never reveals something Marlow has not perceived.
5. **World is frozen during a turn.** From push-to-talk until the action resolves, state does not advance. Only ambience and sounds of the *current* perceived state may play.
6. **Every async model reply carries a turn ID.** Replies for a timed-out or superseded turn are discarded.
7. **Determinism:** all randomness comes from one seeded RNG in the state. Same seed + same action log → identical event log.
8. **Never invent API parameters.** For every Meta / Baseten / Fireworks call, read the official docs first (dev.meta.ai docs, Baseten docs for `meta-models/muse-spark-open-1026`). If something is unclear, stub it behind an adapter, write a TODO, and ask me.
9. **Never commit secrets.** Keys live in `.env` (gitignored); provide `.env.example`.
10. **Licenses:** only CC0, Apache-2.0, MIT, or clearly royalty-free assets. No NC (non-commercial) models or assets. Log every asset in `CREDITS.md` with source URL and license.

## 3. Tech stack

- **Frontend:** Vite + TypeScript, no heavy framework (vanilla or a tiny one). Web Audio API for all sound.
- **Server:** Node + TypeScript (Hono or Fastify). Holds API keys, proxies model calls, writes run logs.
- **Tests:** Vitest.
- **TTS:** Kokoro-82M run **offline** via a script to pre-render every template line to audio files. No TTS at runtime. Fallback: a recorded voice bank with the same file names.
- **Models (behind adapters):**
  - Speech-to-text: **Muse Voice Transcribe** (Meta Model API). Fallbacks: browser speech recognition, then typed input.
  - Intent: **Muse Spark** via Meta Model API (documented low reasoning-effort setting) **or** **Muse Spark Open** via Baseten (`meta-models/muse-spark-open-1026`). Selectable by config. Also a deterministic mock for tests.
  - Mission authoring (offline, optional): **Muse Wonder**.
  - Case File art: **Muse Image**. Optional verification with **SAM 3.1** + Spark behind a flag.

## 4. Repo layout

```
marlow/
  README.md            # what, how to run, what was built during the hackathon, model usage
  CREDITS.md           # every asset + license
  PROGRESS.md          # update at the end of every milestone
  .env.example
  data/
    level.json         # rooms, doors, props, guard, objective
    lines.json         # template bank: id -> text variants (for my review)
    beats.json         # hand-written beat sheet (default)
    beats.wonder.json  # optional, only if it passes V0
    eval/commands.jsonl
  assets/
    audio/lines/       # pre-rendered Kokoro files (generated)
    audio/sfx/  audio/music/  audio/ir/
  packages/
    engine/            # pure TS: state, rules, perception, RNG, validators (no I/O)
    shared/            # schemas (zod), types
  server/              # API proxy, adapters, logging, case-file generation
  web/                 # game client: input, audio renderer, text log, settings
  tools/
    render-lines.ts    # Kokoro offline pre-render
    author-mission.ts  # Wonder -> beats.wonder.json (+ V0)
    eval.ts            # regression harness -> metrics.json + metrics.md
    replay.ts          # replay a run log, assert identical events
```

## 5. World model (L0)

Use zod schemas in `packages/shared`. Starting point:

```json
{
  "seed": 1234, "turn": 0, "alert": 0, "trust": 50, "status": "playing",
  "rooms": [{"id": "lobby", "pos": [0,0], "reverb": "marble", "spokenName": "the lobby"}],
  "doors": [{"id": "door_lobby_hall", "between": ["lobby","hall"], "side": {"lobby":"ahead","hall":"behind"}, "state": "closed"}],
  "props": [{"id": "case_1", "room": "gallery", "side": "left", "tags": ["hide"], "spokenName": "the display case"}],
  "items": [{"id": "ledger", "room": "office", "spokenName": "the ledger"}],
  "guard": {"id": "g1", "route": ["stairwell","hall","gallery","hall"], "step": 0},
  "marlow": {"room": "lobby", "facing": "north", "hidden": false, "carrying": null, "prevRoom": null},
  "knowledge": {"rooms": ["lobby"], "doors": ["door_lobby_hall"], "props": [], "items": [], "guardLastHeard": null},
  "objective": {"item": "ledger", "exitRoom": "lobby"},
  "memory": {"lastTrustLoss": null}
}
```

### V1 level (write `data/level.json`)
Five rooms: **lobby** (entry/exit), **hall**, **gallery**, **office** (ledger), **stairwell**. Connections: lobby–hall (door), hall–gallery (open arch), hall–office (door), hall–stairwell (door). Hide spots: display case in gallery, desk in office. No hide spot in the hall (that's the tension). Guard loops stairwell → hall → gallery → hall → stairwell. Seeded RNG picks the guard's starting step.

### Spatial model
Each room has a grid `pos`; each door/prop has a `side` relative to its room; Marlow has a `facing` updated by her last move. Compute direction (`ahead | behind | left | right`) and distance (`near` = same/adjacent room, `mid` = 2 hops, `far` = 3+) from these. Audio and spoken direction both use this one computation.

## 6. Actions (exactly seven, one per turn)

| Action | Rule |
|---|---|
| `move(room)` | Target must be adjacent **and** its connection known. Through a closed door: makes noise (guard hears if ≤1 hop → alert +1) unless `stance:"quiet"`, which costs 2 guard steps instead of 1. Updates facing, prevRoom, knowledge. |
| `peek(door)` | Door must be known and in current room. Reveals the adjacent room's contents into knowledge. |
| `listen` | Reports guard direction/distance if within 2 hops, else "quiet". |
| `wait` | Nothing; guard advances. |
| `hide` | Current room must have a known `hide` prop. Hidden until next move. |
| `take(item)` | Item must be in current room and known. |
| `exit` | Must be in `exitRoom` carrying the objective item → status `won`. |

Local parser (no model call) handles: wait, stop (= wait), go back (= move to prevRoom), listen, hide, yes, no, repeat (replays last line), and exact room names.

After every resolved action: guard advances its step(s); if guard and Marlow share a room and Marlow is not hidden → **spotted**: alert +2, trust −10, `memory.lastTrustLoss="spotted"`. Alert ≥ 3 → status `caught`.

### Trust rules (start 50, clamp 0–100)
| Event | Change |
|---|---|
| Marlow spotted | −10 |
| Player orders a move on the turn right after Marlow warns of the guard | −5 |
| Player waits/hides right after a warning | +5 |
| Ledger taken | +5 |
| Exit with alert ≤ 1 | +10 |
Trust below 30 switches Marlow to a curter template set. It never changes game rules. Persist trust and `lastTrustLoss` between runs (localStorage + server log). Run 2 opens with a callback template built from them.

## 7. Layers

- **L0 State**, **L2 Rules + perception**: `packages/engine`, pure functions `step(state, action, rng) -> {state, events}`. No I/O.
- **L1 Input**: push-to-talk (hold Space or a big on-screen button; keyboard and screen-reader accessible). STT adapter → final transcript only (partials may display, never execute). Local parser first; else intent adapter.
- **Intent prompt contract**: send the transcript, Marlow's knowledge as a list of `{id, spokenName, type}`, the current room, and the JSON schema. Response must be exactly one of:
  `{"action":"peek","target":"door_lobby_hall","stance":"quiet"}` or `{"clarify":{"candidates":["door_a","door_b"]}}`. Use schema-constrained JSON output per the docs. No confidence field.
- **L3 Story Director**: loads `beats.json` (or `beats.wonder.json` if enabled and V0-valid). Each beat: `{id, trigger, lineIds, cueIds, once}`. Fires ≤ 2 beats per turn. Story may only use pre-declared scheduled events from `level.json` to touch state.
- **L4 Narration**: maps events → template line IDs (variant chosen by seeded RNG) → pre-rendered audio file + text for the log.
- **L5 Audio renderer** (see §9).
- **L6 Mission author** (offline tool, optional).
- **L7 Log/memory**: append every turn `{turnId, transcript, parsed, validation, action, events, lineIds, latencies}` to `runs/{runId}.jsonl`.

## 8. Verification (V0–V3)

| Check | Where | Verifies | On fail |
|---|---|---|---|
| V0 offline mission | load/tools | beat triggers + line/cue IDs exist; all rooms reachable (BFS); ledger takeable; exit reachable | reject file, use hand-written beats |
| V1 schema | every intent reply | zod-valid, exactly one shape | retry once, then template "Say again, boss?" |
| V2 legality + knowledge | before engine | target in Marlow's **knowledge**, action legal now, unambiguous | template clarify/refusal; **state unchanged** |
| V3 regression | `tools/eval.ts`, CI | see §11 | fix before demo |

Plus the **turn-ID guard**: any reply whose `turnId` ≠ current turn is dropped and logged.

## 9. Audio (the experience — treat as a first-class feature)

- **Earpiece bus**: Marlow's pre-rendered voice files → band-pass (~300 Hz–3.4 kHz) + faint static → centered, close. Radio click + short ack ("Copy.") plays instantly on push-to-talk release.
- **World bus**: `PannerNode` with `panningModel="HRTF"`. Position from the spatial model (azimuth from direction, distance → gain + low-pass). Per-room `ConvolverNode` reverb from IR files (marble = long, office = dry, stairwell = metallic). **Occlusion**: extra low-pass when a closed door lies between source and Marlow. Footstep material per room.
- **Moving sources** (guard footsteps traverse an arc when the guard moves) to reduce front/back confusion.
- **Ducking**: world + music drop ~8–10 dB under Marlow's voice (tune by ear).
- **Music**: two CC0 stems max in V1 — calm bed, tension layer fading in at alert ≥ 1.
- **Cue priority**: danger cues > everything except Marlow's voice; never overlap two important cues.
- **Every cue also goes to the text log** (`aria-live="polite"`) with spoken-direction wording ("Footsteps, behind left, near").
- **Settings**: separate voice / music / SFX sliders, mono toggle, captions toggle.
- Ambience during model wait: rain, HVAC hum, Marlow breathing, guard pacing **at current position only**. Hard timeout (configurable, start 4 s): static burst + "Signal's bad, say again?", state unchanged.
- If an asset is missing, synthesize a placeholder tone so nothing breaks; list it as TODO in `PROGRESS.md`.

## 10. Story & lines

Write `data/lines.json` (I will review and edit). Cover every event type with 3–5 variants, plus: mission intro (client phone call), clarify templates for every ambiguous pair in the level, refusals ("There's no door there, boss."), warnings, spotted, caught, win, run-2 callback lines per `lastTrustLoss`, low-trust curt variants.

Tone samples:
- Marlow: "You heard him before I saw him. Again."
- Client (intro call): "They said you retired. They said you can't do this anymore."
- Twist beat when the ledger is taken: Marlow finds a tape in the drawer labeled with the date of the night Owl lost his sight. (Story only; no mechanics.)

Then `tools/render-lines.ts` renders every variant with Kokoro to `assets/audio/lines/{lineId}.{variant}.wav`. Check Kokoro's runtime dependencies' licenses and note them in `CREDITS.md`.

## 11. Metrics & eval (`tools/eval.ts`)

`data/eval/commands.jsonl`: `{id, audioPath?, saidText, state, expected}`. Produce `metrics.json` and `metrics.md` with:
- **Transcription error rate** (when audio present): transcript vs `saidText`.
- **Intent accuracy** given a correct transcript: parsed action vs `expected` (target ≥ 90%).
- **Latency** p50 / p95, release → first word of result.
- **Invalid actions accepted** by the engine (must be 0).
- **Clarification rate**.
- **Replay determinism** via `tools/replay.ts` across all saved runs (must be 100%).
Run eval against both intent backends (Meta API Spark, Baseten Spark Open) and report side by side.

## 12. Case File (post-run comic)

After a run ends: pick 4–6 key events from the run log (intro, first clarify, guard near, ledger taken, spotted or clean exit). For each, build an image prompt **from engine facts only** (rooms, props, positions, outcome) + a fixed visual style guide (noir, rain, high contrast, no real brands/people). Call **Muse Image** in a batch after play (never during). Caption = the template line Marlow actually spoke. Save to `casefiles/{runId}/` and render a shareable HTML page labeled "Illustrated from the run log." Optional flag `VERIFY_ART=1`: SAM 3.1 + Spark check each panel shows the key props; regenerate once on mismatch, else use a fallback frame. Cache everything.

## 13. Debug / demo mode

`?debug=1` shows the hidden engine map, Marlow's knowledge overlay, and the live event log (for the split-screen in the demo video). Never visible in normal play. Add a `?seed=` param for reproducible demo runs.

## 14. Accessibility requirements

- Fully playable without a screen: every state change is audible **and** in the text log.
- Keyboard-only and screen-reader-friendly menus/settings; typed input always available as an alternative to voice.
- No information conveyed by color or visuals alone.

## 15. Milestones (do them in order; each must pass its acceptance check before moving on)

1. **M1 — Access + engine (Day 1).** Script `tools/check-access.ts` that calls each API once (Spark, Voice Transcribe, Wonder, Image, Baseten Spark Open) and prints pass/fail; I record a go/no-go. Engine with all seven actions, level.json, typed command input in a minimal page. *Accept:* unit tests for every action rule; seeded replay test passes.
2. **M2 — One voice turn (Day 2).** Push-to-talk → STT → local parser/intent → V1/V2 → engine → text result. Timing logged. *Accept:* p50/p95 latency printed; turn-ID guard tested.
3. **M3 — World audio (Day 3).** Spatial model, HRTF, reverb, occlusion, guard arc, text-log mirroring. *Accept:* blindfold test — I can locate the guard left/right/ahead/behind from audio alone in ≥ 8 of 10 trials.
4. **M4 — Earpiece (Day 4).** Kokoro pre-render pipeline, radio filter, ack, ambience, timeout, ducking. *Accept:* full run playable by voice with no runtime TTS.
5. **M5 — Clarify + eval (Day 5).** Clarify templates, both intent backends, `tools/eval.ts`, `metrics.md`. *Accept:* invalid actions accepted = 0; determinism = 100%.
6. **M6 — Story + memory (Day 6).** beats.json, Director, trust rules, run-2 callback, optional Wonder authoring with V0. *Accept:* two consecutive runs where run 2 references run 1.
7. **M7 — Case File + polish (Day 7).** Muse Image comic, debug mode, settings, music stems. *Accept:* case file generated for a full run; playtest notes in PROGRESS.md.
8. **M8 — Ship (Day 8).** README (setup, architecture diagram, model usage table, "built during the hackathon" section, metrics table), CREDITS.md complete, demo seed ready, repo public.

**Cut order if behind:** VERIFY_ART → Wonder authoring → second music stem → Case File (last resort). **Never cut:** V1/V2, turn-ID guard, replay test, ducking, text-log mirroring.

## 16. How to work with me

- Start by reading this brief, proposing the repo skeleton, and listing any API details you need from the docs before writing adapters.
- After each milestone: run tests, update `PROGRESS.md` (done / next / blockers / measured numbers), commit with a clear message.
- Ask me before: adding any paid service, adding any dependency with a non-permissive license, changing the seven actions or the rules in §2.
- When unsure about an external API, build the mock first, keep the game playable, and flag the open question.
