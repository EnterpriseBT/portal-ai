import React, { useEffect, useReducer, useRef } from "react";
import {
  Box,
  LinearProgress,
  Typography,
  Button,
  Stack,
  Chip,
} from "@mui/material";
import CancelIcon from "@mui/icons-material/CancelOutlined";

import { sdk } from "../api/sdk";
import { sse } from "../api/sse.api";

// ── Types ──────────────────────────────────────────────────────────────

export interface BulkJobProgressContent {
  jobId: string;
  expectedRecords: number;
  /** Reserved for the live-chart variant (Phase 2 follow-up). */
  viewKind?: "histogram" | "bar" | "paginated-table";
  /** Column name to chart against; reserved for the live-chart variant. */
  columnRef?: string;
}

type JobStatus = "running" | "completed" | "failed" | "cancelled";

interface State {
  status: JobStatus;
  recordsProcessed: number;
  totalRecords: number;
  failureCount: number;
  batchDurationMsAvg: number | null;
  batchCount: number;
}

type Action =
  | {
      kind: "batch";
      recordsProcessed: number;
      totalRecords: number;
      batchDurationMs: number;
      failureCount?: number;
    }
  | {
      kind: "terminal";
      status: "completed" | "failed" | "cancelled";
      /** Carried in the snapshot's `result` envelope when the widget
       *  mounts after the job already finished. Backfills the counts
       *  the live `job:batch` stream would have delivered. */
      recordsProcessed?: number;
      recordsFailed?: number;
      totalRecords?: number;
    }
  | { kind: "cancel-requested" };

function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case "batch":
      return {
        ...state,
        recordsProcessed: action.recordsProcessed,
        totalRecords: action.totalRecords,
        failureCount: action.failureCount ?? state.failureCount,
        batchDurationMsAvg:
          state.batchCount === 0
            ? action.batchDurationMs
            : (state.batchDurationMsAvg! * state.batchCount +
                action.batchDurationMs) /
              (state.batchCount + 1),
        batchCount: state.batchCount + 1,
      };
    case "terminal":
      return {
        ...state,
        status: action.status,
        // Only overwrite counters when the terminal payload carries
        // them — `job:*` terminal events from the live stream don't,
        // but the recovery `snapshot` does (via the job's `result`).
        recordsProcessed:
          action.recordsProcessed ?? state.recordsProcessed,
        totalRecords:
          action.totalRecords ?? state.totalRecords,
        failureCount: action.recordsFailed ?? state.failureCount,
      };
    case "cancel-requested":
      // Optimistic: show "Cancelling…" until the terminal event lands.
      return state;
  }
}

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface BulkJobProgressBlockUIProps {
  state: State;
  cancelling: boolean;
  onCancel: () => void;
}

export const BulkJobProgressBlockUI: React.FC<BulkJobProgressBlockUIProps> = ({
  state,
  cancelling,
  onCancel,
}) => {
  const pct =
    state.totalRecords > 0
      ? Math.min(
          100,
          Math.round((state.recordsProcessed / state.totalRecords) * 100)
        )
      : 0;

  const etaSeconds =
    state.batchDurationMsAvg != null && state.totalRecords > 0
      ? Math.max(
          0,
          Math.round(
            ((state.totalRecords - state.recordsProcessed) *
              state.batchDurationMsAvg) /
              1000 /
              Math.max(1, state.batchCount === 0 ? 1 : 1)
          )
        )
      : null;

  const statusChip = (() => {
    if (state.status === "running")
      return <Chip size="small" label="Running" color="info" />;
    if (state.status === "completed")
      return <Chip size="small" label="Completed" color="success" />;
    if (state.status === "cancelled")
      return <Chip size="small" label="Cancelled" color="warning" />;
    return <Chip size="small" label="Failed" color="error" />;
  })();

  return (
    <Box
      data-testid="bulk-job-progress-block"
      sx={{
        p: 2,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        maxWidth: 540,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2">Bulk transform</Typography>
        {statusChip}
      </Stack>

      <LinearProgress
        variant={state.status === "running" ? "determinate" : "determinate"}
        value={pct}
        sx={{ mt: 1.5, mb: 1 }}
        aria-label="Bulk transform progress"
      />

      <Stack direction="row" spacing={2} alignItems="baseline">
        <Typography variant="body2">
          {state.recordsProcessed.toLocaleString()} /{" "}
          {state.totalRecords.toLocaleString()} records
        </Typography>
        {state.failureCount > 0 && (
          <Typography variant="caption" color="error">
            {state.failureCount.toLocaleString()} failed
          </Typography>
        )}
        {state.status === "running" && etaSeconds != null && (
          <Typography variant="caption" color="text.secondary">
            ETA ~{etaSeconds}s
          </Typography>
        )}
      </Stack>

      {state.status === "running" && (
        <Box sx={{ mt: 1.5 }}>
          <Button
            size="small"
            color="warning"
            startIcon={<CancelIcon />}
            onClick={onCancel}
            disabled={cancelling}
            aria-label="Cancel bulk job"
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        </Box>
      )}
    </Box>
  );
};

// ── Container ──────────────────────────────────────────────────────────

export interface BulkJobProgressBlockProps {
  content: BulkJobProgressContent;
}

const INITIAL: State = {
  status: "running",
  recordsProcessed: 0,
  totalRecords: 0,
  failureCount: 0,
  batchDurationMsAvg: null,
  batchCount: 0,
};

export const BulkJobProgressBlock: React.FC<BulkJobProgressBlockProps> = ({
  content,
}) => {
  const [state, dispatch] = useReducer(reducer, {
    ...INITIAL,
    totalRecords: content.expectedRecords,
  });
  const cancelMutation = sdk.jobs.cancel(content.jobId);
  const connect = sse.create();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const es = await connect(`/api/sse/jobs/${content.jobId}/events`);
      if (cancelled) {
        es.close();
        return;
      }
      esRef.current = es;

      es.addEventListener("job:batch", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          dispatch({
            kind: "batch",
            recordsProcessed: payload.recordsProcessed ?? 0,
            totalRecords: payload.totalRecords ?? 0,
            batchDurationMs: payload.batchDurationMs ?? 0,
            failureCount: payload.failureCount,
          });
        } catch {
          // ignore malformed events
        }
      });

      const handleTerminal =
        (status: "completed" | "failed" | "cancelled") => () => {
          dispatch({ kind: "terminal", status });
          es.close();
        };
      es.addEventListener("job:completed", handleTerminal("completed"));
      es.addEventListener("job:failed", handleTerminal("failed"));
      es.addEventListener("job:cancelled", handleTerminal("cancelled"));

      // Recovery snapshot — server sends this on connect and, for
      // jobs that already reached terminal, immediately closes. Without
      // this listener the close would trip EventSource auto-reconnect
      // (server sets retry: 0) → infinite reconnect loop on every
      // portal reopen with a failed/completed job in history.
      //
      // For terminal snapshots we backfill the record counters from
      // `result` (BulkTransformResultSchema: recordsProcessed,
      // recordsFailed) so the post-reload widget doesn't render as
      // "Completed — 0 / N records".
      es.addEventListener("snapshot", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            status: JobStatus;
            result?: {
              recordsProcessed?: number;
              recordsFailed?: number;
            } | null;
          };
          if (
            payload.status === "completed" ||
            payload.status === "failed" ||
            payload.status === "cancelled"
          ) {
            dispatch({
              kind: "terminal",
              status: payload.status,
              recordsProcessed: payload.result?.recordsProcessed,
              recordsFailed: payload.result?.recordsFailed,
            });
            es.close();
          }
        } catch {
          // ignore malformed snapshots
        }
      });
    })();

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.jobId]);

  const handleCancel = React.useCallback(() => {
    if (cancelMutation.isPending) return;
    dispatch({ kind: "cancel-requested" });
    // Fire-and-forget: the worker-side cancel propagation will
    // surface the terminal event regardless of whether the request
    // succeeded — a failed POST here doesn't block the SSE path.
    cancelMutation.mutate(undefined);
  }, [cancelMutation]);

  return (
    <BulkJobProgressBlockUI
      state={state}
      cancelling={cancelMutation.isPending}
      onCancel={handleCancel}
    />
  );
};
