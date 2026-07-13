/**
 * Engine-pushdown VaR / CVaR (#130 E2c).
 *
 * `PortalSqlHandleService.aggregateOverHandle` is mocked so these tests pin
 * (a) the SQL projection the pushdown issues, (b) the O(1) residue math over
 * the returned sufficient statistics, (c) the null-fallback contract, and
 * (d) the tool's pushdown-vs-in-memory routing — all without a database.
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
  // record-source.ts (pulled in transitively via compute-input.util) imports
  // resolveTiebreaker from this module; preserve the named export so the mock
  // doesn't break that import graph.
  resolveTiebreaker: () => null,
}));

const { AnalyticsService } =
  await import("../../services/analytics.service.js");
const { VarCvarTool } = await import("../../tools/var-cvar.tool.js");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AnalyticsService.varCvarPushdown (#130 E2c)", () => {
  it("parametric: pushes avg/stddev_samp/count and computes the normal-tail residue", async () => {
    mockAggregate.mockResolvedValueOnce({ mu: 0.01, sigma: 0.02, n: 500 });

    const res = await AnalyticsService.varCvarPushdown("qh-1", {
      returnColumn: "r",
      method: "parametric",
      confidence: 0.95,
    });

    expect(mockAggregate).toHaveBeenCalledTimes(1);
    const projection = mockAggregate.mock.calls[0][1] as string;
    expect(projection).toContain('avg("r")');
    expect(projection).toContain('stddev_samp("r")');
    expect(projection).toContain('count("r")');

    expect(res).not.toBeNull();
    expect(res!.method).toBe("parametric");
    // var = -(mu + z·sigma), z = tInverseCDF(0.05, 1000) ≈ -1.6464.
    expect(res!.var).toBeCloseTo(-(0.01 - 1.6464 * 0.02), 3);
    // Normal CVaR exceeds VaR.
    expect(res!.cvar).toBeGreaterThan(res!.var);
  });

  it("historical: pushes percentile_cont then the tail avg; residue is -cutoff / -tailMean", async () => {
    mockAggregate
      .mockResolvedValueOnce({ cutoff: -0.05, n: 200 })
      .mockResolvedValueOnce({ tail_mean: -0.08, tail_n: 10 });

    const res = await AnalyticsService.varCvarPushdown("qh-2", {
      returnColumn: "r",
      method: "historical",
      confidence: 0.95,
    });

    const cutoffProjection = mockAggregate.mock.calls[0][1] as string;
    expect(cutoffProjection).toContain("percentile_cont(");
    expect(cutoffProjection).toContain('WITHIN GROUP (ORDER BY "r")');
    const tailProjection = mockAggregate.mock.calls[1][1] as string;
    expect(tailProjection).toContain('FILTER (WHERE "r" <= -0.05)');

    expect(res).toMatchObject({
      var: 0.05,
      cvar: 0.08,
      tailCount: 10,
      method: "historical",
    });
  });

  it("returns null when the handle is not re-executable (caller falls back)", async () => {
    mockAggregate.mockResolvedValueOnce(null);
    const res = await AnalyticsService.varCvarPushdown("qh-3", {
      returnColumn: "r",
    });
    expect(res).toBeNull();
  });

  it("throws when the source has fewer than 2 returns", async () => {
    mockAggregate.mockResolvedValueOnce({ cutoff: -0.05, n: 1 });
    await expect(
      AnalyticsService.varCvarPushdown("qh-4", { returnColumn: "r" })
    ).rejects.toThrow(/at least 2/);
  });
});

describe("VarCvarTool routing (#130 E2c)", () => {
  type ExecTool = {
    execute: (input: unknown) => Promise<Record<string, unknown>>;
  };

  it("uses pushdown for a queryHandle", async () => {
    mockAggregate.mockResolvedValueOnce({ mu: 0, sigma: 0.02, n: 300 });
    const tool = new VarCvarTool().build() as unknown as ExecTool;

    const res = await tool.execute({
      queryHandle: "qh-x",
      returnColumn: "r",
      method: "parametric",
    });

    expect(mockAggregate).toHaveBeenCalledTimes(1);
    expect(res.method).toBe("parametric");
  });

  it("uses in-memory compute for inline rows (no pushdown)", async () => {
    const tool = new VarCvarTool().build() as unknown as ExecTool;
    const rows = [0.01, -0.02, 0.03, -0.05, 0.0, -0.1, 0.02].map((r) => ({
      r,
    }));

    const res = await tool.execute({
      rows,
      returnColumn: "r",
      method: "historical",
    });

    expect(mockAggregate).not.toHaveBeenCalled();
    expect(res).toHaveProperty("var");
    expect(res).toHaveProperty("cvar");
  });
});
