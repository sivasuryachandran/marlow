# MARLOW — 3-minute demo script

Every spoken line below is real output from `npx tsx tools/rehearse-demo.ts` (which uses the offline mock; with Spark the same orders resolve the same way) (seed 9, then seed 10 for run 2), so the take will match. Orders marked **[type]** are safe to type if speech recognition mishears; say them aloud if it works.

**The three things this video must prove:** (1) an ambiguous order gets a clarifying question, never a guess; (2) an invalid order leaves the world unchanged; (3) the same logged actions replay to identical outcomes.

## Before you record

- Use Chrome (browser speech recognition) and wired or good earbuds. Binaural audio is the whole point; the recording must capture the headphone mix (record system audio, not the room).
- Real voices: run `npm i -D kokoro-js && npm run render-lines` first. Without it Marlow is placeholder tones and the video will not land.
- Tune by ear first: ducking depth, reverb, the guard arc. Do the blindfold smoke test once with a friend.
- Fresh memory: open the settings and press "Forget Marlow's memory", then reload. Take 1 must be Run 1.
- Open `http://localhost:5173/?seed=9` (debug OFF) for the player view. Open a second window `?seed=9&debug=1` only for the split-screen beat (replay the same orders there, or capture the debug panel from a second take).
- `npm run server` running if you want the Case File shot; otherwise `npx tsx tools/casefile.ts <runId>`.
- If a real blind or low-vision tester plays, **their reaction goes first** in the cut (before 0:00). Say "designed to be playable without vision", not more.

## Timeline

Which orders need the model: only **peek / take** phrasings (3 in this script); everything else (listen, go to X, quietly go to X, hide, exit) is handled by the local parser and answers instantly. Real Spark answers in ~3 to 5 s; while it thinks the player hears only rain, HVAC, breathing and the guard pacing where he was last heard. Keep that gap in the cut; it is the product.

| Time | You say | You hear / see | Proves |
|---|---|---|---|
| **0:00–0:15** | (phone rings) | Client: *"They said you retired. They said you can't do this anymore."* then the job. Marlow: *"I'm in the lobby, boss. Door's ahead of me. Whenever you're ready."* | the client call |
| **0:15–0:30** | voice-over | "You're the voice in her earpiece. She's the only one who can see. Muse understands what you say. A deterministic engine decides what happens." | pitch |
| **0:30–0:50** | **"Peek the vault door."** | Marlow: *"I don't know what you mean, boss."* No sound, no footsteps. Say: "Invalid order. The world didn't change." (debug turn counter stays 0) | **invalid = unchanged** |
| **0:50–1:10** | **"Listen."** | Dull, muffled footsteps panned ahead. *"I hear him. Ahead, mid distance."* Let it breathe. | 3D audio, listen as a decision |
| **1:10–1:30** | **"Go to the hall."** | Door creak, guard sweeps in on the left, tension music enters. *"That door was louder than I like."* *"Heading into the hall."* *"Footsteps. Left, near."* | moving source, music by alert |
| **1:30–1:45** | **"Peek the door."** | *"I see two. The lobby door or the gallery arch?"* "Four doors in this room. It asks instead of guessing." **Do not answer** (an answer spends a turn). | **clarify, never a guess** |
| **1:45–2:10** | **"Quietly go to the office."** then **"Hide."** then **"Listen."** | *"Easing into the office. Slow and quiet."* … *"Guard's close, boss. Behind."* *"Down behind the desk. Not breathing."* Then footsteps **here, near**: *"He's in the room with me!"* Hold the silence. | the tension peak; hiding works |
| **2:10–2:25** | **"Take the ledger."** | *"Got the ledger."* the phone rings in the room; twist: *"Boss. There's a tape in the drawer. Labeled with a date. The night you lost your sight. I'm bringing it out."* | story beat |
| **2:25–2:40** | **"Go to the hall."** **"Go to the lobby."** **"Exit."** | *"Outside. Not a hair out of place."* trust rises 50 → 70 | clean exit |
| **2:40–2:50** | "Run it again" | Run 2 opens: *"Same building. Same ledger. Try not to make it a habit, Owl."* … *"Clean run last time. Let's do it again."* | memory across runs |
| **2:50–3:00** | split screen | Left: player. Right: `?debug=1` hidden map + event log. Then `metrics.md`, `simulation.md` (expert 100% clean win, reckless 18%), `npm run replay` → determinism 100%, and a flash of the Case File (real Muse Image panels, "Illustrated from the run log."). End card: "MARLOW. A heist you play by ear." + repo URL. | **replay**, validation |

## Notes that keep the take honest

- The seed-9 clean line is: listen, go to hall, quietly go to office, hide, listen, take the ledger, go to hall, go to lobby, exit. Other seeds: `npx tsx tools/demo-plan.ts <seed>` (that solver plan is the shortest clean one; it doesn't listen first).
- Run 2 from the "Run it again" button is seed+1 (seed 10). Re-run `npx tsx tools/rehearse-demo.ts` after any change to lines or rules; lines pick a variant by hash of seed, turn and line id, so edits to `data/lines.json` can change wording.
- Quote metrics only from `metrics.md` / `simulation.md` as generated. Intent accuracy comes from the real Spark / Spark Open rows in `metrics.md`; the mock row only proves wiring.
- The Case File button needs `npm run server` (it calls Muse Image, about one minute for five panels); or `npx tsx tools/casefile.ts <runId>`.
- Don't claim accessibility results you didn't measure.
- Submission wants a **3-minute** video; the design doc planned ~90 s. The 90 s cut is rows 0:00, 0:30, 1:10, 1:30, 1:45 (shortened), 2:25 and 2:50.
