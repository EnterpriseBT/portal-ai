import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Commercial event record (#176, generalized #568) — the dedup + audit table
 * for every commercial rail that writes `organizations.tier`.
 *
 * One row per `(source, external_id)`: the unique insert is the atomic dedup
 * gate (D2), and the row itself is the audit trail of what each event did to
 * the org's tier. `source` discriminates the rail (Stripe subscription webhook
 * vs. AWS Marketplace SNS notification); `external_id` is that rail's event id
 * (Stripe `evt_…` or the SNS `MessageId`).
 *
 * Sync with the Drizzle `commercial_events` table is enforced at compile time
 * via `apps/api/src/db/schema/type-checks.ts`.
 */

/** The commercial rail an event arrived on. */
export const CommercialEventSourceSchema = z.enum([
  "stripe",
  "aws_marketplace",
]);
export type CommercialEventSource = z.infer<typeof CommercialEventSourceSchema>;

/**
 * What processing the event resulted in:
 * - `applied` — tier/anchor/term written to the org
 * - `noop` — converged with no change
 * - `unmatched` — no org for the event's subject
 * - `ignored` — an event type we verified but don't handle
 * - `foreign` — event for an entitlement the org doesn't track, while it
 *   tracks a different one (#230); recorded, not applied
 */
export const CommercialEventOutcomeSchema = z.enum([
  "applied",
  "noop",
  "unmatched",
  "ignored",
  "foreign",
]);
export type CommercialEventOutcome = z.infer<
  typeof CommercialEventOutcomeSchema
>;

export const CommercialEventSchema = CoreSchema.extend({
  /** The commercial rail (Stripe / AWS Marketplace). */
  source: CommercialEventSourceSchema,
  /** The rail's event id — Stripe `evt_…` or the SNS `MessageId`. Dedup key
   *  together with `source`. */
  externalId: z.string(),
  /** e.g. "customer.subscription.updated" or the SNS notification action. */
  type: z.string(),
  /** Stripe-rail audit context; null for other sources. */
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  /** Null when unmatched. */
  organizationId: z.string().nullable(),
  /** Tier slug written to the org (null if none). */
  resultingTier: z.string().nullable(),
  outcome: CommercialEventOutcomeSchema,
});

export type CommercialEvent = z.infer<typeof CommercialEventSchema>;

export class CommercialEventModel extends CoreModel<CommercialEvent> {
  get schema() {
    return CommercialEventSchema;
  }

  parse(): CommercialEvent {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<CommercialEvent> {
    return this.schema.safeParse(this._model);
  }
}

export class CommercialEventModelFactory extends ModelFactory<
  CommercialEvent,
  CommercialEventModel
> {
  create(createdBy: string): CommercialEventModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new CommercialEventModel(baseModel.toJSON());
  }
}
