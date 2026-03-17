/**
 * Job Events Service — manages job state transitions and real-time event distribution.
 *
 * Persists state changes to PostgreSQL and broadcasts events via Redis Pub/Sub
 * so that SSE clients can receive real-time updates.
 *
 * Uses a single shared Redis subscriber connection for all job event
 * subscriptions, with per-channel listener tracking. Channels are
 * automatically subscribed/unsubscribed as listeners are added/removed.
 */

import type { JobStatus } from "@portalai/core/models";
import type { JobUpdateEvent } from "@portalai/core/contracts";

import type { Redis } from "ioredis";

import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import { DbService } from "./db.service.js";

const logger = createLogger({ module: "job-events" });

const JOB_CHANNEL_PREFIX = "job:events:";

// ---------------------------------------------------------------------------
// Shared subscriber — one Redis connection for all job event subscriptions
// ---------------------------------------------------------------------------

type EventCallback = (event: JobUpdateEvent) => void;

let sharedSubscriber: Redis | null = null;
const channelListeners = new Map<string, Set<EventCallback>>();

function getSharedSubscriber(): Redis {
  if (!sharedSubscriber) {
    sharedSubscriber = getRedisClient().duplicate();
    sharedSubscriber.on("error", (err) => {
      logger.warn({ err }, "Shared Redis subscriber error");
    });
    sharedSubscriber.on("message", (channel: string, message: string) => {
      const listeners = channelListeners.get(channel);
      if (!listeners || listeners.size === 0) return;
      try {
        const event: JobUpdateEvent = JSON.parse(message);
        for (const cb of listeners) {
          cb(event);
        }
      } catch (err) {
        logger.error({ err, channel }, "Failed to parse job event");
      }
    });
  }
  return sharedSubscriber;
}

// ---------------------------------------------------------------------------

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
   * Publish a custom event (e.g. "recommendations") on the job channel.
   * Does NOT update job status or persist to DB — the payload is broadcast only.
   */
  static async publishCustomEvent(
    jobId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const event: JobUpdateEvent = {
      jobId,
      status: "active",
      progress: 0,
      timestamp: SystemUtilities.utc.now().getTime(),
      ...payload,
      _eventType: eventType,
    } as JobUpdateEvent & { _eventType: string };

    const redis = getRedisClient();
    await redis.publish(
      `${JOB_CHANNEL_PREFIX}${jobId}`,
      JSON.stringify(event)
    );
    logger.debug({ jobId, eventType }, "Custom job event published");
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
    const channel = `${JOB_CHANNEL_PREFIX}${jobId}`;
    const sub = getSharedSubscriber();

    // Track listener for this channel
    let listeners = channelListeners.get(channel);
    if (!listeners) {
      listeners = new Set();
      channelListeners.set(channel, listeners);
      sub.subscribe(channel);
    }
    listeners.add(onEvent);

    return () => {
      listeners!.delete(onEvent);
      if (listeners!.size === 0) {
        channelListeners.delete(channel);
        sub.unsubscribe(channel);
      }
    };
  }
}
