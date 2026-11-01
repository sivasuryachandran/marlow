/** The Van Cockpit UI. Shows only what Owl could know: sounds heard, Marlow's room, alert and trust, her words. Never the guard's true position. */
import type { Session, TurnOutput } from "@marlow/game";
import type { Dir, Dist, GameEvent } from "@marlow/shared";
import type { AudioEngine } from "./audio";

export interface CockpitDeps { send(text: string): void; session(): Session; audio: AudioEngine; latencyP50(): number | null; onReveal(): void }

interface Pip { label: string; dir: Dir; dist: Dist; turn: number; kind: "guard" | "world" }
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const AZ: Record<string, number> = { ahead: 0, right: 90, behind: 180, left: 270, here: 0 };
const R: Record<Dist, number> = { near: 0.33, mid: 0.62, far: 0.9 };

let deps: CockpitDeps;
let pips: Pip[] = [];
let peakAlert = 0;
let revealed = false;
export const truthRevealed = () => revealed;

// ---------------- tabs ----------------
export function showTab(name: string) {
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("#tabs [role=tab]"))) {
    const on = b.dataset.tab === name;
    b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
    document.getElementById(b.getAttribute("aria-controls")!)!.hidden = !on;
  }
  if (name === "case") renderCaseStats();
}
function wireTabs() {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("#tabs [role=tab]"));
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => showTab(b.dataset.tab!));
    b.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); showTab(n.dataset.tab!);
    });
  });
}

// ---------------- story illustrations ----------------
/** Beat id (or event) -> pre-generated Muse Image illustration. Mood only; the engine still owns every fact. */
const ART: Record<string, [string, string]> = {
  intro_first: ["title", "Owl, in the van. The Hale Gallery across the street."], intro_repeat: ["lobby", "The lobby again."],
  story_hall: ["hall", "The hall of portraits."], story_limp: ["limp", "A heavy step, a drag, and keys."], story_gallery: ["guestbook", "The guest book, open to the ninth."],
  story_office: ["office", "The empty safe. The ledger, open on the desk."], machine_ring: ["machine", "The answering machine."], machine_late: ["machine", "The answering machine."],
  ledger_twist: ["tape", "A tape, taped inside the back cover."], client_checkin: ["ines", "Ines, on the line."],
};
let seen: [string, string][] = [];
function renderPanels() {
  const box = $("casePanels"); box.replaceChildren(); if (!seen.length) { box.innerHTML = '<p class="dim">The illustrations appear here as the story unfolds.</p>'; return; }
  seen.forEach(([id, cap], i) => { const f = document.createElement("figure"); f.innerHTML = `<img alt="" loading="lazy"><figcaption><b>PANEL ${String(i + 1).padStart(2, "0")}</b> · </figcaption>`; (f.querySelector("img") as HTMLImageElement).src = `/art/story/${id}.jpg`; (f.querySelector("img") as HTMLImageElement).alt = cap; f.querySelector("figcaption")!.append(cap); box.append(f); });
}
function showArt(id: string, caption: string) {
  if (!seen.some(([x]) => x === id)) { seen.push([id, caption]); renderPanels(); }
  const fig = $("story"), img = $("storyImg") as HTMLImageElement;
  img.src = `/art/story/${id}.jpg`; img.alt = caption; $("storyCap").textContent = caption; fig.hidden = false;
}
function storyArt(out: TurnOutput) {
  const ids = out.lines.map(l => l.id);
  if (ids.includes("marlow.epilogue.burn")) return showArt("burn", "Burned. Ashes in the rain.");
  if (ids.includes("marlow.epilogue.send")) return showArt("send", "Sent. By morning the city hears her voice.");
  if (out.events.some(e => e.type === "chase_started")) return showArt("chase", "He's running at her.");
  for (const b of [...(out.beatIds ?? [])].reverse()) if (ART[b]) return showArt(ART[b][0], ART[b][1]);
}

// ---------------- helpers ----------------
const dirOf = (e: GameEvent): { dir: Dir; dist: Dist } | null => ("dir" in e && "dist" in e ? { dir: e.dir as Dir, dist: e.dist as Dist } : null);
const SOUND_LABEL: Record<string, string> = { phone_ring: "Phone ringing" };

function collect(events: GameEvent[], turn: number) {
  for (const e of events) {
    if (!e.perceived) continue;
    const d = dirOf(e); if (!d) continue;
    let label = "", kind: Pip["kind"] = "guard";
    if (e.type === "guard_heard") label = e.via === "listen" ? "Footsteps (listening)" : "Footsteps";
    else if (e.type === "warning") label = "Footsteps, coming this way";
    else if (e.type === "guard_alerted") label = "He heard that";
    else if (e.type === "sound_heard") { label = SOUND_LABEL[e.sound] ?? e.sound.replace(/_/g, " "); kind = "world"; }
    else continue;
    pips = pips.filter(p => p.label !== label); pips.push({ label, ...d, turn, kind });
  }
}

// ---------------- sonar + waveform ----------------
let sweep = 0;
function drawSonar() {
  const c = $("sonar") as HTMLCanvasElement, g = c.getContext("2d")!, W = c.width, cx = W / 2, rad = W / 2 - 14;
  g.clearRect(0, 0, W, W);
  g.strokeStyle = "#232b3b"; g.lineWidth = 1; g.setLineDash([4, 5]);
  for (const f of [R.near, R.mid, R.far]) { g.beginPath(); g.arc(cx, cx, rad * f, 0, Math.PI * 2); g.stroke(); }
  g.setLineDash([]); g.beginPath(); g.moveTo(cx, cx - rad); g.lineTo(cx, cx + rad); g.moveTo(cx - rad, cx); g.lineTo(cx + rad, cx); g.stroke();
  g.fillStyle = "#8b93a7"; g.font = "13px JetBrains Mono, monospace"; g.textAlign = "center";
  g.fillText("AHEAD", cx, 20); g.fillText("BEHIND", cx, W - 10); g.textAlign = "left"; g.fillText("L", 12, cx - 6); g.textAlign = "right"; g.fillText("R", W - 12, cx - 6);
  sweep = (sweep + 0.018) % (Math.PI * 2);
  const grad = g.createConicGradient(sweep - Math.PI / 2, cx, cx); grad.addColorStop(0, "rgba(47,217,238,0.18)"); grad.addColorStop(0.12, "rgba(47,217,238,0)"); grad.addColorStop(1, "rgba(47,217,238,0)");
  g.fillStyle = grad; g.beginPath(); g.arc(cx, cx, rad, 0, Math.PI * 2); g.fill();
  const now = deps.session().state.turn;
  for (const p of pips) {
    const age = now - p.turn; if (age > 3) continue;
    const a = (AZ[p.dir] * Math.PI) / 180, r = rad * R[p.dist], x = cx + Math.sin(a) * r, y = cx - Math.cos(a) * r, alpha = 1 - age * 0.28;
    const col = p.kind === "guard" ? `rgba(255,159,67,${alpha})` : `rgba(47,217,238,${alpha})`;
    g.fillStyle = col; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 9 + ((performance.now() / 60) % 14), 0, Math.PI * 2); g.stroke();
    g.fillStyle = `rgba(232,235,242,${alpha})`; g.font = "13px Space Grotesk, sans-serif"; g.textAlign = x > cx ? "right" : "left"; g.fillText(p.label, x + (x > cx ? -14 : 14), y + 4);
  }
  g.fillStyle = "#fff"; g.beginPath(); g.arc(cx, cx, 7, 0, Math.PI * 2); g.fill(); g.textAlign = "center"; g.font = "700 12px JetBrains Mono, monospace"; g.fillText("MARLOW", cx, cx + 24);
}
function drawWave() {
  const c = $("wave") as HTMLCanvasElement, g = c.getContext("2d")!, W = c.width, H = c.height;
  g.clearRect(0, 0, W, H); g.strokeStyle = "#ff9f43"; g.lineWidth = 2; g.beginPath();
  const an = deps.audio.analyser;
  if (an) {
    const buf = new Uint8Array(an.fftSize); an.getByteTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) { const x = (i / buf.length) * W, y = (buf[i] / 255) * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  } else { g.moveTo(0, H / 2); g.lineTo(W, H / 2); }
  g.stroke();
}
function loop() {
  if (!$("game").hidden && !document.body.classList.contains("audio-only") && !$("tab-play").hidden) { drawSonar(); drawWave(); }
  requestAnimationFrame(loop);
}

// ---------------- panels ----------------
function renderTopology() {
  const s = deps.session().state, ul = $("topology"); ul.replaceChildren();
  for (const r of s.rooms.filter(r => !r.offstage)) {
    const here = s.marlow.room === r.id, known = s.knowledge.rooms.includes(r.id);
    const li = document.createElement("li"); li.className = `${known ? "known" : ""} ${here ? "here" : ""}`;
    li.innerHTML = `<span>${r.spokenName.replace(/^the /, "")}</span><em>${here ? "MARLOW HERE" : known ? "KNOWN" : "UNEXPLORED"}</em>`;
    ul.append(li);
  }
}
function renderHeader() {
  const s = deps.session().state;
  $("hTurn").textContent = String(s.turn).padStart(2, "0");
  $("hObj").textContent = s.status !== "playing" ? (s.status === "won" ? "Job done" : "Caught") : s.marlow.carrying ? "Exit through the lobby" : "Secure the ledger";
  document.querySelectorAll<HTMLElement>("#topbar .chip").forEach(c => c.classList.toggle("on", Number(c.dataset.a) === Math.min(3, s.alert)));
  $("hTrust").style.width = `${Math.round(s.trust)}%`; $("hTrustN").textContent = `${Math.round(s.trust)}%`;
  const l = deps.latencyP50(); $("hLatency").textContent = l == null ? "—" : `${Math.round(l)} ms p50`;
  peakAlert = Math.max(peakAlert, s.alert);
}
function renderSonarNote() {
  const now = deps.session().state.turn, live = pips.filter(p => now - p.turn <= 3);
  $("sonarNote").textContent = live.length ? live.map(p => `${p.label}: ${p.dir === "here" ? "here" : p.dir}, ${p.dist}`).join(" · ") : "Nothing heard recently.";
}
function renderClarify(out: TurnOutput) {
  const box = $("clarify"), btns = $("clarifyBtns"); btns.replaceChildren();
  const choices = out.kind === "clarify" ? deps.session().pendingChoices : [];
  box.hidden = !choices.length; if (!choices.length) return;
  $("clarifyQ").textContent = out.lines.map(l => l.text).join(" ");
  for (const c of choices) { const b = document.createElement("button"); b.type = "button"; b.textContent = c.label.replace(/^./, m => m.toUpperCase()); b.addEventListener("click", () => deps.send(c.label)); btns.append(b); }
}
function renderLastTx(out: TurnOutput) {
  const l = [...out.lines].reverse().find(x => x.speaker !== "system") ?? out.lines[out.lines.length - 1]; if (!l) return;
  $("lastTx").innerHTML = `<small>${l.speaker === "client" ? "CLIENT" : "MARLOW"} · LAST TRANSMISSION</small><p></p>`;
  $("lastTx").querySelector("p")!.textContent = `“${l.text}”`;
}
function renderCaseStats() {
  const ses = deps.session?.(), has = ses && ses.state.turn > 0;
  $("caseRun").textContent = has ? `Run #${String(ses.runNumber).padStart(2, "0")}` : "play a run first";
  const el = $("caseStats"); el.replaceChildren(); if (!has) return;
  const s = ses.state;
  const stat = (k: string, v: string) => { const d = document.createElement("div"); d.className = "stat"; d.innerHTML = `<small>${k}</small><b>${v}</b>`; el.append(d); };
  stat("Turns", String(s.turn)); stat("Marlow's trust", `${Math.round(s.trust)}%`); stat("Peak alert", ["Calm", "Uneasy", "Searching", "Caught"][Math.min(3, peakAlert)]);
  stat("Outcome", s.status === "won" ? "Job done" : s.status === "caught" ? "Caught" : "In progress");
  if (ses.ending) stat("The tape", ses.ending === "burn" ? "Burned" : "Sent");
}

// ---------------- tactical chips ----------------
function showChoices(act: string) {
  const s = deps.session().state, box = $("choices"); box.replaceChildren();
  const add = (label: string, text: string) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", () => { box.replaceChildren(); deps.send(text); }); box.append(b); };
  const doors = s.doors.filter(d => d.between.includes(s.marlow.room) && s.knowledge.doors.includes(d.id));
  if (act === "move") for (const d of doors) { const o = s.rooms.find(r => r.id === (d.between[0] === s.marlow.room ? d.between[1] : d.between[0]))!; if (!o.offstage) add(`Go to ${o.spokenName}`, `go to ${o.spokenName.replace(/^the /, "")}`); }
  if (act === "peek") for (const d of doors) add(`Peek ${d.spokenName}`, `peek ${d.spokenName}`);
  if (act === "take") for (const i of s.items.filter(i => i.room === s.marlow.room && s.knowledge.items.includes(i.id))) add(`Take ${i.spokenName}`, `take ${i.spokenName.replace(/^the /, "")}`);
  if (!box.children.length) { const p = document.createElement("p"); p.className = "dim"; p.textContent = `Nothing to ${act} here that Marlow has told you about.`; box.append(p); }
}
function pressChip(act: string) {
  document.querySelectorAll("#chips button").forEach(b => b.classList.toggle("on", (b as HTMLElement).dataset.act === act));
  if (["move", "peek", "take"].includes(act)) return showChoices(act);
  $("choices").replaceChildren(); deps.send(act);
}

// ---------------- public ----------------
export function initCockpit(d: CockpitDeps) {
  deps = d; wireTabs();
  document.querySelectorAll<HTMLButtonElement>("#chips button").forEach(b => b.addEventListener("click", () => pressChip(b.dataset.act!)));
  const ao = $("audioOnly"); ao.addEventListener("click", () => { const on = document.body.classList.toggle("audio-only"); ao.setAttribute("aria-pressed", String(on)); });
  $("openCase").addEventListener("click", () => showTab("case"));
  $("reveal").addEventListener("click", () => { revealed = true; $("truth").hidden = false; $("reveal").hidden = true; deps.onReveal(); });
  document.addEventListener("keydown", e => {
    const t = e.target as HTMLElement; if (t.tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === "o") { ao.click(); return; }
    if (/^[1-7]$/.test(e.key) && !$("game").hidden && !$("tab-play").hidden) { const b = document.querySelector<HTMLButtonElement>(`#chips button[data-k="${e.key}"]`); b?.click(); }
  });
  requestAnimationFrame(loop);
}
/** Call after every turn (and at the start). */
export function onTurn(out: TurnOutput) {
  collect(out.events, out.state.turn);
  renderHeader(); renderTopology(); renderSonarNote(); renderClarify(out); renderLastTx(out); storyArt(out);
  document.querySelectorAll("#chips button").forEach(b => b.classList.remove("on")); $("choices").replaceChildren();
}
export function resetRun() { pips = []; peakAlert = 0; seen = []; if (document.getElementById("casePanels")) renderPanels(); $("story").hidden = true; }
export function setMic(text: string, live: boolean) { $("micState").textContent = text; $("ptt").classList.toggle("live", live); }
export function micLevel(rms: number) { ($("micLevel") as HTMLElement).style.width = `${Math.min(100, Math.round(rms * 900))}%`; }
