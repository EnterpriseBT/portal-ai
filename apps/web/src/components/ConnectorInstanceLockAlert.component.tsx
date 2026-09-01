import React from "react";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { Link } from "@tanstack/react-router";

import type { RunningJobSummary } from "@portalai/core/contracts";

import { runningJobLabel } from "../utils/running-job-label.util";
import { joinRunningJobLabels } from "../utils/running-job-label.util";
import { formatAgo, isOlderThan } from "../utils/relative-time.util";

/**
 * Age past which a running job's line carries a "may be stuck" hint with a
 * link to the job detail (where Cancel lives). Deliberately a frontend
 * constant, not plumbed from the backend's JOB_STRANDED_THRESHOLD_MS — it
 * is a hint, not a contract, and the two drifting slightly is harmless
 * (#391 discovery Q4). The reconciliation sweep is the actual fix; this is
 * the honest surface during its window.
 */
export const STALE_JOB_HINT_MS = 15 * 60 * 1000;

export interface ConnectorInstanceLockAlertUIProps {
  /**
   * Non-terminal jobs locking this connector instance — drives the
   * alert's visibility (rendered only when non-empty) and copy
   * (lists each running job by its human-readable label + age).
   */
  runningJobs: RunningJobSummary[];
}

/**
 * Lock notice rendered at the top of the connector-instance detail
 * view while a `connector_sync` / `layout_plan_commit` job is in
 * flight against this instance. Tells the user which background
 * work is running, how long it has been running (#391 — the Async-Job
 * rules require the "started X ago" timestamp), and which mutations
 * (sync, rename, delete, plan edits, entity create) are paused until
 * it finishes. A job past `STALE_JOB_HINT_MS` gets a "may be stuck"
 * line linking to the job detail view, where the Cancel affordance
 * lives — because a stranded job's promise of completion will only be
 * kept by the reconciliation sweep, and the user shouldn't have to
 * wait for it.
 *
 * Pure UI by the application-wide component file policy: takes the
 * running-jobs list via props, no SDK / SSE wiring of its own. The
 * consuming view container is responsible for fetching the list and
 * invalidating its query key on the SSE terminal event for any of the
 * listed jobs.
 */
export const ConnectorInstanceLockAlertUI: React.FC<
  ConnectorInstanceLockAlertUIProps
> = ({ runningJobs }) => {
  if (runningJobs.length === 0) return null;
  const phrase = joinRunningJobLabels(runningJobs);
  const isPlural = runningJobs.length > 1;
  const anyStale = runningJobs.some((j) =>
    isOlderThan(j.startedAt ?? j.created, STALE_JOB_HINT_MS)
  );
  return (
    <Box mb={2}>
      <Alert severity="info" variant="outlined">
        <AlertTitle>
          {phrase} {isPlural ? "are" : "is"} running
        </AlertTitle>
        {runningJobs.map((j) => {
          const startedEpoch = j.startedAt ?? j.created;
          const isStale = isOlderThan(startedEpoch, STALE_JOB_HINT_MS);
          return (
            <Typography key={j.id} variant="body2" component="div">
              {runningJobLabel(j)} — started {formatAgo(startedEpoch)}
              {isStale && (
                <>
                  {" — this job may be stuck. "}
                  <Link to="/jobs/$jobId" params={{ jobId: j.id }}>
                    <MuiLink component="span">View job</MuiLink>
                  </Link>
                  {" to check or cancel it."}
                </>
              )}
            </Typography>
          );
        })}
        <Typography variant="body2" component="div" sx={{ mt: 1 }}>
          Sync, rename, delete, plan edits, and creating new entities are paused
          until {isPlural ? "these jobs finish" : "this job finishes"}.
          {anyStale
            ? " The view refreshes automatically as job status changes."
            : ` The view will refresh automatically when ${isPlural ? "they're done" : "it's done"}.`}
        </Typography>
      </Alert>
    </Box>
  );
};
