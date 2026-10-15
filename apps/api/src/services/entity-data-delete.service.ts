/**
 * The off-request half of an entity or connector delete (#802).
 *
 * The delete tombstones everything user-visible in its own transaction —
 * the entity, its mappings, tags, group memberships and views — and inserts
 * an `entity_data_delete` job row in that same transaction. After it commits,
 * the caller dispatches the job, which soft-deletes the records and drops the
 * wide tables: at 400K+ records that work outlasted the request.
 *
 * The row is written in the delete's transaction (so the job exists exactly
 * when the delete does) but queued after commit (so the worker never runs
 * against an uncommitted tombstone). `JobLockService.enqueueExclusive` can't
 * do that — it opens its own transaction — and isn't needed: the job locks no
 * scopes (`JOB_LOCK_SCOPES.entity_data_delete`).
 */

import type { EntityDataDeleteMetadata } from "@portalai/core/models";

import { JobsService } from "./jobs.service.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import type { JobSelect } from "../db/schema/zod.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "entity-data-delete" });

export class EntityDataDeleteService {
  /** Insert the job row on the delete's transaction; dispatch it after. */
  static async insertJob(
    metadata: EntityDataDeleteMetadata,
    tx: DbClient
  ): Promise<JobSelect> {
    return (await JobsService.insertRow(
      metadata.userId,
      {
        type: "entity_data_delete",
        organizationId: metadata.organizationId,
        metadata,
      },
      tx
    )) as JobSelect;
  }

  /**
   * Queue a committed job. Never throws: the delete it follows has already
   * committed, so a failure here is logged, not surfaced. The records it
   * would have removed are unreachable (every read is entity-scoped), and the
   * retention purge's stranded scope reclaims them.
   */
  static async dispatch(job: JobSelect): Promise<void> {
    try {
      await JobsService.dispatch(job);
    } catch (error) {
      logger.error(
        {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "entity_data_delete dispatch failed; the retention purge will reclaim the records"
      );
    }
  }
}
