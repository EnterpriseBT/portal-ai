import type {
  EntityOption,
  RegionDraft,
  SheetPreview,
  Workbook,
} from "../../utils/region-editor.types";

export const ENTITY_OPTIONS: EntityOption[] = [
  { value: "ent_contact", label: "Contact", source: "db" },
  { value: "ent_deal", label: "Deal", source: "db" },
  { value: "ent_revenue", label: "Revenue", source: "db" },
  { value: "ent_account", label: "Account", source: "db" },
  { value: "ent_headcount", label: "Headcount", source: "db" },
  { value: "ent_product", label: "Product", source: "db" },
  { value: "ent_invoice", label: "Invoice", source: "db" },
  { value: "ent_sales_rep", label: "Sales rep", source: "db" },
  { value: "ent_department", label: "Department", source: "db" },
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
// Sheet 1: "Row tables" — rows-as-records + headerAxis: row (standard tables)
// ----------------------------------------------------------------------------

function buildRowTablesSheet(): SheetPreview {
  const cells = blank(28, 8);

  cells[0][0] = "Row-oriented tables — headers in the top row of each region";

  // Region 1: absolute — fixed-bounds Leads table at A3:E8
  cells[2][0] = "Leads (fixed 5 rows)";
  write(cells, 3, 0, ["First", "Last", "Email", "Company", "Deal"]);
  write(cells, 4, 0, ["Alice", "Johnson", "alice@beta.io", "Beta", 12500]);
  write(cells, 5, 0, ["Bob", "Singh", "bob@chai.co", "Chai", 8200]);
  write(cells, 6, 0, ["Carol", "Wu", "carol@delta.ai", "Delta", 45000]);
  write(cells, 7, 0, ["Dev", "Patel", "dev@epsilon.io", "Epsilon", 3300]);
  write(cells, 8, 0, ["Ellie", "Mbeki", "ellie@foxtrot.co", "Foxtrot", 17800]);

  // Region 2: untilEmpty — Opportunities at A11 extending until blank at row 19
  cells[10][0] = "Opportunities (extends until empty row)";
  write(cells, 11, 0, ["Name", "Stage", "Amount", "Close Date"]);
  write(cells, 12, 0, ["Acme upgrade", "Negotiation", 48000, "2026-04-30"]);
  write(cells, 13, 0, ["Gamma expansion", "Proposal", 12000, "2026-05-10"]);
  write(cells, 14, 0, ["Delta renewal", "Closed Won", 35000, "2026-04-02"]);
  write(cells, 15, 0, ["Foxtrot pilot", "Discovery", 8000, "2026-06-15"]);
  // Row 16 deliberately empty so extent stops there.

  // Region 3: matchesPattern — Invoices at A18 ending at "Total" row 25
  cells[17][0] = "Invoices (ends at Total row)";
  write(cells, 18, 0, ["Invoice #", "Customer", "Amount", "Paid"]);
  write(cells, 19, 0, ["INV-001", "Acme", 4200, "Yes"]);
  write(cells, 20, 0, ["INV-002", "Beta", 1800, "Yes"]);
  write(cells, 21, 0, ["INV-003", "Chai", 6500, "No"]);
  write(cells, 22, 0, ["INV-004", "Delta", 12000, "No"]);
  write(cells, 23, 0, ["INV-005", "Epsilon", 3300, "Yes"]);
  write(cells, 24, 0, ["Total", "", 27800, ""]);

  return { id: "sheet_row_tables", name: "Row tables", rowCount: 28, colCount: 8, cells };
}

// ----------------------------------------------------------------------------
// Sheet 2: "Column tables" — columns-as-records + headerAxis: column (transposed)
// Each column = a record; first column carries field labels.
// ----------------------------------------------------------------------------

function buildColumnTablesSheet(): SheetPreview {
  const cells = blank(20, 12);

  cells[0][0] = "Column-oriented tables — field labels in the first column of each region";

  // Region 4: absolute — Products at A3:E7 (4 products as columns)
  cells[2][0] = "Products (fixed 4 columns)";
  write(cells, 3, 0, ["Name", "Widget A", "Widget B", "Gadget", "Gizmo"]);
  write(cells, 4, 0, ["SKU", "SKU-001", "SKU-002", "SKU-010", "SKU-011"]);
  write(cells, 5, 0, ["Price", 19.99, 24.5, 99.0, 149.0]);
  write(cells, 6, 0, ["Stock", 120, 80, 35, 12]);
  write(cells, 7, 0, ["Category", "Basic", "Basic", "Premium", "Premium"]);

  // Region 5: untilEmpty — Departments at A10 extending right until empty column
  cells[9][0] = "Departments (extends until empty column)";
  write(cells, 10, 0, ["Field", "Eng", "Sales", "Marketing", "Support", "Ops"]);
  // Column 6 is empty for all rows -> extent stops at col 5.
  write(cells, 11, 0, ["Head", "Priya", "Marco", "Sara", "Ollie", "Jin"]);
  write(cells, 12, 0, ["Headcount", 42, 28, 14, 9, 7]);
  write(cells, 13, 0, ["Budget", 6.2, 3.1, 1.85, 0.72, 0.9]);

  // Region 6: matchesPattern — Sales reps ending at "Total" column
  cells[15][0] = "Sales reps (ends at Total column)";
  write(cells, 16, 0, ["Name", "Rep A", "Rep B", "Rep C", "Rep D", "Total"]);
  write(cells, 17, 0, ["Deals", 12, 8, 15, 9, 44]);
  write(cells, 18, 0, ["Revenue", 120000, 85000, 175000, 98000, 478000]);

  return { id: "sheet_column_tables", name: "Column tables", rowCount: 20, colCount: 12, cells };
}

// ----------------------------------------------------------------------------
// Sheet 3: "Mixed axes" — less-common orientation/headerAxis combinations
// ----------------------------------------------------------------------------

function buildMixedAxesSheet(): SheetPreview {
  const cells = blank(32, 10);

  cells[0][0] = "Mixed axes — the less-common orientation/header combinations";

  // Region 7: rows-as-records + headerAxis: column (label column labels the row)
  // Layout: each row = a contact record, col A is the "field label column"
  // (e.g., tags like "lead", "opp", "cust") and cols B-E carry the data.
  cells[2][0] = "Rows-as-records with header column (left column labels each row)";
  write(cells, 3, 0, ["Type", "Name", "Amount", "Stage"]);
  write(cells, 4, 0, ["lead", "Acme", 0, "Cold"]);
  write(cells, 5, 0, ["opp", "Beta", 12000, "Proposal"]);
  write(cells, 6, 0, ["cust", "Chai", 45000, "Closed Won"]);
  write(cells, 7, 0, ["lead", "Delta", 0, "Cold"]);
  write(cells, 8, 0, ["opp", "Epsilon", 8000, "Discovery"]);

  // Region 8: columns-as-records + headerAxis: row (top row labels each column record)
  // Layout: top row = record labels (dept names), column 0 = field value rows.
  cells[11][0] = "Columns-as-records with header row (top row labels each column)";
  write(cells, 12, 0, ["", "Engineering", "Sales", "Marketing", "Support"]);
  write(cells, 13, 0, ["Manager", "Priya", "Marco", "Sara", "Ollie"]);
  write(cells, 14, 0, ["Headcount", 42, 28, 14, 9]);
  write(cells, 15, 0, ["Budget ($M)", 6.2, 3.1, 1.85, 0.72]);
  write(cells, 16, 0, ["Tier", "Core", "GTM", "GTM", "Ops"]);
  // Empty col 5 so an untilEmpty region stops there.

  // Region 9: rows-as-records + headerAxis: column — ideal pivoted layout.
  // No header row; column A carries the record identity (salesperson) and the
  // remaining columns carry field values (quota, region, segment, account count).
  cells[19][0] =
    "Rows-as-records with header column — col A identifies each record (no header row)";
  write(cells, 21, 0, ["Alex",    42000, "AMER",  "Enterprise", 18]);
  write(cells, 22, 0, ["Bianca",  58000, "EMEA",  "Mid-Market", 24]);
  write(cells, 23, 0, ["Casey",   36000, "APAC",  "SMB",        31]);
  write(cells, 24, 0, ["Diego",   71000, "LATAM", "Enterprise",  9]);
  write(cells, 25, 0, ["Elena",   49000, "EMEA",  "Mid-Market", 22]);
  write(cells, 26, 0, ["Farouk",  63000, "AMER",  "Enterprise", 14]);
  write(cells, 27, 0, ["Gemma",   31000, "APAC",  "SMB",        27]);
  // Empty row 28 so an untilEmpty region stops there.

  return { id: "sheet_mixed_axes", name: "Mixed axes", rowCount: 32, colCount: 10, cells };
}

// ----------------------------------------------------------------------------
// Sheet 4: "Crosstab" — cells-as-records with row AND column labels
// ----------------------------------------------------------------------------

function buildCrosstabSheet(): SheetPreview {
  const cells = blank(22, 10);

  cells[0][0] = "Crosstabs — both axes label records (cells-as-records)";

  // Region 9: absolute crosstab — Revenue by Region × Month (fixed bounds)
  cells[2][0] = "Revenue by region × month (fixed 3×4)";
  write(cells, 3, 0, ["", "JAN", "FEB", "MAR", "APR"]);
  write(cells, 4, 0, ["North America", 120000, 135000, 148000, 152000]);
  write(cells, 5, 0, ["EMEA", 82000, 89000, 91000, 95000]);
  write(cells, 6, 0, ["APAC", 45000, 52000, 61000, 68000]);

  // Region 10: untilEmpty crosstab — Headcount by Quarter × Department (both axes extend)
  cells[9][0] = "Headcount by quarter × department (extends both directions until empty)";
  write(cells, 10, 0, ["", "Eng", "Sales", "Marketing", "Support"]);
  write(cells, 11, 0, ["Q1 2025", 38, 24, 12, 8]);
  write(cells, 12, 0, ["Q2 2025", 40, 26, 13, 9]);
  write(cells, 13, 0, ["Q3 2025", 41, 27, 14, 9]);
  write(cells, 14, 0, ["Q4 2025", 42, 28, 14, 9]);
  // Row 15 empty, col 5 empty — untilEmpty stops there in both directions.

  return { id: "sheet_crosstab", name: "Crosstab", rowCount: 22, colCount: 10, cells };
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
  write(cells, 7, 0, ["Beta Industries", "Marco", "Negotiation", 17000, "2026-04-22"]);
  write(cells, 8, 0, ["Chai & Co", "Priya", "Proposal", 22500, "2026-05-10"]);
  // Blank row to test single-blank skip (terminator=2 so this doesn't end things).
  // Row 9 intentionally blank.
  write(cells, 10, 0, ["Delta Labs", "Sara", "Discovery", 8000, "2026-06-01"]);
  write(cells, 11, 0, ["Subtotal", "", "", 95500, ""]); // cellMatches rule: ^Subtotal$
  // Row 12 intentionally blank (aesthetic separator between regions).

  write(cells, 13, 0, ["— EMEA Region —"]);
  write(cells, 14, 0, ["Epsilon GmbH", "Hans", "Closed Won", 32000, "2026-03-14"]);
  write(cells, 15, 0, ["Foxtrot SARL", "Claire", "Proposal", 12000, "2026-05-03"]);
  write(cells, 16, 0, ["Gamma PLC", "Hans", "Negotiation", 41000, "2026-04-28"]);
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

  cells[0][0] = "Quarterly snapshot — messy export where non-data columns interleave";
  cells[1][0] = "Rows are fields. Columns with '— Subtotal —' in row 3 are aggregates to skip.";

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

  return { id: "sheet_headerless", name: "Headerless", rowCount: 22, colCount: 10, cells };
}

function buildNotesSheet(): SheetPreview {
  const cells = blank(4, 4);
  cells[0][0] = "Internal notes — not for extraction";
  cells[2][0] = "TODO: verify Q2 figures before committing the plan";
  return { id: "sheet_notes", name: "Notes", rowCount: 4, colCount: 4, cells };
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
    buildNotesSheet(),
  ],
};

export const EMPTY_REGIONS: RegionDraft[] = [];

// Region definitions covering every permutation.
export const PROPOSED_REGIONS: RegionDraft[] = [
  // ---- Sheet 1: Row tables (rows-as-records + headerAxis: row) ----
  {
    id: "region_leads_absolute",
    sheetId: "sheet_row_tables",
    bounds: { startRow: 3, endRow: 8, startCol: 0, endCol: 4 },
    proposedLabel: "Leads (fixed)",
    targetEntityDefinitionId: "ent_contact",
    targetEntityLabel: "Contact",
    orientation: "rows-as-records",
    headerAxis: "row",
    boundsMode: "absolute",
    confidence: 0.94,
  },
  {
    id: "region_opps_untilEmpty",
    sheetId: "sheet_row_tables",
    bounds: { startRow: 11, endRow: 15, startCol: 0, endCol: 3 },
    proposedLabel: "Opportunities (until empty, terminator=2)",
    targetEntityDefinitionId: "ent_deal",
    targetEntityLabel: "Deal",
    orientation: "rows-as-records",
    headerAxis: "row",
    boundsMode: "untilEmpty",
    skipRules: [
      { kind: "blank" },
      // Skip any row that starts with "— ... —" section separators (column A).
      { kind: "cellMatches", crossAxisIndex: 0, pattern: "^—.*—$" },
    ],
    untilEmptyTerminatorCount: 2,
    confidence: 0.88,
  },
  {
    id: "region_invoices_pattern",
    sheetId: "sheet_row_tables",
    bounds: { startRow: 18, endRow: 23, startCol: 0, endCol: 3 },
    proposedLabel: "Invoices (stops at Total)",
    targetEntityDefinitionId: "ent_invoice",
    targetEntityLabel: "Invoice",
    orientation: "rows-as-records",
    headerAxis: "row",
    boundsMode: "matchesPattern",
    boundsPattern: "^Total$",
    confidence: 0.82,
  },

  // ---- Sheet 2: Column tables (columns-as-records + headerAxis: column) ----
  {
    id: "region_products_absolute",
    sheetId: "sheet_column_tables",
    bounds: { startRow: 3, endRow: 7, startCol: 0, endCol: 4 },
    proposedLabel: "Products (fixed)",
    targetEntityDefinitionId: "ent_product",
    targetEntityLabel: "Product",
    orientation: "columns-as-records",
    headerAxis: "column",
    boundsMode: "absolute",
    confidence: 0.91,
  },
  {
    id: "region_depts_untilEmpty",
    sheetId: "sheet_column_tables",
    bounds: { startRow: 10, endRow: 13, startCol: 0, endCol: 5 },
    proposedLabel: "Departments (until empty, terminator=2)",
    targetEntityDefinitionId: "ent_department",
    targetEntityLabel: "Department",
    orientation: "columns-as-records",
    headerAxis: "column",
    boundsMode: "untilEmpty",
    skipRules: [
      { kind: "blank" },
      // For columns-as-records, cross-axis is the row index.
      // Skip any column whose row 10 (label row) matches "— Subtotal —".
      { kind: "cellMatches", crossAxisIndex: 10, pattern: "^—.*—$", axis: "row" },
    ],
    untilEmptyTerminatorCount: 2,
    confidence: 0.86,
  },
  {
    id: "region_salesreps_pattern",
    sheetId: "sheet_column_tables",
    bounds: { startRow: 16, endRow: 18, startCol: 0, endCol: 5 },
    proposedLabel: "Sales reps (stops at Total)",
    targetEntityDefinitionId: "ent_sales_rep",
    targetEntityLabel: "Sales rep",
    orientation: "columns-as-records",
    headerAxis: "column",
    boundsMode: "matchesPattern",
    boundsPattern: "^Total$",
    confidence: 0.79,
  },

  // ---- Sheet 3: Mixed axes (uncommon orientation/headerAxis pairs) ----
  {
    id: "region_labeled_rows",
    sheetId: "sheet_mixed_axes",
    bounds: { startRow: 3, endRow: 8, startCol: 0, endCol: 3 },
    proposedLabel: "Records with label column",
    targetEntityDefinitionId: "ent_contact",
    targetEntityLabel: "Contact",
    orientation: "rows-as-records",
    headerAxis: "column",
    recordsAxisName: { name: "Type", source: "user" },
    boundsMode: "untilEmpty",
    confidence: 0.71,
  },
  {
    id: "region_columns_top_labeled",
    sheetId: "sheet_mixed_axes",
    bounds: { startRow: 12, endRow: 16, startCol: 0, endCol: 4 },
    proposedLabel: "Columns labeled by top row",
    targetEntityDefinitionId: "ent_department",
    targetEntityLabel: "Department",
    orientation: "columns-as-records",
    headerAxis: "row",
    recordsAxisName: { name: "Department", source: "ai", confidence: 0.76 },
    boundsMode: "untilEmpty",
    confidence: 0.68,
  },

  // ---- Sheet 4: Crosstab (cells-as-records) ----
  {
    id: "region_revenue_crosstab_absolute",
    sheetId: "sheet_crosstab",
    bounds: { startRow: 3, endRow: 6, startCol: 0, endCol: 4 },
    proposedLabel: "Revenue crosstab (fixed)",
    targetEntityDefinitionId: "ent_revenue",
    targetEntityLabel: "Revenue",
    orientation: "cells-as-records",
    headerAxis: "row",
    recordsAxisName: { name: "Region", source: "user" },
    secondaryRecordsAxisName: { name: "Month", source: "ai", confidence: 0.82 },
    cellValueName: { name: "Revenue", source: "ai", confidence: 0.79 },
    boundsMode: "absolute",
    confidence: 0.81,
  },
  {
    id: "region_headcount_crosstab_untilEmpty",
    sheetId: "sheet_crosstab",
    bounds: { startRow: 10, endRow: 14, startCol: 0, endCol: 4 },
    proposedLabel: "Headcount crosstab (until empty)",
    targetEntityDefinitionId: "ent_headcount",
    targetEntityLabel: "Headcount",
    orientation: "cells-as-records",
    headerAxis: "row",
    recordsAxisName: { name: "Quarter", source: "user" },
    secondaryRecordsAxisName: { name: "Department", source: "user" },
    cellValueName: { name: "Headcount", source: "user" },
    boundsMode: "untilEmpty",
    confidence: 0.77,
  },

  // ---- Sheet 5a: Messy pipeline (row-oriented skip rules) ----
  {
    id: "region_messy_pipeline",
    sheetId: "sheet_messy_pipeline",
    // Anchor covers header + first region block; extent extends past it.
    bounds: { startRow: 3, endRow: 8, startCol: 0, endCol: 4 },
    proposedLabel: "Global pipeline — skip separators + subtotals",
    targetEntityDefinitionId: "ent_deal",
    targetEntityLabel: "Deal",
    orientation: "rows-as-records",
    headerAxis: "row",
    boundsMode: "untilEmpty",
    skipRules: [
      { kind: "blank" },
      // "— NA Region —" / "— EMEA Region —" / "— APAC Region —" all in column A.
      { kind: "cellMatches", crossAxisIndex: 0, pattern: "^—.*—$" },
      // Subtotal rows — column A contains "Subtotal".
      { kind: "cellMatches", crossAxisIndex: 0, pattern: "^Subtotal$" },
    ],
    untilEmptyTerminatorCount: 2,
    confidence: 0.79,
    warnings: [
      {
        code: "AMBIGUOUS_HEADER",
        severity: "info",
        message: "Three skip rules active — extraction omits section labels and subtotals.",
        suggestedFix: "Verify the 9 extracted rows match the 9 real deals.",
      },
    ],
  },

  // ---- Sheet 5b: Messy quarters (column-oriented skip rules, axis: "row") ----
  {
    id: "region_messy_quarters",
    sheetId: "sheet_messy_quarters",
    // Anchor covers label column + 2 record columns; extent extends right.
    bounds: { startRow: 3, endRow: 7, startCol: 0, endCol: 2 },
    proposedLabel: "Quarters — skip subtotal columns",
    targetEntityDefinitionId: "ent_department",
    targetEntityLabel: "Department",
    orientation: "columns-as-records",
    headerAxis: "column",
    boundsMode: "untilEmpty",
    skipRules: [
      { kind: "blank" },
      // Row 3 is the label row for each column. Skip columns whose row-3 cell
      // looks like an aggregate header ("— Subtotal —", "— Year-end —").
      { kind: "cellMatches", crossAxisIndex: 3, pattern: "^—.*—$", axis: "row" },
    ],
    untilEmptyTerminatorCount: 2,
    confidence: 0.74,
    warnings: [
      {
        code: "UNRECOGNIZED_COLUMN",
        severity: "info",
        message: "Subtotal columns are skipped; record columns extend until two consecutive empty columns.",
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
    orientation: "rows-as-records",
    headerAxis: "none",
    boundsMode: "untilEmpty",
    columnOverrides: {
      columnA: "timestamp",
      columnB: "event",
      columnC: "userId",
      // columnD and columnE left with auto names to show default behavior
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
    orientation: "rows-as-records",
    headerAxis: "row",
    boundsMode: "untilEmpty",
    confidence: 0.83,
  },
];

export const DRIFT_REGIONS: RegionDraft[] = PROPOSED_REGIONS.map((r) => {
  if (r.id === "region_opps_untilEmpty") {
    return {
      ...r,
      drift: {
        flagged: true,
        kind: "columns",
        priorSummary: "Columns: Name · Stage · Amount · Close Date",
        observedSummary: "New column observed: 'Owner' between Stage and Amount",
      },
      warnings: [
        {
          code: "UNRECOGNIZED_COLUMN",
          severity: "warn",
          message: "New column 'Owner' added since last sync.",
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
        priorSummary: "Column-axis values: JAN, FEB, MAR, APR",
        observedSummary: "Column-axis values renamed to January, February, March, April",
      },
      warnings: [
        {
          code: "DUPLICATE_IDENTITY_VALUES",
          severity: "blocker",
          message: "Renaming axis labels changes source_id derivation.",
          suggestedFix: "Confirm whether to accept the rename or keep prior identity mapping.",
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
        message: "Identity column 'Email' has 2 blank rows.",
        suggestedFix: "Fill the blanks in the source file or choose a different identity column.",
      },
    ],
    confidence: 0.48,
  },
];
