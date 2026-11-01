import type { Session } from "@marlow/game";
import { guardRoom, locate, nextGuardRoom } from "@marlow/engine";
import type { GameEvent, WorldState } from "@marlow/shared";

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Ground-truth map of the building as SVG: every room, door, prop and item, Marlow, and the guard's real room with
 * the room he steps into next. Used by the Spectator tab and the Seer link. Never shown in the player's own view.
 */
export function mapSvg(s: WorldState): string {
  const xs = s.rooms.map(r => r.pos[0]), ys = s.rooms.map(r => r.pos[1]);
  const minX = Math.min(...xs), maxY = Math.max(...ys), W = 120, H = 78, GX = 34, GY = 40;
  const at = (id: string) => { const r = s.rooms.find(x => x.id === id)!; return [16 + (r.pos[0] - minX) * (W + GX), 16 + (maxY - r.pos[1]) * (H + GY)] as const; };
  const g = guardRoom(s), next = nextGuardRoom(s);
  let out = "";
  for (const d of s.doors) {
    const [ax, ay] = at(d.between[0]), [bx, by] = at(d.between[1]);
    const known = s.knowledge.doors.includes(d.id);
    out += `<line x1="${ax + W / 2}" y1="${ay + H / 2}" x2="${bx + W / 2}" y2="${by + H / 2}" stroke="${known ? "#ff9f43" : "#3a4256"}" stroke-width="${d.state === "open" ? 3 : 6}" stroke-dasharray="${d.kind === "arch" ? "6 4" : ""}"><title>${esc(d.spokenName)}${d.state === "open" ? " (open)" : ""}</title></line>`;
  }
  for (const r of s.rooms) {
    const [x, y] = at(r.id), known = s.knowledge.rooms.includes(r.id), here = s.marlow.room === r.id;
    out += `<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8" fill="${known ? "#152234" : "#10141d"}" stroke="${here ? "#2fd9ee" : r.offstage ? "#2a3142" : "#3a4256"}" stroke-width="${here ? 3 : 1}" stroke-dasharray="${r.offstage ? "4 3" : ""}"/>`;
    out += `<text x="${x + 8}" y="${y + 17}" fill="#e8ebf2" font-size="12" font-family="Space Grotesk, sans-serif" font-weight="700">${esc(r.spokenName.replace(/^the /, ""))}</text>`;
    s.props.filter(p => p.room === r.id).forEach((p, i) => (out += `<text x="${x + 8}" y="${y + 33 + i * 12}" fill="${p.tags.includes("hide") ? "#5be28a" : "#8b93a7"}" font-size="10" font-family="JetBrains Mono, monospace">${esc(p.spokenName.replace(/^the /, ""))}${p.tags.includes("hide") ? " (cover)" : ""}</text>`));
    s.items.filter(i => i.room === r.id).forEach(i => (out += `<text x="${x + 8}" y="${y + H - 8}" fill="#ff9f43" font-size="11" font-family="JetBrains Mono, monospace">${esc(i.spokenName.replace(/^the /, ""))}</text>`));
    if (g === r.id) out += `<circle cx="${x + W - 16}" cy="${y + 18}" r="9" fill="#ff5d5d"><title>guard</title></circle><text x="${x + W - 16}" y="${y + 22}" text-anchor="middle" font-size="10" fill="#fff" font-weight="700">G</text>`;
    if (here) out += `<circle cx="${x + W - 16}" cy="${y + H - 16}" r="9" fill="${s.marlow.hidden ? "#5be28a" : "#2fd9ee"}"><title>Marlow${s.marlow.hidden ? " (hidden)" : ""}</title></circle><text x="${x + W - 16}" y="${y + H - 12}" text-anchor="middle" font-size="10" fill="#05070b" font-weight="700">M</text>`;
  }
  if (next && next !== g) { // drawn last, beside the door line, so it is never hidden
    const [ax, ay] = at(g), [bx, by] = at(next), vertical = ax === bx, ox = vertical ? 22 : 0, oy = vertical ? 0 : 22;
    out += `<line x1="${ax + W / 2 + ox}" y1="${ay + H / 2 + oy}" x2="${bx + W / 2 + ox}" y2="${by + H / 2 + oy}" stroke="#ff5d5d" stroke-width="3" stroke-dasharray="5 4" marker-end="url(#arrow)"><title>guard's next step</title></line>`;
  }
  const w = 32 + (Math.max(...xs) - minX + 1) * (W + GX), h = 32 + (maxY - Math.min(...ys) + 1) * (H + GY);
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ground-truth map"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#ff5d5d"/></marker></defs>${out}</svg>`;
}

/** Plain-language one-liner of the ground truth, for the Seer to read out. */
export function truthLine(s: WorldState): string {
  const name = (id: string) => s.rooms.find(r => r.id === id)?.spokenName ?? id;
  const g = guardRoom(s), next = nextGuardRoom(s), loc = locate(s, g);
  const where = g === s.marlow.room ? "in the same room as Marlow" : `in ${name(g)} (${loc.hops} room${loc.hops === 1 ? "" : "s"} away, ${loc.dir})`;
  return `Guard is ${where}${next && next !== g ? `, heading to ${name(next)} next` : ", staying put"}. Marlow is in ${name(s.marlow.room)}${s.marlow.hidden ? ", hidden" : ""}${s.marlow.carrying ? ", carrying the ledger" : ""}.`;
}

/** Debug/demo mode (?debug=1, or the Spectator tab after "Show ground truth"): map plus raw state and the last events. */
export function renderDebug(session: Session, lastEvents: GameEvent[], extra: Record<string, unknown>) {
  const s = session.state, map = document.getElementById("map")!, pre = document.getElementById("debug")!;
  map.removeAttribute("hidden"); pre.removeAttribute("hidden");
  map.innerHTML = mapSvg(s).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  map.setAttribute("viewBox", mapSvg(s).match(/viewBox="([^"]+)"/)![1]);
  const g = guardRoom(s);
  pre.textContent = truthLine(s) + "\n\n" + JSON.stringify({
    run: session.runId, runNumber: session.runNumber, turn: s.turn, alert: s.alert, trust: s.trust, status: s.status,
    guard: { room: g, step: s.guard.step, detour: s.guard.detour, returning: s.guard.returning, fromMarlow: locate(s, g) }, marlow: s.marlow, knowledge: s.knowledge,
    lastEvents, ...extra,
  }, null, 1);
}
