import { describe, it, expect } from "@jest/globals";

import { ClusterTool } from "../../tools/cluster.tool.js";

describe("ClusterTool", () => {
  const built = new ClusterTool().build() as unknown as {
    execute: (input: unknown) => Promise<{ centroids: unknown[] }>;
  };

  it("clusters inline rows into k groups", async () => {
    // Two clearly separated blobs.
    const rows = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0.5 },
      { x: 100, y: 100 },
      { x: 101, y: 99 },
      { x: 99, y: 101 },
    ];
    const result = await built.execute({
      rows,
      columns: ["x", "y"],
      k: 2,
      seed: 1,
    });
    expect(result.centroids).toHaveLength(2);
  });

  it("rejects input with neither queryHandle nor rows", () => {
    expect(
      new ClusterTool().schema.safeParse({ columns: ["x"], k: 2 }).success
    ).toBe(false);
  });
});
