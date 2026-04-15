/**
 * CSV Import Service — streams CSV files from S3 and imports rows into entity_records.
 *
 * Thin format-specific wrapper around the shared `importRows` pipeline. The file is
 * consumed as a stream (no `Buffer.concat`); peak memory is bounded by the shared
 * importer's batch size.
 */

import { S3Service } from "./s3.service.js";
import { csvRowIterator } from "../utils/csv-parser.util.js";
import { importRows, type ImportResult } from "./record-import.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "csv-import-service" });

export type CsvImportResult = ImportResult;

interface ImportEntityParams {
  s3Key: string;
  connectorEntityId: string;
  organizationId: string;
  userId: string;
}

export class CsvImportService {
  /**
   * Stream a CSV from S3, normalize rows through field mappings, and upsert
   * into entity_records. Returns created/updated/unchanged/invalid counts.
   */
  static async importFromS3(params: ImportEntityParams): Promise<CsvImportResult> {
    const { s3Key, connectorEntityId } = params;

    logger.info({ connectorEntityId, s3Key }, "Starting CSV import from S3 (streaming)");

    const { stream } = await S3Service.getObjectStream(s3Key);
    const rows = csvRowIterator(stream);
    return importRows(rows, params);
  }
}
