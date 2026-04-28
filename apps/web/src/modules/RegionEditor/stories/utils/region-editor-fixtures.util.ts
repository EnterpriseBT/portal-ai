import type {
  CellValue,
  EntityOption,
  RegionDraft,
  SheetPreview,
  Workbook,
} from "../../utils/region-editor.types";

/**
 * Storybook workbook. The six shape-showcase sheets mirror the layouts in
 * `/public/samples/supported_layouts.xlsx` so stories and the live sample
 * file tell the same story. The "Headerless" and "GL fact (large)" sheets
 * are synthetic — they exist to exercise headerless extraction and
 * edge-scroll drawing across a large sheet, and are deliberately left as-is.
 */

export const ENTITY_OPTIONS: EntityOption[] = [
  { value: "ent_employee", label: "Employee", source: "db" },
  { value: "ent_employee_col", label: "Employee (transposed)", source: "db" },
  { value: "ent_monthly_sales", label: "Monthly sales", source: "db" },
  { value: "ent_ticket", label: "Ticket", source: "db" },
  { value: "ent_account_revenue", label: "Account revenue", source: "db" },
  { value: "ent_company_revenue", label: "Company revenue", source: "db" },
  { value: "ent_product_quarter_revenue", label: "Product × Quarter revenue", source: "db" },
  { value: "ent_contact", label: "Contact", source: "db" },
  { value: "ent_deal", label: "Deal", source: "db" },
  { value: "ent_invoice", label: "Invoice", source: "db" },
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
// Sheet 1 — Single axis · Row orientation · Static headers (employees flat).
//   Mirrors "Single Axis Static - Table 1" in supported_layouts.xlsx.
// ----------------------------------------------------------------------------

function buildSingleAxisStaticRowSheet(): SheetPreview {
  const cells = blank(10, 5);

  cells[0][0] = "Single axis · Row orientation · Static headers";
  cells[1][0] =
    "Each row = one record. Headers are fixed field names across columns.";
  write(cells, 2, 0, [
    "employee_id",
    "name",
    "department",
    "salary",
    "hire_date",
  ]);
  write(cells, 3, 0, [101, "Alice Nguyen", "Engineering", 95000, "2021-03-15"]);
  write(cells, 4, 0, [102, "Bob Okafor", "Marketing", 72000, "2020-07-01"]);
  write(cells, 5, 0, [103, "Carol Singh", "Engineering", 105000, "2019-11-22"]);
  write(cells, 6, 0, [104, "David Liu", "HR", 68000, "2022-01-10"]);
  write(cells, 7, 0, [105, "Eva Martínez", "Marketing", 76000, "2023-05-18"]);

  return {
    id: "sheet_row_tables",
    name: "Single axis · Row · Static",
    rowCount: 10,
    colCount: 5,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 2 — Single axis · Column orientation · Static headers (employees
// transposed). Mirrors "Single Axis Static - Table 1-1".
// ----------------------------------------------------------------------------

function buildSingleAxisStaticColSheet(): SheetPreview {
  const cells = blank(8, 6);

  cells[0][0] = "Single axis · Column orientation · Static headers";
  cells[1][0] =
    "Each column = one record. Headers are fixed field names down column A.";
  write(cells, 2, 0, ["employee_id", 101, 102, 103, 104, 105]);
  write(cells, 3, 0, [
    "name",
    "Alice Nguyen",
    "Bob Okafor",
    "Carol Singh",
    "David Liu",
    "Eva Martínez",
  ]);
  write(cells, 4, 0, [
    "department",
    "Engineering",
    "Marketing",
    "Engineering",
    "HR",
    "Marketing",
  ]);
  write(cells, 5, 0, ["salary", 95000, 72000, 105000, 68000, 76000]);
  write(cells, 6, 0, [
    "hire_date",
    "2021-03-15",
    "2020-07-01",
    "2019-11-22",
    "2022-01-10",
    "2023-05-18",
  ]);

  return {
    id: "sheet_column_tables",
    name: "Single axis · Column · Static",
    rowCount: 8,
    colCount: 6,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 3 — Single axis · Row orientation · Dynamic headers (monthly sales).
//   Mirrors "Single Axis Dynamic - Table 1". The header row carries value
//   labels (month names) rather than field names — the user names the axis
//   and the measure in the config panel.
// ----------------------------------------------------------------------------

function buildSingleAxisDynamicSheet(): SheetPreview {
  const cells = blank(8, 6);

  cells[0][0] = "Single axis · Row orientation · Dynamic headers";
  cells[1][0] =
    "Headers are value labels (month names); user names the axis (month) and the measure (sales).";
  write(cells, 2, 0, [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
  ]);
  write(cells, 3, 0, [42300, 39800, 51200, 55400, 60100, 58700]);
  write(cells, 4, 0, [53210, 32105, 27463, 19283, 85342, 14387]);
  write(cells, 5, 0, [94325, 75324, 64234, 41532, 63642, 32455]);

  return {
    id: "sheet_mixed_axes",
    name: "Single axis · Dynamic",
    rowCount: 8,
    colCount: 6,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 4 — Crosstab · both axes dynamic (team × severity tickets).
//   Mirrors "Crosstab - Table 1" (dynamic × dynamic, blank corner).
// ----------------------------------------------------------------------------

function buildCrosstabSheet(): SheetPreview {
  const cells = blank(10, 5);

  cells[0][0] = "Crosstab · both axes · Dynamic × Dynamic headers";
  cells[1][0] =
    "Both axes carry value labels. Neither axis has a declared field name. Corner cell is blank.";
  write(cells, 2, 0, ["", "Critical", "High", "Medium", "Low"]);
  write(cells, 3, 0, ["Platform", 3, 8, 14, 22]);
  write(cells, 4, 0, ["Mobile", 1, 5, 18, 30]);
  write(cells, 5, 0, ["Data", 2, 6, 11, 19]);
  write(cells, 6, 0, ["DevOps", 5, 12, 9, 15]);
  write(cells, 7, 0, ["QA", 0, 3, 21, 42]);

  return {
    id: "sheet_crosstab",
    name: "Crosstab · Dynamic × Dynamic",
    rowCount: 10,
    colCount: 5,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 5 — Pivot · Row orientation · Hybrid static + dynamic headers
//   (accounts × products × years revenue). Mirrors "Pivot - Table 1".
//   The row-axis header band has two static fields ("Account", "Product")
//   followed by a dynamic pivot over four year labels.
// ----------------------------------------------------------------------------

function buildPivotRowSheet(): SheetPreview {
  const cells = blank(10, 6);

  cells[0][0] = "Pivot · Row orientation · Hybrid Static + Dynamic headers";
  cells[1][0] =
    "Column headers mix static fields (Account, Product) with dynamic value labels (year).";
  write(cells, 2, 0, ["Account", "Product", 2020, 2021, 2022, 2023]);
  write(cells, 3, 0, ["Google", "Product 1", 100000, 200000, 300000, 400000]);
  write(cells, 4, 0, [
    "Microsoft",
    "Product 2",
    150000,
    250000,
    350000,
    450000,
  ]);
  write(cells, 5, 0, ["Costco", "Product 3", 200000, 250000, 300000, 400000]);
  write(cells, 6, 0, ["Lowe’s", "Product 4", 300000, 350000, 400000, 450000]);

  return {
    id: "sheet_messy_pipeline",
    name: "Pivot · Row",
    rowCount: 10,
    colCount: 6,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 6 — Hybrid Crosstab (company × year revenue with metadata fields).
//   Mirrors the core of "Hybrid Crosstab - Table 1-1-1" — simplified to
//   fit the editor's draft model: static fields (Industry, HQ) followed
//   by a dynamic pivot over quarter labels.
// ----------------------------------------------------------------------------

function buildHybridCrosstabSheet(): SheetPreview {
  const cells = blank(10, 7);

  cells[0][0] = "Hybrid Crosstab · Mixed static + dynamic headers";
  cells[1][0] =
    "Two static cols (Industry, HQ) precede a dynamic pivot over quarter labels.";
  write(cells, 2, 0, [
    "Company",
    "Industry",
    "HQ",
    "2022-Q1",
    "2022-Q2",
    "2022-Q3",
    "2022-Q4",
  ]);
  write(cells, 3, 0, ["Apple", "Tech", "Cupertino", 100, 120, 130, 140]);
  write(cells, 4, 0, ["Microsoft", "Tech", "Redmond", 95, 105, 115, 125]);
  write(cells, 5, 0, ["Walmart", "Retail", "Bentonville", 150, 160, 170, 180]);
  write(cells, 6, 0, ["Shell", "Energy", "The Hague", 200, 210, 205, 195]);

  return {
    id: "sheet_messy_quarters",
    name: "Hybrid Crosstab",
    rowCount: 10,
    colCount: 7,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 7 — Hybrid Crosstab · Both axes · Static + Dynamic headers.
//   Product × Quarter revenue where *both* axes mix static field headers
//   with dynamic pivot labels. Row axis: skip (corner) + Region / Owner
//   (static fields) + 2024-Q1..Q4 (dynamic pivot). Column axis: skip
//   (corner) + Audit / Currency (static fields) + Alpha / Beta / Gamma /
//   Delta (dynamic pivot). Inner (dynamic × dynamic) cells carry the
//   revenue measure; field × dynamic cells carry per-period or per-product
//   metadata.
// ----------------------------------------------------------------------------

function buildHybridCrosstabBothAxesSheet(): SheetPreview {
  const cells = blank(11, 7);

  cells[0][0] =
    "Hybrid Crosstab · Both axes · Static + Dynamic headers";
  cells[1][0] =
    "Row axis: Region, Owner, then Q1–Q4.  Column axis: Audit, Currency, then products.  Inner cells = revenue.";

  // Row 2 — row-axis header row: corner, two static fields, four period labels.
  write(cells, 2, 0, [
    "",
    "Region",
    "Owner",
    "2024-Q1",
    "2024-Q2",
    "2024-Q3",
    "2024-Q4",
  ]);

  // Rows 3–4 — column-axis static fields. Their cells under Region/Owner
  // are blank (field × field intersections); under the period pivot they
  // carry per-period metadata (audit status / currency).
  write(cells, 3, 0, ["Audit", "", "", "Draft", "Draft", "Final", "Final"]);
  write(cells, 4, 0, ["Currency", "", "", "USD", "USD", "USD", "USD"]);

  // Rows 5–8 — column-axis dynamic pivot (product names) with per-product
  // metadata (Region, Owner) and per-period revenue.
  write(cells, 5, 0, ["Alpha", "NA", "Priya", 100, 120, 130, 140]);
  write(cells, 6, 0, ["Beta", "EMEA", "Hans", 95, 105, 115, 125]);
  write(cells, 7, 0, ["Gamma", "APAC", "Yuki", 150, 160, 170, 180]);
  write(cells, 8, 0, ["Delta", "LATAM", "Diego", 200, 210, 205, 195]);

  return {
    id: "sheet_hybrid_crosstab_both",
    name: "Hybrid Crosstab · Both axes",
    rowCount: 11,
    colCount: 7,
    cells,
  };
}

// ----------------------------------------------------------------------------
// Sheet 8 — Headerless (unchanged — exercises headerless extraction).
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
// Sheet 9 — Large GL fact (unchanged — exercises edge-scroll drawing).
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
  sourceLabel: "supported_layouts.xlsx",
  sheets: [
    buildSingleAxisStaticRowSheet(),
    buildSingleAxisStaticColSheet(),
    buildSingleAxisDynamicSheet(),
    buildCrosstabSheet(),
    buildPivotRowSheet(),
    buildHybridCrosstabSheet(),
    buildHybridCrosstabBothAxesSheet(),
    buildHeaderlessSheet(),
    buildLargeFactSheet(),
  ],
};

export const EMPTY_REGIONS: RegionDraft[] = [];

// Region definitions cover each of the six showcase layouts with a
// canonical segment model. Region + sheet IDs are stable across the
// codebase — stories and tests address them by id.
export const PROPOSED_REGIONS: RegionDraft[] = [
  // ---- Sheet 1: Single axis · Row · Static (employees) ----
  {
    id: "region_revenue_rows_as_obs",
    sheetId: "sheet_row_tables",
    bounds: { startRow: 2, endRow: 7, startCol: 0, endCol: 4 },
    proposedLabel: "Employees (rows-as-records)",
    targetEntityDefinitionId: "ent_employee",
    targetEntityLabel: "Employee",
    headerAxes: ["row"],
    segmentsByAxis: { row: [{ kind: "field", positionCount: 5 }] },
    confidence: 0.93,
  },

  // ---- Sheet 2: Single axis · Column · Static (employees transposed) ----
  {
    id: "region_revenue_cols_as_obs",
    sheetId: "sheet_column_tables",
    bounds: { startRow: 2, endRow: 6, startCol: 0, endCol: 5 },
    proposedLabel: "Employees (columns-as-records)",
    targetEntityDefinitionId: "ent_employee_col",
    targetEntityLabel: "Employee (transposed)",
    headerAxes: ["column"],
    segmentsByAxis: { column: [{ kind: "field", positionCount: 5 }] },
    confidence: 0.9,
  },

  // ---- Sheet 3: Single axis · Dynamic (monthly sales) ----
  // The header row carries month names; the user provides the axis name
  // ("month") and the measure ("sales") in the config panel.
  {
    id: "region_attrs_rows_as_regions",
    sheetId: "sheet_mixed_axes",
    bounds: { startRow: 2, endRow: 5, startCol: 0, endCol: 5 },
    proposedLabel: "Monthly sales (dynamic headers)",
    targetEntityDefinitionId: "ent_monthly_sales",
    targetEntityLabel: "Monthly sales",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [
        {
          kind: "pivot",
          id: "monthly-sales-pivot",
          axisName: "month",
          axisNameSource: "user",
          positionCount: 6,
        },
      ],
    },
    cellValueField: { name: "sales", nameSource: "user" },
    confidence: 0.75,
  },

  // ---- Sheet 4: Crosstab · Dynamic × Dynamic (team × severity tickets) ----
  {
    id: "region_revenue_crosstab_absolute",
    sheetId: "sheet_crosstab",
    bounds: { startRow: 2, endRow: 7, startCol: 0, endCol: 4 },
    proposedLabel: "Tickets by team × severity",
    targetEntityDefinitionId: "ent_ticket",
    targetEntityLabel: "Ticket",
    headerAxes: ["row", "column"],
    segmentsByAxis: {
      row: [
        { kind: "skip", positionCount: 1 },
        {
          kind: "pivot",
          id: "tickets-crosstab-row-pivot",
          axisName: "severity",
          axisNameSource: "user",
          positionCount: 4,
        },
      ],
      column: [
        { kind: "skip", positionCount: 1 },
        {
          kind: "pivot",
          id: "tickets-crosstab-col-pivot",
          axisName: "team",
          axisNameSource: "user",
          positionCount: 5,
        },
      ],
    },
    cellValueField: { name: "tickets", nameSource: "user" },
    confidence: 0.83,
  },

  // ---- Sheet 5: Pivot · Row · Hybrid (accounts × products × years) ----
  //   Row-axis segments: two static fields (Account, Product) + a dynamic
  //   pivot over four year labels. The pivot contributes a "year"
  //   column-label field and a "revenue" measure.
  {
    id: "region_messy_pipeline",
    sheetId: "sheet_messy_pipeline",
    bounds: { startRow: 2, endRow: 6, startCol: 0, endCol: 5 },
    proposedLabel: "Account revenue by year",
    targetEntityDefinitionId: "ent_account_revenue",
    targetEntityLabel: "Account revenue",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [
        { kind: "field", positionCount: 2 },
        {
          kind: "pivot",
          id: "account-revenue-year-pivot",
          axisName: "year",
          axisNameSource: "user",
          positionCount: 4,
        },
      ],
    },
    cellValueField: { name: "revenue", nameSource: "user" },
    confidence: 0.79,
  },

  // ---- Sheet 6: Hybrid Crosstab (company × year revenue with metadata) ----
  {
    id: "region_messy_quarters",
    sheetId: "sheet_messy_quarters",
    bounds: { startRow: 2, endRow: 6, startCol: 0, endCol: 6 },
    proposedLabel: "Company revenue by quarter",
    targetEntityDefinitionId: "ent_company_revenue",
    targetEntityLabel: "Company revenue",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [
        { kind: "field", positionCount: 3 },
        {
          kind: "pivot",
          id: "company-revenue-quarter-pivot",
          axisName: "quarter",
          axisNameSource: "user",
          positionCount: 4,
        },
      ],
    },
    cellValueField: { name: "revenue", nameSource: "user" },
    confidence: 0.74,
  },

  // ---- Sheet 7: Hybrid Crosstab · Both axes ·
  //   Row axis: skip (corner) + field×2 (Region, Owner) + pivot×4 (periods).
  //   Column axis: skip (corner) + field×2 (Audit, Currency) + pivot×4 (products).
  //   Inner dynamic × dynamic cells carry the revenue measure.
  {
    id: "region_hybrid_crosstab_both",
    sheetId: "sheet_hybrid_crosstab_both",
    bounds: { startRow: 2, endRow: 8, startCol: 0, endCol: 6 },
    proposedLabel: "Product × Quarter revenue (hybrid both axes)",
    targetEntityDefinitionId: "ent_product_quarter_revenue",
    targetEntityLabel: "Product × Quarter revenue",
    headerAxes: ["row", "column"],
    segmentsByAxis: {
      row: [
        { kind: "skip", positionCount: 1 },
        { kind: "field", positionCount: 2 },
        {
          kind: "pivot",
          id: "hybrid-both-period-pivot",
          axisName: "period",
          axisNameSource: "user",
          positionCount: 4,
        },
      ],
      column: [
        { kind: "skip", positionCount: 1 },
        { kind: "field", positionCount: 2 },
        {
          kind: "pivot",
          id: "hybrid-both-product-pivot",
          axisName: "product",
          axisNameSource: "user",
          positionCount: 4,
        },
      ],
    },
    cellValueField: { name: "revenue", nameSource: "user" },
    confidence: 0.7,
  },

  // ---- Sheet 8: Headerless examples ----
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
        priorSummary:
          "Columns: employee_id · name · department · salary · hire_date",
        observedSummary:
          "New column observed: 'location' between department and salary",
      },
      warnings: [
        {
          code: "UNRECOGNIZED_COLUMN",
          severity: "warn",
          message: "New column 'location' added since last sync.",
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
        priorSummary: "Column-axis values: Critical, High, Medium, Low",
        observedSummary:
          "Column-axis values renamed to SEV-1, SEV-2, SEV-3, SEV-4",
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
        message: "Identity column 'employee_id' has 2 blank rows.",
        suggestedFix:
          "Fill the blanks in the source file or choose a different identity column.",
      },
    ],
    confidence: 0.48,
  },
];
