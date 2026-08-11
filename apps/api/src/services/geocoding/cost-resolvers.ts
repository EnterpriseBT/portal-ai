import { registerCostResolver } from "../cost-gate.service.js";
import { cacheHas, reverseCacheHas } from "./cache.js";
import { MAPBOX_PROVIDER_NAME } from "./mapbox.js";

/**
 * Register the geocode cost resolvers (#315): a live provider call costs 1 unit,
 * a cache hit costs **0** — so repeats never touch the org's quota. Legal
 * because `CostResolver` may return a `Promise<number>` (`cost-gate.service.ts`),
 * and the resolver reads the *same* cache key the tool writes under.
 *
 * The cache-presence checks are injectable so the unit test drives 0-vs-1
 * without a live Redis.
 */
export function registerGeocodingCostResolvers(deps?: {
  forwardHas?: (address: string) => Promise<boolean>;
  reverseHas?: (lat: number, lng: number) => Promise<boolean>;
}): void {
  const forwardHas =
    deps?.forwardHas ??
    ((address: string) => cacheHas(MAPBOX_PROVIDER_NAME, address));
  const reverseHas =
    deps?.reverseHas ??
    ((lat: number, lng: number) =>
      reverseCacheHas(MAPBOX_PROVIDER_NAME, lat, lng));

  registerCostResolver("geocode", async (input) => {
    const { address } = input as { address: string };
    return (await forwardHas(address)) ? 0 : 1;
  });
  registerCostResolver("reverse_geocode", async (input) => {
    const { lat, lng } = input as { lat: number; lng: number };
    return (await reverseHas(lat, lng)) ? 0 : 1;
  });
}
