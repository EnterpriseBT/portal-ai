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
  type RequestContext,
} from "../../utils/request-context.util.js";

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

describe("instrumented Query.handle — transaction safety (#698)", () => {
  it("always: a query issued after the request started, once the client is gone, still runs (the ROLLBACK/COMMIT that returns the connection)", () => {
    const ctx = ctxWith("always");
    const running = issue(ctx);
    running.acquire(); // the tile statement holds the tx connection
    ctx.controller.abort("client_gone");
    expect(running.cancelled).toBe(true); // in-flight statement is cut
    const rollback = issue(ctx); // postgres.js's scope() issues ROLLBACK next
    expect(rollback.cancelled).toBe(false);
    expect(rollback.executed).toBe(true);
  });
});

/** Settle a query and hand back what it rejected with. */
const rejectionOf = (q: FakeQuery) =>
  q.then(
    () => undefined,
    (e: unknown) => e
  );
const drizzleWrapped = (err: unknown) =>
  Object.assign(new Error("Failed query: select 1"), { cause: err });

describe("toDbCancellationApiError (#698)", () => {
  it("maps a client-gone cancel (raw or Drizzle-wrapped) to 499 REQUEST_ABANDONED", async () => {
    const ctx = ctxWith();
    const q = issue(ctx);
    ctx.controller.abort("client_gone");
    const err = await rejectionOf(q);
    for (const e of [err, drizzleWrapped(err)]) {
      const mapped = toDbCancellationApiError(e);
      expect(mapped?.status).toBe(499);
      expect(mapped?.code).toBe(ApiCode.REQUEST_ABANDONED);
    }
  });

  it("maps an admission-deadline cancel to 503 DB_ADMISSION_TIMEOUT", async () => {
    jest.useFakeTimers();
    try {
      const ctx = ctxWith("before-start", { dbAdmissionMaxWaitMs: 100 });
      const q = issue(ctx);
      jest.advanceTimersByTime(100);
      const mapped = toDbCancellationApiError(await rejectionOf(q));
      expect(mapped?.status).toBe(503);
      expect(mapped?.code).toBe(ApiCode.DB_ADMISSION_TIMEOUT);
    } finally {
      jest.useRealTimers();
    }
  });

  it("leaves a genuine 57014 alone — even later in a request that had a query cancelled", async () => {
    const ctx = ctxWith("always");
    const cut = issue(ctx);
    cut.acquire();
    ctx.controller.abort("client_gone");
    await rejectionOf(cut);
    // A real statement_timeout surfacing in the same request afterwards.
    const timeout = Object.assign(
      new Error("canceling statement due to statement timeout"),
      {
        code: "57014",
      }
    );
    expect(
      requestContext.run(ctx, () => toDbCancellationApiError(timeout))
    ).toBeUndefined();
    expect(toDbCancellationApiError(drizzleWrapped(timeout))).toBeUndefined();
    const other = Object.assign(new Error("dup"), { code: "23505" });
    expect(toDbCancellationApiError(other)).toBeUndefined();
  });
});
