import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { users } from "./users.table.js";
import { tiers } from "./tiers.table.js";

/**
 * Organizations table.
 */
export const organizations = pgTable("organizations", {
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
});
