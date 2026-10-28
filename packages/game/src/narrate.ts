import { guardRoom, locate, path, doorBetween } from "@marlow/engine";
import type { Dir, Dist, GameEvent, WorldState } from "@marlow/shared";
import type { LineRef } from "./lines";

const nameOf = (s: WorldState, id: string) =>
  [...s.rooms, ...s.doors, ...s.props, ...s.items].find(x => x.id === id)?.spokenName ?? id;

/** Events -> template line refs. Facts come only from perceived events and Marlow's knowledge delta. */
export function narrate(prev: WorldState, next: WorldState, events: GameEvent[]): LineRef[] {
  const out: LineRef[] = [];
  const has = (t: GameEvent["type"]) => events.some(e => e.type === t);
  const newKnown = () => {
    const refs: LineRef[] = [];
    for (const id of next.knowledge.items) if (!prev.knowledge.items.includes(id)) {
      const it = next.items.find(i => i.id === id)!;
      if (it.room) refs.push({ id: "marlow.arrive.item", slots: { item: it.spokenName } });
    }
    for (const id of next.knowledge.props) if (!prev.knowledge.props.includes(id)) {
      const p = next.props.find(p => p.id === id)!;
      if (p.tags.includes("hide")) refs.push({ id: "marlow.arrive.hide", slots: { prop: p.spokenName } });
    }
    return refs;
  };
  for (const e of events) {
    if (!e.perceived) continue;
    switch (e.type) {
      case "door_noise": out.push({ id: "marlow.door_noise", slots: {} }); break;
      case "moved":
        out.push({ id: e.stance === "quiet" ? "marlow.move.quiet" : "marlow.move", slots: { room: nameOf(next, e.to) } });
        out.push(...newKnown());
        break;
      case "door_peeked": {
        out.push({ id: "marlow.peek.room", slots: { room: nameOf(next, e.sees) } });
        const extra = newKnown();
        if (e.guardSeen) out.push({ id: "marlow.peek.guard", slots: {} });
        if (extra.length) out.push(...extra); else if (!e.guardSeen) out.push({ id: "marlow.peek.empty", slots: {} });
        break;
      }
      case "guard_heard":
        if (e.via === "listen") out.push(e.dir === "here" ? { id: "marlow.guard.here", slots: {} } : { id: "marlow.listen.heard", slots: { dir: e.dir, dist: e.dist } });
        else if (!has("warning")) out.push({ id: "marlow.listen.heard", slots: { dir: e.dir, dist: e.dist } });
        break;
      case "warning": out.push({ id: "marlow.warning", slots: { dir: e.dir } }); break;
      case "listen_quiet": out.push({ id: "marlow.listen.quiet", slots: {} }); break;
      case "waited": out.push({ id: "marlow.wait", slots: {} }); break;
      case "hid": out.push({ id: "marlow.hide", slots: { prop: nameOf(next, e.prop) } }); break;
      case "item_taken": out.push({ id: "marlow.take", slots: { item: nameOf(next, e.item) } }); break;
      case "sound_heard": out.push({ id: `marlow.sound.${e.sound}`, slots: { dir: e.dir, dist: e.dist } }); break;
      case "spotted": out.push({ id: "marlow.spotted", slots: {} }); break;
      case "caught": out.push({ id: "marlow.caught", slots: {} }); break;
      case "won": out.push({ id: e.alert <= 1 ? "marlow.win.clean" : "marlow.win.messy", slots: {} }); break;
      case "refused": out.push({ id: `marlow.refuse.${e.reason}`, slots: {} }); break;
    }
  }
  return out;
}

export interface Cue {
  id: string; kind: "world" | "sfx" | "music"; priority: number;
  dir?: Dir; fromDir?: Dir; dist?: Dist; occluded?: boolean; reverb: string; caption: string;
}

const spokenDir = (d: Dir) => (d === "here" ? "here" : d);

/** Every world sound derives from a perceived event; nothing else may reach the world bus. */
export function cuesFor(prev: WorldState, next: WorldState, events: GameEvent[]): Cue[] {
  const reverb = next.rooms.find(r => r.id === next.marlow.room)!.reverb;
  const cues: Cue[] = [];
  const material = (room: string) => next.rooms.find(r => r.id === room)!.footsteps;
  const guardCue = (e: Extract<GameEvent, { type: "guard_heard" }>) => {
    const gr = guardRoom(next);
    const prevView = { ...next, guard: prev.guard } as WorldState;
    const from = locate(prevView, guardRoom(prevView));
    const p = path(next, next.marlow.room, gr);
    const occluded = !!p && p.slice(1).some((r, i) => doorBetween(next, p[i], r)?.state === "closed");
    cues.push({
      id: `sfx.footsteps.${material(gr)}`, kind: "world", priority: 4, dir: e.dir, fromDir: from.dir !== e.dir ? from.dir : undefined,
      dist: e.dist, occluded, reverb, caption: `Footsteps, ${spokenDir(e.dir)}, ${e.dist}${occluded ? ", muffled" : ""}`,
    });
  };
  for (const e of events) {
    if (!e.perceived) continue;
    switch (e.type) {
      case "moved": cues.push({ id: `sfx.footsteps.${material(e.to)}`, kind: "sfx", priority: 1, dir: "here", dist: "near", reverb, caption: "Marlow's footsteps" }); break;
      case "door_noise": cues.push({ id: "sfx.door.creak", kind: "sfx", priority: 2, dir: "here", dist: "near", reverb, caption: "A door creaks" }); break;
      case "guard_heard": guardCue(e); break;
      case "sound_heard": cues.push({ id: "sfx.phone.ring", kind: "world", priority: 3, dir: e.dir, dist: e.dist, reverb, caption: `Phone ringing, ${spokenDir(e.dir)}, ${e.dist}` }); break;
      case "spotted": cues.push({ id: "sfx.stinger.spotted", kind: "sfx", priority: 6, reverb, caption: "Alarm stinger: Marlow has been spotted" }); break;
    }
  }
  if (next.alert >= 1 && prev.alert < 1) cues.push({ id: "music.tension.on", kind: "music", priority: 0, reverb, caption: "Music: tension rises" });
  if (next.status !== "playing") cues.push({ id: "music.tension.off", kind: "music", priority: 0, reverb, caption: "Music: fades out" });
  return cues.sort((a, b) => b.priority - a.priority);
}
