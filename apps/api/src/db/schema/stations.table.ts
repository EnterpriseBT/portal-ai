import { pgTable, text, jsonb } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Stations table.
 * A curated collection of connector instances grouped for analytics.
 */
export const stations = pgTable("stations", {
  ...baseColumns,
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
  toolPacks: jsonb("tool_packs").$type<string[]>().notNull(),
});
