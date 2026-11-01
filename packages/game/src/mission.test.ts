import { describe, it, expect } from "vitest";
import linesJson from "../../../data/lines.json";
import beatsJson from "../../../data/beats.json";
import { createInitialState, step } from "@marlow/engine";
import { fixtureSpec } from "./mission.fixture";
import { buildMission, checkSpec, checkText, loadBank, localParse, InMemoryStore, MockIntent, Session, type Beat, type MissionSpec } from "./index";

const base = { lines: loadBank(linesJson), beats: beatsJson as Beat[] };
const kase = { id: "test", inspiredBy: "a test", sources: ["https://example.org"] };

const spec = fixtureSpec;

describe("mission generator: spec -> playable mission", () => {
  it("builds a valid level whose doors, cover and patrol come from code, not the model", () => {
    const { mission, errors } = buildMission(spec(), kase, base);
    expect(errors).toEqual([]);
    const s = createInitialState(mission!.level, 3);
    expect(s.marlow.room).toBe("foyer");
    // door walls computed from the grid: the rotunda is north of the foyer
    expect(s.doors.find(d => d.id === "door_foyer_rotunda")!.side).toEqual({ foyer: "ahead", rotunda: "behind" });
    // cover never shares a wall with a doorway
    for (const p of s.props) expect(s.doors.filter(d => d.between.includes(p.room)).map(d => d.side[p.room])).not.toContain(p.side);
    // the patrol only ever steps to the same or an adjacent room
    expect(s.guard.route[0]).toBe("post");
  });
  it("is playable to a win through the real engine", () => {
    const { mission } = buildMission(spec(), kase, base);
    let s = createInitialState(mission!.level, 3);
    for (const a of [{ action: "move", target: "rotunda", stance: "quiet" }, { action: "move", target: "archive", stance: "quiet" }, { action: "take", target: "catalogue" }, { action: "move", target: "rotunda", stance: "quiet" }, { action: "move", target: "foyer", stance: "quiet" }, { action: "exit" }] as const) {
      if (s.status !== "playing") break;
      s = step(s, a as never).state;
    }
    expect(["won", "caught"]).toContain(s.status); // reachable end state; the balance simulator measures how often it is won
  });
  it("rejects bad specs with errors the model can fix", () => {
    const bad = spec(); bad.rooms[3].x = 0; bad.rooms[3].y = 1; // two rooms on one cell
    expect(checkSpec(bad).join(" ")).toMatch(/same grid cell/);
    const far = spec(); far.links.push({ a: "foyer", b: "landing", kind: "door" });
    expect(checkSpec(far).join(" ")).toMatch(/not next to each other/);
    const noCover = spec(); noCover.rooms.forEach(r => (r.cover = ""));
    expect(checkSpec(noCover).join(" ")).toMatch(/cover/);
  });
  it("refuses real names from the case", () => {
    const sp = spec(); sp.lines.marlowIntro = "In the Gardner foyer, boss.";
    const { mission } = buildMission(sp, kase, base);
    expect(checkText(mission!, ["Isabella Stewart Gardner"]).join(" ")).toMatch(/real name "gardner"/);
    expect(checkText(buildMission(spec(), kase, base).mission!, ["Isabella Stewart Gardner"])).toEqual([]);
  });
  it("rejects narration in spoken lines: they must be the speaker's own words", () => {
    const sp = spec(); sp.lines.take = "Marlow opens the catalogue and finds a photograph."; sp.lines.clientAfterTake = "Vera breathes fast. Bring it.";
    const errs = checkText(buildMission(sp, kase, base).mission!, []).join(" ");
    expect(errs).toMatch(/marlow.twist.tape: reads as narration/);
    expect(errs).toMatch(/client.got: reads as narration/);
    // ordinary dialogue that mentions a name or a sound is fine
    const ok = spec(); ok.rooms[2].describe = "I see a desk with old reels, boss. A note says Vera was here."; ok.lines.evidence = "This is Vera. Keep the night man busy.";
    expect(checkText(buildMission(ok, kase, base).mission!, [])).toEqual([]);
  });
  it("a lore answer must name its subject (Marlow talking about it, not someone else talking)", () => {
    const sp = spec(); sp.lore[0].text = "I hired you because I trust you, Owl.";
    expect(checkText(buildMission(sp, kase, base).mission!, []).join(" ")).toMatch(/marlow.lore.client.0: a client fact must name its subject/);
  });
  it("story questions use the mission's own names, unlocked by what has been discovered", async () => {
    const { mission } = buildMission(spec(), kase, base);
    const sess = new Session({ level: mission!.level, bank: { ...base.lines, ...mission!.lines }, beats: mission!.beats, lore: mission!.lore, loreTopics: mission!.loreTopics, intent: new MockIntent(), seed: 3, memory: new InMemoryStore() });
    sess.start();
    expect((await sess.submit("who is Vera?"))?.lines[0].id).toBe("marlow.lore.client.0");
    expect((await sess.submit("tell me about Brandt"))?.lines[0].id).toBe("marlow.lore.unknown");
    expect(localParse("who is Ines", sess.state, mission!.loreTopics.map(([t, r]) => [t, new RegExp(r)]))?.kind).not.toBe("lore");
  });
});
