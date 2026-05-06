import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Stations table.
 * A curated collection of connector instances grouped for analytics.
 *
 * Enabled toolpacks live in the `station_toolpacks` join table, not
 * on this row. List/get endpoints embed the joined slugs as
 * `enabledToolpacks` on the response payload.
 */
export const stations = pgTable("stations", {
  ...baseColumns,
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
});
