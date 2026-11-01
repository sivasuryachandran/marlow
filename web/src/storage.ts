import { FRESH_MEMORY, type Memory, type MemoryStore } from "@marlow/game";

/** Trust + the remembered fact persist in localStorage (guarded: storage can throw in private windows). One key per mission. */
export class LocalStore implements MemoryStore {
  private mem: Memory = { ...FRESH_MEMORY };
  constructor(private key = "marlow.memory.v1") {}
  load(): Memory {
    try { const raw = localStorage.getItem(this.key); if (raw) this.mem = { ...FRESH_MEMORY, ...JSON.parse(raw) }; } catch { /* use in-memory */ }
    return { ...this.mem };
  }
  save(m: Memory) { this.mem = { ...m }; try { localStorage.setItem(this.key, JSON.stringify(m)); } catch { /* ignore */ } }
  reset() { this.mem = { ...FRESH_MEMORY }; try { localStorage.removeItem(this.key); } catch { /* ignore */ } }
}
export function loadPrefs<T extends object>(key: string, def: T): T {
  try { return { ...def, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; } catch { return def; }
}
export function savePrefs(key: string, v: object) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }
