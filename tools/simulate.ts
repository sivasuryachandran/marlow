/**
 * Balance simulator. Plays N seeded runs per policy through the real engine and reports outcomes.
 * Policies only act on what Marlow PERCEIVES (event stream + her knowledge), never on the hidden guard position.
 *   cautious: listen, move only after a silent listen, otherwise wait (or hide when warned and cover exists)
 *   reckless: always move toward the objective
 * Usage: npx tsx tools/simulate.ts [seeds=1000] [--md]   -> simulation.md + simulation.svg
 */
import { writeFileSync } from "node:fs";
import { createInitialState, locate, neighbors, path, step } from "../packages/engine/src/index";
import type { Action, GameEvent, WorldState } from "../packages/shared/src/index";
import { level as baseLevel } from "./lib";

const routeArg = process.argv.find(a => a.startsWith("--route="))?.slice(8);
const level = routeArg ? { ...baseLevel, guard: { ...baseLevel.guard, route: routeArg.split(",") } } : baseLevel;

type Mem = { silentAtTurn: number | null; silent: boolean; warnedAtTurn: number | null; heardDir: string | null; commit: number };

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

const policies: Record<string, (s: WorldState, m: Mem) => Action> = {
  reckless(s) {
    const a = objectiveAction(s);
    return "move" in a ? mv(a.move) : a;
  },
  cautious(s, m) {
    const a = objectiveAction(s);
    if (!("move" in a)) return a; // take / exit are in-room, no crossing risk
    if (m.commit > 0) { m.commit--; return mv(a.move); } // after a silent listen, finish the crossing without stopping in the open
    if (m.silentAtTurn === s.turn) {
      if (m.silent) { m.commit = s.marlow.room === "hall" ? 0 : 1; return mv(a.move); }
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
    else if (e.type === "guard_heard" && e.via === "listen") { m.silent = false; m.silentAtTurn = s.turn; m.heardDir = e.dir; }
    else if (e.type === "warning") m.warnedAtTurn = s.turn;
  }
}

// ---------- expert: tracks where the guard COULD be from observations alone, then looks ahead ----------
// The player knows the rules and that the guard walks a loop (briefing). It never reads the hidden guard position:
// it keeps a belief set of route indices consistent with every perceived event so far and plans against that set.
import { candidateActions } from "../packages/engine/src/index";
const obsSig = (events: GameEvent[]) => JSON.stringify(events.filter(e => e.perceived));
const withGuard = (s: WorldState, g: number): WorldState => ({ ...s, guard: { ...s.guard, step: g } });

function remaining(s: WorldState): number {
  const onstage = { ...s, doors: s.doors.filter(d => !d.between.some(b => s.rooms.find(r => r.id === b)?.offstage)) } as WorldState;
  const hops = (a: string, b: string) => path(onstage, a, b)!.length - 1;
  const itemRoom = s.items.find(i => i.id === s.objective.item)!.room;
  if (s.marlow.carrying) return hops(s.marlow.room, s.objective.exitRoom) + 1;
  return hops(s.marlow.room, itemRoom!) + 1 + hops(itemRoom!, s.objective.exitRoom) + 1;
}

function expectimax(s: WorldState, belief: number[], depth: number): number {
  if (s.status === "won") return 1000;
  if (s.status === "caught") return -1000;
  if (depth === 0) return -3 * remaining(s);
  let best = -Infinity;
  for (const a of candidateActions(s)) {
    const groups = new Map<string, { st: WorldState; gs: number[]; alertDelta: number }>();
    for (const g of belief) {
      const r = step(withGuard(s, g), a);
      const k = obsSig(r.events);
      const grp = groups.get(k) ?? { st: r.state, gs: [], alertDelta: r.state.alert - s.alert };
      grp.gs.push(r.state.guard.step); groups.set(k, grp);
    }
    let v = -1; // every turn costs a little: don't dither
    for (const grp of groups.values()) {
      const p = grp.gs.length / belief.length;
      v += p * (-60 * grp.alertDelta + expectimax(grp.st, [...new Set(grp.gs)], depth - 1));
    }
    if (v > best) best = v;
  }
  return best;
}

const EXPERT_DEPTH = Number(process.env.EXPERT_DEPTH ?? 3);
function expertPlay(seed: number, maxTurns = 60) {
  let s = createInitialState(level, seed);
  let belief = s.guard.route.map((_, i) => i);
  while (s.status === "playing" && s.turn < maxTurns) {
    let bestA: Action | null = null, bestV = -Infinity;
    for (const a of candidateActions(s)) {
      const groups = new Map<string, { st: WorldState; gs: number[]; alertDelta: number }>();
      for (const g of belief) {
        const r = step(withGuard(s, g), a);
        const k = obsSig(r.events);
        const grp = groups.get(k) ?? { st: r.state, gs: [], alertDelta: r.state.alert - s.alert };
        grp.gs.push(r.state.guard.step); groups.set(k, grp);
      }
      let v = -1;
      for (const grp of groups.values()) v += (grp.gs.length / belief.length) * (-60 * grp.alertDelta + expectimax(grp.st, [...new Set(grp.gs)], EXPERT_DEPTH - 1));
      if (v > bestV) { bestV = v; bestA = a; }
    }
    const prev = s;
    const r = step(s, bestA!);
    // update belief with what was actually perceived
    const sig = obsSig(r.events), next = new Set<number>();
    for (const g of belief) { const x = step(withGuard(prev, g), bestA!); if (obsSig(x.events) === sig) next.add(x.state.guard.step); }
    belief = [...next];
    s = r.state;
  }
  return s;
}

function play(policy: string, seed: number, maxTurns = 60) {
  let s = createInitialState(level, seed);
  const m: Mem = { silentAtTurn: null, silent: false, warnedAtTurn: null, heardDir: null, commit: 0 };
  while (s.status === "playing" && s.turn < maxTurns) {
    const r = step(s, policies[policy](s, m));
    s = r.state;
    learn(m, s, r.events);
  }
  return s;
}

const NN = Number(process.argv.find(a => /^\d+$/.test(a)) ?? 1000);
const EXPERT_N = Math.min(NN, Number(process.env.EXPERT_N ?? 300));
const rows = [...Object.keys(policies), "expert"].map(name => {
  const N = name === "expert" ? EXPERT_N : NN;
  let won = 0, caught = 0, timeout = 0, clean = 0, turns = 0, alert = 0, trust = 0;
  for (let seed = 1; seed <= N; seed++) {
    const s = name === "expert" ? expertPlay(seed) : play(name, seed);
    if (s.status === "won") { won++; turns += s.turn; if (s.alert <= 1) clean++; }
    else if (s.status === "caught") caught++; else timeout++;
    alert += s.alert; trust += s.trust;
  }
  const pct = (x: number) => Math.round((x / N) * 1000) / 10;
  return { policy: name, runs: N, win: pct(won), cleanWin: pct(clean), caught: pct(caught), timeout: pct(timeout), meanTurnsToWin: won ? Math.round((turns / won) * 10) / 10 : null, meanAlert: Math.round((alert / N) * 100) / 100, meanTrust: Math.round(trust / N) };
});
console.table(rows);

const md = `# Balance simulation

Generated by \`npx tsx tools/simulate.ts\` (${NN} seeds per policy (expert: ${EXPERT_N}), real engine, policies see only Marlow's perception).

| Policy | Win % | Clean win % (alert ≤ 1) | Caught % | Timeout (60 turns) % | Mean turns to win | Mean final trust |
|---|---|---|---|---|---|---|
${rows.map(r => `| ${r.policy} | ${r.win} | ${r.cleanWin} | ${r.caught} | ${r.timeout} | ${r.meanTurnsToWin} | ${r.meanTrust} |`).join("\n")}

Reading it: the win % counts any exit (a single spot, alert 2, is survivable; caught at alert 3). **Clean win** (alert ≤ 1) is the skill measure.
- reckless: always moves toward the objective, never listens.
- cautious: listens, moves only after a silent listen, finishes a crossing without stopping, retreats from the heard direction when there is no cover. Simple rules, no memory of the guard's loop.
- expert: knows the rules and that the guard walks a loop; tracks which route positions are consistent with everything it has perceived and looks 3 turns ahead. It never reads the hidden guard position.
`;
if (!routeArg) writeFileSync("simulation.md", md);
const bar = (y: number, label: string, v: number, color: string) => `<text x="10" y="${y + 14}" fill="#ccd" font-size="13" font-family="sans-serif">${label}</text><rect x="150" y="${y}" width="${v * 4}" height="20" fill="${color}"/><text x="${156 + v * 4}" y="${y + 15}" fill="#fff" font-size="13" font-family="sans-serif">${v}%</text>`;
if (!routeArg) writeFileSync("simulation.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 ${40 + rows.length * 56}" role="img" aria-label="Win rate by player policy"><rect width="100%" height="100%" fill="#0b0b10"/><text x="10" y="22" fill="#e8a33d" font-size="16" font-family="serif">Win rate over seeded runs</text>${rows.map((r, i) => bar(36 + i * 56, `${r.policy} (win)`, r.win, "#e8a33d") + bar(58 + i * 56 - 2, `${r.policy} (caught)`, r.caught, "#c33")).join("")}</svg>`);
