import level from "../../data/level.json";
import { createInitialState, step, validate, locate, type StepResult } from "@marlow/engine";
import type { Action, GameEvent, WorldState } from "@marlow/shared";

const q = new URLSearchParams(location.search);
const seed = Number(q.get("seed") ?? Date.now() % 100000);
let state: WorldState = createInitialState(level, seed);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (t: string) => { const p = document.createElement("p"); p.textContent = t; $("log").append(p); };

/** M1 stand-in for the local parser; M2 replaces this with the real L1 pipeline. */
function parse(text: string, s: WorldState): Action | string {
  const t = text.toLowerCase().trim();
  if (["wait", "stop"].includes(t)) return { action: "wait" };
  if (t === "listen") return { action: "listen" };
  if (t === "hide") return { action: "hide" };
  if (t === "exit") return { action: "exit" };
  if (t === "go back") return s.marlow.prevRoom ? { action: "move", target: s.marlow.prevRoom } : "Nowhere to go back to.";
  const quiet = /quiet/.test(t) ? ("quiet" as const) : undefined;
  const room = s.rooms.find(r => t.includes(r.id));
  if (/^(go|move)/.test(t) && room) return { action: "move", target: room.id, stance: quiet };
  if (t.startsWith("peek")) {
    const door = s.doors.find(d => d.between.some(b => t.includes(b)) && d.between.includes(s.marlow.room));
    return door ? { action: "peek", target: door.id } : "Peek which door?";
  }
  if (t.startsWith("take")) { const it = s.items.find(i => t.includes(i.id)); return it ? { action: "take", target: it.id } : "Take what?"; }
  return "Say again, boss?";
}

const name = (s: WorldState, id: string) =>
  [...s.rooms, ...s.doors, ...s.props, ...s.items].find(x => x.id === id)?.spokenName ?? id;

function narrate(s: WorldState, e: GameEvent): string | null {
  if (!e.perceived) return null;
  switch (e.type) {
    case "moved": return `Moving to ${name(s, e.to)}.`;
    case "door_noise": return "The door creaks.";
    case "door_peeked": return `Through ${name(s, e.door)}: ${name(s, e.sees)}. ${e.guardSeen ? "A guard." : "No guard."}`;
    case "guard_heard": return `Footsteps, ${e.dir}, ${e.dist}.`;
    case "listen_quiet": return "Quiet.";
    case "waited": return "Holding.";
    case "hid": return `Hiding at ${name(s, e.prop)}.`;
    case "item_taken": return `Got ${name(s, e.item)}.`;
    case "warning": return "Guard's close, boss.";
    case "sound_heard": return `${e.sound}, ${e.dir}, ${e.dist}.`;
    case "spotted": return "He saw me!";
    case "caught": return "Caught. Run over.";
    case "won": return "Out clean. Run over.";
    case "refused": return `Can't do that (${e.reason}).`;
    default: return null;
  }
}

function render() {
  const dbg = $("debug");
  dbg.hidden = q.get("debug") !== "1";
  if (dbg.hidden) return;
  dbg.textContent = JSON.stringify({
    turn: state.turn, alert: state.alert, trust: state.trust, status: state.status,
    marlow: state.marlow, guard: { room: state.guard.route[state.guard.step], ...state.guard },
    knowledge: state.knowledge, guardFromMarlow: locate(state, state.guard.route[state.guard.step]),
  }, null, 1);
}

$("f").addEventListener("submit", ev => {
  ev.preventDefault();
  const input = $<HTMLInputElement>("cmd");
  const text = input.value; input.value = "";
  if (!text) return;
  say(`> ${text}`);
  const a = parse(text, state);
  if (typeof a === "string") { say(a); return; }
  const r: StepResult = step(state, a);
  for (const e of r.events) { const line = narrate(state, e); if (line) say(line); }
  state = r.state;
  render();
});
say(`Seed ${seed}. You're in the van. Marlow is in the lobby.`);
render();
