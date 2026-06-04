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
