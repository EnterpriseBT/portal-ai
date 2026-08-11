import { z } from "zod";
import { tool } from "ai";
import type { Redis } from "ioredis";

import { environment } from "../environment.js";
import { Tool } from "../types/tools.js";
import { ApiError } from "../services/http.service.js";
import { MapboxGeocodingProvider } from "../services/geocoding/mapbox.js";
import type { GeocodingProvider } from "../services/geocoding/provider.js";
import { cacheGet, cacheSet } from "../services/geocoding/cache.js";

const InputSchema = z.object({
  address: z.string().min(1).describe("The address or place to geocode."),
});

/** Injected for tests: a fake provider + redis so `execute` runs without a
 *  live key or a live Redis. */
export interface GeocodeToolDeps {
  provider?: GeocodingProvider;
  redis?: Redis;
}

/**
 * `geocode` (#315) — an address → WGS84 coordinates. `metered`: a live provider
 * call costs 1 unit; a cache hit costs 0 (the registered cost resolver reads the
 * same cache). Provider/unresolved failures return a typed `{ error }` the agent
 * relays — it must never fabricate coordinates.
 */
export class GeocodeTool extends Tool<typeof InputSchema> {
  slug = "geocode";
  name = "Geocode";
  description =
    "Convert an address or place name into latitude/longitude coordinates (WGS84). Use before visualize_map when the data has addresses but no coordinates. Never invent coordinates — relay a typed failure if the address can't be resolved.";

  get schema() {
    return InputSchema;
  }

  build(deps: GeocodeToolDeps = {}) {
    if (!deps.provider && !environment.GEOCODING_API_KEY)
      throw new Error("Geocoding API key not configured");
    const provider =
      deps.provider ??
      new MapboxGeocodingProvider(environment.GEOCODING_API_KEY as string);

    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { address } = this.validate(input);
        try {
          const cached = await cacheGet(provider.name, address, deps.redis);
          if (cached) return { ...cached, cached: true };
          const hit = await provider.geocode(address);
          await cacheSet(provider.name, address, hit, deps.redis);
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
