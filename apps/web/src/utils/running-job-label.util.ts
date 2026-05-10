import type { RunningJobSummary } from "@portalai/core/contracts";

/**
 * Map a job's `type` to the human-readable phrase used both in the
 * connector-instance lock alert and in the disabled-button tooltips.
 * Keep these in lockstep so the user sees one consistent name for
 * the work they're racing.
 *
 * Falls back to the raw type string for unknown / future job types
 * so the UI never shows an empty label.
 */
export function runningJobLabel(job: Pick<RunningJobSummary, "type">): string {
  switch (job.type) {
    case "layout_plan_commit":
      return "Import";
    case "connector_sync":
      return "Sync";
    case "file_upload_parse":
      return "File parse";
    case "revalidation":
      return "Revalidation";
    default:
      return job.type;
  }
}

/**
 * Build a comma-separated phrase listing every running job by label —
 * "Import and Sync", "Import, Sync, and Revalidation", etc. Used by
 * the lock alert when more than one job is in flight against the same
 * entity (rare but possible: e.g., a stalled sync the user retried
 * + an awaiting-confirmation commit).
 */
export function joinRunningJobLabels(
  jobs: Pick<RunningJobSummary, "type">[]
): string {
  const labels = jobs.map(runningJobLabel);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
