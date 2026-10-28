import type { Action, WorldState } from "@marlow/shared";
import { step, validate } from "./rules";
import { neighbors } from "./spatial";

/** All actions worth trying from a state (used by the solver and the eval random policy). */
export function candidateActions(s: WorldState): Action[] {
  const out: Action[] = [{ action: "listen" }, { action: "wait" }, { action: "hide" }, { action: "exit" }];
  for (const r of neighbors(s, s.marlow.room)) {
    out.push({ action: "move", target: r }, { action: "move", target: r, stance: "quiet" });
  }
  for (const d of s.doors) if (d.between.includes(s.marlow.room)) out.push({ action: "peek", target: d.id });
  for (const i of s.items) out.push({ action: "take", target: i.id });
  return out.filter(a => validate(s, a).ok);
}

const key = (s: WorldState) => JSON.stringify([
  s.marlow, s.guard.step, s.alert, s.status, s.knowledge, s.doors.map(d => d.state), s.items.map(i => i.room), s.turn >= 6, s.memory.warned,
]);

/** Shortest winning plan that never exceeds `maxAlert`; null if none within `maxDepth`. */
export function solve(start: WorldState, maxDepth = 14, maxAlert = 1, minTrust = 0): Action[] | null {
  let frontier: { s: WorldState; plan: Action[] }[] = [{ s: start, plan: [] }];
  const seen = new Set([key(start)]);
  for (let d = 0; d < maxDepth; d++) {
    const next: typeof frontier = [];
    for (const { s, plan } of frontier) {
      for (const a of candidateActions(s)) {
        const r = step(s, a);
        if (r.state.status === "won") return [...plan, a];
        if (r.state.status !== "playing" || r.state.alert > maxAlert || r.state.trust < minTrust) continue;
        const k = key(r.state);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ s: r.state, plan: [...plan, a] });
      }
    }
    frontier = next;
  }
  return null;
}
