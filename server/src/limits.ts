/**
 * Protection for the endpoints that cost money or write files. They are unauthenticated (this is a local game server), so the
 * point is damage control: a per-client rate limit and a body-size cap, so anyone who can reach the port (for example on your
 * Wi-Fi after `npm run dev:lan`) cannot burn your Meta credits or fill the disk. Not a substitute for a real login.
 */
import type { Context, MiddlewareHandler } from "hono";

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  /** True if this client may make another request now (and counts it). */
  allow(key: string): boolean {
    const t = this.now(), recent = (this.hits.get(key) ?? []).filter(x => t - x < this.windowMs);
    if (recent.length >= this.max) { this.hits.set(key, recent); return false; }
    recent.push(t); this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some(x => t - x < this.windowMs)) this.hits.delete(k); // bound memory
    return true;
  }
}

/** The connecting address. X-Forwarded-For is never trusted: anyone could forge it to dodge the limit. */
export const clientIp = (c: Context): string => ((c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? "local");

export function limit(opts: { max: number; windowMs: number; maxBytes: number; now?: () => number }): MiddlewareHandler {
  const rl = new RateLimiter(opts.max, opts.windowMs, opts.now);
  return async (c, next) => {
    if (!rl.allow(clientIp(c))) return c.json({ error: "too many requests, slow down" }, 429);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const len = c.req.header("content-length");
      if (len === undefined) return c.json({ error: "a content-length is required" }, 411);
      if (!/^\d+$/.test(len) || Number(len) > opts.maxBytes) return c.json({ error: `body too large (limit ${opts.maxBytes} bytes)` }, 413);
    }
    await next();
  };
}

/** Is this a request our game could have made? Anything else is never forwarded to the model (it would cost tokens). */
export function checkIntentRequest(r: unknown): string | null {
  const o = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  if (!o(r)) return "the body must be a JSON object";
  if (!Number.isInteger(r.turnId)) return "turnId must be an integer";
  if (typeof r.transcript !== "string" || r.transcript.length > 400) return "transcript must be text of at most 400 characters";
  if (typeof r.currentRoom !== "string" || r.currentRoom.length > 40) return "currentRoom must be a short id";
  if (!Array.isArray(r.knowledge) || r.knowledge.length > 80) return "knowledge must be a list of at most 80 entries";
  for (const k of r.knowledge) if (!o(k) || typeof k.id !== "string" || typeof k.spokenName !== "string" || JSON.stringify(k).length > 1200) return "a knowledge entry is malformed or too large";
  return null;
}
