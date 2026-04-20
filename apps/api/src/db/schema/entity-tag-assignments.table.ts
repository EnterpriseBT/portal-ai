import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";
import { entityTags } from "./entity-tags.table.js";

/**
 * Entity tag assignments table.
 * Join table linking connector entities to their assigned tags.
 */
export const entityTagAssignments = pgTable(
  "entity_tag_assignments",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    entityTagId: text("entity_tag_id")
      .notNull()
      .references(() => entityTags.id),
  },
  (table) => [
    uniqueIndex("entity_tag_assignments_entity_tag_unique")
      .on(table.connectorEntityId, table.entityTagId)
      .where(sql`deleted IS NULL`),
  ]
);
