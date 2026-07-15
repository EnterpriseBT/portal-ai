import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Organization database model.
 * Extends CoreModel with organization-specific fields.
 *
 * Sync with the Drizzle `organizations` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts` and at runtime
 * via drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const OrganizationSchema = CoreSchema.extend({
  name: z.string(),
  timezone: z.string(),
  ownerUserId: z.string(), // ID of the user who owns this organization
  defaultStationId: z.string().nullable().default(null),
  /** Subscription tier slug — FK to `tiers.slug` (#172). Defaults to
   *  `standard`; the Stripe webhook (#176) writes this. */
  tier: z.string().default("standard"),
  /** Stripe linkage (#176). Null until first checkout / while unsubscribed. */
  stripeCustomerId: z.string().nullable().default(null),
  stripeSubscriptionId: z.string().nullable().default(null),
  /** Billing-cycle anchor day (1–28, webhook-written; null = calendar month). */
  billingAnchorDay: z.number().int().min(1).max(28).nullable().default(null),
});

export type Organization = z.infer<typeof OrganizationSchema>;

export class OrganizationModel extends CoreModel<Organization> {
  get schema() {
    return OrganizationSchema;
  }

  parse(): Organization {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<Organization> {
    return this.schema.safeParse(this._model);
  }
}

export class OrganizationModelFactory extends ModelFactory<
  Organization,
  OrganizationModel
> {
  create(createdBy: string): OrganizationModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const organizationModel = new OrganizationModel(baseModel.toJSON());
    return organizationModel;
  }
}
