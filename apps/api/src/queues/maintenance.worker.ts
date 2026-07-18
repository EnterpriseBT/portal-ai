import { Worker } from "bullmq";

import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";
import {
  LEDGER_RETENTION_PURGE_JOB,
  MAINTENANCE_QUEUE_NAME,
} from "./maintenance.queue.js";
import { ledgerRetentionPurgeProcessor } from "./processors/ledger-retention-purge.processor.js";

const logger = createLogger({ module: "maintenance-worker" });

/**
 * Dedicated tiny worker for the maintenance queue (#179 D5) —
 * deliberately NOT the jobs-table wrapper (no job row, no SSE, no
 * entity locks). The BullMQ return value is the run's summary,
 * surfaced by `GET /api/admin/maintenance`.
 */
export const createMaintenanceWorker = (): Worker => {
  const worker = new Worker(
    MAINTENANCE_QUEUE_NAME,
    async (job) => {
      if (job.name === LEDGER_RETENTION_PURGE_JOB) {
        return ledgerRetentionPurgeProcessor();
      }
      throw new Error(`Unknown maintenance job: ${job.name}`);
    },
    {
      connection: {
        url: environment.REDIS_URL,
        maxRetriesPerRequest: null,
      },
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({ name: job?.name, err }, "Maintenance job failed");
  });
  worker.on("completed", (job) => {
    logger.info(
      { name: job.name, returnvalue: job.returnvalue },
      "Maintenance job completed"
    );
  });

  return worker;
};
