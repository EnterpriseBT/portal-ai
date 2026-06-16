import { describe, it, expect } from "@jest/globals";

import { CorrelateTool } from "../../tools/correlate.tool.js";

describe("CorrelateTool", () => {
  const built = new CorrelateTool().build() as unknown as {
    execute: (input: unknown) => Promise<{ correlation: number }>;
  };

  it("computes a perfect positive correlation over inline rows", async () => {
    const result = await built.execute({
      rows: [
        { a: 1, b: 2 },
        { a: 2, b: 4 },
        { a: 3, b: 6 },
        { a: 4, b: 8 },
      ],
      columnA: "a",
      columnB: "b",
    });
    expect(result.correlation).toBeCloseTo(1, 5);
  });

  it("rejects input with neither queryHandle nor rows", () => {
    expect(
      new CorrelateTool().schema.safeParse({ columnA: "a", columnB: "b" })
        .success
    ).toBe(false);
  });
});
