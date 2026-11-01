/**
 * Seer link: a two-player co-op mode where one person only listens (plays MARLOW as usual) and a friend only sees.
 * The listener's page (host) publishes a snapshot of the world after every turn; the seer's page shows the ground-truth
 * map. The seer cannot give orders; the two talk over their own phone or voice call. This relay keeps the latest
 * snapshot per room so a seer who joins late is caught up at once. Nothing here touches the engine: it only forwards.
 */
export interface Sock { send(data: string): void; close?(code?: number, reason?: string): void }
type Role = "host" | "seer";
interface Room { host?: Sock; seers: Set<Sock>; last?: string; touched: number }

export const ROOM_RE = /^[A-Z]{4}$/;
const MAX_SEERS = 4, MAX_MESSAGE = 512 * 1024;

export class SeerRooms {
  private rooms = new Map<string, Room>();
  constructor(private now: () => number = Date.now) {}

  /** Returns false (and the caller should close the socket) when the room code or role is bad, or the room is full. */
  join(code: string, role: string, sock: Sock): boolean {
    if (!ROOM_RE.test(code) || (role !== "host" && role !== "seer")) return false;
    const room = this.rooms.get(code) ?? { seers: new Set<Sock>(), touched: this.now() };
    if (role === "host") {
      if (room.host && room.host !== sock) room.host.close?.(4000, "replaced by a new host");
      room.host = sock;
    } else {
      if (room.seers.size >= MAX_SEERS) return false;
      room.seers.add(sock);
      sock.send(JSON.stringify({ type: "host", connected: !!room.host }));
      if (room.last) sock.send(room.last);
    }
    room.touched = this.now();
    this.rooms.set(code, room);
    this.announce(code);
    return true;
  }

  /** Only the host may publish; a seer's messages are ignored (the seer cannot act in the game). */
  message(code: string, sock: Sock, data: string) {
    const room = this.rooms.get(code);
    if (!room || room.host !== sock || data.length > MAX_MESSAGE) return;
    let msg: { type?: string };
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type !== "state") return;
    room.last = data; room.touched = this.now();
    for (const s of room.seers) s.send(data);
  }

  leave(code: string, sock: Sock) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.host === sock) room.host = undefined;
    room.seers.delete(sock);
    room.touched = this.now();
    if (!room.host && !room.seers.size) this.rooms.delete(code);
    else this.announce(code);
  }

  /** Drop rooms nobody has used for a while. */
  sweep(maxIdleMs = 2 * 60 * 60 * 1000) {
    for (const [code, r] of this.rooms) if (this.now() - r.touched > maxIdleMs) this.rooms.delete(code);
  }

  size() { return this.rooms.size; }

  private announce(code: string) {
    const room = this.rooms.get(code); if (!room) return;
    room.host?.send(JSON.stringify({ type: "seers", count: room.seers.size }));
    for (const s of room.seers) s.send(JSON.stringify({ type: "host", connected: !!room.host }));
  }
}
