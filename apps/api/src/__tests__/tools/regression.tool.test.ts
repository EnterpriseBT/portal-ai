import { describe, it, expect } from "@jest/globals";

import { RegressionTool } from "../../tools/regression.tool.js";

describe("RegressionTool — schema", () => {
  const tool = new RegressionTool();

  it("accepts a polynomial spec without degree (degree is optional)", () => {
    const result = tool.schema.safeParse({
      entity: "rev",
      x: "month",
      y: "revenue",
      type: "polynomial",
    });
    expect(result.success).toBe(true);
  });

  it("accepts degree within the [2, 10] bound", () => {
    for (const degree of [2, 5, 10]) {
      const result = tool.schema.safeParse({
        entity: "rev",
        x: "month",
        y: "revenue",
        type: "polynomial",
        degree,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects degree below 2", () => {
    const result = tool.schema.safeParse({
      entity: "rev",
      x: "month",
      y: "revenue",
      type: "polynomial",
      degree: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects degree above 10", () => {
    const result = tool.schema.safeParse({
      entity: "rev",
      x: "month",
      y: "revenue",
      type: "polynomial",
      degree: 11,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer degree", () => {
    const result = tool.schema.safeParse({
      entity: "rev",
      x: "month",
      y: "revenue",
      type: "polynomial",
      degree: 2.5,
    });
    expect(result.success).toBe(false);
  });
});
