/**
 * Integration (#130 E2c) — hypothesis_test t-tests engine-pushdown over a
 * REAL handle. Produces a handle (real runSqlQuery, real Redis), then runs
 * each t-test both via `hypothesisTestPushdown` (re-executes the retained
 * query wrapped in avg/var_samp/stddev_samp aggregates against Postgres) and
 * via the in-memory `hypothesisTest`, asserting they agree — proving the
 * generated SQL passes validatePortalSql and the residue is equivalent.
 */
import { describe, it, expect, afterEach } from "@jest/globals";

const { PortalSqlHandleService } =
  await import("../../../services/portal-sql-handle.service.js");
const { AnalyticsService } =
  await import("../../../services/analytics.service.js");
const { getRedisClient } = await import("../../../utils/redis.util.js");

const ORG_ID = "00000000-0000-0000-0000-0000000c2c11";
const STATION_ID = "00000000-0000-0000-0000-0000000c2c12";

const ROWS = [
  { a: 2.1, b: 1.8 },
  { a: 3.4, b: 3.0 },
  { a: 1.9, b: 2.2 },
  { a: 4.2, b: 3.8 },
  { a: 2.8, b: 2.5 },
  { a: 3.1, b: 2.9 },
  { a: 2.5, b: 2.1 },
  { a: 3.9, b: 3.5 },
  { a: 2.2, b: 2.0 },
  { a: 3.6, b: 3.2 },
];
const HANDLE_SQL = `SELECT a::float8 AS a, b::float8 AS b FROM (VALUES ${ROWS.map(
  (r) => `(${r.a}, ${r.b})`
).join(", ")}) AS t(a, b)`;

let producedHandle: string | null = null;

async function produce(): Promise<string> {
  const { envelope } = await PortalSqlHandleService.produce({
    stationId: STATION_ID,
    organizationId: ORG_ID,
    sql: HANDLE_SQL,
  });
  producedHandle = envelope.queryHandle;
  return envelope.queryHandle;
}

describe("Integration (#130 E2c) — hypothesis_test pushdown over a real handle", () => {
  afterEach(async () => {
    if (producedHandle) {
      const redis = getRedisClient();
      await redis.del(`portal-sql:handle:${producedHandle}:meta`);
      await redis.del(`portal-sql:handle:${producedHandle}:batches:0`);
      producedHandle = null;
    }
  });

  it("one-sample / two-sample / paired pushdown match the in-memory statistic + p-value", async () => {
    for (const test of [
      "t_test_one_sample",
      "t_test_two_sample",
      "t_test_paired",
    ] as const) {
      const handle = await produce();
      const pushed = await AnalyticsService.hypothesisTestPushdown(handle, {
        test,
        columnA: "a",
        columnB: "b",
        mu: 2.5,
      });
      const inMem = AnalyticsService.hypothesisTest({
        test,
        records: ROWS,
        columnA: "a",
        columnB: "b",
        mu: 2.5,
      });

      expect(pushed).not.toBeNull();
      expect(pushed!.statistic).toBeCloseTo(inMem.statistic, 6);
      expect(pushed!.pValue).toBeCloseTo(inMem.pValue, 6);
      expect(pushed!.df).toBe(inMem.df);

      // cleanup between iterations
      const redis = getRedisClient();
      await redis.del(`portal-sql:handle:${producedHandle}:meta`);
      await redis.del(`portal-sql:handle:${producedHandle}:batches:0`);
      producedHandle = null;
    }
  });
});
