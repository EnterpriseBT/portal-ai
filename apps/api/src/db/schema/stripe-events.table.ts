import { pgTable, text, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Stripe webhook event records (#176) — the dedup + audit table.
 *
 * One row per Stripe event id: the FULL UNIQUE on `event_id` is the atomic
 * dedup arbiter across instances (D2 — `insertIfNew` races resolve here),
 * and the row doubles as the audit trail of what each event did.
 *
 * Kept in sync with `StripeEventSchema` in `@portalai/core` via
 * `type-checks.ts`.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    ...baseColumns,
    /** Stripe `evt_…` id — the dedup key. */
    eventId: text("event_id").notNull(),
    /** e.g. "customer.subscription.updated" */
    type: text("type").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** Null when unmatched (Q2). */
    organizationId: text("organization_id").references(() => organizations.id),
    /** Tier slug written to the org (null if none). */
    resultingTier: text("resulting_tier"),
    // TS-narrowed to `StripeEventOutcomeSchema` in @portalai/core (kept in
    // sync by type-checks.ts; DDL stays plain text — the CHECK below is the
    // DB-level guard).
    outcome: text("outcome", {
      enum: ["applied", "noop", "unmatched", "ignored"],
    }).notNull(),
  },
  (t) => [
    // FULL unique (not soft-delete-partial) — the atomic dedup key.
    unique("stripe_events_event_id_unique").on(t.eventId),
    check(
      "stripe_events_outcome_check",
      sql`${t.outcome} IN ('applied', 'noop', 'unmatched', 'ignored')`
    ),
  ]
);
