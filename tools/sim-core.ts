/**
 * Balance simulator core, shared by tools/simulate.ts (the built-in level) and the mission generator (every generated
 * level must pass it before anyone plays it). Policies act only on what Marlow perceives, never the hidden guard.
 */
import { candidateActions, createInitialState, guardRoom, locate, neighbors, path, step } from "../packages/engine/src/index";
import type { Action, GameEvent, WorldState } from "../packages/shared/src/index";

/** The room with the most doorways: the policies treat it as the crossing to get through without stopping. */
const hub = (s: WorldState) => [...s.rooms].sort((a, b) => s.doors.filter(d => d.between.includes(b.id)).length - s.doors.filter(d => d.between.includes(a.id)).length)[0].id;

type Mem = { silentAtTurn: number | null; silent: boolean; warnedAtTurn: number | null; heardDir: string | null; heardDist?: string | null; commit: number };

function nextToward(s: WorldState, target: string): string {
  const onstage = { ...s, doors: s.doors.filter(d => !d.between.some(b => s.rooms.find(r => r.id === b)?.offstage)) } as WorldState;
  return path(onstage, s.marlow.room, target)![1];
}
/** The objective part of the plan is common knowledge from the briefing. */
function objectiveAction(s: WorldState): Action | { move: string } {
  if (s.marlow.carrying) return s.marlow.room === s.objective.exitRoom ? { action: "exit" } : { move: nextToward(s, s.objective.exitRoom) };
  const itemRoom = s.items.find(i => i.id === s.objective.item)!.room!;
  return s.marlow.room === itemRoom ? { action: "take", target: s.objective.item } : { move: nextToward(s, itemRoom) };
}
const mv = (t: string): Action => ({ action: "move", target: t });

export const policies: Record<string, (s: WorldState, m: Mem) => Action> = {
  /** The earlier cautious player: listens and waits, but never takes cover on a warning. */
  "cautious-no-cover"(s, m) { const w = m.warnedAtTurn; m.warnedAtTurn = null; const a = policies.cautious(s, m); m.warnedAtTurn = w; return a; },
  reckless(s) {
    const a = objectiveAction(s);
    return "move" in a ? mv(a.move) : a;
  },
  /**
   * careful: what a thoughtful listener does. Listen; then move quietly unless the footsteps are near or in the direction
   * you are heading; hide (or step away) when warned. Unlike "cautious" it does not need total silence, which in a small
   * building may never come. Used to prove every generated mission can be won by careful play.
   */
  careful(s, m) {
    const a = objectiveAction(s);
    const cover = s.props.some(p => p.room === s.marlow.room && p.tags.includes("hide") && s.knowledge.props.includes(p.id));
    const exits = () => neighbors(s, s.marlow.room).filter(r => !s.rooms.find(x => x.id === r)?.offstage);
    if (s.chase) { if (cover) return { action: "hide" }; const to = "move" in a && exits().includes(a.move) ? a.move : exits()[0]; return { action: "move", target: to, stance: "quiet" }; }
    if (!("move" in a)) return a;
    const quiet = (t: string): Action => ({ action: "move", target: t, stance: "quiet" });
    // The silent alarm is running and time is short: a thoughtful player stops waiting and goes, quietly, accepting the risk.
    if (s.alarm !== null && s.alarm <= remaining(s) + 2) return quiet(a.move);
    if (m.warnedAtTurn === s.turn) {
      if (cover) return { action: "hide" };
      const away = exits().filter(r => locate(s, r).dir !== m.heardDir);
      return away.length ? quiet(away.includes(a.move) ? a.move : away[0]) : { action: "wait" };
    }
    if (m.silentAtTurn === s.turn) {
      if (m.silent) return quiet(a.move);
      if (m.heardDist !== "near" && locate(s, a.move).dir !== m.heardDir) return quiet(a.move);
      return cover ? { action: "hide" } : { action: "wait" };
    }
    return { action: "listen" };
  },
  /**
   * waiter: the most timid player. Listens; moves only after a silent listen; whenever it is unsure (anything heard, any
   * warning) it simply waits. It never hides on a warning and ignores the alarm: it shows what pure waiting is worth.
   */
  waiter(s, m) {
    const a = objectiveAction(s);
    if (s.chase) { const exits = neighbors(s, s.marlow.room).filter(r => !s.rooms.find(x => x.id === r)?.offstage); return { action: "move", target: "move" in a && exits.includes(a.move) ? a.move : exits[0], stance: "quiet" }; }
    if (!("move" in a)) return a;
    if (m.silentAtTurn === s.turn) return m.silent && m.warnedAtTurn !== s.turn ? { action: "move", target: a.move, stance: "quiet" } : { action: "wait" };
    return { action: "listen" };
  },
  cautious(s, m) {
    const a = objectiveAction(s);
    if (s.chase) { // he is running at her: hide if there is known cover, otherwise slip out quietly (a slammed door adds alert)
      const cover = s.props.some(p => p.room === s.marlow.room && p.tags.includes("hide") && s.knowledge.props.includes(p.id));
      if (cover) return { action: "hide" };
      const exits = neighbors(s, s.marlow.room).filter(r => !s.rooms.find(x => x.id === r)?.offstage);
      const to = "move" in a && exits.includes(a.move) ? a.move : exits[0];
      return { action: "move", target: to, stance: "quiet" };
    }
    if (!("move" in a)) return a; // take / exit are in-room, no crossing risk
    if (m.warnedAtTurn === s.turn) { // "Guard's close, boss": take cover if there is any, otherwise get out of his way
      const cover = s.props.some(p => p.room === s.marlow.room && p.tags.includes("hide") && s.knowledge.props.includes(p.id));
      if (cover) return { action: "hide" };
    }
    if (m.commit > 0) { m.commit--; return mv(a.move); } // after a silent listen, finish the crossing without stopping in the open
    if (m.silentAtTurn === s.turn) {
      if (m.silent) { m.commit = s.marlow.room === hub(s) ? 0 : 1; return mv(a.move); }
      const cover = s.props.some(p => p.room === s.marlow.room && p.tags.includes("hide") && s.knowledge.props.includes(p.id));
      if (cover) return m.warnedAtTurn === s.turn ? { action: "hide" } : { action: "wait" };
      // No cover (the hall): back away from the heard direction, preferring the room the plan needs.
      const exits = neighbors(s, s.marlow.room).filter(r => !s.rooms.find(x => x.id === r)?.offstage && locate(s, r).dir !== m.heardDir);
      return exits.length ? mv(exits.includes(a.move) ? a.move : exits[0]) : { action: "wait" };
    }
    return { action: "listen" };
  },
};

function learn(m: Mem, s: WorldState, events: GameEvent[]) {
  for (const e of events) {
    if (e.type === "listen_quiet") { m.silent = true; m.silentAtTurn = s.turn; }
    else if (e.type === "guard_heard" && e.via === "listen") { m.silent = false; m.silentAtTurn = s.turn; m.heardDir = e.dir; m.heardDist = e.dist; }
    else if (e.type === "warning") m.warnedAtTurn = s.turn;
  }
}

// ---------- expert: tracks where the guard COULD be from observations alone, then looks ahead ----------
// The player knows the rules and that the guard walks a loop (briefing). It never reads the hidden guard position:
// it keeps a belief set of route indices consistent with every perceived event so far and plans against that set.
const obsSig = (events: GameEvent[]) => JSON.stringify(events.filter(e => e.perceived));
type G = WorldState["guard"];
const withGuard = (s: WorldState, g: G): WorldState => ({ ...s, guard: g });
const uniqG = (gs: G[]): G[] => [...new Map(gs.map(g => [JSON.stringify([g.step, g.at, g.detour, g.returning]), g])).values()];

function remaining(s: WorldState): number {
  const onstage = { ...s, doors: s.doors.filter(d => !d.between.some(b => s.rooms.find(r => r.id === b)?.offstage)) } as WorldState;
  const hops = (a: string, b: string) => path(onstage, a, b)!.length - 1;
  const itemRoom = s.items.find(i => i.id === s.objective.item)!.room;
  if (s.marlow.carrying) return hops(s.marlow.room, s.objective.exitRoom) + 1;
  return hops(s.marlow.room, itemRoom!) + 1 + hops(itemRoom!, s.objective.exitRoom) + 1;
}

function expectimax(s: WorldState, belief: G[], depth: number): number {
  if (s.status === "won") return 1000;
  if (s.status === "caught") return -1000;
  if (depth === 0) return -3 * remaining(s);
  let best = -Infinity;
  for (const a of candidateActions(s)) {
    const groups = new Map<string, { st: WorldState; gs: G[]; alertDelta: number }>();
    for (const g of belief) {
      const r = step(withGuard(s, g), a);
      const k = obsSig(r.events);
      const grp = groups.get(k) ?? { st: r.state, gs: [], alertDelta: r.state.alert - s.alert };
      grp.gs.push(r.state.guard); groups.set(k, grp);
    }
    let v = -1; // every turn costs a little: don't dither
    for (const grp of groups.values()) {
      const p = grp.gs.length / belief.length;
      v += p * (-60 * grp.alertDelta + expectimax(grp.st, uniqG(grp.gs), depth - 1));
    }
    if (v > best) best = v;
  }
  return best;
}

const EXPERT_DEPTH = Number(process.env.EXPERT_DEPTH ?? 3);
export function expertPlay(level: unknown, seed: number, maxTurns = 60) {
  let s = createInitialState(level, seed);
  let belief: G[] = s.guard.route.map((_, i) => ({ ...s.guard, step: i, at: null, detour: null, returning: false }));
  while (s.status === "playing" && s.turn < maxTurns) {
    let bestA: Action | null = null, bestV = -Infinity;
    for (const a of candidateActions(s)) {
      const groups = new Map<string, { st: WorldState; gs: G[]; alertDelta: number }>();
      for (const g of belief) {
        const r = step(withGuard(s, g), a);
        const k = obsSig(r.events);
        const grp = groups.get(k) ?? { st: r.state, gs: [], alertDelta: r.state.alert - s.alert };
        grp.gs.push(r.state.guard); groups.set(k, grp);
      }
      let v = -1;
      for (const grp of groups.values()) v += (grp.gs.length / belief.length) * (-60 * grp.alertDelta + expectimax(grp.st, uniqG(grp.gs), EXPERT_DEPTH - 1));
      if (v > bestV) { bestV = v; bestA = a; }
    }
    const prev = s;
    const r = step(s, bestA!);
    // update belief with what was actually perceived
    const sig = obsSig(r.events), next: G[] = [];
    for (const g of belief) { const x = step(withGuard(prev, g), bestA!); if (obsSig(x.events) === sig) next.push(x.state.guard); }
    belief = uniqG(next);
    s = r.state;
  }
  return s;
}

export function play(level: unknown, policy: string, seed: number, maxTurns = 60) {
  let s = createInitialState(level, seed);
  const m: Mem = { silentAtTurn: null, silent: false, warnedAtTurn: null, heardDir: null, heardDist: null, commit: 0 };
  const trace: string[] = [];
  while (s.status === "playing" && s.turn < maxTurns) {
    const a = policies[policy](s, m);
    const before = `${s.marlow.room}(g:${guardRoom(s)}${s.guard.detour ? "*" : ""})`;
    const r = step(s, a);
    s = r.state;
    learn(m, s, r.events);
    if (process.env.TRACE) trace.push(`${before} ${a.action}${(a as { target?: string }).target ? ":" + (a as { target?: string }).target : ""} -> ${r.events.filter(e => e.perceived && !["alert_changed", "trust_changed"].includes(e.type)).map(e => e.type).join(",")}`);
  }
  if (process.env.TRACE && s.status === "caught" && Number(process.env.TRACE) > 0) { console.log(`--- ${policy} seed ${seed} caught\n  ` + trace.slice(-7).join("\n  ")); process.env.TRACE = String(Number(process.env.TRACE) - 1); }
  return s;
}


export interface PolicyRow { policy: string; runs: number; win: number; cleanWin: number; caught: number; timeout: number; meanTurnsToWin: number | null; meanAlert: number; meanTrust: number }
export function summarize(level: unknown, names: string[], N: number, expertN = Math.min(N, 300)): PolicyRow[] {
  return names.map(name => {
    const n = name === "expert" ? expertN : N;
    let won = 0, caught = 0, timeout = 0, clean = 0, turns = 0, alert = 0, trust = 0;
    for (let seed = 1; seed <= n; seed++) {
      const s = name === "expert" ? expertPlay(level, seed) : play(level, name, seed);
      if (s.status === "won") { won++; turns += s.turn; if (s.alert <= 1) clean++; }
      else if (s.status === "caught") caught++; else timeout++;
      alert += s.alert; trust += s.trust;
    }
    const pct = (x: number) => Math.round((x / n) * 1000) / 10;
    return { policy: name, runs: n, win: pct(won), cleanWin: pct(clean), caught: pct(caught), timeout: pct(timeout), meanTurnsToWin: won ? Math.round((turns / won) * 10) / 10 : null, meanAlert: Math.round((alert / n) * 100) / 100, meanTrust: Math.round(trust / n) };
  });
}
export const POLICIES = Object.keys(policies);
