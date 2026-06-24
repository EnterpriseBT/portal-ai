/**
 * Engine-pushdown OLS regression (#130 E2c).
 *
 * `PortalSqlHandleService.aggregateOverHandle` is mocked. For each design
 * (linear single-x, multivariate, polynomial) we build the exact sufficient
 * statistics the SQL would return — the Gram matrix sums g_i_j, X'y_i, y'y,
 * n — feed them as the mocked aggregate row, and assert the pushdown result
 * matches the in-memory `regression` over the same data (coefficients, R²,
 * SEs, p-values). Also pins the projection/WHERE shape, the omitted residuals
 * contract, the null fallback, and the tool routing — all without a database.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAggregate =
  jest.fn<
    (
      handleId: string,
      projection: string,
      opts?: { where?: string }
    ) => Promise<Record<string, unknown> | null>
  >();

jest.unstable_mockModule("../../services/portal-sql-handle.service.js", () => ({
  PortalSqlHandleService: { aggregateOverHandle: mockAggregate },
  resolveTiebreaker: () => null,
}));

const { AnalyticsService } = await import("../../services/analytics.service.js");
const { RegressionTool } = await import("../../tools/regression.tool.js");

beforeEach(() => {
  jest.clearAllMocks();
});

type Row = Record<string, number>;

/** Build the projection-keyed sufficient-statistics row the pushdown SQL
 *  would return, given a per-row feature extractor (feature 0 = constant 1). */
function statsFor(
  data: Row[],
  featOf: (r: Row) => number[],
  yKey: string
): Record<string, number> {
  const k = featOf(data[0]).length;
  const out: Record<string, number> = { n: data.length, yty: 0 };
  for (let i = 0; i < k; i++) {
    out[`xty_${i}`] = 0;
    for (let j = i; j < k; j++) out[`g_${i}_${j}`] = 0;
  }
  for (const r of data) {
    const f = featOf(r);
    const y = r[yKey];
    out.yty += y * y;
    for (let i = 0; i < k; i++) {
      out[`xty_${i}`] += f[i] * y;
      for (let j = i; j < k; j++) out[`g_${i}_${j}`] += f[i] * f[j];
    }
  }
  return out;
}

function expectArrayClose(a: number[], b: number[], digits = 6): void {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
}

describe("AnalyticsService.regressionPushdown (#130 E2c)", () => {
  it("linear single-x: pushdown matches in-memory; residuals omitted", async () => {
    const data: Row[] = [
      { x: 1, y: 2.1 },
      { x: 2, y: 3.9 },
      { x: 3, y: 6.2 },
      { x: 4, y: 7.8 },
      { x: 5, y: 10.1 },
    ];
    mockAggregate.mockResolvedValueOnce(
      statsFor(data, (r) => [1, r.x], "y")
    );

    const pushed = await AnalyticsService.regressionPushdown("qh-1", {
      x: "x",
      y: "y",
      type: "linear",
    });
    const inMem = AnalyticsService.regression({
      records: data,
      x: "x",
      y: "y",
      type: "linear",
    });

    expect(pushed).not.toBeNull();
    expectArrayClose(pushed!.coefficients, inMem.coefficients);
    expect(pushed!.rSquared).toBeCloseTo(inMem.rSquared, 6);
    expectArrayClose(pushed!.standardErrors, inMem.standardErrors);
    expectArrayClose(pushed!.pValues, inMem.pValues);
    expect(pushed!.residuals).toBeUndefined();

    // projection + null-guard shape
    const projection = mockAggregate.mock.calls[0][1];
    expect(projection).toContain("g_0_0");
    expect(projection).toContain("xty_0");
    expect(projection).toContain("yty");
    expect(projection).toContain("count(*) AS n");
    expect(mockAggregate.mock.calls[0][2]?.where).toContain('"x" IS NOT NULL');
    expect(mockAggregate.mock.calls[0][2]?.where).toContain('"y" IS NOT NULL');
  });

  it("multivariate: pushdown matches in-memory", async () => {
    const data: Row[] = Array.from({ length: 12 }, (_, i) => ({
      a: i,
      b: (i % 3) - 1,
      y: 2 * i + 0.5 * ((i % 3) - 1) + 1 + (i % 2 === 0 ? 0.1 : -0.1),
    }));
    mockAggregate.mockResolvedValueOnce(
      statsFor(data, (r) => [1, r.a, r.b], "y")
    );

    const pushed = await AnalyticsService.regressionPushdown("qh-2", {
      xColumns: ["a", "b"],
      y: "y",
      type: "linear",
    });
    const inMem = AnalyticsService.regression({
      records: data,
      xColumns: ["a", "b"],
      y: "y",
      type: "linear",
    });

    expectArrayClose(pushed!.coefficients, inMem.coefficients);
    expect(pushed!.rSquared).toBeCloseTo(inMem.rSquared, 6);
    expectArrayClose(pushed!.pValues, inMem.pValues);
  });

  it("polynomial: pushdown matches in-memory and uses power() features", async () => {
    const data: Row[] = Array.from({ length: 8 }, (_, i) => ({
      x: i,
      y: i * i - 2 * i + 3,
    }));
    mockAggregate.mockResolvedValueOnce(
      statsFor(data, (r) => [1, r.x, r.x * r.x], "y")
    );

    const pushed = await AnalyticsService.regressionPushdown("qh-3", {
      x: "x",
      y: "y",
      type: "polynomial",
      degree: 2,
    });
    const inMem = AnalyticsService.regression({
      records: data,
      x: "x",
      y: "y",
      type: "polynomial",
      degree: 2,
    });

    expectArrayClose(pushed!.coefficients, inMem.coefficients, 5);
    expect(pushed!.rSquared).toBeCloseTo(inMem.rSquared, 6);
    expect(mockAggregate.mock.calls[0][1]).toContain('power("x", 2)');
  });

  it("returns null when the handle is not re-executable (caller falls back)", async () => {
    mockAggregate.mockResolvedValueOnce(null);
    const res = await AnalyticsService.regressionPushdown("qh-4", {
      x: "x",
      y: "y",
      type: "linear",
    });
    expect(res).toBeNull();
  });

  it("throws when there are too few rows for the degrees of freedom", async () => {
    // k = 2 features, n = 2 → dfResid = 0.
    mockAggregate.mockResolvedValueOnce({
      g_0_0: 2,
      g_0_1: 3,
      g_1_1: 5,
      xty_0: 4,
      xty_1: 7,
      yty: 10,
      n: 2,
    });
    await expect(
      AnalyticsService.regressionPushdown("qh-5", {
        x: "x",
        y: "y",
        type: "linear",
      })
    ).rejects.toThrow(/at least/);
  });
});

describe("RegressionTool routing (#130 E2c)", () => {
  type ExecTool = { execute: (input: unknown) => Promise<Record<string, unknown>> };

  it("pushes down for a queryHandle (residuals omitted)", async () => {
    const data: Row[] = [
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
      { x: 4, y: 8 },
    ];
    mockAggregate.mockResolvedValueOnce(statsFor(data, (r) => [1, r.x], "y"));
    const tool = new RegressionTool().build() as unknown as ExecTool;

    const res = await tool.execute({
      queryHandle: "qh-x",
      x: "x",
      y: "y",
      type: "linear",
    });

    expect(mockAggregate).toHaveBeenCalledTimes(1);
    expect((res.coefficients as number[])[1]).toBeCloseTo(2, 6); // slope
    expect(res.residuals).toBeUndefined();
  });

  it("uses in-memory compute for inline rows and returns residuals", async () => {
    const tool = new RegressionTool().build() as unknown as ExecTool;
    const res = await tool.execute({
      rows: [
        { x: 1, y: 2 },
        { x: 2, y: 4 },
        { x: 3, y: 6 },
        { x: 4, y: 8 },
      ],
      x: "x",
      y: "y",
      type: "linear",
    });

    expect(mockAggregate).not.toHaveBeenCalled();
    expect(res.residuals).toBeDefined();
  });
});
