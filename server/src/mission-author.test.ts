import { describe, it, expect } from "vitest";
import linesJson from "../../data/lines.json";
import beatsJson from "../../data/beats.json";
import { buildMission, loadBank, type Beat } from "@marlow/game";
import { fixtureSpec } from "../../packages/game/src/mission.fixture";
import { research, TARGETS, tuneGuard } from "./mission-author";

const base = { lines: loadBank(linesJson), beats: beatsJson as Beat[] };

describe("mission author: code-side balance and research", () => {
  it("tunes the guard's schedule by simulation until a careful player can win and a reckless one cannot win cleanly", () => {
    const { mission } = buildMission(fixtureSpec(), { id: "t", inspiredBy: "test", sources: [] }, base);
    const t = tuneGuard(mission!.level, 120);
    console.log(`tuned: ${t.note}; careful wins ${t.cautiousWin}%, rushing clean ${t.recklessClean}%`);
    expect(t.ok).toBe(true);
    expect(t.cautiousWin).toBeGreaterThanOrEqual(TARGETS.cautiousWin);
    expect(t.recklessClean).toBeLessThanOrEqual(TARGETS.recklessClean);
  });
  it("research reads a Wikipedia summary, and falls back to search for a loose theme (network mocked)", async () => {
    const fake = (async (u: string) => ({ ok: true, json: async () => (String(u).includes("api.php") ? { query: { search: [{ title: "Real Case" }] } } : String(u).includes("Real%20Case") ? { title: "Real Case", extract: "Facts.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Real_Case" } } } : {}) })) as unknown as typeof fetch;
    expect(await research("some loose theme", fake)).toEqual({ title: "Real Case", extract: "Facts.", url: "https://en.wikipedia.org/wiki/Real_Case" });
  });
});
