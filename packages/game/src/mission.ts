/**
 * Mission generator, the deterministic half. Muse Spark writes a short MissionSpec (rooms on a grid, which rooms
 * connect, the guard's patrol, the story lines). This module turns it into a playable mission (level, line overlay,
 * beats, lore) and checks it. The model never writes level JSON: door walls are computed from grid positions, the
 * patrol is repaired to follow real doorways, and nothing reaches a player unless every check here passes (plus the
 * balance simulator, run by the caller). Same rule as the rest of MARLOW: the AI proposes, the code verifies.
 */
import { Level, type WorldState } from "@marlow/shared";
import { path, validateLevel } from "@marlow/engine";
import { validateBeats, type Beat } from "./director";
import type { LineBank, LineDef } from "./lines";

export type Floor = "marble" | "carpet" | "metal";
export interface SpecRoom { id: string; name: string; aliases: string[]; floor: Floor; x: number; y: number; cover: string; describe: string }
export interface MissionSpec {
  title: string; tagline: string;
  clientName: string; guardName: string; ownerName: string; guardSound: string;
  rooms: SpecRoom[];
  links: { a: string; b: string; kind: "door" | "arch" | "stairs" }[];
  item: { id: string; name: string; aliases: string[]; room: string };
  guardPost: { name: string; attachTo: string };
  patrol: string[];
  lines: {
    clientIntro: string[]; marlowIntro: string; guardFirstHeard: string; take: string; clientAfterTake: string; clientCheckin: string;
    outro: string; evidence: string; evidenceAsk: string; burn: string; send: string; clientAfterBurn: string; clientAfterSend: string;
  };
  lore: { topic: "client" | "guard" | "owner" | "item" | "history"; when: "start" | "guard" | "item" | "end"; text: string }[];
}
export interface MissionCase { id: string; title: string; inspiredBy: string; year: number; facts: string[]; realNames: string[]; sources: string[]; wiki?: string }
export interface Mission {
  id: string; title: string; tagline: string; inspiredBy: string; sources: string[];
  level: unknown; lines: LineBank; beats: Beat[]; lore: Record<string, [string, string][]>; loreTopics: [string, string][]; clientFirstName?: string;
}

const str = { type: "string" } as const;
const strs = { type: "array", items: str } as const;
const ID = { type: "string", pattern: "^[a-z][a-z_]{1,20}$" } as const;
/** JSON schema for Spark's strict structured output. */
export const MISSION_SPEC_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "tagline", "clientName", "guardName", "ownerName", "guardSound", "rooms", "links", "item", "guardPost", "patrol", "lines", "lore"],
  properties: {
    title: str, tagline: str, clientName: str, guardName: str, ownerName: str, guardSound: str,
    rooms: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name", "aliases", "floor", "x", "y", "cover", "describe"],
      properties: { id: ID, name: str, aliases: strs, floor: { type: "string", enum: ["marble", "carpet", "metal"] }, x: { type: "integer" }, y: { type: "integer" }, cover: str, describe: str } } },
    links: { type: "array", items: { type: "object", additionalProperties: false, required: ["a", "b", "kind"], properties: { a: ID, b: ID, kind: { type: "string", enum: ["door", "arch", "stairs"] } } } },
    item: { type: "object", additionalProperties: false, required: ["id", "name", "aliases", "room"], properties: { id: ID, name: str, aliases: strs, room: ID } },
    guardPost: { type: "object", additionalProperties: false, required: ["name", "attachTo"], properties: { name: str, attachTo: ID } },
    patrol: { type: "array", items: ID },
    lines: { type: "object", additionalProperties: false,
      required: ["clientIntro", "marlowIntro", "guardFirstHeard", "take", "clientAfterTake", "clientCheckin", "outro", "evidence", "evidenceAsk", "burn", "send", "clientAfterBurn", "clientAfterSend"],
      properties: { clientIntro: strs, marlowIntro: str, guardFirstHeard: str, take: str, clientAfterTake: str, clientCheckin: str, outro: str, evidence: str, evidenceAsk: str, burn: str, send: str, clientAfterBurn: str, clientAfterSend: str } },
    lore: { type: "array", items: { type: "object", additionalProperties: false, required: ["topic", "when", "text"],
      properties: { topic: { type: "string", enum: ["client", "guard", "owner", "item", "history"] }, when: { type: "string", enum: ["start", "guard", "item", "end"] }, text: str } } },
  },
} as const;

const the = (n: string) => (/^(the|an?) /i.test(n) ? n : `the ${n}`).toLowerCase();
const bare = (n: string) => n.replace(/^(the|an?) /i, "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "x";
const words = (s: string): string[] => s.toLowerCase().match(/[a-z']+/g) ?? [];

/** Silent alarm length: about three times the shortest way out (moves plus the exit order), so quiet decisive play wins and hiding forever does not. */
export const alarmTurnsFor = (probe: WorldState, itemRoom: string, exit: string) => ((path(probe, itemRoom, exit)?.length ?? 3) - 1 + 1) * 3 + 1;

/** Structural checks on the spec itself, before building. */
export function checkSpec(spec: MissionSpec): string[] {
  const e: string[] = [], ids = new Set<string>(), cells = new Set<string>();
  if (spec.rooms.length < 4 || spec.rooms.length > 6) e.push(`need 4 to 6 rooms, got ${spec.rooms.length}`);
  for (const r of spec.rooms) {
    if (ids.has(r.id)) e.push(`duplicate room id ${r.id}`); ids.add(r.id);
    const c = `${r.x},${r.y}`; if (cells.has(c)) e.push(`two rooms on the same grid cell ${c}`); cells.add(c);
    if (Math.abs(r.x) > 2 || r.y < 0 || r.y > 3) e.push(`room ${r.id} is off the grid (x must be -2..2, y 0..3)`);
  }
  const start = spec.rooms[0];
  if (start && start.y !== 0) e.push(`the first room is the entrance and exit; it must be at y=0`);
  for (const l of spec.links) {
    const a = spec.rooms.find(r => r.id === l.a), b = spec.rooms.find(r => r.id === l.b);
    if (!a || !b) { e.push(`link ${l.a}-${l.b} names an unknown room`); continue; }
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) e.push(`link ${l.a}-${l.b}: rooms are not next to each other on the grid`);
  }
  if (!ids.has(spec.item.room)) e.push(`the item is in unknown room ${spec.item.room}`);
  if (start && spec.item.room === start.id) e.push(`the item must not be in the entrance room`);
  if (!ids.has(spec.guardPost.attachTo)) e.push(`guard post attaches to unknown room ${spec.guardPost.attachTo}`);
  for (const p of spec.patrol) if (!ids.has(p)) e.push(`patrol names unknown room ${p}`);
  if (spec.patrol.length < 2) e.push(`the patrol needs at least 2 rooms`);
  if (!spec.rooms.some(r => r.cover.trim())) e.push(`at least one room needs cover to hide behind`);
  const deg = (id: string) => spec.links.filter(l => l.a === id || l.b === id).length;
  if (!spec.rooms.some(r => deg(r.id) >= 3)) e.push(`the building is a single corridor, so Marlow can never step aside while the guard passes: give one room three or more doorways (a hub, like a hall with side rooms off it)`);
  if (spec.lines.clientIntro.length < 2) e.push(`clientIntro needs 2 or 3 lines`);
  return e;
}

/** Build the playable mission from a spec. Returns errors instead of throwing, so they can go back to the model. */
export function buildMission(spec: MissionSpec, kase: Pick<MissionCase, "id" | "inspiredBy" | "sources">, base: { lines: LineBank; beats: Beat[] }): { mission?: Mission; errors: string[] } {
  const errors = checkSpec(spec);
  if (errors.length) return { errors };
  const rooms = spec.rooms.map(r => ({ ...r, id: slug(r.id) }));
  const start = rooms[0];
  const cell = (x: number, y: number) => rooms.find(r => r.x === x && r.y === y);
  // the guard's post: an off-stage room on a free cell next to the room it attaches to (north first)
  const at = rooms.find(r => r.id === slug(spec.guardPost.attachTo))!;
  const free = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => [at.x + dx, at.y + dy]).find(([x, y]) => !cell(x, y) && y >= 0);
  if (!free) return { errors: [`no free grid cell next to ${at.id} for the guard's post`] };
  const post = { id: "post", name: the(spec.guardPost.name), x: free[0], y: free[1] };
  const sideOf = (a: { x: number; y: number }, b: { x: number; y: number }) => (b.y > a.y ? "ahead" : b.y < a.y ? "behind" : b.x > a.x ? "right" : "left");
  const degree = (id: string) => spec.links.filter(l => slug(l.a) === id || slug(l.b) === id).length;
  const doors = spec.links.map(l => {
    const a = rooms.find(r => r.id === slug(l.a))!, b = rooms.find(r => r.id === slug(l.b))!;
    const named = degree(a.id) < degree(b.id) ? a : b;
    return {
      id: `${l.kind}_${a.id}_${b.id}`, kind: l.kind, between: [a.id, b.id], side: { [a.id]: sideOf(a, b), [b.id]: sideOf(b, a) },
      state: l.kind === "door" ? "closed" : "open",
      spokenName: (l.kind === "stairs" ? `the ${bare(named.name)} stairs` : `the ${bare(named.name)} ${l.kind}`).toLowerCase(),
      aliases: named.aliases.map(x => `${bare(x)} ${l.kind}`),
    };
  });
  doors.push({ id: "stairs_post", kind: "stairs", between: [at.id, post.id], side: { [at.id]: sideOf(at, post), [post.id]: sideOf(post, at) }, state: "open", spokenName: "the back stairs", aliases: [] });
  // cover goes against a wall with no doorway, so it never blocks the way through
  const props = rooms.filter(r => r.cover.trim()).map(r => {
    const used = new Set(doors.filter(d => d.between.includes(r.id)).map(d => d.side[r.id]));
    const side = (["left", "right", "ahead", "behind"] as const).find(s => !used.has(s)) ?? "left";
    return { id: `${r.id}_cover`, room: r.id, side, tags: ["hide"], spokenName: `the ${bare(r.cover)}`.toLowerCase(), aliases: [bare(r.cover).split(" ").pop()!.toLowerCase()] };
  });
  const levelRooms = [
    ...rooms.map(r => ({ id: r.id, pos: [r.x, r.y], spokenName: the(r.name), aliases: r.aliases.map(a => bare(a).toLowerCase()), reverb: r.floor === "carpet" ? "dry" : r.floor, footsteps: r.floor })),
    { id: post.id, pos: [post.x, post.y], spokenName: post.name, aliases: [], reverb: "metal", footsteps: "metal", offstage: true },
  ];
  // patrol: three turns at his post, then through the named rooms by real doorways, then back up
  const probe = { rooms: levelRooms, doors } as unknown as WorldState;
  const route: string[] = [post.id, post.id, post.id];
  let cur = post.id;
  for (const target of [...spec.patrol.map(slug), post.id]) {
    const p = path(probe, cur, target);
    if (!p) return { errors: [`the guard cannot walk from ${cur} to ${target}`] };
    route.push(...p.slice(1)); cur = target;
  }
  if (route[route.length - 1] === post.id) route.pop(); // the loop closes back at the post
  const itemId = slug(spec.item.id), itemRoom = slug(spec.item.room);
  const level = {
    rooms: levelRooms, doors, props,
    items: [{ id: itemId, room: itemRoom, spokenName: the(spec.item.name), aliases: spec.item.aliases.map(a => bare(a).toLowerCase()) }],
    guard: { id: "g1", route: route.slice(0, 30), step: 0, startWindow: 1 },
    start: { room: start.id, facing: "north" }, objective: { item: itemId, exitRoom: start.id, alarmTurns: alarmTurnsFor(probe, itemRoom, start.id) }, scheduled: [],
  };
  const parsed = Level.safeParse(level);
  if (!parsed.success) return { errors: [`level does not parse: ${parsed.error.issues.slice(0, 3).map(i => i.path.join(".") + " " + i.message).join("; ")}`] };
  const levelErrs = validateLevel(parsed.data);
  if (levelErrs.length) return { errors: levelErrs };

  // lines: the mission's own story text, under the standard ids the game already knows how to use
  const L = spec.lines, item = the(spec.item.name), itemRoomName = the(rooms.find(r => r.id === itemRoom)!.name);
  const m = (speaker: LineDef["speaker"], ...text: string[]): LineDef => ({ speaker, text: text.filter(Boolean) });
  const lines: LineBank = {
    "client.intro.a": m("client", L.clientIntro[0]), "client.intro.b": m("client", L.clientIntro[1]), "client.intro.c": m("client", L.clientIntro[2] ?? L.clientIntro[1]),
    "client.intro.repeat": m("client", `Same building. Same job. Bring me ${item}, Owl.`),
    "marlow.intro": m("marlow", L.marlowIntro), "marlow.story.limp": m("marlow", L.guardFirstHeard),
    "marlow.twist.tape": m("marlow", L.take), "client.got": m("client", L.clientAfterTake), "client.checkin": m("client", L.clientCheckin),
    "marlow.outro.win": m("marlow", L.outro), "client.tape": m("client", L.evidence), "marlow.epilogue.ask": m("marlow", L.evidenceAsk),
    "marlow.epilogue.burn": m("marlow", L.burn), "marlow.epilogue.send": m("marlow", L.send),
    "client.after.burn": m("client", L.clientAfterBurn), "client.after.send": m("client", L.clientAfterSend),
    "marlow.nudge.office": m("marlow", `${cap(item)} is in ${itemRoomName}, boss. Want me to head there?`),
    "marlow.nudge.take": m("marlow", `It's right here, boss. Want me to take ${item}?`),
    "marlow.nudge.exit": m("marlow", `We have it. Back to ${the(start.name)} and out, boss.`),
  };
  for (const r of rooms.slice(1)) lines[`marlow.story.${r.id}`] = m("marlow", r.describe);
  // beats: the generic ones from the base game, plus this mission's story beats
  const keep = new Set(["callback_spotted", "callback_ignored", "callback_none", "alert_2_first", "low_trust", "extraction_caught"]);
  const beats: Beat[] = [
    { id: "intro_first", trigger: { start: true, first_run: true }, lineIds: ["client.intro.a", "client.intro.b", "client.intro.c", "marlow.intro"], cueIds: ["sfx.phone.ring", "music.calm"], once: true },
    { id: "intro_repeat", trigger: { start: true, repeat_run: true }, lineIds: ["client.intro.repeat", "marlow.intro"], cueIds: ["music.calm"], once: true },
    { id: "story_limp", trigger: { heard_guard: true }, lineIds: ["marlow.story.limp"], cueIds: ["sfx.radio.static"], once: true },
    ...rooms.slice(1).map(r => ({ id: `story_${r.id}`, trigger: { entered: r.id }, lineIds: [`marlow.story.${r.id}`], cueIds: [], once: true })),
    { id: "ledger_twist", trigger: { taken: itemId }, lineIds: ["marlow.twist.tape", "client.got"], cueIds: ["sfx.radio.static"], once: true },
    { id: "client_checkin", trigger: { turn_gte: 5, no_objective: true }, lineIds: ["client.checkin"], cueIds: ["sfx.radio.static"], once: true },
    { id: "nudge_office", trigger: { turn_gte: 5, unless_fired: [`story_${itemRoom}`] }, lineIds: ["marlow.nudge.office"], cueIds: [], once: true },
    { id: "nudge_take", trigger: { turn_gte: 8, after_fired: [`story_${itemRoom}`], unless_fired: ["ledger_twist"] }, lineIds: ["marlow.nudge.take"], cueIds: [], once: true },
    { id: "nudge_exit", trigger: { turn_gte: 12, after_fired: ["ledger_twist"] }, lineIds: ["marlow.nudge.exit"], cueIds: [], once: true },
    ...base.beats.filter(b => keep.has(b.id)),
    { id: "extraction_win", trigger: { status: "won" }, lineIds: ["marlow.outro.win", "client.tape", "marlow.epilogue.ask"], cueIds: ["music.tension.off"], once: true },
  ];
  // lore: what Marlow can say about each topic, unlocked by the beat that reveals it
  const FACT = { start: "job", guard: "story_limp", item: `story_${itemRoom}`, end: "ledger_twist" } as const;
  const lore: Record<string, [string, string][]> = {};
  const order = ["start", "guard", "item", "end"];
  for (const t of ["client", "guard", "owner", "item", "history"]) {
    spec.lore.filter(x => x.topic === t).sort((a, b) => order.indexOf(a.when) - order.indexOf(b.when)).forEach((x, i) => {
      const id = `marlow.lore.${t}.${i}`; lines[id] = m("marlow", x.text); (lore[t] ??= []).push([FACT[x.when], id]);
    });
  }
  lines["marlow.lore.marlow.0"] = m("marlow", "I'm Marlow, boss. Your eyes."); lore.marlow = [["job", "marlow.lore.marlow.0"]];
  const alt = (...xs: string[]) => xs.map(x => x.toLowerCase().replace(/[^a-z' ]/g, "").trim()).filter(Boolean).join("|");
  const loreTopics: [string, string][] = [
    ["client", `\\b(${alt(spec.clientName, spec.clientName.split(" ")[0], "client", "partner", "employer")})\\b`],
    ["guard", `\\b(${alt(spec.guardName, spec.guardName.split(" ")[0], spec.guardName.split(" ").pop()!, "guard", "night man", "watchman")})\\b`],
    ["owner", `\\b(${alt(spec.ownerName, spec.ownerName.split(" ")[0], spec.ownerName.split(" ").pop()!, "owner")})\\b`],
    ["item", `\\b(${alt(bare(spec.item.name), ...spec.item.aliases.map(bare))})\\b`],
    ["history", `\\b(what happened|history|the real|true story|inspired)\\b`],
    ["marlow", `\\b(who are you|about yourself|about you)\\b`],
  ];
  const bank = { ...base.lines, ...lines };
  const beatErrs = validateBeats(beats, bank, ["sfx.phone.ring", "music.calm", "sfx.radio.static", "music.tension.on", "music.tension.off"], parsed.data as unknown as Level);
  if (beatErrs.length) return { errors: beatErrs };
  return { errors: [], mission: { id: `${kase.id}-${slug(spec.title)}`.slice(0, 48), clientFirstName: spec.clientName.split(" ")[0], title: spec.title, tagline: spec.tagline, inspiredBy: kase.inspiredBy, sources: kase.sources, level: parsed.data, lines, beats, lore, loreTopics } };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Text checks: lengths, no template braces, and no real names from the case (people, places and works are fictionalized). */
export function checkText(mission: Mission, realNames: string[]): string[] {
  const e: string[] = [];
  const texts: [string, string][] = [];
  for (const [id, def] of Object.entries(mission.lines)) for (const t of def.text) texts.push([id, t]);
  const lv = mission.level as { rooms: { spokenName: string }[]; items: { spokenName: string }[] };
  for (const r of lv.rooms) texts.push(["room", r.spokenName]);
  for (const i of lv.items) texts.push(["item", i.spokenName]);
  texts.push(["title", mission.title], ["tagline", mission.tagline]);
  const banned = realNames.flatMap(n => n.toLowerCase().split(/\s+/)).filter(w => w.length > 2 && !["the", "and", "museum", "of"].includes(w));
  for (const [id, t] of texts) {
    if (!t.trim()) e.push(`${id}: empty line`);
    if (t.length > 340) e.push(`${id}: too long to speak (${t.length} characters, max 340)`);
    if (/[{}<>]/.test(t)) e.push(`${id}: contains template or markup characters`);
    const hit = words(t).find(w => banned.includes(w));
    if (hit) e.push(`${id}: uses the real name "${hit}"; fictionalize it`);
  }
  // spoken lines must be dialogue in the speaker's own voice: flag a sentence that opens with the speaker's own name and a
  // third-person verb ("Marlow opens the box", "Victor breathes fast"), or "a voice says". Names inside dialogue are fine.
  const clientFirst = (mission.clientFirstName ?? "").toLowerCase().replace(/[^a-z]/g, "");
  for (const [id, def] of Object.entries(mission.lines)) for (const t of def.text) {
    const self = def.speaker === "marlow" ? "marlow" : def.speaker === "client" ? clientFirst : "";
    const sentences = t.split(/(?<=[.!?])\s+/);
    if (self && sentences.some(x => new RegExp(`^${self}\\s+(\\w+s|is|was|has|had)\\b`, "i").test(x.trim()))) e.push(`${id}: reads as narration about the speaker ("${t.slice(0, 50)}…"); write it in the speaker's own words, first person`);
    if (/\b(a|the) voice (says|said|whispers|whispered)\b/i.test(t)) e.push(`${id}: reads as narration ("a voice says"); write the words themselves`);
  }  // a lore answer is Marlow talking ABOUT its topic, so it must name it (the client's name, the guard's name, the object...)
  for (const [topic, re] of mission.loreTopics) {
    if (topic === "history" || topic === "marlow") continue;
    const rx = new RegExp(re, "i");
    for (const [id, def] of Object.entries(mission.lines)) if (id.startsWith(`marlow.lore.${topic}.`)) for (const t of def.text)
      if (!rx.test(t.toLowerCase())) e.push(`${id}: a ${topic} fact must name its subject so Owl knows who or what Marlow means ("${t.slice(0, 50)}…")`);
  }

  return e;
}
