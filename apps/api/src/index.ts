import { app } from "./app.js";
import { environment } from "./environment.js";
import { connectDatabase, closeDatabase } from "./db/index.js";
import { logger } from "./utils/logger.util.js";
import { closeRedis } from "./utils/redis.util.js";
import { gracefulShutdown } from "./utils/shutdown.util.js";
import { jobsQueue } from "./queues/jobs.queue.js";
import { createJobsWorker } from "./queues/jobs.worker.js";
import { processors } from "./queues/processors/index.js";
import { FileUploadSessionService } from "./services/file-upload-session.service.js";

const jobsWorker = createJobsWorker(processors);

async function start() {
  await connectDatabase();

  const server = app.listen(environment.PORT, () => {
    logger.info(
      {
        port: environment.PORT,
        env: environment.NODE_ENV,
      },
      "API server started"
    );
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
    closeWorker: () => jobsWorker.close(),
    closeQueue: () => jobsQueue.close(),
    closeRedis,
    closeDatabase,
  });
  process.exit(server ? 0 : 1);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
