/**
 * Integration (#114) — a pure compute tool over a REAL query handle.
 *
 * Exercises the novel read→compute surface end-to-end against real Redis:
 *
 *   1. produce({sql}) stages rows in Redis under a fresh queryHandle.
 *      (PortalSqlService.runSqlQuery is mocked — sql_query's SQL execution
 *      is covered elsewhere; what matters here is the handle round-trip.)
 *   2. A refactored compute tool is invoked with that queryHandle.
 *   3. resolveComputeRecords reads the rows back from Redis (getSnapshot,
 *      server-side — never through the model) and the pure AnalyticsService
 *      method computes the result.
 *
 * Also asserts the COMPUTE_MAX_ROWS hard-error: a handle whose rowCount
 * exceeds the cap fails with COMPUTE_INPUT_TOO_LARGE rather than computing
 * over a truncated set.
 *
 * Real DB isn't needed (SQL is mocked); Redis is real.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

import { COMPUTE_MAX_ROWS } from "@portalai/core/constants";

const mockRunSqlQuery = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../../services/portal-sql.service.js", () => ({
  PortalSqlService: { runSqlQuery: mockRunSqlQuery },
}));

const { PortalSqlHandleService } = await import(
  "../../../services/portal-sql-handle.service.js"
);
// Uses `cluster` (a surviving pure-compute tool) to exercise the generic
// read→compute surface: describe_column was removed in #130 E2. k=1 over the
// `amount` column gives one centroid (the column mean) and one cluster
// assignment per row, so the round-trip is verifiable from the result.
const { ClusterTool } = await import("../../../tools/cluster.tool.js");
const { getRedisClient } = await import("../../../utils/redis.util.js");

type ExecTool = {
  execute: (
    input: unknown
  ) => Promise<{ clusters: number[]; centroids: number[][] }>;
};
const cluster = new ClusterTool().build() as unknown as ExecTool;

async function produceHandle(result: unknown): Promise<string> {
  mockRunSqlQuery.mockResolvedValueOnce(result);
  const { envelope } = await PortalSqlHandleService.produce({
    stationId: "station-1",
    organizationId: "org-1",
    sql: "SELECT amount FROM t",
  });
  return envelope.queryHandle;
}

describe("Integration (#114) — compute tool over a real query handle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves a real handle from Redis and computes the statistic", async () => {
    // 250 rows (> INLINE_ROWS_THRESHOLD) so a handle is the realistic shape.
    const rows = Array.from({ length: 250 }, (_, i) => ({ amount: i + 1 }));
    const queryHandle = await produceHandle({ rows });

    const result = await cluster.execute({
      queryHandle,
      columns: ["amount"],
      k: 2,
    });

    // The round-trip is the integration point: every one of the 250 staged
    // rows was read back from Redis and fed to the compute (one cluster
    // assignment per row), and k=2 produced two centroids.
    expect(result.clusters).toHaveLength(250);
    expect(result.centroids).toHaveLength(2);

    const redis = getRedisClient();
    await redis.del(`portal-sql:handle:${queryHandle}:meta`);
    await redis.del(`portal-sql:handle:${queryHandle}:batches:0`);
  });

  it("hard-errors with COMPUTE_INPUT_TOO_LARGE when the handle exceeds COMPUTE_MAX_ROWS", async () => {
    // Simulate the row-cap-hit shape: a truncated handle whose true count
    // is past the compute ceiling.
    const queryHandle = await produceHandle({
      rows: [{ amount: 1 }],
      truncated: true,
      totalCount: COMPUTE_MAX_ROWS + 1,
    });

    await expect(
      cluster.execute({ queryHandle, columns: ["amount"], k: 2 })
    ).rejects.toMatchObject({ code: "COMPUTE_INPUT_TOO_LARGE" });

    await getRedisClient().del(`portal-sql:handle:${queryHandle}:meta`);
  });
});
