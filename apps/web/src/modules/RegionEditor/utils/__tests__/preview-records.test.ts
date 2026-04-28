import { describe, it, expect } from "@jest/globals";

import { buildPreviewRecords } from "../preview-records.util";
import type {
  RegionDraft,
  SheetPreview,
} from "../region-editor.types";

function sheet(cells: (string | number | null)[][]): SheetPreview {
  return {
    id: "s1",
    name: "Sheet",
    rowCount: cells.length,
    colCount: cells[0]?.length ?? 0,
    cells,
  };
}

describe("buildPreviewRecords — 2D crosstab with mixed segments per axis", () => {
  // The shape the user described:
  //   row axis    = [field(HQ, Industry), pivot(year)]
  //   column axis = [field(scope, currency), pivot(company)]
  //   cellValueField = amount
  //
  // Sheet layout (rows × cols), startRow=0, startCol=0:
  //          col0     col1     col2     col3 (year-1) col4 (year-2)
  //  row0   "anchor"  HQ       Industry  2020          2021         <- row-axis labels
  //  row1   scope     ?        ?         ?             ?            <- col-axis field "scope"
  //  row2   currency  ?        ?         ?             ?            <- col-axis field "currency"
  //  row3   acme      hq-acme  ind-acme  100           110          <- col-axis pivot company "acme"
  //  row4   beta      hq-beta  ind-beta  200           210          <- col-axis pivot company "beta"
  //
  // Static row-axis fields (HQ, Industry) live in cols 1-2 — their VALUES
  // for a record at (cp.row, rp.col) read from cell(cp.row, fieldCol).
  // Static col-axis fields (scope, currency) live in rows 1-2 — their
  // VALUES for the same record read from cell(fieldRow, rp.col).
  it("emits one record per (row-pivot × col-pivot) cell with sidebar fields from both axes", () => {
    const cells = [
      ["anchor", "HQ", "Industry", "2020", "2021"],
      ["scope", "", "", "scope-2020", "scope-2021"],
      ["currency", "", "", "USD", "EUR"],
      ["acme", "NYC", "Tech", 100, 110],
      ["beta", "LA", "Retail", 200, 210],
    ];
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 4 },
      targetEntityDefinitionId: "metrics",
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 1 },
          { kind: "field", positionCount: 2 },
          {
            kind: "pivot",
            id: "rp_year",
            axisName: "year",
            axisNameSource: "user",
            positionCount: 2,
          },
        ],
        column: [
          { kind: "field", positionCount: 1 },
          { kind: "field", positionCount: 2 },
          {
            kind: "pivot",
            id: "cp_company",
            axisName: "company",
            axisNameSource: "user",
            positionCount: 2,
          },
        ],
      },
      cellValueField: { name: "amount", nameSource: "user" },
    };

    const result = buildPreviewRecords(region, sheet(cells));

    // Columns: row-axis fields, then col-axis fields, then row-axis pivot
    // axisName, then col-axis pivot axisName, then the cell-value field.
    // The leading "anchor" field (positionCount 1 starting at offset 0) reads
    // its header from the corner cell — labelled "anchor" in this fixture.
    expect(result.columns.map((c) => c.label)).toEqual([
      "anchor",
      "HQ",
      "Industry",
      "anchor",
      "scope",
      "currency",
      "year",
      "company",
      "amount",
    ]);

    // 2 years × 2 companies = 4 records.
    expect(result.rows).toHaveLength(4);

    const acme2020 = result.rows.find(
      (r) => r.year === "2020" && r.company === "acme"
    );
    expect(acme2020).toBeDefined();
    expect(acme2020?.HQ).toBe("NYC");
    expect(acme2020?.Industry).toBe("Tech");
    expect(acme2020?.scope).toBe("scope-2020");
    expect(acme2020?.currency).toBe("USD");
    expect(acme2020?.amount).toBe(100);

    const beta2021 = result.rows.find(
      (r) => r.year === "2021" && r.company === "beta"
    );
    expect(beta2021?.HQ).toBe("LA");
    expect(beta2021?.Industry).toBe("Retail");
    expect(beta2021?.scope).toBe("scope-2021");
    expect(beta2021?.currency).toBe("EUR");
    expect(beta2021?.amount).toBe(210);
  });

  it("uses the per-intersection cellValueField override as the column for that block", () => {
    const cells = [
      ["", "yr1", "yr2"],
      ["", 1, 2],
      ["c1", 10, 20],
      ["c2", 30, 40],
    ];
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
      targetEntityDefinitionId: "metrics",
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "rp",
            axisName: "year",
            axisNameSource: "user",
            positionCount: 2,
          },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "cp",
            axisName: "company",
            axisNameSource: "user",
            positionCount: 2,
          },
        ],
      },
      cellValueField: { name: "amount", nameSource: "user" },
      intersectionCellValueFields: {
        rp__cp: { name: "headcount", nameSource: "user" },
      },
    };
    const result = buildPreviewRecords(region, sheet(cells));
    expect(result.columns.map((c) => c.label)).toContain("headcount");
    expect(result.columns.map((c) => c.label)).toContain("amount");
    // Override applies to the rp×cp block — every record there has its
    // value under "headcount", not "amount".
    for (const r of result.rows) {
      expect(r.headcount).toBeDefined();
      expect(r.amount).toBeUndefined();
    }
  });

  it("emits no records when one axis has no pivot segment (incomplete crosstab)", () => {
    const cells = [
      ["", "HQ", "Industry"],
      ["scope", "NYC", "Tech"],
      ["currency", "USD", "Retail"],
    ];
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 2 },
      targetEntityDefinitionId: "metrics",
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: 3 }],
        column: [{ kind: "field", positionCount: 3 }],
      },
    };
    const result = buildPreviewRecords(region, sheet(cells));
    expect(result.rows).toEqual([]);
    expect(result.shape).toMatch(/incomplete/i);
  });
});
