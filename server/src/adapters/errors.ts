/** Thrown by adapters whose provider call shape has not been confirmed from official docs (brief rule 8). */
export class NotConfigured extends Error {
  constructor(public what: string) { super(`NotConfigured: ${what}`); }
}
