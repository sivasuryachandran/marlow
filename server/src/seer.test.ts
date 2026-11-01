import { describe, it, expect } from "vitest";
import { SeerRooms, type Sock } from "./seer";

const sock = () => { const got: unknown[] = []; let closed = false; const s: Sock & { got: unknown[]; closed: () => boolean } = { got, send: d => got.push(JSON.parse(d)), close: () => { closed = true; }, closed: () => closed }; return s; };
const state = (turn: number) => JSON.stringify({ type: "state", turn });

describe("Seer link relay", () => {
  it("relays the host's snapshots to every seer, and a late seer gets the latest one at once", () => {
    const r = new SeerRooms(), host = sock(), a = sock();
    expect(r.join("ABCD", "host", host)).toBe(true);
    expect(r.join("ABCD", "seer", a)).toBe(true);
    r.message("ABCD", host, state(1));
    const late = sock(); r.join("ABCD", "seer", late);
    expect(a.got).toContainEqual({ type: "state", turn: 1 });
    expect(late.got).toContainEqual({ type: "state", turn: 1 });
    expect(host.got).toContainEqual({ type: "seers", count: 2 });
  });
  it("a seer cannot publish: it only sees", () => {
    const r = new SeerRooms(), host = sock(), seer = sock(), other = sock();
    r.join("ABCD", "host", host); r.join("ABCD", "seer", seer); r.join("ABCD", "seer", other);
    r.message("ABCD", seer, state(99));
    expect(other.got).not.toContainEqual({ type: "state", turn: 99 });
  });
  it("rejects bad room codes, bad roles, junk and oversized messages", () => {
    const r = new SeerRooms(), host = sock(), seer = sock();
    expect(r.join("abcd", "host", host)).toBe(false);
    expect(r.join("ABCDE", "host", host)).toBe(false);
    expect(r.join("ABCD", "admin", host)).toBe(false);
    r.join("ABCD", "host", host); r.join("ABCD", "seer", seer);
    r.message("ABCD", host, "not json"); r.message("ABCD", host, JSON.stringify({ type: "order", action: "exit" })); r.message("ABCD", host, JSON.stringify({ type: "state", pad: "x".repeat(600 * 1024) }));
    expect(seer.got.filter(m => (m as { type: string }).type === "state")).toEqual([]);
  });
  it("tells the seer when the host leaves, and forgets empty or idle rooms", () => {
    let t = 0; const r = new SeerRooms(() => t), host = sock(), seer = sock();
    r.join("ABCD", "host", host); r.join("ABCD", "seer", seer);
    r.leave("ABCD", host);
    expect(seer.got).toContainEqual({ type: "host", connected: false });
    r.leave("ABCD", seer);
    expect(r.size()).toBe(0);
    r.join("WXYZ", "seer", sock()); t = 3 * 60 * 60 * 1000; r.sweep();
    expect(r.size()).toBe(0);
  });
  it("caps seers per room, and a new host replaces the old one", () => {
    const r = new SeerRooms(), h1 = sock(), h2 = sock();
    r.join("ABCD", "host", h1);
    for (let i = 0; i < 4; i++) expect(r.join("ABCD", "seer", sock())).toBe(true);
    expect(r.join("ABCD", "seer", sock())).toBe(false);
    r.join("ABCD", "host", h2);
    expect(h1.closed()).toBe(true);
  });
});
