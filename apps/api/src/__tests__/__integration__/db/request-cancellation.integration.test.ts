/**
 * #698 — request-scoped DB cancellation against a real Postgres.
 *
 * Every await of a query under test happens inside `requestContext.run`, as a
 * route handler's does: postgres.js only enters `Query#handle` (where the
 * context is read) when the query is first awaited.
 *
 * Each case uses its own one-connection pool so a `pg_sleep` issued outside any
 * request holds the only connection, and the query under test is genuinely
 * queued in postgres.js's pool queue. Asserts the property that matters: a
 * cancelled write never executes, and a started handler is never interrupted.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import postgres from "postgres";

import {
  instrumentSqlForRequests,
  toDbCancellationApiError,
} from "../../../db/request-cancellation.util.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  requestContext,
  type DbCancelPolicy,
  type RequestContext,
} from "../../../utils/request-context.util.js";

const TABLE = `request_cancel_it_${process.pid}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ctxWith(
  policy: DbCancelPolicy,
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

/** Settle a promise into `{ ok, err }` without throwing. */
async function outcome(p: Promise<unknown>) {
  try {
    await p;
    return { ok: true as const, err: undefined };
  } catch (err) {
    return { ok: false as const, err };
  }
}

describe("request-scoped DB cancellation (#698)", () => {
  let admin!: ReturnType<typeof postgres>;
  let sql!: ReturnType<typeof postgres>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    admin = postgres(process.env.DATABASE_URL, { max: 1 });
    await admin.unsafe(`DROP TABLE IF EXISTS "${TABLE}"`);
    await admin.unsafe(`CREATE TABLE "${TABLE}" (id int)`);
  });

  afterAll(async () => {
    await admin.unsafe(`DROP TABLE IF EXISTS "${TABLE}"`);
    await admin.end();
  });

  // A fresh single-connection instrumented pool per case.
  const pool = () =>
    (sql = instrumentSqlForRequests(
      postgres(process.env.DATABASE_URL as string, { max: 1 })
    ));
  const rows = async () =>
    Number(
      (await admin.unsafe(`SELECT count(*)::int AS n FROM "${TABLE}"`))[0].n
    );
  const clear = () => admin.unsafe(`TRUNCATE "${TABLE}"`);

  it("a queued write cancelled by a client disconnect never executes", async () => {
    await clear();
    pool();
    const hold = sql`SELECT pg_sleep(0.6)`.execute();
    await sleep(50);
    const ctx = ctxWith("before-start");
    const write = requestContext.run(ctx, () =>
      outcome(sql.unsafe(`INSERT INTO "${TABLE}" VALUES (1)`))
    );
    await sleep(50);
    ctx.controller.abort("client_gone");
    const res = await write;
    expect(res.ok).toBe(false);
    expect(ctx.dbCancelReason).toBe("client_gone");
    await hold;
    await sleep(100);
    expect(await rows()).toBe(0);
    await sql.end();
  });

  it("a first query still queued at the admission deadline is cancelled, maps to DB_ADMISSION_TIMEOUT, and never writes", async () => {
    await clear();
    pool();
    const hold = sql`SELECT pg_sleep(0.8)`.execute();
    await sleep(50);
    const ctx = ctxWith("before-start", { dbAdmissionMaxWaitMs: 200 });
    const started = Date.now();
    const res = await requestContext.run(ctx, () =>
      outcome(sql.unsafe(`INSERT INTO "${TABLE}" VALUES (1)`))
    );
    expect(res.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(700);
    const mapped = requestContext.run(ctx, () =>
      toDbCancellationApiError(res.err)
    );
    expect(mapped?.status).toBe(503);
    expect(mapped?.code).toBe(ApiCode.DB_ADMISSION_TIMEOUT);
    await hold;
    await sleep(100);
    expect(await rows()).toBe(0);
    await sql.end();
  });

  it('"always" cancels a running statement on disconnect, freeing the backend', async () => {
    pool();
    const ctx = ctxWith("always");
    const started = Date.now();
    const running = requestContext.run(ctx, () =>
      outcome(sql`SELECT pg_sleep(5) AS marker_698`)
    );
    await sleep(200);
    ctx.controller.abort("client_gone");
    const res = await running;
    expect(res.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    const active = await admin.unsafe(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE state = 'active' AND query LIKE '%marker_698%' AND pid <> pg_backend_pid()`
    );
    expect(Number(active[0].n)).toBe(0);
    await sql.end();
  });

  it('"before-start" lets a statement that already holds a connection finish after a disconnect', async () => {
    await clear();
    pool();
    const ctx = ctxWith("before-start");
    const write = requestContext.run(ctx, () =>
      outcome(sql.unsafe(`INSERT INTO "${TABLE}" SELECT 1 FROM pg_sleep(0.4)`))
    );
    await sleep(150);
    ctx.controller.abort("client_gone");
    const res = await write;
    expect(res.ok).toBe(true);
    expect(ctx.dbCancelReason).toBeUndefined();
    expect(await rows()).toBe(1);
    await sql.end();
  });

  it("a transaction whose BEGIN is still queued at the deadline rejects with no partial writes", async () => {
    await clear();
    pool();
    const hold = sql`SELECT pg_sleep(0.8)`.execute();
    await sleep(50);
    const ctx = ctxWith("before-start", { dbAdmissionMaxWaitMs: 200 });
    const res = await requestContext.run(ctx, () =>
      outcome(
        sql.begin(async (tx) => {
          await tx.unsafe(`INSERT INTO "${TABLE}" VALUES (1)`);
          await tx.unsafe(`INSERT INTO "${TABLE}" VALUES (2)`);
        })
      )
    );
    expect(res.ok).toBe(false);
    expect(ctx.dbCancelReason).toBe("admission_timeout");
    await hold;
    await sleep(100);
    expect(await rows()).toBe(0);
    await sql.end();
  });

  it("outside a request context nothing is cancelled", async () => {
    await clear();
    pool();
    const hold = sql`SELECT pg_sleep(0.3)`.execute();
    await sleep(50);
    await sql.unsafe(`INSERT INTO "${TABLE}" VALUES (1)`);
    await hold;
    expect(await rows()).toBe(1);
    await sql.end();
  });
});
