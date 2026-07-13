/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAnalyticsSqlQuery = jest.fn<() => Promise<unknown>>();
const mockProduce = jest.fn<() => Promise<unknown>>();
const mockExplainSqlQuery =
  jest.fn<() => Promise<{ totalCost: number; estimatedRows: number }>>();
const mockJobsCreate = jest.fn<() => Promise<{ id: string }>>();
const mockAwaitJobTerminal = jest.fn<() => Promise<unknown>>();
const mockRecordRejection = jest.fn<() => Promise<void>>();
const mockValidateAck =
  jest.fn<
    () => Promise<{ ok: true } | { ok: false; reason: "missing" | "stale" }>
  >();

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: {
    sqlQuery: mockAnalyticsSqlQuery,
  },
}));

jest.unstable_mockModule("../../services/portal-sql-handle.service.js", () => ({
  PortalSqlHandleService: {
    produce: mockProduce,
  },
}));

jest.unstable_mockModule("../../services/portal-sql.service.js", () => ({
  PortalSqlService: {
    explainSqlQuery: mockExplainSqlQuery,
  },
}));

jest.unstable_mockModule("../../services/jobs.service.js", () => ({
  JobsService: {
    create: mockJobsCreate,
  },
}));

jest.unstable_mockModule("../../utils/await-job-terminal.util.js", () => ({
  awaitJobTerminal: mockAwaitJobTerminal,
}));

jest.unstable_mockModule(
  "../../services/cost-acknowledgement.service.js",
  () => ({
    CostAcknowledgementService: {
      recordRejection: mockRecordRejection,
      validate: mockValidateAck,
    },
    computeSqlQuerySignature: () => "sig-fixed",
  })
);

// `environment` is NOT mocked — the real default
// SQL_QUERY_JOB_COST_THRESHOLD (1_000_000) is what the escalation tests
// straddle (totalCost 2_000_000 escalates; 10 runs sync). Mocking the
// whole module would strip LOG_LEVEL and break the shared logger.
const { SqlQueryTool } = await import("../../tools/sql-query.tool.js");
const { ApiError } = await import("../../services/http.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

beforeEach(() => {
  jest.clearAllMocks();
});

/** Build with NO portal context → synchronous-only path (no escalation). */
async function execSync(sql = "SELECT * FROM things") {
  const t = new SqlQueryTool().build("station-1", "org-1");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (t as any).execute(
    { sql },
    { toolCallId: "t", messages: [], abortSignal: new AbortController().signal }
  );
}

/** Build WITH portal context → job-tier escalation wired (#130 E1b). */
async function execEsc(
  input: { sql?: string; acknowledgeCost?: boolean } = {}
) {
  const t = new SqlQueryTool().build(
    "station-1",
    "org-1",
    "user-1",
    "portal-1"
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (t as any).execute(
    { sql: "SELECT * FROM things", ...input },
    { toolCallId: "t", messages: [], abortSignal: new AbortController().signal }
  );
}

describe("SqlQueryTool — inline-vs-handle branch (Phase 3)", () => {
  it("returns inline rows when row count ≤ INLINE_ROWS_THRESHOLD", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ x: i }));
    mockAnalyticsSqlQuery.mockResolvedValueOnce({ rows });

    const result = await execSync();

    expect(result).toEqual({ rows });
    expect(mockProduce).not.toHaveBeenCalled();
  });

  it("returns inline at exactly the threshold (100 rows)", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ x: i }));
    mockAnalyticsSqlQuery.mockResolvedValueOnce({ rows });

    const result = await execSync();

    expect(result).toEqual({ rows });
    expect(mockProduce).not.toHaveBeenCalled();
  });

  it("falls through to handle path when row count > INLINE_ROWS_THRESHOLD", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ x: i }));
    mockAnalyticsSqlQuery.mockResolvedValueOnce({ rows });
    mockProduce.mockResolvedValueOnce({
      envelope: {
        queryHandle: "qh-x",
        rowCount: 200,
        schema: [{ name: "x", type: "integer" }],
        sampled: false,
        truncated: false,
        samplePeek: rows.slice(0, 10),
      },
    });

    const result = await execSync();

    expect(mockProduce).toHaveBeenCalledTimes(1);
    expect(mockProduce).toHaveBeenCalledWith(
      expect.objectContaining({
        stationId: "station-1",
        organizationId: "org-1",
      })
    );
    expect((result as { queryHandle: string }).queryHandle).toBe("qh-x");
    expect((result as { rowCount: number }).rowCount).toBe(200);
  });

  it("falls through to handle path when the inline response is truncated by the row cap", async () => {
    mockAnalyticsSqlQuery.mockResolvedValueOnce({
      rows: Array.from({ length: 500 }, (_, i) => ({ x: i })),
      truncated: true,
      totalCount: 5_000,
      hint: "result truncated",
    });
    mockProduce.mockResolvedValueOnce({
      envelope: {
        queryHandle: "qh-y",
        rowCount: 5_000,
        schema: [],
        sampled: false,
        truncated: false,
        samplePeek: [],
      },
    });

    const result = await execSync();
    expect((result as { queryHandle: string }).queryHandle).toBe("qh-y");
  });

  it("falls through to handle path when the inline response was collapsed to a sample", async () => {
    mockAnalyticsSqlQuery.mockResolvedValueOnce({
      truncated: true,
      sample: [{ x: 1 }],
      totalCount: 10_000_000,
      columnSizes: { x: 4 },
      hint: "too big",
    });
    mockProduce.mockResolvedValueOnce({
      envelope: {
        queryHandle: "qh-z",
        rowCount: 10_000_000,
        schema: [],
        sampled: true,
        sampleSize: 50_000,
        truncated: true,
        samplePeek: [],
      },
    });
    const result = await execSync();
    expect((result as { queryHandle: string }).queryHandle).toBe("qh-z");
  });

  it("does NOT probe EXPLAIN when there is no portal context", async () => {
    mockAnalyticsSqlQuery.mockResolvedValueOnce({ rows: [{ x: 1 }] });
    await execSync();
    expect(mockExplainSqlQuery).not.toHaveBeenCalled();
  });
});

describe("SqlQueryTool — job-tier escalation (#130 E1b)", () => {
  it("escalates predictively when EXPLAIN cost crosses the threshold", async () => {
    mockExplainSqlQuery.mockResolvedValueOnce({
      totalCost: 2_000_000,
      estimatedRows: 5_000_000,
    });

    await expect(execEsc()).rejects.toMatchObject({
      code: ApiCode.SQL_QUERY_COST_NOT_ACKNOWLEDGED,
    });
    // No wasted synchronous attempt, and the rejection is recorded.
    expect(mockAnalyticsSqlQuery).not.toHaveBeenCalled();
    expect(mockRecordRejection).toHaveBeenCalledWith(
      "portal-1",
      "sig-fixed",
      expect.any(Number)
    );
  });

  it("runs synchronously when EXPLAIN cost is under the threshold", async () => {
    mockExplainSqlQuery.mockResolvedValueOnce({
      totalCost: 10,
      estimatedRows: 5,
    });
    mockAnalyticsSqlQuery.mockResolvedValueOnce({ rows: [{ x: 1 }] });

    const result = await execEsc();

    expect(result).toEqual({ rows: [{ x: 1 }] });
    expect(mockRecordRejection).not.toHaveBeenCalled();
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("degrades to the sync path when the EXPLAIN probe itself throws", async () => {
    mockExplainSqlQuery.mockRejectedValueOnce(new Error("explain blew up"));
    mockAnalyticsSqlQuery.mockResolvedValueOnce({ rows: [{ x: 1 }] });

    const result = await execEsc();

    expect(result).toEqual({ rows: [{ x: 1 }] });
    expect(mockRecordRejection).not.toHaveBeenCalled();
  });

  it("escalates via the 30s timeout backstop when the sync run times out", async () => {
    mockExplainSqlQuery.mockResolvedValueOnce({
      totalCost: 10,
      estimatedRows: 5,
    });
    mockAnalyticsSqlQuery.mockRejectedValueOnce(
      new ApiError(400, ApiCode.PORTAL_SQL_TIMEOUT, "query timed out (30s)")
    );

    await expect(execEsc()).rejects.toMatchObject({
      code: ApiCode.SQL_QUERY_COST_NOT_ACKNOWLEDGED,
    });
    expect(mockRecordRejection).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-timeout sync error without escalating", async () => {
    mockExplainSqlQuery.mockResolvedValueOnce({
      totalCost: 10,
      estimatedRows: 5,
    });
    mockAnalyticsSqlQuery.mockRejectedValueOnce(
      new ApiError(400, ApiCode.PORTAL_SQL_FORBIDDEN, "nope")
    );

    await expect(execEsc()).rejects.toMatchObject({
      code: ApiCode.PORTAL_SQL_FORBIDDEN,
    });
    expect(mockRecordRejection).not.toHaveBeenCalled();
  });

  it("on retry-with-ack (valid) enqueues the job and returns the handle envelope", async () => {
    mockValidateAck.mockResolvedValueOnce({ ok: true });
    mockJobsCreate.mockResolvedValueOnce({ id: "job-1" });
    mockAwaitJobTerminal.mockResolvedValueOnce({
      status: "completed",
      result: {
        queryHandle: "qh-job",
        rowCount: 9_000,
        schema: [],
        sampled: false,
        truncated: false,
        samplePeek: [],
      },
      error: null,
    });

    const result = await execEsc({ acknowledgeCost: true });

    expect(mockExplainSqlQuery).not.toHaveBeenCalled();
    expect(mockJobsCreate).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        type: "sql_query",
        organizationId: "org-1",
        metadata: expect.objectContaining({
          sql: "SELECT * FROM things",
          stationId: "station-1",
          organizationId: "org-1",
        }),
      })
    );
    expect(result).toMatchObject({ type: "data-table", queryHandle: "qh-job" });
  });

  it("rejects retry-with-ack when the acknowledgement is invalid (no prior rejection)", async () => {
    mockValidateAck.mockResolvedValueOnce({ ok: false, reason: "missing" });

    await expect(execEsc({ acknowledgeCost: true })).rejects.toMatchObject({
      code: ApiCode.SQL_QUERY_COST_ACKNOWLEDGEMENT_INVALID,
    });
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("surfaces a cancelled escalated job as SQL_QUERY_JOB_CANCELLED", async () => {
    mockValidateAck.mockResolvedValueOnce({ ok: true });
    mockJobsCreate.mockResolvedValueOnce({ id: "job-2" });
    mockAwaitJobTerminal.mockResolvedValueOnce({
      status: "cancelled",
      result: null,
      error: null,
    });

    await expect(execEsc({ acknowledgeCost: true })).rejects.toMatchObject({
      code: ApiCode.SQL_QUERY_JOB_CANCELLED,
    });
  });

  it("surfaces a failed escalated job as SQL_QUERY_JOB_FAILED", async () => {
    mockValidateAck.mockResolvedValueOnce({ ok: true });
    mockJobsCreate.mockResolvedValueOnce({ id: "job-3" });
    mockAwaitJobTerminal.mockResolvedValueOnce({
      status: "failed",
      result: null,
      error: "boom",
    });

    await expect(execEsc({ acknowledgeCost: true })).rejects.toMatchObject({
      code: ApiCode.SQL_QUERY_JOB_FAILED,
    });
  });
});
