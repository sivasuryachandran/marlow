# PROGRESS

Status date: 2026-10-28 (evening). Real Meta model calls are now wired and measured.

## Go / no-go (recorded)

`npm run check-access` with the supplied keys: **PASS** Muse Spark `muse-spark-1.3` · **PASS** Muse Voice Transcribe · **PASS** Baseten `meta-models/muse-spark-open` · Muse Image PASS (real Case File generated, ~12 s/panel) · Muse Wonder not tested (optional, unused). **Go.**

Stage-one requirement ("real use of Meta models") is now met by: Voice Transcribe (speech → text), Muse Spark (speech → one legal action or a clarify question), Muse Image (Case File), plus Spark Open on Baseten as the alternate backend.

## Matched-phrase check (wrong-target bug fixed)

"Peek the vault door" → a real door was a bug (a model, or a mishearing, executing a legal action aimed at the wrong thing). Now every move / peek / take reply must carry `matched`: the exact words of the order that name the target. Code (V2b, `packages/game/src/match.ts`) requires that the quote (1) is in the transcript, (2) names the target by spokenName, an alias from `level.json` (e.g. ledger: book, logbook; office: study; stairwell: stairs), or the room beyond a door, and for a bare room word names the **destination** (so "go to the lobby" in the lobby never means the lobby door), (3) agrees with any side word (left/right/ahead/behind), and (4) for generic phrases ("the door") fits exactly one candidate, otherwise it asks a template clarify. A quote that isn't in the order is a broken model contract: retry once, then "Say again". A mismatch becomes the existing refusal template. Note: Marlow can't say "There's no vault door" because every spoken line is pre-rendered from templates, so it says "There's nothing like that here, boss."

- **Wrong-target stress:** 31,920 replies (3 verbs × every phrase × every possible target × 5 rooms × partial/full knowledge): 200 executed legitimately, **0 wrong-target**, **0 with a quote not in the order**. First version of the matcher failed this test with 18 and 20 wrong-target executions (e.g. "go to the lobby" while in the lobby moving to the hall; "take the door" taking the ledger); both were fixed before the numbers above.
- Eval metric "Wrong-target actions executed (must be 0)" is in `metrics.md` for every backend, on correct transcripts and on real speech: **0 / 0 / 0**.
- Dev set (50, tuned on): Spark 98%, Spark Open 90%, end-to-end from real speech Spark 94% / Spark Open 92% / mock 96%, word error rate 9.2% (7.8% in the previous run on the same clips: the recognizer is not fully deterministic).
- **Held-out set (30 new commands, frozen before the first run, never tuned on), `metrics.heldout.md`:** **Spark 96.7%** · **Spark Open 76.7%** (below the 90% target; 2 of the 7 misses were 8 s eval timeouts, the rest "Say again"), wrong-target 0 on both, engine-illegal 0. I did not investigate or fix the Spark Open misses, to keep the set clean. Anything tuned from here on needs a fresh held-out set. Held-out audio isn't recorded yet (`/record.html?set=heldout`, 30 clips).

## Requested report (current numbers)

- **Chase rule:** live and tested (7 engine tests). Spotted = alert +2, trust −10, then exactly one turn to hide at known cover or leave the room, otherwise caught; refused orders don't use the turn.
- **Simulator, 1000 seeds (expert 150):** reckless **43.4% win / 18.4% clean**, caught 56.6% · cautious-simple **50.7% win / 44.1% clean**, caught 49.3% · expert 100% clean, 0 alerts.
- **Spark Open latency (same 50 commands):** p50 0.8 to 1.4 s, p95 7.5 to 9.8 s across four runs (latest 1.4 s / 9.8 s); Spark p50 1.7 to 2.6 s, p95 3.7 to 6.6 s (latest 1.7 s / 3.7 s). Held-out (30): Spark 1.9 s / 3.8 s, Spark Open 3.1 s / 10.3 s.
- **Local parser share, seed-9 demo run:** 8 of 11 turns (73%) local, 3 (27%) model calls.
- Fireworks: key stored in `.env` only; not wired, per your call.

## Real-speech eval (50 recordings of the player's own voice)

| | Before fixes | After fixes |
|---|---|---|
| Muse Voice Transcribe word error rate | 16.3% (15 of 50 clips with an error) | **7.8%** (6 clips) |
| STT latency p50 / p95 | 839 / 1031 ms | 841 / 1123 ms |
| End-to-end speech → STT → intent → V1/V2: mock / Spark / Spark Open | 80% / 86% / 82% | **94% / 92% / 90%** |

What the errors were: "peek" heard as "pick" or "peak" (7 of the first 15 bad clips), stuttered words ("the the", "Listen,Listen,"), and a few one-offs ("peek the office door" → "peeked off his door", "head right" → "he tried tried"). Fixes applied: the documented `keywords` bias on the transcribe request (peek, ledger, room names, etc.), a "speech may be misheard, pick/peak mean peek" hint in the intent prompt (but "pick up" stays take), a repeat-collapsing transcript cleaner, and `pick` as a peek verb in the offline mock. Caveat: the keyword list and fixes were tuned against these same 50 clips, so the 7.8% is optimistic for a new speaker or accent; the real test is a second voice.

The one "executed although intended invalid" case is not an engine violation: "peek the vault door" heard as "peek the wall door" made Spark peek a real, legal door. Engine-illegal actions reaching the engine remain **0** (adversarial check, 2000 bad replies).

Fireworks key: stored in `.env` as `FIREWORKS_API_KEY` for later; not wired to anything (no use in the plan yet).

## Latest changes (decisions applied)

1. **Spotted = chase, not +3.** Being spotted still adds alert +2 and −10 trust, but now the guard runs at Marlow: the player has exactly one turn to **hide (known cover) or leave the room**, otherwise caught ("Too slow, boss"). A refused order (e.g. hide with no cover) doesn't use the turn. Slamming a closed door next to him adds noise alert, so quiet exits matter. New lines (`marlow.chase`, `.escaped`, `.caught`) and a chase cue (`sfx.chase`: fast footsteps + siren sweep, top priority, ducked music). 7 new engine tests.
   - Simulator, 1000 seeds (`simulation.md`): **reckless 43.4% win, 18.4% clean win**, 56.6% caught · **cautious-simple 50.7% win (44.1% clean)**, 49.3% caught (it now reacts to a chase; before that it was 44.1% / 44.1%) · expert 100% clean (150 seeds).
   - Honest read: the chase barely hurts reckless players (always moving already satisfies the rule); it punishes players who stop to wait or listen after being seen. Reckless still wins ~43% overall because the guard is often upstairs or far for the 6-turn dash. If "reckless rarely wins" is a hard goal, the remaining levers are route density near the objective or noise rules, not the chase.
2. **Model vs local parser, seed-9 demo run (11 turns):** 8 local (73%), 3 model calls (27%): "peek the vault door", "peek the door", "take the ledger" (`npx tsx tools/path-share.ts`).
3. **Baseten vs Spark latency** is side by side in `metrics.md` (latest full run: Spark p50 2.1 s / p95 5.0 s; Spark Open p50 0.9 s / p95 8.3 s on the same 50 commands). Spark Open is faster at the median, with a heavier tail.
4. **Prompt shrink experiment** (`knowledgeScope: "near"`: only this room, rooms behind its known doors, and their contents; late-game knowledge so the lists differ; same 50 commands): Spark p50 2171 → 2572 ms, p95 5747 → 8565 ms; Spark Open p50 1164 → 1062 ms, p95 8185 → 7340 ms; accuracy 92% → 96% on both. **No reliable latency gain** (differences are inside run-to-run noise): latency is dominated by network and reasoning, not by the ~14 knowledge entries. Kept as an option (`knowledgeScope`), default stays "all". Files: `metrics.full.md` vs `metrics.full.near.md`.
5. **Real-speech eval:** `npm run server` + open `http://localhost:5173/record.html` (Space starts/stops, R redoes the last, S skips). It saves `data/eval/audio/cNN.wav` (16 kHz mono) through the server. `npm run eval` then runs every clip through Muse Voice Transcribe, reports word error rate and STT latency, and re-scores each backend **from what was heard** (end-to-end). Pipeline smoke-tested with 3 macOS `say` clips (0% WER, STT p50 ~0.8 s); those test clips were deleted, so no real-speech numbers exist yet.

## What changed today

- **Adapters, from the official docs** (no guessing): Spark `POST /chat/completions` with `reasoning_effort`, strict `response_format: json_schema`; Voice Transcribe multipart `request` + 16 kHz mono WAV, reply `transcript`; Muse Image `POST /images/generations` (`b64_json`); Baseten OpenAI-compatible chat, JSON mode. Request shapes are pinned by `server/src/adapters/adapters.test.ts`.
- **Findings from real calls:** Spark spends reasoning tokens inside `max_completion_tokens` (a 200 cap returned empty content) → 1200. Without strict schema Spark sometimes appended junk to `target`; strict mode with a per-request enum of known ids fixed it. Baseten returned a nested `{"action":{"name":…}}` until the prompt got examples; V1 rejects that shape rather than guessing. The Baseten model id is `meta-models/muse-spark-open` (the `-1026` suffix in the brief is rejected). Browser speech and Muse Transcribe both mishear "peek" as "peak"; the intent layers accept that homophone.
- **Turn timeout default 4 s → 7 s**: measured Spark p95 is ~6.5 s (p50 ~2.6 s). The local parser answers listen / wait / hide / exit / "go to X" / "quietly go to X" with no call, so the slow path is peek / take phrasings only.
- **Guard and trust redesign** (the three design bugs):
  - New off-stage `upstairs` room (Marlow can never learn of or enter it). Route: upstairs ×3, stairwell, hall, gallery, **gallery (pause)**, hall, office, office, hall, stairwell, hall, office, hall, stairwell. The hall is occupied 5 of 16 steps.
  - `listen` returns silence when the guard is upstairs (3+ hops), so listening is a decision.
  - A **warning** now fires only when the guard is one hop away **and his next step is Marlow's room**. The −5 trust applies only when the player then moves **into** the guard's room or the one he is heading to; moving away is free; waiting/hiding after a warning still earns +5.
- **Lines trimmed**: 2 variants per line, 1 curt variant, room/door/prop slot pools exclude off-stage things, mixed-type clarifies are refused. Pre-render manifest 930 → **339 files**. `npx tsx tools/demo-lines.ts 7` lists the **24 distinct lines** a clean demo run plus the start of run 2 actually speak (`DEMO_LINES.md`).
- Dev notes: `listen` no longer narrates the guard twice; run logs carry a `levelHash` so logs recorded on an older level are reported as stale rather than as nondeterminism.

## Measured

| | Result |
|---|---|
| Intent accuracy (50 commands, correct transcript; latest run Spark 96% / Spark Open 96%) | mock 100% (wiring only) · **Spark 96%** · **Spark Open 92%** in the latest run (target ≥ 90). Across three runs Spark scored 98 / 92 (after fixing a harness bug) / 96 and Spark Open 92 / 96 / 92: the models are not deterministic, so quote it as ~92–98% |
| Invalid actions accepted | **0** on all backends; adversarial V2: 2000 bad replies, 0 illegal reached the engine |
| Latency release → result (intent path only) | Spark p50 ~2.1–2.6 s / p95 5.0–6.6 s · Spark Open p50 ~0.8–1.0 s / p95 7.7–9.5 s · Voice Transcribe ~0.7–1.1 s. One Spark call exceeded the 8 s eval timeout in one run |
| Replay determinism | 100% of generated seeded runs (logs carry a level hash; logs from an older level are skipped as stale) |
| Balance (1000 seeds; expert 150) | with the chase rule: expert **100%** clean win · cautious-simple 51% (44% clean) · reckless 43% win, **18% clean**, 57% caught (`simulation.md`) |

Misses (latest run): Spark: "open the safe" and "banana" got a refusal instead of "Say again". Spark Open: two "take the ledger" (refused as not-known instead of unknown), "banana" refused, and "peek the door" answered "Say again" instead of a clarify. All are safe outcomes; none executed. (The harness once counted `stance:"normal"` as a miss; fixed.)

## Known issues / honest caveats

- **Reckless still wins 43% of runs** (18% cleanly); see item 1 above for why the chase does not change that.
- The "cautious" policy in the simulator is deliberately simple (44%); the expert policy shows the level is cleanly winnable by a player who counts the guard's loop. Real players land in between: that is the playtest question.
- **Nobody has listened to the audio yet.** Everything audible is still synthesized placeholders (footsteps, creak, phone, stinger, music, reverb IRs) and Marlow's voice is placeholder tones until Kokoro is rendered. The browser run showed the audio context running and the text log mirroring every cue; it can't tell if it sounds good.
- The intent latency (≈3–5 s with Spark) is above the ~3 s design target; the wait is filled with ambience and the guard pacing where he was last heard.
- Keys were pasted in chat: they live only in `.env` (gitignored, not in git history). Rotate them after the hackathon.

## Needs you

0. **Record your 50 commands** (`/record.html`, ~5 min) so the eval has real speech.
1. **Listen tonight** (headphones, blindfold, M3: locate the guard left/right/ahead/behind ≥ 8/10). If the synth sounds cheap, drop CC0 files at `assets/audio/sfx/<cueId>.wav` (they replace the synth automatically) and log them in CREDITS.md.
2. **Kokoro**: `npm i -D kokoro-js` locally (dev-only; espeak-ng/GPL concern noted in CREDITS.md), then `npm run render-lines` (339 files). Review only `DEMO_LINES.md`.
3. Recruit the blind / low-vision tester; make the repo public; record the video (`DEMO_SCRIPT.md`, rehearsed with `tools/rehearse-demo.ts`).
4. Decide on the reckless-win rule and whether Wonder / SAM verification are worth the remaining time.

## Revised plan

| Day | Focus |
|---|---|
| Oct 28 | done: real models wired, guard/trust fixes, simulator, trimmed lines |
| Oct 29–30 | real sound assets, Kokoro lines, tune audio by ear, measured latency with real mic audio (record the 50 commands for a transcription error rate) |
| Oct 31–Nov 1 | playtests incl. the tester, balance, bugs |
| Nov 2 | freeze; README / CREDITS / repo public |
| Nov 3 | record + edit video |
| Nov 4 | buffer; submit early |


## Paused: paid API calls (2026-10-28)
Paid calls were stopped after ~$1 of Baseten Spark Open usage (about 434K output tokens, mostly repeated 50-command evals). `.env` has `INTENT_BACKEND=mock` as a temporary override; set it to `meta` (or delete the line) to make Spark the default again.
- `metrics.md` meta/baseten rows and `DEMO_SCRIPT.md` latencies predate the last prompt change (door `leadsTo`, speech-error hint). Re-run `npm run eval` and `tools/rehearse-demo.ts --live` once credits are back.
- `npm run eval:dry` prints how many paid calls an eval would make and a worst-case output-token bound, and sends nothing. Run it first.
- Offline checks done: clean clone installs, typechecks, passes 101 tests and builds; no keys or recordings in the tree or any commit; every sound cue has a synthesized fallback; the line manifest has 360 entries, none rendered yet (needs `kokoro-js`).

## Resumed (2026-10-29): Meta credits applied
`INTENT_BACKEND=meta` restored. Dev eval re-run on Meta only (`--backends mock,meta`; Spark Open skipped to avoid Baseten billing, so `metrics.md` has no Spark Open column now; its last numbers are in the entries above): **Spark 100% intent accuracy, 0 timeouts, 0 wrong-target, p50 1.75 s / p95 3.87 s**; speech: WER 8.5%, end-to-end 90% (misses are all transcription errors: "wall door", "bananapeek", "he tried quietly"…, none executed a wrong action).

## Eval after recording the held-out audio (2026-10-29, Spark only)
- Dev set (50): intent 98% (miss: "open the safe" refused instead of the expected reason), 0 timeouts, 0 wrong-target, p50 1.42 s / p95 3.88 s. Speech: WER 11.3% (was 8.5% on the previous run of the same clips, so STT varies run to run), end-to-end 92%.
- Held-out (30, frozen, real speech now recorded): intent 96.7% typed (one 8 s harness timeout on "stay where you are"), **100% end-to-end from speech**, WER 7%, 0 wrong-target, 0 illegal. p50 2.12 s / p95 4.73 s.
- Spark Open was not run (Baseten billing); its earlier held-out 76.7% stands as the last measurement.

## Fixes from the 6 recorded play sessions (2026-11-01)
Of 38 turns only 17 did anything; no run took the ledger. Fixed: (1) chatter and questions never become actions: wait/hide/listen/exit need a word of that kind in the order (V2c), "can you hear me / are you there" gets a local reply, "what do you see" and "where can I hide" are free local answers; (2) a refused hide now names the nearest known cover, or says "move me" during a chase; (3) the guard now starts at a fixed point upstairs (`startWindow: 1`), so he first reaches the hall on turn 4 and a first run is learnable. Simulator (1000 runs each): cautious 100% win / 100% clean; cautious-no-cover 100% / 0% clean; reckless 100% win / 0% clean (a dash always gets spotted but a chase escape lets it win messily); expert 100% / 100%. Reckless win rate is much higher than before (was 19%); the game is easier by design on a first run. 113 tests pass; mock eval unchanged (100% dev / 83.3% held-out, 0 wrong-target). Spark rows in `metrics.md` were not re-run (V2c is new since).

## Demo script rewritten for the new story (2026-11-01)
`DEMO_SCRIPT.md` now follows the Purloined Ledger run (15 turns: 6 Spark incl. one refusal and one clarify, 9 instant local). Live rehearsal with Spark: **2/2 played exactly as scripted**, Spark turns 1.2 to 4.7 s (median about 3.2 s), 6 model calls per run, win with alert 2 / trust 45 (the run includes a chase). `tools/rehearse-demo.ts` carries the new script.

## Spark eval re-run on the latest code (2026-11-01)
- **Bug found by the held-out set:** h30 "head out" executed `move hall` (wrong target; Spark quoted just "out" and the matcher accepted a generic pointer to the only door). Fixed in general: "out" and "up" cannot name a target; "head out / go out / step out" map to exit. The stress test now includes those words: old matcher 52 wrong-target executions, fixed matcher 0 over 41,040 replies. h30 is no longer a clean held-out case (disclosed in `metrics.heldout.md`).
- **Dev set (50), Spark, four runs today:** 96%, 100%, 98%, 94%. Every miss was a network timeout or a single-run model wobble (c46 clarified once and not again); 0 wrong-target, 0 illegal. Latest run: p50 1.84 s, p95 8.0 s (the API was slower during that run: 3 timeouts above 8 s). Word error rate 7.8 to 11.3% across runs.
- **Held-out (30), Spark, after the fix:** 93.3% typed, 0 wrong-target, WER 7.9%, p50 1.76 s / p95 3.08 s. Misses: h01 timeout, h26 "conceal yourself".
- Spark Open (Baseten) was not re-run (billing); its last numbers stay in the older entries.

## Accessibility audit (2026-11-01)
Automated: axe-core 4.9.1 (WCAG 2.0/2.1 A and AA plus best practices) on the start screen, play, Briefing, Case File, Spectator and Settings: first pass found a missing level-one heading, the tab strip outside any landmark, and the scrolling log not keyboard-reachable; all fixed, **0 violations on all tabs now**. No color-contrast failures. Manual fixes: Space no longer hijacks focused buttons and tabs (it is push-to-talk only on the talk button or the page body); keyboard Enter/Space on the talk button works (mute toggle when hands-free); focus moves to the talk control on Start; arrow, Home and End keys move between tabs; the sonar and waveform respect prefers-reduced-motion; the sonar has a text equivalent line. **Not tested:** a real screen reader (NVDA, JAWS, VoiceOver) and a real blind or low-vision tester. axe cannot check canvas content, audio, or whether the experience is actually good for a blind player.

## Seer link: one sees, one listens (2026-11-01)
Optional two-player mode. The listener plays as usual; **CO-OP: SEER LINK** creates a four-letter room and a link. The seer's page (`/seer.html?room=CODE`) shows the ground-truth map (real guard, his next step, cover, items), a plain-language line ("Guard is in the stairwell, heading to the hall next. Marlow is in the hall."), and the last 40 lines the listener heard. Read-only: the relay ignores anything a seer sends. Server: `server/src/seer.ts` (room relay, latest snapshot per room for late joiners, max 4 seers, 512 KB message cap, idle rooms swept), WebSocket at `/ws/seer` (`ws` package), proxied by Vite. Tests: 5 relay tests. Verified in two browser windows: live updates, late join with history, host leaving. Not built: voice chat between the two players (use a phone call), and hosting for friends on other networks.
