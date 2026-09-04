/**
 * XLSX reader for the demo fixtures (#509).
 *
 * Yields one `Record<string, string>` per data row keyed by the header row.
 * If `sheetName` is given, only that sheet is read (financials' three
 * differently-shaped sheets); otherwise every sheet is read in order (orders,
 * one sheet per year, all the same shape). Cell values are coerced to strings
 * (dates → `YYYY-MM-DD`) so the output matches the CSV reader and what
 * `importRows` normalizes.
 *
 * The demo XLSX fixtures are small (orders ~8k, financials tiny) so a full
 * in-memory read is fine — the ~1M table is synthesized, never an XLSX.
 */

import ExcelJS from "exceljs";

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    // Formula/richText cells — none in our fixtures, but be defensive.
    const obj = value as { result?: unknown; text?: unknown };
    if (obj.result !== undefined) return String(obj.result);
    if (obj.text !== undefined) return String(obj.text);
  }
  return String(value);
}

export async function* readXlsxRows(
  path: string,
  sheetName?: string
): AsyncGenerator<Record<string, string>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheets = sheetName
    ? wb.worksheets.filter((ws) => ws.name === sheetName)
    : wb.worksheets;

  for (const ws of sheets) {
    const headerValues = ws.getRow(1).values as unknown[]; // 1-indexed
    const headers = headerValues.slice(1).map((h) => cellToString(h));
    for (let r = 2; r <= ws.rowCount; r++) {
      const values = ws.getRow(r).values as unknown[];
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = cellToString(values[i + 1]);
      });
      yield row;
    }
  }
}
