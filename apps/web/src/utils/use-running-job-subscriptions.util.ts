import { useEffect, useRef } from "react";

import type { RunningJobSummary } from "@portalai/core/contracts";

import { sse } from "../api/sse.api";
import { awaitJobCompletion } from "./job-stream.util";

/**
 * #689: subscribe to each running job's SSE stream and call `onSettled` when
 * one reaches a terminal status (completed, failed or cancelled alike). A
 * page that disables its actions while a job runs uses this to hear the job
 * end and refetch, per CLAUDE.md "Async Job State": the SSE channel is the
 * source of truth, never polling.
 *
 * A job that leaves the list has its stream aborted, as do all on unmount.
 * `onSettled` isn't called for an aborted stream.
 */
export function useRunningJobSubscriptions(
  runningJobs: Pick<RunningJobSummary, "id" | "type">[],
  onSettled: (job: Pick<RunningJobSummary, "id" | "type">) => void
): void {
  const connect = sse.create();
  const subscriptions = useRef(new Map<string, AbortController>());
  // The latest callback, so a new closure each render doesn't resubscribe.
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    const subs = subscriptions.current;
    const runningIds = new Set(runningJobs.map((j) => j.id));
    for (const [jobId, ac] of subs.entries()) {
      if (!runningIds.has(jobId)) {
        ac.abort();
        subs.delete(jobId);
      }
    }
    for (const job of runningJobs) {
      if (subs.has(job.id)) continue;
      const ac = new AbortController();
      subs.set(job.id, ac);
      awaitJobCompletion(connect, job.id, { signal: ac.signal })
        .catch(() => undefined)
        .finally(() => {
          if (ac.signal.aborted) return;
          if (subs.get(job.id) === ac) subs.delete(job.id);
          onSettledRef.current(job);
        });
    }
  }, [runningJobs, connect]);

  useEffect(() => {
    const subs = subscriptions.current;
    return () => {
      for (const ac of subs.values()) ac.abort();
      subs.clear();
    };
  }, []);
}
