/**
 * CSV Import Service — reads CSV files from S3 and imports rows into entity_records.
 *
 * Used by the upload confirmation flow to persist parsed CSV data
 * after entities, column definitions, and field mappings have been created.
 */

import { Readable } from "node:stream";
import crypto from "crypto";

import { parse } from "csv-parse";

import { EntityRecordModelFactory } from "@portalai/core/models";

import { S3Service } from "./s3.service.js";
import { DbService } from "./db.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "csv-import-service" });

/** Bytes to read for delimiter detection. */
const DETECTION_CHUNK_SIZE = 4096;

const CANDIDATE_DELIMITERS = [",", "\t", ";", "|"];

/** Maximum records per upsert batch. */
const BATCH_SIZE = 500;

export interface CsvImportResult {
  created: number;
  updated: number;
  unchanged: number;
}

export interface FieldMappingInfo {
  sourceField: string;
  columnDefinitionKey: string;
}

interface ImportEntityParams {
  s3Key: string;
  connectorEntityId: string;
  organizationId: string;
  userId: string;
  fieldMappings: FieldMappingInfo[];
}

function detectDelimiter(sample: string): string {
  let best = ",";
  let bestCount = 0;

  for (const d of CANDIDATE_DELIMITERS) {
    const count = sample.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }

  return best;
}

async function parseCSVBuffer(
  buffer: Buffer,
  delimiter: string,
): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const rows: string[][] = [];
    const parser = parse({
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
    });

    parser.on("readable", () => {
      let record: string[];
      while ((record = parser.read()) !== null) {
        rows.push(record);
      }
    });

    parser.on("error", reject);
    parser.on("end", () => resolve(rows));

    const stream = Readable.from(buffer);
    stream.pipe(parser);
  });
}

function computeChecksum(data: Record<string, unknown>): string {
  const json = JSON.stringify(data, Object.keys(data).sort());
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 16);
}

export class CsvImportService {
  /**
   * Import CSV rows from an S3 file into entity_records.
   *
   * 1. Downloads and parses the CSV from S3
   * 2. Builds raw `data` and `normalizedData` for each row using field mappings
   * 3. Computes checksums for change detection
   * 4. Upserts records into entity_records (dedup by sourceId)
   */
  static async importFromS3(params: ImportEntityParams): Promise<CsvImportResult> {
    const { s3Key, connectorEntityId, organizationId, userId, fieldMappings } = params;

    logger.info(
      { connectorEntityId, s3Key },
      "Starting CSV import from S3"
    );

    // 1. Download from S3
    const { stream } = await S3Service.getObjectStream(s3Key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // 2. Detect delimiter
    const sampleText = buffer.subarray(0, DETECTION_CHUNK_SIZE).toString("utf-8");
    const delimiter = detectDelimiter(sampleText);

    // 3. Parse CSV
    const allRows = await parseCSVBuffer(buffer, delimiter);
    if (allRows.length === 0) {
      return { created: 0, updated: 0, unchanged: 0 };
    }

    // 4. Extract headers (first row) and detect header presence
    const firstRow = allRows[0];
    const hasHeader = firstRow.length > 1 &&
      firstRow.every((v) => v.trim() !== "" && isNaN(Number(v.trim())));

    const headers = hasHeader
      ? firstRow.map((h) => h.trim())
      : firstRow.map((_, i) => `column_${i + 1}`);

    const dataRows = hasHeader ? allRows.slice(1) : allRows;

    // 5. Build a source→columnKey lookup from field mappings
    const sourceToKey = new Map<string, string>();
    for (const fm of fieldMappings) {
      sourceToKey.set(fm.sourceField, fm.columnDefinitionKey);
    }

    // 6. Build import records
    const factory = new EntityRecordModelFactory();
    const now = Date.now();

    // Look up existing records for change detection
    const sourceIds = dataRows.map((_, i) => String(i));
    const existing = await DbService.repository.entityRecords.findBySourceIds(
      connectorEntityId,
      sourceIds,
    );
    const existingMap = new Map(existing.map((r) => [r.sourceId, r]));

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    const toUpsert = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceId = String(i);

      // Build raw data: header → value
      const data: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        data[headers[j]] = j < row.length ? row[j] : null;
      }

      // Build normalizedData: column definition key → value
      const normalizedData: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        const colKey = sourceToKey.get(headers[j]);
        if (colKey) {
          normalizedData[colKey] = j < row.length ? row[j] : null;
        }
      }

      const checksum = computeChecksum(data);

      // Change detection
      const prev = existingMap.get(sourceId);
      if (prev && prev.checksum === checksum) {
        unchanged++;
        continue;
      }

      if (prev) {
        updated++;
      } else {
        created++;
      }

      const model = factory.create(userId);
      model.update({
        id: prev?.id ?? model.toJSON().id,
        organizationId,
        connectorEntityId,
        data,
        normalizedData,
        sourceId,
        checksum,
        syncedAt: now,
        origin: "sync",
        updated: prev ? now : null,
        updatedBy: prev ? userId : null,
      });

      toUpsert.push(model.parse());
    }

    // 7. Batch upsert
    for (let i = 0; i < toUpsert.length; i += BATCH_SIZE) {
      const batch = toUpsert.slice(i, i + BATCH_SIZE);
      await DbService.repository.entityRecords.upsertManyBySourceId(batch);
    }

    logger.info(
      { connectorEntityId, created, updated, unchanged, total: dataRows.length },
      "CSV import completed"
    );

    return { created, updated, unchanged };
  }
}
