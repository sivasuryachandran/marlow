import { validate } from "@marlow/engine";
import type { Action, RefusalReason, WorldState } from "@marlow/shared";
import { v1, type IntentRequest } from "./intent";

export type Verified =
  | { kind: "action"; action: Action }
  | { kind: "clarify"; candidates: string[]; ctype: "door" | "room" | "other" }
  | { kind: "refuse"; reason: RefusalReason; target?: string }
  | { kind: "sayagain"; why: "schema" | "unknown" | "bad_clarify" };

const entityIds = (s: WorldState) => new Set([
  ...s.knowledge.rooms, ...s.knowledge.doors, ...s.knowledge.props, ...s.knowledge.items,
]);

/**
 * V1 (schema) is the caller's retry loop; this applies V1 shape check + V2:
 * target must be in Marlow's knowledge, action legal now, clarify candidates real and known.
 */
export function verify(s: WorldState, reply: unknown): Verified {
  if (reply && typeof reply === "object" && (reply as any).__unknown) return { kind: "sayagain", why: "unknown" };
  const shaped = v1(normalizeMove(s, reply));
  if (!shaped.ok) return { kind: "sayagain", why: "schema" };
  const r = shaped.reply;
  const known = entityIds(s);
  if ("clarify" in r) {
    const c = [...new Set(r.clarify.candidates)];
    if (c.length < 2 || c.some(id => !known.has(id))) return { kind: "sayagain", why: "bad_clarify" };
    const types = new Set(c.map(id => s.doors.some(d => d.id === id) ? "door" : s.rooms.some(x => x.id === id) ? "room" : "other"));
    return { kind: "clarify", candidates: c, ctype: types.size === 1 ? ([...types][0] as "door" | "room" | "other") : "other" };
  }
  if ("target" in r && r.action !== "move" && !known.has(r.target)) {
    // Hallucinated or never-seen target: world unchanged.
    const exists = [...s.rooms, ...s.doors, ...s.props, ...s.items].some(x => x.id === r.target);
    return { kind: "refuse", reason: exists ? "not_known" : "unknown_target", target: r.target };
  }
  const v = validate(s, r);
  return v.ok ? { kind: "action", action: r } : { kind: "refuse", reason: v.reason, target: v.target };
}

/** A move expressed as a door id (`door:<id>`) means the room on the other side. */
function normalizeMove(s: WorldState, reply: unknown): unknown {
  const r = reply as any;
  if (r?.action === "move" && typeof r.target === "string" && r.target.startsWith("door:")) {
    const door = s.doors.find(d => d.id === r.target.slice(5));
    if (!door || !door.between.includes(s.marlow.room)) return { ...r, target: r.target.slice(5) };
    return { ...r, target: door.between[0] === s.marlow.room ? door.between[1] : door.between[0] };
  }
  return reply;
}

export type { IntentRequest };
