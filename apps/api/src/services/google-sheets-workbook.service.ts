/**
 * Sheets API → `WorkbookData` mapper.
 *
 * Pure function: takes the JSON shape returned by
 * `GET /v4/spreadsheets/{id}?includeGridData=true` and produces a
 * `WorkbookData` validated against `WorkbookSchema`. No network, no I/O.
 *
 * Date coercion mirrors the XLSX adapter: serial-number cells whose
 * `effectiveFormat.numberFormat.type` is `DATE` or `DATE_TIME` become
 * JS `Date` objects rather than raw numbers, so a date imported from a
 * Sheets tab matches the same date imported from an uploaded XLSX.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-B.plan.md` §Slice 6.
 */

import type {
  CellValue,
  SheetData,
  WorkbookCell,
  WorkbookData,
} from "@portalai/spreadsheet-parsing";
import { WorkbookSchema } from "@portalai/spreadsheet-parsing";

interface SheetsExtendedValue {
  stringValue?: string;
  numberValue?: number;
  boolValue?: boolean;
  formulaValue?: string;
  errorValue?: { type?: string; message?: string };
}

interface SheetsCellData {
  userEnteredValue?: SheetsExtendedValue;
  effectiveValue?: SheetsExtendedValue;
  formattedValue?: string;
  effectiveFormat?: {
    numberFormat?: { type?: string; pattern?: string };
  };
}

interface SheetsRowData {
  values?: SheetsCellData[];
}

interface SheetsGridData {
  startRow?: number;
  startColumn?: number;
  rowData?: SheetsRowData[];
}

interface SheetsSheetProperties {
  title?: string;
  gridProperties?: { rowCount?: number; columnCount?: number };
}

interface SheetsSheet {
  properties?: SheetsSheetProperties;
  data?: SheetsGridData[];
}

interface SheetsResponse {
  properties?: { title?: string };
  sheets?: SheetsSheet[];
}

/** Sheets/Excel epoch is 1899-12-30 UTC; integer = days since. */
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

function isDateLikeFormat(type: string | undefined): boolean {
  return (
    type === "DATE" ||
    type === "DATE_TIME" ||
    type === "TIME"
  );
}

function serialToDate(serial: number): Date {
  return new Date(SERIAL_EPOCH_MS + Math.round(serial * MS_PER_DAY));
}

function coerceCellValue(cell: SheetsCellData): CellValue {
  const ev = cell.effectiveValue;
  if (!ev) return null;

  // Date / time-formatted numbers come back as numberValue + a date-like
  // numberFormat. Mirror the XLSX adapter and produce a Date.
  if (
    typeof ev.numberValue === "number" &&
    isDateLikeFormat(cell.effectiveFormat?.numberFormat?.type)
  ) {
    return serialToDate(ev.numberValue);
  }

  if (typeof ev.stringValue === "string") {
    return ev.stringValue === "" ? null : ev.stringValue;
  }
  if (typeof ev.numberValue === "number") return ev.numberValue;
  if (typeof ev.boolValue === "boolean") return ev.boolValue;
  // Formula errors: surface the message so the user sees something
  // useful rather than null.
  if (ev.errorValue) {
    return ev.errorValue.message ?? ev.errorValue.type ?? "#ERROR";
  }
  // Formula source string with no effective value (rare — formula not
  // yet evaluated). Fall back to the formula text.
  if (typeof ev.formulaValue === "string") {
    return ev.formulaValue;
  }
  return null;
}

function isCellEmpty(cell: SheetsCellData): boolean {
  const ev = cell.effectiveValue;
  if (!ev) return !cell.formattedValue;
  return (
    ev.stringValue === undefined &&
    ev.numberValue === undefined &&
    ev.boolValue === undefined &&
    ev.formulaValue === undefined &&
    ev.errorValue === undefined
  );
}

function mapSheet(sheet: SheetsSheet): SheetData {
  const title = sheet.properties?.title ?? "";
  const grid = sheet.data?.[0] ?? {};
  const startRow = grid.startRow ?? 0;
  const startColumn = grid.startColumn ?? 0;
  const rowData = grid.rowData ?? [];
  const cells: WorkbookCell[] = [];

  for (let r = 0; r < rowData.length; r++) {
    const row = rowData[r];
    const values = row?.values ?? [];
    for (let c = 0; c < values.length; c++) {
      const cell = values[c]!;
      if (isCellEmpty(cell)) continue;
      const out: WorkbookCell = {
        row: startRow + r + 1, // schema is 1-based
        col: startColumn + c + 1,
        value: coerceCellValue(cell),
      };
      if (typeof cell.formattedValue === "string" && cell.formattedValue !== "") {
        out.rawText = cell.formattedValue;
      }
      cells.push(out);
    }
  }

  const declaredRows = sheet.properties?.gridProperties?.rowCount;
  const declaredCols = sheet.properties?.gridProperties?.columnCount;
  return {
    name: title,
    dimensions: {
      rows: typeof declaredRows === "number" ? declaredRows : rowData.length,
      cols:
        typeof declaredCols === "number"
          ? declaredCols
          : Math.max(0, ...rowData.map((r) => r?.values?.length ?? 0)),
    },
    cells,
  };
}

export function googleSheetsToWorkbook(response: SheetsResponse): WorkbookData {
  const sheets = (response.sheets ?? []).map(mapSheet);
  const workbook: WorkbookData = { sheets };
  const validated = WorkbookSchema.safeParse(workbook);
  if (!validated.success) {
    throw new Error(
      `Google Sheets response did not produce a valid workbook: ${validated.error.message}`
    );
  }
  return validated.data;
}
