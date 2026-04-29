import { describe, it, expect } from "@jest/globals";

import { googleSheetsToWorkbook } from "../../services/google-sheets-workbook.service.js";

describe("googleSheetsToWorkbook", () => {
  it("maps a single sheet with primitive values to WorkbookData", () => {
    const response = {
      properties: { title: "My Workbook" },
      sheets: [
        {
          properties: { title: "Sheet1", gridProperties: { rowCount: 2, columnCount: 3 } },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: [
                    { effectiveValue: { stringValue: "name" }, formattedValue: "name" },
                    { effectiveValue: { stringValue: "age" }, formattedValue: "age" },
                    { effectiveValue: { stringValue: "active" }, formattedValue: "active" },
                  ],
                },
                {
                  values: [
                    { effectiveValue: { stringValue: "Alice" }, formattedValue: "Alice" },
                    { effectiveValue: { numberValue: 30 }, formattedValue: "30" },
                    { effectiveValue: { boolValue: true }, formattedValue: "TRUE" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const out = googleSheetsToWorkbook(response);
    expect(out.sheets).toHaveLength(1);
    const sheet = out.sheets[0]!;
    expect(sheet.name).toBe("Sheet1");
    expect(sheet.dimensions).toEqual({ rows: 2, cols: 3 });
    expect(sheet.cells).toEqual([
      { row: 1, col: 1, value: "name", rawText: "name" },
      { row: 1, col: 2, value: "age", rawText: "age" },
      { row: 1, col: 3, value: "active", rawText: "active" },
      { row: 2, col: 1, value: "Alice", rawText: "Alice" },
      { row: 2, col: 2, value: 30, rawText: "30" },
      { row: 2, col: 3, value: true, rawText: "TRUE" },
    ]);
  });

  it("maps multiple tabs into separate sheets, preserving names verbatim", () => {
    const response = {
      sheets: [
        {
          properties: {
            title: "Cases",
            gridProperties: { rowCount: 1, columnCount: 1 },
          },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: [
                    {
                      effectiveValue: { stringValue: "case-1" },
                      formattedValue: "case-1",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          properties: {
            title: "Headcount",
            gridProperties: { rowCount: 1, columnCount: 1 },
          },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: [
                    {
                      effectiveValue: { numberValue: 42 },
                      formattedValue: "42",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const out = googleSheetsToWorkbook(response);
    expect(out.sheets.map((s) => s.name)).toEqual(["Cases", "Headcount"]);
  });

  it("emits no cell entries for sparse / empty cells", () => {
    const response = {
      sheets: [
        {
          properties: {
            title: "Sheet1",
            gridProperties: { rowCount: 2, columnCount: 3 },
          },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: [
                    {
                      effectiveValue: { stringValue: "a" },
                      formattedValue: "a",
                    },
                    {}, // gap
                    {
                      effectiveValue: { stringValue: "c" },
                      formattedValue: "c",
                    },
                  ],
                },
                { values: [] }, // entire empty row
              ],
            },
          ],
        },
      ],
    };

    const out = googleSheetsToWorkbook(response);
    const cells = out.sheets[0]!.cells;
    // Two non-empty cells emitted; empty middle cell + entire empty row are skipped.
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => `${c.row},${c.col}=${c.value}`)).toEqual([
      "1,1=a",
      "1,3=c",
    ]);
  });

  it("coerces DATE-formatted serial numbers into Date objects", () => {
    // Sheets serial 44197 = 2021-01-01 (epoch 1899-12-30, with leap-year quirk).
    const response = {
      sheets: [
        {
          properties: {
            title: "Sheet1",
            gridProperties: { rowCount: 1, columnCount: 1 },
          },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: [
                    {
                      effectiveValue: { numberValue: 44197 },
                      formattedValue: "1/1/2021",
                      effectiveFormat: { numberFormat: { type: "DATE" } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const out = googleSheetsToWorkbook(response);
    const cell = out.sheets[0]!.cells[0]!;
    expect(cell.value).toBeInstanceOf(Date);
    const d = cell.value as Date;
    expect(d.getUTCFullYear()).toBe(2021);
    expect(d.getUTCMonth()).toBe(0); // January
    expect(d.getUTCDate()).toBe(1);
  });

  it("coerces DATE_TIME-formatted serial numbers including fractional time", () => {
    // 44197.5 = 2021-01-01 12:00 UTC.
    const response = {
      sheets: [
        {
          properties: {
            title: "Sheet1",
            gridProperties: { rowCount: 1, columnCount: 1 },
          },
          data: [
            {
              rowData: [
                {
                  values: [
                    {
                      effectiveValue: { numberValue: 44197.5 },
                      effectiveFormat: { numberFormat: { type: "DATE_TIME" } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = googleSheetsToWorkbook(response);
    const d = out.sheets[0]!.cells[0]!.value as Date;
    expect(d.getUTCHours()).toBe(12);
  });

  it("uses formattedValue as the display text for formula cells", () => {
    const response = {
      sheets: [
        {
          properties: {
            title: "Sheet1",
            gridProperties: { rowCount: 1, columnCount: 1 },
          },
          data: [
            {
              rowData: [
                {
                  values: [
                    {
                      // Formula cell: userEnteredValue is the formula, but
                      // effectiveValue carries the computed result.
                      userEnteredValue: { formulaValue: "=1+1" },
                      effectiveValue: { numberValue: 2 },
                      formattedValue: "2",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = googleSheetsToWorkbook(response);
    const cell = out.sheets[0]!.cells[0]!;
    expect(cell.value).toBe(2);
    expect(cell.rawText).toBe("2");
  });

  it("validates against WorkbookSchema (rejects malformed shapes via throw)", () => {
    // No sheets at all → schema requires .min(1)
    expect(() =>
      googleSheetsToWorkbook({ sheets: [] })
    ).toThrow(/workbook/i);
  });
});
