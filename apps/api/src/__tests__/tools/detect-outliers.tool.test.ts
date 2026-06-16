import { describe, it, expect } from "@jest/globals";

import { DetectOutliersTool } from "../../tools/detect-outliers.tool.js";

describe("DetectOutliersTool", () => {
  const built = new DetectOutliersTool().build() as unknown as {
    execute: (input: unknown) => Promise<{ outliers: unknown[] }>;
  };

  it("flags an obvious outlier over inline rows", async () => {
    const rows = [{ v: 10 }, { v: 11 }, { v: 12 }, { v: 11 }, { v: 999 }];
    const result = await built.execute({
      rows,
      column: "v",
      method: "iqr",
    });
    expect(result.outliers.length).toBeGreaterThan(0);
  });

  it("rejects input with neither queryHandle nor rows", () => {
    expect(
      new DetectOutliersTool().schema.safeParse({ column: "v", method: "iqr" })
        .success
    ).toBe(false);
  });
});
