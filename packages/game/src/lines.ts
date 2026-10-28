/** Template bank (L4). Every spoken fact is a template + engine-supplied slots. */
export interface LineDef { speaker: "marlow" | "client" | "system"; text: string[]; curt?: string[] }
export type LineBank = Record<string, LineDef>;
export interface LineRef { id: string; slots: Record<string, string> }
export interface SpokenLine { id: string; variant: number; text: string; speaker: string; audioKey: string; curt: boolean }

export const DIR_WORDS: Record<string, string> = { ahead: "ahead", behind: "behind", left: "left", right: "right", here: "here" };
export const DIST_WORDS: Record<string, string> = { near: "near", mid: "mid distance", far: "far" };

export function loadBank(json: unknown): LineBank {
  const out: LineBank = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) if (!k.startsWith("_")) out[k] = v as LineDef;
  return out;
}

/** FNV-1a: deterministic presentation choice that doesn't touch the engine RNG. */
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const c of parts.join("|")) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const safe = (s: string) => s.replace(/[^a-z0-9_-]+/gi, "_");
export function audioKey(id: string, variant: number, curt: boolean, slots: Record<string, string>): string {
  const sl = Object.keys(slots).sort().map(k => `${k}=${safe(slots[k])}`).join(".");
  return `${id}.${curt ? "c" : "v"}${variant}${sl ? "." + sl : ""}`;
}

export function fill(tpl: string, slots: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const raw = slots[k] ?? `{${k}}`;
    return DIR_WORDS[raw] ?? DIST_WORDS[raw] ?? raw;
  });
}
const cap = (s: string) => s.replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());

export function renderLine(bank: LineBank, ref: LineRef, opts: { seed: number; turnId: number; curt: boolean }): SpokenLine | null {
  const def = bank[ref.id];
  if (!def) return null;
  const curt = opts.curt && !!def.curt?.length;
  const variants = curt ? def.curt! : def.text;
  const variant = hash(opts.seed, opts.turnId, ref.id, JSON.stringify(ref.slots)) % variants.length;
  return {
    id: ref.id, variant, speaker: def.speaker, curt,
    text: cap(fill(variants[variant], ref.slots)),
    audioKey: audioKey(ref.id, variant, curt, ref.slots),
  };
}

/** Slot domains per line id, used by tools/render-lines.ts to enumerate every file that can be spoken. */
export function slotDomains(level: { rooms: any[]; doors: any[]; props: any[]; items: any[] }): Record<string, string[]> {
  return {
    room: level.rooms.filter(r => !r.offstage).map(r => r.spokenName), door: level.doors.filter(d => d.kind !== "stairs").map(d => d.spokenName),
    item: level.items.map(i => i.spokenName), prop: level.props.map(p => p.spokenName),
    dir: ["ahead", "behind", "left", "right"], dist: ["near", "mid", "far"],
  };
}

export function expandLine(id: string, def: LineDef, level: Parameters<typeof slotDomains>[0]): { audioKey: string; text: string; speaker: string }[] {
  const dom = slotDomains(level);
  const clarify = id.startsWith("marlow.clarify.");
  const kind = id.split(".")[2];
  const pool = kind === "door" ? dom.door : kind === "room" ? dom.room : [...dom.prop, ...dom.item];
  const out: { audioKey: string; text: string; speaker: string }[] = [];
  for (const curt of [false, true]) {
    const variants = curt ? def.curt ?? [] : def.text;
    variants.forEach((tpl, v) => {
      const names = [...new Set([...tpl.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
      let combos: Record<string, string>[] = [{}];
      for (const n of names) {
        const vals = clarify && (n === "a" || n === "b") ? pool : dom[n] ?? [`{${n}}`];
        combos = combos.flatMap(c => vals.map(val => ({ ...c, [n]: val })));
      }
      for (const c of combos) {
        if (clarify && c.a === c.b) continue;
        out.push({ audioKey: audioKey(id, v, curt, c), text: cap(fill(tpl, c)), speaker: def.speaker });
      }
    });
  }
  return out;
}
