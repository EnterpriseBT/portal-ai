/**
 * Shared row-import pipeline consumed by `CsvImportService` and `XlsxImportService`.
 *
 * Takes an async iterable of raw rows (keyed by source field names) and:
 *   1. Fetches field mappings once for the entity
 *   2. Normalizes each row through the NormalizationService
 *   3. Computes a SHA-256 checksum for change detection
 *   4. Batches upserts at BATCH_SIZE rows, looking up existing records per batch
 *   5. Returns created / updated / unchanged / invalid counts
 *
 * Peak memory is O(BATCH_SIZE) regardless of total row count.
 */

import crypto from "crypto";

import { eq } from "drizzle-orm";

import { EntityRecordModelFactory } from "@portalai/core/models";

import { DbService } from "./db.service.js";
import { NormalizationService } from "./normalization.service.js";
import { fieldMappings } from "../db/schema/index.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "record-import" });

/** Maximum records per upsert batch. */
const BATCH_SIZE = 500;

export interface ImportRowsParams {
  connectorEntityId: string;
  organizationId: string;
  userId: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
}

interface PendingRow {
  sourceId: string;
  data: Record<string, unknown>;
  normalizedData: Record<string, unknown>;
  validationErrors: Array<{ field: string; error: string }> | null;
  isValid: boolean;
  checksum: string;
}

function computeChecksum(data: Record<string, unknown>): string {
  const json = JSON.stringify(data, Object.keys(data).sort());
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 16);
}

/**
 * Consume an async iterable of rows and upsert them into entity_records.
 *
 * @param rows - Async iterable of rows keyed by source field names
 * @param params - Entity and org context
 */
export async function importRows(
  rows: AsyncIterable<Record<string, string>>,
  params: ImportRowsParams
): Promise<ImportResult> {
  const { connectorEntityId, organizationId, userId } = params;

  logger.info(
    { connectorEntityId },
    "Starting record import from async iterable"
  );

  // 1. Fetch field mappings once
  const mappings = (await DbService.repository.fieldMappings.findMany(
    eq(fieldMappings.connectorEntityId, connectorEntityId),
    { include: ["columnDefinition"] }
  )) as any[];

  const factory = new EntityRecordModelFactory();
  const now = Date.now();

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let invalid = 0;
  let rowIndex = 0;
  let totalProcessed = 0;

  const pending: PendingRow[] = [];

  async function flushBatch(): Promise<void> {
    if (pending.length === 0) return;

    // Look up existing records for change detection (per-batch keeps memory bounded)
    const sourceIds = pending.map((p) => p.sourceId);
    const existing = await DbService.repository.entityRecords.findBySourceIds(
      connectorEntityId,
      sourceIds
    );
    const existingMap = new Map(
      (
        existing as Array<{ sourceId: string; checksum: string; id: string }>
      ).map((r) => [r.sourceId, r])
    );

    const toUpsert: unknown[] = [];
    for (const p of pending) {
      const prev = existingMap.get(p.sourceId);
      if (prev && prev.checksum === p.checksum) {
        unchanged++;
        continue;
      }

      if (prev) updated++;
      else created++;

      const model = factory.create(userId);
      model.update({
        id: prev?.id ?? model.toJSON().id,
        organizationId,
        connectorEntityId,
        data: p.data,
        normalizedData: p.normalizedData,
        sourceId: p.sourceId,
        checksum: p.checksum,
        syncedAt: now,
        origin: "sync",
        validationErrors: p.validationErrors,
        isValid: p.isValid,
        updated: prev ? now : null,
        updatedBy: prev ? userId : null,
      });
      toUpsert.push(model.parse());
    }

    if (toUpsert.length > 0) {
      await DbService.repository.entityRecords.upsertManyBySourceId(
        toUpsert as any
      );
    }

    totalProcessed += pending.length;
    pending.length = 0;
  }

  // 2. Consume rows, normalize, batch
  for await (const row of rows) {
    const sourceId = String(rowIndex++);

    try {
      // Raw data: pass through keys as-is
      const data: Record<string, unknown> = { ...row };

      const { normalizedData, validationErrors, isValid } =
        NormalizationService.normalizeWithMappings(mappings, data);

      if (!isValid) invalid++;

      pending.push({
        sourceId,
        data,
        normalizedData,
        validationErrors,
        isValid,
        checksum: computeChecksum(data),
      });

      if (pending.length >= BATCH_SIZE) {
        await flushBatch();
      }
    } catch (err) {
      invalid++;
      logger.warn(
        { sourceId, error: err instanceof Error ? err.message : String(err) },
        "Skipping row due to unexpected processing error"
      );
    }
  }

  // 3. Flush any remaining partial batch
  await flushBatch();

  if (invalid > 0) {
    logger.warn(
      { connectorEntityId, invalid, total: totalProcessed },
      "Record import completed with validation errors"
    );
  }

  logger.info(
    {
      connectorEntityId,
      created,
      updated,
      unchanged,
      invalid,
      total: totalProcessed,
    },
    "Record import completed"
  );

  return { created, updated, unchanged, invalid };
}
