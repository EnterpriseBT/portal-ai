import { describe, it, expect } from "@jest/globals";

import { registerGeocodingCostResolvers } from "../../../services/geocoding/cost-resolvers.js";
import { resolveCallCost } from "../../../services/cost-gate.service.js";

describe("geocoding cost resolvers (#315)", () => {
  it("charge 0 units on a cache hit, 1 on a miss (geocode + reverse_geocode)", async () => {
    registerGeocodingCostResolvers({
      forwardHas: async () => true,
      reverseHas: async () => true,
    });
    expect(await resolveCallCost("geocode", { address: "x" })).toBe(0);
    expect(await resolveCallCost("reverse_geocode", { lat: 1, lng: 2 })).toBe(
      0
    );

    registerGeocodingCostResolvers({
      forwardHas: async () => false,
      reverseHas: async () => false,
    });
    expect(await resolveCallCost("geocode", { address: "x" })).toBe(1);
    expect(await resolveCallCost("reverse_geocode", { lat: 1, lng: 2 })).toBe(
      1
    );
  });
});
