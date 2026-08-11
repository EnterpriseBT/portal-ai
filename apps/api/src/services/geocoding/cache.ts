import type { Redis } from "ioredis";

import { GEOCODE_CACHE_TTL_MS } from "@portalai/core/constants";

import { getRedisClient } from "../../utils/redis.util.js";
import type { GeocodeHit } from "./provider.js";

/**
 * Global, zero-unit geocode address cache (#315). An address→coordinates
 * mapping is org-independent public data, so the cache is **global** (not
 * per-org) and a hit costs the org 0 units via the registered cost resolver.
 *
 * Keyed by the *normalized* address (lowercase / trimmed / whitespace-collapsed)
 * so trivial formatting differences share a hit. The value is the full
 * `GeocodeHit` so a cache hit needs no provider round-trip.
 */

/** Lowercase, trim, and collapse internal whitespace so equivalent addresses
 *  ("123  Main St " vs "123 main st") share one cache entry. */
export const normalizeAddress = (address: string): string =>
  address.toLowerCase().trim().replace(/\s+/g, " ");

/** Cache key namespace: `geocode:v1:<provider>:<normalized-address>`. The `v1`
 *  lets the value shape evolve without stale reads. */
export const geocodeCacheKey = (provider: string, address: string): string =>
  `geocode:v1:${provider}:${normalizeAddress(address)}`;

const ttlSeconds = () => Math.floor(GEOCODE_CACHE_TTL_MS / 1000);

export async function cacheGet(
  provider: string,
  address: string,
  redis: Redis = getRedisClient()
): Promise<GeocodeHit | null> {
  const raw = await redis.get(geocodeCacheKey(provider, address));
  return raw ? (JSON.parse(raw) as GeocodeHit) : null;
}

export async function cacheSet(
  provider: string,
  address: string,
  hit: GeocodeHit,
  redis: Redis = getRedisClient()
): Promise<void> {
  await redis.set(
    geocodeCacheKey(provider, address),
    JSON.stringify(hit),
    "EX",
    ttlSeconds()
  );
}

/** Whether a forward-geocode hit is cached — the cost resolver reads this to
 *  charge 0 units on a repeat. */
export async function cacheHas(
  provider: string,
  address: string,
  redis: Redis = getRedisClient()
): Promise<boolean> {
  return (await redis.exists(geocodeCacheKey(provider, address))) === 1;
}
