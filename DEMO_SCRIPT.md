# MARLOW — 3-minute demo script

Every spoken line below is real output from `npx tsx tools/rehearse-demo.ts` (seed 7, then seed 8 for run 2), so the take will match. Orders marked **[type]** are safe to type if speech recognition mishears; say them aloud if it works.

**The three things this video must prove:** (1) an ambiguous order gets a clarifying question, never a guess; (2) an invalid order leaves the world unchanged; (3) the same logged actions replay to identical outcomes.

## Before you record

- Use Chrome (browser speech recognition) and wired or good earbuds. Binaural audio is the whole point; the recording must capture the headphone mix (record system audio, not the room).
- Real voices: run `npm i -D kokoro-js && npm run render-lines` first. Without it Marlow is placeholder tones and the video will not land.
- Tune by ear first: ducking depth, reverb, the guard arc. Do the blindfold smoke test once with a friend.
- Fresh memory: open the settings and press "Forget Marlow's memory", then reload. Take 1 must be Run 1.
- Open `http://localhost:5173/?seed=7` (debug OFF) for the player view. Open a second window `?seed=7&debug=1` only for the split-screen beat (replay the same orders there, or capture the debug panel from a second take).
- `npm run server` running if you want the Case File shot; otherwise `npx tsx tools/casefile.ts <runId>`.
- If a real blind or low-vision tester plays, **their reaction goes first** in the cut (before 0:00). Say "designed to be playable without vision", not more.

## Timeline

| Time | Screen | You say / hear | Proves |
|---|---|---|---|
| **0:00–0:15** | Black. Rain. Only the status line. | Phone rings. Client: *"They said you retired. They said you can't do this anymore."* then *"The gallery keeps a ledger in the office off the main hall. Marlow is already in the lobby. Bring it out, quietly, and I will forget the rest."* Marlow: *"I'm in the lobby, boss. Door's ahead of me. Whenever you're ready."* | the client call, the stakes |
| **0:15–0:30** | Same, captions visible. | Voice-over: "You're the voice in her earpiece. She's the only one who can see. Muse understands what you say. A deterministic engine decides what happens." | the pitch |
| **0:30–0:50** | Hold Space. | Order: **"Peek the vault door."** Marlow: *"I don't know what you mean, boss."* Nothing moves; the log shows no footsteps. Say: "Invalid order. The world didn't change." (Debug turn counter, if shown: 0.) | #2 invalid = unchanged |
| **0:50–1:10** | Hold Space. | **"Listen."** Cue, panned ahead, dull and muffled: *"Footsteps, ahead, mid, muffled."* Marlow: *"Boots on the floor. Ahead, mid distance."* then *"Guard's close, boss. Ahead."* Let the audio breathe for a beat. | 3D audio, text mirror |
| **1:10–1:30** | Hold Space. | **"Go to the hall."** Door creak, guard footsteps sweep to the left, tension music enters. Marlow: *"Hinge squeaked. Sorry."* *"Heading into the hall."* *"He's near, left. Think before you send me."* | moving source, music by alert, warning |
| **1:30–1:50** | Hold Space. | **"Peek the door."** Marlow: *"Which door, boss? The lobby door, or the gallery arch?"* Say: "Four doors in this room. It asks instead of guessing." **Do not answer** (answering spends a turn and moves the guard). Go straight to the next order. | #1 clarify |
| **1:50–2:10** | | **"Quietly go to the office."** *"Soft steps to the office."* *"There's the ledger in here."* *"I can hide at the desk."* **"Take the ledger."** *"I have the ledger."* then the twist: *"Boss. There's a tape in the drawer. Labeled with a date. The night you lost your sight. I'm bringing it out."* | story beat, one-line pause |
| **2:10–2:25** | | **"Go to the hall."** **"Go to the lobby."** (Phone rings behind, mid-distance in the lobby.) **"Exit."** *"Out clean, boss. You heard him before I saw him. Again."* | clean exit |
| **2:25–2:40** | Press "Run it again". | Run 2 opens: *"Back again. The ledger's still in the office. Let's see if you've learned anything."* … *"I called out a guard and you pushed me anyway last run. Listen to me this time."* Say **"Listen."** then **"Wait."** (waiting right after a warning earns trust back). | memory across runs |
| **2:40–2:55** | Split screen: left player, right `?debug=1` map + event log; then `metrics.md` and a terminal running `npm run replay`. | Voice-over: "Hidden map on the right: the engine owns the truth, Marlow only knows what she's perceived. The same logged actions replay to the same event log: determinism 100%. Zero invalid actions accepted." Flash the Case File (3 to 6 panels, "Illustrated from the run log."). | #3 replay, metrics, Case File |
| **2:55–3:00** | Title card. | "MARLOW. A heist you play by ear." Repo URL. | |

## Notes that keep the take honest

- **Seed 7 clean line** is: listen, go to hall, quietly go to office, take the ledger, go to hall, go to lobby, exit (alert 1, trust dips mid-run because the orders after warnings cost −5; it is real, don't hide it). Print other seeds with `npx tsx tools/demo-plan.ts <seed>`.
- The "Run it again" button uses seed+1, so Run 2 is seed 8 (callback text and trust gain verified by `rehearse-demo.ts`).
- The refusal line for unknown targets is "I don't know what you mean, boss." The "There's no door there, boss." variant plays when you peek a door that isn't in the current room, which spoken orders can't currently reach; don't promise it on camera.
- Quote metrics only from `metrics.md` as generated. Until Meta/Baseten keys exist the intent numbers are the mock's; say "the engine's checks" (invalid accepted 0, determinism 100%), not model accuracy.
- Don't claim accessibility results you didn't measure.
- Submission wants a **3-minute** video; the design doc planned ~90 s. This script is the 3:00 cut; the 90 s cut is rows 0:00–0:15, 0:30–0:50, 1:10–1:50, 2:10–2:25, 2:40–2:55.
