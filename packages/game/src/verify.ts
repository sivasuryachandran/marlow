import { validate } from "@marlow/engine";
import type { Action, RefusalReason, WorldState } from "@marlow/shared";
import { v1, type IntentRequest } from "./intent";
import { checkMatch } from "./match";

export type Verified =
  | { kind: "action"; action: Action }
  | { kind: "clarify"; candidates: string[]; ctype: "door" | "room" | "other" }
  | { kind: "refuse"; reason: RefusalReason; target?: string }
  | { kind: "sayagain"; why: "schema" | "unknown" | "bad_clarify" };

export interface VerifyOpts { scope?: string[] }

const INTENT_WORDS: Record<string, RegExp> = {
  wait: /\b(wait|hold|stop|freeze|stay|still|pause|hang|halt|idle|sit|stand|standby|patience|pass|don'?t move|do not move|not move)\b/,
  hide: /\b(hide|hiding|hid|hided|cover|duck|conceal|crouch|behind|tuck|vanish|low|sight|get down)\b/,
  listen: /\b(listen|hear|hearing|sound|sounds|noise|ears?|anyone|anybody|somebody|someone|footsteps?|guard)\b/,
  exit: /\b(exit|leave|out|extract|escape|bail|run|abort|done|finish|finished|outside|home|van|go)\b/,
};
const entityIds = (s: WorldState) => new Set([
  ...s.knowledge.rooms, ...s.knowledge.doors, ...s.knowledge.props, ...s.knowledge.items,
]);

/**
 * V1 (schema) is the caller's retry loop; this applies V1 shape check + V2:
 * target must be in Marlow's knowledge, action legal now, clarify candidates real and known.
 */
export function verify(s: WorldState, reply: unknown, transcript: string, opts: VerifyOpts = {}): Verified {
  if (reply && typeof reply === "object" && (reply as any).__unknown) return { kind: "sayagain", why: "unknown" };
  const shaped = v1(normalizeMove(s, reply));
  if (!shaped.ok) return { kind: "sayagain", why: "schema" };
  const r = shaped.reply;
  const known = entityIds(s);
  if ("clarify" in r) {
    const c = [...new Set(r.clarify.candidates)];
    if (c.length < 2 || c.some(id => !known.has(id))) return { kind: "sayagain", why: "bad_clarify" };
    const types = new Set(c.map(id => s.doors.some(d => d.id === id) ? "door" : s.rooms.some(x => x.id === id) ? "room" : "other"));
    if (types.size !== 1) return { kind: "sayagain", why: "bad_clarify" }; // mixed kinds: not a question we can speak from a template
    return { kind: "clarify", candidates: c, ctype: [...types][0] as "door" | "room" | "other" };
  }
  if ("target" in r && r.action !== "move" && !known.has(r.target)) {
    // Hallucinated or never-seen target: world unchanged.
    const exists = [...s.rooms, ...s.doors, ...s.props, ...s.items].some(x => x.id === r.target);
    return { kind: "refuse", reason: exists ? "not_known" : "unknown_target", target: r.target };
  }
  // V2b: the quoted words must be in the order and must actually name this target (never "vault door" -> a real door).
  if ("target" in r && (r.action === "move" || r.action === "peek" || r.action === "take")) {
    const m = checkMatch(s, transcript, r, opts.scope);
    if (!m.ok) {
      if (m.why === "no_phrase" || m.why === "not_in_transcript") return { kind: "sayagain", why: "schema" }; // broken contract: retry once
      if (m.why === "ambiguous") {
        const c = m.candidates.slice(0, 2);
        const isDoor = c.every(id => s.doors.some(d => d.id === id)), isRoom = c.every(id => s.rooms.some(x => x.id === id));
        return { kind: "clarify", candidates: c, ctype: isDoor ? "door" : isRoom ? "room" : "other" };
      }
      return { kind: "refuse", reason: "unknown_target", target: r.target };
    }
  }
  // V2c: wait / hide / listen / exit need a word of that kind in the order. A question or small talk never becomes an action.
  const lex = INTENT_WORDS[(r as { action: string }).action];
  if (lex && !lex.test(transcript.toLowerCase())) return { kind: "sayagain", why: "unknown" };
  const v = validate(s, r);
  const { matched: _m, ...engineAction } = r as Action & { matched?: string };
  return v.ok ? { kind: "action", action: engineAction as Action } : { kind: "refuse", reason: v.reason, target: v.target };
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
