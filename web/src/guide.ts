import { renderLine, countWord, type LineBank, type SpokenLine } from "@marlow/game";
import type { AudioEngine } from "./audio";
import { BY_ID, TOGGLES, BRIEF_SEQUENCE, pttState, pickKind } from "./guide-map";

/**
 * Audio guide: reads each control aloud as it takes focus, answers H for help on the current screen, and reads the briefing.
 * Every sentence is a pre-rendered voice line (the "guide" speaker); nothing is synthesized while you play.
 */
interface Deps {
  audio: AudioEngine; bank: LineBank;
  level: { rooms: { spokenName: string; id: string }[]; doors: any[]; props: { spokenName: string }[]; items: { id: string; spokenName: string }[]; objective: { item: string; exitRoom: string; alarmTurns?: number } };
  mission: { id: string; lines: Record<string, unknown> } | null;
}
const KEY = "marlow.guide.v1";
const $ = (id: string) => document.getElementById(id) as HTMLElement;
let d: Deps; let on = false; let briefing = false;

function load(): boolean { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } }
function save() { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private window */ } }

/** Only the slots the line's text uses count toward its file name. */
function line(id: string, slots: Record<string, string> = {}): SpokenLine | null {
  const used = new Set([...(d.bank[id]?.text.join(" ") ?? "").matchAll(/\{(\w+)\}/g)].map(m => m[1]));
  return renderLine(d.bank, { id, slots: Object.fromEntries(Object.entries(slots).filter(([k]) => used.has(k))) }, { seed: 0, turnId: 0, curt: false });
}
/** Speak one guide line (mission-specific lines come from the mission's folder). Resolves when done or cut off. */
async function say(id: string, slots: Record<string, string> = {}, base?: string): Promise<void> {
  const l = line(id, slots); if (!l) return;
  const own = d.mission && id in d.mission.lines ? `/missions/${d.mission.id}/audio` : undefined;
  await d.audio.speakGuide(l, base ?? own);
}

/** Wait (up to ~15 s) until the game's own voice has finished, so the guide never talks over Marlow. */
async function waitQuiet(still: () => boolean) {
  for (let i = 0; i < 60 && d.audio.voiceActive && still(); i++) await new Promise(r => setTimeout(r, 250));
}

function lineForControl(el: HTMLElement): { id: string; slots?: Record<string, string>; base?: string } | null {
  if (el.dataset.guide) return { id: el.dataset.guide, slots: el.dataset.guideSlots ? JSON.parse(el.dataset.guideSlots) : undefined };
  if (el.dataset.mission) return { id: "guide.card", base: `/missions/${el.dataset.mission}/audio` };
  if (el.matches("a.skip")) return { id: "guide.ctl.skiplink" };
  if (el.id === "ptt") return { id: `guide.ctl.ptt.${pttState(el.textContent ?? "")}` };
  if (el.id in TOGGLES) {
    const [yes, no] = TOGGLES[el.id];
    const state = el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-pressed") === "true" || el.dataset.playing === "1";
    return { id: state ? yes : no };
  }
  if (el.id in BY_ID) return { id: BY_ID[el.id] };
  if (el.getAttribute("role") === "tab" && el.dataset.tab) return { id: `guide.ctl.tab.${el.dataset.tab}` };
  if (el.closest("#chips") && el.dataset.act) return { id: `guide.ctl.chip.${el.dataset.act}` };
  if (el.closest("#clarifyBtns")) {
    const p = pickKind(el.textContent ?? "", d.level as never);
    return p ? { id: `guide.pick.${p.kind}`, slots: { [p.kind]: p.name } } : null;
  }
  if (el.matches("form.gen button[type=submit]")) return { id: BY_ID.genSubmit };
  if (el.matches("a.case-card") && !el.dataset.mission) return { id: "guide.ctl.case.builtin" };
  return null;
}

async function onFocus(e: FocusEvent) {
  if (!on || briefing) return;
  const el = e.target as HTMLElement; if (!(el instanceof HTMLElement)) return;
  const l = lineForControl(el); if (!l) return;
  await waitQuiet(() => document.activeElement === el);
  if (document.activeElement !== el) return;
  // a case card's line lives in that case's own folder, not in this page's bank
  const ln = l.base ? { id: l.id, audioKey: `${l.id}.v0` } : line(l.id, l.slots); if (!ln) return;
  await d.audio.speakGuide(ln, l.base ?? (d.mission && l.id in d.mission.lines ? `/missions/${d.mission.id}/audio` : undefined));
}

function currentHelp(): string {
  if (!$("hero").hidden) return "start";
  if (!$("end").hidden && !$("endChoices").hidden) return "pick";
  if (!$("end").hidden && !$("tab-play").hidden) return "end";
  for (const t of ["brief", "case", "spec", "set"]) if (!$(`tab-${t}`).hidden) return t;
  return "play";
}

export const guide = {
  get on() { return on; },
  init(deps: Deps) {
    d = deps; on = load();
    const sync = () => { const b = $("guideToggle"); b.setAttribute("aria-pressed", String(on)); };
    sync();
    document.addEventListener("focusin", e => { void onFocus(e); });
    const flip = async () => { on = !on; save(); sync(); stopBrief(); await say(on ? "guide.on" : "guide.off"); };
    $("guideToggle").addEventListener("click", () => { void flip(); });
    document.addEventListener("keydown", e => {
      const t = e.target as HTMLElement, typing = t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && !["range", "checkbox", "button"].includes((t as HTMLInputElement).type));
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") { stopBrief(); d.audio.stopGuide(); return; }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === "g") { void flip(); }
      else if (k === "h" && on) { e.preventDefault(); void say(`guide.help.${currentHelp()}`); }
    });
    const lb = $("listenBrief");
    lb.addEventListener("click", () => { if (briefing) stopBrief(); else void playBrief(); });
    document.querySelectorAll<HTMLElement>('[role="tab"]').forEach(t => t.addEventListener("click", () => { if (on) stopBrief(); }));
  },
  /** Say a status line once the game's own voice is done (only when the guide is on). */
  async announce(id: string, slots: Record<string, string> = {}) {
    if (!on) return; await waitQuiet(() => true); if (on) await say(id, slots);
  },
  /** Speak the room code letter by letter. */
  async roomCode(code: string) {
    if (!on) return;
    await say("guide.coop.ready"); await say("guide.roomcode");
    for (const ch of code.toUpperCase()) { if (!on) return; await say("guide.letter", { letter: ch }); }
  },
};

function stopBrief() {
  if (!briefing) return; briefing = false; d.audio.stopGuide(); setBriefButton(false);
}
function setBriefButton(playing: boolean) {
  const b = $("listenBrief"); b.dataset.playing = playing ? "1" : "0"; b.setAttribute("aria-pressed", String(playing));
  b.textContent = playing ? "Stop the briefing" : "Listen to the briefing";
}
/** Read the briefing aloud, section by section. Works with the guide off; this is an explicit request. */
async function playBrief() {
  briefing = true; setBriefButton(true);
  const slots = { item: itemName(), room: roomName(), count: countWord(d.level.objective.alarmTurns ?? 10) };
  for (const id of BRIEF_SEQUENCE) {
    if (!briefing) return;
    if (!d.bank[id]) continue;
    await say(id, slots);
    if (!briefing) return;
    await new Promise(r => setTimeout(r, 350));
  }
  briefing = false; setBriefButton(false);
}
const itemName = () => d.level.items.find(i => i.id === d.level.objective.item)?.spokenName ?? "the item";
const roomName = () => d.level.rooms.find(r => r.id === d.level.objective.exitRoom)?.spokenName ?? "the exit";
