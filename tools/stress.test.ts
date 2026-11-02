import { describe, it, expect } from "vitest";
import { engineFuzz, generatorFuzz, parserFuzz, pipelineFuzz, relayLoad } from "./stress-lib";

// A small version of tools/stress.ts, so a regression in any promise the game makes fails the normal test run.
describe("stress (small scale)", () => {
  it("engine: random and junk actions never break an invariant", async () => { const r = await engineFuzz(0.25); expect(r.findings, JSON.stringify(r.findings.slice(0, 3))).toEqual([]); }, 90000);
  it("pipeline: a hostile model and hostile text never break the session", async () => { const r = await pipelineFuzz(0.5); expect(r.findings, JSON.stringify(r.findings.slice(0, 3))).toEqual([]); }, 90000);
  it("parser: awkward text is never slow or crashing", async () => { const r = await parserFuzz(1); expect(r.findings, JSON.stringify(r.findings.slice(0, 3))).toEqual([]); }, 90000);
  it("generator: broken specs never crash it, accepted missions are winnable", async () => { const r = await generatorFuzz(0.25); expect(r.findings, JSON.stringify(r.findings.slice(0, 3))).toEqual([]); }, 90000);
  it("relay: abuse never takes it down or leaks rooms", async () => { const r = await relayLoad(1); expect(r.findings, JSON.stringify(r.findings.slice(0, 3))).toEqual([]); }, 90000);
});
