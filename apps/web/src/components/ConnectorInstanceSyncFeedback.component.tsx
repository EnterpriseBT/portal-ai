import type React from "react";

import { Link } from "@tanstack/react-router";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Snackbar from "@mui/material/Snackbar";
import LinkOffIcon from "@mui/icons-material/LinkOff";

import { Box, Progress, Stack, Typography } from "@portalai/core/ui";
import { JobModel } from "@portalai/core/models";
import type { JobProgressDetail, JobStatus } from "@portalai/core/models";

import type { ReplayWarning } from "@portalai/core/contracts";

import type { SyncRecordCounts } from "../utils/use-connector-instance-sync.util";
import { formatJobProgress } from "../utils/job-progress.util";
import { formatReplayWarning } from "../utils/replay-warning.util";

/** #1009: how many regions the warning names before "+N more". */
const SHOWN_REPLAY_WARNINGS = 3;

export interface ConnectorInstanceSyncFeedbackUIProps {
  /** Live job status from the SSE stream. */
  jobStatus: JobStatus | null;
  /** Live progress percent (0–100) from the SSE stream. */
  progress: number;
  /** Structured progress from the SSE stream (#458), else null. */
  progressDetail?: JobProgressDetail | null;
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
  /** #1009: regions the sync read past their sheet or skipped (a missing
   *  sheet). When present, the success renders as a warning naming them. */
  replayWarnings?: ReplayWarning[] | null;
  /** #1009: warnings past the result's cap, counted into "+N more". */
  replayWarningsOmitted?: number;
  /** #1009: the instance whose layout editor the warning links to; null or
   *  absent when the caller can't edit the plan, so no link renders. */
  editLayoutPlanLink?: { connectorInstanceId: string } | null;
}

/**
 * Closeable toast for the post-trigger feedback of the connector-instance
 * NOT a toast, deliberately (#293): this is *progress through phases*, a
 * status display that happens to be rendered in a Snackbar, not the outcome of
 * a single action. A recorded exception, not a precedent — see CLAUDE.md →
 * "Toast Pattern (apps/web)".
 *
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
  progressDetail,
  recordCounts,
  errorMessage,
  onDismissResult,
  showReconnect,
  onReconnect,
  isReconnecting,
  replayWarnings,
  replayWarningsOmitted = 0,
  editLayoutPlanLink,
}: ConnectorInstanceSyncFeedbackUIProps) => {
  const isLive = jobStatus !== null && !JobModel.isTerminalStatus(jobStatus);
  const open = isLive || recordCounts !== null || errorMessage !== null;

  // Snackbar requires exactly one child; pick the active phase.
  let body: React.ReactElement | null = null;
  if (isLive) {
    // #458: fraction when the total is known, count + indeterminate bar
    // when it isn't, plain percent for jobs that report no detail.
    const display = formatJobProgress(progressDetail ?? null, progress);
    body = (
      // Fixed width, not minWidth: the "X of Y records" line grows as the
      // count climbs, and a content-sized Alert would reflow the progress
      // bar's width on every update (#458 smoke finding).
      <Alert
        severity="info"
        variant="filled"
        // The message slot doesn't grow by default; without flexGrow the
        // fixed-width Alert would shrink-wrap the bar to the text width.
        sx={{ width: 360, "& .MuiAlert-message": { flexGrow: 1 } }}
      >
        <Stack spacing={0.75} sx={{ width: "100%" }}>
          <Typography variant="body2">Syncing…</Typography>
          {display.kind !== "percent" && (
            <Typography variant="body2">{display.label}</Typography>
          )}
          <Box sx={{ width: "100%" }}>
            <Progress
              value={display.kind === "count" ? 0 : display.barValue}
              indeterminate={display.kind === "count"}
              showLabel={display.kind !== "count"}
              // `inherit` = the filled Alert's contrast color (white). The
              // primary-palette bar and text.secondary label are both
              // near-invisible on the filled `info` background (#458).
              color="inherit"
              height={6}
              animated
            />
          </Box>
        </Stack>
      </Alert>
    );
  } else if (recordCounts && replayWarnings && replayWarnings.length > 0) {
    const shown = replayWarnings.slice(0, SHOWN_REPLAY_WARNINGS);
    const more =
      replayWarnings.length - shown.length + Math.max(0, replayWarningsOmitted);
    body = (
      <Alert
        severity="warning"
        variant="filled"
        onClose={onDismissResult}
        // Width as the sibling phases set it; capped so long region lines wrap.
        sx={{ minWidth: 320, maxWidth: 480 }}
        action={
          editLayoutPlanLink ? (
            <Link
              to="/connectors/$connectorInstanceId/layout-plan/edit"
              params={{
                connectorInstanceId: editLayoutPlanLink.connectorInstanceId,
              }}
              style={{ color: "inherit", alignSelf: "center" }}
            >
              <MuiLink component="span" color="inherit" sx={{ mr: 1 }}>
                Modify layout plan
              </MuiLink>
            </Link>
          ) : undefined
        }
      >
        <Stack spacing={0.5}>
          <Typography variant="subtitle2" component="p">
            Synced, but part of the layout plan no longer fits the source
          </Typography>
          {shown.map((w) => (
            <Typography key={w.regionId} variant="body2">
              {formatReplayWarning(w)}
            </Typography>
          ))}
          {more > 0 && <Typography variant="body2">+{more} more</Typography>}
          <Typography variant="body2">
            {recordCounts.created} added, {recordCounts.updated} updated,{" "}
            {recordCounts.unchanged} unchanged, {recordCounts.deleted} removed
          </Typography>
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
          Sync complete: {recordCounts.created} added, {recordCounts.updated}{" "}
          updated, {recordCounts.unchanged} unchanged, {recordCounts.deleted}{" "}
          removed
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
