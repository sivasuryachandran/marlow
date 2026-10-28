import { readFileSync, readdirSync, existsSync } from "node:fs";
import level from "../data/level.json" with { type: "json" };
import linesJson from "../data/lines.json" with { type: "json" };
import beatsJson from "../data/beats.json" with { type: "json" };
import cuesJson from "../data/cues.json" with { type: "json" };
import { loadBank, type Beat } from "../packages/game/src/index";

export { level, linesJson, beatsJson, cuesJson };
export const bank = loadBank(linesJson);
export const beats = beatsJson as Beat[];
export const cues = cuesJson as string[];

export function readRuns(dir = "runs"): { id: string; rows: Record<string, any>[] }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".jsonl")).map(f => ({
    id: f.replace(/\.jsonl$/, ""),
    rows: readFileSync(`${dir}/${f}`, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)),
  }));
}
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
