import { describe, it, expect, jest } from "@jest/globals";
import type { Redis } from "ioredis";

import { GeocodeTool } from "../../tools/geocode.tool.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import type {
  GeocodeHit,
  GeocodingProvider,
} from "../../services/geocoding/provider.js";

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    },
    exists: async (k: string) => (store.has(k) ? 1 : 0),
  } as unknown as Redis;
}

const HIT: GeocodeHit = {
  lat: 40.7,
  lng: -111.9,
  formattedAddress: "123 Main St",
  confidence: 0.9,
};

const provider = (
  geocode: GeocodingProvider["geocode"]
): GeocodingProvider => ({
  name: "mapbox",
  geocode,
  reverseGeocode: async () => {
    throw new Error("unused");
  },
});

type Built = { execute: (input: unknown) => Promise<Record<string, unknown>> };
const run = (t: unknown, input: unknown) => (t as Built).execute(input);

describe("GeocodeTool (#315)", () => {
  it("throws at build() when no key and no injected provider", () => {
    expect(() => new GeocodeTool().build()).toThrow(/api key/i);
  });

  it("resolves through the provider and caches (cached:false), then serves the cache (cached:true)", async () => {
    const geocode = jest.fn(async () => HIT);
    const redis = fakeRedis();
    const t = new GeocodeTool().build({ provider: provider(geocode), redis });

    const first = await run(t, { address: "123 Main St" });
    expect(first).toEqual({ ...HIT, cached: false });

    const second = await run(t, { address: "  123 MAIN st " });
    expect(second).toEqual({ ...HIT, cached: true });
    // The provider was hit once; the normalized repeat came from cache.
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("returns a typed { error } (never a throw) when the provider is unavailable", async () => {
    const geocode = jest.fn(async () => {
      throw new ApiError(
        503,
        ApiCode.GEOCODE_PROVIDER_UNAVAILABLE,
        "provider down"
      );
    });
    const t = new GeocodeTool().build({
      provider: provider(geocode),
      redis: fakeRedis(),
    });
    const out = await run(t, { address: "x" });
    expect(out).toEqual({
      error: expect.objectContaining({
        code: ApiCode.GEOCODE_PROVIDER_UNAVAILABLE,
      }),
    });
  });

  it("returns a typed { error } for an unresolvable address", async () => {
    const geocode = jest.fn(async () => {
      throw new ApiError(422, ApiCode.GEOCODE_ADDRESS_UNRESOLVED, "no match");
    });
    const t = new GeocodeTool().build({
      provider: provider(geocode),
      redis: fakeRedis(),
    });
    const out = await run(t, { address: "nowhere" });
    expect((out.error as { code: string }).code).toBe(
      ApiCode.GEOCODE_ADDRESS_UNRESOLVED
    );
  });
});
