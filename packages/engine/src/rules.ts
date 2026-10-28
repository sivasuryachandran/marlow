import type { Action, GameEvent, RefusalReason, WorldState } from "@marlow/shared";
import { Rng } from "./rng";
import { revealRoom } from "./state";
import {
  bearingBetween, doorBetween, guardRoom, hops, locate, neighbors, sideRelativeToFacing,
} from "./spatial";

export type Validation = { ok: true } | { ok: false; reason: RefusalReason; target?: string };
export interface StepResult { state: WorldState; events: GameEvent[]; roll: number }

const refuse = (reason: RefusalReason, target?: string): Validation => ({ ok: false, reason, target });

/** V2 core: is this action legal now, using only what Marlow knows? */
export function validate(s: WorldState, a: Action): Validation {
  if (s.status !== "playing") return refuse("game_over");
  const k = s.knowledge, here = s.marlow.room;
  switch (a.action) {
    case "move": {
      if (!s.rooms.some(r => r.id === a.target && !r.offstage)) return refuse("unknown_target", a.target);
      const door = doorBetween(s, here, a.target);
      if (!door || a.target === here) return refuse("not_adjacent", a.target);
      if (!k.doors.includes(door.id)) return refuse("not_known", a.target);
      if (door.state === "locked") return refuse("door_locked", a.target);
      return { ok: true };
    }
    case "peek": {
      const door = s.doors.find(d => d.id === a.target);
      if (!door) return refuse("unknown_target", a.target);
      if (!k.doors.includes(door.id)) return refuse("not_known", a.target);
      if (!door.between.includes(here)) return refuse("not_in_room", a.target);
      return { ok: true };
    }
    case "hide":
      return s.props.some(p => p.room === here && p.tags.includes("hide") && k.props.includes(p.id))
        ? { ok: true } : refuse("no_hide_spot");
    case "take": {
      const item = s.items.find(i => i.id === a.target);
      if (!item) return refuse("unknown_target", a.target);
      if (!k.items.includes(item.id)) return refuse("not_known", a.target);
      if (item.room !== here) return refuse("no_item", a.target);
      return { ok: true };
    }
    case "exit":
      return here === s.objective.exitRoom && s.marlow.carrying === s.objective.item
        ? { ok: true } : refuse("not_ready_to_exit");
    default:
      return { ok: true };
  }
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Pure: (state, action) -> new state + events. Invalid actions return the SAME state
 * (no turn, no guard step, no RNG use) with a single `refused` event.
 */
export function step(prev: WorldState, action: Action, rngIn?: Rng): StepResult {
  const v = validate(prev, action);
  if (!v.ok) return { state: prev, events: [{ type: "refused", reason: v.reason, target: v.target, perceived: true }], roll: -1 };

  const s: WorldState = structuredClone(prev);
  const rng = rngIn ?? new Rng(s.rngState);
  const ev: GameEvent[] = [];
  const roll = rng.int(1_000_000);
  const warnedBefore = s.memory.warned;
  s.memory.warned = false;
  let guardSteps = 1;

  const addTrust = (delta: number, reason: string, loss?: string) => {
    s.trust = clamp(s.trust + delta);
    ev.push({ type: "trust_changed", delta, reason, perceived: false });
    if (loss) s.memory.lastTrustLoss = loss;
  };
  const addAlert = (n: number) => {
    s.alert += n;
    ev.push({ type: "alert_changed", alert: s.alert, perceived: true });
  };
  const hear = (via: "listen" | "footsteps" | "noise") => {
    const loc = locate(s, guardRoom(s));
    s.knowledge.guardLastHeard = { dir: loc.dir, dist: loc.dist, turn: s.turn };
    ev.push({ type: "guard_heard", dir: loc.dir, dist: loc.dist, via, perceived: true });
    return loc;
  };

  // Trust reaction to the previous turn's warning: walking into the guard's room (or the one he's heading to) costs trust.
  const dangerBefore = s.memory.danger;
  s.memory.danger = [];
  if (warnedBefore) {
    if (action.action === "move" && dangerBefore.includes(action.target)) addTrust(-5, "ignored_warning", "ignored_warning");
    else if (action.action === "wait" || action.action === "hide") addTrust(5, "heeded_warning");
  }

  switch (action.action) {
    case "move": {
      const from = s.marlow.room, to = action.target;
      const door = s.doors.find(d => d.id === doorBetween(s, from, to)!.id)!;
      const quiet = action.stance === "quiet";
      if (door.state === "closed") {
        door.state = "open";
        if (quiet) guardSteps = 2;
        else {
          ev.push({ type: "door_noise", door: door.id, perceived: true });
          if (hops(s, guardRoom(s), from) <= 1) addAlert(1);
        }
      }
      const a = s.rooms.find(r => r.id === from)!.pos, b = s.rooms.find(r => r.id === to)!.pos;
      s.marlow.facing = bearingBetween(a, b);
      s.marlow.prevRoom = from;
      s.marlow.room = to;
      s.marlow.hidden = false;
      revealRoom(s, to, true);
      ev.push({ type: "moved", from, to, stance: quiet ? "quiet" : "normal", perceived: true });
      break;
    }
    case "peek": {
      const door = s.doors.find(d => d.id === action.target)!;
      const other = door.between[0] === s.marlow.room ? door.between[1] : door.between[0];
      revealRoom(s, other, false);
      ev.push({
        type: "door_peeked", door: door.id, sees: other,
        props: s.props.filter(p => p.room === other).map(p => p.id),
        items: s.items.filter(i => i.room === other).map(i => i.id),
        guardSeen: guardRoom(s) === other, perceived: true,
      });
      break;
    }
    case "listen": {
      const loc = locate(s, guardRoom(s));
      if (loc.hops <= 2) hear("listen"); else ev.push({ type: "listen_quiet", perceived: true });
      break;
    }
    case "wait":
      ev.push({ type: "waited", perceived: true });
      break;
    case "hide": {
      const p = s.props.find(p => p.room === s.marlow.room && p.tags.includes("hide") && s.knowledge.props.includes(p.id))!;
      s.marlow.hidden = true;
      ev.push({ type: "hid", prop: p.id, perceived: true });
      break;
    }
    case "take": {
      const item = s.items.find(i => i.id === action.target)!;
      item.room = null;
      s.marlow.carrying = item.id;
      ev.push({ type: "item_taken", item: item.id, perceived: true });
      if (item.id === s.objective.item) addTrust(5, "ledger_taken");
      break;
    }
    case "exit": {
      s.status = "won";
      if (s.alert <= 1) addTrust(10, "clean_exit");
      ev.push({ type: "won", alert: s.alert, perceived: true });
      s.turn += 1;
      s.rngState = rng.state;
      return { state: s, events: ev, roll };
    }
  }

  // Guard advances; spotted check after every guard step.
  for (let i = 0; i < guardSteps && s.status === "playing"; i++) {
    s.guard.step = (s.guard.step + 1) % s.guard.route.length;
    ev.push({ type: "guard_moved", to: guardRoom(s), perceived: false });
    if (guardRoom(s) === s.marlow.room && !s.marlow.hidden) {
      ev.push({ type: "spotted", perceived: true });
      addAlert(2);
      addTrust(-10, "spotted", "spotted");
    }
    if (s.alert >= 3) { s.status = "caught"; ev.push({ type: "caught", perceived: true }); }
  }

  s.turn += 1;

  if (s.status === "playing") {
    // Scheduled world events: pre-declared sounds only, perceived within 2 hops.
    for (const e of s.scheduled.filter(e => e.turn === s.turn)) {
      const loc = locate(s, e.room);
      if (loc.hops <= 2) ev.push({ type: "sound_heard", sound: e.sound, dir: loc.dir, dist: loc.dist, perceived: true });
    }
    // Passive footsteps: audible only when the guard is within one hop. That is also the warning.
    const loc = locate(s, guardRoom(s));
    if (loc.hops === 1) {
      hear("footsteps");
      // Warn only when he is heading toward Marlow's room next step.
      const next = s.guard.route[(s.guard.step + 1) % s.guard.route.length];
      if (next === s.marlow.room) {
        ev.push({ type: "warning", dir: loc.dir, dist: loc.dist, perceived: true });
        s.memory.warned = true;
        s.memory.danger = [guardRoom(s), next];
      }
    }
  }

  s.rngState = rng.state;
  return { state: s, events: ev, roll };
}

export { neighbors };
