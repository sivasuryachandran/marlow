import type { Action, WorldState } from "@marlow/shared";

export type LocalParse =
  | { kind: "action"; action: Action }
  | { kind: "yes" } | { kind: "no" } | { kind: "repeat" }
  | { kind: "no_back" }
  | { kind: "ready" }
  | { kind: "look" }
  | { kind: "talk" }
  | { kind: "cover" }
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
  // "Where can I hide": from what she already knows. Free and local.
  if (/\b(where (can|could|do|should) (i|you|we) hide|any (cover|hiding)|hiding (spot|place)|where is (the )?cover|where'?s (the )?cover|is there (any )?(cover|a place to hide))\b/.test(t)) return { kind: "cover" };
  // Checking in on her ("can you hear me", "are you there", "hello"): she answers; no turn passes, nothing moves.
  if (/^(hey|hi|hello|testing|test|hello marlow|hey marlow|are you there|you there|is anyone there|can you hear me|do you hear me|can you hear me now|are you (ok|okay|alright|all right)|how are you|you ok|you okay|are you with me|are you listening|marlow)( there| now)?$/.test(t)) return { kind: "talk" };
  // "What do you see / look around": Marlow describes the room from what she already knows. Free, local, no turn passes.
  if (/\b(what (do|can) you see|what do you see|look around|what is around|what's around|describe|where are you|what(?:'s| is) (in )?(the )?(room|here))\b/.test(t) && !/\b(door|arch|through|behind|left|right|stairs?|gallery|office|hall|lobby|stairwell)\b/.test(t)) return { kind: "look" };
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

const ORDER_WORDS = new Set(["go", "move", "walk", "head", "enter", "step", "sneak", "creep", "proceed", "run", "cross", "peek", "peak", "pique", "pick", "look", "check", "crack", "glance", "open", "take", "grab", "get", "steal", "lift", "pocket",
  "listen", "hear", "hide", "wait", "hold", "stop", "freeze", "stay", "exit", "leave", "extract", "back", "retreat", "see", "describe", "left", "right", "ahead", "front", "forward", "straight", "behind", "one", "other", "first", "second", "yes", "no", "door", "arch", "room", "upstairs", "downstairs", "up", "down", "out", "tiptoe", "quietly", "quiet", "slip", "turn"]);

/** True when the order contains anything the game could act on. Pure small talk ("yeah we did good") never needs a model call. */
export function plausibleOrder(text: string, s: WorldState): boolean {
  const names = new Set<string>();
  const add = (x: { spokenName: string; aliases?: string[] }) => [x.spokenName, ...(x.aliases ?? [])].forEach(n => n.toLowerCase().split(/\W+/).forEach(w => w && names.add(w)));
  s.rooms.forEach(add); s.props.forEach(add); s.items.forEach(add);
  return norm(text).split(" ").some(w => ORDER_WORDS.has(w) || names.has(w));
}
