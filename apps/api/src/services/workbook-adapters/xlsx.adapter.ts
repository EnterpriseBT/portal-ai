import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import ExcelJS from "exceljs";

import type { CellValue } from "@portalai/spreadsheet-parsing";

import { ProcessorError } from "../../utils/processor-error.util.js";
import type {
  ChunkCell,
  ChunkRow,
  SessionWriter,
} from "../workbook-cache.service.js";
import {
  emptySharedStringsEntry,
  metadataFirst,
  readZipLayout,
  streamEntries,
  ZipLayoutError,
} from "./xlsx-entry-order.util.js";

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
  /**
   * Optional per-flush row-count callback. Fires after each chunk
   * is written to the cache (every `STAGE_SIZE` rows). Used by the
   * file_upload_parse processor to emit incremental Bull progress
   * so the SSE-fed UI bar ticks during parsing instead of stalling
   * at the upload's 100% until the worker completes.
   */
  onRowsFlushed?: (rowsThisFlush: number) => void;
}

/**
 * Coerce an ExcelJS raw cell value into the `ChunkCell` union we store in
 * the chunked cache. Lossy compared to `WorkbookCell.value` (Date → ISO
 * string, formula objects → their `result`, hyperlinks → display text);
 * the legacy WorkbookData path was already lossy here through
 * `JSON.stringify(workbook)`, so the round-trip behavior matches the
 * pre-Phase-4 single-blob cache.
 */
export function coerceCell(raw: unknown): ChunkCell {
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
      formula?: string;
      sharedFormula?: string;
      error?: string;
      sharedString?: number;
    };
    if (Array.isArray(obj.richText)) {
      const joined = obj.richText.map((p) => p.text ?? "").join("");
      return joined === "" ? null : joined;
    }
    if (typeof obj.text === "string") {
      return obj.text === "" ? null : obj.text;
    }
    if (obj.result !== undefined) return coerceCell(obj.result);
    // A formula error ("#N/A", "#DIV/0!") reads as its text.
    if (typeof obj.error === "string") return obj.error;
    // A formula the file saved without a cached result has no value.
    if (obj.formula !== undefined || obj.sharedFormula !== undefined) {
      return null;
    }
    // #997: an unresolved shared string, or a shape we don't know, used to
    // be stored as "[object Object]". Refuse the file instead.
    const shape =
      obj.sharedString !== undefined
        ? "an unresolved shared string"
        : `a cell of shape {${Object.keys(obj).join(", ")}}`;
    throw new ProcessorError(
      "XLSX_PARSE_FAILED",
      `Failed to parse XLSX file: ${shape}`
    );
  }
  return String(raw);
}

/**
 * ExcelJS' `row.values` drops a formula's cached result when it's falsy
 * (0, "", false), which would read a zero total as blank; the cell keeps
 * it (#997).
 */
function withCachedResult(raw: unknown, row: ExcelJsRow, col: number): unknown {
  if (
    raw !== null &&
    typeof raw === "object" &&
    ("formula" in raw || "sharedFormula" in raw) &&
    (raw as { result?: unknown }).result === undefined
  ) {
    const result = row.getCell(col).result;
    if (result !== undefined) return { ...raw, result };
  }
  return raw;
}

/**
 * The worksheets `xl/workbook.xml` declares, by their relationship type
 * (chart sheets aren't worksheets and are never emitted). Matched on the
 * type's last segment, so both the transitional and strict namespaces count. Counted from the
 * workbook rather than from zip entry names, so a sheet stored under any
 * name is counted (#997).
 */
export function declaredWorksheetCount(reader: object): number {
  const { model, workbookRels } = reader as {
    model?: { sheets?: Array<{ rId?: string }> };
    workbookRels?: Array<{ Id?: string; Type?: string }>;
  };
  const worksheetIds = new Set(
    (workbookRels ?? [])
      .filter((rel) => rel.Type?.endsWith("/worksheet"))
      .map((rel) => rel.Id)
  );
  return (model?.sheets ?? []).filter((s) => worksheetIds.has(s.rId)).length;
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
  /** The cell at a 1-based column; `result` keeps a falsy cached value. */
  getCell(col: number): { result?: unknown };
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
 * Read an XLSX byte source through ExcelJS' `WorkbookReader` into the
 * chunked workbook cache. The source is first spooled to a temp file, up to
 * the upload size limit, so its zip entries can be handed to ExcelJS in an
 * order it reads deterministically (#997); the file is removed when the
 * parse ends, however it ends. Memory is bounded by:
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
  const out: XlsxParsedSheetMeta[] = [];
  const dir = await mkdtemp(join(tmpdir(), "xlsx-"));
  const path = join(dir, "source.xlsx");

  try {
    // Spooling is outside the parse-error wrapping below: a failed download
    // or a full disk is the server's failure, not a bad file.
    await pipeline(source, createWriteStream(path));
    const { size } = await stat(path);

    try {
      // #997: ExcelJS reads a zip deterministically only with its metadata
      // (shared strings, styles) ahead of the sheets, so hand it the
      // entries in that order, with an empty shared-strings part when the
      // file has none.
      const layout = await readZipLayout(path, size);
      const ordered = { ...layout, entries: metadataFirst(layout.entries) };
      const hasSharedStrings = layout.entries.some(
        (e) => e.name === "xl/sharedStrings.xml"
      );
      const reader = new WorkbookReader(
        streamEntries(
          path,
          ordered,
          hasSharedStrings ? [] : [emptySharedStringsEntry()]
        ),
        {
          sharedStrings: "cache",
          styles: "cache",
          hyperlinks: "ignore",
          worksheets: "emit",
        }
      );

      for await (const worksheet of reader) {
        const rawName = worksheet.name ?? `Sheet${worksheet.id}`;
        const { name, sheetId } = ctx.resolveSheet(rawName);

        let rowCount = 0;
        let colCount = 0;
        let stage: ChunkRow[] = [];

        const flushIfFull = async (): Promise<void> => {
          if (stage.length >= STAGE_SIZE) {
            const count = stage.length;
            await writer.appendRows(sheetId, stage);
            stage = [];
            ctx.onRowsFlushed?.(count);
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
            denseRow[c - 1] = coerceCell(withCachedResult(values[c], row, c));
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
          const count = stage.length;
          await writer.appendRows(sheetId, stage);
          ctx.onRowsFlushed?.(count);
        }

        await writer.finishSheet(sheetId, {
          name,
          rowCount,
          colCount,
        });

        out.push({ sheetId, name, rowCount, colCount });
      }

      // A sheet the reader skipped is data lost without a trace (#997).
      const expectedSheets = declaredWorksheetCount(reader);
      if (out.length < expectedSheets) {
        throw new ProcessorError(
          "XLSX_PARSE_FAILED",
          `Failed to parse XLSX file: read ${out.length} of ${expectedSheets} sheets`
        );
      }
    } catch (err) {
      if (err instanceof ZipLayoutError) {
        throw new ProcessorError(
          "XLSX_PARSE_FAILED",
          `Failed to parse XLSX file: ${err.message}`
        );
      }
      throw wrapXlsxError(err);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return out;
}

// Re-export for consumers that only need the `CellValue` type from this module.
export type { CellValue };
