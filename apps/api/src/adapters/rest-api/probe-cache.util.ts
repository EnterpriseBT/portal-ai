/**
 * In-process TTL cache for the REST API probe pipeline.
 *
 * One instance per Node process, instantiated at adapter-registry
 * construction time and injected into `RestApiAdapter`. The probe
 * route writes the merged heuristic + AI-assist result on miss and
 * reads it on subsequent calls within the 60-second TTL window.
 *
 * No background pruning — expired entries are dropped lazily on the
 * next `get(key)` for that key. Concurrent in-flight probes for the
 * same key are not deduplicated; both run and the second write wins
 * (acceptable at v1 scale; in-flight dedup is a v2 polish).
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ProbeCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly defaultTtlMs: number = 60_000) {}

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Debug-only; not part of the contract callers should depend on. */
  size(): number {
    return this.store.size;
  }
}
