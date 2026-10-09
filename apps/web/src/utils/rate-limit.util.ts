/**
 * #747: the client half of the authenticated API limiter (#574). A
 * `429 API_RATE_LIMITED` means the user's per-minute bucket is spent, and the
 * bucket is per user, so every read in the tab is spending the same one. The
 * first refused read pauses reads tab-wide for its `Retry-After` window;
 * reads issued meanwhile wait it out instead of spending refused requests
 * into the same window. `fetchWithAuth` applies it to every GET. Writes never
 * wait or retry here: their own surfaces show the server's "Try again in N
 * seconds."
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
// A refusal that pushes the running window's end out by at least this much is
// news worth replacing the notice for. Parallel refusals from one window name
// the same end give or take a second of rounding, and must not churn it.
const EXTENSION_NOTICE_MS = 2_000;
// Held reads leave over this spread once the window ends, so a busy page
// doesn't spend the fresh bucket in one instant and start another window.
const RELEASE_SPREAD_MS = 3_000;

let apiReadsPausedUntil = 0;

/** A new rate-limit window, or a running one pushed out by a longer refusal
 *  (`extended`). `waitMs` is the whole wait from now. */
export interface RateLimitWindowEvent {
  waitMs: number;
  extended: boolean;
}

type RateLimitWindowListener = (event: RateLimitWindowEvent) => void;
const windowListeners = new Set<RateLimitWindowListener>();

/** Hear each new rate-limit window once, with its wait, and again only if a
 *  longer refusal extends it by a real amount (so the notice can name the
 *  wait that actually holds). Returns the unsubscribe. */
export function onApiRateLimitWindow(
  listener: RateLimitWindowListener
): () => void {
  windowListeners.add(listener);
  return () => {
    windowListeners.delete(listener);
  };
}

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
  const isNewWindow = apiReadPauseRemainingMs() === 0;
  const previousEnd = apiReadsPausedUntil;
  apiReadsPausedUntil = Math.max(apiReadsPausedUntil, Date.now() + ms);
  const extended =
    !isNewWindow && apiReadsPausedUntil - previousEnd >= EXTENSION_NOTICE_MS;
  if (!isNewWindow && !extended) return;
  const event: RateLimitWindowEvent = {
    waitMs: apiReadPauseRemainingMs(),
    extended,
  };
  for (const listener of windowListeners) {
    // Best-effort: this runs on a refused read's error path, and a notice
    // that throws must not replace the 429 the retry rule keys on.
    try {
      listener(event);
    } catch {
      // The notice is lost; the pause and the retry still hold.
    }
  }
}

/** Milliseconds left in the running pause, 0 when none. */
export function apiReadPauseRemainingMs(): number {
  return Math.max(0, apiReadsPausedUntil - Date.now());
}

/** A random delay within the release spread. */
export function releaseJitterMs(): number {
  return Math.random() * RELEASE_SPREAD_MS;
}

/** Resolves after `ms`; rejects with `AbortError` if `signal` fires first. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wait out any running pause, re-checking since it may be extended, then a
 * random part of the release spread. Resolves at once when no pause is
 * running. Rejects with `AbortError` if `signal` fires first, so a read whose
 * page has gone never sends.
 */
export async function waitForApiReadPause(signal?: AbortSignal): Promise<void> {
  if (apiReadPauseRemainingMs() === 0) return;
  while (apiReadPauseRemainingMs() > 0) {
    await sleep(apiReadPauseRemainingMs(), signal);
  }
  const jitter = releaseJitterMs();
  if (jitter > 0) await sleep(jitter, signal);
}

/** Clears the pause. For tests: the state is module-level. */
export function resetApiReadPause(): void {
  apiReadsPausedUntil = 0;
}
