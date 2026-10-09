/**
 * Log-level policy for typed API errors (#698).
 *
 * Expected backpressure is the system working as designed, not a failure: the
 * map tile admission gate turning a request away with `503 MAP_TILE_BUSY`
 * (the gate itself already logs a structured `warn` with its stats). Logging
 * it at `error` would put routine load-shedding in the error stream and trip
 * error-rate alerting exactly when the gate is doing its job.
 *
 * Likewise `429 MAP_TILE_RATE_LIMITED` (#705): a user over their per-user
 * map-tile bucket is the limiter doing its job, and a busy map session would
 * otherwise flood the error stream.
 *
 * Deliberately NOT here: `DB_ADMISSION_TIMEOUT`. It means the shared pool was
 * exhausted for 30s — the condition #698 exists to prevent — so it stays an
 * error that should alert. Nor `API_RATE_LIMITED`: a user over the API bucket
 * is a runaway client or abuse. Nor `SITE_CONFIG_RATE_LIMITED`: the anonymous
 * site limiter is only reached by a scraper. Both are worth seeing.
 */
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

const BACKPRESSURE_API_CODES: ReadonlySet<ApiCode> = new Set([
  ApiCode.MAP_TILE_BUSY,
  ApiCode.MAP_TILE_RATE_LIMITED,
]);

/** True for an `ApiError` that is expected load-shedding, logged at `warn`. */
export function isExpectedBackpressure(err: unknown): err is ApiError {
  return err instanceof ApiError && BACKPRESSURE_API_CODES.has(err.code);
}
