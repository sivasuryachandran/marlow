/** Case picker and mission generator UI (Briefing tab), and the title card for a generated mission. */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface LoadedMission {
  id: string; title: string; tagline: string; inspiredBy: string; sources: string[];
  level: { rooms: { id: string; spokenName: string }[]; items: { id?: string; spokenName: string }[]; objective?: { item: string; exitRoom: string; alarmTurns?: number } }; lines: Record<string, unknown>; beats: unknown[];
  cast?: { client: string; guard: string; owner: string }; lore: unknown; loreTopics: [string, string][]; voices?: boolean; art?: string[]; artCaptions?: Record<string, string>;
}

/** Captions for a mission's stills, from its own rooms and object (beat ids are story_<room>, ledger_twist, intro_first). */
export function artCaptions(m: LoadedMission): Record<string, string> {
  const caps: Record<string, string> = {};
  for (const b of m.art ?? []) {
    if (b === "intro_first") caps[b] = m.title;
    else if (b === "ledger_twist") caps[b] = `Inside ${m.level.items[0]?.spokenName ?? "it"}.`;
    else { const r = m.level.rooms.find(x => `story_${x.id}` === b); caps[b] = r ? r.spokenName.replace(/^./, c => c.toUpperCase()) + "." : b; }
  }
  return caps;
}

/** The Briefing tab's memo is the built-in story's; for a generated case, rewrite it from the case itself. */
function writeBriefing(m: LoadedMission) {
  const paper = document.querySelector<HTMLElement>("article.paper"); if (!paper) return;
  const o = m.level.objective, item = m.level.items.find(i => i.id === o?.item)?.spokenName ?? "the object", exit = m.level.rooms.find(r => r.id === o?.exitRoom)?.spokenName ?? "the way out", n = o?.alarmTurns ?? 10;
  const c = m.cast;
  const head = paper.querySelector<HTMLElement>(".memohead"); if (head) head.innerHTML = `TO: Owl<br>FROM: ${c ? esc(c.client) : "the client"}<br>RE: ${esc(m.title)}`;
  const ps = Array.from(paper.querySelectorAll<HTMLElement>("#memoH ~ p")).slice(0, 2);
  const job = (m.lines["guide.brief.job"] as { text?: string[] } | undefined)?.text?.[0]?.replace(/^The job\.\s*/, "");
  if (ps[0]) ps[0].textContent = job ?? `${m.title}. ${m.tagline}`;
  ps[1]?.remove();
  const li = paper.querySelectorAll("ol li")[3];
  if (li) li.innerHTML = `Get <b>${esc(item)}</b> and <b>get out through ${esc(exit)}</b>. Doors are noisy; the guard hears them and walks toward the sound. If he spots her he runs: you get exactly one turn to hide or leave the room. <b>Taking it sets off a silent alarm</b>: you have ${n} moves to get out. Waiting for the guard to leave no longer works.`;
  const say = Array.from(paper.querySelectorAll("h2")).find(h => h.textContent === "Things to say")?.nextElementSibling;
  if (say) say.innerHTML = `listen · what do you see · peek the door quietly · hide · take it · go back · exit<br>who is the client · who is the guard · where can I hide`;
}
const esc = (t: string) => t.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

const el = (tag: string, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

export function initMissions(mission: LoadedMission | null) {
  if (mission) {
    // title card and briefing speak about tonight's case
    const sub = document.querySelector<HTMLElement>(".subtitle"); if (sub) sub.textContent = mission.title;
    const tag = document.querySelector<HTMLElement>("#hero .tag"); if (tag) tag.textContent = `${mission.tagline} A heist you play by ear.`;
    const cast = document.querySelector<HTMLElement>(".cast-wrap"); if (cast) cast.hidden = true; // the painted cast belongs to the built-in story
    document.title = `MARLOW — ${mission.title}`;
    writeBriefing(mission);
  }
  const box = $("cases"); if (!box) return;
  const now = el("p", "now");
  now.innerHTML = mission ? `Now playing: <b></b>, inspired by <span></span>. Every name, place and object in it is invented.` : `Now playing: <b>The Purloined Ledger</b>, the built-in story.`;
  if (mission) { now.querySelector("b")!.textContent = mission.title; now.querySelector("span")!.textContent = mission.inspiredBy; }
  box.append(now);
  if (mission) {
    const src = el("p", "dim"); src.append("Sources: ");
    for (const u of [...new Set(mission.sources)]) { const a = el("a", "", u.replace(/^https?:\/\//, "")) as HTMLAnchorElement; a.href = u; a.target = "_blank"; a.rel = "noopener"; src.append(a, " "); }
    const rep = el("a", "", "how it was checked") as HTMLAnchorElement; rep.href = `/missions/${mission.id}/report.md`; rep.target = "_blank"; src.append("· ", rep);
    box.append(src);
  }
  const list = el("div", "case-list"); box.append(list);
  const card = (title: string, sub: string, href: string, current: boolean, id?: string) => {
    const a = el("a", `case-card${current ? " current" : ""}`) as HTMLAnchorElement; a.href = href; if (id) a.dataset.mission = id;
    a.append(el("b", "", title), el("span", "", sub)); if (current) a.setAttribute("aria-current", "page"); list.append(a);
  };
  card("The Purloined Ledger", "The built-in story: Owl, Marlow, Ines and the Hale Gallery.", location.pathname, !mission);
  fetch("/missions/index.json").then(r => (r.ok ? r.json() : [])).then((ms: { id: string; title: string; tagline: string; inspiredBy: string }[]) => {
    for (const m of ms) card(m.title, `Inspired by ${m.inspiredBy}. ${m.tagline}`, `?mission=${encodeURIComponent(m.id)}`, mission?.id === m.id, m.id);
  }).catch(() => {});

  // write a new case: needs the server (Muse Spark, and optionally Muse Image and local Kokoro voices)
  const form = el("form", "gen") as HTMLFormElement;
  form.innerHTML = `<h3>Write a new case</h3>
    <p class="dim">Pick a real heist (or describe one). Muse Spark adapts it into a new building and story with invented names; the game's code then builds the level, checks it, and simulates hundreds of runs to make sure careful play can win and reckless play can't. It takes a few minutes with voices and pictures.</p>
    <label for="genCase">Real case</label><select id="genCase"><option value="">Loading…</option></select>
    <label for="genTheme">or describe one</label><input id="genTheme" type="text" placeholder="e.g. the 1963 Great Train Robbery">
    <div class="btns"><button class="primary" type="submit">Write the case</button></div>
    <pre id="genLog" class="genlog" role="status" aria-live="polite" hidden></pre>`;
  box.append(form);
  const sel = form.querySelector<HTMLSelectElement>("#genCase")!;
  fetch("/api/cases").then(r => (r.ok ? r.json() : Promise.reject())).then((cs: { id: string; title: string; inspiredBy: string }[]) => {
    sel.innerHTML = `<option value="">Choose one…</option>` + cs.map(c => `<option value="${c.id}"></option>`).join("");
    cs.forEach((c, i) => (sel.options[i + 1].textContent = `${c.title} (inspired by ${c.inspiredBy})`));
  }).catch(() => { sel.innerHTML = `<option value="">Needs the server (npm run server)</option>`; });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const log = $("genLog"); log.hidden = false; log.textContent = "Starting…";
    const body = { caseId: sel.value || undefined, theme: (form.querySelector("#genTheme") as HTMLInputElement).value.trim() || undefined };
    if (!body.caseId && !body.theme) { log.textContent = "Choose a case or describe one."; return; }
    const r = await fetch("/api/missions/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!r || !r.ok) { log.textContent = r ? `Could not start: ${await r.text()}` : "The server is not running (npm run server)."; return; }
    const { job } = await r.json();
    const poll = async () => {
      const j = await fetch(`/api/missions/job/${job}`).then(x => x.json()).catch(() => null);
      if (j) log.textContent = (j.log ?? []).join("\n");
      if (j?.done) { if (j.ok) { const a = el("a", "", `Play “${j.id}” now`) as HTMLAnchorElement; a.href = `?mission=${encodeURIComponent(j.id)}`; log.append("\n\n", a); } return; }
      setTimeout(poll, 2000);
    };
    poll();
  });
}
