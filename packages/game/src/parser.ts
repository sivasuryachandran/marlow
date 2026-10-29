import type { Action, WorldState } from "@marlow/shared";

export type LocalParse =
  | { kind: "action"; action: Action }
  | { kind: "yes" } | { kind: "no" } | { kind: "repeat" }
  | { kind: "no_back" }
  | { kind: "ready" }
  | null;

/** Speech recognizers sometimes stutter ("the the", "Listen,Listen,", "sneak to the sneak to the hall"): collapse adjacent repeats. */
export function cleanTranscript(text: string): string {
  let w = text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[,;]+/g, " ").split(/\s+/).filter(Boolean);
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + 2 * n <= w.length; ) {
      const a = w.slice(i, i + n).join(" ").toLowerCase(), b = w.slice(i + n, i + 2 * n).join(" ").toLowerCase();
      if (a === b) w.splice(i, n); else i++;
    }
  }
  return w.join(" ");
}

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
  // "I'm ready, we can start, go ahead": acknowledgement only, not an order. Marlow answers; the world does not change.
  const rest = t.replace(/\b(i am|i'm|im|we are|we're|we can|you can|you may|let's|lets|let us|all|is|set|good to|ready|start|begin|go ahead|go|now|and|then|so|when you are|whenever you are|okay|ok|alright)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!rest && /\b(ready|start|begin|go ahead|let's go|lets go|set)\b/.test(t)) return { kind: "ready" };
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
