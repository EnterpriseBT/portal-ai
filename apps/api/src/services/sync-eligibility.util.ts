/**
 * Sync-eligibility guard.
 *
 * A `LayoutPlan` whose regions all use `column` or `composite` identity
 * strategies has stable `sourceId`s across re-runs, so the watermark-
 * based reconciliation works correctly. A region with `rowPosition`
 * identity uses synthesized cell-position ids (`cell-{r}-{c}` etc.) that
 * shift on every row insert/delete in the source sheet, making sync
 * "every record was deleted and re-created" — pathological churn.
 *
 * Both the sync-time route guard (Phase D Slice 5) and the frontend
 * "Sync now" disable check (Phase D Slice 6 via the redacted instance
 * shape) consume this. Phase C's commit-time review banner consumes the
 * same rule but reads region drafts directly off the editor state; the
 * shape difference is why this helper takes a `LayoutPlan` rather than
 * a `RegionDraft[]`.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-D.plan.md` §Slice 2.
 */

import type { LayoutPlan } from "@portalai/core/contracts";

export interface SyncEligibility {
  ok: boolean;
  ineligibleRegionIds: string[];
}

export function assertSyncEligibleIdentity(plan: LayoutPlan): SyncEligibility {
  const ineligibleRegionIds = plan.regions
    .filter((r) => r.identityStrategy?.kind === "rowPosition")
    .map((r) => r.id);
  return ineligibleRegionIds.length === 0
    ? { ok: true, ineligibleRegionIds: [] }
    : { ok: false, ineligibleRegionIds };
}
