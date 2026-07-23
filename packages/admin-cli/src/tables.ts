/**
 * The CLI's own minimal drizzle table defs (#190, Decision 2).
 *
 * Runtime imports of apps/api are forbidden (module-load side effects,
 * inverted package graph), so the columns portalai touches are declared here
 * — and `__tests__/tables-parity.test.ts` pins every one of them against the
 * API's real schema (name, dataType, notNull). FK `.references()` are
 * deliberately omitted: the database enforces them; these defs exist for
 * query building only.
 */

import { bigint, pgTable, text } from "drizzle-orm/pg-core";

/** Mirrors apps/api/src/db/schema/base.columns.ts (parity-pinned). */
const base = {
  id: text("id").primaryKey(),
  created: bigint("created", { mode: "number" }).notNull(),
  createdBy: text("created_by").notNull(),
  updated: bigint("updated", { mode: "number" }),
  updatedBy: text("updated_by"),
  deleted: bigint("deleted", { mode: "number" }),
  deletedBy: text("deleted_by"),
};

export const organizations = pgTable("organizations", {
  ...base,
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  defaultStationId: text("default_station_id"),
  tier: text("tier").notNull().default("standard"),
  // #259: needed by the org set-tier Stripe-desync guard (and surfaced by
  // `org get`). A live subscription drives the tier, so set-tier must see it.
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
});

export const users = pgTable("users", {
  ...base,
  auth0Id: text("auth0_id").notNull(),
  email: text("email"),
  name: text("name"),
  picture: text("picture"),
  lastLogin: bigint("last_login", { mode: "number" }),
});

export const organizationUsers = pgTable("organization_users", {
  ...base,
  organizationId: text("organization_id").notNull(),
  userId: text("user_id").notNull(),
  lastLogin: bigint("last_login", { mode: "number" }),
});

/** Subset: only what setTier's existence check needs. */
export const tiers = pgTable("tiers", {
  ...base,
  slug: text("slug").notNull(),
});
