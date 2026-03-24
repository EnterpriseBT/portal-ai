import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Entity tags table.
 * Org-scoped tags that can be assigned to connector entities for navigation.
 */
export const entityTags = pgTable("entity_tags", {
  ...baseColumns,
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  color: text("color"),
  description: text("description"),
});
