import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Subscription tier — the per-org unit-allocation contract.
 *
 * Two shapes live here:
 *
 * - {@link TierSchema} is the **flat DB-row** shape (hybrid storage: a scalar
 *   cost-class charge grid + a JSONB `perToolCaps`). It must stay in sync with
 *   the Drizzle `tiers` table — enforced at compile time via
 *   `apps/api/src/db/schema/type-checks.ts`. Its `periodKind`/`overage` fields
 *   are `string` because the DB columns are `text` (CHECK-constrained); the
 *   narrowed enums live on {@link TierPolicySchema}.
 * - {@link TierPolicySchema} is the **assembled, nested** shape that consumers
 *   read — the cost gate (#169) for allocations, the Settings display for
 *   what-you-get. `resolveTier` maps a row into a policy.
 *
 * See `docs/SUBSCRIPTION_TIER_POLICY.spec.md`.
 */

/** One cost class's allocation. `null` = unlimited (no cap) for that dimension. */
export const AllocationSchema = z.object({
  unitsPerPeriod: z.number().int().nonnegative().nullable(),
  ratePerMin: z.number().int().nonnegative().nullable(),
});
export type Allocation = z.infer<typeof AllocationSchema>;

/** The billing window. v1 ships only `monthly`; `anchorDay` lets a payment
 *  provider later set a real per-org anchor without a schema change. */
export const TierPeriodSchema = z.object({
  kind: z.literal("monthly"),
  anchorDay: z.number().int().min(1).max(28),
});
export type TierPeriod = z.infer<typeof TierPeriodSchema>;

/** Behavior when an allocation is exhausted. Per-tier for v1. */
export const OverageSchema = z.enum(["hard-deny", "soft-alert"]);
export type Overage = z.infer<typeof OverageSchema>;

/** Optional finer caps on individual tools (built-in or custom), by tool name. */
export const PerToolCapsSchema = z.record(
  z.string(),
  z.object({ unitsPerPeriod: z.number().int().nonnegative() })
);
export type PerToolCaps = z.infer<typeof PerToolCapsSchema>;

/**
 * The assembled tier policy handed to consumers. Allocations are keyed by the
 * three cost classes (`free | metered | expensive`, the `CostHintSchema`
 * vocabulary).
 */
export const TierPolicySchema = z.object({
  tier: z.string(), // the slug that resolved
  period: TierPeriodSchema,
  allocations: z.object({
    free: AllocationSchema,
    metered: AllocationSchema,
    expensive: AllocationSchema,
  }),
  perToolCaps: PerToolCapsSchema.nullable(),
  overage: OverageSchema,
});
export type TierPolicy = z.infer<typeof TierPolicySchema>;

/**
 * The flat `tiers` DB-row shape (hybrid). Scalar charge grid so "change a
 * charge" is a plain SQL `UPDATE`; JSONB only for the variable `perToolCaps`.
 * `null` in the grid means unlimited for that class/dimension.
 */
export const TierSchema = CoreSchema.extend({
  slug: z.string(),
  displayName: z.string(),
  periodKind: z.string(), // text column; narrowed to "monthly" on TierPolicy
  periodAnchorDay: z.number().int().min(1).max(28),
  overage: z.string(), // text column; narrowed to Overage on TierPolicy
  freeUnitsPerPeriod: z.number().int().nonnegative().nullable(),
  freeRatePerMin: z.number().int().nonnegative().nullable(),
  meteredUnitsPerPeriod: z.number().int().nonnegative().nullable(),
  meteredRatePerMin: z.number().int().nonnegative().nullable(),
  expensiveUnitsPerPeriod: z.number().int().nonnegative().nullable(),
  expensiveRatePerMin: z.number().int().nonnegative().nullable(),
  perToolCaps: PerToolCapsSchema.nullable(),
});
export type Tier = z.infer<typeof TierSchema>;

export class TierModel extends CoreModel<Tier> {
  get schema() {
    return TierSchema;
  }

  parse(): Tier {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<Tier> {
    return this.schema.safeParse(this._model);
  }
}

export class TierModelFactory extends ModelFactory<Tier, TierModel> {
  create(createdBy: string): TierModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new TierModel(baseModel.toJSON());
  }
}
