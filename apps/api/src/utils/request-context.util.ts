import { AsyncLocalStorage } from "node:async_hooks";
import type pino from "pino";

/**
 * How this request's DB queries are cancelled when its client goes away or a
 * first query can't get a connection in time (#698):
 *
 *  - `"before-start"` (default): only queries issued before the request has
 *    started DB work are cancelled, so a handler is never interrupted between
 *    two writes.
 *  - `"always"`: running statements are cancelled too. Only for routes whose
 *    DB work is read-only and safe to cut mid-flight (map tiles).
 */
export type DbCancelPolicy = "before-start" | "always";
/** Why the SQL instrumentation cancelled one of this request's queries. */
export type DbCancelReason = "client_gone" | "admission_timeout";

export interface RequestContext {
  log: pino.Logger;
  /** Per-request memo for correctness-neutral dedup of work that can't change
   *  within a single request (#647). Lazily created by {@link memoizeForRequest}. */
  memo?: Map<string, unknown>;
  /** #698: fires once when the client disconnects before the response
   *  finished (reason `"client_gone"`). */
  signal?: AbortSignal;
  /** #698: see {@link DbCancelPolicy}. Unset reads as `"before-start"`. */
  dbCancelPolicy?: DbCancelPolicy;
  /** #698: set by the SQL instrumentation when it cancels one of this
   *  request's queries, so the resulting `57014` maps to a typed error. */
  dbCancelReason?: DbCancelReason;
  /** #698: true once any of this request's queries acquired a connection. */
  dbStarted?: boolean;
  /** #698: override for the DB admission deadline (ms). Unset uses
   *  `DB_ADMISSION_MAX_WAIT_MS`; tests set it to exercise the deadline. */
  dbAdmissionMaxWaitMs?: number;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** The current request's disconnect signal; undefined outside a request. */
export function getRequestSignal(): AbortSignal | undefined {
  return requestContext.getStore()?.signal;
}

/** Opt the current request into a DB cancel policy. No-op outside a request. */
export function setDbCancelPolicy(policy: DbCancelPolicy): void {
  const ctx = requestContext.getStore();
  if (ctx) ctx.dbCancelPolicy = policy;
}

/** Why the instrumentation cancelled a query of this request, if it did. */
export function getDbCancelReason(): DbCancelReason | undefined {
  return requestContext.getStore()?.dbCancelReason;
}

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
