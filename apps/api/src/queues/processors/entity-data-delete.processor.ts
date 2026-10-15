import { UnrecoverableError } from "bullmq";
import { and, inArray, isNotNull } from "drizzle-orm";

import { EntityDataDeleteMetadataSchema } from "@portalai/core/models";

import type { TypedJobProcessor } from "../jobs.worker.js";
import { DbService } from "../../services/db.service.js";
import { wideTableReconcilerService } from "../../services/wide-table-reconciler.service.js";
import { connectorEntities } from "../../db/schema/index.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "entity-data-delete-processor" });

/** Records soft-deleted per statement — bounds each statement's row locks. */
export const ENTITY_DATA_DELETE_BATCH_SIZE = 10_000;

/**
 * Processor for `entity_data_delete` jobs (#802).
 *
 * For each entity the delete already tombstoned: drop its `er__<id>` wide
 * table (`DROP TABLE IF EXISTS`, which also clears its catalog rows and cached
 * statement), then soft-delete its records batch by batch until none are
 * left.
 *
 * Only soft-deleted entities are touched — an id that resolves to a live
 * entity is skipped and logged, never deleted. That makes the job safe to
 * re-run: a stall re-delivered second pass finds no live records and no wide
 * table and reports zeros, so no `SyncLockService` lock is needed (the same
 * reasoning as `entity_record_clear`).
 */
export const entityDataDeleteProcessor: TypedJobProcessor<
  "entity_data_delete"
> = async (bullJob) => {
  const parsed = EntityDataDeleteMetadataSchema.safeParse(bullJob.data);
  if (!parsed.success) {
    throw new UnrecoverableError(
      "entity_data_delete: metadata is missing its organization, user or entities"
    );
  }
  const { organizationId, userId, connectorEntityIds } = parsed.data;

  const tombstoned = new Set(
    (
      await DbService.repository.connectorEntities.findMany(
        and(
          inArray(connectorEntities.id, connectorEntityIds),
          isNotNull(connectorEntities.deleted)
        ),
        { includeDeleted: true, organizationId }
      )
    ).map((e) => e.id)
  );
  for (const id of connectorEntityIds) {
    if (!tombstoned.has(id)) {
      logger.warn(
        { jobId: bullJob.data.jobId, connectorEntityId: id },
        "entity_data_delete: entity is not soft-deleted; skipping it"
      );
    }
  }

  let recordsDeleted = 0;
  let wideTablesDropped = 0;
  let done = 0;
  for (const connectorEntityId of tombstoned) {
    if (await DbService.repository.wideTable.tableExists(connectorEntityId)) {
      await wideTableReconcilerService.dropTable(connectorEntityId);
      wideTablesDropped += 1;
    }
    for (;;) {
      const deleted =
        await DbService.repository.entityRecords.softDeleteBatchByConnectorEntityId(
          connectorEntityId,
          userId,
          ENTITY_DATA_DELETE_BATCH_SIZE
        );
      if (deleted === 0) break;
      recordsDeleted += deleted;
    }
    done += 1;
    await bullJob.updateProgress(Math.round((done / tombstoned.size) * 100));
  }

  logger.info(
    {
      jobId: bullJob.data.jobId,
      organizationId,
      entities: tombstoned.size,
      recordsDeleted,
      wideTablesDropped,
    },
    "entity_data_delete completed"
  );
  return { recordsDeleted, wideTablesDropped };
};
