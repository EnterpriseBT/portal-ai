/**
 * Resource-limit constants for the large-data-ops feature
 * (issue #85). Shared between apps/api and (eventually) apps/web.
 *
 * See docs/LARGE_DATA_OPS_PHASE_1.spec.md for the contract these
 * values pin.
 */

/** Per-job cap on total records written; bulk tool route rejects past this. */
export const MAX_BULK_RECORDS = 1_000_000;

/** Default batch size for bulk transforms (per-batch UPSERT count). */
export const DEFAULT_BULK_BATCH = 1_000;

/** Max concurrent non-terminal bulk jobs per organization. */
export const MAX_CONCURRENT_BULK_PER_ORG = 2;

/** Max bytes of serialized row payload per `job:batch` SSE event. */
export const BATCH_ROW_PAYLOAD_LIMIT = 256 * 1024;

/** TTL on a Redis-cached query handle. */
export const READ_HANDLE_TTL_MS = 24 * 60 * 60 * 1000;

/** TTL on a scoped webhook read/write token (#124). Short by design — the
 *  grant lives only for the duration of one webhook call; it is also revoked
 *  when the call settles, and bounded above by the handle's remaining TTL. */
export const WEBHOOK_READ_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Above this row count, reads automatically sample. */
export const SAMPLING_THRESHOLD = 50_000;

/**
 * Defensive per-layer render clamp for the inline map path (#84 / #314).
 * `visualize_map` delivers small results inline and larger ones as vector
 * tiles via the shared sink threshold (`INLINE_ROWS_THRESHOLD`), and the LLM
 * SQL layer itself caps at `PORTAL_SQL_DEFAULTS.rowCap`, so in normal operation
 * an inline layer stays well under this. It is the backstop that clamps +
 * surfaces a "showing first N of M" notice if more features ever reach the
 * renderer inline (e.g. a pinned snapshot); large layers take the tile path,
 * which transfers only the viewport.
 */
export const MAP_LAYER_FEATURE_CAP = 10_000;

/** Per-query wall-clock cap for a SYNCHRONOUS query; PG `statement_timeout`.
 *  The job tier (#130 E1) runs past this off-thread — see
 *  `SQL_QUERY_JOB_TIMEOUT_MS`. */
export const STATEMENT_TIMEOUT_MS = 30_000;

/** Wall-clock cap for an aggregate/scan run at the JOB tier (#130 E1) —
 *  off the request thread, so it can run far longer than the synchronous
 *  `STATEMENT_TIMEOUT_MS`. Matches the prior `bulk_aggregate` 120s budget
 *  that `sql_query@job` rehomes. */
export const SQL_QUERY_JOB_TIMEOUT_MS = 120_000;

/** Below this row count, reads still inline rows instead of returning a handle. */
export const INLINE_ROWS_THRESHOLD = 100;

/** Max rows a query handle stages in Redis; results past this truncate
 *  (the handle's `truncated` flag is set and only this many rows are cached). */
export const HANDLE_ROW_CAP = 100_000;

/**
 * Max rows a result **table lists** (#277). A deliberate display cap, not a
 * data limit: every staged row is still analysed server-side by aggregates and
 * the analytics tools — a listing of 10,000+ rows is simply unusable, and the
 * useful response to an oversized result is to narrow the query.
 *
 * Shared because four surfaces must agree on it: the table's fetch, its
 * "showing the first N of M" notice, and the two agent-facing tool
 * descriptions that tell the agent how to narrate a capped result. The
 * snapshot endpoint's own per-request clamp is a separate payload guard and is
 * the effective ceiling if it is ever set lower than this.
 */
export const TABLE_DISPLAY_ROW_LIMIT = 5_000;

/** Max rows persisted into a pinned result's stored snapshot (#312). Bound to
 *  the display limit — rows beyond it are unreachable in a pinned table
 *  anyway; `truncated`/`rowCount` on the stored content record the excess. */
export const PIN_SNAPSHOT_ROW_CAP = TABLE_DISPLAY_ROW_LIMIT;

/** A `d3` widget auto-refreshes when its data is older than this (#270). Short
 *  enough to read as "live", long enough that re-viewing/scrolling past a widget
 *  costs no SQL. Tunable; kept in the 2–5 min band. */
export const VIZ_REFRESH_FRESHNESS_MS = 3 * 60 * 1000;

/** Per-org ceiling on widget refreshes per minute (#270) — an abuse backstop on
 *  the free, unmetered refresh endpoint. The freshness gate is the primary
 *  volume control; this is the hard cap. */
export const VIZ_REFRESH_RATE_PER_MIN = 120;

/** The in-memory *materialization* threshold for a pure compute tool (#114),
 *  not a processing ceiling (#129). Equal to HANDLE_ROW_CAP — the read
 *  primitive stages at most that many rows in Redis, so this is the
 *  faithful-inline limit for the `bounded` path (`resolveRecordSource`).
 *  A `streaming` tool folds *past* it over the cursor (`resolveRecordStream`
 *  → keyset re-execution), one batch resident, with no row ceiling. The
 *  COMPUTE_INPUT_TOO_LARGE error is now scoped to the cases the cursor can't
 *  serve: `bounded` + `onOverflow:error`, and a `streaming` tool over a >cap
 *  source that lacks a keyset (no projected `id` / no declared order). */
export const COMPUTE_MAX_ROWS = HANDLE_ROW_CAP;

/**
 * Low-zoom map aggregation defaults (#330), shared by the server tile query and
 * the web layer/paint so the two agree without a round-trip.
 * - `AGG_ZOOM_THRESHOLD`: aggregate at `z < this`, raw features at `z >= this`.
 *   MapLibre zoom bounds are min-inclusive / max-exclusive, so the aggregate
 *   fill (`maxzoom = threshold`) and the raw layer (`minzoom = threshold`) hand
 *   off cleanly at exactly this zoom with no overlap. Set so raw only takes over
 *   once a tile is under `MAP_TILE_FEATURE_CAP`: a dense layer (≈400k county
 *   parcels) still packs ~22k features into a z12 tile and ~10k into z13 — both
 *   over the cap, so raw there would clip to an arbitrary, spatially-patchy
 *   subset. z14 drops to ~2.5k (clean). Overridable per layer for sparser data.
 * - `AGG_GRID_PX`: target grid-cell size in screen pixels (server derives the
 *   world-unit cell size per tile from this).
 * - `AGG_DENSITY_MAX`: upper bound of the log-scaled density domain used to
 *   shade cells when a layer has no `colorBy` (fixed, not per-tile normalized).
 */
export const AGG_ZOOM_THRESHOLD = 14;
export const AGG_GRID_PX = 24;
export const AGG_DENSITY_MAX = 5000;

/**
 * Precomputed polygon-dissolve zoom bands (#472, retuned #478). Below the z14
 * raw handoff, a polygon choropleth is served from a per-pin dissolved +
 * simplified geometry (one MultiPolygon per colorBy value per band). Each band
 * covers `[prev, maxZoomExclusive)` and is dissolved+simplified for its
 * `representativeZoom` (the server derives the tolerance via
 * `tileSimplifyTolerance`). Bands are disjoint and cover z0–13; z≥14 stays the
 * raw path (#450 already fast there). `bandForZoom` returns `null` at/above the
 * threshold.
 *
 * #478: five bands (was three) so the merge-granularity steps gently across
 * zoom (~2.7× per boundary) instead of one ~20× jump at z8 that visibly
 * "exploded" a merged region into its parcels. The added bands are the *cheap*
 * coarse ones (z7/z8 rep); the expensive fine unions (z9/z12 rep) are unchanged.
 * Measured piece counts per rep zoom on a 397,960-parcel layer: z6≈444, z7≈1227,
 * z8≈3272, z9≈8781, z12≈13336.
 */
export const DISSOLVE_ZOOM_BANDS = [
  { band: 0, maxZoomExclusive: 7, representativeZoom: 6 },
  { band: 1, maxZoomExclusive: 8, representativeZoom: 7 },
  { band: 2, maxZoomExclusive: 9, representativeZoom: 8 },
  { band: 3, maxZoomExclusive: 11, representativeZoom: 9 },
  { band: 4, maxZoomExclusive: AGG_ZOOM_THRESHOLD, representativeZoom: 12 },
] as const;

/** Zoom → dissolve band index, or `null` at/above `AGG_ZOOM_THRESHOLD` (raw path). */
export function bandForZoom(z: number): number | null {
  for (const b of DISSOLVE_ZOOM_BANDS) {
    if (z < b.maxZoomExclusive) return b.band;
  }
  return null;
}

/**
 * Max distinct colorBy values a choropleth may have to be dissolved (#472). A
 * choropleth with more categories than this isn't legible anyway; over the
 * ceiling the pin is left to the raw-simplify fallback. Bounds stored rows at
 * `ceiling × DISSOLVE_ZOOM_BANDS.length` per pin.
 */
export const DISSOLVE_CARDINALITY_CEILING = 64;

/**
 * Geocode address-cache TTL (#315). An address→coordinates mapping is
 * effectively static public data, so the global Redis cache holds a hit for a
 * long window — a repeat lookup never re-charges the org's quota. 30 days.
 */
export const GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
