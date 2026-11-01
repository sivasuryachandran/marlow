/** Host side of the Seer link: publishes a snapshot of the world after every turn to a room a friend can watch. */
import type { Session, TurnOutput } from "@marlow/game";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O: easy to read out over a call
let ws: WebSocket | null = null, code = "", hosting = false, retry = 0, last: string | null = null;
let history: string[] = []; // the last lines the listener heard, so a seer who joins late can catch up

const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/seer?room=${code}&role=host`);
  $("coopStatus").textContent = "Connecting…";
  ws.onopen = () => { retry = 0; $("coopStatus").textContent = "Waiting for your seer to open the link."; if (last) ws!.send(last); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data as string);
    if (m.type === "seers") $("coopStatus").textContent = m.count ? `${m.count} seer${m.count > 1 ? "s" : ""} watching. Talk to them on a call.` : "Waiting for your seer to open the link.";
  };
  ws.onclose = () => {
    if (!hosting) return;
    $("coopStatus").textContent = "The server is not reachable (is npm run server running?). Retrying…";
    setTimeout(() => hosting && connect(), Math.min(8000, 1000 * 2 ** retry++));
  };
}

async function showLinks() {
  const local = `${location.origin}/seer.html?room=${code}`;
  $("coopCode").textContent = code;
  ($("coopLink") as HTMLInputElement).value = local;
  const lan: string[] = await fetch("/api/lan").then(r => (r.ok ? r.json() : [])).catch(() => []);
  const port = location.port ? `:${location.port}` : "";
  $("coopLan").textContent = lan.length && /^(localhost|127\.)/.test(location.hostname)
    ? `Friend on the same Wi-Fi: start the game with "npm run dev:lan", then they open http://${lan[0]}${port}/seer.html?room=${code}`
    : "";
}

export function initCoop() {
  $("coopBtn").addEventListener("click", async () => {
    const panel = $("coop");
    if (!hosting) {
      hosting = true; code = newCode(); panel.hidden = false;
      $("coopBtn").setAttribute("aria-pressed", "true");
      await showLinks(); connect(); $("coopCode").focus();
    } else panel.hidden = !panel.hidden;
  });
  $("coopCopy").addEventListener("click", async () => {
    const v = ($("coopLink") as HTMLInputElement).value;
    try { await navigator.clipboard.writeText(v); $("coopCopy").textContent = "Copied"; } catch { ($("coopLink") as HTMLInputElement).select(); }
    setTimeout(() => ($("coopCopy").textContent = "Copy link"), 1500);
  });
  $("coopStop").addEventListener("click", () => {
    hosting = false; ws?.close(); ws = null; last = null;
    $("coop").hidden = true; $("coopBtn").setAttribute("aria-pressed", "false");
  });
}

/** Called after every turn. Sends nothing unless the player started a Seer link. */
export function publishTurn(session: Session, out: TurnOutput) {
  if (!hosting) return;
  if (out.turnId === 0) history = []; // a new run
  if (out.transcript) history.push(`Owl: ${out.transcript}`);
  history.push(...out.cues.filter(c => c.caption).map(c => `[${c.caption}]`), ...out.lines.map(l => `${l.speaker === "client" ? "Client" : "Marlow"}: ${l.text}`));
  history = history.slice(-40);
  last = JSON.stringify({ type: "state", turn: out.state.turn, runNumber: session.runNumber, state: out.state, history });
  if (ws?.readyState === WebSocket.OPEN) ws.send(last);
}
