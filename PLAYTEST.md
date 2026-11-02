# Playtest protocol: two people, one heist

**Status: not yet run.** Nobody outside the build has played MARLOW with another person, and no blind or low-vision person has played it at all. This file is the protocol and an empty results table so that when it is done, the evidence is honest. Do not quote results from it until the table below has real rows.

## Setup (5 minutes)
- Two people who did not build the game. One wears headphones and has the screen turned away or the screen covered (the *listener*). One sits where they can see the map (the *seer*).
- Run `npm run server` and `npm run dev`, open `http://localhost:5173/split.html` on the seer's screen, and give the listener a second window or device at `http://localhost:5173/?seed=7` and press **CO-OP: SEER LINK** with the same room code (or sit them in front of the left half of the split page with the screen hidden). They talk face to face or on a call; the game has no built-in voice chat.
- Chrome, headphones, microphone allowed. Spark and Voice Transcribe keys set, or the offline fallback (note which, in the table).

## What you say (read it, then stay quiet)
"One of you hears a heist through headphones and gives spoken orders to a thief called Marlow. The other sees the whole building, including where the guard is, but cannot give orders. Talk to each other. Get the ledger out without being caught. I will not help."

## Do not coach
No hints about commands, the alarm, or the guard. Note every place you wanted to speak.

## Observe (tick, then note times)
| Question | Evidence to note |
|---|---|
| Did they understand the two roles within 2 minutes? | what they said first, who asked what |
| Did a decision change because of information only the other person had? | the exact moment ("he's coming from behind", then hide) |
| Where did they get stuck or repeat themselves? | order, how many tries, what finally worked |
| Did the guard create tension, or did they just wait? | turns spent waiting vs moving; did the alarm change that? |
| Did the alarm make sense without explanation? | what they did when it started |
| Did anything sound confusing or wrong? | which sound, which moment |
| After the run, did they ask to play again or swap roles, without being asked? | yes or no, verbatim |

## Measure (write down, do not estimate)
Time to first successful order; number of "say again" replies; number of turns; outcome (won clean, won messy, caught, and why); whether captions were used.

## After (3 questions, verbatim answers)
1. In one sentence, what is this game?
2. What was the most confusing moment?
3. Would you play again, and with whom?

## Results (fill in; leave empty until real)
| Date | Pair (age range, gaming experience) | Roles | Outcome | Understood roles in 2 min | Info-driven decision | Played again unprompted | Main confusion |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## What you may claim afterwards
- With 2 or 3 pairs: "In early sessions with N pairs, ..." and only what the table shows.
- No blind or low-vision participant: say "designed to be playable without looking". Do not say "validated for blind players". A sighted person with their eyes closed tests the audio loop; it is not accessibility validation.
- If nobody asks to play again, do not claim repeat demand.
