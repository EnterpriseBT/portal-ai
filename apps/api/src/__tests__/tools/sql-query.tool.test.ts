/* global AbortController */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
} from "@jest/globals";

const mockAnalyticsSqlQuery = jest.fn<() => Promise<unknown>>();
const mockProduce = jest.fn<() => Promise<unknown>>();

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

const { SqlQueryTool } = await import("../../tools/sql-query.tool.js");

beforeEach(() => {
  jest.clearAllMocks();
});

async function exec(sql = "SELECT * FROM things") {
  const t = new SqlQueryTool().build("station-1", "org-1");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (t as any).execute({ sql }, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });
}

describe("SqlQueryTool — inline-vs-handle branch (Phase 3)", () => {
  it("returns inline rows when row count ≤ INLINE_ROWS_THRESHOLD", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ x: i }));
    mockAnalyticsSqlQuery.mockResolvedValueOnce({ rows });

    const result = await exec();

    expect(result).toEqual({ rows });
    expect(mockProduce).not.toHaveBeenCalled();
  });

  it("returns inline at exactly the threshold (100 rows)", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ x: i }));
    mockAnalyticsSqlQuery.mockResolvedValueOnce({ rows });

    const result = await exec();

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

    const result = await exec();

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

    const result = await exec();
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
    const result = await exec();
    expect((result as { queryHandle: string }).queryHandle).toBe("qh-z");
  });
});
