import type { Action, WorldState } from "@marlow/shared";

export type LocalParse =
  | { kind: "action"; action: Action }
  | { kind: "yes" } | { kind: "no" } | { kind: "repeat" }
  | { kind: "no_back" }
  | null;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

/** Local parser (L1): plain code, no model call. Null => needs the intent adapter. */
export function localParse(text: string, s: WorldState): LocalParse {
  const quiet = /\b(quietly|softly|carefully|slowly|silently|gently|sneak|creep)\b/.test(norm(text));
  const t = norm(text).replace(/\b(quietly|softly|carefully|slowly|silently|gently|sneak|creep)\b/g, " ").replace(/\s+/g, " ").trim().replace(/^(ok(ay)?|alright|marlow|boss)\s+/, "").replace(/\s+(please|marlow)$/, "");
  if (["wait", "stop", "hold", "hold on", "hold up", "freeze", "stay", "stay put", "hold position"].includes(t)) return { kind: "action", action: { action: "wait" } };
  if (["listen", "listen up", "what do you hear"].includes(t)) return { kind: "action", action: { action: "listen" } };
  if (["hide", "get down", "take cover"].includes(t)) return { kind: "action", action: { action: "hide" } };
  if (["exit", "get out", "leave", "extract"].includes(t)) return { kind: "action", action: { action: "exit" } };
  if (["go back", "back", "back up", "retreat", "go back the way you came"].includes(t)) {
    return s.marlow.prevRoom ? { kind: "action", action: { action: "move", target: s.marlow.prevRoom } } : { kind: "no_back" };
  }
  if (["yes", "yeah", "yep", "affirmative", "correct"].includes(t)) return { kind: "yes" };
  if (["no", "nope", "negative"].includes(t)) return { kind: "no" };
  if (["repeat", "say again", "repeat that", "what", "come again", "say that again"].includes(t)) return { kind: "repeat" };
  const bare = t.replace(/^(go to|go into|move to|head to|go|enter|to)\s+/, "").replace(/^the\s+/, "");
  for (const r of s.rooms) {
    if (bare === r.id || bare === r.spokenName.replace(/^the\s+/, ""))
      return { kind: "action", action: { action: "move", target: r.id, ...(quiet ? { stance: "quiet" as const } : {}) } };
  }
  return null;
}
