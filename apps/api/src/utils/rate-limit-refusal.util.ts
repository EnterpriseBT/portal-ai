/**
 * #705: the one shape of a rate-limit refusal, shared by every per-window
 * limiter. A 429 whose message and `details.retryAfterSeconds` name the
 * seconds left in the window the request was counted in; `HttpService.error`
 * turns that hint into the `Retry-After` header.
 */
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { secondsUntilWindowEnd, RATE_WINDOW_MS } from "./rate-limit.util.js";

const inSeconds = (s: number) => (s === 1 ? "1 second" : `${s} seconds`);

/**
 * @param refusal  the sentence before the wait, e.g. "Too many requests."
 * @param now      the instant the request was counted at, so the wait
 *                 matches its window exactly
 */
export function rateLimitedError(
  code: ApiCode,
  refusal: string,
  now: number
): ApiError {
  const retryAfterSeconds = secondsUntilWindowEnd(RATE_WINDOW_MS, now);
  return new ApiError(
    429,
    code,
    `${refusal} Try again in ${inSeconds(retryAfterSeconds)}.`,
    { retryAfterSeconds }
  );
}
