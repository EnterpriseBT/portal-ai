/**
 * Provider-agnostic geocoding seam (#315). The tools depend on this interface,
 * never a concrete provider — swapping Mapbox for another vendor (or a
 * self-hosted Nominatim later) is a construction change, not a tool rewrite.
 *
 * Failures are thrown as typed `ApiError`s (`GEOCODE_PROVIDER_UNAVAILABLE` /
 * `GEOCODE_ADDRESS_UNRESOLVED`) so the tool layer relays them as typed results —
 * the agent must never fabricate coordinates.
 */

/** A forward-geocode result: an address resolved to WGS84 coordinates. */
export interface GeocodeHit {
  lat: number;
  lng: number;
  formattedAddress: string;
  /** Provider match confidence in [0, 1]. */
  confidence: number;
}

/** A reverse-geocode result: coordinates resolved to an address. */
export interface ReverseHit {
  address: string;
  components: Record<string, string>;
  /** Provider match confidence in [0, 1]. */
  confidence: number;
}

export interface GeocodingProvider {
  /** Stable provider id, used in the cache key namespace. */
  readonly name: string;
  geocode(address: string): Promise<GeocodeHit>;
  reverseGeocode(lat: number, lng: number): Promise<ReverseHit>;
}
