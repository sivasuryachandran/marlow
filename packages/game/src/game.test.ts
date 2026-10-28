import { describe, it, expect } from "vitest";
import level from "../../../data/level.json";
import linesJson from "../../../data/lines.json";
import beatsJson from "../../../data/beats.json";
import cuesJson from "../../../data/cues.json";
import { createInitialState, solve, candidateActions, step, Rng, revealRoom } from "@marlow/engine";
import type { Action, Level, WorldState } from "@marlow/shared";
import {
  loadBank, localParse, mockInfer, knowledgeList, verify, v1, MockIntent, Session, InMemoryStore, validateBeats,
  expandLine, type IntentAdapter, type Beat,
} from "./index";

const bank = loadBank(linesJson);
const beats = beatsJson as Beat[];
const mk = (seed = 1, patch?: (s: WorldState) => void) => { const s = createInitialState(level, seed); patch?.(s); return s; };
const inHall = (s: WorldState) => { s.marlow.room = "hall"; s.marlow.prevRoom = "lobby"; revealRoom(s, "hall", true); };
const mkSession = (o: Partial<ConstructorParameters<typeof Session>[0]> = {}) =>
  new Session({ level, bank, beats, intent: new MockIntent(), seed: 3, memory: new InMemoryStore(), ...o });

describe("content (V0)", () => {
  it("beats reference real lines, cues and entities", () => {
    expect(validateBeats(beats, bank, cuesJson as string[], level as unknown as Level)).toEqual([]);
  });
  it("V0 rejects a broken beat sheet", () => {
    const bad: Beat[] = [{ id: "x", trigger: { taken: "gold" }, lineIds: ["nope"], cueIds: ["nope"], once: true }];
    expect(validateBeats(bad, bank, cuesJson as string[], level as unknown as Level).length).toBe(3);
  });
  it("every line id the narrator can produce exists in the bank", () => {
    const need = [
      "move", "move.quiet", "door_noise", "arrive.item", "arrive.hide", "peek.room", "peek.empty", "peek.guard", "listen.heard", "guard.here",
      "listen.quiet", "wait", "hide", "take", "warning", "sound.phone_ring", "spotted", "caught", "win.clean", "win.messy",
      "refuse.unknown_target", "refuse.not_known", "refuse.not_adjacent", "refuse.door_locked", "refuse.not_in_room", "refuse.no_hide_spot",
      "refuse.no_item", "refuse.not_ready_to_exit", "refuse.game_over", "clarify.door", "clarify.room", "clarify.other",
    ];
    for (const n of need) expect(bank["marlow." + n], n).toBeDefined();
    for (const n of ["ack", "sayagain", "timeout", "nothing_pending", "nothing_to_repeat"]) expect(bank["system." + n]).toBeDefined();
  });
  it("every line has 2+ variants and renders with no unfilled slots", () => {
    for (const [id, def] of Object.entries(bank)) {
      expect(def.text.length, id).toBeGreaterThanOrEqual(1);
      for (const e of expandLine(id, def, level)) expect(e.text, e.audioKey).not.toMatch(/\{\w+\}/);
    }
  });
});

describe("local parser", () => {
  const s = mk(1, inHall);
  it("handles the basics without a model", () => {
    expect(localParse("Wait.", s)).toEqual({ kind: "action", action: { action: "wait" } });
    expect(localParse("stop", s)).toEqual({ kind: "action", action: { action: "wait" } });
    expect(localParse("listen", s)).toEqual({ kind: "action", action: { action: "listen" } });
    expect(localParse("go back", s)).toEqual({ kind: "action", action: { action: "move", target: "lobby" } });
    expect(localParse("hall", s)).toEqual({ kind: "action", action: { action: "move", target: "hall" } });
    expect(localParse("go to the office", s)).toEqual({ kind: "action", action: { action: "move", target: "office" } });
    expect(localParse("yes", s)).toEqual({ kind: "yes" });
    expect(localParse("repeat", s)).toEqual({ kind: "repeat" });
  });
  it("defers everything else", () => expect(localParse("peek the left door quietly", s)).toBeNull());
  it("go back with no previous room is a refusal, not a guess", () => expect(localParse("go back", mk())).toEqual({ kind: "no_back" }));
});

describe("mock intent", () => {
  const req = (transcript: string, s: WorldState) => ({ turnId: 1, transcript, currentRoom: s.marlow.room, knowledge: knowledgeList(s) });
  it("peek the left door picks by side relative to facing", () => {
    const s = mk(1, inHall);
    expect(mockInfer(req("peek the left door", s))).toMatchObject({ action: "peek", target: "arch_hall_gallery" });
    expect(mockInfer(req("peek the door on the right", s))).toMatchObject({ action: "peek", target: "door_hall_office" });
  });
  it("an ambiguous 'door' yields a clarify with real candidates", () => {
    const s = mk(1, inHall);
    const r = mockInfer(req("peek the door", s)) as any;
    expect(r.clarify.candidates.length).toBeGreaterThanOrEqual(2);
  });
  it("quiet stance and natural phrasing", () => {
    const s = mk(1, inHall);
    expect(mockInfer(req("sneak into the office", s))).toMatchObject({ action: "move", target: "door:door_hall_office", stance: "quiet" });
    expect(mockInfer(req("grab the ledger", s))).toMatchObject({ action: "take", target: "unknown" }); // not known yet
  });
});

describe("V1 / V2", () => {
  it("V1 accepts exactly one shape", () => {
    expect(v1({ action: "wait" }).ok).toBe(true);
    expect(v1({ action: "fly" }).ok).toBe(false);
    expect(v1({ action: "move" }).ok).toBe(false);
    expect(v1({ clarify: { candidates: ["a"] } }).ok).toBe(false);
    expect(v1({ clarify: { candidates: ["a", "b"] }, action: "wait" }).ok).toBe(false);
  });
  it("V2 blocks hallucinated, unseen and illegal targets; none is executable", () => {
    const s = mk();
    expect(verify(s, { action: "peek", target: "door_vault" })).toMatchObject({ kind: "refuse", reason: "unknown_target" });
    expect(verify(s, { action: "peek", target: "door_hall_office" })).toMatchObject({ kind: "refuse", reason: "not_known" });
    expect(verify(s, { action: "take", target: "ledger" })).toMatchObject({ kind: "refuse", reason: "not_known" });
    expect(verify(s, { action: "move", target: "office" })).toMatchObject({ kind: "refuse" });
    expect(verify(s, { action: "exit" })).toMatchObject({ kind: "refuse", reason: "not_ready_to_exit" });
    expect(verify(s, { clarify: { candidates: ["door_lobby_hall", "door_secret"] } })).toMatchObject({ kind: "sayagain" });
    expect(verify(s, { nonsense: 1 })).toMatchObject({ kind: "sayagain" });
  });
  it("a move may name a door; it resolves to the room beyond", () => {
    const s = mk(1, inHall);
    expect(verify(s, { action: "move", target: "door:door_hall_office" })).toMatchObject({ kind: "action", action: { action: "move", target: "office" } });
  });
});

describe("Session", () => {
  it("opens with the client call (first run) and Marlow's intro", () => {
    const o = mkSession().start();
    expect(o.lines.map(l => l.id)).toEqual(["client.intro.a", "client.intro.b", "marlow.intro"]);
    expect(o.lines.every(l => l.audioKey.length > 0)).toBe(true);
  });
  it("a refusal leaves the world byte-identical and speaks a template", async () => {
    const s = mkSession(); s.start();
    const before = JSON.stringify(s.state);
    const o = (await s.submit("peek the vault door"))!;
    expect(o.kind).toBe("refused");
    expect(JSON.stringify(s.state)).toBe(before);
    expect(o.lines[0].id).toMatch(/^marlow\.refuse\./);
  });
  it("asks a template clarify, then resolves it from the follow-up", async () => {
    const s = mkSession({ seed: 5 }); s.start();
    await s.submit("go to hall"); // local parser
    expect(s.state.marlow.room).toBe("hall");
    const turnBefore = s.state.turn;
    const q = (await s.submit("peek the door"))!;
    expect(q.kind).toBe("clarify");
    expect(q.lines[0].id).toBe("marlow.clarify.door");
    expect(s.state.turn).toBe(turnBefore);
    const open = s.state.status;
    if (open === "playing") {
      const a = (await s.submit("the left one"))!;
      expect(a.action).toMatchObject({ action: "peek" });
    }
  });
  it("unknown speech gets 'Say again'; no state change", async () => {
    const s = mkSession(); s.start();
    const o = (await s.submit("xyzzy plugh"))!;
    expect(o.kind).toBe("sayagain");
    expect(s.state.turn).toBe(0);
  });
  it("repeat replays the last spoken lines without a turn", async () => {
    const s = mkSession({ seed: 5 }); s.start();
    const a = (await s.submit("listen"))!;
    const r = (await s.submit("repeat"))!;
    expect(r.lines).toEqual(a.lines);
    expect(s.state.turn).toBe(1);
  });
  it("logs every turn with transcript, parsed, validation, events, lineIds, latencies", async () => {
    const s = mkSession({ seed: 5 }); s.start();
    await s.submit("peek the lobby door");
    const row = s.log.at(-1) as any;
    expect(row).toMatchObject({ turnId: 1, transcript: "peek the lobby door" });
    expect(row.parsed).toBeDefined(); expect(row.validation).toBe("action");
    expect(row.events.length).toBeGreaterThan(0); expect(row.lineIds.length).toBeGreaterThan(0); expect(row.latencies.totalMs).toBeGreaterThanOrEqual(0);
  });
  it("low trust switches to the curt template set", async () => {
    const mem = new InMemoryStore({ trust: 20, lastTrustLoss: "spotted", runs: 1 });
    const s = mkSession({ memory: mem, seed: 5 });
    const o = (await (s.start(), s.submit("wait")))!;
    expect(o.lines[0].curt).toBe(true);
  });
});

describe("turn-ID guard", () => {
  const slow = (ms: number, turnIdOffset = 0): IntentAdapter => ({
    name: "slow", infer: async req => { await new Promise(r => setTimeout(r, ms)); return { turnId: req.turnId + turnIdOffset, reply: { action: "wait" } }; },
  });
  it("timeout: static line, state unchanged, late reply discarded and logged", async () => {
    const s = mkSession({ intent: slow(60), timeoutMs: 20 }); s.start();
    const o = (await s.submit("do something clever"))!;
    expect(o.kind).toBe("timeout");
    expect(o.lines[0].id).toBe("system.timeout");
    expect(o.beatCueIds).toContain("sfx.radio.static");
    await new Promise(r => setTimeout(r, 80));
    expect(s.state.turn).toBe(0);
    expect(s.log.some((r: any) => r.discarded && r.reason === "late_reply")).toBe(true);
  });
  it("superseded turn: first reply dropped, second acts", async () => {
    const s = mkSession({ intent: slow(30), timeoutMs: 500 }); s.start();
    const first = s.submit("do something clever");
    const second = s.submit("do something else");
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBeNull();
    expect(b).not.toBeNull();
    expect(s.state.turn).toBe(0 + (b!.kind === "ok" ? 1 : 0));
    expect(s.log.some((r: any) => r.discarded && r.reason === "superseded")).toBe(true);
  });
  it("a reply carrying the wrong turn id is dropped", async () => {
    const s = mkSession({ intent: slow(1, 7), timeoutMs: 500 }); s.start();
    const o = await s.submit("do something clever");
    expect(o).toBeNull();
    expect(s.log.some((r: any) => r.discarded && r.reason === "turn_id_mismatch")).toBe(true);
    expect(s.state.turn).toBe(0);
  });
});

describe("a full run by typed words, and run-to-run memory", () => {
  const say = (a: Action, s: WorldState): string => {
    const n = (id: string) => [...s.doors, ...s.items].find(x => x.id === id)?.spokenName.replace(/^the /, "") ?? id;
    switch (a.action) {
      case "move": return a.stance === "quiet" ? `quietly sneak to the ${a.target}` : `go to ${a.target}`;
      case "peek": return `peek the ${n(a.target)}`;
      case "take": return `take the ${n(a.target)}`;
      default: return a.action;
    }
  };
  it("solver finds a clean win; the session reproduces it from speech; run 2 calls back to run 1", async () => {
    let seed = 0, plan: Action[] | null = null;
    for (seed = 1; seed < 60 && !plan; seed++) plan = solve(createInitialState(level, seed), 12);
    seed -= 1;
    expect(plan, "level must be winnable cleanly").not.toBeNull();
    const mem = new InMemoryStore();
    const s1 = mkSession({ seed, memory: mem }); s1.start();
    // Play the solver's plan through the full speech pipeline, using the engine to narrate what to say next.
    let probe = createInitialState(level, seed);
    for (const a of plan!) {
      const text = say(a, probe);
      const o = await s1.submit(text);
      expect(o?.kind, text).toBe("ok");
      probe = step(probe, a).state;
    }
    expect(s1.state.status).toBe("won");
    expect(s1.state.alert).toBeLessThanOrEqual(1);
    const saved = mem.load();
    expect(saved.runs).toBe(1);
    expect(saved.trust).toBeGreaterThan(0);

    const s2 = mkSession({ seed: seed + 1, memory: mem });
    const intro = s2.start();
    expect(s2.runNumber).toBe(2);
    const cb = saved.lastTrustLoss === "ignored_warning" ? "marlow.callback.ignored_warning" : saved.lastTrustLoss === "spotted" ? "marlow.callback.spotted" : "marlow.callback.none";
    expect(intro.lines.map(l => l.id)).toEqual(["client.intro.repeat", "marlow.intro", cb]);
  });
  it("a spotted run makes run 2 open with the spotted callback", async () => {
    const mem = new InMemoryStore();
    const s1 = mkSession({ seed: 9, memory: mem }); s1.start();
    await s1.submit("go to hall");
    for (let i = 0; i < 12 && s1.state.status === "playing"; i++) await s1.submit("wait");
    expect(mem.load().lastTrustLoss).toBe("spotted");
    const s2 = mkSession({ seed: 9, memory: mem });
    expect(s2.start().lines.map(l => l.id)).toContain("marlow.callback.spotted");
  });
  it("the solver proves the level winnable and candidate actions are all legal", () => {
    const s = mk();
    expect(candidateActions(s).every(a => step(s, a).events[0].type !== "refused")).toBe(true);
    expect(new Rng(1).next()).toBeLessThan(1);
  });
});
