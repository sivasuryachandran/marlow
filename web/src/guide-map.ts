/** Which pre-rendered guide line each control speaks. Pure data and string logic, so a test can check every control has a line. */
export const BY_ID: Record<string, string> = {
  start: "guide.ctl.start", coopBtn: "guide.ctl.coop", coopLink: "guide.ctl.coopLink", coopCopy: "guide.ctl.coopCopy", coopStop: "guide.ctl.coopStop",
  cmd: "guide.ctl.cmd", skip: "guide.ctl.skip", burnBtn: "guide.ctl.burn", sendBtn: "guide.ctl.send", again: "guide.ctl.again", openCase: "guide.ctl.openCase",
  casefile: "guide.ctl.casefile", reveal: "guide.ctl.reveal", vVoice: "guide.ctl.vVoice", vMusic: "guide.ctl.vMusic", vSfx: "guide.ctl.vSfx",
  forget: "guide.ctl.forget", genCase: "guide.ctl.genCase", genTheme: "guide.ctl.genTheme", genSubmit: "guide.ctl.genSubmit",
};
/** Controls whose line depends on their state: id → [line when state is true, line when false]. */
export const TOGGLES: Record<string, [string, string]> = {
  audioOnly: ["guide.ctl.audioOnly.on", "guide.ctl.audioOnly.off"], guideToggle: ["guide.ctl.guide.on", "guide.ctl.guide.off"],
  ambience: ["guide.ctl.ambience.on", "guide.ctl.ambience.off"], mono: ["guide.ctl.mono.on", "guide.ctl.mono.off"], captions: ["guide.ctl.captions.on", "guide.ctl.captions.off"],
  listenBrief: ["guide.ctl.listenBrief.stop", "guide.ctl.listenBrief.play"],
};
export const TABS = ["play", "brief", "case", "spec", "set"];
export const CHIPS = ["move", "peek", "listen", "wait", "hide", "take", "exit"];
export const PTT_STATES = ["hold", "live", "muted", "unavailable"];
export const pttState = (text: string) => /unavailable/i.test(text) ? "unavailable" : /muted/i.test(text) ? "muted" : /listening/i.test(text) ? "live" : "hold";
export const BRIEF_SEQUENCE = ["guide.brief.start", "guide.brief.job", "guide.brief.how", "guide.brief.goal", "guide.brief.alarm", "guide.brief.tape", "guide.brief.say", "guide.brief.engine", "guide.brief.cast", "guide.brief.end"];
export const HELP = ["start", "play", "brief", "case", "spec", "set", "end", "pick"];

/** Every line id the controller can ask for with no slots (so each needs a rendered file). */
export function staticLineIds(): string[] {
  return [
    ...Object.values(BY_ID), ...Object.values(TOGGLES).flat(), "guide.ctl.skiplink", "guide.ctl.case.builtin",
    ...TABS.map(t => `guide.ctl.tab.${t}`), ...CHIPS.map(c => `guide.ctl.chip.${c}`), ...PTT_STATES.map(s => `guide.ctl.ptt.${s}`),
    ...HELP.map(h => `guide.help.${h}`), "guide.on", "guide.off", "guide.status.over", "guide.status.pick", "guide.coop.ready", "guide.roomcode", "guide.mic.muted", "guide.mic.live",
  ];
}

/** Which kind of name a clarify button is, by looking it up in the level. */
export function pickKind(label: string, level: { rooms: { spokenName: string }[]; doors: { spokenName: string }[]; props: { spokenName: string }[]; items: { spokenName: string }[] }): { kind: "door" | "room" | "item" | "prop"; name: string } | null {
  const l = label.trim().toLowerCase();
  for (const [kind, xs] of [["door", level.doors], ["room", level.rooms], ["item", level.items], ["prop", level.props]] as const) {
    const x = xs.find(y => y.spokenName.toLowerCase() === l); if (x) return { kind, name: x.spokenName };
  }
  return null;
}
