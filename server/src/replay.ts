import { createInitialState, RULES_VERSION, step } from "@marlow/engine";
import { hash } from "@marlow/game";
import type { WorldState } from "@marlow/shared";

export type Row = Record<string, any>;

/** Re-run a logged run through the engine; every executed turn must reproduce its logged events exactly. */
export function replayRows(rows: Row[], level: unknown): { ok: boolean; turns: number; mismatchAt?: number; stale?: boolean; final: WorldState } {
  const head = rows.find(r => r.type === "start");
  if (!head) throw new Error("run log has no start row");
  let s = createInitialState(level, head.seed, { trust: head.trust, lastTrustLoss: head.lastTrustLoss });
  // A log recorded against a different level file cannot be expected to replay; report it as stale, not as nondeterminism.
  if ((head as { rulesVersion?: number }).rulesVersion !== RULES_VERSION) return { ok: false, stale: true, turns: 0, final: s };
  if (head.levelHash !== undefined && head.levelHash !== hash(JSON.stringify(level))) return { ok: false, stale: true, turns: 0, final: s };
  let turns = 0;
  for (const row of rows) {
    if (!row.action || !row.events || row.discarded) continue;
    const r = step(s, row.action);
    turns++;
    if (JSON.stringify(r.events) !== JSON.stringify(row.events)) return { ok: false, turns, mismatchAt: row.turnId, final: s };
    s = r.state;
  }
  return { ok: true, turns, final: s };
}

/** States after each executed turn, keyed by turnId (used by the case file for engine facts). */
export function statesByTurn(rows: Row[], level: unknown): Map<number, { before: WorldState; after: WorldState }> {
  const head = rows.find(r => r.type === "start")!;
  let s = createInitialState(level, head.seed, { trust: head.trust, lastTrustLoss: head.lastTrustLoss });
  const out = new Map<number, { before: WorldState; after: WorldState }>();
  out.set(0, { before: s, after: s });
  for (const row of rows) {
    if (!row.action || !row.events || row.discarded) continue;
    const r = step(s, row.action);
    out.set(row.turnId, { before: s, after: r.state });
    s = r.state;
  }
  return out;
}
