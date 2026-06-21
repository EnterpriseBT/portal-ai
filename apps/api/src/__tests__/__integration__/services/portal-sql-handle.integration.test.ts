/**
 * Smoke B — Phase 3 acceptance integration test for #85.
 *
 * Drives the producer + Redis + Pub/Sub + snapshot loop end-to-end.
 * The underlying SQL execution is mocked at PortalSqlService.runSqlQuery
 * so the test focuses on the handle orchestration:
 *
 *   1. produce({sql}) → stages batches in Redis + broadcasts data +
 *      complete events on portal-sql:stream:<id>.
 *   2. A Pub/Sub subscriber receives the events.
 *   3. getSnapshot returns the same rows from Redis later.
 *
 * Real DB isn't needed since the SQL is mocked; Redis is real.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

const mockRunSqlQuery = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../../services/portal-sql.service.js", () => ({
  PortalSqlService: { runSqlQuery: mockRunSqlQuery },
}));

const { PortalSqlHandleService, streamChannelKey } = await import(
  "../../../services/portal-sql-handle.service.js"
);
const { getRedisClient } = await import("../../../utils/redis.util.js");
const { resolveRecordStream } = await import(
  "../../../tools/record-source.js"
);
const { AnalyticsService } = await import(
  "../../../services/analytics.service.js"
);
const { HANDLE_ROW_CAP } = await import(
  "@portalai/core/constants"
);

describe("Smoke B — query-handle pipeline (#85 Phase 3)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Best-effort cleanup; TTL evicts stragglers anyway.
  });

  it("end-to-end: produce → SSE channel receives data + complete; snapshot returns rows", async () => {
    // Seed 2,500 rows so the handle splits into 3 batches.
    const rows = Array.from({ length: 2_500 }, (_, i) => ({
      acreage: 0.5 + i * 0.1,
      assessed_value: 100_000 + i,
    }));
    mockRunSqlQuery.mockResolvedValueOnce({ rows });

    // Subscribe to the Pub/Sub channel BEFORE producing so the
    // subscriber doesn't miss events. The handle id is generated
    // inside produce(); we subscribe to a wildcard, then collect
    // matching events.
    const subscriber = getRedisClient().duplicate();
    const received: unknown[] = [];
    await subscriber.psubscribe("portal-sql:stream:*");
    subscriber.on("pmessage", (_pattern, _chan, message) => {
      received.push(JSON.parse(message));
    });

    const { envelope } = await PortalSqlHandleService.produce({
      stationId: "station-1",
      organizationId: "org-1",
      sql: "SELECT acreage, assessed_value FROM parcels",
    });

    // Settle: the producer's publish loop is async; let pending
    // messages drain.
    await new Promise((r) => setTimeout(r, 200));

    // Envelope shape.
    expect(envelope.queryHandle).toMatch(/^qh-/);
    expect(envelope.rowCount).toBe(2_500);
    expect(envelope.sampled).toBe(false);
    expect(envelope.schema).toHaveLength(2);
    expect(envelope.samplePeek).toHaveLength(10);

    // Pub/Sub events.
    const channel = streamChannelKey(envelope.queryHandle);
    const events = received as Array<{ type: string }>;
    expect(events.length).toBeGreaterThanOrEqual(4); // 3 data + 1 complete
    const dataCount = events.filter((e) => e.type === "data").length;
    const completeCount = events.filter((e) => e.type === "complete").length;
    expect(dataCount).toBe(3);
    expect(completeCount).toBe(1);

    // Snapshot returns the rows.
    const snap = await PortalSqlHandleService.getSnapshot(
      envelope.queryHandle,
      { offset: 0, limit: 5_000 }
    );
    expect(snap.total).toBe(2_500);
    expect(snap.rows).toHaveLength(2_500);
    expect(snap.rows[0]).toEqual({
      acreage: 0.5,
      assessed_value: 100_000,
    });
    expect(snap.rows[2_499]).toEqual({
      acreage: 0.5 + 2_499 * 0.1,
      assessed_value: 100_000 + 2_499,
    });

    await subscriber.punsubscribe("portal-sql:stream:*");
    await subscriber.quit();

    // Cleanup: drop the handle keys explicitly so concurrent runs
    // don't see them via channel suffixing.
    const redis = getRedisClient();
    await redis.del(`portal-sql:handle:${envelope.queryHandle.slice(3)}:meta`);
    expect(channel).toMatch(/^portal-sql:stream:qh-/);
  }, 15_000);

  it("getSnapshot returns READ_HANDLE_EXPIRED for an unknown handle", async () => {
    await expect(
      PortalSqlHandleService.getSnapshot("qh-does-not-exist", {
        offset: 0,
        limit: 100,
      })
    ).rejects.toMatchObject({ code: "READ_HANDLE_EXPIRED" });
  });
});

/**
 * #129 slice 5 — the exactness lock: forecast folds a > HANDLE_ROW_CAP handle
 * end-to-end with NO COMPUTE_INPUT_TOO_LARGE, exact to the whole-array result,
 * streaming one keyset page at a time.
 *
 * Coverage split (deliberate — see spec test 7): the REAL keyset SQL against
 * Postgres is already proven by `portal-sql.service.integration` (the wrapped
 * `(orderBy, _record_id)` query) and the `keyset-cursor-stability` spike. This
 * test closes the remaining gap — the produce → streamHandle (rowCount > cap,
 * so the keyset branch) → resolveRecordStream → forecastFromStream
 * orchestration — with real Redis and `runSqlQuery` mocked, so it runs fast
 * (no 100k-row DB seed re-proving the keyset half on every CI run). The page
 * mock returns the ordered series in BATCH_SIZE chunks, exactly as a correctly
 * advancing keyset over Postgres would.
 */
describe("#129 streaming fold over a > HANDLE_ROW_CAP handle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("forecast folds a 120k handle exactly, no COMPUTE_INPUT_TOO_LARGE, one batch at a time", async () => {
    const BATCH = 1_000; // streamHandle's page size
    const N = HANDLE_ROW_CAP + 20_000; // 120,000 — past the snapshot tier
    const BASE = Date.UTC(2020, 0, 1);

    // Deterministic series, already in (ts, _record_id) order. The wiggle
    // (i % 7) gives non-zero residuals so σ / MAPE are exercised, not just 0.
    const series = Array.from({ length: N }, (_, i) => ({
      _record_id: `r-${String(i).padStart(7, "0")}`,
      ts: new Date(BASE + i * 86_400_000).toISOString(),
      val: 100 + 0.5 * i + (i % 7),
    }));

    // runSqlQuery: call 1 is produce (shape 2 — stage a small head but report
    // the full totalCount so rowCount > cap → cursor branch). Calls 2+ are
    // streamHandle keyset pages, served as successive ordered BATCH slices.
    let firstCall = true;
    let pageStart = 0;
    mockRunSqlQuery.mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        return {
          rows: series.slice(0, BATCH),
          truncated: true,
          totalCount: N,
        };
      }
      const page = series.slice(pageStart, pageStart + BATCH);
      pageStart += BATCH;
      return { rows: page };
    });

    const { envelope } = await PortalSqlHandleService.produce({
      stationId: "station-1",
      organizationId: "org-1",
      sql: 'SELECT "_record_id", "ts", "val" FROM series',
    });
    expect(envelope.rowCount).toBe(N);
    // Past the snapshot tier → resolveRecordStream must take the keyset cursor.
    expect(envelope.rowCount).toBeGreaterThan(HANDLE_ROW_CAP);

    // Fold the stream (this is what forecast.tool does: orderBy = dateColumn).
    const params = {
      dateColumn: "ts",
      valueColumn: "val",
      horizon: 6,
      trend: "additive" as const,
    };
    const streamed = await AnalyticsService.forecastFromStream(
      resolveRecordStream(
        { queryHandle: envelope.queryHandle },
        { mode: "streaming" },
        { orderBy: "ts" }
      ),
      params
    );

    // Oracle: the whole-array forecast over the same series.
    const oracle = AnalyticsService.forecast({ ...params, records: series });

    expect(streamed.count).toBe(N); // every row folded, none dropped
    streamed.forecast.values.forEach((v, i) =>
      expect(v).toBeCloseTo(oracle.forecast.values[i], 6)
    );
    streamed.forecast.lower.forEach((v, i) =>
      expect(v).toBeCloseTo(oracle.forecast.lower[i], 6)
    );
    streamed.forecast.upper.forEach((v, i) =>
      expect(v).toBeCloseTo(oracle.forecast.upper[i], 6)
    );
    expect(streamed.mape).toBeCloseTo(oracle.mape, 6);

    // Streamed one keyset page at a time: ~N/BATCH page calls (+ produce +
    // the terminating empty page), each capped at BATCH — never one big read.
    const calls = mockRunSqlQuery.mock.calls as unknown as Array<
      [{ sql: string; rowCap?: number }]
    >;
    expect(calls.length).toBeGreaterThanOrEqual(N / BATCH);
    const keysetCalls = calls.filter((c) =>
      /ORDER BY "ts" ASC, "_record_id" ASC LIMIT 1000/.test(c[0].sql)
    );
    expect(keysetCalls.length).toBeGreaterThanOrEqual(N / BATCH);
    expect(keysetCalls.every((c) => c[0].rowCap === BATCH)).toBe(true);

    // Cleanup the staged head.
    await getRedisClient().del(
      `portal-sql:handle:${envelope.queryHandle.slice(3)}:meta`
    );
  }, 30_000);
});

/**
 * #124 slice 1 — produceFromRows: the outbound producer. A caller-supplied
 * row set (a webhook's large result) stages into the same envelope/Redis
 * batches `produce` yields and reads back via `getSnapshot`. No `runSqlQuery`
 * (no originating query → `sql: null`), so the SQL mock is never touched.
 */
describe("#124 produceFromRows — externally-supplied rows", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function cleanup(handleId: string, batches: number) {
    const redis = getRedisClient();
    await redis.del(`portal-sql:handle:${handleId.slice(3)}:meta`);
    for (let b = 0; b < batches; b++) {
      await redis.del(`portal-sql:handle:${handleId.slice(3)}:batches:${b}`);
    }
  }

  it("stages supplied rows into a readable handle (sql null), round-trips via getSnapshot", async () => {
    // 2,500 rows → 3 batches, like the produce() smoke test.
    const rows = Array.from({ length: 2_500 }, (_, i) => ({
      label: `row-${i}`,
      score: i * 2,
    }));

    const { envelope } = await PortalSqlHandleService.produceFromRows({
      rows,
      stationId: "station-1",
      organizationId: "org-1",
    });

    expect(envelope.queryHandle).toMatch(/^qh-/);
    expect(envelope.rowCount).toBe(2_500);
    expect(envelope.truncated).toBe(false);
    expect(envelope.sql).toBeNull(); // no originating query
    // schema derived from the first row's keys + value types.
    expect(envelope.schema.map((c) => c.name)).toEqual(["label", "score"]);
    expect(mockRunSqlQuery).not.toHaveBeenCalled();

    const snap = await PortalSqlHandleService.getSnapshot(envelope.queryHandle, {
      offset: 0,
      limit: 5_000,
    });
    expect(snap.total).toBe(2_500);
    expect(snap.rows).toHaveLength(2_500);
    expect(snap.rows[0]).toEqual({ label: "row-0", score: 0 });
    expect(snap.rows[2_499]).toEqual({ label: "row-2499", score: 4_998 });

    await cleanup(envelope.queryHandle, 3);
  }, 15_000);

  it("honors a supplied schema and a paged getSnapshot window", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ v: i }));
    const { envelope } = await PortalSqlHandleService.produceFromRows({
      rows,
      schema: [{ name: "v", type: "int4" }],
      stationId: "s",
      organizationId: "o",
    });
    expect(envelope.schema).toEqual([{ name: "v", type: "int4" }]);

    const page = await PortalSqlHandleService.getSnapshot(envelope.queryHandle, {
      offset: 10,
      limit: 5,
    });
    expect(page.rows).toEqual([
      { v: 10 },
      { v: 11 },
      { v: 12 },
      { v: 13 },
      { v: 14 },
    ]);
    expect(page.total).toBe(30);

    await cleanup(envelope.queryHandle, 1);
  }, 15_000);

  it("truncates a supplied set past HANDLE_ROW_CAP and flags it", async () => {
    const rows = Array.from({ length: HANDLE_ROW_CAP + 10 }, (_, i) => ({ i }));
    const { envelope } = await PortalSqlHandleService.produceFromRows({
      rows,
      stationId: "s",
      organizationId: "o",
    });
    // No query to re-execute → fully staged, so rowCount caps at the snapshot.
    expect(envelope.rowCount).toBe(HANDLE_ROW_CAP);
    expect(envelope.truncated).toBe(true);

    await cleanup(envelope.queryHandle, Math.ceil(HANDLE_ROW_CAP / 1_000));
  }, 30_000);
});
