import type { Readable } from "node:stream";

import ExcelJS from "exceljs";

import type {
  CellValue,
  MergedRange,
  SheetData,
  WorkbookCell,
  WorkbookData,
} from "@portalai/spreadsheet-parsing";

import { ProcessorError } from "../../utils/processor-error.util.js";
import type {
  ChunkCell,
  ChunkRow,
  SessionWriter,
} from "../workbook-cache.service.js";

const STAGE_SIZE = 256;

/** A sheet emitted to the writer; mirrors the CSV adapter's return shape. */
export interface XlsxParsedSheetMeta {
  sheetId: string;
  name: string;
  rowCount: number;
  colCount: number;
}

export interface XlsxToCacheContext {
  /**
   * Resolve a worksheet's raw name into (uniqued name, stable sheetId) so
   * the adapter can call `writer.finishSheet` with the values the file-upload
   * pipeline expects. Called once per worksheet, in the order ExcelJS yields
   * them.
   */
  resolveSheet: (rawName: string) => { name: string; sheetId: string };
}

/**
 * Coerce an ExcelJS raw cell value into the `ChunkCell` union we store in
 * the chunked cache. Lossy compared to `WorkbookCell.value` (Date → ISO
 * string, formula objects → their `result`, hyperlinks → display text);
 * the legacy WorkbookData path was already lossy here through
 * JSON.stringify in WorkbookCacheService.set, so the round-trip behavior
 * matches.
 */
function coerceCell(raw: unknown): ChunkCell {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return raw === "" ? null : raw;
  if (typeof raw === "object") {
    const obj = raw as {
      richText?: Array<{ text?: string }>;
      text?: string | number | boolean | Date;
      result?: unknown;
      hyperlink?: string;
    };
    if (Array.isArray(obj.richText)) {
      const joined = obj.richText.map((p) => p.text ?? "").join("");
      return joined === "" ? null : joined;
    }
    if (typeof obj.text === "string") {
      return obj.text === "" ? null : obj.text;
    }
    if (obj.result !== undefined) return coerceCell(obj.result);
  }
  return String(raw);
}

function wrapXlsxError(err: unknown): ProcessorError {
  if (err instanceof ProcessorError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/password|encrypted|encryption/i.test(message)) {
    return new ProcessorError(
      "XLSX_PASSWORD_PROTECTED",
      `XLSX file is password-protected: ${message}`
    );
  }
  return new ProcessorError(
    "XLSX_PARSE_FAILED",
    `Failed to parse XLSX file: ${message}`
  );
}

interface ExcelJsRow {
  number: number;
  values: unknown[]; // sparse 1-indexed array
}

interface ExcelJsWorksheetReader {
  id: number;
  name?: string;
  [Symbol.asyncIterator](): AsyncIterator<ExcelJsRow>;
}

interface ExcelJsWorkbookReaderCtor {
  new (
    input: Readable,
    options?: {
      sharedStrings?: "cache" | "emit" | "ignore";
      styles?: "cache" | "ignore";
      hyperlinks?: "cache" | "emit" | "ignore";
      worksheets?: "emit" | "prep";
    }
  ): {
    [Symbol.asyncIterator](): AsyncIterator<ExcelJsWorksheetReader>;
  };
}

const WorkbookReader = (
  ExcelJS as unknown as {
    stream: { xlsx: { WorkbookReader: ExcelJsWorkbookReaderCtor } };
  }
).stream.xlsx.WorkbookReader;

/**
 * Stream an XLSX byte source through ExcelJS' `WorkbookReader` straight into
 * the chunked workbook cache. Memory is bounded by:
 *
 *   - the shared-strings cache (one entry per unique string in the file)
 *   - one chunk's worth of staged rows (`STAGE_SIZE × maxColCount`)
 *
 * vs. the legacy `xlsxToWorkbook`, which `readAll`'d the entire stream into
 * a Buffer + held the full sparse cell array.
 *
 * Trade-off: merged-cell metadata is dropped on the streaming path. ExcelJS'
 * streaming reader sees `mergeCell` tags but does not surface them, and a
 * grep at the time of the refactor found no consumer of `WorkbookCell.merged`
 * downstream of the adapter. If a renderer/interpreter starts using merge
 * info, capture it via a dedicated XLSX side-pass.
 */
export async function xlsxToCache(
  source: Readable,
  writer: SessionWriter,
  ctx: XlsxToCacheContext
): Promise<XlsxParsedSheetMeta[]> {
  const reader = new WorkbookReader(source, {
    sharedStrings: "cache",
    styles: "cache",
    hyperlinks: "ignore",
    worksheets: "emit",
  });

  const out: XlsxParsedSheetMeta[] = [];

  try {
    for await (const worksheet of reader) {
      const rawName = worksheet.name ?? `Sheet${worksheet.id}`;
      const { name, sheetId } = ctx.resolveSheet(rawName);

      let rowCount = 0;
      let colCount = 0;
      let stage: ChunkRow[] = [];

      const flushIfFull = async (): Promise<void> => {
        if (stage.length >= STAGE_SIZE) {
          await writer.appendRows(sheetId, stage);
          stage = [];
        }
      };

      for await (const row of worksheet) {
        const targetRow = row.number;

        // Fill any gap rows the source skipped (XLSX rows are sparse by row
        // number; the dense layout needs explicit empties to keep the row
        // index aligned).
        while (rowCount + 1 < targetRow) {
          rowCount++;
          stage.push([]);
          await flushIfFull();
        }

        const values = row.values; // 1-indexed sparse, [undefined, v1, v2, ...]
        const denseRow: ChunkCell[] = new Array(
          values.length > 0 ? values.length - 1 : 0
        );
        for (let c = 1; c < values.length; c++) {
          denseRow[c - 1] = coerceCell(values[c]);
        }
        // Trim trailing-null run so empty tails don't bloat the chunk.
        let lastNonNull = denseRow.length - 1;
        while (lastNonNull >= 0 && denseRow[lastNonNull] === null) {
          lastNonNull--;
        }
        const trimmed: ChunkCell[] = denseRow.slice(0, lastNonNull + 1);
        if (trimmed.length > colCount) colCount = trimmed.length;

        rowCount++;
        stage.push(trimmed);
        await flushIfFull();
      }

      if (stage.length > 0) {
        await writer.appendRows(sheetId, stage);
      }

      await writer.finishSheet(sheetId, {
        name,
        rowCount,
        colCount,
      });

      out.push({ sheetId, name, rowCount, colCount });
    }
  } catch (err) {
    throw wrapXlsxError(err);
  }

  return out;
}

// ── Legacy `WorkbookData` adapter (microsoft-excel connector) ──────────────
// The file-upload pipeline uses `xlsxToCache` above; the OAuth-driven
// microsoft-excel connector still consumes `WorkbookData` via the legacy
// `WorkbookCacheService.set/get` blob cache, so the buffer-the-world adapter
// stays until Phase 4 migrates that pipeline (see
// docs/LARGE_FILE_PARSE_STREAMING.plan.md). Memory cost on this path is
// O(workbook size); large Microsoft Excel sheets are still vulnerable to
// OOM on the connector's sync path.

function coerceCellRich(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return raw === "" ? null : raw;
  if (typeof raw === "object") {
    const obj = raw as {
      richText?: Array<{ text?: string }>;
      text?: string;
      result?: unknown;
    };
    if (Array.isArray(obj.richText)) {
      const joined = obj.richText.map((p) => p.text ?? "").join("");
      return joined === "" ? null : joined;
    }
    if (typeof obj.text === "string") {
      return obj.text === "" ? null : obj.text;
    }
    if (obj.result !== undefined) return coerceCellRich(obj.result);
  }
  return String(raw);
}

interface MergeModel {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

function collectMerges(ws: ExcelJS.Worksheet): Map<string, MergedRange> {
  const byTopLeft = new Map<string, MergedRange>();
  const merges = (
    ws as unknown as { _merges?: Record<string, { model?: MergeModel }> }
  )._merges;
  if (!merges) return byTopLeft;
  for (const key of Object.keys(merges)) {
    const model = merges[key]?.model;
    if (!model) continue;
    byTopLeft.set(`${model.top}:${model.left}`, {
      startRow: model.top,
      startCol: model.left,
      endRow: model.bottom,
      endCol: model.right,
    });
  }
  return byTopLeft;
}

async function readAll(source: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function buildSheetWorkbookData(ws: ExcelJS.Worksheet): SheetData {
  const merges = collectMerges(ws);
  const cells: WorkbookCell[] = [];
  let maxRow = 0;
  let maxCol = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = coerceCellRich(cell.value);
      if (value === null) return;
      if (rowNumber > maxRow) maxRow = rowNumber;
      if (colNumber > maxCol) maxCol = colNumber;
      const mergedKey = `${rowNumber}:${colNumber}`;
      const merged = merges.get(mergedKey);
      cells.push(
        merged
          ? { row: rowNumber, col: colNumber, value, merged }
          : { row: rowNumber, col: colNumber, value }
      );
    });
  });

  const name =
    (ws as unknown as { name?: string }).name ??
    `Sheet${(ws as unknown as { id?: number }).id ?? "?"}`;

  return {
    name,
    dimensions: { rows: maxRow, cols: maxCol },
    cells,
  };
}

/**
 * Convert an XLSX byte stream into a canonical `WorkbookData`. Buffers the
 * full source in memory before parsing; only the microsoft-excel connector
 * still uses this. New file-upload code should use `xlsxToCache` above.
 */
export async function xlsxToWorkbook(source: Readable): Promise<WorkbookData> {
  let buffer: Buffer;
  try {
    buffer = await readAll(source);
  } catch (err) {
    throw wrapXlsxError(err);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (err) {
    throw wrapXlsxError(err);
  }

  const sheets: SheetData[] = [];
  workbook.eachSheet((ws) => {
    sheets.push(buildSheetWorkbookData(ws));
  });

  return { sheets };
}

// Re-export for consumers that only need the `CellValue` type from this module.
export type { CellValue };
