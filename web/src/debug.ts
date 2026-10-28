import type { Session } from "@marlow/game";
import { guardRoom, locate } from "@marlow/engine";
import type { GameEvent } from "@marlow/shared";

/** Debug/demo mode (?debug=1): hidden engine map, Marlow's knowledge overlay, live event log. Never rendered otherwise. */
export function renderDebug(session: Session, lastEvents: GameEvent[], extra: Record<string, unknown>) {
  const s = session.state, svg = document.getElementById("map")!, pre = document.getElementById("debug")!;
  svg.removeAttribute("hidden"); pre.removeAttribute("hidden");
  const xs = s.rooms.map(r => r.pos[0]), ys = s.rooms.map(r => r.pos[1]);
  const minX = Math.min(...xs), maxY = Math.max(...ys), W = 110, H = 70;
  const at = (id: string) => { const r = s.rooms.find(x => x.id === id)!; return [20 + (r.pos[0] - minX) * (W + 30), 20 + (maxY - r.pos[1]) * (H + 40)] as const; };
  let out = "";
  for (const d of s.doors) {
    const [ax, ay] = at(d.between[0]), [bx, by] = at(d.between[1]);
    const known = s.knowledge.doors.includes(d.id);
    out += `<line x1="${ax + W / 2}" y1="${ay + H / 2}" x2="${bx + W / 2}" y2="${by + H / 2}" stroke="${known ? "#e8a33d" : "#555"}" stroke-width="${d.state === "open" ? 2 : 5}" stroke-dasharray="${d.kind === "arch" ? "4 3" : ""}"/>`;
  }
  const g = guardRoom(s);
  for (const r of s.rooms) {
    const [x, y] = at(r.id), known = s.knowledge.rooms.includes(r.id), here = s.marlow.room === r.id;
    out += `<rect x="${x}" y="${y}" width="${W}" height="${H}" fill="${known ? "#1c2a1c" : "#14141c"}" stroke="${here ? "#fff" : "#667"}" stroke-width="${here ? 3 : 1}"/>`;
    out += `<text x="${x + 6}" y="${y + 16}" fill="#ccd" font-size="12">${r.id}${known ? " ✓" : ""}</text>`;
    s.props.filter(p => p.room === r.id).forEach((p, i) => (out += `<text x="${x + 6}" y="${y + 32 + i * 12}" fill="${s.knowledge.props.includes(p.id) ? "#9f9" : "#977"}" font-size="10">${p.id}</text>`));
    s.items.filter(i => i.room === r.id).forEach(i => (out += `<text x="${x + 6}" y="${y + H - 6}" fill="#e8a33d" font-size="11">${i.id}</text>`));
    if (g === r.id) out += `<circle cx="${x + W - 14}" cy="${y + 16}" r="8" fill="#e44"><title>guard</title></circle>`;
    if (here) out += `<circle cx="${x + W - 14}" cy="${y + H - 14}" r="8" fill="#fff"><title>Marlow</title></circle>`;
  }
  svg.innerHTML = out;
  pre.textContent = JSON.stringify({
    run: session.runId, runNumber: session.runNumber, turn: s.turn, alert: s.alert, trust: s.trust, status: s.status,
    guard: { room: g, step: s.guard.step, detour: s.guard.detour, returning: s.guard.returning, fromMarlow: locate(s, g) }, marlow: s.marlow, knowledge: s.knowledge,
    lastEvents, ...extra,
  }, null, 1);
}
