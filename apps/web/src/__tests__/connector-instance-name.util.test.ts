import { describe, it, expect } from "@jest/globals";

import { generatedConnectorName } from "../utils/connector-instance-name.util";

// #801: a connector named after a file or a workbook/sheet title the user
// can't edit is clipped to the name limit instead of failing the commit.
describe("generatedConnectorName", () => {
  it("passes a short title through, trimmed", () => {
    expect(generatedConnectorName("  Q3 sales  ", "Upload")).toBe("Q3 sales");
  });

  it("falls back when the title is blank", () => {
    expect(generatedConnectorName("   ", "Upload")).toBe("Upload");
  });

  it("clips a long title to 120 characters with an ellipsis", () => {
    const name = generatedConnectorName("t".repeat(150), "Upload");
    expect(name).toHaveLength(120);
    expect(name.endsWith("…")).toBe(true);
  });
});
