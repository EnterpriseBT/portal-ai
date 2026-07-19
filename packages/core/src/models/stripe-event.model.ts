import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Stripe webhook event record (#176) — the dedup + audit table.
 *
 * One row per Stripe event id (`evt_…`): the unique insert is the atomic
 * dedup gate (D2), and the row itself is the audit trail of what each
 * event did to the org's tier.
 *
 * Sync with the Drizzle `stripe_events` table is enforced at compile time
 * via `apps/api/src/db/schema/type-checks.ts`.
 */

/**
 * What processing the event resulted in:
 * - `applied` — tier/anchor written to the org
 * - `noop` — converged with no change
 * - `unmatched` — no org for the event's Stripe customer (Q2)
 * - `ignored` — non-subscription event type we verified but don't handle
 * - `foreign` — event for a subscription the org doesn't track, while it
 *   tracks a different one (double-checkout orphan, #230); recorded, not applied
 */
export const StripeEventOutcomeSchema = z.enum([
  "applied",
  "noop",
  "unmatched",
  "ignored",
  "foreign",
]);
export type StripeEventOutcome = z.infer<typeof StripeEventOutcomeSchema>;

export const StripeEventSchema = CoreSchema.extend({
  /** Stripe `evt_…` id — the dedup key. */
  eventId: z.string(),
  /** e.g. "customer.subscription.updated" */
  type: z.string(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  /** Null when unmatched. */
  organizationId: z.string().nullable(),
  /** Tier slug written to the org (null if none). */
  resultingTier: z.string().nullable(),
  outcome: StripeEventOutcomeSchema,
});

export type StripeEvent = z.infer<typeof StripeEventSchema>;

export class StripeEventModel extends CoreModel<StripeEvent> {
  get schema() {
    return StripeEventSchema;
  }

  parse(): StripeEvent {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<StripeEvent> {
    return this.schema.safeParse(this._model);
  }
}

export class StripeEventModelFactory extends ModelFactory<
  StripeEvent,
  StripeEventModel
> {
  create(createdBy: string): StripeEventModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new StripeEventModel(baseModel.toJSON());
  }
}
