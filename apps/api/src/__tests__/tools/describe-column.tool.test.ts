import { describe, it, expect } from "@jest/globals";

import { DescribeColumnTool } from "../../tools/describe-column.tool.js";

// Pure-path tests: inline `rows` drive the full compute with no SDK,
// DB, or stationData mocks. The handle path is covered in
// compute-input.util.test.ts.

describe("DescribeColumnTool", () => {
  const built = new DescribeColumnTool().build() as unknown as {
    execute: (input: unknown) => Promise<{ count: number; mean: number }>;
  };

  it("computes stats over inline rows", async () => {
    const result = await built.execute({
      rows: [{ amount: 1 }, { amount: 2 }, { amount: 3 }, { amount: 4 }],
      column: "amount",
    });
    expect(result.count).toBe(4);
    expect(result.mean).toBe(2.5);
  });

  it("rejects input with neither queryHandle nor rows", () => {
    const tool = new DescribeColumnTool();
    expect(tool.schema.safeParse({ column: "amount" }).success).toBe(false);
  });

  it("accepts a queryHandle without rows", () => {
    const tool = new DescribeColumnTool();
    expect(
      tool.schema.safeParse({ queryHandle: "qh-1", column: "amount" }).success
    ).toBe(true);
  });
});
