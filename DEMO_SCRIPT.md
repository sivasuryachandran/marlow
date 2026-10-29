# MARLOW — 3-minute demo script

Every line below is real output from `node --env-file=.env --import tsx tools/rehearse-demo.ts --live`, which plays this exact script through the real game with **live Muse Spark**. It has played exactly as written **5 out of 5** times (seed 7, then seed 8 for run 2). Offline `tools/rehearse-demo.ts` (no `--live`) can't parse the natural-language lines.

**The three things this video must prove:** (1) an ambiguous order gets a clarifying question, never a guess; (2) an invalid order leaves the world unchanged; (3) the same logged actions replay to identical outcomes.

**Which path answers each turn.** `LOCAL` = the plain-code parser answers instantly (about 0 ms, no model). `SPARK` = a real Muse Spark call, then the code checks it (V1 schema, V2 legality, matched-phrase check) before anything can happen. In this script **6 of 11 turns go to Spark** (one refusal, one clarify, one clarify answer, three natural-language orders) and **5 are instant local turns**.

## Before you record

- Use Chrome (browser speech recognition) and wired or good earbuds. Binaural audio is the whole point; the recording must capture the headphone mix (record system audio, not the room).
- Real voices: run `npm i -D kokoro-js && npm run render-lines` first. Without it Marlow is placeholder tones and the video will not land.
- Tune by ear first: ducking depth, reverb, the guard arc. Do the blindfold smoke test once with a friend.
- Fresh memory: open the settings and press "Forget Marlow's memory", then reload. Take 1 must be Run 1.
- Open `http://localhost:5173/?seed=7` (debug OFF) for the player view. Open a second window `?seed=7&debug=1` only for the split-screen beat (replay the same orders there, or capture the debug panel from a second take).
- `npm run server` running if you want the Case File shot; otherwise `npx tsx tools/casefile.ts <runId>`.
- If a real blind or low-vision tester plays, **their reaction goes first** in the cut (before 0:00). Say "designed to be playable without vision", not more.

## Timeline (seed 7)

Spark turns take about 2 to 4.5 s in the rehearsals (median 2.8 s). Let that gap play: while it thinks you hear only rain, the HVAC, Marlow breathing and the guard pacing where he was last heard. If a turn ever exceeds 7 s the game says "Signal's bad, say again?" and nothing changes; that is a feature, keep the take.

| Time | You say | Path | You hear / see | Proves |
|---|---|---|---|---|
| **0:00–0:15** | (phone rings) | — | Client: *"They said you retired. They said you can't do this anymore."* then the job. Marlow: *"I'm in the lobby, boss. Door's ahead of me. Whenever you're ready."* | the client call |
| **0:15–0:30** | voice-over | — | "You're the voice in her earpiece. She's the only one who can see. Muse understands what you say. A deterministic engine decides what happens." | pitch |
| **0:30–0:38** | **"Listen."** | LOCAL, instant | Marlow: *"Quiet. Nothing close."* (the guard is upstairs: silence is information) | listen is a decision |
| **0:38–0:55** | **"Check the vault door."** | **SPARK** | ~3 s of rain and breathing, then *"There's nothing like that here, boss."* Nothing moves; the debug turn counter doesn't change. Say: "Invalid order. The world didn't change." | **invalid = unchanged** (model names a door that isn't there; the code won't map it to a real one) |
| **0:55–1:12** | **"Let's head into the hallway."** | **SPARK** | Door creak, Marlow's footsteps. *"That door was louder than I like."* *"Heading into the hall."* | natural language → one legal action ("hallway" is an alias the code checks) |
| **1:12–1:28** | **"Take a look through that door."** | **SPARK** | *"I see two. The lobby door or the gallery arch?"* Say: "Four doors here. It asks instead of guessing." | **clarify, never a guess** |
| **1:28–1:48** | **"The one on the left."** | **SPARK** | *"Looking through. The gallery."* *"I can hide at the display case."* then a muffled guard cue, ahead and near: *"Footsteps, ahead, and coming. Careful."* | follow-up resolved from the same question |
| **1:48–2:05** | **"Quietly slip into the study."** | **SPARK** | *"Quietly into the office. This takes a moment."* *"The ledger, right there."* *"I can hide at the desk."* No door noise, so the guard doesn't turn toward her. | quiet stance; sound-reactive guard stays asleep |
| **2:05–2:10** | **"Hide."** | LOCAL, instant | *"Tucked in at the desk."* | instant local turn |
| **2:10–2:25** | **"Grab the book off the desk."** | **SPARK** | *"Got the ledger."* the phone rings in the room; then the twist: *"Boss. There's a tape in the drawer. Labeled with a date. The night you lost your sight. I'm bringing it out."* | story beat ("book" is an alias of the ledger) |
| **2:25–2:40** | **"Go to the hall."** **"Go to the lobby."** **"Exit."** | LOCAL ×3, instant | *"Heading into the hall."* … *"Moving to the lobby."* … *"Outside. Not a hair out of place."* | clean exit |
| **2:40–2:48** | "Run it again" · **"Listen."** **"Wait."** | LOCAL ×2 | Run 2 opens: *"Back again. The ledger's still in the office…"* then *"I called out a guard and you pushed me anyway last run. Listen to me this time."* (the rehearsal's run 1 moved into a room the guard had just warned about, which costs trust) | memory across runs |
| **2:48–3:00** | split screen | — | Left: player. Right: `?debug=1` hidden map + event log. Then `metrics.md`, `simulation.md`, and `npm run replay` → determinism 100%. Flash the Case File (real Muse Image panels). End card: "MARLOW. A heist you play by ear." + repo URL. | **replay**, validation |

### Optional bonus beat (not in the rehearsed run)
To show the **sound-reactive guard**, on another take walk into the hall with a normal "Go to the hall" while the guard is in an adjacent room: Marlow says *"He heard that. Footsteps turning my way, left."*, the guard cue swings toward you, and you have to hide or leave. It costs a take; the rehearsed run above avoids it.

## Notes that keep the take honest

- Order of the model turns: refusal, move, clarify, clarify-answer, quiet move, take. Replace none of them with local phrasings; the wording is what makes them go to Spark.
- Spark isn't deterministic. If a take goes off-script, check `tools/rehearse-demo.ts --live` still passes before re-recording.
- Quote metrics only from `metrics.md` / `metrics.heldout.md` / `simulation.md` as generated. Don't claim the held-out numbers for Spark Open: they are below target.
- The Case File button needs `npm run server` (about one minute for five panels); or `npx tsx tools/casefile.ts <runId>`.
- Don't claim accessibility results you didn't measure.
- The 90 s cut: rows 0:00, 0:38, 0:55, 1:12 (+1:28 answer), 2:10, 2:25, 2:48.


## Recording-day checklist
1. `.env`: `INTENT_BACKEND=meta`; `npm run check-access` (one tiny call) before the take.
2. `npx tsx tools/rehearse-demo.ts --live --runs 2` passes before every recording session.
3. Voices rendered (`npm run render-lines`), headphones on, system audio captured.
4. Memory reset, `?seed=7`, debug off.
5. Take once with the tester or a friend blindfolded, then the clean take.
6. Cut the 90 s version using the rows listed above; end card with the repo URL (repo must be public first).
