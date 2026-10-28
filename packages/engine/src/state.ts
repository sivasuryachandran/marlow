import { Level, WorldState, type Compass } from "@marlow/shared";
import { Rng } from "./rng";
import { bearingBetween, path, sideRelativeToFacing } from "./spatial";

export function revealRoom(s: WorldState, room: string, doors: boolean) {
  const k = s.knowledge;
  const add = (arr: string[], id: string) => { if (!arr.includes(id)) arr.push(id); };
  add(k.rooms, room);
  for (const p of s.props) if (p.room === room) add(k.props, p.id);
  for (const i of s.items) if (i.room === room) add(k.items, i.id);
  if (doors) for (const d of s.doors) if (d.between.includes(room) && !d.between.some(r => s.rooms.find(x => x.id === r)?.offstage)) add(k.doors, d.id);
}

export function createInitialState(
  levelJson: unknown, seed: number, carry: { trust?: number; lastTrustLoss?: string | null } = {},
): WorldState {
  const level = Level.parse(levelJson);
  const errs = validateLevel(level);
  if (errs.length) throw new Error("invalid level: " + errs.join("; "));
  const rng = new Rng(seed >>> 0);
  const s: WorldState = {
    seed, rngState: 0, turn: 0, alert: 0, trust: carry.trust ?? 50, status: "playing",
    rooms: level.rooms, doors: structuredClone(level.doors), props: level.props, items: structuredClone(level.items),
    guard: { ...level.guard, step: rng.int(level.guard.route.length) },
    marlow: { room: level.start.room, facing: level.start.facing, hidden: false, carrying: null, prevRoom: null },
    knowledge: { rooms: [], doors: [], props: [], items: [], guardLastHeard: null },
    objective: level.objective, scheduled: level.scheduled,
    memory: { lastTrustLoss: carry.lastTrustLoss ?? null, warned: false, danger: [] },
  };
  revealRoom(s, s.marlow.room, true);
  s.rngState = rng.state;
  return s;
}

const SIDE_TO_COMPASS = ["north", "east", "south", "west"] as const;

/** V0-style structural check: ids resolve, sides agree with grid, everything reachable, objective doable. */
export function validateLevel(level: Level): string[] {
  const errs: string[] = [];
  const rooms = new Set(level.rooms.map(r => r.id));
  const probe = { rooms: level.rooms, doors: level.doors } as unknown as WorldState;
  for (const d of level.doors) {
    for (const r of d.between) if (!rooms.has(r)) errs.push(`door ${d.id}: unknown room ${r}`);
    const [a, b] = d.between.map(r => level.rooms.find(x => x.id === r));
    if (a && b) {
      for (const [from, to] of [[a, b], [b, a]] as const) {
        const side = d.side[from.id];
        if (!side) { errs.push(`door ${d.id}: missing side for ${from.id}`); continue; }
        const expect = bearingBetween(from.pos, to.pos);
        const got = sideRelativeToFacing(side, "north");
        const gotCompass: Compass = SIDE_TO_COMPASS[["ahead", "right", "behind", "left"].indexOf(got)];
        if (gotCompass !== expect) errs.push(`door ${d.id}: side ${side} in ${from.id} contradicts grid (${expect})`);
      }
    }
  }
  for (const p of level.props) if (!rooms.has(p.room)) errs.push(`prop ${p.id}: unknown room`);
  for (const i of level.items) if (i.room && !rooms.has(i.room)) errs.push(`item ${i.id}: unknown room`);
  const it = level.items.find(i => i.id === level.objective.item);
  if (!it?.room) errs.push("objective item missing or not placed");
  if (!rooms.has(level.objective.exitRoom)) errs.push("exitRoom unknown");
  if (!rooms.has(level.start.room)) errs.push("start room unknown");
  for (const r of level.rooms) if (!path(probe, level.start.room, r.id)) errs.push(`room ${r.id} unreachable`);
  const onstage = { ...probe, doors: level.doors.filter(d => !d.between.some(b => level.rooms.find(r => r.id === b)?.offstage)) } as unknown as WorldState;
  for (const r of level.rooms.filter(r => !r.offstage)) if (!path(onstage, level.start.room, r.id)) errs.push(`room ${r.id} unreachable without off-stage rooms`);
  for (const r of level.guard.route) if (!rooms.has(r)) errs.push(`guard route: unknown room ${r}`);
  const rt = level.guard.route;
  for (let i = 0; i < rt.length; i++) {
    const a = rt[i], b = rt[(i + 1) % rt.length];
    if (a !== b && path(probe, a, b)?.length !== 2) errs.push(`guard route ${a}->${b} not adjacent`);
  }
  for (const e of level.scheduled) if (!rooms.has(e.room)) errs.push(`scheduled ${e.id}: unknown room`);
  return errs;
}
