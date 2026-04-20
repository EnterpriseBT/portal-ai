import type { WorkbookFingerprint } from "../plan/workbook-fingerprint.schema.js";
import type { CellValue, SheetData, WorkbookData } from "./types.js";

type AnchorCell = WorkbookFingerprint["anchorCells"][number];

function coerceAnchorValue(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function findAnchorCell(sheet: SheetData): AnchorCell | undefined {
  const topLeft = sheet.cells.find((c) => c.row === 1 && c.col === 1);
  if (!topLeft) return undefined;
  const text = coerceAnchorValue(topLeft.value);
  if (text === "") return undefined;
  return { sheet: sheet.name, row: 1, col: 1, value: text };
}

export function computeWorkbookFingerprint(
  data: WorkbookData
): WorkbookFingerprint {
  const sheetNames: string[] = [];
  const dimensions: Record<string, { rows: number; cols: number }> = {};
  const anchorCells: AnchorCell[] = [];

  for (const sheet of data.sheets) {
    sheetNames.push(sheet.name);
    dimensions[sheet.name] = {
      rows: sheet.dimensions.rows,
      cols: sheet.dimensions.cols,
    };
    const anchor = findAnchorCell(sheet);
    if (anchor) anchorCells.push(anchor);
  }

  return { sheetNames, dimensions, anchorCells };
}
