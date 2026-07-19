import { Queue } from "bullmq";

import { environment } from "../environment.js";

/**
 * Maintenance queue (#179 D5) — internal repeatable housekeeping jobs.
 *
 * Deliberately OFF the user-facing `jobs` table machinery: no jobs row,
 * no SSE, no entity locks. Operator visibility comes from
 * `GET /api/admin/maintenance` (BullMQ state) + structured pino logs.
 */
export const MAINTENANCE_QUEUE_NAME = "maintenance";

/** Job name AND scheduler id for the daily ledger retention purge —
 *  one exported const shared by the processor, the boot registration,
 *  and the admin read. */
export const LEDGER_RETENTION_PURGE_JOB = "ledger-retention-purge";

let _maintenanceQueue: Queue | null = null;

/**
 * Lazily construct the maintenance queue. Same rationale as the jobs queue:
 * `new Queue()` eagerly opens an ioredis connection, so constructing at module
 * load turned an import into a live Redis socket and hung Jest via ioredis's
 * reconnect timer when no Redis was present (#220). Deferring to first use
 * keeps imports side-effect-free.
 */
export const getMaintenanceQueue = (): Queue => {
  if (!_maintenanceQueue) {
    _maintenanceQueue = new Queue(MAINTENANCE_QUEUE_NAME, {
      connection: {
        url: environment.REDIS_URL,
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: {
        // Keep enough history for the admin read's "recent runs" without
        // unbounded Redis growth.
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 30 },
      },
    });
  }
  return _maintenanceQueue;
};

/** Close the queue's Redis connection, but only if it was ever constructed. */
export const closeMaintenanceQueue = async (): Promise<void> => {
  if (_maintenanceQueue) {
    await _maintenanceQueue.close();
    _maintenanceQueue = null;
  }
};

/**
 * Register the repeatable maintenance schedulers. `upsertJobScheduler`
 * is idempotent by scheduler id, so multi-instance / repeated boots
 * never produce duplicate schedulers.
 */
export const registerMaintenanceSchedulers = async (): Promise<void> => {
  await getMaintenanceQueue().upsertJobScheduler(
    LEDGER_RETENTION_PURGE_JOB,
    { pattern: "0 4 * * *" }, // daily 04:00 UTC
    { name: LEDGER_RETENTION_PURGE_JOB }
  );
};
