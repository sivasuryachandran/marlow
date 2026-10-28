import { describe, it, expect } from "vitest";
import level from "../../../data/level.json";
import { Level, type Action, type WorldState } from "@marlow/shared";
import { createInitialState, validateLevel, revealRoom, step, validate, locate, Rng } from "./index";

const mk = (seed = 1, patch?: (s: WorldState) => void): WorldState => {
  const s = createInitialState(level, seed);
  patch?.(s);
  return s;
};
/** Place Marlow in a room as if she had walked there. */
const at = (s: WorldState, room: string, facing: WorldState["marlow"]["facing"] = "north") => {
  s.marlow.room = room; s.marlow.facing = facing; revealRoom(s, room, true);
};
// route: upstairs x3, stairwell, hall, gallery, gallery (pause), hall, office, office, hall, stairwell, hall, office, hall, stairwell
const GUARD = { up: 0, up3: 2, stairwell: 3, hall: 4, gallery: 5, pause: 6, hall2: 7, office: 8 };
const types = (r: ReturnType<typeof step>) => r.events.map(e => e.type);

describe("level", () => {
  it("passes structural validation", () => expect(validateLevel(Level.parse(level))).toEqual([]));
  it("rejects a door whose side contradicts the grid", () => {
    const bad = structuredClone(level) as any;
    bad.doors[0].side.lobby = "left";
    expect(validateLevel(Level.parse(bad)).join()).toContain("contradicts grid");
  });
  it("seeded RNG picks the guard start", () => {
    expect(mk(7).guard.step).toBe(mk(7).guard.step);
    const starts = new Set(Array.from({ length: 40 }, (_, i) => mk(i).guard.step));
    expect(starts.size).toBeGreaterThan(1);
  });
});

describe("spatial", () => {
  it("hall is ahead of the lobby; gallery left and office right once in the hall", () => {
    const s = mk();
    expect(locate(s, "hall")).toMatchObject({ dir: "ahead", dist: "near" });
    at(s, "hall");
    expect(locate(s, "gallery").dir).toBe("left");
    expect(locate(s, "office").dir).toBe("right");
    expect(locate(s, "stairwell").dir).toBe("ahead");
    expect(locate(s, "lobby").dir).toBe("behind");
  });
  it("facing rotates directions", () => {
    const s = mk();
    at(s, "hall", "east"); // facing the office
    expect(locate(s, "office").dir).toBe("ahead");
    expect(locate(s, "gallery").dir).toBe("behind");
  });
});

describe("move", () => {
  it("through a closed door is noisy: guard within 1 hop -> alert +1", () => {
    const s = mk(1, s => { s.guard.step = GUARD.hall; });
    const r = step(s, { action: "move", target: "hall" });
    expect(types(r)).toContain("door_noise");
    expect(r.state.alert).toBe(1);
    expect(r.state.marlow).toMatchObject({ room: "hall", prevRoom: "lobby", facing: "north" });
    expect(r.state.doors.find(d => d.id === "door_lobby_hall")!.state).toBe("open");
  });
  it("noise adds no alert when the guard is 2 hops away (only the spot, +2)", () => {
    const s = mk(1, s => { s.guard.step = GUARD.stairwell; });
    expect(step(s, { action: "move", target: "hall" }).state.alert).toBe(2);
  });
  it("quiet stance is silent but costs two guard steps", () => {
    const s = mk(1, s => { at(s, "hall"); s.guard.step = GUARD.gallery; });
    const r = step(s, { action: "move", target: "office", stance: "quiet" });
    expect(types(r)).not.toContain("door_noise");
    expect(r.state.alert).toBe(0);
    expect(r.state.guard.step).toBe(GUARD.hall2); // gallery -> pause -> hall, while Marlow is already in the office
  });
  it("quiet entry to the hall is spotted when the guard is about to enter it", () => {
    const s = mk(1, s => { s.guard.step = GUARD.stairwell; });
    expect(types(step(s, { action: "move", target: "hall", stance: "quiet" }))).toContain("spotted");
  });
  it("refuses non-adjacent, unknown-connection and unknown rooms; state untouched", () => {
    const s = mk();
    for (const [t, reason] of [["office", "not_adjacent"], ["lobby", "not_adjacent"], ["moon", "unknown_target"]] as const) {
      const r = step(s, { action: "move", target: t });
      expect(r.state).toBe(s);
      expect(r.events).toEqual([{ type: "refused", reason, target: t, perceived: true }]);
    }
    const forgot = mk(1, s => { s.knowledge.doors = []; });
    expect(validate(forgot, { action: "move", target: "hall" })).toMatchObject({ ok: false, reason: "not_known" });
  });
  it("refuses a locked door", () => {
    const s = mk(1, s => { s.doors[0].state = "locked"; });
    expect(validate(s, { action: "move", target: "hall" })).toMatchObject({ reason: "door_locked" });
  });
  it("entering a room reveals its doors, props and items", () => {
    const s = mk(1, s => at(s, "hall"));
    const r = step(s, { action: "move", target: "office" });
    expect(r.state.knowledge.items).toContain("ledger");
    expect(r.state.knowledge.props).toContain("desk_1");
  });
});

describe("peek", () => {
  it("reveals the adjacent room's contents and any guard there", () => {
    const s = mk(1, s => { s.guard.step = GUARD.hall; });
    const r = step(s, { action: "peek", target: "door_lobby_hall" });
    const e = r.events.find(e => e.type === "door_peeked") as any;
    expect(e).toMatchObject({ sees: "hall", guardSeen: true });
    expect(r.state.knowledge.rooms).toContain("hall");
    expect(r.state.marlow.room).toBe("lobby");
  });
  it("reveals items without moving", () => {
    const s = mk(1, s => at(s, "hall"));
    const r = step(s, { action: "peek", target: "door_hall_office" });
    expect(r.state.knowledge.items).toContain("ledger");
  });
  it("refuses unknown door, unknown id, and door in another room", () => {
    const s = mk();
    expect(validate(s, { action: "peek", target: "door_hall_office" })).toMatchObject({ reason: "not_known" });
    expect(validate(s, { action: "peek", target: "nope" })).toMatchObject({ reason: "unknown_target" });
    const t = mk(1, s => { s.knowledge.doors.push("door_hall_office"); });
    expect(validate(t, { action: "peek", target: "door_hall_office" })).toMatchObject({ reason: "not_in_room" });
  });
});

describe("listen", () => {
  it("reports guard direction and distance within 2 hops and stores it as knowledge", () => {
    const s = mk(1, s => { s.guard.step = GUARD.stairwell; });
    const r = step(s, { action: "listen" });
    expect(r.events.find(e => e.type === "guard_heard")).toMatchObject({ dir: "ahead", dist: "mid", via: "listen" });
  });
  it("is silent when the guard is upstairs (3+ hops): listening is a real decision", () => {
    for (const st of [GUARD.up, 1, GUARD.up3]) {
      const r = step(mk(1, s => { s.guard.step = st; }), { action: "listen" });
      expect(types(r)).toContain("listen_quiet");
      expect(types(r)).not.toContain("guard_heard");
    }
  });
  it("the guard pauses a step in the gallery, and the hall is empty most of the route", () => {
    const route = (level as any).guard.route as string[];
    expect(route.filter(r => r === "hall").length / route.length).toBeLessThan(0.4);
    expect(route.some((r, i) => r === "gallery" && route[(i + 1) % route.length] === "gallery")).toBe(true);
  });
  it("Marlow can never move to or learn about the off-stage room", () => {
    const s = mk(1, s => at(s, "stairwell"));
    expect(s.knowledge.doors).not.toContain("stairs_up");
    expect(validate(s, { action: "move", target: "upstairs" })).toMatchObject({ ok: false });
  });
});

describe("wait", () => {
  it("only advances the guard", () => {
    const s = mk(1, s => { s.guard.step = GUARD.up; });
    const r = step(s, { action: "wait" });
    expect(r.state.guard.step).toBe(1);
    expect(r.state.turn).toBe(1);
    expect(r.state.marlow).toEqual(s.marlow);
  });
});

describe("hide", () => {
  it("needs a known hide prop in the room (none in the hall)", () => {
    expect(validate(mk(1, s => at(s, "hall")), { action: "hide" })).toMatchObject({ reason: "no_hide_spot" });
    const unseen = mk(1, s => { s.marlow.room = "gallery"; });
    expect(validate(unseen, { action: "hide" })).toMatchObject({ reason: "no_hide_spot" });
  });
  it("hidden Marlow is not spotted; moving clears hiding", () => {
    const s = mk(1, s => { at(s, "gallery", "west"); s.guard.step = GUARD.hall; });
    const r = step(s, { action: "hide" });
    expect(r.state.guard.step).toBe(GUARD.gallery);
    expect(types(r)).not.toContain("spotted");
    expect(r.state.marlow.hidden).toBe(true);
    const r2 = step(r.state, { action: "move", target: "hall" });
    expect(r2.state.marlow.hidden).toBe(false);
  });
});

describe("take / exit", () => {
  const inOffice = () => mk(1, s => { at(s, "office", "east"); s.guard.step = GUARD.stairwell; });
  it("take requires the item in the room and known", () => {
    expect(validate(mk(), { action: "take", target: "ledger" })).toMatchObject({ reason: "not_known" });
    const known = mk(1, s => { s.knowledge.items.push("ledger"); });
    expect(validate(known, { action: "take", target: "ledger" })).toMatchObject({ reason: "no_item" });
    expect(validate(mk(), { action: "take", target: "gold" })).toMatchObject({ reason: "unknown_target" });
  });
  it("taking the ledger carries it and adds trust", () => {
    const r = step(inOffice(), { action: "take", target: "ledger" });
    expect(r.state.marlow.carrying).toBe("ledger");
    expect(r.state.items[0].room).toBeNull();
    expect(r.state.trust).toBe(55);
  });
  it("exit needs the exit room and the objective item", () => {
    expect(validate(mk(), { action: "exit" })).toMatchObject({ reason: "not_ready_to_exit" });
    const holding = mk(1, s => { at(s, "hall"); s.marlow.carrying = "ledger"; });
    expect(validate(holding, { action: "exit" })).toMatchObject({ reason: "not_ready_to_exit" });
  });
  it("clean exit wins and adds trust; a noisy exit does not", () => {
    const base = (alert: number) => mk(1, s => { s.marlow.carrying = "ledger"; s.alert = alert; });
    const clean = step(base(1), { action: "exit" });
    expect(clean.state.status).toBe("won");
    expect(clean.state.trust).toBe(60);
    expect(step(base(2), { action: "exit" }).state.trust).toBe(50);
  });
  it("nothing is legal after the game ends", () => {
    const won = step(mk(1, s => { s.marlow.carrying = "ledger"; }), { action: "exit" }).state;
    expect(validate(won, { action: "wait" })).toMatchObject({ reason: "game_over" });
  });
});

describe("guard, alert, trust", () => {
  it("spots Marlow in the open: alert +2, trust -10, remembered", () => {
    const s = mk(1, s => { at(s, "hall"); s.guard.step = GUARD.stairwell; });
    const r = step(s, { action: "wait" });
    expect(types(r)).toContain("spotted");
    expect(r.state).toMatchObject({ alert: 2, trust: 40, status: "playing" });
    expect(r.state.memory.lastTrustLoss).toBe("spotted");
  });
  it("alert >= 3 is caught", () => {
    const s = mk(1, s => { at(s, "hall"); s.guard.step = GUARD.stairwell; s.alert = 1; });
    const r = step(s, { action: "wait" });
    expect(r.state.status).toBe("caught");
    expect(validate(r.state, { action: "wait" })).toMatchObject({ reason: "game_over" });
  });
  it("a warning fires only when the guard is one hop away AND heading into Marlow's room", () => {
    // Marlow in the hall; guard goes upstairs(2) -> stairwell(3), whose next step is the hall.
    const r = step(mk(1, s => { at(s, "hall"); s.guard.step = GUARD.up3; }), { action: "wait" });
    expect(types(r)).toContain("warning");
    expect(r.state.memory).toMatchObject({ warned: true, danger: ["stairwell", "hall"] });
    // Adjacent but heading elsewhere (hall -> gallery): heard, not warned.
    const r2 = step(mk(1, s => { s.guard.step = GUARD.stairwell; }), { action: "wait" });
    expect(types(r2)).toContain("guard_heard");
    expect(types(r2)).not.toContain("warning");
    expect(r2.state.memory.warned).toBe(false);
  });
  const warnedInHall = () => step(mk(1, s => { at(s, "hall"); s.guard.step = GUARD.up3; }), { action: "wait" }).state;
  it("moving INTO the guard's room after a warning costs trust (-5) and is remembered", () => {
    const r = step(warnedInHall(), { action: "move", target: "stairwell" });
    expect(r.events).toContainEqual({ type: "trust_changed", delta: -5, reason: "ignored_warning", perceived: false });
    expect(r.state.memory.lastTrustLoss).toBe("ignored_warning");
  });
  it("moving AWAY from the guard after a warning is free", () => {
    const r = step(warnedInHall(), { action: "move", target: "office" });
    expect(r.events.some(e => e.type === "trust_changed")).toBe(false);
    expect(r.state.status).toBe("playing");
    expect(r.state.alert).toBeLessThanOrEqual(1);
  });
  it("hiding right after a warning earns +5", () => {
    const warned = step(mk(1, s => { at(s, "gallery", "west"); s.guard.step = GUARD.stairwell; }), { action: "wait" }).state;
    expect(warned.memory.warned).toBe(true); // guard in hall, next step is the gallery
    const r = step(warned, { action: "hide" });
    expect(r.state.trust).toBe(55);
    expect(types(r)).not.toContain("spotted");
  });
  it("scheduled phone rings only when perceivable", () => {
    const s = mk(1, s => { at(s, "hall"); s.turn = 5; s.guard.step = GUARD.stairwell; s.marlow.hidden = true; });
    const r = step(s, { action: "wait" });
    expect(r.events.find(e => e.type === "sound_heard")).toMatchObject({ sound: "phone_ring", dir: "right" });
  });
  it("trust is clamped to 0..100", () => {
    const s = mk(1, s => { at(s, "hall"); s.guard.step = GUARD.stairwell; s.trust = 4; });
    expect(step(s, { action: "wait" }).state.trust).toBe(0);
  });
});

describe("determinism", () => {
  const ACTIONS: Action[] = [
    { action: "move", target: "hall" }, { action: "move", target: "lobby" }, { action: "move", target: "gallery" },
    { action: "move", target: "office", stance: "quiet" }, { action: "move", target: "stairwell" },
    { action: "peek", target: "door_hall_office" }, { action: "peek", target: "door_lobby_hall" },
    { action: "listen" }, { action: "wait" }, { action: "hide" },
    { action: "take", target: "ledger" }, { action: "exit" },
  ];
  const play = (seed: number) => {
    const pick = new Rng(seed * 31 + 5); // separate "player" RNG
    let s = createInitialState(level, seed);
    const log: unknown[] = [];
    for (let i = 0; i < 60 && s.status === "playing"; i++) {
      const a = ACTIONS[pick.int(ACTIONS.length)];
      const r = step(s, a);
      log.push({ a, e: r.events, roll: r.roll });
      s = r.state;
    }
    return { log, s };
  };
  it("same seed + same actions => identical event log and state (50 seeds)", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const a = play(seed), b = play(seed);
      expect(b.log).toEqual(a.log);
      expect(b.s).toEqual(a.s);
    }
  });
  it("replaying a recorded action list reproduces events exactly", () => {
    const { log } = play(99) as { log: { a: Action; e: unknown }[] };
    let s = createInitialState(level, 99);
    for (const entry of log) {
      const r = step(s, entry.a);
      expect(r.events).toEqual(entry.e);
      s = r.state;
    }
  });
  it("engine never accepts an action validate() rejects", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const pick = new Rng(seed);
      let s = createInitialState(level, seed);
      for (let i = 0; i < 80 && s.status === "playing"; i++) {
        const a = ACTIONS[pick.int(ACTIONS.length)];
        const v = validate(s, a);
        const r = step(s, a);
        if (!v.ok) { expect(r.state).toBe(s); expect(r.events[0].type).toBe("refused"); }
        else expect(r.state.turn).toBe(s.turn + 1);
        s = r.state;
      }
    }
  });
});
