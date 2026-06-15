import { describe, it, expect } from "@jest/globals";

import { AggregateTool } from "../../tools/aggregate.tool.js";

describe("AggregateTool", () => {
  const built = new AggregateTool().build() as unknown as {
    execute: (input: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  };

  it("groups inline rows and reduces per group", async () => {
    const rows = [
      { region: "east", amount: 10 },
      { region: "east", amount: 20 },
      { region: "west", amount: 5 },
    ];
    const result = await built.execute({
      rows,
      groupBy: ["region"],
      metrics: [{ op: "sum", column: "amount", as: "total" }],
    });
    const east = result.rows.find((r) => r.region === "east");
    const west = result.rows.find((r) => r.region === "west");
    expect(east?.total).toBe(30);
    expect(west?.total).toBe(5);
  });

  it("rejects input with neither queryHandle nor rows", () => {
    expect(
      new AggregateTool().schema.safeParse({
        groupBy: [],
        metrics: [{ op: "count" }],
      }).success
    ).toBe(false);
  });
});
