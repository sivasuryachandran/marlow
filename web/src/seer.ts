/** Seer page: a friend who can see watches the ground truth and talks to the player who can only listen. Read-only. */
import type { WorldState } from "@marlow/shared";
import { truthLine } from "./debug";
import { FloorPlan } from "./floorplan";
import type { GameEvent } from "@marlow/shared";

interface Snapshot { type: "state"; turn: number; runNumber: number; state: WorldState; history: string[]; events?: GameEvent[] }
let plan: FloorPlan | null = null;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const q = new URLSearchParams(location.search);
const code = (q.get("room") ?? "").toUpperCase();
let ws: WebSocket | null = null, retry = 0;

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/seer?room=${encodeURIComponent(code)}&role=seer`);
  $("sConn").textContent = "connecting…";
  ws.onopen = () => { retry = 0; };
  ws.onmessage = e => {
    const m = JSON.parse(e.data as string);
    if (m.type === "host") $("sConn").textContent = m.connected ? "connected to the listener" : "waiting for the listener";
    if (m.type === "state") render(m as Snapshot);
  };
  ws.onclose = e => {
    if (e.code === 4001) { $("sConn").textContent = "room not available"; return; }
    $("sConn").textContent = "reconnecting…";
    setTimeout(connect, Math.min(8000, 1000 * 2 ** retry++));
  };
}

function render(m: Snapshot) {
  const s = m.state;
  $("sTurn").textContent = String(s.turn).padStart(2, "0");
  $("sObj").textContent = s.status !== "playing" ? (s.status === "won" ? "Job done" : "Caught") : s.marlow.carrying ? "Exit through the lobby" : "Secure the ledger";
  document.querySelectorAll<HTMLElement>("#topbar .chip").forEach(c => c.classList.toggle("on", Number(c.dataset.a) === Math.min(3, s.alert)));
  plan ??= new FloorPlan($("seerMap") as HTMLCanvasElement);
  plan.update(s, m.events ?? []);
  $("seerMap").setAttribute("aria-label", `Ground-truth floor plan. ${truthLine(s)}`);
  $("truth").textContent = s.status === "playing" ? truthLine(s) : s.status === "won" ? "They made it out." : "Marlow was caught.";
  const box = $("heard"); box.replaceChildren();
  for (const t of m.history) { const p = document.createElement("p"); p.className = t.startsWith("[") ? "cue" : t.startsWith("Client") ? "client" : t.startsWith("Owl") ? "you" : "marlow"; p.textContent = t.replace(/^\[(.*)\]$/, "($1)"); box.append(p); }
  box.scrollTop = box.scrollHeight;
}

if (/^[A-Z]{4}$/.test(code)) {
  $("sRoom").textContent = code; $("seerView").hidden = false; connect();
} else {
  $("join").hidden = false;
  $("joinForm").addEventListener("submit", e => {
    e.preventDefault();
    const c = ($("code") as HTMLInputElement).value.trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(c)) location.search = `?room=${c}`;
  });
  ($("code") as HTMLInputElement).focus();
}
