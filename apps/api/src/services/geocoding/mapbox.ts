import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import type { GeocodeHit, GeocodingProvider, ReverseHit } from "./provider.js";

const MAPBOX_BASE = "https://api.mapbox.com/geocoding/v5/mapbox.places";

/** Stable provider id — the cache-key namespace + the cost-resolver's cache
 *  lookups both reference it, so a hit charges 0 for the same key the tool
 *  wrote under. */
export const MAPBOX_PROVIDER_NAME = "mapbox";

/**
 * Minimum Mapbox `relevance` to trust a match (#315 smoke). Mapbox rarely
 * returns *zero* features for garbage input — it partial-matches (e.g. "99999"
 * → a postal fragment at relevance 0.5). Below this cutoff we treat the result
 * as **unresolved** (a typed failure the agent relays) rather than returning —
 * and billing + caching — a low-confidence coordinate. A well-formed address
 * scores ≥ ~0.75; 0.6 rejects the observed partial-postal noise while keeping
 * legitimate matches. Deliberately conservative — a valid-but-partial address
 * near the cutoff may be rejected, which is safer than a confident-looking
 * wrong coordinate.
 */
export const MAPBOX_MIN_RELEVANCE = 0.6;

/** Mapbox feature shape (only the fields we read). */
interface MapboxFeature {
  center: [number, number]; // [lng, lat]
  place_name: string;
  relevance?: number;
  text?: string;
  place_type?: string[];
  context?: Array<{ id: string; text: string }>;
}

/**
 * The only `GeocodingProvider` implementation (#315) — Mapbox's forward/reverse
 * geocoding v5 API. Provider/transport errors throw
 * `GEOCODE_PROVIDER_UNAVAILABLE`; an empty result throws
 * `GEOCODE_ADDRESS_UNRESOLVED`. `fetch` is injected so the tool tests drive it
 * without a live key.
 */
export class MapboxGeocodingProvider implements GeocodingProvider {
  readonly name = MAPBOX_PROVIDER_NAME;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async request(query: string): Promise<MapboxFeature> {
    const url = `${MAPBOX_BASE}/${encodeURIComponent(query)}.json?access_token=${this.apiKey}&limit=1`;
    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch (err) {
      throw new ApiError(
        503,
        ApiCode.GEOCODE_PROVIDER_UNAVAILABLE,
        `Geocoding provider request failed: ${(err as Error).message}`,
        {
          recommendation:
            "The geocoding provider is unreachable. Relay this and retry later — do not invent coordinates.",
        }
      );
    }
    if (!res.ok) {
      throw new ApiError(
        503,
        ApiCode.GEOCODE_PROVIDER_UNAVAILABLE,
        `Geocoding provider returned ${res.status}.`,
        {
          recommendation:
            "The geocoding provider errored. Relay this and retry later — do not invent coordinates.",
        }
      );
    }
    const body = (await res.json()) as { features?: MapboxFeature[] };
    const feature = body.features?.[0];
    if (!feature) {
      throw new ApiError(
        422,
        ApiCode.GEOCODE_ADDRESS_UNRESOLVED,
        `No geocoding match for "${query}".`,
        {
          recommendation:
            "The provider found no match. Ask the user to refine it — do not invent coordinates.",
        }
      );
    }
    // A low-relevance partial match is untrustworthy — treat it as unresolved
    // so it surfaces as a typed failure the agent relays (never a
    // confident-looking wrong coordinate; #315 smoke).
    if ((feature.relevance ?? 0) < MAPBOX_MIN_RELEVANCE) {
      throw new ApiError(
        422,
        ApiCode.GEOCODE_ADDRESS_UNRESOLVED,
        `Only a low-confidence match (relevance ${feature.relevance ?? 0}) for "${query}" — treating as unresolved.`,
        {
          recommendation:
            "The provider returned only a weak partial match. Ask the user to refine it — do not invent coordinates.",
        }
      );
    }
    return feature;
  }

  async geocode(address: string): Promise<GeocodeHit> {
    const f = await this.request(address);
    return {
      lat: f.center[1],
      lng: f.center[0],
      formattedAddress: f.place_name,
      confidence: f.relevance ?? 0,
    };
  }

  async reverseGeocode(lat: number, lng: number): Promise<ReverseHit> {
    // Mapbox reverse geocoding queries `lng,lat`.
    const f = await this.request(`${lng},${lat}`);
    const components: Record<string, string> = {};
    if (f.text && f.place_type?.[0]) components[f.place_type[0]] = f.text;
    for (const c of f.context ?? []) {
      const kind = c.id.split(".")[0];
      if (kind) components[kind] = c.text;
    }
    return {
      address: f.place_name,
      components,
      confidence: f.relevance ?? 0,
    };
  }
}
