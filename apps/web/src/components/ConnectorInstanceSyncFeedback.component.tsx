import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
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
  /** Called when the user closes the success/failure alert. */
  onDismissResult: () => void;
  /**
   * When true AND the alert is showing a failure, render an inline
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
 * Pure UI for the post-trigger feedback panel of the connector-instance
 * sync flow: a determinate progress bar while the job is active, a
 * dismissible success summary on completion, or an error alert on
 * failure. Renders nothing when there's no in-flight job and no
 * recently-finished result to show.
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

  if (!isLive && !recordCounts && !errorMessage) return null;

  return (
    <Stack spacing={1}>
      {isLive ? (
        <Box sx={{ width: 280 }}>
          <Progress value={progress} height={6} animated />
        </Box>
      ) : null}

      {!isLive && recordCounts ? (
        <Alert
          severity="success"
          onClose={onDismissResult}
          variant="outlined"
        >
          <Typography variant="body2">
            Sync complete: {recordCounts.created} added,{" "}
            {recordCounts.updated} updated, {recordCounts.unchanged}{" "}
            unchanged, {recordCounts.deleted} removed
          </Typography>
        </Alert>
      ) : null}

      {!isLive && errorMessage ? (
        <Alert
          severity="error"
          onClose={onDismissResult}
          variant="outlined"
          action={
            showReconnect && onReconnect ? (
              <Button
                size="small"
                color="error"
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
      ) : null}
    </Stack>
  );
};
