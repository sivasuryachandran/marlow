export interface Memory { trust: number; lastTrustLoss: string | null; runs: number }
export const FRESH_MEMORY: Memory = { trust: 50, lastTrustLoss: null, runs: 0 };
export interface MemoryStore { load(): Memory; save(m: Memory): void }

export class InMemoryStore implements MemoryStore {
  constructor(private m: Memory = { ...FRESH_MEMORY }) {}
  load() { return { ...this.m }; }
  save(m: Memory) { this.m = { ...m }; }
}
