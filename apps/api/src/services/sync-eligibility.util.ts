/**
 * Sync-eligibility advisory.
 *
 * `rowPosition` identity uses synthesized cell-position ids (`row-{n}` /
 * `col-{n}` / `cell-{r}-{c}`) that shift on every row insert/delete in the
 * source sheet. Records sync correctly against the watermark reaper, but
 * any structural change to the sheet produces a full reap-and-recreate
 * delta — not a graceful per-row update. Surfacing the warning lets the UI
 * render a non-blocking advisory ("re-sync recreates all records in the
 * affected region(s)") without gating the sync itself; the user has
 * opted into the trade-off when committing the plan.
 *
 * Prior versions of this helper returned `ok: false` for `rowPosition` and
 * the sync route 409'd. The hard gate moved to an advisory in Phase B of
 * `docs/RECORD_IDENTITY_REVIEW.spec.md`.
 */

import type { LayoutPlan } from "@portalai/core/contracts";

export interface SyncEligibilityCheck {
  ok: true;
  identityWarnings: { regionId: string }[];
}

export function assertSyncEligibleIdentity(
  plan: LayoutPlan
): SyncEligibilityCheck {
  const identityWarnings = plan.regions
    .filter((r) => r.identityStrategy?.kind === "rowPosition")
    .map((r) => ({ regionId: r.id }));
  return { ok: true, identityWarnings };
}
