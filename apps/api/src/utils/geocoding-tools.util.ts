import { environment } from "../environment.js";

/**
 * Which geocoding tools a session builds (#315, #615) — the single rule both
 * `ToolService.buildAnalyticsTools` (which builds them) and the station
 * context behind the system prompt (which describes them) read, so the prompt
 * can never offer a geocoding tool the session lacks.
 *
 * Both need the `gis` pack and `GEOCODING_API_KEY` (a keyless env would
 * throw at build). `bulk_geocode_records` is an async job tied to a portal,
 * so it also needs one. It writes, so the station write gate may still
 * withhold it afterwards; that's the caller's `stationWritable`, not this.
 */
export function geocodingTools(opts: { gis: boolean; inPortal: boolean }): {
  geocode: boolean;
  bulkGeocode: boolean;
} {
  const configured = opts.gis && Boolean(environment.GEOCODING_API_KEY);
  return { geocode: configured, bulkGeocode: configured && opts.inPortal };
}
