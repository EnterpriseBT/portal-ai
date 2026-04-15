/**
 * XLSX Import Service — streams a named sheet from an XLSX file in S3 and
 * imports rows into entity_records.
 *
 * Thin format-specific wrapper around the shared `importRows` pipeline. The
 * file is consumed as a stream (no full-file buffering); peak memory is
 * bounded by the shared importer's batch size plus exceljs's internal
 * sharedStrings cache for the workbook.
 */

import { S3Service } from "./s3.service.js";
import { xlsxSheetRowIterator } from "../utils/xlsx-parser.util.js";
import { importRows, type ImportResult, type ImportRowsParams } from "./record-import.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "xlsx-import-service" });

export type XlsxImportResult = ImportResult;

interface ImportEntityParams extends ImportRowsParams {
  s3Key: string;
  /** Name of the worksheet inside the workbook to import. */
  sheetName: string;
}

export class XlsxImportService {
  /**
   * Stream a sheet from S3, normalize rows through field mappings, and upsert
   * into entity_records. Returns created/updated/unchanged/invalid counts.
   *
   * Throws ProcessorError("UPLOAD_SHEET_NOT_FOUND") if `sheetName` is not
   * present in the workbook.
   */
  static async importFromS3(params: ImportEntityParams): Promise<XlsxImportResult> {
    const { s3Key, sheetName, connectorEntityId } = params;

    logger.info(
      { connectorEntityId, s3Key, sheetName },
      "Starting XLSX import from S3 (streaming)",
    );

    const { stream } = await S3Service.getObjectStream(s3Key);
    const rows = xlsxSheetRowIterator(stream, sheetName);
    return importRows(rows, params);
  }
}
