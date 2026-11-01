import type { GameEvent, Level, WorldState } from "@marlow/shared";
import { validateLevel } from "@marlow/engine";
import type { LineBank } from "./lines";

export interface Trigger {
  start?: boolean; first_run?: boolean; repeat_run?: boolean; last_trust_loss?: string | null;
  alert_gte?: number; entered?: string; heard?: string; heard_guard?: boolean; in_room?: string; unless_fired?: string[]; after_fired?: string[]; taken?: string; turn_gte?: number; no_objective?: boolean; trust_lt?: number; status?: "won" | "caught";
}
export interface Beat { id: string; trigger: Trigger; lineIds: string[]; cueIds: string[]; once: boolean }
export interface DirectorCtx { runNumber: number; start: boolean }

const MAX_BEATS = 2;

/** L3: reads state + events, never writes either. Returns beats to speak (<= 2 per turn). */
export class Director {
  private fired = new Set<string>();
  /** Which beats have been spoken this run: the story's discovered facts. */
  has(id: string) { return this.fired.has(id); }
  constructor(private beats: Beat[]) {}

  evaluate(s: WorldState, events: GameEvent[], ctx: DirectorCtx): Beat[] {
    const out: Beat[] = [];
    for (const b of this.beats) {
      if (out.length >= MAX_BEATS) break;
      if (b.once && this.fired.has(b.id)) continue;
      if (!matches(b.trigger, s, events, ctx)) continue;
      if (b.trigger.unless_fired?.some(id => this.fired.has(id))) continue;
      if (b.trigger.after_fired?.some(id => !this.fired.has(id))) continue;
      this.fired.add(b.id);
      out.push(b);
    }
    return out;
  }
}

function matches(t: Trigger, s: WorldState, events: GameEvent[], ctx: DirectorCtx): boolean {
  if (t.start !== undefined && t.start !== ctx.start) return false;
  if (t.first_run && ctx.runNumber !== 1) return false;
  if (t.repeat_run && ctx.runNumber < 2) return false;
  if ("last_trust_loss" in t && t.last_trust_loss !== s.memory.lastTrustLoss) return false;
  if (t.alert_gte !== undefined && s.alert < t.alert_gte) return false;
  if (t.entered && !events.some(e => e.type === "moved" && e.to === t.entered)) return false;
  if (t.heard && !events.some(e => e.type === "sound_heard" && e.sound === t.heard)) return false;
  if (t.heard_guard && !events.some(e => e.type === "guard_heard")) return false;
  if (t.in_room && s.marlow.room !== t.in_room) return false;
  if (t.taken && !events.some(e => e.type === "item_taken" && e.item === t.taken)) return false;
  if (t.turn_gte !== undefined && s.turn < t.turn_gte) return false;
  if (t.no_objective && s.marlow.carrying === s.objective.item) return false;
  if (t.trust_lt !== undefined && s.trust >= t.trust_lt) return false;
  if (t.status && s.status !== t.status) return false;
  return true;
}

/** V0: beat sheet references real lines, cues and entities; level is structurally sound. Returns error list. */
export function validateBeats(beats: Beat[], bank: LineBank, cues: string[], level: Level): string[] {
  const errs = validateLevel(level);
  const ids = new Set<string>();
  const entities = new Set([...level.rooms, ...level.doors, ...level.props, ...level.items].map(x => x.id));
  for (const b of beats) {
    if (ids.has(b.id)) errs.push(`duplicate beat id ${b.id}`);
    ids.add(b.id);
    for (const l of b.lineIds) if (!bank[l]) errs.push(`beat ${b.id}: unknown line ${l}`);
    for (const c of b.cueIds) if (!cues.includes(c)) errs.push(`beat ${b.id}: unknown cue ${c}`);
    for (const r of [b.trigger.entered, b.trigger.in_room]) if (r && !entities.has(r)) errs.push(`beat ${b.id}: unknown room ${r}`);
    for (const u of [...(b.trigger.unless_fired ?? []), ...(b.trigger.after_fired ?? [])]) if (!beats.some(x => x.id === u)) errs.push(`beat ${b.id}: unless_fired/after_fired names unknown beat ${u}`);
    if (b.trigger.taken && !entities.has(b.trigger.taken)) errs.push(`beat ${b.id}: unknown item ${b.trigger.taken}`);
    if (!Object.keys(b.trigger).length) errs.push(`beat ${b.id}: empty trigger`);
  }
  return errs;
}
