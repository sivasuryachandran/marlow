import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guardRoom, locate } from "@marlow/engine";
import type { WorldState } from "@marlow/shared";
import type { ImageAdapter, ImageResult } from "./adapters/image";
import { verifyPanel } from "./adapters/image";
import { statesByTurn, type Row } from "./replay";

export const STYLE_GUIDE =
  "Film noir comic panel. Rain, high contrast black and white with one amber accent, heavy shadows, flat ink shapes. " +
  "No real brands, logos, readable text, or real people. Fictional museum interior.";

export interface Moment { key: string; turnId: number; label: string }
export interface Panel {
  key: string; turnId: number; label: string; facts: string[]; mustShow: string[]; prompt: string;
  caption: string; alt: string; image: string; source: string; verified: string;
}

/** Pick 4–6 key moments: intro, first clarify, guard near, ledger taken, outcome. */
export function pickMoments(rows: Row[]): Moment[] {
  const turns = rows.filter(r => typeof r.turnId === "number" && !r.discarded);
  const m: Moment[] = [{ key: "intro", turnId: 0, label: "The job" }];
  const find = (f: (r: Row) => boolean) => turns.find(f);
  const clarify = find(r => r.kind === "clarify");
  if (clarify) m.push({ key: "clarify", turnId: clarify.turnId, label: "Which door?" });
  const near = find(r => r.events?.some((e: any) => e.type === "warning" || (e.type === "guard_heard" && e.dist === "near")));
  if (near) m.push({ key: "guard_near", turnId: near.turnId, label: "Guard close" });
  const spotted = find(r => r.events?.some((e: any) => e.type === "spotted"));
  if (spotted) m.push({ key: "spotted", turnId: spotted.turnId, label: "Seen" });
  const ledger = find(r => r.events?.some((e: any) => e.type === "item_taken"));
  if (ledger) m.push({ key: "ledger", turnId: ledger.turnId, label: "The ledger" });
  const end = [...turns].reverse().find(r => r.events?.some((e: any) => e.type === "won" || e.type === "caught"));
  if (end) m.push({ key: end.events.some((e: any) => e.type === "won") ? "exit" : "caught", turnId: end.turnId, label: end.events.some((e: any) => e.type === "won") ? "Out" : "Caught" });
  const seen = new Set<number>();
  const uniq = m.filter(x => (seen.has(x.turnId) ? false : (seen.add(x.turnId), true)));
  return uniq.slice(0, 6);
}

const nm = (s: WorldState, id: string) => [...s.rooms, ...s.doors, ...s.props, ...s.items].find(x => x.id === id)?.spokenName ?? id;

/** Facts come only from engine state; images never feed anything back. */
export function factsFor(after: WorldState, row: Row | undefined): { facts: string[]; mustShow: string[] } {
  const room = after.rooms.find(r => r.id === after.marlow.room)!;
  const facts = [`Setting: ${room.spokenName} of a closed art museum at night, ${room.reverb} acoustics.`];
  const mustShow: string[] = [];
  for (const p of after.props.filter(p => p.room === room.id)) { facts.push(`${p.spokenName} on the ${p.side} side.`); mustShow.push(p.spokenName); }
  for (const i of after.items.filter(i => i.room === room.id)) { facts.push(`${i.spokenName} within reach.`); mustShow.push(i.spokenName); }
  for (const d of after.doors.filter(d => d.between.includes(room.id))) facts.push(`${d.spokenName} is ${d.state}.`);
  if (after.marlow.carrying) facts.push(`Marlow carries ${nm(after, after.marlow.carrying)}.`);
  const g = locate(after, guardRoom(after));
  if (g.dir === "here") { facts.push("The guard is in the same room."); mustShow.push("guard"); }
  else if (row?.events?.some((e: any) => e.type === "guard_heard" || e.type === "warning" || e.type === "door_peeked")) facts.push(`A guard is ${g.dist === "near" ? "one room away" : "far off"}, ${g.dir}; seen only as a shadow under a door.`);
  if (after.marlow.hidden) facts.push("Marlow is hiding.");
  facts.push(`Alert level ${after.alert} of 3.`);
  return { facts, mustShow };
}

/** Marlow's own words from that turn become the caption. */
export function captionFor(row: Row | undefined, fallback: string): string {
  const marlow = (row?.lines ?? []).filter((l: any) => String(l.id).startsWith("marlow.") || String(l.id).startsWith("client."));
  return marlow.length ? marlow.map((l: any) => l.text).slice(0, 2).join(" ") : fallback;
}

export function placeholderSvg(after: WorldState, label: string, caption: string): string {
  const W = 800, H = 500;
  const xs = after.rooms.map(r => r.pos[0]), ys = after.rooms.map(r => r.pos[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const cell = 120, ox = 200 + -x0 * 0, oy = 80;
  const pos = (r: { pos: [number, number] }) => [ox + (r.pos[0] - x0) * (cell + 20), oy + (Math.max(...ys) - r.pos[1]) * (cell - 10)];
  const g = after.rooms.find(r => r.id === guardRoom(after))!;
  let rain = "";
  for (let i = 0; i < 70; i++) { const x = (i * 97) % W, y = (i * 53) % H; rain += `<line x1="${x}" y1="${y}" x2="${x - 6}" y2="${y + 22}" stroke="#667" stroke-opacity=".35"/>`; }
  const rooms = after.rooms.map(r => {
    const [x, y] = pos(r);
    const here = r.id === after.marlow.room;
    const props = after.props.filter(p => p.room === r.id).map((p, i) => `<rect x="${x + 8 + i * 28}" y="${y + cell - 34}" width="22" height="20" fill="#222" stroke="#eee"/>`).join("");
    const item = after.items.filter(i => i.room === r.id).map(() => `<circle cx="${x + cell - 18}" cy="${y + 18}" r="8" fill="#e8a33d"/>`).join("");
    return `<g><rect x="${x}" y="${y}" width="${cell}" height="${cell - 20}" fill="${here ? "#2a2418" : "#111"}" stroke="${here ? "#e8a33d" : "#889"}" stroke-width="${here ? 4 : 1.5}"/>${props}${item}</g>`;
  }).join("");
  const [mx, my] = pos(after.rooms.find(r => r.id === after.marlow.room)!);
  const [gx, gy] = pos(g);
  const esc = (t: string) => t.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
<rect width="${W}" height="${H}" fill="#0b0b10"/>${rain}${rooms}
<circle cx="${mx + 60}" cy="${my + 50}" r="12" fill="#fff"/><text x="${mx + 44}" y="${my + 86}" fill="#fff" font-size="13" font-family="sans-serif">Marlow</text>
<path d="M${gx + 90} ${gy + 25} l12 0 l6 34 l-24 0z" fill="#c33" opacity=".85"/>
<text x="20" y="40" fill="#e8a33d" font-size="26" font-family="serif">${esc(label)}</text>
<text x="20" y="${H - 18}" fill="#ccd" font-size="14" font-family="serif">${esc(caption.slice(0, 110))}</text></svg>`;
}

export async function buildCaseFile(opts: {
  runId: string; rows: Row[]; level: unknown; outDir: string; image?: ImageAdapter; verify?: boolean;
}): Promise<{ dir: string; panels: Panel[]; html: string }> {
  const dir = join(opts.outDir, opts.runId);
  mkdirSync(dir, { recursive: true });
  const states = statesByTurn(opts.rows, opts.level);
  const panels: Panel[] = [];
  for (const mo of pickMoments(opts.rows)) {
    const row = opts.rows.find(r => r.turnId === mo.turnId && !r.discarded && r.lines);
    const st = states.get(mo.turnId) ?? states.get([...states.keys()].filter(k => k <= mo.turnId).pop()!)!;
    const { facts, mustShow } = factsFor(st.after, row);
    const prompt = `${STYLE_GUIDE} Scene: ${facts.join(" ")} Moment: ${mo.label}.`;
    const caption = captionFor(row, mo.label);
    const base = join(dir, `panel-${panels.length + 1}`);
    const cache = ["svg", "png", "jpg"].map(e => `${base}.${e}`).find(existsSync);
    let img: ImageResult; let verified = "not-run";
    if (cache) img = { ext: cache.split(".").pop() as ImageResult["ext"], data: "", source: existsSync(`${base}.source`) ? (readFileSync(`${base}.source`, "utf8") as ImageResult["source"]) : "placeholder" };
    else {
      try { if (!opts.image) throw new Error("no image adapter"); img = await opts.image.render(prompt, `${opts.runId}:${mo.key}`); }
      catch { img = { ext: "svg", data: placeholderSvg(st.after, mo.label, caption), source: "placeholder" }; }
      if (opts.verify) {
        const v = await verifyPanel(img, mustShow);
        verified = v.skipped ? "skipped" : v.ok ? "ok" : "failed";
        // On mismatch: regenerate once, else the placeholder frame (engine-drawn, always true).
        if (!v.ok) img = { ext: "svg", data: placeholderSvg(st.after, mo.label, caption), source: "placeholder" };
      }
      writeFileSync(`${base}.${img.ext}`, img.data);
      writeFileSync(`${base}.source`, img.source);
    }
    panels.push({ key: mo.key, turnId: mo.turnId, label: mo.label, facts, mustShow, prompt, caption, alt: facts.join(" "), image: `panel-${panels.length + 1}.${img.ext}`, source: img.source, verified });
  }
  writeFileSync(join(dir, "prompts.json"), JSON.stringify(panels, null, 2));
  const html = renderHtml(opts.runId, panels);
  writeFileSync(join(dir, "index.html"), html);
  return { dir, panels, html };
}

export function renderHtml(runId: string, panels: Panel[]): string {
  const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MARLOW — Case File ${esc(runId)}</title>
<style>body{margin:0;background:#0b0b10;color:#eee;font:17px/1.5 Georgia,serif}main{max-width:52rem;margin:auto;padding:1.5rem}
h1{color:#e8a33d;letter-spacing:.2em}figure{margin:2rem 0}img{width:100%;border:2px solid #556}figcaption{padding:.6rem 0}
.alt{color:#99a;font:14px sans-serif}footer{color:#99a;font:13px sans-serif;margin:3rem 0}</style></head>
<body><main><h1>MARLOW — CASE FILE</h1>
<p>A heist run by ear, described for those who need the picture.</p>
${panels.map((p, i) => `<figure><img src="${p.image}" alt="${esc(p.alt)}"><figcaption><strong>${i + 1}. ${esc(p.label)}.</strong> “${esc(p.caption)}”<div class="alt">${esc(p.alt)}</div></figcaption></figure>`).join("\n")}
<footer>Illustrated from the run log. Run ${esc(runId)}. Panels: ${[...new Set(panels.map(p => p.source))].join(", ")}. All characters and places are fictional.</footer></main></body></html>`;
}
