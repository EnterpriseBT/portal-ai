import { TERMINAL_JOB_STATUSES } from "@portalai/core/models";
import type { JobStatus } from "@portalai/core/models";
import type { JobUpdateEvent } from "@portalai/core/contracts";

import { DbService } from "../services/db.service.js";
import { JobsService } from "../services/jobs.service.js";
import { JobEventsService } from "../services/job-events.service.js";

/** How often the await falls back to reading the job row, covering the
 *  subscribe race (job finished before we subscribed) or a missed
 *  publish. The processor's `statement_timeout` bounds the total wait
 *  regardless. */
export const TERMINAL_POLL_INTERVAL_MS = 1_000;

export interface TerminalOutcome {
  status: JobStatus;
  result: Record<string, unknown> | null;
  error: string | null;
}

/**
 * Resolve when the job reaches a terminal status. Subscribes to the
 * job-events Redis channel (the established convention) and falls back
 * to polling the job row. If `signal` aborts (the agent turn is
 * cancelled), the job is cancelled via the same `JobsService.cancel`
 * path the write tools use — keeping cancel consistent across job types.
 *
 * Shared by the job-tier tools that await their terminal envelope inline
 * (`sql_query` at job mode — #130 E1b).
 */
export function awaitJobTerminal(
  jobId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<TerminalOutcome> {
  return new Promise<TerminalOutcome>((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => {};
    let poll: ReturnType<typeof setInterval> | undefined;

    const onAbort = () => {
      void JobsService.cancel(jobId).catch(() => undefined);
    };

    const finish = (outcome: TerminalOutcome) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (poll) clearInterval(poll);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    unsubscribe = JobEventsService.subscribe(jobId, (event: JobUpdateEvent) => {
      if (TERMINAL_JOB_STATUSES.includes(event.status)) {
        finish({
          status: event.status,
          result: (event.result as Record<string, unknown> | null) ?? null,
          error: event.error ?? null,
        });
      }
    });

    const checkRow = async () => {
      const job = await DbService.repository.jobs
        .findById(jobId)
        .catch(() => null);
      if (job && TERMINAL_JOB_STATUSES.includes(job.status)) {
        finish({
          status: job.status,
          result: (job.result as Record<string, unknown> | null) ?? null,
          error: job.error ?? null,
        });
      }
    };
    poll = setInterval(() => void checkRow(), TERMINAL_POLL_INTERVAL_MS);
    // Immediate check in case the job is already terminal before the
    // subscription is wired (fast job / subscribe race).
    void checkRow();

    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort);
    }
  });
}
