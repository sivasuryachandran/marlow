import type { Compass, Dir, Dist, Side, WorldState } from "@marlow/shared";

const COMPASS: Compass[] = ["north", "east", "south", "west"];
const SIDE_BEARING: Record<Side, number> = { ahead: 0, right: 1, behind: 2, left: 3 };

/** North is +y. A room-frame side is expressed relative to a north-facing observer. */
export function bearingBetween(a: [number, number], b: [number, number]): Compass {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "north" : "south";
  return dx >= 0 ? "east" : "west";
}

export function relative(bearing: Compass, facing: Compass): Side {
  const r = (COMPASS.indexOf(bearing) - COMPASS.indexOf(facing) + 4) % 4;
  return (["ahead", "right", "behind", "left"] as Side[])[r];
}

/** Direction of a room-frame side (door/prop) as Marlow currently perceives it. */
export function sideRelativeToFacing(side: Side, facing: Compass): Side {
  return relative(COMPASS[SIDE_BEARING[side]], facing);
}

export function neighbors(s: WorldState, room: string): string[] {
  return s.doors.filter(d => d.between.includes(room)).map(d => d.between[0] === room ? d.between[1] : d.between[0]);
}

export function doorBetween(s: WorldState, a: string, b: string) {
  return s.doors.find(d => d.between.includes(a) && d.between.includes(b));
}

/** Shortest room path (inclusive) over all connections, or null. */
export function path(s: WorldState, from: string, to: string): string[] | null {
  const prev = new Map<string, string | null>([[from, null]]);
  const q = [from];
  while (q.length) {
    const r = q.shift()!;
    if (r === to) {
      const out: string[] = [];
      for (let c: string | null = r; c; c = prev.get(c) ?? null) out.unshift(c);
      return out;
    }
    for (const n of neighbors(s, r)) if (!prev.has(n)) { prev.set(n, r); q.push(n); }
  }
  return null;
}

export function hops(s: WorldState, a: string, b: string): number {
  const p = path(s, a, b);
  return p ? p.length - 1 : Infinity;
}

export function distBucket(h: number): Dist { return h <= 1 ? "near" : h === 2 ? "mid" : "far"; }

/** Direction + distance from Marlow to any room; the one computation audio and speech share. */
export function locate(s: WorldState, room: string): { dir: Dir; dist: Dist; hops: number } {
  const from = s.marlow.room;
  const p = path(s, from, room);
  if (!p) return { dir: "here", dist: "far", hops: Infinity };
  if (p.length === 1) return { dir: "here", dist: "near", hops: 0 };
  const a = s.rooms.find(r => r.id === from)!.pos, b = s.rooms.find(r => r.id === p[1])!.pos;
  return { dir: relative(bearingBetween(a, b), s.marlow.facing), dist: distBucket(p.length - 1), hops: p.length - 1 };
}

export function guardRoom(s: WorldState): string { return s.guard.route[s.guard.step % s.guard.route.length]; }
