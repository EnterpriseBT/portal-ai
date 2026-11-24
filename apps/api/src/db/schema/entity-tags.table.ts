import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Entity tags table.
 * Org-scoped tags assigned to entities, stations, pins, connectors and views.
 */
export const entityTags = pgTable(
  "entity_tags",
  {
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
  },
  // #1071: names are unique per org among live tags. The service checks
  // first for a clean 409; this index is what holds when two creates or
  // renames race past that check (the agent issues tool calls in parallel).
  (table) => [
    uniqueIndex("entity_tags_org_name_unique")
      .on(table.organizationId, table.name)
      .where(sql`deleted IS NULL`),
  ]
);
