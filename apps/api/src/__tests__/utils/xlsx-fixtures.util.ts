/**
 * In-memory XLSX fixture builders for tests.
 *
 * Uses ExcelJS's in-memory `Workbook` writer to produce real .xlsx buffers
 * without committing binary fixtures to the repo. Cell values are written
 * through the standard cell.value API so type coercion (Date, number,
 * boolean) round-trips through the streaming reader as it would for a
 * user-uploaded file.
 */

import { Readable } from "node:stream";

import ExcelJS from "exceljs";

type CellValue = string | number | boolean | Date | null;

/**
 * Build an XLSX workbook with a single sheet whose first row is treated as
 * headers and remaining rows as data. Strings are written as-is; the
 * `unknown[][]` overload allows mixing types per cell for type-coercion tests.
 */
export async function buildSingleSheetXlsx(
  sheetName: string,
  rows: CellValue[][],
): Promise<Buffer> {
  return buildMultiSheetXlsx({ [sheetName]: rows });
}

/**
 * Build an XLSX workbook with multiple sheets. Insertion order of the
 * `sheets` record is preserved as worksheet order. Pass an empty array
 * to create a header-less / row-less sheet.
 */
export async function buildMultiSheetXlsx(
  sheets: Record<string, CellValue[][]>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  for (const [name, rows] of Object.entries(sheets)) {
    const ws = workbook.addWorksheet(name);
    // ExcelJS's streaming reader crashes reading workbooks where a worksheet
    // never had addRow called (it emits malformed workbook.xml missing the
    // <sheets> relationship). Add a placeholder empty row to guarantee the
    // sheet's XML is initialized; the parser treats all-blank rows as empty
    // and skips them, so this preserves the fixture's intent for truly
    // empty sheets.
    if (rows.length === 0) {
      ws.addRow([""]);
    } else {
      for (const row of rows) {
        ws.addRow(row);
      }
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/** Wrap a buffer as a Readable stream for parser consumption. */
export function toStream(buffer: Buffer): Readable {
  return Readable.from(buffer);
}
