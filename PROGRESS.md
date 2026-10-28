# PROGRESS

## M1 — Access + engine (in progress; code done, access go/no-go pending)

**Done**
- Repo skeleton (npm workspaces: `packages/shared`, `packages/engine`, `server`, `web`, `tools`).
- `packages/shared`: zod schemas (WorldState, Level, Action, IntentReply) and event types.
- `packages/engine`: pure `step(state, action)`; all seven actions, `validate()` (V2 legality core), seeded RNG stored in state, spatial model, `validateLevel()` (V0-style structural check).
- `data/level.json`: 5 rooms, guard loop, ledger, scheduled office phone at turn 6.
- `web/`: minimal typed-command page (`npm run dev`, `?debug=1`, `?seed=`).
- `tools/replay.ts`, `tools/check-access.ts`.
- 34 Vitest tests green (every action rule, spotted/caught/trust, 50-seed replay determinism, invalid actions never mutate state).

**Measured**: n/a yet (no latency until M2).

**Blockers / open questions for you**
1. Meta API (from https://dev.meta.ai/docs/): base `https://api.meta.ai/v1`, `Authorization: Bearer $MODEL_API_KEY`, ASR `POST /v1/asr/transcribe` (model `muse-voice-transcribe-1.0`). NOT yet read: chat path, Spark reasoning-effort setting for Chat Completions, structured-output param, ASR request fields, Image/Wonder shapes. Adapters stay stubbed until read. Need `MODEL_API_KEY` in `.env` to run `npm run check-access`.
2. Baseten Spark Open docs not read; needs `BASETEN_API_KEY`.
3. **Go/no-go on API access: PENDING** (you record it).

**Design observations to review (rules are per brief; nothing changed)**
- Level diameter is 2 hops, so `listen` never returns "quiet" on this map (rule is implemented; add a larger map or tighten it if you want that outcome).
- The guard crosses the hall on every other step, so any 2-step quiet move into the hall is always spotted. Quiet works for the office/gallery side. Consider if this is the tension you want.
- Passive footsteps (and the Marlow warning that drives the trust rules) trigger only when the guard is within 1 hop; `listen` extends to 2.

**Next**: M2 — push-to-talk → STT → parser/intent → V1/V2 → engine → text, with latency logging and the turn-ID guard.
