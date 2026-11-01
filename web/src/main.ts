import linesJson from "../../data/lines.json";
import loreJson from "../../data/lore.json";
import beatsJson from "../../data/beats.json";
import level from "../../data/level.json";
import { Session, loadBank, renderLine, type Beat, type SpokenLine, type TurnOutput } from "@marlow/game";
import type { GameEvent } from "@marlow/shared";
import { AudioEngine, type AudioSettings } from "./audio";
import { renderDebug } from "./debug";
import { HttpIntent } from "./intent-client";
import { loadPrefs, LocalStore, savePrefs } from "./storage";
import { BrowserStt, ServerStt, type Stt } from "./stt";
import { HandsFree } from "./vad";
import { initCockpit, micLevel, onTurn, resetRun, setMic, showTab, truthRevealed } from "./cockpit";

const q = new URLSearchParams(location.search);
const debug = q.get("debug") === "1";
const fixedSeed = q.has("seed") ? Number(q.get("seed")) : null;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const bank = loadBank(linesJson);
const audio = new AudioEngine();
const store = new LocalStore();
const intent = new HttpIntent();
let session: Session;
let seed = fixedSeed ?? Math.floor(Math.random() * 1e6);
let stt: Stt | null = null;
let recording = false;
let hf: HandsFree | null = null, muted = false, busy = false;
const hfPause = () => { if (hf) { hf.paused = true; hf.reset(); } };
const hfResume = () => { if (hf && !muted) setTimeout(() => { if (!busy) hf!.paused = false; }, 500); };
let lastEvents: GameEvent[] = [];
const latencies: number[] = [];

// ---------- log (everything audible is also text) ----------
function log(cls: string, text: string) {
  const p = document.createElement("p"); p.className = cls; p.textContent = text;
  const box = $("log"); box.append(p); box.scrollTop = box.scrollHeight;
}
const status = (t: string) => { $("status").textContent = t; };
function showTurn(out: TurnOutput) {
  for (const c of out.cues) if (c.caption) log("cue", `[${c.caption}]`);
  for (const l of out.lines) log(l.speaker === "client" ? "client" : "marlow", `${l.speaker === "client" ? "Client" : "Marlow"}: ${l.text}`);
  if (out.kind === "timeout") log("sys", "[Static burst: signal's bad]");
  onTurn(out);
}

// ---------- settings ----------
const prefs = loadPrefs<AudioSettings & { captions: boolean }>("marlow.prefs.v1", { voice: 1, music: 0.35, sfx: 1, mono: false, ambience: false, captions: true });
function bindSettings() {
  const map: [string, keyof AudioSettings][] = [["vVoice", "voice"], ["vMusic", "music"], ["vSfx", "sfx"]];
  for (const [id, key] of map) {
    const el = $<HTMLInputElement>(id); el.value = String(prefs[key]);
    el.addEventListener("input", () => { prefs[key] = Number(el.value) as never; audio.applySettings({ [key]: prefs[key] }); savePrefs("marlow.prefs.v1", prefs); });
  }
  const amb = $<HTMLInputElement>("ambience"); amb.checked = prefs.ambience;
  amb.addEventListener("change", () => { prefs.ambience = amb.checked; audio.applySettings({ ambience: amb.checked }); savePrefs("marlow.prefs.v1", prefs); });
  const mono = $<HTMLInputElement>("mono"); mono.checked = prefs.mono;
  mono.addEventListener("change", () => { prefs.mono = mono.checked; audio.applySettings({ mono: mono.checked }); savePrefs("marlow.prefs.v1", prefs); });
  const cap = $<HTMLInputElement>("captions"); cap.checked = prefs.captions;
  const applyCaps = () => { $("log").classList.toggle("sr-only", !cap.checked); $("partial").hidden = !cap.checked; };
  cap.addEventListener("change", () => { prefs.captions = cap.checked; applyCaps(); savePrefs("marlow.prefs.v1", prefs); });
  applyCaps();
  Object.assign(audio.settings, prefs);
  $("forget").addEventListener("click", () => { store.reset(); status("Marlow has forgotten your past runs."); });
}

// ---------- session ----------
function postLog(runId: string, row: Record<string, unknown>) {
  fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, row }) }).catch(() => {});
}
function newSession() {
  const runId = `${seed}-${Date.now().toString(36)}`;
  session = new Session({
    level, bank, beats: beatsJson as Beat[], lore: loreJson as unknown as Record<string, [string, string][]>, intent, seed, memory: store, runId,
    timeoutMs: Number((q.get("timeout") ?? 7000)), onLog: row => postLog(runId, row),
  });
  $("log").replaceChildren(); $("end").hidden = true; $("casefileOut").textContent = ""; $<HTMLIFrameElement>("casefileFrame").hidden = true; resetRun();
}

function refresh() {
  const dbg = debug || truthRevealed() ? { intentBackend: intent.usingFallback ? "mock (in-browser)" : intent.name, sttBackend: stt?.name ?? "typed", missingAssets: [...audio.missing], latencyMs: summarize() } : {};
  if (debug || truthRevealed()) renderDebug(session, lastEvents, dbg);
}
function summarize() {
  if (!latencies.length) return null;
  const a = [...latencies].sort((x, y) => x - y);
  return { n: a.length, p50: Math.round(a[Math.floor(a.length * 0.5)]), p95: Math.round(a[Math.min(a.length - 1, Math.floor(a.length * 0.95))]) };
}

async function begin() {
  $("hero").hidden = true; $("game").hidden = false; $("ptt").focus({ preventScroll: true }); // keyboard users land on the talk control
  await audio.unlock();
  audio.applySettings(prefs);
  await intent.init();
  void intent.warmup();
  const h = await fetch("/api/health").then(r => r.json()).catch(() => null);
  stt = h?.stt ? new ServerStt() : BrowserStt.available() ? new BrowserStt() : null;
  if (!stt) $("ptt").textContent = "VOICE INPUT UNAVAILABLE · TYPE BELOW";
  newSession();
  if (stt instanceof ServerStt) await startHandsFree();
  const intro = session.start();
  status("The client is on the line…");
  showTurn(intro);
  refresh();
  hfPause(); await audio.playTurn(intro); hfResume();
  status(`Marlow is in position. Run ${session.runNumber}. ${hf ? "Just speak; the mic is always listening." : stt ? "Hold the button or Space to talk." : "Type an order."}`);
}

async function handleTranscript(text: string) {
  busy = true; hfPause();
  try { await handleTranscript1(text); } finally { busy = false; hfResume(); }
}
async function handleTranscript1(text: string) {
  log("you", `You: ${text}`);
  status("Marlow is working it out…");
  audio.startWaiting(session.state.knowledge.guardLastHeard as never, session.state.rooms.find(r => r.id === session.state.marlow.room)!.reverb);
  const t0 = performance.now();
  const out = await session.submit(text);
  audio.stopWaiting();
  if (!out) return; // superseded by a newer turn: reply discarded
  latencies.push(performance.now() - t0);
  lastEvents = out.events;
  showTurn(out);
  if (out.kind === "timeout") audio.playStatic();
  refresh();
  await audio.playTurn(out);
  if (out.state.status !== "playing") finish(out);
  else status("Your move.");
}

function finish(out: TurnOutput) {
  $("end").hidden = false;
  $("endText").textContent = out.state.status === "won"
    ? `Job done in ${out.state.turn} turns. Alert ${out.state.alert} of 3. Trust ${Math.round(out.state.trust)}.`
    : `Marlow was caught after ${out.state.turn} turns. Trust ${Math.round(out.state.trust)}.`;
  status("The run is over.");
  $<HTMLButtonElement>("again").focus();
}

// ---------- always-on listening ----------
async function startHandsFree() {
  try {
    hf = new HandsFree({
      onSegment: async wav => {
        if (busy || muted) return;
        busy = true; hfPause();
        void audio.playAck(); status("Got it…");
        let text: string | null = null;
        try {
          const r = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
          if (r.ok) text = ((await r.json()) as { text: string }).text?.trim() || null;
        } catch { /* fall through */ }
        busy = false;
        if (!text) { log("sys", "[No speech picked up.]"); status("Didn't catch that."); hfResume(); return; }
        void handleTranscript(text);
      },
      onLevel: (r, speaking) => { micLevel(r); if (speaking && !busy) status("Listening…"); },
    });
    await hf.start();
    const b = $("ptt"); b.textContent = "LISTENING · TAP TO MUTE"; b.setAttribute("aria-pressed", "false"); setMic("mic live", true);
  } catch {
    hf = null; log("sys", "[Microphone unavailable. Hold the button or Space to talk, or type.]");
  }
}
function toggleMute() {
  if (!hf) return;
  muted = !muted; const b = $("ptt");
  b.setAttribute("aria-pressed", String(muted)); b.textContent = muted ? "MUTED · TAP TO LISTEN" : "LISTENING · TAP TO MUTE"; setMic(muted ? "mic muted" : "mic live", !muted);
  if (muted) hfPause(); else hf.paused = false;
  status(muted ? "Mic muted." : "Listening.");
}

// ---------- push to talk ----------
async function pttDown() {
  if (recording || !stt || !session) return;
  recording = true; $("ptt").setAttribute("aria-pressed", "true");
  status("Listening…");
  stt.start(t => { $("partial").textContent = t; });
}
async function pttUp() {
  if (!recording || !stt) return;
  recording = false; $("ptt").setAttribute("aria-pressed", "false");
  const ackLine = renderLine(bank, { id: "system.ack", slots: {} }, { seed, turnId: session.currentTurn + 1, curt: false });
  void audio.playAck(ackLine ?? undefined); // instant radio click + "Copy."
  let text: string | null = null;
  try { text = await stt.stop(); }
  catch {
    text = null;
    if (stt instanceof ServerStt && BrowserStt.available()) { stt = new BrowserStt(); log("sys", "[Cloud transcription failed; switched to browser speech recognition. Say it again.]"); }
  }
  $("partial").textContent = "";
  if (!text) { log("sys", "[No speech picked up. Try again, or type.]"); status("Didn't catch that."); return; }
  void handleTranscript(text);
}
let spaceAt = -1e9;
function wirePtt() {
  const b = $("ptt");
  b.addEventListener("pointerdown", e => { e.preventDefault(); if (hf) toggleMute(); else void pttDown(); });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, () => { if (!hf) void pttUp(); });
  // keyboard activation (Enter or Space on the focused button) arrives as a click with detail 0; a Space already handled as push-to-talk is skipped
  b.addEventListener("click", e => { if (e.detail !== 0 || performance.now() - spaceAt < 700) return; if (hf) toggleMute(); else void (recording ? pttUp() : pttDown()); });
  document.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if (e.code !== "Space" || t.tagName === "INPUT" || $("game").hidden || hf || (t.closest("button,a,select,textarea,[role=tab]") && t.id !== "ptt")) return;
    spaceAt = performance.now();
    e.preventDefault(); if (!e.repeat) void pttDown();
  });
  document.addEventListener("keyup", e => {
    const t = e.target as HTMLElement;
    if (e.code !== "Space" || t.tagName === "INPUT" || $("game").hidden || hf || (t.closest("button,a,select,textarea,[role=tab]") && t.id !== "ptt")) return;
    spaceAt = performance.now();
    e.preventDefault(); void pttUp();
  });
}

// ---------- wiring ----------
bindSettings(); wirePtt();
initCockpit({
  send: text => { if (busy || !session) return; void audio.playAck(); void handleTranscript(text); },
  session: () => session, audio, latencyP50: () => (latencies.length ? [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)] : null),
  onReveal: () => refresh(),
});
$("start").addEventListener("click", () => void begin());
$("f").addEventListener("submit", e => {
  e.preventDefault();
  const el = $<HTMLInputElement>("cmd"); const text = el.value.trim(); el.value = "";
  if (!text || !session) return;
  void audio.playAck(); void handleTranscript(text);
});
$("again").addEventListener("click", async () => {
  seed = (fixedSeed ?? seed) + 1; if (fixedSeed != null) { /* stay reproducible: run 2 = seed+1 */ }
  newSession();
  const intro = session.start(); showTurn(intro); refresh();
  status(`Run ${session.runNumber}.`); hfPause(); await audio.playTurn(intro); hfResume(); status("Marlow is in position.");
});
$("casefile").addEventListener("click", async () => {
  const out = $("casefileOut"); out.textContent = "Drawing the Case File…";
  try {
    const r = await fetch(`/api/casefile/${session.runId}`, { method: "POST" });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    out.innerHTML = `Ready: <a href="${j.url}" target="_blank" rel="noopener">open the Case File in a new tab</a> (${j.panels} panels, ${j.sources.join(", ")}).`;
    const fr = $<HTMLIFrameElement>("casefileFrame"); fr.src = j.url; fr.hidden = false;
  } catch {
    out.textContent = `The Case File needs the server (npm run server). From a terminal: npx tsx tools/casefile.ts ${session.runId}`;
  }
});
if (debug) { (window as any).__marlow = { get session() { return session; }, audio }; }
