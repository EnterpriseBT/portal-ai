import { describe, it, expect } from "@jest/globals";

import { RegressionTool } from "../../tools/regression.tool.js";
import { LogisticRegressionTool } from "../../tools/logistic-regression.tool.js";
import { ForecastTool } from "../../tools/forecast.tool.js";

type ExecTool = { execute: (input: unknown) => Promise<unknown> };

// Pure-path tests for the regression pack: inline `rows` drive the full
// compute with no SDK / DB / stationData mocks. Exact statistical
// correctness is covered by analytics.service.test.ts; these assert the
// refactored pure contract (input shape + record resolution + call-through).

describe("RegressionTool", () => {
  const built = new RegressionTool().build() as unknown as {
    execute: (input: unknown) => Promise<{ rSquared: number }>;
  };

  it("fits a perfect line over inline rows", async () => {
    const result = await built.execute({
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
    expect(result.rSquared).toBeCloseTo(1, 5);
  });

  it("rejects input with neither queryHandle nor rows", () => {
    expect(
      new RegressionTool().schema.safeParse({ x: "x", y: "y", type: "linear" })
        .success
    ).toBe(false);
  });
});

describe("LogisticRegressionTool", () => {
  const built = new LogisticRegressionTool().build() as unknown as {
    execute: (input: unknown) => Promise<Record<string, unknown>>;
  };

  it("fits over inline rows and returns coefficients", async () => {
    const result = await built.execute({
      rows: [
        { x: -3, y: 0 },
        { x: -2, y: 0 },
        { x: -1, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
      ],
      x: "x",
      y: "y",
    });
    expect(result).toHaveProperty("coefficients");
  });
});

// The time-series tools: assert the pure path wires through (input shape
// → record resolution → AnalyticsService) and returns a result. Numeric
// correctness is covered by analytics.service.test.ts.
// (trend / changepoint / decompose removed in #130 E2 — expressed in sql_query.)

describe("ForecastTool", () => {
  const built = new ForecastTool().build() as unknown as ExecTool;

  it("forecasts future periods over inline rows", async () => {
    const result = await built.execute({
      rows: [10, 12, 14, 16, 18, 20].map((v, i) => ({
        d: `2024-01-0${i + 1}`,
        v,
      })),
      dateColumn: "d",
      valueColumn: "v",
      horizon: 3,
    });
    expect(result).toBeTruthy();
  });
});
