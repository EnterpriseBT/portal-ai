import { pgTable, text, boolean, unique } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { connectorEntities } from "./connector-entities.table.js";
import { columnDefinitions } from "./column-definitions.table.js";

/**
 * Field mappings table.
 * Maps a source field name from a connector entity to a shared
 * column definition.
 */
export const fieldMappings = pgTable(
  "field_mappings",
  {
    ...baseColumns,
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    columnDefinitionId: text("column_definition_id")
      .notNull()
      .references(() => columnDefinitions.id),
    sourceField: text("source_field").notNull(),
    isPrimaryKey: boolean("is_primary_key").notNull(),
  },
  (table) => [
    unique("field_mappings_entity_column_unique").on(
      table.connectorEntityId,
      table.columnDefinitionId,
    ),
  ],
);
