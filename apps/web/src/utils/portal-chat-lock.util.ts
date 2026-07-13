/**
 * Hook driving the portal chat-input lock state (#85 Phase 2 slice 5).
 *
 * Sources of truth, in order:
 *   1. `GET /api/portals/:id/running-jobs` — initial state on mount.
 *   2. `/api/sse/portals/:id/events` — Pub/Sub events flip the lock
 *      in real time. On `bulk_job_terminal`, the query is invalidated
 *      so the input unlocks without polling.
 *
 * Returns `{ locked, reason }`. When `locked` is true, the chat input
 * owner disables its submit affordance and shows a tooltip.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { sdk, queryKeys } from "../api/sdk";
import { sse } from "../api/sse.api";

export interface PortalChatLockState {
  locked: boolean;
  reason: string | null;
  runningJobs: Array<{
    id: string;
    type: string;
    status: string;
    startedAt: number | null;
    created: number;
  }>;
}

export function usePortalChatLock(portalId: string): PortalChatLockState {
  const query = sdk.portals.runningJobs(portalId);
  const queryClient = useQueryClient();
  const connect = sse.create();

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    (async () => {
      es = await connect(
        `/api/sse/portals/${encodeURIComponent(portalId)}/events`
      );
      if (cancelled) {
        es.close();
        return;
      }
      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (
            payload.type === "bulk_job_terminal" ||
            payload.type === "bulk_job_started"
          ) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.portals.runningJobs(portalId),
            });
          }
        } catch {
          // ignore malformed events
        }
      };
    })();
    return () => {
      cancelled = true;
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalId]);

  const jobs = query.data?.jobs ?? [];
  const locked = jobs.length > 0;
  const reason = locked
    ? `${jobs.length} bulk operation${jobs.length > 1 ? "s" : ""} running — input unlocks when ${jobs.length > 1 ? "they finish" : "it finishes"}.`
    : null;

  return { locked, reason, runningJobs: jobs };
}
