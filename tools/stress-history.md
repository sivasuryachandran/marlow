## What stress testing found, and what I did about it (2026-11-01)

**Real problems in the game: all fixed, each with a regression test**
1. **A model adapter that throws crashed the turn.** If the intent adapter threw or rejected (network down, a 500), `Session.submit` threw; in the browser that left the status stuck on "Marlow is working it out…". Now it is the in-fiction "Signal's bad, say again?" and the world is untouched. *Found by the pipeline fuzz.*
2. **A malformed mission spec crashed the generator** with `Cannot read properties of null`. Spark's output is schema-constrained so this is unlikely, but a non-conforming reply would have killed a generation job. Now every spec is shape-checked first and bad ones are rejected with clear errors, and the author loop catches anything else. *Found by the generator fuzz.*
3. **Long input was slow:** about 3 seconds on a 360,000-character string (spoken orders are never that long, but the typed box accepts anything). Orders are now cut at 400 characters inside the parser and the session, and the input box has a 300-character limit. Slowest case now 0.3 ms. *Found by the parser fuzz.*
4. **The paid and file-writing endpoints had no limits.** `/api/intent`, `/api/transcribe` and `/api/missions/generate` are unauthenticated, so anyone who can reach the port (for example on your Wi-Fi after `npm run dev:lan`) could spend your Meta credits. Added per-client rate limits and body-size caps (413 for oversize, 429 for floods, 411 without a length; a forged X-Forwarded-For does not dodge them), validation so only requests the game could have sent reach the model, and 400 instead of 500 for junk JSON. Verified against the live server with oversize bodies, a 140-request flood, and path-traversal ids (all refused). **This is damage control, not authentication: do not expose this server to the internet.** *Found by reading the endpoints while planning the HTTP probes.*

**Mistakes in my own stress tests, found and fixed (not game bugs)**
- The relay "bad joins accepted" and "rooms leaked" findings were my test not reading the server's close code and leaving sockets open.
- My random mission specs were almost never valid, so "every accepted mission is winnable" was barely exercised; the generator layer now builds hub-shaped specs and 343 of 800 are accepted and checked against the engine's solver.
- A test hung because I attached a listener after the message it was waiting for had already arrived; every layer now has a watchdog.
- **My HTTP probe accidentally started a real mission generation** (theme "x" is valid input). I killed it within about a minute; it left no files or records and spent at most a Spark call or two.

**What found nothing** (and how hard it looked): the engine kept every invariant over 26,445 random and junk steps on four levels, never accepted an invalid action, replayed identically, and every one of 480 solver plans actually won when executed, including through the silent alarm. The relay held 120 rooms and 480 sockets, a 2,400-message flood, junk and oversize messages, and leaked no rooms.

**What stress testing did not cover**
- Real audio. Browser stress used typed input, and the browser pane cannot use a microphone.
- Real load: 480 sockets on one machine is not production, and Spark's latency under many players was not tested.
- A security review. The HTTP probes were a handful of cases, not a penetration test; there is no authentication.
- Long-session memory in the browser (runs were minutes, not hours).
- Mobile and slow-network behaviour.

## Browser stress (run by hand in the browser pane, 2026-11-01)
40 orders submitted back to back, including `<script>` and `<img onerror>` payloads, 5,000-character strings, emoji, null bytes and `__proto__`: **no JavaScript errors, nothing injected into the page** (the payloads appear as plain text), page responsive. Then six new runs started in under a second, every tab, hotkeys 1 to 7, audio-only and co-op toggled repeatedly and Escape mashed while orders were being sent: **no errors, no overflowing elements, end card hidden and status correct afterwards.** Note: this pass ran with the API server stopped, so it exercised the game's offline fallback parser; the validated-endpoint path was then checked separately with one real Spark call (HTTP 200).
