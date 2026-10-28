# MARLOW

A screenless, binaural heist radio-drama you play by voice. You are Owl, running the job from a van; Marlow is the only one who can see. Muse understands what you say; a deterministic engine decides what happens.

Built for the Meta Global AI Developer Hackathon (Indie track). All code written during the hackathon. See `PROGRESS.md` for status.

```
npm install
npm test          # engine rules + replay determinism
npm run dev       # typed-command page; add ?debug=1&seed=42
npm run check-access
```
Copy `.env.example` to `.env` for API keys (never committed).
