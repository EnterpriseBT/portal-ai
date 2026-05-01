import type React from "react";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";
import LinkOffIcon from "@mui/icons-material/LinkOff";

import { Box, Progress, Stack, Typography } from "@portalai/core/ui";
import { JobModel } from "@portalai/core/models";
import type { JobStatus } from "@portalai/core/models";

import type { SyncRecordCounts } from "../utils/use-connector-instance-sync.util";

export interface ConnectorInstanceSyncFeedbackUIProps {
  /** Live job status from the SSE stream. */
  jobStatus: JobStatus | null;
  /** Live progress percent (0–100) from the SSE stream. */
  progress: number;
  /** Tally rendered when a job completes successfully. */
  recordCounts: SyncRecordCounts | null;
  /** Error message rendered on POST failure or stream failure. */
  errorMessage: string | null;
  /** Called when the user closes the success/failure toast. */
  onDismissResult: () => void;
  /**
   * When true AND the toast is showing a failure, render an inline
   * Reconnect button so the user can recover without scrolling back to
   * the page header. The view decides whether the failure looks
   * auth-related (e.g. message includes `invalid_grant` /
   * `refresh_failed`) — this component renders the button blindly when
   * told to.
   */
  showReconnect?: boolean;
  /** Click handler for the inline Reconnect button. */
  onReconnect?: () => void;
  /** Reconnect popup in flight. */
  isReconnecting?: boolean;
}

/**
 * Closeable toast for the post-trigger feedback of the connector-instance
 * sync flow. Renders three phases inside a single MUI `Snackbar` anchored
 * bottom-right:
 *   - while a job is active: a progress bar with the live percent
 *   - on success: a tally of added/updated/unchanged/removed records
 *   - on failure: the error message, plus an optional Reconnect button
 *
 * The toast opens automatically when there's something to show and closes
 * via the user clicking the Alert's X (terminal phases only — the live
 * phase has no close affordance because the job is still running).
 *
 * Convention: any UI action that triggers a backend job should surface
 * progress + result + error feedback through a closeable toast like
 * this one rather than as an inline view panel. Keeps the page surface
 * uncluttered while the job runs.
 *
 * Paired with `ConnectorInstanceSyncButtonUI` (the trigger). State is
 * owned upstream via `useConnectorInstanceSync` so trigger + feedback
 * stay in sync without sharing a parent component.
 */
export const ConnectorInstanceSyncFeedbackUI = ({
  jobStatus,
  progress,
  recordCounts,
  errorMessage,
  onDismissResult,
  showReconnect,
  onReconnect,
  isReconnecting,
}: ConnectorInstanceSyncFeedbackUIProps) => {
  const isLive = jobStatus !== null && !JobModel.isTerminalStatus(jobStatus);
  const open = isLive || recordCounts !== null || errorMessage !== null;

  // Snackbar requires exactly one child; pick the active phase.
  let body: React.ReactElement | null = null;
  if (isLive) {
    body = (
      <Alert severity="info" variant="filled" sx={{ minWidth: 320 }}>
        <Stack spacing={0.75}>
          <Typography variant="body2">Syncing…</Typography>
          <Box sx={{ width: "100%" }}>
            <Progress value={progress} height={6} animated />
          </Box>
        </Stack>
      </Alert>
    );
  } else if (recordCounts) {
    body = (
      <Alert
        severity="success"
        variant="filled"
        onClose={onDismissResult}
        sx={{ minWidth: 320 }}
      >
        <Typography variant="body2">
          Sync complete: {recordCounts.created} added,{" "}
          {recordCounts.updated} updated, {recordCounts.unchanged}{" "}
          unchanged, {recordCounts.deleted} removed
        </Typography>
      </Alert>
    );
  } else if (errorMessage) {
    body = (
      <Alert
        severity="error"
        variant="filled"
        onClose={onDismissResult}
        sx={{ minWidth: 320 }}
        action={
          showReconnect && onReconnect ? (
            <Button
              size="small"
              color="inherit"
              startIcon={<LinkOffIcon />}
              onClick={onReconnect}
              disabled={isReconnecting === true}
              sx={{ mr: 1 }}
            >
              {isReconnecting ? "Reconnecting…" : "Reconnect"}
            </Button>
          ) : undefined
        }
      >
        <Typography variant="body2">{errorMessage}</Typography>
      </Alert>
    );
  }

  return (
    <Snackbar
      open={open}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
    >
      {body ?? <span />}
    </Snackbar>
  );
};
