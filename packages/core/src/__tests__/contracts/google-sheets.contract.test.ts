import * as googleSheetsContract from "../../contracts/google-sheets.contract.js";
import {
  GoogleSheetsAuthorizeResponsePayloadSchema,
  GoogleSheetsSelectSheetRequestBodySchema,
  GoogleSheetsSelectSheetResponsePayloadSchema,
  GoogleSheetsSheetSliceRequestSchema,
} from "../../contracts/google-sheets.contract.js";

/**
 * Google Sheets connector contracts.
 *
 * This file had no test until #408, which is part of why the Drive
 * `files.list` schemas could be deleted without anything noticing — the
 * proxy they described was removed when the connector narrowed to
 * `drive.file`, under which the app cannot list a user's spreadsheets at
 * all. The surviving contracts are pinned here so the next removal is a
 * deliberate act rather than a silent one.
 */

// ── The removed listing contracts ────────────────────────────────────

describe("the Drive files.list contracts (#408)", () => {
  it("no longer exports the list-sheets schemas or types", () => {
    // Named rather than inferred: a re-introduction should fail loudly and
    // say what came back.
    const exported = Object.keys(googleSheetsContract);
    for (const name of [
      "GoogleSheetsListSheetsRequestQuerySchema",
      "GoogleSheetsListSheetsItemSchema",
      "GoogleSheetsListSheetsResponsePayloadSchema",
    ]) {
      expect(exported).not.toContain(name);
    }
  });

  it("exports nothing else named ListSheets", () => {
    expect(
      Object.keys(googleSheetsContract).filter((k) => k.includes("ListSheets"))
    ).toEqual([]);
  });
});

// ── The surviving contracts ──────────────────────────────────────────

describe("GoogleSheetsAuthorizeResponsePayloadSchema", () => {
  it("accepts a consent URL", () => {
    const result = GoogleSheetsAuthorizeResponsePayloadSchema.safeParse({
      url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-URL", () => {
    const result = GoogleSheetsAuthorizeResponsePayloadSchema.safeParse({
      url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("GoogleSheetsSelectSheetRequestBodySchema", () => {
  it("accepts a spreadsheetId", () => {
    const result = GoogleSheetsSelectSheetRequestBodySchema.safeParse({
      spreadsheetId: "1abcXYZ",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty spreadsheetId", () => {
    // The Picker always yields an id; an empty one means the caller lost it
    // between the pick and the POST.
    const result = GoogleSheetsSelectSheetRequestBodySchema.safeParse({
      spreadsheetId: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("GoogleSheetsSelectSheetResponsePayloadSchema", () => {
  it("accepts an inline preview", () => {
    const result = GoogleSheetsSelectSheetResponsePayloadSchema.safeParse({
      title: "Q3 Forecast",
      sheets: [
        {
          id: "sheet-0",
          name: "Sheet1",
          dimensions: { rows: 1, cols: 1 },
          cells: [["alpha"]],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("GoogleSheetsSheetSliceRequestSchema", () => {
  it("accepts a slice window", () => {
    const result = GoogleSheetsSheetSliceRequestSchema.safeParse({
      connectorInstanceId: "ci-1",
      sheetId: "sheet-0",
      rowStart: 0,
      rowEnd: 100,
      colStart: 0,
      colEnd: 26,
    });
    expect(result.success).toBe(true);
  });
});
