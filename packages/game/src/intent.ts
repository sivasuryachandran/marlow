import { IntentReply, type Compass, type Side, type WorldState } from "@marlow/shared";
import { sideRelativeToFacing } from "@marlow/engine";

export interface KnownEntity { id: string; spokenName: string; type: "room" | "door" | "prop" | "item"; side?: Side }
export interface IntentRequest { turnId: number; transcript: string; currentRoom: string; knowledge: KnownEntity[] }
export interface IntentResponse { turnId: number; reply: unknown }
export interface IntentAdapter { name: string; infer(req: IntentRequest): Promise<IntentResponse> }

/** Marlow's knowledge only; `side` is relative to her current facing (extension to the brief's {id, spokenName, type}). */
export function knowledgeList(s: WorldState): KnownEntity[] {
  const k = s.knowledge, facing: Compass = s.marlow.facing;
  const out: KnownEntity[] = [];
  for (const r of s.rooms) if (k.rooms.includes(r.id)) out.push({ id: r.id, spokenName: r.spokenName, type: "room" });
  for (const d of s.doors) if (k.doors.includes(d.id)) {
    const side = d.side[s.marlow.room];
    out.push({ id: d.id, spokenName: d.spokenName, type: "door", side: side ? sideRelativeToFacing(side, facing) : undefined });
  }
  for (const p of s.props) if (k.props.includes(p.id)) out.push({ id: p.id, spokenName: p.spokenName, type: "prop", side: sideRelativeToFacing(p.side, facing) });
  for (const i of s.items) if (k.items.includes(i.id)) out.push({ id: i.id, spokenName: i.spokenName, type: "item" });
  return out;
}

/** Plain JSON Schema for schema-constrained output (exact wiring per provider docs is an adapter TODO). */
export const INTENT_JSON_SCHEMA = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["action"],
      properties: { action: { enum: ["move", "peek", "listen", "wait", "hide", "take", "exit"] }, target: { type: "string" }, stance: { enum: ["normal", "quiet"] } } },
    { type: "object", additionalProperties: false, required: ["clarify"],
      properties: { clarify: { type: "object", additionalProperties: false, required: ["candidates"], properties: { candidates: { type: "array", minItems: 2, items: { type: "string" } } } } } },
  ],
} as const;

export const INTENT_SYSTEM_PROMPT =
  "You convert a spoken order into exactly one JSON object for a heist game. Use only ids from the knowledge list. " +
  "Reply with {\"action\":...,\"target\":...,\"stance\":...} or {\"clarify\":{\"candidates\":[ids]}} when the order fits two or more known targets. " +
  "Never invent ids. No prose.";

/** V1: exactly one valid shape. */
export function v1(reply: unknown): { ok: true; reply: IntentReply } | { ok: false } {
  if (!reply || typeof reply !== "object") return { ok: false };
  const keys = Object.keys(reply as object);
  const allowed = "clarify" in (reply as object) ? ["clarify"] : ["action", "target", "stance"];
  if (keys.some(k => !allowed.includes(k))) return { ok: false };
  const p = IntentReply.safeParse(reply);
  return p.success ? { ok: true, reply: p.data } : { ok: false };
}

// ---------- deterministic mock (also the offline fallback) ----------
const VERBS: [RegExp, string][] = [
  [/\b(peek|look through|look in|look at|check|crack|glance)\b/, "peek"],
  [/\b(go|move|walk|head|enter|step|sneak|creep|proceed|run|cross)\b/, "move"],
  [/\b(take|grab|get|pick up|steal|lift|pocket)\b/, "take"],
  [/\b(hide|duck|take cover|get down)\b/, "hide"],
  [/\b(listen|hear|any sound)\b/, "listen"],
  [/\b(wait|hold|stay|stop|freeze|sit tight)\b/, "wait"],
  [/\b(exit|leave|get out|extract|bail)\b/, "exit"],
];
const QUIET = /\b(quiet|quietly|softly|carefully|slowly|sneak|sneaking|creep|silently|gently)\b/;
const SIDE_WORDS: Record<Side, RegExp> = {
  ahead: /\b(ahead|front|forward|straight)\b/, behind: /\b(behind|back)\b/, left: /\b(left)\b/, right: /\b(right)\b/,
};
const FILLER = new Set(["the", "a", "an", "to", "door", "doors", "room", "into", "in", "through", "of", "that", "one", "it", "there", "please",
  "on", "at", "toward", "towards", "marlow", "boss", "and", "then", "way", "side", "hand", "arch", "up", "out", "over", "your", "my", "you", "can", "could", "now",
  "go", "move", "walk", "head", "enter", "step", "sneak", "creep", "proceed", "run", "cross", "peek", "look", "check", "crack", "glance", "take", "grab", "get", "pick", "steal", "lift", "pocket",
  "quiet", "quietly", "softly", "carefully", "slowly", "silently", "gently", "ahead", "front", "forward", "straight", "behind", "back", "left", "right"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).filter(Boolean);

interface Option { id: string; target: string; names: string[]; side?: Side }

/** Keyword NLU over Marlow's knowledge only. Unknown nouns => target "unknown" (V2 refuses); several fits => clarify. */
export function mockInfer(req: IntentRequest): unknown {
  const t = req.transcript.toLowerCase();
  const verb = VERBS.find(([re]) => re.test(t))?.[1];
  if (!verb) return { __unknown: true };
  const stance = QUIET.test(t) ? ("quiet" as const) : undefined;
  if (["listen", "wait", "hide", "exit"].includes(verb)) return { action: verb };

  const k = req.knowledge;
  const nm = (e: KnownEntity) => words(e.spokenName).filter(w => !FILLER.has(w));
  let options: Option[];
  if (verb === "take") options = k.filter(e => e.type === "item").map(e => ({ id: e.id, target: e.id, names: nm(e) }));
  else if (verb === "peek") options = k.filter(e => e.type === "door" && e.id.includes(req.currentRoom)).map(e => ({ id: e.id, target: e.id, names: nm(e), side: e.side }));
  else {
    // move: a room reachable through a known door here, or a door here (meaning the room beyond it)
    options = k.filter(e => e.type === "door" && e.id.includes(req.currentRoom)).map(d => {
      const other = d.id.replace(/^(door|arch)_/, "").split("_").find(r => r !== req.currentRoom) ?? "";
      const room = k.find(e => e.type === "room" && e.id === other);
      return { id: d.id, target: `door:${d.id}`, names: [...nm(d), ...(room ? nm(room) : [])], side: d.side };
    });
  }
  const content = words(t).filter(w => !FILLER.has(w));
  let cands = options;
  if (content.length) {
    cands = options.filter(o => content.some(w => o.names.includes(w)));
    if (!cands.length) return { action: verb, target: "unknown", stance };
  }
  const sideHit = (Object.keys(SIDE_WORDS) as Side[]).find(sd => SIDE_WORDS[sd].test(t));
  if (sideHit) { const f = cands.filter(o => o.side === sideHit); if (f.length) cands = f; }
  if (cands.length === 0) return { action: verb, target: "unknown", stance };
  if (cands.length > 1) return { clarify: { candidates: cands.map(c => c.id) } };
  return verb === "take" ? { action: verb, target: cands[0].target } : { action: verb, target: cands[0].target, stance };
}

export class MockIntent implements IntentAdapter {
  name = "mock";
  constructor(private delayMs = 0) {}
  async infer(req: IntentRequest): Promise<IntentResponse> {
    if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs));
    return { turnId: req.turnId, reply: mockInfer(req) };
  }
}
