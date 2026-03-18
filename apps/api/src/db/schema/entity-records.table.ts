import {
  pgTable,
  text,
  bigint,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";

/**
 * Entity records table.
 * JSONB row store for import and hybrid-mode connectors.
 * Each row represents a single data record belonging to a connector entity.
 */
export const entityRecords = pgTable(
  "entity_records",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    normalizedData: jsonb("normalized_data")
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceId: text("source_id").notNull(),
    checksum: text("checksum").notNull(),
    syncedAt: bigint("synced_at", { mode: "number" }).notNull(),
  },
  (table) => [
    unique("entity_records_entity_source_unique").on(
      table.connectorEntityId,
      table.sourceId
    ),
    index("entity_records_normalized_data_gin").using(
      "gin",
      table.normalizedData
    ),
    index("entity_records_entity_synced_at_idx").on(
      table.connectorEntityId,
      table.syncedAt
    ),
  ]
);
