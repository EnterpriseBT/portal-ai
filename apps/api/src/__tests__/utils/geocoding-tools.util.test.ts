import { describe, it, expect, afterEach } from "@jest/globals";

import { environment } from "../../environment.js";
import { geocodingTools } from "../../utils/geocoding-tools.util.js";

describe("geocodingTools (#615)", () => {
  const original = environment.GEOCODING_API_KEY;
  afterEach(() => {
    environment.GEOCODING_API_KEY = original;
  });

  it("builds nothing without the gis pack, key or not", () => {
    environment.GEOCODING_API_KEY = "key";
    expect(geocodingTools({ gis: false, inPortal: true })).toEqual({
      geocode: false,
      bulkGeocode: false,
    });
  });

  it("builds nothing without a geocoding key", () => {
    environment.GEOCODING_API_KEY = "";
    expect(geocodingTools({ gis: true, inPortal: true })).toEqual({
      geocode: false,
      bulkGeocode: false,
    });
  });

  it("builds bulk geocoding only inside a portal", () => {
    environment.GEOCODING_API_KEY = "key";
    expect(geocodingTools({ gis: true, inPortal: false })).toEqual({
      geocode: true,
      bulkGeocode: false,
    });
    expect(geocodingTools({ gis: true, inPortal: true })).toEqual({
      geocode: true,
      bulkGeocode: true,
    });
  });
});
