import { JOB_TYPE_LABELS, type JobType } from "@portalai/core/models";
import type { RunningJobSummary } from "@portalai/core/contracts";

/**
 * Map a job's `type` to the human-readable phrase used in lock alerts and
 * disabled-action tooltips, from core's `JOB_TYPE_LABELS` (#769), which the
 * API's 409 message uses too, so the user sees one name for the work.
 *
 * Falls back to the raw type string for an unknown job type, so the UI never
 * shows an empty label.
 */
export function runningJobLabel(job: Pick<RunningJobSummary, "type">): string {
  return JOB_TYPE_LABELS[job.type as JobType] ?? job.type;
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

/** The page a lock reason is shown on (#769). */
export type LockedObject =
  | { kind: "connectorEntity"; id: string }
  | { kind: "connectorInstance"; id: string }
  | { kind: "columnDefinition"; id: string };

/**
 * #689, #769: the reason running jobs give every action they block on a page,
 * or `null` when nothing is running. One sentence, so the tooltips, the flags
 * and the layout-plan Commit all name the job alike, and it says where the
 * job runs: this entity, this connector, one of its entities, or an entity
 * that uses the column definition. `jobs` comes from that page's running-jobs
 * endpoint, so every job in it already blocks the page.
 */
export function jobLockReason(
  jobs: Pick<RunningJobSummary, "type" | "lockScopes">[],
  here: LockedObject
): string | null {
  if (jobs.length === 0) return null;
  const holds = (key: string) => jobs.some((j) => j.lockScopes?.includes(key));
  let where: string;
  switch (here.kind) {
    case "connectorEntity":
      where = holds(`entity:${here.id}`) ? "this entity" : "this connector";
      break;
    case "connectorInstance":
      where = holds(`instance:${here.id}`)
        ? "this connector"
        : "one of this connector's entities";
      break;
    case "columnDefinition":
      where = "an entity that uses this column definition";
      break;
  }
  const many = jobs.length > 1;
  return `${joinRunningJobLabels(jobs)} ${many ? "are" : "is"} running on ${where} — try again when ${many ? "they finish" : "it finishes"}.`;
}
