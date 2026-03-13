/**
 * Job Events Service — manages job state transitions and real-time event distribution.
 *
 * Stub: Full implementation in Step 5 (Event Service).
 * This provides the interface so the queue layer can compile.
 */

import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "job-events" });

export interface JobEvent {
  jobId: string;
  status: string;
  progress: number;
  error?: string | null;
  result?: Record<string, unknown> | null;
  timestamp: number;
}

export class JobEventsService {
  /** Update job row in PostgreSQL AND publish event to Redis. */
  static async transition(
    jobId: string,
    status: string,
    patch: Partial<{
      progress: number;
      error: string;
      result: Record<string, unknown>;
    }> = {}
  ): Promise<void> {
    // TODO: Step 5 — persist to PostgreSQL + publish to Redis Pub/Sub
    logger.info({ jobId, status, ...patch }, "Job transition (stub)");
  }

  /** Update progress without a status transition. */
  static async updateProgress(
    jobId: string,
    progress: number
  ): Promise<void> {
    // TODO: Step 5 — persist progress + publish to Redis Pub/Sub
    logger.debug({ jobId, progress }, "Job progress update (stub)");
  }

  /** Subscribe to events for a specific job. Returns a cleanup function. */
  static subscribe(
    _jobId: string,
    _onEvent: (event: JobEvent) => void
  ): () => void {
    // TODO: Step 5 — Redis Pub/Sub subscription
    return () => {};
  }
}
