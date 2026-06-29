import { describe, it, expect } from "@jest/globals";

import { AnalyticsService } from "../../services/analytics.service.js";

// A cleanly separable 1-feature problem (y = 1 iff x > 5), replicated so the
// single-pass online fit sees enough gradient steps to converge.
const BASE: Record<string, unknown>[] = [];
for (let x = 0; x <= 10; x++) {
  if (x === 5) continue; // leave a margin around the boundary
  BASE.push({ x, y: x > 5 ? 1 : 0 });
}
const SEPARABLE: Record<string, unknown>[] = [];
for (let rep = 0; rep < 200; rep++) SEPARABLE.push(...BASE);

async function* asStream(records: Record<string, unknown>[], batch: number) {
  for (let i = 0; i < records.length; i += batch) yield records.slice(i, i + batch);
}

describe("logisticRegressionFromStream (#153 AdaGrad SGD)", () => {
  it("converges to the same decision direction as in-memory IRLS", async () => {
    const inMemory = AnalyticsService.logisticRegression({
      records: SEPARABLE,
      x: "x",
      y: "y",
    });
    const streamed = await AnalyticsService.logisticRegressionFromStream(
      asStream(SEPARABLE, 16),
      { x: "x", y: "y" }
    );

    expect(streamed.count).toBe(SEPARABLE.length);
    expect(streamed.coefficients).toHaveLength(2);
    // Same sign on both coefficients (intercept −, slope +) → same boundary.
    expect(Math.sign(streamed.coefficients[0])).toBe(
      Math.sign(inMemory.coefficients[0])
    );
    expect(Math.sign(streamed.coefficients[1])).toBe(
      Math.sign(inMemory.coefficients[1])
    );
    expect(streamed.coefficients[1]).toBeGreaterThan(0); // x↑ ⇒ P(y=1)↑
    // Prequential accuracy is high on a separable problem.
    expect(streamed.accuracy).toBeGreaterThan(0.8);
    expect(streamed.logLoss).toBeGreaterThan(0);
  });

  it("fits a multivariate problem (xColumns)", async () => {
    const recs: Record<string, unknown>[] = [];
    for (let rep = 0; rep < 200; rep++) {
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
          recs.push({ a, b, y: a + b > 3 ? 1 : 0 });
        }
      }
    }
    const streamed = await AnalyticsService.logisticRegressionFromStream(
      asStream(recs, 32),
      { xColumns: ["a", "b"], y: "y" }
    );
    expect(streamed.coefficients).toHaveLength(3); // intercept + a + b
    expect(streamed.coefficients[1]).toBeGreaterThan(0); // a↑ ⇒ y
    expect(streamed.coefficients[2]).toBeGreaterThan(0); // b↑ ⇒ y
    expect(streamed.accuracy).toBeGreaterThan(0.75);
  });

  it("is invariant to batch size", async () => {
    const a = await AnalyticsService.logisticRegressionFromStream(
      asStream(SEPARABLE, 1),
      { x: "x", y: "y" }
    );
    const b = await AnalyticsService.logisticRegressionFromStream(
      asStream(SEPARABLE, 500),
      { x: "x", y: "y" }
    );
    expect(a.coefficients).toEqual(b.coefficients);
    expect(a.accuracy).toBeCloseTo(b.accuracy, 12);
  });

  it("rejects a single-class stream", async () => {
    await expect(
      AnalyticsService.logisticRegressionFromStream(
        asStream([{ x: 1, y: 0 }, { x: 2, y: 0 }], 1),
        { x: "x", y: "y" }
      )
    ).rejects.toThrow(/one of each class/);
  });

  it("rejects specifying both x and xColumns", async () => {
    await expect(
      AnalyticsService.logisticRegressionFromStream(asStream(BASE, 4), {
        x: "x",
        xColumns: ["x"],
        y: "y",
      })
    ).rejects.toThrow(/either x or xColumns/);
  });
});
