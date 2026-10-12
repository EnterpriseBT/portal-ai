import { eq } from "drizzle-orm";

import type { RevalidationResult } from "@portalai/core/models";

import type { TypedJobProcessor } from "../jobs.worker.js";
import { DbService } from "../../services/db.service.js";
import { NormalizationService } from "../../services/normalization.service.js";
import { fieldMappings } from "../../db/schema/index.js";
import { createLogger } from "../../utils/logger.util.js";
import { EntityRecordCountCache } from "../../services/entity-record-count.cache.js";

const logger = createLogger({ module: "revalidation-processor" });

/** Batch size for updating records to avoid memory spikes. */
const BATCH_SIZE = 100;

export const revalidationProcessor: TypedJobProcessor<"revalidation"> = async (
  bullJob
) => {
  const { jobId, connectorEntityId } = bullJob.data;

  logger.info({ jobId, connectorEntityId }, "Revalidation started");

  // 1. Fetch all field mappings for the entity (with column definitions)
  const mappings = await DbService.repository.fieldMappings.findMany(
    eq(fieldMappings.connectorEntityId, connectorEntityId),
    { include: ["columnDefinition"] }
  );

  await bullJob.updateProgress(10);

  // 2. Fetch all records for the entity
  const records =
    await DbService.repository.entityRecords.findByConnectorEntityId(
      connectorEntityId
    );

  const total = records.length;
  logger.info(
    { jobId, connectorEntityId, total },
    "Fetched records for revalidation"
  );

  if (total === 0) {
    await bullJob.updateProgress(100);
    return { total: 0, valid: 0, invalid: 0, errors: [] };
  }

  await bullJob.updateProgress(20);

  // 3. Re-run normalization pipeline for each record
  let valid = 0;
  let invalid = 0;
  let geometryRejected = 0;
  const errorSummary: RevalidationResult["errors"] = [];

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const updates = batch.map((record) => {
      // `record.data` is the raw connector payload (always populated
      // by every write path). After Phase 2 slice 6 dropped the
      // `normalized_data` JSONB column, there's no legacy fallback —
      // an absent `data` field is a structured error per the spec.
      const rawData = (record.data ?? {}) as Record<string, unknown>;
      const result = NormalizationService.normalizeWithMappings(
        mappings as Parameters<
          typeof NormalizationService.normalizeWithMappings
        >[0],
        rawData
      );

      if (result.isValid) {
        valid++;
      } else {
        invalid++;
        if (result.validationErrors) {
          errorSummary.push({
            recordId: record.id,
            errors: result.validationErrors,
          });
        }
      }

      return {
        id: record.id,
        normalizedData: result.normalizedData,
        validationErrors: result.validationErrors,
        isValid: result.isValid,
      };
    });

    // Batch update records — write to both stores in one transaction
    // so the wide-table state remains coherent with the transactional
    // row's `is_valid` flag.
    await DbService.transaction(async (tx) => {
      // #764: one batched entity_records write per batch, not one per
      // record. (`normalized_data` is no longer a column: the normalized
      // values live in the wide table, written below.)
      await DbService.repository.entityRecords.bulkUpdateValidity(
        updates.map((u) => ({
          id: u.id,
          validationErrors: u.validationErrors,
          isValid: u.isValid,
        })),
        tx
      );
      // #761: one batched wide-table write per batch, not one per record.
      // #757: a geometry the audit refuses (one sync already skipped, say)
      // leaves that column as it is rather than failing the job.
      const refused = await DbService.repository.wideTable.updateMany(
        connectorEntityId,
        updates.map((u) => ({
          entityRecordId: u.id,
          normalizedData: u.normalizedData,
          isValid: u.isValid,
        })),
        tx,
        { onRejectedGeometry: "skip" }
      );
      geometryRejected += refused.length;
    });

    // Progress: 20-90 range spread across batches
    const progress = Math.round(20 + ((i + batch.length) / total) * 70);
    await bullJob.updateProgress(progress);
  }

  // #433: revalidation changes no row count, but it flips `is_valid` — and
  // `isValid` is part of the count-cache fingerprint, so the validity-filtered
  // totals move. One bump at the end covers the whole run.
  await EntityRecordCountCache.invalidate(connectorEntityId);

  logger.info(
    { jobId, connectorEntityId, total, valid, invalid },
    "Revalidation complete"
  );
  if (geometryRejected > 0) {
    // The same geometries the sync that wrote these records refused and
    // reported (#316); revalidation leaves them as they are.
    logger.warn(
      { jobId, connectorEntityId, geometryRejected },
      "Revalidation left refused geometries unchanged"
    );
  }

  const result: RevalidationResult = {
    total,
    valid,
    invalid,
    errors: errorSummary,
  };
  return result;
};
