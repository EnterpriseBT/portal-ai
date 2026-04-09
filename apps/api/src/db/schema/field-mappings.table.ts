import { pgTable, text, boolean, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";
import { columnDefinitions } from "./column-definitions.table.js";

/**
 * Field mappings table.
 * Maps a source field name from a connector entity to a shared
 * column definition. When the mapped column is a reference type,
 * refNormalizedKey and refEntityKey capture the relationship target
 * at the per-entity level (rather than on the shared column
 * definition catalog).
 */
export const fieldMappings = pgTable(
  "field_mappings",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    columnDefinitionId: text("column_definition_id")
      .notNull()
      .references(() => columnDefinitions.id),
    sourceField: text("source_field").notNull(),
    isPrimaryKey: boolean("is_primary_key").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    required: boolean("required").notNull(),
    defaultValue: text("default_value"),
    format: text("format"),
    enumValues: jsonb("enum_values").$type<string[]>(),

    // Reference fields (populated when the mapped column has type "reference" or "reference-array")
    refNormalizedKey: text("ref_normalized_key"),
    refEntityKey: text("ref_entity_key"),
  },
  (table) => [
    uniqueIndex("field_mappings_entity_normalized_key_unique")
      .on(table.connectorEntityId, table.normalizedKey)
      .where(sql`deleted IS NULL`),
  ],
);
