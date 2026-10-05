/**
 * Request-scoped DB cancellation (#698).
 *
 * When a request's DB work is cancelled — its client disconnected, or its
 * first query waited too long for a pool connection — Postgres rejects the
 * statement with `57014` ("canceling statement due to user request"), the same
 * SQLSTATE as a `statement_timeout`. The instrumentation records *why* on the
 * request context, and {@link toDbCancellationApiError} turns that into the
 * matching typed error, so a cancellation is never reported as a timeout.
 */

import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { unwrapPgError } from "../utils/pg-error.util.js";
import { getDbCancelReason } from "../utils/request-context.util.js";

/** How long a request's first query may wait for a pool connection before it
 *  is cancelled — far under the ALB's 180s idle timeout, so a request the
 *  client has given up on can never start writing afterwards. */
export const DB_ADMISSION_MAX_WAIT_MS = 30_000;

/** Map a `57014` caused by request cancellation to its typed `ApiError`;
 *  `undefined` for any other error (including a real `statement_timeout`). */
export function toDbCancellationApiError(err: unknown): ApiError | undefined {
  if (unwrapPgError(err).code !== "57014") return undefined;
  switch (getDbCancelReason()) {
    case "admission_timeout":
      return new ApiError(
        503,
        ApiCode.DB_ADMISSION_TIMEOUT,
        "The database is busy — retry shortly"
      );
    case "client_gone":
      return new ApiError(
        499,
        ApiCode.REQUEST_ABANDONED,
        "Client disconnected"
      );
    default:
      return undefined;
  }
}
