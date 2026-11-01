# MARLOW: The Purloined Ledger (story bible, DRAFT for approval)

Adapted *ideas* (not text) from public-domain works on Project Gutenberg. See CREDITS.md.

| Idea we borrow | Source | Where it lands |
|---|---|---|
| The thing everyone wants is not locked away; it sits in plain sight | Poe, "The Purloined Letter" (1844) | The ledger lies open on the office desk. The safe beside it is empty. |
| The prize is hidden inside a decoy | Leblanc, "The Black Pearl" (Arsène Lupin, Gentleman-Burglar, 1907) | The tape is taped inside the ledger's back cover. |
| A loyal partner is the thief's eyes and conscience | Hornung, *The Amateur Cracksman* (1899), Raffles and Bunny | Marlow sees; Owl decides. |
| Guilt is betrayed by sound | Poe, "The Tell-Tale Heart" (1843) | Owl cannot see his betrayer, but knows him by ear: a heavy step, a drag, keys. |

## Premise
You are **Owl**, once the best fixer in the city. Three years ago, on the night of the Fenwick job, the lights went out and you lost your sight. You never saw who was in the building. You remember only sounds: **a heavy step, a drag, and keys.**

**Marlow** is your eyes: young, brave, the only one who still calls you "boss". **Ines** is your old partner. She has called you back for one last job: fetch a ledger from the Hale Gallery. "Don't read it. It's only numbers."

## Truth (what actually happened, hidden from the player until discovered)
1. Ines sold the Fenwick job to Hale, who owned the building. She told Halloran, Hale's night man, to keep Owl inside until the lights went out.
2. Halloran, the guard with the limp, was there that night. Owl heard him and never forgot the sound.
3. Hale's ledger records the payment: *Fenwick, the ninth, forty thousand, initial H.*
4. Ines wants the ledger because it names her. She does not know the tape exists. Hale kept it as insurance and taped it inside the ledger's back cover.

## Facts the system tracks (each turns on only when the game shows it)
| Fact id | Becomes known when | Marlow can then answer about |
|---|---|---|
| `job` | the opening call | Ines, the job, the ledger |
| `limp` | the guard is first heard (listen or footsteps) | Halloran, Fenwick (the sound) |
| `hall` / `gallery` / `office` / `stairwell` | Marlow first enters that room | the room |
| `guestbook` | first enters the gallery | Ines signed the book on the ninth |
| `ledger_open` | first enters the office | the safe is empty; the ledger is on the desk |
| `machine` | the phone rings while Marlow is in the office (or she enters the office after turn 7) | Hale and Ines are connected |
| `tape` | the ledger is taken | the tape exists; what it is |
| `ending` | the player chooses burn or send | nothing more |

Answers to "who is Ines / Halloran / Hale / what happened at Fenwick / what's in the ledger / the tape" are templates chosen from the highest fact level reached. Anything not yet discovered gets "I don't know yet, boss."

## Acts and beats
**Act I, the call and the hall (turns 1-4).** Ines's call. Marlow at the lobby door. Hall: portraits, quiet. The guard is upstairs for three turns; then his step-drag-keys comes down the stairwell. Marlow: "That's what you told me you remember from Fenwick."

**Act II, the rooms (turns 4-10).**
- *Gallery*: a guest book open to the ninth, three years back. Last signature: Ines Vane. Marlow: "That's the client."
- *Office*: the safe stands open and empty. The ledger lies open on the desk "like a menu." Marlow: "Nobody hides what nobody looks for." The phone rings at turn 6; the answering machine plays Hale: "Ines, it's Hale. Halloran says you want the ledger gone. Burn it before Owl reads it."
- *Stairwell*: a radio upstairs, and the guard humming.

**Act III, the take (turn ~8-12).** Taking the ledger: a tape taped inside the back cover, labelled *Fenwick, the ninth*. Ines, on the radio: "You have it? Good. Now come out. And Owl, don't open anything else." Chase and sound-reactive guard keep the tension up.

**Act IV, out and the choice.** In the van Marlow plays the tape: Ines's voice telling Halloran to keep Owl inside until the lights go. "Burn it, or send it?" The player answers by voice. Burn: Ines thanks Owl, he will never learn why. Send: Ines begs, "Owl, pick up."

## Nudges when stuck (one each, in order)
1. Not yet in the office by turn 5: "The ledger's in the office off the main hall, boss."
2. In the office, not yet taken, by turn 8: "It's right there on the desk. Want me to take it?"
3. Taken, not out, by turn 12: "We have it. Back through the hall and out the lobby."

## What stays true to the architecture
- The engine owns truth. Facts come from engine events and beats; narration never invents.
- Every line is a pre-rendered template. No runtime TTS.
- The model (Spark) never decides story; it only maps what you say to a legal action or a lore topic, and the code checks it.
