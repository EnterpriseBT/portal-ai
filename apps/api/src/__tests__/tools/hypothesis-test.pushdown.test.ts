/**
 * Engine-pushdown hypothesis tests (#130 E2c).
 *
 * `PortalSqlHandleService.aggregateOverHandle` is mocked so these tests pin
 * (a) the SQL projection each t-test issues, (b) the O(1) statistic residue
 * over the returned sufficient statistics, (c) that mann_whitney / chi_squared
 * are NOT pushed, (d) the null-fallback contract, and (e) the tool routing —
 * all without a database.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAggregate =
  jest.fn<
    (
      handleId: string,
      projection: string
    ) => Promise<Record<string, unknown> | null>
  >();

jest.unstable_mockModule("../../services/portal-sql-handle.service.js", () => ({
  PortalSqlHandleService: { aggregateOverHandle: mockAggregate },
  resolveTiebreaker: () => null,
}));

const { AnalyticsService } = await import("../../services/analytics.service.js");
const { HypothesisTestTool } = await import(
  "../../tools/hypothesis-test.tool.js"
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AnalyticsService.hypothesisTestPushdown (#130 E2c)", () => {
  it("t_test_one_sample: pushes avg/stddev_samp/count and computes t = (mean-mu)/(sd/√n)", async () => {
    mockAggregate.mockResolvedValueOnce({ mean: 5, sd: 2, n: 25 });

    const res = await AnalyticsService.hypothesisTestPushdown("qh-1", {
      test: "t_test_one_sample",
      columnA: "x",
      mu: 4,
    });

    const projection = mockAggregate.mock.calls[0][1] as string;
    expect(projection).toContain('avg("x")');
    expect(projection).toContain('stddev_samp("x")');
    expect(projection).toContain('count("x")');

    expect(res!.statistic).toBeCloseTo(2.5, 10); // (5-4)/(2/5)
    expect(res!.df).toBe(24);
    expect(res!.pValue).toBeGreaterThan(0);
    expect(res!.pValue).toBeLessThan(1);
  });

  it("t_test_two_sample: pooled t over avg/var_samp/count per column", async () => {
    mockAggregate.mockResolvedValueOnce({
      xmean: 10,
      xvar: 4,
      nx: 30,
      ymean: 8,
      yvar: 4,
      ny: 30,
    });

    const res = await AnalyticsService.hypothesisTestPushdown("qh-2", {
      test: "t_test_two_sample",
      columnA: "a",
      columnB: "b",
    });

    const projection = mockAggregate.mock.calls[0][1] as string;
    expect(projection).toContain('var_samp("a")');
    expect(projection).toContain('var_samp("b")');

    // pooledVar = 4, se = √(4·(1/30+1/30)) ; t = 2/se
    const se = Math.sqrt(4 * (1 / 30 + 1 / 30));
    expect(res!.statistic).toBeCloseTo(2 / se, 10);
    expect(res!.df).toBe(58);
  });

  it("t_test_paired: t over avg(a-b)/stddev_samp(a-b)/count of non-null pairs", async () => {
    mockAggregate.mockResolvedValueOnce({ mean: 1.5, sd: 3, n: 16 });

    const res = await AnalyticsService.hypothesisTestPushdown("qh-3", {
      test: "t_test_paired",
      columnA: "a",
      columnB: "b",
    });

    const projection = mockAggregate.mock.calls[0][1] as string;
    expect(projection).toContain('avg("a" - "b")');
    expect(projection).toContain('stddev_samp("a" - "b")');
    expect(projection).toContain('FILTER (WHERE "a" IS NOT NULL AND "b" IS NOT NULL)');

    expect(res!.statistic).toBeCloseTo(2.0, 10); // 1.5/(3/4)
    expect(res!.df).toBe(15);
  });

  it("does not push mann_whitney or chi_squared (returns null without querying)", async () => {
    const mw = await AnalyticsService.hypothesisTestPushdown("qh-4", {
      test: "mann_whitney",
      columnA: "a",
      columnB: "b",
    });
    const chi = await AnalyticsService.hypothesisTestPushdown("qh-5", {
      test: "chi_squared",
    });
    expect(mw).toBeNull();
    expect(chi).toBeNull();
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it("returns null when the handle is not re-executable (caller falls back)", async () => {
    mockAggregate.mockResolvedValueOnce(null);
    const res = await AnalyticsService.hypothesisTestPushdown("qh-6", {
      test: "t_test_one_sample",
      columnA: "x",
    });
    expect(res).toBeNull();
  });

  it("throws on a degenerate sample (n < 2)", async () => {
    mockAggregate.mockResolvedValueOnce({ mean: 5, sd: 0, n: 1 });
    await expect(
      AnalyticsService.hypothesisTestPushdown("qh-7", {
        test: "t_test_one_sample",
        columnA: "x",
      })
    ).rejects.toThrow(/at least 2/);
  });
});

describe("HypothesisTestTool routing (#130 E2c)", () => {
  type ExecTool = { execute: (input: unknown) => Promise<Record<string, unknown>> };

  it("pushes a t-test down for a queryHandle", async () => {
    mockAggregate.mockResolvedValueOnce({ mean: 5, sd: 2, n: 25 });
    const tool = new HypothesisTestTool().build() as unknown as ExecTool;

    const res = await tool.execute({
      test: "t_test_one_sample",
      queryHandle: "qh-x",
      columnA: "x",
      mu: 4,
    });

    expect(mockAggregate).toHaveBeenCalledTimes(1);
    expect(res.statistic).toBeCloseTo(2.5, 10);
  });

  it("keeps mann_whitney on the in-memory path (no pushdown) with inline rows", async () => {
    const tool = new HypothesisTestTool().build() as unknown as ExecTool;
    const rows = [
      ...[1, 2, 3, 4, 5].map((a) => ({ a, b: null })),
      ...[6, 7, 8, 9, 10].map((b) => ({ a: null, b })),
    ];

    const res = await tool.execute({
      test: "mann_whitney",
      rows,
      columnA: "a",
      columnB: "b",
    });

    expect(mockAggregate).not.toHaveBeenCalled();
    expect(res).toHaveProperty("statistic");
    expect(res).toHaveProperty("pValue");
  });

  it("runs chi_squared in-memory with no data source", async () => {
    const tool = new HypothesisTestTool().build() as unknown as ExecTool;
    const res = await tool.execute({
      test: "chi_squared",
      observed: [10, 20, 30],
      expected: [20, 20, 20],
    });

    expect(mockAggregate).not.toHaveBeenCalled();
    expect(res).toHaveProperty("statistic");
  });
});
