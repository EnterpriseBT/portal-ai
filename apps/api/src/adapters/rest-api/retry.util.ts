/**
 * Retry wrapper for REST API fetches.
 *
 * Wraps any `() => Promise<T>` and retries on the documented transient
 * statuses (429, 502, 503, 504). 429 honors `Retry-After` (seconds or
 * HTTP-date); all other retryable statuses use exponential backoff
 * (`baseDelayMs * 2^attempt`, capped at `maxDelayMs`). After the
 * budget is exhausted:
 *
 *   - the last status was 429 → rethrow as `REST_API_RATE_LIMITED`
 *     (carries `details.lastRetryAfter` + `details.attempts`)
 *   - any other retryable status → rethrow the underlying
 *     `REST_API_FETCH_FAILED` with `details.attempts` patched on
 *
 * Non-`ApiError` throws + non-retryable statuses propagate
 * immediately without consuming the budget.
 *
 * Pure modulo `setTimeout`; injectable timer via the `now` + `wait`
 * fields kept off the public surface for the tests (Jest fake timers
 * drive `setTimeout`).
 */
import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOnStatus: Set<number>;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  baseDelayMs: 250,
  maxDelayMs: 8000,
  retryOnStatus: new Set([429, 502, 503, 504]),
};

export interface RetryHooks {
  /** Called once per retry, *before* the wait completes. */
  onRetry?: (attempt: number, delayMs: number, status?: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  hooks?: RetryHooks
): Promise<T> {
  let lastError: ApiError | null = null;
  let lastStatus: number | undefined;
  let lastRetryAfter: string | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const details = err.details as
        | { status?: number; headers?: Record<string, string> }
        | undefined;
      const status = details?.status;
      if (status === undefined || !policy.retryOnStatus.has(status)) {
        throw err;
      }

      lastError = err;
      lastStatus = status;
      lastRetryAfter = details?.headers?.["retry-after"];

      if (attempt >= policy.maxRetries) break;

      const retryAfterMs = parseRetryAfter(lastRetryAfter);
      const delay =
        retryAfterMs !== null
          ? Math.min(retryAfterMs, policy.maxDelayMs * 2)
          : Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);

      hooks?.onRetry?.(attempt + 1, delay, status);
      await sleep(delay);
    }
  }

  // Budget exhausted. Re-shape per status.
  const attempts = policy.maxRetries + 1;
  if (lastStatus === 429) {
    throw new ApiError(
      502,
      ApiCode.REST_API_RATE_LIMITED,
      `Upstream rate-limited after ${attempts} attempt${attempts === 1 ? "" : "s"}`,
      {
        ...(lastError?.details ?? {}),
        attempts,
        ...(lastRetryAfter !== undefined ? { lastRetryAfter } : {}),
      }
    );
  }
  // Fallthrough: re-throw the original code with attempts patched on.
  throw new ApiError(
    lastError?.status ?? 502,
    (lastError?.code as ApiCode) ?? ApiCode.REST_API_FETCH_FAILED,
    lastError?.message ?? "fetch failed",
    { ...(lastError?.details ?? {}), attempts }
  );
}

/**
 * Parse a `Retry-After` header value to milliseconds.
 *
 *   - Integer seconds (`Retry-After: 30`) → milliseconds.
 *   - HTTP-date (RFC 7231 §7.1.3) → `parsed - now`, floored at 0.
 *   - Anything else (including undefined) → null.
 */
function parseRetryAfter(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 1000;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, parsed - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
