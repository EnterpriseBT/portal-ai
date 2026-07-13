/**
 * Integration (#130 E2c) — var_cvar engine-pushdown over a REAL handle.
 *
 * Unlike the unit test (which mocks `aggregateOverHandle`), this exercises
 * the actual SQL path end-to-end: a real query handle is produced (real
 * `PortalSqlService.runSqlQuery`, real Redis), then `varCvarPushdown`
 * re-executes the handle's retained query wrapped in the
 * `percentile_cont … WITHIN GROUP` / `avg … FILTER` aggregate and runs it
 * against Postgres — proving the generated projection passes
 * `validatePortalSql` and executes.
 *
 * The SQL is a self-contained `VALUES` series, so no entity seeding is
 * needed; only a valid-UUID org/station for the session-view pipeline.
 */
import { describe, it, expect, afterEach } from "@jest/globals";

const { PortalSqlHandleService } =
  await import("../../../services/portal-sql-handle.service.js");
const { AnalyticsService } =
  await import("../../../services/analytics.service.js");
const { getRedisClient } = await import("../../../utils/redis.util.js");

const ORG_ID = "00000000-0000-0000-0000-0000000c2c01";
const STATION_ID = "00000000-0000-0000-0000-0000000c2c02";

// Sorted returns; PG percentile_cont(0.05) over these 10 values interpolates
// at index 0.05·(10-1)=0.45 between -0.10 and -0.05 → -0.0775. Only -0.10 is
// at/below that cutoff, so the historical tail is a single observation.
const RETURNS = [-0.1, -0.05, -0.02, 0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.08];
const HANDLE_SQL = `SELECT v::float8 AS r FROM (VALUES ${RETURNS.map(
  (v) => `(${v})`
).join(", ")}) AS t(v)`;

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

describe("Integration (#130 E2c) — var_cvar pushdown over a real handle", () => {
  afterEach(async () => {
    if (producedHandle) {
      const redis = getRedisClient();
      await redis.del(`portal-sql:handle:${producedHandle}:meta`);
      await redis.del(`portal-sql:handle:${producedHandle}:batches:0`);
      producedHandle = null;
    }
  });

  it("historical: percentile_cont cutoff + tail avg execute and match the hand value", async () => {
    const handle = await produce();
    const res = await AnalyticsService.varCvarPushdown(handle, {
      returnColumn: "r",
      method: "historical",
      confidence: 0.95,
    });

    expect(res).not.toBeNull();
    expect(res!.method).toBe("historical");
    expect(res!.var).toBeCloseTo(0.0775, 4); // -cutoff
    expect(res!.cvar).toBeCloseTo(0.1, 4); // -mean of the single tail obs
    expect(res!.tailCount).toBe(1);
  });

  it("parametric: avg/stddev_samp aggregate executes and yields a positive VaR", async () => {
    const handle = await produce();
    const res = await AnalyticsService.varCvarPushdown(handle, {
      returnColumn: "r",
      method: "parametric",
      confidence: 0.95,
    });

    expect(res).not.toBeNull();
    expect(res!.method).toBe("parametric");
    expect(Number.isFinite(res!.var)).toBe(true);
    expect(res!.cvar).toBeGreaterThan(res!.var);
  });
});
