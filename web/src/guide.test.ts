import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { expandLine, loadBank } from "@marlow/game";
import { BRIEF_SEQUENCE, BY_ID, CHIPS, TABS, TOGGLES, pickKind, pttState, staticLineIds } from "./guide-map";

const bank = loadBank(JSON.parse(readFileSync("data/lines.json", "utf8")));
const level = JSON.parse(readFileSync("data/level.json", "utf8"));
const html = readFileSync("web/index.html", "utf8");

describe("audio guide coverage", () => {
  it("every control the page has maps to a guide line", () => {
    // every button, input and select with an id in index.html
    const ids = [...html.matchAll(/<(?:button|input|select)\b[^>]*\bid="(\w+)"/g)].map(m => m[1]);
    const covered = new Set([...Object.keys(BY_ID), ...Object.keys(TOGGLES), "ptt"]);
    const tabIds = new Set(TABS.map(t => `t-${t}`));
    const missing = ids.filter(i => !covered.has(i) && !tabIds.has(i));
    expect(missing).toEqual([]);
  });
  it("every tab and playbook chip in the page has a line", () => {
    for (const t of TABS) expect(html).toContain(`data-tab="${t}"`);
    for (const c of CHIPS) expect(html).toContain(`data-act="${c}"`);
  });
  it("every line the guide can ask for exists in the bank, spoken by the guide", () => {
    for (const id of [...staticLineIds(), ...BRIEF_SEQUENCE, "guide.letter", "guide.pick.door", "guide.pick.room", "guide.pick.item", "guide.pick.prop", "guide.choice.go", "guide.choice.peek", "guide.choice.take"]) {
      expect(bank[id], id).toBeTruthy();
      expect(bank[id].speaker).toBe("guide");
    }
  });
  it("every spoken guide file (all slot combinations) has an mp3", () => {
    const missing: string[] = [];
    for (const [id, def] of Object.entries(bank)) if (id.startsWith("guide.")) for (const x of expandLine(id, def, level)) if (!existsSync(`assets/audio/lines/${x.audioKey}.mp3`)) missing.push(x.audioKey);
    expect(missing).toEqual([]);
  });
  it("the room code can be spoken: all 26 letters are rendered", () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") expect(existsSync(`assets/audio/lines/guide.letter.v0.letter=${ch}.mp3`), ch).toBe(true);
  });
  it("no guide line is longer than 480 characters (about 30 seconds)", () => {
    for (const [id, def] of Object.entries(bank)) if (id.startsWith("guide.")) for (const t of def.text) expect(t.length, id).toBeLessThan(480);
  });
  it("push-to-talk state is read from its label", () => {
    expect(pttState("HOLD SPACE TO TRANSMIT")).toBe("hold");
    expect(pttState("LISTENING · TAP TO MUTE")).toBe("live");
    expect(pttState("MUTED · TAP TO LISTEN")).toBe("muted");
    expect(pttState("VOICE INPUT UNAVAILABLE · TYPE BELOW")).toBe("unavailable");
  });
  it("a clarify button finds its kind of name in the level", () => {
    expect(pickKind("The Lobby", level)?.kind).toBe("room");
    expect(pickKind("nonsense", level)).toBeNull();
  });
});
