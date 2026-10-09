/**
 * #747: the client half of the authenticated API limiter (#574). A
 * `429 API_RATE_LIMITED` means the user's per-minute bucket is spent, and the
 * bucket is per user, so every read in the tab is spending the same one. The
 * first refusal pauses reads tab-wide for its `Retry-After` window; reads
 * issued meanwhile wait it out instead of spending refused requests into the
 * same window. Mutations never wait or retry here: their own surfaces show the
 * server's "Try again in N seconds."
 *
 * Mirrors the map's tile pause (`tile-protocol.util.ts`, #705), which keeps
 * its own state for `MAP_TILE_RATE_LIMITED`. Kept free of `api.util` imports
 * (structural types only) since `api.util` imports this.
 */

export const API_RATE_LIMITED = "API_RATE_LIMITED";

const DEFAULT_RETRY_AFTER_MS = 2_000;
const MIN_RETRY_AFTER_MS = 1_000;
// A rate-limit window is a minute, so its Retry-After is at most 60s.
const MAX_RETRY_AFTER_MS = 60_000;

let apiReadsPausedUntil = 0;

/** Whether `error` is the API bucket's refusal. A map-tile or codeless 429
 *  is not: the former is the map's, the latter isn't our limiter's. */
export function isApiRateLimited(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return status === 429 && code === API_RATE_LIMITED;
}

/** The refusal's wait in ms, clamped to [1s, 60s]; 2s when unknown. */
export function retryAfterMs(error: { retryAfterSeconds?: number }): number {
  const seconds = error.retryAfterSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return DEFAULT_RETRY_AFTER_MS;
  }
  return Math.min(
    MAX_RETRY_AFTER_MS,
    Math.max(MIN_RETRY_AFTER_MS, seconds * 1_000)
  );
}

/** Hold reads for `ms`. A longer pause extends the window; a shorter one
 *  never shortens it. */
export function pauseApiReads(ms: number): void {
  apiReadsPausedUntil = Math.max(apiReadsPausedUntil, Date.now() + ms);
}

/** Milliseconds left in the running pause, 0 when none. */
export function apiReadPauseRemainingMs(): number {
  return Math.max(0, apiReadsPausedUntil - Date.now());
}

/**
 * Wait out any running pause, re-checking since it may be extended. Takes no
 * abort signal on purpose: reading react-query's `signal` opts every query
 * into abort-on-unmount, and a wait abandoned by its query ends within 60s
 * anyway.
 */
export async function waitForApiReadPause(): Promise<void> {
  while (apiReadPauseRemainingMs() > 0) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, apiReadPauseRemainingMs())
    );
  }
}

/** Clears the pause. For tests: the state is module-level. */
export function resetApiReadPause(): void {
  apiReadsPausedUntil = 0;
}
