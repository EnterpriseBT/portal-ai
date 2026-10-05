/**
 * Request-scoped DB cancellation (#698).
 *
 * `instrumentSqlForRequests` patches postgres.js's `Query.prototype.handle` —
 * the one method every execution path (await, `.execute()`, `.values()`, a
 * transaction's `BEGIN`, cursors) runs exactly once, just before the query
 * joins the pool queue. Outside a request context it does nothing. Inside one,
 * each query is tracked until it settles and is cancelled when:
 *
 *  - the client disconnects and the request has not started DB work yet (or
 *    the request opted into `"always"`, which also cancels running statements);
 *  - it is still waiting for a pool connection after the admission deadline
 *    and the request has not started DB work yet.
 *
 * "Started" means any of the request's queries has acquired a connection, so
 * a handler is never cut between two writes. Cancelling a queued query removes
 * it from the pool queue; cancelling a running one uses Postgres's cancel
 * request on its own short-lived socket, never a pool connection.
 *
 * When a request's DB work is cancelled — its client disconnected, or its
 * first query waited too long for a pool connection — Postgres rejects the
 * statement with `57014` ("canceling statement due to user request"), the same
 * SQLSTATE as a `statement_timeout`. The instrumentation records *why* on the
 * request context, and {@link toDbCancellationApiError} turns that into the
 * matching typed error, so a cancellation is never reported as a timeout.
 */

import type postgres from "postgres";

import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { unwrapPgError } from "../utils/pg-error.util.js";
import {
  requestContext,
  type DbCancelReason,
  type RequestContext,
} from "../utils/request-context.util.js";

/** How long a request's first query may wait for a pool connection before it
 *  is cancelled — far under the ALB's 180s idle timeout, so a request the
 *  client has given up on can never start writing afterwards. */
export const DB_ADMISSION_MAX_WAIT_MS = 30_000;

/**
 * Why the instrumentation cancelled the query a given error came from, keyed
 * by the rejection object itself. Keyed per error (not per request) so a
 * *later* genuine `statement_timeout` in the same request is still reported as
 * a timeout, not as the earlier cancellation.
 */
const cancelledErrors = new WeakMap<object, DbCancelReason>();

/** Map a `57014` the request instrumentation caused to its typed `ApiError`;
 *  `undefined` for any other error (including a real `statement_timeout`).
 *  Drizzle wraps driver errors, so the original is looked up on `.cause`. */
export function toDbCancellationApiError(err: unknown): ApiError | undefined {
  if (unwrapPgError(err).code !== "57014") return undefined;
  const cause = (err as { cause?: unknown } | null | undefined)?.cause;
  const reason =
    (isObject(err) ? cancelledErrors.get(err) : undefined) ??
    (isObject(cause) ? cancelledErrors.get(cause) : undefined);
  switch (reason) {
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

const isObject = (v: unknown): v is object =>
  typeof v === "object" && v !== null;

/** The slice of postgres.js's (internal) `Query` the instrumentation uses.
 *  `state` is set once the query holds a connection; `cancel()` is public. */
interface CancellableQuery extends Promise<unknown> {
  state: unknown;
  executed: boolean;
  cancel(): unknown;
  handle(...args: unknown[]): unknown;
}

/** Live tracked queries per request — "has this request started DB work?". */
const liveQueries = new WeakMap<RequestContext, Set<CancellableQuery>>();
const instrumentedPrototypes = new WeakSet<object>();

function hasStarted(ctx: RequestContext): boolean {
  if (ctx.dbStarted) return true;
  for (const q of liveQueries.get(ctx) ?? []) if (q.state) return true;
  return false;
}

/** Track one query of the current request. Returns true when it was cancelled
 *  before it was handed to the driver (it must then not be executed). */
function track(q: CancellableQuery): boolean {
  const ctx = requestContext.getStore();
  if (!ctx) return false;
  const policy = ctx.dbCancelPolicy ?? "before-start";
  if (policy === "before-start" && hasStarted(ctx)) return false;

  const live = liveQueries.get(ctx) ?? new Set<CancellableQuery>();
  liveQueries.set(ctx, live);
  live.add(q);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelledFor: DbCancelReason | undefined;
  const cleanup = () => {
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onAbort);
    live.delete(q);
  };
  const cancel = (reason: DbCancelReason) => {
    const queued = !q.state;
    cleanup();
    // A statement cut while holding a connection means the request's DB work
    // had started — so its follow-up ROLLBACK must never be cut too.
    if (q.state) ctx.dbStarted = true;
    cancelledFor = reason;
    ctx.dbCancelReason ??= reason;
    const fields = { dbCancel: reason, policy, queued };
    if (reason === "admission_timeout") {
      ctx.log?.warn(
        fields,
        "DB query cancelled: no connection within the admission deadline"
      );
    } else {
      ctx.log?.info(fields, "DB query cancelled: client disconnected");
    }
    q.cancel();
  };
  // A query is cut on disconnect only when it is (a) still queued before the
  // request has started any DB work — never sent, nothing half-done — or (b)
  // under "always", actually holding a connection (cancelled in-flight via
  // Postgres's cancel request). A not-yet-running query issued *after* the
  // request started is never cut: inside a transaction that is the
  // ROLLBACK/COMMIT that hands the connection back to the pool, and cancelling
  // it before it is sent would strand the connection in an open transaction.
  const cancellableOnAbort = () =>
    q.state ? policy === "always" : !hasStarted(ctx);
  const onAbort = () => {
    if (cancellableOnAbort()) cancel("client_gone");
  };

  // Observe settlement without re-entering Query#then (which calls handle()).
  // Registered before any cancel and before the caller's own `then`, so a
  // cancelled query's rejection is attributed before anything maps it.
  Promise.prototype.then.call(
    q,
    () => {
      if (q.state) ctx.dbStarted = true;
      cleanup();
    },
    (err: unknown) => {
      if (cancelledFor && isObject(err)) cancelledErrors.set(err, cancelledFor);
      if (q.state) ctx.dbStarted = true;
      cleanup();
    }
  );

  if (ctx.signal?.aborted) {
    if (cancellableOnAbort()) {
      cancel("client_gone");
      return true;
    }
    cleanup();
    return false;
  }
  ctx.signal?.addEventListener("abort", onAbort, { once: true });
  if (!hasStarted(ctx)) {
    timer = setTimeout(() => {
      if (!q.state && !hasStarted(ctx)) cancel("admission_timeout");
    }, ctx.dbAdmissionMaxWaitMs ?? DB_ADMISSION_MAX_WAIT_MS);
    timer.unref?.();
  }
  return false;
}

/** Patch a `Query` prototype's `handle` (idempotent). Exported for tests,
 *  which instrument a stand-in class; production uses
 *  {@link instrumentSqlForRequests}. */
export function instrumentQueryPrototype(proto: object): void {
  if (instrumentedPrototypes.has(proto)) return;
  instrumentedPrototypes.add(proto);
  const target = proto as CancellableQuery;
  const original = target.handle;
  target.handle = function (this: CancellableQuery, ...args: unknown[]) {
    if (!this.executed && track(this)) {
      // Cancelled before reaching the driver: mark it executed so a later
      // await doesn't hand an already-rejected query to the pool.
      this.executed = true;
      return Promise.resolve();
    }
    return original.apply(this, args);
  };
}

/** Enable request-scoped cancellation for every query of this postgres.js
 *  instance (and any other sharing its `Query` class). Returns `sql`. */
export function instrumentSqlForRequests<T extends postgres.Sql>(sql: T): T {
  // An unexecuted query, used only to reach the (non-exported) Query class.
  instrumentQueryPrototype(Object.getPrototypeOf(sql.unsafe("select 1")));
  return sql;
}
