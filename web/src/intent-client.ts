import { MockIntent, type IntentAdapter, type IntentRequest, type IntentResponse } from "@marlow/game";

/** Calls the server's configured backend; falls back to the in-browser deterministic mock when unavailable (static hosting, 501, network). */
export class HttpIntent implements IntentAdapter {
  name = "mock";
  usingFallback = true;
  private fallback = new MockIntent();
  async init() {
    try {
      const h = await (await fetch("/api/health")).json();
      this.usingFallback = h.intent === "mock" || !h.keys?.meta && h.intent === "meta" || !h.keys?.baseten && h.intent === "baseten";
      if (!this.usingFallback) this.name = h.intent;
    } catch { this.usingFallback = true; }
  }
  async infer(req: IntentRequest): Promise<IntentResponse> {
    if (!this.usingFallback) {
      try {
        const r = await fetch("/api/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
        if (r.ok) return (await r.json()) as IntentResponse;
        if (r.status === 501) this.usingFallback = true; // adapter not wired: stay playable
      } catch { /* network: fall through */ }
    }
    return this.fallback.infer(req);
  }
}
