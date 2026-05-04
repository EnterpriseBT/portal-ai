import type { IdentityStrategy, LayoutPlan } from "@portalai/core/contracts";

/**
 * Returns a new `LayoutPlan` with every region locked to `rowPosition`
 * identity and the resulting `ROW_POSITION_IDENTITY` advisory warning
 * stripped. File-upload-only: the lock and the warning suppression are
 * both context-specific to one-shot uploads, where stable-by-value
 * identity is meaningless and the rowPosition advisory ("breaks if rows
 * reorder") refers to a sync that never happens.
 *
 * Sets `identityStrategy.source = "user"` so subsequent re-interpret
 * passes (via `regionDraftsToHints`) preserve the lock rather than
 * letting the parser re-detect a column.
 */
export function lockPlanIdentityToRowPosition(plan: LayoutPlan): LayoutPlan {
  const lockedStrategy: IdentityStrategy = {
    kind: "rowPosition",
    confidence: 1,
    source: "user",
  };
  return {
    ...plan,
    regions: plan.regions.map((region) => ({
      ...region,
      identityStrategy: { ...lockedStrategy },
      warnings: (region.warnings ?? []).filter(
        (w) => w.code !== "ROW_POSITION_IDENTITY"
      ),
    })),
  };
}
