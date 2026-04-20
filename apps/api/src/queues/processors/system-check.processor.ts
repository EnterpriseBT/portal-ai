import type { TypedJobProcessor } from "../jobs.worker.js";

import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "system-check-processor" });

const TOTAL_DURATION_MS = 10_000;
const TICK_INTERVAL_MS = 1_000;
const TOTAL_TICKS = TOTAL_DURATION_MS / TICK_INTERVAL_MS;

/**
 * System check processor — a lightweight diagnostic job for testing
 * the async jobs pipeline end-to-end.
 *
 * Runs a 10-second timer, updating progress every second (10% per tick).
 * Returns a summary of the check upon completion.
 */
export const systemCheckProcessor: TypedJobProcessor<"system_check"> = async (
  bullJob
) => {
  const { jobId } = bullJob.data;
  logger.info({ jobId }, "System check started");

  for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
    const progress = Math.round((tick / TOTAL_TICKS) * 100);
    await bullJob.updateProgress(progress);
    logger.debug({ jobId, progress }, "System check progress");
  }

  logger.info({ jobId }, "System check completed");

  return {
    status: "healthy",
    checks: {
      database: "ok",
      redis: "ok",
      queue: "ok",
    },
    durationMs: TOTAL_DURATION_MS,
  };
};
