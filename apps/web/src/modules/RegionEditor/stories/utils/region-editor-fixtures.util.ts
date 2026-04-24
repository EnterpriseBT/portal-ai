import type {
  CellValue,
  EntityOption,
  RegionDraft,
  SheetPreview,
  Workbook,
} from "../../utils/region-editor.types";

export const ENTITY_OPTIONS: EntityOption[] = [
  { value: "ent_contact", label: "Contact", source: "db" },
  { value: "ent_deal", label: "Deal", source: "db" },
  { value: "ent_revenue", label: "Revenue", source: "db" },
  { value: "ent_revenue_transposed", label: "Revenue (transposed)", source: "db" },
  { value: "ent_revenue_crosstab", label: "Revenue (crosstab)", source: "db" },
  { value: "ent_account", label: "Account", source: "db" },
  { value: "ent_headcount", label: "Headcount", source: "db" },
  { value: "ent_product", label: "Product", source: "db" },
  { value: "ent_invoice", label: "Invoice", source: "db" },
  { value: "ent_sales_rep", label: "Sales rep", source: "db" },
  { value: "ent_department", label: "Department", source: "db" },
  { value: "ent_department_transposed", label: "Department (transposed)", source: "db" },
  { value: "ent_department_messy", label: "Department (messy quarters)", source: "db" },
  { value: "ent_note", label: "Note", source: "db" },
];

type Cell = string | number | null;

function blank(rows: number, cols: number): Cell[][] {
  return Array.from({ length: rows }, () => Array<Cell>(cols).fill(""));
}

function write(cells: Cell[][], r: number, c: number, values: Cell[]): void {
  values.forEach((v, i) => {
    cells[r][c + i] = v;
  });
}

// ----------------------------------------------------------------------------
// Unified demo dataset — the same quarterly revenue numbers are reshaped across
// sheets 1–4 so a demo can compare how each orientation/headerAxis combination
// interprets the same underlying observations.
// ----------------------------------------------------------------------------

const UNIFIED_REGION_NAMES = ["North America", "EMEA", "APAC", "LATAM"];
const UNIFIED_QUARTERS = ["Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025"];
const UNIFIED_REVENUE: number[][] = [
  [120000, 135000, 148000, 152000], // North America
  [82000, 89000, 91000, 95000], // EMEA
  [45000, 52000, 61000, 68000], // APAC
  [22000, 28000, 31000, 35000], // LATAM
];

// ----------------------------------------------------------------------------
// Sheet 1: "Row tables" — rows-as-records + headerAxis: row
//   Flat fact table: one row per (region, quarter) observation, headers on top.
// ----------------------------------------------------------------------------

function buildRowTablesSheet(): SheetPreview {
  const cells = blank(22, 5);

  cells[0][0] =
    "Same data as Column tables, Mixed axes, Crosstab — rows-as-records, header row";
  cells[2][0] = "Quarterly revenue (flat fact, one row per observation)";
  write(cells, 3, 0, ["Region", "Quarter", "Revenue"]);

  let r = 4;
  for (let i = 0; i < UNIFIED_REGION_NAMES.length; i++) {
    for (let q = 0; q < UNIFIED_QUARTERS.length; q++) {
      write(cells, r, 0, [
        UNIFIED_REGION_NAMES[i],
        UNIFIED_QUARTERS[q],
        UNIFIED_REVENUE[i][q],
      ]);
      r++;
    }
  }

  return {
    id: "sheet_row_tables",
    name: "Row tables",
    rowCount: 22,
    colCount: 5,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 2: "Column tables" — columns-as-records + headerAxis: column
//   Same observations, transposed: one column per observation, field labels in
//   column A.
// ----------------------------------------------------------------------------

function buildColumnTablesSheet(): SheetPreview {
  const cells = blank(10, 18);

  cells[0][0] =
    "Same data as Row tables — columns-as-records, header column (transposed flat fact)";
  cells[2][0] = "Quarterly revenue (one column per observation)";
  cells[3][0] = "Region";
  cells[4][0] = "Quarter";
  cells[5][0] = "Revenue";

  let c = 1;
  for (let i = 0; i < UNIFIED_REGION_NAMES.length; i++) {
    for (let q = 0; q < UNIFIED_QUARTERS.length; q++) {
      cells[3][c] = UNIFIED_REGION_NAMES[i];
      cells[4][c] = UNIFIED_QUARTERS[q];
      cells[5][c] = UNIFIED_REVENUE[i][q];
      c++;
    }
  }

  return {
    id: "sheet_column_tables",
    name: "Column tables",
    rowCount: 10,
    colCount: 18,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 3: "Mixed axes" — the two less-common orientation/headerAxis combos.
//   Same four regions as elsewhere, but the fields are heterogeneous region
//   attributes (Manager / Headcount / HQ / Currency). Heterogeneous fields
//   make the pivoted shape visually distinct from a crosstab, because the
//   rows/columns label *named attributes* rather than values of an axis.
// ----------------------------------------------------------------------------

const UNIFIED_REGION_FIELDS = ["Manager", "Headcount", "HQ", "Currency"];
const UNIFIED_REGION_ATTRS: Cell[][] = [
  ["Priya", 120, "New York", "USD"], // North America
  ["Hans", 82, "London", "EUR"], // EMEA
  ["Yuki", 45, "Singapore", "SGD"], // APAC
  ["Diego", 22, "São Paulo", "BRL"], // LATAM
];

function buildMixedAxesSheet(): SheetPreview {
  const cells = blank(20, 7);

  cells[0][0] =
    "Same regions, heterogeneous attributes — two pivot permutations";

  // Variant A: rows-as-records + headerAxis: column
  //   Col A identifies each record (region); row 3 labels the attribute columns.
  //   The header cell above col A is left blank — the identity axis has no
  //   built-in name, the user supplies one via recordsAxisName.
  cells[2][0] =
    "rows-as-records + headerAxis: column — col A = region identity (unlabeled); row 3 = attribute labels";
  for (let f = 0; f < UNIFIED_REGION_FIELDS.length; f++) {
    cells[3][1 + f] = UNIFIED_REGION_FIELDS[f];
  }
  for (let i = 0; i < UNIFIED_REGION_NAMES.length; i++) {
    cells[4 + i][0] = UNIFIED_REGION_NAMES[i];
    for (let f = 0; f < UNIFIED_REGION_FIELDS.length; f++) {
      cells[4 + i][1 + f] = UNIFIED_REGION_ATTRS[i][f];
    }
  }

  // Variant B: columns-as-records + headerAxis: row
  //   Row 12 identifies each record (region); col A labels the attribute rows.
  //   The leftmost cell of row 12 is left blank — the identity axis has no
  //   built-in name, the user supplies one via recordsAxisName.
  cells[10][0] =
    "columns-as-records + headerAxis: row — row 12 = region identity (unlabeled); col A = attribute labels";
  for (let i = 0; i < UNIFIED_REGION_NAMES.length; i++) {
    cells[12][1 + i] = UNIFIED_REGION_NAMES[i];
  }
  for (let f = 0; f < UNIFIED_REGION_FIELDS.length; f++) {
    cells[13 + f][0] = UNIFIED_REGION_FIELDS[f];
    for (let i = 0; i < UNIFIED_REGION_NAMES.length; i++) {
      cells[13 + f][1 + i] = UNIFIED_REGION_ATTRS[i][f];
    }
  }

  return {
    id: "sheet_mixed_axes",
    name: "Mixed axes",
    rowCount: 20,
    colCount: 7,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 4: "Crosstab" — cells-as-records.
//   Same observations laid out as a 2D pivot: regions down, quarters across.
// ----------------------------------------------------------------------------

function buildCrosstabSheet(): SheetPreview {
  const cells = blank(10, 7);

  cells[0][0] = "Same data — cells-as-records (2D crosstab)";
  cells[2][0] = "Revenue by region × quarter (fixed 4×4)";

  for (let q = 0; q < UNIFIED_QUARTERS.length; q++) {
    cells[3][1 + q] = UNIFIED_QUARTERS[q];
  }
  for (let i = 0; i < UNIFIED_REGION_NAMES.length; i++) {
    cells[4 + i][0] = UNIFIED_REGION_NAMES[i];
    for (let q = 0; q < UNIFIED_QUARTERS.length; q++) {
      cells[4 + i][1 + q] = UNIFIED_REVENUE[i][q];
    }
  }

  return {
    id: "sheet_crosstab",
    name: "Crosstab",
    rowCount: 10,
    colCount: 7,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 5a: "Messy pipeline" — row-oriented data that needs skip rules to extract cleanly
// ----------------------------------------------------------------------------

function buildMessyPipelineSheet(): SheetPreview {
  const cells = blank(30, 6);

  cells[0][0] = "Global pipeline report — messy export with section separators";
  cells[1][0] = "Generated 2026-04-17";
  // Row 2 intentionally blank (gap between title and header).

  write(cells, 3, 0, ["Account", "Owner", "Stage", "Amount", "Close"]);
  // Row 4 intentionally blank (aesthetic gap between header and data).

  write(cells, 5, 0, ["— NA Region —"]);
  write(cells, 6, 0, ["Acme", "Priya", "Closed Won", 48000, "2026-03-01"]);
  write(cells, 7, 0, [
    "Beta Industries",
    "Marco",
    "Negotiation",
    17000,
    "2026-04-22",
  ]);
  write(cells, 8, 0, ["Chai & Co", "Priya", "Proposal", 22500, "2026-05-10"]);
  // Blank row to test single-blank skip (terminator=2 so this doesn't end things).
  // Row 9 intentionally blank.
  write(cells, 10, 0, ["Delta Labs", "Sara", "Discovery", 8000, "2026-06-01"]);
  write(cells, 11, 0, ["Subtotal", "", "", 95500, ""]); // cellMatches rule: ^Subtotal$
  // Row 12 intentionally blank (aesthetic separator between regions).

  write(cells, 13, 0, ["— EMEA Region —"]);
  write(cells, 14, 0, [
    "Epsilon GmbH",
    "Hans",
    "Closed Won",
    32000,
    "2026-03-14",
  ]);
  write(cells, 15, 0, [
    "Foxtrot SARL",
    "Claire",
    "Proposal",
    12000,
    "2026-05-03",
  ]);
  write(cells, 16, 0, [
    "Gamma PLC",
    "Hans",
    "Negotiation",
    41000,
    "2026-04-28",
  ]);
  write(cells, 17, 0, ["Subtotal", "", "", 85000, ""]);
  // Row 18 blank.

  write(cells, 19, 0, ["— APAC Region —"]);
  write(cells, 20, 0, ["Hotel KK", "Yuki", "Closed Lost", 0, "2026-02-14"]);
  write(cells, 21, 0, ["Indigo Pte", "Yuki", "Proposal", 19000, "2026-05-18"]);
  write(cells, 22, 0, ["Subtotal", "", "", 19000, ""]);
  // Rows 23, 24 both blank — terminator=2 fires here.
  write(cells, 25, 0, ["Report footer — should not be extracted"]);
  cells[26][0] = "Contact sales-ops for corrections";

  return {
    id: "sheet_messy_pipeline",
    name: "Messy pipeline",
    rowCount: 30,
    colCount: 6,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 5b: "Messy quarters" — column-oriented data where skip rules skip columns
// ----------------------------------------------------------------------------

function buildMessyQuartersSheet(): SheetPreview {
  const cells = blank(12, 14);

  cells[0][0] =
    "Quarterly snapshot — messy export where non-data columns interleave";
  cells[1][0] =
    "Rows are fields. Columns with '— Subtotal —' in row 3 are aggregates to skip.";

  // Row 3 is the label row the skip rule will target (axis: "row", crossAxisIndex: 3).
  write(cells, 3, 0, [
    "Dept",
    "Q1 2025",
    "Q2 2025",
    "— Subtotal —",
    "Q3 2025",
    "Q4 2025",
    "— Subtotal —",
    "Q1 2026",
    "Q2 2026",
    "— Year-end —",
    "Q3 2026",
  ]);
  write(cells, 4, 0, ["Eng HC", 38, 40, 78, 41, 42, 83, 42, 43, 161, 43]);
  write(cells, 5, 0, ["Sales HC", 24, 26, 50, 27, 28, 55, 28, 29, 105, 29]);
  write(cells, 6, 0, ["Mkt HC", 12, 13, 25, 14, 14, 28, 14, 14, 53, 14]);
  write(cells, 7, 0, ["Support HC", 8, 9, 17, 9, 9, 18, 9, 10, 35, 10]);
  // Column 11 and 12 are empty — terminator=2 fires for the columns region.
  // Column 13 has content — never reached.
  cells[4][13] = 999;
  cells[5][13] = 999;

  return {
    id: "sheet_messy_quarters",
    name: "Messy quarters",
    rowCount: 12,
    colCount: 14,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 6: "Headerless" — raw data with no header row, plus a gap-before-data case
// ----------------------------------------------------------------------------

function buildHeaderlessSheet(): SheetPreview {
  const cells = blank(22, 10);

  cells[0][0] = "Headerless data and gap-between-header-and-data examples";

  // Region: headerless data (rows-as-records + headerAxis: none)
  cells[2][0] = "Raw event log — no header row";
  write(cells, 3, 0, ["2026-04-01", "login", "user_42", "10.0.1.5", 200]);
  write(cells, 4, 0, ["2026-04-01", "view_report", "user_42", "10.0.1.5", 200]);
  write(cells, 5, 0, ["2026-04-02", "login", "user_17", "10.0.1.9", 200]);
  write(cells, 6, 0, ["2026-04-02", "export_csv", "user_17", "10.0.1.9", 204]);
  write(cells, 7, 0, ["2026-04-03", "login", "user_03", "10.0.2.1", 401]);
  write(cells, 8, 0, ["2026-04-03", "login", "user_03", "10.0.2.1", 200]);

  // Region: headers with a blank gap before data starts (rows-as-records + headerAxis: row)
  cells[11][0] = "Header row, then gap, then data";
  write(cells, 12, 0, ["Order", "Customer", "Amount", "Shipped"]);
  // Row 13 intentionally blank — gap between headers and data.
  write(cells, 14, 0, ["ORD-100", "Acme", 4200, "Yes"]);
  write(cells, 15, 0, ["ORD-101", "Beta", 1800, "Yes"]);
  write(cells, 16, 0, ["ORD-102", "Chai", 6500, "No"]);
  write(cells, 17, 0, ["ORD-103", "Delta", 12000, "No"]);

  return {
    id: "sheet_headerless",
    name: "Headerless",
    rowCount: 22,
    colCount: 10,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 8: Large GL fact — exercises edge-scroll while drawing
// ----------------------------------------------------------------------------

function buildLargeFactSheet(): SheetPreview {
  const rowCount = 480;
  const colCount = 36;
  const cells: CellValue[][] = Array.from({ length: rowCount }, () =>
    Array<CellValue>(colCount).fill("")
  );

  cells[0][0] =
    "Raw GL export — Jan 2024 – Dec 2026 (scroll to draw across full range)";

  const monthHeaders = Array.from({ length: 36 }, (_, i) => {
    const year = 2024 + Math.floor(i / 12);
    const month = (i % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
  const staticHeaders = [
    "Account",
    "Cost Center",
    "Region",
    "Product",
    "Segment",
  ];
  const headers = [
    ...staticHeaders,
    ...monthHeaders.slice(0, colCount - staticHeaders.length),
  ];
  for (let c = 0; c < colCount; c++) cells[2][c] = headers[c];

  const accounts = [
    "4000 Revenue",
    "4100 Services",
    "4200 Licenses",
    "5000 COGS",
    "6000 Opex",
  ];
  const centers = ["AMER-East", "AMER-West", "EMEA", "APAC", "LATAM"];
  const regions = ["US", "CA", "UK", "DE", "FR", "JP", "AU", "BR"];
  const products = ["Portal", "Pulse", "Prism", "Pilot", "Pivot"];
  const segments = ["Enterprise", "Mid-market", "SMB", "Startup"];

  for (let r = 3; r < rowCount; r++) {
    cells[r][0] = accounts[r % accounts.length];
    cells[r][1] = centers[r % centers.length];
    cells[r][2] = regions[r % regions.length];
    cells[r][3] = products[r % products.length];
    cells[r][4] = segments[r % segments.length];
    for (let c = 5; c < colCount; c++) {
      const base = ((r * 37) ^ (c * 13)) & 0xffff;
      cells[r][c] = Math.round(1000 + (base % 95000));
    }
  }

  return {
    id: "sheet_large_fact",
    name: "GL fact (large)",
    rowCount,
    colCount,
    cells,
  };
}

export const DEMO_WORKBOOK: Workbook = {
  fetchedAt: "2026-04-17 09:12 UTC",
  sourceLabel: "demo.xlsx",
  sheets: [
    buildRowTablesSheet(),
    buildColumnTablesSheet(),
    buildMixedAxesSheet(),
    buildCrosstabSheet(),
    buildMessyPipelineSheet(),
    buildMessyQuartersSheet(),
    buildHeaderlessSheet(),
    buildLargeFactSheet(),
  ],
};

export const EMPTY_REGIONS: RegionDraft[] = [];

// Region definitions covering every shape the editor supports. Each entry
// is authored directly in the canonical segment model — stories exercise
// the same shape the Panel / SheetCanvas render in production.
export const PROPOSED_REGIONS: RegionDraft[] = [
  // ---- Sheet 1: Tidy row-headers ----
  // Flat fact table: one row per (region, quarter) observation.
  {
    id: "region_revenue_rows_as_obs",
    sheetId: "sheet_row_tables",
    bounds: { startRow: 3, endRow: 19, startCol: 0, endCol: 2 },
    proposedLabel: "Revenue (rows-as-records, header row)",
    targetEntityDefinitionId: "ent_revenue",
    targetEntityLabel: "Revenue",
    headerAxes: ["row"],
    segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
    confidence: 0.93,
  },

  // ---- Sheet 2: Tidy column-headers (transposed) ----
  // Same observations, transposed: one column per observation.
  {
    id: "region_revenue_cols_as_obs",
    sheetId: "sheet_column_tables",
    bounds: { startRow: 3, endRow: 5, startCol: 0, endCol: 16 },
    proposedLabel: "Revenue (columns-as-records, header column)",
    targetEntityDefinitionId: "ent_revenue_transposed",
    targetEntityLabel: "Revenue (transposed)",
    headerAxes: ["column"],
    segmentsByAxis: { column: [{ kind: "field", positionCount: 3 }] },
    confidence: 0.9,
  },

  // ---- Sheet 3: Mixed axes — two pivoted permutations ----
  // Variant A: column header with a pivot — each row is a record, col 0
  // holds the pivot axis values ("Region").
  {
    id: "region_attrs_rows_as_regions",
    sheetId: "sheet_mixed_axes",
    bounds: { startRow: 3, endRow: 7, startCol: 0, endCol: 4 },
    proposedLabel: "Region attributes (pivoted column header)",
    targetEntityDefinitionId: "ent_department",
    targetEntityLabel: "Department",
    headerAxes: ["column"],
    segmentsByAxis: {
      column: [
        {
          kind: "pivot",
          id: "attrs-rows-col-pivot",
          axisName: "Region",
          axisNameSource: "user",
          positionCount: 5,
        },
      ],
    },
    cellValueField: { name: "value", nameSource: "user" },
    confidence: 0.75,
  },
  // Variant B: row header with a pivot — each column is a record, row 0
  // holds the pivot axis values ("Region").
  {
    id: "region_attrs_cols_as_regions",
    sheetId: "sheet_mixed_axes",
    bounds: { startRow: 12, endRow: 16, startCol: 0, endCol: 4 },
    proposedLabel: "Region attributes (pivoted row header)",
    targetEntityDefinitionId: "ent_department_transposed",
    targetEntityLabel: "Department (transposed)",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [
        {
          kind: "pivot",
          id: "attrs-cols-row-pivot",
          axisName: "Region",
          axisNameSource: "ai",
          positionCount: 5,
        },
      ],
    },
    cellValueField: { name: "value", nameSource: "user" },
    confidence: 0.72,
  },

  // ---- Sheet 4: Crosstab ----
  // Same observations laid out as a 2D pivot (Region × Quarter).
  {
    id: "region_revenue_crosstab_absolute",
    sheetId: "sheet_crosstab",
    bounds: { startRow: 3, endRow: 7, startCol: 0, endCol: 4 },
    proposedLabel: "Revenue (2D crosstab)",
    targetEntityDefinitionId: "ent_revenue_crosstab",
    targetEntityLabel: "Revenue (crosstab)",
    headerAxes: ["row", "column"],
    segmentsByAxis: {
      row: [
        {
          kind: "pivot",
          id: "revenue-crosstab-row-pivot",
          axisName: "Region",
          axisNameSource: "user",
          positionCount: 5,
        },
      ],
      column: [
        {
          kind: "pivot",
          id: "revenue-crosstab-col-pivot",
          axisName: "Quarter",
          axisNameSource: "ai",
          positionCount: 5,
        },
      ],
    },
    cellValueField: { name: "Revenue", nameSource: "ai" },
    confidence: 0.83,
  },

  // ---- Sheet 5a: Row-oriented skip rules ----
  {
    id: "region_messy_pipeline",
    sheetId: "sheet_messy_pipeline",
    bounds: { startRow: 3, endRow: 8, startCol: 0, endCol: 4 },
    proposedLabel: "Global pipeline — skip separators + subtotals",
    targetEntityDefinitionId: "ent_deal",
    targetEntityLabel: "Deal",
    headerAxes: ["row"],
    segmentsByAxis: { row: [{ kind: "field", positionCount: 5 }] },
    recordAxisTerminator: { kind: "untilBlank", consecutiveBlanks: 2 },
    skipRules: [
      { kind: "blank" },
      // "— NA Region —" / "— EMEA Region —" / "— APAC Region —" all in column A.
      { kind: "cellMatches", crossAxisIndex: 0, pattern: "^—.*—$" },
      // Subtotal rows — column A contains "Subtotal".
      { kind: "cellMatches", crossAxisIndex: 0, pattern: "^Subtotal$" },
    ],
    confidence: 0.79,
    warnings: [
      {
        code: "AMBIGUOUS_HEADER",
        severity: "info",
        message:
          "Three skip rules active — extraction omits section labels and subtotals.",
        suggestedFix: "Verify the 9 extracted rows match the 9 real deals.",
      },
    ],
  },

  // ---- Sheet 5b: Column-oriented skip rules (rule axis "row") ----
  {
    id: "region_messy_quarters",
    sheetId: "sheet_messy_quarters",
    bounds: { startRow: 3, endRow: 7, startCol: 0, endCol: 2 },
    proposedLabel: "Quarters — skip subtotal columns",
    targetEntityDefinitionId: "ent_department_messy",
    targetEntityLabel: "Department (messy quarters)",
    headerAxes: ["column"],
    segmentsByAxis: { column: [{ kind: "field", positionCount: 5 }] },
    recordAxisTerminator: { kind: "untilBlank", consecutiveBlanks: 2 },
    skipRules: [
      { kind: "blank" },
      // Row 3 is the label row for each column. Skip columns whose row-3 cell
      // looks like an aggregate header ("— Subtotal —", "— Year-end —").
      {
        kind: "cellMatches",
        crossAxisIndex: 3,
        pattern: "^—.*—$",
        axis: "row",
      },
    ],
    confidence: 0.74,
    warnings: [
      {
        code: "UNRECOGNIZED_COLUMN",
        severity: "info",
        message:
          "Subtotal columns are skipped; record columns extend until two consecutive empty columns.",
      },
    ],
  },

  // ---- Sheet 6: Headerless examples ----
  {
    id: "region_event_log_headerless",
    sheetId: "sheet_headerless",
    bounds: { startRow: 3, endRow: 8, startCol: 0, endCol: 4 },
    proposedLabel: "Event log (no headers)",
    targetEntityDefinitionId: null,
    headerAxes: [],
    recordsAxis: "column",
    recordAxisTerminator: { kind: "untilBlank", consecutiveBlanks: 2 },
    columnOverrides: {
      columnA: "timestamp",
      columnB: "event",
      columnC: "userId",
    },
    confidence: 0.64,
  },
  {
    id: "region_orders_gap",
    sheetId: "sheet_headerless",
    bounds: { startRow: 12, endRow: 17, startCol: 0, endCol: 3 },
    proposedLabel: "Orders (header, gap, data)",
    targetEntityDefinitionId: "ent_invoice",
    targetEntityLabel: "Invoice",
    headerAxes: ["row"],
    segmentsByAxis: { row: [{ kind: "field", positionCount: 4 }] },
    recordAxisTerminator: { kind: "untilBlank", consecutiveBlanks: 2 },
    confidence: 0.83,
  },
];

export const DRIFT_REGIONS: RegionDraft[] = PROPOSED_REGIONS.map((r) => {
  if (r.id === "region_revenue_rows_as_obs") {
    return {
      ...r,
      drift: {
        flagged: true,
        kind: "columns",
        priorSummary: "Columns: Region · Quarter · Revenue",
        observedSummary:
          "New column observed: 'Source' between Quarter and Revenue",
      },
      warnings: [
        {
          code: "UNRECOGNIZED_COLUMN",
          severity: "warn",
          message: "New column 'Source' added since last sync.",
          suggestedFix: "Accept the new column to include it in the mapping.",
        },
      ],
    };
  }
  if (r.id === "region_revenue_crosstab_absolute") {
    return {
      ...r,
      drift: {
        flagged: true,
        kind: "identity",
        identityChanging: true,
        priorSummary: "Column-axis values: Q1 2025, Q2 2025, Q3 2025, Q4 2025",
        observedSummary:
          "Column-axis values renamed to 2025-Q1, 2025-Q2, 2025-Q3, 2025-Q4",
      },
      warnings: [
        {
          code: "DUPLICATE_IDENTITY_VALUES",
          severity: "blocker",
          message: "Renaming axis labels changes source_id derivation.",
          suggestedFix:
            "Confirm whether to accept the rename or keep prior identity mapping.",
        },
      ],
    };
  }
  return r;
});

export const BLOCKER_REGIONS: RegionDraft[] = [
  {
    ...PROPOSED_REGIONS[0],
    warnings: [
      {
        code: "IDENTITY_COLUMN_HAS_BLANKS",
        severity: "blocker",
        message: "Identity column 'Region' has 2 blank rows.",
        suggestedFix:
          "Fill the blanks in the source file or choose a different identity column.",
      },
    ],
    confidence: 0.48,
  },
];
