import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useRef, useState } from "react";

import { JobModel } from "@portalai/core/models";
import type { JobStatus } from "@portalai/core/models";
import type { JobSnapshotEvent, JobUpdateEvent } from "@portalai/core/contracts";

// --- Types ---

type ConnectionStatus = "idle" | "connecting" | "connected" | "error" | "closed";

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
export const useJobStream = (jobId: string | null | undefined): JobStreamState => {
  const { getAccessTokenSilently } = useAuth0();
  const [state, setState] = useState<JobStreamState>(INITIAL_STATE);

  // Refs for stable access inside async/event callbacks
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getTokenRef = useRef(getAccessTokenSilently);

  useEffect(() => {
    getTokenRef.current = getAccessTokenSilently;
  }, [getAccessTokenSilently]);

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

      let token: string;
      try {
        token = await getTokenRef.current({
          authorizationParams: {
            audience: import.meta.env?.VITE_AUTH0_AUDIENCE,
          },
        });
      } catch {
        if (!cancelled) {
          setState((prev) => ({ ...prev, connectionStatus: "error" }));
        }
        return;
      }

      if (cancelled) return;

      const url = `/api/sse/jobs/${encodeURIComponent(jobId)}/events?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
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
            progress: data.progress > prev.progress ? data.progress : prev.progress,
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
