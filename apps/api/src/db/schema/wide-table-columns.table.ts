import {
  pgTable,
  text,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";
import { fieldMappings } from "./field-mappings.table.js";
import { columnDefinitions } from "./column-definitions.table.js";

/**
 * Catalog of dynamic columns on each `er__<connector_entity_id>` wide
 * table. One row = one (connector_entity, field_mapping) → wide-table
 * column linkage. The reconciler is the only writer.
 *
 * `retired_at` is set when the source field_mapping is soft-deleted.
 * The Postgres column itself is *not* dropped at retire time — Phase 5
 * has a maintenance job for that. Until then, retired columns stay on
 * disk and are skipped by the statement cache.
 */
export const wideTableColumns = pgTable(
  "wide_table_columns",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    fieldMappingId: text("field_mapping_id")
      .notNull()
      .references(() => fieldMappings.id),
    columnDefinitionId: text("column_definition_id")
      .notNull()
      .references(() => columnDefinitions.id),
    /** Sanitized column name as it appears on the wide table (e.g. `c_amount`). */
    columnName: text("column_name").notNull(),
    /** Postgres type as it was applied (`numeric`, `text`, `boolean`, …). */
    pgType: text("pg_type").notNull(),
    /** Set when the source field-mapping is soft-deleted. */
    retiredAt: bigint("retired_at", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("wide_table_columns_entity_column_unique")
      .on(table.connectorEntityId, table.columnName)
      .where(sql`deleted IS NULL`),
    uniqueIndex("wide_table_columns_entity_field_mapping_unique")
      .on(table.connectorEntityId, table.fieldMappingId)
      .where(sql`deleted IS NULL`),
    index("wide_table_columns_entity_idx").on(table.connectorEntityId),
  ]
);
