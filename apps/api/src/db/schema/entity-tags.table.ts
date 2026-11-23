import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Entity tags table.
 * Org-scoped tags assigned to entities, stations, pins, connectors and views.
 */
export const entityTags = pgTable("entity_tags", {
  ...baseColumns,
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  color: text("color"),
  description: text("description"),
  // #1071: the portal session that created the tag (#641). Provenance only:
  // ownership is createdBy, and no permission check reads it.
  sourcePortalId: text("source_portal_id"),
});
