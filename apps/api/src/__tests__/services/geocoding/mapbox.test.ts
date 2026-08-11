import { describe, it, expect, jest } from "@jest/globals";

import { MapboxGeocodingProvider } from "../../../services/geocoding/mapbox.js";
import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";

const okRes = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const errRes = (status: number): Response =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

const FEATURE = {
  center: [-111.9, 40.7],
  place_name: "123 Main St, Salt Lake City, Utah",
  relevance: 0.95,
  text: "123 Main St",
  place_type: ["address"],
  context: [
    { id: "place.1", text: "Salt Lake City" },
    { id: "region.1", text: "Utah" },
  ],
};

describe("MapboxGeocodingProvider (#315)", () => {
  it("geocode parses center → lat/lng, place_name, relevance → confidence", async () => {
    const fetchImpl = jest.fn(async () =>
      okRes({ features: [FEATURE] })
    ) as unknown as typeof fetch;
    const provider = new MapboxGeocodingProvider("key", fetchImpl);
    const hit = await provider.geocode("123 Main St");
    expect(hit).toEqual({
      lat: 40.7,
      lng: -111.9,
      formattedAddress: "123 Main St, Salt Lake City, Utah",
      confidence: 0.95,
    });
  });

  it("geocode → GEOCODE_PROVIDER_UNAVAILABLE when the request throws", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const provider = new MapboxGeocodingProvider("key", fetchImpl);
    await expect(provider.geocode("x")).rejects.toMatchObject({
      code: ApiCode.GEOCODE_PROVIDER_UNAVAILABLE,
    });
  });

  it("geocode → GEOCODE_PROVIDER_UNAVAILABLE on a non-ok response", async () => {
    const fetchImpl = jest.fn(async () =>
      errRes(500)
    ) as unknown as typeof fetch;
    const provider = new MapboxGeocodingProvider("key", fetchImpl);
    await expect(provider.geocode("x")).rejects.toMatchObject({
      code: ApiCode.GEOCODE_PROVIDER_UNAVAILABLE,
    });
  });

  it("geocode → GEOCODE_ADDRESS_UNRESOLVED for a low-confidence partial match (#315 smoke)", async () => {
    // Mapbox partial-matches garbage ("99999" → a postal fragment @ 0.5)
    // rather than returning empty; a sub-threshold relevance is unresolved.
    const fetchImpl = jest.fn(async () =>
      okRes({ features: [{ ...FEATURE, relevance: 0.5 }] })
    ) as unknown as typeof fetch;
    const provider = new MapboxGeocodingProvider("key", fetchImpl);
    await expect(provider.geocode("99999")).rejects.toMatchObject({
      code: ApiCode.GEOCODE_ADDRESS_UNRESOLVED,
    });
  });

  it("geocode → GEOCODE_ADDRESS_UNRESOLVED when no feature matches", async () => {
    const fetchImpl = jest.fn(async () =>
      okRes({ features: [] })
    ) as unknown as typeof fetch;
    const provider = new MapboxGeocodingProvider("key", fetchImpl);
    const err = await provider.geocode("nowhere").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(ApiCode.GEOCODE_ADDRESS_UNRESOLVED);
  });

  it("reverseGeocode queries lng,lat and returns address + components", async () => {
    const fetchImpl = jest.fn(async () =>
      okRes({ features: [FEATURE] })
    ) as unknown as typeof fetch;
    const provider = new MapboxGeocodingProvider("key", fetchImpl);
    const hit = await provider.reverseGeocode(40.7, -111.9);
    expect(hit.address).toBe("123 Main St, Salt Lake City, Utah");
    expect(hit.components).toMatchObject({
      address: "123 Main St",
      place: "Salt Lake City",
      region: "Utah",
    });
    // The request URL encodes `lng,lat`.
    const url = (fetchImpl as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent("-111.9,40.7"));
  });

  it("reverseGeocode → GEOCODE_ADDRESS_UNRESOLVED when no feature matches", async () => {
    const fetchImpl = jest.fn(async () =>
      okRes({ features: [] })
    ) as unknown as typeof fetch;
    const provider = new MapboxGeocodingProvider("key", fetchImpl);
    await expect(provider.reverseGeocode(0, 0)).rejects.toMatchObject({
      code: ApiCode.GEOCODE_ADDRESS_UNRESOLVED,
    });
  });
});
