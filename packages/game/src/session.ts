import { createInitialState, locate, RULES_VERSION, sideRelativeToFacing, step } from "@marlow/engine";
import type { Action, GameEvent, WorldState } from "@marlow/shared";
import { Director, type Beat } from "./director";
import { knowledgeList, type IntentAdapter, type KnowledgeScope, type KnownEntity } from "./intent";
import { cleanTranscript, localParse, plausibleOrder } from "./parser";
import { hash, renderLine, type LineBank, type LineRef, type SpokenLine } from "./lines";
import type { MemoryStore } from "./memory";
import { coverRefs, cuesFor, narrate, type Cue } from "./narrate";
import { verify, type Verified } from "./verify";

export type TurnKind = "ok" | "clarify" | "refused" | "timeout" | "sayagain" | "local";
export interface TurnOutput {
  turnId: number; kind: TurnKind; transcript: string; action?: Action; events: GameEvent[];
  lines: SpokenLine[]; cues: Cue[]; beatCueIds: string[]; latencyMs: number; state: WorldState;
}
export interface SessionConfig {
  level: unknown; bank: LineBank; beats: Beat[]; intent: IntentAdapter; seed: number; memory: MemoryStore;
  timeoutMs?: number; lore?: Record<string, [string, string][]>; knowledgeScope?: KnowledgeScope; runId?: string; onLog?: (row: Record<string, unknown>) => void; now?: () => number;
}

const TIMEOUT = Symbol("timeout");
const SAYAGAIN: LineRef = { id: "system.sayagain", slots: {} };

export class Session {
  state: WorldState;
  readonly runId: string;
  readonly runNumber: number;
  readonly log: Record<string, unknown>[] = [];
  /** Highest turn id handed out; only a reply carrying exactly this id may act. */
  currentTurn = 0;
  private dead = new Set<number>();
  private director: Director;
  private lastLines: SpokenLine[] = [];
  private pending: { transcript: string; candidates: string[] } | null = null;
  private saved = false;
  private now: () => number;

  constructor(private cfg: SessionConfig) {
    const mem = cfg.memory.load();
    this.runNumber = mem.runs + 1;
    this.state = createInitialState(cfg.level, cfg.seed, { trust: mem.trust, lastTrustLoss: mem.lastTrustLoss });
    this.runId = cfg.runId ?? `run-${cfg.seed}-${this.runNumber}`;
    this.director = new Director(cfg.beats);
    this.now = cfg.now ?? (() => performance.now());
    this.write({ type: "start", rulesVersion: RULES_VERSION, levelHash: hash(JSON.stringify(cfg.level)), runId: this.runId, seed: cfg.seed, trust: mem.trust, lastTrustLoss: mem.lastTrustLoss, runNumber: this.runNumber });
  }

  private write(row: Record<string, unknown>) { this.log.push(row); this.cfg.onLog?.(row); }

  private render(refs: LineRef[], turnId: number, prevTrust = this.state.trust): SpokenLine[] {
    return refs.map(r => renderLine(this.cfg.bank, r, { seed: this.cfg.seed, turnId, curt: prevTrust < 30 })).filter((l): l is SpokenLine => !!l);
  }

  private beatOutput(events: GameEvent[], start: boolean, turnId: number, prevTrust: number) {
    const beats = this.director.evaluate(this.state, events, { runNumber: this.runNumber, start });
    return {
      lines: this.render(beats.flatMap(b => b.lineIds.map(id => ({ id, slots: {} }))), turnId, prevTrust),
      cueIds: beats.flatMap(b => b.cueIds), ids: beats.map(b => b.id),
    };
  }

  /** How the story ended, once chosen after a win. */
  ending: "burn" | "send" | null = null;

  /** Mission intro: the Director's start beats. */
  start(): TurnOutput {
    const b = this.beatOutput([], true, 0, this.state.trust);
    this.lastLines = b.lines;
    this.write({ turnId: 0, beats: b.ids, lineIds: b.lines.map(l => l.id), lines: b.lines.map(l => ({ id: l.id, text: l.text })) });
    return { turnId: 0, kind: "ok", transcript: "", events: [], lines: b.lines, cues: [], beatCueIds: b.cueIds, latencyMs: 0, state: this.state };
  }

  /** Returns null when the turn was superseded or timed out (reply discarded, state untouched). */
  async submit(rawTranscript: string): Promise<TurnOutput | null> {
    const transcript = cleanTranscript(rawTranscript);
    const turnId = ++this.currentTurn;
    const t0 = this.now();
    const s = this.state;
    const out = (kind: TurnKind, refs: LineRef[], extra: Partial<TurnOutput> = {}, row: Record<string, unknown> = {}): TurnOutput => {
      const lines = extra.lines ?? this.render(refs, turnId, s.trust);
      if (kind !== "local") this.lastLines = lines.length ? lines : this.lastLines;
      const o: TurnOutput = {
        turnId, kind, transcript, events: [], lines, cues: [], beatCueIds: [], latencyMs: this.now() - t0, state: this.state, ...extra,
      };
      this.write({
        turnId, transcript, kind, lineIds: lines.map(l => l.id), lines: lines.map(l => ({ id: l.id, text: l.text, audioKey: l.audioKey })),
        events: o.events, action: o.action, latencies: { totalMs: Math.round(o.latencyMs) }, ...row,
      });
      return o;
    };

    // The ending is a choice made by voice after a win: burn the tape or send it. Local, no model, nothing in the world changes.
    if (s.status === "won" && !this.ending) {
      const t = transcript.toLowerCase();
      const choice = /\b(burn|burned|destroy|fire|ash|ashes|torch|shred)\b/.test(t) ? "burn" : /\b(send|sent|publish|press|broadcast|expose|post|release|leak|tell|everyone|police)\b/.test(t) ? "send" : null;
      if (!choice) return out("local", [{ id: "marlow.epilogue.retry", slots: {} }], {}, { parsed: "epilogue_retry" });
      this.ending = choice;
      return out("local", [{ id: `marlow.epilogue.${choice}`, slots: {} }, { id: `client.after.${choice}`, slots: {} }], {}, { parsed: `epilogue_${choice}` });
    }
    if (s.status !== "playing") return out("refused", [{ id: "marlow.refuse.game_over", slots: {} }]);

    const local = localParse(transcript, s);
    if (local) {
      switch (local.kind) {
        case "repeat":
          return this.lastLines.length ? out("local", [], { lines: this.lastLines }, { parsed: "repeat" })
            : out("local", [{ id: "system.nothing_to_repeat", slots: {} }], {}, { parsed: "repeat" });
        case "yes": case "no":
          if (this.pending) return out("clarify", [this.clarifyRef(this.pending.candidates, s)], {}, { parsed: local.kind });
          return out("local", [{ id: "system.nothing_pending", slots: {} }], {}, { parsed: local.kind });
        case "lore": return out("local", [{ id: this.loreLine(local.topic), slots: {} }], {}, { parsed: `lore:${local.topic}` });
        case "cover": return out("local", coverRefs(s), {}, { parsed: "cover" });
        case "talk": return out("local", [{ id: "marlow.talk", slots: {} }], {}, { parsed: "talk" });
        case "look": return out("local", this.lookRefs(s), {}, { parsed: "look" });
        case "ready": return out("local", [{ id: "system.ready", slots: {} }], {}, { parsed: "ready" });
        case "no_back": return out("refused", [{ id: "marlow.refuse.not_adjacent", slots: {} }], {}, { parsed: "go back" });
        case "action": { this.pending = null; return this.execute(turnId, transcript, local.action, t0, "local"); }
      }
    }

    // Small talk has nothing the game could act on: answer at once instead of waiting on a model.
    if (!this.pending && !plausibleOrder(transcript, s)) return out("sayagain", [SAYAGAIN], {}, { parsed: "no_order_words" });

    // Clarification follow-up: narrow to the named candidate, then re-ask the intent adapter.
    let request = { transcript, knowledge: knowledgeList(s, this.cfg.knowledgeScope) };
    let pendingScope: string[] | undefined;
    if (this.pending) {
      const pick = resolveCandidate(transcript, this.pending.candidates, s);
      if (pick) { request = { transcript: this.pending.transcript, knowledge: knowledgeList(s).filter(e => e.id === pick) }; pendingScope = [pick]; }
      else this.pending = null;
    }

    let reply: unknown = undefined;
    let verdict: Verified = { kind: "sayagain", why: "schema" };
    const tIntent = this.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.callIntent(turnId, { turnId, currentRoom: s.marlow.room, ...request });
      if (res === TIMEOUT) {
        this.write({ turnId, transcript, kind: "timeout", discarded: false, latencies: { totalMs: Math.round(this.now() - t0) } });
        return { turnId, kind: "timeout", transcript, events: [], lines: this.render([{ id: "system.timeout", slots: {} }], turnId, s.trust), cues: [], beatCueIds: ["sfx.radio.static"], latencyMs: this.now() - t0, state: this.state };
      }
      if (res === null) return null; // superseded
      reply = res;
      verdict = verify(this.state, reply, request.transcript, { scope: pendingScope });
      if (!(verdict.kind === "sayagain" && verdict.why === "schema")) break; // V1 retry once
    }
    const intentMs = Math.round(this.now() - tIntent);
    const rowBase = { parsed: reply, validation: verdict.kind === "refuse" ? verdict.reason : verdict.kind, backend: this.cfg.intent.name, latencies: { intentMs } };

    switch (verdict.kind) {
      case "sayagain": return out("sayagain", [SAYAGAIN], {}, rowBase);
      case "refuse": this.pending = null; return out("refused", [{ id: `marlow.refuse.${verdict.reason}`, slots: {} }], {}, rowBase);
      case "clarify": {
        const cands = verdict.candidates.slice(0, 2);
        this.pending = { transcript: this.pending?.transcript ?? transcript, candidates: cands };
        return out("clarify", [this.clarifyRef(cands, this.state, verdict.ctype)], {}, rowBase);
      }
      case "action": this.pending = null; return this.execute(turnId, transcript, verdict.action, t0, rowBase);
    }
  }

  /** What Marlow can already see from where she stands: only things the player has been told about. Reads state, changes nothing. */
  private lookRefs(s: WorldState): LineRef[] {
    const here = s.marlow.room, name = (id: string) => s.rooms.find(r => r.id === id)!.spokenName;
    const refs: LineRef[] = [{ id: "marlow.look.room", slots: { room: name(here) } }];
    for (const d of s.doors) {
      if (!d.between.includes(here) || !s.knowledge.doors.includes(d.id)) continue;
      const other = d.between[0] === here ? d.between[1] : d.between[0];
      refs.push({ id: "marlow.look.door", slots: { room: name(other), dir: sideRelativeToFacing(d.side[here], s.marlow.facing) } });
    }
    for (const i of s.items) if (i.room === here && s.knowledge.items.includes(i.id)) refs.push({ id: "marlow.arrive.item", slots: { item: i.spokenName } });
    for (const p of s.props) if (p.room === here && p.tags.includes("hide") && s.knowledge.props.includes(p.id)) refs.push({ id: "marlow.arrive.hide", slots: { prop: p.spokenName } });
    return refs;
  }
  /** The highest-level answer on a topic whose required story fact has been discovered; otherwise "I don't know yet". */
  private loreLine(topic: string): string {
    const known = (f: string) => f === "job" || (f === "machine" ? this.director.has("machine_ring") || this.director.has("machine_late") : this.director.has(f));
    let best: string | null = null;
    for (const [fact, lineId] of this.cfg.lore?.[topic] ?? []) if (known(fact)) best = lineId;
    return best ?? "marlow.lore.unknown";
  }
  private clarifyRef(cands: string[], s: WorldState, ctype?: string): LineRef {
    const name = (id: string) => [...s.rooms, ...s.doors, ...s.props, ...s.items].find(x => x.id === id)!.spokenName;
    const type = ctype ?? (s.doors.some(d => d.id === cands[0]) ? "door" : s.rooms.some(r => r.id === cands[0]) ? "room" : "other");
    return { id: `marlow.clarify.${type}`, slots: { a: name(cands[0]), b: name(cands[1]) } };
  }

  private async callIntent(turnId: number, req: Parameters<IntentAdapter["infer"]>[0]): Promise<unknown | typeof TIMEOUT | null> {
    const timeoutMs = this.cfg.timeoutMs ?? 4000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const call = this.cfg.intent.infer(req);
    const winner = await Promise.race([
      call, new Promise<typeof TIMEOUT>(res => { timer = setTimeout(() => res(TIMEOUT), timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    if (winner === TIMEOUT) {
      this.dead.add(turnId);
      call.then(late => this.write({ turnId, discarded: true, reason: "late_reply", replyTurnId: late.turnId }), () => {});
      return TIMEOUT;
    }
    if (winner.turnId !== turnId || this.currentTurn !== turnId || this.dead.has(turnId)) {
      this.write({ turnId, discarded: true, reason: winner.turnId !== turnId ? "turn_id_mismatch" : "superseded", replyTurnId: winner.turnId });
      return null;
    }
    return winner.reply;
  }

  private execute(turnId: number, transcript: string, action: Action, t0: number, how: string | Record<string, unknown>): TurnOutput {
    const prev = this.state;
    const r = step(prev, action);
    this.state = r.state;
    const refs = narrate(prev, r.state, r.events);
    const b = this.beatOutput(r.events, false, turnId, prev.trust);
    const lines = [...this.render(refs, turnId, prev.trust), ...b.lines];
    this.lastLines = lines;
    const refused = r.events[0]?.type === "refused";
    const o: TurnOutput = {
      turnId, kind: refused ? "refused" : "ok", transcript, action: refused ? undefined : action, events: r.events, lines,
      cues: cuesFor(prev, r.state, r.events), beatCueIds: b.cueIds, latencyMs: this.now() - t0, state: r.state,
    };
    this.write({
      turnId, transcript, kind: o.kind, ...(typeof how === "string" ? { parsed: how, validation: "local" } : how), action: o.action, roll: r.roll,
      events: r.events, beats: b.ids, lineIds: lines.map(l => l.id), lines: lines.map(l => ({ id: l.id, text: l.text, audioKey: l.audioKey })),
      latencies: { ...((how as any)?.latencies ?? {}), totalMs: Math.round(o.latencyMs) },
    });
    if (this.state.status !== "playing" && !this.saved) {
      this.saved = true;
      const mem = this.cfg.memory.load();
      this.cfg.memory.save({ trust: this.state.trust, lastTrustLoss: this.state.memory.lastTrustLoss, runs: mem.runs + 1 });
      this.write({ type: "end", status: this.state.status, alert: this.state.alert, trust: this.state.trust, turns: this.state.turn });
    }
    return o;
  }

  /** What Marlow can currently tell the player (debug/map helper). */
  guardFromMarlow() { return locate(this.state, this.state.guard.route[this.state.guard.step]); }
}

function resolveCandidate(text: string, cands: string[], s: WorldState): string | null {
  const t = text.toLowerCase();
  if (/\b(first|former)\b/.test(t)) return cands[0];
  if (/\b(second|latter|other)\b/.test(t)) return cands[1];
  const info = knowledgeList(s).filter(e => cands.includes(e.id));
  const stop = new Set(["the", "door", "room", "one", "a", "an", "that", "this", "to", "go", "through"]);
  const hit = info.filter((e: KnownEntity) => {
    if (t.includes(e.id)) return true;
    if (e.side && new RegExp(`\\b${e.side === "ahead" ? "(ahead|front|forward)" : e.side === "behind" ? "(behind|back)" : e.side}\\b`).test(t)) return true;
    return e.spokenName.toLowerCase().split(/\s+/).some(w => w.length > 2 && !stop.has(w) && t.includes(w));
  });
  return hit.length === 1 ? hit[0].id : null;
}
