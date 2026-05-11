import { useEffect, useRef, useState } from "react";

import { JobModel } from "@portalai/core/models";
import type { JobStatus } from "@portalai/core/models";
import type {
  JobSnapshotEvent,
  JobUpdateEvent,
} from "@portalai/core/contracts";

import { sse } from "../api/sse.api";

// --- Types ---

type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "closed";

export interface JobStreamState {
  jobId: string | null;
  status: JobStatus | null;
  progress: number;
  error: string | null;
  result: Record<string, unknown> | null;
  startedAt: number | null;
  completedAt: number | null;
  connectionStatus: ConnectionStatus;
}

const INITIAL_STATE: JobStreamState = {
  jobId: null,
  status: null,
  progress: 0,
  error: null,
  result: null,
  startedAt: null,
  completedAt: null,
  connectionStatus: "idle",
};

const RECONNECT_DELAY_MS = 3000;

// --- Hook ---

/**
 * Subscribes to real-time SSE updates for a given job.
 *
 * - On connect, receives a `snapshot` event with the current job state.
 * - Receives `update` events as the job progresses.
 * - Auto-closes when the job reaches a terminal state.
 * - Auto-reconnects on network errors.
 * - Cleans up EventSource on unmount or when `jobId` changes.
 *
 * Pass `null` or `undefined` as `jobId` to disable the stream.
 */
export const useJobStream = (
  jobId: string | null | undefined
): JobStreamState => {
  const createSSEConnection = sse.create();
  const [state, setState] = useState<JobStreamState>(INITIAL_STATE);

  // Refs for stable access inside async/event callbacks
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef(createSSEConnection);

  useEffect(() => {
    connectRef.current = createSSEConnection;
  }, [createSSEConnection]);

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    const closeEventSource = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const clearReconnect = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const openStream = async () => {
      closeEventSource();
      clearReconnect();

      if (cancelled) return;

      let es: EventSource;
      try {
        es = await connectRef.current(
          `/api/sse/jobs/${encodeURIComponent(jobId)}/events`
        );
      } catch {
        if (!cancelled) {
          setState((prev) => ({ ...prev, connectionStatus: "error" }));
        }
        return;
      }

      if (cancelled) return;

      eventSourceRef.current = es;

      es.addEventListener("snapshot", (e: MessageEvent) => {
        if (cancelled) return;
        const data: JobSnapshotEvent = JSON.parse(e.data);
        setState({
          jobId: data.jobId,
          status: data.status,
          progress: data.progress,
          error: data.error,
          result: data.result,
          startedAt: data.startedAt,
          completedAt: data.completedAt,
          connectionStatus: "connected",
        });

        if (JobModel.isTerminalStatus(data.status)) {
          es.close();
          eventSourceRef.current = null;
          setState((prev) => ({ ...prev, connectionStatus: "closed" }));
        }
      });

      es.addEventListener("update", (e: MessageEvent) => {
        if (cancelled) return;
        const data: JobUpdateEvent = JSON.parse(e.data);
        setState((prev) => {
          // Don't let a stale "active" progress event regress from a later status
          const status =
            prev.status === "awaiting_confirmation" && data.status === "active"
              ? prev.status
              : data.status;
          return {
            ...prev,
            status,
            progress:
              data.progress > prev.progress ? data.progress : prev.progress,
            error: data.error ?? prev.error,
            result: data.result ?? prev.result,
            connectionStatus: "connected",
          };
        });

        if (JobModel.isTerminalStatus(data.status)) {
          es.close();
          eventSourceRef.current = null;
          setState((prev) => ({ ...prev, connectionStatus: "closed" }));
        }
      });

      // Listen for custom job:recommendations event — merges recommendations
      // into the result so the upload workflow can access them immediately.
      es.addEventListener("job:recommendations", (e: MessageEvent) => {
        if (cancelled) return;
        const data = JSON.parse(e.data);
        if (data.recommendations) {
          setState((prev) => ({
            ...prev,
            result: {
              ...(prev.result ?? {}),
              recommendations: data.recommendations,
            },
            connectionStatus: "connected",
          }));
        }
      });

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        if (cancelled) return;

        setState((prev) => {
          // Don't reconnect if job is already terminal
          if (prev.status && JobModel.isTerminalStatus(prev.status)) {
            return { ...prev, connectionStatus: "closed" };
          }
          reconnectTimerRef.current = setTimeout(() => {
            openStream();
          }, RECONNECT_DELAY_MS);
          return { ...prev, connectionStatus: "error" };
        });
      };
    };

    openStream();

    return () => {
      cancelled = true;
      clearReconnect();
      closeEventSource();
    };
  }, [jobId]);

  if (!jobId) return INITIAL_STATE;

  // Derive "connecting" status: jobId is set but no snapshot received yet
  if (state.connectionStatus === "idle") {
    return { ...state, connectionStatus: "connecting" };
  }

  return state;
};

// ---------------------------------------------------------------------------
// Imperative variant
// ---------------------------------------------------------------------------

export interface JobCompletionResult {
  result: Record<string, unknown> | null;
}

/**
 * Imperative wait-for-job — opens an SSE stream and resolves on the
 * job's terminal status. Used inside async callbacks (e.g. the
 * file-upload workflow's `parseFile`) where a hook is not available.
 * Caller passes the auth-aware `connect` factory from `sse.create()`.
 *
 * Resolves with the job's `result` payload on `completed`, rejects
 * with the `error` string on `failed` / `cancelled`. Honors `signal`
 * for cancellation; on abort the EventSource is closed and the
 * promise rejects with an AbortError.
 *
 * `onProgress` (optional) fires for every active/pending intermediate
 * event with the job's current `progress` percent — used by the
 * file-upload workflow to surface the parse job's mid-flight progress
 * after the S3 PUT has already reached 100%.
 */
export async function awaitJobCompletion(
  connect: (path: string) => Promise<EventSource>,
  jobId: string,
  options: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {}
): Promise<JobCompletionResult> {
  const { signal, onProgress } = options;
  if (signal?.aborted) {
    throw new DOMException("Job wait aborted", "AbortError");
  }

  const es = await connect(`/api/sse/jobs/${encodeURIComponent(jobId)}/events`);

  return new Promise<JobCompletionResult>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      es.close();
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Job wait aborted", "AbortError"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const handleEvent = (e: MessageEvent) => {
      let data: {
        status?: string;
        progress?: number;
        result?: Record<string, unknown> | null;
        error?: string | null;
      };
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!data.status) return;

      if (data.status === "completed") {
        cleanup();
        resolve({ result: data.result ?? null });
      } else if (data.status === "failed" || data.status === "cancelled") {
        cleanup();
        reject(
          new Error(
            data.error ??
              (data.status === "cancelled" ? "Job cancelled" : "Job failed")
          )
        );
      } else if (onProgress && typeof data.progress === "number") {
        // Intermediate active/pending/awaiting_confirmation events
        // carry the job's current `progress`. Forward to the caller
        // so they can drive a mid-flight UI bar (parse step, commit
        // step, etc.). Promise stays unresolved until the terminal
        // event arrives.
        onProgress(data.progress);
      }
    };

    es.addEventListener("snapshot", handleEvent);
    es.addEventListener("update", handleEvent);
    es.onerror = () => {
      // EventSource auto-reconnects on transient errors; only reject if the
      // promise hasn't already settled. The caller's onProgress hook can
      // surface the connection state if needed.
      if (settled) return;
      cleanup();
      reject(new Error("SSE connection error while waiting for job"));
    };
  });
}
