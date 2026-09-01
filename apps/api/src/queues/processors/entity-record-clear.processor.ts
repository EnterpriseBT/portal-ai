import type { TypedJobProcessor } from "../jobs.worker.js";
import { DbService } from "../../services/db.service.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "entity-record-clear-processor" });

/**
 * Processor for `entity_record_clear` jobs (#453).
 *
 * Soft-deletes every record of one connector entity plus its `er__<id>`
 * wide-table mirror, inside one transaction — the body the clear route
 * ran inline before #453 moved it off-request (a 400K-row clear measured
 * 66s; 1.5M-row entities are a real target). The route's guards (write
 * capability, instance job lock, revalidation) run before enqueue, and
 * the job's `JOB_LOCK_KEYS` entry locks the whole connector instance
 * while this runs, so a resync cannot race the clear.
 *
 * Deliberately NO `SyncLockService` advisory lock (#460/#461): those
 * exist for watermark reaps, where a second pass of one job deletes the
 * first pass's in-flight writes. A clear deletes *everything* — a stall
 * re-delivered second pass double-soft-deletes idempotently and reports
 * `deleted: 0`, which is correct.
 */
export const entityRecordClearProcessor: TypedJobProcessor<
  "entity_record_clear"
> = async (bullJob) => {
  const {
    jobId,
    connectorEntityId,
    connectorInstanceId,
    organizationId,
    userId,
  } = bullJob.data;

  logger.info(
    { jobId, connectorEntityId, connectorInstanceId, organizationId },
    "entity_record_clear started"
  );

  const deleted = await DbService.transaction(async (tx) => {
    // #451: soft-delete by `connector_entity_id` — no id list materialised;
    // the driver returns the affected count directly.
    const count =
      await DbService.repository.entityRecords.softDeleteByConnectorEntityId(
        connectorEntityId,
        userId,
        tx
      );
    if (count === 0) return 0;
    // #450/#451: tombstone the wide rows in the SAME tx via a server-side
    // join — a crash between the two writes must never leave live wide rows
    // pointing at dead records.
    await DbService.repository.wideTable.markDeletedByConnectorEntity(
      connectorEntityId,
      tx
    );
    return count;
  });

  logger.info(
    { jobId, connectorEntityId, deleted },
    "entity_record_clear completed"
  );

  return { deleted };
};
