# CREDITS

Every asset and third-party component, with source and license. No third-party audio, images or fonts are bundled yet: all sounds are synthesized at runtime from code in this repo (see PROGRESS.md for the placeholder list).

| Item | Source | License |
|---|---|---|
| zod | https://github.com/colinhacks/zod | MIT |
| hono, @hono/node-server | https://github.com/honojs/hono | MIT |
| vite, vitest | https://github.com/vitejs/vite · https://github.com/vitest-dev/vitest | MIT |
| tsx, typescript, @types/node | npm | MIT / Apache-2.0 |
| Web Audio API (HRTF PannerNode, ConvolverNode) | browser standard | n/a |
| Synthesized impulse responses, SFX, music, ambience | `web/src/audio.ts` (original code) | repo license |
| Kokoro-82M (planned offline TTS, not installed) | https://huggingface.co/hexgrad/Kokoro-82M | Apache-2.0 weights. **Dev-only, offline tool**: `kokoro-js` is installed locally to pre-render WAV files and is not a dependency of the shipped game. Its phonemizer path is believed to use espeak-ng (GPL-3.0); to verify before install. Only the generated audio files ship, never the tool. Not legal advice. |
| Muse Spark, Voice Transcribe, Image | Meta Model API (https://dev.meta.ai/docs) | provider terms; Case File images generated at run time by Muse Image, labeled "Illustrated from the run log" |
| Muse Spark Open | Baseten Model APIs (`meta-models/muse-spark-open`) | provider terms |
| Muse Wonder, SAM 3.1 | Meta Model API | optional, not used yet |

Intended future sources (log here when used): OpenAIR impulse responses (per-file CC license), Freesound CC0 filter, Sonniss GDC bundles, CC0 music stems.

Real places, if mentioned, are settings only. All characters and targets are fictional.

## Story inspiration (public domain in the US; ideas adapted, no text copied)
- Edgar Allan Poe, "The Purloined Letter" (1844) and "The Tell-Tale Heart" (1843), via Project Gutenberg eBook 2148.
- Maurice Leblanc, *The Extraordinary Adventures of Arsène Lupin, Gentleman-Burglar* (1907), "The Black Pearl", via Project Gutenberg eBook 6133. Leblanc died in 1941, so check local law outside the US.
- E. W. Hornung, *The Amateur Cracksman* (1899), via Project Gutenberg eBook 706.
All names, dialogue and plot specifics in MARLOW are original. See STORY.md.

## Story illustrations
`assets/art/story/*.jpg` (12 images) were generated once with **Muse Image** (`muse-image-1.0`, Meta Model API) by `npm run story-art`, then recompressed with ffmpeg. They are mood illustrations only and never carry game facts. The UI layout follows designs made in Google Stitch for this project.

## Seer link (co-op)
`ws` 8.x (MIT) for the WebSocket relay. Design informed by Keep Talking and Nobody Explodes (information split between players), Operation: Tango (each player sees a different part of the world) and the CHI 2021 paper "Exploring Asymmetric Roles in Mixed-Ability Gaming" (Gonçalves et al.). No code or assets from those works.

## Interface theme (1960s caper picture)
Fonts from Google Fonts: Limelight (SIL OFL), Libre Baskerville (SIL OFL), Special Elite (Apache 2.0), Courier Prime (SIL OFL). Interface art in `assets/art/ui/` (title poster, five cast portraits, paper and blueprint textures) generated with **Muse Image** by `npm run story-art -- --set=ui`, recompressed with ffmpeg. The portraits are invented characters; the Hale portrait was regenerated once because the first version resembled a classic screen star too closely.
