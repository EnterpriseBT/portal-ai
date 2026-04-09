import {
  pgTable,
  text,
  bigint,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";

/**
 * Origin of an entity record — how it was created.
 * - `sync`: imported via connector sync (e.g. CSV import)
 * - `manual`: created via REST API / UI
 * - `portal`: created by an LLM tool during a portal session
 */
export const entityRecordOriginEnum = pgEnum("entity_record_origin", [
  "sync",
  "manual",
  "portal",
]);

export type EntityRecordOrigin = (typeof entityRecordOriginEnum.enumValues)[number];

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
    origin: entityRecordOriginEnum("origin").notNull().default("manual"),
    validationErrors: jsonb("validation_errors").$type<{ field: string; error: string }[]>(),
    isValid: boolean("is_valid").notNull(),
  },
  (table) => [
    uniqueIndex("entity_records_entity_source_unique")
      .on(table.connectorEntityId, table.sourceId)
      .where(sql`deleted IS NULL`),
    index("entity_records_normalized_data_gin").using(
      "gin",
      table.normalizedData
    ),
    index("entity_records_entity_synced_at_idx").on(
      table.connectorEntityId,
      table.syncedAt
    ),
    index("entity_records_entity_is_valid_idx").on(
      table.connectorEntityId,
      table.isValid
    ),
  ]
);
