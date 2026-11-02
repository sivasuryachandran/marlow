# MARLOW — 3-minute demo script (The Purloined Ledger)

Every line below is real output from `node --env-file=.env --import tsx tools/rehearse-demo.ts --live`, which plays this exact script through the real game with **live Muse Spark**. It played exactly as written **2 out of 2** times (re-run 2026-11-01 after adding the silent alarm) (seed 7; the guard's opening is fixed, so the timeline is the same every take).

**What the video must prove:** (1) you talk to Marlow in your own words and Muse Spark turns it into one legal action; (2) an ambiguous order gets a clarifying question, never a guess; (3) an invalid order leaves the world unchanged; (4) the story is discovered by listening, not read at you; (5) the same logged run replays to an identical result.

**Which path answers each turn.** `LOCAL` = plain code answers instantly (about 0 ms, no model call). `SPARK` = a real Muse Spark call, then the code checks it (schema, legality, matched-phrase check) before anything can happen. **6 of 15 turns go to Spark** (one refusal, one clarify, one clarify answer, three natural-language orders) and **9 are instant local turns**. Measured Spark turns in the latest two rehearsals: 2.0 to 3.8 s, median about 2.3 s (earlier rehearsals: 1.2 to 4.7 s).

## Before you record

- Chrome, wired or good earbuds (record system audio, not the room).
- `.env` with `INTENT_BACKEND=meta`; `npm run check-access` first (one tiny call). `npm run server` and `npm run dev` both running.
- Voices: already bundled as MP3. If the game talks in humming tones, run `git pull` (they live in `assets/audio/lines/*.mp3`).
- `npx tsx tools/rehearse-demo.ts --live --runs 2` must pass right before the take.
- Open `http://localhost:5173/?seed=7`. Open Settings and press "Forget Marlow's memory", then reload: take 1 must be Run 1.
- Capture the cockpit full screen (sonar, waveform, log, illustrations) **and** the headphone mix.
- If a blind or low-vision tester plays, their reaction goes first in the cut. Say "designed to be playable without vision", not more.

## Timeline

| Time | You say | Path | You hear / see | Proves |
|---|---|---|---|---|
| **0:00–0:15** | (phone rings) | — | Title illustration. Ines: *"They said you retired… I never believed them. It's Ines, Owl."* Then the job, and *"Don't read it. It's only numbers."* | the call, the premise |
| **0:15–0:25** | voice-over | — | "You're Owl. You can't see. Marlow is your eyes. Muse understands what you say; a deterministic engine decides what happens." | pitch |
| **0:25–0:35** | **"I'm ready."** then **"Listen."** | LOCAL ×2 | *"Ready when you are. Give me an order."* then *"Nothing but the rain."* | instant local turns; silence is information |
| **0:35–0:50** | **"Check the vault door."** | **SPARK** | ~4 s of waiting, then *"I don't know what you mean, boss."* Turn counter does not change. Say: "Invalid order. The world didn't change." | **invalid = unchanged** |
| **0:50–1:05** | **"Let's head into the hallway."** | **SPARK** | Door creak, footsteps. *"Hinge squeaked. Sorry."* *"Portraits all down the hall…"* Hall illustration. | natural language → one legal action |
| **1:05–1:20** | **"Take a look through that door."** | **SPARK** | *"Which door, boss? The lobby door, or the gallery arch?"* Two big buttons appear on screen. | **clarify, never a guess** |
| **1:20–1:40** | **"The one on the left."** | **SPARK** | *"That's the gallery."* A muffled step, a drag, keys, ahead and near. *"Step, then a drag. Keys on a belt… that's what you told me you remember from Fenwick. That's Halloran."* Sonar lights up; "limp" illustration. | the story arrives by sound |
| **1:40–1:48** | **"Who is Halloran?"** | LOCAL | *"Halloran is the night man. A heavy step, a drag, and keys. It's the sound you remember from Fenwick."* (free: no turn passes) | the system knows what you've discovered |
| **1:48–2:00** | **"Quietly slip into the study."** | **SPARK** | Quiet footsteps. *"The safe is standing open, and it's empty. But the ledger's lying open on the desk… like a menu."* Office illustration. | quiet stance; "study" is an alias the code checks |
| **2:00–2:10** | **"Hide."** then **"Wait."** | LOCAL ×2 | *"Tucked in at the desk."* The phone rings; the answering machine: *"Ines, it's Hale. Halloran says you want the ledger gone. Burn it before Owl reads it."* | the twist: the client is in on it |
| **2:10–2:25** | **"Grab the book off the desk."** | **SPARK** | *"I have the ledger."* **Silent alarm**: *"That tripped something. A silent alarm. We don't have long!"* The red ALARM counter in the top bar starts at 10 and the pulse sounds. Then *"There's a tape taped inside the back cover. Fenwick, the ninth."* Ines: *"Don't open anything else."* Tape illustration. | story beat; "book" is an alias of the ledger; time pressure |
| **2:25–2:42** | **"Go to the hall."** · **"Go to the lobby."** · **"Exit."** | LOCAL ×3 | The guard hears the door, spots her, runs. Alarm stinger, tension music, chase illustration; the alarm counter keeps dropping (9, 8…) and its pulse gets faster. *"One move, boss!"* then *"I'm clear."* then *"We're out, but that was loud."* Show the caption strip: every sound is also text. | chase: one turn to hide or leave; understandable muted |
| **2:42–2:50** | **"Burn it."** | LOCAL | The tape plays: Ines, with keys behind her. Marlow: *"Burn it, or send it?"* → *"Burning it. Ashes in the rain."* Ines: *"Owl. I know you have it. Thank you."* | the ending is a spoken choice |
| **2:50–3:00** | split screen | — | Player view; then the **Spectator / Debug** tab (ground truth, the guard's real route). Flash `metrics.md` and `simulation.md`, run `npm run replay` → determinism 100%. End card: "MARLOW. A heist you play by ear." + https://github.com/sivasuryachandran/marlow | **replay**, validation |

### Optional bonus take (not in the rehearsed run)
Say "Send it" instead of "Burn it" to show the other ending: *"Owl, pick up. Please. Owl."* with the city-at-dawn illustration.

## Notes that keep the take honest

- The six Spark turns are: refusal, move, clarify, clarify answer, quiet move, take. Replace none of them with local phrasings; the wording is what routes them to Spark.
- Spark isn't deterministic. If a take goes off-script, re-run `tools/rehearse-demo.ts --live` before recording again.
- The route goes through a chase on purpose. It is a messy win (alert 2, trust 45), not a clean one; do not call it a perfect run.
- Quote metrics only from `metrics.md` / `metrics.heldout.md` / `simulation.md` as generated (Spark dev set 98%, held-out 96.7%, 0 wrong-target; the word-error rate varies 8 to 11% between runs). `metrics.md` Spark rows predate the newest word-check change.
- Don't claim accessibility results you didn't measure.
- The illustrations were made once with Muse Image and are mood only. The Case File (Case File tab) draws a fresh comic from your run and needs `npm run server`; it takes about a minute.
- The 90 s cut: rows 0:00, 0:35, 0:50, 1:05 (+1:20 answer), 2:10, 2:25, 2:42.
