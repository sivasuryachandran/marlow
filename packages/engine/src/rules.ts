import type { Action, GameEvent, RefusalReason, WorldState } from "@marlow/shared";
import { Rng } from "./rng";
import { revealRoom } from "./state";
import {
  bearingBetween, doorBetween, guardRoom, hops, locate, neighbors, nextGuardRoom, routeRoom, sideRelativeToFacing,
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

/** A normal (non-quiet) step is audible to a guard in the same or an adjacent room (1 hop). 2 hops made the level unwinnable for anyone who walks normally. */
export const EARSHOT = 1;
/** He walks toward the noise for at most this many steps, then walks back to his route. */
export const DETOUR_STEPS = 2;

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Pure: (state, action) -> new state + events. Invalid actions return the SAME state
 * (no turn, no guard step, no RNG use) with a single `refused` event.
 */
/** One guard step: toward a noise while detouring, back toward his route while returning, otherwise along the route. */
function advanceGuard(s: WorldState) {
  const g = s.guard, next = nextGuardRoom(s);
  if (g.detour && g.detour.left > 0) {
    g.at = next; g.detour.left -= 1;
    if (g.at === g.detour.target || g.detour.left === 0) { g.detour = null; g.returning = g.at !== routeRoom(s); if (!g.returning) g.at = null; }
  } else if (g.returning) {
    g.at = next;
    if (g.at === routeRoom(s)) { g.returning = false; g.at = null; }
  } else { g.step = (g.step + 1) % g.route.length; g.at = null; }
}

/** Bump when a rule changes behaviour, so logs recorded under older rules are reported stale instead of as nondeterminism. */
export const RULES_VERSION = 5;

export function step(prev: WorldState, action: Action, rngIn?: Rng): StepResult {
  const v = validate(prev, action);
  if (!v.ok) return { state: prev, events: [{ type: "refused", reason: v.reason, target: v.target, perceived: true }], roll: -1 };

  const s: WorldState = structuredClone(prev);
  const rng = rngIn ?? new Rng(s.rngState);
  const ev: GameEvent[] = [];
  const roll = rng.int(1_000_000);
  const warnedBefore = s.memory.warned;
  const chasing = s.chase;
  s.memory.warned = false;
  let guardSteps = 1;
  let alarmStartedNow = false;

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
      // Sound-reactive guard: any non-quiet move within earshot pulls him off his route toward Marlow's new room.
      if (!quiet && guardRoom(s) !== to && hops(s, guardRoom(s), to) <= EARSHOT) {
        s.guard.at = guardRoom(s);
        s.guard.detour = { target: to, left: DETOUR_STEPS };
        s.guard.returning = false;
        const loc = locate(s, guardRoom(s));
        ev.push({ type: "guard_alerted", dir: loc.dir, dist: loc.dist, perceived: true });
      }
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
      if (item.id === s.objective.item) {
        addTrust(5, "ledger_taken");
        // Silent alarm: taking the objective starts a countdown. Reach the exit and leave before it hits zero.
        if (s.objective.alarmTurns && s.alarm === null) { s.alarm = s.objective.alarmTurns; alarmStartedNow = true; ev.push({ type: "alarm_started", turns: s.alarm, perceived: true }); }
      }
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

  // Chase: after being spotted the player gets exactly one turn to hide or leave the room.
  let escaped = false;
  if (chasing) {
    if (action.action === "move" || action.action === "hide") {
      s.chase = false; escaped = true;
      ev.push({ type: "chase_escaped", perceived: true });
    } else {
      s.chase = false; s.status = "caught";
      ev.push({ type: "caught", reason: "chase", perceived: true });
      s.turn += 1; s.rngState = rng.state;
      return { state: s, events: ev, roll };
    }
  }

  // Guard advances; spotted check after every guard step.
  for (let i = 0; i < guardSteps && s.status === "playing"; i++) {
    const before = structuredClone(s.guard);
    advanceGuard(s);
    // Slipping away from a chase buys one turn: he searches instead of following straight into her new room.
    if (escaped && guardRoom(s) === s.marlow.room && !s.marlow.hidden) s.guard = before;
    ev.push({ type: "guard_moved", to: guardRoom(s), perceived: false });
    if (guardRoom(s) === s.marlow.room && !s.marlow.hidden) {
      ev.push({ type: "spotted", perceived: true });
      addAlert(2);
      addTrust(-10, "spotted", "spotted");
      if (s.alert < 3) { s.chase = true; ev.push({ type: "chase_started", perceived: true }); break; } // he runs at her: one turn to react
    }
    if (s.alert >= 3) { s.status = "caught"; ev.push({ type: "caught", reason: "alert", perceived: true }); }
  }

  s.turn += 1;

  // The silent alarm ticks once per turn after the one it started on. At zero the building seals: caught.
  if (s.status === "playing" && s.alarm !== null && !alarmStartedNow) {
    s.alarm -= 1;
    if (s.alarm <= 0) { s.status = "caught"; ev.push({ type: "caught", reason: "alarm", perceived: true }); }
    else ev.push({ type: "alarm_tick", left: s.alarm, total: s.objective.alarmTurns!, perceived: true });
  }

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
      const next = nextGuardRoom(s);
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
