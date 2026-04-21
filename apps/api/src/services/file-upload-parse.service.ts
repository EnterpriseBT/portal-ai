import { Readable } from "node:stream";

import type { SheetData, WorkbookData } from "@portalai/spreadsheet-parsing";
import { WorkbookSchema } from "@portalai/spreadsheet-parsing";

import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";
import { csvToWorkbook } from "./workbook-adapters/csv.adapter.js";
import { xlsxToWorkbook } from "./workbook-adapters/xlsx.adapter.js";
import { ProcessorError } from "../utils/processor-error.util.js";

export interface ParseFileInput {
  buffer: Buffer;
  filename: string;
}

export interface ParseFileResult {
  workbook: WorkbookData;
}

const SUPPORTED_EXTENSIONS = [".csv", ".tsv", ".xlsx", ".xls"] as const;

function extensionOf(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === filename.length - 1) return "";
  return filename.substring(dotIndex).toLowerCase();
}

function baseNameOf(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex > 0 ? filename.substring(0, dotIndex) : filename;
  return base.length > 0 ? base : "Sheet1";
}

/**
 * Returns a sheet name guaranteed unique within `taken`. On collision, appends
 * a numeric suffix — `Sheet1`, `Sheet1 (2)`, `Sheet1 (3)`, … — preserving the
 * original name when there is no conflict.
 */
function uniqueSheetName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let suffix = 2;
  // Cap the search to avoid pathological loops on malicious input.
  while (suffix < 1_000) {
    const candidate = `${name} (${suffix})`;
    if (!taken.has(candidate)) return candidate;
    suffix += 1;
  }
  throw new Error(`Could not generate unique sheet name for "${name}"`);
}

async function parseSingle(input: ParseFileInput): Promise<WorkbookData> {
  const { buffer, filename } = input;

  if (buffer.length === 0) {
    throw new ApiError(
      400,
      ApiCode.FILE_UPLOAD_PARSE_EMPTY,
      `File "${filename}" is empty`
    );
  }

  const ext = extensionOf(filename);
  if (!SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])) {
    throw new ApiError(
      400,
      ApiCode.FILE_UPLOAD_PARSE_UNSUPPORTED,
      `Unsupported file extension "${ext || "(none)"}" on "${filename}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`
    );
  }

  try {
    if (ext === ".csv" || ext === ".tsv") {
      const source = Readable.from(buffer);
      return await csvToWorkbook(source, {
        sheetName: baseNameOf(filename),
        delimiter: ext === ".tsv" ? "\t" : undefined,
      });
    }
    const source = Readable.from(buffer);
    return await xlsxToWorkbook(source);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof ProcessorError) {
      throw new ApiError(
        400,
        ApiCode.FILE_UPLOAD_PARSE_FAILED,
        err.message
      );
    }
    throw new ApiError(
      500,
      ApiCode.FILE_UPLOAD_PARSE_FAILED,
      err instanceof Error ? err.message : "Failed to parse file"
    );
  }
}

export const FileUploadParseService = {
  async parse(inputs: ParseFileInput[]): Promise<ParseFileResult> {
    if (inputs.length === 0) {
      throw new ApiError(
        400,
        ApiCode.FILE_UPLOAD_PARSE_INVALID_PAYLOAD,
        "At least one file is required"
      );
    }

    const merged: SheetData[] = [];
    const taken = new Set<string>();

    for (const input of inputs) {
      const workbook = await parseSingle(input);
      for (const sheet of workbook.sheets) {
        const name = uniqueSheetName(sheet.name, taken);
        taken.add(name);
        merged.push({ ...sheet, name });
      }
    }

    const workbook: WorkbookData = { sheets: merged };
    const validated = WorkbookSchema.safeParse(workbook);
    if (!validated.success) {
      throw new ApiError(
        500,
        ApiCode.FILE_UPLOAD_PARSE_FAILED,
        "Adapter produced an invalid workbook"
      );
    }

    return { workbook };
  },
};
