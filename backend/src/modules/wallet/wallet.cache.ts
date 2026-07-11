// Minimal in-memory TTL cache, scoped to this module.
//
// Not a general-purpose utility deliberately - this project has exactly
// one cacheable, side-effect-free lookup today (ENS resolution), and a
// dependency-free ~20-line Map is a better trade at this scale than
// adding a package (e.g. lru-cache) for a single call site. If a second
// module needs the same shape later, that's the trigger to promote this
// to backend/src/utils/, not before (see architecture Section 24's "does
// this provide genuine value at this project's scale" test).
//
// Explicitly NOT a substitute for the rate-limiting work (gap #3,
// deferred): this caches by key (address/name), so it reduces redundant
// RPC calls for the SAME lookup, but does nothing to bound the number of
// DISTINCT lookups a single caller can trigger. Real abuse protection
// still depends on rate limiting landing on any endpoint that ends up
// calling into this module.

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  private readonly store = new Map<string, CacheEntry<V>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Test-only escape hatch, same pattern as the Blockchain module's _reset*ForTests. */
  _clearForTests(): void {
    this.store.clear();
  }
}
