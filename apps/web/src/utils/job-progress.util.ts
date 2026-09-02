import type { JobProgressDetail } from "@portalai/core/models";

/**
 * The three honest renderings of job progress (#458), in preference order:
 *
 * - `fraction` — structured detail with a known total: "X of Y records"
 *   with a determinate bar derived from the counts. The derived bar caps at
 *   99 (records-done still precedes finalization); only an asserted
 *   terminal percent of 100 completes it. The cap also absorbs a stale
 *   probe total that undercounts (`processed > total`).
 * - `count` — structured detail with an unknown total: "X records so far"
 *   with an indeterminate bar. No percent is shown anywhere — an absent
 *   number is the honest rendering of an unknown denominator.
 * - `percent` — no detail reported (milestone-style jobs): the scalar
 *   percent, exactly as before.
 *
 * One helper owns these rules so the sync toast, the job detail view, and
 * the job cards cannot drift apart.
 */
export type JobProgressDisplay =
  | { kind: "fraction"; barValue: number; label: string }
  | { kind: "count"; label: string }
  | { kind: "percent"; barValue: number; label: string };

export function formatJobProgress(
  detail: JobProgressDetail | null | undefined,
  percent: number
): JobProgressDisplay {
  if (detail && detail.total != null && detail.total > 0) {
    const derived = Math.min(
      99,
      Math.round((detail.processed / detail.total) * 100)
    );
    return {
      kind: "fraction",
      barValue: percent >= 100 ? 100 : derived,
      label: `${detail.processed.toLocaleString()} of ${detail.total.toLocaleString()} records`,
    };
  }
  if (detail) {
    return {
      kind: "count",
      label: `${detail.processed.toLocaleString()} records so far`,
    };
  }
  return {
    kind: "percent",
    barValue: percent,
    label: `${Math.round(percent)}%`,
  };
}
