import { pgTable, text, integer, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { users } from "./users.table.js";
import { tiers } from "./tiers.table.js";

/**
 * Organizations table.
 */
export const organizations = pgTable(
  "organizations",
  {
    ...baseColumns,
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    defaultStationId: text("default_station_id"),
    /** Subscription tier slug — FK to the unique `tiers.slug` (#172). Every org
     *  resolves a tier from day one: `NOT NULL DEFAULT 'standard'` backfills
     *  existing rows on migration, and the `standard` tier is seeded first. */
    tier: text("tier")
      .notNull()
      .default("standard")
      .references(() => tiers.slug),
    /** Stripe linkage (#176). Null until first checkout / while unsubscribed.
     *  `stripe_customer_id` survives cancellation; `stripe_subscription_id`
     *  and `billing_anchor_day` are cleared on revert to `standard`. */
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    billingAnchorDay: integer("billing_anchor_day"),
  },
  (t) => [
    // PG UNIQUE ignores NULLs — "unique where not null" for both ids.
    unique("organizations_stripe_customer_id_unique").on(t.stripeCustomerId),
    unique("organizations_stripe_subscription_id_unique").on(
      t.stripeSubscriptionId
    ),
    check(
      "organizations_anchor_day_check",
      sql`${t.billingAnchorDay} IS NULL OR ${t.billingAnchorDay} BETWEEN 1 AND 28`
    ),
  ]
);
