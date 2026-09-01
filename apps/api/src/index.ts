import { app } from "./app.js";
import { environment } from "./environment.js";
import { connectDatabase, closeDatabase } from "./db/index.js";
import { logger } from "./utils/logger.util.js";
import { closeRedis } from "./utils/redis.util.js";
import { gracefulShutdown } from "./utils/shutdown.util.js";
import { closeJobsQueue } from "./queues/jobs.queue.js";
import { createJobsWorker } from "./queues/jobs.worker.js";
import {
  closeMaintenanceQueue,
  registerMaintenanceSchedulers,
} from "./queues/maintenance.queue.js";
import { createMaintenanceWorker } from "./queues/maintenance.worker.js";
import { processors } from "./queues/processors/index.js";
import { FileUploadSessionService } from "./services/file-upload-session.service.js";
import { JobReconciliationService } from "./services/job-reconciliation.service.js";
import { wideTableReconcilerService } from "./services/wide-table-reconciler.service.js";
import { ApiCode } from "./constants/api-codes.constants.js";

const jobsWorker = createJobsWorker(processors);
const maintenanceWorker = createMaintenanceWorker();

// #391: an unhandled promise rejection crashes Node by default, and the
// job pipeline has legitimate fire-and-forget promises (e.g.
// `void bullJob.updateProgress(...)`) that reject when a job's Redis keys
// vanish mid-run (measured: `Missing key for job N. updateProgress` after a
// FLUSHALL took the whole API down WITH the executions it stranded —
// bypassing every worker/queue "error" handler, because a rejection is not
// an EventEmitter event). Log loudly and stay up: one job's async noise
// must not become a full multi-tenant outage, and the reconciliation sweep
// repairs the job rows. `uncaughtException` deliberately keeps Node's
// default crash — a synchronous escape means unknown process state, and
// the orchestrator restart + boot sweep is the designed recovery there.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection (staying up)");
});

async function start() {
  await connectDatabase();

  // Wide-table boot drift check — guarantees every live connector_entity
  // has a correctly-shaped `er__<id>` table before the HTTP listener
  // accepts traffic. Throws on the first unfixable drift; we exit non-
  // zero so the operator sees the failure immediately.
  logger.info("Starting wide-table boot drift check…");
  try {
    const result = await wideTableReconcilerService.reconcileAll();
    logger.info({ ...result }, "Wide-table boot drift check complete");
  } catch (err) {
    logger.fatal(
      { err, code: ApiCode.WIDE_TABLE_DRIFT_AT_BOOT },
      "Wide-table boot drift check failed — refusing to start"
    );
    process.exit(1);
  }

  const server = app.listen(environment.PORT, () => {
    logger.info(
      {
        port: environment.PORT,
        env: environment.NODE_ENV,
      },
      "API server started"
    );
  });

  // Maintenance schedulers (#179 D5) — upsert-by-id, so multi-instance
  // boots are idempotent. A registration failure degrades to "no purge
  // until next boot", never a refused start.
  registerMaintenanceSchedulers()
    .then(() => logger.info("Maintenance schedulers registered"))
    .catch((err) => {
      logger.warn({ err }, "Failed to register maintenance schedulers");
    });

  // Fire-and-forget sweep of stale upload rows — the S3 bucket lifecycle
  // rule is the durability guarantee; this is a UI-visible cleanup so
  // admin views stay clean.
  FileUploadSessionService.sweepStaleUploads()
    .then(({ swept }) => {
      if (swept > 0) {
        logger.info({ swept }, "Stale file_uploads swept at startup");
      }
    })
    .catch((err) => {
      logger.warn({ err }, "Startup file_uploads sweep failed");
    });

  // Stranded-job reconciliation (#391): once at boot (covers "Redis died,
  // then we deployed"), then every interval tick (covers a mid-life loss —
  // deliberately an in-process timer, NOT a maintenance-queue job, because
  // the repeatable scheduler lives in the very keyspace whose loss this
  // repairs). Fail-open: a failed pass degrades to today's behavior.
  // Multi-instance safety comes from the guarded transition, not
  // coordination.
  JobReconciliationService.sweepStrandedJobs()
    .then((summary) => {
      if (summary.reaped > 0 || summary.skipped > 0) {
        logger.warn({ ...summary }, "Startup stranded-job sweep reaped jobs");
      } else {
        logger.info({ ...summary }, "Startup stranded-job sweep clean");
      }
    })
    .catch((err) => {
      logger.warn({ err }, "Startup stranded-job sweep failed");
    });
  setInterval(() => {
    JobReconciliationService.sweepStrandedJobs().catch((err) => {
      logger.warn({ err }, "Periodic stranded-job sweep failed");
    });
  }, environment.JOB_STRANDED_SWEEP_INTERVAL_MS).unref();

  return server;
}

const serverPromise = start().catch((err) => {
  logger.fatal(err, "Failed to start server");
  process.exit(1);
});

// Graceful shutdown
async function shutdown() {
  const server = await serverPromise;
  await gracefulShutdown({
    server: server || undefined,
    closeWorker: async () => {
      await Promise.all([jobsWorker.close(), maintenanceWorker.close()]);
    },
    closeQueue: async () => {
      await Promise.all([closeJobsQueue(), closeMaintenanceQueue()]);
    },
    closeRedis,
    closeDatabase,
  });
  process.exit(server ? 0 : 1);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
