import { describe, it, expect } from "@jest/globals";

const { sheetId } = await import("../../utils/workbook-preview.util.js");

describe("sheetId", () => {
  it("slugs the sheet name", () => {
    expect(sheetId(0, "Q1 Sales")).toBe("sheet_0_q1_sales");
  });

  // #805: the id is stored in layout plans (jsonb), which can't hold U+0000.
  it("drops U+0000 from the name", () => {
    expect(sheetId(2, "Ta\u0000b")).toBe("sheet_2_tab");
  });
});
