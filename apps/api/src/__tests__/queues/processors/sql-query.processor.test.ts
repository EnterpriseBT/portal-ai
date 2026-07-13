import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
} from "@jest/globals";

import { SQL_QUERY_JOB_TIMEOUT_MS } from "@portalai/core/constants";

// ── Mocks (must precede the dynamic import) ──────────────────────────

const mockProduce = jest.fn<() => Promise<{ envelope: unknown }>>();

jest.unstable_mockModule(
  "../../../services/portal-sql-handle.service.js",
  () => ({
    PortalSqlHandleService: { produce: mockProduce },
  })
);

// ── SUT ──────────────────────────────────────────────────────────────

let sqlQueryProcessor: typeof import("../../../queues/processors/sql-query.processor.js").sqlQueryProcessor;

beforeAll(async () => {
  sqlQueryProcessor = (
    await import("../../../queues/processors/sql-query.processor.js")
  ).sqlQueryProcessor;
});

beforeEach(() => {
  mockProduce.mockReset();
});

type ProcessorJob = Parameters<typeof sqlQueryProcessor>[0];

function makeJob(overrides: Record<string, unknown> = {}): ProcessorJob {
  return {
    data: {
      jobId: "job-1",
      type: "sql_query",
      sql: 'SELECT COUNT(*) AS total FROM "contacts"',
      stationId: "station-1",
      organizationId: "org-1",
      ...overrides,
    },
  } as unknown as ProcessorJob;
}

describe("sqlQueryProcessor (#130 E1a)", () => {
  it("runs the SQL off-thread at the 120s job timeout and returns the handle envelope", async () => {
    const envelope = {
      queryHandle: "qh-abc",
      rowCount: 1,
      schema: [{ name: "total", type: "int8" }],
      sampled: false,
      truncated: false,
      samplePeek: [{ total: 5_000_000 }],
      sql: 'SELECT COUNT(*) AS total FROM "contacts"',
    };
    mockProduce.mockResolvedValueOnce({ envelope });

    const out = await sqlQueryProcessor(makeJob());

    // produce is invoked with the job's SQL + the elevated 120s timeout
    // (vs the synchronous 30s) so the long scan runs off the request thread.
    expect(mockProduce).toHaveBeenCalledWith({
      stationId: "station-1",
      organizationId: "org-1",
      sql: 'SELECT COUNT(*) AS total FROM "contacts"',
      statementTimeoutMs: SQL_QUERY_JOB_TIMEOUT_MS,
    });
    // the staged handle envelope IS the job's terminal payload
    expect(out).toEqual(envelope);
  });

  it("propagates a produce failure (e.g. the 120s timeout) to the worker", async () => {
    mockProduce.mockRejectedValueOnce(
      Object.assign(new Error("canceling statement due to statement timeout"), {
        code: "PORTAL_SQL_TIMEOUT",
      })
    );
    await expect(sqlQueryProcessor(makeJob())).rejects.toThrow(
      /statement timeout/
    );
  });
});
