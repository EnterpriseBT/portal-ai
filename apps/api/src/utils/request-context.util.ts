import { AsyncLocalStorage } from "node:async_hooks";
import type pino from "pino";

export interface RequestContext {
  log: pino.Logger;
  /** Per-request memo for correctness-neutral dedup of work that can't change
   *  within a single request (#647). Lazily created by {@link memoizeForRequest}. */
  memo?: Map<string, unknown>;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Memoize `factory` for the lifetime of the current request (i.e. one agent
 * turn / HTTP request), keyed by `key` (#647). The in-flight promise is cached,
 * so concurrent callers with the same key share one resolution; a rejection is
 * evicted, so a failed call is retried by the next caller. With no request
 * store (a job worker, a test), this is a passthrough that just runs `factory`.
 *
 * Only for values that cannot change within one request (e.g. a caller's
 * resolved view grants — a grant changed mid-turn applies on the next request).
 * `key` shares one per-request namespace across all callers, so it MUST be
 * prefixed to the concern (e.g. `views:<…>`) to avoid a cross-concern collision.
 */
export function memoizeForRequest<T>(
  key: string,
  factory: () => Promise<T>
): Promise<T> {
  const ctx = requestContext.getStore();
  if (!ctx) return factory();
  const memo = (ctx.memo ??= new Map<string, unknown>());
  const existing = memo.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = factory().catch((err) => {
    // Don't cache a failure — evict so the next caller retries.
    memo.delete(key);
    throw err;
  });
  memo.set(key, pending);
  return pending;
}
