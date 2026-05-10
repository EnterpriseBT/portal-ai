import React from "react";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";

import type { RunningJobSummary } from "@portalai/core/contracts";

import { joinRunningJobLabels } from "../utils/running-job-label.util";

export interface ConnectorInstanceLockAlertUIProps {
  /**
   * Non-terminal jobs locking this connector instance — drives the
   * alert's visibility (rendered only when non-empty) and copy
   * (lists each running job by its human-readable label).
   */
  runningJobs: RunningJobSummary[];
}

/**
 * Lock notice rendered at the top of the connector-instance detail
 * view while a `connector_sync` / `layout_plan_commit` job is in
 * flight against this instance. Tells the user which background
 * work is running and which mutations (sync, rename, delete, plan
 * edits, entity create) are paused until it finishes.
 *
 * Pure UI by the application-wide component file policy: takes the
 * running-jobs list via props, no SDK / SSE wiring of its own. The
 * connector-instance view container is responsible for fetching the
 * list (`sdk.connectorInstances.runningJobs`) and invalidating its
 * query key on the SSE terminal event for any of the listed jobs.
 */
export const ConnectorInstanceLockAlertUI: React.FC<
  ConnectorInstanceLockAlertUIProps
> = ({ runningJobs }) => {
  if (runningJobs.length === 0) return null;
  const phrase = joinRunningJobLabels(runningJobs);
  const isPlural = runningJobs.length > 1;
  return (
    <Box mb={2}>
      <Alert severity="info" variant="outlined">
        <AlertTitle>
          {phrase} {isPlural ? "are" : "is"} running
        </AlertTitle>
        Sync, rename, delete, plan edits, and creating new entities are
        paused until {isPlural ? "these jobs finish" : "this job finishes"}.
        The view will refresh automatically when{" "}
        {isPlural ? "they're done" : "it's done"}.
      </Alert>
    </Box>
  );
};
