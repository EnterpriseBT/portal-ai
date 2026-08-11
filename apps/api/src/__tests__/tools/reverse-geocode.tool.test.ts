import { describe, it, expect, jest } from "@jest/globals";
import type { Redis } from "ioredis";

import { ReverseGeocodeTool } from "../../tools/reverse-geocode.tool.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import type {
  GeocodingProvider,
  ReverseHit,
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

const HIT: ReverseHit = {
  address: "123 Main St",
  components: { place: "SLC" },
  confidence: 0.8,
};

const provider = (
  reverseGeocode: GeocodingProvider["reverseGeocode"]
): GeocodingProvider => ({
  name: "mapbox",
  geocode: async () => {
    throw new Error("unused");
  },
  reverseGeocode,
});

type Built = { execute: (input: unknown) => Promise<Record<string, unknown>> };
const run = (t: unknown, input: unknown) => (t as Built).execute(input);

describe("ReverseGeocodeTool (#315)", () => {
  it("throws at build() when no key and no injected provider", () => {
    expect(() => new ReverseGeocodeTool().build()).toThrow(/api key/i);
  });

  it("resolves then serves the cache (cached:true) for the same coordinate", async () => {
    const reverseGeocode = jest.fn(async () => HIT);
    const redis = fakeRedis();
    const t = new ReverseGeocodeTool().build({
      provider: provider(reverseGeocode),
      redis,
    });

    expect(await run(t, { lat: 40.7, lng: -111.9 })).toEqual({
      ...HIT,
      cached: false,
    });
    expect(await run(t, { lat: 40.7, lng: -111.9 })).toEqual({
      ...HIT,
      cached: true,
    });
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
  });

  it("returns a typed { error } for an unresolvable coordinate", async () => {
    const reverseGeocode = jest.fn(async () => {
      throw new ApiError(422, ApiCode.GEOCODE_ADDRESS_UNRESOLVED, "no match");
    });
    const t = new ReverseGeocodeTool().build({
      provider: provider(reverseGeocode),
      redis: fakeRedis(),
    });
    const out = await run(t, { lat: 0, lng: 0 });
    expect((out.error as { code: string }).code).toBe(
      ApiCode.GEOCODE_ADDRESS_UNRESOLVED
    );
  });
});
