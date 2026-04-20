import { ToolPackUtil } from "../utils/tool-packs.util";

describe("ToolPackUtil.getLabel", () => {
  it("returns the human-readable label for known packs", () => {
    expect(ToolPackUtil.getLabel("data_query")).toBe("Data Query");
    expect(ToolPackUtil.getLabel("statistics")).toBe("Statistics");
    expect(ToolPackUtil.getLabel("regression")).toBe("Regression");
    expect(ToolPackUtil.getLabel("financial")).toBe("Financial");
    expect(ToolPackUtil.getLabel("web_search")).toBe("Web Search");
    expect(ToolPackUtil.getLabel("entity_management")).toBe(
      "Entity Management"
    );
  });

  it("falls back to the raw key for unknown packs", () => {
    expect(ToolPackUtil.getLabel("unknown_pack")).toBe("unknown_pack");
  });
});
