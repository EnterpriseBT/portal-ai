import { z } from "zod";
import { tool } from "ai";
import type { Redis } from "ioredis";

import { environment } from "../environment.js";
import { Tool } from "../types/tools.js";
import { ApiError } from "../services/http.service.js";
import { MapboxGeocodingProvider } from "../services/geocoding/mapbox.js";
import type { GeocodingProvider } from "../services/geocoding/provider.js";
import {
  reverseCacheGet,
  reverseCacheSet,
} from "../services/geocoding/cache.js";

const InputSchema = z.object({
  lat: z.number().min(-90).max(90).describe("Latitude in WGS84."),
  lng: z.number().min(-180).max(180).describe("Longitude in WGS84."),
});

export interface ReverseGeocodeToolDeps {
  provider?: GeocodingProvider;
  redis?: Redis;
}

/**
 * `reverse_geocode` (#315) — WGS84 coordinates → an address. `metered`, same
 * zero-unit-on-cache-hit contract as `geocode`; failures return a typed
 * `{ error }` the agent relays.
 */
export class ReverseGeocodeTool extends Tool<typeof InputSchema> {
  slug = "reverse_geocode";
  name = "Reverse Geocode";
  description =
    "Convert latitude/longitude coordinates (WGS84) into a human-readable address. Never invent an address — relay a typed failure if the coordinates can't be resolved.";

  get schema() {
    return InputSchema;
  }

  build(deps: ReverseGeocodeToolDeps = {}) {
    if (!deps.provider && !environment.GEOCODING_API_KEY)
      throw new Error("Geocoding API key not configured");
    const provider =
      deps.provider ??
      new MapboxGeocodingProvider(environment.GEOCODING_API_KEY as string);

    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { lat, lng } = this.validate(input);
        try {
          const cached = await reverseCacheGet(
            provider.name,
            lat,
            lng,
            deps.redis
          );
          if (cached) return { ...cached, cached: true };
          const hit = await provider.reverseGeocode(lat, lng);
          await reverseCacheSet(provider.name, lat, lng, hit, deps.redis);
          return { ...hit, cached: false };
        } catch (err) {
          if (err instanceof ApiError)
            return {
              error: {
                code: err.code,
                message: err.message,
                recommendation: err.recommendation,
              },
            };
          throw err;
        }
      },
    });
  }
}
