import { describe, it, expect } from "@jest/globals";
import type { Redis } from "ioredis";

import {
  cacheGet,
  cacheHas,
  cacheSet,
  geocodeCacheKey,
  normalizeAddress,
} from "../../../services/geocoding/cache.js";
import type { GeocodeHit } from "../../../services/geocoding/provider.js";

/** A minimal in-memory stand-in for the ioredis surface the cache uses. */
function fakeRedis() {
  const store = new Map<string, string>();
  const redis = {
    store,
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    },
    exists: async (k: string) => (store.has(k) ? 1 : 0),
  } as unknown as Redis & { store: Map<string, string> };
  return redis;
}

const HIT: GeocodeHit = {
  lat: 40.7,
  lng: -111.9,
  formattedAddress: "123 Main St, Salt Lake City, UT",
  confidence: 0.99,
};

describe("geocoding cache (#315)", () => {
  it("normalizeAddress lowercases, trims, and collapses whitespace", () => {
    expect(normalizeAddress("  123   Main St ")).toBe("123 main st");
    expect(normalizeAddress("123 MAIN st")).toBe("123 main st");
  });

  it("geocodeCacheKey is namespaced + normalized", () => {
    expect(geocodeCacheKey("mapbox", " 123  Main St ")).toBe(
      "geocode:v1:mapbox:123 main st"
    );
    // Formatting-different addresses collapse to the same key.
    expect(geocodeCacheKey("mapbox", "123 MAIN ST")).toBe(
      geocodeCacheKey("mapbox", "123 main st")
    );
  });

  it("cacheHas is false before a set and true after (per normalized key)", async () => {
    const redis = fakeRedis();
    expect(await cacheHas("mapbox", "123 Main St", redis)).toBe(false);
    await cacheSet("mapbox", "123 Main St", HIT, redis);
    expect(await cacheHas("mapbox", "  123 main st ", redis)).toBe(true);
  });

  it("cacheSet → cacheGet round-trips the full hit", async () => {
    const redis = fakeRedis();
    expect(await cacheGet("mapbox", "123 Main St", redis)).toBeNull();
    await cacheSet("mapbox", "123 Main St", HIT, redis);
    expect(await cacheGet("mapbox", "123 Main St", redis)).toEqual(HIT);
  });
});
