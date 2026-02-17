import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";

/**
 * Organizations table.
 */
export const organizations = pgTable("organizations", {
  ...baseColumns,
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
});
