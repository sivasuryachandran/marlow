import type { Action, Side, WorldState } from "@marlow/shared";
import { sideRelativeToFacing } from "@marlow/engine";

/**
 * "Matched" check (V2b). A model that targets something must quote the exact words of the order that named it.
 * The code then verifies (1) the quote really is in the transcript, and (2) it names the target: its spokenName,
 * an alias from level.json, or (for doors/rooms) the room beyond it; or, for a purely generic quote ("the door",
 * "left one"), that exactly one candidate fits. Anything else never reaches the engine.
 */
export type MatchResult =
  | { ok: true }
  | { ok: false; why: "no_phrase" | "not_in_transcript" }          // model contract broken: retry / "say again"
  | { ok: false; why: "mismatch" }                                  // the player named something else: refusal template
  | { ok: false; why: "ambiguous"; candidates: string[] };          // generic reference fits several: clarify template

const GENERIC = new Set(["the", "a", "an", "that", "this", "one", "it", "there", "door", "doors", "room", "arch", "way", "through", "to", "into", "in", "of", "on", "at", "thing", "side", "please", "hand", "toward", "towards", "you", "your", "yours", "me", "my", "over", "here", "us"]);
const SIDES: Record<string, Side> = { left: "left", right: "right", ahead: "ahead", front: "ahead", forward: "ahead", straight: "ahead", behind: "behind", back: "behind" };

export const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean).map(w => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

function containsRun(hay: string[], needle: string[]): boolean {
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return true;
  return false;
}

interface Cand { id: string; names: Set<string>; bareNames: Set<string>; side?: Side }

/** Candidates an order of this verb can name right now, with every word that legitimately names each one. */
function candidates(s: WorldState, verb: "move" | "peek" | "take"): Cand[] {
  const here = s.marlow.room, facing = s.marlow.facing;
  const nameSet = (...parts: { spokenName: string; aliases: string[] }[]) => new Set(parts.flatMap(p => [p.spokenName, ...p.aliases].flatMap(tokens)).filter(w => !GENERIC.has(w)));
  if (verb === "take") return s.items.filter(i => i.room === here && s.knowledge.items.includes(i.id)).map(i => ({ id: i.id, names: nameSet(i), bareNames: nameSet(i) }));
  const doors = s.doors.filter(d => d.between.includes(here) && s.knowledge.doors.includes(d.id));
  return doors.map(d => {
    const otherId = d.between[0] === here ? d.between[1] : d.between[0];
    const other = s.rooms.find(r => r.id === otherId)!;
    const side = d.side[here] ? sideRelativeToFacing(d.side[here], facing) : undefined;
    // Moving: a bare room word names the destination ("go to the lobby" while IN the lobby is not the lobby door); with
    // "door"/"arch" in the order, the door's own name counts too.
    const cur = nameSet(s.rooms.find(r => r.id === here)!);
    const bare = verb === "move" ? new Set([...nameSet(other), ...[...nameSet(d)].filter(w => !cur.has(w))]) : nameSet(d, other);
    return { id: verb === "peek" ? d.id : otherId, names: nameSet(d, other), bareNames: bare, side };
  });
}

export function checkMatch(s: WorldState, transcript: string, action: Action & { matched?: string }, scope?: string[]): MatchResult {
  if (action.action !== "move" && action.action !== "peek" && action.action !== "take") return { ok: true };
  const target = (action as { target: string }).target;
  const phrase = tokens(action.matched ?? "");
  if (!phrase.length) return { ok: false, why: "no_phrase" };
  if (!containsRun(tokens(transcript), phrase)) return { ok: false, why: "not_in_transcript" };

  let cands = candidates(s, action.action);
  if (scope) cands = cands.filter(c => scope.includes(c.id) || (action.action === "move" && s.doors.some(d => scope.includes(d.id) && d.between.includes(c.id))));
  const me = cands.find(c => c.id === target);
  // Type words must fit the verb: you can take an item but not a "door"; you can peek a door but not a "room".
  const TYPE_WORDS = action.action === "take" ? ["door", "arch", "room"] : action.action === "peek" ? ["room"] : [];
  if (phrase.some(w => TYPE_WORDS.includes(w))) return { ok: false, why: "mismatch" };
  const content = phrase.filter(w => !GENERIC.has(w) && !(w in SIDES));
  const sides = phrase.filter(w => w in SIDES).map(w => SIDES[w]);

  if (content.length) {
    // The player named a thing: every named word must belong to the target (its name, an alias, or the room beyond its door).
    const pool = phrase.some(w => w === "door" || w === "arch") ? me?.names : me?.bareNames;
    if (!me || !pool || !content.every(w => pool.has(w))) return { ok: false, why: "mismatch" };
    if (sides.length && me.side && !sides.every(sd => sd === me.side)) return { ok: false, why: "mismatch" };
    return { ok: true };
  }
  // Generic reference ("the door", "the left one"): only if exactly one candidate fits.
  const fits = sides.length ? cands.filter(c => c.side && sides.every(sd => sd === c.side)) : cands;
  if (fits.length === 1) return fits[0].id === target ? { ok: true } : { ok: false, why: "mismatch" };
  if (fits.length === 0) return { ok: false, why: "mismatch" };
  return { ok: false, why: "ambiguous", candidates: fits.map(c => c.id) };
}
