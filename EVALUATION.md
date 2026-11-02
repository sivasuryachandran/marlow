# Evaluating MARLOW (for reviewers, human or AI)

Repo: https://github.com/sivasuryachandran/marlow · Built for the Meta Global AI Developer Hackathon (Indie track).
MARLOW is a screenless, binaural heist game played by voice. A deterministic engine decides what happens; Meta Muse models only understand speech and generate content; code verifies every model output.

## Run it (no API keys needed)
```bash
git clone https://github.com/sivasuryachandran/marlow.git && cd marlow
npm install
npm test && npm run typecheck && npm run build   # expect 151 tests passing
npm run dev                                       # http://localhost:5173/?seed=7  (Chrome, headphones)
```
Without keys the game uses Chrome speech recognition and an offline intent parser. Never ask for or paste real API keys; `.env` is gitignored and no key is in any commit.

## Claims, and where to check each
| Claim | Check it with |
|---|---|
| The engine is pure and deterministic (one seeded RNG, replay gives identical logs) | `npm run replay`; `packages/engine/src/rules.ts` |
| An invalid or hallucinated model action can never reach the engine | `packages/game/src/verify.ts`, `match.ts`; stress test in `tools/eval.ts` (41,040 model replies, 0 wrong-target, 0 illegal) |
| Wrong-target protection: the model must quote the words naming its target, and the code checks them | `packages/game/src/match.ts`; `EVAL_SKIP_AUDIO=1 EVAL_TAG=x npm run eval -- --backends mock` |
| Game balance is measured, not guessed | `npx tsx tools/simulate.ts` (careful play wins, reckless play can't win cleanly) |
| A silent alarm (10 moves after the ledger is taken) makes waiting stop working; deterministic; measured, not target-shaped | `packages/engine/src/rules.ts`, `simulation.md` (includes an alarm-length sweep and the "waiter" player) |
| Every sound has a caption and a scope animation, so the game is understandable muted | `web/src/captions.ts` (+ test that every cue id has text), caption strip in the UI |
| Generated missions are validated and balance-tested before play | `packages/game/src/mission.ts`, `server/src/mission-author.ts`, `npm run mission -- --list`, `assets/missions/*/report.md`, [generation-stats.md](generation-stats.md) (every run, failures included) |
| Truth flows engine to narration only; the model never states facts | `packages/game/src/narrate.ts`, `session.ts` |
| Accessibility: axe-clean, keyboard-only playable, audio-only mode | `PROGRESS.md` (accessibility audit); open the app, press O |
| Meta models used for real: Spark (intent, mission authoring), Voice Transcribe, Muse Image | `server/src/adapters/*`, `tools/check-access.ts`, request shapes pinned in `adapters.test.ts` |

## Where I would attack it
1. Prompt-injection or odd phrasing that makes the model pick a legal-but-unintended action (see `data/eval/commands.jsonl` and `heldout.jsonl` for the test phrases).
2. The mission generator: can a hostile theme or case text get unsafe or off-brand content past the checks in `checkText`?
3. The WebSocket relay (`server/src/seer.ts`): room codes, message size, a seer sending messages.
4. Anything in `web/` that could leak the guard's true position to the solo player (the player map must never show him).
5. Repo hygiene: secrets, licences (`CREDITS.md`), large files.

## Known limits (please do not rediscover these as findings)
- No blind or low-vision tester has played it; no real screen reader (NVDA, JAWS, VoiceOver) was used. Only axe-core and keyboard checks.
- Audio quality is unjudged by any listener. Sound effects and music are synthesized in the browser; voices are Kokoro. No recorded audio assets.
- Held-out eval case h30 ("head out") exposed a real bug that was then fixed, so it is no longer a clean held-out case (disclosed in `metrics.heldout.md`).
- Spark accuracy varies run to run (dev set 94 to 100% across four runs); Spark Open on Baseten was last measured at 76.7% on the held-out set and has not been re-run.
- Three missions have been generated end to end (gallery, Louvre, diamond vault); 3 of 4 case runs recorded by the instrumented generator... see generation-stats.md for the real counts, including failures and one false rejection caused by my own checker.
- The generator tunes balance with simulated players (careful, reckless), not people; real players may find generated levels easier or harder. The silent alarm length (10 on the built-in level) was chosen from a simulation sweep so a human has slack, not from human play.
- Seer link works on the same network only (no hosted relay). `PLAYTEST.md` is the protocol for a two-person test; it has not been run, so there is no evidence yet that people want to play this.

## A prompt you can paste to another agent
> You are reviewing the public repo https://github.com/sivasuryachandran/marlow, a hackathon game. Read `EVALUATION.md` and `README.md` first. Clone it, run `npm install && npm test && npm run typecheck`, and play it with `npm run dev`. Then act as [a senior engineer / a security reviewer / an accessibility specialist / a game designer / a hackathon judge]. Verify the claims in the table yourself instead of trusting the docs, try to break the areas listed under "Where I would attack it", and report: (1) bugs with exact steps, (2) claims that are false or overstated, (3) the three highest-impact improvements, (4) a score out of 10 for originality, technical depth, accessibility and polish, each with a reason. Do not use or request API keys.
