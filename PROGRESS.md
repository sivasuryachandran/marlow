# PROGRESS

Status date: 2026-10-28 (evening). Real Meta model calls are now wired and measured.

## Go / no-go (recorded)

`npm run check-access` with the supplied keys: **PASS** Muse Spark `muse-spark-1.3` · **PASS** Muse Voice Transcribe · **PASS** Baseten `meta-models/muse-spark-open` · Muse Image PASS (real Case File generated, ~12 s/panel) · Muse Wonder not tested (optional, unused). **Go.**

Stage-one requirement ("real use of Meta models") is now met by: Voice Transcribe (speech → text), Muse Spark (speech → one legal action or a clarify question), Muse Image (Case File), plus Spark Open on Baseten as the alternate backend.

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
| Intent accuracy (50 commands, correct transcript) | mock 100% (wiring only) · **Spark 96%** · **Spark Open 92%** in the latest run (target ≥ 90). Across three runs Spark scored 98 / 92 (after fixing a harness bug) / 96 and Spark Open 92 / 96 / 92: the models are not deterministic, so quote it as ~92–98% |
| Invalid actions accepted | **0** on all backends; adversarial V2: 2000 bad replies, 0 illegal reached the engine |
| Latency release → result (intent path only) | Spark p50 ~2.1–2.6 s / p95 5.0–6.6 s · Spark Open p50 ~0.8–1.0 s / p95 7.7–9.5 s · Voice Transcribe ~0.7–1.1 s. One Spark call exceeded the 8 s eval timeout in one run |
| Replay determinism | 100% of generated seeded runs |
| Balance (1000 seeds; expert 150) | expert **100%** clean win · cautious 44% (all clean) · reckless 43% win but only **18% clean**, 57% caught (`simulation.md`) |

Misses (latest run): Spark: "open the safe" and "banana" got a refusal instead of "Say again". Spark Open: two "take the ledger" (refused as not-known instead of unknown), "banana" refused, and "peek the door" answered "Say again" instead of a clarify. All are safe outcomes; none executed. (The harness once counted `stance:"normal"` as a miss; fixed.)

## Known issues / honest caveats

- **Reckless still wins 43% of runs** because one spot (+2) is survivable (caught at alert 3). "Reckless rarely wins" holds for clean wins (18%), not for any win. If you want it lower, the lever is a rule change (e.g. spotted = +3), which I have not made without your say-so.
- The "cautious" policy in the simulator is deliberately simple (44%); the expert policy shows the level is cleanly winnable by a player who counts the guard's loop. Real players land in between: that is the playtest question.
- **Nobody has listened to the audio yet.** Everything audible is still synthesized placeholders (footsteps, creak, phone, stinger, music, reverb IRs) and Marlow's voice is placeholder tones until Kokoro is rendered. The browser run showed the audio context running and the text log mirroring every cue; it can't tell if it sounds good.
- The intent latency (≈3–5 s with Spark) is above the ~3 s design target; the wait is filled with ambience and the guard pacing where he was last heard.
- Keys were pasted in chat: they live only in `.env` (gitignored, not in git history). Rotate them after the hackathon.

## Needs you

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
