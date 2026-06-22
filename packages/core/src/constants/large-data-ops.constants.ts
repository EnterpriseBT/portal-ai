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

/** Max bytes of a serialized `bulk_aggregate` result (#100). Over this,
 *  the job fails BULK_AGGREGATE_RESULT_TOO_LARGE rather than persisting
 *  a multi-MB job row — the agent should use a coarser aggregate or
 *  materialize grouped output into an entity and read it with bulk_query. */
export const BULK_AGGREGATE_RESULT_LIMIT = 1024 * 1024;

/** TTL on a Redis-cached query handle. */
export const READ_HANDLE_TTL_MS = 24 * 60 * 60 * 1000;

/** TTL on a scoped webhook read/write token (#124). Short by design — the
 *  grant lives only for the duration of one webhook call; it is also revoked
 *  when the call settles, and bounded above by the handle's remaining TTL. */
export const WEBHOOK_READ_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Above this row count, reads automatically sample. */
export const SAMPLING_THRESHOLD = 50_000;

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
