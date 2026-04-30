import { useCallback, useEffect, useRef, useState } from "react";

import type { JobStatus } from "@portalai/core/models";
import { useQueryClient } from "@tanstack/react-query";

import { sdk, queryKeys } from "../api/sdk";
import type { ApiError } from "./api.util";

export interface SyncRecordCounts {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
}

export interface ConnectorInstanceSyncState {
  /** HTTP POST in flight (mutation hasn't returned yet). */
  isStarting: boolean;
  /** Live job status from the SSE stream, or `null` when no job is tracked. */
  jobStatus: JobStatus | null;
  /** Live progress percent (0–100) from the SSE stream. */
  progress: number;
  /** Tally rendered when a job completes successfully (else null). */
  recordCounts: SyncRecordCounts | null;
  /** Error message rendered on POST failure or stream failure (else null). */
  errorMessage: string | null;
  /** Click handler — fires the sync mutation. */
  onSync: () => void;
  /** Dismisses the success / failure feedback panel. */
  onDismissResult: () => void;
}

function extractRecordCounts(
  result: Record<string, unknown> | null
): SyncRecordCounts | null {
  if (!result) return null;
  const rc = (result as { recordCounts?: unknown }).recordCounts;
  if (!rc || typeof rc !== "object") return null;
  const { created, updated, unchanged, deleted } = rc as Record<
    string,
    unknown
  >;
  if (
    typeof created === "number" &&
    typeof updated === "number" &&
    typeof unchanged === "number" &&
    typeof deleted === "number"
  ) {
    return { created, updated, unchanged, deleted };
  }
  return null;
}

/**
 * Drives the connector-instance "Sync now" flow.
 *
 * Fires the mutation, captures the returned `jobId`, subscribes to its
 * SSE stream, latches onto an in-flight job on 409 SYNC_ALREADY_RUNNING,
 * and exposes everything callers need to render a trigger button + a
 * separate progress/result panel. State is held in one place so the
 * trigger and feedback can be placed in different parts of a layout
 * (e.g. trigger as a primary header action, feedback below the header).
 *
 * `syncEligible` is *not* an argument — the caller has it from the
 * connector instance's GET response and passes it directly to the
 * trigger UI. The hook owns only the dynamic sync state.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-D.plan.md` §Slice 6.
 */
export const useConnectorInstanceSync = (
  connectorInstanceId: string
): ConnectorInstanceSyncState => {
  const queryClient = useQueryClient();
  const syncMutation = sdk.connectorInstances.sync(connectorInstanceId);
  const [jobId, setJobId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Live SSE — `null` jobId disables the stream.
  const stream = sdk.jobs.stream(jobId);

  // Side-effect on job completion: refresh derived data so the UI
  // reflects the synced state (lastSyncAt on the instance, the records
  // list). Pure invalidation — no setState in the effect.
  const lastInvalidatedJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!jobId) return;
    if (stream.status !== "completed") return;
    if (lastInvalidatedJobIdRef.current === jobId) return;
    lastInvalidatedJobIdRef.current = jobId;
    queryClient.invalidateQueries({
      queryKey: queryKeys.connectorInstances.get(connectorInstanceId),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.entityRecords.root });
  }, [jobId, stream.status, queryClient, connectorInstanceId]);

  const onSync = useCallback(() => {
    setMutationError(null);
    syncMutation.mutate(undefined, {
      onSuccess: ({ jobId: newJobId }) => {
        setJobId(newJobId);
        // Bump the jobs list so any open page picks up the new pending row.
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.root });
      },
      onError: (err: ApiError) => {
        // Single-flight: if a sync is already running for this instance,
        // the 409 carries the in-flight jobId. Latch onto its SSE stream
        // rather than show an error to the user.
        if (
          err.code === "SYNC_ALREADY_RUNNING" &&
          typeof err.details?.jobId === "string"
        ) {
          setJobId(err.details.jobId);
          return;
        }
        setMutationError(err.message);
      },
    });
  }, [syncMutation, queryClient]);

  const onDismissResult = useCallback(() => {
    setMutationError(null);
    setJobId(null);
  }, []);

  // Derive surface state from the stream so we don't double-buffer it.
  const recordCounts =
    stream.status === "completed" ? extractRecordCounts(stream.result) : null;
  const errorMessage =
    mutationError ?? (stream.status === "failed" ? stream.error : null);

  return {
    isStarting: syncMutation.isPending,
    jobStatus: stream.status,
    progress: stream.progress,
    recordCounts,
    errorMessage,
    onSync,
    onDismissResult,
  };
};
