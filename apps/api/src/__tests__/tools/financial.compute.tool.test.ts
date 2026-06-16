import { describe, it, expect } from "@jest/globals";

import { TechnicalIndicatorTool } from "../../tools/technical-indicator.tool.js";
import { SharpeRatioTool } from "../../tools/sharpe-ratio.tool.js";
import { MaxDrawdownTool } from "../../tools/max-drawdown.tool.js";
import { RollingReturnsTool } from "../../tools/rolling-returns.tool.js";
import { VarCvarTool } from "../../tools/var-cvar.tool.js";
import { PortfolioMetricsTool } from "../../tools/portfolio-metrics.tool.js";

// Pure-path tests for the data-dependent financial tools: inline `rows`
// drive the full compute with no SDK / DB / stationData mocks. Exact
// numeric correctness is covered by analytics.service.test.ts.

type ExecTool = { execute: (input: unknown) => Promise<unknown> };

const priceRows = [10, 11, 12, 11, 13, 14, 13, 15].map((v, i) => ({
  d: `2024-01-0${i + 1}`,
  v,
}));
const returnRows = [0.01, -0.02, 0.03, -0.01, 0.02, -0.03, 0.01, 0.02].map(
  (r) => ({ r })
);

describe("SharpeRatioTool", () => {
  const built = new SharpeRatioTool().build() as unknown as ExecTool;

  it("computes over inline rows", async () => {
    const result = await built.execute({ rows: returnRows, valueColumn: "r" });
    expect(result).toBeDefined();
  });

  it("rejects input with neither queryHandle nor rows", () => {
    expect(
      new SharpeRatioTool().schema.safeParse({ valueColumn: "r" }).success
    ).toBe(false);
  });
});

describe("MaxDrawdownTool", () => {
  const built = new MaxDrawdownTool().build() as unknown as ExecTool;

  it("computes over inline rows", async () => {
    const result = await built.execute({
      rows: priceRows,
      dateColumn: "d",
      valueColumn: "v",
    });
    expect(result).toBeDefined();
  });
});

describe("RollingReturnsTool", () => {
  const built = new RollingReturnsTool().build() as unknown as ExecTool;

  it("computes over inline rows", async () => {
    const result = await built.execute({
      rows: priceRows,
      dateColumn: "d",
      valueColumn: "v",
      window: 2,
    });
    expect(result).toBeDefined();
  });
});

describe("VarCvarTool", () => {
  const built = new VarCvarTool().build() as unknown as ExecTool;

  it("computes over inline rows", async () => {
    const result = await built.execute({ rows: returnRows, returnColumn: "r" });
    expect(result).toBeDefined();
  });
});

describe("PortfolioMetricsTool", () => {
  const built = new PortfolioMetricsTool().build() as unknown as ExecTool;

  it("computes over inline rows without a benchmark", async () => {
    const result = await built.execute({ rows: returnRows, returnColumn: "r" });
    expect(result).toBeDefined();
  });

  it("computes with an inline benchmark source", async () => {
    const result = await built.execute({
      rows: returnRows,
      returnColumn: "r",
      benchmarkRows: returnRows.map((x) => ({ b: x.r })),
      benchmarkReturnColumn: "b",
    });
    expect(result).toBeDefined();
  });

  it("throws when a benchmark source is given without benchmarkReturnColumn", async () => {
    await expect(
      built.execute({
        rows: returnRows,
        returnColumn: "r",
        benchmarkRows: returnRows.map((x) => ({ b: x.r })),
      })
    ).rejects.toThrow(/benchmarkReturnColumn/);
  });
});

describe("TechnicalIndicatorTool", () => {
  const built = new TechnicalIndicatorTool().build() as unknown as ExecTool;

  it("computes an SMA over inline rows", async () => {
    const result = await built.execute({
      rows: priceRows,
      dateColumn: "d",
      valueColumn: "v",
      indicator: "SMA",
      params: { period: 3 },
    });
    expect(result).toBeDefined();
  });

  it("rejects input with neither queryHandle nor rows", () => {
    expect(
      new TechnicalIndicatorTool().schema.safeParse({
        dateColumn: "d",
        valueColumn: "v",
        indicator: "SMA",
      }).success
    ).toBe(false);
  });
});
