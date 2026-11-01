/**
 * Floor-plan geometry for the seer's top-down map, computed from the level data only (room grid positions, which wall
 * each door is on, which wall each prop is against). Pure: no DOM, no randomness, so it can be tested and can never
 * disagree with the engine. "ahead/right/behind/left" in level.json are relative to facing north (see validateLevel).
 */
import type { WorldState } from "@marlow/shared";

export const CELL_W = 260, CELL_H = 190, WALL = 18, MARGIN = 34, STREET = 70;
export interface Rect { x: number; y: number; w: number; h: number }
export interface PlanRoom extends Rect { id: string; name: string; floor: string; offstage: boolean }
export interface PlanDoor { id: string; kind: string; x: number; y: number; horizontal: boolean; between: [string, string] }
export interface PlanProp extends Rect { id: string; room: string; kind: "desk" | "case" | "other"; hide: boolean }
export interface Plan { width: number; height: number; rooms: PlanRoom[]; doors: PlanDoor[]; props: PlanProp[]; exit: { x: number; y: number }; street: Rect }

const FLOOR: Record<string, string> = { marble: "floor_marble", carpet: "floor_carpet", metal: "floor_metal" };

export function planLayout(s: Pick<WorldState, "rooms" | "doors" | "props" | "objective">): Plan {
  const xs = s.rooms.map(r => r.pos[0]), ys = s.rooms.map(r => r.pos[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const rooms: PlanRoom[] = s.rooms.map(r => ({
    id: r.id, name: r.spokenName.replace(/^the /, ""), offstage: !!r.offstage,
    floor: r.id === s.objective.exitRoom ? "floor_lobby" : FLOOR[r.footsteps] ?? "floor_marble",
    x: MARGIN + (r.pos[0] - minX) * CELL_W, y: MARGIN + (maxY - r.pos[1]) * CELL_H, w: CELL_W - WALL, h: CELL_H - WALL,
  }));
  const room = (id: string) => rooms.find(r => r.id === id)!;
  /** The midpoint of a room's wall on a north-relative side, pushed half a wall outward (the doorway sits in the wall). */
  const wallPoint = (r: Rect, side: string) => {
    switch (side) {
      case "ahead": return { x: r.x + r.w / 2, y: r.y - WALL / 2, horizontal: true };
      case "behind": return { x: r.x + r.w / 2, y: r.y + r.h + WALL / 2, horizontal: true };
      case "left": return { x: r.x - WALL / 2, y: r.y + r.h / 2, horizontal: false };
      default: return { x: r.x + r.w + WALL / 2, y: r.y + r.h / 2, horizontal: false };
    }
  };
  const doors: PlanDoor[] = s.doors.map(d => {
    const a = d.between[0], p = wallPoint(room(a), d.side[a]);
    return { id: d.id, kind: d.kind, ...p, between: [d.between[0], d.between[1]] as [string, string] };
  });
  const props: PlanProp[] = s.props.map(p => {
    const r = room(p.room), kind: PlanProp["kind"] = /desk/.test(p.id) ? "desk" : /case/.test(p.id) ? "case" : "other";
    const [w, h] = kind === "desk" ? [86, 42] : kind === "case" ? [34, 92] : [50, 40];
    // against its wall, a third of the way along, so it never blocks the doorway in the middle of that wall
    const pos = { ahead: [r.x + r.w * 0.22, r.y + 12], behind: [r.x + r.w * 0.22, r.y + r.h - h - 12], left: [r.x + 14, r.y + r.h * 0.12], right: [r.x + r.w - w - 14, r.y + r.h * 0.12] }[p.side as string] ?? [r.x + 14, r.y + 14];
    return { id: p.id, room: p.room, kind, hide: p.tags.includes("hide"), x: pos[0], y: pos[1], w, h };
  });
  const exitRoom = room(s.objective.exitRoom);
  const width = MARGIN * 2 + (maxX - minX + 1) * CELL_W - WALL, height = MARGIN * 2 + (maxY - minY + 1) * CELL_H - WALL + STREET;
  const street = { x: 0, y: exitRoom.y + exitRoom.h + WALL, w: width, h: height - (exitRoom.y + exitRoom.h + WALL) };
  return { width, height, rooms, doors, props, exit: { x: exitRoom.x + exitRoom.w / 2, y: exitRoom.y + exitRoom.h + WALL / 2 }, street };
}

/** Where a token stands in a room: Marlow left of centre, the guard right of centre, so they never cover each other. */
export function tokenSpot(plan: Plan, roomId: string, who: "marlow" | "guard") {
  const r = plan.rooms.find(x => x.id === roomId)!;
  return { x: r.x + r.w * (who === "marlow" ? 0.4 : 0.64), y: r.y + r.h * (who === "marlow" ? 0.62 : 0.5) };
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
