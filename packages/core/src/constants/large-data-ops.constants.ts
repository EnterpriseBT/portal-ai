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

/** Max features rendered per inline map layer (#84 / #314). Bounds the client;
 *  the wire payload is already bounded by the sink threshold + handle snapshot
 *  cap. Applies to the inline path only — the vector-tile path transfers just
 *  the viewport, so large layers render through tiles instead. */
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
