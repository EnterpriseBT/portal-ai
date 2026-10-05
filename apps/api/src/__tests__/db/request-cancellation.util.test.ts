import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

import {
  instrumentQueryPrototype,
  toDbCancellationApiError,
} from "../../db/request-cancellation.util.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import {
  requestContext,
  type DbCancelPolicy,
  type DbCancelReason,
  type RequestContext,
} from "../../utils/request-context.util.js";

/** A 57014 as Drizzle surfaces it: the pg error on `.cause`. */
const cancelled = Object.assign(new Error("Failed query: select 1"), {
  cause: Object.assign(new Error("canceling statement due to user request"), {
    code: "57014",
  }),
});

const inRequest = <T>(reason: DbCancelReason | undefined, fn: () => T): T =>
  requestContext.run(
    {
      log: undefined as never,
      dbCancelPolicy: "before-start",
      dbCancelReason: reason,
      dbStarted: false,
    },
    fn
  );

describe("toDbCancellationApiError (#698)", () => {
  it("maps a 57014 the request instrumentation caused to its typed error", () => {
    const timeout = inRequest("admission_timeout", () =>
      toDbCancellationApiError(cancelled)
    );
    expect(timeout?.status).toBe(503);
    expect(timeout?.code).toBe(ApiCode.DB_ADMISSION_TIMEOUT);

    const gone = inRequest("client_gone", () =>
      toDbCancellationApiError(cancelled)
    );
    expect(gone?.status).toBe(499);
    expect(gone?.code).toBe(ApiCode.REQUEST_ABANDONED);
  });

  it("ignores a 57014 with no request cancel reason (a real statement_timeout) and non-57014 errors", () => {
    expect(
      inRequest(undefined, () => toDbCancellationApiError(cancelled))
    ).toBeUndefined();
    expect(toDbCancellationApiError(cancelled)).toBeUndefined();
    const other = Object.assign(new Error("dup"), { code: "23505" });
    expect(
      inRequest("client_gone", () => toDbCancellationApiError(other))
    ).toBeUndefined();
  });
});

/**
 * A stand-in for postgres.js's `Query`: a Promise subclass whose `handle()` is
 * the single entry point every execution path goes through (then/execute/…),
 * `state` is set once it holds a connection, and `cancel()` rejects with 57014.
 */
class FakeQuery extends Promise<string> {
  static get [Symbol.species]() {
    return Promise;
  }
  state: object | null = null;
  executed = false;
  cancelled = false;
  settle!: (v: string) => void;
  private rejectFn!: (e: unknown) => void;
  constructor() {
    let res!: (v: string) => void;
    let rej!: (e: unknown) => void;
    super((a, b) => {
      res = a;
      rej = b;
    });
    this.settle = res;
    this.rejectFn = rej;
  }
  handle(): void {
    this.executed = true;
  }
  cancel(): void {
    this.cancelled = true;
    this.rejectFn(
      Object.assign(new Error("canceling statement"), { code: "57014" })
    );
  }
  /** Simulate the pool handing this query a connection. */
  acquire(): void {
    this.state = {};
  }
}
instrumentQueryPrototype(FakeQuery.prototype);

const flush = () => new Promise<void>((r) => setImmediate(r));

/** Start a query inside `ctx`, the way a handler's `await` would. */
function issue(ctx: RequestContext): FakeQuery {
  const q = new FakeQuery();
  requestContext.run(ctx, () => q.handle());
  q.catch(() => undefined); // the test inspects rejection via `cancelled`
  return q;
}

function ctxWith(
  policy: DbCancelPolicy = "before-start",
  extra: Partial<RequestContext> = {}
): RequestContext & { controller: AbortController } {
  const controller = new AbortController();
  return Object.assign(
    {
      log: undefined as never,
      signal: controller.signal,
      dbCancelPolicy: policy,
      dbStarted: false,
      controller,
    },
    extra
  );
}

describe("instrumented Query.handle — request cancellation (#698)", () => {
  it("is a passthrough outside a request context", () => {
    const q = new FakeQuery();
    q.catch(() => undefined);
    q.handle();
    expect(q.executed).toBe(true);
    expect(q.cancelled).toBe(false);
  });

  it("before-start: cancels a queued query when the client disconnects", () => {
    const ctx = ctxWith();
    const q = issue(ctx);
    ctx.controller.abort("client_gone");
    expect(q.cancelled).toBe(true);
    expect(ctx.dbCancelReason).toBe("client_gone");
  });

  it("before-start: leaves a query that already holds a connection running", () => {
    const ctx = ctxWith();
    const q = issue(ctx);
    q.acquire();
    ctx.controller.abort("client_gone");
    expect(q.cancelled).toBe(false);
    expect(ctx.dbCancelReason).toBeUndefined();
  });

  it("before-start: never cancels a queued query while a sibling of the same request is running", () => {
    const ctx = ctxWith();
    const writing = issue(ctx);
    writing.acquire();
    const queued = issue(ctx);
    ctx.controller.abort("client_gone");
    expect(queued.cancelled).toBe(false);
    expect(writing.cancelled).toBe(false);
  });

  it("before-start: once the request has started DB work, a later queued query is not cancelled", async () => {
    const ctx = ctxWith();
    const first = issue(ctx);
    first.acquire();
    first.settle("ok");
    await flush();
    expect(ctx.dbStarted).toBe(true);
    const later = issue(ctx);
    ctx.controller.abort("client_gone");
    expect(later.cancelled).toBe(false);
  });

  it("always: cancels a running query on disconnect", () => {
    const ctx = ctxWith("always");
    const q = issue(ctx);
    q.acquire();
    ctx.controller.abort("client_gone");
    expect(q.cancelled).toBe(true);
    expect(ctx.dbCancelReason).toBe("client_gone");
  });

  it("cancels a query issued after the signal already aborted", () => {
    const ctx = ctxWith();
    ctx.controller.abort("client_gone");
    expect(issue(ctx).cancelled).toBe(true);
  });

  describe("admission deadline (fake timers)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it("cancels a first query still queued after the deadline", () => {
      const ctx = ctxWith("before-start", { dbAdmissionMaxWaitMs: 500 });
      const q = issue(ctx);
      jest.advanceTimersByTime(499);
      expect(q.cancelled).toBe(false);
      jest.advanceTimersByTime(1);
      expect(q.cancelled).toBe(true);
      expect(ctx.dbCancelReason).toBe("admission_timeout");
    });

    it("does not fire once the query has acquired a connection, and leaves no timer after settle", async () => {
      const ctx = ctxWith("before-start", { dbAdmissionMaxWaitMs: 500 });
      const q = issue(ctx);
      q.acquire();
      jest.advanceTimersByTime(1_000);
      expect(q.cancelled).toBe(false);
      q.settle("ok");
      await Promise.resolve();
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
