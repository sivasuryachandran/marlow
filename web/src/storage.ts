import { FRESH_MEMORY, type Memory, type MemoryStore } from "@marlow/game";

const KEY = "marlow.memory.v1";
/** Trust + the remembered fact persist in localStorage (guarded: storage can throw in private windows). */
export class LocalStore implements MemoryStore {
  private mem: Memory = { ...FRESH_MEMORY };
  load(): Memory {
    try { const raw = localStorage.getItem(KEY); if (raw) this.mem = { ...FRESH_MEMORY, ...JSON.parse(raw) }; } catch { /* use in-memory */ }
    return { ...this.mem };
  }
  save(m: Memory) { this.mem = { ...m }; try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignore */ } }
  reset() { this.mem = { ...FRESH_MEMORY }; try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
}
export function loadPrefs<T extends object>(key: string, def: T): T {
  try { return { ...def, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; } catch { return def; }
}
export function savePrefs(key: string, v: object) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }
