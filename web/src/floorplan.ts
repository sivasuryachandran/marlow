/**
 * The seer's top-down map: a game-style floor plan drawn on a canvas from the engine's own state. Floors are Muse Image
 * textures matched to each room's footstep sound; walls, doorways, furniture, tokens, the guard's flashlight, his route
 * and noise ripples are all computed from level data and events, so the picture can never disagree with the game.
 * Ground truth: only for the seer and the Spectator tab, never for the listening player.
 */
import type { GameEvent, WorldState } from "@marlow/shared";
import { guardRoom, nextGuardRoom } from "@marlow/engine";
import { planLayout, tokenSpot, WALL, type Plan, type PlanRoom } from "./plan-layout";

type Pt = { x: number; y: number };
interface Mover { path: Pt[]; t0: number; dur: number; at: Pt }
interface Ripple { x: number; y: number; t0: number; color: string; label?: string }

const TEXTURES = ["floor_lobby", "floor_marble", "floor_carpet", "floor_metal", "floor_street"];
const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class FloorPlan {
  private g: CanvasRenderingContext2D;
  private plan?: Plan;
  private s?: WorldState;
  private pats: Record<string, CanvasPattern | null> = {};
  private marlow?: Mover;
  private guard?: Mover;
  private ripples: Ripple[] = [];
  private lastRooms = { marlow: "", guard: "" };
  private view: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 0, h: 0 };
  private dpr = 1;

  /** "truth": everything, for the seer and the Spectator tab. "player": only what Marlow has seen, growing as she explores. */
  constructor(private canvas: HTMLCanvasElement, private mode: "truth" | "player" = "truth") {
    this.g = canvas.getContext("2d")!;
    for (const t of TEXTURES) {
      const img = new Image(); img.src = `/art/ui/${t}.jpg`;
      img.onload = () => { const p = this.g.createPattern(img, "repeat"); p?.setTransform(new DOMMatrix().scale(t === "floor_street" ? 0.4 : 0.3)); this.pats[t] = p; };
    }
    const tick = (now: number) => { requestAnimationFrame(tick); if (this.s && this.canvas.offsetParent !== null) { try { this.draw(now); } catch (e) { console.warn("map frame skipped", e); } } };
    requestAnimationFrame(tick);
  }

  /** Feed the latest state (and the events of the turn that produced it). */
  update(s: WorldState, events: GameEvent[] = []) {
    if (!this.plan) { this.plan = planLayout(s); this.dpr = Math.min(2, window.devicePixelRatio || 1); }
    this.s = s;
    this.fit();
    this.s = s;
    const now = performance.now(), p = this.plan;
    const hideSpot = s.marlow.hidden ? p.props.find(x => x.room === s.marlow.room && x.hide) : undefined;
    const mTarget = hideSpot ? { x: hideSpot.x + hideSpot.w + 16, y: hideSpot.y + hideSpot.h / 2 } : tokenSpot(p, s.marlow.room, "marlow");
    this.marlow = this.move(this.marlow, this.lastRooms.marlow, s.marlow.room, mTarget, now);
    const gr = guardRoom(s);
    this.guard = this.move(this.guard, this.lastRooms.guard, gr, tokenSpot(p, gr, "guard"), now);
    this.lastRooms = { marlow: s.marlow.room, guard: gr };
    for (const e of events) this.rippleFor(e, now);
  }

  /** Forget the previous run (a new run starts with an empty map). */
  reset() { this.plan = undefined; this.marlow = undefined; this.guard = undefined; this.ripples = []; this.lastRooms = { marlow: "", guard: "" }; this.view = { x: 0, y: 0, w: 0, h: 0 }; }

  /** Rooms the picture may show. Truth mode: all of them. Player mode: only those Marlow has seen, never the guard's post. */
  private shown(): PlanRoom[] {
    const p = this.plan!, s = this.s!;
    return this.mode === "truth" ? p.rooms : p.rooms.filter(r => !r.offstage && s.knowledge.rooms.includes(r.id));
  }
  /** Size the canvas to the picture: the whole plan, or (player) just the explored rooms plus the street. */
  private fit() {
    const p = this.plan!, rs = this.shown();
    let v = { x: 0, y: 0, w: p.width, h: p.height };
    if (this.mode === "player" && rs.length) {
      const x0 = Math.min(...rs.map(r => r.x)) - 40, y0 = Math.min(...rs.map(r => r.y)) - 40, x1 = Math.max(...rs.map(r => r.x + r.w)) + 40;
      const exitRoom = rs.find(r => Math.abs(p.exit.x - (r.x + r.w / 2)) < 1 && p.exit.y > r.y + r.h);
      const y1 = Math.max(...rs.map(r => r.y + r.h)) + (exitRoom ? p.street.h : 40);
      v = { x: x0, y: y0, w: Math.max(420, x1 - x0), h: Math.max(300, y1 - y0) };
    }
    if (v.w !== this.view.w || v.h !== this.view.h || v.x !== this.view.x || v.y !== this.view.y) {
      this.view = v;
      this.canvas.width = Math.round(v.w * this.dpr); this.canvas.height = Math.round(v.h * this.dpr);
      this.canvas.style.aspectRatio = `${v.w} / ${v.h}`;
    }
  }
  /** A door is shown to the player only if Marlow knows it; the truth view shows all. */
  private doorShown(id: string): boolean { return this.mode === "truth" || this.s!.knowledge.doors.includes(id); }

  // ---------- motion ----------
  private doorBetween(a: string, b: string) { return this.plan!.doors.find(d => d.between.includes(a) && d.between.includes(b)); }
  private move(cur: Mover | undefined, fromRoom: string, toRoom: string, target: Pt, now: number): Mover {
    const at = cur ? this.pos(cur, now) : target;
    if (!cur) return { path: [target], t0: now, dur: 1, at: target };
    const d = fromRoom && fromRoom !== toRoom ? this.doorBetween(fromRoom, toRoom) : undefined;
    const path = d ? [at, { x: d.x, y: d.y }, target] : [at, target];
    return { path, t0: now, dur: still() ? 1 : d ? 1100 : 500, at: target };
  }
  private pos(m: Mover, now: number): Pt {
    const t = Math.min(1, (now - m.t0) / m.dur), k = ease(t);
    if (m.path.length === 1 || t >= 1) return m.path[m.path.length - 1];
    const segs = m.path.slice(1).map((p, i) => Math.hypot(p.x - m.path[i].x, p.y - m.path[i].y)), total = segs.reduce((a, b) => a + b, 0);
    let dist = k * total;
    for (let i = 0; i < segs.length; i++) {
      if (dist <= segs[i] || i === segs.length - 1) { const f = segs[i] ? dist / segs[i] : 1, a = m.path[i], b = m.path[i + 1]; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
      dist -= segs[i];
    }
    return m.at;
  }

  private rippleFor(e: GameEvent, now: number) {
    if (this.mode === "player" && !e.perceived) return;
    const p = this.plan!, s = this.s!, m = this.marlow?.at;
    if (e.type === "door_noise") { const d = p.doors.find(x => x.id === e.door); if (d) this.ripples.push({ x: d.x, y: d.y, t0: now, color: "240,180,90", label: "creak" }); }
    else if (e.type === "guard_alerted" && m) this.ripples.push({ ...m, t0: now, color: "240,180,90", label: "he heard that" });
    else if (e.type === "spotted" && m) this.ripples.push({ ...m, t0: now, color: "224,70,60", label: "SPOTTED" });
    else if (e.type === "chase_started" && m) this.ripples.push({ ...m, t0: now + 400, color: "224,70,60", label: "CHASE" });
    else if (e.type === "sound_heard") {
      const src = s.scheduled.find(x => x.sound === e.sound), r = src && p.rooms.find(x => x.id === src.room);
      if (r) this.ripples.push({ x: r.x + r.w * 0.8, y: r.y + r.h * 0.2, t0: now, color: "155,227,166", label: "ring" });
    } else if (e.type === "item_taken" && m) this.ripples.push({ ...m, t0: now, color: "255,211,107", label: "taken" });
  }

  // ---------- drawing ----------
  private draw(now: number) {
    const g = this.g, p = this.plan!, s = this.s!, v = this.view, player = this.mode === "player", rooms = this.shown();
    g.setTransform(this.dpr, 0, 0, this.dpr, -v.x * this.dpr, -v.y * this.dpr);
    g.clearRect(v.x, v.y, v.w, v.h);
    g.fillStyle = player ? "#0a0806" : "#0b0907"; g.fillRect(v.x, v.y, v.w, v.h);
    this.street(now);
    for (const r of rooms) { g.fillStyle = r.offstage ? "#1a1510" : "#2f251b"; g.fillRect(r.x - WALL / 2, r.y - WALL / 2, r.w + WALL, r.h + WALL); } // walls
    for (const r of rooms) this.floor(r);
    for (const d of p.doors) if (this.doorShown(d.id) && d.between.some(b => rooms.some(r => r.id === b))) this.door(d.id);
    if (player) this.unexplored(rooms);
    this.decor(now, rooms);
    for (const pr of p.props) if (rooms.some(r => r.id === pr.room) && (!player || s.knowledge.props.includes(pr.id))) this.prop(pr.id, now);
    if (!player) { this.fog(); this.route(); this.flashlight(now); }
    this.ripplesDraw(now);
    this.tokens(now);
    this.compass();
  }

  /** Doors Marlow knows lead somewhere she has not seen: a dashed, unlabelled stub, so the map invites exploring. */
  private unexplored(rooms: PlanRoom[]) {
    const g = this.g, p = this.plan!, s = this.s!;
    for (const d of p.doors) {
      if (!s.knowledge.doors.includes(d.id)) continue;
      const other = d.between.find(b => !rooms.some(r => r.id === b)); const o = p.rooms.find(r => r.id === other);
      if (!other || !o || o.offstage) continue;
      g.save(); g.setLineDash([6, 6]); g.strokeStyle = "rgba(242,231,208,.35)"; g.lineWidth = 2; g.strokeRect(o.x, o.y, o.w, o.h);
      g.fillStyle = "rgba(242,231,208,.5)"; g.font = "italic 14px 'Libre Baskerville', serif"; g.textAlign = "center"; g.fillText("not seen yet", o.x + o.w / 2, o.y + o.h / 2 + 5); g.restore();
    }
  }

  private street(now: number) {
    const g = this.g, st = this.plan!.street;
    if (this.mode === "player" && !this.shown().some(r => Math.abs(this.plan!.exit.x - (r.x + r.w / 2)) < 1 && this.plan!.exit.y > r.y + r.h)) return;
    g.fillStyle = this.pats.floor_street ?? "#141110"; g.fillRect(st.x, st.y, st.w, st.h);
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(st.x, st.y, st.w, st.h);
    if (!still()) { g.strokeStyle = "rgba(200,210,230,.25)"; g.lineWidth = 1; for (let i = 0; i < 40; i++) { const x = (i * 97 + now / 6) % st.w, y = st.y + ((i * 53 + now / 3) % st.h); g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3, y + 9); g.stroke(); } }
    g.fillStyle = "rgba(242,231,208,.75)"; g.font = "13px 'Special Elite', monospace"; g.textAlign = "center";
    g.fillText("THE STREET · EXIT", this.plan!.exit.x, st.y + st.h - 14);
  }

  private floor(r: PlanRoom) {
    const g = this.g;
    g.save(); g.fillStyle = this.pats[r.floor] ?? "#3a3026"; g.fillRect(r.x, r.y, r.w, r.h);
    const sh = g.createLinearGradient(r.x, r.y, r.x, r.y + r.h); sh.addColorStop(0, "rgba(0,0,0,.35)"); sh.addColorStop(0.15, "rgba(0,0,0,0)"); sh.addColorStop(0.85, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,.4)");
    g.fillStyle = sh; g.fillRect(r.x, r.y, r.w, r.h);
    if (r.offstage) { g.fillStyle = "rgba(8,6,4,.6)"; g.fillRect(r.x, r.y, r.w, r.h); }
    // brass name plaque
    g.font = "13px 'Special Elite', monospace"; const label = r.name.toUpperCase() + (r.offstage ? " · GUARD'S POST" : ""), w = g.measureText(label).width + 16;
    g.fillStyle = "rgba(20,15,10,.85)"; g.fillRect(r.x + 8, r.y + 8, w, 22); g.strokeStyle = "#a8843a"; g.lineWidth = 1; g.strokeRect(r.x + 8.5, r.y + 8.5, w - 1, 21);
    g.fillStyle = "#e8cf8e"; g.textAlign = "left"; g.fillText(label, r.x + 16, r.y + 24);
    g.restore();
  }

  private door(id: string) {
    const g = this.g, p = this.plan!, s = this.s!, d = p.doors.find(x => x.id === id)!, real = s.doors.find(x => x.id === id)!;
    const L = 58, T = WALL + 2, w = d.horizontal ? L : T, h = d.horizontal ? T : L;
    g.save(); g.translate(d.x, d.y);
    g.fillStyle = "#4a3a28"; g.fillRect(-w / 2, -h / 2, w, h); // threshold
    if (d.kind === "stairs") { g.strokeStyle = "#9a8f80"; g.lineWidth = 2; for (let i = -2; i <= 2; i++) { g.beginPath(); if (d.horizontal) { g.moveTo(-w / 2 + 4, i * 3.5); g.lineTo(w / 2 - 4, i * 3.5); } else { g.moveTo(i * 3.5, -h / 2 + 4); g.lineTo(i * 3.5, h / 2 - 4); } g.stroke(); } }
    else if (d.kind === "arch") { g.fillStyle = "#cfc3ad"; const c = 8; if (d.horizontal) { g.fillRect(-w / 2, -h / 2, c, h); g.fillRect(w / 2 - c, -h / 2, c, h); } else { g.fillRect(-w / 2, -h / 2, w, c); g.fillRect(-w / 2, h / 2 - c, w, c); } }
    else if (real.state === "open") { g.strokeStyle = "rgba(201,140,70,.8)"; g.lineWidth = 3; g.beginPath(); if (d.horizontal) { g.moveTo(-L / 2, 0); g.lineTo(-L / 2 + 6, -L + 10); } else { g.moveTo(0, -L / 2); g.lineTo(L - 10, -L / 2 + 6); } g.stroke(); }
    else { g.fillStyle = "#8a5a2b"; if (d.horizontal) g.fillRect(-L / 2 + 3, -3, L - 6, 6); else g.fillRect(-3, -L / 2 + 3, 6, L - 6); g.fillStyle = "#e8cf8e"; g.beginPath(); g.arc(d.horizontal ? L / 2 - 10 : 0, d.horizontal ? 0 : L / 2 - 10, 2.2, 0, Math.PI * 2); g.fill(); }
    g.restore();
    if (d.id === p.doors.find(x => x.between.includes(s.objective.exitRoom))?.id) { /* exit drawn separately */ }
  }

  private decor(now: number, shown: PlanRoom[]) {
    const g = this.g, p = this.plan!, s = this.s!, room = (id: string) => shown.find(r => r.id === id), player = this.mode === "player";
    // the front doors from the exit room to the street
    const e = p.exit; g.fillStyle = "#4a3a28"; g.fillRect(e.x - 34, e.y - WALL / 2 - 1, 68, WALL + 2); g.fillStyle = "#8a5a2b"; g.fillRect(e.x - 30, e.y - 3, 28, 6); g.fillRect(e.x + 2, e.y - 3, 28, 6);
    // portraits along the hall walls
    const hall = room("hall");
    if (hall) for (const fx of [0.14, 0.3, 0.7, 0.86]) for (const top of [true, false]) { const x = hall.x + hall.w * fx - 9, y = top ? hall.y + 3 : hall.y + hall.h - 9; g.fillStyle = "#c9a24a"; g.fillRect(x, y, 18, 6); g.fillStyle = "#3b2a1a"; g.fillRect(x + 2, y + 1.5, 14, 3); }
    // the office safe, standing open and empty
    const office = room("office");
    if (office) { const x = office.x + office.w - 54, y = office.y + office.h - 54; g.fillStyle = "#2a2a2c"; g.fillRect(x, y, 40, 40); g.fillStyle = "#111"; g.fillRect(x + 6, y + 6, 28, 28); g.strokeStyle = "#7d7d80"; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 40, y + 2); g.lineTo(x + 58, y - 10); g.stroke(); }
    // stair treads in the stairwell
    const sw = shown.find(r => r.floor === "floor_metal" && !r.offstage);
    if (sw) { g.strokeStyle = "rgba(200,200,200,.25)"; g.lineWidth = 2; for (let i = 0; i < 7; i++) { const y = sw.y + 14 + i * 9; g.beginPath(); g.moveTo(sw.x + sw.w * 0.3, y); g.lineTo(sw.x + sw.w * 0.7, y); g.stroke(); } }
    // the ledger, if it is still in a room
    for (const it of s.items) if (it.room && room(it.room) && (!player || s.knowledge.items.includes(it.id))) {
      const desk = p.props.find(pr => pr.room === it.room && pr.kind === "desk"), r = room(it.room)!;
      const x = desk ? desk.x + desk.w * 0.55 : r.x + r.w / 2, y = desk ? desk.y + desk.h / 2 : r.y + r.h / 2;
      g.save(); g.translate(x, y); g.rotate(-0.2); g.fillStyle = "#6b1d1e"; g.fillRect(-10, -7, 20, 14); g.strokeStyle = "#e8cf8e"; g.lineWidth = 1; g.strokeRect(-8, -5, 16, 10); g.restore();
      const glint = still() ? 0.5 : 0.5 + 0.5 * Math.sin(now / 300);
      g.fillStyle = `rgba(255,224,140,${0.25 + 0.35 * glint})`; g.beginPath(); g.arc(x, y, 16 + 4 * glint, 0, Math.PI * 2); g.fill();
    }
  }

  private prop(id: string, now: number) {
    const g = this.g, pr = this.plan!.props.find(x => x.id === id)!;
    g.save();
    if (pr.kind === "desk") {
      g.fillStyle = "#5a3820"; g.fillRect(pr.x, pr.y, pr.w, pr.h); g.fillStyle = "#7a5030"; g.fillRect(pr.x + 3, pr.y + 3, pr.w - 6, pr.h - 6);
      g.fillStyle = "rgba(120,220,140,.25)"; g.beginPath(); g.arc(pr.x + 14, pr.y + 12, 16, 0, Math.PI * 2); g.fill(); g.fillStyle = "#2f8a4a"; g.beginPath(); g.arc(pr.x + 14, pr.y + 12, 6, 0, Math.PI * 2); g.fill();
    } else if (pr.kind === "case") {
      g.fillStyle = "rgba(170,215,225,.22)"; g.fillRect(pr.x, pr.y, pr.w, pr.h); g.strokeStyle = "#e8e2d4"; g.lineWidth = 2; g.strokeRect(pr.x, pr.y, pr.w, pr.h);
      g.strokeStyle = "rgba(255,255,255,.45)"; g.beginPath(); g.moveTo(pr.x + 6, pr.y + 10); g.lineTo(pr.x + 16, pr.y + 2); g.stroke();
      g.fillStyle = "#c9a24a"; g.beginPath(); g.arc(pr.x + pr.w / 2, pr.y + pr.h / 2, 6, 0, Math.PI * 2); g.fill();
    } else { g.fillStyle = "#4a3a28"; g.fillRect(pr.x, pr.y, pr.w, pr.h); }
    if (pr.hide) { g.font = "11px 'Courier Prime', monospace"; g.fillStyle = "#9be3a6"; g.textAlign = "left"; g.fillText("cover", pr.x, pr.y + pr.h + 13); }
    g.restore();
  }

  /** Rooms Marlow has not seen yet are darker: the seer sees them, but knows the listener has no idea what is there. */
  private fog() {
    const g = this.g, s = this.s!;
    for (const r of this.plan!.rooms) {
      if (r.offstage || s.knowledge.rooms.includes(r.id)) continue;
      g.save(); g.fillStyle = "rgba(6,5,4,.55)"; g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = "rgba(255,255,255,.06)"; g.lineWidth = 6; g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
      for (let k = -r.h; k < r.w; k += 22) { g.beginPath(); g.moveTo(r.x + k, r.y + r.h); g.lineTo(r.x + k + r.h, r.y); g.stroke(); }
      g.fillStyle = "rgba(242,231,208,.7)"; g.font = "italic 12px 'Libre Baskerville', serif"; g.textAlign = "center"; g.fillText("Marlow hasn't seen this yet", r.x + r.w / 2, r.y + r.h - 12);
      g.restore();
    }
  }

  /** The guard's next two steps, as a dashed red line through the doorways. */
  private route() {
    const g = this.g, p = this.plan!, s = this.s!, cur = guardRoom(s), steps: string[] = [];
    if (s.guard.detour || s.guard.returning) steps.push(nextGuardRoom(s));
    else for (let k = 1; steps.length < 2 && k < s.guard.route.length; k++) { const r = s.guard.route[(s.guard.step + k) % s.guard.route.length]; if (r !== (steps[steps.length - 1] ?? cur)) steps.push(r); }
    if (!steps.length || !this.guard) return;
    const pts: Pt[] = [this.guard.at]; let prev = cur;
    for (const r of steps) { const d = this.doorBetween(prev, r); if (!d) break; pts.push({ x: d.x, y: d.y }, tokenSpot(p, r, "guard")); prev = r; }
    if (pts.length < 2) return;
    g.save(); g.strokeStyle = "rgba(224,70,60,.85)"; g.lineWidth = 3; g.setLineDash([8, 7]); g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (const q of pts.slice(1)) g.lineTo(q.x, q.y); g.stroke(); g.setLineDash([]);
    const a = pts[pts.length - 2], b = pts[pts.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x);
    g.fillStyle = "rgba(224,70,60,.9)"; g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x - 12 * Math.cos(ang - 0.4), b.y - 12 * Math.sin(ang - 0.4)); g.lineTo(b.x - 12 * Math.cos(ang + 0.4), b.y - 12 * Math.sin(ang + 0.4)); g.fill();
    g.restore();
  }

  private flashlight(now: number) {
    if (!this.guard) return;
    const g = this.g, p = this.plan!, s = this.s!, at = this.pos(this.guard, now), here = guardRoom(s), next = nextGuardRoom(s), room = p.rooms.find(r => r.id === here)!;
    let target: Pt = s.chase ? (this.marlow ? this.pos(this.marlow, now) : at) : next !== here ? (this.doorBetween(here, next) ?? { x: at.x, y: at.y - 1 }) : { x: at.x - 1, y: at.y };
    const ang = Math.atan2(target.y - at.y, target.x - at.x) + (still() ? 0 : Math.sin(now / 700) * 0.28), half = 0.4, len = 175;
    g.save(); g.beginPath(); g.rect(room.x - WALL / 2, room.y - WALL / 2, room.w + WALL, room.h + WALL); g.clip();
    const grad = g.createRadialGradient(at.x, at.y, 6, at.x, at.y, len);
    const col = s.guard.detour || s.chase ? "255,150,120" : "255,228,150";
    grad.addColorStop(0, `rgba(${col},.55)`); grad.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grad; g.beginPath(); g.moveTo(at.x, at.y); g.arc(at.x, at.y, len, ang - half, ang + half); g.closePath(); g.fill();
    g.restore();
  }

  private ripplesDraw(now: number) {
    const g = this.g;
    this.ripples = this.ripples.filter(r => now - r.t0 < 2200);
    for (const r of this.ripples) {
      const t = (now - r.t0) / 2200; if (t < 0) continue;
      g.save();
      for (const k of [0, 0.18, 0.36]) { const tt = still() ? 0.4 : Math.max(0, t - k); if (tt <= 0) continue; g.strokeStyle = `rgba(${r.color},${(1 - tt) * 0.9})`; g.lineWidth = 3; g.beginPath(); g.arc(r.x, r.y, 10 + tt * 70, 0, Math.PI * 2); g.stroke(); }
      if (r.label) { g.fillStyle = `rgba(${r.color},${1 - t})`; g.font = "bold 13px 'Special Elite', monospace"; g.textAlign = "center"; g.fillText(r.label, r.x, r.y - 28 - t * 20); }
      g.restore();
    }
  }

  private tokens(now: number) {
    const g = this.g, s = this.s!;
    const disc = (p: Pt, r: number, fill: string, stroke: string, letter: string, letterCol: string) => {
      g.fillStyle = "rgba(0,0,0,.45)"; g.beginPath(); g.ellipse(p.x + 2, p.y + 4, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = fill; g.strokeStyle = stroke; g.lineWidth = 2.5; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = letterCol; g.font = `bold ${r}px 'Courier Prime', monospace`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(letter, p.x, p.y + 1); g.textBaseline = "alphabetic";
    };
    if (this.guard && this.mode === "truth") {
      const at = this.pos(this.guard, now);
      disc(at, 15, "#b8302a", "#f2e7d0", "G", "#fff");
      g.fillStyle = "#e8cf8e"; g.font = "12px 'Special Elite', monospace"; g.textAlign = "center"; g.fillText("Halloran", at.x, at.y + 30);
      if (s.guard.detour) { g.fillStyle = "#ffcf6b"; g.font = "bold 18px 'Courier Prime', monospace"; g.fillText("!", at.x + 16, at.y - 14); }
    }
    if (this.marlow) {
      const at = this.pos(this.marlow, now), hidden = s.marlow.hidden;
      if (s.chase) { const k = still() ? 0.5 : (now / 500) % 1; g.strokeStyle = `rgba(224,70,60,${1 - k})`; g.lineWidth = 3; g.beginPath(); g.arc(at.x, at.y, 16 + k * 18, 0, Math.PI * 2); g.stroke(); }
      g.globalAlpha = hidden ? 0.65 : 1;
      disc(at, 13, hidden ? "#9be3a6" : "#f0c56a", "#1a1208", "M", "#1a1208");
      g.globalAlpha = 1;
      // facing: a small wedge pointing where she faces
      const f = { north: -Math.PI / 2, east: 0, south: Math.PI / 2, west: Math.PI }[s.marlow.facing] ?? -Math.PI / 2;
      g.fillStyle = "#f0c56a"; g.beginPath(); g.moveTo(at.x + Math.cos(f) * 22, at.y + Math.sin(f) * 22); g.lineTo(at.x + Math.cos(f + 0.5) * 15, at.y + Math.sin(f + 0.5) * 15); g.lineTo(at.x + Math.cos(f - 0.5) * 15, at.y + Math.sin(f - 0.5) * 15); g.fill();
      g.fillStyle = "#f2e7d0"; g.font = "12px 'Special Elite', monospace"; g.textAlign = "center"; g.fillText(hidden ? "Marlow (hidden)" : s.marlow.carrying ? "Marlow + ledger" : "Marlow", at.x, at.y + 28);
    }
  }

  private compass() {
    const g = this.g, x = this.plan!.width - 30, y = 30;
    g.save(); g.strokeStyle = "#a8843a"; g.fillStyle = "rgba(20,15,10,.8)"; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = "#e8cf8e"; g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x + 5, y + 2); g.lineTo(x - 5, y + 2); g.fill();
    g.font = "10px 'Special Elite', monospace"; g.textAlign = "center"; g.fillText("N", x, y + 12); g.restore();
  }
}
