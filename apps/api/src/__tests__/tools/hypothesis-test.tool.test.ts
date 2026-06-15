import { describe, it, expect } from "@jest/globals";

import { HypothesisTestTool } from "../../tools/hypothesis-test.tool.js";

describe("HypothesisTestTool", () => {
  const built = new HypothesisTestTool().build() as unknown as {
    execute: (input: unknown) => Promise<{ pValue: number; statistic: number }>;
  };

  it("runs chi_squared with no data source (observed/expected only)", async () => {
    const result = await built.execute({
      test: "chi_squared",
      observed: [10, 20, 30],
      expected: [20, 20, 20],
    });
    expect(typeof result.statistic).toBe("number");
    expect(typeof result.pValue).toBe("number");
  });

  it("runs a column-based t-test over inline rows", async () => {
    const result = await built.execute({
      test: "t_test_one_sample",
      rows: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }],
      columnA: "v",
      mu: 0,
    });
    expect(typeof result.pValue).toBe("number");
  });

  it("accepts neither a source nor observed (schema is permissive; test logic validates)", () => {
    // Unlike the strict-XOR compute tools, hypothesis_test's data source
    // is optional, so the schema accepts test-only input.
    expect(
      new HypothesisTestTool().schema.safeParse({ test: "chi_squared" }).success
    ).toBe(true);
  });
});
