import { eq } from "drizzle-orm";

import type { RevalidationResult } from "@portalai/core/models";

import type { TypedJobProcessor } from "../jobs.worker.js";
import { DbService } from "../../services/db.service.js";
import { NormalizationService } from "../../services/normalization.service.js";
import { fieldMappings } from "../../db/schema/index.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "revalidation-processor" });

/** Batch size for updating records to avoid memory spikes. */
const BATCH_SIZE = 100;

export const revalidationProcessor: TypedJobProcessor<"revalidation"> = async (bullJob) => {
  const { jobId, connectorEntityId } = bullJob.data;

  logger.info({ jobId, connectorEntityId }, "Revalidation started");

  // 1. Fetch all field mappings for the entity (with column definitions)
  const mappings = await DbService.repository.fieldMappings.findMany(
    eq(fieldMappings.connectorEntityId, connectorEntityId),
    { include: ["columnDefinition"] },
  );

  await bullJob.updateProgress(10);

  // 2. Fetch all records for the entity
  const records = await DbService.repository.entityRecords.findByConnectorEntityId(
    connectorEntityId,
  );

  const total = records.length;
  logger.info({ jobId, connectorEntityId, total }, "Fetched records for revalidation");

  if (total === 0) {
    await bullJob.updateProgress(100);
    return { total: 0, valid: 0, invalid: 0, errors: [] };
  }

  await bullJob.updateProgress(20);

  // 3. Re-run normalization pipeline for each record
  let valid = 0;
  let invalid = 0;
  const errorSummary: RevalidationResult["errors"] = [];

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const updates = batch.map((record) => {
      const rawData = (record.data ?? record.normalizedData ?? {}) as Record<string, unknown>;
      const result = NormalizationService.normalizeWithMappings(
        mappings as Parameters<typeof NormalizationService.normalizeWithMappings>[0],
        rawData,
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

    // Batch update records
    await Promise.all(
      updates.map((u) =>
        DbService.repository.entityRecords.update(u.id, {
          normalizedData: u.normalizedData,
          validationErrors: u.validationErrors,
          isValid: u.isValid,
        } as never),
      ),
    );

    // Progress: 20-90 range spread across batches
    const progress = Math.round(20 + ((i + batch.length) / total) * 70);
    await bullJob.updateProgress(progress);
  }

  logger.info(
    { jobId, connectorEntityId, total, valid, invalid },
    "Revalidation complete",
  );

  const result: RevalidationResult = { total, valid, invalid, errors: errorSummary };
  return result;
};
