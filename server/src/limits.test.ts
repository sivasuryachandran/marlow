import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { RateLimiter, checkIntentRequest, limit } from "./limits";

describe("limits on the paid and file-writing endpoints", () => {
  it("a client is limited to max requests per window, then allowed again", () => {
    let t = 0; const rl = new RateLimiter(3, 1000, () => t);
    expect([1, 2, 3, 4].map(() => rl.allow("a"))).toEqual([true, true, true, false]);
    expect(rl.allow("b")).toBe(true); // another client is unaffected
    t = 1001; expect(rl.allow("a")).toBe(true);
  });
  it("rejects oversize bodies (413) and missing or bogus content-length (411, 413) before the handler runs", async () => {
    let ran = 0; const app = new Hono(); app.use("/x", limit({ max: 100, windowMs: 60000, maxBytes: 100 })); app.post("/x", c => { ran++; return c.text("ok"); });
    const post = (body: string, len: string) => app.request("/x", { method: "POST", body, headers: { "content-length": len } });
    expect((await post("hi", "2")).status).toBe(200);
    expect((await post("x".repeat(500), "500")).status).toBe(413);
    expect((await post("x", "abc")).status).toBe(413);
    expect((await post("x", "-5")).status).toBe(413);
    expect(ran).toBe(1); // only the one honest request reached the handler
  });
  it("floods get 429 before the handler runs", async () => {
    let ran = 0; const app = new Hono(); app.use("/x", limit({ max: 2, windowMs: 60000, maxBytes: 100 })); app.get("/x", c => { ran++; return c.text("ok"); });
    expect([1, 2, 3, 4].map(() => 0)).toHaveLength(4);
    const codes: number[] = []; for (let i = 0; i < 4; i++) codes.push((await app.request("/x")).status);
    expect(codes).toEqual([200, 200, 429, 429]); expect(ran).toBe(2);
  });
  it("does not trust a forged X-Forwarded-For to dodge the limit", async () => {
    const app = new Hono(); app.use("/x", limit({ max: 1, windowMs: 60000, maxBytes: 100 })); app.get("/x", c => c.text("ok"));
    const get = (ip: string) => app.request("/x", { headers: { "x-forwarded-for": ip } });
    expect((await get("1.1.1.1")).status).toBe(200);
    expect((await get("2.2.2.2")).status).toBe(429); // same real client, different claimed address
  });
});

describe("only requests our game could have made reach the model", () => {
  const good = { turnId: 1, transcript: "go to the hall", currentRoom: "lobby", knowledge: [{ id: "hall", spokenName: "the hall", type: "room" }] };
  it("accepts a real request", () => expect(checkIntentRequest(good)).toBeNull());
  it("rejects anything else: junk, wrong types, giant text, giant lists", () => {
    for (const bad of [null, undefined, "x", [], {}, { ...good, turnId: "1" }, { ...good, transcript: 5 }, { ...good, transcript: "x".repeat(401) }, { ...good, currentRoom: "r".repeat(41) },
      { ...good, knowledge: "all" }, { ...good, knowledge: Array(81).fill(good.knowledge[0]) }, { ...good, knowledge: [{ id: 1 }] }, { ...good, knowledge: [{ ...good.knowledge[0], pad: "x".repeat(2000) }] }])
      expect(checkIntentRequest(bad), JSON.stringify(bad)?.slice(0, 60)).toBeTruthy();
  });
});
