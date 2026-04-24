/**
 * Matrix-id fixture for the PR-2 `detect-segments` heuristic stage.
 *
 * Each matrix id describes a canonical region shape; `matrixInput(id)` builds
 * an InterpretInput wrapped around a minimal workbook + region hint with no
 * pre-seeded segments (detect-segments is what we're testing). `EXPECTATIONS`
 * carries the shape detect-segments should produce (segmentsByAxis +
 * cellValueField).
 *
 * Keep the fixture compact — 1a–1g cover row-axis shapes; 2a–2g mirror them
 * on the column axis; `crosstab-sales-leads` and `crosstab-sales-by-year`
 * exercise 2D; `headerless-rows` exercises the stage's no-op path.
 */

import type {
  CellValueField,
  InterpretInput,
  Region,
} from "../../plan/index.js";

export const MATRIX_IDS = [
  "1a",
  "1b",
  "1c",
  "1d",
  "1e",
  "1f",
  "1g",
  "2a",
  "2b",
  "2c",
  "2d",
  "2e",
  "2f",
  "2g",
  "crosstab-sales-leads",
  "crosstab-sales-by-year",
  "headerless-rows",
] as const;

export type MatrixId = (typeof MATRIX_IDS)[number];

export interface Expectation {
  /** Expected segmentsByAxis written by detect-segments. `undefined` when the
   * stage is a no-op for this region (e.g. headerless). */
  segmentsByAxis?: Region["segmentsByAxis"];
  /** Expected cellValueField. `undefined` when no pivot segments were produced. */
  cellValueField?: CellValueField;
  /** Expected record count if the plan were replayed (used by Phase D). */
  recordCount: number;
}

const AI_VALUE: CellValueField = { name: "value", nameSource: "ai" };

const DYNAMIC_TAIL = {
  terminator: { kind: "untilBlank", consecutiveBlanks: 2 },
} as const;

// ── Workbook helpers ──────────────────────────────────────────────────────

function rowOf<T>(row: number, values: T[], startCol = 1) {
  return values.map((value, i) => ({ row, col: startCol + i, value }));
}

function colOf<T>(col: number, values: T[], startRow = 1) {
  return values.map((value, i) => ({ row: startRow + i, col, value }));
}

// ── 1a — tidy all-static ──────────────────────────────────────────────────
function input1a(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 3, cols: 3 },
          cells: [
            ...rowOf(1, ["email", "name", "age"]),
            ...rowOf(2, ["a@x.com", "alice", 30]),
            ...rowOf(3, ["b@x.com", "bob", 25]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
      },
    ],
  };
}

// ── 1b — pivot all (quarter) ──────────────────────────────────────────────
function input1b(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 2, cols: 3 },
          cells: [
            ...rowOf(1, ["Q1", "Q2", "Q3"]),
            ...rowOf(2, [10, 20, 30]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
        targetEntityDefinitionId: "revenue",
        headerAxes: ["row"],
      },
    ],
  };
}

// ── 1c — 2 pivots, no statics ─────────────────────────────────────────────
function input1c(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 2, cols: 6 },
          cells: [
            ...rowOf(1, ["Q1", "Q2", "Q3", "Jan", "Feb", "Mar"]),
            ...rowOf(2, [10, 20, 30, 4, 5, 6]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 6 },
        targetEntityDefinitionId: "revenue",
        headerAxes: ["row"],
      },
    ],
  };
}

// ── 1d — statics + 1 pivot ────────────────────────────────────────────────
function input1d(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 2, cols: 5 },
          cells: [
            ...rowOf(1, ["name", "industry", "Q1", "Q2", "Q3"]),
            ...rowOf(2, ["Apple", "Tech", 10, 20, 30]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 5 },
        targetEntityDefinitionId: "companies",
        headerAxes: ["row"],
      },
    ],
  };
}

// ── 1e — canonical: statics + 2 pivots ────────────────────────────────────
function input1e(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 2, cols: 8 },
          cells: [
            ...rowOf(1, [
              "name",
              "industry",
              "Q1",
              "Q2",
              "Q3",
              "Jan",
              "Feb",
              "Mar",
            ]),
            ...rowOf(2, ["Apple", "Tech", 10, 20, 30, 4, 5, 6]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 8 },
        targetEntityDefinitionId: "companies",
        headerAxes: ["row"],
      },
    ],
  };
}

// ── 1f — statics + 1 pivot + skip ─────────────────────────────────────────
function input1f(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 2, cols: 6 },
          cells: [
            ...rowOf(1, ["name", "industry", "Q1", "Q2", "Q3", "Total"]),
            ...rowOf(2, ["Apple", "Tech", 10, 20, 30, 60]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 6 },
        targetEntityDefinitionId: "companies",
        headerAxes: ["row"],
      },
    ],
  };
}

// ── 1g — statics + dynamic year segment at tail ───────────────────────────
function input1g(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 2, cols: 5 },
          cells: [
            ...rowOf(1, ["name", "industry", "2022", "2023", "2024"]),
            ...rowOf(2, ["Apple", "Tech", 10, 20, 30]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 5 },
        targetEntityDefinitionId: "companies",
        headerAxes: ["row"],
      },
    ],
  };
}

// ── 2a — tidy all-static, column axis ─────────────────────────────────────
function input2a(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 3, cols: 3 },
          cells: [
            ...colOf(1, ["email", "name", "age"]),
            ...colOf(2, ["a@x.com", "alice", 30]),
            ...colOf(3, ["b@x.com", "bob", 25]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["column"],
      },
    ],
  };
}

// ── 2b — pivot all, column axis ───────────────────────────────────────────
function input2b(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 3, cols: 3 },
          cells: [
            ...colOf(1, ["Q1", "Q2", "Q3"]),
            ...colOf(2, [10, 20, 30]),
            ...colOf(3, [11, 22, 33]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        targetEntityDefinitionId: "revenue",
        headerAxes: ["column"],
      },
    ],
  };
}

// ── 2c — 2 pivots, no statics, column axis ────────────────────────────────
function input2c(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 6, cols: 3 },
          cells: [
            ...colOf(1, ["Q1", "Q2", "Q3", "Jan", "Feb", "Mar"]),
            ...colOf(2, [10, 20, 30, 4, 5, 6]),
            ...colOf(3, [11, 22, 33, 5, 6, 7]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 6, endCol: 3 },
        targetEntityDefinitionId: "revenue",
        headerAxes: ["column"],
      },
    ],
  };
}

// ── 2d — statics + 1 pivot, column axis ───────────────────────────────────
function input2d(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 5, cols: 3 },
          cells: [
            ...colOf(1, ["name", "industry", "Q1", "Q2", "Q3"]),
            ...colOf(2, ["Apple", "Tech", 10, 20, 30]),
            ...colOf(3, ["Berry", "Food", 11, 22, 33]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 3 },
        targetEntityDefinitionId: "companies",
        headerAxes: ["column"],
      },
    ],
  };
}

// ── 2e — canonical column-axis (statics + 2 pivots) ───────────────────────
function input2e(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 8, cols: 3 },
          cells: [
            ...colOf(1, [
              "name",
              "industry",
              "Q1",
              "Q2",
              "Q3",
              "Jan",
              "Feb",
              "Mar",
            ]),
            ...colOf(2, ["Apple", "Tech", 10, 20, 30, 4, 5, 6]),
            ...colOf(3, ["Berry", "Food", 11, 22, 33, 5, 6, 7]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 8, endCol: 3 },
        targetEntityDefinitionId: "companies",
        headerAxes: ["column"],
      },
    ],
  };
}

// ── 2f — statics + 1 pivot + skip, column axis ────────────────────────────
function input2f(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 6, cols: 3 },
          cells: [
            ...colOf(1, ["name", "industry", "Q1", "Q2", "Q3", "Total"]),
            ...colOf(2, ["Apple", "Tech", 10, 20, 30, 60]),
            ...colOf(3, ["Berry", "Food", 11, 22, 33, 66]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 6, endCol: 3 },
        targetEntityDefinitionId: "companies",
        headerAxes: ["column"],
      },
    ],
  };
}

// ── 2g — column-axis dynamic tail (mirror of 1g) ──────────────────────────
function input2g(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 5, cols: 3 },
          cells: [
            ...colOf(1, ["name", "industry", "2022", "2023", "2024"]),
            ...colOf(2, ["Apple", "Tech", 10, 20, 30]),
            ...colOf(3, ["Berry", "Food", 11, 22, 33]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 3 },
        targetEntityDefinitionId: "companies",
        headerAxes: ["column"],
      },
    ],
  };
}

// ── crosstab-sales-leads — 2D both axes fixed pivots ──────────────────────
// Anchor cell (1,1) = "Sales"; row axis carries months, col axis carries
// quarters. Both heuristic-classifiable, both fixed.
function inputCrosstabSalesLeads(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 5, cols: 5 },
          cells: [
            ...rowOf(1, ["Sales", "Jan", "Feb", "Mar", "Apr"]),
            ...rowOf(2, ["Q1", 10, 20, 30, 40]),
            ...rowOf(3, ["Q2", 11, 21, 31, 41]),
            ...rowOf(4, ["Q3", 12, 22, 32, 42]),
            ...rowOf(5, ["Q4", 13, 23, 33, 43]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 5 },
        targetEntityDefinitionId: "sales-leads",
        headerAxes: ["row", "column"],
        axisAnchorCell: { row: 1, col: 1 },
      },
    ],
  };
}

// ── crosstab-sales-by-year — 2D with dynamic year on one axis ─────────────
// Anchor cell (1,1) is empty; row axis carries fiscal-year labels (dynamic),
// col axis carries quarters (fixed). FY-prefixed year labels keep the header
// line non-numeric so detect-headers scores row 1 above the data rows.
function inputCrosstabSalesByYear(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 5, cols: 4 },
          cells: [
            { row: 1, col: 1, value: "" },
            { row: 1, col: 2, value: "FY22" },
            { row: 1, col: 3, value: "FY23" },
            { row: 1, col: 4, value: "FY24" },
            ...rowOf(2, ["Q1", 10, 20, 30]),
            ...rowOf(3, ["Q2", 11, 21, 31]),
            ...rowOf(4, ["Q3", 12, 22, 32]),
            ...rowOf(5, ["Q4", 13, 23, 33]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 4 },
        targetEntityDefinitionId: "sales-by-year",
        headerAxes: ["row", "column"],
        axisAnchorCell: { row: 1, col: 1 },
      },
    ],
  };
}

// ── headerless-rows — no header axis ──────────────────────────────────────
function inputHeaderlessRows(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 3, cols: 3 },
          cells: [
            ...rowOf(1, ["a@x.com", "alice", 30]),
            ...rowOf(2, ["b@x.com", "bob", 25]),
            ...rowOf(3, ["c@x.com", "carol", 40]),
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Data",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        headerAxes: [],
        recordsAxis: "row",
      },
    ],
  };
}

const INPUTS: Record<MatrixId, () => InterpretInput> = {
  "1a": input1a,
  "1b": input1b,
  "1c": input1c,
  "1d": input1d,
  "1e": input1e,
  "1f": input1f,
  "1g": input1g,
  "2a": input2a,
  "2b": input2b,
  "2c": input2c,
  "2d": input2d,
  "2e": input2e,
  "2f": input2f,
  "2g": input2g,
  "crosstab-sales-leads": inputCrosstabSalesLeads,
  "crosstab-sales-by-year": inputCrosstabSalesByYear,
  "headerless-rows": inputHeaderlessRows,
};

export function matrixInput(id: MatrixId): InterpretInput {
  return INPUTS[id]();
}

// ── Expected shapes ───────────────────────────────────────────────────────

function pivot(
  tag: "quarter" | "month" | "year" | "date",
  axis: "row" | "column",
  positionCount: number,
  dynamic?: typeof DYNAMIC_TAIL
) {
  return {
    kind: "pivot" as const,
    id: `segment_${tag}_${axis}`,
    axisName: tag,
    axisNameSource: "ai" as const,
    positionCount,
    ...(dynamic ? { dynamic } : {}),
  };
}

export const EXPECTATIONS: Record<MatrixId, Expectation> = {
  "1a": {
    segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
    recordCount: 2,
  },
  "1b": {
    segmentsByAxis: { row: [pivot("quarter", "row", 3)] },
    cellValueField: AI_VALUE,
    recordCount: 3,
  },
  "1c": {
    segmentsByAxis: {
      row: [pivot("quarter", "row", 3), pivot("month", "row", 3)],
    },
    cellValueField: AI_VALUE,
    recordCount: 6,
  },
  "1d": {
    segmentsByAxis: {
      row: [
        { kind: "field", positionCount: 2 },
        pivot("quarter", "row", 3),
      ],
    },
    cellValueField: AI_VALUE,
    recordCount: 3,
  },
  "1e": {
    segmentsByAxis: {
      row: [
        { kind: "field", positionCount: 2 },
        pivot("quarter", "row", 3),
        pivot("month", "row", 3),
      ],
    },
    cellValueField: AI_VALUE,
    recordCount: 6,
  },
  "1f": {
    segmentsByAxis: {
      row: [
        { kind: "field", positionCount: 2 },
        pivot("quarter", "row", 3),
        { kind: "skip", positionCount: 1 },
      ],
    },
    cellValueField: AI_VALUE,
    recordCount: 3,
  },
  "1g": {
    segmentsByAxis: {
      row: [
        { kind: "field", positionCount: 2 },
        pivot("year", "row", 3, DYNAMIC_TAIL),
      ],
    },
    cellValueField: AI_VALUE,
    recordCount: 3,
  },
  "2a": {
    segmentsByAxis: { column: [{ kind: "field", positionCount: 3 }] },
    recordCount: 2,
  },
  "2b": {
    segmentsByAxis: { column: [pivot("quarter", "column", 3)] },
    cellValueField: AI_VALUE,
    recordCount: 6,
  },
  "2c": {
    segmentsByAxis: {
      column: [pivot("quarter", "column", 3), pivot("month", "column", 3)],
    },
    cellValueField: AI_VALUE,
    recordCount: 12,
  },
  "2d": {
    segmentsByAxis: {
      column: [
        { kind: "field", positionCount: 2 },
        pivot("quarter", "column", 3),
      ],
    },
    cellValueField: AI_VALUE,
    recordCount: 6,
  },
  "2e": {
    segmentsByAxis: {
      column: [
        { kind: "field", positionCount: 2 },
        pivot("quarter", "column", 3),
        pivot("month", "column", 3),
      ],
    },
    cellValueField: AI_VALUE,
    recordCount: 12,
  },
  "2f": {
    segmentsByAxis: {
      column: [
        { kind: "field", positionCount: 2 },
        pivot("quarter", "column", 3),
        { kind: "skip", positionCount: 1 },
      ],
    },
    cellValueField: AI_VALUE,
    recordCount: 6,
  },
  "2g": {
    segmentsByAxis: {
      column: [
        { kind: "field", positionCount: 2 },
        pivot("year", "column", 3, DYNAMIC_TAIL),
      ],
    },
    cellValueField: AI_VALUE,
    recordCount: 6,
  },
  "crosstab-sales-leads": {
    segmentsByAxis: {
      row: [
        { kind: "field", positionCount: 1 },
        pivot("month", "row", 4),
      ],
      column: [
        { kind: "field", positionCount: 1 },
        pivot("quarter", "column", 4),
      ],
    },
    cellValueField: { name: "Sales", nameSource: "anchor-cell" },
    recordCount: 16,
  },
  "crosstab-sales-by-year": {
    segmentsByAxis: {
      row: [
        { kind: "field", positionCount: 1 },
        pivot("year", "row", 3, DYNAMIC_TAIL),
      ],
      column: [
        { kind: "field", positionCount: 1 },
        pivot("quarter", "column", 4),
      ],
    },
    // Anchor cell resolves blank → fall back to the ai "value" seed.
    cellValueField: AI_VALUE,
    recordCount: 12,
  },
  "headerless-rows": {
    // detect-segments is a no-op for headerless regions.
    segmentsByAxis: undefined,
    cellValueField: undefined,
    recordCount: 3,
  },
};
