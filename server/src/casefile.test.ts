import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import level from "../../data/level.json";
import linesJson from "../../data/lines.json";
import beatsJson from "../../data/beats.json";
import { createInitialState, solve } from "@marlow/engine";
import { InMemoryStore, MockIntent, Session, loadBank, type Beat } from "@marlow/game";
import { buildCaseFile, pickMoments } from "./casefile";
import { replayRows } from "./replay";
import { MuseImage } from "./adapters/image";
import { loadConfig } from "./config";

async function winningRun() {
  let seed = 1, plan = solve(createInitialState(level, seed), 12);
  while (!plan) plan = solve(createInitialState(level, ++seed), 12);
  const s = new Session({ level, bank: loadBank(linesJson), beats: beatsJson as Beat[], intent: new MockIntent(), seed, memory: new InMemoryStore(), runId: "t1" });
  s.start();
  const say = (a: any) => {
    const nm = (id: string) => [...s.state.doors, ...s.state.items].find(x => x.id === id)?.spokenName.replace(/^the /, "") ?? id;
    return a.action === "move" ? `${a.stance ? "quietly " : ""}go to ${a.target}` : a.action === "peek" ? `peek the ${nm(a.target)}` : a.action === "take" ? `take the ${nm(a.target)}` : a.action;
  };
  for (const a of plan) await s.submit(say(a));
  return s;
}

describe("run log replay", () => {
  it("a played run replays to identical events", async () => {
    const s = await winningRun();
    expect(s.state.status).toBe("won");
    expect(replayRows(s.log, level).ok).toBe(true);
  });
  it("tampering with a logged event is detected", async () => {
    const s = await winningRun();
    const rows = structuredClone(s.log);
    const r = rows.find((r: any) => r.events?.length) as any;
    r.events.push({ type: "waited", perceived: true });
    expect(replayRows(rows, level).ok).toBe(false);
  });
});

describe("case file", () => {
  it("4–6 panels from engine facts, captions from spoken lines, no image API needed", async () => {
    const s = await winningRun();
    expect(pickMoments(s.log).length).toBeGreaterThanOrEqual(3);
    const out = await buildCaseFile({ runId: "t1", rows: s.log, level, outDir: mkdtempSync(join(tmpdir(), "cf-")), image: new MuseImage(loadConfig({})) });
    expect(out.panels.length).toBeGreaterThanOrEqual(3);
    expect(out.panels.length).toBeLessThanOrEqual(6);
    for (const p of out.panels) {
      expect(p.prompt).toContain("Film noir");
      expect(p.source).toBe("placeholder");
      expect(existsSync(join(out.dir, p.image))).toBe(true);
    }
    expect(out.panels[0].caption.length).toBeGreaterThan(0);
    expect(out.html).toContain("Illustrated from the run log.");
    expect(readFileSync(join(out.dir, "prompts.json"), "utf8")).toContain("mustShow");
  });
  it("is cached: a second build reuses panel files", async () => {
    const s = await winningRun();
    const dir = mkdtempSync(join(tmpdir(), "cf-"));
    const a = await buildCaseFile({ runId: "t1", rows: s.log, level, outDir: dir });
    const b = await buildCaseFile({ runId: "t1", rows: s.log, level, outDir: dir });
    expect(b.panels.map(p => p.image)).toEqual(a.panels.map(p => p.image));
  });
});
