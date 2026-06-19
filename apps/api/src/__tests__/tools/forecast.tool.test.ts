/* global AbortController */
import { jest, describe, it, expect } from "@jest/globals";

// record-source.ts (loaded transitively by the tool) imports the handle
// service. Inline rows touch no handle I/O, so the mock just needs to satisfy
// the import bindings — it is never called in these tests.
jest.unstable_mockModule("../../services/portal-sql-handle.service.js", () => ({
  PortalSqlHandleService: {
    getSnapshot: jest.fn(),
    getMeta: jest.fn(),
    streamHandle: jest.fn(),
  },
  resolveTiebreaker: (schema: Array<{ name: string }>) =>
    schema.find((c) => c.name === "_record_id" || c.name === "id")?.name ??
    null,
}));

const { ForecastTool } = await import("../../tools/forecast.tool.js");
const { AnalyticsService } = await import(
  "../../services/analytics.service.js"
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exec(input: any) {
  const t = new ForecastTool().build();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (t as any).execute(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });
}

describe("ForecastTool — streaming fold over inline rows (#129)", () => {
  // Deliberately SHUFFLED rows: the tool must order by dateColumn before
  // folding, matching the whole-array path (which sorts internally).
  const shuffled = (() => {
    const ordered = Array.from({ length: 24 }, (_, i) => ({
      date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      value: 100 + 10 * Math.sin((2 * Math.PI * i) / 12),
    }));
    // a fixed non-trivial permutation
    return [12, 3, 0, 23, 7, 1, 19, 5, 14, 2, 11, 8, 22, 4, 16, 9, 21, 6, 15, 10, 20, 13, 18, 17].map(
      (i) => ordered[i]
    );
  })();

  const params = {
    dateColumn: "date",
    valueColumn: "value",
    horizon: 6,
    seasonalPeriod: 12,
    seasonality: "additive" as const,
    trend: "none" as const,
  };

  it("equals the whole-array forecast despite unordered input", async () => {
    const result = await exec({ ...params, rows: shuffled });
    const whole = AnalyticsService.forecast({ ...params, records: shuffled });

    result.forecast.values.forEach((v: number, i: number) =>
      expect(v).toBeCloseTo(whole.forecast.values[i], 8)
    );
    result.forecast.lower.forEach((v: number, i: number) =>
      expect(v).toBeCloseTo(whole.forecast.lower[i], 8)
    );
    result.forecast.upper.forEach((v: number, i: number) =>
      expect(v).toBeCloseTo(whole.forecast.upper[i], 8)
    );
    expect(result.forecast.dates).toEqual(whole.forecast.dates);
    expect(result.mape).toBeCloseTo(whole.mape, 8);
  });

  it("returns the reduced shape — no full-length series arrays", async () => {
    const result = await exec({ ...params, rows: shuffled });
    expect(result).not.toHaveProperty("observed");
    expect(result).not.toHaveProperty("fitted");
    expect(result).not.toHaveProperty("dates");
    expect(result.forecast.values).toHaveLength(6);
    expect(result.count).toBe(24);
  });
});
