/**
 * Network-failure cause extraction for the REST API connector (#435).
 *
 * `fetch` reports *every* network-level failure as the same useless
 * `TypeError: fetch failed`, and hangs the actionable reason —
 * `UND_ERR_SOCKET`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`,
 * `UND_ERR_HEADERS_TIMEOUT` — off `err.cause`. Storing the outermost
 * message therefore records nothing: production logs read
 * `details.cause: "fetch failed"`, a tautology that made it impossible
 * to say which fault a failed sync had hit.
 *
 * `describeCause` walks the chain so the real reason lands in
 * `details`, and `networkFailure` additionally attaches the original
 * error as the `ApiError`'s own `cause` — which `formatJobError`
 * (`queues/jobs.worker.ts:25`) already walks, so the operator-facing
 * job error becomes "other side closed | code: UND_ERR_SOCKET" instead
 * of "Fetch failed: fetch failed" with no extra plumbing.
 */

import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";

/** Depth guard — a real chain is 2–3 links; anything deeper is a cycle. */
const MAX_CAUSE_DEPTH = 8;

export interface CauseLink {
  name?: string;
  code?: string;
  errno?: number;
  syscall?: string;
  message?: string;
}

export interface DescribedCause {
  /**
   * The deepest link, formatted `code: message` (or just the message
   * when the link carries no code). This is the single string worth
   * putting in front of a human.
   */
  cause: string;
  /** Every link, outermost first. */
  causeChain: CauseLink[];
}

/**
 * Read the diagnostic fields off one error-ish value, omitting keys it
 * doesn't carry so the serialized chain stays readable in logs.
 */
function linkOf(value: unknown): CauseLink {
  if (typeof value !== "object" || value === null) {
    return { message: String(value) };
  }
  const e = value as {
    name?: unknown;
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
    message?: unknown;
  };
  const link: CauseLink = {};
  if (typeof e.name === "string") link.name = e.name;
  if (typeof e.code === "string") link.code = e.code;
  if (typeof e.errno === "number") link.errno = e.errno;
  if (typeof e.syscall === "string") link.syscall = e.syscall;
  if (typeof e.message === "string") link.message = e.message;
  return link;
}

/** Format one link for human consumption. */
function describeLink(link: CauseLink): string {
  const message = link.message ?? link.name ?? "unknown error";
  return link.code !== undefined ? `${link.code}: ${message}` : message;
}

/**
 * Walk `err` and its `cause` chain. Returns the chain outermost-first
 * plus a single human-readable string taken from the **deepest** link,
 * which is where the real reason lives.
 */
export function describeCause(err: unknown): DescribedCause {
  const causeChain: CauseLink[] = [];
  const seen = new Set<unknown>();
  let cursor: unknown = err;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (cursor === undefined || cursor === null) break;
    if (typeof cursor === "object") {
      if (seen.has(cursor)) break;
      seen.add(cursor);
    }
    causeChain.push(linkOf(cursor));
    cursor =
      typeof cursor === "object"
        ? (cursor as { cause?: unknown }).cause
        : undefined;
  }

  if (causeChain.length === 0) causeChain.push({ message: String(err) });
  return {
    cause: describeLink(causeChain[causeChain.length - 1]),
    causeChain,
  };
}

/**
 * Build the `REST_API_FETCH_FAILED` an unreachable / dropped upstream
 * should produce. Carries no `status` — that absence is exactly how
 * `withRetry` recognises a network-level failure as retryable, so
 * don't add one here.
 *
 * `extra` merges additional detail (e.g. `phase`) without displacing
 * the cause fields.
 */
export function networkFailure(
  url: string,
  err: unknown,
  extra: Record<string, unknown> = {}
): ApiError {
  const described = describeCause(err);
  const apiError = new ApiError(
    502,
    ApiCode.REST_API_FETCH_FAILED,
    `Fetch failed: ${described.cause}`,
    { url, ...extra, ...described }
  );
  // Surfaced to `formatJobError`, which walks `.cause` to build the
  // job row's error text.
  apiError.cause = err;
  return apiError;
}
