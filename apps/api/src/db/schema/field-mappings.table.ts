import { pgTable, text, boolean, unique, foreignKey } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";
import { columnDefinitions } from "./column-definitions.table.js";

/**
 * Field mappings table.
 * Maps a source field name from a connector entity to a shared
 * column definition. When the mapped column is a reference type,
 * refColumnDefinitionId and refEntityKey capture the relationship
 * target at the per-entity level (rather than on the shared column
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

    // Reference fields (populated when the mapped column has type "reference" or "reference-array")
    refColumnDefinitionId: text("ref_column_definition_id").references(
      () => columnDefinitions.id,
    ),
    refEntityKey: text("ref_entity_key"),
    refBidirectionalFieldMappingId: text("ref_bidirectional_field_mapping_id"),
  },
  (table) => [
    unique("field_mappings_entity_column_unique").on(
      table.connectorEntityId,
      table.columnDefinitionId,
    ),
    foreignKey({
      columns: [table.refBidirectionalFieldMappingId],
      foreignColumns: [table.id],
    }),
  ],
);
