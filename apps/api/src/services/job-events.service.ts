/**
 * Job Events Service — manages job state transitions and real-time event distribution.
 *
 * Persists state changes to PostgreSQL and broadcasts events via Redis Pub/Sub
 * so that SSE clients can receive real-time updates.
 */

import type { JobStatus } from "@mcp-ui/core/models";
import type { JobUpdateEvent } from "@mcp-ui/core/contracts";

import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import { DbService } from "./db.service.js";

const logger = createLogger({ module: "job-events" });

const JOB_CHANNEL_PREFIX = "job:events:";

export class JobEventsService {
  /**
   * Update job row in PostgreSQL AND publish event to Redis.
   */
  static async transition(
    jobId: string,
    status: JobStatus,
    patch: Partial<{
      progress: number;
      error: string;
      result: Record<string, unknown>;
    }> = {}
  ): Promise<void> {
    const now = SystemUtilities.utc.now().getTime();
    const dbPatch: Record<string, unknown> = {
      status,
      updated: now,
      ...patch,
    };
    if (status === "active") dbPatch.startedAt = now;
    if (status === "completed" || status === "failed") dbPatch.completedAt = now;

    // Persist to PostgreSQL
    await DbService.repository.jobs.update(jobId, dbPatch);

    // Broadcast via Redis Pub/Sub
    const event: JobUpdateEvent = {
      jobId,
      status,
      progress: patch.progress ?? 0,
      error: patch.error ?? null,
      result: patch.result ?? null,
      timestamp: now,
    };
    const redis = getRedisClient();
    await redis.publish(
      `${JOB_CHANNEL_PREFIX}${jobId}`,
      JSON.stringify(event)
    );
    logger.debug({ jobId, status }, "Job event published");
  }

  /**
   * Update progress without a status transition.
   */
  static async updateProgress(
    jobId: string,
    progress: number
  ): Promise<void> {
    const now = SystemUtilities.utc.now().getTime();
    await DbService.repository.jobs.update(jobId, {
      progress,
      updated: now,
    });

    const event: JobUpdateEvent = {
      jobId,
      status: "active",
      progress,
      timestamp: now,
    };
    const redis = getRedisClient();
    await redis.publish(
      `${JOB_CHANNEL_PREFIX}${jobId}`,
      JSON.stringify(event)
    );
  }

  /**
   * Subscribe to events for a specific job.
   * Returns a cleanup function.
   */
  static subscribe(
    jobId: string,
    onEvent: (event: JobUpdateEvent) => void
  ): () => void {
    // Dedicated subscriber connection (required by Redis for pub/sub)
    const subscriber = getRedisClient().duplicate();
    const channel = `${JOB_CHANNEL_PREFIX}${jobId}`;

    subscriber.subscribe(channel);
    subscriber.on("message", (_ch: string, message: string) => {
      try {
        onEvent(JSON.parse(message));
      } catch (err) {
        logger.error({ err, jobId }, "Failed to parse job event");
      }
    });

    return () => {
      subscriber.unsubscribe(channel);
      subscriber.disconnect();
    };
  }
}
