import { describe, it, expect } from "vitest";
import cues from "../../data/cues.json";
import level from "../../data/level.json";
import { createInitialState, step } from "@marlow/engine";
import { cuesFor } from "@marlow/game";
import { CUE_CAPTION, captionFor } from "./captions";

describe("every sound has a caption (the game is understandable muted)", () => {
  it("every cue id in the game's cue list has caption text", () => {
    for (const id of cues as string[]) expect(CUE_CAPTION[id], id).toBeTruthy();
  });
  it("every cue the engine can emit carries a non-empty caption", () => {
    const base = createInitialState(level, 3);
    const events: any[] = [
      { type: "moved", from: "lobby", to: "hall", stance: "normal", perceived: true }, { type: "door_noise", door: "door_lobby_hall", perceived: true },
      { type: "guard_heard", dir: "ahead", dist: "near", via: "footsteps", perceived: true }, { type: "sound_heard", sound: "phone_ring", dir: "left", dist: "mid", perceived: true },
      { type: "guard_alerted", dir: "behind", dist: "near", perceived: true }, { type: "spotted", perceived: true }, { type: "chase_started", perceived: true },
      { type: "alarm_started", turns: 10, perceived: true }, { type: "alarm_tick", left: 3, total: 10, perceived: true }, { type: "alarm_tick", left: 1, total: 10, perceived: true },
    ];
    const next = { ...base, alert: 2, status: "caught" as const };
    const all = cuesFor(base, next, events);
    expect(all.length).toBeGreaterThanOrEqual(10);
    for (const c of all) { expect(c.caption.trim(), c.id).not.toBe(""); expect(CUE_CAPTION[c.id] ?? c.id.startsWith("sfx.footsteps"), c.id).toBeTruthy(); }
  });
  it("an unknown id falls back to the id, never to nothing", () => { expect(captionFor("sfx.new.thing")).toBe("sfx.new.thing"); });
  it("a real played turn also has captions for its cues", () => {
    const r = step(createInitialState(level, 3), { action: "move", target: "hall" });
    for (const c of cuesFor(createInitialState(level, 3), r.state, r.events)) expect(c.caption).toBeTruthy();
  });
});
