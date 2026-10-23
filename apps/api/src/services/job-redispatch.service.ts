import type { JobType } from "@portalai/core/models";

import type { JobSelect } from "../db/schema/zod.js";
import { getJobsQueue } from "../queues/jobs.queue.js";
import { createLogger } from "../utils/logger.util.js";
import { DbService } from "./db.service.js";
import { JobsService } from "./jobs.service.js";
import {
  REDISPATCH_LOCK_NAMESPACE,
  SyncLockService,
  type SyncLockOutcome,
} from "./sync-lock.service.js";

const logger = createLogger({ module: "job-redispatch" });

/** The constant subject id for the singleton re-dispatch lock. */
export const REDISPATCH_LOCK_KEY = "jobs-redispatch";

export type RedispatchCursor = { created: number; id: string };

export interface RedispatchSummary {
  /** false ⇒ another pass held the lock; nothing ran. */
  acquiredLock: boolean;
  scanned: number;
  redispatched: {
    id: string;
    type: JobType;
    priorStatus: "pending" | "active" | "stalled";
  }[];
  /** Still live in the current queue (under its row id or its legacy id). */
  present: number;
  /** Went terminal between the read and the flip; never re-added. */
  skippedTerminal: number;
  dryRun: boolean;
}

/** A queued job as far as re-dispatch cares: whose row it belongs to, and
 *  whether BullMQ will still run it. */
export interface QueuedJob {
  data: { jobId?: unknown };
  getState: () => Promise<string>;
  remove: () => Promise<void>;
}

/**
 * The pass's side effects, injectable so the ordering and every abort path
 * are unit-testable (the same shape as `db-upgrade`'s `UpgradeSteps`).
 */
export interface RedispatchDeps {
  findCandidates: (
    cursor: RedispatchCursor | null,
    limit: number
  ) => Promise<JobSelect[]>;
  getQueuedJob: (bullJobId: string) => Promise<QueuedJob | undefined>;
  markRedispatched: (id: string) => Promise<boolean>;
  add: (row: JobSelect) => Promise<void>;
  withLock: <T>(fn: () => Promise<T>) => Promise<SyncLockOutcome<T>>;
}

/** BullMQ states in which an entry will still run. `completed` and `failed`
 *  entries linger for days (removeOnComplete/removeOnFail) but never run. */
const LIVE_STATES = new Set([
  "waiting",
  "delayed",
  "active",
  "prioritized",
  "waiting-children",
]);

/**
 * Put every non-terminal `jobs` row whose BullMQ entry is gone back on the
 * queue (#852). Run deliberately, by an operator, after a Redis replacement
 * (`portalops jobs redispatch`), with the API scaled to zero so no worker
 * races it, and **before** the API boots against the new Redis: the boot
 * reconciliation sweep (#391) would otherwise reap the queued rows as
 * stranded.
 *
 * Each row without a live entry is flipped first (`bullJobId = id` while
 * non-terminal), then added under its row id. The flip is the guard that
 * keeps a row cancelled or reaped meanwhile from being revived; the worker
 * also skips any entry whose row is terminal, so a stale entry left on the
 * other Redis after a rollback can't re-run finished work. An add failure
 * aborts; the flipped row is still absent from the queue, so the next run
 * picks it up, and a duplicate add is a no-op BullMQ ignores. An interrupted
 * `active` row resumes through the worker's own re-delivery path (#464
 * `lost_executions`).
 */
export class JobRedispatchService {
  static readonly PAGE_SIZE = 200;

  static readonly DEFAULT_DEPS: RedispatchDeps = {
    findCandidates: (cursor, limit) =>
      DbService.repository.jobs.findRedispatchCandidates(cursor, limit),
    getQueuedJob: async (bullJobId) =>
      (await getJobsQueue().getJob(bullJobId)) ?? undefined,
    markRedispatched: (id) => DbService.repository.jobs.markRedispatched(id),
    add: async (row) => {
      // What the row has left of its budget: a sync that spent 2 of 3
      // attempts on the old queue gets 1 more, not a fresh 3 (#852 review).
      const spent = Math.min(row.attempts ?? 0, row.maxAttempts - 1);
      await getJobsQueue().add(
        row.type,
        JobsService.queuePayload(row, { attemptOffset: spent }),
        JobsService.queueOptions(row, row.maxAttempts - spent)
      );
    },
    withLock: (fn) =>
      SyncLockService.withAdvisoryLock(
        REDISPATCH_LOCK_NAMESPACE,
        REDISPATCH_LOCK_KEY,
        fn,
        { event: "jobs-redispatch.lock", subject: "redispatch" }
      ),
  };

  /**
   * Whether the row's job will still run from the current queue. Looked up
   * under the row id (every dispatch since #852) and under its stored legacy
   * id (BullMQ's own counter, before #852). A legacy id is a per-Redis
   * counter, so a hit only counts when the job it names is this row's; and
   * only a live entry counts, since a `completed`/`failed` one never runs
   * again even though the row says otherwise. A finished entry under the row
   * id is removed so the re-add isn't ignored as a duplicate.
   */
  private static async isQueued(
    row: JobSelect,
    deps: RedispatchDeps,
    dryRun: boolean
  ): Promise<boolean> {
    const ids = [row.id];
    if (row.bullJobId && row.bullJobId !== row.id) ids.push(row.bullJobId);
    for (const id of ids) {
      // A throw propagates: absence must be observed, never assumed.
      const queued = await deps.getQueuedJob(id);
      if (queued?.data.jobId !== row.id) continue;
      if (LIVE_STATES.has(await queued.getState())) return true;
      if (id === row.id && !dryRun) await queued.remove();
    }
    return false;
  }

  static async redispatchOrphans(
    opts: { dryRun: boolean },
    deps: RedispatchDeps = JobRedispatchService.DEFAULT_DEPS
  ): Promise<RedispatchSummary> {
    const summary: RedispatchSummary = {
      acquiredLock: true,
      scanned: 0,
      redispatched: [],
      present: 0,
      skippedTerminal: 0,
      dryRun: opts.dryRun,
    };

    const outcome = await deps.withLock(async () => {
      let cursor: RedispatchCursor | null = null;
      for (;;) {
        const page = await deps.findCandidates(
          cursor,
          JobRedispatchService.PAGE_SIZE
        );
        for (const row of page) {
          summary.scanned++;
          if (await JobRedispatchService.isQueued(row, deps, opts.dryRun)) {
            summary.present++;
            continue;
          }
          const entry = {
            id: row.id,
            type: row.type,
            priorStatus: row.status as "pending" | "active" | "stalled",
          };
          if (opts.dryRun) {
            summary.redispatched.push(entry);
            continue;
          }
          if (!(await deps.markRedispatched(row.id))) {
            summary.skippedTerminal++;
            continue;
          }
          await deps.add(row);
          summary.redispatched.push(entry);
        }
        if (page.length < JobRedispatchService.PAGE_SIZE) break;
        const last = page[page.length - 1]!;
        cursor = { created: last.created, id: last.id };
      }
    });

    if (!outcome.acquired) {
      logger.warn("REDISPATCH SKIPPED: another pass is already running");
      return { ...summary, acquiredLock: false };
    }
    logger.info(
      {
        scanned: summary.scanned,
        redispatched: summary.redispatched.length,
        present: summary.present,
        skippedTerminal: summary.skippedTerminal,
        dryRun: summary.dryRun,
      },
      "REDISPATCH COMPLETE"
    );
    return summary;
  }
}
