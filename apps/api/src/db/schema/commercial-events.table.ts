import { pgTable, text, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Commercial event records (#176, generalized #568) — the dedup + audit table
 * for every rail that writes `organizations.tier`.
 *
 * One row per `(source, external_id)`: the FULL UNIQUE on that pair is the
 * atomic dedup arbiter across instances (D2 — `insertIfNew` races resolve
 * here), and the row doubles as the audit trail of what each event did. The
 * same `external_id` may legitimately recur across different `source`s, so the
 * arbiter is the pair, not `external_id` alone.
 *
 * Kept in sync with `CommercialEventSchema` in `@portalai/core` via
 * `type-checks.ts`.
 */
export const commercialEvents = pgTable(
  "commercial_events",
  {
    ...baseColumns,
    /** The commercial rail (`stripe` | `aws_marketplace`). */
    source: text("source", { enum: ["stripe", "aws_marketplace"] }).notNull(),
    /** The rail's event id — Stripe `evt_…` or the SNS `MessageId`. */
    externalId: text("external_id").notNull(),
    /** e.g. "customer.subscription.updated" or the SNS notification action. */
    type: text("type").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** Null when unmatched. */
    organizationId: text("organization_id").references(() => organizations.id),
    /** Tier slug written to the org (null if none). */
    resultingTier: text("resulting_tier"),
    // TS-narrowed to `CommercialEventOutcomeSchema` in @portalai/core (kept in
    // sync by type-checks.ts; DDL stays plain text — the CHECK below is the
    // DB-level guard).
    outcome: text("outcome", {
      enum: ["applied", "noop", "unmatched", "ignored", "foreign"],
    }).notNull(),
  },
  (t) => [
    // FULL unique (not soft-delete-partial) — the atomic dedup key, keyed on
    // the (source, external_id) pair.
    unique("commercial_events_source_external_id_unique").on(
      t.source,
      t.externalId
    ),
    check(
      "commercial_events_source_check",
      sql`${t.source} IN ('stripe', 'aws_marketplace')`
    ),
    check(
      "commercial_events_outcome_check",
      sql`${t.outcome} IN ('applied', 'noop', 'unmatched', 'ignored', 'foreign')`
    ),
  ]
);
