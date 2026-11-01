import { describe, it, expect } from "vitest";
import level from "../../data/level.json";
import { createInitialState } from "@marlow/engine";
import { inside, overlaps, planLayout, tokenSpot, WALL } from "./plan-layout";

const s = createInitialState(level, 7);
const plan = planLayout(s);
const room = (id: string) => plan.rooms.find(r => r.id === id)!;

describe("seer floor plan layout (from level data only)", () => {
  it("has one room per level room, none overlapping", () => {
    expect(plan.rooms.map(r => r.id).sort()).toEqual(s.rooms.map(r => r.id).sort());
    for (const a of plan.rooms) for (const b of plan.rooms) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });
  it("puts every doorway in the wall between exactly the two rooms it connects", () => {
    for (const d of plan.doors) {
      const [a, b] = d.between.map(room);
      // the doorway point is within half a wall of both rooms' edges
      const near = (r: typeof a) => d.x >= r.x - WALL && d.x <= r.x + r.w + WALL && d.y >= r.y - WALL && d.y <= r.y + r.h + WALL;
      expect(near(a), d.id).toBe(true);
      expect(near(b), d.id).toBe(true);
      for (const r of plan.rooms) if (r !== a && r !== b) expect(near(r), `${d.id} touches ${r.id}`).toBe(false);
    }
  });
  it("matches compass sense: the stairwell is above the hall, the gallery to its left, the office to its right", () => {
    expect(room("stairwell").y).toBeLessThan(room("hall").y);
    expect(room("gallery").x).toBeLessThan(room("hall").x);
    expect(room("office").x).toBeGreaterThan(room("hall").x);
    expect(room("lobby").y).toBeGreaterThan(room("hall").y);
  });
  it("floors follow each room's footstep material; the exit room gets the lobby floor", () => {
    expect(room("office").floor).toBe("floor_carpet");
    expect(room("stairwell").floor).toBe("floor_metal");
    expect(room("lobby").floor).toBe("floor_lobby");
  });
  it("props sit inside their own room and off the doorway, and tokens stand inside their room", () => {
    for (const p of plan.props) {
      expect(inside({ x: p.x, y: p.y }, room(p.room))).toBe(true);
      expect(inside({ x: p.x + p.w, y: p.y + p.h }, room(p.room))).toBe(true);
      for (const d of plan.doors.filter(d => d.between.includes(p.room))) expect(inside(d, { x: p.x - 10, y: p.y - 10, w: p.w + 20, h: p.h + 20 }), `${p.id} blocks ${d.id}`).toBe(false);
    }
    for (const r of plan.rooms) for (const who of ["marlow", "guard"] as const) expect(inside(tokenSpot(plan, r.id, who), r)).toBe(true);
  });
  it("the street is below the exit room, the full width of the map", () => {
    expect(plan.street.y).toBeGreaterThan(room("lobby").y + room("lobby").h);
    expect(plan.street.w).toBe(plan.width);
  });
});
