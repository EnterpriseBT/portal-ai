/**
 * Integration (#130 E2c) — regression engine-pushdown over a REAL handle.
 *
 * Produces a handle (real runSqlQuery, real Redis), then for each design
 * (linear single-x, multivariate, polynomial) runs `regressionPushdown`
 * (accumulates X'X / X'y / y'y as SQL sums against Postgres) and the
 * in-memory `regression`, asserting the scalar stats agree — proving the
 * generated aggregate projection passes validatePortalSql and executes, and
 * that residuals are omitted on the pushdown path.
 */
import { describe, it, expect, afterEach } from "@jest/globals";

const { PortalSqlHandleService } = await import(
  "../../../services/portal-sql-handle.service.js"
);
const { AnalyticsService } = await import(
  "../../../services/analytics.service.js"
);
const { getRedisClient } = await import("../../../utils/redis.util.js");

const ORG_ID = "00000000-0000-0000-0000-0000000c2c21";
const STATION_ID = "00000000-0000-0000-0000-0000000c2c22";

// y ≈ 2x + 0.7·x2 + 1 with small wobble; x2 is a second regressor.
const ROWS = Array.from({ length: 12 }, (_, i) => ({
  x: i + 1,
  x2: ((i * 7) % 5) - 2,
  y: 2 * (i + 1) + 0.7 * (((i * 7) % 5) - 2) + 1 + (i % 2 === 0 ? 0.15 : -0.2),
}));
const HANDLE_SQL =
  `SELECT x::float8 AS x, x2::float8 AS x2, y::float8 AS y FROM (VALUES ${ROWS.map(
    (r) => `(${r.x}, ${r.x2}, ${r.y})`
  ).join(", ")}) AS t(x, x2, y)`;

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

async function cleanup(): Promise<void> {
  if (producedHandle) {
    const redis = getRedisClient();
    await redis.del(`portal-sql:handle:${producedHandle}:meta`);
    await redis.del(`portal-sql:handle:${producedHandle}:batches:0`);
    producedHandle = null;
  }
}

describe("Integration (#130 E2c) — regression pushdown over a real handle", () => {
  afterEach(cleanup);

  const designs = [
    { label: "linear single-x", params: { x: "x", y: "y", type: "linear" as const } },
    {
      label: "multivariate",
      params: { xColumns: ["x", "x2"], y: "y", type: "linear" as const },
    },
    {
      label: "polynomial deg 2",
      params: { x: "x", y: "y", type: "polynomial" as const, degree: 2 },
    },
  ];

  for (const { label, params } of designs) {
    it(`${label}: pushdown scalar stats match in-memory; residuals omitted`, async () => {
      const handle = await produce();
      const pushed = await AnalyticsService.regressionPushdown(handle, params);
      const inMem = AnalyticsService.regression({ records: ROWS, ...params });

      expect(pushed).not.toBeNull();
      pushed!.coefficients.forEach((c, i) =>
        expect(c).toBeCloseTo(inMem.coefficients[i], 6)
      );
      expect(pushed!.rSquared).toBeCloseTo(inMem.rSquared, 6);
      pushed!.standardErrors.forEach((s, i) =>
        expect(s).toBeCloseTo(inMem.standardErrors[i], 6)
      );
      pushed!.pValues.forEach((p, i) =>
        expect(p).toBeCloseTo(inMem.pValues[i], 6)
      );
      expect(pushed!.residuals).toBeUndefined();

      await cleanup();
    });
  }
});
