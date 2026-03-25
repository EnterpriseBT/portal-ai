import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { users } from "./users.table.js";

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
});
